"""Cases — investment baskets built and managed by the TaurEye engine.

A Case is a themed basket of stocks with fixed target weights: sector cases
(the strongest names in one sector), cap cases (large / mid / small), strategy
cases (quality compounders, deep value, momentum leaders, dividend payers) and
the flagship multibagger case. Every constituent is chosen by the analyser that
already scores the whole listed universe — no hand-picking.

Each case carries what you need to actually buy it: target weights, the
minimum investment that buys at least one share of every constituent, the share
count at that amount, and the realised CAGR since the basket was struck.

Baskets are struck once a year — a vintage. Between vintages the engine still
manages them: it books profit on a runaway constituent, exits one whose thesis
has broken, and adds a replacement from the reserve list. Every one of those
moves is written to an action ledger, so the basket's history is auditable
rather than a number that silently changes.

The selection, weighting and allocation maths are pure functions (no I/O), so
the parts that decide what you own are unit-tested without a network.
"""
from __future__ import annotations

import json
import logging
import math
import re
import threading
import time

import store

log = logging.getLogger("cases")

DAY = 86400
YEAR = 365.25 * DAY

# ── construction rules ───────────────────────────────────────────────────────
MIN_SCORE = 55          # analyser floor to be eligible for any case
TARGET_N = 8            # constituents per case
MIN_N = 4               # below this the case isn't published at all
MAX_WEIGHT = 0.20       # no single stock may dominate a basket
MIN_WEIGHT = 0.04       # nor be a rounding error
RESERVE_N = 6           # bench, used when the engine exits a constituent

# ── management rules ─────────────────────────────────────────────────────────
BOOK_AT_PCT = 60.0      # trim a constituent that has run this far
BOOK_FRACTION = 0.5     # by this much
EXIT_SCORE = 45.0       # thesis broken: the analyser no longer rates it
EXIT_LOSS_PCT = -35.0   # or it has fallen this far
REVIEW_INTERVAL = 6 * 3600

CAP_BANDS = {           # market cap in ₹ crore
    "largecap": (67000, None),
    "midcap": (22000, 67000),
    "smallcap": (1000, 22000),
}

_lock = threading.Lock()
_thread = None
_state = {"status": "idle", "built": 0, "asof": 0, "error": None}


def _num(v):
    try:
        f = float(v)
        return f if f == f and abs(f) != float("inf") else None
    except (TypeError, ValueError):
        return None


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")


# ── pure maths: weighting, sizing, returns ───────────────────────────────────
def weights(scores: list, max_w: float = MAX_WEIGHT, min_w: float = MIN_WEIGHT) -> list:
    """Score-proportional weights, capped so no name dominates and floored so
    none is a token holding. Always sums to 1.

    The cap is applied by redistributing the excess across the uncapped names
    and re-checking, because a naive single pass leaves the total below 1."""
    vals = [max(0.0, _num(s) or 0.0) for s in scores]
    n = len(vals)
    if not n:
        return []
    total = sum(vals)
    w = [v / total for v in vals] if total > 0 else [1.0 / n] * n

    # An equal split already breaching the cap means the cap is unsatisfiable.
    if max_w * n < 1.0 - 1e-9:
        return [1.0 / n] * n
    for _ in range(n + 2):
        excess = sum(x - max_w for x in w if x > max_w)
        if excess <= 1e-12:
            break
        room = [i for i, x in enumerate(w) if x < max_w]
        if not room:
            break
        free = sum(w[i] for i in room)
        for i in range(n):
            if w[i] > max_w:
                w[i] = max_w
        for i in room:
            w[i] += excess * (w[i] / free if free > 0 else 1.0 / len(room))

    # Floor, then renormalise — the floor can only push the total up, so scale
    # the above-floor names back down rather than breaking the floor again.
    if min_w * n <= 1.0:
        for _ in range(n + 2):
            short = sum(min_w - x for x in w if x < min_w)
            if short <= 1e-12:
                break
            donors = [i for i, x in enumerate(w) if x > min_w]
            if not donors:
                break
            pool = sum(w[i] - min_w for i in donors)
            for i in range(n):
                if w[i] < min_w:
                    w[i] = min_w
            for i in donors:
                take = short * ((w[i] - min_w) / pool) if pool > 0 else short / len(donors)
                w[i] -= take
    s = sum(w)
    return [round(x / s, 6) for x in w] if s > 0 else [1.0 / n] * n


def min_investment(prices: list, ws: list, step: int = 500) -> float:
    """The smallest amount that buys at least one share of every constituent at
    its target weight — the standard basket minimum. Rounded up to `step` so it
    reads as a real number, and so rounding down a share can't under-fill a leg."""
    need = 0.0
    for p, w in zip(prices, ws):
        px, wt = _num(p), _num(w)
        if not px or px <= 0 or not wt or wt <= 0:
            continue
        need = max(need, px / wt)
    if need <= 0:
        return 0.0
    return float(math.ceil(need / step) * step)


def allocate(amount: float, prices: list, ws: list) -> dict:
    """Whole-share allocation of `amount` across the basket. Returns per-leg
    shares and the value actually deployed — fractional shares don't exist on
    the NSE, so the realised weights drift from the targets and the page shows
    both rather than pretending they match."""
    amt = _num(amount) or 0.0
    legs = []
    invested = 0.0
    for p, w in zip(prices, ws):
        px, wt = _num(p), _num(w)
        if not px or px <= 0 or wt is None:
            legs.append({"shares": 0, "value": 0.0, "actual_weight": 0.0})
            continue
        shares = int(amt * wt // px)
        value = shares * px
        invested += value
        legs.append({"shares": shares, "value": round(value, 2), "actual_weight": 0.0})
    for leg in legs:
        leg["actual_weight"] = round(leg["value"] / invested, 6) if invested > 0 else 0.0
    return {"legs": legs, "invested": round(invested, 2),
            "cash": round(amt - invested, 2), "amount": round(amt, 2)}


def cagr(start_value: float, end_value: float, seconds: float):
    """Compound annual growth rate. None when the window is under a month — an
    annualised number from three weeks of data is noise dressed as a rate."""
    sv, ev = _num(start_value), _num(end_value)
    if not sv or sv <= 0 or ev is None or ev < 0 or seconds is None:
        return None
    years = seconds / YEAR
    if years < (30 * DAY) / YEAR:
        return None
    try:
        return round(((ev / sv) ** (1 / years) - 1) * 100, 2)
    except (ValueError, ZeroDivisionError, OverflowError):
        return None


def basket_return(holdings: list, quotes: dict) -> dict:
    """Weighted return of a basket at current prices. Exited legs keep the
    return they were closed at, so booking a profit doesn't erase it from the
    basket's record."""
    total_w = 0.0
    ret = 0.0
    priced = 0
    for h in holdings:
        w = _num(h.get("weight")) or 0.0
        entry = _num(h.get("entry"))
        if not entry or entry <= 0 or w <= 0:
            continue
        px = _num(h.get("exit")) if h.get("status") == "exited" else _num(quotes.get(h["symbol"]))
        if px is None:
            continue
        ret += w * ((px / entry) - 1)
        total_w += w
        priced += 1
    if not total_w:
        return {"return_pct": None, "priced": 0, "coverage": 0.0}
    return {"return_pct": round(ret / total_w * 100, 2), "priced": priced,
            "coverage": round(total_w, 4)}


def review_actions(holdings: list, quotes: dict, scores: dict, now: int = None) -> list:
    """What the engine should do to a live basket, as a list of actions.

    Pure: hand it holdings, prices and today's analyser scores and it returns
    the moves. Exits are checked before profit-booking, so a name that has both
    run up and broken its thesis is exited rather than merely trimmed."""
    now = int(now if now is not None else time.time())
    out = []
    for h in holdings:
        if h.get("status") != "held":
            continue
        sym = h.get("symbol")
        entry = _num(h.get("entry"))
        px = _num(quotes.get(sym))
        if not entry or entry <= 0 or px is None:
            continue
        pl = (px / entry - 1) * 100
        score = _num(scores.get(sym))

        if score is not None and score < EXIT_SCORE:
            out.append({"action": "exit", "symbol": sym, "price": round(px, 2),
                        "pl_pct": round(pl, 2), "ts": now,
                        "note": f"Analyser score fell to {score:.0f} — below the {EXIT_SCORE:.0f} "
                                f"floor the case requires. Thesis no longer holds."})
        elif pl <= EXIT_LOSS_PCT:
            out.append({"action": "exit", "symbol": sym, "price": round(px, 2),
                        "pl_pct": round(pl, 2), "ts": now,
                        "note": f"Down {abs(pl):.1f}% — past the {abs(EXIT_LOSS_PCT):.0f}% "
                                f"line where the case cuts a position."})
        elif pl >= BOOK_AT_PCT and not h.get("booked"):
            out.append({"action": "book", "symbol": sym, "price": round(px, 2),
                        "pl_pct": round(pl, 2), "qty_pct": BOOK_FRACTION * 100, "ts": now,
                        "note": f"Up {pl:.1f}% — booking {BOOK_FRACTION * 100:.0f}% of the "
                                f"position and letting the rest run."})
    return out


# ── case definitions the engine fills ────────────────────────────────────────
def _q(metrics, key):
    return _num((metrics or {}).get(key))


def strategy_filters() -> dict:
    """Each strategy case is a predicate over a screened row. Kept together so
    the rules that decide what you own read as one page."""
    def quality(r):
        m = r.get("metrics") or {}
        roe, de = _num(r.get("roe")), _num(r.get("debt_equity"))
        return roe is not None and roe >= 15 and de is not None and de <= 0.5

    def value(r):
        m = r.get("metrics") or {}
        pe, pb = _q(m, "pe"), _q(m, "pb")
        return pe is not None and 0 < pe <= 18 and (pb is None or pb <= 3)

    def momentum(r):
        v200, pfh = _num(r.get("vs_200dma")), _num(r.get("pct_from_high"))
        return v200 is not None and v200 > 0 and pfh is not None and pfh > -15

    def dividend(r):
        return (_q(r.get("metrics"), "dividend_yield") or 0) >= 1.5

    return {"quality": quality, "value": value, "momentum": momentum, "dividend": dividend}


CASE_BLURB = {
    "quality": ("Quality compounders",
                "Businesses that earn well on the capital they employ and don't lean on debt "
                "to do it — return on equity of 15%+ with debt/equity under 0.5."),
    "value": ("Deep value",
              "Priced below what the earnings justify — a P/E of 18 or less with a price-to-book "
              "under 3, screened for a fundamental score that says the discount isn't deserved."),
    "momentum": ("Momentum leaders",
                 "Names already trending: above the 200-day average and within 15% of their "
                 "52-week high, so the market agrees with the fundamentals."),
    "dividend": ("Dividend income",
                 "Payers yielding 1.5% or more that still clear the analyser's quality bar — "
                 "income without buying a value trap."),
}

CAP_BLURB = {
    "largecap": ("Largecap core",
                 "The biggest listed businesses in India — above ₹67,000 crore. The stable core "
                 "of a portfolio: slower, deeper, and far less likely to gap on you."),
    "midcap": ("Midcap growth",
               "₹22,000–67,000 crore: established enough to have a record, small enough to still "
               "compound quickly. The band where most multibaggers are found."),
    "smallcap": ("Smallcap explorers",
                 "₹1,000–22,000 crore. The highest potential in the market and the highest risk — "
                 "thin liquidity, sharper drawdowns, and a longer holding period required."),
}


def build_cases(rows: list, now: int = None) -> list:
    """Turn a screened universe into the full set of cases. Pure — hand it the
    multibagger screen's results and it returns basket definitions with weights,
    minimum investment and a reserve bench. Cases with too few qualifying names
    are dropped rather than padded with weaker ones."""
    now = int(now if now is not None else time.time())
    pool = [r for r in (rows or [])
            if (_num(r.get("score")) or 0) >= MIN_SCORE and (_num(r.get("price")) or 0) > 0]
    pool.sort(key=lambda r: -(_num(r.get("score")) or 0))
    out = []

    def mk(cid, name, kind, theme, blurb, members):
        if len(members) < MIN_N:
            return None
        picked = members[:TARGET_N]
        reserve = members[TARGET_N:TARGET_N + RESERVE_N]
        ws = weights([_num(r.get("score")) for r in picked])
        prices = [_num(r.get("price")) for r in picked]
        mi = min_investment(prices, ws)
        alloc = allocate(mi, prices, ws)
        return {
            "id": cid, "name": name, "kind": kind, "theme": theme, "blurb": blurb,
            "vintage": time.gmtime(now).tm_year, "created": now,
            "min_investment": mi,
            "constituents": [{
                "symbol": r["symbol"], "name": r.get("name") or r["symbol"],
                "weight": w, "price": _num(r.get("price")), "score": _num(r.get("score")),
                "tier": r.get("tier"), "sector": r.get("sector"),
                "market_cap_cr": _num(r.get("market_cap_cr")),
                "shares": leg["shares"], "value": leg["value"],
            } for r, w, leg in zip(picked, ws, alloc["legs"])],
            "reserve": [{"symbol": r["symbol"], "name": r.get("name") or r["symbol"],
                         "score": _num(r.get("score")), "price": _num(r.get("price"))}
                        for r in reserve],
            "invested": alloc["invested"], "cash": alloc["cash"],
        }

    # 1 · the flagship — best analyser scores in the market, whatever they are
    c = mk("multibagger-flagship", "Multibagger flagship", "multibagger", "All caps",
           "The highest analyser scores in the listed universe, regardless of sector or size. "
           "The engine's single best expression of what it rates most highly right now.",
           pool)
    if c:
        out.append(c)

    # 2 · sector cases
    by_sector = {}
    for r in pool:
        sec = r.get("sector")
        if sec:
            by_sector.setdefault(sec, []).append(r)
    for sec, members in sorted(by_sector.items()):
        c = mk(f"sector-{slug(sec)}", f"{sec} leaders", "sector", sec,
               f"The strongest-scoring {sec} businesses in the listed universe. A concentrated "
               f"bet on one part of the economy — it will move with that sector, up and down.",
               members)
        if c:
            out.append(c)

    # 3 · cap cases
    for band, (lo, hi) in CAP_BANDS.items():
        members = [r for r in pool
                   if (_num(r.get("market_cap_cr")) or 0) >= lo
                   and (hi is None or (_num(r.get("market_cap_cr")) or 0) < hi)]
        title, blurb = CAP_BLURB[band]
        c = mk(f"cap-{band}", title, "cap", band.capitalize(), blurb, members)
        if c:
            out.append(c)

    # 4 · strategy cases
    for key, pred in strategy_filters().items():
        title, blurb = CASE_BLURB[key]
        members = [r for r in pool if _safe(pred, r)]
        c = mk(f"strategy-{key}", title, "strategy", "Strategy", blurb, members)
        if c:
            out.append(c)
    return out


def _safe(pred, row) -> bool:
    try:
        return bool(pred(row))
    except Exception:
        return False


# ── persistence ──────────────────────────────────────────────────────────────
def save_case(c: dict, now: int = None) -> None:
    """Write a freshly-struck case and its holdings. Existing holdings for the
    case are closed as a rebalance rather than deleted — the basket's history
    survives its vintages."""
    now = int(now if now is not None else time.time())
    store.execute(
        "INSERT INTO cases (id, name, kind, theme, blurb, vintage, created, rebalanced, "
        "min_investment, meta) VALUES (?,?,?,?,?,?,?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name, blurb=excluded.blurb, "
        "vintage=excluded.vintage, rebalanced=excluded.rebalanced, "
        "min_investment=excluded.min_investment, meta=excluded.meta",
        (c["id"], c["name"], c["kind"], c.get("theme"), c.get("blurb"), c["vintage"],
         now, now, c["min_investment"],
         json.dumps({"reserve": c.get("reserve") or [], "invested": c.get("invested"),
                     "cash": c.get("cash")})))
    store.execute("UPDATE case_holdings SET status='rebalanced', exit_ts=? "
                  "WHERE case_id=? AND status='held'", (now, c["id"]))
    for k in c["constituents"]:
        store.execute(
            "INSERT INTO case_holdings (case_id, symbol, name, weight, entry, entry_ts, "
            "shares, status, score, sector, meta) VALUES (?,?,?,?,?,?,?, 'held', ?,?,?)",
            (c["id"], k["symbol"], k["name"], k["weight"], k["price"], now, k["shares"],
             k["score"], k.get("sector"),
             json.dumps({"tier": k.get("tier"), "market_cap_cr": k.get("market_cap_cr")})))
    log_action(c["id"], "rebalance", None, note=(
        f"{c['vintage']} vintage struck — {len(c['constituents'])} constituents, "
        f"minimum investment {c['min_investment']:,.0f}."), now=now)


def log_action(case_id: str, action: str, symbol=None, price=None, qty_pct=None,
               pl_pct=None, note: str = "", now: int = None) -> None:
    store.execute(
        "INSERT INTO case_actions (case_id, ts, action, symbol, price, qty_pct, pl_pct, note) "
        "VALUES (?,?,?,?,?,?,?,?)",
        (case_id, int(now if now is not None else time.time()), action, symbol, price,
         qty_pct, pl_pct, note))


def apply_actions(case_id: str, actions: list, bench: list = None, now: int = None) -> int:
    """Execute the engine's review decisions against stored holdings, and refill
    an emptied slot from the bench so the basket stays fully invested."""
    now = int(now if now is not None else time.time())
    applied = 0
    held = {h["symbol"]: h for h in holdings_of(case_id)}
    for a in actions or []:
        h = held.get(a.get("symbol"))
        if not h:
            continue
        if a["action"] == "exit":
            store.execute("UPDATE case_holdings SET status='exited', exit=?, exit_ts=? WHERE id=?",
                          (a.get("price"), now, h["id"]))
            log_action(case_id, "exit", a["symbol"], a.get("price"), 100.0, a.get("pl_pct"),
                       a.get("note", ""), now)
            applied += 1
            add = _next_from_bench(case_id, bench, held)
            if add:
                # Size the replacement the same way the basket was sized in the
                # first place — inheriting the slot's weight at the case's own
                # minimum investment. Inserting it at zero shares would show the
                # user a holding they apparently own none of.
                shares = _shares_for(case_id, h.get("weight"), add.get("price"))
                store.execute(
                    "INSERT INTO case_holdings (case_id, symbol, name, weight, entry, entry_ts, "
                    "shares, status, score, sector, meta) VALUES (?,?,?,?,?,?,?, 'held', ?,?,?)",
                    (case_id, add["symbol"], add.get("name") or add["symbol"], h["weight"],
                     add.get("price"), now, shares, add.get("score"), add.get("sector"), "{}"))
                held[add["symbol"]] = {"symbol": add["symbol"], "weight": h["weight"]}
                log_action(case_id, "add", add["symbol"], add.get("price"), 100.0, None,
                           f"Replaces {a['symbol']} — next-highest analyser score on the "
                           f"case's reserve list.", now)
                applied += 1
        elif a["action"] == "book":
            store.execute("UPDATE case_holdings SET status='booked', weight=?, meta=? WHERE id=?",
                          ((h.get("weight") or 0) * (1 - BOOK_FRACTION),
                           json.dumps({**_loads(h.get("meta")), "booked_at": a.get("price"),
                                       "booked_pl_pct": a.get("pl_pct")}), h["id"]))
            log_action(case_id, "book", a["symbol"], a.get("price"), a.get("qty_pct"),
                       a.get("pl_pct"), a.get("note", ""), now)
            applied += 1
    return applied


def _shares_for(case_id: str, weight, price) -> int:
    """Whole shares of one leg at the case's minimum investment."""
    w, px = _num(weight), _num(price)
    if not w or not px or px <= 0:
        return 0
    rows = store.query("SELECT min_investment FROM cases WHERE id=?", (case_id,))
    mi = _num(rows[0]["min_investment"]) if rows else None
    return int((mi or 0) * w // px)


def _next_from_bench(case_id: str, bench, held: dict):
    for cand in (bench or []):
        if cand.get("symbol") and cand["symbol"] not in held:
            return cand
    return None


def _loads(raw):
    try:
        v = json.loads(raw) if raw else {}
        return v if isinstance(v, dict) else {}
    except (TypeError, ValueError):
        return {}


def holdings_of(case_id: str) -> list:
    return store.query(
        "SELECT * FROM case_holdings WHERE case_id=? AND status IN ('held','booked') "
        "ORDER BY weight DESC", (case_id,))


def actions_of(case_id: str, limit: int = 40) -> list:
    return store.query("SELECT * FROM case_actions WHERE case_id=? ORDER BY ts DESC, id DESC "
                       "LIMIT ?", (case_id, int(limit)))


def all_cases() -> list:
    return store.query("SELECT * FROM cases ORDER BY kind, name")


def case_detail(case_id: str, quotes: dict = None) -> dict:
    rows = store.query("SELECT * FROM cases WHERE id=?", (case_id,))
    if not rows:
        return None
    c = rows[0]
    meta = _loads(c.get("meta"))
    hs = holdings_of(case_id)
    quotes = quotes or {}
    legs = []
    for h in hs:
        px = _num(quotes.get(h["symbol"])) or _num(h["entry"])
        entry = _num(h["entry"])
        pl = round((px / entry - 1) * 100, 2) if entry and px else None
        legs.append({
            "symbol": h["symbol"], "name": h["name"], "weight": _num(h["weight"]),
            "entry": entry, "entry_ts": h["entry_ts"], "price": px, "pl_pct": pl,
            "shares": h["shares"], "value": round((h["shares"] or 0) * (px or 0), 2),
            "status": h["status"], "score": _num(h["score"]), "sector": h["sector"],
        })
    br = basket_return(hs, quotes)
    oldest = min([h["entry_ts"] for h in hs], default=None)
    now = int(time.time())
    growth = cagr(100.0, 100.0 * (1 + (br["return_pct"] or 0) / 100),
                  (now - oldest) if oldest else None)
    return {
        "id": c["id"], "name": c["name"], "kind": c["kind"], "theme": c["theme"],
        "blurb": c["blurb"], "vintage": c["vintage"], "created": c["created"],
        "rebalanced": c["rebalanced"], "min_investment": _num(c["min_investment"]),
        "constituents": legs, "reserve": meta.get("reserve") or [],
        "return_pct": br["return_pct"], "cagr_pct": growth,
        "held_since": oldest, "actions": actions_of(case_id),
        "rules": {"target_n": TARGET_N, "max_weight": MAX_WEIGHT, "min_weight": MIN_WEIGHT,
                  "book_at_pct": BOOK_AT_PCT, "book_fraction": BOOK_FRACTION,
                  "exit_score": EXIT_SCORE, "exit_loss_pct": EXIT_LOSS_PCT,
                  "min_score": MIN_SCORE},
    }


def overview(quotes: dict = None) -> dict:
    """Every case with its headline numbers, for the list page."""
    out = []
    for c in all_cases():
        hs = holdings_of(c["id"])
        br = basket_return(hs, quotes or {})
        oldest = min([h["entry_ts"] for h in hs], default=None)
        now = int(time.time())
        out.append({
            "id": c["id"], "name": c["name"], "kind": c["kind"], "theme": c["theme"],
            "blurb": c["blurb"], "vintage": c["vintage"],
            "min_investment": _num(c["min_investment"]),
            "count": len(hs), "return_pct": br["return_pct"],
            "cagr_pct": cagr(100.0, 100.0 * (1 + (br["return_pct"] or 0) / 100),
                             (now - oldest) if oldest else None),
            "held_since": oldest,
            "top": [h["symbol"] for h in hs[:4]],
        })
    return {"cases": out, "count": len(out),
            "kinds": sorted({c["kind"] for c in out}),
            "asof": _state.get("asof") or 0,
            "status": _state.get("status"),
            "rules": {"target_n": TARGET_N, "min_score": MIN_SCORE,
                      "book_at_pct": BOOK_AT_PCT, "exit_score": EXIT_SCORE,
                      "exit_loss_pct": EXIT_LOSS_PCT, "rebalance": "annual"}}


# ── the driver: strike vintages, then manage them ────────────────────────────
def needs_vintage(c: dict, now: int = None) -> bool:
    """A basket is re-struck when its vintage year is behind the current one —
    "preset and updated every year". A brand-new case has no row at all."""
    year = time.gmtime(int(now if now is not None else time.time())).tm_year
    return int(c.get("vintage") or 0) < year


def build_and_review(rows: list, quotes_fn=None, now: int = None) -> dict:
    """One pass of the engine over every case: strike this year's vintage where
    one is due, then review the live baskets and act. `quotes_fn` takes a list
    of symbols and returns {symbol: price}; without it the review is skipped and
    only construction runs."""
    now = int(now if now is not None else time.time())
    built = struck = acted = 0
    existing = {c["id"]: c for c in all_cases()}
    fresh = build_cases(rows, now)
    bench = {}

    for c in fresh:
        built += 1
        bench[c["id"]] = c.get("reserve") or []
        cur = existing.get(c["id"])
        if cur is None or needs_vintage(cur, now):
            save_case(c, now)
            struck += 1

    # Review the live baskets against today's prices and scores.
    if quotes_fn:
        scores = {r["symbol"]: _num(r.get("score")) for r in (rows or []) if r.get("symbol")}
        for c in all_cases():
            hs = holdings_of(c["id"])
            syms = [h["symbol"] for h in hs]
            if not syms:
                continue
            try:
                quotes = quotes_fn(syms) or {}
            except Exception as e:
                log.warning("cases: quotes failed for %s (%s)", c["id"], e)
                continue
            acts = review_actions(hs, quotes, scores, now)
            if acts:
                acted += apply_actions(c["id"], acts, bench.get(c["id"]), now)

    with _lock:
        _state.update({"status": "done", "asof": now, "error": None})
    log.info("cases: %d built, %d vintages struck, %d engine actions", built, struck, acted)
    return {"built": built, "struck": struck, "actions": acted, "asof": now}


def ensure_built(rows_fn, quotes_fn=None, force: bool = False) -> bool:
    """Kick a build/review pass in the background if the cases have gone stale.
    Never blocks a request — the page serves whatever the last pass stored."""
    global _thread
    with _lock:
        if _thread is not None:
            return False
        if not force and _state["asof"] and (time.time() - _state["asof"]) < REVIEW_INTERVAL:
            return False
        _thread = threading.Thread(target=_run, args=(rows_fn, quotes_fn),
                                   name="cases-build", daemon=True)
        _thread.start()
        return True


def _run(rows_fn, quotes_fn) -> None:
    global _thread
    try:
        with _lock:
            _state.update({"status": "running", "error": None})
        rows = rows_fn() or []
        if not rows:
            with _lock:
                _state.update({"status": "waiting", "error": "screen not ready"})
            return
        res = build_and_review(rows, quotes_fn)
        with _lock:
            _state["built"] = res["built"]
    except Exception as e:
        log.error("cases build failed: %s", e)
        with _lock:
            _state.update({"status": "error", "error": str(e)})
    finally:
        with _lock:
            _thread = None


def progress() -> dict:
    with _lock:
        running = _thread is not None
        s = dict(_state)
    s["running"] = running
    return s
