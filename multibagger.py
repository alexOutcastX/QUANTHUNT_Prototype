# Multibagger-potential scoring for the Analysis tab.
#
# Pure functions only (stdlib, no network) so the engine is unit-testable in
# CI; server.py fetches the raw metrics from yfinance and calls score().
#
# The framework distils how the well-documented multibagger hunters screen:
# Peter Lynch (small, fast growers at a fair price / PEG), Chris Mayer's
# "100 Baggers" study of 365 US 100-baggers (small base + high sustained
# ROE reinvested for years), Thomas Phelps ("buy right, sit tight"), and
# Motilal Oswal's 100x wealth-creation studies of Indian markets (small-cap
# base, earnings growth, promoter skin in the game, low leverage, long
# runway). Each pillar below maps to one of those observations.

PILLARS = [
    # (key, label, weight, what the big players look for)
    ("size", "Size & runway", 18,
     "Small base: nearly every 100-bagger started as a small cap - a 500cr company can 100x, a 5L cr one cannot."),
    ("growth", "Growth engine", 24,
     "Sustained revenue & earnings growth >15-20% - the single biggest driver of multibagger returns."),
    ("quality", "Quality & moat", 18,
     "High return on equity with strong margins, held for years - Mayer's 'twin engines' of growth and returns on capital."),
    ("balance", "Balance sheet", 14,
     "Low debt and positive cash generation - leverage is how promising small caps die before they compound."),
    ("ownership", "Ownership", 10,
     "High promoter/insider stake (skin in the game) and low institutional ownership (still undiscovered)."),
    ("valuation", "Valuation", 10,
     "Growth at a reasonable price - Lynch's PEG: pay less than the growth rate, avoid paying up for the story."),
    ("momentum", "Trend", 6,
     "Price in a long-term uptrend - winners keep making highs; big players add to strength, not to falling knives."),
]


def _resolve(base: str, retries: int = 1):
    """Return (ticker, info) for a bare NSE/BSE symbol, tolerating transient
    Yahoo failures. Tries the NSE feed first, then the BSE (.BO) feed, and
    retries the `.info` call on an exception (Yahoo rate-limits/HTTP hiccups)
    with a short backoff. Returns ({}) info when neither exchange yields data —
    the caller raises ValueError from that, so a flaky upstream never surfaces
    as an unhandled 500/502. `retries` is the number of *extra* attempts per
    exchange (0 = fail fast, used by the mass screen)."""
    import time as _t
    import yfinance as yf

    def has(info):
        return bool(info.get("longName") or info.get("shortName") or info.get("regularMarketPrice"))

    last_t = None
    for suffix in (".NS", ".BO"):
        t = last_t = yf.Ticker(base + suffix)
        info = {}
        for attempt in range(retries + 1):
            try:
                info = t.info or {}
                if has(info):
                    break  # got usable data
                # Empty/sparse `.info` is usually a transient rate-limit, not a
                # bad symbol — back off and retry rather than moving on.
                raise ValueError("sparse info")
            except Exception:
                info = info if has(info) else {}
                if attempt < retries:
                    _t.sleep(min(1.0 * (2 ** attempt), 5.0))  # exp backoff, capped 5s
        if has(info):
            return t, info
    return last_t, {}


def fetch_metrics(symbol: str, with_history: bool = True, retries: int = 1):
    """Fetch the raw scoring metrics for a symbol from yfinance (lazy import,
    so this module stays importable in stdlib-only CI).

    Returns (metrics, ident): `metrics` feeds score(); `ident` carries
    name/sector/industry/price/about. with_history=False skips the extra
    price-history request (3y CAGR) — used by the mass screen where one HTTP
    call per symbol is the budget. `retries` controls upstream resilience (see
    _resolve). Raises ValueError when neither exchange has data.
    """
    t, info = _resolve(symbol.upper().strip(), retries=retries)
    if not info.get("longName") and not info.get("shortName") and not info.get("regularMarketPrice"):
        raise ValueError(f"no data for {symbol}")

    def cr(v):
        return round(v / 1e7, 2) if v else None

    def pctf(v):
        return round(v * 100, 2) if v is not None else None

    price = info.get("currentPrice") or info.get("regularMarketPrice")
    dma200 = info.get("twoHundredDayAverage")
    hi52 = info.get("fiftyTwoWeekHigh")

    cagr3 = None
    if with_history:
        try:
            hist = t.history(period="3y", interval="1mo", auto_adjust=True)
            closes = hist["Close"].dropna()
            if len(closes) >= 24 and closes.iloc[0] > 0:
                years = (len(closes) - 1) / 12.0
                cagr3 = round(((float(closes.iloc[-1]) / float(closes.iloc[0])) ** (1 / years) - 1) * 100, 1)
        except Exception:
            pass

    de = info.get("debtToEquity")   # yfinance reports percent (e.g. 45.3)
    metrics = {
        "mcap_cr":             cr(info.get("marketCap")),
        "revenue_growth_pct":  pctf(info.get("revenueGrowth")),
        "earnings_growth_pct": pctf(info.get("earningsGrowth")),
        "roe_pct":             pctf(info.get("returnOnEquity")),
        "op_margin_pct":       pctf(info.get("operatingMargins")),
        "profit_margin_pct":   pctf(info.get("profitMargins")),
        "debt_equity":         round(de / 100, 2) if de is not None else None,
        "current_ratio":       info.get("currentRatio"),
        "fcf_cr":              cr(info.get("freeCashflow")),
        "insider_pct":         pctf(info.get("heldPercentInsiders")),
        "institution_pct":     pctf(info.get("heldPercentInstitutions")),
        "pe":                  info.get("trailingPE"),
        "pb":                  info.get("priceToBook"),
        "peg":                 info.get("trailingPegRatio") or info.get("pegRatio"),
        "vs_200dma_pct":       round((price / dma200 - 1) * 100, 1) if price and dma200 else None,
        "pct_from_high_pct":   round((price / hi52 - 1) * 100, 1) if price and hi52 else None,
        "price_cagr_3y_pct":   cagr3,
    }
    # Quote extras for list views (same info call — zero extra cost).
    prev = info.get("previousClose") or info.get("regularMarketPreviousClose")
    vol = info.get("volume") or info.get("regularMarketVolume")
    avgvol = info.get("averageVolume")
    d50avg = info.get("fiftyDayAverage")
    ident = {
        "symbol":   symbol.upper().strip(),
        "name":     info.get("longName") or info.get("shortName") or symbol.upper(),
        "sector":   info.get("sector"),
        "industry": info.get("industry"),
        "price":    price,
        "chg":      round((price / prev - 1) * 100, 2) if price and prev else None,
        "volume":   vol,
        "relvol":   round(vol / avgvol, 2) if vol and avgvol else None,
        "vs_50dma": round((price / d50avg - 1) * 100, 1) if price and d50avg else None,
        "about":    (info.get("longBusinessSummary") or "")[:500],
    }
    return metrics, ident


def _band(value, bands, default=None):
    """First score whose threshold the value passes; None-safe."""
    if value is None:
        return default
    for threshold, s in bands:
        if value >= threshold:
            return s
    return bands[-1][1]


def _band_low(value, bands, default=None):
    """Like _band but lower-is-better."""
    if value is None:
        return default
    for threshold, s in bands:
        if value <= threshold:
            return s
    return bands[-1][1]


def _avg(*vals):
    xs = [v for v in vals if v is not None]
    return sum(xs) / len(xs) if xs else None


def _pillar_scores(m):
    """Raw 0-100 score per pillar from the metrics dict (all keys optional)."""
    s = {}

    s["size"] = _band_low(m.get("mcap_cr"), [
        (500, 100), (2000, 88), (5000, 72), (10000, 50), (20000, 30), (float("inf"), 8),
    ])

    rev = _band(m.get("revenue_growth_pct"), [
        (25, 100), (15, 82), (8, 58), (0, 34), (float("-inf"), 10),
    ])
    earn = _band(m.get("earnings_growth_pct"), [
        (30, 100), (18, 84), (10, 60), (0, 34), (float("-inf"), 8),
    ])
    s["growth"] = _avg(rev, earn)

    roe = _band(m.get("roe_pct"), [
        (25, 100), (18, 84), (12, 62), (8, 40), (float("-inf"), 15),
    ])
    opm = _band(m.get("op_margin_pct"), [
        (20, 100), (12, 78), (6, 52), (0, 30), (float("-inf"), 5),
    ])
    s["quality"] = _avg(roe, opm)

    de = _band_low(m.get("debt_equity"), [
        (0.1, 100), (0.3, 86), (0.7, 62), (1.5, 32), (float("inf"), 10),
    ])
    cr = _band(m.get("current_ratio"), [
        (2, 100), (1.2, 72), (0.8, 42), (float("-inf"), 15),
    ])
    fcf = None
    if m.get("fcf_cr") is not None:
        fcf = 100 if m["fcf_cr"] > 0 else 20
    s["balance"] = _avg(de, cr, fcf)

    ins = _band(m.get("insider_pct"), [
        (60, 100), (45, 82), (30, 58), (15, 36), (float("-inf"), 20),
    ])
    inst = _band_low(m.get("institution_pct"), [
        (5, 100), (15, 78), (30, 52), (float("inf"), 30),
    ])
    s["ownership"] = _avg(ins, inst)

    peg = _band_low(m.get("peg"), [
        (1.0, 100), (1.5, 82), (2.5, 56), (4.0, 30), (float("inf"), 10),
    ])
    if peg is None:
        peg = _band_low(m.get("pe"), [
            (15, 82), (25, 62), (40, 36), (float("inf"), 14),
        ])
    s["valuation"] = peg

    trend = _band(m.get("vs_200dma_pct"), [
        (0, 90), (-10, 55), (float("-inf"), 25),
    ])
    cagr = _band(m.get("price_cagr_3y_pct"), [
        (25, 100), (12, 75), (0, 45), (float("-inf"), 20),
    ])
    s["momentum"] = _avg(trend, cagr)

    return s


def _flags(m, pillar):
    """Human-readable strengths and red flags from raw metrics."""
    strengths, red = [], []

    def num(k):
        return m.get(k)

    mc = num("mcap_cr")
    if mc is not None:
        if mc <= 5000:
            strengths.append(f"Small base (₹{mc:,.0f} cr) — genuine room to re-rate many times over.")
        elif mc > 20000:
            red.append(f"Already a ₹{mc:,.0f} cr company — the multibagger math gets hard from a large base.")
    rg, eg = num("revenue_growth_pct"), num("earnings_growth_pct")
    if rg is not None and rg >= 15:
        strengths.append(f"Revenue compounding at {rg:.0f}% — a working growth engine.")
    if eg is not None and eg >= 18:
        strengths.append(f"Earnings growing {eg:.0f}% — profits scaling with (or faster than) sales.")
    if eg is not None and eg < 0:
        red.append(f"Earnings shrinking ({eg:.0f}%) — multibaggers are built on profit growth.")
    roe = num("roe_pct")
    if roe is not None and roe >= 18:
        strengths.append(f"ROE {roe:.0f}% — high returns on capital to reinvest (Mayer's key ingredient).")
    if roe is not None and roe < 8:
        red.append(f"ROE only {roe:.0f}% — capital compounds slowly at this rate.")
    de = num("debt_equity")
    if de is not None and de <= 0.3:
        strengths.append(f"Barely levered (D/E {de:.2f}) — survives downturns while compounding.")
    if de is not None and de > 1.5:
        red.append(f"Heavy leverage (D/E {de:.2f}) — the classic small-cap killer.")
    fcf = num("fcf_cr")
    if fcf is not None and fcf < 0:
        red.append("Negative free cash flow — growth is being bought, not earned.")
    ins = num("insider_pct")
    if ins is not None and ins >= 45:
        strengths.append(f"Promoters/insiders hold {ins:.0f}% — strong skin in the game.")
    if ins is not None and ins < 15:
        red.append(f"Low insider holding ({ins:.0f}%) — nobody with skin in the game.")
    inst = num("institution_pct")
    if inst is not None and inst < 15:
        strengths.append(f"Institutions own just {inst:.0f}% — still under-discovered; re-rating fuel.")
    if inst is not None and inst > 40:
        red.append(f"Institutions already own {inst:.0f}% — the discovery re-rating has happened.")
    peg, pe = num("peg"), num("pe")
    if peg is not None and peg <= 1.2:
        strengths.append(f"PEG {peg:.2f} — paying less than the growth rate (Lynch's test).")
    if pe is not None and pe > 60 and (eg is None or eg < 25):
        red.append(f"P/E {pe:.0f} without matching growth — priced for perfection.")
    v200 = num("vs_200dma_pct")
    if v200 is not None and v200 < -10:
        red.append(f"Trading {abs(v200):.0f}% below the 200-DMA — fighting a downtrend.")
    ph = num("pct_from_high_pct")
    if ph is not None and ph <= -60:
        red.append(f"{abs(ph):.0f}% below its 52-week high — falling knives rarely multibag next.")
    if pillar.get("growth") is None:
        red.append("Growth data unavailable — the most important pillar could not be verified.")
    return strengths, red


def _checklist(m):
    """The classic big-player checklist, pass/fail/unknown per criterion."""
    def state(v, ok):
        if v is None:
            return "unknown"
        return "pass" if ok(v) else "fail"

    return [
        {"label": "Small-cap base (< ₹5,000 cr)", "state": state(m.get("mcap_cr"), lambda v: v < 5000)},
        {"label": "Revenue growth > 15%", "state": state(m.get("revenue_growth_pct"), lambda v: v > 15)},
        {"label": "Earnings growth > 18%", "state": state(m.get("earnings_growth_pct"), lambda v: v > 18)},
        {"label": "ROE > 15%", "state": state(m.get("roe_pct"), lambda v: v > 15)},
        {"label": "Debt/equity < 0.5", "state": state(m.get("debt_equity"), lambda v: v < 0.5)},
        {"label": "Positive free cash flow", "state": state(m.get("fcf_cr"), lambda v: v > 0)},
        {"label": "Promoter/insider stake > 40%", "state": state(m.get("insider_pct"), lambda v: v > 40)},
        {"label": "Institutional ownership < 20%", "state": state(m.get("institution_pct"), lambda v: v < 20)},
        {"label": "PEG < 1.5 (growth at a fair price)", "state": state(m.get("peg") or m.get("pe"),
            (lambda v: v < 1.5) if m.get("peg") is not None else (lambda v: v < 25))},
        {"label": "Price above 200-DMA (uptrend)", "state": state(m.get("vs_200dma_pct"), lambda v: v > 0)},
    ]


def score(metrics: dict) -> dict:
    """Full multibagger report from a metrics dict; every key is optional.

    Returns score (0-100), a heuristic probability band, tier, per-pillar
    breakdown, strengths/red flags, and the classic checklist.
    """
    m = metrics or {}
    raw = _pillar_scores(m)

    # Weighted composite over pillars that HAVE data; missing pillars don't
    # silently count as zero (they're reported as unknown instead).
    num = den = 0.0
    pillars_out = []
    for key, label, weight, note in PILLARS:
        ps = raw.get(key)
        if ps is not None:
            num += ps * weight
            den += weight
        pillars_out.append({
            "key": key, "label": label, "weight": weight,
            "score": round(ps) if ps is not None else None, "note": note,
        })
    composite = round(num / den) if den else 0
    coverage = round(100 * den / sum(w for _, _, w, _ in PILLARS))

    if composite >= 75:
        tier = "HIGH POTENTIAL"
    elif composite >= 60:
        tier = "PROMISING"
    elif composite >= 45:
        tier = "MODERATE"
    elif composite >= 30:
        tier = "WEAK"
    else:
        tier = "LOW"

    # Honest heuristic: even textbook setups mostly don't 10x. Map the score
    # to an indicative probability of a 5x+ over 5-10 years, capped low.
    probability = max(2, min(70, round(composite * 0.62 - 8)))

    strengths, red_flags = _flags(m, raw)

    return {
        "score": composite,
        "coverage_pct": coverage,
        "tier": tier,
        "probability_pct": probability,
        "pillars": pillars_out,
        "strengths": strengths,
        "red_flags": red_flags,
        "checklist": _checklist(m),
        "metrics": m,
        "methodology": (
            "Framework distilled from Peter Lynch (fast growers, PEG), Chris Mayer's "
            "100 Baggers study (small base + high ROE reinvested for years), Thomas "
            "Phelps (buy right, sit tight) and Motilal Oswal's 100x studies (earnings "
            "growth, promoter skin in the game, low leverage). Score is a weighted "
            "composite of 7 pillars; the probability is an indicative heuristic for a "
            "5x+ outcome over 5-10 years, not a forecast."
        ),
        "disclaimer": (
            "For information only — not investment advice. Multibagger outcomes are "
            "rare and survivorship-biased; most stocks that look like this do not 10x. "
            "Verify fundamentals from filings before acting."
        ),
    }
