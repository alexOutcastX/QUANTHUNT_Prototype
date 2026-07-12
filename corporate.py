# Corporate / institutional data from free public NSE feeds.
#
# Design: this module holds the URL templates, defensive PARSERS, and an
# in-memory cache. The actual HTTP is INJECTED (a `fetch(url) -> dict|list`
# callable) so the network path (NSE session, cookies, retries) stays in
# server.py and the parsers are unit-testable with crafted payloads offline.
#
# Feeds (all public, work from an Indian IP — the Mumbai VM):
#   - Corporate announcements   /api/corporate-announcements?index=equities&symbol=
#   - Corporate actions         /api/corporates-corporateActions?index=equities&symbol=
#   - Shareholding pattern      /api/corporate-share-holdings-master?index=equities&symbol=
#   - Bulk / block deals        /api/snapshot-capital-market-largedeal (market-wide)
#
# Everything is best-effort and clearly sourced; missing → empty.

import time
import threading

BASE = "https://www.nseindia.com"
URLS = {
    "announcements": BASE + "/api/corporate-announcements?index=equities&symbol={sym}",
    "actions": BASE + "/api/corporates-corporateActions?index=equities&symbol={sym}",
    "shareholding": BASE + "/api/corporate-share-holdings-master?index=equities&symbol={sym}&issuer=",
    "deals": BASE + "/api/snapshot-capital-market-largedeal",
}
TTL = 6 * 3600          # corporate data changes slowly
DEALS_TTL = 3600

_cache = {}
_lock = threading.Lock()


def _cached(key, ttl, producer):
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    try:
        data = producer()
    except Exception:
        # keep last-good on failure rather than blanking the UI
        with _lock:
            hit = _cache.get(key)
        return hit[1] if hit else {"items": [], "source": "NSE", "error": "unavailable"}
    with _lock:
        _cache[key] = (now, data)
    return data


def _s(v):
    return "" if v is None else str(v).strip()


# ── parsers (pure; take the raw decoded JSON) ──
def parse_announcements(raw) -> dict:
    rows = raw if isinstance(raw, list) else (raw or {}).get("data", raw) or []
    if not isinstance(rows, list):
        rows = []
    out = []
    for r in rows[:40]:
        out.append({
            "date": _s(r.get("an_dt") or r.get("sort_date") or r.get("dt")),
            "subject": _s(r.get("desc") or r.get("subject") or r.get("attchmntText"))[:200],
            "detail": _s(r.get("attchmntText") or r.get("smIndustry"))[:400],
            "attachment": _s(r.get("attchmntFile") or r.get("attachment")),
        })
    return {"items": [o for o in out if o["subject"] or o["detail"]], "source": "NSE"}


def parse_actions(raw) -> dict:
    rows = raw if isinstance(raw, list) else (raw or {}).get("data", raw) or []
    if not isinstance(rows, list):
        rows = []
    out = []
    for r in rows[:40]:
        out.append({
            "type": _s(r.get("subject") or r.get("purpose") or r.get("action")),
            "ex_date": _s(r.get("exDate") or r.get("ex_date")),
            "record_date": _s(r.get("recDate") or r.get("record_date")),
            "detail": _s(r.get("subject") or r.get("purpose")),
        })
    return {"items": [o for o in out if o["type"]], "source": "NSE"}


def _num(v):
    try:
        return round(float(str(v).replace(",", "").replace("%", "").strip()), 2)
    except Exception:
        return None


def parse_shareholding(raw) -> dict:
    # NSE returns a list of quarterly records; take the latest and normalise the
    # promoter / FII / DII / public split + promoter pledge if present.
    rows = raw if isinstance(raw, list) else (raw or {}).get("data", raw) or []
    if not isinstance(rows, list) or not rows:
        return {"latest": None, "source": "NSE"}
    r = rows[0]
    latest = {
        "date": _s(r.get("date") or r.get("submissionDate") or r.get("asOnDate")),
        "promoter": _num(r.get("promoter") or r.get("promoterAndPromoterGroup")),
        "fii": _num(r.get("fii") or r.get("foreignInstitutions")),
        "dii": _num(r.get("dii") or r.get("domesticInstitutions")),
        "public": _num(r.get("public") or r.get("publicShareholding")),
        "pledge": _num(r.get("pledge") or r.get("pledgePercentage")),
    }
    return {"latest": latest, "source": "NSE"}


def parse_deals(raw) -> dict:
    # Market-wide bulk/block deals snapshot.
    data = raw or {}
    bulk = data.get("BULK_DEALS_DATA") or data.get("bulk") or (data if isinstance(data, list) else [])
    block = data.get("BLOCK_DEALS_DATA") or data.get("block") or []

    def norm(rows, kind):
        out = []
        for r in (rows or [])[:60]:
            out.append({
                "kind": kind,
                "date": _s(r.get("date") or r.get("BD_DT_DATE")),
                "symbol": _s(r.get("symbol") or r.get("BD_SYMBOL")),
                "client": _s(r.get("clientName") or r.get("BD_CLIENT_NAME"))[:80],
                "side": _s(r.get("buySell") or r.get("BD_BUY_SELL")),
                "qty": _num(r.get("qty") or r.get("BD_QTY_TRD")),
                "price": _num(r.get("price") or r.get("BD_TP_WATP")),
            })
        return [o for o in out if o["symbol"]]

    return {"bulk": norm(bulk, "bulk"), "block": norm(block, "block"), "source": "NSE"}


# ── public API (fetch injected) ──
def announcements(symbol, fetch):
    sym = symbol.upper().strip()
    return _cached("ann:" + sym, TTL, lambda: parse_announcements(fetch(URLS["announcements"].format(sym=sym))))


def actions(symbol, fetch):
    sym = symbol.upper().strip()
    return _cached("act:" + sym, TTL, lambda: parse_actions(fetch(URLS["actions"].format(sym=sym))))


def shareholding(symbol, fetch):
    sym = symbol.upper().strip()
    return _cached("shp:" + sym, TTL, lambda: parse_shareholding(fetch(URLS["shareholding"].format(sym=sym))))


def deals(fetch):
    return _cached("deals", DEALS_TTL, lambda: parse_deals(fetch(URLS["deals"])))
