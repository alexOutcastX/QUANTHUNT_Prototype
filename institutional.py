"""Institutional / algorithmic strategy screener.

Screens a stock against the classic algorithmic-trading strategies described in
the reference material:

  • Momentum          — ride assets showing strong, persistent price momentum
                        (The Algorithmic Trading Handbook, ch.3; HFT review §3.3).
  • Trend-Following   — buy names in an established up-trend (EMA structure /
                        golden cross).
  • Breakout          — a volatility squeeze that resolves into a new N-day high.
  • Mean Reversion    — price stretched far from its mean; contrarian long
                        expecting a snap back (Handbook ch.3).
  • Statistical Arb   — relative value: the stock trades abnormally cheap versus
                        its usual ratio to the market index, expecting the spread
                        to converge (Handbook ch.3 / HFT review §3.2).

A stock can match several strategies at once (confluence lifts the score). The
result tags which strategy(ies) flagged it so the UI can show *why* a name was
picked. Pure Python; reuses the recommend.py TA helpers. Indicative and
educational only — not investment advice.
"""
from __future__ import annotations

import math

from recommend import _atr, _ema, _rsi, eta_to_target, progress_drift


def _sma(vals, n):
    if len(vals) < n or n <= 0:
        return None
    return sum(vals[-n:]) / n


def _std(vals, n):
    xs = vals[-n:]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / len(xs))


def _pct(a, b):
    return (a - b) / b * 100 if b else 0.0


def _ret(closes, n):
    return _pct(closes[-1], closes[-1 - n]) if len(closes) > n else 0.0


def _max_drawdown(closes, lookback=126):
    xs = closes[-lookback:]
    if len(xs) < 2:
        return 0.0
    peak, mdd = xs[0], 0.0
    for c in xs:
        peak = max(peak, c)
        dd = (c - peak) / peak * 100 if peak else 0.0
        mdd = min(mdd, dd)
    return round(mdd, 1)


# ── strategy catalogue (label + one-line description shown in the UI) ──────────
STRATEGIES = {
    "momentum":    "Momentum",
    "trend":       "Trend-Following",
    "breakout":    "Breakout",
    "mean_rev":    "Mean Reversion",
    "stat_arb":    "Statistical Arbitrage",
}


def analyze(symbol, candles, bench_closes=None, name=None):
    """candles: chronological [{t,o,h,l,c,v}]. bench_closes: optional index close
    series (e.g. NIFTY) for the statistical-arbitrage relative-value read."""
    cs = [c for c in candles
          if c.get("c") is not None and c.get("h") is not None and c.get("l") is not None]
    if len(cs) < 60:
        return {"symbol": symbol, "name": name, "action": "SKIP", "qualifies": False,
                "strategies": [], "note": "Not enough history for an institutional read."}

    highs = [float(c["h"]) for c in cs]
    lows = [float(c["l"]) for c in cs]
    closes = [float(c["c"]) for c in cs]
    vols = [float(c.get("v") or 0) for c in cs]
    price = closes[-1]

    ema20 = _ema(closes, 20) or price
    ema50 = _ema(closes, 50) or price
    ema200 = _ema(closes, 200) if len(closes) >= 200 else _ema(closes, min(len(closes), 100))
    ema200 = ema200 or price
    rsi = _rsi(closes) or 50.0
    atr = _atr(highs, lows, closes) or price * 0.02
    sma50 = _sma(closes, 50) or price
    std50 = _std(closes, 50) or (price * 0.02)

    r_1m = _ret(closes, 21)
    r_3m = _ret(closes, 63)
    r_6m = _ret(closes, 126)
    r_12m = _ret(closes, 252)
    win = min(252, len(closes))
    high52 = max(highs[-win:])
    low52 = min(lows[-win:])
    max_dd = _max_drawdown(closes, 126)
    relvol = (vols[-1] / (sum(vols[-21:-1]) / 20)) if len(vols) > 21 and sum(vols[-21:-1]) else 1.0

    # trend from EMA structure
    if price > ema200 and ema50 >= ema200:
        trend = "up"
    elif price < ema200 and ema50 <= ema200:
        trend = "down"
    else:
        trend = "side"

    # momentum 0-100 (also feeds the ETA drift)
    mom = 50.0
    mom += 12 if price > ema20 else -8
    mom += 12 if ema50 > ema200 else -12
    mom += min(12, max(-8, r_3m / 2))
    if 55 <= rsi <= 78:
        mom += 8
    momentum = max(0, min(100, round(mom)))

    # ── support / resistance + trade setup ───────────────────────────────────
    sw_lo = min(lows[-40:])
    sw_hi = max(highs[-40:])
    below = [x for x in (sw_lo, ema20, ema50) if x and x < price]
    above = [x for x in (sw_hi, high52) if x and x > price]
    support = max(below) if below else price - 1.5 * atr
    resistance = min(above) if above else price + 2.0 * atr

    entry = round(price, 2)
    raw_stop = min(support, price - 1.5 * atr)
    stop = max(raw_stop, price * 0.90)          # cap risk ~10%
    stop = min(stop, price * 0.985)
    risk = price - stop
    t_res = resistance if resistance > price * 1.02 else None
    t_2r = price + 2.2 * risk
    target = max([x for x in (t_res, t_2r, high52 if high52 > price else None) if x] or [price * 1.08])
    reward = target - price
    rr = round(reward / risk, 2) if risk > 0 else None
    upside_pct = round(_pct(target, price), 2)
    stop_pct = round(_pct(stop, price), 2)
    eta_days, eta = eta_to_target(price, target, atr, progress_drift(momentum, trend, r_1m > 0))

    # ── strategy detectors — each returns (matched, score, note) ─────────────
    matched: list[dict] = []

    def add(key, score, note):
        matched.append({"key": key, "label": STRATEGIES[key],
                        "score": max(0, min(100, round(score))), "note": note})

    # Momentum — strong, persistent up-move, price leading its averages.
    if r_3m > 4 and price > ema50 and price > ema200 and rsi >= 55:
        sc = 45 + min(35, r_6m * 0.6) + min(12, r_3m * 0.4) + (6 if relvol >= 1.2 else 0)
        add("momentum", sc,
            f"6-month momentum {r_6m:+.0f}% (3-mo {r_3m:+.0f}%) — leading its averages")

    # Trend-Following — clean EMA stack in a live up-trend.
    if price > ema200 and ema20 > ema50 > ema200:
        golden = ema50 > ema200 and (_ema(closes[:-15], 50) or 0) <= (_ema(closes[:-15], 200) or 0)
        sc = 55 + min(20, (r_6m or 0) * 0.3) + (12 if golden else 0)
        note = ("Golden cross — 50-DMA crossed above the 200-DMA"
                if golden else "EMAs stacked 20 > 50 > 200 — up-trend intact")
        add("trend", sc, note)

    # Breakout — a volatility squeeze resolving into a new N-day high.
    bw_series = []
    for i in range(-100, 0):
        seg = closes[i - 20:i] if i - 20 >= -len(closes) else None
        if seg and len(seg) == 20:
            m = sum(seg) / 20
            sd = math.sqrt(sum((x - m) ** 2 for x in seg) / 20)
            if m:
                bw_series.append(4 * sd / m)          # Bollinger bandwidth
    bw_now = bw_series[-1] if bw_series else None
    bw_med = sorted(bw_series)[len(bw_series) // 2] if bw_series else None
    donchian_hi = max(highs[-56:-1]) if len(highs) >= 56 else max(highs[:-1] or highs)
    squeezed = bw_now is not None and bw_med and bw_now <= bw_med * 0.9
    if price >= donchian_hi and price >= high52 * 0.985 and squeezed:
        sc = 55 + (14 if relvol >= 1.5 else 6 if relvol >= 1.1 else 0) + min(16, (r_1m or 0))
        add("breakout", sc,
            f"New {56}-day high out of a volatility squeeze"
            + (f" on {relvol:.1f}× volume" if relvol >= 1.2 else ""))

    # Mean Reversion — stretched far below the mean, still structurally intact.
    z = (price - sma50) / std50 if std50 else 0.0
    if (z <= -1.5 or rsi <= 32) and price > ema200 * 0.85:
        sc = 45 + min(35, abs(z) * 14) + (10 if rsi <= 30 else 0)
        add("mean_rev", sc,
            f"{abs(z):.1f}σ below the 50-day mean (RSI {rsi:.0f}) — reversion setup")

    # Statistical Arbitrage — relative value versus the market index.
    z_ratio = None
    if bench_closes and len(bench_closes) >= 60:
        n = min(len(closes), len(bench_closes), 120)
        s_tail = closes[-n:]
        b_tail = [float(x) for x in bench_closes[-n:] if x]
        if len(b_tail) == n and all(b_tail):
            ratio = [s_tail[i] / b_tail[i] for i in range(n)]
            rm = sum(ratio) / n
            rsd = math.sqrt(sum((x - rm) ** 2 for x in ratio) / n)
            if rsd:
                z_ratio = (ratio[-1] - rm) / rsd
                if z_ratio <= -1.3 and price > ema200 * 0.85:
                    sc = 45 + min(38, abs(z_ratio) * 16)
                    add("stat_arb", sc,
                        f"Trading {abs(z_ratio):.1f}σ below its usual ratio to the index "
                        "— relative-value long, expecting convergence")

    matched.sort(key=lambda m: m["score"], reverse=True)

    # ── overall score + action ───────────────────────────────────────────────
    if matched:
        base = matched[0]["score"]
        confluence = min(18, 6 * (len(matched) - 1))     # extra strategies add conviction
        score = max(0, min(100, round(base + confluence)))
    else:
        score = 0
    primary = matched[0] if matched else None

    bearish = trend == "down" and not any(m["key"] in ("mean_rev", "stat_arb") for m in matched)
    qualifies = bool(matched) and (rr is None or rr >= 1.2) and score >= 50 and not bearish
    if qualifies:
        action = "BUY"
    elif matched and score >= 40:
        action = "WATCH"
    else:
        action = "AVOID"

    reasons = [m["note"] for m in matched]
    if trend == "up":
        reasons.append("Longer-term trend up — above the 200-DMA")
    elif trend == "down":
        reasons.append("⚠ Below the 200-DMA — counter-trend / reversion only")
    if rr:
        reasons.append(f"About {rr:.1f}:1 reward-to-risk to ₹{target:,.0f}")

    return {
        "symbol": symbol,
        "name": name,
        "action": action,
        "qualifies": qualifies,
        "score": score,
        "strategies": matched,                 # every strategy that flagged it
        "primary": primary["label"] if primary else "No strategy match",
        "primary_key": primary["key"] if primary else None,
        "matched_count": len(matched),
        "trend": trend,
        "momentum": momentum,
        "rsi": round(rsi, 1),
        "price": entry,
        "entry": entry,
        "stop": round(stop, 2),
        "stop_pct": stop_pct,
        "target": round(target, 2),
        "upside_pct": upside_pct,
        "rr": rr,
        "eta_days": eta_days,
        "eta": eta,
        "support": round(support, 2),
        "resistance": round(resistance, 2),
        "max_dd": max_dd,
        "ret_3m": round(r_3m, 1),
        "ret_6m": round(r_6m, 1),
        "ret_12m": round(r_12m, 1),
        "reasons": reasons,
    }
