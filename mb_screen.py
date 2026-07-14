# Full-universe multibagger screen (background job + cached results).
#
# The Multibagger tab's fixed screen must cover the WHOLE listed universe
# (~2,000 NSE equities), which is far too heavy to scan from the browser.
# Instead a background thread runs the screen server-side in two stages and
# caches the result to disk (survives restarts; deploy rsync excludes it):
#
#   Stage 1 (cheap, batched): 1y of daily closes via yf.download in chunks →
#           keep only stocks trading above their 200-DMA (the trend gate
#           removes ~half the universe before any per-symbol work).
#   Stage 2 (per symbol, cached): fundamentals via the fundamentals provider
#           chain (7-day disk cache) → apply the fixed criteria:
#           market cap < ₹20,000 cr · ROE > 15% · D/E < 0.6.
#
# First run takes minutes (progress is reported); later runs are mostly cache
# hits. Results refresh every 12 hours.

import json
import logging
import os
import threading
import time

log = logging.getLogger("mb_screen")

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mb_screen.json")
TTL = 12 * 3600
CHUNK = 150

CRITERIA = {"mcap_max_cr": 20000, "roe_min": 15, "de_max": 0.6, "trend": "price > 200-DMA"}

_lock = threading.Lock()
_thread = None
_state = {
    "status": "idle",       # idle | running | done | error
    "progress": "",
    "asof": 0,
    "universe": 0,
    "uptrend": 0,
    "results": [],           # [{symbol, price, vs_200dma, market_cap_cr, roe, debt_equity, sector}]
    "error": None,
}


def _load_disk():
    try:
        with open(_FILE) as f:
            saved = json.load(f)
        if isinstance(saved, dict) and isinstance(saved.get("results"), list):
            _state.update({
                "status": "done", "asof": saved.get("asof", 0),
                "universe": saved.get("universe", 0), "uptrend": saved.get("uptrend", 0),
                "results": saved["results"],
            })
    except Exception:
        pass


_load_disk()


def _save_disk():
    try:
        payload = {k: _state[k] for k in ("asof", "universe", "uptrend", "results")}
        with open(_FILE + ".tmp", "w") as f:
            json.dump(payload, f)
        os.replace(_FILE + ".tmp", _FILE)
    except Exception:
        pass


def _run(universe_fn, fund):
    global _thread
    try:
        import yfinance as yf

        syms = [x["symbol"] for x in (universe_fn() or []) if x.get("symbol")]
        with _lock:
            _state.update({"status": "running", "universe": len(syms), "error": None,
                           "progress": f"0/{len(syms)} price history"})

        # Stage 1 — trend gate over batched daily closes.
        uptrend = []   # (sym, price, vs200)
        for i in range(0, len(syms), CHUNK):
            chunk = syms[i:i + CHUNK]
            try:
                df = yf.download([s + ".NS" for s in chunk], period="1y", interval="1d",
                                 group_by="ticker", threads=True, progress=False,
                                 auto_adjust=True)
            except Exception as e:
                log.warning("mb_screen chunk %d failed: %s", i // CHUNK, e)
                continue
            for s in chunk:
                try:
                    sub = df[s + ".NS"] if len(chunk) > 1 else df
                    closes = sub["Close"].dropna()
                    if len(closes) < 200:
                        continue
                    px = float(closes.iloc[-1])
                    dma = float(closes.tail(200).mean())
                    if px > 0 and dma > 0 and px > dma:
                        uptrend.append((s, round(px, 2), round((px / dma - 1) * 100, 1)))
                except Exception:
                    continue
            with _lock:
                _state["progress"] = f"{min(i + CHUNK, len(syms))}/{len(syms)} price history · {len(uptrend)} in uptrend"
            time.sleep(0.5)   # be polite to the quote host

        with _lock:
            _state["uptrend"] = len(uptrend)
            # A fresh run replaces the previous results progressively.
            _state["results"] = []

        # Stage 2 — fundamentals gate (provider chain, 7-day disk cache).
        # Parallel workers: a cold symbol costs 1-3s of scraping, so a serial
        # sweep over ~900 uptrend stocks took 30-45 minutes. Eight workers cut
        # that to a few minutes, and matches are published LIVE so the tab
        # fills in while the job runs; cached symbols are near-instant.
        from concurrent.futures import ThreadPoolExecutor

        results = []
        done_ct = [0]

        def check(item):
            s, px, v200 = item
            try:
                f = fund.get_one(s) or {}
            except Exception:
                f = {}
            mc, roe, de = f.get("market_cap_cr"), f.get("roe"), f.get("debt_equity")
            hit = None
            if (mc is not None and 0 < mc < CRITERIA["mcap_max_cr"]
                    and roe is not None and roe > CRITERIA["roe_min"]
                    and de is not None and de < CRITERIA["de_max"]):
                hit = {"symbol": s, "price": px, "vs_200dma": v200,
                       "market_cap_cr": mc, "roe": roe, "debt_equity": de,
                       "sector": f.get("sector")}
            with _lock:
                done_ct[0] += 1
                if hit:
                    results.append(hit)
                    _state["results"] = sorted(results, key=lambda r: r["market_cap_cr"])
                if done_ct[0] % 10 == 0:
                    _state["progress"] = f"{done_ct[0]}/{len(uptrend)} fundamentals · {len(results)} matches"

        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(check, uptrend))

        results.sort(key=lambda r: r["market_cap_cr"])   # smallest base first
        with _lock:
            _state.update({"status": "done", "asof": int(time.time()),
                           "results": results, "progress": ""})
            _save_disk()
        log.info("mb_screen done: %d/%d universe matches", len(results), len(syms))
    except Exception as e:
        log.error("mb_screen failed: %s", e)
        with _lock:
            # Keep any previous results usable; just record the failure.
            _state.update({"status": "done" if _state["results"] else "error",
                           "error": str(e), "progress": ""})
    finally:
        with _lock:
            _thread = None


def ensure_started(universe_fn, fund) -> None:
    """Kick the background screen if results are stale and no job is running."""
    global _thread
    with _lock:
        if _thread is not None:
            return
        if _state["status"] == "done" and time.time() - _state["asof"] < TTL:
            return
        _thread = threading.Thread(target=_run, args=(universe_fn, fund),
                                   name="mb-screen", daemon=True)
        _thread.start()


def snapshot() -> dict:
    with _lock:
        running = _thread is not None
        return {
            "status": "running" if running and not _state["results"] else _state["status"],
            "refreshing": running,
            "progress": _state["progress"],
            "asof": _state["asof"],
            "universe": _state["universe"],
            "uptrend": _state["uptrend"],
            "matches": len(_state["results"]),
            "results": _state["results"],
            "criteria": CRITERIA,
            "error": _state["error"],
        }
