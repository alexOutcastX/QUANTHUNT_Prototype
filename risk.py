# Portfolio risk analytics — pure functions over price/return series.
#
# No network and no numpy: every function here takes plain lists so the whole
# module is unit-testable offline with hand-built series. server.py fetches the
# price history (yfinance) and feeds it in; the maths lives here.
#
# Definitions used (all standard desk conventions):
#   returns      : simple daily returns  r_t = p_t / p_{t-1} - 1
#   volatility   : stdev of daily returns, annualised by sqrt(252)
#   VaR (hist)   : the q-quantile loss of the empirical return distribution
#   VaR (param)  : z(q) * sigma under a normal assumption
#   beta         : cov(asset, index) / var(index)
#   max drawdown : largest peak-to-trough decline of the equity curve
#   correlation  : Pearson r between two return series

import math

TRADING_DAYS = 252
# z-scores for one-tailed normal VaR at common confidence levels.
_Z = {0.90: 1.2816, 0.95: 1.6449, 0.99: 2.3263}


def returns(prices):
    """Simple daily returns from a price series (drops non-positive/None gaps)."""
    out = []
    prev = None
    for p in prices:
        p = _f(p)
        if p is not None and p > 0 and prev is not None and prev > 0:
            out.append(p / prev - 1.0)
        if p is not None and p > 0:
            prev = p
    return out


def _f(v):
    try:
        if v is None:
            return None
        return float(v)
    except Exception:
        return None


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0.0


def stdev(xs, sample=True):
    xs = [x for x in xs if x is not None]
    n = len(xs)
    if n < 2:
        return 0.0
    m = sum(xs) / n
    var = sum((x - m) ** 2 for x in xs) / (n - 1 if sample else n)
    return math.sqrt(var)


def volatility(rets, annualise=True):
    s = stdev(rets)
    return s * math.sqrt(TRADING_DAYS) if annualise else s


def historical_var(rets, conf=0.95):
    """Empirical VaR: the loss not exceeded with `conf` probability, as a
    positive fraction (0.03 == a 3% one-day loss). Returns None if too few."""
    xs = sorted(r for r in rets if r is not None)
    if len(xs) < 20:
        return None
    idx = int((1 - conf) * len(xs))
    idx = min(max(idx, 0), len(xs) - 1)
    q = xs[idx]
    return round(-q, 5) if q < 0 else 0.0


def parametric_var(rets, conf=0.95):
    """Normal-assumption VaR = z(conf) * sigma - mean, as a positive fraction."""
    if len([r for r in rets if r is not None]) < 20:
        return None
    z = _Z.get(round(conf, 2), 1.6449)
    v = z * stdev(rets) - mean(rets)
    return round(max(v, 0.0), 5)


def covariance(a, b):
    n = min(len(a), len(b))
    if n < 2:
        return 0.0
    a, b = a[-n:], b[-n:]
    ma, mb = sum(a) / n, sum(b) / n
    return sum((a[i] - ma) * (b[i] - mb) for i in range(n)) / (n - 1)


def beta(asset_rets, index_rets):
    """cov(asset, index) / var(index) — sensitivity to the benchmark."""
    n = min(len(asset_rets), len(index_rets))
    if n < 2:
        return None
    a, b = asset_rets[-n:], index_rets[-n:]
    var_i = covariance(b, b)
    if var_i == 0:
        return None
    return round(covariance(a, b) / var_i, 4)


def correlation(a, b):
    n = min(len(a), len(b))
    if n < 2:
        return None
    a, b = a[-n:], b[-n:]
    sa, sb = stdev(a), stdev(b)
    if sa == 0 or sb == 0:
        return None
    return round(covariance(a, b) / (sa * sb), 4)


def max_drawdown(prices):
    """Largest peak-to-trough decline of a price/equity series, as a positive
    fraction. Also returns the peak and trough values."""
    ps = [_f(p) for p in prices if _f(p) is not None and _f(p) > 0]
    if len(ps) < 2:
        return {"mdd": None, "peak": None, "trough": None}
    peak = ps[0]
    mdd = 0.0
    peak_at = trough_at = ps[0]
    for p in ps:
        if p > peak:
            peak = p
        dd = (peak - p) / peak if peak else 0.0
        if dd > mdd:
            mdd, peak_at, trough_at = dd, peak, p
    return {"mdd": round(mdd, 5), "peak": round(peak_at, 2), "trough": round(trough_at, 2)}


def sharpe(rets, rf_annual=0.065):
    """Annualised Sharpe using a daily-decomposed risk-free rate."""
    s = stdev(rets)
    if s == 0:
        return None
    rf_daily = rf_annual / TRADING_DAYS
    excess = mean(rets) - rf_daily
    return round((excess / s) * math.sqrt(TRADING_DAYS), 3)


def portfolio_series(holdings, hist):
    """Combine per-symbol price histories into a portfolio equity curve.

    holdings: [{"symbol","qty"}]; hist: {symbol: [prices...]} aligned tail-wise.
    Returns (equity_series, weights_by_symbol) using the latest price as weight.
    """
    syms = [h for h in holdings if hist.get(h["symbol"])]
    if not syms:
        return [], {}
    n = min(len(hist[h["symbol"]]) for h in syms)
    if n < 2:
        return [], {}
    equity = []
    for i in range(-n, 0):
        v = 0.0
        for h in syms:
            price = _f(hist[h["symbol"]][i])
            qty = _f(h.get("qty")) or 0
            if price is not None:
                v += price * qty
        equity.append(v)
    last_vals = {}
    total = 0.0
    for h in syms:
        price = _f(hist[h["symbol"]][-1]) or 0
        qty = _f(h.get("qty")) or 0
        val = price * qty
        last_vals[h["symbol"]] = val
        total += val
    weights = {s: round(v / total, 4) for s, v in last_vals.items()} if total else {}
    return equity, weights


def analyze(holdings, hist, index_prices=None, conf=0.95):
    """Full risk report for a portfolio: value, weights, vol, VaR, drawdown,
    Sharpe, beta vs index, and the per-symbol correlation to the portfolio."""
    equity, weights = portfolio_series(holdings, hist)
    if len(equity) < 2:
        return {"ok": False, "reason": "insufficient history"}

    port_rets = returns(equity)
    idx_rets = returns(index_prices) if index_prices else None

    corr = {}
    for h in holdings:
        ps = hist.get(h["symbol"])
        if ps:
            c = correlation(returns(ps), port_rets)
            if c is not None:
                corr[h["symbol"]] = c

    var_pct = historical_var(port_rets, conf)
    value = equity[-1]
    return {
        "ok": True,
        "value": round(value, 2),
        "weights": weights,
        "volatility_annual": round(volatility(port_rets), 5),
        "var_pct": var_pct,
        "var_amount": round(var_pct * value, 2) if (var_pct and value) else None,
        "var_param_pct": parametric_var(port_rets, conf),
        "drawdown": max_drawdown(equity),
        "sharpe": sharpe(port_rets),
        "beta": beta(port_rets, idx_rets) if idx_rets else None,
        "correlations": corr,
        "conf": conf,
        "days": len(port_rets),
    }
