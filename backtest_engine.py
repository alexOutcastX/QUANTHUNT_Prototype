# Institutional-grade portfolio backtest engine (background job + snapshot API).
#
# Replaces the old client-side single-symbol simulator. Design goals, in the
# order professionals ask for them:
#
#   * No lookahead: signals are computed on bar t's CLOSE and executed at bar
#     t+1's OPEN (configurable to same-close for parity with simpler tools).
#   * Portfolio-level: many symbols, one capital pool, whole-share fills, a max
#     concurrent position count, and deterministic candidate ranking when more
#     signals fire than there are free slots.
#   * Honest fills: stop/target/trailing exits are resting orders checked
#     intra-bar; when price GAPS through a level at the open, the fill is the
#     open (the real, worse price) — not the level.
#   * Real Indian cost stack: brokerage (% with a per-order cap), STT, exchange
#     transaction charges, SEBI fees, GST, stamp duty, plus slippage in bps —
#     each fill is charged, and every trade in the blotter carries its charges.
#   * Full analytics: CAGR, Sharpe, Sortino, Calmar, volatility, max drawdown
#     and its duration, exposure, turnover, win rate, profit factor,
#     expectancy, payoff ratio, monthly-returns matrix, per-symbol breakdown,
#     equity + drawdown + buy&hold benchmark curves and a complete trade log.
#
# The engine is dependency-injected (constituents_fn / load_ohlc) so unit tests
# run stdlib-only with synthetic data, and runs as a background job with live
# progress — a 50-symbol × 5-year sweep is far too slow for request/response.

import json
import logging
import math
import os
import threading
import time
import uuid
from datetime import datetime, timezone

log = logging.getLogger("backtest_engine")

_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backtests.json")

MAX_SYMBOLS = 100          # hard cap per run (feed protection)
MIN_BARS = 60              # a symbol needs at least this much history
MAX_JOBS = 8               # completed jobs kept in memory (ring)
MAX_RUNNING = 2            # concurrent simulations
TRADING_DAYS = 252
RF_RATE = 0.06             # Indian risk-free proxy for Sharpe/Sortino

_lock = threading.Lock()
_jobs: "dict[str, dict]" = {}   # run_id -> job state


# ── Indicators (pure python, None = warm-up) ─────────────────────────────────

def _ema(xs, period):
    k = 2.0 / (period + 1)
    out = [None] * len(xs)
    val = None
    for i, x in enumerate(xs):
        if x is None:
            continue
        val = x if val is None else x * k + val * (1 - k)
        out[i] = val
    return out


def _sma(xs, period):
    out = [None] * len(xs)
    s = 0.0
    for i, x in enumerate(xs):
        s += x
        if i >= period:
            s -= xs[i - period]
        if i >= period - 1:
            out[i] = s / period
    return out


def _rsi(closes, period):
    out = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        gains += max(d, 0)
        losses += max(-d, 0)
    avg_g, avg_l = gains / period, losses / period
    out[period] = 100 - 100 / (1 + (avg_g / avg_l if avg_l else 1e9))
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        avg_g = (avg_g * (period - 1) + max(d, 0)) / period
        avg_l = (avg_l * (period - 1) + max(-d, 0)) / period
        out[i] = 100 - 100 / (1 + (avg_g / avg_l if avg_l else 1e9))
    return out


def _atr(candles, period=14):
    n = len(candles)
    out = [0.0] * n
    s = 0.0
    for i in range(n):
        h, l = candles[i]["h"], candles[i]["l"]
        tr = h - l if i == 0 else max(
            h - l, abs(h - candles[i - 1]["c"]), abs(l - candles[i - 1]["c"]))
        if i < period:
            s += tr
            out[i] = s / (i + 1)
        else:
            out[i] = (out[i - 1] * (period - 1) + tr) / period
    return out


def _stdev(xs):
    n = len(xs)
    if n < 2:
        return 0.0
    m = sum(xs) / n
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (n - 1))


def _macd_parts(closes, fast=12, slow=26, signal=9):
    f, s = _ema(closes, fast), _ema(closes, slow)
    line = [None if (f[i] is None or s[i] is None) else f[i] - s[i] for i in range(len(closes))]
    sig = _ema(line, signal)
    hist = [None if (line[i] is None or sig[i] is None) else line[i] - sig[i] for i in range(len(closes))]
    return line, sig, hist


def _boll(closes, period=20, mult=2.0):
    mid = _sma(closes, period)
    up = [None] * len(closes)
    lo = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1:i + 1]
        m = mid[i]
        std = math.sqrt(sum((x - m) ** 2 for x in window) / period)
        up[i] = m + mult * std
        lo[i] = m - mult * std
    return mid, up, lo


def _rolling_max(xs, period):
    out = [None] * len(xs)
    for i in range(period - 1, len(xs)):
        out[i] = max(xs[i - period + 1:i + 1])
    return out


def _rolling_min(xs, period):
    out = [None] * len(xs)
    for i in range(period - 1, len(xs)):
        out[i] = min(xs[i - period + 1:i + 1])
    return out


def _roc(closes, period):
    out = [None] * len(closes)
    for i in range(period, len(closes)):
        if closes[i - period]:
            out[i] = (closes[i] / closes[i - period] - 1) * 100
    return out


def _adx_parts(highs, lows, closes, period=14):
    n = len(closes)
    plus_dm = [0.0] * n
    minus_dm = [0.0] * n
    tr = [0.0] * n
    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        dn = lows[i - 1] - lows[i]
        plus_dm[i] = up if (up > dn and up > 0) else 0.0
        minus_dm[i] = dn if (dn > up and dn > 0) else 0.0
        tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]), abs(lows[i] - closes[i - 1]))
    s_tr = [None] * n
    s_p = [None] * n
    s_m = [None] * n
    if n > period:
        s_tr[period] = sum(tr[1:period + 1])
        s_p[period] = sum(plus_dm[1:period + 1])
        s_m[period] = sum(minus_dm[1:period + 1])
        for i in range(period + 1, n):
            s_tr[i] = s_tr[i - 1] - s_tr[i - 1] / period + tr[i]
            s_p[i] = s_p[i - 1] - s_p[i - 1] / period + plus_dm[i]
            s_m[i] = s_m[i - 1] - s_m[i - 1] / period + minus_dm[i]
    p_di = [None] * n
    m_di = [None] * n
    dx = [None] * n
    for i in range(period, n):
        if not s_tr[i]:
            continue
        p_di[i] = 100 * s_p[i] / s_tr[i]
        m_di[i] = 100 * s_m[i] / s_tr[i]
        tot = p_di[i] + m_di[i]
        dx[i] = 100 * abs(p_di[i] - m_di[i]) / tot if tot else 0
    adx = [None] * n
    val = None
    for i in range(period * 2, n):
        if dx[i] is None:
            continue
        val = dx[i] if val is None else (val * (period - 1) + dx[i]) / period
        adx[i] = val
    return adx, p_di, m_di


def _supertrend(candles, period=10, mult=3.0):
    """Returns per-bar trend: +1 above the supertrend line, -1 below."""
    n = len(candles)
    atr = _atr(candles, period)
    trend = [0] * n
    ub = lb = None
    st_dir = 1
    for i in range(n):
        h, l, c = candles[i]["h"], candles[i]["l"], candles[i]["c"]
        mid = (h + l) / 2
        basic_ub = mid + mult * atr[i]
        basic_lb = mid - mult * atr[i]
        prev_c = candles[i - 1]["c"] if i else c
        ub = basic_ub if (ub is None or basic_ub < ub or prev_c > ub) else ub
        lb = basic_lb if (lb is None or basic_lb > lb or prev_c < lb) else lb
        if st_dir == 1 and c < lb:
            st_dir = -1
        elif st_dir == -1 and c > ub:
            st_dir = 1
        trend[i] = st_dir
    return trend


# ── Strategy library ─────────────────────────────────────────────────────────
# Each strategy returns a per-bar signal list: +1 enter long, -1 exit, 0 none.
# Params are dicts (validated against defaults) so the client can edit them.

def _cross(a, b, i):
    if i == 0 or a[i] is None or b[i] is None or a[i - 1] is None or b[i - 1] is None:
        return 0
    if a[i - 1] <= b[i - 1] and a[i] > b[i]:
        return 1
    if a[i - 1] >= b[i - 1] and a[i] < b[i]:
        return -1
    return 0


STRATEGIES = {
    "ema_cross": {"label": "EMA Crossover", "params": {"fast": 9, "slow": 21},
                  "blurb": "Buy when the fast EMA crosses above the slow EMA; exit on the reverse cross."},
    "sma_cross": {"label": "SMA Crossover", "params": {"fast": 20, "slow": 50},
                  "blurb": "Classic moving-average trend following on simple averages."},
    "golden_cross": {"label": "Golden Cross (50/200)", "params": {"fast": 50, "slow": 200},
                     "blurb": "The long-horizon institutional staple: 50-DMA over 200-DMA."},
    "macd": {"label": "MACD Signal", "params": {"fast": 12, "slow": 26, "signal": 9},
             "blurb": "Buy when the MACD line crosses above its signal line; exit on the reverse."},
    "rsi_rev": {"label": "RSI Mean Reversion", "params": {"period": 14, "oversold": 30, "overbought": 70},
                "blurb": "Buy the turn back up out of oversold; exit on the turn down out of overbought."},
    "bollinger": {"label": "Bollinger Reversion", "params": {"period": 20, "mult": 2},
                  "blurb": "Buy the tag of the lower band; exit at the middle band or upper-band tag."},
    "donchian": {"label": "Donchian Breakout", "params": {"entry": 55, "exit": 20},
                 "blurb": "Turtle-style: buy an N-day-high breakout, exit on an M-day low."},
    "momentum": {"label": "Momentum (ROC)", "params": {"period": 63, "entry": 10, "exit": 0},
                 "blurb": "Own what's rising: buy when N-day rate-of-change exceeds the entry %, exit when it fades."},
    "adx_trend": {"label": "ADX Trend (+DI/-DI)", "params": {"period": 14, "min_adx": 25},
                  "blurb": "Trade only trending names: +DI over -DI with ADX confirming trend strength."},
    "supertrend": {"label": "Supertrend", "params": {"period": 10, "mult": 3},
                   "blurb": "Follow the ATR-band flip: long while price holds above the supertrend line."},
    "price_ema": {"label": "Price vs EMA", "params": {"period": 20},
                  "blurb": "Long when price reclaims the EMA, exit when it loses it."},
    "minervini": {"label": "Minervini Trend Template", "params": {"near_high_pct": 25},
                  "blurb": "SEPA-style filter: price above rising 150/200-DMAs, well off the low, near the 52-week high."},
    "week52_breakout": {"label": "52-Week-High Breakout", "params": {"exit": 20},
                        "blurb": "Buy new 52-week highs, exit on a 20-day low — momentum's simplest edge."},
}


def _signals(candles, key, params):
    n = len(candles)
    closes = [c["c"] for c in candles]
    highs = [c["h"] for c in candles]
    lows = [c["l"] for c in candles]
    sig = [0] * n
    p = dict(STRATEGIES[key]["params"])
    for k, v in (params or {}).items():
        if k in p:
            try:
                p[k] = float(v)
            except (TypeError, ValueError):
                pass

    if key in ("ema_cross", "sma_cross", "golden_cross"):
        fn = _ema if key == "ema_cross" else _sma
        fast, slow = fn(closes, int(p["fast"])), fn(closes, int(p["slow"]))
        for i in range(n):
            sig[i] = _cross(fast, slow, i)
    elif key == "macd":
        line, s_line, _h = _macd_parts(closes, int(p["fast"]), int(p["slow"]), int(p["signal"]))
        for i in range(n):
            sig[i] = _cross(line, s_line, i)
    elif key == "rsi_rev":
        r = _rsi(closes, int(p["period"]))
        os_, ob = p["oversold"], p["overbought"]
        for i in range(1, n):
            if r[i - 1] is None or r[i] is None:
                continue
            if r[i - 1] < os_ and r[i] >= os_:
                sig[i] = 1
            elif r[i - 1] > ob and r[i] <= ob:
                sig[i] = -1
    elif key == "bollinger":
        mid, up, lo = _boll(closes, int(p["period"]), p["mult"])
        for i in range(1, n):
            if lo[i] is None or lo[i - 1] is None:
                continue
            if closes[i - 1] >= lo[i - 1] and closes[i] < lo[i]:
                sig[i] = 1
            elif (closes[i - 1] <= mid[i - 1] and closes[i] > mid[i]) or closes[i] > up[i]:
                sig[i] = -1
    elif key == "donchian":
        hi_n = _rolling_max(highs, int(p["entry"]))
        lo_n = _rolling_min(lows, int(p["exit"]))
        for i in range(1, n):
            if hi_n[i - 1] is not None and closes[i] > hi_n[i - 1]:
                sig[i] = 1
            elif lo_n[i - 1] is not None and closes[i] < lo_n[i - 1]:
                sig[i] = -1
    elif key == "momentum":
        r = _roc(closes, int(p["period"]))
        for i in range(n):
            if r[i] is None:
                continue
            if r[i] > p["entry"]:
                sig[i] = 1
            elif r[i] < p["exit"]:
                sig[i] = -1
    elif key == "adx_trend":
        adx, p_di, m_di = _adx_parts(highs, lows, closes, int(p["period"]))
        for i in range(1, n):
            if p_di[i] is None or p_di[i - 1] is None or adx[i] is None:
                continue
            if p_di[i - 1] <= m_di[i - 1] and p_di[i] > m_di[i] and adx[i] >= p["min_adx"]:
                sig[i] = 1
            elif p_di[i - 1] >= m_di[i - 1] and p_di[i] < m_di[i]:
                sig[i] = -1
    elif key == "supertrend":
        tr = _supertrend(candles, int(p["period"]), p["mult"])
        for i in range(1, n):
            if tr[i - 1] == -1 and tr[i] == 1:
                sig[i] = 1
            elif tr[i - 1] == 1 and tr[i] == -1:
                sig[i] = -1
    elif key == "price_ema":
        e = _ema(closes, int(p["period"]))
        for i in range(1, n):
            if e[i] is None or e[i - 1] is None:
                continue
            if closes[i - 1] < e[i - 1] and closes[i] >= e[i]:
                sig[i] = 1
            elif closes[i - 1] > e[i - 1] and closes[i] <= e[i]:
                sig[i] = -1
    elif key == "minervini":
        s150, s200 = _sma(closes, 150), _sma(closes, 200)
        hi52, lo52 = _rolling_max(highs, 252), _rolling_min(lows, 252)
        near = p["near_high_pct"]
        for i in range(1, n):
            if i < 21 or s200[i] is None or s200[i - 21] is None or s150[i] is None:
                continue
            ok = (closes[i] > s150[i] > s200[i]
                  and s200[i] > s200[i - 21]
                  and hi52[i] and lo52[i]
                  and closes[i] >= lo52[i] * 1.3
                  and closes[i] >= hi52[i] * (1 - near / 100))
            was = (s150[i - 1] is not None and closes[i - 1] > s150[i - 1] > (s200[i - 1] or 1e18))
            if ok and not was:
                sig[i] = 1
            elif not ok and was:
                sig[i] = -1
    elif key == "week52_breakout":
        hi52 = _rolling_max(highs, 252)
        lo_n = _rolling_min(lows, int(p["exit"]))
        for i in range(1, n):
            if hi52[i - 1] is not None and closes[i] > hi52[i - 1]:
                sig[i] = 1
            elif lo_n[i - 1] is not None and closes[i] < lo_n[i - 1]:
                sig[i] = -1
    return sig


# ── Manual rule builder ──────────────────────────────────────────────────────
# {ind, period?, op, target, value?} — AND semantics within each of buy[]/sell[].
_RULE_INDS = ("close", "volume", "rsi", "ema", "sma", "macd_hist", "atr", "high_n", "low_n")
_RULE_OPS = ("gt", "lt", "cross_above", "cross_below")
_RULE_TARGETS = ("value", "ema", "sma", "close", "high_n", "low_n")


def _rule_series(candles, ind, period):
    closes = [c["c"] for c in candles]
    if ind == "close":
        return closes
    if ind == "volume":
        return [c.get("v") or 0 for c in candles]
    if ind == "rsi":
        return _rsi(closes, int(period or 14))
    if ind == "ema":
        return _ema(closes, int(period or 20))
    if ind == "sma":
        return _sma(closes, int(period or 20))
    if ind == "macd_hist":
        return _macd_parts(closes)[2]
    if ind == "atr":
        return _atr(candles, int(period or 14))
    if ind == "high_n":
        return _rolling_max([c["h"] for c in candles], int(period or 20))
    if ind == "low_n":
        return _rolling_min([c["l"] for c in candles], int(period or 20))
    return closes


def _custom_signals(candles, buy_rules, sell_rules, filters=None,
                    mode_buy="all", mode_sell="all", base=None):
    """User-defined strategy signals.

    Entry  = (base bot signal, when one is chosen) AND (entry rules matched
             per mode_buy: 'all'/'any') AND (every filter — regime conditions
             like `close > SMA 200` that gate entries without triggering them).
    Exit   = base bot sell signal OR exit rules (matched per mode_sell).
    """
    n = len(candles)

    def compile_(rules):
        out = []
        for r in rules or []:
            ind = r.get("ind") if r.get("ind") in _RULE_INDS else "close"
            op = r.get("op") if r.get("op") in _RULE_OPS else "gt"
            tgt = r.get("target") if r.get("target") in _RULE_TARGETS else "value"
            left = _rule_series(candles, ind, r.get("period"))
            if tgt == "value":
                try:
                    v = float(r.get("value") or 0)
                except (TypeError, ValueError):
                    v = 0.0
                right = [v] * n
            else:
                right = _rule_series(candles, tgt, r.get("value"))
            out.append((op, left, right))
        return out

    def true_at(rule, i):
        op, left, right = rule
        l, r = left[i], right[i]
        if l is None or r is None:
            return False
        if op == "gt":
            return l > r
        if op == "lt":
            return l < r
        if i == 0 or left[i - 1] is None or right[i - 1] is None:
            return False
        if op == "cross_above":
            return left[i - 1] <= right[i - 1] and l > r
        return left[i - 1] >= right[i - 1] and l < r

    def matched(rules, mode, i):
        if not rules:
            return False
        fn = any if mode == "any" else all
        return fn(true_at(r, i) for r in rules)

    buy = compile_(buy_rules)
    sell = compile_(sell_rules)
    filt = compile_(filters)
    base_sig = None
    if base and base.get("key") in STRATEGIES:
        base_sig = _signals(candles, base["key"], base.get("params"))

    sig = [0] * n
    for i in range(n):
        # Entry: every configured trigger source must agree, filters must pass.
        enter = base_sig[i] == 1 if base_sig else False
        if buy:
            rule_hit = matched(buy, mode_buy, i)
            enter = (enter and rule_hit) if base_sig else rule_hit
        if enter and filt and not all(true_at(r, i) for r in filt):
            enter = False
        # Exit: any configured exit source suffices.
        leave = (base_sig[i] == -1 if base_sig else False) or matched(sell, mode_sell, i)
        if enter:
            sig[i] = 1
        elif leave:
            sig[i] = -1
    return sig


# ── Cost model (India delivery defaults; every field configurable) ───────────

DEFAULT_COSTS = {
    "brokerage_pct": 0.03,     # % per order …
    "brokerage_cap": 20.0,     # … capped at ₹20 (discount-broker style); 0 = no cap
    "stt_pct": 0.1,            # securities transaction tax, both sides (delivery)
    "exchange_pct": 0.00297,   # NSE transaction charges
    "sebi_pct": 0.0001,
    "gst_pct": 18.0,           # on brokerage + exchange charges
    "stamp_pct": 0.015,        # buy side only
    "slippage_bps": 5.0,       # price impact per fill, in basis points
}


def _order_charges(value, side, costs):
    brok = value * costs["brokerage_pct"] / 100
    if costs["brokerage_cap"]:
        brok = min(brok, costs["brokerage_cap"])
    stt = value * costs["stt_pct"] / 100
    exch = value * costs["exchange_pct"] / 100
    sebi = value * costs["sebi_pct"] / 100
    gst = (brok + exch) * costs["gst_pct"] / 100
    stamp = value * costs["stamp_pct"] / 100 if side == "buy" else 0.0
    return brok + stt + exch + sebi + gst + stamp


def _slip(price, side, costs):
    d = costs["slippage_bps"] / 10000.0
    return price * (1 + d) if side == "buy" else price * (1 - d)


# ── Portfolio simulator ──────────────────────────────────────────────────────

def _ts_day(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def _simulate(series, signals, cfg, progress=None):
    """series: {sym: candles}, signals: {sym: sig[]}. Returns the result dict."""
    capital = max(1000.0, float(cfg.get("capital") or 1_000_000))
    max_pos = max(1, int(cfg.get("max_positions") or 10))
    exec_mode = cfg.get("execution") if cfg.get("execution") in ("next_open", "same_close") else "next_open"
    sizing = cfg.get("sizing") or {}
    size_mode = sizing.get("mode") if sizing.get("mode") in ("equal", "fixed", "risk") else "equal"
    size_val = float(sizing.get("value") or 0)
    costs = dict(DEFAULT_COSTS)
    for k, v in (cfg.get("costs") or {}).items():
        if k in costs:
            try:
                costs[k] = float(v)
            except (TypeError, ValueError):
                pass
    risk = cfg.get("risk") or {}
    sl_type = risk.get("sl_type") if risk.get("sl_type") in ("none", "pct", "atr") else "none"
    sl_val = float(risk.get("sl_val") or 0)
    tp_type = risk.get("tp_type") if risk.get("tp_type") in ("none", "pct", "rr") else "none"
    tp_val = float(risk.get("tp_val") or 0)
    trail_pct = float(risk.get("trail_pct") or 0)
    max_hold = int(risk.get("max_hold_days") or 0)

    # Unified calendar + per-symbol bar index maps.
    all_ts = sorted({c["t"] for cs in series.values() for c in cs})
    idx_of = {sym: {c["t"]: i for i, c in enumerate(cs)} for sym, cs in series.items()}
    atr_of = {sym: _atr(cs, 14) for sym, cs in series.items()}
    roc_of = {sym: _roc([c["c"] for c in cs], 63) for sym, cs in series.items()}

    cash = capital
    positions = {}                # sym -> position dict
    pending_entries = []          # [{sym, signal_ts}] to execute at next bar open
    pending_exits = {}            # sym -> reason, execute at next bar open
    trades = []
    equity_curve = []
    invested_frac = []
    total_traded = 0.0
    total_charges = 0.0
    tid = [0]

    def bar_at(sym, ts):
        i = idx_of[sym].get(ts)
        return (series[sym][i], i) if i is not None else (None, None)

    def open_position(sym, bar, i, ts):
        nonlocal cash, total_traded, total_charges
        if sym in positions or len(positions) >= max_pos:
            return
        price = _slip(bar["o"] if exec_mode == "next_open" else bar["c"], "buy", costs)
        if price <= 0:
            return
        # Size on yesterday's marks — today's closes aren't known at the open.
        equity = cash + sum(p["qty"] * (last_close.get(s) or p["entry_px"])
                            for s, p in positions.items())
        stop_px = None
        if sl_type == "pct" and sl_val > 0:
            stop_px = price * (1 - sl_val / 100)
        elif sl_type == "atr" and sl_val > 0:
            stop_px = price - atr_of[sym][i] * sl_val
        if size_mode == "fixed" and size_val > 0:
            alloc = size_val
        elif size_mode == "risk" and size_val > 0 and stop_px and stop_px < price:
            alloc = (equity * size_val / 100) / ((price - stop_px) / price)
        else:
            alloc = equity / max_pos
        qty = int(min(alloc, cash) // price)
        if qty <= 0:
            return
        value = qty * price
        ch = _order_charges(value, "buy", costs)
        if value + ch > cash:
            qty = int((cash - ch) // price)
            if qty <= 0:
                return
            value = qty * price
            ch = _order_charges(value, "buy", costs)
        cash -= value + ch
        total_traded += value
        total_charges += ch
        tgt_px = None
        if tp_type == "pct" and tp_val > 0:
            tgt_px = price * (1 + tp_val / 100)
        elif tp_type == "rr" and tp_val > 0 and stop_px:
            tgt_px = price + (price - stop_px) * tp_val
        positions[sym] = {
            "qty": qty, "entry_px": price, "entry_ts": ts, "entry_charges": ch,
            "stop": stop_px, "target": tgt_px, "peak": price, "bars": 0,
            "risk_per_share": (price - stop_px) if stop_px else None,
        }

    def close_position(sym, ts, raw_price, reason):
        nonlocal cash, total_traded, total_charges
        p = positions.pop(sym)
        price = _slip(raw_price, "sell", costs)
        value = p["qty"] * price
        ch = _order_charges(value, "sell", costs)
        cash += value - ch
        total_traded += value
        total_charges += ch
        gross = (price - p["entry_px"]) * p["qty"]
        charges = ch + p["entry_charges"]
        net = gross - charges
        hold = max(1, round((ts - p["entry_ts"]) / 86400))
        tid[0] += 1
        trades.append({
            "id": tid[0], "symbol": sym, "qty": p["qty"],
            "entry_date": _ts_day(p["entry_ts"]), "entry_ts": p["entry_ts"],
            "entry_px": round(p["entry_px"], 2),
            "exit_date": _ts_day(ts), "exit_ts": ts, "exit_px": round(price, 2),
            "reason": reason,
            "gross_pnl": round(gross, 2), "charges": round(charges, 2),
            "net_pnl": round(net, 2),
            "ret_pct": round((price / p["entry_px"] - 1) * 100, 2),
            "hold_days": hold,
            "r_multiple": round(net / (p["risk_per_share"] * p["qty"]), 2)
            if p.get("risk_per_share") else None,
        })

    last_close = {}

    def bar_now(sym, ts):
        b, _ = bar_at(sym, ts)
        return b["c"] if b else last_close.get(sym, 0.0)

    for di, ts in enumerate(all_ts):
        if progress and di % 50 == 0:
            progress(f"simulating {_ts_day(ts)} · {di}/{len(all_ts)} days")

        # 1) Execute pending signal exits at this bar's open.
        for sym, reason in list(pending_exits.items()):
            b, _i = bar_at(sym, ts)
            if b is None or sym not in positions:
                continue
            close_position(sym, ts, b["o"], reason)
            del pending_exits[sym]

        # 2) Resting orders: stops / targets / trailing, gap-aware.
        for sym in list(positions.keys()):
            b, i = bar_at(sym, ts)
            if b is None:
                continue
            p = positions[sym]
            if p["entry_ts"] == ts:
                continue  # same-bar entry: manage from the next bar
            p["bars"] += 1
            exited = False
            eps = 1e-6  # float guard so an exact touch of a level still fills
            if p["stop"] is not None:
                if b["o"] <= p["stop"] + eps:
                    close_position(sym, ts, b["o"], "Stop (gap)")
                    exited = True
                elif b["l"] <= p["stop"] + eps:
                    close_position(sym, ts, p["stop"], "Stop")
                    exited = True
            if not exited and trail_pct > 0:
                p["peak"] = max(p["peak"], b["h"])
                trail_px = p["peak"] * (1 - trail_pct / 100)
                if p["peak"] > p["entry_px"] and b["l"] <= trail_px + eps:
                    close_position(sym, ts, min(max(trail_px, b["l"]), b["h"]), "Trail")
                    exited = True
            if not exited and p["target"] is not None:
                if b["o"] >= p["target"] - eps:
                    close_position(sym, ts, b["o"], "Target (gap)")
                    exited = True
                elif b["h"] >= p["target"] - eps:
                    close_position(sym, ts, p["target"], "Target")
                    exited = True
            if not exited and max_hold > 0 and p["bars"] >= max_hold:
                close_position(sym, ts, b["c"], "Time")

        # 3) Execute pending entries at this bar's open (ranked by momentum).
        if pending_entries:
            ranked = []
            for e in pending_entries:
                sym = e["sym"]
                b, i = bar_at(sym, ts)
                if b is None or sym in positions:
                    continue
                r = roc_of[sym][i] if i is not None and roc_of[sym][i] is not None else -1e9
                ranked.append((r, sym, b, i))
            ranked.sort(key=lambda x: (-x[0], x[1]))
            for _r, sym, b, i in ranked:
                open_position(sym, b, i, ts)
            pending_entries = []

        # 4) Read today's signals at the close; queue for the next bar's open
        #    (or act on the close in same_close mode).
        for sym, cs in series.items():
            b, i = bar_at(sym, ts)
            if b is None:
                continue
            last_close[sym] = b["c"]
            s = signals[sym][i]
            if s == 1 and sym not in positions and sym not in pending_exits:
                if exec_mode == "same_close":
                    open_position(sym, b, i, ts)
                else:
                    pending_entries.append({"sym": sym})
            elif s == -1 and sym in positions:
                if exec_mode == "same_close":
                    close_position(sym, ts, b["c"], "Signal")
                else:
                    pending_exits[sym] = "Signal"

        # 5) Mark to market.
        pos_val = sum(p["qty"] * bar_now(sym, ts) for sym, p in positions.items())
        eq = cash + pos_val
        equity_curve.append({"t": ts, "eq": round(eq, 2)})
        invested_frac.append(pos_val / eq if eq > 0 else 0.0)

    # Force-close whatever is still open at the last close.
    final_ts = all_ts[-1] if all_ts else 0
    for sym in list(positions.keys()):
        close_position(sym, final_ts, last_close.get(sym, positions[sym]["entry_px"]), "End")
    if equity_curve:
        equity_curve[-1] = {"t": final_ts, "eq": round(cash, 2)}

    return {
        "capital": capital, "equity_curve": equity_curve, "trades": trades,
        "invested_frac": invested_frac, "total_traded": total_traded,
        "total_charges": round(total_charges, 2), "costs": costs,
    }


# ── Analytics ────────────────────────────────────────────────────────────────

def _daily_returns(curve):
    out = []
    for i in range(1, len(curve)):
        prev = curve[i - 1]["eq"]
        if prev > 0:
            out.append(curve[i]["eq"] / prev - 1)
    return out


def _metrics(sim):
    curve = sim["equity_curve"]
    trades = sim["trades"]
    capital = sim["capital"]
    if not curve:
        return {}
    final = curve[-1]["eq"]
    days = max(1, (curve[-1]["t"] - curve[0]["t"]) / 86400)
    years = days / 365.25
    rets = _daily_returns(curve)
    cagr = ((final / capital) ** (1 / years) - 1) * 100 if final > 0 and years > 0 else -100.0
    vol = _stdev(rets) * math.sqrt(TRADING_DAYS) * 100 if rets else 0.0
    rf_d = RF_RATE / TRADING_DAYS
    mean_ex = (sum(rets) / len(rets) - rf_d) if rets else 0.0
    sd = _stdev(rets)
    sharpe = (mean_ex / sd) * math.sqrt(TRADING_DAYS) if sd > 1e-12 else 0.0
    downs = [r for r in rets if r < 0]
    dsd = math.sqrt(sum(r * r for r in downs) / len(rets)) if rets and downs else 0.0
    sortino = (mean_ex / dsd) * math.sqrt(TRADING_DAYS) if dsd > 1e-12 else 0.0

    # Max drawdown depth + duration. Duration is the underwater spell measured
    # peak → RECOVERY (equity back at the old peak), the way fund factsheets
    # quote it — not merely peak → trough.
    peak = capital
    peak_t = curve[0]["t"] if curve else 0
    underwater_from = None
    max_dd = 0.0
    dd_days = 0
    dd_curve = []
    for pt in curve:
        if pt["eq"] >= peak:
            if underwater_from is not None:
                dd_days = max(dd_days, round((pt["t"] - underwater_from) / 86400))
                underwater_from = None
            peak = max(peak, pt["eq"])
            peak_t = pt["t"]
            dd_curve.append({"t": pt["t"], "dd": 0.0})
        else:
            if underwater_from is None:
                underwater_from = peak_t
            dd = (peak - pt["eq"]) / peak * 100 if peak > 0 else 0.0
            dd_curve.append({"t": pt["t"], "dd": round(-dd, 2)})
            max_dd = max(max_dd, dd)
            dd_days = max(dd_days, round((pt["t"] - underwater_from) / 86400))
    calmar = cagr / max_dd if max_dd > 0 else None

    wins = [t for t in trades if t["net_pnl"] > 0]
    losses = [t for t in trades if t["net_pnl"] <= 0]
    gross_w = sum(t["net_pnl"] for t in wins)
    gross_l = abs(sum(t["net_pnl"] for t in losses))
    avg_win = gross_w / len(wins) if wins else 0.0
    avg_loss = gross_l / len(losses) if losses else 0.0
    expectancy = (sum(t["net_pnl"] for t in trades) / len(trades)) if trades else 0.0
    exposure = (sum(sim["invested_frac"]) / len(sim["invested_frac"]) * 100) if sim["invested_frac"] else 0.0
    avg_eq = sum(p["eq"] for p in curve) / len(curve)
    turnover = sim["total_traded"] / avg_eq / years if avg_eq > 0 and years > 0 else 0.0

    # Monthly returns matrix.
    monthly = {}
    month_start = {}
    for pt in curve:
        d = datetime.fromtimestamp(pt["t"], tz=timezone.utc)
        key = (d.year, d.month)
        if key not in month_start:
            month_start[key] = pt["eq"]
        monthly[key] = pt["eq"]
    months_sorted = sorted(monthly)
    monthly_rows = {}
    prev_eq = capital
    for key in months_sorted:
        y, m = key
        ret = (monthly[key] / prev_eq - 1) * 100 if prev_eq > 0 else 0.0
        monthly_rows.setdefault(y, [None] * 12)[m - 1] = round(ret, 2)
        prev_eq = monthly[key]
    monthly_table = [{"year": y, "months": monthly_rows[y],
                      "total": round((math.prod((1 + (r or 0) / 100) for r in monthly_rows[y]) - 1) * 100, 2)}
                     for y in sorted(monthly_rows)]

    per_symbol = {}
    for t in trades:
        rec = per_symbol.setdefault(t["symbol"], {"symbol": t["symbol"], "trades": 0, "wins": 0,
                                                  "net_pnl": 0.0, "charges": 0.0})
        rec["trades"] += 1
        rec["wins"] += 1 if t["net_pnl"] > 0 else 0
        rec["net_pnl"] = round(rec["net_pnl"] + t["net_pnl"], 2)
        rec["charges"] = round(rec["charges"] + t["charges"], 2)
    per_symbol = sorted(per_symbol.values(), key=lambda r: -r["net_pnl"])

    best = max(trades, key=lambda t: t["net_pnl"]) if trades else None
    worst = min(trades, key=lambda t: t["net_pnl"]) if trades else None

    return {
        "final_capital": round(final, 2),
        "net_profit": round(final - capital, 2),
        "total_return_pct": round((final / capital - 1) * 100, 2),
        "cagr_pct": round(cagr, 2),
        "volatility_pct": round(vol, 2),
        "sharpe": round(sharpe, 2),
        "sortino": round(sortino, 2),
        "calmar": round(calmar, 2) if calmar is not None else None,
        "max_drawdown_pct": round(max_dd, 2),
        "max_drawdown_days": dd_days,
        "exposure_pct": round(exposure, 1),
        "turnover_x": round(turnover, 2),
        "trades": len(trades),
        "win_rate_pct": round(len(wins) / len(trades) * 100, 1) if trades else 0.0,
        "profit_factor": round(gross_w / gross_l, 2) if gross_l > 0 else None,
        "expectancy": round(expectancy, 2),
        "avg_win": round(avg_win, 2),
        "avg_loss": round(avg_loss, 2),
        "payoff": round(avg_win / avg_loss, 2) if avg_loss > 0 else None,
        "avg_hold_days": round(sum(t["hold_days"] for t in trades) / len(trades), 1) if trades else 0.0,
        "total_charges": sim["total_charges"],
        "best_trade": best, "worst_trade": worst,
        "drawdown_curve": dd_curve,
        "monthly_returns": monthly_table,
        "per_symbol": per_symbol,
        "rf_rate_pct": RF_RATE * 100,
    }


def _benchmark(series, capital):
    """Equal-weight buy&hold of the same universe, first-common-bar entry."""
    all_ts = sorted({c["t"] for cs in series.values() for c in cs})
    if not all_ts:
        return []
    alloc = capital / len(series)
    units = {}
    last = {}
    curve = []
    idx_of = {sym: {c["t"]: i for i, c in enumerate(cs)} for sym, cs in series.items()}
    pending = dict.fromkeys(series, alloc)
    for ts in all_ts:
        total = 0.0
        for sym, cs in series.items():
            i = idx_of[sym].get(ts)
            if i is not None:
                px = cs[i]["c"]
                last[sym] = px
                if sym in pending and px > 0:
                    units[sym] = pending.pop(sym) / px
            px = last.get(sym)
            if sym in units and px:
                total += units[sym] * px
        total += sum(pending.values())
        curve.append({"t": ts, "eq": round(total, 2)})
    return curve


# ── Job runner ───────────────────────────────────────────────────────────────

def validate_config(cfg):
    strat = (cfg or {}).get("strategy") or {}
    key = strat.get("key")
    if key != "custom" and key not in STRATEGIES:
        return f"Unknown strategy '{key}'"
    if key == "custom" and not (strat.get("buy") or []) and not (strat.get("base") or {}).get("key"):
        return "Custom strategy needs at least one entry rule or a base strategy"
    if not (cfg.get("symbols") or cfg.get("index")):
        return "Pick a universe: symbols[] or index"
    return None


def start(cfg, constituents_fn, load_ohlc):
    """Validate + launch a backtest job. Returns (run_id, error)."""
    err = validate_config(cfg)
    if err:
        return None, err
    with _lock:
        running = sum(1 for j in _jobs.values() if j["status"] == "running")
        if running >= MAX_RUNNING:
            return None, "Too many backtests running — wait for one to finish."
        run_id = uuid.uuid4().hex[:12]
        _jobs[run_id] = {"status": "running", "progress": "starting…",
                         "config": cfg, "result": None, "error": None,
                         "ts": time.time()}
        # Ring: drop the oldest finished jobs beyond MAX_JOBS.
        done = sorted((k for k, j in _jobs.items() if j["status"] != "running"),
                      key=lambda k: _jobs[k]["ts"])
        for k in done[:max(0, len(_jobs) - MAX_JOBS)]:
            _jobs.pop(k, None)
    t = threading.Thread(target=_run_job, args=(run_id, cfg, constituents_fn, load_ohlc),
                         name=f"backtest-{run_id}", daemon=True)
    t.start()
    return run_id, None


def _set(run_id, **kw):
    with _lock:
        if run_id in _jobs:
            _jobs[run_id].update(**kw)


def _run_job(run_id, cfg, constituents_fn, load_ohlc):
    try:
        # Resolve the universe.
        syms = [s.strip().upper() for s in (cfg.get("symbols") or []) if s and s.strip()]
        if not syms and cfg.get("index"):
            rows, _src = constituents_fn(cfg["index"].strip().upper())
            syms = [r.get("symbol") for r in (rows or []) if r.get("symbol")]
        syms = list(dict.fromkeys(syms))[:MAX_SYMBOLS]
        if not syms:
            _set(run_id, status="error", error="No symbols in the selected universe.")
            return
        period = cfg.get("period") if cfg.get("period") in ("1y", "2y", "5y", "10y", "max") else "2y"
        if period == "max":
            period = "10y"

        series = {}
        skipped = []
        for i, sym in enumerate(syms):
            _set(run_id, progress=f"loading history {i + 1}/{len(syms)} · {sym}")
            try:
                cs = load_ohlc(sym, period, "1d")
            except Exception:
                cs = []
            cs = [c for c in (cs or []) if c.get("c") is not None and c.get("o") is not None]
            if len(cs) >= MIN_BARS:
                series[sym] = cs
            else:
                skipped.append(sym)
        if not series:
            _set(run_id, status="error",
                 error="No price history available for this universe right now — retry shortly.")
            return

        strat = cfg["strategy"]
        _set(run_id, progress="computing signals…")
        if strat.get("key") == "custom":
            signals = {sym: _custom_signals(
                cs, strat.get("buy"), strat.get("sell"),
                filters=strat.get("filters"),
                mode_buy=strat.get("mode_buy") or "all",
                mode_sell=strat.get("mode_sell") or "all",
                base=strat.get("base"))
                for sym, cs in series.items()}
        else:
            signals = {sym: _signals(cs, strat["key"], strat.get("params"))
                       for sym, cs in series.items()}

        sim = _simulate(series, signals, cfg, progress=lambda p: _set(run_id, progress=p))
        _set(run_id, progress="computing analytics…")
        stats = _metrics(sim)
        bench = _benchmark(series, sim["capital"])

        result = {
            "universe": sorted(series.keys()),
            "skipped": skipped,
            "period": period,
            "strategy": strat,
            "execution": cfg.get("execution") or "next_open",
            "stats": stats,
            "equity_curve": sim["equity_curve"],
            "benchmark_curve": bench,
            "trades": sim["trades"],
            "costs": sim["costs"],
            "asof": time.time(),
        }
        _set(run_id, status="done", progress="done", result=result)
        _save_last(run_id, cfg, result)
    except Exception as e:
        log.error("backtest %s failed: %s", run_id, e, exc_info=True)
        _set(run_id, status="error", error=str(e))


def snapshot(run_id):
    with _lock:
        j = _jobs.get(run_id)
        if j is None:
            return {"status": "unknown", "error": "No such backtest run (it may have expired).",
                    "run_id": run_id}
        return {"status": j["status"], "progress": j["progress"], "run_id": run_id,
                "error": j["error"], "result": j["result"]}


def _save_last(run_id, cfg, result):
    """Persist the most recent completed run so a restart can still show it."""
    try:
        slim = dict(result)
        slim["trades"] = slim["trades"][-500:]
        with open(_FILE + ".tmp", "w") as f:
            json.dump({"run_id": run_id, "config": cfg, "result": slim}, f)
        os.replace(_FILE + ".tmp", _FILE)
    except Exception:
        log.debug("backtest persist failed", exc_info=True)


def last_run():
    try:
        with open(_FILE) as f:
            return json.load(f)
    except Exception:
        return None


def strategies_meta():
    return [{"key": k, "label": v["label"], "params": v["params"], "blurb": v["blurb"]}
            for k, v in STRATEGIES.items()]
