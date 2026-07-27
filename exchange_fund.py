"""Fundamentals straight from the exchanges — BSE for ratios, NSE for growth.

This replaces the screener.in scrape. screener.in is a derived source: it
re-publishes filings NSE and BSE put out themselves, and pulling a company page
per symbol is automated access its terms do not allow. The exchanges publish the
same numbers first-hand, for public consumption, and we are already an NSE client
for prices and bhavcopy.

Two sources, verified answering from the production VM (see
.github/workflows/probe-endpoints.yml):

  BSE  api.bseindia.com/BseIndiaAPI/api/ComHeadernew  → EPS, PE, PB, ROE, OPM,
       NPM, sector, industry, face value — one unauthenticated request.
       ...api/StockTrading                            → full & free-float mcap.

  NSE  /api/corporates-financial-results  → every quarter the company has filed,
       each row linking an XBRL document on nsearchives carrying
       RevenueFromOperations, ProfitLossForPeriod and BasicEarningsLossPerShare
       with the period dates. That is what the growth fields are computed from.

NSE's /api/quote-equity 403s from cloud IPs (confirmed on the VM) — we do not
use it. BSE covers everything it would have given.

Not available here: ROCE (BSE publishes ROE, not ROCE), debt/equity and current
ratio. The last two were already yfinance gap-fills in fundamentals._GAP_FILL,
so only ROCE is genuinely lost versus the old scrape.
"""
import csv
import datetime
import io
import json
import logging
import os
import re
import threading
import time

log = logging.getLogger("quanthunt")

_DIR = os.path.dirname(os.path.abspath(__file__))
_CODES_FILE = os.path.join(_DIR, "bse_codes.json")

TIMEOUT = int(os.environ.get("EXCH_TIMEOUT_SEC", "20"))

# How many quarters to pull per symbol. TTM EPS needs the last 8 (four current
# vs the four before them); QoQ needs 2 and YoY needs 5. Eight covers all of it.
MAX_QUARTERS = 8

_UA = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept-Language": "en-US,en;q=0.9",
}
_BSE_HEADERS = dict(_UA, Referer="https://www.bseindia.com/")
_BSE_API = "https://api.bseindia.com/BseIndiaAPI/api"
_BSE_BASE = "https://www.bseindia.com"
_NSE_BASE = "https://www.nseindia.com"


def _num(x):
    """Parse an exchange figure ('1,281.37', '28.98', '', '-') → float or None."""
    if x is None:
        return None
    s = str(x).strip().replace(",", "")
    if not s or s in ("-", "--", "NA", "N.A.", "null"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v == v else None          # drop NaN


def _pos(x):
    """As _num, but treats 0 as absent. BSE sends 0.00 for 'not reported',
    and a zero PE or ROE would otherwise pass a '< 15' screen as a real value."""
    v = _num(x)
    return v if v else None


# ---------- symbol → BSE scrip code ----------
# BSE's API is keyed by scrip code (500325), not ticker. The daily cash-market
# bhavcopy carries FinInstrmId (the code), ISIN and TckrSymb together, so the map
# comes from a file the exchange already publishes — no lookup service needed.
_codes: dict = {}
_codes_day = ""
_codes_lock = threading.Lock()


def _load_codes_cache() -> None:
    global _codes, _codes_day
    try:
        with open(_CODES_FILE) as f:
            blob = json.load(f)
        if isinstance(blob, dict) and blob.get("codes"):
            _codes = blob["codes"]
            _codes_day = blob.get("day", "")
    except Exception:
        pass


def _fetch_codes() -> dict:
    """symbol → scrip code from the BSE bhavcopy. Walks back over weekends."""
    import requests
    sess = requests.Session()
    sess.headers.update(_BSE_HEADERS)
    try:
        sess.get(_BSE_BASE, timeout=8)     # warm cookies, as the site expects
    except Exception:
        pass
    today = datetime.date.today()
    for delta in range(7):
        d = today - datetime.timedelta(days=delta)
        url = (_BSE_BASE + "/download/BhavCopy/Equity/"
               "BhavCopy_BSE_CM_0_0_0_%s_F_0000.CSV" % d.strftime("%Y%m%d"))
        try:
            r = sess.get(url, timeout=TIMEOUT)
            if r.status_code != 200 or "," not in r.text[:200]:
                continue
            out = {}
            for row in csv.DictReader(io.StringIO(r.text)):
                if (row.get("FinInstrmTp") or "").strip().upper() not in ("STK", "EQ", ""):
                    continue
                sym = (row.get("TckrSymb") or "").strip().upper()
                code = (row.get("FinInstrmId") or "").strip()
                if sym and code.isdigit():
                    out[sym] = code
            if out:
                log.info("BSE scrip codes %s: %d symbols", d, len(out))
                return out
        except Exception as e:
            log.warning("BSE scrip-code fetch %s failed: %s", d, e)
    return {}


def bse_code(sym: str):
    """Scrip code for an NSE symbol, or None when the company is NSE-only.

    Dual-listed companies use the same ticker on both exchanges, which is the
    overwhelming majority of the NSE list. A miss is not an error: the symbol
    simply gets its growth from NSE and its ratios from the yfinance fallback.
    """
    global _codes, _codes_day
    today = datetime.date.today().isoformat()
    with _codes_lock:
        if not _codes:
            _load_codes_cache()
        if _codes and _codes_day == today:
            return _codes.get(sym.strip().upper())
    fresh = _fetch_codes()
    with _codes_lock:
        if fresh:
            _codes, _codes_day = fresh, today
            try:
                with open(_CODES_FILE, "w") as f:
                    json.dump({"day": today, "codes": fresh}, f)
            except Exception:
                pass
        return (_codes or {}).get(sym.strip().upper())


# ---------- BSE: ratios + market cap ----------
def _bse_ratios(code: str) -> dict:
    import requests
    out = {}
    try:
        r = requests.get(_BSE_API + "/ComHeadernew/w",
                         params={"quotetype": "EQ", "scripcode": code, "seriesid": ""},
                         headers=_BSE_HEADERS, timeout=TIMEOUT)
        if r.status_code == 200:
            d = r.json() or {}
            out.update({
                "eps": _pos(d.get("EPS")),
                "pe": _pos(d.get("PE")),
                "pb": _pos(d.get("PB")),
                "roe": _pos(d.get("ROE")),
                # IndustryNew is the GICS-style bucket; Industry is the narrow
                # one. Sector maps onto our own taxonomy downstream.
                "sector": (d.get("Sector") or "").strip() or None,
                "industry": ((d.get("IndustryNew") or d.get("Industry") or "").strip()
                             or None),
            })
    except Exception as e:
        log.debug("BSE ratios %s failed: %s", code, e)
    try:
        r = requests.get(_BSE_API + "/StockTrading/w",
                         params={"flag": "", "quotetype": "EQ", "scripcode": code},
                         headers=_BSE_HEADERS, timeout=TIMEOUT)
        if r.status_code == 200:
            d = r.json() or {}
            out["market_cap_cr"] = _pos(d.get("MktCapFull"))   # already in crore
    except Exception as e:
        log.debug("BSE mcap %s failed: %s", code, e)
    return out


# ---------- NSE: quarterly filings ----------
# Two taxonomies. Industrials file INDAS_*.xml; banks file BANKING_*.xml with an
# entirely different vocabulary — no RevenueFromOperations at all, because a bank
# reports Interest Earned + Other Income, whose total is `Income`. Each key below
# lists the alternates in preference order, so one parser handles both.
_XBRL_TAGS = {
    "revenue": ("RevenueFromOperations",          # Ind-AS
                "Income"),                        # banking: total income
    "profit": ("ProfitLossForPeriod",             # Ind-AS
               "ProfitLossForThePeriod",          # banking
               "ProfitLossFromOrdinaryActivitiesAfterTax"),
    "eps": ("BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations",
            "BasicEarningsPerShareAfterExtraordinaryItems",       # banking
            "BasicEarningsPerShareBeforeExtraordinaryItems",
            "BasicEarningsLossPerShareFromContinuingOperations"),
}
_XBRL_END = "DateOfEndOfReportingPeriod"

# The context carrying the three-month column.
#
# These filings declare the SAME startDate/endDate on the quarter context and on
# the year-to-date one — verified on Reliance's Q3FY25, where OneD and FourD both
# say 2024-10-01→2024-12-31 while FourD's revenue is the nine-month figure. So
# the period dates cannot be used to tell them apart; the filer distinguishes
# them only by the One/Two/Three/Four context-id convention, where One is the
# current quarter. Picking the wrong one would silently compare a quarter against
# a nine-month total and report growth that never happened.
_QUARTER_CTX = "OneD"


def _facts(text: str, tag: str) -> list:
    """All (contextRef, value) pairs for a tag. Elements are namespaced
    (in-bse-fin:Foo) and carry attributes, so match the local name exactly —
    a loose match would hit ...PerShareFromDiscontinuedOperations too."""
    out = []
    for m in re.finditer(r"<[A-Za-z0-9_\-]+:%s(\s[^>]*)?>([^<]*)</" % re.escape(tag), text):
        attrs = m.group(1) or ""
        ctx = re.search(r'contextRef="([^"]+)"', attrs)
        out.append((ctx.group(1) if ctx else "", m.group(2).strip()))
    return out


def _xbrl_value(text: str, tag: str):
    """Quarter value for a tag: the OneD context, else the first occurrence."""
    facts = _facts(text, tag)
    if not facts:
        return None
    for ctx, val in facts:
        if ctx == _QUARTER_CTX:
            return val
    return facts[0][1]


def _parse_xbrl(text: str) -> dict:
    out = {}
    for key, tags in _XBRL_TAGS.items():
        for tag in tags:
            v = _num(_xbrl_value(text, tag))
            if v is not None:
                out[key] = v
                break
    end = _xbrl_value(text, _XBRL_END)
    if end:
        out["end"] = end
    return out


_sess = None
_sess_ts = 0.0
_sess_lock = threading.Lock()
SESSION_TTL = int(os.environ.get("EXCH_SESSION_TTL_SEC", "600"))


def _nse_session(force=False):
    """One shared NSE session, refreshed every SESSION_TTL.

    NSE hands out its cookie on the homepage and API calls without it 403 even
    from IPs that are otherwise fine — but building a session per symbol meant
    an extra homepage hit each time, and the cookie went stale mid-sweep (SBIN
    came back with zero filings on one pass and 145 rows on the next). Sharing
    it cuts two requests per symbol and keeps the cookie warm.
    """
    global _sess, _sess_ts
    import requests
    with _sess_lock:
        if _sess is not None and not force and (time.time() - _sess_ts) < SESSION_TTL:
            return _sess
        s = requests.Session()
        s.headers.update(dict(_UA, Referer=_NSE_BASE + "/"))
        try:
            s.get(_NSE_BASE + "/", timeout=TIMEOUT)
        except Exception:
            pass
        _sess, _sess_ts = s, time.time()
        return s


def _quarters(sym: str, sess=None) -> list:
    """Most recent quarters first, each {'revenue','profit','eps','end'}.

    Standalone ('Non-Consolidated') filings only — mixing the two would compare
    a consolidated quarter against a standalone one and invent growth that never
    happened. Standalone is what every company files every quarter; consolidated
    is optional for some.
    """
    rows = None
    # One retry on a fresh session: a stale cookie answers non-200, and losing a
    # symbol's whole filing history to that would silently blank its growth
    # fields for the full cache TTL.
    for attempt in (0, 1):
        s = sess if (sess is not None and attempt == 0) else _nse_session(force=attempt == 1)
        try:
            r = s.get(_NSE_BASE + "/api/corporates-financial-results",
                      params={"index": "equities", "symbol": sym, "period": "Quarterly"},
                      timeout=TIMEOUT)
            if r.status_code == 200:
                rows = r.json()
                break
        except Exception as e:
            log.debug("NSE results %s attempt %d failed: %s", sym, attempt + 1, e)
    if not isinstance(rows, list):
        return []
    sess = _nse_session()

    seen, picked = set(), []
    for row in rows:
        if not isinstance(row, dict) or not row.get("xbrl"):
            continue
        if (row.get("consolidated") or "").strip().lower() != "non-consolidated":
            continue
        key = (row.get("fromDate"), row.get("toDate"))
        if key in seen:
            continue                      # revised filings repeat a period
        seen.add(key)
        picked.append(row)
        if len(picked) >= MAX_QUARTERS:
            break

    out = []
    for row in picked:
        try:
            x = sess.get(row["xbrl"], timeout=TIMEOUT)
            if x.status_code != 200:
                continue
            q = _parse_xbrl(x.text)
        except Exception:
            continue
        if q.get("revenue") is not None or q.get("eps") is not None:
            q.setdefault("end", (row.get("toDate") or "").strip())
            out.append(q)
    return out


def _growth(new, old):
    """Percent change, or None where a percentage would be a lie.

    A negative or zero base makes growth meaningless — a swing from -10 cr to
    +5 cr is not "150% growth", and printing that would let it pass a ">= 10%"
    screen. Those cases return None so the filter skips the row instead of
    admitting it on a fake number. Same rule the screener.in path used.
    """
    if new is None or old is None or old <= 0:
        return None
    return round((new - old) / old * 100, 1)


def _sum(qs, key):
    vals = [q.get(key) for q in qs]
    return sum(vals) if vals and all(v is not None for v in vals) else None


# A bonus or split changes the share count, and the filing for the earlier
# quarter is NOT restated — so EPS across it measures dilution, not earnings.
# Reliance's Q3FY25 is the worked example: PAT fell 12.1% while filed EPS fell
# 56.1% (14.67 → 6.44), an implied share-count ratio of 2.002 — exactly the 1:1
# bonus of October 2024. Left alone, that number would throw a stock out of an
# "EPS growth > 10%" screen for a reason that has nothing to do with the
# business.
#
# PAT and EPS must otherwise move together, so their ratio is the share count.
# Anything outside this band means the count moved and the EPS comparison is
# void; buybacks and ESOP issues move it by a few percent, while the smallest
# real bonus/split (5:4) moves it 25%.
_SHARE_COUNT_BAND = 0.10


def _share_count_stable(pat_new, pat_old, eps_new, eps_old) -> bool:
    """False when the implied share count moved enough to void an EPS comparison.

    Unknown inputs return True — the caller has already range-checked what it
    could, and refusing to answer on missing PAT would blank EPS growth for
    every company whose profit line failed to parse.
    """
    for v in (pat_new, pat_old, eps_new, eps_old):
        if v is None or v <= 0:
            return True
    implied = (pat_new / pat_old) / (eps_new / eps_old)
    return abs(implied - 1.0) <= _SHARE_COUNT_BAND


def growth_from_quarters(qs: list) -> dict:
    """Growth fields from newest-first quarters. Kept separate from the fetch so
    the arithmetic is testable without a network."""
    out = {"revenue_growth_pct": None, "earnings_growth_pct": None,
           "revenue_qoq_pct": None, "earnings_qoq_pct": None,
           "eps_growth_yoy_pct": None, "eps_ttm_growth_pct": None}
    if not qs:
        return out
    cur = qs[0]
    if len(qs) >= 2:                       # sequential quarter
        out["revenue_qoq_pct"] = _growth(cur.get("revenue"), qs[1].get("revenue"))
        out["earnings_qoq_pct"] = _growth(cur.get("profit"), qs[1].get("profit"))
    if len(qs) >= 5:                       # same quarter a year earlier
        yr = qs[4]
        out["revenue_growth_pct"] = _growth(cur.get("revenue"), yr.get("revenue"))
        out["earnings_growth_pct"] = _growth(cur.get("profit"), yr.get("profit"))
        # Both EPS measures span the same year, so one share-count check covers
        # them: if a bonus/split landed in it, neither comparison is meaningful.
        if _share_count_stable(cur.get("profit"), yr.get("profit"),
                               cur.get("eps"), yr.get("eps")):
            out["eps_growth_yoy_pct"] = _growth(cur.get("eps"), yr.get("eps"))
            if len(qs) >= 8:               # trailing twelve months vs the prior
                out["eps_ttm_growth_pct"] = _growth(_sum(qs[:4], "eps"),
                                                    _sum(qs[4:8], "eps"))
    return out


# ---------- public ----------
def fetch(sym: str):
    """Fundamentals for one NSE symbol, or None when neither source answered.

    Returned in fundamentals.FIELDS shape; keys this source cannot supply are
    absent, so fundamentals' yfinance gap-fill still runs for them.
    """
    sym = (sym or "").strip().upper()
    if not sym:
        return None

    data, used = {}, []
    code = None
    try:
        code = bse_code(sym)
    except Exception as e:
        log.debug("BSE code lookup %s failed: %s", sym, e)
    if code:
        r = _bse_ratios(code)
        if any(v is not None for v in r.values()):
            data.update({k: v for k, v in r.items() if v is not None})
            used.append("BSE")

    try:
        qs = _quarters(sym)
    except Exception as e:
        log.debug("NSE quarters %s failed: %s", sym, e)
        qs = []
    if qs:
        g = growth_from_quarters(qs)
        if any(v is not None for v in g.values()):
            data.update(g)
            used.append("NSE")
        data["quarters"] = len(qs)
        if qs[0].get("eps") is not None and data.get("eps") is None:
            data["eps"] = qs[0]["eps"]     # BSE silent → take it from the filing

    if not used:
        return None
    data["source"] = "+".join(used)
    data["asof"] = int(time.time())
    return data
