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
