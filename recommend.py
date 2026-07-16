"""Buy-recommendation engine.

Combines four reads into a single actionable call for a stock:
  • Fundamentals — the Multibagger analyser score (passed in; yfinance-grounded).
  • Momentum     — trend alignment vs the 20/50/200 EMAs, RSI, recent thrust.
  • Pattern      — the current chart pattern (via patterns.detect_patterns).
  • Structure    — pivots / swing levels for support & resistance and a concrete
                   trade setup (entry, stop-loss, target, risk:reward, upside).

Pure Python (no third-party deps) so it stays fast and unit-testable. Output is
indicative and educational — NOT investment advice.
"""
from __future__ import annotations

import math

import patterns as _patterns


# ── small TA helpers (no numpy/pandas) ───────────────────────────────────────
def _ema(vals, period):
    if not vals:
        return None
    k = 2 / (period + 1)
    e = vals[0]
    for v in vals[1:]:
        e = v * k + e * (1 - k)
    return e


def _rsi(closes, period=14):
    if len(closes) < period + 1:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gains += d
        else:
            losses -= d
    ag = gains / period
    al = losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (period - 1) + max(d, 0)) / period
        al = (al * (period - 1) + max(-d, 0)) / period
    if al == 0:
        return 100.0
    rs = ag / al
    return 100 - 100 / (1 + rs)


def _atr(highs, lows, closes, period=14):
    n = len(closes)
    if n < period + 1:
        return None
    trs = []
    for i in range(1, n):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
        trs.append(tr)
    if len(trs) < period:
        return None
    atr = sum(trs[:period]) / period
    for tr in trs[period:]:
        atr = (atr * (period - 1) + tr) / period
    return atr


def _pct(a, b):
    return (a - b) / b * 100 if b else 0.0


# ── the engine ───────────────────────────────────────────────────────────────
def analyze(symbol, candles, fund_score=None, name=None):
    """candles: chronological [{t,o,h,l,c,v}]. fund_score: 0-100 analyser score
    (optional). Returns a recommendation dict."""
    cs = [c for c in candles if c.get("c") is not None and c.get("h") is not None
          and c.get("l") is not None]
    if len(cs) < 40:
        return {"symbol": symbol, "name": name, "action": "SKIP",
                "note": "Not enough history for a recommendation."}

    highs = [float(c["h"]) for c in cs]
    lows = [float(c["l"]) for c in cs]
    closes = [float(c["c"]) for c in cs]
    vols = [float(c.get("v") or 0) for c in cs]
    price = closes[-1]

    ema20 = _ema(closes[-120:], 20) or price
    ema50 = _ema(closes[-200:], 50) or price
    ema200 = _ema(closes, 200) if len(closes) >= 200 else None
    rsi = _rsi(closes) or 50.0
    atr = _atr(highs, lows, closes) or price * 0.02
    win = min(252, len(closes))
    high52 = max(highs[-win:])
    low52 = min(lows[-win:])
    ret20 = _pct(price, closes[-21]) if len(closes) > 21 else 0.0
    relvol = (vols[-1] / (sum(vols[-21:-1]) / 20)) if len(vols) > 21 and sum(vols[-21:-1]) else 1.0

    # classic floor-trader pivots off the last bar
    h, l, c = highs[-1], lows[-1], closes[-1]
    P = (h + l + c) / 3
    r1, s1 = 2 * P - l, 2 * P - h
    r2, s2 = P + (h - l), P - (h - l)
    r3 = h + 2 * (P - l)
    s3 = l - 2 * (h - P)

    # recent swing structure (last ~40 bars) for firmer S/R
    seg = 40
    sw_hi = max(highs[-seg:])
    sw_lo = min(lows[-seg:])

    # ── Momentum score (0-100) ───────────────────────────────────────────────
    m = 0
    if price > ema20:
        m += 18
    if price > ema50:
        m += 20
    if ema200 is None or price > ema200:
        m += 16
    if ema20 > ema50 and (ema200 is None or ema50 > ema200):
        m += 12                                   # stacked EMAs
    if 50 <= rsi <= 72:
        m += 14
    elif rsi > 72:
        m += 6
    if ret20 > 0:
        m += min(12, ret20)                       # recent thrust, capped
    if relvol >= 1.3:
        m += 8
    pfh = _pct(price, high52)                      # ≤0, closer to 0 = nearer high
    if pfh > -8:
        m += 6
    momentum = max(0, min(100, round(m)))
    mom_bullish = price > ema50 and momentum >= 55

    # ── Pattern read ─────────────────────────────────────────────────────────
    pat = _patterns.detect_patterns(cs)
    cur = pat.get("current")
    pattern_label = cur["label"] if cur else None
    pattern_bias = cur["bias"] if cur else None
    pattern_conf = cur["confidence"] if cur else 0
    pat_target = cur.get("target") if cur else None
    if cur and pattern_bias == "bullish":
        pattern_score = pattern_conf
    elif cur and pattern_bias == "bearish":
        pattern_score = 100 - pattern_conf
    else:
        pattern_score = 50

    # ── Support / resistance (immediate) ─────────────────────────────────────
    below = sorted([x for x in (s1, s2, s3, ema20, ema50, sw_lo) if x and x < price], reverse=True)
    above = sorted([x for x in (r1, r2, r3, sw_hi, high52, pat_target) if x and x > price])
    support = round(below[0], 2) if below else round(price - 1.5 * atr, 2)
    resistance = round(above[0], 2) if above else round(price + 2 * atr, 2)
    support2 = round(below[1], 2) if len(below) > 1 else round(price - 3 * atr, 2)

    # ── Trade setup ──────────────────────────────────────────────────────────
    entry = round(price, 2)
    # stop: just under immediate support, but cap the risk band (2%–10%) and keep
    # it beyond noise (≥1 ATR).
    raw_stop = min(support, price - 1.0 * atr)
    stop = max(raw_stop, price * 0.90)            # cap risk at ~10%
    if (price - stop) / price < 0.02:             # too tight → widen to 1.5 ATR
        stop = price - 1.5 * atr
    stop = round(stop, 2)
    # Profit target = a meaningful objective, not the nearest pivot: room to the
    # 52-week high when below it, else a breakout extension (52w high +6% / 3 ATR
    # / the pattern's measured target) so stocks already at highs still get a
    # realistic target rather than a 1% pivot.
    if price < high52 * 0.97:
        target = high52
    else:
        target = max(high52 * 1.06, price + 3 * atr, pat_target or 0)
    if target <= price:
        target = price + 2.5 * atr
    target = round(target, 2)
    target2 = round(max(target * 1.05, price + 5 * atr), 2)
    risk = price - stop
    reward = target - price
    rr = round(reward / risk, 2) if risk > 0 else None
    upside_pct = round(_pct(target, price), 2)
    stop_pct = round(_pct(stop, price), 2)

    # ── Confidence blend + action ────────────────────────────────────────────
    if fund_score is not None:
        conf = 0.40 * fund_score + 0.35 * momentum + 0.25 * pattern_score
    else:
        conf = 0.55 * momentum + 0.45 * pattern_score
    confidence = round(max(0, min(100, conf)))

    bearish_pattern = cur is not None and pattern_bias == "bearish" and pattern_conf >= 60
    if mom_bullish and not bearish_pattern and (rr is None or rr >= 1.2) and confidence >= 58:
        action = "BUY"
    elif momentum >= 45 and not bearish_pattern:
        action = "WATCH"
    else:
        action = "AVOID"

    # ── Rationale ────────────────────────────────────────────────────────────
    rationale = []
    if fund_score is not None and fund_score >= 70:
        rationale.append(f"Strong fundamentals — analyser {round(fund_score)}/100")
    elif fund_score is not None and fund_score >= 55:
        rationale.append(f"Sound fundamentals — analyser {round(fund_score)}/100")
    if price > ema50 and (ema200 is None or price > ema200):
        rationale.append("Trading above the 50 & 200-DMA — uptrend intact")
    elif price > ema50:
        rationale.append("Reclaimed the 50-DMA")
    if ema20 > ema50 and (ema200 is None or ema50 > ema200):
        rationale.append("EMAs stacked 20 > 50 > 200")
    if 50 <= rsi <= 72:
        rationale.append(f"RSI {rsi:.0f} in the momentum zone")
    elif rsi > 72:
        rationale.append(f"RSI {rsi:.0f} — extended, may need to cool")
    if relvol >= 1.3:
        rationale.append(f"Volume {relvol:.1f}× average — participation building")
    if cur and pattern_bias == "bullish":
        rationale.append(f"{pattern_label} — bullish structure ({pattern_conf}% match)")
    elif cur and pattern_bias == "bearish":
        rationale.append(f"⚠ {pattern_label} overhead — bearish risk")
    if pfh > -6:
        rationale.append(f"{abs(pfh):.1f}% from the 52-week high — near breakout")
    if rr:
        rationale.append(f"Setup ≈ {rr:.1f}:1 reward-to-risk to ₹{target:,.0f}")

    return {
        "symbol": symbol,
        "name": name,
        "action": action,
        "confidence": confidence,
        "fundamental_score": round(fund_score) if fund_score is not None else None,
        "momentum_score": momentum,
        "pattern_score": round(pattern_score),
        "pattern": pattern_label,
        "pattern_bias": pattern_bias,
        "price": entry,
        "entry": entry,
        "stop": stop,
        "stop_pct": stop_pct,
        "target": target,
        "target2": target2,
        "upside_pct": upside_pct,
        "rr": rr,
        "support": support,
        "support2": support2,
        "resistance": resistance,
        "rsi": round(rsi, 1),
        "high52": round(high52, 2),
        "low52": round(low52, 2),
        "rationale": rationale,
    }
