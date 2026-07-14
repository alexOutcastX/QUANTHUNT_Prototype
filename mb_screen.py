# Full-universe multibagger screen (background job + cached results).
#
# The Multibagger tab's Screener view is simply "every stock whose ANALYSER
# score is 60+", computed over the whole listed NSE universe (~2,000
# equities). That is far too heavy for the browser, so a background thread
# runs the analyser's own scoring engine (multibagger.score over
# multibagger.fetch_metrics) per symbol on a worker pool — one Yahoo lookup
# per stock, no scraping — publishes matches LIVE as they are found, and
# caches the result to disk (survives restarts; deploy rsync excludes it).
#
# A coverage floor keeps junk out: with missing data the score is computed
# only over the pillars that HAVE data, so a stock with one strong pillar and
# nothing else must not sneak in.

import json
import logging
import os
import threading
import time

log = logging.getLogger("mb_screen")

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mb_screen.json")
TTL = 12 * 3600
WORKERS = 12

CRITERIA = {"min_score": 60, "min_coverage_pct": 60}

_lock = threading.Lock()
_thread = None
_state = {
    "status": "idle",       # idle | running | done | error
    "progress": "",
    "asof": 0,
    "universe": 0,
    "results": [],           # [{symbol, score, tier, probability_pct, coverage_pct,
                             #   price, vs_200dma, market_cap_cr, roe, debt_equity, sector}]
    "error": None,
}


def _load_disk():
    try:
        with open(_FILE) as f:
            saved = json.load(f)
        if isinstance(saved, dict) and isinstance(saved.get("results"), list):
            _state.update({
                "status": "done", "asof": saved.get("asof", 0),
                "universe": saved.get("universe", 0),
                "results": saved["results"],
            })
    except Exception:
        pass


_load_disk()


def _save_disk():
    try:
        payload = {k: _state[k] for k in ("asof", "universe", "results")}
        with open(_FILE + ".tmp", "w") as f:
            json.dump(payload, f)
        os.replace(_FILE + ".tmp", _FILE)
    except Exception:
        pass


def _run(universe_fn):
    global _thread
    try:
        import multibagger as mb
        from concurrent.futures import ThreadPoolExecutor

        syms = [x["symbol"] for x in (universe_fn() or []) if x.get("symbol")]
        with _lock:
            _state.update({"status": "running", "universe": len(syms), "error": None,
                           "results": [], "progress": f"0/{len(syms)} analysed"})

        results = []
        done_ct = [0]

        def check(s):
            hit = None
            try:
                metrics, ident = mb.fetch_metrics(s, with_history=False)
                r = mb.score(metrics)
                if (r["score"] >= CRITERIA["min_score"]
                        and r["coverage_pct"] >= CRITERIA["min_coverage_pct"]):
                    hit = {"symbol": s, "score": r["score"], "tier": r["tier"],
                           "probability_pct": r["probability_pct"],
                           "coverage_pct": r["coverage_pct"],
                           "price": ident.get("price"),
                           "chg": ident.get("chg"),
                           "volume": ident.get("volume"),
                           "relvol": ident.get("relvol"),
                           "vs_50dma": ident.get("vs_50dma"),
                           "vs_200dma": metrics.get("vs_200dma_pct"),
                           "pct_from_high": metrics.get("pct_from_high_pct"),
                           "market_cap_cr": metrics.get("mcap_cr"),
                           "roe": metrics.get("roe_pct"),
                           "debt_equity": metrics.get("debt_equity"),
                           "sector": ident.get("sector")}
            except Exception:
                pass
            with _lock:
                done_ct[0] += 1
                if hit:
                    results.append(hit)
                    _state["results"] = sorted(results, key=lambda x: -x["score"])
                if done_ct[0] % 10 == 0:
                    _state["progress"] = (f"{done_ct[0]}/{len(syms)} analysed · "
                                          f"{len(results)} scored {CRITERIA['min_score']}+")

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(check, syms))

        results.sort(key=lambda x: -x["score"])   # best score first
        with _lock:
            _state.update({"status": "done", "asof": int(time.time()),
                           "results": results, "progress": ""})
            _save_disk()
        log.info("mb_screen done: %d/%d score %d+", len(results), len(syms),
                 CRITERIA["min_score"])
    except Exception as e:
        log.error("mb_screen failed: %s", e)
        with _lock:
            # Keep any previous results usable; just record the failure.
            _state.update({"status": "done" if _state["results"] else "error",
                           "error": str(e), "progress": ""})
    finally:
        with _lock:
            _thread = None


def ensure_started(universe_fn, force: bool = False) -> None:
    """Kick the background screen if results are stale (or force=True) and no
    job is already running."""
    global _thread
    with _lock:
        if _thread is not None:
            return
        if not force and _state["status"] == "done" and time.time() - _state["asof"] < TTL:
            return
        _thread = threading.Thread(target=_run, args=(universe_fn,),
                                   name="mb-screen", daemon=True)
        _thread.start()


def snapshot() -> dict:
    with _lock:
        running = _thread is not None
        return {
            "status": "running" if running else _state["status"],
            "refreshing": running,
            "progress": _state["progress"],
            "asof": _state["asof"],
            "universe": _state["universe"],
            "matches": len(_state["results"]),
            "results": _state["results"],
            "criteria": CRITERIA,
            "error": _state["error"],
        }
