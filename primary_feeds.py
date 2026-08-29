"""Primary-market (IPO) and fixed-income (G-Sec / SGB) feeds.

Parses NSE's public JSON APIs for the landing page's Upcoming-IPO and
fixed-returns windows. The HTTP fetcher is injected (server.py passes its
cookie-warmed ``nse_get``) so this module stays stdlib-only and the parsing
is unit-testable offline. NSE responses drift over time, so every field is
read through key aliases and a row is kept as long as it names an issue.
"""


def _first(d, *keys):
    for k in keys:
        v = d.get(k)
        if v not in (None, "", "-"):
            return v
    return None


def _fnum(v):
    try:
        n = float(str(v).replace(",", "").replace("%", "").strip())
    except Exception:
        return None
    return round(n, 2) if n == n else None  # NaN guard


def parse_ipos(fetch):
    """(items, err) — current + upcoming public issues, current first.

    items: [{symbol, name, series, start, end, price_band, size, status}]
    ``fetch(path, params)`` must return decoded JSON or raise.
    """
    out, errs = [], []
    for path, params, status in (
        ("/api/ipo-current-issues", None, "open"),
        ("/api/all-upcoming-issues", {"category": "ipo"}, "upcoming"),
    ):
        try:
            data = fetch(path, params)
            rows = data if isinstance(data, list) else (data or {}).get("data") or []
            for it in rows:
                if not isinstance(it, dict):
                    continue
                sym = str(_first(it, "symbol", "sym") or "").strip().upper()
                name = str(_first(it, "companyName", "company", "issuer", "name") or sym).strip()
                if not sym and not name:
                    continue
                out.append({
                    "symbol": sym,
                    "name": name,
                    "series": str(_first(it, "series", "sr") or "").strip().upper(),
                    "start": str(_first(it, "issueStartDate", "startDate", "issueStart") or ""),
                    "end": str(_first(it, "issueEndDate", "endDate", "issueEnd") or ""),
                    "price_band": str(_first(it, "priceBand", "issuePrice", "price") or ""),
                    "size": str(_first(it, "issueSize", "size") or ""),
                    "status": status,
                })
        except Exception as e:  # feed down ≠ page down
            errs.append(f"{status}: {e}")
    seen, uniq = set(), []
    for it in out:  # an issue can appear in both lists — the 'open' row wins
        k = (it["symbol"] or it["name"]).upper()
        if k in seen:
            continue
        seen.add(k)
        uniq.append(it)
    return uniq, ("; ".join(errs) if errs and not uniq else None)


_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _iso(v):
    """NSE writes '28-Aug-2026'. Returns YYYY-MM-DD, or None."""
    parts = str(v or "").strip().replace("/", "-").split("-")
    if len(parts) != 3:
        return None
    try:
        d, mon, y = int(parts[0]), _MONTHS.get(parts[1][:3].lower()), int(parts[2])
        return f"{y:04d}-{mon:02d}-{d:02d}" if mon and 1 <= d <= 31 else None
    except (ValueError, TypeError):
        return None


def rank_ipos(items, today=None):
    """Only issues you can still act on, in the order they open.

    Applied when the feed is SERVED rather than when it is cached, because all
    three answers here are functions of today's date: a payload cached this
    morning — or restored from yesterday's disk copy — would otherwise keep
    calling a closed book "opening soon".

      * A book whose close date has passed is history, not upcoming.
      * NSE's own `status` says only which of its two lists the row came from,
        and its "upcoming" list carries issues that are open right now. The
        badge has to come from the dates.
      * Feed order is not date order, so "the next five" was five arbitrary
        issues.
    """
    import datetime
    if not isinstance(items, list):
        return []
    today = (today or datetime.date.today()).isoformat()
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        opens, closes = _iso(it.get("start")), _iso(it.get("end"))
        if closes and closes < today:
            continue
        row = dict(it)
        if opens and closes:
            row["status"] = "open" if opens <= today <= closes else "upcoming"
        elif opens:
            row["status"] = "open" if opens <= today else "upcoming"
        row["opens_on"] = opens
        row["closes_on"] = closes
        out.append(row)
    out.sort(key=lambda r: (r.get("opens_on") is None, r.get("opens_on") or "",
                            r.get("symbol") or ""))
    return out


def parse_gsec(fetch):
    """(items, err) — traded government securities and sovereign gold bonds.

    items: [{symbol, series, kind, ltp, chg, yld, coupon, maturity}] with
    kind in {'gsec', 'sgb'}. Yields are traded (market) yields, not bank
    deposit rates.
    """
    out, errs = [], []
    for kind in ("gsec", "sgb"):
        try:
            data = fetch("/api/liveBonds-traded-on-cds", {"type": kind})
            rows = data if isinstance(data, list) else (data or {}).get("data") or []
            for it in rows:
                if not isinstance(it, dict):
                    continue
                sym = str(_first(it, "symbol", "sym") or "").strip().upper()
                if not sym:
                    continue
                out.append({
                    "symbol": sym,
                    "series": str(_first(it, "series") or "").strip().upper(),
                    "kind": kind,
                    "ltp": _fnum(_first(it, "lastPrice", "ltp", "averagePrice", "close")),
                    "chg": _fnum(_first(it, "pChange", "perChange", "chg")),
                    "yld": _fnum(_first(it, "yield", "averageYield", "ytm", "indicativeYield")),
                    "coupon": _fnum(_first(it, "couponRate", "coupon", "faceInterestRate")),
                    "maturity": str(_first(it, "maturityDate", "redemptionDate", "maturity") or ""),
                })
        except Exception as e:
            errs.append(f"{kind}: {e}")
    # G-Secs first, then SGBs; within a kind, most traded shape is preserved.
    out.sort(key=lambda r: 0 if r["kind"] == "gsec" else 1)
    return out, ("; ".join(errs) if errs and not out else None)
