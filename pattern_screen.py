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
TTL = 3600            # a finished sweep stays fresh for an hour
WORKERS = 6
MIN_CONF = 55         # confidence floor for a hit
RECENT_BARS = 12      # formation must reach within the last N daily bars
MAX_SYMBOLS = 260     # hard cap per sweep (NIFTY 500 would hammer the feed)
PERIOD = "1y"

_lock = threading.Lock()
_threads: dict = {}    # index -> live worker thread
_states: dict = {}     # index -> state dict


def _blank(index: str) -> dict:
    return {"status": "idle", "progress": "", "asof": 0, "index": index,
            "universe": 0, "capped": False, "results": [], "error": None}


def _load_disk() -> None:
    global _states
    try:
        with open(_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict):
            _states = data
    except Exception:
        _states = {}


def _save_disk() -> None:
    try:
        with _lock:
            snap = json.dumps(_states)
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
        fresh = st["status"] == "done" and (time.time() - st["asof"]) < TTL
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

        def work(sym: str) -> None:
            hits = []
            try:
                candles = load_ohlc(sym, PERIOD, "1d")
                usable = [c for c in (candles or []) if c.get("c") is not None]
                if len(usable) >= 20:
                    px = usable[-1]["c"]
                    det = detect(usable)
                    last = len(usable) - 1
                    for p in det.get("patterns", []):
                        if (p.get("confidence", 0) >= MIN_CONF
                                and p.get("end_index", 0) >= last - RECENT_BARS):
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
                if hits:
                    results.extend(hits)
                st = _states[index]
                st["progress"] = f"{done[0]}/{len(syms)} scanned · {len(results)} hits"
                # live-publish, strongest first
                st["results"] = sorted(results, key=lambda h: -h["confidence"])

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(work, syms))

        with _lock:
            st = _states[index]
            st.update(status="done", asof=time.time(),
                      progress=f"{len(syms)} scanned · {len(st['results'])} hits")
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
            "matches": len(st.get("results", [])),
            "results": list(st.get("results", [])),
            "error": st.get("error"),
        }
