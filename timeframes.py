"""Multi-timeframe trade analysis: instead of one blended verdict, score a
symbol independently on every timeframe from 5-minute up to weekly, then roll
those into near→far horizon reads (intraday / short / medium / long term).

The per-timeframe scorer (`score_read`) is pure-Python so it is unit-tested
without pandas; the data fetch (`_read`, `analyse`) lazily imports yfinance/ta
and degrades gracefully to a null read when a timeframe is unavailable
(intraday history is limited and rate-limited)."""
import logging

log = logging.getLogger("timeframes")

# (yfinance interval, history period, human label) — near → far.
TIMEFRAMES = [
    ("5m",  "5d",  "5-minute"),
    ("15m", "1mo", "15-minute"),
    ("60m", "3mo", "1-hour"),
    ("1d",  "1y",  "Daily"),
    ("1wk", "5y",  "Weekly"),
]

# Which timeframes inform each near→far horizon.
HORIZONS = [
    ("intraday", "Intraday",            ("5m", "15m", "60m")),
    ("short",    "Short term · days",   ("60m", "1d")),
    ("medium",   "Medium term · weeks", ("1d", "1wk")),
    ("long",     "Long term · months",  ("1wk",)),
]


def score_read(price, ema20, ema50, rsi, macd):
    """0-100 bull/bear score + bias label for one timeframe from four inputs.
    Pure-Python (no pandas) so it can be unit-tested. Each of four checks moves
    the score 12.5 points off neutral (50): price vs EMA20, EMA20 vs EMA50,
    RSI zone, MACD-histogram sign."""
    bull = bear = 0
    if price is not None and ema20 is not None:
        (bull, bear) = (bull + 1, bear) if price > ema20 else (bull, bear + 1)
    if ema20 is not None and ema50 is not None:
        (bull, bear) = (bull + 1, bear) if ema20 > ema50 else (bull, bear + 1)
    if rsi is not None:
        if rsi >= 55:
            bull += 1
        elif rsi <= 45:
            bear += 1
    if macd is not None:
        (bull, bear) = (bull + 1, bear) if macd > 0 else (bull, bear + 1)
    score = max(0, min(100, round(50 + (bull - bear) * 12.5)))
    bias = "bullish" if score >= 60 else "bearish" if score <= 40 else "neutral"
    return score, bias


def rating_of(score):
    """Map a 0-100 timeframe score to a trade rating label. Pure/unit-tested."""
    if score is None:
        return "n/a"
    if score >= 80:
        return "Strong Buy"
    if score >= 60:
        return "Buy"
    if score > 40:
        return "Neutral"
    if score > 20:
        return "Weak"
    return "Avoid"


def _levels(highs, lows, price):
    """Swing-pivot support/resistance + Fibonacci retracement for one interval.
    Pure over plain lists (unit-tested). `highs`/`lows` are the interval's bar
    highs/lows, `price` the last close. Returns supports (nearest-first, below
    price), resistances (above), fib retracement levels of the swing, and the
    swing hi/lo."""
    n = min(len(highs), len(lows))
    if n < 10 or price is None:
        return {}
    k = 3  # fractal half-window
    piv_hi, piv_lo = [], []
    for i in range(k, n - k):
        if highs[i] == max(highs[i - k:i + k + 1]):
            piv_hi.append(highs[i])
        if lows[i] == min(lows[i - k:i + k + 1]):
            piv_lo.append(lows[i])
    pivots = piv_hi + piv_lo
    below = sorted({round(p, 2) for p in pivots if p < price}, key=lambda x: price - x)[:3]
    above = sorted({round(p, 2) for p in pivots if p > price}, key=lambda x: x - price)[:3]
    hi, lo = max(highs[:n]), min(lows[:n])
    rng = hi - lo
    fib = {}
    if rng > 0:
        for r in (0.236, 0.382, 0.5, 0.618, 0.786):
            fib[str(r)] = round(hi - r * rng, 2)   # retracement down from swing high
    return {
        "supports": below,
        "resistances": above,
        "fib": fib,
        "swing_hi": round(hi, 2),
        "swing_lo": round(lo, 2),
    }


def _read(df):
    """Compute the score inputs for one interval's OHLC frame (needs pandas/ta)."""
    try:
        import math
        import ta
    except Exception:
        return None
    close = df["Close"].dropna()
    if len(close) < 20:
        return None
    price = float(close.iloc[-1])
    ema20 = float(close.ewm(span=20, adjust=False).mean().iloc[-1])
    ema50 = float(close.ewm(span=50, adjust=False).mean().iloc[-1]) if len(close) >= 50 else ema20
    try:
        rsi = float(ta.momentum.rsi(close, window=14).iloc[-1])
        if math.isnan(rsi):
            rsi = None
    except Exception:
        rsi = None
    try:
        macd = float(ta.trend.MACD(close).macd_diff().iloc[-1])
        if math.isnan(macd):
            macd = None
    except Exception:
        macd = None
    score, bias = score_read(price, ema20, ema50, rsi, macd)
    try:
        levels = _levels(df["High"].dropna().tolist(), df["Low"].dropna().tolist(), price)
    except Exception:
        levels = {}
    return {
        "price": round(price, 2),
        "rsi": round(rsi, 1) if rsi is not None else None,
        "macd": round(macd, 3) if macd is not None else None,
        "vs_ema20": round((price / ema20 - 1) * 100, 2) if ema20 else None,
        "vs_ema50": round((price / ema50 - 1) * 100, 2) if ema50 else None,
        "score": score,
        "bias": bias,
        "rating": rating_of(score),
        **levels,
    }


def analyse(symbol, suffix=".NS"):
    """Return a per-timeframe + per-horizon read for `symbol`. Never raises;
    unavailable timeframes come back with score=None / bias='n/a'."""
    try:
        import yfinance as yf
    except Exception:
        return {"symbol": symbol, "timeframes": [], "horizons": [], "error": "engine unavailable"}

    tfs = []
    for interval, period, label in TIMEFRAMES:
        row = None
        try:
            df = yf.Ticker(f"{symbol}{suffix}").history(period=period, interval=interval, auto_adjust=True)
            if df is not None and not df.empty:
                row = _read(df)
        except Exception as e:
            log.debug("timeframe %s %s failed: %s", symbol, interval, e)
        tfs.append({"tf": interval, "label": label, **(row or {"score": None, "bias": "n/a"})})

    by_tf = {t["tf"]: t for t in tfs}

    def avg(keys):
        xs = [by_tf[k]["score"] for k in keys if by_tf.get(k) and by_tf[k].get("score") is not None]
        return round(sum(xs) / len(xs)) if xs else None

    horizons = []
    for key, label, keys in HORIZONS:
        sc = avg(keys)
        bias = "n/a" if sc is None else "bullish" if sc >= 60 else "bearish" if sc <= 40 else "neutral"
        horizons.append({"key": key, "label": label, "score": sc, "bias": bias,
                         "from": [by_tf[k]["label"] for k in keys if by_tf.get(k)]})

    # Overall: all timeframes count, but weight the higher (less noisy) ones more.
    weights = {"5m": 1, "15m": 1, "60m": 2, "1d": 3, "1wk": 3}
    num = den = 0
    for t in tfs:
        s = t.get("score")
        if s is not None:
            w = weights.get(t["tf"], 1)
            num += s * w
            den += w
    overall = round(num / den) if den else None
    overall_bias = ("n/a" if overall is None else "bullish" if overall >= 60
                    else "bearish" if overall <= 40 else "neutral")

    return {"symbol": symbol, "timeframes": tfs, "horizons": horizons,
            "overall": {"score": overall, "bias": overall_bias, "rating": rating_of(overall)}}
