"""One prebuilt screener payload per universe, rebuilt twice a day.

The screening console used to open in four waves: /index for the constituents
and their quotes, /universe for company names, /scan in three batches for the
technicals, /fundamentals/bulk in three more. Seven requests, most of them
waiting on the one before, for a table whose every number is derived from daily
bars and does not change between them.

The caches behind those routes were already warm — measured on the live server,
NIFTY 500 came back 500/500 cached. The cost was never the computation. It was
the shape of the conversation.

So the merge happens here instead, on a schedule, and the console asks for it
once. Everything a row needs — name, exchange, the session's close, the
technicals, the fundamentals — arrives in a single response built while nobody
was waiting.

WHEN, and why those two times:

  16:00 IST  the NSE closes at 15:30 and the bhavcopy settles shortly after,
             so this is the first moment the day's real closing numbers exist.
  02:00 IST  the overnight pass. Fundamentals arrive on filing schedules
             rather than market ones, and the upstream is idle at 2am, which
             is when a sweep that costs hundreds of history calls belongs.

Both are configurable (SNAPSHOT_TIMES) and both are IST regardless of where
the server thinks it is, because the schedule is about an exchange, not about
a machine.

A snapshot is never the whole truth during market hours: it carries the last
settled close. The client overlays live quotes on top when the market is open,
which is one extra request that can happen AFTER the table is already on
screen, rather than three that have to happen before it.
"""

import datetime as _dt
import json
import logging
import os
import threading
import time

log = logging.getLogger(__name__)

# Universes worth prebuilding. NIFTY 500 contains 50/100/200, so the list is
# short by design — a snapshot per sectoral index would multiply the build cost
# for rows already inside the broad one.
INDICES = [n.strip() for n in os.environ.get(
    "SNAPSHOT_INDICES", "NIFTY 500,NIFTY MIDCAP 100,NIFTY SMALLCAP 100").split(",") if n.strip()]

# IST, as HH:MM, comma separated.
TIMES = [t.strip() for t in os.environ.get("SNAPSHOT_TIMES", "16:00,02:00").split(",") if t.strip()]

IST = _dt.timezone(_dt.timedelta(hours=5, minutes=30))

_FILE = os.environ.get("SNAPSHOT_FILE", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "screener_snapshots.json"))

# A snapshot older than this is not served. Two builds a day means a healthy
# one is at most ~14h old; 36h covers a missed build and a weekend gap without
# ever serving numbers from another week.
MAX_AGE = int(os.environ.get("SNAPSHOT_MAX_AGE", str(36 * 3600)))

_LOCK = threading.Lock()
_SNAPS: dict = {}          # index name -> payload
_building: set = set()


def _now() -> float:
    return time.time()


def next_run_at(times=None, now=None) -> float:
    """Epoch seconds of the next scheduled build.

    Times are wall-clock IST. Written against a timezone-aware clock rather
    than "sleep 12 hours from boot", so a restart at 15:59 does not push the
    close-of-day build to the middle of the next afternoon.
    """
    times = times or TIMES
    now = now or _dt.datetime.now(IST)
    best = None
    for t in times:
        try:
            hh, mm = (int(x) for x in t.split(":", 1))
        except ValueError:
            continue
        when = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if when <= now:
            when += _dt.timedelta(days=1)
        if best is None or when < best:
            best = when
    if best is None:                                  # no parseable time
        best = now + _dt.timedelta(hours=12)
    return best.timestamp()


def _load() -> None:
    try:
        with open(_FILE) as fh:
            disk = json.load(fh)
    except Exception:
        return
    now = _now()
    with _LOCK:
        for name, snap in (disk.get("snapshots") or {}).items():
            if isinstance(snap, dict) and (now - float(snap.get("built_at") or 0)) < MAX_AGE:
                _SNAPS[name] = snap
    if _SNAPS:
        log.info("Snapshots: loaded %d from disk", len(_SNAPS))


def _save() -> None:
    try:
        with _LOCK:
            payload = {"snapshots": dict(_SNAPS)}
        tmp = _FILE + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(payload, fh, separators=(",", ":"))
        os.replace(tmp, _FILE)
    except Exception as e:
        log.warning("Snapshots: could not save: %s", e)


def build(name: str, constituents, technicals, fundamentals, names=None) -> dict:
    """Merge one universe into the payload the console renders.

    Pure: every source is passed in. That is what lets the whole merge be
    tested without a network, a cache or a running server — the thing that
    made the four-wave version hard to check.
    """
    rows = []
    names = names or {}
    for c in constituents or []:
        sym = (c.get("symbol") or "").strip().upper()
        if not sym:
            continue
        meta = names.get(sym) or {}
        row = {
            "sym": sym,
            "name": meta.get("name") or c.get("name") or sym,
            "exchange": meta.get("exchange") or "NSE",
            # The session's settled numbers. A snapshot is EOD by definition;
            # anything live is overlaid by the client.
            "price": c.get("price"),
            "prevClose": c.get("prevClose"),
            "chg": c.get("chg"),
            "absChg": c.get("absChg"),
            "volume": c.get("volume"),
        }
        tech = (technicals or {}).get(sym)
        if tech:
            # Quote fields already set above win: the scan row's price can be a
            # bar older than the constituent feed's.
            for k, v in tech.items():
                if k not in row or row[k] is None:
                    row[k] = v
        fund = (fundamentals or {}).get(sym)
        row["_fund"] = fund if fund else None
        rows.append(row)

    covered = sum(1 for r in rows if r.get("rsi") is not None)
    with_fund = sum(1 for r in rows if r.get("_fund"))
    return {
        "index": name,
        "built_at": int(_now()),
        "count": len(rows),
        "technicals": covered,
        "fundamentals": with_fund,
        "rows": rows,
    }


def put(name: str, snap: dict) -> None:
    with _LOCK:
        _SNAPS[name] = snap
    _save()


def get(name: str):
    """The snapshot for one universe, or None when there is nothing worth
    serving. Age is checked here rather than by the caller so a stale one
    cannot be served by a route that forgot to look."""
    with _LOCK:
        snap = _SNAPS.get(name)
    if not snap:
        return None
    if (_now() - float(snap.get("built_at") or 0)) > MAX_AGE:
        return None
    return snap


def status() -> dict:
    with _LOCK:
        snaps = {
            n: {"built_at": s.get("built_at"), "count": s.get("count"),
                "technicals": s.get("technicals"), "fundamentals": s.get("fundamentals"),
                "age_sec": int(_now() - float(s.get("built_at") or 0))}
            for n, s in _SNAPS.items()
        }
    return {"indices": INDICES, "times_ist": TIMES, "max_age_sec": MAX_AGE,
            "next_run_at": int(next_run_at()), "snapshots": snaps,
            "building": sorted(_building)}


def run_once(builder) -> dict:
    """Rebuild every configured universe. `builder(name)` returns a payload.

    One index failing must not cost the others theirs: a snapshot that is a
    day old still beats no snapshot, so a failed build leaves the previous one
    in place rather than clearing it.
    """
    done = {}
    for name in INDICES:
        with _LOCK:
            _building.add(name)
        try:
            snap = builder(name)
            if snap and snap.get("count"):
                put(name, snap)
                done[name] = snap["count"]
                log.info("Snapshot: %s -> %d rows (%d technicals, %d fundamentals)",
                         name, snap["count"], snap.get("technicals", 0),
                         snap.get("fundamentals", 0))
            else:
                log.warning("Snapshot: %s produced nothing; keeping the previous one", name)
        except Exception as e:
            log.warning("Snapshot: %s failed (%s); keeping the previous one", name, e)
        finally:
            with _LOCK:
                _building.discard(name)
    return done


def start(builder, build_on_boot=True) -> None:
    """Run the schedule forever in a daemon thread."""
    _load()

    def _loop():
        # A boot build only when there is nothing to serve. Restarting the
        # service should not cost a full sweep of the upstream if a snapshot
        # from this morning is already on disk.
        if build_on_boot:
            time.sleep(20)                     # let the service settle first
            if not any(get(n) for n in INDICES):
                run_once(builder)
        while True:
            wait = max(30.0, next_run_at() - _now())
            time.sleep(wait)
            run_once(builder)

    threading.Thread(target=_loop, name="screener-snapshot", daemon=True).start()


def _reset_for_tests() -> None:
    with _LOCK:
        _SNAPS.clear()
        _building.clear()
