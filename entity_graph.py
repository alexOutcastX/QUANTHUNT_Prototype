# Grounded entity graph — the "Palantir layer", built ONLY from real NSE
# records so every edge is citable and time-stamped.
#
# What this is (and honestly isn't):
#   - IS: institutional link-analysis grounded in NSE **bulk/block deal**
#     records. Nodes are companies and the institutions/clients that traded
#     them; each edge (institution ⇄ company) aggregates the underlying deals
#     and carries its **citations** (the raw date/side/qty/price rows) and a
#     **time range** (first/last deal). Nothing is inferred by a model — if
#     there is no NSE record, there is no edge.
#   - IS: company nodes enriched with the latest **shareholding structure**
#     (promoter/FII/DII/public/pledge), stamped with its filing period.
#   - IS NOT (yet): board interlocks, promoter-group trees, auditor/lender
#     pivots, related-party links — those need structured filings parsing and
#     are tracked as a follow-up in ROADMAP.md. We don't fake them.
#
# Pure functions over injected data (deal dicts, shareholding dicts) so the
# whole module is unit-testable offline; server.py wires the live fetch.

import re

# Legal-form / boilerplate tokens stripped during entity resolution so
# "HDFC MUTUAL FUND" and "HDFC Mutual Fund A/C ..." collapse to one node.
_SUFFIXES = [
    "PRIVATE LIMITED", "PVT LTD", "LIMITED", "LTD", "LLP", "LLC",
    "MUTUAL FUND", "MF", "AIF", "PMS", "PORTFOLIO", "FUND", "TRUST",
    "INVESTMENT", "INVESTMENTS", "CAPITAL", "SECURITIES", "HOLDINGS",
    "INDIA", "INDIA FUND", "ABSOLUTE RETURN", "OPPORTUNITIES", "SCHEME",
]
_ACCOUNT = re.compile(r"\bA[\s/.-]*C\b.*$", re.IGNORECASE)  # drop "A/C ...."
_NONWORD = re.compile(r"[^A-Z0-9 ]+")
_WS = re.compile(r"\s+")


def norm_entity(name):
    """Resolve a raw deal client name to a stable canonical key + display."""
    raw = (name or "").strip()
    if not raw:
        return "", ""
    s = raw.upper()
    s = _ACCOUNT.sub("", s)             # cut trailing account descriptors
    s = _NONWORD.sub(" ", s)            # drop punctuation
    s = _WS.sub(" ", s).strip()
    # strip trailing legal/type suffix tokens (repeat: "... CAPITAL LTD")
    changed = True
    while changed:
        changed = False
        for suf in _SUFFIXES:
            if s.endswith(" " + suf) or s == suf:
                s = s[: len(s) - len(suf)].strip()
                changed = True
    key = _WS.sub(" ", s).strip()
    if not key:                         # name was ALL boilerplate — keep raw
        key = _WS.sub(" ", _NONWORD.sub(" ", raw.upper())).strip()
    return key, _title(key)


def _title(key):
    return " ".join(w.capitalize() if not w.isupper() or len(w) > 4 else w
                    for w in key.split())


def _num(v):
    try:
        if v in (None, "", "-"):
            return None
        return float(v)
    except Exception:
        return None


def _side_sign(side):
    s = (side or "").strip().upper()
    if s.startswith("B"):
        return 1
    if s.startswith("S"):
        return -1
    return 0


def build_flows(deals):
    """Turn market bulk/block deal records into a grounded institution⇄company
    graph. `deals` is the dict from corporate.deals: {"bulk":[...],"block":[...]}.

    Returns {nodes:{companies,entities}, edges:[...], asof:{first,last}} where
    each edge carries net/buy/sell qty, deal_count, avg price, a date range,
    and the raw `citations` it was aggregated from.
    """
    rows = list(deals.get("bulk") or []) + list(deals.get("block") or [])
    edges = {}
    companies = {}
    entities = {}
    dates = []

    for r in rows:
        sym = (r.get("symbol") or "").strip().upper()
        ekey, edisp = norm_entity(r.get("client"))
        if not sym or not ekey:
            continue
        qty = _num(r.get("qty")) or 0
        price = _num(r.get("price"))
        side = (r.get("side") or "").strip().upper()
        sign = _side_sign(side)
        date = (r.get("date") or "").strip()
        if date:
            dates.append(date)

        companies.setdefault(sym, {"id": sym, "kind": "company", "deals": 0})
        companies[sym]["deals"] += 1
        entities.setdefault(ekey, {"id": ekey, "name": edisp, "kind": "institution",
                                   "deals": 0, "symbols": set()})
        entities[ekey]["deals"] += 1
        entities[ekey]["symbols"].add(sym)

        k = (ekey, sym)
        e = edges.get(k)
        if not e:
            e = edges[k] = {
                "entity": ekey, "entity_name": edisp, "symbol": sym,
                "buy_qty": 0.0, "sell_qty": 0.0, "net_qty": 0.0,
                "deal_count": 0, "_pxsum": 0.0, "_pxn": 0,
                "first_date": date, "last_date": date, "citations": [],
            }
        if sign > 0:
            e["buy_qty"] += qty
        elif sign < 0:
            e["sell_qty"] += qty
        e["net_qty"] += sign * qty
        e["deal_count"] += 1
        if price is not None:
            e["_pxsum"] += price
            e["_pxn"] += 1
        # keep the date range (string compare is unreliable, so track all)
        e["citations"].append({"date": date, "side": side, "qty": qty,
                               "price": price, "kind": r.get("kind", "")})

    out_edges = []
    for e in edges.values():
        cds = [c["date"] for c in e["citations"] if c["date"]]
        e["first_date"] = min(cds) if cds else ""
        e["last_date"] = max(cds) if cds else ""
        e["avg_price"] = round(e["_pxsum"] / e["_pxn"], 2) if e["_pxn"] else None
        del e["_pxsum"], e["_pxn"]
        out_edges.append(e)

    # entity sets → counts (JSON-safe)
    for ent in entities.values():
        ent["breadth"] = len(ent["symbols"])
        ent["symbols"] = sorted(ent["symbols"])

    out_edges.sort(key=lambda x: (abs(x["net_qty"]), x["deal_count"]), reverse=True)
    return {
        "nodes": {"companies": list(companies.values()),
                  "entities": sorted(entities.values(),
                                     key=lambda e: (e["breadth"], e["deals"]), reverse=True)},
        "edges": out_edges,
        "asof": {"first": min(dates) if dates else "", "last": max(dates) if dates else ""},
        "source": "NSE bulk/block deals",
        "disclaimer": "Every edge is grounded in an NSE bulk/block deal record "
                      "(cited + dated). Board interlocks / promoter-group / "
                      "related-party links require filings parsing and are not "
                      "included.",
    }


def top_entities(graph, limit=25):
    """Institutions ranked by breadth (distinct symbols) then deal count."""
    return graph["nodes"]["entities"][:limit]


def entity_positions(graph, entity_key):
    """All grounded positions (edges) for one institution, most-active first."""
    ek = (entity_key or "").strip().upper()
    # norm the query the same way node keys were built
    ek, _ = norm_entity(entity_key)
    pos = [e for e in graph["edges"] if e["entity"] == ek]
    pos.sort(key=lambda x: x["deal_count"], reverse=True)
    return pos


def symbol_flows(graph, symbol):
    """All institutions active in one company, net accumulation first."""
    sym = (symbol or "").strip().upper()
    flows = [e for e in graph["edges"] if e["symbol"] == sym]
    flows.sort(key=lambda x: x["net_qty"], reverse=True)
    return flows


def enrich_company(node, shareholding):
    """Attach the latest shareholding structure (time-stamped) to a company
    node so the graph carries ownership context, not just flow."""
    latest = (shareholding or {}).get("latest") or {}
    if latest:
        node = dict(node)
        node["shareholding"] = {
            "period": latest.get("date", ""),
            "promoter": latest.get("promoter"),
            "fii": latest.get("fii"),
            "dii": latest.get("dii"),
            "public": latest.get("public"),
            "pledge": latest.get("pledge"),
        }
    return node
