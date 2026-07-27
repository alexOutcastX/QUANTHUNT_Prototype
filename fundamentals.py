"""Bulk fundamentals cache — instant fundamental screening.

Fetches per-symbol fundamentals from EODHD (when EODHD_API_KEY is set) with a
yfinance fallback, normalizes them to one compact schema, and caches them in
memory + on disk. The screener requests them in bulk (`/fundamentals/bulk`), so
after a background warm-up fundamental filters run client-side with no per-filter
network round-trip. The disk cache (fund_cache.json) survives restarts.

EODHD is the preferred source because it answers from datacenter IPs (yfinance
and NSE bot-wall them). Set EODHD_API_KEY in the environment (see DEPLOY-ORACLE.md).
Without a key we fall back to yfinance, which works from residential/Mumbai IPs.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

EODHD_KEY = (os.environ.get("EODHD_API_KEY") or "").strip()
# Provider order. 'auto' = [eodhd if key] -> screener.in -> yfinance. Override with
# FUND_SOURCE (e.g. "screener", "yfinance", "screener,yfinance", "eodhd").
FUND_SOURCE = (os.environ.get("FUND_SOURCE") or "auto").strip().lower()
TTL = int(os.environ.get("FUND_TTL_SEC", str(7 * 24 * 3600)))   # fundamentals move slowly → 7 days
# A failed lookup caches an empty payload; without a shorter TTL that blank would
# stick for the full 7 days, so a single transient provider outage permanently
# blanks a symbol's fundamentals. Retry failed lookups much sooner instead.
NEG_TTL = int(os.environ.get("FUND_NEG_TTL_SEC", "1800"))        # 30 min
_DIR = os.path.dirname(os.path.abspath(__file__))
_FILE = os.path.join(_DIR, "fund_cache.json")

# sym -> {"data": {<schema>}, "ts": epoch}
_cache: dict = {}
_inflight: set = set()
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=6)   # bounded so we never hammer the providers
_dirty = False

# The compact schema the screener's fundamental filters read.
FIELDS = ("pe", "forward_pe", "pb", "eps", "dividend_yield", "roe", "roce",
          "debt_equity", "current_ratio", "market_cap_cr", "sector", "industry",
          # Growth. The Custom screener has offered Revenue Growth / Earnings
          # Growth filters for a while, but this payload never carried them, so
          # every row read null and the filters matched nothing. Both are
          # most-recent-quarter vs the same quarter a year earlier (that is what
          # both providers report) — quarterly YoY, not full-year FY vs FY.
          #
          # QoQ and EPS growth come from screener.in's quarterly / annual
          # tables, which are in the SAME page already fetched for #top-ratios —
          # so they cost no extra request. EODHD and yfinance expose neither in
          # their per-symbol payloads and leave them null; screener.in is first
          # in the provider chain ahead of yfinance, so in practice they are
          # populated.
          "revenue_growth_pct", "earnings_growth_pct",
          "revenue_qoq_pct", "earnings_qoq_pct",
          "eps_growth_yoy_pct", "eps_ttm_growth_pct")


# Cache entries are stamped with a fingerprint of FIELDS. fund_cache.json has a
# 7-day TTL and is deliberately excluded from the deploy rsync, so it outlives
# releases — which means adding a field to the schema is NOT enough to make it
# appear: every symbol cached under the old shape keeps answering without the
# new key until its TTL expires. A screener filter reading that missing key gets
# null and matches nothing, which is exactly how the growth filters shipped
# looking broken. Deriving the stamp from FIELDS makes this automatic: change
# the schema, and every stale-shaped entry is refetched on next use.
SCHEMA_V = hashlib.md5(",".join(sorted(FIELDS)).encode()).hexdigest()[:8]


# ---------- persistence ----------
def _load() -> None:
    try:
        with open(_FILE) as f:
            data = json.load(f)
        if isinstance(data, dict):
            with _lock:
                _cache.update(data)
    except Exception:
        pass


def _save() -> None:
    global _dirty
    try:
        with _lock:
            snap = dict(_cache)
            _dirty = False
        tmp = _FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(snap, f)
        os.replace(tmp, _FILE)   # atomic
    except Exception:
        pass


def _fresh(sym: str) -> bool:
    e = _cache.get(sym)
    if not e or e.get("v") != SCHEMA_V:
        return False
    # A populated result is good for the full TTL; an empty (failed) result only
    # for the short negative TTL, so outages self-heal instead of sticking.
    ttl = TTL if e.get("data") else NEG_TTL
    return (time.time() - e["ts"]) < ttl


# ---------- normalization ----------
def _n(x):
    return round(x, 2) if isinstance(x, (int, float)) else None


def _pct(x):
    return round(x * 100, 2) if isinstance(x, (int, float)) else None


def _map_eodhd(fund: dict) -> dict:
    hi = fund.get("Highlights") or {}
    val = fund.get("Valuation") or {}
    gen = fund.get("General") or {}
    mc = hi.get("MarketCapitalization")
    return {
        "pe": _n(hi.get("PERatio")) or _n(val.get("TrailingPE")),
        "forward_pe": _n(val.get("ForwardPE")),
        "pb": _n(val.get("PriceBookMRQ")),
        "eps": hi.get("EarningsShare"),
        "dividend_yield": _pct(hi.get("DividendYield")),
        "roe": _pct(hi.get("ReturnOnEquityTTM")),
        "roce": _pct(hi.get("ReturnOnAssetsTTM")),   # ROA proxy (EODHD has no direct ROCE)
        "debt_equity": None,                          # not in Highlights
        "current_ratio": None,
        "market_cap_cr": round(mc / 1e7, 2) if isinstance(mc, (int, float)) and mc else None,
        "sector": gen.get("Sector"),
        "industry": gen.get("Industry"),
        "revenue_growth_pct": _pct(hi.get("QuarterlyRevenueGrowthYOY")),
        "earnings_growth_pct": _pct(hi.get("QuarterlyEarningsGrowthYOY")),
        # Sequential-quarter and EPS growth need the full quarterly/annual
        # series, which this provider's per-symbol payload does not carry.
        # screener.in fills them (see _screener_growth).
        "revenue_qoq_pct": None,
        "earnings_qoq_pct": None,
        "eps_growth_yoy_pct": None,
        "eps_ttm_growth_pct": None,
        "source": "EODHD",
    }


def _map_yf(info: dict) -> dict:
    mc = info.get("marketCap")
    return {
        "pe": _n(info.get("trailingPE")),
        "forward_pe": _n(info.get("forwardPE")),
        "pb": _n(info.get("priceToBook")),
        "eps": info.get("trailingEps"),
        "dividend_yield": _pct(info.get("dividendYield")),
        "roe": _pct(info.get("returnOnEquity")),
        "roce": _pct(info.get("returnOnAssets")),
        "debt_equity": _n(info.get("debtToEquity")),
        "current_ratio": _n(info.get("currentRatio")),
        "market_cap_cr": round(mc / 1e7, 2) if isinstance(mc, (int, float)) and mc else None,
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        # yfinance reports these as ratios (0.275 = +27.5%), same as the other
        # _pct fields above. earningsGrowth is PAT growth, not EPS growth.
        "revenue_growth_pct": _pct(info.get("revenueGrowth")),
        "earnings_growth_pct": _pct(info.get("earningsGrowth")),
        # Sequential-quarter and EPS growth need the full quarterly/annual
        # series, which this provider's per-symbol payload does not carry.
        # screener.in fills them (see _screener_growth).
        "revenue_qoq_pct": None,
        "earnings_qoq_pct": None,
        "eps_growth_yoy_pct": None,
        "eps_ttm_growth_pct": None,
        "source": "yfinance",
    }


# ---------- fetchers ----------
def _fetch_eodhd(sym: str):
    import requests
    url = f"https://eodhd.com/api/fundamentals/{sym}.NSE?api_token={EODHD_KEY}&fmt=json"
    r = requests.get(url, timeout=40, headers={"Accept": "application/json"})
    if r.status_code != 200:
        return None
    fund = r.json()
    return _map_eodhd(fund) if isinstance(fund, dict) else None


def _fetch_yf(sym: str):
    import yfinance as yf
    info = yf.Ticker(f"{sym}.NS").info or {}
    return _map_yf(info) if info else None


# ---------- screener.in scraper ----------
_SCR_UA = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept-Language": "en-US,en;q=0.9",
}


def _snum(s):
    """Parse a screener.in figure like '17,87,234' / '₹ 1,320' / '22.5 %' → float."""
    if s is None:
        return None
    s = str(s).replace(",", "").replace("₹", "").replace("%", "").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _parse_screener(html: str) -> dict | None:
    """Parse the #top-ratios box on a screener.in company page into our schema.
    Kept separate from the HTTP fetch so it can be unit-tested offline."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    ul = soup.find(id="top-ratios")
    if not ul:
        return None
    ratios: dict = {}
    for li in ul.find_all("li"):
        name_el = li.find(class_="name")
        if not name_el:
            continue
        name = name_el.get_text(" ", strip=True).lower()
        val_el = li.find(class_="value") or li
        nums = [_snum(n.get_text()) for n in val_el.find_all(class_="number")]
        ratios[name] = [n for n in nums if n is not None]

    def first(key):
        v = ratios.get(key)
        return v[0] if v else None

    pe = first("stock p/e")
    price = first("current price")
    book = first("book value")
    return {
        "pe": pe,
        "forward_pe": None,
        "pb": round(price / book, 2) if price and book else None,
        "eps": round(price / pe, 2) if price and pe else None,
        "dividend_yield": first("dividend yield"),
        "roe": first("roe"),
        "roce": first("roce"),
        "debt_equity": _screener_de(soup),      # derived from the balance sheet
        "current_ratio": None,                   # not on screener's public page (yfinance fills it)
        "market_cap_cr": first("market cap"),
        "sector": None,
        "industry": None,
        # Growth straight off the quarterly + annual tables on the same page.
        **_screener_growth(soup),
        "source": "screener.in",
    }


def _screener_de(soup):
    """Debt/Equity from screener.in's Balance Sheet:
    Borrowings / (Equity Capital + Reserves), using the latest year column."""
    try:
        sec = soup.find(id="balance-sheet")
        table = sec.find("table") if sec else None
        if not table:
            return None
        rows = {}
        for tr in table.find_all("tr"):
            cells = tr.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            label = cells[0].get_text(" ", strip=True).lower().rstrip("+").strip()
            vals = [v for v in (_snum(c.get_text()) for c in cells[1:]) if v is not None]
            if vals:
                rows[label] = vals[-1]      # latest column
        borrow = rows.get("borrowings")
        equity = (rows.get("equity capital") or 0) + (rows.get("reserves") or 0)
        if borrow is not None and equity:
            return round(borrow / equity, 2)
    except Exception:
        pass
    return None


def _series(soup, section_id) -> dict:
    """{row label: [oldest … latest]} for a screener.in financial table.

    Unlike _screener_de, which only needs the latest column, growth needs the
    whole row: QoQ compares the last two periods and YoY the last and the
    fourth-from-last.
    """
    out: dict = {}
    sec = soup.find(id=section_id)
    table = sec.find("table") if sec else None
    if not table:
        return out
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) < 3:
            continue
        label = cells[0].get_text(" ", strip=True).lower().rstrip("+").strip()
        vals = [_snum(c.get_text()) for c in cells[1:]]
        vals = [v for v in vals if v is not None]
        if label and len(vals) >= 2:
            out[label] = vals
    return out


def _row(series: dict, *names):
    """First matching row — screener.in says 'Sales' for most companies and
    'Revenue' for banks/NBFCs, and suffixes some labels."""
    for want in names:
        for label, vals in series.items():
            if label.startswith(want):
                return vals
    return None


def _growth(new, old):
    """Percent change, or None where a percentage would be a lie.

    A negative or zero base makes growth meaningless — a swing from -10 cr to
    +5 cr is not "150% growth", and printing that would let it pass a
    ">= 10%" screen. Those cases return None so the filter skips the row
    instead of admitting it on a fake number.
    """
    if new is None or old is None or old <= 0:
        return None
    return round((new - old) / old * 100, 1)


def _screener_growth(soup) -> dict:
    """Revenue / profit / EPS growth from the quarterly and annual tables.

    Both tables are already in the page we fetched for #top-ratios, so this is
    free — no extra request per symbol. That is what makes QoQ and real EPS
    growth affordable in a 200-symbol scan, which the yfinance path could not
    do (its `info` payload carries neither).
    """
    out = {
        "revenue_growth_pct": None, "earnings_growth_pct": None,
        "revenue_qoq_pct": None, "earnings_qoq_pct": None,
        "eps_growth_yoy_pct": None, "eps_ttm_growth_pct": None,
    }
    try:
        q = _series(soup, "quarters")
        sales = _row(q, "sales", "revenue")
        profit = _row(q, "net profit")
        eps_q = _row(q, "eps in rs", "eps")
        # QoQ = latest quarter vs the one before it (sequential).
        # YoY = latest quarter vs the same quarter a year earlier (4 back),
        # which is the comparison that strips Indian seasonality.
        if sales and len(sales) >= 2:
            out["revenue_qoq_pct"] = _growth(sales[-1], sales[-2])
        if sales and len(sales) >= 5:
            out["revenue_growth_pct"] = _growth(sales[-1], sales[-5])
        if profit and len(profit) >= 2:
            out["earnings_qoq_pct"] = _growth(profit[-1], profit[-2])
        if profit and len(profit) >= 5:
            out["earnings_growth_pct"] = _growth(profit[-1], profit[-5])
        # TTM EPS vs the four quarters before it — a same-quarter EPS pair is
        # noisy, four-quarter sums are what people mean by "EPS is growing".
        if eps_q and len(eps_q) >= 8:
            out["eps_ttm_growth_pct"] = _growth(sum(eps_q[-4:]), sum(eps_q[-8:-4]))

        p = _series(soup, "profit-loss")
        eps_y = _row(p, "eps in rs", "eps")
        if eps_y and len(eps_y) >= 2:
            out["eps_growth_yoy_pct"] = _growth(eps_y[-1], eps_y[-2])
    except Exception:
        pass
    return out


def _fetch_screener(sym: str):
    import requests
    for path in (f"/company/{sym}/", f"/company/{sym}/consolidated/"):
        try:
            r = requests.get("https://www.screener.in" + path, timeout=25, headers=_SCR_UA)
        except Exception:
            continue
        if r.status_code == 200 and 'id="top-ratios"' in r.text:
            data = _parse_screener(r.text)
            if data and (data.get("pe") or data.get("market_cap_cr") or data.get("roe")):
                return data
    return None


_FETCHERS = {"eodhd": _fetch_eodhd, "screener": _fetch_screener, "yfinance": _fetch_yf}


def _provider_chain() -> list:
    """Default chain. screener.in is deliberately NOT in it.

    It is a derived source — a re-publication of filings the exchanges publish
    themselves — and pulling a company page per symbol is automated access its
    terms do not allow. NSE (quarterly XBRL filings via nsearchives) and BSE
    (ComHeadernew: EPS/PE/PB/ROE/OPM/NPM/sector) publish the same numbers
    first-hand, and we are already an NSE client for prices and bhavcopy.

    The fetcher stays wired so FUND_SOURCE=screener still works for local
    one-off use, but nothing reaches for it on its own.
    """
    if FUND_SOURCE and FUND_SOURCE != "auto":
        return [p.strip() for p in FUND_SOURCE.split(",") if p.strip() in _FETCHERS]
    chain = []
    if EODHD_KEY:
        chain.append("eodhd")
    chain.append("yfinance")
    return chain


# Fields screener.in can't provide from its public page — filled from yfinance
# in 'auto' mode so those filters still work.
_GAP_FILL = ("current_ratio", "forward_pe", "debt_equity", "sector", "industry")


def _fetch_one(sym: str) -> None:
    global _dirty
    data = None
    used = None
    for prov in _provider_chain():
        fn = _FETCHERS.get(prov)
        if not fn:
            continue
        try:
            data = fn(sym)
        except Exception:
            data = None
        if data:
            used = prov
            break
    # Gap-fill from yfinance (auto mode only) when the primary source is a scraper
    # that lacks some fields. Cached for TTL, so this is a one-time cost per symbol.
    if data and used and used != "yfinance" and FUND_SOURCE == "auto" \
            and any(data.get(k) is None for k in _GAP_FILL):
        try:
            yf = _fetch_yf(sym)
        except Exception:
            yf = None
        if yf:
            for k in _GAP_FILL:
                if data.get(k) is None and yf.get(k) is not None:
                    data[k] = yf[k]
            data["source"] = (data.get("source") or "") + "+yfinance"
    with _lock:
        _cache[sym] = {"data": data or {}, "ts": time.time(), "v": SCHEMA_V}
        _inflight.discard(sym)
        _dirty = True


def get_one(sym: str) -> dict:
    """Synchronous single-symbol fetch through the provider chain
    (screener.in → yfinance gap-fill → EODHD), served from cache when fresh.
    Blocks a few seconds on a cold symbol; instant afterwards (disk TTL)."""
    sym = sym.strip().upper()
    if not _fresh(sym):
        with _lock:
            _inflight.add(sym)
        _fetch_one(sym)
    with _lock:
        return dict((_cache.get(sym) or {}).get("data") or {})


def enqueue(symbols) -> list:
    """Submit background fetches for any symbols not fresh in cache. Returns the
    list actually scheduled (already-cached / in-flight ones are skipped)."""
    todo = []
    with _lock:
        for s in symbols:
            if not _fresh(s) and s not in _inflight:
                _inflight.add(s)
                todo.append(s)
    for s in todo:
        _pool.submit(_fetch_one, s)
    return todo


# ---------- bulk warm (scrape the whole universe up front) ----------
# On-demand fetching means the first person to open a fundamental screen pays
# for every symbol, and a large universe can look empty for minutes. Warming
# walks the list in the background so the cache is already hot.
#
# It gets its OWN pool: pushing 1500 symbols through the shared _pool would put
# every interactive /fundamentals/bulk request behind them in the queue. Fewer
# workers than the on-demand pool, deliberately — this is the job that can wait.
WARM_WORKERS = int(os.environ.get("FUND_WARM_WORKERS", "4"))

_warm = {
    "running": False, "cancel": False,
    "total": 0, "done": 0, "ok": 0, "failed": 0, "skipped": 0,
    "started": 0.0, "updated": 0.0, "finished": 0.0,
    "universe": "", "last_error": "",
}
_warm_lock = threading.Lock()
_warm_thread = None


def warm_progress() -> dict:
    """Snapshot for the developer portal. Cheap enough to poll every 2 s."""
    with _warm_lock:
        w = dict(_warm)
    done, total = w["done"], w["total"]
    # While running, elapsed must track the wall clock — using `updated` would
    # freeze the ETA whenever a slow provider stalls every worker at once.
    end = time.time() if w["running"] else (w["finished"] or w["updated"])
    elapsed = (end - w["started"]) if w["started"] else 0
    rate = (done / elapsed) if elapsed > 0 and done else 0
    w["rate_per_min"] = round(rate * 60, 1)
    w["eta_sec"] = int((total - done) / rate) if rate > 0 and total > done else None
    w["elapsed_sec"] = int(elapsed)
    w["pct"] = round(done / total * 100, 1) if total else 0.0
    with _lock:
        w["cache_size"] = len(_cache)
        w["cache_fresh"] = sum(1 for s in _cache if _fresh(s))
        w["inflight"] = len(_inflight)
    w["schema"] = SCHEMA_V
    w["workers"] = WARM_WORKERS
    return w


def _warm_run(symbols):
    ex = ThreadPoolExecutor(max_workers=WARM_WORKERS)

    def one(sym):
        # Cancel returns WITHOUT touching `done`, so a stopped sweep reads as
        # "stopped at 412/1455", not as a completed one.
        with _warm_lock:
            if _warm["cancel"]:
                return
        try:
            if _fresh(sym):
                with _warm_lock:
                    _warm["skipped"] += 1
                    _warm["done"] += 1
                    _warm["updated"] = time.time()
                return
            with _lock:
                _inflight.add(sym)
            _fetch_one(sym)                      # writes the cache + stamps it
            with _lock:
                got = bool((_cache.get(sym) or {}).get("data"))
            with _warm_lock:
                _warm["ok" if got else "failed"] += 1
        except Exception as e:                   # one bad symbol must not stop the sweep
            with _lock:
                _inflight.discard(sym)
            with _warm_lock:
                _warm["failed"] += 1
                _warm["last_error"] = "%s: %s" % (sym, e)
                _warm["last_error"] = _warm["last_error"][:200]
        with _warm_lock:
            _warm["done"] += 1
            _warm["updated"] = time.time()

    try:
        list(ex.map(one, symbols))
    finally:
        ex.shutdown(wait=False)
        _save()                                  # persist what we gathered
        with _warm_lock:
            _warm["running"] = False
            _warm["finished"] = time.time()
            _warm["updated"] = time.time()


def warm_start(symbols, label="universe") -> dict:
    """Kick off a background sweep. No-op if one is already running."""
    global _warm_thread
    syms = [s.strip().upper() for s in symbols if s and s.strip()]
    with _warm_lock:
        if _warm["running"]:
            return {"started": False, "reason": "already running"}
        _warm.update({
            "running": True, "cancel": False,
            "total": len(syms), "done": 0, "ok": 0, "failed": 0, "skipped": 0,
            "started": time.time(), "updated": time.time(), "finished": 0.0,
            "universe": label, "last_error": "",
        })
    _warm_thread = threading.Thread(target=_warm_run, args=(syms,),
                                    name="fund-warm", daemon=True)
    _warm_thread.start()
    return {"started": True, "total": len(syms), "universe": label}


def warm_stop() -> dict:
    with _warm_lock:
        was = _warm["running"]
        _warm["cancel"] = True
    return {"stopping": was}


# ---------- public API ----------
def bulk(symbols) -> dict:
    """Return cached fundamentals for `symbols`, and kick off background fetches
    for the missing ones. Poll again to collect the `pending` list as it fills."""
    symbols = [s for s in symbols if s][:800]   # cap request size
    enqueue(symbols)
    out, pending = {}, []
    now = time.time()
    with _lock:
        for s in symbols:
            e = _cache.get(s)
            if e and e.get("v") == SCHEMA_V and (now - e["ts"] < TTL):
                out[s] = e["data"]
            else:
                pending.append(s)
    return {
        "data": out,
        "pending": pending,
        "provider": "EODHD" if EODHD_KEY else "yfinance",
        "cached": len(out),
        "total": len(symbols),
    }


def _saver_loop() -> None:
    while True:
        time.sleep(30)
        if _dirty:
            _save()


_load()
threading.Thread(target=_saver_loop, name="fund-cache-saver", daemon=True).start()
