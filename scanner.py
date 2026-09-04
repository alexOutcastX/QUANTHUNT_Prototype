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
import atexit
import json
import math
import os
import queue
import threading
import time
from concurrent.futures import ThreadPoolExecutor

_CACHE = {}          # sym -> (ts, row|None)
_CACHE_LOCK = threading.Lock()

# ── Why this module looks like fundamentals.py now ───────────────────────────
# It didn't, and that was the whole problem. fundamentals.py keeps a disk cache
# that survives restarts and answers bulk() from it IMMEDIATELY, returning a
# `pending` list for whatever is still warming. This module kept everything in
# memory and blocked the request until every uncached symbol had been computed.
#
# Two consequences, both visible on a wide universe:
#
#   • Every deploy wiped the technicals. gunicorn restarts, _CACHE is empty, and
#     the next visitor pays a cold sweep of the entire universe — which is
#     1447 upstream history fetches through a process-wide 4-wide semaphore, so
#     minutes at best. The financials beside them came straight off disk.
#   • A blocking scan cannot degrade. With 60 symbols a call the client had to
#     make 121 round trips for ALL MARKETS and wait out the slowest upstream
#     fetch in each one, while the same semaphore was being shared with the
#     warm loop and the fundamentals sweep.
#
# So: the cache is now durable, reads never block on the network, and a row
# that is merely stale is served now and refreshed behind the response.
_DIR = os.path.dirname(os.path.abspath(__file__))
_FILE = os.environ.get("SCAN_CACHE_FILE") or os.path.join(_DIR, "scan_cache.json")

# Compute pool for background refills. Sized to the upstream semaphore in
# ydata (4 by default) — more threads here would not buy any more concurrency,
# it would only take workers away from serving requests.
#
# Deliberately NOT a ThreadPoolExecutor. Its threads are non-daemon and joined
# by an atexit hook, so a deep queue turns every restart into a wait for the
# backlog to drain — 1447 queued symbols at a second each is minutes of a
# gunicorn worker refusing to die, and the cache flush never runs. Daemon
# threads plus a bounded queue instead.
#
# The bound matters as much as the pool size: one visitor opening ALL MARKETS
# would otherwise queue the entire universe and park everyone else's symbols
# behind it. Over the cap, work is simply dropped — the client is polling and
# will ask again, so the queue stays a window on current demand rather than a
# transcript of every request ever made.
_POOL_SIZE = max(1, int(os.environ.get("SCAN_WORKERS", "4")))
_QUEUE_MAX = max(_POOL_SIZE, int(os.environ.get("SCAN_QUEUE_MAX", "400")))
_queue: "queue.Queue[str]" = queue.Queue(maxsize=_QUEUE_MAX)
_inflight: set = set()
_inflight_lock = threading.Lock()
_workers_started = False
_workers_lock = threading.Lock()

# Most symbols a single /scan may ask about. The old cap of 60 existed because
# every miss was computed inline; now that a miss is queued rather than waited
# on, a big request is just a big dictionary lookup.
MAX_SYMBOLS = int(os.environ.get("SCAN_MAX_SYMBOLS", "600"))

# A row past _TTL is stale but still worth showing while it refreshes — these
# are daily-bar indicators, and a fifteen-minute-old RSI beats an em-dash. Past
# this bound it is not: a technical read from a previous session would be
# actively misleading, so it is withheld and recomputed.
_STALE_MAX = int(os.environ.get("SCAN_STALE_MAX", str(12 * 3600)))
# How long a computed row stays good. Every field here is derived from DAILY
# bars — RSI, the moving-average distances, the 52-week extremes — so a row a
# few minutes old is not meaningfully different from a fresh one, while the
# recompute costs a full history fetch through a 4-wide upstream semaphore.
# Five minutes was short enough that a wide universe could never finish warming
# before the head of the list expired again; fifteen lets the warm loop hold
# ~3x the symbols for the same sustained call rate.
_TTL = int(os.environ.get("SCAN_TTL", "900"))
# A failed row (None) previously stuck for the full 5 minutes, so one transient
# Yahoo blip dropped the symbol from the screener for that long. Retry failures
# much sooner (but not every request, to avoid hammering a genuinely dead sym).
_NEG_TTL = 45

# Cached NIFTY 50 daily returns for beta (index -> (ts, pandas.Series))
_IDX_CACHE = {"ts": 0.0, "ret": None}
_IDX_TTL = 900


def _load() -> None:
    """Pull the last-good rows off disk. Best-effort: a missing or corrupt file
    just means a cold start, which is what every start used to be."""
    try:
        with open(_FILE) as f:
            disk = json.load(f)
    except Exception:
        return
    now = time.time()
    kept = 0
    with _CACHE_LOCK:
        for sym, e in (disk.get("rows") or {}).items():
            try:
                ts, row = float(e["ts"]), e.get("row")
            except Exception:
                continue
            # Only rows still worth serving. A failed row (None) is never
            # persisted as a negative — it would outlive its 45s cool-off.
            if row is not None and (now - ts) < _STALE_MAX:
                _CACHE[sym] = (ts, row)
                kept += 1
    if kept:
        import logging
        logging.getLogger("quanthunt.scanner").info(
            "Scan cache: %d rows restored from disk", kept)


def _save() -> None:
    """Write the cache out atomically, so a kill mid-write can't leave a
    truncated file that _load then silently discards."""
    now = time.time()
    with _CACHE_LOCK:
        rows = {s: {"ts": ts, "row": row}
                for s, (ts, row) in _CACHE.items()
                if row is not None and (now - ts) < _STALE_MAX}
    if not rows:
        return
    tmp = _FILE + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump({"rows": rows}, f)
        os.replace(tmp, _FILE)
    except Exception:
        try:
            os.unlink(tmp)
        except Exception:
            pass


_SAVE_EVERY = int(os.environ.get("SCAN_SAVE_SEC", "120"))


def _saver_loop() -> None:
    while True:
        time.sleep(_SAVE_EVERY)
        try:
            _save()
        except Exception:
            pass


def start_persistence() -> None:
    """Restore the cache and keep flushing it. Called once at import."""
    _load()
    threading.Thread(target=_saver_loop, daemon=True, name="scan-saver").start()
    atexit.register(_save)


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


# ── moving-average pair gaps, for the "near a crossover" scan ───────────────
#
# The pairs a trend trader watches, fast first. 9/20 is the short-term turn,
# 20/50 the swing turn, 50/100 the intermediate, 50/200 the golden/death cross.
MA_PAIRS = ((9, 20), (20, 50), (50, 100), (50, 200))

# How far back the "was it wider then?" reading looks. A week of sessions is
# long enough to show a trend and short enough that a single day's noise does
# not decide it.
MA_GAP_LOOKBACK = 5

# How many sessions of gap history the volatility is measured over. A month of
# them: enough for the number to mean something, short enough to describe how
# the pair is behaving now rather than last quarter.
MA_GAP_VOL_WINDOW = 21


def ma_gap(fast, slow):
    """The fast average's distance from the slow one, in percent.

    Signed: negative means the fast average is below the slow one, so a cross
    from here would be upward. None when either value is missing or the slow
    average is zero — never a fabricated 0.
    """
    if fast is None or slow is None:
        return None
    try:
        f, sl = float(fast), float(slow)
    except (TypeError, ValueError):
        return None
    if sl == 0 or f != f or sl != sl:          # NaN-safe
        return None
    return round((f / sl - 1) * 100, 3)


def ma_gap_sigma(fast, slow, window=MA_GAP_VOL_WINDOW):
    """How much the gap between two averages moves in a session, in points.

    The standard deviation of the DAILY CHANGE in the gap, not of the gap
    itself — the question a probability has to answer is how far this thing
    travels in a day, not how wide it has been.

    Without it a converging pair can only be extrapolated in a straight line,
    which says a gap closing at 0.1 points a session is certain to touch in
    five. It is not: the same drift with a jumpy gap may cross tomorrow or
    wander for a month, and those are the two cases a reader needs told apart.
    """
    try:
        gaps = (fast / slow - 1.0) * 100.0
        deltas = gaps.diff().tail(window).dropna()
        if len(deltas) < 5:
            return None
        v = float(deltas.std())
    except (TypeError, ValueError, ZeroDivisionError, AttributeError):
        return None
    if v != v or v in (float("inf"), float("-inf")) or v < 0:
        return None
    return round(v, 4)


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


def _candle_parts(o, h, l, c):
    body = abs(c - o)
    rng = (h - l) or 1e-9
    upper = h - max(o, c)
    lower = min(o, c) - l
    return body, rng, upper, lower


def candlesticks(o, h, l, c):
    """Detect the common candlestick patterns on the LAST bar of the OHLC
    sequences (chronological lists of floats). Pure-Python so it is unit-tested
    without pandas. Returns a dict of boolean flags plus cs_bullish/cs_bearish
    roll-ups. Mirrors the classic single/two/three-bar definitions."""
    keys = ("cs_doji", "cs_hammer", "cs_shooting_star", "cs_bull_engulf",
            "cs_bear_engulf", "cs_piercing", "cs_dark_cloud", "cs_morning_star",
            "cs_evening_star", "cs_three_white", "cs_three_black")
    f = {k: False for k in keys}
    n = min(len(o), len(h), len(l), len(c))
    if n < 1:
        f["cs_bullish"] = f["cs_bearish"] = False
        return f
    o1, h1, l1, c1 = float(o[-1]), float(h[-1]), float(l[-1]), float(c[-1])
    body1, rng1, up1, lo1 = _candle_parts(o1, h1, l1, c1)
    f["cs_doji"] = body1 <= 0.1 * rng1
    f["cs_hammer"] = body1 > 0 and lo1 >= 2 * body1 and up1 <= body1
    f["cs_shooting_star"] = body1 > 0 and up1 >= 2 * body1 and lo1 <= body1
    if n >= 2:
        o0, c0 = float(o[-2]), float(c[-2])
        body0 = abs(c0 - o0)
        prev_bear, prev_bull = c0 < o0, c0 > o0
        cur_bull, cur_bear = c1 > o1, c1 < o1
        mid0 = (o0 + c0) / 2
        f["cs_bull_engulf"] = prev_bear and cur_bull and c1 >= o0 and o1 <= c0 and body1 > body0
        f["cs_bear_engulf"] = prev_bull and cur_bear and o1 >= c0 and c1 <= o0 and body1 > body0
        f["cs_piercing"] = prev_bear and cur_bull and o1 < c0 and mid0 < c1 < o0
        f["cs_dark_cloud"] = prev_bull and cur_bear and o1 > c0 and o0 < c1 < mid0
    if n >= 3:
        o2, c2 = float(o[-3]), float(c[-3])
        body2 = abs(c2 - o2)
        small_mid = body2 > 0 and abs(float(c[-2]) - float(o[-2])) <= 0.5 * body2
        mid2 = (o2 + c2) / 2
        f["cs_morning_star"] = c2 < o2 and small_mid and c1 > o1 and c1 > mid2
        f["cs_evening_star"] = c2 > o2 and small_mid and c1 < o1 and c1 < mid2
        c_2 = float(c[-2])
        f["cs_three_white"] = (c2 > o2 and c_2 > float(o[-2]) and c1 > o1 and c_2 > c2 and c1 > c_2)
        f["cs_three_black"] = (c2 < o2 and c_2 < float(o[-2]) and c1 < o1 and c_2 < c2 and c1 < c_2)
    f["cs_bullish"] = any(f[k] for k in ("cs_hammer", "cs_bull_engulf", "cs_piercing", "cs_morning_star", "cs_three_white"))
    f["cs_bearish"] = any(f[k] for k in ("cs_shooting_star", "cs_bear_engulf", "cs_dark_cloud", "cs_evening_star", "cs_three_black"))
    return f


def minervini(price, sma50, sma150, sma200, sma200_prev, pct_from_low, pct_from_high, rs_positive):
    """Mark Minervini's Trend Template. Returns (all_pass, rules_passed_count).
    `rs_positive` is a relative-strength proxy (6-month return positive) standing
    in for the IBD RS-rating ≥ 70 rule, which needs a full-universe ranking."""
    def gt(a, b):
        return a is not None and b is not None and a > b
    rules = [
        gt(price, sma150),                                   # 1 price > 150-DMA
        gt(price, sma200),                                   # 2 price > 200-DMA
        gt(sma150, sma200),                                  # 3 150-DMA > 200-DMA
        gt(sma200, sma200_prev),                             # 4 200-DMA rising
        gt(sma50, sma150) and gt(sma150, sma200),            # 5 50 > 150 > 200
        gt(price, sma50),                                    # 6 price > 50-DMA
        pct_from_low is not None and pct_from_low >= 30,     # 7 ≥30% above 52w low
        pct_from_high is not None and pct_from_high >= -25,  # 8 within 25% of high
        bool(rs_positive),                                   # 9 relative strength
    ]
    passed = sum(1 for r in rules if r)
    return all(rules), passed


def _compute_row(sym, idx_ret, suffix=".NS"):
    """Compute the technical snapshot for one symbol. Returns dict or None.
    `suffix` selects the exchange feed (".NS" NSE, ".BO" BSE-only listings)."""
    try:
        import ydata
    except Exception:
        return None

    yf_sym = sym if sym.startswith("^") else f"{sym}{suffix}"
    # Route through ydata so the 8-worker scan fan-out shares the global outbound
    # Yahoo cap + rate-limit backoff with every other endpoint.
    df = ydata.history(yf_sym, "1y", "1d")
    return row_from_frame(df, idx_ret)


def row_from_frame(df, idx_ret=None):
    """The technical snapshot for an OHLCV frame — every value read off the LAST
    bar of whatever frame it is handed. Split out from _compute_row so a
    historical replay can pass df.iloc[:i] and get the snapshot exactly as it
    stood on that day, with no knowledge of later bars. Returns None when the
    frame is too short to compute anything meaningful."""
    try:
        import ta
    except Exception:
        return None
    if df is None or df.empty or len(df) < 20:
        return None

    # A feed appends a bar for the session in progress before it has traded —
    # sometimes carrying a volume but no close — and EVERY number below is read
    # off the last bar. So one placeholder does not cost one field, it costs the
    # whole row: price, the distance from all six averages, the 52-week
    # extremes, the change, Williams %R, %B, the pivots and the returns all come
    # back empty. And because the placeholder appears on every symbol at once,
    # it empties the universe at once — a screener with nothing to screen on.
    #
    # Trim it. The last bar that actually has a close IS the latest close; there
    # is nothing to compute from a bar that has not happened yet.
    valid = df["Close"].notna().to_numpy().nonzero()[0]
    if len(valid) == 0:
        return None
    if valid[-1] != len(df) - 1:
        df = df.iloc[:valid[-1] + 1]
        if len(df) < 20:
            return None

    close, high, low, vol = df["Close"], df["High"], df["Low"], df["Volume"]
    price = float(close.iloc[-1])
    # Belt and braces after the trim: a row priced at NaN is not a row with one
    # bad field, it is a row where nothing downstream means anything.
    if not math.isfinite(price):
        return None
    # A NaN previous close is the one that got out: `chg` and `absChg` are
    # derived from it, and NaN propagates silently through arithmetic.
    prev = (_num(close.iloc[-2], 6) if len(close) > 1 else price)
    if prev is None:
        prev = price

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
    # _num, not float: a rolling max over a window that is all-NaN is NaN, and
    # `if high52` is true for NaN, so the percentages below inherited it and the
    # row went out with NaN in five fields.
    high52 = _num(high.rolling(win).max().iloc[-1])
    low52 = _num(low.rolling(win).min().iloc[-1])
    pct_from_high = round((price - high52) / high52 * 100, 2) if high52 else None
    pct_from_low = round((price - low52) / low52 * 100, 2) if low52 else None

    # Trailing % returns over a trading week (~5 bars) and month (~21 bars) — the
    # true higher-timeframe momentum, so the radar can screen "daily strong but
    # weekly/monthly weak" exactly rather than by a 200-DMA proxy.
    def _ret_n(n):
        if len(close) > n:
            base = float(close.iloc[-(n + 1)])
            return round((price / base - 1) * 100, 2) if base else None
        return None

    ret_1w = _ret_n(5)
    ret_1m = _ret_n(21)

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
        pH, pL, pC = (_num(high.iloc[-2], 6), _num(low.iloc[-2], 6),
                      _num(close.iloc[-2], 6))
    else:
        pH, pL, pC = H, L, C
    # Same bar, same failure: fall back to today's rather than emit NaN levels.
    if pH is None or pL is None or pC is None:
        pH, pL, pC = H, L, C
    cam_h4 = pC + (pH - pL) * 1.1 / 2
    cam_h3 = pC + (pH - pL) * 1.1 / 4
    cam_l3 = pC - (pH - pL) * 1.1 / 4
    cam_l4 = pC - (pH - pL) * 1.1 / 2

    # ── Minervini Trend Template + a relative-strength proxy ──
    sma150 = _sma(close, 150)

    def _last(s, i=-1):
        try:
            v = float(s.iloc[i])
            return None if math.isnan(v) else v
        except (IndexError, TypeError, ValueError):
            return None

    sma9, sma100 = _sma(close, 9), _sma(close, 100)

    # A small gap on its own does not mean two averages are converging — they
    # may have just crossed and be separating. So each pair reports the gap now
    # AND the gap a week ago; the pair of numbers is what lets the client say
    # "closing" rather than merely "close".
    _series = {9: sma9, 20: sma20, 50: sma50, 100: sma100, 200: sma200}
    back = -1 - MA_GAP_LOOKBACK
    ma_gaps = {}
    for _f, _sl in MA_PAIRS:
        now = ma_gap(_last(_series[_f]), _last(_series[_sl]))
        then = (ma_gap(_last(_series[_f], back), _last(_series[_sl], back))
                if len(close) > MA_GAP_LOOKBACK + 1 else None)
        if now is not None:
            # [gap now, gap a week ago, how far the gap moves in a session].
            # The third is what turns "closing at this rate" into a probability
            # instead of a straight line drawn to zero.
            ma_gaps[f"{_f}_{_sl}"] = [now, then,
                                      ma_gap_sigma(_series[_f], _series[_sl])]

    v50, v150, v200 = _last(sma50), _last(sma150), _last(sma200)
    v200_prev = _last(sma200, -21) if len(close) > 21 else None
    dma200_rising = bool(v200 is not None and v200_prev is not None and v200 > v200_prev)
    ret_6m = None
    if len(close) > 126:
        base = float(close.iloc[-127])
        if base > 0:
            ret_6m = round((price / base - 1) * 100, 2)
    rs_positive = ret_6m is not None and ret_6m > 0
    mnv_all, mnv_passed = minervini(price, v50, v150, v200, v200_prev, pct_from_low, pct_from_high, rs_positive)

    # ── Candlestick patterns on the latest bar ──
    cs = candlesticks(list(df["Open"]), list(high), list(low), list(close))

    return {
        "price": round(price, 2),
        "prevClose": round(prev, 2),
        "chg": round((price / prev - 1) * 100, 2) if prev else None,
        "absChg": round(price - prev, 2),
        "volume": int(volume),
        "avgvol": int(avgvol) if avgvol and math.isfinite(avgvol) else None,
        "relvol": relvol,
        "d9": dist(_sma(close, 9)),
        "d20": dist(_sma(close, 20)),
        "d50": dist(_sma(close, 50)),
        "d100": dist(sma100),
        "d150": dist(sma150),
        "d200": dist(_sma(close, 200)),
        "rsi": _num(rsi.iloc[-1], 1),
        "macd": _num(macd_hist.iloc[-1], 3),
        "willr": _num(willr.iloc[-1], 1),
        "bollb": bollb,
        "high52": round(high52, 2) if high52 else None,
        "low52": round(low52, 2) if low52 else None,
        "pct_from_high": pct_from_high,
        "pct_from_low": pct_from_low,
        "ret_1w": ret_1w,
        "ret_1m": ret_1m,
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
        # Minervini Trend Template + relative strength
        "dma200_rising": dma200_rising,
        "ret_6m": ret_6m,
        "minervini": bool(mnv_all),
        "minervini_rules": mnv_passed,
        # {"9_20": [gap now %, gap 5 ago %, daily sigma], ...} — see MA_PAIRS.
        "ma_gaps": ma_gaps,
        # Candlestick patterns on the latest bar
        **cs,
    }


def _compute_into_cache(sym):
    """Refill one symbol. Runs on the background pool; never raises."""
    try:
        row = _compute_row(sym, _index_returns())
    except Exception:
        row = None
    with _CACHE_LOCK:
        _CACHE[sym] = (time.time(), row)
    with _inflight_lock:
        _inflight.discard(sym)
    return row


def _worker():
    while True:
        sym = _queue.get()
        try:
            _compute_into_cache(sym)
        except Exception:
            with _inflight_lock:
                _inflight.discard(sym)
        finally:
            _queue.task_done()


def _start_workers():
    global _workers_started
    with _workers_lock:
        if _workers_started:
            return
        _workers_started = True
        for i in range(_POOL_SIZE):
            threading.Thread(target=_worker, daemon=True,
                             name=f"scan-{i}").start()


def enqueue(symbols):
    """Queue background refills. Returns what was actually accepted.

    Two things are deliberately dropped rather than queued:
      • a symbol already in flight — a polling client re-sends its pending list
        every couple of seconds, and without this the queue fills with
        duplicates of work already running and never drains;
      • anything past the queue bound — the client will ask again on its next
        poll, so a full queue costs a round trip, whereas an unbounded one
        parks every later visitor behind one ALL MARKETS sweep.
    """
    _start_workers()
    queued = []
    for s in symbols:
        with _inflight_lock:
            if s in _inflight:
                continue
            _inflight.add(s)
        try:
            _queue.put_nowait(s)
            queued.append(s)
        except queue.Full:
            with _inflight_lock:
                _inflight.discard(s)
            break                      # the rest would fail too
    return queued


def scan(symbols, wait=False):
    """Technical rows for `symbols`, served from cache without blocking.

    Returns {"data", "pending", "count", "computed", "cached", "stale"}.

    A fresh row is returned. A row past its TTL but inside _STALE_MAX is ALSO
    returned — and refreshed behind the response — because these are daily-bar
    indicators and a slightly old number beats an empty column. Anything else
    is queued and named in `pending`; poll again to collect it.

    `wait=True` restores the old blocking behaviour for the warm loop, which
    exists precisely to do this work up front and has no one waiting on it.
    """
    symbols = [s.strip().upper() for s in symbols if s and s.strip()][:MAX_SYMBOLS]
    now = time.time()
    out, pending, todo = {}, [], []
    stale_n = 0

    with _CACHE_LOCK:
        for s in symbols:
            hit = _CACHE.get(s)
            row = hit[1] if hit else None
            age = (now - hit[0]) if hit else None
            if row is not None and age < _TTL:
                out[s] = row                          # fresh
            elif row is not None and age < _STALE_MAX:
                out[s] = row                          # stale but usable…
                stale_n += 1
                todo.append(s)                        # …refresh behind it
            elif row is None and hit and age < _NEG_TTL:
                pending.append(s)                     # failed just now — cool off
            else:
                pending.append(s)
                todo.append(s)

    if wait:
        _blocking_fill(todo, out)
        pending = [s for s in pending if s not in out]
    else:
        enqueue(todo)

    return {"data": out, "pending": pending, "count": len(out),
            "computed": len(todo), "cached": len(out) - stale_n, "stale": stale_n}


def _blocking_fill(todo, out):
    """Compute `todo` inline and merge into `out`. Warm-loop path only."""
    if not todo:
        return
    from concurrent.futures import as_completed
    idx_ret = _index_returns()
    ex = ThreadPoolExecutor(max_workers=_POOL_SIZE)
    try:
        futs = {ex.submit(_compute_row, s, idx_ret): s for s in todo}
        stamp = time.time()
        for f in as_completed(futs):
            s = futs[f]
            try:
                row = f.result()
            except Exception:
                row = None
            with _CACHE_LOCK:
                _CACHE[s] = (stamp, row)
            if row is not None:
                out[s] = row
    finally:
        ex.shutdown(wait=False)


start_persistence()
