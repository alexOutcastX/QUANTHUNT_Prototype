"""ICT / Smart-Money-Concepts (SMC) screener — long-biased.

Adapts the discretionary ICT/SMC rulebook to what is *measurable on daily NSE
candles*. It screens for the book's structural long models and stacks a
confluence score, following the book's own risk rules (stop beyond the sweep
wick / HVI / algo candle; TP1 = nearest weak high = internal liquidity; TP2 =
external liquidity).

MODELS SCREENED (daily structure)
  • Liquidity Sweep Reversal — wick beyond a prior swing low, close back inside.
  • AMD / Power of 3         — accumulation → manipulation sweep → reclaim.
  • Market-Maker Buy Model   — engineered dip reclaimed back through the range.
  • Algo Candle / FVG        — price mitigating a bullish fair-value gap.
  • Breaker / Rejection Block— retest of broken structure now acting as support.
  • High-Volume Imbalance    — displacement / rejection on unusually high volume.
  • Divergence               — bullish momentum divergence at the sweep.
Plus premium/discount (dealing-range equilibrium) and a confluence scorer.

NOT AUTOMATED HERE (need intraday / forex-session data we don't have for daily
NSE equities): the NY Open trap, 1-minute ping-pong, the 90-minute cycle, the
Frankfurt/London session sweeps, and the true NY-midnight-open premium/discount.
Those are surfaced to the user as caveats, per the book's "flag what can't be
automated" instruction. This is a discretionary framework with no published,
verified edge — treat output as candidates to BACKTEST, not signals.
"""
from __future__ import annotations

import math

from recommend import _atr, _ema, _rsi, eta_to_target, progress_drift

# Session / intraday models that daily-candle screening cannot reproduce.
NOT_AUTOMATED = [
    "NY Open trap (needs the New-York session open)",
    "1-minute ping-pong scalps (needs 1-min data)",
    "90-minute opening-price cycle",
    "Frankfurt / London session sweeps",
    "True premium/discount off the 00:00 NY daily open (proxied by the daily dealing range)",
]

STRATEGIES = {
    "sweep":      "Liquidity Sweep Reversal",
    "amd":        "AMD (Power of 3)",
    "mmxm":       "Market-Maker Model",
    "fvg":        "Algo Candle / FVG",
    "breaker":    "Breaker / Rejection Block",
    "hvi":        "High-Volume Imbalance",
    "divergence": "Divergence",
}


def _pivots(highs, lows, k=2):
    """Swing highs (buy-side liquidity) and lows (sell-side liquidity) as
    (index, price). A pivot needs k bars on each side lower/higher."""
    ph, pl = [], []
    n = len(highs)
    for i in range(k, n - k):
        if highs[i] >= max(highs[i - k:i + k + 1]) and highs[i] > max(highs[i - k:i]):
            ph.append((i, highs[i]))
        if lows[i] <= min(lows[i - k:i + k + 1]) and lows[i] < min(lows[i - k:i]):
            pl.append((i, lows[i]))
    return ph, pl


def _pct(a, b):
    return (a - b) / b * 100 if b else 0.0


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


def analyze(symbol, candles, name=None):
    cs = [c for c in candles
          if c.get("c") is not None and c.get("h") is not None and c.get("l") is not None]
    if len(cs) < 70:
        return {"symbol": symbol, "name": name, "action": "SKIP", "qualifies": False,
                "strategies": [], "confluences": [], "note": "Not enough history for an SMC read."}

    highs = [float(c["h"]) for c in cs]
    lows = [float(c["l"]) for c in cs]
    closes = [float(c["c"]) for c in cs]
    opens = [float(c.get("o") or closes[i]) for i, c in enumerate(cs)]
    vols = [float(c.get("v") or 0) for c in cs]
    price = closes[-1]

    atr = _atr(highs, lows, closes) or price * 0.02
    rsi = _rsi(closes) or 50.0
    ema50 = _ema(closes, 50) or price
    ema200 = _ema(closes, 200) if len(closes) >= 200 else _ema(closes, min(len(closes), 100))
    ema200 = ema200 or price
    relvol = (vols[-1] / (sum(vols[-21:-1]) / 20)) if len(vols) > 21 and sum(vols[-21:-1]) else 1.0
    max_dd = _max_drawdown(closes, 126)

    ph, pl = _pivots(highs, lows, k=2)
    # exclude the freshest bars so a swing has to be confirmed
    prior_lows = [p for p in pl if p[0] <= len(cs) - 3]
    prior_highs = [p for p in ph if p[0] <= len(cs) - 3]

    trend = ("up" if price > ema200 and ema50 >= ema200
             else "down" if price < ema200 and ema50 <= ema200 else "side")
    mom = 50.0 + (12 if price > ema50 else -8) + (10 if ema50 > ema200 else -10)
    if 45 <= rsi <= 70:
        mom += 8
    momentum = max(0, min(100, round(mom)))

    # ── dealing range → premium / discount (proxy for the NY-open reference) ──
    win = min(60, len(cs))
    rng_hi = max(highs[-win:])
    rng_lo = min(lows[-win:])
    span = max(rng_hi - rng_lo, 1e-9)
    pos = (price - rng_lo) / span               # 0 = range low, 1 = range high
    in_discount = pos < 0.5
    in_ote = 0.205 <= pos <= 0.385              # 62–79% retrace of the up-leg
    zone = "discount" if in_discount else "premium" if pos > 0.5 else "equilibrium"

    matched: list[dict] = []
    confl: list[str] = []

    def add(key, score, note):
        matched.append({"key": key, "label": STRATEGIES[key],
                        "score": max(0, min(100, round(score))), "note": note})

    last3_low = min(lows[-3:])
    # ── A. Liquidity Sweep Reversal ──────────────────────────────────────────
    sweep_wick = None
    ssl = max([p for p in prior_lows if p[1] < price], key=lambda p: p[1], default=None)  # nearest below
    if ssl and last3_low < ssl[1] and price > ssl[1]:
        sweep_wick = last3_low
        confl.append("HTF liquidity sweep (sell-side)")
        sc = 55 + (12 if in_discount else 0) + (10 if rsi <= 45 else 0) + (8 if relvol >= 1.3 else 0)
        add("sweep", sc, "Swept sell-side liquidity below the prior swing low and closed back inside")

    # ── B. AMD / Power of 3 ──────────────────────────────────────────────────
    if len(cs) >= 20:
        base = cs[-18:-3]
        base_lo = min(float(c["l"]) for c in base)
        base_hi = max(float(c["h"]) for c in base)
        base_mid = (base_lo + base_hi) / 2
        if last3_low < base_lo and price > base_mid:
            confl.append("Accumulation range swept then reclaimed")
            add("amd", 55 + (12 if in_discount else 0) + (8 if price > base_hi else 0),
                "Accumulation → manipulation (downside sweep) → reclaim (Power of 3)")

    # ── C. Market-Maker Buy Model (engineered dip reclaimed through structure) ─
    lower_high = min([p for p in prior_highs if p[1] > price], key=lambda p: p[1], default=None)
    reclaimed_lh = lower_high and any(closes[j] > lower_high[1] for j in range(max(0, len(cs) - 3), len(cs)))
    if sweep_wick is not None and reclaimed_lh:
        confl.append("Structure shift through the last lower-high")
        add("mmxm", 58 + (10 if in_discount else 0),
            "Market-maker buy model — engineered dip reclaimed back through the range")

    # ── D. Algo Candle / FVG (bullish fair-value gap being mitigated) ─────────
    fvg = None
    for i in range(len(cs) - 3, max(2, len(cs) - 34), -1):
        gap_bot, gap_top = highs[i - 2], lows[i]
        if gap_top > gap_bot:                                    # bullish imbalance
            mitigated_below = any(closes[j] < gap_bot for j in range(i + 1, len(cs)))
            if not mitigated_below and lows[-1] <= gap_top * 1.005 and price >= gap_bot:
                fvg = (round(gap_bot, 2), round(gap_top, 2))
                break
    if fvg:
        confl.append("FVG / Algo-Candle at entry")
        add("fvg", 52 + (10 if in_discount else 0) + (8 if relvol >= 1.3 else 0),
            f"Price mitigating a bullish fair-value gap ₹{fvg[0]:,}–₹{fvg[1]:,}")

    # ── E. Breaker / Rejection Block (retest of broken structure) ─────────────
    breaker_lvl = None
    for idx, hp in reversed(prior_highs):
        broke = any(closes[j] > hp for j in range(idx + 1, len(cs)))
        if broke and abs(price - hp) <= 1.2 * atr and price >= hp * 0.98:
            breaker_lvl = hp
            break
    if breaker_lvl:
        confl.append("Breaker / broken structure retest")
        add("breaker", 54 + (8 if in_discount else 0),
            f"Retesting a bullish breaker — broken structure (₹{breaker_lvl:,.0f}) now support")

    # ── F. High-Volume Imbalance (displacement / rejection on high volume) ────
    hvi_low = None
    for j in range(len(cs) - 1, max(0, len(cs) - 11), -1):
        rv = (vols[j] / (sum(vols[j - 20:j]) / 20)) if j >= 20 and sum(vols[j - 20:j]) else 1.0
        rng = highs[j] - lows[j]
        body_low = min(opens[j], closes[j])
        lower_wick = body_low - lows[j]
        displaced = rng > 1.6 * atr and closes[j] > opens[j]
        rejection = lower_wick > 0.5 * rng and closes[j] > (lows[j] + 0.6 * rng)
        if rv >= 1.8 and (displaced or rejection):
            hvi_low = lows[j]
            confl.append("High-volume imbalance (HVI)")
            add("hvi", 52 + min(16, (rv - 1.8) * 20),
                f"High-volume {'displacement' if displaced else 'rejection'} candle "
                f"({rv:.1f}× volume) — institutional footprint")
            break

    # ── G. Divergence (bullish momentum divergence across two swing lows) ─────
    if len(prior_lows) >= 2:
        (i1, l1), (i2, l2) = prior_lows[-2], prior_lows[-1]
        if l2 < l1 and i2 - i1 >= 5:
            r1 = _rsi(closes[:i1 + 1]) or 50
            r2 = _rsi(closes[:i2 + 1]) or 50
            if r2 > r1:
                confl.append("Bullish momentum divergence")
                add("divergence", 48, "Bullish divergence — price made a lower low, momentum a higher low")

    # extra confluences (each = 1 point in the book's scorer)
    if in_discount:
        confl.append("Discount / OTE alignment" if in_ote else "Discount alignment")
    if price > ema200:
        confl.append("HTF narrative bullish (above 200-DMA)")
    # inducement proxy: a minor swing low resting just above the swept level
    if sweep_wick is not None and any(sweep_wick < p[1] < price for p in prior_lows[-6:]):
        confl.append("Inducement present in front of the zone")
    confl = list(dict.fromkeys(confl))          # de-dup, keep order
    conf_count = len(confl)

    # ── liquidity targets: TP1 = nearest weak high, TP2 = external liquidity ──
    highs_above = sorted([p[1] for p in prior_highs if p[1] > price])
    weak_high = highs_above[0] if highs_above else None
    ext_liq = max([max(highs[-20:]), max(highs[-40:]) if len(highs) >= 40 else 0,
                   max(highs[-90:]) if len(highs) >= 90 else 0]) if highs_above else None

    # ── trade setup (book's structural stop) ─────────────────────────────────
    entry = round(price, 2)
    struct_lows = [x for x in (sweep_wick, hvi_low, (fvg[0] if fvg else None)) if x]
    raw_stop = min(struct_lows) if struct_lows else price - 1.5 * atr
    stop = min(raw_stop - 0.1 * atr, price - 1.0 * atr)         # just beyond the wick
    stop = max(stop, price * 0.90)                              # cap risk ~10%
    stop = min(stop, price * 0.985)
    risk = price - stop
    tp1 = weak_high if (weak_high and weak_high > price * 1.01) else price + 2.0 * risk
    target = round(tp1, 2)
    tp2 = max([x for x in (ext_liq, target * 1.05, price + 4 * risk) if x])
    target2 = round(tp2, 2)
    rr = round((target - price) / risk, 2) if risk > 0 else None
    upside_pct = round(_pct(target, price), 2)
    stop_pct = round(_pct(stop, price), 2)
    eta_days, eta = eta_to_target(price, target, atr, progress_drift(momentum, trend, closes[-1] > closes[-2]))

    core = {"sweep", "amd", "mmxm", "fvg", "breaker", "hvi"}
    has_core = any(m["key"] in core for m in matched)
    matched.sort(key=lambda m: m["score"], reverse=True)
    if matched:
        score = min(100, matched[0]["score"] + min(20, 5 * (conf_count - 1)))
    else:
        score = 0

    # book: only long from discount, need a preceding sweep, ≥4 confluences ideal
    qualifies = (has_core and sweep_wick is not None and conf_count >= 3
                 and pos < 0.62 and (rr is None or rr >= 1.2) and score >= 55)
    if qualifies:
        action = "LONG"
    elif matched and conf_count >= 2:
        action = "WATCH"
    else:
        action = "AVOID"

    primary = matched[0] if matched else None
    reasons = [m["note"] for m in matched]
    reasons.append(f"{zone.title()} zone — {pos * 100:.0f}% of the dealing range"
                   + (" (OTE)" if in_ote else ""))
    if weak_high:
        reasons.append(f"TP1 draws on the weak high at ₹{weak_high:,.0f} (internal liquidity)")
    reasons.append(f"{conf_count} confluences" + (" — book wants ≥4" if conf_count < 4 else ""))
    if rr:
        reasons.append(f"About {rr:.1f}:1 to TP1")

    return {
        "symbol": symbol,
        "name": name,
        "action": action,
        "qualifies": qualifies,
        "score": score,
        "strategies": matched,
        "confluences": confl,
        "conf_count": conf_count,
        "zone": zone,
        "in_discount": in_discount,
        "primary": primary["label"] if primary else "No SMC setup",
        "primary_key": primary["key"] if primary else None,
        "matched_count": len(matched),
        "trend": trend,
        "momentum": momentum,
        "rsi": round(rsi, 1),
        "price": entry,
        "entry": entry,
        "stop": round(stop, 2),
        "stop_pct": stop_pct,
        "target": target,
        "target2": target2,
        "upside_pct": upside_pct,
        "rr": rr,
        "eta_days": eta_days,
        "eta": eta,
        "support": round(rng_lo, 2),
        "resistance": round(weak_high, 2) if weak_high else round(rng_hi, 2),
        "max_dd": max_dd,
        "reasons": reasons,
        "not_automated": NOT_AUTOMATED,
    }
