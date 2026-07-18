# Grounded affiliation graphs — promoter shareholding and disclosed political
# funding — built from a curated, CITED seed dataset (affiliations.seed.json),
# NOT model-inferred.
#
# Same integrity rule as entity_graph.py: every edge carries a source and a
# date/period, and coverage is intentionally partial (a seed of well-documented
# public records) rather than a fabricated-complete graph. If a link isn't in a
# public filing/disclosure, it isn't here.
#
# Two graphs:
#   - promoter:  promoter group → listed company   (approx stake %, filing period)
#   - political: donor entity → electoral-bond purchases (₹ crore, date window)
#
# Provenance (all public):
#   - Promoter groups & holdings: NSE/BSE shareholding-pattern filings.
#   - Political funding: ECI/SBI electoral-bond disclosure, March 2024. These are
#     PURCHASE totals (donor side). Recipient-party matching needs the matched
#     bond-number dataset and is deliberately NOT asserted here — buying bonds was
#     legal and inclusion implies no wrongdoing.
#
# Pure functions over the seed dict; the JSON is loaded once and cached.

import json
import os
import threading

_SEED_PATH = os.path.join(os.path.dirname(__file__), "affiliations.seed.json")
_lock = threading.Lock()
_cache = None

PROMOTER_DISCLAIMER = (
    "Promoter → company links from public NSE/BSE shareholding-pattern filings. "
    "Stakes are approximate and drift between quarters — verify the current figure "
    "on the exchange. Retail shareholders are never disclosed by name and are not "
    "included."
)
POLITICAL_DISCLAIMER = (
    "Disclosed political funding via electoral bonds, per the ECI/SBI release "
    "(March 2024). Amounts are the total value of electoral bonds PURCHASED by "
    "each entity (donor side), rounded to ₹ crore. This shows that an entity funded "
    "politics through bonds; the exact recipient party needs the matched "
    "bond-number dataset and is not asserted here. Buying electoral bonds was legal "
    "— inclusion implies no wrongdoing."
)


def _load():
    global _cache
    with _lock:
        if _cache is None:
            try:
                with open(_SEED_PATH, encoding="utf-8") as f:
                    _cache = json.load(f)
            except Exception:
                _cache = {"promoters": {}, "political": {}}
        return _cache


def reload_seed():
    """Drop the cached seed (used by tests that patch the file)."""
    global _cache
    with _lock:
        _cache = None


def _norm(v):
    return " ".join((v or "").upper().split())


# ── promoter graph ──
def promoter_graph(seed=None):
    """Promoter groups → their listed companies, grounded in shareholding
    filings. Each holder node embeds its company edges so the client can expand
    without another request."""
    d = (seed if seed is not None else _load()).get("promoters", {}) or {}
    as_of = d.get("as_of", "")
    source = d.get("source", "")
    citation = "Shareholding pattern · " + as_of if as_of else "Shareholding pattern"
    holders = []
    all_edges = []
    companies = {}
    for g in d.get("groups", []) or []:
        gkey = _norm(g.get("key"))
        if not gkey:
            continue
        gname = g.get("name") or gkey
        edges = []
        for c in g.get("companies", []) or []:
            sym = _norm(c.get("symbol"))
            if not sym:
                continue
            e = {
                "holder": gkey,
                "holder_name": gname,
                "symbol": sym,
                "company_name": c.get("company") or sym,
                "stake_pct": c.get("stake_pct"),
                "as_of": as_of,
                "source": source,
                "citation": citation,
            }
            edges.append(e)
            all_edges.append(e)
            companies.setdefault(sym, {"id": sym, "company_name": c.get("company") or sym, "kind": "company"})
        # highest disclosed stake first, unknown (null) stakes last
        edges.sort(key=lambda x: (x["stake_pct"] is None, -(x["stake_pct"] or 0), x["symbol"]))
        holders.append({
            "id": gkey,
            "name": gname,
            "kind": "promoter",
            "breadth": len(edges),
            "symbols": sorted({e["symbol"] for e in edges}),
            "edges": edges,
        })
    holders.sort(key=lambda h: (h["breadth"], h["name"]), reverse=True)
    return {
        "kind": "promoter",
        "nodes": {"holders": holders, "companies": list(companies.values())},
        "edges": all_edges,
        "asof": {"first": as_of, "last": as_of},
        "source": source,
        "disclaimer": PROMOTER_DISCLAIMER,
    }


def promoter_by_symbol(symbol, seed=None):
    """Which promoter group(s) hold a given company — the reverse lookup."""
    sym = _norm(symbol)
    g = promoter_graph(seed)
    return [e for e in g["edges"] if e["symbol"] == sym]


# ── political graph ──
def political_graph(seed=None):
    """Donor entities ranked by electoral-bond purchase value (donor side)."""
    d = (seed if seed is not None else _load()).get("political", {}) or {}
    as_of = d.get("as_of", "")
    source = d.get("source", "")
    donors = []
    for r in d.get("donors", []) or []:
        key = _norm(r.get("key"))
        if not key:
            continue
        donors.append({
            "id": key,
            "name": r.get("name") or key,
            "kind": "donor",
            "symbol": _norm(r.get("symbol")) or None,
            "amount_cr": r.get("amount_cr"),
            "first_date": r.get("first_date", ""),
            "last_date": r.get("last_date", ""),
            "source": source,
            "citation": source,
        })
    donors.sort(key=lambda x: (x["amount_cr"] is None, -(x["amount_cr"] or 0), x["name"]))
    total = round(sum((x["amount_cr"] or 0) for x in donors), 1)
    return {
        "kind": "political",
        "nodes": {"donors": donors},
        "total_cr": total,
        "count": len(donors),
        "asof": {"first": as_of, "last": as_of},
        "source": source,
        "disclaimer": POLITICAL_DISCLAIMER,
    }


def political_by_symbol(symbol, seed=None):
    """Electoral-bond purchases attributed to a listed company (where mapped)."""
    sym = _norm(symbol)
    g = political_graph(seed)
    return [d for d in g["nodes"]["donors"] if d.get("symbol") == sym]
