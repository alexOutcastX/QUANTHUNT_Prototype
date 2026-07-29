"""Historical replay — fills the track record for the last N trading days.

The live ledger only grows from the moment it ships, so the Historic tab starts
empty. This module replays the engines over recent history so the page has
something to show on day one: for each of the last N trading days it rebuilds
the exact indicator snapshot as it stood on that date, asks the engine what it
would have called, and settles the resulting trades against the actual highs
and lows that followed.

What this is NOT
----------------
A replayed call is a SIMULATION, not a track record. The engines' rules exist
today, so running them over last month is in-sample by construction — it cannot
tell you how the engine will do, only what its rules would have produced. Every
replayed row is stored with backfilled=1, kept in its own summary, and labelled
in the UI. The two populations are never quoted as one number.

Honesty rules baked into the replay
-----------------------------------
• No look-ahead: the snapshot for day D is computed from `df.iloc[:D+1]` only.
• Entries fill at the NEXT bar's open — you cannot buy at the close that
  produced the signal.
• When a bar's range covers both the stop and the target, the STOP is taken.
  Intrabar order is unknowable from daily data, so the replay resolves the
  ambiguity against itself rather than in its own favour.
• Multibagger is not replayed at all. Its score needs point-in-time
  fundamentals — balance-sheet data as it stood on that date — which we do not
  have. Reconstructing it from today's figures would be look-ahead of the worst
  kind: it would "pick" exactly the companies that turned out well.
"""
from __future__ import annotations

import logging
import threading
import time

import tradelog

log = logging.getLogger("backfill")

DAYS = 30                    # trading days of history to replay
WORKERS = 3                  # modest: the scanner shares the outbound Yahoo cap
UNIVERSE = "NIFTY 100"
MAX_SYMBOLS = 120
HISTORY = "2y"               # recommend.analyze wants 200+ bars before day one

STATE_KEY = "tradelog.backfill.v1"

_lock = threading.Lock()
_thread = None
_state = {"status": "idle", "done": 0, "total": 0, "opened": 0, "settled": 0,
          "symbol": "", "error": None, "finished": 0}


# ── frame helpers ────────────────────────────────────────────────────────────
def to_candles(df) -> list:
    """OHLCV frame → the chronological dicts recommend.analyze expects."""
    out = []
    for i in range(len(df)):
        try:
            out.append({
                "t": int(df.index[i].timestamp()),
                "o": float(df["Open"].iloc[i]),
                "h": float(df["High"].iloc[i]),
                "l": float(df["Low"].iloc[i]),
                "c": float(df["Close"].iloc[i]),
                "v": float(df["Volume"].iloc[i]),
            })
        except (TypeError, ValueError, AttributeError):
            continue
    return out


def walk_forward(candles: list, start: int, entry: float, stop, target,
                 horizon_days: int, side: str = "long"):
    """Settle one trade against the bars that actually followed it.

    Returns (status, exit_price, exit_epoch) or None if it never resolved and is
    still running at the end of the data. `start` is the index of the ENTRY bar.
    A bar whose range covers both levels is treated as a stop-out — see the
    module docstring."""
    if start >= len(candles):
        return None
    opened_t = candles[start]["t"]
    deadline = opened_t + horizon_days * 86400
    for j in range(start, len(candles)):
        c = candles[j]
        if side == "short":
            hit_stop = stop is not None and c["h"] >= stop
            hit_tgt = target is not None and c["l"] <= target
        else:
            hit_stop = stop is not None and c["l"] <= stop
            hit_tgt = target is not None and c["h"] >= target
        if hit_stop:                      # pessimistic when both are touched
            return ("lost", float(stop), c["t"])
        if hit_tgt:
            return ("won", float(target), c["t"])
        if c["t"] >= deadline:
            return ("closed", c["c"], c["t"])
    return None


# ── the replay ───────────────────────────────────────────────────────────────
def replay_symbol(sym: str, df, name: str = None, days: int = DAYS) -> dict:
    """Replay both replayable engines over one symbol's recent history and write
    the resulting trades to the ledger. Returns {opened, settled}."""
    import momentum_screen
    import recommend
    import scanner

    candles = to_candles(df)
    n = len(candles)
    opened = settled = 0
    if n < 60:
        return {"opened": 0, "settled": 0}

    first = max(40, n - days - 1)
    # Live-record semantics: at most one open trade per source at a time, so a
    # signal that repeats for ten days running is one call, not ten.
    busy_until = {"reco": -1, "momentum": -1}

    for i in range(first, n - 1):
        entry_px = candles[i + 1]["o"]     # fills at the next open, not this close
        entry_t = candles[i + 1]["t"]
        if not entry_px or entry_px <= 0:
            continue

        picks = []
        if i > busy_until["reco"]:
            rec = recommend.analyze(sym, candles[:i + 1], None, name)
            if rec.get("action") == "BUY":
                eta = rec.get("eta_days")
                horizon = (max(21, min(180, round(eta * 1.4))) if eta
                           else tradelog.HORIZON["reco"])
                picks.append(("reco", {
                    "symbol": sym, "name": name, "side": "long",
                    "strategy": (f"BUY · {rec['confidence']}% confidence"
                                 if rec.get("confidence") is not None else "BUY"),
                    "entry": entry_px, "stop": rec.get("stop"), "target": rec.get("target"),
                    "horizon_days": horizon, "rationale": rec.get("rationale") or [],
                    "meta": {k: rec.get(k) for k in
                             ("confidence", "momentum_score", "pattern_score", "pattern",
                              "rr", "upside_pct") if rec.get(k) is not None},
                    "backfilled": True,
                }))

        if i > busy_until["momentum"]:
            t = scanner.row_from_frame(df.iloc[:i + 1])
            read = momentum_screen.classify(t) if t else None
            if read and read.get("score", 0) >= tradelog.MOM_MIN_SCORE:
                cands = [x for x in (t.get("high52"), t.get("r3"), t.get("cam_h4"))
                         if x and x > entry_px]
                picks.append(("momentum", {
                    "symbol": sym, "name": name, "side": "long",
                    "strategy": tradelog.SETUP_STRATEGY.get(read.get("setup"), "Momentum setup"),
                    "entry": entry_px, "stop": None,
                    "target": round(max(cands), 2) if cands else None,
                    "horizon_days": tradelog.HORIZON["momentum"],
                    "rationale": (read.get("signals") or [])[:6],
                    "meta": {"score": read.get("score"), "probability": read.get("probability"),
                             "setup": read.get("setup")},
                    "backfilled": True,
                }))

        for source, pick in picks:
            tid = tradelog.open_trade(source, pick, entry_t)
            opened += 1
            res = walk_forward(candles, i + 1, entry_px, pick["stop"], pick["target"],
                               pick["horizon_days"])
            if res:
                status, exit_px, exit_t = res
                tradelog.settle(tid, status, round(exit_px, 2), exit_t)
                settled += 1
                # Free the slot from the bar it actually closed on.
                busy_until[source] = _index_at(candles, exit_t, i)
            else:
                tradelog.mark(tid, round(candles[-1]["c"], 2), candles[-1]["t"])
                busy_until[source] = n     # still running — no re-entry
    return {"opened": opened, "settled": settled}


def _index_at(candles: list, epoch: int, floor_i: int) -> int:
    for j in range(floor_i, len(candles)):
        if candles[j]["t"] >= epoch:
            return j
    return len(candles)


def _universe(universe_fn=None) -> list:
    """Symbols to replay: an index constituent list, capped. Falls back to the
    app universe when the index feed is unreachable."""
    try:
        import server
        rows, _src = server._get_constituents(UNIVERSE)
        syms = [{"symbol": x["symbol"], "name": x.get("name")} for x in (rows or [])
                if x.get("symbol")]
        if syms:
            return syms[:MAX_SYMBOLS]
    except Exception as e:
        log.warning("backfill: index feed unavailable (%s)", e)
    try:
        return rows_of(universe_fn() if universe_fn else [])[:MAX_SYMBOLS]
    except Exception as e:
        log.warning("backfill: universe unavailable (%s)", e)
        return []


def rows_of(uni) -> list:
    """Normalise whatever a universe callable returned into symbol rows.

    server.get_universe_nonblocking() returns (rows, warming); get_universe()
    returns a bare list. Taking the first for the second silently replays an
    empty universe — and iterating the tuple as rows is what 500'd the penny
    route — so both shapes are accepted explicitly."""
    if isinstance(uni, tuple):
        uni = uni[0]
    return [{"symbol": x["symbol"], "name": x.get("name")}
            for x in (uni or []) if isinstance(x, dict) and x.get("symbol")]


def _run(universe_fn, days) -> None:
    global _thread
    try:
        import store
        import ydata
        from concurrent.futures import ThreadPoolExecutor

        syms = _universe(universe_fn)
        with _lock:
            _state.update({"status": "running", "total": len(syms), "done": 0,
                           "opened": 0, "settled": 0, "error": None})
        if not syms:
            raise RuntimeError("no universe to replay")

        def one(item):
            sym = item["symbol"]
            try:
                df = ydata.history(f"{sym}.NS", HISTORY, "1d")
                if df is None or df.empty:
                    return
                res = replay_symbol(sym, df, item.get("name"), days)
                with _lock:
                    _state["opened"] += res["opened"]
                    _state["settled"] += res["settled"]
            except Exception as e:
                log.debug("backfill %s failed: %s", sym, e)
            finally:
                with _lock:
                    _state["done"] += 1
                    _state["symbol"] = sym

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(one, syms))

        with _lock:
            _state.update({"status": "done", "finished": int(time.time()), "symbol": ""})
            store.kv_set(STATE_KEY, {"at": _state["finished"], "days": days,
                                     "symbols": len(syms), "opened": _state["opened"]})
        log.info("backfill done: %d trades over %d symbols (%d settled)",
                 _state["opened"], len(syms), _state["settled"])
    except Exception as e:
        log.error("backfill failed: %s", e)
        with _lock:
            _state.update({"status": "error", "error": str(e)})
    finally:
        with _lock:
            _thread = None


def ensure_started(universe_fn=None, force: bool = False, days: int = DAYS) -> bool:
    """Run the replay once, in the background. Idempotent across restarts — the
    completion marker lives in the store, so a redeploy doesn't refill the
    ledger and double the record."""
    global _thread
    import store
    with _lock:
        if _thread is not None:
            return False
    if not force and store.kv_get(STATE_KEY):
        return False
    with _lock:
        if _thread is not None:
            return False
        _thread = threading.Thread(target=_run, args=(universe_fn, days),
                                   name="tradelog-backfill", daemon=True)
        _thread.start()
        return True


def progress() -> dict:
    with _lock:
        running = _thread is not None
        s = dict(_state)
    s["running"] = running
    s["pct"] = round(s["done"] / s["total"] * 100, 1) if s["total"] else 0.0
    return s
