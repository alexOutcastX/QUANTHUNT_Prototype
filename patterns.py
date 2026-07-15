"""Classic chart-pattern recognition over OHLC candles.

Detects the geometric ("price structure") patterns from the Chart Patterns
Handbook — double/triple tops & bottoms, head-and-shoulders, triangles, wedges,
rectangles, broadening formations, channels, flags, pennants, cup-and-handle,
rounding tops/bottoms and V reversals — by locating swing pivots and fitting
trend lines, then scoring each formation.

Each detection reports: when it started, when it ended, a confidence that the
shape is a genuine instance (0-100), a *continuation* probability that price
follows the pattern's implied direction (an indicative base rate from the
classic pattern literature, nudged by confirmation/volume context), and the
*expansion* — the measured-move target as a signed % of price.

No third-party dependencies (pure Python + math) so it stays fast and testable.
Probabilities are indicative heuristics for education, NOT a forecast.
"""
from __future__ import annotations

import math

# ── Pattern metadata ─────────────────────────────────────────────────────────
# bias: direction the pattern implies once it resolves.
# category: reversal (flips the prior trend) / continuation (resumes it) /
#           bilateral (breaks either way — bias set at detection).
# base: indicative probability the pattern follows through to its target once
#       confirmed — loose base rates in the spirit of the classic surveys, used
#       only as a starting point and always labelled indicative.
_META = {
    "double_top":            ("Double Top",            "bearish", "reversal",     0.65),
    "double_bottom":         ("Double Bottom",         "bullish", "reversal",     0.66),
    "triple_top":            ("Triple Top",            "bearish", "reversal",     0.60),
    "triple_bottom":         ("Triple Bottom",         "bullish", "reversal",     0.61),
    "head_shoulders":        ("Head and Shoulders",    "bearish", "reversal",     0.66),
    "inverse_head_shoulders":("Inverse Head & Shoulders","bullish","reversal",    0.63),
    "ascending_triangle":    ("Ascending Triangle",    "bullish", "continuation", 0.63),
    "descending_triangle":   ("Descending Triangle",   "bearish", "continuation", 0.60),
    "symmetrical_triangle":  ("Symmetrical Triangle",  "neutral", "bilateral",    0.54),
    "rising_wedge":          ("Rising Wedge",          "bearish", "reversal",     0.60),
    "falling_wedge":         ("Falling Wedge",         "bullish", "reversal",     0.62),
    "rectangle":             ("Rectangle",             "neutral", "bilateral",    0.55),
    "broadening":            ("Broadening Formation",  "neutral", "bilateral",    0.50),
    "ascending_channel":     ("Ascending Channel",     "bullish", "continuation", 0.55),
    "descending_channel":    ("Descending Channel",    "bearish", "continuation", 0.55),
    "bull_flag":             ("Bull Flag",             "bullish", "continuation", 0.67),
    "bear_flag":             ("Bear Flag",             "bearish", "continuation", 0.62),
    "bull_pennant":          ("Bull Pennant",          "bullish", "continuation", 0.60),
    "bear_pennant":          ("Bear Pennant",          "bearish", "continuation", 0.58),
    "cup_and_handle":        ("Cup and Handle",        "bullish", "continuation", 0.65),
    "rounding_bottom":       ("Rounding Bottom",       "bullish", "reversal",     0.57),
    "rounding_top":          ("Rounding Top",          "bearish", "reversal",     0.53),
    "v_bottom":              ("V-Bottom",              "bullish", "reversal",     0.55),
    "v_top":                 ("V-Top",                 "bearish", "reversal",     0.54),
}


# Specificity priority — when two patterns cover almost the same span, the more
# specific/reliable read wins over a generic envelope (e.g. a Double Top should
# not be hidden behind a Rounding Top over the same bars).
_PRIORITY = {
    "head_shoulders": 3, "inverse_head_shoulders": 3, "double_top": 3,
    "double_bottom": 3, "triple_top": 3, "triple_bottom": 3, "cup_and_handle": 3,
    "ascending_triangle": 2, "descending_triangle": 2, "symmetrical_triangle": 2,
    "rising_wedge": 2, "falling_wedge": 2, "bull_flag": 2, "bear_flag": 2,
    "bull_pennant": 2, "bear_pennant": 2, "v_bottom": 2, "v_top": 2,
    "rectangle": 1, "broadening": 1, "ascending_channel": 1,
    "descending_channel": 1, "rounding_bottom": 1, "rounding_top": 1,
}


def meta_for(t):
    label, bias, cat, base = _META.get(t, (t, "neutral", "bilateral", 0.5))
    return {"label": label, "bias": bias, "category": cat, "base": base}


# ── small numeric helpers (no numpy) ─────────────────────────────────────────
def _linfit(xs, ys):
    """Least-squares slope+intercept of ys ~ a*x + b. Returns (a, b)."""
    n = len(xs)
    if n < 2:
        return 0.0, (ys[0] if ys else 0.0)
    sx = sum(xs); sy = sum(ys)
    sxx = sum(x * x for x in xs); sxy = sum(x * y for x, y in zip(xs, ys))
    den = n * sxx - sx * sx
    if abs(den) < 1e-12:
        return 0.0, sy / n
    a = (n * sxy - sx * sy) / den
    b = (sy - a * sx) / n
    return a, b


def _r2(xs, ys, a, b):
    if len(ys) < 2:
        return 0.0
    mean = sum(ys) / len(ys)
    ss_tot = sum((y - mean) ** 2 for y in ys)
    ss_res = sum((y - (a * x + b)) ** 2 for x, y in zip(xs, ys))
    if ss_tot < 1e-12:
        return 1.0
    return max(0.0, 1.0 - ss_res / ss_tot)


def _pct(a, b):
    return abs(a - b) / b if b else 0.0


# ── pivots ───────────────────────────────────────────────────────────────────
def _pivots(highs, lows, k):
    """Alternating swing highs/lows. Returns [(index, price, 'H'|'L'), …]."""
    n = len(highs)
    raw = []
    for i in range(k, n - k):
        hw = highs[i - k:i + k + 1]
        lw = lows[i - k:i + k + 1]
        # pivot high: highest in the window AND strictly above both neighbours
        # (the neighbour test rejects flat plateaus without needing a unique max)
        if highs[i] == max(hw) and highs[i] > highs[i - 1] and highs[i] > highs[i + 1]:
            raw.append((i, highs[i], "H"))
        elif lows[i] == min(lw) and lows[i] < lows[i - 1] and lows[i] < lows[i + 1]:
            raw.append((i, lows[i], "L"))
    # collapse consecutive same-kind pivots, keeping the more extreme one
    seq = []
    for piv in raw:
        if seq and seq[-1][2] == piv[2]:
            if (piv[2] == "H" and piv[1] > seq[-1][1]) or (piv[2] == "L" and piv[1] < seq[-1][1]):
                seq[-1] = piv
        else:
            seq.append(piv)
    return seq


# ── reversal detectors over the pivot sequence ───────────────────────────────
def _reversal(seq, closes, times, tol=0.04):
    """Double/triple tops & bottoms and (inverse) head-and-shoulders."""
    out = []
    P = seq
    price0 = closes[len(closes) // 2] or 1.0

    def conf_close_below(after_idx, level):
        for j in range(after_idx + 1, len(closes)):
            if closes[j] < level:
                return j
        return None

    def conf_close_above(after_idx, level):
        for j in range(after_idx + 1, len(closes)):
            if closes[j] > level:
                return j
        return None

    for i in range(len(P) - 2):
        a, b, c = P[i], P[i + 1], P[i + 2]
        # Double top: H, L, H with near-equal highs
        if a[2] == "H" and b[2] == "L" and c[2] == "H" and _pct(a[1], c[1]) <= tol:
            trough = b[1]
            height = (a[1] + c[1]) / 2 - trough
            if height > 0:
                brk = conf_close_below(c[0], trough)
                sym = 1 - _pct(a[1], c[1]) / tol
                out.append(_mk("double_top", a[0], (brk or c[0]), times, closes,
                               sym, height / ((a[1] + c[1]) / 2), trough,
                               confirmed=brk is not None))
        # Double bottom
        if a[2] == "L" and b[2] == "H" and c[2] == "L" and _pct(a[1], c[1]) <= tol:
            peak = b[1]
            height = peak - (a[1] + c[1]) / 2
            if height > 0:
                brk = conf_close_above(c[0], peak)
                sym = 1 - _pct(a[1], c[1]) / tol
                out.append(_mk("double_bottom", a[0], (brk or c[0]), times, closes,
                               sym, height / ((a[1] + c[1]) / 2), peak,
                               confirmed=brk is not None))

    for i in range(len(P) - 4):
        p = P[i:i + 5]
        kinds = "".join(x[2] for x in p)
        # Triple top: H L H L H
        if kinds == "HLHLH" and _pct(p[0][1], p[2][1]) <= tol and _pct(p[2][1], p[4][1]) <= tol:
            neck = min(p[1][1], p[3][1])
            top = max(p[0][1], p[2][1], p[4][1])
            height = top - neck
            if height > 0:
                brk = conf_close_below(p[4][0], neck)
                sym = 1 - (_pct(p[0][1], p[2][1]) + _pct(p[2][1], p[4][1])) / (2 * tol)
                out.append(_mk("triple_top", p[0][0], (brk or p[4][0]), times, closes,
                               sym, height / top, neck, confirmed=brk is not None))
        # Triple bottom
        if kinds == "LHLHL" and _pct(p[0][1], p[2][1]) <= tol and _pct(p[2][1], p[4][1]) <= tol:
            neck = max(p[1][1], p[3][1])
            bot = min(p[0][1], p[2][1], p[4][1])
            height = neck - bot
            if height > 0:
                brk = conf_close_above(p[4][0], neck)
                sym = 1 - (_pct(p[0][1], p[2][1]) + _pct(p[2][1], p[4][1])) / (2 * tol)
                out.append(_mk("triple_bottom", p[0][0], (brk or p[4][0]), times, closes,
                               sym, height / bot, neck, confirmed=brk is not None))
        # Head & shoulders: H L H L H, middle head highest, shoulders similar
        if kinds == "HLHLH":
            ls, t1, hd, t2, rs = p
            if hd[1] > ls[1] and hd[1] > rs[1] and _pct(ls[1], rs[1]) <= tol * 1.5:
                neck = (t1[1] + t2[1]) / 2
                height = hd[1] - neck
                if height > 0:
                    brk = conf_close_below(rs[0], neck)
                    sym = 1 - _pct(ls[1], rs[1]) / (tol * 1.5)
                    out.append(_mk("head_shoulders", ls[0], (brk or rs[0]), times, closes,
                                   sym, height / hd[1], neck, confirmed=brk is not None))
        # Inverse head & shoulders
        if kinds == "LHLHL":
            ls, t1, hd, t2, rs = p
            if hd[1] < ls[1] and hd[1] < rs[1] and _pct(ls[1], rs[1]) <= tol * 1.5:
                neck = (t1[1] + t2[1]) / 2
                height = neck - hd[1]
                if height > 0:
                    brk = conf_close_above(rs[0], neck)
                    sym = 1 - _pct(ls[1], rs[1]) / (tol * 1.5)
                    out.append(_mk("inverse_head_shoulders", ls[0], (brk or rs[0]), times, closes,
                                   sym, height / hd[1], neck, confirmed=brk is not None))
    return out


# ── trend-line detectors over sliding windows ────────────────────────────────
def _trendline(highs, lows, closes, times, k):
    """Triangles, wedges, rectangle, broadening and channels."""
    out = []
    n = len(highs)
    seq = _pivots(highs, lows, k)
    for w in (40, 60, 90):
        if n < w + 2:
            continue
        for end in range(w, n, max(6, w // 4)):
            start = end - w
            piv = [p for p in seq if start <= p[0] <= end]
            hs = [(p[0], p[1]) for p in piv if p[2] == "H"]
            ls = [(p[0], p[1]) for p in piv if p[2] == "L"]
            if len(hs) < 2 or len(ls) < 2:
                continue
            avg = sum(closes[start:end + 1]) / (end - start + 1) or 1.0
            ah, bh = _linfit([x for x, _ in hs], [y for _, y in hs])
            al, bl = _linfit([x for x, _ in ls], [y for _, y in ls])
            # relative slope over the window (fraction of price)
            sh = ah * w / avg
            sl = al * w / avg
            top0, top1 = bh + ah * start, bh + ah * end
            bot0, bot1 = bl + al * start, bl + al * end
            width0 = _pct(top0, bot0) if bot0 else 0
            width1 = _pct(top1, bot1) if bot1 else 0
            fit = (_r2([x for x, _ in hs], [y for _, y in hs], ah, bh)
                   + _r2([x for x, _ in ls], [y for _, y in ls], al, bl)) / 2
            height = abs(top0 - bot0) / avg
            flat = 0.03
            t = None
            if sh <= flat and sh >= -flat and sl > flat:
                t = "ascending_triangle"
            elif sl <= flat and sl >= -flat and sh < -flat:
                t = "descending_triangle"
            elif sh < -flat and sl > flat:
                t = "symmetrical_triangle"
            elif sh > flat and sl > flat and width1 < width0 * 0.7:
                t = "rising_wedge"
            elif sh < -flat and sl < -flat and width1 < width0 * 0.7:
                t = "falling_wedge"
            elif abs(sh) <= flat and abs(sl) <= flat and width0 > 0.03:
                t = "rectangle"
            elif sh > flat and sl < -flat and width1 > width0 * 1.3:
                t = "broadening"
            elif sh > flat and sl > flat and abs(sh - sl) < flat and width1 <= width0 * 1.3 and width1 >= width0 * 0.7:
                t = "ascending_channel"
            elif sh < -flat and sl < -flat and abs(sh - sl) < flat and width1 <= width0 * 1.3 and width1 >= width0 * 0.7:
                t = "descending_channel"
            if t:
                out.append(_mk(t, start, end, times, closes, fit, height,
                               (top1 + bot1) / 2, confirmed=False,
                               touches=len(hs) + len(ls)))
    return out


# ── pole + consolidation: flags & pennants ───────────────────────────────────
def _flags(highs, lows, closes, times, k):
    out = []
    n = len(highs)
    seq = _pivots(highs, lows, k)
    pole = max(8, n // 40)
    for cons in (8, 12, 18):
        for end in range(pole + cons, n, 4):
            cs = end - cons
            ps = cs - pole
            if ps < 0:
                continue
            move = (closes[cs] - closes[ps]) / (closes[ps] or 1.0)
            # consolidation slope
            xs = list(range(cs, end + 1))
            a, b = _linfit(xs, closes[cs:end + 1])
            avg = sum(closes[cs:end + 1]) / (end - cs + 1) or 1.0
            cslope = a * cons / avg
            rng = (max(highs[cs:end + 1]) - min(lows[cs:end + 1])) / avg
            piv = [p for p in seq if cs <= p[0] <= end]
            hs = [(p[0], p[1]) for p in piv if p[2] == "H"]
            ls = [(p[0], p[1]) for p in piv if p[2] == "L"]
            converging = False
            if len(hs) >= 2 and len(ls) >= 2:
                ah, _ = _linfit([x for x, _ in hs], [y for _, y in hs])
                al, _ = _linfit([x for x, _ in ls], [y for _, y in ls])
                converging = (ah < 0 and al > 0)
            if move >= 0.12 and rng < 0.10:               # strong up pole, tight pause
                t = "bull_pennant" if converging else "bull_flag"
                out.append(_mk(t, ps, end, times, closes, min(1.0, move / 0.2),
                               abs(move), closes[end], confirmed=False))
            elif move <= -0.12 and rng < 0.10:            # strong down pole
                t = "bear_pennant" if converging else "bear_flag"
                out.append(_mk(t, ps, end, times, closes, min(1.0, abs(move) / 0.2),
                               abs(move), closes[end], confirmed=False))
    return out


# ── parabola: rounding & cup-and-handle; sharp V reversals ───────────────────
def _curves(highs, lows, closes, times):
    out = []
    n = len(closes)
    for w in (30, 45, 70):
        if n < w + 2:
            continue
        for end in range(w, n, max(5, w // 5)):
            start = end - w
            xs = list(range(w + 1))
            ys = closes[start:end + 1]
            # fit quadratic y = A x^2 + B x + C via normal equations (3x3)
            A, B, C = _quadfit(xs, ys)
            if A == 0:
                continue
            avg = sum(ys) / len(ys) or 1.0
            curv = A * w * w / avg                     # normalized curvature
            vertex = -B / (2 * A) if A else 0
            # residual quality
            res = sum((y - (A * x * x + B * x + C)) ** 2 for x, y in zip(xs, ys))
            tot = sum((y - avg) ** 2 for y in ys) or 1.0
            q = max(0.0, 1 - res / tot)
            if q < 0.55:
                continue
            depth = abs(max(ys) - min(ys)) / avg
            if curv > 0.15 and 0.2 * w < vertex < 0.8 * w:        # U — rounding bottom
                # cup-and-handle: small pullback near the right rim
                handle = ys[-max(3, w // 8):]
                rim = max(ys[:w // 2])
                if min(handle) > rim * 0.90 and handle[-1] < max(handle):
                    out.append(_mk("cup_and_handle", start, end, times, closes, q, depth,
                                   rim, confirmed=False))
                else:
                    out.append(_mk("rounding_bottom", start, end, times, closes, q, depth,
                                   max(ys), confirmed=False))
            elif curv < -0.15 and 0.2 * w < vertex < 0.8 * w:     # ∩ — rounding top
                out.append(_mk("rounding_top", start, end, times, closes, q, depth,
                               min(ys), confirmed=False))
    # sharp V reversals around an extreme pivot
    for w in (6, 10):
        for i in range(w, n - w):
            left = (closes[i] - closes[i - w]) / (closes[i - w] or 1.0)
            right = (closes[i + w] - closes[i]) / (closes[i] or 1.0)
            if left <= -0.10 and right >= 0.10:
                out.append(_mk("v_bottom", i - w, i + w, times, closes,
                               min(1.0, (abs(left) + right) / 0.4), (abs(left) + right) / 2,
                               closes[i], confirmed=True))
            elif left >= 0.10 and right <= -0.10:
                out.append(_mk("v_top", i - w, i + w, times, closes,
                               min(1.0, (abs(left) + abs(right)) / 0.4), (abs(left) + abs(right)) / 2,
                               closes[i], confirmed=True))
    return out


def _quadfit(xs, ys):
    n = len(xs)
    s0 = n
    s1 = sum(xs); s2 = sum(x * x for x in xs)
    s3 = sum(x ** 3 for x in xs); s4 = sum(x ** 4 for x in xs)
    t0 = sum(ys); t1 = sum(x * y for x, y in zip(xs, ys)); t2 = sum(x * x * y for x, y in zip(xs, ys))
    # solve [[s4,s3,s2],[s3,s2,s1],[s2,s1,s0]] · [A,B,C] = [t2,t1,t0]
    m = [[s4, s3, s2, t2], [s3, s2, s1, t1], [s2, s1, s0, t0]]
    for col in range(3):
        piv = max(range(col, 3), key=lambda r: abs(m[r][col]))
        if abs(m[piv][col]) < 1e-9:
            return 0.0, 0.0, 0.0
        m[col], m[piv] = m[piv], m[col]
        pv = m[col][col]
        m[col] = [v / pv for v in m[col]]
        for r in range(3):
            if r != col:
                f = m[r][col]
                m[r] = [a - f * b for a, b in zip(m[r], m[col])]
    return m[0][3], m[1][3], m[2][3]


# ── assemble one detection record ────────────────────────────────────────────
def _mk(t, i0, i1, times, closes, fit, expansion, level, confirmed, touches=0):
    m = meta_for(t)
    fit = max(0.0, min(1.0, fit))
    # confidence: geometric fit + a small bonus for extra trend-line touches
    conf = 40 + 55 * fit + min(5, touches)
    conf = max(20, min(98, conf))
    # continuation: base rate, lifted when the breakout is already confirmed
    cont = m["base"] * 100 * (1.08 if confirmed else 1.0)
    cont = max(35, min(90, cont))
    direction = 1 if m["bias"] == "bullish" else (-1 if m["bias"] == "bearish" else 0)
    exp_pct = round(expansion * 100 * (1 if direction >= 0 else -1), 1)
    px = closes[min(i1, len(closes) - 1)]
    target = None
    if direction and px:
        target = round(px * (1 + direction * expansion), 2)
    return {
        "type": t,
        "label": m["label"],
        "bias": m["bias"],
        "category": m["category"],
        "start_index": i0,
        "end_index": i1,
        "start_ts": int(times[max(0, min(i0, len(times) - 1))]),
        "end_ts": int(times[max(0, min(i1, len(times) - 1))]),
        "confidence": round(conf),
        "continuation": round(cont),
        "expansion_pct": exp_pct,
        "target": target,
        "level": round(level, 2) if level else None,
        "status": "confirmed" if confirmed else "forming",
    }


# ── public entry point ───────────────────────────────────────────────────────
def detect_patterns(candles, max_results=40):
    """candles: chronological list of {t,o,h,l,c,v}. Returns a summary dict."""
    cs = [c for c in candles if c.get("c") is not None and c.get("h") is not None
          and c.get("l") is not None]
    n = len(cs)
    if n < 20:
        return {"count": 0, "patterns": [], "current": None,
                "note": "Not enough history to scan for chart patterns (need ~20+ bars)."}
    highs = [float(c["h"]) for c in cs]
    lows = [float(c["l"]) for c in cs]
    closes = [float(c["c"]) for c in cs]
    times = [int(c["t"]) for c in cs]
    k = max(2, min(6, n // 60))

    seq = _pivots(highs, lows, k)
    found = []
    found += _reversal(seq, closes, times)
    found += _trendline(highs, lows, closes, times, k)
    found += _flags(highs, lows, closes, times, k)
    found += _curves(highs, lows, closes, times)

    # De-duplicate near-identical detections. Order by specificity first, then
    # confidence, so the more specific/reliable read survives an overlap.
    found.sort(key=lambda d: (-_PRIORITY.get(d["type"], 1), -d["confidence"], d["start_index"]))
    kept = []
    for d in found:
        dup = False
        for e in kept:
            ov = _overlap(d, e)
            # same pattern, overlapping span → keep the higher-confidence one;
            # any two patterns covering almost the same span → keep the stronger
            # read so the table isn't three near-identical rows.
            if (e["type"] == d["type"] and ov > 0.6) or ov > 0.8:
                dup = True
                break
        if not dup:
            kept.append(d)

    # Recency-sorted; the "current" pattern is the most recent whose span
    # reaches the last few bars (still active / just resolved).
    kept.sort(key=lambda d: d["end_index"], reverse=True)
    last = n - 1
    current = None
    for d in kept:
        if last - d["end_index"] <= max(3, k):
            current = d
            break
    for d in kept:
        d["current"] = current is not None and d is current
        d.pop("start_index", None)
        d.pop("end_index", None)

    return {
        "count": len(kept),
        "patterns": kept[:max_results],
        "current": current,
        "bars": n,
    }


def _overlap(a, b):
    lo = max(a["start_index"], b["start_index"])
    hi = min(a["end_index"], b["end_index"])
    inter = max(0, hi - lo)
    span = max(a["end_index"] - a["start_index"], b["end_index"] - b["start_index"], 1)
    return inter / span
