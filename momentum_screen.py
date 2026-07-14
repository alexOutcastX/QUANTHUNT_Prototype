# Full-universe momentum radar (background job + cached results).
#
# The Momentum tab covers EVERY listed stock — the whole NSE equity universe
# plus BSE-only listings (best-effort master list; the radar degrades to
# NSE-only when BSE's endpoint is unreachable). A background thread computes
# each symbol's technical snapshot with the same scanner used by /scan
# (perfect parity with the app's technicals) and classifies it into the
# classic setups. Matches are published LIVE, sorted best score first, and
# the result is cached to disk (deploy rsync excludes it).
#
# classify() is a pure stdlib function (unit-tested in CI) and is the Python
# twin of mobile/src/momentum.ts — keep the two in sync when tuning.

import json
import logging
import os
import threading
import time

log = logging.getLogger("momentum_screen")

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mom_screen.json")
TTL = 4 * 3600            # momentum is fresher than fundamentals — refresh 4-hourly
WORKERS = 12
MIN_SCORE = 45

SETUP_LABEL = {"breakout": "BREAKOUT WATCH", "fired": "BREAKOUT FIRED",
               "pullback": "PULLBACK REVERSAL"}

_lock = threading.Lock()
_thread = None
_state = {
    "status": "idle",     # idle | running | done | error
    "progress": "",
    "asof": 0,
    "universe_nse": 0,
    "universe_bse": 0,
    "results": [],
    "error": None,
}


def _nn(v):
    try:
        return None if v is None or v != v else float(v)
    except (TypeError, ValueError):
        return None


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _breakout(t):
    signals, cautions = [], []
    score = 0
    fired = False

    if t.get("sqzFire") and (_nn(t.get("sqzMom")) or 0) > 0:
        score += 25
        fired = True
        signals.append("TTM squeeze just FIRED with positive momentum — compression is releasing upward.")
    elif t.get("sqzOn"):
        score += 18
        signals.append("TTM squeeze ON — Bollinger bands inside Keltner channel, volatility coiling for a move.")

    ph = _nn(t.get("pct_from_high"))
    if ph is not None:
        if ph >= -3:
            score += 20
            signals.append(f"Pressing the 52-week high ({ph:.1f}% away) — minimal overhead supply.")
        elif ph >= -8:
            score += 12
            signals.append(f"Within {abs(ph):.1f}% of the 52-week high — late-stage base.")
        elif ph < -35:
            cautions.append(f"{abs(ph):.0f}% below the 52-week high — heavy overhead supply to chew through.")
            score -= 8
    if t.get("new_high_52w"):
        score += 12
        fired = True
        signals.append("Fresh 52-week high on the latest bar — breakout in progress.")
    if t.get("cam_break_up"):
        score += 8
        fired = True
        signals.append("Camarilla H4 breakout — price cleared the upper day-structure band.")

    rv = _nn(t.get("relvol"))
    if rv is not None:
        if rv >= 2:
            score += 15
            signals.append(f"Volume {rv:.1f}× average — institutions participating.")
        elif rv >= 1.3:
            score += 8
            signals.append(f"Volume {rv:.1f}× average — accumulation building.")
        elif fired and rv < 0.9:
            cautions.append("Breakout attempt on below-average volume — follow-through is unreliable without volume.")
            score -= 6

    d20, d50, d200 = _nn(t.get("d20")), _nn(t.get("d50")), _nn(t.get("d200"))
    if d20 is not None and d50 is not None and d200 is not None and d20 > 0 and d50 > 0 and d200 > 0:
        score += 12
        signals.append("Price above the 20/50/200-DMA stack — full trend alignment.")
    elif d200 is not None and d200 < 0:
        cautions.append("Still below the 200-DMA — breakouts against the primary trend fail more often.")
        score -= 6

    rsi = _nn(t.get("rsi"))
    if rsi is not None:
        if 55 <= rsi <= 70:
            score += 8
            signals.append(f"RSI {rsi:.0f} — in the 55-70 power zone, strong but not stretched.")
        elif rsi > 78:
            cautions.append(f"RSI {rsi:.0f} — extended; chasing here risks buying the blow-off.")
            score -= 5

    if t.get("macd_bull_cross"):
        score += 8
        signals.append("MACD bullish cross on the latest bar.")
    elif (_nn(t.get("macd")) or 0) > 0:
        score += 4
        signals.append("MACD histogram positive — momentum on the buyers' side.")

    price, r1 = _nn(t.get("price")), _nn(t.get("r1"))
    if price is not None and r1 is not None and r1 > price and (r1 - price) / r1 <= 0.02:
        score += 8
        signals.append("Sitting right under the R1 pivot — a clean trigger level overhead.")
    if t.get("gap_up"):
        score += 4
        signals.append("Gapped up today — demand imbalance at the open.")
    if (_nn(t.get("chg")) or 0) < -3:
        cautions.append("Down sharply today — wait for the setup to stabilise.")
        score -= 6

    if len(signals) < 2:
        return None
    score = _clamp(round(score), 0, 100)
    return {"setup": "fired" if fired else "breakout", "score": score,
            "probability": _clamp(round(30 + 0.4 * score + (4 if fired else 0)), 25, 75),
            "signals": signals, "cautions": cautions}


def _pullback(t):
    d20, d50, d200 = _nn(t.get("d20")), _nn(t.get("d50")), _nn(t.get("d200"))
    if d200 is None or d200 <= 0:
        return None
    if t.get("death_cross") or t.get("cam_break_down"):
        return None

    signals, cautions = [], []
    score = 0

    if d200 > 5:
        score += 15
        signals.append(f"Established uptrend — price {d200:.1f}% above the 200-DMA.")
    else:
        score += 8
        signals.append("Primary uptrend intact (above the 200-DMA).")
    if d50 is not None and d50 > 0:
        score += 10
        signals.append("Intermediate trend healthy — still above the 50-DMA.")

    if d20 is not None and -8 < d20 < 0:
        score += 15
        signals.append(f"Orderly pullback — {abs(d20):.1f}% under the 20-DMA, not a breakdown.")
    elif d20 is not None and d20 <= -8:
        cautions.append(f"Deep {abs(d20):.1f}% break below the 20-DMA — sharper than a routine dip.")
        score -= 4

    rsi = _nn(t.get("rsi"))
    if rsi is not None:
        if rsi < 30:
            score += 18
            signals.append(f"RSI {rsi:.0f} — washed-out oversold inside an uptrend.")
        elif rsi <= 45:
            score += 12
            signals.append(f"RSI {rsi:.0f} — reset to the pullback zone.")
        if rsi < 22:
            cautions.append("RSI extremely low — sometimes the dip IS the breakdown; confirm before entry.")
    if (_nn(t.get("willr")) or 0) <= -80:
        score += 10
        signals.append("Williams %R below -80 — short-term selling exhausted.")
    bb = _nn(t.get("bollb"))
    if bb is not None and bb <= 0.25:
        score += 10
        signals.append(f"Bollinger %B {bb:.2f} — hugging the lower band, stretched rubber band.")

    price, s1 = _nn(t.get("price")), _nn(t.get("s1"))
    if price is not None and s1 is not None and price > s1 and (price - s1) / s1 <= 0.03:
        score += 12
        signals.append("Sitting on the S1 support pivot — defined risk, clean invalidation level.")

    rv = _nn(t.get("relvol"))
    if rv is not None and rv < 1:
        score += 6
        signals.append(f"Pullback on quiet volume ({rv:.1f}×) — sellers lack conviction.")
    elif rv is not None and rv >= 2 and (_nn(t.get("chg")) or 0) < 0:
        cautions.append(f"Heavy volume ({rv:.1f}×) on the decline — distribution, not a quiet dip.")
        score -= 8

    if t.get("macd_bull_cross"):
        score += 10
        signals.append("MACD bullish cross — the turn may already be starting.")

    if len(signals) < 3:
        return None
    score = _clamp(round(score), 0, 100)
    return {"setup": "pullback", "score": score,
            "probability": _clamp(round(30 + 0.4 * score), 25, 72),
            "signals": signals, "cautions": cautions}


def classify(t: dict):
    """Best qualifying setup for a technical snapshot, or None. Pure stdlib."""
    b = _breakout(t or {})
    p = _pullback(t or {})
    best = b if (b or {}).get("score", -1) >= (p or {}).get("score", -1) else p
    return best if best and best["score"] >= MIN_SCORE else None


# ── BSE-only universe (best-effort) ──────────────────────────────────────────
def _load_bse_only(nse_syms: set):
    """Active BSE equity scrips whose ticker has no NSE listing. Empty on any
    failure — BSE's endpoints are frequently unreachable from data centres."""
    try:
        import requests
        r = requests.get(
            "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w",
            params={"Group": "", "Scripcode": "", "industry": "", "segment": "Equity",
                    "status": "Active"},
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.bseindia.com/"},
            timeout=25,
        )
        rows = r.json() if r.ok else []
        out = []
        for it in rows or []:
            tick = str(it.get("scrip_id") or "").strip().upper()
            name = str(it.get("Scrip_Name") or tick).strip()
            if tick and tick not in nse_syms:
                out.append({"symbol": tick, "name": name})
        log.info("BSE-only universe: %d scrips", len(out))
        return out
    except Exception as e:
        log.warning("BSE universe unavailable (%s) — radar covers NSE only this run", e)
        return []


def _load_disk():
    try:
        with open(_FILE) as f:
            saved = json.load(f)
        if isinstance(saved, dict) and isinstance(saved.get("results"), list):
            _state.update({"status": "done", "asof": saved.get("asof", 0),
                           "universe_nse": saved.get("universe_nse", 0),
                           "universe_bse": saved.get("universe_bse", 0),
                           "results": saved["results"]})
    except Exception:
        pass


_load_disk()


def _save_disk():
    try:
        payload = {k: _state[k] for k in ("asof", "universe_nse", "universe_bse", "results")}
        with open(_FILE + ".tmp", "w") as f:
            json.dump(payload, f)
        os.replace(_FILE + ".tmp", _FILE)
    except Exception:
        pass


def _run(universe_fn):
    global _thread
    try:
        import scanner as _scanner
        from concurrent.futures import ThreadPoolExecutor

        uni = universe_fn() or []
        nse = [{"symbol": x["symbol"], "name": x.get("name") or x["symbol"], "suffix": ".NS",
                "exchange": "NSE"} for x in uni if x.get("symbol")]
        bse = [{**b, "suffix": ".BO", "exchange": "BSE"}
               for b in _load_bse_only({x["symbol"] for x in nse})]
        items = nse + bse
        with _lock:
            _state.update({"status": "running", "universe_nse": len(nse),
                           "universe_bse": len(bse), "error": None, "results": [],
                           "progress": f"0/{len(items)} scanned"})

        try:
            idx_ret = _scanner._index_returns()
        except Exception:
            idx_ret = None

        results = []
        done_ct = [0]

        def check(it):
            hit = None
            try:
                t = _scanner._compute_row(it["symbol"], idx_ret, it["suffix"])
                read = classify(t) if t else None
                if read:
                    hit = {"symbol": it["symbol"], "name": it["name"], "exchange": it["exchange"],
                           "price": t.get("price"), "chg": t.get("chg"), "rsi": t.get("rsi"),
                           "relvol": t.get("relvol"), "d200": t.get("d200"),
                           "pct_from_high": t.get("pct_from_high"), **read}
            except Exception:
                pass
            with _lock:
                done_ct[0] += 1
                if hit:
                    results.append(hit)
                    _state["results"] = sorted(results, key=lambda x: -x["score"])
                if done_ct[0] % 10 == 0:
                    _state["progress"] = f"{done_ct[0]}/{len(items)} scanned · {len(results)} setups"

        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            list(pool.map(check, items))

        results.sort(key=lambda x: -x["score"])
        with _lock:
            _state.update({"status": "done", "asof": int(time.time()),
                           "results": results, "progress": ""})
            _save_disk()
        log.info("momentum_screen done: %d setups over %d NSE + %d BSE",
                 len(results), len(nse), len(bse))
    except Exception as e:
        log.error("momentum_screen failed: %s", e)
        with _lock:
            _state.update({"status": "done" if _state["results"] else "error",
                           "error": str(e), "progress": ""})
    finally:
        with _lock:
            _thread = None


def ensure_started(universe_fn, force: bool = False) -> None:
    global _thread
    with _lock:
        if _thread is not None:
            return
        if not force and _state["status"] == "done" and time.time() - _state["asof"] < TTL:
            return
        _thread = threading.Thread(target=_run, args=(universe_fn,),
                                   name="momentum-screen", daemon=True)
        _thread.start()


def snapshot() -> dict:
    with _lock:
        running = _thread is not None
        return {
            "status": "running" if running else _state["status"],
            "refreshing": running,
            "progress": _state["progress"],
            "asof": _state["asof"],
            "universe_nse": _state["universe_nse"],
            "universe_bse": _state["universe_bse"],
            "matches": len(_state["results"]),
            "results": _state["results"],
            "error": _state["error"],
        }
