# F&O option-chain analytics from the free public NSE option-chain feed.
#
# Same design as corporate.py: URL templates + defensive PARSERS + an in-memory
# cache, with the actual HTTP INJECTED (a `fetch(url) -> dict` callable) so the
# NSE session lives in server.py and the parsers/analytics are unit-testable
# with crafted payloads offline.
#
# Feeds (public, best from an Indian IP — the Mumbai VM):
#   - Index options   /api/option-chain-indices?symbol=NIFTY
#   - Equity options  /api/option-chain-equities?symbol=RELIANCE
#
# On top of the raw chain we derive the numbers a desk actually reads:
#   PCR (put/call OI ratio), max-pain strike, ATM strike + ATM IV, and the
#   per-strike OI / change-in-OI / IV / LTP ladder around the money.

import time
import threading

BASE = "https://www.nseindia.com"
URLS = {
    "indices": BASE + "/api/option-chain-indices?symbol={sym}",
    "equities": BASE + "/api/option-chain-equities?symbol={sym}",
}
# Index option chains covered by the indices endpoint; everything else is equity.
INDEX_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50"}
TTL = 60  # option chains move fast; a short cache still absorbs UI bursts

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
        with _lock:
            hit = _cache.get(key)
        return hit[1] if hit else {"strikes": [], "source": "NSE", "error": "unavailable"}
    with _lock:
        _cache[key] = (now, data)
    return data


def _num(v):
    try:
        if v in (None, "", "-"):
            return None
        return float(str(v).replace(",", "").strip())
    except Exception:
        return None


def _leg(d):
    """Normalise one CE/PE leg to the handful of fields we surface."""
    d = d or {}
    return {
        "oi": _num(d.get("openInterest")),
        "chg_oi": _num(d.get("changeinOpenInterest")),
        "iv": _num(d.get("impliedVolatility")),
        "ltp": _num(d.get("lastPrice")),
        "volume": _num(d.get("totalTradedVolume")),
    }


def parse_chain(raw, expiry=None) -> dict:
    """Turn the raw NSE option-chain payload into underlying + a strike ladder
    for one expiry (the nearest by default), plus PCR / max-pain / ATM."""
    rec = (raw or {}).get("records") or {}
    rows = rec.get("data") or []
    if not isinstance(rows, list):
        rows = []
    expiries = rec.get("expiryDates") or []
    underlying = _num(rec.get("underlyingValue"))

    # Pick the expiry: requested if valid, else the first (nearest) listed.
    exp = expiry if (expiry and expiry in expiries) else (expiries[0] if expiries else None)

    strikes = {}
    for r in rows:
        if exp and r.get("expiryDate") != exp:
            continue
        k = _num(r.get("strikePrice"))
        if k is None:
            continue
        e = strikes.setdefault(k, {"strike": k, "ce": None, "pe": None})
        if r.get("CE"):
            e["ce"] = _leg(r["CE"])
        if r.get("PE"):
            e["pe"] = _leg(r["PE"])

    ladder = [strikes[k] for k in sorted(strikes)]

    # PCR = total put OI / total call OI (a >1 skew reads bullish/oversold-hedged).
    tot_ce = sum((s["ce"]["oi"] or 0) for s in ladder if s["ce"])
    tot_pe = sum((s["pe"]["oi"] or 0) for s in ladder if s["pe"])
    pcr = round(tot_pe / tot_ce, 3) if tot_ce else None

    # ATM = strike nearest the underlying; ATM IV = avg of its CE/PE IV.
    atm = atm_iv = None
    if underlying is not None and ladder:
        atm = min(ladder, key=lambda s: abs(s["strike"] - underlying))["strike"]
        row = next((s for s in ladder if s["strike"] == atm), None)
        ivs = [row[leg]["iv"] for leg in ("ce", "pe") if row and row[leg] and row[leg]["iv"]]
        atm_iv = round(sum(ivs) / len(ivs), 2) if ivs else None

    return {
        "symbol": None,
        "underlying": underlying,
        "expiry": exp,
        "expiries": expiries,
        "strikes": ladder,
        "pcr": pcr,
        "total_ce_oi": tot_ce or None,
        "total_pe_oi": tot_pe or None,
        "max_pain": max_pain(ladder),
        "atm": atm,
        "atm_iv": atm_iv,
        "source": "NSE",
    }


def max_pain(ladder) -> float:
    """Strike at which total option-writer payout (and thus buyer value) is
    minimised — the classic 'max pain' magnet. Computed by settling every
    strike's OI at each candidate expiry price and taking the argmin."""
    strikes = [s["strike"] for s in ladder]
    if not strikes:
        return None
    best_k, best_loss = None, None
    for expire_at in strikes:
        loss = 0.0
        for s in ladder:
            k = s["strike"]
            ce_oi = (s["ce"]["oi"] if s["ce"] else 0) or 0
            pe_oi = (s["pe"]["oi"] if s["pe"] else 0) or 0
            # Calls ITM when price > strike; puts ITM when price < strike.
            loss += max(expire_at - k, 0) * ce_oi
            loss += max(k - expire_at, 0) * pe_oi
        if best_loss is None or loss < best_loss:
            best_loss, best_k = loss, expire_at
    return best_k


def _endpoint(symbol):
    return "indices" if symbol.upper() in INDEX_SYMBOLS else "equities"


# ── public API (fetch injected) ──
def option_chain(symbol, fetch, expiry=None):
    sym = symbol.upper().strip()
    kind = _endpoint(sym)
    key = "oc:%s:%s" % (sym, expiry or "near")

    def produce():
        data = parse_chain(fetch(URLS[kind].format(sym=sym)), expiry=expiry)
        data["symbol"] = sym
        return data

    return _cached(key, TTL, produce)
