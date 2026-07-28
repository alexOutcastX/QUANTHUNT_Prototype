"""Valuation engine for the institutional dossier.

Turns the numbers the dossier has already fetched — price, EPS, book value,
multi-year revenue and PAT, debt, cash, free cash flow — into a valuation
section: multiples with their reciprocal yields, four independent intrinsic-value
estimates, the growth the market is currently pricing in, and a fair-value range
built from whichever methods could actually answer.

Three rules run through all of it.

1. NO NUMBER WITHOUT ITS INPUTS. Every estimate returns the assumptions it used
   (discount rate, horizon, terminal growth, the growth figure it took) so a
   reader can disagree with the answer by disagreeing with an input, rather than
   having to trust it.

2. SILENCE BEATS A WRONG NUMBER. A loss-making company has no meaningful P/E, a
   negative book value has no Graham number, negative free cash flow has no DCF.
   Those return None with a stated reason instead of a figure that would look
   authoritative and be meaningless. This matters most for screening: a fake
   'cheap' reading is worse than a blank.

3. A RANGE, NOT A POINT. Any single model is a guess about the future dressed as
   arithmetic. The verdict comes from where the price sits against the spread of
   methods that answered, and always reports how many that was.

Pure Python, no I/O, no network — every input is passed in.
"""
from __future__ import annotations

import math

# ---------- assumptions, stated once and returned with every result ----------
# Discount rate for the DCF. India's 10-year sovereign has sat near 7%, and a
# mid-single-digit equity risk premium on top puts a broad-market cost of equity
# near 13%. Deliberately NOT per-stock: a beta-adjusted rate implies a precision
# this data does not support.
DISCOUNT_RATE = 0.13
# Terminal growth. Below long-run nominal GDP on purpose — a company cannot
# outgrow its economy forever, and a terminal rate near the discount rate makes
# the result explode.
TERMINAL_GROWTH = 0.04
# Explicit forecast horizon before the terminal value takes over.
DCF_YEARS = 10
# Growth is capped before it enters any model. A company posting 80% is not
# compounding at 80% for a decade, and an uncapped figure dominates the output.
MAX_GROWTH = 0.25
# Graham's original formula used 22.5 = 15x earnings * 1.5x book.
GRAHAM_FACTOR = 22.5
# Fair multiple for the earnings-power estimate: a no-growth business earning a
# steady stream is worth roughly the inverse of the discount rate (1/0.13 ≈ 7.7).
EPV_MULTIPLE = 1.0 / DISCOUNT_RATE

ASSUMPTIONS = {
    "discount_rate_pct": round(DISCOUNT_RATE * 100, 1),
    "terminal_growth_pct": round(TERMINAL_GROWTH * 100, 1),
    "horizon_years": DCF_YEARS,
    "growth_cap_pct": round(MAX_GROWTH * 100, 1),
}


def _f(x):
    """Finite float or None. Guards against NaN/inf leaking in from providers."""
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    v = float(x)
    return v if math.isfinite(v) else None


def _pos(x):
    v = _f(x)
    return v if v is not None and v > 0 else None


def _round(x, n=2):
    v = _f(x)
    return round(v, n) if v is not None else None


# Estimates split into two kinds, and the distinction matters.
#
#   "growth" — DCF and the dividend model price the future, so they answer the
#              question "what is this worth if it keeps compounding".
#   "floor"  — the Graham number and earnings-power value deliberately assume NO
#              growth. They are a margin-of-safety floor, not a fair value.
#
# Averaging the two kinds together would call every quality compounder
# expensive, because the floor methods are built to ignore exactly what such a
# business is worth paying for. So the headline range comes from the growth
# methods, and the floor is reported separately as what the business is worth
# if growth stops entirely.
KIND_GROWTH = "growth"
KIND_FLOOR = "floor"


def _est(value, method, kind, note, **inputs):
    """One intrinsic-value estimate, carrying what produced it."""
    return {"method": method, "kind": kind, "value": _round(value),
            "note": note, "inputs": inputs}


def _skip(method, kind, reason):
    return {"method": method, "kind": kind, "value": None, "note": reason, "inputs": {}}


# ---------- growth ----------
def _cagr(first, last, years):
    if years <= 0:
        return None
    a, b = _pos(first), _pos(last)
    if a is None or b is None:
        return None
    return (b / a) ** (1.0 / years) - 1.0


def earnings_growth(fin_years, fallback_pct=None):
    """Sustainable growth rate as a fraction, with the reasoning.

    Prefers the PAT CAGR across the full reported history — one year's spike
    says little — and falls back to the latest reported YoY only when there is
    no usable series. Capped at MAX_GROWTH; never negative, because feeding a
    shrinking rate into a DCF produces a value that says 'this company winds
    itself down', which is a much stronger claim than the data supports.
    """
    rows = [r for r in (fin_years or []) if isinstance(r, dict)]
    # fin_years arrives newest-first from the report; oldest-first is what a
    # CAGR needs.
    series = [_f(r.get("net_income")) for r in rows][::-1]
    series = [v for v in series if v is not None]
    if len(series) >= 3 and series[0] > 0 and series[-1] > 0:
        g = _cagr(series[0], series[-1], len(series) - 1)
        if g is not None:
            capped = max(0.0, min(MAX_GROWTH, g))
            return capped, "PAT CAGR over %d reported years%s" % (
                len(series), " (capped)" if g > MAX_GROWTH else "")
    g = _f(fallback_pct)
    if g is not None:
        capped = max(0.0, min(MAX_GROWTH, g / 100.0))
        return capped, "latest reported YoY earnings growth%s" % (
            " (capped)" if g / 100.0 > MAX_GROWTH else "")
    return None, "no usable earnings history"


# ---------- intrinsic value models ----------
def dcf_per_share(fcf_cr, shares_cr, growth, discount=DISCOUNT_RATE,
                  terminal=TERMINAL_GROWTH, years=DCF_YEARS):
    """Two-stage discounted cash flow, per share.

    Grows free cash flow for `years`, discounts each year back, then adds a
    Gordon terminal value. Returns None on negative FCF: a company burning cash
    has no positive discounted stream, and forcing one would invent a floor
    under a business that may not have one.
    """
    f0, sh = _pos(fcf_cr), _pos(shares_cr)
    if f0 is None or sh is None or growth is None:
        return None
    if discount <= terminal:      # Gordon denominator would go negative
        return None
    pv = 0.0
    cf = f0
    for yr in range(1, years + 1):
        cf *= (1.0 + growth)
        pv += cf / ((1.0 + discount) ** yr)
    terminal_val = cf * (1.0 + terminal) / (discount - terminal)
    pv += terminal_val / ((1.0 + discount) ** years)
    return pv / sh


def implied_growth(price, fcf_cr, shares_cr, discount=DISCOUNT_RATE,
                   terminal=TERMINAL_GROWTH, years=DCF_YEARS):
    """Reverse DCF: the growth rate that makes the DCF equal today's price.

    The most useful line in a valuation section, because it inverts the burden
    of proof — instead of arguing about a fair value, you ask whether the growth
    already in the price is achievable. Binary search over a wide bracket;
    returns None when even 0% growth already exceeds the price (the market is
    pricing decline, which this model cannot express).
    """
    p, f0, sh = _pos(price), _pos(fcf_cr), _pos(shares_cr)
    if p is None or f0 is None or sh is None:
        return None
    lo, hi = 0.0, 0.60
    if dcf_per_share(f0, sh, lo, discount, terminal, years) > p:
        return None               # priced below a no-growth valuation
    if dcf_per_share(f0, sh, hi, discount, terminal, years) < p:
        return None               # needs more than 60% — off the scale
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if dcf_per_share(f0, sh, mid, discount, terminal, years) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def graham_number(eps, bvps):
    """sqrt(22.5 * EPS * book value per share) — Benjamin Graham's ceiling for a
    defensive buyer. Needs both positive; a loss or negative book returns None."""
    e, b = _pos(eps), _pos(bvps)
    if e is None or b is None:
        return None
    return math.sqrt(GRAHAM_FACTOR * e * b)


def earnings_power_value(eps, multiple=EPV_MULTIPLE):
    """What the current earnings stream is worth assuming NO growth at all.

    Deliberately the most conservative estimate here. Where price sits versus
    this number is the cleanest read on how much of the valuation is a bet on
    the future rather than on what the business earns today.
    """
    e = _pos(eps)
    return e * multiple if e is not None else None


def dividend_discount(price, dividend_yield_pct, growth, discount=DISCOUNT_RATE):
    """Gordon growth on the current dividend. Only meaningful for real payers,
    so anything under a 0.5% yield is skipped rather than answered."""
    p, y = _pos(price), _f(dividend_yield_pct)
    if p is None or y is None or y < 0.5 or growth is None:
        return None
    d0 = p * (y / 100.0)
    if discount <= growth:
        return None
    return d0 * (1.0 + growth) / (discount - growth)


# ---------- public ----------
def _peer_block(multiples, roe_pct, sector, peers):
    """Where each multiple sits against its sector median.

    This is the context a raw multiple cannot carry: 28x is dear for a bank and
    ordinary for a consumer brand. `peers` comes from the cached universe (see
    fundamentals.sector_medians), so it costs nothing to include and is simply
    absent when too few companies in the sector have been scraped.
    """
    if not peers:
        return None
    rows = []
    pairs = (("pe", "P/E", multiples.get("pe"), True),
             ("pb", "P/B", multiples.get("pb"), True),
             ("roe", "ROE", _f(roe_pct), False),
             ("dividend_yield", "Dividend yield", multiples.get("dividend_yield_pct"), False))
    for key, label, mine, lower_is_cheaper in pairs:
        med = _f(peers.get(key))
        if mine is None or med is None or med == 0:
            continue
        diff = (mine - med) / abs(med) * 100.0
        rows.append({
            "label": label,
            "value": _round(mine),
            "sector": _round(med),
            "diff_pct": _round(diff, 1),
            # "cheaper" is only meaningful for valuation multiples; for ROE and
            # yield, higher is simply better, so the wording differs.
            "read": (("below" if diff < 0 else "above") + " sector")
            if lower_is_cheaper else (("above" if diff > 0 else "below") + " sector"),
        })
    if not rows:
        return None
    return {"sector": sector, "n": peers.get("n"), "rows": rows}


def value(*, price=None, eps=None, pe=None, pb=None, market_cap_cr=None,
          fcf_cr=None, ocf_cr=None, total_debt_cr=None, cash_cr=None,
          revenue_cr=None, op_income_cr=None, dividend_yield_pct=None,
          earnings_growth_pct=None, fin_years=None, roe_pct=None,
          sector=None, peers=None) -> dict:
    """Full valuation for one company. Every argument optional; whatever is
    missing simply narrows the output rather than failing it."""
    price = _pos(price)
    eps = _f(eps)
    mcap = _pos(market_cap_cr)

    # Book value per share, derived from P/B rather than requiring a separate
    # balance-sheet lookup.
    bvps = None
    if price is not None and _pos(pb) is not None:
        bvps = price / pb
    # Share count in crore, from market cap and price — used by the DCF so it
    # never needs a shares-outstanding feed of its own.
    shares_cr = (mcap / price) if (mcap is not None and price is not None) else None

    growth, growth_note = earnings_growth(fin_years, earnings_growth_pct)

    # ---- multiples and their yields ----
    ev = None
    if mcap is not None:
        debt = _f(total_debt_cr) or 0.0
        csh = _f(cash_cr) or 0.0
        ev = mcap + debt - csh
    ebitda = _f(op_income_cr)          # operating income as the EBITDA proxy

    multiples = {
        "pe": _round(pe if _f(pe) is not None else
                     (price / eps if (price is not None and _pos(eps)) else None)),
        "pb": _round(pb),
        "ev_cr": _round(ev),
        "ev_ebitda": _round(ev / ebitda) if (ev is not None and _pos(ebitda)) else None,
        "ev_sales": _round(ev / revenue_cr) if (ev is not None and _pos(revenue_cr)) else None,
        # Yields are the same information the other way up, and are directly
        # comparable to a bond — the reason to show both.
        "earnings_yield_pct": _round(100.0 / pe, 2) if _pos(pe) else None,
        "fcf_yield_pct": _round(_f(fcf_cr) / mcap * 100.0, 2)
        if (mcap is not None and _f(fcf_cr) is not None) else None,
        "dividend_yield_pct": _round(dividend_yield_pct),
        "peg": None,
        "bvps": _round(bvps),
    }
    if _pos(pe) and growth and growth > 0:
        multiples["peg"] = _round(pe / (growth * 100.0))

    # ---- intrinsic value estimates ----
    estimates = []

    d = dcf_per_share(fcf_cr, shares_cr, growth)
    if d is not None:
        estimates.append(_est(d, "Discounted cash flow", KIND_GROWTH,
                              "Free cash flow grown %.1f%% for %d years, then %.1f%% forever, "
                              "discounted at %.0f%%." % (growth * 100, DCF_YEARS,
                                                         TERMINAL_GROWTH * 100,
                                                         DISCOUNT_RATE * 100),
                              fcf_cr=_round(fcf_cr), growth_pct=_round(growth * 100, 1),
                              **ASSUMPTIONS))
    elif _f(fcf_cr) is not None and _f(fcf_cr) <= 0:
        estimates.append(_skip("Discounted cash flow", KIND_GROWTH,
                               "Free cash flow is negative — no positive stream to discount."))
    else:
        estimates.append(_skip("Discounted cash flow", KIND_GROWTH,
                               "Needs free cash flow, market cap and an earnings growth rate."))

    g = graham_number(eps, bvps)
    if g is not None:
        estimates.append(_est(g, "Graham number", KIND_FLOOR,
                              "sqrt(22.5 × EPS × book value per share) — a defensive buyer's ceiling.",
                              eps=_round(eps), bvps=_round(bvps)))
    else:
        estimates.append(_skip("Graham number", KIND_FLOOR,
                               "Needs positive EPS and positive book value per share."))

    epv = earnings_power_value(eps)
    if epv is not None:
        estimates.append(_est(epv, "Earnings power value", KIND_FLOOR,
                              "Current EPS capitalised at %.1fx (1 / %.0f%% discount rate), "
                              "assuming no growth at all." % (EPV_MULTIPLE, DISCOUNT_RATE * 100),
                              eps=_round(eps), multiple=_round(EPV_MULTIPLE)))
    else:
        estimates.append(_skip("Earnings power value", KIND_FLOOR,
                               "Needs positive EPS — the company is not profitable."))

    ddm = dividend_discount(price, dividend_yield_pct, growth)
    if ddm is not None:
        estimates.append(_est(ddm, "Dividend discount", KIND_GROWTH,
                              "Current dividend grown %.1f%% forever, discounted at %.0f%%."
                              % (growth * 100, DISCOUNT_RATE * 100),
                              dividend_yield_pct=_round(dividend_yield_pct)))
    else:
        estimates.append(_skip("Dividend discount", KIND_FLOOR,
                               "Only applied to real dividend payers (yield above 0.5%)."))

    # ---- fair value range ----
    # Growth methods set the range. Floor methods are reported separately, as
    # what the business is worth if growth stops — mixing them would drag the
    # midpoint of every compounder below its price by construction.
    grow_vals = sorted(e["value"] for e in estimates
                       if e["value"] is not None and e["kind"] == KIND_GROWTH)
    floor_vals = sorted(e["value"] for e in estimates
                        if e["value"] is not None and e["kind"] == KIND_FLOOR)
    fair = None
    if grow_vals:
        mid = (grow_vals[len(grow_vals) // 2] if len(grow_vals) % 2
               else (grow_vals[len(grow_vals) // 2 - 1] + grow_vals[len(grow_vals) // 2]) / 2.0)
        fair = {
            "low": _round(grow_vals[0]),
            "mid": _round(mid),
            "high": _round(grow_vals[-1]),
            "methods": len(grow_vals),
            "upside_pct": _round((mid - price) / price * 100, 1) if price else None,
            # The highest no-growth estimate: the level below which you are
            # paying nothing for the future at all.
            "floor": _round(floor_vals[-1]) if floor_vals else None,
            "floor_methods": len(floor_vals),
        }
    elif floor_vals:
        # No growth method answered — report the floor alone and say so.
        fair = {
            "low": _round(floor_vals[0]),
            "mid": _round(floor_vals[-1]),
            "high": _round(floor_vals[-1]),
            "methods": 0,
            "upside_pct": _round((floor_vals[-1] - price) / price * 100, 1) if price else None,
            "floor": _round(floor_vals[-1]),
            "floor_methods": len(floor_vals),
        }

    # ---- what the price already assumes ----
    ig = implied_growth(price, fcf_cr, shares_cr)
    priced_in = {
        "implied_growth_pct": _round(ig * 100, 1) if ig is not None else None,
        "assumed_growth_pct": _round(growth * 100, 1) if growth is not None else None,
        "note": ("Free cash flow must compound at this rate for %d years to justify "
                 "today's price." % DCF_YEARS) if ig is not None else
                ("Today's price is at or below a no-growth valuation." if
                 (price and _pos(fcf_cr) and shares_cr) else
                 "Needs free cash flow and market cap."),
    }

    peer_block = _peer_block(multiples, roe_pct, sector, peers)
    verdict, reasons = _verdict(price, fair, multiples, priced_in, growth, peer_block)

    return {
        "price": _round(price),
        "multiples": multiples,
        "growth": {"used_pct": _round(growth * 100, 1) if growth is not None else None,
                   "basis": growth_note},
        "estimates": estimates,
        "fair_value": fair,
        "priced_in": priced_in,
        "peers": peer_block,
        "verdict": verdict,
        "reasons": reasons,
        "assumptions": ASSUMPTIONS,
        "caveats": [
            "Every figure is derived from reported financials and today's price — "
            "it is arithmetic, not a forecast, and not investment advice.",
            ("Sector medians come from companies scraped into the cache, not the "
             "full index — treat them as indicative." if peer_block else
             "No peer comparison was available: too few companies in this sector "
             "have been scraped, so a P/E here has no industry context."),
            "Estimates assume the business keeps working as it has. They cannot "
            "see competition, regulation, promoter conduct or accounting quality.",
        ],
    }


def _verdict(price, fair, multiples, priced_in, growth, peers=None):
    """Cheap / fair / expensive, with the reasons that drove it.

    Reasons are returned whether or not they agree, so a mixed picture reads as
    mixed rather than being flattened into a label.
    """
    reasons = []
    score = 0

    if fair and price and fair.get("mid"):
        up = fair["upside_pct"]
        n = fair["methods"]
        label = ("%d growth method%s" % (n, "" if n == 1 else "s")) if n else "no-growth floor only"
        if up is not None:
            if up >= 25:
                score += 2
                reasons.append("Fair-value midpoint sits %.0f%% above the price (%s)." % (up, label))
            elif up <= -25:
                score -= 2
                reasons.append("Fair-value midpoint sits %.0f%% below the price (%s)."
                               % (abs(up), label))
            else:
                reasons.append("Price is within 25%% of the fair-value midpoint (%s)." % label)
        # Trading under the no-growth floor is the strongest cheap signal here:
        # the future is being valued at nothing or less.
        flr = fair.get("floor")
        if flr is not None and price < flr:
            score += 1
            reasons.append("Price is below the no-growth floor of %s — the market is paying "
                           "nothing for future growth." % _round(flr))

    ey = multiples.get("earnings_yield_pct")
    if ey is not None:
        if ey >= 8:
            score += 1
            reasons.append("Earnings yield of %.1f%% is competitive with a government bond." % ey)
        elif ey <= 3:
            score -= 1
            reasons.append("Earnings yield of %.1f%% is well below the risk-free rate." % ey)

    peg = multiples.get("peg")
    if peg is not None:
        if peg <= 1:
            score += 1
            reasons.append("PEG of %.2f — growth more than covers the multiple." % peg)
        elif peg >= 2:
            score -= 1
            reasons.append("PEG of %.2f — the multiple runs ahead of the growth." % peg)

    ig, ag = priced_in.get("implied_growth_pct"), priced_in.get("assumed_growth_pct")
    if ig is not None and ag is not None:
        if ig > ag + 5:
            score -= 1
            reasons.append("Price assumes %.1f%% growth against the %.1f%% the record supports."
                           % (ig, ag))
        elif ig < ag - 5:
            score += 1
            reasons.append("Price assumes only %.1f%% growth against the %.1f%% the record supports."
                           % (ig, ag))

    if peers:
        for r in peers["rows"]:
            if r["label"] == "P/E" and r["diff_pct"] is not None:
                if r["diff_pct"] <= -30:
                    score += 1
                    reasons.append("P/E of %s is %.0f%% below the %s sector median of %s."
                                   % (r["value"], abs(r["diff_pct"]), peers["sector"], r["sector"]))
                elif r["diff_pct"] >= 50:
                    score -= 1
                    reasons.append("P/E of %s is %.0f%% above the %s sector median of %s."
                                   % (r["value"], r["diff_pct"], peers["sector"], r["sector"]))

    fcy = multiples.get("fcf_yield_pct")
    if fcy is not None and fcy < 0:
        score -= 1
        reasons.append("Free cash flow is negative — the business consumes cash.")

    if not reasons:
        return "unrated", ["Not enough reported data to value this company."]
    # No method produced a value — say so. Landing on "fairly valued" because
    # nothing could be computed would dress absence of evidence as a finding,
    # and a loss-making cash-burner is exactly the case that hits this path.
    if not fair:
        return "unrated", reasons + [
            "No valuation method could produce a figure from the reported data."]
    if score >= 2:
        return "undervalued", reasons
    if score <= -2:
        return "expensive", reasons
    return "fairly valued", reasons
