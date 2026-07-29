"""Penny-stock screen — cheap shares, graded by whether you could actually own them.

A list of low-priced tickers is the easiest screen in the world to write and the
most dangerous one to publish. In the Indian market the penny segment is where
retail money goes to die: shells with no revenue, operator-driven pump-and-dumps,
and scrips that trade a few lakh a day and lock in a circuit the moment you want
out. A screener that returns "here are 400 stocks under ₹10" is not a tool, it's
a target list for somebody else's exit.

So this screen leads with the two things that decide whether a cheap stock is an
opportunity or a trap:

  • LIQUIDITY — from the exchange's own turnover. A stock you cannot sell is not
    an investment at any price, and this is knowable before you buy.
  • SUBSTANCE — does a business exist underneath? Earnings, operating cash flow,
    debt, book value. Cheap because it's small is a different thing from cheap
    because it's worth nothing.

Every row carries a risk grade and the specific flags behind it. Nothing is
hidden — an illiquid loss-making shell still appears, labelled as one, because
the user asked to see the segment and filtering it away silently would just make
them look somewhere with no warnings at all.

Price and turnover come from the NSE bhavcopy the universe is already built
from, so the whole screen costs no extra market-data calls. Fundamentals come
from the warm cache. Pure stdlib and pure functions — the grading is unit-tested
without a network.
"""
from __future__ import annotations

import logging

log = logging.getLogger("penny_screen")

# ── price bands (₹) ──────────────────────────────────────────────────────────
# "Penny stock" has no statutory definition in India. These are the bands the
# market actually talks in; the UI exposes them and the user picks.
BANDS = {
    "under10": {"label": "Under ₹10", "lo": 0.0, "hi": 10.0,
                "note": "The classic penny band — and the one where almost every "
                        "listed shell sits."},
    "10to50": {"label": "₹10 – ₹50", "lo": 10.0, "hi": 50.0,
               "note": "Low-priced but not always tiny — some real small-caps "
                       "trade here on a large share count."},
    "50to100": {"label": "₹50 – ₹100", "lo": 50.0, "hi": 100.0,
                "note": "Cheap by price, frequently ordinary small-caps. A low "
                        "share price is not the same as a low valuation."},
    "under100": {"label": "Everything under ₹100", "lo": 0.0, "hi": 100.0,
                 "note": "The whole low-priced segment."},
}
DEFAULT_BAND = "under10"

# ── liquidity grades, on daily traded value (₹) ──────────────────────────────
# The number that decides whether you can get out. A ₹20 lakh/day counter cannot
# absorb a ₹2 lakh sell order without moving several percent.
LIQ_TRADEABLE = 2_00_00_000     # ₹2 crore/day and up
LIQ_THIN = 25_00_000            # ₹25 lakh/day and up
LIQUIDITY = {
    "tradeable": "Trades enough that a retail-sized order can get in and out.",
    "thin": "Thin — a modest order moves the price, and exits take days.",
    "illiquid": "Effectively untradeable. You may not be able to sell at any "
                "sensible price when you want to.",
    "unknown": "No turnover reported for the latest session.",
}

# ── risk weights ─────────────────────────────────────────────────────────────
# Higher score = MORE dangerous. This is the opposite polarity to every other
# score in the app, which is deliberate: on this screen a big number is a
# warning, not a recommendation.
RISK = {
    "illiquid": 30,
    "thin": 14,
    "no_fundamentals": 18,
    "loss_making": 20,
    "negative_ocf": 14,
    "high_debt": 14,
    "negative_equity": 22,
    "nano_cap": 12,
    "no_revenue_growth": 6,
    "far_below_high": 6,
}
GRADE_BANDS = ((70, "extreme"), (45, "high"), (25, "elevated"), (0, "moderate"))


def _num(v):
    try:
        f = float(v)
        return f if f == f and abs(f) != float("inf") else None
    except (TypeError, ValueError):
        return None


def liquidity_grade(turnover):
    """Daily traded value → a grade. `turnover` is rupees, as the bhavcopy
    reports it (TURNOVER_LACS scaled up in the universe loader)."""
    t = _num(turnover)
    if t is None or t <= 0:
        return "unknown"
    if t >= LIQ_TRADEABLE:
        return "tradeable"
    if t >= LIQ_THIN:
        return "thin"
    return "illiquid"


def band_of(price):
    """The narrowest named band a price falls in ('under10' before '10to50')."""
    p = _num(price)
    if p is None or p <= 0:
        return None
    for key in ("under10", "10to50", "50to100"):
        b = BANDS[key]
        if b["lo"] <= p < b["hi"]:
            return key
    return None


def assess(row: dict, fund: dict = None) -> dict:
    """Grade one low-priced stock. `row` is a universe entry (symbol, price,
    turnover, chg); `fund` is its cached fundamentals or None.

    Returns the risk grade, the flags behind it, and the positives — pure, so
    the judgement that reaches the user is testable without a network."""
    fund = fund or {}
    price = _num(row.get("price"))
    turnover = _num(row.get("turnover"))
    liq = liquidity_grade(turnover)

    flags = []          # what makes this dangerous
    positives = []      # what argues it is a real business
    score = 0

    # 1 · Can you get out?
    if liq == "illiquid":
        score += RISK["illiquid"]
        flags.append(f"Illiquid — about ₹{(turnover or 0) / 1e5:,.1f} lakh traded on the "
                     f"latest session. Exiting a position may not be possible at a fair price.")
    elif liq == "thin":
        score += RISK["thin"]
        flags.append(f"Thin volume — roughly ₹{(turnover or 0) / 1e7:,.2f} crore a day. "
                     f"Expect slippage on the way in and the way out.")
    elif liq == "unknown":
        score += RISK["illiquid"]
        flags.append("No turnover reported in the latest session — it may not have traded at all.")
    else:
        positives.append(f"Traded about ₹{(turnover or 0) / 1e7:,.1f} crore in the latest "
                         f"session — liquid enough to enter and exit.")

    # 2 · Is there a business under the price?
    eps = _num(fund.get("eps"))
    roe = _num(fund.get("roe"))
    de = _num(fund.get("debt_equity"))
    ocf = _num(fund.get("ocf_cr"))
    mcap = _num(fund.get("market_cap_cr"))
    pb = _num(fund.get("pb"))
    rev_g = _num(fund.get("revenue_growth_pct"))

    if not fund or all(v is None for v in (eps, roe, de, mcap)):
        score += RISK["no_fundamentals"]
        flags.append("No fundamental data published for this scrip. For a stock this cheap "
                     "that absence is itself the finding — you would be buying blind.")
    else:
        if eps is not None:
            if eps > 0:
                positives.append(f"Profitable — earnings of ₹{eps:,.2f} a share.")
            else:
                score += RISK["loss_making"]
                flags.append(f"Loss-making — earnings of ₹{eps:,.2f} a share. The price is low "
                             f"because the company is losing money.")
        if ocf is not None:
            if ocf > 0:
                positives.append(f"Operating cash flow positive at ₹{ocf:,.0f} crore — the "
                                 f"business funds itself.")
            else:
                score += RISK["negative_ocf"]
                flags.append(f"Burning cash — operating cash flow of ₹{ocf:,.0f} crore. It needs "
                             f"outside money to keep going.")
        if de is not None:
            if de > 2:
                score += RISK["high_debt"]
                flags.append(f"Heavily indebted — debt/equity of {de:.2f}. Lenders rank ahead of "
                             f"you, and at this size refinancing is not guaranteed.")
            elif de <= 0.5:
                positives.append(f"Low debt — debt/equity of {de:.2f}.")
        if roe is not None and roe > 12:
            positives.append(f"Return on equity of {roe:.1f}% — it earns on the capital it holds.")
        if pb is not None and pb < 0:
            score += RISK["negative_equity"]
            flags.append("Negative book value — liabilities exceed assets. Equity holders are "
                         "last in line and there may be nothing left for them.")
        if mcap is not None and mcap < 100:
            score += RISK["nano_cap"]
            flags.append(f"Nano-cap at ₹{mcap:,.0f} crore. Companies this small are outside index "
                         f"and institutional coverage, and are the easiest to manipulate.")
        elif mcap is not None:
            positives.append(f"Market capitalisation of ₹{mcap:,.0f} crore.")
        if rev_g is not None:
            if rev_g > 15:
                positives.append(f"Revenue growing {rev_g:.1f}% year on year.")
            elif rev_g < 0:
                score += RISK["no_revenue_growth"]
                flags.append(f"Revenue shrinking {abs(rev_g):.1f}% year on year.")

    grade = next(g for cut, g in GRADE_BANDS if score >= cut)
    return {
        "risk_score": min(100, score),
        "risk_grade": grade,
        "liquidity": liq,
        "liquidity_note": LIQUIDITY[liq],
        "flags": flags,
        "positives": positives,
        "band": band_of(price),
        "has_fundamentals": bool(fund),
    }


def screen(universe: list, funds: dict = None, band: str = DEFAULT_BAND,
           min_turnover: float = 0.0, max_risk: str = None, exchange: str = None,
           limit: int = 300) -> dict:
    """Run the screen over a universe. Pure — hand it bhavcopy rows and a
    fundamentals map and it returns the graded list.

    `min_turnover` is the user's own liquidity floor in rupees; `max_risk` caps
    the grade. Both default to off, so the unfiltered segment is what you see
    first — with its warnings attached."""
    b = BANDS.get(band) or BANDS[DEFAULT_BAND]
    funds = funds or {}
    order = {g: i for i, (_cut, g) in enumerate(GRADE_BANDS)}   # extreme=0 … moderate=3
    cap = order.get(max_risk) if max_risk in order else None

    rows = []
    scanned = 0
    for item in universe or []:
        sym = item.get("symbol")
        price = _num(item.get("price"))
        if not sym or price is None or price <= 0:
            continue
        if not (b["lo"] <= price < b["hi"]):
            continue
        scanned += 1
        turnover = _num(item.get("turnover")) or 0.0
        if min_turnover and turnover < min_turnover:
            continue
        if exchange and (item.get("exchange") or "NSE") != exchange:
            continue
        f = funds.get(sym) or {}
        a = assess(item, f)
        if cap is not None and order[a["risk_grade"]] < cap:
            continue
        rows.append({
            "symbol": sym,
            "name": item.get("name") or sym,
            "exchange": item.get("exchange") or "NSE",
            "price": round(price, 2),
            "chg": _num(item.get("chg")),
            "turnover": round(turnover, 2),
            "turnover_cr": round(turnover / 1e7, 3),
            "market_cap_cr": _num(f.get("market_cap_cr")),
            "eps": _num(f.get("eps")),
            "pe": _num(f.get("pe")),
            "pb": _num(f.get("pb")),
            "roe": _num(f.get("roe")),
            "debt_equity": _num(f.get("debt_equity")),
            "ocf_cr": _num(f.get("ocf_cr")),
            "revenue_growth_pct": _num(f.get("revenue_growth_pct")),
            "sector": f.get("sector"),
            **a,
        })

    # Most tradeable first, then least risky, then biggest. Liquidity leads
    # because it is the constraint that actually binds in this segment.
    liq_rank = {"tradeable": 0, "thin": 1, "unknown": 2, "illiquid": 3}
    rows.sort(key=lambda r: (liq_rank.get(r["liquidity"], 3), r["risk_score"],
                             -(r["market_cap_cr"] or 0)))
    total = len(rows)
    return {
        "band": band,
        "band_label": b["label"],
        "band_note": b["note"],
        "rows": rows[:max(1, int(limit))],
        "count": min(total, max(1, int(limit))),
        "matches": total,
        "in_band": scanned,
        "truncated": total > limit,
        "grades": _tally(rows, "risk_grade"),
        "liquidity_mix": _tally(rows, "liquidity"),
        "with_fundamentals": len([r for r in rows if r["has_fundamentals"]]),
        "bands": [{"key": k, **{kk: vv for kk, vv in v.items()}} for k, v in BANDS.items()],
        "thresholds": {"tradeable": LIQ_TRADEABLE, "thin": LIQ_THIN},
    }


def _tally(rows: list, key: str) -> dict:
    out = {}
    for r in rows:
        out[r[key]] = out.get(r[key], 0) + 1
    return out
