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
    # NSE answers either a bare list or {"data": [...]}, and on a bad day a
    # bare error string — which must produce an empty calendar, not a 500.
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("data") or []
    else:
        rows = []
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
    # NSE answers either a bare list or {"data": [...]}, and on a bad day a
    # bare error string — which must produce an empty calendar, not a 500.
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("data") or []
    else:
        rows = []
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


# ── Market-wide corporate action calendar ───────────────────────────────────
# The per-symbol feed above answers "what is coming for THIS company". A desk
# needs the other question — "what is coming at all" — which is a different NSE
# endpoint, and the one the Desk landing page is built on.

_KINDS = (
    # Order matters: a subject can mention more than one word, and the more
    # specific reading wins. "Bonus" inside a dividend line is rare but a
    # rights issue that also mentions a dividend is not.
    ("bonus", "Bonus"),
    ("split", "Split"),
    ("sub-division", "Split"),
    ("sub division", "Split"),
    ("rights", "Rights"),
    ("buy back", "Buyback"),
    ("buyback", "Buyback"),
    ("dividend", "Dividend"),
)

KINDS = ("Dividend", "Bonus", "Split", "Rights", "Buyback", "Other")


def classify_action(subject: str) -> str:
    """Which kind of corporate action a subject line describes.

    NSE publishes the subject as free text ("Dividend - Rs 16 Per Share",
    "Face Value Split (Sub-Division) - From Rs 10/- To Rs 2/-"), with no type
    code, so the type has to be read out of the words.
    """
    s = (subject or "").lower()
    for needle, kind in _KINDS:
        if needle in s:
            return kind
    return "Other"


_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def parse_ca_date(v):
    """NSE writes '31-Aug-2026'. Returns YYYY-MM-DD, or None.

    Sorting on the raw string would put every August before every February,
    which for a calendar is the one thing that must not happen.
    """
    s = (v or "").strip()
    parts = s.replace("/", "-").split("-")
    if len(parts) != 3:
        return None
    try:
        d = int(parts[0])
        mon = _MONTHS.get(parts[1][:3].lower())
        y = int(parts[2])
        if not mon or not (1 <= d <= 31):
            return None
        return f"{y:04d}-{mon:02d}-{d:02d}"
    except (ValueError, TypeError):
        return None


def parse_calendar(raw) -> dict:
    # NSE answers either a bare list or {"data": [...]}, and on a bad day a
    # bare error string — which must produce an empty calendar, not a 500.
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("data") or []
    else:
        rows = []
    if not isinstance(rows, list):
        rows = []
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        sym = _s(r.get("symbol"))
        subject = _s(r.get("subject"))
        if not sym or not subject:
            continue
        ex = parse_ca_date(r.get("exDate"))
        out.append({
            "symbol": sym,
            "name": _s(r.get("comp")) or sym,
            "kind": classify_action(subject),
            "subject": subject,
            "ex_date": ex,
            "record_date": parse_ca_date(r.get("recDate")),
            "series": _s(r.get("series")),
        })
    # Undated entries last rather than first: an empty string sorts before
    # every real date, which would put the least useful rows at the top.
    out.sort(key=lambda x: (x["ex_date"] is None, x["ex_date"] or "", x["symbol"]))
    return {"items": out, "source": "NSE"}


def calendar(fetch, days: int = 30) -> dict:
    """Upcoming actions across the whole market, for the next `days`."""
    import datetime
    days = max(1, min(int(days or 30), 90))
    today = datetime.date.today()
    end = today + datetime.timedelta(days=days)
    # A full URL, like every other entry in URLS: the injected fetch takes one.
    url = (BASE + "/api/corporates-corporateActions?index=equities"
           f"&from_date={today.strftime('%d-%m-%Y')}"
           f"&to_date={end.strftime('%d-%m-%Y')}")
    return _cached(f"calendar:{days}", 1800, lambda: parse_calendar(fetch(url)))
