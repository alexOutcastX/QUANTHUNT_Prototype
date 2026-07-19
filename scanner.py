"""
Live technical scanner for the Screener.

Computes, per symbol, the technical fields the Screener filters on — straight
from yfinance daily history (no synthetic/demo data). Results are cached in
memory with a short TTL so repeated screens over the same symbols are cheap.

Fields returned per symbol (all best-effort; missing → null):
  price, prevClose, chg, absChg, volume, avgvol, relvol,
  d9, d20, d50, d200            (% distance of price from the SMA),
  rsi, macd, willr, bollb,
  high52, low52, pct_from_high, pct_from_low,
  beta,                          (vs NIFTY 50, 1y daily returns)
  sqzOn, sqzFire, sqzMom,        (TTM squeeze)
  s1, s2, s3, r1, r2, r3,        (classic floor-trader pivots)
  cam_h3, cam_h4, cam_l3, cam_l4,(Camarilla levels from the previous bar)
  golden_cross, death_cross,     (50-DMA crossed the 200-DMA on the latest bar)
  cross_20_50_up, cross_20_50_down,
  macd_bull_cross, macd_bear_cross,
  gap_up, gap_down,              (open vs previous bar's high/low)
  new_high_52w, new_low_52w,     (fresh 52-week extreme on the latest bar)
  volume_spike,                  (volume >= 2.5x the 20-day average)
  cam_break_up, cam_break_down   (close beyond the Camarilla H4/L4 level)
"""
import math
import threading
import time

_CACHE = {}          # sym -> (ts, row|None)
_CACHE_LOCK = threading.Lock()
_TTL = 300           # 5 minutes for a good row
# A failed row (None) previously stuck for the full 5 minutes, so one transient
# Yahoo blip dropped the symbol from the screener for that long. Retry failures
# much sooner (but not every request, to avoid hammering a genuinely dead sym).
_NEG_TTL = 45

# Cached NIFTY 50 daily returns for beta (index -> (ts, pandas.Series))
_IDX_CACHE = {"ts": 0.0, "ret": None}
_IDX_TTL = 900


def _num(v, nd=2):
    try:
        if v is None:
            return None
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, nd)
    except (TypeError, ValueError):
        return None


def _sma(series, n):
    return series.rolling(n).mean()


def _index_returns():
    """NIFTY 50 daily pct returns, cached, for beta."""
    now = time.time()
    if _IDX_CACHE["ret"] is not None and (now - _IDX_CACHE["ts"]) < _IDX_TTL:
        return _IDX_CACHE["ret"]
    import ydata
    df = ydata.history("^NSEI", "1y", "1d")
    ret = df["Close"].pct_change().dropna() if df is not None and not df.empty else None
    if ret is not None:
        _IDX_CACHE["ts"] = now
        _IDX_CACHE["ret"] = ret
        return ret
    # Upstream failed — keep the last-good returns rather than caching None for
    # 15 minutes (which zeroed out beta across the whole scan).
    return _IDX_CACHE["ret"]


def _beta(close, idx_ret):
    if idx_ret is None or close is None or len(close) < 30:
        return None
    try:
        import pandas as pd
        stock_ret = close.pct_change().dropna()
        joined = pd.concat([stock_ret, idx_ret], axis=1, join="inner").dropna()
        if len(joined) < 30:
            return None
        a = joined.iloc[:, 0]
        b = joined.iloc[:, 1]
        var = b.var()
        if not var or math.isnan(var):
            return None
        return round(float(a.cov(b) / var), 2)
    except Exception:
        return None


def _compute_row(sym, idx_ret, suffix=".NS"):
    """Compute the technical snapshot for one symbol. Returns dict or None.
    `suffix` selects the exchange feed (".NS" NSE, ".BO" BSE-only listings)."""
    try:
        import ta
        import ydata
    except Exception:
        return None

    yf_sym = sym if sym.startswith("^") else f"{sym}{suffix}"
    # Route through ydata so the 8-worker scan fan-out shares the global outbound
    # Yahoo cap + rate-limit backoff with every other endpoint.
    df = ydata.history(yf_sym, "1y", "1d")
    if df is None or df.empty or len(df) < 20:
        return None

    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    price = float(close.iloc[-1])
    prev = float(close.iloc[-2]) if len(close) > 1 else price

    def dist(ma):
        v = ma.iloc[-1]
        if v is None or math.isnan(v) or v == 0:
            return None
        return round((price / float(v) - 1) * 100, 2)

    # RSI / MACD / Williams %R / Bollinger %B
    rsi = ta.momentum.rsi(close, window=14)
    macd_obj = ta.trend.MACD(close)
    macd_hist = macd_obj.macd_diff()
    willr = ta.momentum.williams_r(high, low, close, lbp=14)
    bb = ta.volatility.BollingerBands(close, window=20, window_dev=2)
    bb_h, bb_l = bb.bollinger_hband(), bb.bollinger_lband()
    bollb = None
    try:
        span = float(bb_h.iloc[-1]) - float(bb_l.iloc[-1])
        if span and not math.isnan(span):
            bollb = round((price - float(bb_l.iloc[-1])) / span, 3)
    except (TypeError, ValueError):
        bollb = None

    # Volume
    avgvol = float(vol.rolling(20).mean().iloc[-1]) if len(vol) >= 20 else float(vol.mean())
    volume = float(vol.iloc[-1]) if not math.isnan(vol.iloc[-1]) else 0.0
    relvol = round(volume / avgvol, 2) if avgvol else None

    # 52-week high / low (bounded to available bars)
    win = min(252, len(close))
    high52 = float(high.rolling(win).max().iloc[-1])
    low52 = float(low.rolling(win).min().iloc[-1])
    pct_from_high = round((price - high52) / high52 * 100, 2) if high52 else None
    pct_from_low = round((price - low52) / low52 * 100, 2) if low52 else None

    # TTM squeeze: BB(20,2) inside Keltner(20, 1.5*ATR)
    sqz_on = sqz_fire = None
    sqz_mom = None
    try:
        atr = ta.volatility.average_true_range(high, low, close, window=20)
        kc_mid = _sma(close, 20)
        kc_up = kc_mid + 1.5 * atr
        kc_lo = kc_mid - 1.5 * atr

        def _sqz(i):
            bh, bl = bb_h.iloc[i], bb_l.iloc[i]
            ku, kl = kc_up.iloc[i], kc_lo.iloc[i]
            if any(math.isnan(x) for x in (bh, bl, ku, kl)):
                return None
            return bool(bh < ku and bl > kl)

        sqz_on = _sqz(-1)
        prev_sqz = _sqz(-2) if len(close) > 21 else None
        sqz_fire = bool(prev_sqz and sqz_on is False)
        if not math.isnan(kc_mid.iloc[-1]):
            sqz_mom = round(price - float(kc_mid.iloc[-1]), 2)
    except Exception:
        pass

    # ── True cross/event detection on the latest bar ──
    def _cross_up(a, b):
        """a crossed above b between the previous and latest bar (None = n/a)."""
        try:
            a0, a1 = float(a.iloc[-2]), float(a.iloc[-1])
            b0, b1 = float(b.iloc[-2]), float(b.iloc[-1])
            if any(math.isnan(x) for x in (a0, a1, b0, b1)):
                return None
            return bool(a0 <= b0 and a1 > b1)
        except (IndexError, TypeError, ValueError):
            return None

    sma20, sma50, sma200 = _sma(close, 20), _sma(close, 50), _sma(close, 200)
    golden_cross = _cross_up(sma50, sma200)
    death_cross = _cross_up(sma200, sma50)
    cross_20_50_up = _cross_up(sma20, sma50)
    cross_20_50_down = _cross_up(sma50, sma20)

    # MACD histogram sign flip = MACD line crossing its signal line
    macd_bull_cross = macd_bear_cross = None
    try:
        h0, h1 = float(macd_hist.iloc[-2]), float(macd_hist.iloc[-1])
        if not (math.isnan(h0) or math.isnan(h1)):
            macd_bull_cross = bool(h0 <= 0 < h1)
            macd_bear_cross = bool(h0 >= 0 > h1)
    except (IndexError, TypeError, ValueError):
        pass

    # Gaps: latest open vs the previous bar's range
    gap_up = gap_down = None
    try:
        o1 = float(df["Open"].iloc[-1])
        ph, pl = float(high.iloc[-2]), float(low.iloc[-2])
        if not any(math.isnan(x) for x in (o1, ph, pl)):
            gap_up = bool(o1 > ph)
            gap_down = bool(o1 < pl)
    except (IndexError, KeyError, TypeError, ValueError):
        pass

    # Fresh 52-week extremes: latest bar beats every prior bar in the window
    new_high_52w = new_low_52w = None
    if win > 2:
        try:
            prior_hi = float(high.iloc[-win:-1].max())
            prior_lo = float(low.iloc[-win:-1].min())
            new_high_52w = bool(float(high.iloc[-1]) > prior_hi)
            new_low_52w = bool(float(low.iloc[-1]) < prior_lo)
        except (TypeError, ValueError):
            pass

    volume_spike = bool(avgvol and volume >= 2.5 * avgvol) if avgvol else None

    # Classic floor-trader pivots from the last completed bar
    H, L, C = float(high.iloc[-1]), float(low.iloc[-1]), price
    P = (H + L + C) / 3
    s1, s2, s3 = 2 * P - H, P - (H - L), L - 2 * (H - P)
    r1, r2, r3 = 2 * P - L, P + (H - L), H + 2 * (P - L)

    # Camarilla levels from the PREVIOUS completed bar (standard practice:
    # today's trading levels derive from yesterday's OHLC — and it means the
    # break flags below can actually fire when today's close escapes the band).
    if len(close) >= 2:
        pH, pL, pC = float(high.iloc[-2]), float(low.iloc[-2]), float(close.iloc[-2])
    else:
        pH, pL, pC = H, L, C
    cam_h4 = pC + (pH - pL) * 1.1 / 2
    cam_h3 = pC + (pH - pL) * 1.1 / 4
    cam_l3 = pC - (pH - pL) * 1.1 / 4
    cam_l4 = pC - (pH - pL) * 1.1 / 2

    return {
        "price": round(price, 2),
        "prevClose": round(prev, 2),
        "chg": round((price / prev - 1) * 100, 2) if prev else None,
        "absChg": round(price - prev, 2),
        "volume": int(volume),
        "avgvol": int(avgvol) if avgvol else None,
        "relvol": relvol,
        "d9": dist(_sma(close, 9)),
        "d20": dist(_sma(close, 20)),
        "d50": dist(_sma(close, 50)),
        "d200": dist(_sma(close, 200)),
        "rsi": _num(rsi.iloc[-1], 1),
        "macd": _num(macd_hist.iloc[-1], 3),
        "willr": _num(willr.iloc[-1], 1),
        "bollb": bollb,
        "high52": round(high52, 2) if high52 else None,
        "low52": round(low52, 2) if low52 else None,
        "pct_from_high": pct_from_high,
        "pct_from_low": pct_from_low,
        "beta": _beta(close, idx_ret),
        "sqzOn": sqz_on,
        "sqzFire": sqz_fire,
        "sqzMom": sqz_mom,
        "s1": round(s1, 2), "s2": round(s2, 2), "s3": round(s3, 2),
        "r1": round(r1, 2), "r2": round(r2, 2), "r3": round(r3, 2),
        "cam_h3": round(cam_h3, 2), "cam_h4": round(cam_h4, 2),
        "cam_l3": round(cam_l3, 2), "cam_l4": round(cam_l4, 2),
        "golden_cross": golden_cross,
        "death_cross": death_cross,
        "cross_20_50_up": cross_20_50_up,
        "cross_20_50_down": cross_20_50_down,
        "macd_bull_cross": macd_bull_cross,
        "macd_bear_cross": macd_bear_cross,
        "gap_up": gap_up,
        "gap_down": gap_down,
        "new_high_52w": new_high_52w,
        "new_low_52w": new_low_52w,
        "volume_spike": volume_spike,
        "cam_break_up": bool(price > cam_h4),
        "cam_break_down": bool(price < cam_l4),
    }


def scan(symbols):
    """Compute (or serve cached) technical rows for a list of symbols.

    Returns {"data": {sym: row}, "count": n, "computed": k, "cached": c}.
    """
    symbols = [s.strip().upper() for s in symbols if s and s.strip()][:60]
    now = time.time()
    out = {}
    todo = []

    with _CACHE_LOCK:
        for s in symbols:
            hit = _CACHE.get(s)
            if hit and hit[1] is not None and (now - hit[0]) < _TTL:
                out[s] = hit[1]                       # good row within its TTL
            elif hit and hit[1] is None and (now - hit[0]) < _NEG_TTL:
                pass                                  # failed recently — brief cool-off, don't recompute yet
            else:
                todo.append(s)

    cached_n = len(out)
    if todo:
        idx_ret = _index_returns()
        from concurrent.futures import ThreadPoolExecutor, as_completed
        results = {}
        with ThreadPoolExecutor(max_workers=8) as ex:
            futs = {ex.submit(_compute_row, s, idx_ret): s for s in todo}
            for f in as_completed(futs):
                s = futs[f]
                try:
                    results[s] = f.result()
                except Exception:
                    results[s] = None
        stamp = time.time()
        with _CACHE_LOCK:
            for s, row in results.items():
                _CACHE[s] = (stamp, row)
                if row is not None:
                    out[s] = row

    return {"data": out, "count": len(out), "computed": len(todo), "cached": cached_n}
