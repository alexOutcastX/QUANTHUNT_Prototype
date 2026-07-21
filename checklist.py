"""10-point fundamental checklist for the dossier + multibagger analyser.

A quick growth-quality-value scorecard on one page:
  1. 3-yr Sales CAGR              2. 3-yr Net Profit CAGR
  3. 3-yr EPS CAGR               4. EPS growth (this year)
  5. P/E                         6. PEG (P/E ÷ this-year EPS growth)
  7. Operating Cash Flow          8. OCF ÷ Net Profit (earnings quality)
  9. Debt (with D/E)             10. Interest coverage (EBIT ÷ interest)

`build(data)` is pure (no network) so it is unit-tested with synthetic inputs;
`analyse(symbol)` does the yfinance fetch and hands the extracted series to it.
Every item degrades to a 'na' verdict when its inputs are missing, so a stock
with thin financials still renders a partial checklist instead of erroring.
"""
import logging

log = logging.getLogger("checklist")


def _num(x):
    try:
        f = float(x)
        return f if f == f else None  # drop NaN
    except Exception:
        return None


def _cagr(series):
    """CAGR % from an oldest→newest series. None unless the base and final value
    are both positive (a CAGR across a sign change is meaningless)."""
    xs = [_num(x) for x in (series or [])]
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    first, last, years = xs[0], xs[-1], len(xs) - 1
    if first <= 0 or last <= 0 or years <= 0:
        return None
    return round((((last / first) ** (1.0 / years)) - 1) * 100, 1)


def _yoy(series):
    """Latest-year growth %: (newest / previous − 1). None if the prior base
    isn't positive."""
    xs = [_num(x) for x in (series or [])]
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    prev, cur = xs[-2], xs[-1]
    if prev is None or prev <= 0 or cur is None:
        return None
    return round((cur / prev - 1) * 100, 1)


def _verdict(value, good, ok, higher_better=True):
    """'good' / 'ok' / 'bad' from thresholds; 'na' when value is None."""
    if value is None:
        return "na"
    if higher_better:
        return "good" if value >= good else "ok" if value >= ok else "bad"
    return "good" if value <= good else "ok" if value <= ok else "bad"


def _pct(v, dp=1):
    return None if v is None else f"{v:+.{dp}f}%"


def build(data: dict) -> dict:
    """Compute the 10-point checklist from extracted fundamentals. `data` keys
    (all optional): rev_series, pat_series, eps_series (oldest→newest lists),
    pe, ocf_cr, net_profit_cr, total_debt_cr, debt_equity, ebit_cr,
    interest_cr, eps_growth_yr (override for item 4)."""
    rev = data.get("rev_series")
    pat = data.get("pat_series")
    eps = data.get("eps_series")

    sales_cagr = _cagr(rev)
    pat_cagr = _cagr(pat)
    eps_cagr = _cagr(eps)
    eps_yoy = data.get("eps_growth_yr")
    if eps_yoy is None:
        eps_yoy = _yoy(eps)

    pe = _num(data.get("pe"))
    peg = None
    if pe is not None and eps_yoy is not None and eps_yoy > 0:
        peg = round(pe / eps_yoy, 2)

    ocf = _num(data.get("ocf_cr"))
    net = _num(data.get("net_profit_cr"))
    ocf_to_net = None
    if ocf is not None and net is not None and net > 0:
        ocf_to_net = round(ocf / net, 2)

    total_debt = _num(data.get("total_debt_cr"))
    de = _num(data.get("debt_equity"))

    ebit = _num(data.get("ebit_cr"))
    interest = _num(data.get("interest_cr"))
    icr = None
    if ebit is not None and interest is not None:
        if abs(interest) < 1e-9:
            icr = 999.0            # no interest burden → effectively uncapped
        elif interest > 0:
            icr = round(ebit / interest, 1)

    def cr(v):
        return None if v is None else (f"₹{v:,.0f} Cr")

    items = [
        {"key": "sales_cagr", "label": "3-yr Sales CAGR", "value": _pct(sales_cagr),
         "verdict": _verdict(sales_cagr, 15, 8)},
        {"key": "pat_cagr", "label": "3-yr Net Profit CAGR", "value": _pct(pat_cagr),
         "verdict": _verdict(pat_cagr, 15, 8)},
        {"key": "eps_cagr", "label": "3-yr EPS growth (CAGR)", "value": _pct(eps_cagr),
         "verdict": _verdict(eps_cagr, 15, 8)},
        {"key": "eps_yoy", "label": "EPS growth (this year)", "value": _pct(eps_yoy),
         "verdict": _verdict(eps_yoy, 15, 0)},
        {"key": "pe", "label": "P/E", "value": (None if pe is None else f"{pe:.1f}"),
         "verdict": _verdict(pe, 25, 45, higher_better=False)},
        {"key": "peg", "label": "PEG (P/E ÷ EPS growth)", "value": (None if peg is None else f"{peg:.2f}"),
         "verdict": _verdict(peg, 1.0, 2.0, higher_better=False)},
        {"key": "ocf", "label": "Operating Cash Flow", "value": cr(ocf),
         "verdict": ("na" if ocf is None else "good" if ocf > 0 else "bad")},
        {"key": "ocf_net", "label": "OCF ÷ Net Profit", "value": (None if ocf_to_net is None else f"{ocf_to_net:.2f}x"),
         "verdict": _verdict(ocf_to_net, 0.8, 0.5)},
        {"key": "debt", "label": "Debt (D/E)", "value": (
            "Debt-free" if (total_debt is not None and total_debt <= 0) else
            (cr(total_debt) + (f" · D/E {de:.2f}" if de is not None else "")) if total_debt is not None else
            (f"D/E {de:.2f}" if de is not None else None)),
         "verdict": _verdict(de, 0.3, 1.0, higher_better=False) if de is not None
                    else ("good" if (total_debt is not None and total_debt <= 0) else "na")},
        {"key": "icr", "label": "Interest coverage", "value": (
            None if icr is None else ("—" if icr >= 999 else f"{icr:.1f}x")),
         "verdict": _verdict(icr, 5, 2.5)},
    ]

    scored = [i for i in items if i["verdict"] != "na"]
    passed = sum(1 for i in items if i["verdict"] == "good")
    ok = sum(1 for i in items if i["verdict"] == "ok")
    # Score: good = full weight, ok = half, over the items we could actually judge.
    score = round((passed + ok * 0.5) / len(scored) * 100) if scored else None
    return {
        "items": items,
        "passed": passed,
        "ok": ok,
        "scored": len(scored),
        "total": len(items),
        "score": score,
    }


def _series(df, names):
    """Pull the first matching row from a yfinance statement DataFrame as an
    oldest→newest Python list. yfinance columns are newest-first, so reverse."""
    if df is None:
        return None
    try:
        idx = {str(r).strip().lower(): r for r in df.index}
        for n in names:
            r = idx.get(n.lower())
            if r is not None:
                vals = list(df.loc[r])[::-1]        # oldest → newest
                return [(_num(v)) for v in vals]
    except Exception:
        pass
    return None


def _latest(df, names):
    s = _series(df, names)
    if s:
        for v in reversed(s):
            if v is not None:
                return v
    return None


def analyse(symbol: str, suffix: str = ".NS") -> dict:
    """Fetch fundamentals for `symbol` and build the checklist. Never raises."""
    try:
        import yfinance as yf
    except Exception:
        return {"symbol": symbol, "items": [], "error": "engine unavailable"}
    try:
        t = yf.Ticker(f"{symbol}{suffix}")
        inc = getattr(t, "income_stmt", None)
        cf = getattr(t, "cashflow", None)
        bs = getattr(t, "balance_sheet", None)
        info = t.info or {}

        def to_cr(v):
            return None if _num(v) is None else round(_num(v) / 1e7, 1)  # ₹ → crore

        rev = _series(inc, ["Total Revenue", "Operating Revenue"])
        pat = _series(inc, ["Net Income", "Net Income Common Stockholders"])
        eps = _series(inc, ["Diluted EPS", "Basic EPS"])
        ocf = _latest(cf, ["Operating Cash Flow", "Total Cash From Operating Activities", "Cash Flow From Continuing Operating Activities"])
        net_latest = _latest(inc, ["Net Income", "Net Income Common Stockholders"])
        ebit = _latest(inc, ["EBIT", "Operating Income", "Total Operating Income As Reported"])
        interest = _latest(inc, ["Interest Expense", "Interest Expense Non Operating"])
        total_debt = info.get("totalDebt")
        de = info.get("debtToEquity")

        data = {
            "rev_series": [to_cr(x) for x in rev] if rev else None,
            "pat_series": [to_cr(x) for x in pat] if pat else None,
            "eps_series": eps,
            "pe": info.get("trailingPE"),
            "eps_growth_yr": (round(_num(info.get("earningsGrowth")) * 100, 1)
                              if _num(info.get("earningsGrowth")) is not None else None),
            "ocf_cr": to_cr(ocf),
            "net_profit_cr": to_cr(net_latest),
            "total_debt_cr": to_cr(total_debt),
            "debt_equity": round(_num(de) / 100, 2) if _num(de) is not None else None,
            "ebit_cr": to_cr(ebit),
            "interest_cr": to_cr(abs(interest)) if _num(interest) is not None else None,
        }
        out = build(data)
        out["symbol"] = symbol
        return out
    except Exception as e:
        log.warning("checklist %s failed: %s", symbol, e)
        return {"symbol": symbol, "items": [], "error": "Couldn't build the checklist right now."}
