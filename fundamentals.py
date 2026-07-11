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

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

EODHD_KEY = (os.environ.get("EODHD_API_KEY") or "").strip()
TTL = int(os.environ.get("FUND_TTL_SEC", str(7 * 24 * 3600)))   # fundamentals move slowly → 7 days
_DIR = os.path.dirname(os.path.abspath(__file__))
_FILE = os.path.join(_DIR, "fund_cache.json")

# sym -> {"data": {<schema>}, "ts": epoch}
_cache: dict = {}
_inflight: set = set()
_lock = threading.Lock()
_pool = ThreadPoolExecutor(max_workers=4)   # bounded so we never hammer EODHD/yfinance
_dirty = False

# The compact schema the screener's fundamental filters read.
FIELDS = ("pe", "forward_pe", "pb", "eps", "dividend_yield", "roe", "roce",
          "debt_equity", "current_ratio", "market_cap_cr", "sector", "industry")


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
    return bool(e) and (time.time() - e["ts"] < TTL)


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


def _fetch_one(sym: str) -> None:
    global _dirty
    data = None
    if EODHD_KEY:
        try:
            data = _fetch_eodhd(sym)
        except Exception:
            data = None
    if data is None:
        try:
            data = _fetch_yf(sym)
        except Exception:
            data = None
    with _lock:
        _cache[sym] = {"data": data or {}, "ts": time.time()}
        _inflight.discard(sym)
        _dirty = True


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
            if e and (now - e["ts"] < TTL):
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
