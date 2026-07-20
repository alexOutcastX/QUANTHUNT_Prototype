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

import sectors as _sectors   # app-wide NSE sector classification (long-tail accumulator)

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
    # Sector tally accumulated over EVERY symbol the sweep touches (not just the
    # 60+ scorers) so the sectoral heatmap gets full NSE+BSE coverage for free —
    # the .info fetch that scores each stock already carries sector/chg/mcap.
    # sector -> {"count", "mcap", "chg_w", "chg_den"} (see _acc_sector).
    "sector_acc": {},
    "sector_universe": 0,    # symbols with a resolved sector this sweep
    "error": None,
}


def _acc_sector(acc: dict, sector, chg, mcap) -> None:
    """Fold one stock into the per-sector accumulator (in place). Cap-weights the
    day change, falling back to equal weight when a market cap is missing."""
    if not sector:
        return
    a = acc.setdefault(sector, {"count": 0, "mcap": 0.0, "chg_w": 0.0, "chg_den": 0.0})
    a["count"] += 1
    m = float(mcap) if isinstance(mcap, (int, float)) and mcap and mcap > 0 else 0.0
    a["mcap"] += m
    if isinstance(chg, (int, float)):
        w = m if m > 0 else 1.0
        a["chg_w"] += float(chg) * w
        a["chg_den"] += w


def sectors_from_acc(acc: dict) -> list:
    """Reduce the accumulator to a display list: one row per sector with its
    constituent count, total market cap and cap-weighted average day change.
    Sorted biggest-count first. Pure — unit-tested without any data deps."""
    out = []
    for sec, a in acc.items():
        out.append({
            "sector": sec,
            "count": a["count"],
            "market_cap_cr": round(a["mcap"], 2) if a["mcap"] else None,
            "chg": round(a["chg_w"] / a["chg_den"], 2) if a["chg_den"] else None,
        })
    out.sort(key=lambda x: -x["count"])
    return out


def _load_disk():
    try:
        with open(_FILE) as f:
            saved = json.load(f)
        if isinstance(saved, dict) and isinstance(saved.get("results"), list):
            _state.update({
                "status": "done", "asof": saved.get("asof", 0),
                "universe": saved.get("universe", 0),
                "results": saved["results"],
                "sector_acc": saved.get("sector_acc") or {},
                "sector_universe": saved.get("sector_universe", 0),
            })
    except Exception:
        pass


_load_disk()


def _save_disk():
    try:
        payload = {k: _state[k] for k in
                   ("asof", "universe", "results", "sector_acc", "sector_universe")}
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
        sector_acc = {}
        sector_ct = [0]
        with _lock:
            _state.update({"status": "running", "universe": len(syms), "error": None,
                           "results": [], "progress": f"0/{len(syms)} analysed",
                           "sector_acc": {}, "sector_universe": 0})

        results = []
        done_ct = [0]

        def check(s):
            hit = None
            try:
                metrics, ident = mb.fetch_metrics(s, with_history=False, retries=0)
                r = mb.score(metrics)
                # Fold EVERY resolved stock into the sector tally (not just the
                # 60+ scorers) so the sectoral heatmap sees the whole universe.
                # Also accumulate the Yahoo GICS sector into the app-wide NSE
                # classification (translated) so the long tail the NSE index
                # files miss still gets a sector — persisted, so it only grows.
                gics = ident.get("sector")
                if gics:
                    try:
                        _sectors.record(s, gics)
                    except Exception:
                        pass
                    with _lock:
                        _acc_sector(sector_acc, gics, ident.get("chg"), metrics.get("mcap_cr"))
                        sector_ct[0] += 1
                        _state["sector_acc"] = sector_acc
                        _state["sector_universe"] = sector_ct[0]
                # Emit the app-wide NSE macro sector (falls back to the raw GICS
                # value) so the multibagger rows speak the same sector language
                # as the heatmap and the sector filter.
                nse_sector = _sectors.sector_of(s, gics) or gics
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
                           "sector": nse_sector,
                           # Identity + the full metrics dict so a live report
                           # fetch that hits a Yahoo rate-limit can rebuild the
                           # complete report from what the screen already scored.
                           "name": ident.get("name"),
                           "industry": ident.get("industry"),
                           "metrics": metrics}
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
        try:
            _sectors.flush()   # persist the sweep's long-tail sector additions
        except Exception:
            pass
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


def cached(symbol: str):
    """Return a screened symbol's stored scoring data — the full `metrics` dict
    plus identity (name/sector/price) — so the single-stock report route can
    fall back to it when a live Yahoo fetch is rate-limited. None when the
    symbol isn't in the latest screen (or predates the stored-metrics field)."""
    s = (symbol or "").upper().strip()
    with _lock:
        for r in _state["results"]:
            if str(r.get("symbol", "")).upper() == s and r.get("metrics"):
                return dict(r)
    return None


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


def sector_snapshot() -> dict:
    """Full NSE+BSE sectoral aggregate, computed as a by-product of the same
    universe sweep the multibagger screen runs. Every stock with a resolved
    sector is folded in — not just the scorers — so the sectoral heatmap gets
    whole-market coverage with no extra data fetching."""
    with _lock:
        running = _thread is not None
        return {
            "status": "running" if running else _state["status"],
            "refreshing": running,
            "progress": _state["progress"],
            "asof": _state["asof"],
            "universe": _state["universe"],          # total scrips in the sweep
            "mapped": _state.get("sector_universe", 0),  # scrips with a sector
            "sectors": sectors_from_acc(_state.get("sector_acc") or {}),
            "error": _state["error"],
        }
