"""Short-term (swing) trade engine.

Finds mean-reversion / pullback-reversal setups on liquid mid & large caps:
a stock in a healthy longer-term trend that has pulled back toward support or
dipped into oversold territory (RSI near 30) and is starting to turn back up.

Produces a **probability score** and a swing trade setup (entry / stop / target
/ R:R) plus trend, momentum, upside and max drawdown for the detail popup.

The mid/large-cap universe is enforced by the caller (the client fans this out
over NIFTY 200 constituents = the top-200 by market cap). This module only
judges the technical swing setup on the candles.
"""
from recommend import _atr, _ema, _rsi, eta_to_target


def _dist_pct(a, b):
    return abs(a - b) / b * 100 if b else 999.0


def _max_drawdown(closes, lookback=126):
    xs = closes[-lookback:]
    if len(xs) < 2:
        return 0.0
    peak = xs[0]
    mdd = 0.0
    for c in xs:
        if c > peak:
            peak = c
        dd = (c - peak) / peak * 100 if peak else 0.0
        if dd < mdd:
            mdd = dd
    return round(mdd, 1)


def analyze(symbol, candles, name=None):
    cs = [c for c in candles
          if c.get("c") is not None and c.get("h") is not None and c.get("l") is not None]
    if len(cs) < 60:
        return {"symbol": symbol, "name": name, "action": "SKIP", "qualifies": False,
                "note": "Not enough history for a swing read."}

    closes = [c["c"] for c in cs]
    highs = [c["h"] for c in cs]
    lows = [c["l"] for c in cs]
    price = closes[-1]

    ema20 = _ema(closes, 20)
    ema50 = _ema(closes, 50)
    ema200 = _ema(closes, 200) if len(closes) >= 200 else _ema(closes, min(len(closes), 100))
    rsi = _rsi(closes) or 50.0
    prev_rsi = _rsi(closes[:-1]) or rsi
    atr = _atr(highs, lows, closes) or (price * 0.02)

    sw_lo = min(lows[-20:])
    sw_hi = max(highs[-20:])
    sw_hi40 = max(highs[-40:])
    max_dd = _max_drawdown(closes, 126)

    # ── trend from EMA structure ────────────────────────────────────────────
    up = price > (ema200 or price) and (ema50 or 0) >= (ema200 or 0)
    down = price < (ema200 or price) and (ema50 or 0) <= (ema200 or 0)
    trend = "up" if up else "down" if down else "side"

    # a small up-tick off the low (bounce confirmation)
    turning_up = closes[-1] > closes[-2] and rsi >= prev_rsi

    # ── momentum 0-100 ──────────────────────────────────────────────────────
    mom = 50.0
    if ema20:
        mom += 12 if price > ema20 else -8
    if ema50 and ema200:
        mom += 12 if ema50 > ema200 else -12
    if turning_up:
        mom += 8
    if rsi >= 55:
        mom += 6
    momentum = max(0, min(100, round(mom)))

    # ── support / resistance ────────────────────────────────────────────────
    below = [x for x in [sw_lo, ema50, ema20] if x and x < price]
    above = [x for x in [sw_hi, sw_hi40, ema20, ema50] if x and x > price]
    support = max(below) if below else price * 0.95
    resistance = min(above) if above else price * 1.06

    # ── swing-setup detection ───────────────────────────────────────────────
    near_support = _dist_pct(price, support) <= 4.0
    oversold = rsi <= 38
    deep_oversold = rsi <= 30
    pullback_in_uptrend = (trend == "up" and rsi <= 52
                           and price <= (ema20 or price) * 1.02)

    setup = None
    if pullback_in_uptrend and (near_support or rsi <= 45):
        setup = "Pullback reversal"
    elif oversold and price > (ema200 or 0) * 0.92:
        setup = "Oversold bounce"

    # ── trade setup ─────────────────────────────────────────────────────────
    entry = round(price, 2)
    raw_stop = min(support, price - 1.5 * atr)
    stop = max(raw_stop, price * 0.92)   # cap swing risk at ~8%
    stop = min(stop, price * 0.985)      # keep at least ~1.5% room
    risk = price - stop
    t_res = resistance if resistance > price * 1.02 else None
    t_2r = price + 2.2 * risk
    target = max([x for x in [t_res, t_2r] if x] or [price * 1.06])
    reward = target - price
    rr = round(reward / risk, 2) if risk > 0 else None
    upside_pct = round((target - price) / price * 100, 2)
    stop_pct = round((stop - price) / price * 100, 2)
    eta_days, eta = eta_to_target(price, target, atr)

    # ── probability score (0-100) ───────────────────────────────────────────
    prob = 0.0
    prob += 34 if trend == "up" else (12 if trend == "side" else 0)
    if deep_oversold:
        prob += 22
    elif oversold:
        prob += 16
    elif rsi <= 50:
        prob += 8
    if near_support:
        prob += 14
    if turning_up:
        prob += 12
    if rr and rr >= 2:
        prob += 12
    elif rr and rr >= 1.5:
        prob += 8
    if max_dd <= -35:
        prob -= 8
    probability = max(0, min(100, round(prob)))

    qualifies = (setup is not None and (rr is None or rr >= 1.3) and probability >= 45)
    if qualifies:
        action = "SWING"
    elif setup and probability >= 35:
        action = "WATCH"
    else:
        action = "AVOID"

    reasons = []
    if setup:
        reasons.append(setup + (" near support" if near_support else ""))
    if deep_oversold:
        reasons.append(f"RSI {rsi:.0f} — oversold, mean-reversion zone")
    elif oversold:
        reasons.append(f"RSI {rsi:.0f} — cooling toward oversold")
    if trend == "up":
        reasons.append("Longer-term trend still up (above 200-DMA)")
    elif trend == "down":
        reasons.append("⚠ Below the 200-DMA — counter-trend bounce only")
    if turning_up:
        reasons.append("Turning up off the low")
    if rr:
        reasons.append(f"About {rr:.1f}:1 reward-to-risk to ₹{target:,.0f}")

    return {
        "symbol": symbol,
        "name": name,
        "action": action,
        "qualifies": qualifies,
        "setup": setup or "No swing setup",
        "probability": probability,
        "trend": trend,
        "momentum": momentum,
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
        "rsi": round(rsi, 1),
        "max_dd": max_dd,
        "reasons": reasons,
    }
