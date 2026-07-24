# Index-wide chart-pattern screener (background job + cached results).
#
# The Patterns tab's single-symbol recogniser answers "what patterns does this
# stock show?" — this module answers the inverse: "which stocks in an index are
# showing a pattern right now?". Scanning an index means one OHLC history per
# constituent, far too slow for a request/response cycle, so a background
# thread sweeps the constituents on a small worker pool (the shared _load_ohlc
# cache + Yahoo limiter do the rate-limit heavy lifting), publishes hits LIVE
# as they are found, and caches the finished sweep to disk for an hour.
#
# Only *fresh* detections count: the formation must reach into the last
# RECENT_BARS daily bars and clear MIN_CONF, otherwise every stock would match
# on some months-old triangle and the screen would be noise.

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

log = logging.getLogger("pattern_screen")

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pattern_screen.json")
_SCHEMA = 2           # bump to invalidate persisted sweeps after detector/filter changes
TTL = 3600            # a finished sweep stays fresh for an hour
TTL_PARTIAL = 600     # a rate-limited (partial) sweep retries much sooner
WORKERS = 6
RETRY_WORKERS = 2     # gentler second pass for symbols the feed refused
MIN_CONF = 55         # confidence floor for a hit
RECENT_BARS = 15      # formation must reach within the last N daily bars (~3 weeks)
MAX_SYMBOLS = 260     # hard cap per sweep (NIFTY 500 would hammer the feed)
PERIOD = "1y"
PARTIAL_FRACTION = 0.4  # >40% of symbols without data => sweep marked partial

_lock = threading.Lock()
_threads: dict = {}    # index -> live worker thread
_states: dict = {}     # index -> state dict


def _blank(index: str) -> dict:
    return {"status": "idle", "progress": "", "asof": 0, "index": index,
            "universe": 0, "capped": False, "results": [], "error": None,
            "scanned_ok": 0, "no_data": 0, "partial": False}


def _load_disk() -> None:
    global _states
    try:
        with open(_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict) and data.get("_v") == _SCHEMA:
            states = data.get("states")
            if isinstance(states, dict):
                _states = states
    except Exception:
        _states = {}


def _save_disk() -> None:
    try:
        with _lock:
            snap = json.dumps({"_v": _SCHEMA, "states": _states})
        tmp = _FILE + ".tmp"
        with open(tmp, "w") as f:
            f.write(snap)
        os.replace(tmp, _FILE)
    except Exception:
        log.debug("pattern_screen disk save failed", exc_info=True)


_load_disk()


def ensure(index: str, constituents_fn, load_ohlc, detect, force: bool = False) -> None:
    """Start a sweep for `index` unless a fresh one (or a live worker) exists."""
    with _lock:
        st = _states.get(index)
        if st is None:
            st = _blank(index)
            _states[index] = st
        # A partial sweep (feed rate-limited most symbols away) goes stale much
        # sooner, so the next visit automatically fills in the gaps.
        ttl = TTL_PARTIAL if st.get("partial") else TTL
        fresh = st["status"] == "done" and (time.time() - st["asof"]) < ttl
        if (fresh and not force) or _threads.get(index):
            return
        t = threading.Thread(
            target=_run, args=(index, constituents_fn, load_ohlc, detect),
            name=f"pattern-screen-{index}", daemon=True)
        _threads[index] = t
    t.start()


def _run(index: str, constituents_fn, load_ohlc, detect) -> None:
    try:
        rows, _src = constituents_fn(index)
        syms = [r.get("symbol") for r in (rows or []) if r.get("symbol")]
        capped = len(syms) > MAX_SYMBOLS
        if capped:
            syms = syms[:MAX_SYMBOLS]
        with _lock:
            st = _states[index]
            st.update(status="running", progress=f"0/{len(syms)}",
                      universe=len(syms), capped=capped, error=None, results=[])
        if not syms:
            with _lock:
                _states[index].update(status="error", error="No constituents for this index right now — retry shortly.")
            return

        results: list = []
        done = [0]
        ok = [0]
        nodata: list = []

        def work(sym: str) -> bool:
            """Scan one symbol; returns True when price history was available."""
            hits = []
            got_data = False
            try:
                candles = load_ohlc(sym, PERIOD, "1d")
                usable = [c for c in (candles or []) if c.get("c") is not None]
                if len(usable) >= 20:
                    got_data = True
                    px = usable[-1]["c"]
                    det = detect(usable)
                    # detect() strips bar indices from its output, so recency is
                    # judged on end_ts: the formation must reach into the last
                    # RECENT_BARS daily bars (cutoff = that bar's timestamp).
                    cutoff = usable[max(0, len(usable) - 1 - RECENT_BARS)].get("t") or 0
                    for p in det.get("patterns", []):
                        if (p.get("confidence", 0) >= MIN_CONF
                                and (p.get("end_ts") or 0) >= cutoff):
                            hits.append({
                                "symbol": sym,
                                "price": round(float(px), 2) if px is not None else None,
                                "type": p["type"], "label": p["label"],
                                "bias": p["bias"], "category": p["category"],
                                "status": p.get("status"),
                                "confidence": p["confidence"],
                                "continuation": p.get("continuation"),
                                "expansion_pct": p.get("expansion_pct"),
                                "target": p.get("target"),
                                "start_ts": p.get("start_ts"), "end_ts": p.get("end_ts"),
                            })
            except Exception:
                log.debug("pattern sweep failed for %s", sym, exc_info=True)
            with _lock:
                done[0] += 1
                if got_data:
                    ok[0] += 1
                if hits:
                    results.extend(hits)
                st = _states[index]
                st["progress"] = f"{done[0]}/{len(syms)} scanned · {len(results)} hits"
                # live-publish, strongest first
                st["results"] = sorted(results, key=lambda h: -h["confidence"])
                st["scanned_ok"] = ok[0]
            return got_data

        def sweep(batch, workers):
            missed = []
            with ThreadPoolExecutor(max_workers=workers) as pool:
                for sym, got in zip(batch, pool.map(work, batch)):
                    if not got:
                        missed.append(sym)
            return missed

        # First pass at full speed, then a gentler retry for every symbol the
        # feed refused (usually a transient Yahoo rate-limit) — without this a
        # throttled sweep finishes "done · 0 hits" and looks like the scanner
        # is broken.
        nodata = sweep(syms, WORKERS)
        if nodata:
            with _lock:
                _states[index]["progress"] = (
                    f"retrying {len(nodata)} rate-limited symbols…")
            done[0] -= len(nodata)  # they re-count as the retry completes
            nodata = sweep(nodata, RETRY_WORKERS)

        with _lock:
            st = _states[index]
            partial = len(nodata) > len(syms) * PARTIAL_FRACTION
            st.update(status="done", asof=time.time(),
                      scanned_ok=ok[0], no_data=len(nodata), partial=partial,
                      progress=f"{ok[0]}/{len(syms)} scanned · {len(st['results'])} hits"
                               + (f" · {len(nodata)} no data" if nodata else ""))
        _save_disk()
    except Exception as e:
        log.error("pattern screen failed for %s: %s", index, e)
        with _lock:
            _states[index].update(status="error", error=str(e))
    finally:
        with _lock:
            _threads.pop(index, None)


def snapshot(index: str) -> dict:
    with _lock:
        st = _states.get(index) or _blank(index)
        running = _threads.get(index) is not None
        return {
            "status": "running" if running else st["status"],
            "refreshing": running,
            "progress": st.get("progress", ""),
            "asof": st.get("asof", 0),
            "index": index,
            "universe": st.get("universe", 0),
            "capped": st.get("capped", False),
            "scanned_ok": st.get("scanned_ok", 0),
            "no_data": st.get("no_data", 0),
            "partial": st.get("partial", False),
            "matches": len(st.get("results", [])),
            "results": list(st.get("results", [])),
            "error": st.get("error"),
        }


# ── Trade Scan: entry / target / stop / R:R from a detected pattern ──────────
def trade_setup(pat: dict, price) -> dict | None:
    """Derive a tradeable setup from a detected pattern at the current price.

    Target = the pattern's measured-move objective (its own target, else the
    expansion % projected from price). Stop = the invalidation side: the key
    level when it sits on the correct side of entry, else half the measured
    move (a 2:1 setup). Returns None when the geometry doesn't produce a
    coherent setup (target/stop on the wrong side of entry)."""
    if not pat or price is None or price <= 0:
        return None
    bull = pat.get("bias") != "bearish"
    target = pat.get("target")
    if target is None and pat.get("expansion_pct") is not None:
        target = price * (1 + pat["expansion_pct"] / 100.0)
    if target is None:
        return None
    level = pat.get("level")
    if bull:
        if target <= price:
            return None
        stop = level if (level is not None and level < price) else price - (target - price) / 2
        if stop >= price:
            return None
    else:
        if target >= price:
            return None
        stop = level if (level is not None and level > price) else price + (price - target) / 2
        if stop <= price:
            return None
    risk = abs(price - stop)
    if risk <= 0:
        return None
    return {"entry": round(price, 2), "target": round(target, 2),
            "stop": round(stop, 2), "rr": round(abs(target - price) / risk, 2)}
