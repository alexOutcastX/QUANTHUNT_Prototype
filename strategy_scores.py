"""Per-strategy scorecard for a single symbol — how well a stock fits each of
the strategies the app screens with (Minervini, momentum, breakout, candlestick,
plus the fundamental pillars: growth, free cash flow, low debt, value, and the
blended multibagger score). Shown identically in every detail popup so the user
can see which strategies a stock passes rather than one opaque verdict.

`build_scores` is pure-Python (no pandas) so it is unit-tested; `analyse` wires
in the live multibagger pillars + scan technicals."""
import logging

log = logging.getLogger("strategy_scores")


def _clamp(v):
    return None if v is None else max(0, min(100, round(v)))


def build_scores(pillars, mb_score, tech):
    """pillars: {pillar_key: 0-100 or None} from multibagger.score.
    mb_score: overall multibagger score. tech: scan row dict (or None).
    Returns an ordered list of {id, name, score, pass, note}."""
    t = tech or {}
    p = pillars or {}
    out = []

    def add(sid, name, score, note):
        sc = _clamp(score)
        out.append({"id": sid, "name": name, "score": sc,
                    "pass": bool(sc is not None and sc >= 70), "note": note})

    # ── Technical strategies (from the scan) ──
    r = t.get("minervini_rules")
    add("minervini", "Minervini Trend Template",
        None if r is None else r / 9 * 100,
        f"{r}/9 template rules pass" if r is not None else "no data")

    parts = []
    for k in ("d50", "d150", "d200"):
        v = t.get(k)
        if v is not None:
            parts.append(75 if v > 0 else 25)
    rsi = t.get("rsi")
    if rsi is not None:
        parts.append(max(0, min(100, (rsi - 30) / 40 * 100)))  # 30→0, 70→100
    r6 = t.get("ret_6m")
    if r6 is not None:
        parts.append(max(0, min(100, 50 + r6)))
    add("momentum", "Momentum leaders",
        (sum(parts) / len(parts)) if parts else None,
        "trend vs 50/150/200-DMA + RSI + 6-month return")

    pfh = t.get("pct_from_high")  # negative = below the 52w high
    b = None
    if pfh is not None:
        b = 100 + pfh * 4  # at the high → 100, -25% → 0
        if t.get("new_high_52w"):
            b += 10
        if t.get("cs_bullish"):
            b += 8
    add("breakout", "Breakout / near-highs", b,
        "proximity to 52-week high + fresh high + bullish candle")

    cs = None
    if t.get("cs_bullish"):
        cs = 78
    elif t.get("cs_bearish"):
        cs = 25
    elif t.get("rsi") is not None:
        cs = 50
    add("candles", "Candlestick signal", cs, "latest-bar candlestick bias")

    # ── Fundamental strategies (from the multibagger pillars) ──
    add("growth", "Growth compounder", p.get("growth"), "profit (PAT) + revenue growth")
    add("cashflow", "Free-cash-flow quality", p.get("cashflow"), "real free cash flow vs market cap")
    add("leverage", "Low debt / balance", p.get("leverage"), "debt & borrowings + liquidity")
    add("value", "Value (GARP)", p.get("valuation"), "PEG / P-E vs growth rate")
    add("multibagger", "Multibagger score", mb_score, "blended long-term quality")

    return out


def analyse(symbol):
    """Fetch the live inputs (multibagger pillars + scan technicals) and score."""
    pillars, mb_score, tech = {}, None, None
    try:
        import multibagger as mb
        metrics, _ = mb.fetch_metrics(symbol, retries=2)
        rep = mb.score(metrics)
        mb_score = rep.get("score")
        pillars = {pl["key"]: pl.get("score") for pl in rep.get("pillars", [])}
    except Exception as e:
        log.debug("strategy_scores mb %s: %s", symbol, e)
    try:
        import scanner
        data = (scanner.scan([symbol]) or {}).get("data", {})
        tech = data.get(symbol) or data.get(symbol.upper())
    except Exception as e:
        log.debug("strategy_scores scan %s: %s", symbol, e)
    return {"symbol": symbol, "strategies": build_scores(pillars, mb_score, tech)}
