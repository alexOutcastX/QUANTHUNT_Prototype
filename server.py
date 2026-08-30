"""
QuantHunt NSE Direct backend.
- /ltp          : NSE Direct + Yahoo Finance fallback
- /universe     : NSE bhavcopy EQ/BE + NIFTY MICROCAP 250
- /index        : Live index constituents
- /history      : OHLCV historical data (YF)
- /patterns     : Candlestick + TA pattern analysis
- /fundamentals : PE, EPS, revenue, ratios (YF)
"""
from flask import Flask, jsonify, redirect, request, render_template, send_from_directory
from flask_cors import CORS
import requests, logging, time, threading, os, io, csv, datetime, json, math, sys
import pandas as pd
import fundamentals as _fund   # bulk fundamentals cache (EODHD + yfinance fallback)
import valuation as _valuation  # dossier valuation section (pure arithmetic, no I/O)
import scanner as _scanner     # live per-symbol technical scan for the screener
import relations as _relations # curated company-relationship graph (Terminal tab)
import news as _news           # RSS news aggregation (Terminal news panel)
import news_history as _newshist  # a month of recorded headlines (the feeds keep hours)
import primary_feeds as _primary  # NSE IPO calendar + G-Sec/SGB quotes (landing page)
import ai_graph as _ai         # AI-generated relationship graphs (any symbol)
import broker as _broker       # BYOB Zerodha connect (read-only, single user)
import holidays as _holidays   # NSE trading holidays + market open/closed status
import auth as _auth           # owner passcode gate for owner-only endpoints
import store as _store         # SQLite persistence (kv + snapshots)
import corporate as _corp       # corporate actions/announcements/shareholding/deals (NSE)
import derivatives as _deriv     # F&O option-chain analytics (PCR/max-pain/ATM IV) from NSE
import risk as _risk            # portfolio risk analytics (VaR/beta/drawdown/correlation)
import entity_graph as _egraph   # grounded institution⇄company graph from NSE deal records
import affiliations as _affil     # seed-grounded promoter + political funding graphs
import alerts as _alerts        # server-side price/technical alerts (store-backed)
import apikeys as _apikeys      # public-API key issue/verify (hashed, store-backed)
import push as _push            # FCM push delivery + device-token registry + broadcasts
import chat as _chat            # in-app messaging: global room + channels + DMs
import sectors as _sectors      # app-wide NSE sector classification + heatmap aggregate
import tradelog as _tradelog    # append-only record of every trade the engines recommended
import backfill as _backfill    # historical replay that seeds that record (clearly labelled)
import cases as _cases          # TaurEye-built investment baskets (sector/cap/strategy/multibagger)

# Support both normal run and PyInstaller frozen exe
_BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, template_folder=_BASE_DIR, static_folder=_BASE_DIR)
# CORS is an explicit allowlist — never a wildcard (credentials are sent). The
# web SPA is served same-origin (no CORS needed). The Capacitor mobile shell
# loads from a localhost WebView origin, so those exact origins are allowed;
# extend with CORS_ORIGINS (comma-separated, e.g. an https domain) as needed.
_CAPACITOR_ORIGINS = [
    "https://localhost", "http://localhost",
    "capacitor://localhost", "ionic://localhost",
]
_CORS_ORIGINS = _CAPACITOR_ORIGINS + [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()
]
CORS(app, origins=_CORS_ORIGINS, supports_credentials=True)
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("quanthunt")

NSE_BASE = "https://www.nseindia.com"
NSE_ARCHIVE = "https://nsearchives.nseindia.com"
HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}

# ── NSE session (cookie-warmed) ──────────────────────────────────────────────
_session = None
_session_lock = threading.Lock()
_session_ts = 0


def nse_session():
    global _session, _session_ts
    with _session_lock:
        now = time.time()
        if _session is None or (now - _session_ts) > 600:
            s = requests.Session()
            s.headers.update(HEADERS)
            try:
                s.get(NSE_BASE, timeout=8)
                s.get(NSE_BASE + "/option-chain", timeout=8)
            except Exception as e:
                log.warning("NSE warmup failed: %s", e)
            _session = s
            _session_ts = now
        return _session


def _reset_session():
    global _session, _session_ts
    with _session_lock:
        _session = None
        _session_ts = 0


def nse_get(path, params=None, retries=2, base=NSE_BASE):
    s = nse_session()
    last_err = None
    for i in range(retries + 1):
        try:
            r = s.get(base + path, params=params, timeout=12)
            if r.status_code == 200:
                return r.json()
            last_err = f"HTTP {r.status_code}"
        except Exception as e:
            last_err = str(e)
        _reset_session()
        s = nse_session()
    raise RuntimeError(f"NSE fetch failed for {path}: {last_err}")


# ── Yahoo Finance fallback ───────────────────────────────────────────────────
_yf_session = None
_yf_lock = threading.Lock()

def yf_session():
    global _yf_session
    with _yf_lock:
        if _yf_session is None:
            import yfinance as yf
            _yf_session = yf
        return _yf_session

# Two CALENDAR days are not two SESSIONS. `period="2d"` asked for Friday and
# Saturday, Saturday has no bar, so the frame held one row — the previous close
# fell back to that same row and every change on the home page read +0.00% for
# the whole weekend, and again on Monday until the open. Ten days always spans
# two sessions, across a long weekend or a Diwali cluster included.
_YF_WINDOW = "10d"


def _finite(x, fallback=None):
    """A float that is safe to serialise, or `fallback`.

    float(nan) does not raise, and a NaN that reaches jsonify is written as a
    bare `NaN` — invalid JSON, which kills the client outright rather than
    degrading (the same trap _nan_safe exists for further down).
    """
    try:
        v = float(x)
    except (TypeError, ValueError):
        return fallback
    return v if math.isfinite(v) else fallback


def _quote_from_frame(df):
    """Last two sessions of a daily OHLCV frame → a quote entry, or None.

    Yahoo pads its frames with rows that carry a volume but no prices, and
    dropna(subset=["Close"]) did not always clear them — RELIANCE was serving
    `"price": NaN` on the live site. Everything is read through a finite check
    instead of positionally trusting the frame.
    """
    if df is None or getattr(df, "empty", True):
        return None
    try:
        closes = pd.to_numeric(df["Close"], errors="coerce")
        df = df.loc[closes.notna() & closes.apply(lambda v: math.isfinite(v))]
    except Exception:
        return None
    if df.empty:
        return None
    row = df.iloc[-1]
    close = _finite(row["Close"])
    if not close or close <= 0:
        return None
    prev = _finite(df.iloc[-2]["Close"]) if len(df) >= 2 else None
    if not prev or prev <= 0:
        prev = None
    try:
        session = pd.to_datetime(df.index[-1]).strftime("%Y-%m-%d")
    except Exception:
        session = None
    return {
        "price": round(close, 2),
        "prevClose": round(prev if prev else close, 2),
        # No prior session in a ten-day window means a listing too new to have
        # a change. Reporting +0.00% would be a claim; None is the gap it is.
        "chg": round((close - prev) / prev * 100, 2) if prev else None,
        "absChg": round(close - prev, 2) if prev else None,
        "open": _finite(row.get("Open"), close),
        "high": _finite(row.get("High"), close),
        "low": _finite(row.get("Low"), close),
        "volume": int(_finite(row.get("Volume"), 0) or 0),
        # The session these numbers are FROM, taken off the bar's own date
        # rather than guessed from the server clock.
        "session": session,
        "source": "YF",
    }


# ── The exchange's own settled session ──────────────────────────────────────
# Yahoo can lag the exchange by a full day. On the Saturday this was written
# NSE's bhavcopy held Friday and Yahoo's last NSE bar was Thursday, so a
# correctly-computed Yahoo change was still the wrong session's change. The
# bhavcopy row carries the whole OHLCV line, so nothing here is reconstructed —
# it is read straight off the universe cache that every screen already uses.
_settled_idx = (0.0, {})


def _settled_rows():
    """symbol -> bhavcopy row, rebuilt only when the universe cache turns over.

    Reads the cache directly and never calls get_universe(): a cold process
    must not turn a quote lookup into a blocking bhavcopy download.
    """
    global _settled_idx
    ts, idx = _settled_idx
    if ts != _universe_ts or not idx:
        idx = {u["symbol"]: u for u in (_universe_cache or [])
               if u.get("price") is not None}
        _settled_idx = (_universe_ts, idx)
    return idx


def _settled_quote(symbol):
    """The exchange's settled numbers for one symbol, or None."""
    if not _BHAV_DATE:
        return None
    r = _settled_rows().get(symbol)
    if not r:
        return None
    price = _finite(r.get("price"))
    if not price or price <= 0:
        return None
    prev = _finite(r.get("prevClose"))
    return {
        "price": round(price, 2),
        "prevClose": round(prev if prev else price, 2),
        "chg": _finite(r.get("chg")),
        "absChg": _finite(r.get("absChg")),
        "open": _finite(r.get("open"), price),
        "high": _finite(r.get("high"), price),
        "low": _finite(r.get("low"), price),
        "volume": int(_finite(r.get("volume"), 0) or 0),
        "session": _BHAV_DATE,
        "source": "NSE",
    }


def _freshest(*quotes):
    """Whichever quote is from the later session.

    Comparing sessions rather than consulting a clock is what makes this right
    in both directions: during a live session Yahoo's bar is today and the
    bhavcopy is last night's, so Yahoo wins; over a weekend the bhavcopy is
    Friday and Yahoo's last bar may be Thursday, so the bhavcopy wins. Ties go
    to the earlier argument, so an intraday bar is not displaced by the
    previous close of the same day.
    """
    best = None
    for q in quotes:
        if q and (best is None
                  or (q.get("session") or "") > (best.get("session") or "")):
            best = q
    return best


def yf_price(symbol):
    """Fetch price from Yahoo Finance using NSE suffix (.NS)."""
    try:
        yf = yf_session()
        ticker = yf.Ticker(f"{symbol}.NS")
        return _freshest(_quote_from_frame(ticker.history(period=_YF_WINDOW)),
                         _settled_quote(symbol))
    except Exception as e:
        log.debug("YF fallback failed for %s: %s", symbol, e)
        return _settled_quote(symbol)


# ── Universe cache (bhavcopy + microcap index) ───────────────────────────────
_universe_cache = []
_universe_ts    = 0
_universe_lock  = threading.Lock()
_UNIVERSE_TTL   = 6 * 3600   # refresh every 6 hours


# SME (NSE EMERGE) scrips from the same bhavcopy download — populated as a
# side-effect of _load_bhavcopy, served as the "SME EMERGE" custom group.
_SME_LIST: list = []

# Trading date of the bhavcopy currently in the universe cache (ISO). Shown to
# the user whenever a screen is painted from bhavcopy quotes rather than live
# ones, so a settlement-day close is never mistaken for an intraday price.
_BHAV_DATE: str = ""


def _load_bhavcopy():
    """Download latest bhavcopy and return list of EQ-series symbols."""
    s = nse_session()
    today = datetime.date.today()
    for delta in range(7):
        d = today - datetime.timedelta(days=delta)
        url = (f"/products/content/sec_bhavdata_full_{d.strftime('%d%m%Y')}.csv")
        try:
            r = s.get(NSE_ARCHIVE + url, timeout=20)
            if r.status_code != 200:
                continue
            reader = csv.DictReader(io.StringIO(r.text))
            rows   = list(reader)
            if not rows:
                continue
            # sec_bhavdata_full column names carry a leading space (' SERIES',
            # ' CLOSE_PRICE', …) — key each row by stripped name so we can also
            # pull prev-close (day change) and turnover (the heatmap weight).
            def _num(v):
                try:
                    return float(str(v).strip().replace(",", ""))
                except Exception:
                    return 0.0
            eq = []
            sme = []
            for raw in rows:
                row = {(k or "").strip(): v for k, v in raw.items()}
                series = row.get("SERIES", "").strip()
                sym = row.get("SYMBOL", "").strip()
                if not sym:
                    continue
                close = _num(row.get("CLOSE_PRICE"))
                prev  = _num(row.get("PREV_CLOSE"))
                chg   = round((close - prev) / prev * 100, 2) if prev else None
                # TURNOVER is in lakhs of rupees; scale to rupees for a weight.
                turnover = _num(row.get("TURNOVER_LACS")) * 1e5
                # The full OHLCV row, not just the close: these are the exact
                # fields the screener's price columns want, and carrying them
                # here means an index whose live feed is blocked still paints
                # LTP / %CHG / VOLUME without a single extra upstream call.
                item = {"symbol": sym, "exchange": "NSE", "price": close,
                        "chg": chg, "turnover": turnover,
                        "prevClose": prev or None,
                        "absChg": round(close - prev, 2) if prev else None,
                        "open": _num(row.get("OPEN_PRICE")) or None,
                        "high": _num(row.get("HIGH_PRICE")) or None,
                        "low":  _num(row.get("LOW_PRICE")) or None,
                        "volume": _num(row.get("TTL_TRD_QNTY")) or None}
                if series in ("EQ", "BE"):
                    eq.append(item)
                elif series in ("SM", "ST"):
                    # NSE EMERGE SME platform (same bhavcopy file, no extra fetch)
                    sme.append(item)
            global _SME_LIST, _BHAV_DATE
            _SME_LIST = sme
            _BHAV_DATE = d.isoformat()
            log.info("Bhavcopy %s: %d EQ/BE symbols, %d SME", d, len(eq), len(sme))
            return eq, d
        except Exception as e:
            log.warning("Bhavcopy %s failed: %s", d, e)
    return [], None


BSE_BASE = "https://www.bseindia.com"
BSE_HEADERS = {
    "User-Agent": HEADERS["User-Agent"],
    "Accept": "text/csv,application/csv,*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.bseindia.com/",
}
_BSE_SYM_OK = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&.-")


def _load_bse():
    """BSE-listed equities from the daily cash-market bhavcopy, so BSE-only
    scrips (e.g. CIANAGRO) that never list on the NSE are still searchable.

    Best-effort: any failure returns an empty list and the universe simply
    stays NSE-only — the BSE names are additive, never required.
    """
    sess = requests.Session()
    sess.headers.update(BSE_HEADERS)
    try:                                   # warm cookies like the NSE session
        sess.get(BSE_BASE, timeout=8)
    except Exception:
        pass
    today = datetime.date.today()
    for delta in range(7):                 # walk back over weekends/holidays
        d = today - datetime.timedelta(days=delta)
        url = (BSE_BASE + "/download/BhavCopy/Equity/"
               f"BhavCopy_BSE_CM_0_0_0_{d.strftime('%Y%m%d')}_F_0000.CSV")
        try:
            r = sess.get(url, timeout=20)
            if r.status_code != 200 or not r.text or "," not in r.text[:200]:
                continue
            reader = csv.DictReader(io.StringIO(r.text))
            cols = {(f or "").strip(): f for f in (reader.fieldnames or [])}
            sym_c = cols.get("TckrSymb")
            nam_c = cols.get("FinInstrmNm")
            typ_c = cols.get("FinInstrmTp")
            cls_c = cols.get("ClsPric")
            prv_c = cols.get("PrvsClsgPric")
            trf_c = cols.get("TtlTrfVal")      # total traded value (rupees)
            opt_c = cols.get("OptnTp")
            if not sym_c:
                continue

            def _num(v):
                try:
                    return float(str(v or "0").strip().replace(",", ""))
                except Exception:
                    return 0.0

            out = []
            for row in reader:
                sym = (row.get(sym_c) or "").strip().upper()
                if not sym or any(ch not in _BSE_SYM_OK for ch in sym):
                    continue
                if opt_c and (row.get(opt_c) or "").strip():
                    continue           # skip derivatives — cash equities only
                if typ_c:
                    t = (row.get(typ_c) or "").strip().upper()
                    if t and t not in ("STK", "EQ", "EQUITY", "E"):
                        continue
                price = _num(row.get(cls_c)) if cls_c else 0.0
                prev  = _num(row.get(prv_c)) if prv_c else 0.0
                chg   = round((price - prev) / prev * 100, 2) if prev else None
                turnover = _num(row.get(trf_c)) if trf_c else 0.0
                name = (row.get(nam_c) or "").strip() if nam_c else ""
                out.append({"symbol": sym, "exchange": "BSE", "price": price,
                            "name": name, "chg": chg, "turnover": turnover})
            log.info("BSE bhavcopy %s: %d equity scrips", d, len(out))
            if out:
                return out
        except Exception as e:
            log.warning("BSE bhavcopy %s failed: %s", d, e)
    return []


def _load_microcap():
    """Pull NIFTY MICROCAP 250 constituents (with company names when present)."""
    try:
        data = nse_get("/api/equity-stockIndices", params={"index": "NIFTY MICROCAP 250"})
        items = []
        for item in data.get("data", []):
            sym = item.get("symbol", "")
            if sym and sym != "NIFTY MICROCAP 250":
                name = (item.get("meta") or {}).get("companyName") or ""
                items.append({"symbol": sym, "exchange": "NSE", "price": 0, "name": name})
        return items
    except Exception as e:
        log.warning("Microcap index fetch failed: %s", e)
        return []


def _load_equity_names():
    """Map SYMBOL -> company name from NSE's official equity master list.

    EQUITY_L.csv covers the whole listed EQ universe with real company names,
    which the bhavcopy lacks. Failures degrade gracefully to an empty map so
    the universe still works (name falls back to the symbol).
    """
    try:
        s = nse_session()
        r = s.get(NSE_ARCHIVE + "/content/equities/EQUITY_L.csv", timeout=20)
        if r.status_code != 200:
            log.warning("EQUITY_L.csv HTTP %s", r.status_code)
            return {}
        reader = csv.DictReader(io.StringIO(r.text))
        name_col = next((k for k in (reader.fieldnames or []) if "NAME OF COMPANY" in k.upper()), None)
        sym_col  = next((k for k in (reader.fieldnames or []) if k.strip().upper() == "SYMBOL"), None)
        if not name_col or not sym_col:
            return {}
        names = {}
        for row in reader:
            sym = (row.get(sym_col) or "").strip()
            nm  = (row.get(name_col) or "").strip()
            if sym and nm:
                names[sym] = nm
        log.info("Equity names loaded: %d", len(names))
        return names
    except Exception as e:
        log.warning("Equity-name list fetch failed: %s", e)
        return {}


# ── Exchange scrip masters ───────────────────────────────────────────────────
# A bhavcopy lists what TRADED that day, not what is LISTED. Anything thinly
# traded therefore vanishes from the universe on any day it doesn't print a
# tick — which for a screener with a penny tab is exactly the wrong set to
# lose. Taparia Tools, to take the case that surfaced this, is BSE-only and
# trades rarely: it was in neither bhavcopy, so it could not be searched for
# at all even though its dossier renders fine once you reach it.
#
# The masters enumerate every listed security regardless of trading, so the
# universe is (bhavcopy ∪ masters). Master-only rows carry no price — they
# didn't trade — which is honest and still makes them findable.
_BSE_MASTER_URL = "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w"


def _load_bse_master():
    """Every ACTIVE BSE equity scrip. Best-effort: failure just means the
    universe stays as wide as the bhavcopies made it."""
    try:
        sess = requests.Session()
        sess.headers.update({**BSE_HEADERS,
                             "Accept": "application/json, text/plain, */*",
                             "Referer": BSE_BASE + "/corporates/List_Scrips.html"})
        try:
            sess.get(BSE_BASE, timeout=8)      # warm cookies like the bhavcopy path
        except Exception:
            pass
        r = sess.get(_BSE_MASTER_URL, timeout=25, params={
            "Group": "", "Scripcode": "", "industry": "",
            "segment": "Equity", "status": "Active"})
        if r.status_code != 200:
            log.warning("BSE scrip master HTTP %s", r.status_code)
            return []
        out = []
        for it in r.json() or []:
            sym = (it.get("scrip_id") or "").strip().upper()
            if not sym or any(ch not in _BSE_SYM_OK for ch in sym):
                continue
            out.append({"symbol": sym, "exchange": "BSE",
                        "name": (it.get("Issuer_Name") or it.get("Scrip_Name") or "").strip()})
        log.info("BSE scrip master: %d active equity scrips", len(out))
        return out
    except Exception as e:
        log.warning("BSE scrip master fetch failed: %s", e)
        return []


def get_universe():
    global _universe_cache, _universe_ts
    with _universe_lock:
        if _universe_cache and (time.time() - _universe_ts) < _UNIVERSE_TTL:
            return _universe_cache
        log.info("Refreshing universe from bhavcopy + microcap index...")
        bhav, bhav_date = _load_bhavcopy()
        micro = _load_microcap()
        seen = {item["symbol"] for item in bhav}
        for item in micro:
            if item["symbol"] not in seen:
                bhav.append(item)
                seen.add(item["symbol"])
        # BSE-exclusive scrips (never listed on NSE) so they're searchable too.
        # NSE stays authoritative — a symbol already seen keeps its NSE entry.
        for item in _load_bse():
            if item["symbol"] not in seen:
                bhav.append(item)
                seen.add(item["symbol"])
        # Attach real company names (bhavcopy has none). Prefer the official
        # equity master list; fall back to any name the microcap feed carried.
        names = _load_equity_names()
        for item in bhav:
            nm = names.get(item["symbol"]) or item.get("name") or ""
            item["name"] = nm
        # …then widen to everything LISTED, not merely everything that traded.
        # These carry no price: they didn't print a tick, and inventing one
        # would be worse than an honest blank. They are searchable, which is
        # the whole point — a symbol you cannot type is a symbol you cannot use.
        listed_only = 0
        for sym, nm in names.items():
            if sym not in seen:
                bhav.append({"symbol": sym, "exchange": "NSE", "name": nm,
                             "price": None, "chg": None, "listed_only": True})
                seen.add(sym)
                listed_only += 1
        for item in _load_bse_master():
            if item["symbol"] not in seen:
                bhav.append({**item, "price": None, "chg": None, "listed_only": True})
                seen.add(item["symbol"])
                listed_only += 1
        if listed_only:
            log.info("Universe: +%d listed-but-untraded scrips from the masters", listed_only)
        _universe_cache = bhav
        _universe_ts    = time.time()
        log.info("Universe ready: %d symbols (bhavcopy date: %s)", len(bhav), bhav_date)
        return _universe_cache


# ── Non-blocking universe access ─────────────────────────────────────────────
# get_universe() blocks the calling request thread on a cold bhavcopy fetch
# (several seconds of network). On a gthread worker a handful of such requests
# arriving together saturate the thread pool and hang the whole site. Endpoints
# that only need "whatever's cached, don't wait" (the heatmap) use this instead:
# it warms the universe in a background thread and returns immediately with the
# current cache (possibly empty/stale). The caller reports `running` so the UI
# keeps polling until the tiles fill in.
_universe_warm_lock = threading.Lock()
_universe_warming = False


def _warm_universe_async():
    """Kick a one-shot background universe refresh (idempotent)."""
    global _universe_warming
    with _universe_warm_lock:
        if _universe_warming:
            return
        _universe_warming = True

    def _run():
        global _universe_warming
        try:
            get_universe()
        except Exception as e:
            log.warning("background universe warm failed: %s", e)
        finally:
            with _universe_warm_lock:
                _universe_warming = False

    threading.Thread(target=_run, daemon=True).start()


def get_universe_nonblocking():
    """Return the cached universe without ever blocking on the network. If the
    cache is warm, serve it; otherwise trigger a background warm and return
    whatever we currently hold (stale or empty) plus a `warming` flag."""
    with _universe_lock:
        cache = _universe_cache
        fresh = bool(cache) and (time.time() - _universe_ts) < _UNIVERSE_TTL
    if fresh:
        return cache, False
    _warm_universe_async()
    return cache, True


# ── Sector classification (NSE index Industry files → sectors.py) ────────────
_sector_refresh_lock = threading.Lock()
_sector_refresh_thread = None


def _nse_archive_text(path):
    """Fetch a text/CSV body from the NSE archive host (cookie-warmed session).
    Raises on non-200 so refresh_classification skips a failed file."""
    s = nse_session()
    r = s.get(NSE_ARCHIVE + path, timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    return r.text


# Last BSE scrip-master fetch outcome, surfaced in /sectors for diagnostics.
_bse_diag = {"tried": False}


def _bse_scrip_industries():
    """Every actively-listed BSE equity + its industry, from the BSE scrip master.
    Returns a list of (symbol, industry) — the broad base for the sector map
    (~4,000+ scrips the NSE index files never list). Best-effort: any failure
    returns an empty list and the classifier simply falls back to NSE + Yahoo.
    Records the attempt outcome in _bse_diag so /sectors can report what happened."""
    global _bse_diag
    sess = requests.Session()
    sess.headers.update({
        "User-Agent": HEADERS["User-Agent"],
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.bseindia.com/",
        "Origin": "https://www.bseindia.com",
    })
    try:                                   # warm cookies like the bhavcopy session
        sess.get(BSE_BASE, timeout=8)
    except Exception:
        pass
    params = {"Group": "", "Scripcode": "", "industry": "", "segment": "Equity", "status": "Active"}
    # api.bseindia.com is the canonical host; fall back to the www host in case
    # the api subdomain isn't reachable from the VM's egress.
    hosts = [
        "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w",
        "https://www.bseindia.com/BseIndiaAPI/api/ListofScripData/w",
    ]
    last = None
    for url in hosts:
        try:
            r = sess.get(url, params=params, timeout=30)
            status = r.status_code
            if status != 200:
                last = f"HTTP {status} @ {url.split('/')[2]}"
                continue
            body = r.json()
            if isinstance(body, str):
                body = json.loads(body)
            rows = body if isinstance(body, list) else (body.get("Table") or body.get("data") or [])
            out = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                sym = (row.get("scrip_id") or row.get("Scrip_Id") or row.get("SCRIP_ID")
                       or row.get("ScripID") or row.get("Scrip_Cd") or "").strip().upper()
                ind = (row.get("INDUSTRY") or row.get("Industry") or row.get("industry")
                       or row.get("Industry_New") or row.get("NewIndustry") or "").strip()
                if sym and ind:
                    out.append((sym, ind))
            _bse_diag = {"tried": True, "host": url.split('/')[2], "status": status,
                         "raw_rows": len(rows), "parsed": len(out),
                         "sample_keys": list(rows[0].keys())[:12] if rows and isinstance(rows[0], dict) else []}
            log.info("BSE scrip master: %d/%d classified scrips via %s", len(out), len(rows), url.split('/')[2])
            if out:
                return out
            last = f"0 parsed of {len(rows)} rows @ {url.split('/')[2]}"
        except Exception as e:
            last = f"{type(e).__name__}: {e}"
            continue
    _bse_diag = {"tried": True, "error": str(last)}
    log.warning("BSE scrip master failed: %s", last)
    return []


def _nse_industry_sector(sym):
    """NSE's own macro sector for one symbol, from the equity-quote industryInfo
    (macro/sector/industry). Reliable from the VM (the app already uses this API).
    Returns a raw sector string or None."""
    try:
        data = nse_get("/api/quote-equity", params={"symbol": sym}, retries=1)
        ii = (data or {}).get("industryInfo") or {}
        return ii.get("sector") or ii.get("macro") or ii.get("industry")
    except Exception:
        return None


def _nse_classify_universe(universe, cap=2500):
    """Classify NSE-listed scrips the index files miss, one quote-API call each
    (bounded pool, own count). This is what lifts NSE coverage from the ~751 the
    index files cap at toward the full ~2,000 NSE universe. Records exact NSE
    sectors; persists once at the end. Returns the number newly classified."""
    from concurrent.futures import ThreadPoolExecutor
    todo = [x["symbol"] for x in (universe or [])
            if x.get("exchange") == "NSE" and x.get("symbol")
            and not _sectors.sector_of(x["symbol"])][:cap]
    if not todo:
        return 0
    added = [0]

    def one(s):
        sec = _nse_industry_sector(s)
        if sec and _sectors.set_sector(s, sec):
            added[0] += 1

    # Gentle concurrency — NSE throttles aggressive bursts.
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(one, todo))
    _sectors.flush()
    log.info("NSE per-symbol classify: +%d of %d attempted", added[0], len(todo))
    return added[0]


def _sector_refresh_running():
    with _sector_refresh_lock:
        return _sector_refresh_thread is not None


def _ensure_sector_classification(force=False):
    """Kick a background pull of the NSE sector classification if it's stale (or
    forced) and not already running. Non-blocking: the heatmap serves whatever
    the disk-cached map already covers while a refresh runs."""
    global _sector_refresh_thread
    with _sector_refresh_lock:
        if _sector_refresh_thread is not None:
            return
        if not force and _sectors.map_size() > 0:
            # A day-TTL check lives inside refresh_classification; only spawn a
            # thread when there's a real chance of work.
            import time as _t
            if (_t.time() - _sectors._fetched_ts) < _sectors._TTL:
                return

        def _work():
            global _sector_refresh_thread
            try:
                try:
                    bse_rows = _bse_scrip_industries()
                except Exception as e:
                    log.warning("BSE scrip master fetch failed: %s", e)
                    bse_rows = []
                n = _sectors.refresh_classification(_nse_archive_text, bse_rows=bse_rows, force=force)
                log.info("Sector classification refreshed: %d symbols mapped", n)
                # The bundled sector_map.csv already gives whole-universe coverage,
                # so the light NSE index top-up above is enough to catch newly
                # listed scrips. (The heavy per-symbol NSE sweep is retired — it
                # hammered NSE for names the bundle already covers.)
            except Exception as e:
                log.warning("Sector classification refresh failed: %s", e)
            finally:
                with _sector_refresh_lock:
                    _sector_refresh_thread = None

        _sector_refresh_thread = threading.Thread(target=_work, name="sector-classify", daemon=True)
        _sector_refresh_thread.start()


def _fetch_one(sym, out):
    """Fetch a single symbol via NSE → YF fallback and write into out dict."""
    result = None
    try:
        data = nse_get("/api/quote-equity", params={"symbol": sym}, retries=1)
        pi   = data.get("priceInfo", {}) or {}
        if pi.get("lastPrice"):
            ohlc = pi.get("intraDayHighLow", {}) or {}
            vol  = ((data.get("preOpenMarket",       {}) or {}).get("totalTradedVolume") or
                    (data.get("marketDeptOrderBook", {}) or {}).get("totalTradedVolume"))
            result = {
                "price":     pi.get("lastPrice"),
                "prevClose": pi.get("previousClose"),
                "chg":       pi.get("pChange"),
                "absChg":    pi.get("change"),
                "open":      pi.get("open"),
                "high":      ohlc.get("max"),
                "low":       ohlc.get("min"),
                "volume":    vol,
                "source":    "NSE",
            }
    except Exception:
        pass
    if not result:
        result = yf_price(sym)
    out[sym] = result or {"error": "no data", "source": "NSE+YF"}


# ── Symbol alias map: old/dead symbols → current NSE symbols ─────────────────
# Sources: NSE corporate actions (demergers, renames, mergers)
SYMBOL_ALIASES = {
    # Tata Motors demerger (Apr 2024) → Passenger Vehicles + Commercial Vehicles
    "TATAMOTORS": ["TMPV", "TMCV"],
    # Adani Transmission renamed to Adani Energy Solutions (Jan 2024)
    "ADANITRANS":  ["ADANIENSOL"],
    # LTIMindtree — NSE API bug, YF works fine
    "LTIM":        ["LTIM"],
    # Mindtree + LTTS merged into LTIMindtree (2022)
    "MINDTREE":    ["LTIM"],
    "L&TFH":       ["L&TFH"],
}


# ── Routes ───────────────────────────────────────────────────────────────────
# Precompressed static assets. The web bundle is ~1.4 MB of JS; serving it
# uncompressed is the single biggest cause of slow first load (and the app
# can't assume the nginx in front has gzip configured). At startup a background
# thread writes .br / .gz siblings next to every compressible file in the web
# build; the static routes then serve the best encoding the client accepts.
# Brotli gets the bundle to ~¼ the size, gzip to ~⅓.
_COMPRESSIBLE = (".js", ".css", ".html", ".svg", ".json", ".txt", ".map")


def _web_cache_dir():
    # Kept OUTSIDE mobile/dist so the compressed variants never end up in git
    # (dist is force-added on every build).
    return os.path.join(_BASE_DIR, "mobile", "dist-precompressed")


def _write_atomic(path, data):
    """Write via a temp file + rename so readers never observe a partial file.

    open(path, "wb") truncates immediately, so a request landing mid-write used
    to receive a few bytes of a .gz — served as a 200 with Content-Encoding:
    gzip that no browser can decode. If the write then failed outright (full
    disk, killed process) the truncated file survived with a *fresh* mtime, so
    the freshness check below considered it good and the blank page became
    permanent. os.replace() is atomic, and a failed write now leaves the
    previous good variant untouched.
    """
    tmp = "%s.tmp%d" % (path, os.getpid())
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# Registry of precompressed variants this process wrote (or re-verified) itself:
#   "index.html.gz" -> (size, mtime)
# A variant is served ONLY if it is listed here AND still matches that stat.
# Trusting the filesystem alone is what made a corrupt .gz reachable: a
# truncated file is still a file, and a 1-byte .gz passes any "is it empty?"
# test while decoding to nothing.
_WEB_VARIANTS = {}
_WEB_VARIANTS_LOCK = threading.Lock()


def _decompressed_len(path, enc):
    """Byte length the variant decodes to — the only real proof it is intact."""
    blob = open(path, "rb").read()
    if enc == "gzip":
        import gzip as _gzip
        return len(_gzip.decompress(blob))
    import brotli
    return len(brotli.decompress(blob))


def _precompress_web_dir():
    """Build .br/.gz siblings for the web bundle and register the good ones.

    Every variant is either written here (atomically) or decompressed and
    checked against its source length before being registered, so a leftover
    truncated file from an interrupted run can never be served — it simply
    fails verification and gets rewritten.
    """
    try:
        import brotli  # optional — gzip alone still helps
    except Exception:
        brotli = None
    import gzip as _gzip
    cache = _web_cache_dir()
    encs = [("gzip", ".gz", lambda d: _gzip.compress(d, 9))]
    if brotli is not None:
        encs.append(("br", ".br", lambda d: brotli.compress(d, quality=10)))

    good = {}
    for root, _dirs, files in os.walk(WEB_DIR):
        for name in files:
            if not name.endswith(_COMPRESSIBLE):
                continue
            src = os.path.join(root, name)
            rel = os.path.relpath(src, WEB_DIR).replace(os.sep, "/")
            try:
                src_stat = os.stat(src)
                data = None
                for enc, ext, compress in encs:
                    dst = os.path.join(cache, rel + ext)
                    try:
                        # Reuse an existing variant only when it is newer than
                        # the source AND actually decodes back to it.
                        st = os.stat(dst)
                        if (st.st_mtime >= src_stat.st_mtime
                                and _decompressed_len(dst, enc) == src_stat.st_size):
                            good[rel + ext] = (st.st_size, st.st_mtime)
                            continue
                    except Exception:
                        pass  # missing, stale or corrupt — rebuild it below
                    if data is None:
                        data = open(src, "rb").read()
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    _write_atomic(dst, compress(data))
                    st = os.stat(dst)
                    good[rel + ext] = (st.st_size, st.st_mtime)
            except Exception:
                logging.debug("precompress failed for %s", src, exc_info=True)

    with _WEB_VARIANTS_LOCK:
        _WEB_VARIANTS.clear()
        _WEB_VARIANTS.update(good)
    logging.info("precompressed %d web variants", len(good))


def _variant_for(fname, ext):
    """Path of a registered, still-matching variant, or None to serve plain."""
    with _WEB_VARIANTS_LOCK:
        rec = _WEB_VARIANTS.get(fname + ext)
    if rec is None:
        return None
    size, mtime = rec
    path = os.path.join(_web_cache_dir(), fname + ext)
    try:
        st = os.stat(path)
    except OSError:
        return None
    if st.st_size != size or st.st_mtime != mtime:
        logging.warning("precompressed variant changed under us, ignoring: %s", path)
        return None
    return path


def _send_web_file(fname):
    """send_from_directory(WEB_DIR, ...) preferring a precompressed variant.

    A variant is used only when _variant_for vouches for it. Serving a bad one
    is uniquely nasty: the response is a 200 the browser cannot decode, so the
    page renders blank with nothing in the console and no failed request to
    point at — and for /_expo/* assets, which go out as `immutable, max-age=1y`,
    the browser caches that blank result for a year. Falling back to the
    uncompressed original always works.
    """
    import mimetypes
    accept = request.headers.get("Accept-Encoding", "").lower()
    if fname.endswith(_COMPRESSIBLE):
        for enc, ext in (("br", ".br"), ("gzip", ".gz")):
            if enc not in accept:
                continue
            path = _variant_for(fname, ext)
            if path is None:
                continue
            resp = send_from_directory(os.path.dirname(path), os.path.basename(path))
            resp.headers["Content-Encoding"] = enc
            resp.headers["Content-Type"] = (
                mimetypes.guess_type(fname)[0] or "application/octet-stream")
            resp.headers["Vary"] = "Accept-Encoding"
            return resp
    return send_from_directory(WEB_DIR, fname)


def _no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response


def _immutable(response):
    # Content-hashed build artefacts never change under the same name — let the
    # browser keep them for a year. index.html stays no-store, so a deploy still
    # takes effect immediately (it references the new hashes).
    response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


# Hot, frequently re-requested market-data endpoints: a short browser-side
# cache (delayed data anyway) makes tab hops and re-mounts feel instant while
# stale-while-revalidate refreshes in the background.
_MICRO_CACHE_PREFIXES = ("/indices", "/movers", "/news", "/sectors", "/ltp",
                         "/index", "/gsec", "/ipos", "/holidays")


@app.after_request
def _micro_cache(response):
    if (request.method == "GET" and response.status_code == 200
            and not response.headers.get("Cache-Control")
            and request.path.startswith(_MICRO_CACHE_PREFIXES)):
        response.headers["Cache-Control"] = "public, max-age=20, stale-while-revalidate=60"
    return response

# Exported React Native web build (Expo). When present it becomes the live UI;
# the legacy single-file HTML stays available at /legacy and as a fallback.
WEB_DIR = os.path.join(_BASE_DIR, "mobile", "dist")
_WEB_INDEX = os.path.join(WEB_DIR, "index.html")

# Generate the .br/.gz variants at import so they exist under gunicorn
# (wsgi.py) and `python server.py` alike. Idempotent and cheap (~1 s for the
# whole bundle; skipped entirely when the cache is fresh).
threading.Thread(target=_precompress_web_dir, name="web-precompress", daemon=True).start()


def _serve_app_shell():
    if os.path.exists(_WEB_INDEX):
        return _no_cache(_send_web_file("index.html"))
    return _no_cache(send_from_directory(_BASE_DIR, "StockScreenPro.html"))


@app.route("/")
def index():
    """The start page.

    Signed out you get the public landing — brand, what the product does, and
    the sign-in form. Signed in you get the app itself, so returning members
    never see a marketing page they have already read.

    The decision is per request rather than a redirect, so the URL stays `/`
    either way and signing in does not bounce you through an interstitial.
    The native shell loads its bundled copy of index.html and never asks the
    server for `/`, so it is unaffected.
    """
    if _member_session_present():
        return _serve_app_shell()
    # This response depends on a cookie, so it must never be reused for a
    # different session. Without both headers a browser happily serves the
    # landing back to a signed-in visitor (and the app shell to a signed-out
    # one) from its own cache, which looks exactly like a broken login.
    resp = app.make_response(_brand.landing_html())
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Vary"] = "Cookie, Accept-Encoding"
    return resp


@app.route("/app")
@app.route("/app/")
def app_shell():
    """The app, regardless of session — the shell shows its own sign-in gate.

    Deliberately unconditional: it is the escape hatch for a bookmark, for the
    post-login redirect, and for the deploy's own smoke check, none of which
    should depend on whether a cookie happens to be valid.
    """
    return _serve_app_shell()


@app.route("/legacy")
def legacy_ui():
    return _no_cache(send_from_directory(_BASE_DIR, "StockScreenPro.html"))


@app.route("/<path:fname>")
def static_files(fname):
    # 1) Prefer the RN-web bundle (index.html SPA shell, _expo/*, assets/*, favicon)
    if os.path.isfile(os.path.join(WEB_DIR, fname)):
        # The Expo export puts every JS/asset under a content-hashed name in
        # _expo/ and assets/. Serving those no-store forced the browser to
        # re-download the whole ~1.4 MB bundle on every visit — the single
        # biggest cause of slow website startup.
        # vendor/ files carry their version in the filename, so they're as
        # good as content-hashed — cache like the build artefacts.
        if fname.startswith(("_expo/", "assets/", "vendor/")):
            return _immutable(_send_web_file(fname))
        return _no_cache(_send_web_file(fname))
    # 2) Fall back to repo-root files (StockScreenPro.html, VERSION, legacy assets)
    if os.path.isfile(os.path.join(_BASE_DIR, fname)):
        return _no_cache(send_from_directory(_BASE_DIR, fname))
    # 3) SPA fallback: unknown non-API paths → the web shell (API routes are
    #    matched by Flask before this catch-all, so they're unaffected)
    if os.path.exists(_WEB_INDEX):
        return _no_cache(_send_web_file("index.html"))
    return ("Not found", 404)


def _app_version():
    try:
        with open(os.path.join(_BASE_DIR, "VERSION")) as f:
            return f.read().strip()
    except Exception:
        return "0.0.0"


# ── per-IP rate limiting (sliding window; nginx sets X-Real-IP) ──
_RL: dict = {}
_RL_LOCK = threading.Lock()
_STARTED = time.time()


def _client_ip():
    return request.headers.get("X-Real-IP") or request.remote_addr or "?"


def _rl_hit(name, limit, window):
    """Record a hit; returns None if allowed, else seconds until retry."""
    key = (name, _client_ip())
    now = time.time()
    with _RL_LOCK:
        hits = [t for t in _RL.get(key, []) if now - t < window]
        if len(hits) >= limit:
            _RL[key] = hits
            return max(1, int(window - (now - hits[0])) + 1)
        hits.append(now)
        _RL[key] = hits
        if len(_RL) > 5000:  # bound memory under address churn
            _RL.clear()
    return None


def rate_limit(name, limit, window):
    def deco(fn):
        import functools

        @functools.wraps(fn)
        def wrapper(*a, **kw):
            retry = _rl_hit(name, limit, window)
            if retry is not None:
                return jsonify({"error": "rate-limited",
                                "detail": "Too many requests — retry in %ds." % retry}), 429
            return fn(*a, **kw)
        return wrapper
    return deco


# ── observability: request metrics + structured access log + error capture ──
_METRICS = {"requests": 0, "errors": 0, "by_status": {}, "slow": 0}
_METRICS_LOCK = threading.Lock()


# Global per-identity limiter (token bucket): a signed-in user gets their own
# bucket, anonymous traffic shares one per IP. Generous enough for the app's
# real bursts (a dashboard load fires ~10 calls, screener polls stream), tight
# enough that one client can't monopolise the single worker. Static assets are
# exempt — they're immutable-cached anyway.
_BUCKETS = {}
_BUCKETS_LOCK = threading.Lock()
_BUCKET_RATE = 6.0      # tokens/second (≈360 req/min sustained)
_BUCKET_BURST = 150.0


def _identity():
    try:
        uid = current_user_id()
        if uid is not None:
            return f"u:{uid}"
    except Exception:
        pass
    return "ip:" + (request.headers.get("X-Real-IP") or request.remote_addr or "?")


@app.before_request
def _req_start():
    request._t0 = time.time()
    p = request.path
    if p == "/" or p.startswith(("/_expo/", "/assets/", "/favicon", "/legal", "/privacy", "/terms", "/status")):
        return None
    ident = _identity()
    now = time.time()
    with _BUCKETS_LOCK:
        tokens, ts = _BUCKETS.get(ident, (_BUCKET_BURST, now))
        tokens = min(_BUCKET_BURST, tokens + (now - ts) * _BUCKET_RATE)
        if tokens < 1.0:
            _BUCKETS[ident] = (tokens, now)
            return jsonify({"error": "rate-limited",
                            "detail": "Too many requests — slow down a little."}), 429
        _BUCKETS[ident] = (tokens - 1.0, now)
        # keep the table from growing unbounded
        if len(_BUCKETS) > 5000:
            cutoff = now - 600
            for k in [k for k, (_, t) in _BUCKETS.items() if t < cutoff][:2500]:
                _BUCKETS.pop(k, None)
    return None


# CSP for served HTML. Pragmatic, not maximal: react-native-web injects inline
# <style>, the chart/graph/PDF views render in srcdoc iframes (which inherit
# this policy) with inline <script>, and the TradingView widget pulls tv.js and
# frames from tradingview hosts — so inline script/style must stay allowed.
# What this still buys: no scripts from any other origin, no plugins, no
# base-tag hijack, forms only to self.
_CSP = (
    "default-src 'self'; "
    # unpkg.com is the CDN *fallback* for the self-hosted /vendor chart libs
    # (lightweight-charts, d3) — the srcdoc chart iframes inherit this policy.
    "script-src 'self' 'unsafe-inline' https://s3.tradingview.com https://*.tradingview.com "
    "https://unpkg.com; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' data: https://fonts.gstatic.com; "
    "img-src * data: blob:; "
    "connect-src 'self' https: wss:; "
    "frame-src 'self' blob: https://*.tradingview.com https://*.tradingview-widget.com; "
    "object-src 'none'; base-uri 'self'; form-action 'self'"
)


@app.after_request
def _gzip_json(resp):
    # Compress large dynamic JSON payloads (scan results, movers, dashboards
    # are hundreds of KB). Static files are handled by the precompressed-file
    # path above (their responses stream in passthrough mode, skipped here).
    try:
        if (resp.status_code == 200
                and not resp.direct_passthrough
                and "Content-Encoding" not in resp.headers
                and (resp.content_type or "").startswith("application/json")
                and "gzip" in request.headers.get("Accept-Encoding", "").lower()):
            body = resp.get_data()
            if len(body) > 1024:
                import gzip as _gzip
                resp.set_data(_gzip.compress(body, 5))
                resp.headers["Content-Encoding"] = "gzip"
                resp.headers["Content-Length"] = str(len(resp.get_data()))
                resp.headers["Vary"] = "Accept-Encoding"
    except Exception:
        pass
    return resp


@app.after_request
def _security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    resp.headers.setdefault("Permissions-Policy",
                            "camera=(), microphone=(), geolocation=(), payment=()")
    ctype = (resp.headers.get("Content-Type") or "")
    if ctype.startswith("text/html"):
        resp.headers.setdefault("Content-Security-Policy", _CSP)
    # HSTS only once the request actually arrived over TLS (nginx sets the
    # forwarded proto after enable-https.sh) — emitting it on plain HTTP is a
    # no-op at best and confusing at worst.
    if request.headers.get("X-Forwarded-Proto", "").lower() == "https":
        resp.headers.setdefault("Strict-Transport-Security",
                                "max-age=31536000; includeSubDomains")
    try:
        dt = time.time() - getattr(request, "_t0", time.time())
        with _METRICS_LOCK:
            _METRICS["requests"] += 1
            b = str(resp.status_code)
            _METRICS["by_status"][b] = _METRICS["by_status"].get(b, 0) + 1
            if resp.status_code >= 500:
                _METRICS["errors"] += 1
            if dt > 5:
                _METRICS["slow"] += 1
        # concise structured access line (path only, no query — avoids logging secrets)
        if resp.status_code >= 400 or dt > 5:
            logging.info("req %s %s -> %s %.0fms", request.method,
                         request.path, resp.status_code, dt * 1000)
    except Exception:
        pass
    return resp


@app.errorhandler(Exception)
def _on_error(e):
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    logging.exception("unhandled error on %s", request.path)
    with _METRICS_LOCK:
        _METRICS["errors"] += 1
    return jsonify({"error": "server-error",
                    "detail": "Something went wrong — please retry."}), 500


# ── owner authentication (protects broker + future per-user endpoints) ──
def require_owner(fn):
    import functools

    @functools.wraps(fn)
    def wrapper(*a, **kw):
        # An owner-flagged member account is enough; the standalone passcode is
        # only *required* when no such account can grant the rights.
        if not _owner_session():
            if not _owner_auth_available():
                return jsonify({"error": "owner-auth-required",
                                "detail": "This feature is owner-only. Sign in with an "
                                          "owner account, or set APP_PASSWORD on the "
                                          "server."}), 403
            return jsonify({"error": "unauthorized",
                            "detail": "Owner login required."}), 401
        return fn(*a, **kw)
    return wrapper


@app.route("/auth/status")
def auth_status():
    return jsonify({"configured": _owner_auth_available(),
                    "owner": _owner_session()})


# ── session transport ────────────────────────────────────────────────────────
# The web SPA is same-origin, so httpOnly cookies are both safe and sufficient.
# The Android shell is a Capacitor WebView at https://localhost calling this
# API cross-site, where the browser refuses to attach SameSite=Lax cookies —
# so every session there would silently vanish on the next request. Each
# session therefore ALSO travels as a bearer header the native shell stores
# itself (`X-TE-Member` / `X-TE-User` / `X-TE-Owner`); the token is the exact
# same signed value the cookie carries, so nothing about verification changes.
_HDR_MEMBER = "X-TE-Member"
_HDR_USER = "X-TE-User"
_HDR_OWNER = "X-TE-Owner"


def _is_https() -> bool:
    return (request.headers.get("X-Forwarded-Proto") == "https"
            or request.scheme == "https")


# Set to a leading-dot parent (".taureye.com") when the site answers on more
# than one hostname — apex AND www — so one login covers both. Left blank the
# cookie is host-only, which is the right default for a single hostname and for
# the bare IP (browsers reject a domain attribute on an IP host outright).
_COOKIE_DOMAIN = (os.environ.get("SESSION_COOKIE_DOMAIN") or "").strip() or None


def _cookie_domain():
    """The configured parent domain — but only when it covers THIS request.

    A Domain attribute that does not cover the request host is rejected
    outright by every browser: the cookie is silently never stored, so login
    returns 200 and the user is immediately signed out again. That is exactly
    what SESSION_COOKIE_DOMAIN=.taureye.com did to sign-in on the bare IP,
    which is the host used for preview testing.

    Falling back to a host-only cookie is correct rather than merely tolerant:
    the point of the setting is to span apex and www, and on any host outside
    that domain there is nothing to span.
    """
    if not _COOKIE_DOMAIN:
        return None
    host = (request.host or "").split(":")[0].strip().lower()
    base = _COOKIE_DOMAIN.lstrip(".").lower()
    if host == base or host.endswith("." + base):
        return _COOKIE_DOMAIN
    return None


def _session_cookie(resp, name, value, max_age):
    """Set a session cookie with the strongest flags the transport allows.
    Cross-site (native shell) needs SameSite=None, which browsers only accept
    with Secure — so that combination is used only once TLS is in front."""
    https = _is_https()
    resp.set_cookie(name, value, max_age=max_age, httponly=True,
                    domain=_cookie_domain(),
                    samesite="None" if https else "Lax", secure=https)
    return resp


def _clear_cookie(resp, name):
    """Expire a session cookie. The domain MUST match the one it was set with —
    a host-only delete leaves a .parent-domain cookie in place, so logout would
    silently not log the user out."""
    resp.delete_cookie(name, domain=_cookie_domain())
    return resp


def _bearer(header_name: str) -> str:
    """Session token from the header the native shell sends (blank on web)."""
    raw = (request.headers.get(header_name) or "").strip()
    return raw[7:].strip() if raw.lower().startswith("bearer ") else raw


def _owner_auth_available() -> bool:
    """True when SOME route to owner rights exists — an owner-flagged member
    account, or the standalone passcode."""
    if any(a.get("owner") for a in _members.accounts().values()):
        return True
    return _auth.configured()


def _owner_session() -> bool:
    """Owner rights come from ONE sign-in: a member account flagged `owner`
    counts, so the broker / alerts / developer screens stop asking for a
    separate passcode. The standalone passcode still works for instances that
    have no member table configured."""
    m = _members.from_cookie(request.cookies.get(_members.COOKIE, "")) \
        or _members.from_cookie(_bearer(_HDR_MEMBER))
    if m and m.get("owner"):
        return True
    return (_auth.is_owner(request.cookies.get(_auth.COOKIE, ""))
            or _auth.is_owner(_bearer(_HDR_OWNER)))


@app.route("/auth/login", methods=["POST"])
@rate_limit("auth-login", 8, 300)
def auth_login():
    body = request.get_json(silent=True) or {}
    if not _auth.configured():
        return jsonify({"error": "not-configured",
                        "detail": "No owner passcode is set on this server."}), 403
    if not _auth.check_password(body.get("password", "")):
        return jsonify({"error": "bad-password"}), 401
    token = _auth.make_cookie()
    resp = jsonify({"owner": True, "token": token})
    return _session_cookie(resp, _auth.COOKIE, token, _auth.TTL)


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    resp = jsonify({"owner": False, "user": None})
    _clear_cookie(resp, _auth.COOKIE)
    _clear_cookie(resp, _USER_COOKIE)
    return resp


# ── user accounts (email + OTP) — the multi-tenant foundation ────────────────
import users as _users

_USER_COOKIE = "te_user"


def current_user_id():
    """The account whose synced documents (watchlists, alerts, paper trades)
    this request owns. A member sign-in IS an account — it auto-provisions a
    row keyed to the member, so signing in once starts cloud sync without a
    second email login. The email/OTP identity remains for accounts created
    that way (and for members who prefer an email they can move between
    devices)."""
    uid = (_users.session_user_id(request.cookies.get(_USER_COOKIE, ""))
           or _users.session_user_id(_bearer(_HDR_USER)))
    if uid is not None:
        return uid
    m = current_member()
    if m and _users.enabled():
        row, _created = _users.get_or_create_user(_member_account_email(m), consent=True)
        if row:
            return row["id"]
    return None


def _member_account_email(member) -> str:
    """Stable internal address for a member's synced documents. Never emailed —
    it exists so member and email accounts share one storage table."""
    return f"{member['uname']}@member.taureye.local"


def require_user(fn):
    import functools

    @functools.wraps(fn)
    def wrapper(*a, **kw):
        uid = current_user_id()
        if uid is None:
            return jsonify({"error": "not-signed-in"}), 401
        request.user_id = uid
        return fn(*a, **kw)
    return wrapper


# ── membership gate (username/password + plan) — the paywall foundation ──────
import members as _members

# Said once, at boot, in the log the operator actually reads. The placeholder
# credentials are in a public repository's history: on a reachable instance
# they are not a warning about an open door, they are the open door. Loud
# rather than silent, and never in an HTTP response — telling an anonymous
# caller which credentials are in use would be the same mistake again.
if _members.using_default_accounts():
    log.warning(
        "SECURITY: running on the PUBLISHED placeholder logins. Rotate them: "
        "write %s (or set MEMBER_ACCOUNTS_JSON) with hashes from "
        "`python -m members hash`.", _members.accounts_file())


def current_member():
    return (_members.from_cookie(request.cookies.get(_members.COOKIE, ""))
            or _members.from_cookie(_bearer(_HDR_MEMBER)))


def _member_session_present() -> bool:
    """Is this request carrying a valid member session?

    Used by `/` to choose between the landing page and the app. Never raises:
    a malformed cookie must render the landing, not a 500 on the front door.
    """
    try:
        return current_member() is not None
    except Exception:
        return False


def require_plan(*feature):
    """Gate an API route behind a signed-in member whose plan carries the
    feature (no feature argument = any signed-in member)."""
    def deco(fn):
        import functools

        @functools.wraps(fn)
        def wrapper(*a, **kw):
            m = current_member()
            if m is None:
                return jsonify({"error": "member-required",
                                "detail": "Sign in to use this feature."}), 401
            missing = [f for f in feature if f not in m["features"]]
            if missing:
                return jsonify({"error": "plan-required", "plan": m["plan"],
                                "detail": "Your membership doesn't include this "
                                          "feature yet."}), 402
            request.member = m
            return fn(*a, **kw)
        return wrapper
    return deco


@app.route("/auth/member/login", methods=["POST"])
@rate_limit("member-login", 10, 300)
def member_login():
    body = request.get_json(silent=True) or {}
    m = _members.check_login(body.get("username", ""), body.get("password", ""))
    if m is None:
        return jsonify({"error": "bad-credentials",
                        "detail": "Wrong username or password."}), 401
    m["features"] = _members.features_for(m["plan"])
    token = _members.make_cookie(m)
    resp = jsonify({"member": m, "token": token})
    return _session_cookie(resp, _members.COOKIE, token, _members.TTL)


@app.route("/auth/member/register", methods=["POST"])
# Ten an hour per IP. Creating an account is a thing a person does once; the
# only caller who needs it faster is someone enumerating names.
@rate_limit("member-register", 10, 3600)
def member_register():
    body = request.get_json(silent=True) or {}
    m, err = _members.register(body.get("username", ""), body.get("password", ""),
                               body.get("code", ""))
    if m is None:
        return jsonify({"error": "signup-refused", "detail": err}), 400
    # Signed straight in: making someone type the password they just chose,
    # into the form they just left, is a step that exists for no one.
    m["features"] = _members.features_for(m["plan"])
    token = _members.make_cookie(m)
    _analytics.track(m["uname"], "auth.signup")
    resp = jsonify({"member": m, "token": token})
    return _session_cookie(resp, _members.COOKIE, token, _members.TTL)


@app.route("/auth/member/signup-policy")
def member_signup_policy():
    """What the sign-up form needs to know before anyone types into it."""
    return jsonify({
        "open": _members.signup_open(),
        "invite_required": bool(os.environ.get("MEMBER_SIGNUP_CODE", "").strip()),
        "username_min": _members.USERNAME_MIN,
        "username_max": _members.USERNAME_MAX,
        "password_min": _members.PASSWORD_MIN,
        "plan": _members.SIGNUP_PLAN,
    })


@app.route("/auth/member")
def member_me():
    return jsonify({"member": current_member()})


@app.route("/auth/member/logout", methods=["POST"])
def member_logout():
    resp = jsonify({"member": None})
    _clear_cookie(resp, _members.COOKIE)
    _clear_cookie(resp, _USER_COOKIE)      # sign out of BOTH identities at once
    _analytics.track(_acct(), "auth.signout")
    return resp


# ── monetisation: wallet, credits, referrals, subscriptions, analytics ───────
# Everything below is preview-gated. taureye.com and 161.118.174.177 are the
# same server, so "live on the IP, not on the domain" is decided per request
# from the Host header — see preview.py.
import preview as _preview
import gifting as _gifting
import privacy as _privacy
import usage as _usage
import rewards as _rewards
import wallet as _wallet
import referrals as _referrals
import billing as _billing
import analytics as _analytics
import integrations as _integrations


def _acct() -> str:
    """The wallet/referral identity for this request.

    The member username, because that is what people actually sign in with
    today. Email accounts (users.py) are a separate identity that is not yet
    joined to this one; when they are, this is the single place to do it.
    """
    m = current_member()
    return (m or {}).get("uname", "")


def _preview_on() -> bool:
    return _preview.enabled(request.headers.get("Host", ""))


def require_preview(fn):
    """404 (not 403) off the preview host — an unreleased feature should look
    absent on the public domain, not merely forbidden."""
    import functools

    @functools.wraps(fn)
    def wrapper(*a, **kw):
        if not _preview_on():
            return jsonify({"error": "not-found",
                            "detail": "This feature is not available yet."}), 404
        return fn(*a, **kw)
    return wrapper


# ── public brand site: landing, About, Insights ──────────────────────────────
# Served as HTML rather than inside the RN app: these are documents, not app
# screens, and an RN-web SPA is invisible to search engines. Lives under /site
# so the app keeps the root — moving the app would break every bookmark and the
# deploy's own smoke check for no benefit.
import brandsite as _brand


@app.route("/brand/<path:asset>")
def brand_asset(asset):
    """Logo, wordmark, favicons, OG image, and the hero bull's WebGL bundle.
    Long-cached — the images are versioned by filename and change roughly never,
    and bull.js is requested with a content-hash query (see brandsite._asset_v)
    so a rebuild is not stuck behind this week-long cache."""
    if "/" in asset or ".." in asset:
        return jsonify({"error": "not-found"}), 404
    path = os.path.join(_brand.IMG_DIR, asset)
    if not os.path.isfile(path):
        return jsonify({"error": "not-found"}), 404
    resp = _send_brand_file(asset)
    resp.headers["Cache-Control"] = "public, max-age=604800"
    return resp


# Verified once at import: a .gz that does not decompress to exactly its
# original is never served. A bad one is a 200 the browser cannot decode —
# blank content with nothing in the console — and this route sends
# `max-age=604800`, so the browser would keep the broken result for a week.
_BRAND_GZ = {}


def _verify_brand_variants():
    import gzip as _gz
    for name in os.listdir(_brand.IMG_DIR):
        if not name.endswith(".gz"):
            continue
        orig = os.path.join(_brand.IMG_DIR, name[:-3])
        gzp = os.path.join(_brand.IMG_DIR, name)
        if not os.path.isfile(orig):
            continue
        try:
            with open(gzp, "rb") as fh:
                out = _gz.decompress(fh.read())
            if len(out) == os.path.getsize(orig):
                _BRAND_GZ[name[:-3]] = os.path.getmtime(gzp)
            else:
                logging.warning("brand: %s does not match its source, ignoring", name)
        except Exception:
            logging.warning("brand: %s is not readable gzip, ignoring", name)


def _send_brand_file(asset):
    """send_from_directory for brand/img, preferring a committed .gz.

    The three.js bull bundle is 562 KB raw and 146 KB gzipped. nginx would
    compress it, but only where nginx's own config lists the right MIME type —
    and the live config on the VM is certbot-managed, so a deploy cannot safely
    rewrite it. Shipping the compressed copy makes the transfer size a property
    of the repo rather than of one machine's configuration.
    """
    import mimetypes
    if (asset in _BRAND_GZ
            and "gzip" in request.headers.get("Accept-Encoding", "").lower()
            and _BRAND_GZ[asset] == os.path.getmtime(
                os.path.join(_brand.IMG_DIR, asset + ".gz"))):
        resp = send_from_directory(_brand.IMG_DIR, asset + ".gz")
        resp.headers["Content-Encoding"] = "gzip"
        resp.headers["Content-Type"] = (
            mimetypes.guess_type(asset)[0] or "application/octet-stream")
        resp.headers["Vary"] = "Accept-Encoding"
        return resp
    return send_from_directory(_brand.IMG_DIR, asset)


_verify_brand_variants()


@app.route("/site")
@app.route("/site/")
def site_landing():
    return _brand.landing_html()


@app.route("/site/about")
def site_about():
    return _brand.about_html()


@app.route("/site/insights")
def site_insights():
    return _brand.insights_html()


@app.route("/site/tutorial")
def site_tutorial():
    return _brand.tutorial_html()


@app.route("/site/contact")
def site_contact():
    return _brand.contact_html()


@app.route("/site/legal")
def site_legal_index():
    return redirect("/site/legal/terms", code=302)


@app.route("/site/legal/<key>")
def site_legal(key):
    out = _brand.legal_html(key)
    if out is None:
        return redirect("/site/legal/terms", code=302)
    return out


@app.route("/site/insights/<slug>")
def site_article(slug):
    out = _brand.article_html(slug)
    if out is None:
        return _brand.page(
            "Not found — TaurEye",
            '<section><div class="wrap"><h1>Article not found</h1>'
            '<p class="lead">That article does not exist or has moved.</p>'
            '<a class="btn" href="/site/insights">← All insights</a></div></section>',
        ), 404
    return out


@app.route("/preview")
def preview_status():
    host = request.headers.get("Host", "")
    return jsonify({"preview": _preview_on(), "host": host,
                    "reason": _preview.reason(host)})


@app.route("/wallet")
@require_preview
@require_plan()
def wallet_get():
    acct = _acct()
    return jsonify({
        "account": acct,
        "balances": _wallet.balances(acct),
        "history": _wallet.history(acct, 25),
    })


@app.route("/wallet/earn")
@require_preview
@require_plan()
def wallet_earn():
    """Ways to earn credits, and which are available right now.

    The wallet's 'what next' — a balance with no visible way to grow it reads
    as a dead end, which is how the credit system felt before this existed.
    """
    acct = _acct()
    # One status read, shared — earn_list() would otherwise recompute it.
    daily = _rewards.status(acct)
    return jsonify({
        "earn": _rewards.earn_list(acct, st=daily),
        "prices": _rewards.price_list(),
        "daily": daily,
        "balance": _wallet.balance(acct),
    })


@app.route("/wallet/daily", methods=["POST"])
@require_preview
@require_plan()
def wallet_daily():
    """Claim the daily bonus. Idempotent on the trading day, so a double tap or
    a retried request pays exactly once."""
    acct = _acct()
    out = _rewards.claim_daily(acct)
    _analytics.track(acct, "wallet.daily",
                     {"ok": bool(out.get("ok")), "streak": out.get("streak", 0)})
    return jsonify(out), (200 if out.get("ok") else 409)


@app.route("/wallet/history")
@require_preview
@require_plan()
def wallet_history():
    """The full ledger. Every row carries a human reason, and showing them is
    how a currency earns trust — a balance nobody can audit is a number."""
    try:
        limit = max(1, min(200, int(request.args.get("limit", "50"))))
    except (TypeError, ValueError):
        limit = 50
    acct = _acct()
    return jsonify({"history": _wallet.history(acct, limit),
                    "balances": _wallet.balances(acct)})


@app.route("/wallet/spend", methods=["POST"])
@require_preview
@require_plan()
def wallet_spend():
    """Charge for a metered action.

    The client asks to spend BEFORE doing the work and passes a stable `ref`,
    so a retry after a dropped connection cannot double-charge — the ledger's
    unique index on (acct, currency, ref) enforces that at the database rather
    than in application logic.
    """
    body = request.get_json(silent=True) or {}
    action = str(body.get("action") or "").strip()
    ref = str(body.get("ref") or "").strip() or None
    cost = _rewards.price(action)
    if not cost:
        return jsonify({"error": "unknown-action",
                        "detail": f"Nothing is priced as {action!r}."}), 400
    acct = _acct()
    try:
        left = _wallet.spend(acct, cost, _rewards.PRICE_LABELS.get(action, action), ref=ref)
    except _wallet.InsufficientFunds:
        return jsonify({"error": "insufficient-credits", "needed": cost,
                        "balance": _wallet.balance(acct),
                        "detail": "Not enough credits for this yet."}), 402
    _analytics.track(acct, "wallet.spend", {"action": action, "credits": cost})
    return jsonify({"ok": True, "spent": cost, "balance": left, "action": action})


@app.route("/account/data")
@require_preview
@require_plan()
def account_data_export():
    """Everything this account holds, as one JSON document.

    A DPDP requirement, and the honest version of one: it returns the actual
    rows rather than a summary, because the point is that the person can see
    what is held about them, not be told about it.
    """
    acct = _acct()
    plan = request.member.get("plan") or "free"
    out = {
        "account": acct,
        "exported_at": int(time.time()),
        "member": {k: v for k, v in request.member.items() if k != "token"},
        "wallet": {
            "balances": _wallet.balances(acct),
            "ledger": _wallet.history(acct, limit=1000),
        },
        "referrals": _referrals.stats(acct),
        "usage": _usage.summary(acct, plan),
        "subscription": _billing.subscription(acct, plan),
    }
    resp = jsonify(out)
    resp.headers["Content-Disposition"] = f'attachment; filename="taureye-data-{acct}.json"'
    return resp


@app.route("/account/delete", methods=["POST"])
@require_preview
@require_plan()
def account_delete():
    """Erase this account's data.

    Requires the password again: deletion is irreversible and a live session is
    not proof that the person at the keyboard is the account holder.

    The wallet ledger is NOT deleted — it is the record behind money that has
    moved, including gifts to other people, and erasing one side of a transfer
    corrupts the other. It is anonymised instead: the rows survive, the identity
    does not. That is what the law asks for and what accounting needs.
    """
    body = request.get_json(silent=True) or {}
    acct = _acct()
    if not _members.check_login(acct, str(body.get("password") or "")):
        return jsonify({"error": "bad-password",
                        "detail": "Enter your password to confirm deletion."}), 403
    if str(body.get("confirm") or "").strip().upper() != "DELETE":
        return jsonify({"error": "not-confirmed",
                        "detail": 'Type DELETE to confirm.'}), 400

    erased = _privacy.erase(acct)
    resp = jsonify({"ok": True, "erased": erased,
                    "note": "Wallet rows were anonymised rather than removed, "
                            "because they are the other half of transfers that "
                            "involved other people."})
    _clear_cookie(resp, _members.COOKIE)
    _clear_cookie(resp, _USER_COOKIE)
    return resp


@app.route("/r/<code>")
def referral_link(code):
    """A share link that applies the code without anyone typing it.

    First touch, not last: the person who sent the first link is the one who
    actually persuaded them, so an existing cookie is never overwritten. The
    cookie is the only state — attribution still happens through /referral/claim
    once there is an account to attach it to.
    """
    clean = "".join(ch for ch in (code or "").upper() if ch.isalnum())[:12]
    resp = redirect("/", code=302)
    if clean:
        resp.set_cookie(
            "te_ref", clean,
            max_age=30 * 24 * 3600,
            httponly=False,          # the sign-in page reads it to prefill
            samesite="Lax",
            secure=request.is_secure,
            domain=_cookie_domain(),
        )
    return resp


@app.route("/usage")
@require_preview
@require_plan()
def usage_get():
    """This month's allowances — so the UI can show a limit BEFORE it is hit
    rather than only when it bites."""
    acct = _acct()
    return jsonify(_usage.summary(acct, request.member.get("plan") or "free"))


@app.route("/usage/record", methods=["POST"])
@require_preview
@require_plan()
def usage_record():
    """Count one use of an allowance-limited action.

    Returns 402 when the allowance is spent, with what would lift it — the
    client turns that into an upgrade prompt rather than an error.
    """
    body = request.get_json(silent=True) or {}
    action = str(body.get("action") or "").strip()
    if action not in _usage.LABELS:
        return jsonify({"error": "unknown-action"}), 400
    acct = _acct()
    plan = request.member.get("plan") or "free"
    if not _usage.allows(acct, action, plan):
        return jsonify({
            "error": "allowance-spent",
            "detail": f"You have used this month's {_usage.LABELS[action]}.",
            "action": action,
            "plan": plan,
            "limit": _usage.limit_for(plan, action),
        }), 402
    _usage.record(acct, action)
    # Doing something real is what releases the rest of a referral reward — a
    # manufactured account signs up and stops, so the bulk waits for this.
    try:
        _referrals.activate(acct)
    except Exception:
        logging.debug("referral activation failed for %s", acct, exc_info=True)
    return jsonify({"ok": True, **_usage.summary(acct, plan)["actions"][action]})


@app.route("/wallet/gift", methods=["GET", "POST"])
@require_preview
@require_plan()
def wallet_gift():
    """Send credits to another member.

    GET returns what the sender may do right now, so the form can show the
    limits before an attempt rather than after a refusal.
    """
    acct = _acct()
    if request.method == "GET":
        return jsonify(_gifting.quote(acct))

    body = request.get_json(silent=True) or {}
    try:
        out = _gifting.send(
            acct,
            str(body.get("to") or ""),
            body.get("amount"),
            str(body.get("message") or ""),
            known_accounts=set(_members.accounts().keys()),
        )
    except _gifting.GiftRefused as e:
        return jsonify({"error": "gift-refused", "detail": str(e)}), 400
    except _wallet.InsufficientFunds:
        return jsonify({"error": "insufficient-credits",
                        "detail": "Not enough credits."}), 402
    _analytics.track(acct, "wallet.gift", {"amount": out["amount"]})
    return jsonify(out)


@app.route("/referral")
@require_preview
@require_plan()
def referral_get():
    _analytics.track(_acct(), "referral.view", plan=request.member["plan"])
    return jsonify(_referrals.stats(_acct()))


@app.route("/referral/claim", methods=["POST"])
@require_preview
@require_plan()
@rate_limit("referral-claim", 10, 600)
def referral_claim():
    body = request.get_json(silent=True) or {}
    try:
        out = _referrals.claim(_acct(), body.get("code", ""),
                               list(_members.accounts().keys()))
    except _referrals.ReferralError as e:
        return jsonify({"error": "referral-refused", "detail": str(e)}), 400
    _analytics.track(_acct(), "referral.claimed", plan=request.member["plan"])
    return jsonify({"ok": True, **out, "balances": _wallet.balances(_acct())})


@app.route("/billing/plans")
@require_preview
def billing_plans():
    m = current_member()
    acct = (m or {}).get("uname", "")
    return jsonify({
        "plans": _billing.plans(),
        "current": _billing.subscription(acct, (m or {}).get("plan", "")),
        "provider": _billing.provider(),
        "provider_configured": _billing.provider_configured(),
    })


@app.route("/billing/checkout", methods=["POST"])
@require_preview
@require_plan()
@rate_limit("billing-checkout", 12, 600)
def billing_checkout():
    body = request.get_json(silent=True) or {}
    try:
        intent = _billing.start_checkout(_acct(), body.get("plan", ""))
    except ValueError as e:
        return jsonify({"error": "bad-plan", "detail": str(e)}), 400
    _analytics.track(_acct(), "billing.checkout_started",
                     {"plan": body.get("plan", "")}, plan=request.member["plan"])
    return jsonify(intent)


@app.route("/billing/subscription")
@require_preview
@require_plan()
def billing_subscription():
    m = request.member
    return jsonify(_billing.subscription(_acct(), m["plan"]))


@app.route("/paywall/<feature>")
@require_preview
def paywall_check(feature):
    """What a locked feature should tell the user, and what unlocks it."""
    m = current_member()
    acct = (m or {}).get("uname", "")
    allowed = bool(m) and _billing.allows(acct, feature, m["plan"])
    need = _billing.required_plan(feature)
    return jsonify({
        "feature": feature, "allowed": allowed, "required_plan": need,
        "plan": _billing.PLANS.get(need, {}).get("name", need),
        "price_inr": _billing.PLANS.get(need, {}).get("price_paise", 0) / 100.0,
        "signed_in": bool(m),
    })


@app.route("/analytics/track", methods=["POST"])
@require_preview
def analytics_track():
    body = request.get_json(silent=True) or {}
    m = current_member()
    ok = _analytics.track((m or {}).get("uname", ""), body.get("event", ""),
                          body.get("props") or {}, plan=(m or {}).get("plan", ""))
    return jsonify({"ok": ok})


@app.route("/analytics/summary")
@require_preview
@require_owner
def analytics_summary():
    return jsonify(_analytics.summary(int(request.args.get("days", 30))))


@app.route("/integrations")
@require_preview
@require_owner
def integrations_status():
    return jsonify({"integrations": _integrations.all_status()})


@app.route("/integrations/public")
@require_preview
def integrations_public():
    """Client-safe subset: just enough to decide which buttons to render."""
    return jsonify({
        "google": _integrations.google_signin_config(request.headers.get("Host", "")),
        "supabase": _integrations.supabase_config(),
        "payments": {"provider": _billing.provider(),
                     "enabled": _billing.provider_configured()},
    })


@app.route("/auth/otp/request", methods=["POST"])
@rate_limit("otp-request", 6, 600)
def auth_otp_request():
    if not _users.enabled():
        return jsonify({"error": "accounts-disabled",
                        "detail": "Accounts need AUTH_SECRET (or APP_PASSWORD) set on the server."}), 503
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    if not _users.valid_email(email):
        return jsonify({"error": "bad-email"}), 400
    code = _users.issue_otp(email)
    try:
        sent = _users.send_otp_email(email, code)
    except Exception as e:
        log.warning("OTP email send failed for %s: %s", email, e)
        return jsonify({"error": "email-failed",
                        "detail": "Could not send the code — try again shortly."}), 502
    if sent:
        return jsonify({"sent": True})
    # No SMTP configured. Only in explicit dev mode does the code come back in
    # the response (so the flow can be tested without a mail server).
    if os.environ.get("DEV_ECHO_OTP") == "1":
        return jsonify({"sent": False, "dev_code": code})
    return jsonify({"error": "email-not-configured",
                    "detail": "Sign-in emails aren't configured on this server yet."}), 503


@app.route("/auth/otp/verify", methods=["POST"])
@rate_limit("otp-verify", 12, 600)
def auth_otp_verify():
    if not _users.enabled():
        return jsonify({"error": "accounts-disabled"}), 503
    body = request.get_json(silent=True) or {}
    email = (body.get("email") or "").strip().lower()
    if not _users.valid_email(email):
        return jsonify({"error": "bad-email"}), 400
    if not _users.verify_otp(email, body.get("code", "")):
        return jsonify({"error": "bad-code",
                        "detail": "Wrong or expired code."}), 401
    user, created = _users.get_or_create_user(email, consent=bool(body.get("consent")))
    if user is None:
        # brand-new address without the consent checkbox ticked
        return jsonify({"error": "consent-required",
                        "detail": "Accept the Terms & Privacy Policy to create the account."}), 428
    token = _users.make_session_cookie(user["id"])
    resp = jsonify({"user": {"email": user["email"]}, "created": created, "token": token})
    return _session_cookie(resp, _USER_COOKIE, token, _users.SESSION_TTL)


@app.route("/calibration")
def calibration():
    """Community calibration: per-engine realised hit-rate / avg R / sample
    size aggregated over every synced paper-trade log. Public and honest —
    hit-rates only appear once an engine has a meaningful closed sample."""
    return jsonify(_users.calibration())


# ── compliance flags ─────────────────────────────────────────────────────────
# advisory_mode gates every advice-shaped surface (BUY/WATCH actions, targets,
# stops, confidence/probability framing). Until SEBI Research-Analyst
# registration exists it stays OFF for the public: only the owner sees the
# advisory framing. ADVISORY_USERS=1 extends it to signed-in users and
# ADVISORY_ALL=1 to everyone — both explicit owner decisions, never defaults.
@app.route("/flags")
def flags():
    owner = _owner_session()
    signed_in = current_user_id() is not None
    advisory = (
        owner
        or os.environ.get("ADVISORY_ALL") == "1"
        or (signed_in and os.environ.get("ADVISORY_USERS") == "1")
    )
    return jsonify({"advisory_mode": bool(advisory),
                    "accounts": _users.enabled(),
                    "signed_in": signed_in})


@app.route("/auth/me")
def auth_me():
    uid = current_user_id()
    if uid is None:
        return jsonify({"user": None})
    u = _users.get_user(uid)
    if not u:
        return jsonify({"user": None})
    # A member-derived account reports the member's name, not the internal
    # address that keys its rows (see _member_account_email).
    m = current_member()
    if m and u["email"] == _member_account_email(m):
        return jsonify({"user": {"email": m["username"], "source": "member"}})
    return jsonify({"user": {"email": u["email"], "source": "email"}})


@app.route("/auth/account", methods=["DELETE"])
@require_user
def auth_account_delete():
    """DPDP-style deletion: purges the account and every stored document."""
    _users.delete_user(request.user_id)
    resp = jsonify({"deleted": True})
    _clear_cookie(resp, _USER_COOKIE)
    return resp


@app.route("/user/data/<kind>", methods=["GET", "PUT"])
@require_user
def user_data(kind):
    if kind not in _users.DATA_KINDS:
        return jsonify({"error": "unknown-kind"}), 400
    if request.method == "GET":
        doc = _users.data_get(request.user_id, kind)
        return jsonify(doc or {"v": None, "ts": 0})
    body = request.get_json(silent=True) or {}
    if "v" not in body:
        return jsonify({"error": "missing-value"}), 400
    ts = int(body.get("ts") or time.time())
    # Last-write-wins guarded by timestamp so a stale device can't clobber a
    # newer copy that another device already pushed.
    cur = _users.data_get(request.user_id, kind)
    if cur and cur["ts"] > ts:
        return jsonify({"stored": False, "server_newer": True, "v": cur["v"], "ts": cur["ts"]})
    _users.data_put(request.user_id, kind, body["v"], ts)
    return jsonify({"stored": True, "ts": ts})


@app.route("/ping")
def ping():
    return jsonify({"server": "ok", "status": "ok", "source": "NSE Direct + YF fallback",
                    "version": _app_version()})


@app.route("/health")
def health():
    """Operational status: uptime, data-layer cache states, AI availability."""
    def safe(fn, default=None):
        try:
            return fn()
        except Exception:
            return default
    return jsonify({
        "status": "ok",
        "version": _app_version(),
        "uptime_s": int(time.time() - _STARTED),
        "ai_graphs": _ai.available(),
        "auth": _auth.configured(),
        "db": safe(lambda: _store.stats(), {"ok": False}),
        "requests": _METRICS["requests"],
        "errors": _METRICS["errors"],
        "caches": {
            "fundamentals": safe(lambda: len(getattr(_fund, "_cache", {}) or {}), 0),
            "graphs": safe(lambda: len(_ai._load()), 0),
            "scan": safe(lambda: len(getattr(_scanner, "_cache", {}) or {}), 0),
            "news": safe(lambda: len(getattr(_news, "_cache", {}) or {}), 0),
        },
    })


@app.route("/health/upstream")
def health_upstream():
    """Can this machine actually reach the data providers?

    Added because the answer was not obtainable any other way. The screener
    sat at "technicals 0/1444" on the VM, which looks like slowness and is
    not: RSI, the moving averages and the 52-week extremes all come from
    ydata.history(), that is yfinance only, and if yfinance rate-limits this
    IP then every technical in the app is uncomputable rather than merely
    slow. No amount of caching helps when there is nothing to cache.

    Distinguishing the two needed a shell on the box, which is exactly what
    was unavailable. So it is a URL instead. Reports booleans and counts
    only — no keys, no config, nothing worth hiding.
    """
    import scanner as _sc
    import ydata
    out = {"ok": True}

    t = time.time()
    try:
        # tries=1: this is a probe, not a fetch. The default backoff spends
        # ~30s retrying, which would tie up a worker and make a health check
        # the slowest route in the app.
        df = ydata.history("RELIANCE.NS", "1mo", "1d", tries=1)
        out["yfinance"] = {"rows": 0 if df is None else int(len(df)),
                           "ms": int((time.time() - t) * 1000)}
    except Exception as e:
        out["yfinance"] = {"rows": 0, "error": str(e)[:200]}
    out["yfinance"]["reachable"] = bool(out["yfinance"].get("rows"))

    # What the scan cache actually holds right now — a good row, a failed
    # row and an absent row are three different problems.
    try:
        now = time.time()
        with _sc._CACHE_LOCK:
            items = list(_sc._CACHE.items())
        good = sum(1 for _, (ts, r) in items if r is not None and now - ts < _sc._STALE_MAX)
        bad = sum(1 for _, (_ts, r) in items if r is None)
        out["scan_cache"] = {"rows": len(items), "usable": good, "failed": bad,
                            "queued": len(_sc._inflight)}
    except Exception as e:
        out["scan_cache"] = {"error": str(e)[:200]}

    try:
        uni, warming = get_universe_nonblocking()
        out["universe"] = {"symbols": len(uni or []), "warming": bool(warming),
                           "priced": sum(1 for u in (uni or []) if u.get("price")),
                           "bhavcopy_date": _BHAV_DATE or None}
    except Exception as e:
        out["universe"] = {"error": str(e)[:200]}

    # The one-line verdict, so nobody has to interpret the numbers.
    if not out["yfinance"]["reachable"]:
        out["verdict"] = ("yfinance is NOT reachable from this host — technicals "
                          "cannot be computed at all, which is a data-source "
                          "problem, not a caching or latency one.")
    elif out.get("scan_cache", {}).get("usable", 0) == 0:
        out["verdict"] = "yfinance is reachable but the scan cache is empty — still warming."
    else:
        out["verdict"] = "upstream reachable and the scan cache has usable rows."
    return _no_cache(jsonify(out))


@app.route("/healthz")
def healthz():
    """Lean machine-readable liveness + feed staleness for the uptime monitor.

    Always 200 when the process answers; `status` degrades to "degraded" when
    the primary data caches look stale (feeds blocked/rate-limited), so the
    monitor can distinguish 'down' from 'up but starving'."""
    now = time.time()
    idx = _indices_cache.get("domestic")
    idx_age = int(now - idx["ts"]) if idx and idx.get("data") else None
    feeds_ok = idx_age is not None and idx_age < 3600
    db_ok = True
    try:
        _store.kv_get("__healthz__")
    except Exception:
        db_ok = False
    status = "ok" if (db_ok and (feeds_ok or idx_age is None)) else "degraded"
    if not db_ok:
        status = "error"
    return jsonify({
        "status": status,
        "version": _app_version(),
        "uptime_s": int(now - _STARTED),
        "db_ok": db_ok,
        "indices_cache_age_s": idx_age,
        "errors": _METRICS["errors"],
        "requests": _METRICS["requests"],
    })


# Self-hosted client-side error capture: the app POSTs uncaught JS errors here
# so crashes surface in the server log (and /metrics error count) even with no
# external error-tracking vendor configured. SENTRY_DSN, when set (and
# sentry-sdk installed), additionally initialises real Sentry server-side.
@app.route("/client-error", methods=["POST"])
@rate_limit("client-error", 20, 600)
def client_error():
    body = request.get_json(silent=True) or {}
    msg = str(body.get("message", ""))[:400]
    stack = str(body.get("stack", ""))[:1500]
    ver = str(body.get("version", ""))[:40]
    plat = str(body.get("platform", ""))[:40]
    log.error("CLIENT-ERROR [%s %s] %s\n%s", plat, ver, msg, stack)
    with _METRICS_LOCK:
        _METRICS["client_errors"] = _METRICS.get("client_errors", 0) + 1
    return jsonify({"logged": True})


if os.environ.get("SENTRY_DSN"):
    try:
        import sentry_sdk
        sentry_sdk.init(dsn=os.environ["SENTRY_DSN"], traces_sample_rate=0.05)
        log.info("Sentry initialised")
    except Exception as _e:  # missing package / bad DSN — never block startup
        log.warning("Sentry init failed: %s", _e)


@app.route("/metrics")
@require_owner
def metrics():
    """Owner-only operational metrics (request/error counters, DB, caches)."""
    with _METRICS_LOCK:
        m = dict(_METRICS, by_status=dict(_METRICS["by_status"]))
    m["uptime_s"] = int(time.time() - _STARTED)
    m["db"] = _store.stats()
    return jsonify(m)


@app.route("/version")
def version():
    return jsonify({"version": _app_version(), "commit": os.environ.get("GIT_COMMIT", "")})


_LTP_CACHE: dict = {}      # sym -> (fetched_at, entry) — short-lived quote cache
_LTP_TTL = 60


def _yf_batch(symbols):
    """One batched Yahoo download for many NSE symbols → {sym: entry}.

    A single network operation covers a whole graph's quote list in a couple of
    seconds, where per-symbol NSE+YF lookups (each slow to fail when NSE
    throttles the VM) used to blow the frontend's timeout.
    """
    out = {}
    if not symbols:
        return out
    try:
        yf = yf_session()
        data = yf.download([s + ".NS" for s in symbols], period=_YF_WINDOW,
                           group_by="ticker", threads=True, progress=False,
                           auto_adjust=False)
        # Whether the frame is per-ticker depends on the shape yfinance
        # returns, not on how many symbols were asked for: a one-symbol
        # download can still come back with MultiIndex columns, and then
        # `data` itself has no "Close" to read.
        cols = getattr(data, "columns", None)
        top = set(cols.levels[0]) if isinstance(cols, pd.MultiIndex) else set()
        for s in symbols:
            try:
                df = data[s + ".NS"] if (s + ".NS") in top else data
                entry = _quote_from_frame(df)
            except Exception:
                entry = None
            entry = _freshest(entry, _settled_quote(s))
            if entry:
                out[s] = entry
    except Exception as e:
        log.debug("YF batch failed: %s", e)
        # A dead Yahoo is not a dead quote: the exchange's own settled close is
        # already in memory for every symbol that traded.
        for s in symbols:
            entry = _settled_quote(s)
            if entry:
                out[s] = entry
    return out


@app.route("/ltp")
def ltp():
    raw = request.args.get("symbols", "").strip().upper()
    if not raw:
        return jsonify({"error": "No symbols"}), 400
    symbols = [s.strip() for s in raw.split(",") if s.strip()][:100]
    out = {}
    now = time.time()

    # Skip symbols that aren't NSE-listed without touching the network — graph
    # nodes include foreign names (MICROSOFT, ARAMCO, …) that would otherwise
    # each burn a slow NSE+YF failure and time the whole batch out. Soft check:
    # only applied once the universe cache is warm.
    known = {u["symbol"] for u in (_universe_cache or [])}
    pending = []
    for sym in symbols:
        if known and sym not in known and sym not in SYMBOL_ALIASES:
            out[sym] = {"error": "not NSE-listed", "source": "skip"}
        elif sym in _LTP_CACHE and now - _LTP_CACHE[sym][0] < _LTP_TTL:
            out[sym] = _LTP_CACHE[sym][1]
        else:
            pending.append(sym)

    # 1) One batched Yahoo call covers most of the list quickly. Aliased
    #    symbols (e.g. TATAMOTORS → TMPV/TMCV) need the full resolver instead.
    batchable = [s for s in pending if s not in SYMBOL_ALIASES]
    for s, entry in _yf_batch(batchable).items():
        _LTP_CACHE[s] = (now, entry)
        out[s] = entry

    def _resolve(sym):
        res = {}
        resolved = SYMBOL_ALIASES.get(sym)
        if resolved and resolved != [sym]:
            for cur in resolved:
                if cur == sym:
                    continue
                sub = {}
                _fetch_one(cur, sub)   # fetch the actual symbol (one level)
                entry = sub.get(cur)
                if entry and entry.get("price"):
                    entry["alias_of"] = sym
                    res[sym] = entry
                    return res
        _fetch_one(sym, res)
        return res

    # 2) NSE → YF per-symbol only for aliases and batch misses, concurrently.
    rest = [s for s in pending if s not in out]
    if rest:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as pool:
            for res in pool.map(_resolve, rest):
                for s, entry in res.items():
                    if entry and entry.get("price"):
                        _LTP_CACHE[s] = (now, entry)
                    out[s] = entry

    return jsonify(out)


NSE_INDEX_MAP = {
    "NIFTY 50": "NIFTY 50", "NIFTY 100": "NIFTY 100",
    "NIFTY 200": "NIFTY 200", "NIFTY 500": "NIFTY 500",
    "NIFTY BANK": "NIFTY BANK", "NIFTY IT": "NIFTY IT",
    "NIFTY MIDCAP 100": "NIFTY MIDCAP 100", "NIFTY MIDCAP 150": "NIFTY MIDCAP 150",
    "NIFTY SMALLCAP 100": "NIFTY SMALLCAP 100", "NIFTY SMALLCAP 250": "NIFTY SMALLCAP 250",
    "NIFTY MICROCAP 250": "NIFTY MICROCAP 250", "NIFTY AUTO": "NIFTY AUTO",
    "NIFTY PHARMA": "NIFTY PHARMA", "NIFTY FMCG": "NIFTY FMCG",
    "NIFTY METAL": "NIFTY METAL",
}


# niftyindices.com publishes official constituent CSVs (Symbol column). It is
# a separate host from nseindia.com and far less aggressive about blocking
# datacenter IPs — NSE Direct routinely 401/403s cloud VMs, which used to make
# /index 502 and blank the screener.
NIFTYINDICES_CSV = {
    "NIFTY 50": "ind_nifty50list.csv",
    "NIFTY 100": "ind_nifty100list.csv",
    "NIFTY 200": "ind_nifty200list.csv",
    "NIFTY 500": "ind_nifty500list.csv",
    "NIFTY BANK": "ind_niftybanklist.csv",
    "NIFTY IT": "ind_niftyitlist.csv",
    "NIFTY MIDCAP 100": "ind_niftymidcap100list.csv",
    "NIFTY MIDCAP 150": "ind_niftymidcap150list.csv",
    "NIFTY SMALLCAP 100": "ind_niftysmallcap100list.csv",
    "NIFTY SMALLCAP 250": "ind_niftysmallcap250list.csv",
    "NIFTY MICROCAP 250": "ind_niftymicrocap250_list.csv",
    "NIFTY AUTO": "ind_niftyautolist.csv",
    "NIFTY PHARMA": "ind_niftypharmalist.csv",
    "NIFTY FMCG": "ind_niftyfmcglist.csv",
    "NIFTY METAL": "ind_niftymetallist.csv",
}

_INDEX_CACHE_FILE = os.path.join(_BASE_DIR, "index_cache.json")
_INDEX_MEM = {}          # name -> (ts, rows, source)
# How long a memoised constituent list stays good, BY SOURCE. A live NSE row
# carries quotes, so it has to expire quickly. The niftyindices CSV and the
# static Sensex list carry no quotes at all — they are membership lists that
# change about twice a year — yet they were being re-fetched every 60 seconds,
# and each miss first spent several seconds on the NSE endpoint that is blocked
# from cloud IPs anyway. That recurring stall was most of the screener's
# perceived latency. Prices no longer ride on this cache at all (they come from
# the bhavcopy backfill), so the quoteless sources can be held far longer.
_INDEX_MEM_TTL = 60
_INDEX_MEM_TTL_STATIC = 30 * 60


def _index_mem_ttl(source):
    return _INDEX_MEM_TTL if source == "nse" else _INDEX_MEM_TTL_STATIC


# NSE Direct returns 404/403 to cloud IPs for the whole equity-stockIndices
# endpoint, not per index. Once it has failed, stop paying its timeout on every
# index in the union — sixteen of those in parallel is what made a first load
# take the better part of a minute.
_NSE_IDX_DOWN_UNTIL = 0.0
_NSE_IDX_COOLOFF = 10 * 60


def _index_cache_write(name, rows, source):
    _INDEX_MEM[name] = (time.time(), rows, source)
    try:
        disk = {}
        if os.path.exists(_INDEX_CACHE_FILE):
            with open(_INDEX_CACHE_FILE) as f:
                disk = json.load(f)
        disk[name] = {"rows": rows, "source": source, "ts": time.time()}
        with open(_INDEX_CACHE_FILE, "w") as f:
            json.dump(disk, f)
    except Exception as e:
        log.warning("index cache write failed: %s", e)


def _index_cache_read(name):
    try:
        if os.path.exists(_INDEX_CACHE_FILE):
            with open(_INDEX_CACHE_FILE) as f:
                entry = json.load(f).get(name)
            if entry and entry.get("rows"):
                return entry["rows"], entry.get("source", "cache")
    except Exception:
        pass
    return None, None


def _fetch_niftyindices_csv(name):
    """Constituent symbols from niftyindices.com (no live quotes)."""
    fname = NIFTYINDICES_CSV.get(name)
    if not fname:
        return None
    url = f"https://niftyindices.com/IndexConstituent/{fname}"
    r = requests.get(url, headers={"User-Agent": HEADERS["User-Agent"],
                                   "Referer": "https://niftyindices.com/"}, timeout=15)
    r.raise_for_status()
    rows = []
    reader = csv.DictReader(io.StringIO(r.text))
    for rec in reader:
        sym = (rec.get("Symbol") or rec.get("symbol") or "").strip().upper()
        if sym:
            rows.append({"symbol": sym, "price": None, "prevClose": None, "chg": None,
                         "absChg": None, "open": None, "high": None, "low": None,
                         "volume": None})
    return rows or None


# Custom constituent groups beyond NSE's official indices. BSE SENSEX is the
# official 30 (all NSE-listed; static seed, refreshed with the codebase — the
# basket changes ~twice a year). SME EMERGE and RECENT IPOS are derived from
# feeds the app already pulls (bhavcopy series / the universe sweep's Yahoo
# metadata) — no new scraping.
SENSEX_30 = [
    "RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "BHARTIARTL", "TCS", "ITC",
    "LT", "KOTAKBANK", "SBIN", "AXISBANK", "HINDUNILVR", "BAJFINANCE",
    "MARUTI", "M&M", "SUNPHARMA", "NTPC", "HCLTECH", "ULTRACEMCO", "TITAN",
    "POWERGRID", "TATASTEEL", "TATAMOTORS", "ASIANPAINT", "ADANIPORTS",
    "BAJAJFINSV", "NESTLEIND", "JSWSTEEL", "INDUSINDBK", "TECHM",
]
CUSTOM_GROUPS = ("BSE SENSEX", "SME EMERGE", "RECENT IPOS")


# NSE master lists (main board EQUITY_L + EMERGE SME_EQUITY_L) parsed into
# SYMBOL -> {name, listed_ts}. Both carry the official DATE OF LISTING, which
# makes RECENT IPOS exact and instant — no waiting on the universe sweep.
_MASTER_TTL = 6 * 3600
_master_cache: dict = {}   # path -> (fetched_at, {sym: {...}})


def _parse_listing_date(s):
    s = (s or "").strip()
    for fmt in ("%d-%b-%Y", "%d-%b-%y"):
        try:
            return int(datetime.datetime.strptime(s, fmt).timestamp())
        except ValueError:
            continue
    return None


def _master_list(path):
    """SYMBOL -> {name, listed_ts} from an NSE master-list CSV (cached; serves
    the last-good copy on fetch failure). Column names differ between the main
    board (\"NAME OF COMPANY\") and SME (\"NAME_OF_COMPANY\") files, so match
    on normalized headers."""
    ts, data = _master_cache.get(path, (0.0, {}))
    if data and (time.time() - ts) < _MASTER_TTL:
        return data
    try:
        s = nse_session()
        r = s.get(NSE_ARCHIVE + path, timeout=20)
        # The archive answers some bad paths with a tiny 200 stub — demand a
        # real CSV header before trusting it.
        if r.status_code != 200 or "SYMBOL" not in r.text[:300].upper():
            return data
        reader = csv.DictReader(io.StringIO(r.text))
        norm = {(k or "").strip().upper().replace("_", " "): k for k in (reader.fieldnames or [])}
        sym_k = norm.get("SYMBOL")
        name_k = next((v for n, v in norm.items() if "NAME" in n and "COMPANY" in n), None)
        date_k = next((v for n, v in norm.items() if "DATE" in n and "LISTING" in n), None)
        if not sym_k:
            return data
        out = {}
        for row in reader:
            sym = (row.get(sym_k) or "").strip()
            if not sym:
                continue
            out[sym] = {
                "name": ((row.get(name_k) or "").strip() or None) if name_k else None,
                "listed_ts": _parse_listing_date(row.get(date_k)) if date_k else None,
            }
        if out:
            _master_cache[path] = (time.time(), out)
            log.info("Master list %s: %d symbols", path, len(out))
            return out
    except Exception as e:
        log.warning("Master list %s failed: %s", path, e)
    return data


def _sme_master():
    return _master_list("/emerge/corporates/content/SME_EQUITY_L.csv")


def _main_master():
    return _master_list("/content/equities/EQUITY_L.csv")


def _custom_group_rows(name):
    """Rows for the custom groups; (rows, source) or (None, None)."""
    if name == "BSE SENSEX":
        return [{"symbol": s} for s in SENSEX_30], "static"
    if name == "SME EMERGE":
        if not _SME_LIST:
            get_universe_nonblocking()  # warms the bhavcopy → fills _SME_LIST
        master = _sme_master()
        if _SME_LIST:
            rows = [dict(r, name=(master.get(r["symbol"]) or {}).get("name"))
                    for r in _SME_LIST]
        else:
            # Bhavcopy still warming — serve the master list itself (symbols +
            # names; /scan backfills quotes) instead of an empty screen.
            rows = [{"symbol": sym, "name": m.get("name")} for sym, m in master.items()]
        return rows, ("bhavcopy" if _SME_LIST else "master" if rows else "warming")
    if name == "RECENT IPOS":
        # Official listing dates from BOTH NSE master lists (main board +
        # EMERGE): exact, instant, and each stock ages out one year after its
        # first trading day. Prices come from feeds we already hold.
        import mb_screen as mbs
        now = time.time()
        sweep = {r["symbol"]: r for r in mbs.recent_ipos()}
        sme_px = {r["symbol"]: r for r in _SME_LIST}
        rows = []
        for master in (_main_master(), _sme_master()):
            for sym, m in master.items():
                lts = m.get("listed_ts")
                if lts and (now - lts) <= 365 * 86400:
                    extra = sweep.get(sym) or sme_px.get(sym) or {}
                    rows.append({"symbol": sym,
                                 "name": m.get("name") or extra.get("name"),
                                 "listed_ts": lts,
                                 "price": extra.get("price"),
                                 "chg": extra.get("chg")})
        seen = set()
        uniq = []
        for r in sorted(rows, key=lambda x: -(x.get("listed_ts") or 0)):
            if r["symbol"] not in seen:
                seen.add(r["symbol"])
                uniq.append(r)
        return uniq, ("master" if uniq else "pending")
    return None, None


# ── Quote backfill from the bhavcopy universe ────────────────────────────────
# Only ONE of the three constituent sources carries prices: NSE Direct. That
# endpoint is routinely blocked from cloud IPs, so in production every index
# fell through to the constituent CSV — symbols and nothing else — and the
# screener painted a full table of em-dashes until /scan had walked all 1447
# names one upstream history call at a time (i.e. never, in practice).
#
# The universe cache already holds a full OHLCV row for the entire NSE, pulled
# once every six hours from the daily bhavcopy. Backfilling from it costs zero
# network and turns "nothing" into "yesterday's close, clearly labelled" — a
# real number the user can screen on while the live technicals arrive behind it.
_QUOTE_IDX = {"ts": 0.0, "map": {}}
_QUOTE_FIELDS = ("price", "prevClose", "chg", "absChg", "open", "high", "low",
                 "volume", "turnover")


def _quote_index():
    """symbol -> bhavcopy quote, rebuilt only when the universe cache turns over."""
    with _universe_lock:
        cache, ts = _universe_cache, _universe_ts
    if not cache:
        return {}
    if _QUOTE_IDX["ts"] == ts and _QUOTE_IDX["map"]:
        return _QUOTE_IDX["map"]
    m = {}
    for row in cache:
        sym = row.get("symbol")
        if not sym:
            continue
        # `is not None`, not truthiness: a stock that closed exactly flat has a
        # chg of 0.0, and dropping it would render an em-dash for a number we
        # actually know. Only the price itself must be non-zero — a zero close
        # means the scrip didn't trade, which is an absence, not a quote.
        if not row.get("price"):
            continue
        m[sym] = {k: row[k] for k in _QUOTE_FIELDS if row.get(k) is not None}
    _QUOTE_IDX["ts"], _QUOTE_IDX["map"] = ts, m
    return m


def _enrich_quotes(rows):
    """Fill missing price fields on constituent rows from the bhavcopy.

    Returns (rows, filled) — a NEW list, and how many rows gained a price they
    didn't have. Never overwrites a value the source already supplied: a live
    NSE quote always beats a settled close. The copy matters — `rows` may be
    the memoised/disk-cached constituent list, and writing settled closes into
    it would make them indistinguishable from live quotes on the next request.
    """
    if not rows:
        return rows, 0
    quotes = _quote_index()
    if not quotes:
        _warm_universe_async()      # cold cache — fill in on a later request
        return rows, 0
    out, filled = [], 0
    for r in rows:
        q = quotes.get(r.get("symbol"))
        if not q:
            out.append(r)
            continue
        merged = dict(r)
        for k, v in q.items():
            if merged.get(k) is None:
                merged[k] = v
        if r.get("price") is None and merged.get("price") is not None:
            filled += 1
        out.append(merged)
    return out, filled


def _get_constituents(name):
    """(rows, source) for an index — NSE live (carries pChange) → niftyindices
    CSV (symbols only) → last-good disk cache. (None, None) if all fail.
    Memoized in _INDEX_MEM for _INDEX_MEM_TTL."""
    if name in CUSTOM_GROUPS:
        return _custom_group_rows(name)
    key = NSE_INDEX_MAP.get(name)
    if not key:
        return None, None

    global _NSE_IDX_DOWN_UNTIL
    now = time.time()
    hit = _INDEX_MEM.get(name)
    if hit and (now - hit[0]) < _index_mem_ttl(hit[2]):
        return hit[1], hit[2]

    # 1) NSE Direct — live quotes (often blocked from cloud IPs)
    if now >= _NSE_IDX_DOWN_UNTIL:
        try:
            data = nse_get("/api/equity-stockIndices", params={"index": key})
            rows = []
            for item in data.get("data", []):
                sym = item.get("symbol")
                if not sym or sym == key:
                    continue
                rows.append({
                    "symbol":    sym,
                    "price":     item.get("lastPrice"),
                    "prevClose": item.get("previousClose"),
                    "chg":       item.get("pChange"),
                    "absChg":    item.get("change"),
                    "open":      item.get("open"),
                    "high":      item.get("dayHigh"),
                    "low":       item.get("dayLow"),
                    "volume":    item.get("totalTradedVolume"),
                })
            if rows:
                _index_cache_write(name, rows, "nse")
                return rows, "nse"
        except Exception as e:
            # The endpoint is blocked wholesale, not per index — sit out the
            # cool-off rather than timing out once per index in the union.
            _NSE_IDX_DOWN_UNTIL = time.time() + _NSE_IDX_COOLOFF
            log.warning("NSE index fetch failed for %s (cooling off %ds): %s",
                        name, _NSE_IDX_COOLOFF, e)

    # 2) niftyindices.com constituent CSV — symbols only; the frontend backfills
    #    prices and technicals from /scan, so the screener stays fully live.
    try:
        rows = _fetch_niftyindices_csv(name)
        if rows:
            _index_cache_write(name, rows, "niftyindices-csv")
            return rows, "niftyindices-csv"
    except Exception as e:
        log.warning("niftyindices CSV fetch failed for %s: %s", name, e)

    # 3) last-good disk cache (survives restarts)
    rows, source = _index_cache_read(name)
    if rows:
        return rows, f"stale-{source}"
    return None, None


@app.route("/index")
def index_constituents():
    name = request.args.get("name", "").strip().upper()
    if name not in NSE_INDEX_MAP and name not in CUSTOM_GROUPS:
        return jsonify({"error": f"Unknown index '{name}'",
                        "available": list(NSE_INDEX_MAP) + list(CUSTOM_GROUPS)}), 400
    rows, source = _get_constituents(name)
    if rows:
        rows, filled = _enrich_quotes(rows)
        priced = sum(1 for r in rows if r.get("price") is not None)
        # quote_source tells the client how much to trust these prices: "nse"
        # is live and must survive the /scan merge; "bhavcopy" is the previous
        # settled close and should yield to the first technical row that lands.
        # It keys off where the constituents CAME from, not off how many rows
        # the backfill touched — the SME group is already bhavcopy-derived, so
        # counting fills would have labelled a settled close as live.
        live = (source == "nse")
        quote_source = ("none" if not priced
                        else "mixed" if live and filled
                        else "nse" if live
                        else "bhavcopy")
        return jsonify({"index": name, "count": len(rows), "data": rows,
                        "source": source, "quote_source": quote_source,
                        "quote_date": None if quote_source == "nse" else (_BHAV_DATE or None),
                        "priced": priced})
    if name in CUSTOM_GROUPS:
        # Not failure — the group simply hasn't been derived yet (bhavcopy
        # still warming / universe sweep hasn't recorded listing dates).
        note = ("SME list warms with the daily bhavcopy — retry in a minute."
                if name == "SME EMERGE" else
                "Recent-IPO list builds during the universe sweep — check back after the next refresh.")
        return jsonify({"index": name, "count": 0, "data": [], "source": source, "note": note})
    return jsonify({"error": f"All constituent sources failed for {name}", "data": []}), 502


_movers_cache = {}       # index -> (ts, payload)
_MOVERS_TTL = 180


def _rows_with_chg(name, cap=180):
    """Constituent rows carrying a live `chg`. Uses the NSE feed's pChange when
    available; otherwise batch-quotes the symbols via Yahoo in one call (bounded
    to `cap` to keep latency sane)."""
    rows, _src = _get_constituents(name)
    if not rows:
        return []
    live = [r for r in rows if r.get("chg") is not None]
    # An index whose every constituent is EXACTLY unchanged is not a session,
    # it is a feed serving placeholder zeros — which is what a weekend request
    # to the NSE endpoint returns. Fall through to the quote backfill, which
    # reads the last bar that actually traded.
    if live and any(r["chg"] != 0 for r in live):
        return rows
    # Clear the placeholder zeros before backfilling. The backfill is capped,
    # so anything past the cap would otherwise keep its 0.00 and be counted as
    # a genuine unchanged print — 320 fake flats in a 500-name breadth. A row
    # nobody could quote is a gap, and _movers_build drops gaps.
    for r in rows:
        r["chg"] = None
    # CSV fallback gave symbols only — backfill quotes in one batched call so
    # breadth/movers still work when NSE has blocked the VM.
    syms = [r["symbol"] for r in rows][:cap]
    q = _yf_batch(syms)
    for r in rows:
        e = q.get(r["symbol"])
        if e:
            for k in ("price", "prevClose", "chg", "absChg", "open", "high",
                      "low", "volume", "session"):
                r[k] = e.get(k)
    return rows


def _movers_aggregate(name, rows, top, partial=False):
    """Breadth + top movers payload from constituent rows carrying `chg`."""
    now = time.time()
    # Which session these numbers belong to. Taken from the rows themselves
    # where the quote backfill recorded it, so the card can say "Friday" over
    # a weekend instead of implying the move happened today.
    stamps = [r.get("session") for r in rows if r.get("session")]
    session = max(set(stamps), key=stamps.count) if stamps else _holidays.last_session()
    up = sum(1 for r in rows if r["chg"] > 0)
    down = sum(1 for r in rows if r["chg"] < 0)
    flat = len(rows) - up - down
    liq = [r for r in rows if (r.get("volume") is None or (r.get("volume") or 0) > 10000)]
    srt = sorted(liq, key=lambda r: r["chg"], reverse=True)
    payload = {
        "index": name,
        "breadth": {"up": up, "down": down, "flat": flat, "total": len(rows),
                    "ratio": round(up / down, 2) if down else float(up)},
        "gainers": srt[:top],
        "losers": list(reversed(srt[-top:])) if len(srt) >= top else list(reversed(srt)),
        "asof": int(now),
        "session": session,
    }
    if partial:
        payload["partial"] = True
    return payload


def _movers_build(name, top):
    """The slow full build (may block minutes against a rate-limited feed —
    only ever runs on the background thread)."""
    rows = [r for r in _rows_with_chg(name) if r.get("chg") is not None]
    if not rows:
        return None
    return _movers_aggregate(name, rows, top)


_movers_refreshing = {}


def _movers_refresh_bg(name, top):
    """Single-flight background rebuild; persists the result so it survives
    restarts (deploys previously wiped the only copy)."""
    if _movers_refreshing.get(name):
        return

    _movers_refreshing[name] = True

    def work():
        try:
            p = _movers_build(name, top)
            if p:
                _movers_cache[name] = (time.time(), p)
                try:
                    _store.kv_set("movers." + name, p)
                except Exception:
                    pass
        except Exception as e:
            log.debug("movers bg rebuild failed for %s: %s", name, e)
        finally:
            _movers_refreshing[name] = False

    threading.Thread(target=work, daemon=True).start()


def _movers_from_scan_cache(name, top):
    """Instant degraded answer from the warm scanner cache (no network):
    whatever symbols the scan loop already holds fresh rows for. Marked
    partial — better an honest subset now than a spinner forever."""
    import scanner as _sc
    now = time.time()
    rows = []
    try:
        with _sc._CACHE_LOCK:
            for sym, (ts, row) in _sc._CACHE.items():
                if row and row.get("chg") is not None and now - ts < 1800:
                    rows.append({"symbol": sym, "price": row.get("price"),
                                 "chg": row.get("chg"), "volume": row.get("volume")})
    except Exception:
        return None
    if len(rows) < 20:
        return None
    return _movers_aggregate(name, rows, top, partial=True)


@app.route("/movers")
def movers():
    """Advance/decline breadth + top gainers/losers for an index.

    NEVER blocks on upstream work: the full NIFTY-500 rebuild can take minutes
    against a rate-limited feed while the client aborts at 25 s — which showed
    as the breadth cards spinning forever. Order of service: fresh memory
    cache -> last-good (memory, then disk — marked stale) with a background
    single-flight rebuild -> an instant partial answer from the warm scanner
    cache -> 503 'warming' (the client shows a retrying state and the
    background build lands within a couple of minutes)."""
    name = request.args.get("index", "NIFTY 50").strip().upper()
    try:
        top = min(max(int(request.args.get("n", 6) or 6), 1), 15)
    except Exception:
        top = 6
    if name not in NSE_INDEX_MAP:
        return jsonify({"error": f"Unknown index '{name}'"}), 400

    now = time.time()
    hit = _movers_cache.get(name)
    if hit and now - hit[0] < _MOVERS_TTL:
        return jsonify(hit[1])
    if hit:
        _movers_refresh_bg(name, top)
        stale = dict(hit[1])
        stale["stale"] = True
        return jsonify(stale)
    saved = None
    try:
        saved = _store.kv_get("movers." + name)
    except Exception:
        pass
    if saved:
        _movers_refresh_bg(name, top)
        saved = dict(saved)
        saved["stale"] = True
        return jsonify(saved)
    _movers_refresh_bg(name, top)
    fb = _movers_from_scan_cache(name, top)
    if fb:
        return jsonify(fb)
    return jsonify({"index": name, "breadth": None, "gainers": [], "losers": [],
                    "error": "movers warming — retry shortly"}), 503


@app.route("/universe")
def universe():
    items = get_universe()
    # Quotes ride along: the master list is already a full bhavcopy row, and a
    # client that has it can paint a price for any symbol it holds — a search
    # result, a watchlist, a screen whose index feed came back bare — without
    # another request. Three extra numbers per symbol, on a payload the client
    # caches for half an hour.
    return jsonify({
        "ready":   bool(items),
        "total":   len(items),
        "nse":     len(items),
        "bse":     0,
        "as_of":   _BHAV_DATE or None,
        "symbols": [{"symbol": x["symbol"], "name": x.get("name") or x["symbol"],
                     "exchange": x["exchange"], "price": x.get("price") or None,
                     "chg": x.get("chg"), "volume": x.get("volume")}
                    for x in items],
    })


def _period_to_bars(period, interval):
    """Convert a period string + interval string to number of tvDatafeed bars."""
    trading_days = {
        '1d': 1, '5d': 5, '1mo': 21, '3mo': 63,
        '6mo': 126, '1y': 252, '2y': 504, '5y': 1260, 'max': 3000,
    }
    bars_per_day = {
        '1m': 375, '5m': 75, '15m': 25, '30m': 12,
        '1h': 7, '2h': 4, '4h': 2,
        '1d': 1, '1wk': 0.2, '1mo': 0.05,
    }
    days = trading_days.get(period, 252)
    bpd  = bars_per_day.get(interval, 1)
    return max(200, int(days * bpd * 1.15))  # 15 % buffer


def _fetch_tv_data(sym, interval, period):
    """Fetch OHLCV from TradingView via tvDatafeed."""
    try:
        from tvDatafeed import TvDatafeed, Interval as TvInterval
        iv_map = {
            '1d': TvInterval.in_daily, '1h': TvInterval.in_1_hour,
            '15m': TvInterval.in_15_minute, '5m': TvInterval.in_5_minute,
            '1wk': TvInterval.in_weekly, '1mo': TvInterval.in_monthly,
        }
        n_bars = _period_to_bars(period, interval)
        idx_map = {
            '^NSEI': ('NIFTY50', 'NSE'), '^BSESN': ('SENSEX', 'BSE'),
            '^NSEBANK': ('BANKNIFTY', 'NSE'), '^CNXMC': ('CNXMIDCAP', 'NSE'),
            '^CNXIT': ('CNXINFOTECHNOLOGY', 'NSE'), '^CNXPHARMA': ('CNXPHARMA', 'NSE'),
            '^CNXFMCG': ('CNXFMCG', 'NSE'), '^CNXAUTO': ('CNXAUTO', 'NSE'),
        }
        if sym.startswith('^'):
            tv_sym, exchange = idx_map.get(sym, ('NIFTY50', 'NSE'))
        else:
            tv_sym = sym.replace('.NS', '')
            exchange = 'NSE'
        tv = TvDatafeed()
        df = tv.get_hist(symbol=tv_sym, exchange=exchange,
                         interval=iv_map.get(interval, TvInterval.in_daily),
                         n_bars=n_bars)
        if df is not None and not df.empty:
            df.columns = [c.capitalize() for c in df.columns]
            df.index = pd.to_datetime(df.index)
        return df
    except Exception as e:
        log.warning(f"tvDatafeed fallback failed for {sym}: {e}")
        return None


# Price-history cache. Serving a recent payload straight from memory means a
# burst of chart opens (or a heavy scan) doesn't re-hammer yfinance, and —
# crucially — if the upstream feed rate-limits, we fall back to the last-good
# candles (flagged `stale`) instead of a broken "chart unavailable".
_history_cache = {}          # (sym, period, interval) -> (fetched_at, payload)
_history_lock = threading.Lock()


def _history_ttl(interval):
    if interval in ('1m', '5m', '15m'):
        return 120          # intraday moves fast
    if interval == '1h':
        return 300
    return 600              # daily+ changes slowly within a session


@app.route("/history")
def history():
    sym      = request.args.get("symbol", "").strip().upper()
    period   = request.args.get("period",   "1y")   # 1d 5d 1mo 3mo 6mo 1y 2y 5y
    interval = request.args.get("interval", "1d")   # 1m 5m 15m 1h 1d 1wk 1mo
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    key = (sym, period, interval)
    now = time.time()
    with _history_lock:
        hit = _history_cache.get(key)
    if hit and now - hit[0] < _history_ttl(interval):
        return jsonify(hit[1])
    try:
        import yfinance as yf
        # 4h isn't a Yahoo interval — fetch 1h (up to its 730-day cap) and
        # resample to 4-hour session bars below.
        fetch_interval = '1h' if interval == '4h' else interval
        # For intraday ≤15m yfinance caps at 60 days — prefer tvDatafeed for longer history
        yf_limited = fetch_interval in ('1m', '5m', '15m')
        df = None

        if yf_limited:
            df = _fetch_tv_data(sym, fetch_interval, period)

        if df is None or df.empty:
            # yfinance caps: 5m/15m → 60d, 1h → 730d; cap period to avoid empty response
            yf_period_cap = {'1m': '7d', '5m': '60d', '15m': '60d', '1h': '2y'}
            yf_period = yf_period_cap.get(fetch_interval, period)
            # Index names ("NIFTY 50", "SENSEX") chart their Yahoo index ticker.
            mapped = INDEX_YF.get(sym, sym)
            yf_sym = mapped if mapped.startswith('^') else f"{mapped}.NS"
            ticker = yf.Ticker(yf_sym)
            for attempt in range(3):
                df = ticker.history(period=yf_period, interval=fetch_interval, auto_adjust=True)
                if not df.empty:
                    break
                if attempt < 2:
                    time.sleep(1.5 ** attempt)
                    ticker = yf.Ticker(yf_sym)

        if (df is None or df.empty) and not yf_limited:
            df = _fetch_tv_data(sym, fetch_interval, period)

        if interval == '4h' and df is not None and not df.empty:
            df.index = pd.to_datetime(df.index)
            df = df.resample('4h', origin='start_day').agg(
                {"Open": "first", "High": "max", "Low": "min",
                 "Close": "last", "Volume": "sum"}).dropna(subset=["Open", "Close"])

        if df is None or df.empty:
            # Upstream returned nothing (often a transient rate-limit) — serve the
            # last-good candles if we have them rather than a blank chart.
            with _history_lock:
                hit = _history_cache.get(key)
            if hit:
                stale = dict(hit[1]); stale["stale"] = True
                return jsonify(stale)
            return jsonify({"error": f"No data for {sym}", "candles": []}), 404

        df.index = pd.to_datetime(df.index)

        # Add TA indicators
        import ta as ta_lib
        close = df["Close"]
        df["ema9"]   = ta_lib.trend.ema_indicator(close, window=9)
        df["ema20"]  = ta_lib.trend.ema_indicator(close, window=20)
        df["ema50"]  = ta_lib.trend.ema_indicator(close, window=50)
        df["ema200"] = ta_lib.trend.ema_indicator(close, window=200)
        df["rsi"]    = ta_lib.momentum.rsi(close, window=14)
        macd_obj     = ta_lib.trend.MACD(close)
        df["macd"]   = macd_obj.macd()
        df["macd_signal"] = macd_obj.macd_signal()
        df["macd_hist"]   = macd_obj.macd_diff()
        bb = ta_lib.volatility.BollingerBands(close, window=20, window_dev=2)
        df["bb_upper"] = bb.bollinger_hband()
        df["bb_mid"]   = bb.bollinger_mavg()
        df["bb_lower"] = bb.bollinger_lband()

        def safe(v):
            if v is None or (isinstance(v, float) and math.isnan(v)):
                return None
            return round(float(v), 4)

        candles = []
        for ts, row in df.iterrows():
            candles.append({
                "t":    int(ts.timestamp()),
                "o":    safe(row["Open"]),
                "h":    safe(row["High"]),
                "l":    safe(row["Low"]),
                "c":    safe(row["Close"]),
                "v":    int(row["Volume"]) if not math.isnan(row["Volume"]) else 0,
                "ema9":  safe(row.get("ema9")),
                "ema20": safe(row.get("ema20")),
                "ema50": safe(row.get("ema50")),
                "ema200":safe(row.get("ema200")),
                "rsi":   safe(row.get("rsi")),
                "macd":  safe(row.get("macd")),
                "macd_signal": safe(row.get("macd_signal")),
                "macd_hist":   safe(row.get("macd_hist")),
                "bb_upper": safe(row.get("bb_upper")),
                "bb_mid":   safe(row.get("bb_mid")),
                "bb_lower": safe(row.get("bb_lower")),
            })

        payload = {
            "symbol":   sym,
            "period":   period,
            "interval": interval,
            "count":    len(candles),
            "candles":  candles,
        }
        with _history_lock:
            _history_cache[key] = (now, payload)
        return jsonify(payload)
    except Exception as e:
        log.error("History error for %s: %s", sym, e)
        # Rate-limited / network blip — serve last-good candles if cached.
        with _history_lock:
            hit = _history_cache.get(key)
        if hit:
            stale = dict(hit[1]); stale["stale"] = True
            return jsonify(stale)
        return jsonify({"error": str(e)}), 502


def _detect_patterns(df):
    """Detect candlestick and TA patterns. Returns list of {type, date, desc}."""
    patterns = []
    if len(df) < 3:
        return patterns

    o, h, l, c = df["Open"], df["High"], df["Low"], df["Close"]

    def body(i):   return abs(c.iloc[i] - o.iloc[i])
    def range_(i): return h.iloc[i] - l.iloc[i]
    def is_bull(i): return c.iloc[i] > o.iloc[i]
    def is_bear(i): return c.iloc[i] < o.iloc[i]
    def upper_wick(i): return h.iloc[i] - max(c.iloc[i], o.iloc[i])
    def lower_wick(i): return min(c.iloc[i], o.iloc[i]) - l.iloc[i]

    for i in range(2, len(df)):
        ts  = df.index[i].strftime("%Y-%m-%d")
        ts1 = df.index[i-1].strftime("%Y-%m-%d")

        # Doji
        if range_(i) > 0 and body(i) / range_(i) < 0.1:
            patterns.append({"type": "doji", "date": ts, "desc": "Doji — indecision", "bias": "neutral"})

        # Hammer (bullish reversal after downtrend)
        if (is_bull(i) and lower_wick(i) > 2 * body(i) and
                upper_wick(i) < 0.3 * body(i) and is_bear(i-1)):
            patterns.append({"type": "hammer", "date": ts, "desc": "Hammer — bullish reversal", "bias": "bullish"})

        # Shooting star (bearish reversal after uptrend)
        if (is_bear(i) and upper_wick(i) > 2 * body(i) and
                lower_wick(i) < 0.3 * body(i) and is_bull(i-1)):
            patterns.append({"type": "shooting_star", "date": ts, "desc": "Shooting Star — bearish reversal", "bias": "bearish"})

        # Bullish engulfing
        if (is_bull(i) and is_bear(i-1) and
                o.iloc[i] <= c.iloc[i-1] and c.iloc[i] >= o.iloc[i-1]):
            patterns.append({"type": "bullish_engulfing", "date": ts, "desc": "Bullish Engulfing", "bias": "bullish"})

        # Bearish engulfing
        if (is_bear(i) and is_bull(i-1) and
                o.iloc[i] >= c.iloc[i-1] and c.iloc[i] <= o.iloc[i-1]):
            patterns.append({"type": "bearish_engulfing", "date": ts, "desc": "Bearish Engulfing", "bias": "bearish"})

        # Morning star (3-candle bullish reversal)
        if i >= 2 and is_bear(i-2) and body(i-1) < 0.3 * body(i-2) and is_bull(i):
            patterns.append({"type": "morning_star", "date": ts, "desc": "Morning Star — bullish reversal", "bias": "bullish"})

        # Evening star (3-candle bearish reversal)
        if i >= 2 and is_bull(i-2) and body(i-1) < 0.3 * body(i-2) and is_bear(i):
            patterns.append({"type": "evening_star", "date": ts, "desc": "Evening Star — bearish reversal", "bias": "bearish"})

        # Three white soldiers
        if (i >= 2 and is_bull(i) and is_bull(i-1) and is_bull(i-2) and
                c.iloc[i] > c.iloc[i-1] > c.iloc[i-2]):
            patterns.append({"type": "three_white_soldiers", "date": ts, "desc": "Three White Soldiers — strong bullish", "bias": "bullish"})

        # Three black crows
        if (i >= 2 and is_bear(i) and is_bear(i-1) and is_bear(i-2) and
                c.iloc[i] < c.iloc[i-1] < c.iloc[i-2]):
            patterns.append({"type": "three_black_crows", "date": ts, "desc": "Three Black Crows — strong bearish", "bias": "bearish"})

    return patterns[-20:]  # last 20 patterns


@app.route("/patterns")
def patterns():
    sym    = request.args.get("symbol", "").strip().upper()
    period = request.args.get("period", "6mo")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    try:
        import ydata
        df = ydata.history(f"{sym}.NS", period, "1d")
        if df is None or df.empty:
            return jsonify({"symbol": sym, "patterns": []})

        found = _detect_patterns(df)

        # TA signal summary using ta library
        import ta as ta_lib
        close = df["Close"]
        rsi_val   = float(ta_lib.momentum.rsi(close, window=14).iloc[-1])
        macd_hist = float(ta_lib.trend.MACD(close).macd_diff().iloc[-1])
        ema20     = float(ta_lib.trend.ema_indicator(close, window=20).iloc[-1])
        ema50     = float(ta_lib.trend.ema_indicator(close, window=50).iloc[-1])
        price_now = float(close.iloc[-1])

        signals = []
        if rsi_val > 70:   signals.append({"name": "RSI Overbought", "bias": "bearish", "value": f"{rsi_val:.1f}"})
        elif rsi_val < 30: signals.append({"name": "RSI Oversold",   "bias": "bullish", "value": f"{rsi_val:.1f}"})
        else:              signals.append({"name": "RSI Neutral",    "bias": "neutral",  "value": f"{rsi_val:.1f}"})

        if macd_hist > 0:  signals.append({"name": "MACD Bullish",  "bias": "bullish", "value": f"{macd_hist:.2f}"})
        else:              signals.append({"name": "MACD Bearish",   "bias": "bearish", "value": f"{macd_hist:.2f}"})

        if price_now > ema20 > ema50: signals.append({"name": "Price > EMA20 > EMA50", "bias": "bullish", "value": ""})
        elif price_now < ema20 < ema50: signals.append({"name": "Price < EMA20 < EMA50", "bias": "bearish", "value": ""})

        # 52w high/low
        high52 = float(df["High"].max())
        low52  = float(df["Low"].min())
        pct_from_high = round((price_now - high52) / high52 * 100, 2)
        pct_from_low  = round((price_now - low52)  / low52  * 100, 2)

        return jsonify({
            "symbol":  sym,
            "patterns": found,
            "signals":  signals,
            "summary": {
                "rsi":           round(rsi_val, 1),
                "macd_hist":     round(macd_hist, 3),
                "price":         round(price_now, 2),
                "ema20":         round(ema20, 2),
                "ema50":         round(ema50, 2),
                "high52":        round(high52, 2),
                "low52":         round(low52, 2),
                "pct_from_high": pct_from_high,
                "pct_from_low":  pct_from_low,
            }
        })
    except Exception as e:
        log.error("Patterns error for %s: %s", sym, e)
        return jsonify({"error": str(e)}), 502


# OHLC cache for the analysis fan-out. /recommendation, /swing, /institutional,
# /smc and /chart-patterns each pull 1–2y of daily bars per symbol on every
# request, multiplied across the candidate list and concurrent with the
# screener scan — the biggest single amplifier of Yahoo rate-limits. Cache the
# parsed candles for a short window and, crucially, serve the last-good set when
# the upstream feed fails (usually a transient rate-limit) instead of erroring.
_ohlc_cache = {}          # (sym, period, interval) -> (fetched_at, candles)
_ohlc_lock = threading.Lock()


def _ohlc_ttl(interval):
    if interval in ('1m', '5m', '15m'):
        return 120
    if interval == '1h':
        return 300
    return 600            # daily+ changes slowly within a session


# The pattern scanner accepts index names too — "NIFTY 50", "BANKNIFTY" or
# "SENSEX" scan the index's own chart. Mapped to Yahoo index tickers (exact
# names only, so equities are never shadowed).
INDEX_YF = {
    "NIFTY": "^NSEI", "NIFTY 50": "^NSEI", "NIFTY50": "^NSEI",
    "NIFTY 100": "^CNX100", "NIFTY 200": "^CNX200", "NIFTY 500": "^CRSLDX",
    "NIFTY NEXT 50": "^NSMIDCP",
    "NIFTY BANK": "^NSEBANK", "BANKNIFTY": "^NSEBANK",
    "NIFTY IT": "^CNXIT", "NIFTY AUTO": "^CNXAUTO",
    "NIFTY PHARMA": "^CNXPHARMA", "NIFTY FMCG": "^CNXFMCG",
    "NIFTY METAL": "^CNXMETAL", "NIFTY ENERGY": "^CNXENERGY",
    "NIFTY REALTY": "^CNXREALTY",
    "NIFTY MIDCAP 100": "^CRSMID", "NIFTY MIDCAP 150": "^CRSMID",
    "NIFTY SMALLCAP 100": "^CNXSC",
    "SENSEX": "^BSESN", "BSE SENSEX": "^BSESN",
}


def _load_ohlc(sym, period, interval="1d"):
    """Resilient OHLC fetch (yfinance .NS → .BO, then tvDatafeed) for the
    chart-pattern scanner. Returns a chronological list of {t,o,h,l,c,v}.

    Cached with stale-on-error: routes through ydata (global limiter + 429
    backoff) and, if every source fails, returns the last-good candles rather
    than an empty list that would 404/503 the whole Analyse card."""
    import ydata
    sym = INDEX_YF.get(sym.strip().upper(), sym)
    key = (sym, period, interval)
    now = time.time()
    with _ohlc_lock:
        hit = _ohlc_cache.get(key)
    if hit and now - hit[0] < _ohlc_ttl(interval):
        return hit[1]

    df = None
    for suffix in (".NS", ".BO"):
        ysym = sym if sym.startswith("^") else f"{sym}{suffix}"
        df = ydata.history(ysym, period, interval)
        if df is not None and not df.empty:
            break
        if sym.startswith("^"):
            break
    if (df is None or df.empty):
        df = _fetch_tv_data(sym, interval, period)
    if df is None or df.empty:
        # Upstream returned nothing (often a transient rate-limit) — serve the
        # last-good candles if we have any rather than failing the card.
        return hit[1] if hit else []
    df.index = pd.to_datetime(df.index)
    out = []
    for ts, row in df.iterrows():
        try:
            o, h, l, c = (float(row["Open"]), float(row["High"]),
                          float(row["Low"]), float(row["Close"]))
            # Yahoo pads illiquid scrips (e.g. BSE Ltd on holidays) with NaN
            # rows; float(nan) does NOT raise, and a NaN that reaches jsonify
            # produces literal `NaN` — invalid JSON that kills the client.
            if any(math.isnan(x) or math.isinf(x) for x in (o, h, l, c)):
                continue
            out.append({
                "t": int(ts.timestamp()), "o": o, "h": h, "l": l, "c": c,
                "v": int(row["Volume"]) if not math.isnan(row["Volume"]) else 0,
            })
        except Exception:
            continue
    if out:
        with _ohlc_lock:
            _ohlc_cache[key] = (now, out)
    return out


def _nan_safe(obj):
    """Recursively replace NaN/Inf floats with None so jsonify never emits
    invalid JSON (Python's json module writes bare `NaN` by default)."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _nan_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_nan_safe(v) for v in obj]
    return obj


@app.route("/chart-patterns")
def chart_patterns():
    """Scan a symbol's price history for classic chart patterns (double tops,
    head-and-shoulders, triangles, wedges, flags, cup-and-handle, …) and report
    each with its span, confidence, continuation probability and measured move."""
    from patterns import detect_patterns as _detect_chart

    sym = request.args.get("symbol", "").strip().upper().replace(":", "")
    period = request.args.get("period", "2y")
    interval = request.args.get("interval", "1d")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    if period not in ("6mo", "1y", "2y", "5y", "max"):
        period = "2y"
    if interval not in ("1d", "1wk"):
        interval = "1d"
    try:
        candles = _load_ohlc(sym, period, interval)
        if not candles:
            return jsonify({"error": f"No price history for {sym}", "symbol": sym,
                            "patterns": [], "candles": []}), 404
        result = _detect_chart(candles)
        result["symbol"] = sym
        result["period"] = period
        result["interval"] = interval
        # Ship a trimmed candle series so the client can chart it without a
        # second round trip.
        result["candles"] = [{"t": c["t"], "o": c["o"], "h": c["h"],
                              "l": c["l"], "c": c["c"]} for c in candles]
        return jsonify(_nan_safe(result))
    except Exception as e:
        log.error("Chart-patterns error for %s: %s", sym, e)
        return jsonify({"error": str(e), "symbol": sym, "patterns": []}), 503


@app.route("/patterns/screen")
def patterns_screen():
    """Index-wide chart-pattern screener (background sweep; see
    pattern_screen.py). ?index=NIFTY 50 picks the universe, ?refresh=1 forces
    a re-sweep even when the cached one is still fresh. Hits stream into the
    snapshot LIVE while the sweep runs; filter by pattern type client-side."""
    import pattern_screen as ps
    from patterns import detect_patterns as _detect_chart

    name = request.args.get("index", "NIFTY 50").strip().upper()
    # Custom groups (BSE SENSEX / SME EMERGE / RECENT IPOS) are sweepable too —
    # _get_constituents resolves them the same way the equity screener does.
    if name not in NSE_INDEX_MAP and name not in CUSTOM_GROUPS:
        return jsonify({"error": f"Unknown index '{name}'",
                        "indices": sorted(list(NSE_INDEX_MAP) + list(CUSTOM_GROUPS))}), 400
    ps.ensure(name, _get_constituents, _load_ohlc, _detect_chart,
              force=request.args.get("refresh") == "1")
    return jsonify(_nan_safe(ps.snapshot(name)))


# ── Trade Scan: short-term pattern setups on the major indices ──────────────
# Sweeps each index across intraday/short timeframes, keeps the CURRENT
# pattern per (index, timeframe) and derives entry/target/stop/R:R via
# pattern_screen.trade_setup. Refreshed in a background thread, cached 10 min.
_TRADE_TFS = [
    ("15m", "60d", "15m · intraday"),
    ("1h", "1y", "1h · 1-5 days"),
    ("4h", "2y", "4h · 1-3 weeks"),
    ("1d", "2y", "1D · positional"),
]
_TRADE_INDICES = ["NIFTY 50", "NIFTY BANK", "BSE SENSEX", "NIFTY IT",
                  "NIFTY MIDCAP 100", "NIFTY SMALLCAP 100"]
_TRADE = {"ts": 0.0, "data": None, "running": False}
_TRADE_LOCK = threading.Lock()
_TRADE_TTL = 600


def _resample_4h(candles):
    """1h → 4h session bars (bucketed on the epoch 4-hour grid)."""
    out, order = {}, []
    for c in candles:
        b = c["t"] - (c["t"] % 14400)
        if b not in out:
            out[b] = {"t": b, "o": c["o"], "h": c["h"], "l": c["l"], "c": c["c"], "v": c["v"]}
            order.append(b)
        else:
            d = out[b]
            d["h"] = max(d["h"], c["h"])
            d["l"] = min(d["l"], c["l"])
            d["c"] = c["c"]
            d["v"] += c["v"]
    return [out[b] for b in order]


def _run_trade_scan():
    import pattern_screen as ps
    from patterns import detect_patterns as _detect
    rows = []
    for name in _TRADE_INDICES:
        for interval, period, tf_label in _TRADE_TFS:
            try:
                candles = _load_ohlc(name, period, "1h" if interval == "4h" else interval)
                if interval == "4h":
                    candles = _resample_4h(candles)
                if len(candles) < 60:
                    continue
                res = _detect(candles)
                cur = res.get("current")
                if not cur or (cur.get("confidence") or 0) < 55:
                    continue
                px = candles[-1]["c"]
                setup = ps.trade_setup(cur, px)
                if not setup:
                    continue
                rows.append({
                    "index": name, "tf": tf_label, "interval": interval,
                    "pattern": cur.get("label"), "bias": cur.get("bias"),
                    "status": cur.get("status"),
                    "confidence": cur.get("confidence"),
                    "continuation": cur.get("continuation"),
                    "expansion_pct": cur.get("expansion_pct"),
                    "active": bool(cur.get("active")),
                    "price": round(px, 2), **setup,
                })
            except Exception as e:
                log.warning("trade-scan %s %s failed: %s", name, interval, e)
    order = {iv: i for i, (iv, _p, _l) in enumerate(_TRADE_TFS)}
    rows.sort(key=lambda r: (order.get(r["interval"], 9), -(r["confidence"] or 0)))
    payload = _nan_safe({"status": "done", "results": rows,
                         "indices": _TRADE_INDICES, "asof": int(time.time())})
    with _TRADE_LOCK:
        _TRADE.update(ts=time.time(), data=payload, running=False)


@app.route("/patterns/trade-scan")
def patterns_trade_scan():
    """Short-term chart-pattern setups on the major indices, per timeframe,
    each with entry / target / stop-loss / R:R plus probability and
    continuation odds. ?refresh=1 forces a fresh sweep."""
    force = request.args.get("refresh") == "1"
    now = time.time()
    with _TRADE_LOCK:
        data = _TRADE["data"]
        fresh = data is not None and now - _TRADE["ts"] < _TRADE_TTL and not force
        if not fresh and not _TRADE["running"]:
            _TRADE["running"] = True
            threading.Thread(target=_run_trade_scan, daemon=True).start()
        running = _TRADE["running"]
    if data is not None:
        out = dict(data)
        out["refreshing"] = running
        return jsonify(out)
    return jsonify({"status": "running", "refreshing": True, "results": [],
                    "indices": _TRADE_INDICES})


@app.route("/backtest/strategies")
def backtest_strategies():
    """Strategy library for the backtester: key, label, editable params, blurb."""
    import backtest_engine as bte
    return jsonify({"strategies": bte.strategies_meta(),
                    "default_costs": bte.DEFAULT_COSTS,
                    "max_symbols": bte.MAX_SYMBOLS})


@app.route("/backtest/run", methods=["POST"])
def backtest_run():
    """Launch a portfolio backtest as a background job (see backtest_engine.py).
    Body = the full run config (universe, strategy, sizing, costs, risk).
    Returns {run_id}; poll /backtest/status?id=<run_id> for progress + result."""
    import backtest_engine as bte
    cfg = request.get_json(silent=True) or {}
    if cfg.get("index") and cfg["index"].strip().upper() not in NSE_INDEX_MAP:
        return jsonify({"error": f"Unknown index '{cfg['index']}'"}), 400
    run_id, err = bte.start(cfg, _get_constituents, _load_ohlc)
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"run_id": run_id})


@app.route("/backtest/status")
def backtest_status():
    """Snapshot of a backtest job: status, live progress and (when done) the
    full result — stats, equity/benchmark/drawdown curves and the trade log."""
    import backtest_engine as bte
    run_id = request.args.get("id", "").strip()
    if not run_id:
        return jsonify({"error": "id required"}), 400
    return jsonify(bte.snapshot(run_id))


@app.route("/backtest/last")
def backtest_last():
    """The most recent completed run (survives a server restart)."""
    import backtest_engine as bte
    data = bte.last_run()
    return jsonify(data or {"run_id": None})


@app.route("/recommendation")
def recommendation():
    """Full buy-recommendation for one symbol: blends the passed-in fundamental
    (analyser) score with a fresh momentum + chart-pattern + structure read to
    produce an action, confidence, trade setup (entry/stop/target),
    support/resistance and upside. The client fans this out over the top
    Multibagger candidates to build the recommendations list."""
    from recommend import analyze

    sym = request.args.get("symbol", "").strip().upper().replace(":", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    name = request.args.get("name") or None
    fund = request.args.get("fund")
    try:
        fund_score = float(fund) if fund not in (None, "") else None
    except (TypeError, ValueError):
        fund_score = None
    try:
        candles = _load_ohlc(sym, "2y", "1d")
        if not candles:
            return jsonify({"symbol": sym, "action": "SKIP",
                            "note": f"No price history for {sym}"}), 404
        rec = analyze(sym, candles, fund_score, name)
        rec["symbol"] = sym
        # Every BUY the engine publishes enters the track record, at the levels
        # it published, dated now. Recording here (not in the client) is what
        # makes the Historic tab a record of the engine rather than a record of
        # what one device happened to render.
        try:
            _tradelog.record_reco(rec)
        except Exception as e:
            log.warning("tradelog: could not record %s (%s)", sym, e)
        return jsonify(rec)
    except Exception as e:
        log.error("Recommendation error for %s: %s", sym, e)
        return jsonify({"error": str(e), "symbol": sym, "action": "SKIP"}), 503


@app.route("/swing")
def swing():
    """Short-term (swing) trade read for one symbol: detects a pullback-reversal
    or oversold-bounce setup and returns a probability score + trade setup
    (entry/stop/target/R:R) plus trend, momentum, upside and max drawdown. The
    client fans this out over NIFTY 200 constituents (mid & large caps) to build
    the short-term recommendations list."""
    from swing import analyze

    sym = request.args.get("symbol", "").strip().upper().replace(":", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    name = request.args.get("name") or None
    try:
        candles = _load_ohlc(sym, "1y", "1d")
        if not candles:
            return jsonify({"symbol": sym, "action": "SKIP", "qualifies": False,
                            "note": f"No price history for {sym}"}), 404
        res = analyze(sym, candles, name)
        res["symbol"] = sym
        return jsonify(res)
    except Exception as e:
        log.error("Swing error for %s: %s", sym, e)
        return jsonify({"error": str(e), "symbol": sym, "action": "SKIP", "qualifies": False}), 503


_BENCH_CACHE: dict = {}   # index-close series for the stat-arb relative-value read
_BENCH_TTL = 3600


def _bench_closes():
    """1-year daily closes for NIFTY 50 (^NSEI), cached hourly. Used as the
    market benchmark for the statistical-arbitrage relative-value strategy.
    Returns [] on failure so the strategy simply sits out."""
    import ydata
    hit = _BENCH_CACHE.get("nsei")
    if hit and (time.time() - hit[0]) < _BENCH_TTL:
        return hit[1]
    closes = []
    df = ydata.history("^NSEI", "1y", "1d")
    if df is not None and not df.empty:
        closes = [float(x) for x in df["Close"].tolist() if x == x]
    if not closes:
        # Fetch failed (previously this raised NameError — yf was never imported
        # in this scope — and the stat-arb leg silently sat out forever). Keep
        # the last-good benchmark instead of caching an empty list.
        return hit[1] if hit else []
    _BENCH_CACHE["nsei"] = (time.time(), closes)
    return closes


@app.route("/institutional")
def institutional():
    """Screen one symbol against the classic algorithmic-trading strategies
    (momentum, trend-following, breakout, mean-reversion, statistical arbitrage)
    and return which strategy(ies) flagged it plus a trade setup. The client fans
    this out over NIFTY 200 constituents to build the Institutional list."""
    from institutional import analyze

    sym = request.args.get("symbol", "").strip().upper().replace(":", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    name = request.args.get("name") or None
    try:
        candles = _load_ohlc(sym, "2y", "1d")
        if not candles:
            return jsonify({"symbol": sym, "action": "SKIP", "qualifies": False,
                            "strategies": [], "note": f"No price history for {sym}"}), 404
        res = analyze(sym, candles, bench_closes=_bench_closes(), name=name)
        res["symbol"] = sym
        return jsonify(res)
    except Exception as e:
        log.error("Institutional error for %s: %s", sym, e)
        return jsonify({"error": str(e), "symbol": sym, "action": "SKIP",
                        "qualifies": False, "strategies": []}), 503


@app.route("/smc")
def smc_route():
    """Screen one symbol against the ICT / Smart-Money-Concepts long models
    (liquidity sweep reversal, AMD/Power-of-3, market-maker model, Algo-Candle/
    FVG, breaker/rejection block, HVI, divergence) with a confluence score and
    the book's structural stop/target rules. The client fans this over NIFTY 200
    to build the HFT/ICT/SMC list. Long-biased; daily structure only."""
    from smc import analyze

    sym = request.args.get("symbol", "").strip().upper().replace(":", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    name = request.args.get("name") or None
    try:
        candles = _load_ohlc(sym, "2y", "1d")
        if not candles:
            return jsonify({"symbol": sym, "action": "SKIP", "qualifies": False,
                            "strategies": [], "note": f"No price history for {sym}"}), 404
        res = analyze(sym, candles, name=name)
        res["symbol"] = sym
        return jsonify(res)
    except Exception as e:
        log.error("SMC error for %s: %s", sym, e)
        return jsonify({"error": str(e), "symbol": sym, "action": "SKIP",
                        "qualifies": False, "strategies": []}), 503


_MB_CACHE: dict = {}   # symbol -> (epoch, payload); refreshed every 6h
_MB_TTL = 6 * 3600


@app.route("/momentum/screen")
def momentum_screen_route():
    """Full NSE+BSE momentum radar (background job; see momentum_screen.py).
    ?refresh=1 forces a re-run even when the cached result is still fresh."""
    import momentum_screen as moms
    moms.ensure_started(get_universe, force=request.args.get("refresh") == "1")
    return jsonify(moms.snapshot())


@app.route("/multibagger/screen")
def multibagger_screen():
    """Full-universe analyser-score screen (background job; see mb_screen.py).
    ?refresh=1 forces a re-run even when the cached result is still fresh."""
    import mb_screen as mbs
    mbs.ensure_started(get_universe, force=request.args.get("refresh") == "1")
    return jsonify(mbs.snapshot())


@app.route("/penny/screen")
def penny_screen_route():
    """Penny-stock screen: low-priced scrips graded by whether you could
    actually trade them and whether a business exists underneath.

    Price and turnover come from the bhavcopy universe that is already cached,
    and fundamentals are read from the warm cache WITHOUT fetching — so a screen
    over the whole listed market costs no outbound calls."""
    import penny_screen as ps

    band = request.args.get("band") or ps.DEFAULT_BAND
    try:
        min_turnover = float(request.args.get("min_turnover") or 0)
    except (TypeError, ValueError):
        min_turnover = 0.0
    try:
        limit = int(request.args.get("limit") or 300)
    except (TypeError, ValueError):
        limit = 300

    # get_universe_nonblocking returns (rows, warming) — not a bare list.
    uni, warming = get_universe_nonblocking()
    uni = uni or []
    funds = _fund.cached_many([u["symbol"] for u in uni if u.get("symbol")])
    payload = ps.screen(uni, funds, band=band, min_turnover=min_turnover,
                        max_risk=request.args.get("max_risk"),
                        exchange=request.args.get("exchange"), limit=limit)
    payload["universe"] = len(uni)
    payload["warming"] = bool(warming or not uni)
    return jsonify(payload)


@app.route("/sectors/members")
def sector_members():
    """Constituent stocks of one heatmap bucket (symbol, name, price, day chg),
    most-traded first — feeds the sector popup's stock list. Same universe +
    classification as /sectors, so the count matches the tile."""
    _ensure_sector_classification()
    sector = (request.args.get("sector") or "").strip()
    if not sector:
        return jsonify({"error": "sector required"}), 400
    level = (request.args.get("level") or "macro").strip().lower()
    if level not in _sectors.LEVELS:
        level = "macro"
    universe, warming = get_universe_nonblocking()
    want = sector.upper()
    items, parent = [], ""
    for it in (universe or []):
        sym = it.get("symbol")
        if not sym:
            continue
        label, macro = _sectors.label_at(sym, level, it.get("sector"))
        if not label or label.upper() != want:
            continue
        parent = macro
        items.append({"symbol": sym, "name": it.get("name") or "",
                      "exchange": it.get("exchange") or "NSE",
                      "price": it.get("price"), "chg": it.get("chg"),
                      "turnover": it.get("turnover")})
    items.sort(key=lambda x: -(x.get("turnover") or 0))
    return jsonify(_nan_safe({"sector": sector, "level": level, "parent": parent,
                              "count": len(items), "warming": warming,
                              "items": items[:400]}))


@app.route("/sectors")
def sectors_aggregate():
    """Full NSE+BSE sectoral heatmap aggregate over the WHOLE listed universe.

    Day change + traded-value weight come straight from the bhavcopy (every
    scrip, no per-stock Yahoo call), and each symbol is classified into NSE's
    macro-economic sectors (~22 — far finer than Yahoo's 11 GICS buckets) via
    the disk-cached NSE index classification (see sectors.py). So the heatmap
    covers thousands of scrips across all sectors instantly, instead of only the
    few hundred a rate-limited .info sweep could resolve. ?refresh=1 re-pulls
    the NSE classification."""
    _ensure_sector_classification(force=request.args.get("refresh") == "1")
    # Classification level for the heatmap tiles: macro (22 NSE sectors, default),
    # industry (~65) or basic (~200). Screeners still filter by macro — each finer
    # tile carries its parent macro for routing.
    level = (request.args.get("level") or "macro").strip().lower()
    if level not in _sectors.LEVELS:
        level = "macro"
    # Never block the worker thread on a cold bhavcopy fetch — serve whatever
    # universe is cached and warm the rest in the background (see
    # get_universe_nonblocking). A cold heatmap comes back empty with
    # `running`, and the tiles fill in on the next poll.
    universe, warming = get_universe_nonblocking()
    agg = _sectors.build_heatmap(universe, level=level)
    with _universe_lock:
        asof = int(_universe_ts)
    # While the NSE classification is still downloading (cold cache) or the
    # universe is still warming, report `running` so the heatmap keeps polling
    # and the tiles fill in as more of the universe gets classified — then
    # settle to `done`.
    refreshing = _sector_refresh_running() or warming
    return jsonify({
        "status": "running" if refreshing else "done",
        "refreshing": refreshing,
        "progress": f"{agg['mapped']:,} of {agg['universe']:,} scrips classified" if refreshing else "",
        "asof": asof,
        "level": agg["level"],
        "universe": agg["universe"],
        "mapped": agg["mapped"],
        "sectors": agg["sectors"],
        # Per-source classification breakdown — helps diagnose coverage: how many
        # symbols the BSE scrip master vs the NSE index files each contributed,
        # plus the distinct-bucket count at each classification level.
        "diag": {"classify": _sectors.diag(), "bse": _bse_diag,
                 "static": _sectors.static_count(),
                 "classified_symbols": _sectors.map_size(),
                 "levels": _sectors.level_counts()},
        "error": None,
    })


@app.route("/multibagger")
def multibagger_report():
    """One-click multibagger-potential report (see multibagger.py for the model)."""
    sym = request.args.get("symbol", "").strip().upper()
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    cached = _MB_CACHE.get(sym)
    if cached and time.time() - cached[0] < _MB_TTL:
        return jsonify(cached[1])
    try:
        import multibagger as mb
        try:
            # A user-initiated single-stock lookup: retry through transient Yahoo
            # rate-limits (exp backoff in mb._resolve) before giving up — the mass
            # screen fails fast instead.
            metrics, ident = mb.fetch_metrics(sym, retries=3)
        except ValueError:
            # The `.info` endpoint is rate-limited. If the background screen has
            # already scored this scrip, serve the full report from that cache so
            # a screened multibagger is always analysable.
            cached = _mb_from_screen_cache(sym)
            if cached:
                _MB_CACHE[sym] = (time.time(), cached)
                return jsonify(cached)
            return jsonify({"error": f"No market data for {sym} — it may be newly "
                                     "listed or delisted, or the data source is "
                                     "briefly unavailable. Try again shortly."}), 404
        payload = mb.score(metrics)
        payload.update(ident)
        _MB_CACHE[sym] = (time.time(), payload)
        return jsonify(payload)
    except Exception as e:
        # Upstream (yfinance/Yahoo) hiccup, not a bug in our model. Try the screen
        # cache before giving up; otherwise report a retryable 503 (never a 502).
        cached = _mb_from_screen_cache(sym)
        if cached:
            return jsonify(cached)
        log.error("Multibagger error for %s: %s", sym, e)
        return jsonify({"error": f"Couldn't analyse {sym} right now — the market "
                                 "data source may be rate-limiting. Try again in a "
                                 "moment."}), 503


def _mb_from_screen_cache(sym: str):
    """Rebuild a full multibagger report from the background screen's stored
    metrics for `sym` (see mb_screen.cached). Returns the report dict flagged
    `stale`, or None when the symbol wasn't screened / has no stored metrics."""
    try:
        import mb_screen
        import multibagger as mb
        c = mb_screen.cached(sym)
        if not c or not c.get("metrics"):
            return None
        payload = mb.score(c["metrics"])
        payload.update({
            "symbol": sym,
            "name": c.get("name") or sym,
            "sector": _sectors.sector_of(sym, c.get("sector")) or c.get("sector"),
            "industry": c.get("industry"),
            "price": c.get("price"),
            "about": c.get("about") or "",
            "stale": True,  # scored from the last full screen, not a live fetch
        })
        return payload
    except Exception:
        return None


@app.route("/fundamentals")
def fundamentals():
    sym = request.args.get("symbol", "").strip().upper()
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    try:
        import yfinance as yf
        ticker = yf.Ticker(f"{sym}.NS")
        info   = ticker.info or {}

        def fmt_cr(v):
            if not v: return None
            return round(v / 1e7, 2)  # convert to Crores

        financials = {}
        try:
            inc = ticker.income_stmt
            if inc is not None and not inc.empty:
                col = inc.columns[0]
                financials["revenue"]     = fmt_cr(inc.loc["Total Revenue", col]) if "Total Revenue" in inc.index else None
                financials["net_income"]  = fmt_cr(inc.loc["Net Income", col])    if "Net Income" in inc.index    else None
                financials["ebitda"]      = fmt_cr(inc.loc["EBITDA", col])        if "EBITDA" in inc.index        else None
        except Exception:
            pass

        # Overlay the screener.in provider chain (get_one blocks briefly on a
        # cold symbol, then serves from the 7-day disk cache). Screener values
        # win where present — that chain is the product's fundamentals source.
        chain = {}
        try:
            chain = _fund.get_one(sym)
        except Exception as e:
            log.warning("fundamentals chain fetch failed for %s: %s", sym, e)

        payload = {
            "symbol":       sym,
            "name":         info.get("longName") or info.get("shortName", sym),
            "sector":       _sectors.sector_of(sym, info.get("sector")) or info.get("sector"),
            "industry":     info.get("industry"),
            "exchange":     info.get("exchange"),
            "market_cap_cr": fmt_cr(info.get("marketCap")),
            "pe":           round(info.get("trailingPE", 0) or 0, 2) or None,
            "forward_pe":   round(info.get("forwardPE",  0) or 0, 2) or None,
            "pb":           round(info.get("priceToBook", 0) or 0, 2) or None,
            "eps":          info.get("trailingEps"),
            "dividend_yield": round((info.get("dividendYield") or 0) * 100, 2) or None,
            "roe":          round((info.get("returnOnEquity") or 0) * 100, 2) or None,
            "roce":         round((info.get("returnOnAssets") or 0) * 100, 2) or None,
            "debt_equity":  round(info.get("debtToEquity", 0) or 0, 2) or None,
            "current_ratio": round(info.get("currentRatio", 0) or 0, 2) or None,
            "week52_high":  info.get("fiftyTwoWeekHigh"),
            "week52_low":   info.get("fiftyTwoWeekLow"),
            "avg_volume":   info.get("averageVolume"),
            "beta":         round(info.get("beta", 0) or 0, 2) or None,
            "description":  (info.get("longBusinessSummary") or "")[:600],
            "financials":   financials,
        }
        for k in _fund.FIELDS:
            if chain.get(k) is not None:
                payload[k] = chain[k]
        if chain.get("source"):
            payload["fund_source"] = chain["source"]
        return jsonify(payload)
    except Exception as e:
        log.error("Fundamentals error for %s: %s", sym, e)
        return jsonify({"error": str(e)}), 502


@app.route("/fundamentals/bulk")
def fundamentals_bulk():
    """Bulk fundamentals for the screener. Returns cached rows immediately and
    warms the rest in the background (poll again to collect `pending`)."""
    syms = [s.strip().upper() for s in request.args.get("symbols", "").split(",") if s.strip()]
    if not syms:
        return jsonify({"data": {}, "pending": [], "provider": _fund.EODHD_KEY and "EODHD" or "yfinance",
                        "cached": 0, "total": 0})
    out = _fund.bulk(syms)
    # Overlay the app-wide NSE macro sector so the screeners' sector filters use
    # the same taxonomy as the sectoral heatmap (keeps heatmap→screener routing
    # consistent). Falls back to the provider's raw sector when unclassified.
    try:
        for sym, row in (out.get("data") or {}).items():
            if isinstance(row, dict):
                nse = _sectors.sector_of(sym, row.get("sector"))
                if nse:
                    row["sector"] = nse
    except Exception:
        pass
    return jsonify(out)


# ── Fundamentals warm sweep (owner-operated, surfaced in the developer portal) ──
def _warm_symbols(scope: str) -> tuple:
    """Resolve a warm scope to (symbols, label). 'all' walks the whole listed
    universe; anything else is treated as an index / custom group name."""
    scope = (scope or "").strip().upper()
    if scope in ("", "ALL", "UNIVERSE"):
        # NSE only: the provider chain is keyed by NSE symbol (screener.in's
        # company page, then SYM.NS on yfinance), so sweeping the ~2600 BSE-only
        # scrips would just cache empty results — and a cached empty result is
        # 'fresh' for the full TTL, so they would not be retried for a week.
        items = get_universe() or []
        return ([x["symbol"] for x in items
                 if x.get("symbol") and x.get("exchange") == "NSE"], "ALL NSE")
    if scope not in NSE_INDEX_MAP and scope not in CUSTOM_GROUPS:
        return [], scope
    rows, _src = _get_constituents(scope)
    return [r.get("symbol") for r in (rows or []) if r.get("symbol")], scope


@app.route("/fundamentals/warm", methods=["GET"])
@require_owner
def fundamentals_warm_status():
    return jsonify(_fund.warm_progress())


@app.route("/fundamentals/warm", methods=["POST"])
@require_owner
def fundamentals_warm_start():
    b = request.get_json(silent=True) or {}
    scope = b.get("scope") or "ALL"
    syms, label = _warm_symbols(scope)
    if not syms:
        return jsonify({"started": False,
                        "reason": f"no symbols for '{label}' — unknown index, or the "
                                  f"universe sweep hasn't populated it yet",
                        "scopes": ["ALL"] + list(NSE_INDEX_MAP) + list(CUSTOM_GROUPS)}), 400
    res = _fund.warm_start(syms, label)
    res["progress"] = _fund.warm_progress()
    return jsonify(res)


@app.route("/fundamentals/warm/stop", methods=["POST"])
@require_owner
def fundamentals_warm_stop():
    res = _fund.warm_stop()
    res["progress"] = _fund.warm_progress()
    return jsonify(res)


# Warm the fundamentals cache on boot so the growth/valuation filters have data
# before anyone opens a screen. Off by default (FUND_WARM=off) because it is a
# long scrape; the deploy sets it to an index name or ALL.
FUND_WARM = os.environ.get("FUND_WARM", "off").strip()


def start_fund_warm():
    """Start the boot-time fundamentals sweep once (called from __main__/wsgi)."""
    if not FUND_WARM or FUND_WARM.lower() in ("0", "off", "false", "no"):
        return

    def _go():
        time.sleep(45)   # after the universe list and the scan warm have settled
        try:
            syms, label = _warm_symbols(FUND_WARM)
            if not syms:
                log.warning("Fundamentals warm: no symbols for scope %r", FUND_WARM)
                return
            _fund.warm_start(syms, label)
            log.info("Fundamentals warm started: %s (%d symbols)", label, len(syms))
        except Exception as e:
            log.warning("Fundamentals warm failed to start: %s", e)

    threading.Thread(target=_go, name="fund-warm-boot", daemon=True).start()


@app.route("/sector-medians")
def sector_medians_route():
    """Peer medians per sector, from the cached fundamentals. Feeds the dossier's
    valuation context and the screener's 'vs sector' filters."""
    data = _fund.sector_medians(force=request.args.get("force") == "1")
    return jsonify({"sectors": data, "count": len(data),
                    "min_sample": _fund.SECTOR_MIN_N,
                    "fields": list(_fund.SECTOR_FIELDS)})


def _quote_prices(symbols):
    """{symbol: last price} for the trade ledger's mark-to-market pass. Reuses
    the quote cache and the one batched Yahoo call the /ltp route uses — the
    ledger must never open its own per-symbol fan-out, which is exactly what
    starved the scanner when the fundamentals sweep did it."""
    out = {}
    now = time.time()
    pending = []
    for s in symbols:
        hit = _LTP_CACHE.get(s)
        if hit and now - hit[0] < _LTP_TTL and hit[1].get("price"):
            out[s] = hit[1]["price"]
        else:
            pending.append(s)
    if pending:
        for s, entry in _yf_batch(pending).items():
            _LTP_CACHE[s] = (now, entry)
            if entry.get("price"):
                out[s] = entry["price"]
    return out


@app.route("/tradelog")
def tradelog_route():
    """The track record: every trade the recommendation, momentum and
    multibagger engines called, with its outcome marked to market. Filter with
    ?source=reco|momentum|multibagger and ?status=open|won|lost|closed."""
    try:
        _tradelog.ensure_marked(_quote_prices)
    except Exception as e:
        log.warning("tradelog: mark-to-market could not start (%s)", e)
    payload = _tradelog.ledger(
        source=request.args.get("source"),
        status=request.args.get("status"),
        limit=request.args.get("limit", 500),
        origin=request.args.get("origin"),
    )
    payload["backfill"] = _backfill.progress()
    return jsonify(payload)


@app.route("/tradelog/reconcile", methods=["POST"])
def tradelog_reconcile():
    """Force an immediate mark-to-market pass (developer portal)."""
    started = _tradelog.ensure_marked(_quote_prices, force=True)
    return jsonify({"started": started, "open": len(_tradelog.open_symbols())})


@app.route("/tradelog/backfill", methods=["GET"])
def tradelog_backfill_status():
    return jsonify(_backfill.progress())


@app.route("/tradelog/backfill", methods=["POST"])
def tradelog_backfill_start():
    """Replay the engines over recent history to seed the record (developer
    portal). Runs once by default; ?force=1 re-runs it."""
    force = (request.json or {}).get("force") if request.is_json else False
    started = _backfill.ensure_started(get_universe_nonblocking, force=bool(force))
    return jsonify({"started": started, "progress": _backfill.progress()})


def start_backfill():
    """Seed the track record on boot, once ever (the completion marker lives in
    the store, so a redeploy doesn't refill and double it). Off with
    TRADELOG_BACKFILL=0."""
    if os.environ.get("TRADELOG_BACKFILL", "1") in ("0", "", "off", "false"):
        return

    def _go():
        time.sleep(90)          # let the universe + scan caches warm first
        try:
            if _backfill.ensure_started(get_universe_nonblocking):
                log.info("Track-record backfill started (%d days)", _backfill.DAYS)
        except Exception as e:
            log.warning("Track-record backfill failed to start: %s", e)

    threading.Thread(target=_go, name="tradelog-backfill-boot", daemon=True).start()


def _case_rows():
    """The scored universe the case engine builds from — the multibagger screen's
    own results, so a case can only ever hold something the analyser rated."""
    import mb_screen as mbs
    mbs.ensure_started(get_universe)
    return mbs.snapshot().get("results") or []


@app.route("/cases")
def cases_overview():
    """Every TaurEye case with its headline numbers. ?refresh=1 forces the
    engine to re-run its build/review pass."""
    try:
        _cases.ensure_built(_case_rows, _quote_prices,
                            force=request.args.get("refresh") == "1")
    except Exception as e:
        log.warning("cases: build could not start (%s)", e)
    syms = []
    for c in _cases.all_cases():
        syms += [h["symbol"] for h in _cases.holdings_of(c["id"])]
    quotes = _quote_prices(sorted(set(syms))[:200]) if syms else {}
    payload = _cases.overview(quotes)
    payload["progress"] = _cases.progress()
    return jsonify(payload)


@app.route("/cases/<case_id>")
def case_detail_route(case_id):
    """One case in full: constituents with live P/L, the allocation at a given
    investment (?amount=), CAGR, and the engine's action ledger."""
    holds = _cases.holdings_of(case_id)
    quotes = _quote_prices([h["symbol"] for h in holds]) if holds else {}
    detail = _cases.case_detail(case_id, quotes)
    if not detail:
        return jsonify({"error": f"Unknown case '{case_id}'"}), 404
    try:
        amount = float(request.args.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if amount > 0:
        legs = detail["constituents"]
        alloc = _cases.allocate(amount, [l["price"] for l in legs],
                                [l["weight"] for l in legs])
        for leg, a in zip(legs, alloc["legs"]):
            leg["alloc_shares"] = a["shares"]
            leg["alloc_value"] = a["value"]
            leg["alloc_weight"] = a["actual_weight"]
        detail["allocation"] = {k: alloc[k] for k in ("invested", "cash", "amount")}
    return jsonify(detail)


@app.route("/cases/rebuild", methods=["POST"])
def cases_rebuild():
    """Force a build/review pass (developer portal)."""
    started = _cases.ensure_built(_case_rows, _quote_prices, force=True)
    return jsonify({"started": started, "progress": _cases.progress()})


@app.route("/returns")
def returns():
    """Bulk 1Y/3Y/5Y return calculator — per-symbol with threading."""
    raw = request.args.get("symbols", "").strip().upper()
    if not raw:
        return jsonify({"error": "symbols required"}), 400
    symbols = [s.strip() for s in raw.split(",") if s.strip()][:50]
    import ydata
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _calc_one(sym):
        yf_sym = sym if sym.startswith("^") else f"{sym}.NS"
        try:
            df = ydata.history(yf_sym, "5y", "1mo")
            if df is None or df.empty:
                return sym, {}
            col = df["Close"].dropna()
            if len(col) < 2:
                return sym, {}
            cur = float(col.iloc[-1])
            def _r(n):
                past = float(col.iloc[max(0, len(col) - 1 - n)])
                return round((cur / past - 1) * 100, 2) if past > 0 else None
            return sym, {"ret1y": _r(12), "ret3y": _r(36), "ret5y": _r(60)}
        except Exception as e:
            log.warning("Returns error %s: %s", sym, e)
            return sym, {}

    out = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = {ex.submit(_calc_one, s): s for s in symbols}
        for f in as_completed(futures):
            sym, data = f.result()
            out[sym] = data
    log.info("Returns: computed %d/%d symbols", sum(1 for v in out.values() if v), len(symbols))
    return jsonify(out)


# ── Scan cache warmer ────────────────────────────────────────────────────────
# Pre-computes technicals for the indices users actually open, so a visitor hits
# a hot cache instead of waiting out a cold yfinance sweep. Disable with
# SCAN_WARM=off; scope it with e.g. SCAN_WARM="NIFTY 100".
#
# Coverage is bounded by upstream calls per second, not by the number of names:
# scanner only recomputes a symbol once its row expires, so a cycle shorter than
# that TTL costs almost nothing after the first pass. Lengthening the TTL is
# therefore what buys coverage — NIFTY 500 (which contains 50 and 100) now warms
# for a LOWER sustained call rate than the old 150-symbol/5-minute setup, and it
# covers the great majority of what the screener's wider universes ask for.
SCAN_WARM = os.environ.get("SCAN_WARM", "NIFTY 500,NIFTY 50,NIFTY 100").strip()
SCAN_WARM_CHUNK = int(os.environ.get("SCAN_WARM_CHUNK", "60"))
SCAN_WARM_PAUSE = float(os.environ.get("SCAN_WARM_PAUSE", "2"))
SCAN_WARM_CYCLE = float(os.environ.get("SCAN_WARM_CYCLE", "600"))


def _warm_index_symbols(name):
    """Constituent symbols for one index name, for the warm loop.

    Goes through _get_constituents rather than hitting NSE Direct: that
    endpoint 404s for cloud IPs, so asking it straight meant the warm loop
    silently warmed nothing in production — exactly where a hot cache matters
    and exactly where the failure was invisible.
    """
    rows, _src = _get_constituents(name.strip().upper())
    return [r.get("symbol") for r in (rows or []) if r.get("symbol")]


def _warm_scan_loop():
    """Keep the technical-scan cache hot for the indices users actually open.

    Previously this warmed ONE index, and scanner.scan() caps a call at 60
    symbols — so anything past NIFTY 50 was computed live, per user, per visit,
    which is what made the screener slow on the wider universes.

    It now walks a list of indices in chunks. The pacing matters more than the
    coverage: every row costs one upstream history call through the same global
    cap the interactive scan uses, so an unpaced sweep would starve the very
    requests it is meant to speed up (which is exactly what the fundamentals
    sweep once did). Chunks are small and separated by a deliberate pause.
    """
    names = [n.strip() for n in SCAN_WARM.split(",") if n.strip()]
    time.sleep(15)  # let the service settle before hitting data sources
    while True:
        started = time.time()
        for name in names:
            try:
                syms = _warm_index_symbols(name)
                if not syms:
                    continue
                warmed = computed = 0
                for i in range(0, len(syms), SCAN_WARM_CHUNK):
                    chunk = syms[i:i + SCAN_WARM_CHUNK]
                    # wait=True: this loop exists to do the work, and nobody is
                    # waiting on it. Left non-blocking it would just enqueue the
                    # whole index onto the same pool that serves live requests.
                    res = _scanner.scan(chunk, wait=True)
                    warmed += res["count"]
                    computed += res["computed"]
                    time.sleep(SCAN_WARM_PAUSE)   # yield the upstream budget
                log.info("Scan warm: %s -> %d/%d rows (%d computed)",
                         name, warmed, len(syms), computed)
            except Exception as e:
                log.warning("Scan warm failed for %s: %s", name, e)
        # Re-warm on a cycle a little under the row TTL so a warmed row is
        # still fresh when the next user asks for it.
        time.sleep(max(30, SCAN_WARM_CYCLE - (time.time() - started)))


def start_scan_warm():
    """Start the warm loop once (called from __main__ and wsgi.py)."""
    if SCAN_WARM and SCAN_WARM.lower() not in ("0", "off", "false", "no"):
        threading.Thread(target=_warm_scan_loop, name="scan-warm", daemon=True).start()


AI_DISCLAIMER = ("AI-generated relationship map from model knowledge — indicative, "
                 "not verified filings data. Not investment advice.")


@app.route("/graph")
@rate_limit("graph", 60, 300)
def relationship_graph():
    """Company-relationship graph for the Terminal tab.

    No ?symbol → the curated demo dataset (also the fallback universe).
    ?symbol=X → AI-generated graph for any company when ANTHROPIC_API_KEY is
    configured (30-day disk cache); curated data still wins for symbols it
    covers so the hand-checked cluster stays authoritative.
    """
    sym = request.args.get("symbol", "").strip().upper()
    # BYOK: the visitor may bring their own key for any supported provider
    # (Claude/Gemini/Grok/OpenAI), sent as headers, never logged or stored, so
    # AI graphs work even with no server key.
    user_key = request.headers.get("X-AI-Key", "").strip()
    user_provider = request.headers.get("X-AI-Provider", "").strip()
    user_model = request.headers.get("X-AI-Model", "").strip()
    ai_ok = _ai.available() or bool(user_key)
    base = _relations.graph()
    base["ai"] = ai_ok
    if not sym or sym in base["companies"]:
        return jsonify(base)

    # A cached or committed-seed graph is served to everyone, no key required —
    # this is what makes the pre-warmed set instant and keyless.
    seeded = _ai.cached_graph(sym)
    if seeded:
        listed = sorted(k for k, v in seeded["companies"].items() if v.get("listed"))
        return jsonify({"companies": seeded["companies"], "edges": seeded["edges"],
                        "available": listed, "source": "ai", "ai": ai_ok,
                        "disclaimer": AI_DISCLAIMER})

    # A minimal graph so the Terminal can centre on ANY listed company and use
    # its workspace (chart, fundamentals, news, compare) even when relationship
    # edges aren't available — those need either the curated set or an AI key.
    def _minimal(reason):
        name = sym
        try:
            f = _fund.get_one(sym) or {}
            name = f.get("name") or sym
        except Exception:
            pass
        if reason == "no-key":
            note = ("Relationship edges for this company need the AI graph — add an AI "
                    "key (Claude/Gemini/Grok/OpenAI) from the ⚙ AI KEY field to unlock them.")
        elif reason == "gen-sparse":
            note = ("No relationship map could be generated for this company (it's "
                    "thinly covered) — showing its live chart, fundamentals and news.")
        else:
            note = ("Couldn't build a relationship graph right now — showing the "
                    "company's live data instead.")
        return jsonify({
            "companies": {sym: {"name": name, "listed": True}},
            "edges": [], "available": [sym], "source": "minimal", "ai": ai_ok,
            "disclaimer": note,
        })

    if not ai_ok:
        return _minimal("no-key")

    # We only reach here on a genuine (uncached) generation. Cap per IP, but only
    # when the server's own key pays for it — BYOK spends the user's own tokens.
    if not user_key:
        retry = _rl_hit("graph-ai", 10, 3600)
        if retry is not None:
            return jsonify({"error": "rate-limited", "ai": True,
                            "detail": "Graph-generation limit reached — retry in %d min."
                                      % max(1, retry // 60)}), 429
    # Ground the AI with the company's real identity so lesser-known names still
    # map to their actual relationships (name — industry — sector).
    ctx = ""
    try:
        f = _fund.get_one(sym) or {}
        bits = [str(f[k]) for k in ("name", "industry", "sector") if f.get(k)]
        ctx = " · ".join(dict.fromkeys(bits))  # dedupe, keep order
    except Exception:
        pass
    try:
        g = _ai.get_graph(sym, user_key, user_provider, user_model, context=ctx)
    except ValueError as e:
        # The provider answered but the graph was unparseable or too sparse (common
        # for thinly-covered small-caps). The key is fine — don't cry wolf about it;
        # give the company workspace with an honest note.
        logging.info("AI graph sparse/invalid for %s: %s", sym, e)
        return _minimal("gen-sparse")
    except Exception as e:
        logging.warning("AI graph generation failed for %s: %s", sym, e)
        if user_key:
            return jsonify({"error": "ai-key-failed", "ai": True,
                            "detail": "Couldn't reach your AI provider or the key was "
                                      "rejected — check it's valid, has credit, and the "
                                      "model is available to your account, then retry."}), 400
        return _minimal("gen-failed")  # still centre on the company with its data
    listed = sorted(k for k, v in g["companies"].items() if v.get("listed"))
    return jsonify({"companies": g["companies"], "edges": g["edges"],
                    "available": listed, "source": "ai", "ai": True,
                    "disclaimer": AI_DISCLAIMER})


# ── BYOB broker connect (Zerodha Kite, READ-ONLY — no order endpoints) ──
@app.route("/broker/status")
@rate_limit("broker", 60, 300)
def broker_status():
    return jsonify(_broker.status())


@app.route("/broker/callback")
@rate_limit("broker-login", 10, 600)
def broker_callback():
    """Kite redirects here after the user logs in on zerodha.com."""
    tok = request.args.get("request_token", "").strip()
    if not tok:
        return jsonify({"error": "missing request_token"}), 400
    try:
        _broker.complete_login(tok)
    except Exception as e:
        logging.warning("broker login failed: %s", type(e).__name__)
        return jsonify({"error": "login-failed",
                        "detail": "Token exchange failed — start the login again."}), 502
    return redirect("/?broker=connected")


@app.route("/broker/holdings")
@require_owner
@rate_limit("broker", 60, 300)
def broker_holdings():
    if not _broker.connected():
        return jsonify({"error": "not-connected"}), 401
    try:
        return jsonify({"holdings": _broker.holdings(), "read_only": True})
    except Exception as e:
        return jsonify({"error": "broker-error", "detail": str(e)}), 502


@app.route("/broker/ltp")
@require_owner
@rate_limit("broker", 120, 300)
def broker_ltp():
    if not _broker.connected():
        return jsonify({"error": "not-connected"}), 401
    syms = [x for x in request.args.get("symbols", "").upper().split(",") if x]
    try:
        return jsonify({"data": _broker.ltp(syms)})
    except Exception as e:
        return jsonify({"error": "broker-error", "detail": str(e)}), 502


@app.route("/broker/logout", methods=["POST"])
@require_owner
@rate_limit("broker-login", 10, 600)
def broker_logout():
    _broker.logout()
    return jsonify({"connected": False})


# Top movers across the WHOLE market, not inside an index.
#
# Every movers list on the page until now was scoped to a constituent list —
# NIFTY 500 for breadth, NIFTY 50 and SENSEX for the slider — so the day's
# biggest actual moves, which are usually nowhere near the large-cap indices,
# never appeared anywhere.
#
# The bhavcopy is already in memory for all ~5,700 traded symbols with a close,
# a previous close and a turnover, so this costs one sort and no network.
#
# The turnover floor is not tidying: with no floor at all the list is rights
# entitlements and shells that printed one trade, several pegged at exactly
# ±20% because they hit the circuit band rather than because anyone moved them.
# A crore of turnover is a low bar that still leaves ~1,700 names, and the UI
# states it rather than implying the whole market was considered.
_MARKET_MOVERS_FLOOR = 1e7          # ₹1 crore of the day's turnover

# How far the previous close may sit outside the day's traded range before it
# stops being a previous close worth comparing to. NSE's widest price band is
# 20% (×1.20), so a gap of half again cannot happen in an ordinary session.
_PREV_CLOSE_GAP = 1.5


def _comparable_prev_close(r) -> bool:
    """Is this row's change a MOVE, or an artefact of the reference changing?

    The bhavcopy's PREV_CLOSE is raw: it is not adjusted for splits, bonuses or
    demergers, and on a listing day it is the issue price. So a 1:10 split
    prints as −90% and a listing pop prints as +95%, and both would top a
    "biggest movers" list while describing nothing that happened in the market.

    The tell is not the size of the change — a stock really can fall 20% — it
    is that the stock never traded anywhere NEAR its stated previous close.
    A genuine limit-down day still opens close to yesterday and falls; a split
    opens at a tenth of it. On the session this was written the rule excluded
    exactly three names out of 1,691 (two 1:10 ETF splits and one listing),
    while the widest real gap — a scrip locked at its 20% lower circuit — sat
    at ×1.25, comfortably inside.
    """
    prev, lo, hi = (_finite(r.get("prevClose")), _finite(r.get("low")),
                    _finite(r.get("high")))
    if not prev or not lo or not hi or lo <= 0 or hi <= 0:
        return True          # nothing to judge on; do not silently drop it
    if prev > hi:
        return prev / hi <= _PREV_CLOSE_GAP
    if prev < lo:
        return lo / prev <= _PREV_CLOSE_GAP
    return True              # the previous close is inside the day's range


@app.route("/movers/market")
def market_movers():
    """The day's biggest gainers and losers across every traded symbol."""
    n = max(1, min(request.args.get("n", 6, type=int) or 6, 25))
    try:
        floor = float(request.args.get("min_turnover") or _MARKET_MOVERS_FLOOR)
    except (TypeError, ValueError):
        floor = _MARKET_MOVERS_FLOOR
    floor = max(0.0, floor)

    # Never blocks: a cold process warms in the background and says `running`
    # rather than holding a request thread open on a multi-second bhavcopy
    # fetch — a handful of those together saturate the worker pool.
    rows, warming = get_universe_nonblocking()
    if not rows:
        return jsonify({"gainers": [], "losers": [], "running": bool(warming),
                        "universe": 0, "traded": 0,
                        "min_turnover": floor, "session": _BHAV_DATE})

    traded = [r for r in rows
              if r.get("chg") is not None and _finite(r.get("price"))]
    liquid = [r for r in traded if (r.get("turnover") or 0) >= floor]
    ranked = [r for r in liquid if _comparable_prev_close(r)]
    skipped = len(liquid) - len(ranked)
    ranked.sort(key=lambda r: r["chg"], reverse=True)
    liquid = ranked

    def out(r):
        return {"symbol": r["symbol"], "name": r.get("name") or r["symbol"],
                "price": r.get("price"), "chg": r.get("chg"),
                "absChg": r.get("absChg"), "volume": r.get("volume"),
                "turnover": r.get("turnover")}

    return jsonify({
        "gainers": [out(r) for r in liquid[:n]],
        "losers": [out(r) for r in reversed(liquid[-n:])] if len(liquid) >= n
                  else [out(r) for r in reversed(liquid)],
        "universe": len(liquid),
        "traded": len(traded),
        # Splits, bonuses and listing days, whose "previous close" is not a
        # price the stock ever traded at. Reported rather than hidden.
        "excluded": skipped,
        "min_turnover": floor,
        "session": _BHAV_DATE,
    })


@app.route("/news")
@rate_limit("news", 30, 300)
def latest_news():
    """Latest news for the Terminal news panel.

    Merges a symbol-specific Google News feed (query = company name via ?q=)
    with market-wide RSS feeds. Cached an hour per symbol; ?force=1 (the
    panel's update button) refetches, rate-limited server-side.
    """
    sym = request.args.get("symbol", "").strip().upper()
    q = request.args.get("q", "").strip()
    force = request.args.get("force") == "1"
    payload = _news.get_news(sym, q, force)
    # Write through whatever this poll saw. The feeds are a window — a few
    # hours, at most a day — so a headline nobody recorded as it went past is
    # gone. Market-wide only: a symbol-specific Google News query is a search
    # result, not the market's record of the day.
    if not sym:
        try:
            _newshist.record(payload.get("items"))
        except Exception as e:
            log.debug("news history write failed: %s", e)
    return jsonify(payload)


@app.route("/news/history")
@rate_limit("news-history", 60, 300)
def news_history():
    """Headlines recorded from earlier polls, newest first.

    `days` is capped at the retention window, and the response says how far
    back the archive actually reaches — it starts accumulating the day the
    server first runs this, and cannot reach backwards into stories that were
    never recorded.
    """
    items = _newshist.history(
        days=request.args.get("days", 30, type=int),
        limit=request.args.get("limit", 200, type=int),
        offset=request.args.get("offset", 0, type=int),
        q=request.args.get("q", "").strip(),
        source=request.args.get("source", "").strip(),
    )
    st = _newshist.stats()
    return jsonify({"items": items, "sources": _newshist.sources(),
                    "oldest": st.get("oldest"), "newest": st.get("newest"),
                    "total": st.get("n") or 0,
                    "keep_days": _newshist.KEEP_DAYS})


@app.route("/holidays")
def market_holidays():
    """NSE trading-holiday calendar + live market open/closed status (IST)."""
    s = _holidays.market_status()
    return jsonify({**s, "holidays": _holidays.holidays(),
                    "note": "Indicative list — verify with NSE circulars."})


# ── Primary-market + fixed-income windows (landing page) ─────────────────────
# Upcoming/current IPOs and traded G-Sec / SGB quotes from NSE's public JSON
# APIs (parsing in primary_feeds.py). Best-effort with a memory cache and a
# last-good disk copy — the landing page degrades to an empty window with an
# error note instead of failing.
_FEED_LOCK = threading.Lock()
_FEEDS = {
    "ipos": {"ts": 0.0, "data": None, "ttl": 1800,
             "file": os.path.join(_BASE_DIR, "ipo_cache.json"),
             "parse": lambda: _primary.parse_ipos(lambda p, q=None: nse_get(p, params=q))},
    "gsec": {"ts": 0.0, "data": None, "ttl": 1800,
             "file": os.path.join(_BASE_DIR, "gsec_cache.json"),
             "parse": lambda: _primary.parse_gsec(lambda p, q=None: nse_get(p, params=q))},
}


def _feed_payload(name):
    feed = _FEEDS[name]
    now = time.time()
    with _FEED_LOCK:
        if feed["data"] is not None and now - feed["ts"] < feed["ttl"]:
            return feed["data"]
    items, err = feed["parse"]()
    if items:
        payload = {"items": items,
                   "asof": datetime.datetime.now().isoformat(timespec="seconds")}
        with _FEED_LOCK:
            feed["ts"], feed["data"] = now, payload
        try:
            with open(feed["file"], "w") as f:
                json.dump(payload, f)
        except Exception:
            pass
        return payload
    try:  # degrade: last-good disk copy, marked stale
        with open(feed["file"]) as f:
            old = json.load(f)
        old["stale"] = True
        with _FEED_LOCK:  # retry the live feed again in 5 min, not a full TTL
            feed["ts"], feed["data"] = now - feed["ttl"] + 300, old
        return old
    except Exception:
        return {"items": [], "error": err or "unavailable"}


def _ipo_items():
    """The public-issue rows, ranked for today — see primary_feeds.rank_ipos.

    Ranked here rather than in the cache: whether a book is open, closed or
    still to come is a fact about today, and the payload behind this can be a
    disk copy written days ago.
    """
    try:
        return _primary.rank_ipos((_feed_payload("ipos") or {}).get("items") or [])
    except Exception:
        return []


@app.route("/ipos")
@rate_limit("ipos", 30, 300)
def upcoming_ipos():
    """Current + upcoming public issues (mainboard & SME) from NSE."""
    payload = dict(_feed_payload("ipos") or {})
    payload["items"] = _ipo_items()
    return jsonify(payload)


@app.route("/gsec")
@rate_limit("gsec", 30, 300)
def gsec_quotes():
    """Traded G-Secs and sovereign gold bonds — market yields, not FD rates."""
    return jsonify(_feed_payload("gsec"))


# ── Major indices (live level + day change + 1Y return via yfinance) ─────────
_MAJOR_INDICES = [
    ("NIFTY50",     "NIFTY 50",         "^NSEI"),
    ("SENSEX",      "BSE SENSEX",       "^BSESN"),
    ("BANKNIFTY",   "NIFTY Bank",       "^NSEBANK"),
    ("NIFTYIT",     "NIFTY IT",         "^CNXIT"),
    ("NIFTYAUTO",   "NIFTY Auto",       "^CNXAUTO"),
    ("NIFTYPHARMA", "NIFTY Pharma",     "^CNXPHARMA"),
    ("NIFTYFMCG",   "NIFTY FMCG",       "^CNXFMCG"),
    ("NIFTYMETAL",  "NIFTY Metal",      "^CNXMETAL"),
    ("NIFTYENERGY", "NIFTY Energy",     "^CNXENERGY"),
    ("NIFTYREALTY", "NIFTY Realty",     "^CNXREALTY"),
    ("NIFTYMIDCAP", "NIFTY Midcap 100", "^CRSMID"),
    ("NIFTYNEXT50", "NIFTY Next 50",    "^NSMIDCP"),
]
# Major international indices (Global tab). Same (key, name, yf_sym) shape.
_INTL_INDICES = [
    ("SP500",      "S&P 500",        "^GSPC"),
    ("DJIA",       "Dow Jones",      "^DJI"),
    ("NASDAQ",     "Nasdaq",         "^IXIC"),
    ("FTSE100",    "FTSE 100",       "^FTSE"),
    ("DAX",        "DAX",            "^GDAXI"),
    ("CAC40",      "CAC 40",         "^FCHI"),
    ("NIKKEI225",  "Nikkei 225",     "^N225"),
    ("HANGSENG",   "Hang Seng",      "^HSI"),
    ("SHANGHAI",   "Shanghai",       "000001.SS"),
    ("STOXX50E",   "Euro Stoxx 50",  "^STOXX50E"),
]
# US-listed depository receipts (ADRs) of Indian companies (Depository tab).
# Plain US tickers — priced in USD, no .NS suffix.
_DR_INDICES = [
    ("INFY",  "Infosys",     "INFY"),
    ("WIT",   "Wipro",       "WIT"),
    ("IBN",   "ICICI Bank",  "IBN"),
    ("HDB",   "HDFC Bank",   "HDB"),
    ("RDY",   "Dr Reddy's",  "RDY"),
    ("MMYT",  "MakeMyTrip",  "MMYT"),
    ("WNS",   "WNS",         "WNS"),
    ("SIFY",  "Sify",        "SIFY"),
]
# Category → index list. "domestic" keeps the historic default behaviour.
# Currencies (INR crosses + dollar index + BTC) and commodities — same
# (key, name, yf_sym) shape, mainly for the configurable ticker strip.
_CURRENCY_LIST = [
    ("USDINR", "USD/INR", "USDINR=X"),
    ("EURINR", "EUR/INR", "EURINR=X"),
    ("GBPINR", "GBP/INR", "GBPINR=X"),
    ("JPYINR", "JPY/INR", "JPYINR=X"),
    ("DXY",    "Dollar Index", "DX-Y.NYB"),
    ("BTCUSD", "Bitcoin", "BTC-USD"),
]
_COMMODITY_LIST = [
    ("GOLD",   "Gold",       "GC=F"),
    ("SILVER", "Silver",     "SI=F"),
    ("BRENT",  "Brent Crude", "BZ=F"),
    ("WTI",    "WTI Crude",  "CL=F"),
    ("NATGAS", "Natural Gas", "NG=F"),
    ("COPPER", "Copper",     "HG=F"),
]

_INDEX_LISTS = {
    "domestic":      _MAJOR_INDICES,
    "international": _INTL_INDICES,
    "depository":    _DR_INDICES,
    "currency":      _CURRENCY_LIST,
    "commodity":     _COMMODITY_LIST,
}
# Per-category cache: category → {"ts": float, "data": [...]}
_indices_cache = {}
_INDICES_TTL = 300   # 5 minutes


# NSE publishes every one of its indices in a single call, and it is the
# exchange's own number. Yahoo has quietly stopped updating several of the
# ^CNX* sector tickers: on the Saturday this was written NIFTY Auto, FMCG,
# Metal, Energy, Realty and Midcap were all SIX WEEKS stale there, and the
# rest were a day behind — the strip showed NIFTY 50 at Thursday's 24,090.85
# and called it −0.48% while NSE had Friday's close at 24,175.65, +0.35%.
#
# BSE SENSEX is not an NSE index and has no entry here; it stays on Yahoo, and
# the tile says so when it ends up a session behind the rest of the strip.
_NSE_INDEX_NAMES = {
    "NIFTY50": "NIFTY 50",
    "BANKNIFTY": "NIFTY BANK",
    "NIFTYIT": "NIFTY IT",
    "NIFTYAUTO": "NIFTY AUTO",
    "NIFTYPHARMA": "NIFTY PHARMA",
    "NIFTYFMCG": "NIFTY FMCG",
    "NIFTYMETAL": "NIFTY METAL",
    "NIFTYENERGY": "NIFTY ENERGY",
    "NIFTYREALTY": "NIFTY REALTY",
    "NIFTYMIDCAP": "NIFTY MIDCAP 100",
    "NIFTYNEXT50": "NIFTY NEXT 50",
}
_NSE_IDX_TTL = 120
_nse_idx_cache = {"ts": 0.0, "rows": {}}
_nse_idx_lock = threading.Lock()


def _nse_all_indices():
    """NSE's index feed keyed by index name. Cached, and never raises.

    On failure the last good copy is returned rather than an empty dict: a
    throttled call must not silently hand the strip back to a stale Yahoo
    ticker, which is the exact failure this exists to correct.
    """
    with _nse_idx_lock:
        if _nse_idx_cache["rows"] and time.time() - _nse_idx_cache["ts"] < _NSE_IDX_TTL:
            return _nse_idx_cache["rows"]
    rows = {}
    try:
        data = nse_get("/api/allIndices", retries=1)
        for r in (data or {}).get("data") or []:
            nm = (r.get("indexSymbol") or r.get("index") or "").strip().upper()
            if nm and _finite(r.get("last")):
                rows[nm] = r
    except Exception as e:
        log.debug("NSE allIndices failed: %s", e)
    with _nse_idx_lock:
        if rows:
            _nse_idx_cache["rows"] = rows
            _nse_idx_cache["ts"] = time.time()
        return _nse_idx_cache["rows"]


def _nse_index_row(key):
    """Level + day change for one index, from the exchange, or None."""
    nm = _NSE_INDEX_NAMES.get(key)
    if not nm:
        return None
    r = _nse_all_indices().get(nm)
    if not r:
        return None
    last = _finite(r.get("last"))
    if not last or last <= 0:
        return None
    chg = _finite(r.get("percentChange"))
    if chg is None:
        prev = _finite(r.get("previousClose"))
        chg = round((last / prev - 1) * 100, 2) if prev else None
    # The feed carries no per-row date; a level read from it belongs to the
    # session in progress, or to the last one that closed.
    return {"level": round(last, 2), "chg": chg,
            "session": _holidays.last_session()}


def _fetch_index_row(key, name, yf_sym):
    """One index snapshot: last close, % day change, % 1-year return.

    Tolerates short-history symbols (some ADRs/foreign tickers): `level` is
    always computed, while `chg`/`y1` fall back to None when there aren't
    enough closes to compute them.
    """
    # Guarded: ydata.history promises not to raise, but that promise starts
    # AFTER yfinance imports, and a Yahoo that is missing or broken must not
    # take out an index NSE is publishing perfectly well. The overlay below is
    # the whole point — it can build a row from nothing but the exchange.
    df = None
    try:
        import ydata
        df = ydata.history(yf_sym, "1y", "1d", auto_adjust=False)
    except Exception as e:
        log.debug("YF history failed for %s: %s", yf_sym, e)
    row = {"key": key, "name": name, "symbol": yf_sym,
           "level": None, "chg": None, "y1": None, "session": None}
    first = None
    if df is not None and not df.empty:
        closes = df["Close"].dropna()
        last = _finite(closes.iloc[-1]) if len(closes) else None
        if last and last > 0:
            prev = _finite(closes.iloc[-2]) if len(closes) >= 2 else None
            first = _finite(closes.iloc[0]) if len(closes) >= 2 else None
            # A year of closes means the last two rows are always two real
            # sessions — which is why the index tiles kept showing a genuine
            # move over a weekend while every other card read +0.00%.
            try:
                row["session"] = pd.to_datetime(closes.index[-1]).strftime("%Y-%m-%d")
            except Exception:
                pass
            row["level"] = round(last, 2)
            row["chg"] = round((last / prev - 1) * 100, 2) if prev else None
            row["y1"] = round((last / first - 1) * 100, 1) if first else None
    live = _nse_index_row(key)
    if live and (live["session"] or "") > (row["session"] or ""):
        row["level"] = live["level"]
        row["chg"] = live["chg"]
        row["session"] = live["session"]
        # Recompute the 1-year figure against the level actually shown, or the
        # tile would pair today's number with last month's return.
        if first:
            row["y1"] = round((live["level"] / first - 1) * 100, 1)
    return row


_INDICES_STALE_TTL = 60   # re-check cadence while a feed is behind the session


def _mark_stale(rows):
    """Flag every row whose session is behind the last one that traded.

    An absolute test, not a comparison against the other rows: when a whole
    feed stops updating, "behind its neighbours" marks nothing at all, which is
    precisely the case that needs marking.
    """
    last = _holidays.last_session()
    for r in (rows or []):
        sess = r.get("session")
        r["stale"] = bool(sess and sess < last)
    return rows


def _indices_behind(rows):
    """True when the strip as a whole has not caught up to the last session."""
    return (_indices_session(rows) or "") < _holidays.last_session()


def _indices_session(rows):
    """The most recent session in the list.

    Not a majority: this list mixes sources, and when half the rows came from
    a feed that had stopped updating, a majority vote labelled the whole strip
    with the stale date. The card reports the freshest session it holds, and a
    row behind it carries its own stamp so the tile is not read as current.
    """
    stamps = [r.get("session") for r in (rows or []) if r.get("session")]
    return max(stamps) if stamps else None


@app.route("/indices")
def indices_live():
    """Index levels, cached 5 minutes per category.

    ?category= selects the list: domestic (default — NSE/BSE sectors the
    Dashboard depends on), international (major global indices), or depository
    (US-listed Indian ADRs). Each category is cached separately; only the
    domestic set is persisted as a daily snapshot.
    """
    category = request.args.get("category", "domestic").strip().lower()
    if category not in _INDEX_LISTS:
        category = "domestic"
    now = time.time()
    entry = _indices_cache.get(category)
    # A payload that has not caught up to the last completed session gets a
    # much shorter life, so every load re-checks it instead of sitting on it
    # for the full five minutes. Shortening the TTL rather than bypassing the
    # cache is deliberate: an index that upstream simply never updates (a
    # delisted ticker, a feed that has gone quiet) must not turn every page
    # load into a fetch.
    ttl = _INDICES_TTL
    if entry is not None and entry["data"] and _indices_behind(entry["data"]):
        ttl = _INDICES_STALE_TTL
    cached = entry is not None and entry["data"] is not None and (now - entry["ts"]) < ttl
    if not cached:
        # Stale-while-revalidate: 12 serial 1-year yfinance fetches took
        # 10-25 s and the dashboard's index strip blocked on them every time
        # the 5-min TTL lapsed. If we hold ANY previous snapshot, return it
        # immediately and refresh in a background thread (single-flight);
        # only a truly cold process pays the fetch — and pays it in parallel.
        if entry is not None and entry["data"]:
            if not _indices_refreshing.get(category):
                _indices_refreshing[category] = True
                threading.Thread(
                    target=_refresh_indices, args=(category,), daemon=True
                ).start()
            prev = dict(entry)
            return jsonify({"indices": _mark_stale(prev["data"]),
                            "asof": int(time.time()),
                            "session": _indices_session(prev["data"]),
                            "cached": True, "stale": True})
        _refresh_indices(category)
        entry = _indices_cache[category]
    return jsonify({"indices": _mark_stale(entry["data"]),
                    "asof": int(time.time()),
                    "session": _indices_session(entry["data"]),
                    "cached": cached})


_indices_refreshing = {}   # category -> bool (single-flight guard)


def _refresh_indices(category):
    """Fetch every index in a category in parallel and swap the cache."""
    from concurrent.futures import ThreadPoolExecutor
    try:
        items = _INDEX_LISTS[category]

        def one(args):
            key, name, yf_sym = args
            try:
                row = _fetch_index_row(key, name, yf_sym)
                row["category"] = category
                return row
            except Exception as e:
                log.debug("Index fetch failed for %s: %s", yf_sym, e)
                return None

        with ThreadPoolExecutor(max_workers=8) as pool:
            rows = [r for r in pool.map(one, items) if r is not None]
        now = time.time()
        _indices_cache[category] = {"ts": now, "data": rows}
        # Persist a daily history point per index (domestic only, throttled to
        # once/hour) so the app builds a real long-run series over time.
        if category == "domestic":
            try:
                last = _store.kv_get("indices_snap_ts", 0)
                if now - last > 3600:
                    for r in rows:
                        _store.snap_put("index", r["key"], {"level": r.get("level"), "chg": r.get("chg")})
                    _store.kv_set("indices_snap_ts", int(now))
            except Exception as e:
                log.debug("index snapshot failed: %s", e)
    finally:
        _indices_refreshing[category] = False


# ── corporate / institutional data (NSE public feeds, injected fetch) ──
def _corp_fetch(url):
    """GET a full NSE URL via the warmed session; returns decoded JSON."""
    s = nse_session()
    for _ in range(2):
        try:
            r = s.get(url, timeout=12)
            if r.status_code == 200:
                return r.json()
        except Exception:
            pass
        _reset_session()
        s = nse_session()
    raise RuntimeError("NSE corporate fetch failed")


@app.route("/corporate/announcements")
@rate_limit("corp", 60, 300)
def corp_announcements():
    sym = request.args.get("symbol", "").strip().upper()
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    return jsonify(_corp.announcements(sym, _corp_fetch))


@app.route("/corporate/actions")
@rate_limit("corp", 60, 300)
def corp_actions():
    sym = request.args.get("symbol", "").strip().upper()
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    return jsonify(_corp.actions(sym, _corp_fetch))


@app.route("/corporate/calendar")
@rate_limit("corp", 60, 300)
def corp_calendar():
    """Upcoming corporate actions across the whole market.

    /corporate/actions answers "what is coming for THIS company". A desk needs
    the other question — what is coming at all — which is a different NSE feed
    and the one the Desk landing page is built on.
    """
    days = request.args.get("days", 30, type=int)
    # The public issues come from the feed /ipos already serves — same rows,
    # same ranking, same last-good-on-disk cache, one NSE round trip instead of
    # two. Sharing the ranking is the point: the two views disagreed on screen
    # about which issues were still open.
    return jsonify(_corp.calendar(_corp_fetch, days, _ipo_items()))


@app.route("/corporate/shareholding")
@rate_limit("corp", 60, 300)
def corp_shareholding():
    sym = request.args.get("symbol", "").strip().upper()
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    return jsonify(_corp.shareholding(sym, _corp_fetch))


@app.route("/corporate/deals")
@rate_limit("corp", 60, 300)
def corp_deals():
    return jsonify(_corp.deals(_corp_fetch))


# ── Derivatives (F&O option chain) ──
@app.route("/derivatives/option-chain")
@rate_limit("deriv", 60, 300)
def deriv_option_chain():
    """Option-chain ladder + PCR / max-pain / ATM IV for an index or equity.
    Sourced live from NSE's public option-chain feed (best from an Indian IP)."""
    sym = request.args.get("symbol", "NIFTY").strip().upper()
    expiry = request.args.get("expiry", "").strip() or None
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    return jsonify(_deriv.option_chain(sym, _corp_fetch, expiry=expiry))


# ── Portfolio risk ──
def _closes(sym, period="1y"):
    """Daily closing prices for a symbol as a plain list (newest last)."""
    import ydata
    df = ydata.history(f"{sym}.NS", period, "1d")
    if df is None or df.empty:
        return []
    return [float(x) for x in df["Close"].tolist() if x == x]


@app.route("/risk/portfolio", methods=["POST"])
@rate_limit("risk", 30, 300)
def risk_portfolio():
    """Risk report for a set of holdings. Body: {holdings:[{symbol,qty}],
    benchmark?:"NIFTY 50", conf?:0.95}. Fetches 1Y daily closes per symbol and
    a benchmark index, then runs the pure analytics in risk.py."""
    body = request.get_json(silent=True) or {}
    holdings = body.get("holdings") or []
    holdings = [{"symbol": str(h.get("symbol", "")).upper().strip(), "qty": h.get("qty", 0)}
                for h in holdings if str(h.get("symbol", "")).strip()]
    if not holdings:
        return jsonify({"ok": False, "reason": "no holdings"}), 400
    try:
        conf = float(body.get("conf", 0.95))
    except Exception:
        conf = 0.95
    conf = min(max(conf, 0.90), 0.99)

    hist = {}
    for h in holdings:
        c = _closes(h["symbol"])
        if c:
            hist[h["symbol"]] = c

    # Benchmark: NIFTY index via ^NSEI so beta is against the market. Reuse the
    # shared, cached, rate-limit-aware benchmark loader (previously this raised
    # NameError — yf was never imported here — so every holding came back as
    # symbols_missing).
    idx = _bench_closes() or None

    report = _risk.analyze(holdings, hist, index_prices=idx, conf=conf)
    report["symbols_priced"] = list(hist.keys())
    report["symbols_missing"] = [h["symbol"] for h in holdings if h["symbol"] not in hist]
    return jsonify(report)


# ── Grounded entity graph (institutional link analysis) ──
@app.route("/entity-graph")
@rate_limit("corp", 60, 300)
def entity_graph_route():
    """Grounded institution⇄company graph from NSE bulk/block deal records.
    Optional views: ?entity=<name> for one institution's positions, ?symbol=
    for all institutions active in a stock. Every edge carries citations."""
    graph = _egraph.build_flows(_corp.deals(_corp_fetch))
    entity = request.args.get("entity", "").strip()
    symbol = request.args.get("symbol", "").strip().upper()
    if entity:
        return jsonify({"view": "entity", "entity": entity,
                        "positions": _egraph.entity_positions(graph, entity),
                        "asof": graph["asof"], "source": graph["source"]})
    if symbol:
        return jsonify({"view": "symbol", "symbol": symbol,
                        "flows": _egraph.symbol_flows(graph, symbol),
                        "asof": graph["asof"], "source": graph["source"]})
    # Overview: ranked entities + the strongest edges, trimmed for payload size.
    graph["nodes"]["entities"] = _egraph.top_entities(graph, 40)
    graph["edges"] = graph["edges"][:120]
    return jsonify(graph)


@app.route("/promoter-graph")
@rate_limit("corp", 60, 300)
def promoter_graph_route():
    """Promoter group → listed company links, from a curated, cited seed of
    public NSE/BSE shareholding-pattern filings. ?symbol=<sym> reverses the
    lookup (which promoter group holds a stock)."""
    symbol = request.args.get("symbol", "").strip()
    if symbol:
        return jsonify({"view": "symbol", "symbol": symbol.upper(),
                        "holders": _affil.promoter_by_symbol(symbol),
                        "source": _affil.promoter_graph()["source"]})
    return jsonify(_affil.promoter_graph())


@app.route("/political-graph")
@rate_limit("corp", 60, 300)
def political_graph_route():
    """Disclosed political funding via electoral bonds (donor side), from the
    ECI/SBI March-2024 release. Amounts are bonds PURCHASED; recipient party is
    not asserted. ?symbol=<sym> filters to a listed company where mapped."""
    symbol = request.args.get("symbol", "").strip()
    if symbol:
        return jsonify({"view": "symbol", "symbol": symbol.upper(),
                        "donors": _affil.political_by_symbol(symbol),
                        "source": _affil.political_graph()["source"]})
    return jsonify(_affil.political_graph())


# ── Server-side alerts (owner-only) ──
def _alert_notify(alert, quote):
    """Deliver a fired alert. Push/email need external services; we POST to an
    ALERT_WEBHOOK if configured, and always log. Non-fatal on failure."""
    app.logger.info("ALERT FIRED %s %s %s (val=%s)", alert.get("symbol"),
                    alert.get("type"), alert.get("value"), alert.get("last_value"))
    hook = os.environ.get("ALERT_WEBHOOK", "").strip()
    if hook:
        try:
            requests.post(hook, json={"alert": alert, "quote": quote}, timeout=6)
        except Exception:
            pass
    # Push to every registered device (no-op until FCM creds are configured).
    try:
        _push.notify_alert(alert, quote)
    except Exception:
        pass


# ── Push notifications: device tokens, dev broadcasts, background evaluator ──
@app.route("/push/register", methods=["POST"])
@rate_limit("push_reg", 60, 300)
def push_register():
    """A device registers its FCM token so alerts + broadcasts can reach it."""
    body = request.get_json(silent=True) or {}
    token = str(body.get("token", "")).strip()
    if not token:
        return jsonify({"ok": False, "reason": "token required"}), 400
    n = _push.register(token, str(body.get("platform", "android")),
                       str(body.get("user_id", "")))
    return jsonify({"ok": True, "count": n, "configured": _push.configured()})


@app.route("/push/unregister", methods=["POST"])
@rate_limit("push_reg", 60, 300)
def push_unregister():
    body = request.get_json(silent=True) or {}
    n = _push.unregister(str(body.get("token", "")).strip())
    return jsonify({"ok": True, "count": n})


@app.route("/push/status")
def push_status():
    return jsonify({"configured": _push.configured(), "devices": len(_push.tokens())})


@app.route("/broadcast", methods=["GET"])
def broadcast_list():
    """Recent dev broadcasts — an in-app announcements inbox (public read)."""
    return jsonify({"items": _push.broadcast_log(50)})


@app.route("/broadcast", methods=["POST"])
@require_owner
@rate_limit("broadcast", 20, 300)
def broadcast_send():
    """Owner-only: push a dev message to every registered device + log it."""
    body = request.get_json(silent=True) or {}
    title = str(body.get("title", "")).strip()
    msg = str(body.get("body", "")).strip()
    if not title and not msg:
        return jsonify({"ok": False, "reason": "title or body required"}), 400
    res = _push.broadcast(title or "TaurEye", msg, body.get("data") or {})
    return jsonify({"ok": True, **res})


# Background alert evaluator: periodically checks server alerts against live
# quotes and fires them (→ webhook + push) so triggers reach the user without
# the app open. Mirrors _warm_scan_loop; started in __main__ and wsgi.py.
ALERT_LOOP = os.environ.get("ALERT_LOOP", "on")
_ALERT_INTERVAL = int(os.environ.get("ALERT_INTERVAL_SEC", "120") or "120")


def _alert_loop():
    time.sleep(20)  # let the service settle before hitting data sources
    while True:
        try:
            syms = _alerts.symbols_watched()
            if syms:
                quotes = {}
                for s in syms[:100]:
                    _fetch_one(s, quotes)
                fired = _alerts.check(quotes, notify=_alert_notify)
                if fired:
                    log.info("Alert loop fired %d alert(s)", len(fired))
        except Exception as e:
            log.warning("Alert loop failed: %s", e)
        time.sleep(_ALERT_INTERVAL)


def start_alert_loop():
    """Start the alert evaluator once (called from __main__ and wsgi.py)."""
    if ALERT_LOOP and ALERT_LOOP.lower() not in ("0", "off", "false", "no"):
        threading.Thread(target=_alert_loop, name="alert-loop", daemon=True).start()


# ── In-app messaging: global room + topic channels + 1:1 DMs ──
@app.route("/chat/identity", methods=["POST"])
@rate_limit("chat_id", 60, 300)
def chat_identity():
    """Create/refresh a device chat account. Blank user_id mints a new one."""
    body = request.get_json(silent=True) or {}
    u = _chat.upsert_user(str(body.get("user_id", "")), str(body.get("handle", "")))
    return jsonify({"ok": True, **u})


@app.route("/chat/users")
def chat_users():
    q = request.args.get("q", "")
    exclude = request.args.get("exclude", "")
    return jsonify({"users": _chat.find_users(q, exclude=exclude)})


@app.route("/chat/dm", methods=["POST"])
@rate_limit("chat_dm", 60, 300)
def chat_dm():
    """Resolve (or open) the 1:1 conversation between two users."""
    body = request.get_json(silent=True) or {}
    a = str(body.get("from", "")).strip()
    b = str(body.get("to", "")).strip()
    if not a or not b or a == b:
        return jsonify({"ok": False, "reason": "from and to required"}), 400
    return jsonify({"ok": True, "conv": _chat.dm_conv(a, b)})


@app.route("/chat/overview")
def chat_overview():
    uid = request.args.get("user_id", "").strip()
    _chat.touch(uid)
    return jsonify(_chat.overview(uid))


@app.route("/chat/messages")
def chat_messages():
    conv = request.args.get("conv", "").strip()
    since = request.args.get("since", "0")
    try:
        since_id = int(since)
    except Exception:
        since_id = 0
    _chat.touch(request.args.get("user_id", "").strip())
    return jsonify({"conv": conv, "messages": _chat.messages(conv, since_id)})


@app.route("/chat/messages", methods=["POST"])
@rate_limit("chat_post", 40, 60)
def chat_post():
    body = request.get_json(silent=True) or {}
    conv = str(body.get("conv", "")).strip()
    uid = str(body.get("user_id", "")).strip()
    msg = _chat.post(conv, uid, str(body.get("text", "")))
    if not msg:
        return jsonify({"ok": False, "reason": "empty or invalid conversation"}), 400
    # DM → push the recipient (no-op until FCM is configured).
    peer = _chat.dm_peer(conv, uid)
    if peer:
        try:
            _push.notify_dm(peer, msg["handle"], msg["text"])
        except Exception:
            pass
    return jsonify({"ok": True, "message": msg})


@app.route("/chat/read", methods=["POST"])
def chat_read():
    body = request.get_json(silent=True) or {}
    _chat.mark_read(str(body.get("user_id", "")).strip(),
                    str(body.get("conv", "")).strip(), body.get("last_id", 0))
    return jsonify({"ok": True})


@app.route("/chat/messages/<int:msg_id>", methods=["DELETE"])
def chat_delete(msg_id):
    body = request.get_json(silent=True) or {}
    uid = str(body.get("user_id", "")).strip()
    is_owner = _owner_session()
    ok = _chat.delete(msg_id, uid, is_owner=is_owner)
    return jsonify({"ok": ok}), (200 if ok else 403)


@app.route("/alerts", methods=["GET"])
@require_owner
def alerts_list():
    return jsonify({"alerts": _alerts.list_alerts()})


@app.route("/alerts", methods=["POST"])
@require_owner
@rate_limit("alerts", 60, 300)
def alerts_create():
    b = request.get_json(silent=True) or {}
    try:
        a = _alerts.create(b.get("symbol"), b.get("type"), b.get("value"), b.get("note", ""))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify({"alert": a})


@app.route("/alerts/<alert_id>", methods=["DELETE"])
@require_owner
def alerts_delete(alert_id):
    return jsonify({"deleted": _alerts.delete(alert_id)})


@app.route("/alerts/<alert_id>/toggle", methods=["POST"])
@require_owner
def alerts_toggle(alert_id):
    b = request.get_json(silent=True) or {}
    return jsonify({"ok": _alerts.set_active(alert_id, bool(b.get("active", True)))})


@app.route("/alerts/check", methods=["POST"])
@require_owner
@rate_limit("alerts", 30, 300)
def alerts_check():
    """Fetch live quotes for watched symbols, evaluate alerts, fire the newly
    triggered ones. Returns what fired (and can be polled by the client)."""
    syms = _alerts.symbols_watched()
    quotes = {}
    for s in syms[:100]:
        _fetch_one(s, quotes)
    fired = _alerts.check(quotes, notify=_alert_notify)
    return jsonify({"checked": len(syms), "fired": fired})


# ── Public API keys (owner issues; callers use X-API-Key) ──
@app.route("/apikeys", methods=["GET"])
@require_owner
def apikeys_list():
    return jsonify({"keys": _apikeys.list_keys()})


@app.route("/apikeys", methods=["POST"])
@require_owner
def apikeys_issue():
    b = request.get_json(silent=True) or {}
    raw, rec = _apikeys.issue(b.get("label", ""))
    # raw key is returned exactly once — the client must copy it now.
    return jsonify({"key": raw, "record": rec})


@app.route("/apikeys/<key_id>", methods=["DELETE"])
@require_owner
def apikeys_revoke(key_id):
    return jsonify({"revoked": _apikeys.revoke(key_id)})


def require_api_key(fn):
    import functools

    @functools.wraps(fn)
    def wrapper(*a, **kw):
        rec = _apikeys.verify(request.headers.get("X-API-Key", ""))
        if not rec:
            return jsonify({"error": "invalid-api-key",
                            "detail": "Pass a valid key in the X-API-Key header. "
                                      "The owner issues keys via /apikeys."}), 401
        request._apikey = rec
        return fn(*a, **kw)
    return wrapper


# ── Public data API (v1) — key-gated + rate-limited ──
@app.route("/api/v1/quote")
@require_api_key
@rate_limit("apiv1", 120, 60)
def api_v1_quote():
    raw = request.args.get("symbols", "").strip().upper()
    if not raw:
        return jsonify({"error": "symbols required"}), 400
    syms = [s.strip() for s in raw.split(",") if s.strip()][:50]
    out = {}
    for s in syms:
        _fetch_one(s, out)
    return jsonify({"quotes": out, "count": len(out)})


@app.route("/api/v1/indices")
@require_api_key
@rate_limit("apiv1", 120, 60)
def api_v1_indices():
    # Reuse the live-indices snapshot the app already computes.
    return indices_live()


@app.route("/indices/history")
def indices_history():
    """Persisted level history for one index (from the snapshot store)."""
    key = request.args.get("key", "").strip()
    if not key:
        return jsonify({"error": "key required"}), 400
    return jsonify({"key": key, "series": _store.snap_series("index", key, 400)})


@app.route("/scan")
@rate_limit("scan", 200, 300)
def scan():
    """Live technical indicators per symbol for the screener filter engine.

    Query: ?symbols=A,B,C. Answers from cache WITHOUT blocking on the network:
    anything not yet computed comes back in `pending` and is queued behind the
    response, so a wide universe paints whatever is warm on the first call
    instead of waiting out an upstream fetch per symbol. Poll for the rest.
    """
    raw = request.args.get("symbols", "").strip().upper()
    if not raw:
        return jsonify({"error": "symbols required", "data": {}}), 400
    symbols = [s.strip() for s in raw.split(",") if s.strip()]
    try:
        return jsonify(_scanner.scan(symbols))
    except Exception as e:
        log.error("Scan error: %s", e)
        return jsonify({"error": str(e), "data": {}}), 502


@app.route("/report")
def report():
    """Full AMC-grade investment report for a single NSE symbol."""
    sym = request.args.get("symbol", "").strip().upper()
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    try:
        import yfinance as yf
        import numpy as np
        ticker = yf.Ticker(f"{sym}.NS")
        info   = ticker.info or {}

        def fmt_cr(v):
            if v is None or v == 0: return None
            return round(float(v) / 1e7, 2)

        def pct(v):
            if v is None: return None
            return round(float(v) * 100, 2)

        def r2(v):
            if v is None or v == 0: return None
            try: return round(float(v), 2)
            except: return None

        # ── Multi-year Income Statement ────────────────────────────────────────
        fin_years = []
        try:
            inc = ticker.income_stmt
            if inc is not None and not inc.empty:
                prev_rev = None
                prev_ni  = None
                for col in list(inc.columns)[:4]:
                    yr  = str(col)[:4]
                    rev = inc.loc["Total Revenue",     col] if "Total Revenue"     in inc.index else None
                    ni  = inc.loc["Net Income",        col] if "Net Income"        in inc.index else None
                    ebt = inc.loc["EBITDA",            col] if "EBITDA"            in inc.index else None
                    op  = inc.loc["Operating Income",  col] if "Operating Income"  in inc.index else None
                    ge  = inc.loc["Gross Profit",      col] if "Gross Profit"      in inc.index else None
                    rev_g = round((float(rev)/float(prev_rev)-1)*100,1) if rev and prev_rev and float(prev_rev)>0 else None
                    ni_g  = round((float(ni)/float(prev_ni) -1)*100,1) if ni  and prev_ni  and float(prev_ni) >0 else None
                    nm    = round(float(ni)/float(rev)*100,2)   if ni  and rev  and float(rev) >0 else None
                    om    = round(float(op)/float(rev)*100,2)   if op  and rev  and float(rev) >0 else None
                    gm    = round(float(ge)/float(rev)*100,2)   if ge  and rev  and float(rev) >0 else None
                    fin_years.append({"year":yr,"revenue":fmt_cr(rev),"net_income":fmt_cr(ni),
                                      "ebitda":fmt_cr(ebt),"op_income":fmt_cr(op),"gross_profit":fmt_cr(ge),
                                      "net_margin":nm,"op_margin":om,"gross_margin":gm,
                                      "rev_growth":rev_g,"ni_growth":ni_g})
                    prev_rev, prev_ni = rev, ni
        except Exception as e:
            log.warning("Income stmt error %s: %s", sym, e)

        # ── Quarterly Income Statement (last ~6 quarters) ──────────────────────
        fin_quarters = []
        try:
            qinc = ticker.quarterly_income_stmt
            if qinc is not None and not qinc.empty:
                prev_rev = prev_ni = None
                for col in list(qinc.columns)[:6]:
                    q   = str(col)[:10]
                    rev = qinc.loc["Total Revenue",    col] if "Total Revenue"    in qinc.index else None
                    ni  = qinc.loc["Net Income",       col] if "Net Income"       in qinc.index else None
                    op  = qinc.loc["Operating Income", col] if "Operating Income" in qinc.index else None
                    # QoQ growth (statements are newest-first, so prev is the NEXT col)
                    fin_quarters.append({"period": q, "revenue": fmt_cr(rev),
                                         "net_income": fmt_cr(ni), "op_income": fmt_cr(op)})
        except Exception as e:
            log.warning("Quarterly stmt error %s: %s", sym, e)

        # ── Balance Sheet ──────────────────────────────────────────────────────
        bs = {}
        try:
            bal = ticker.balance_sheet
            if bal is not None and not bal.empty:
                c = bal.columns[0]
                def bv(k): return bal.loc[k, c] if k in bal.index else None
                bs = {
                    "total_debt":     fmt_cr(bv("Total Debt")),
                    "long_term_debt": fmt_cr(bv("Long Term Debt")),
                    "current_debt":   fmt_cr(bv("Current Debt")),
                    "total_assets":   fmt_cr(bv("Total Assets")),
                    "equity":         fmt_cr(bv("Stockholders Equity")),
                    "cash":           fmt_cr(bv("Cash And Cash Equivalents")),
                    "inventory":      fmt_cr(bv("Inventory")),
                    "receivables":    fmt_cr(bv("Accounts Receivable")),
                }
        except Exception as e:
            log.warning("Balance sheet error %s: %s", sym, e)

        # ── Shareholding (best-effort from Yahoo held-percentages) ─────────────
        shareholding = {
            "insiders_pct":     pct(info.get("heldPercentInsiders")),
            "institutions_pct": pct(info.get("heldPercentInstitutions")),
        }

        # ── Cash Flow ──────────────────────────────────────────────────────────
        cf = {}
        try:
            cfs = ticker.cashflow
            if cfs is not None and not cfs.empty:
                c = cfs.columns[0]
                def cv(k): return cfs.loc[k, c] if k in cfs.index else None
                ocf   = cv("Operating Cash Flow")
                fcf   = cv("Free Cash Flow")
                capex = cv("Capital Expenditure")
                cf = {
                    "ocf":   fmt_cr(ocf),
                    "fcf":   fmt_cr(fcf),
                    "capex": fmt_cr(abs(float(capex)) if capex is not None else None),
                    "ocf_margin": round(float(ocf)/float(fin_years[0]["revenue"])*100/1e7,2)
                                  if ocf and fin_years and fin_years[0].get("revenue") else None,
                }
        except Exception as e:
            log.warning("Cash flow error %s: %s", sym, e)

        # ── Technical Levels (1Y daily) ────────────────────────────────────────
        tech = {}
        try:
            import ydata
            hist = ydata.history(f"{sym}.NS", "1y", "1d")
            if hist is not None and not hist.empty:
                cl  = hist["Close"].dropna()
                hi  = hist["High"].dropna()
                lo  = hist["Low"].dropna()
                vol = hist["Volume"].dropna()
                cur = float(cl.iloc[-1])
                h52 = float(hi.max())
                l52 = float(lo.min())

                ma20  = float(cl.tail(20).mean())  if len(cl) >= 20  else None
                ma50  = float(cl.tail(50).mean())  if len(cl) >= 50  else None
                ma200 = float(cl.tail(200).mean()) if len(cl) >= 200 else None

                delta    = cl.diff()
                gain     = delta.clip(lower=0)
                loss     = -delta.clip(upper=0)
                ag       = gain.ewm(span=14, adjust=False).mean()
                al       = loss.ewm(span=14, adjust=False).mean()
                rsi_val  = float(100 - 100 / (1 + ag.iloc[-1] / al.iloc[-1])) if float(al.iloc[-1]) > 0 else 100.0

                tr_df = pd.concat([hi - lo, (hi - cl.shift()).abs(), (lo - cl.shift()).abs()], axis=1).max(axis=1)
                atr   = float(tr_df.tail(14).mean())

                dr        = cl.pct_change().dropna()
                vol_ann   = round(float(dr.std() * (252 ** 0.5) * 100), 2)
                sharpe    = round(float(dr.mean() / dr.std() * (252 ** 0.5)), 2) if float(dr.std()) > 0 else None

                # Max drawdown over 1Y
                roll_max  = cl.cummax()
                dd_series = (cl - roll_max) / roll_max * 100
                max_dd    = round(float(dd_series.min()), 2)

                # Pivot supports / resistances (last 90 days)
                r90    = hist.tail(90)
                ph, pl = [], []
                rh_arr = r90["High"].values
                rl_arr = r90["Low"].values
                for i in range(2, len(rh_arr) - 2):
                    if rh_arr[i] > rh_arr[i-1] and rh_arr[i] > rh_arr[i-2] and rh_arr[i] > rh_arr[i+1] and rh_arr[i] > rh_arr[i+2]:
                        ph.append(round(float(rh_arr[i]), 2))
                    if rl_arr[i] < rl_arr[i-1] and rl_arr[i] < rl_arr[i-2] and rl_arr[i] < rl_arr[i+1] and rl_arr[i] < rl_arr[i+2]:
                        pl.append(round(float(rl_arr[i]), 2))
                resistances = sorted([x for x in ph if x > cur], key=lambda x: x - cur)[:3]
                supports    = sorted([x for x in pl if x < cur], key=lambda x: cur - x)[:3]

                fib_rng  = h52 - l52
                fibs = {k: round(l52 + v * fib_rng, 2) for k, v in
                        {"0.0":0,"23.6%":0.236,"38.2%":0.382,"50.0%":0.5,"61.8%":0.618,"78.6%":0.786,"100%":1.0}.items()}

                avg_v20  = int(float(vol.tail(20).mean()))
                avg_v3m  = int(float(vol.tail(63).mean()))
                vol_ratio = round(avg_v20 / avg_v3m, 2) if avg_v3m > 0 else None

                tech = {
                    "cur": round(cur, 2), "h52": round(h52, 2), "l52": round(l52, 2),
                    "from_h52": round((cur / h52 - 1) * 100, 2),
                    "from_l52": round((cur / l52 - 1) * 100, 2),
                    "ma20": round(ma20, 2) if ma20 else None,
                    "ma50": round(ma50, 2) if ma50 else None,
                    "ma200": round(ma200, 2) if ma200 else None,
                    "above_ma20": cur > ma20 if ma20 else None,
                    "above_ma50": cur > ma50 if ma50 else None,
                    "above_ma200": cur > ma200 if ma200 else None,
                    "rsi": round(rsi_val, 1),
                    "atr": round(atr, 2),
                    "atr_pct": round(atr / cur * 100, 2) if cur else None,
                    "volatility": vol_ann,
                    "sharpe": sharpe,
                    "max_drawdown": max_dd,
                    "avg_vol_20d": avg_v20,
                    "avg_vol_3m": avg_v3m,
                    "vol_ratio": vol_ratio,
                    "supports": supports,
                    "resistances": resistances,
                    "fibs": fibs,
                }
        except Exception as e:
            log.warning("Technical error %s: %s", sym, e)

        # ── Quality Score ──────────────────────────────────────────────────────
        roe    = pct(info.get("returnOnEquity"))
        roa    = pct(info.get("returnOnAssets"))
        de     = r2(info.get("debtToEquity"))
        cr     = r2(info.get("currentRatio"))
        pe     = r2(info.get("trailingPE"))
        pb     = r2(info.get("priceToBook"))
        nm     = fin_years[0].get("net_margin") if fin_years else None
        rsi_q  = tech.get("rsi", 50) if tech else 50
        from_h = tech.get("from_h52", -100) if tech else -100

        def clamp(v, lo, hi): return max(lo, min(hi, v))

        # Profitability  (0-30)
        prof = 0
        if roe:  prof += 15 if roe > 20 else 10 if roe > 15 else 5 if roe > 10 else 2
        if roa:  prof += 10 if roa > 12 else 7 if roa > 8 else 4 if roa > 4 else 1
        if nm:   prof += 5  if nm > 20  else 4  if nm > 15 else 2  if nm > 8  else 0
        prof = clamp(prof, 0, 30)

        # Financial Health (0-25)
        health = 0
        if de is not None: health += 15 if de < 30 else 10 if de < 70 else 5 if de < 120 else 0
        if cr is not None: health += 10 if cr > 2  else 7  if cr > 1.5 else 4 if cr > 1  else 0
        health = clamp(health, 0, 25)

        # Valuation (0-20)
        val = 0
        if pe and pe > 0: val += 12 if pe < 15 else 9 if pe < 22 else 6 if pe < 35 else 3 if pe < 50 else 0
        if pb and pb > 0: val += 8  if pb < 1.5 else 6 if pb < 2.5 else 4 if pb < 4 else 2 if pb < 6 else 0
        val = clamp(val, 0, 20)

        # Momentum (0-15)
        mom = 0
        if from_h is not None: mom += 15 if from_h > -5 else 11 if from_h > -15 else 7 if from_h > -30 else 3
        if rsi_q:
            if 50 <= rsi_q <= 65: mom = clamp(mom + 0, 0, 15)
            elif rsi_q < 35 or rsi_q > 75: mom = clamp(mom - 2, 0, 15)
        mom = clamp(mom, 0, 15)

        # Dividend (0-10)
        dy   = pct(info.get("dividendYield"))
        div  = (10 if dy and dy > 4 else 7 if dy and dy > 2 else 4 if dy and dy > 1 else 1) if dy else 0

        total_score = clamp(prof + health + val + mom + div, 0, 100)
        breakdown   = {"Profitability": prof, "Financial Health": health,
                       "Valuation": val, "Momentum": mom, "Dividend": div}
        maxes       = {"Profitability": 30, "Financial Health": 25,
                       "Valuation": 20, "Momentum": 15, "Dividend": 10}

        grade  = ("AAA" if total_score >= 85 else "AA" if total_score >= 75 else
                  "A"   if total_score >= 65 else "BBB" if total_score >= 55 else
                  "BB"  if total_score >= 45 else "B")
        rec    = ("STRONG BUY" if total_score >= 80 else "BUY" if total_score >= 65 else
                  "HOLD" if total_score >= 50 else "AVOID")
        rec_color = {"STRONG BUY":"#10b981","BUY":"#22c55e","HOLD":"#f59e0b","AVOID":"#f43f5e"}[rec]

        mcap_cr = fmt_cr(info.get("marketCap"))
        mcap_cat = ("Large Cap" if mcap_cr and mcap_cr > 20000 else
                    "Mid Cap"   if mcap_cr and mcap_cr > 5000  else "Small Cap")

        # Valuation is computed here, from values already in hand, so the
        # dossier gets it without a second round trip. Best-effort: a valuation
        # that cannot be built must never cost the reader the rest of the report.
        #
        # EVERY input falls back to the fundamentals cache. All of these used to
        # be read from the yfinance `info` blob alone — which is precisely the
        # call that gets rate-limited from a cloud IP. When it came back thin,
        # the whole valuation section rendered as em-dashes: no earnings yield,
        # no book value, no PEG, no EV multiples — while the fundamentals card
        # an inch above it showed a full P/E and P/B from a different, cached,
        # far more reliable source. Deriving a yield needs the same P/E either
        # way, so there is no reason for one panel to know it and the other not.
        try:
            _fc = _fund.get_one(sym) or {}
            # A THIRD source. The dossier's own tiles are rendered from the
            # multibagger engine's metrics, which is a separate call the client
            # makes — so this route could report "not enough reported data to
            # value this company" while the tiles an inch above it displayed
            # the very market cap and free cash flow it said were missing.
            # Only fetched when something is actually absent, since it is real
            # network I/O and the dossier already does plenty.
            _mm = {}
            if (mcap_cr is None or (cf or {}).get("fcf") is None
                    or _fc.get("market_cap_cr") is None or _fc.get("fcf_cr") is None):
                try:
                    import multibagger as _mb
                    _mm = (_mb.fetch_metrics(sym, with_history=False) or (None,))[0] or {}
                except Exception:
                    _mm = {}

            def _pick(*vals):
                for v in vals:
                    if v is not None:
                        return v
                return None

            _px = r2(info.get("currentPrice") or info.get("regularMarketPrice")) \
                or (tech or {}).get("price")
            _latest = (fin_years or [{}])[0] if fin_years else {}
            _sec_name = (_sectors.sector_of(sym, info.get("sector")) or info.get("sector")
                         or _fc.get("sector"))
            valuation = _valuation.value(
                price=_px,
                eps=_pick(r2(info.get("trailingEps")), _fc.get("eps")),
                pe=_pick(pe, _fc.get("pe"), _mm.get("pe")),
                pb=_pick(pb, _fc.get("pb"), _mm.get("pb")),
                market_cap_cr=_pick(mcap_cr, _fc.get("market_cap_cr"), _mm.get("mcap_cr")),
                fcf_cr=_pick((cf or {}).get("fcf"), _fc.get("fcf_cr"), _mm.get("fcf_cr")),
                ocf_cr=_pick((cf or {}).get("ocf"), _fc.get("ocf_cr")),
                total_debt_cr=_pick((bs or {}).get("total_debt"), _mm.get("total_debt_cr")),
                cash_cr=(bs or {}).get("cash"),
                revenue_cr=_pick(_latest.get("revenue"), _fc.get("revenue_cr")),
                op_income_cr=_latest.get("op_income"),
                dividend_yield_pct=_pick(dy, _fc.get("dividend_yield")),
                earnings_growth_pct=_pick(pct(info.get("earningsGrowth")),
                                          _fc.get("earnings_growth_pct"),
                                          _mm.get("earnings_growth_pct")),
                fin_years=fin_years,
                roe_pct=_pick(roe, _fc.get("roe"), _mm.get("roe_pct")),
                sector=_sec_name, peers=(_fund.sector_medians() or {}).get(_sec_name))
        except Exception as e:
            log.warning("Valuation failed for %s: %s", sym, e)
            valuation = None

        return _no_cache(jsonify({
            "symbol": sym,
            "name": info.get("longName") or info.get("shortName", sym),
            "sector": _sectors.sector_of(sym, info.get("sector")) or info.get("sector"),
            "industry": info.get("industry"),
            "market_cap_cr": mcap_cr,
            "market_cap_cat": mcap_cat,
            "exchange": info.get("exchange"),
            # Valuation
            "pe": pe, "forward_pe": r2(info.get("forwardPE")),
            "pb": pb, "ps": r2(info.get("priceToSalesTrailing12Months")),
            "ev_ebitda": r2(info.get("enterpriseToEbitda")),
            "ev_revenue": r2(info.get("enterpriseToRevenue")),
            "peg": r2(info.get("pegRatio")),
            "eps": r2(info.get("trailingEps")),
            "dividend_yield": dy,
            "payout_ratio": pct(info.get("payoutRatio")),
            # Profitability
            "roe": roe, "roa": roa,
            "gross_margin": pct(info.get("grossMargins")),
            "op_margin": pct(info.get("operatingMargins")),
            "profit_margin": pct(info.get("profitMargins")),
            "rev_growth": pct(info.get("revenueGrowth")),
            "earn_growth": pct(info.get("earningsGrowth")),
            # Health
            "debt_equity": de, "current_ratio": cr,
            "quick_ratio": r2(info.get("quickRatio")),
            "interest_coverage": r2(info.get("ebitdaMargins")),
            # Risk
            "beta": r2(info.get("beta")),
            "avg_volume": info.get("averageVolume"),
            "float_shares": info.get("floatShares"),
            # Price levels
            "week52_high": r2(info.get("fiftyTwoWeekHigh")),
            "week52_low":  r2(info.get("fiftyTwoWeekLow")),
            "target_price": r2(info.get("targetMeanPrice")),
            "target_high":  r2(info.get("targetHighPrice")),
            "target_low":   r2(info.get("targetLowPrice")),
            "analyst_count": info.get("numberOfAnalystOpinions"),
            "rec_rating": info.get("recommendationMean"),
            # Description
            "description": (info.get("longBusinessSummary") or "")[:900],
            # Multi-year
            "fin_years": fin_years,
            "fin_quarters": fin_quarters,
            "shareholding": shareholding,
            "balance_sheet": bs,
            "cash_flow": cf,
            # Technical
            "technical": tech,
            # Score
            "quality_score": total_score,
            "score_breakdown": breakdown,
            "score_maxes": maxes,
            "grade": grade,
            "recommendation": rec,
            "rec_color": rec_color,
            "valuation": valuation,
        }))
    except Exception as e:
        log.error("Report error for %s: %s", sym, e)
        return jsonify({"error": str(e)}), 502


_TF_CACHE = {}
_TF_TTL = 180  # 3 min — intraday reads move fast but not every second


@app.route("/timeframes")
def timeframes_route():
    """Multi-timeframe trade analysis (5-min → weekly + near/far horizons)."""
    sym = request.args.get("symbol", "").strip().upper().replace("NSE:", "").replace("BSE:", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    cached = _TF_CACHE.get(sym)
    if cached and time.time() - cached[0] < _TF_TTL:
        return jsonify(cached[1])
    try:
        import timeframes as _tf
        payload = _tf.analyse(sym)
        _TF_CACHE[sym] = (time.time(), payload)
        return jsonify(payload)
    except Exception as e:
        log.error("timeframes error %s: %s", sym, e)
        return jsonify({"error": f"Couldn't analyse timeframes for {sym} — try again shortly."}), 503


_STRAT_CACHE = {}
_STRAT_TTL = 600  # 10 min


@app.route("/strategy-scores")
def strategy_scores_route():
    """Per-strategy scorecard for one symbol (Minervini, momentum, breakout,
    candlestick, growth, FCF, debt, value, multibagger) — shown in every popup."""
    sym = request.args.get("symbol", "").strip().upper().replace("NSE:", "").replace("BSE:", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    cached = _STRAT_CACHE.get(sym)
    if cached and time.time() - cached[0] < _STRAT_TTL:
        return jsonify(cached[1])
    try:
        import strategy_scores
        payload = strategy_scores.analyse(sym)
        _STRAT_CACHE[sym] = (time.time(), payload)
        return jsonify(payload)
    except Exception as e:
        log.error("strategy-scores error %s: %s", sym, e)
        return jsonify({"error": f"Couldn't score {sym} right now — try again shortly."}), 503


_CHK_CACHE = {}
_CHK_TTL = 6 * 3600  # financials change quarterly — cache for hours


@app.route("/checklist")
def checklist_route():
    """10-point fundamental checklist for one symbol (3-yr sales/PAT/EPS CAGR,
    EPS growth, P/E, PEG, operating cash flow, OCF/PAT, debt, interest coverage)
    — shown in the dossier + multibagger analyser."""
    sym = request.args.get("symbol", "").strip().upper().replace("NSE:", "").replace("BSE:", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    cached = _CHK_CACHE.get(sym)
    if cached and time.time() - cached[0] < _CHK_TTL:
        return jsonify(cached[1])
    try:
        import checklist as _cl
        payload = _cl.analyse(sym)
        if payload.get("items"):
            _CHK_CACHE[sym] = (time.time(), payload)
        return jsonify(payload)
    except Exception as e:
        log.error("checklist error %s: %s", sym, e)
        return jsonify({"error": f"Couldn't build the checklist for {sym} — try again shortly."}), 503


_SCR_CACHE = {}
_SCR_TTL = 6 * 3600  # shareholding/balance change quarterly — cache for hours


@app.route("/screener-financials")
def screener_financials():
    """On-demand screener.in scrape: real promoter/FII/DII shareholding + borrowings."""
    sym = request.args.get("symbol", "").strip().upper().replace("NSE:", "").replace("BSE:", "")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    cached = _SCR_CACHE.get(sym)
    if cached and time.time() - cached[0] < _SCR_TTL:
        return jsonify(cached[1])
    try:
        import screenerin
        payload = screenerin.financials(sym)
        if payload.get("ok"):
            _SCR_CACHE[sym] = (time.time(), payload)
        return jsonify(payload)
    except Exception as e:
        log.error("screener-financials error %s: %s", sym, e)
        return jsonify({"error": f"Couldn't reach screener.in for {sym} — try again shortly.", "ok": False}), 503


def _prefetch_universe():
    """Background prefetch so first /universe call is instant."""
    try:
        get_universe()
    except Exception as e:
        log.warning("Prefetch failed: %s", e)


@app.route("/api/analyze", methods=["POST", "OPTIONS"])
def analyze():
    if request.method == "OPTIONS":
        return jsonify({}), 200
    body      = request.get_json(force=True, silent=True) or {}
    sym       = body.get("symbol", "").strip().upper()
    timeframe = body.get("timeframe", "5m")
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    try:
        import yfinance as yf
        import numpy as np

        period_map = {"1m": "5d", "5m": "60d", "15m": "60d", "1h": "2y", "1d": "5y", "1wk": "max", "1mo": "max"}
        yf_period  = period_map.get(timeframe, "60d")
        yf_sym     = sym if sym.startswith("^") else f"{sym}.NS"

        df = None
        if timeframe in ("1m", "5m", "15m"):
            df = _fetch_tv_data(sym, timeframe, yf_period)
        if df is None or df.empty:
            ticker = yf.Ticker(yf_sym)
            df = ticker.history(period=yf_period, interval=timeframe, auto_adjust=True)
        if df is None or df.empty:
            return jsonify({"error": f"No data for {sym}"}), 404

        df = df.dropna(subset=["Close"])
        n  = len(df)
        if n < 30:
            return jsonify({"error": "Insufficient data for analysis"}), 422

        closes = df["Close"].values.astype(float)
        highs  = df["High"].values.astype(float)
        lows   = df["Low"].values.astype(float)
        opens  = df["Open"].values.astype(float)
        vols   = df["Volume"].values.astype(float)

        last_c = closes[-1]; last_h = highs[-1]; last_l = lows[-1]; last_o = opens[-1]

        # ── ATR(14) ──────────────────────────────────────────────────────
        tr = np.maximum(highs[1:] - lows[1:],
             np.maximum(np.abs(highs[1:] - closes[:-1]),
                        np.abs(lows[1:]  - closes[:-1])))
        atr = float(np.mean(tr[-14:]))

        # ── Swing liquidity levels ────────────────────────────────────────
        lb = min(50, n - 1)
        swing_high = float(np.max(highs[-lb:]))
        swing_low  = float(np.min(lows[-lb:]))
        near_high  = abs(last_c - swing_high) < 0.6 * atr
        near_low   = abs(last_c - swing_low)  < 0.6 * atr

        # ── Displacement (last candle vs ATR) ─────────────────────────────
        disp_ratio = abs(last_c - last_o) / atr if atr > 0 else 1.0
        strong_disp = disp_ratio > 1.4
        disp_up     = last_c > last_o

        # ── VWAP (session bars: 78 for 5m, 26 for 15m, 6 for 1h) ─────────
        vwap_bars = {"5m": 78, "15m": 26, "1h": 6, "1d": 5}.get(timeframe, min(78, n))
        vwap_bars = min(vwap_bars, n)
        tp_vol = ((highs[-vwap_bars:] + lows[-vwap_bars:] + closes[-vwap_bars:]) / 3) * vols[-vwap_bars:]
        vwap   = float(np.sum(tp_vol) / np.sum(vols[-vwap_bars:])) if np.sum(vols[-vwap_bars:]) > 0 else last_c
        above_vwap = last_c > vwap

        # ── EMA alignment ─────────────────────────────────────────────────
        def _ema(arr, w):
            k, e = 2 / (w + 1), arr[0]
            for v in arr[1:]: e = v * k + e * (1 - k)
            return float(e)
        ema9  = _ema(closes[-min(n, 100):], 9)
        ema20 = _ema(closes[-min(n, 100):], 20)
        ema50 = _ema(closes[-min(n, 100):], 50) if n >= 55 else ema20
        bull_align = ema9 > ema20 > ema50
        bear_align = ema9 < ema20 < ema50

        # ── RSI(14) ───────────────────────────────────────────────────────
        d = np.diff(closes[-(14 + 20):])
        avg_g = float(np.mean(np.where(d > 0, d, 0)[-14:]))
        avg_l = float(np.mean(np.where(d < 0, -d, 0)[-14:]))
        rsi   = 100 - 100 / (1 + avg_g / avg_l) if avg_l > 0 else 100.0
        oversold = rsi < 35; overbought = rsi > 65

        # ── Market state ──────────────────────────────────────────────────
        atr_pct = (atr / last_c) * 100
        if bull_align or bear_align:
            mkt = "TRENDING"
        elif atr_pct < 0.25:
            mkt = "CHOP"
        else:
            mkt = "RANGING"

        # ── Trap: wick hunt beyond swing without follow-through ───────────
        prior_h = highs[-6:-1]; prior_l = lows[-6:-1]
        bull_trap = bool(last_h > float(np.max(prior_h)) and last_c < float(np.mean(prior_h)))
        bear_trap = bool(last_l < float(np.min(prior_l)) and last_c > float(np.mean(prior_l)))
        trap = bull_trap or bear_trap

        # ── Volume surge (last bar vs 20-bar avg) ─────────────────────────
        vol_avg   = float(np.mean(vols[-21:-1])) if n > 21 else float(np.mean(vols))
        vol_surge = vols[-1] > 1.8 * vol_avg if vol_avg > 0 else False

        # ── Score ─────────────────────────────────────────────────────────
        score   = 50
        reasons = []

        if strong_disp:
            score += 15
            reasons.append(f"Strong displacement ({disp_ratio:.1f}× ATR)")
        if near_low and not near_high:
            score += 12
            reasons.append("Price at demand zone (swing low)")
        elif near_high and not near_low:
            score += 12
            reasons.append("Price at supply zone (swing high)")
        if vol_surge:
            score += 10
            reasons.append(f"Volume surge ({vols[-1]/vol_avg:.1f}× avg)")
        if above_vwap:
            score += 8
            reasons.append("Price above VWAP — buy bias")
        else:
            score += 5
            reasons.append("Price below VWAP — sell bias")
        if bull_align:
            score += 10; reasons.append("EMAs bullish (9>20>50)")
        elif bear_align:
            score += 10; reasons.append("EMAs bearish (9<20<50)")
        if oversold:
            score += 8;  reasons.append(f"RSI oversold ({rsi:.0f})")
        elif overbought:
            score += 8;  reasons.append(f"RSI overbought ({rsi:.0f})")
        if mkt == "CHOP":
            score -= 15; reasons.append("Choppy price action — low setup quality")
        if trap:
            score -= 12; reasons.append("Liquidity trap detected — trade with caution")

        score = max(0, min(100, int(score)))

        # ── Direction ─────────────────────────────────────────────────────
        long_pts  = sum([above_vwap, bull_align, oversold,  disp_up,     near_low])
        short_pts = sum([not above_vwap, bear_align, overbought, not disp_up, near_high])
        direction = "NONE"
        if score >= 60:
            direction = "LONG" if long_pts >= short_pts else "SHORT"

        confidence = min(100, int(score * 0.65 + abs(long_pts - short_pts) * 8))

        # ── Entry / SL / Targets ──────────────────────────────────────────
        if direction == "LONG":
            entry   = round(last_c, 2)
            sl      = round(last_c - 1.5 * atr, 2)
            risk    = entry - sl
            targets = [round(entry + r * risk, 2) for r in [1.5, 2.5, 4.0]]
        elif direction == "SHORT":
            entry   = round(last_c, 2)
            sl      = round(last_c + 1.5 * atr, 2)
            risk    = sl - entry
            targets = [round(entry - r * risk, 2) for r in [1.5, 2.5, 4.0]]
        else:
            entry   = round(last_c, 2)
            sl      = round(last_c - atr, 2)
            targets = [round(last_c + atr, 2)]

        return jsonify({
            "score":       score,
            "confidence":  confidence,
            "direction":   direction,
            "entry":       entry,
            "stopLoss":    sl,
            "targets":     targets,
            "marketState": mkt,
            "trap":        trap,
            "reason":      reasons,
            "vwap":        round(vwap, 2),
            "rsi":         round(float(rsi), 1),
            "atr":         round(atr, 2),
        })
    except Exception as e:
        log.error("Analyze error %s: %s", sym, e, exc_info=True)
        return jsonify({"error": str(e)}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    threading.Thread(target=_prefetch_universe, daemon=True).start()
    start_scan_warm()
    start_fund_warm()
    start_alert_loop()
    start_backfill()
    print("\n" + "=" * 60)
    print("  QuantHunt — NSE Direct + YF fallback")
    print("  Universe: bhavcopy EQ/BE + NIFTY MICROCAP 250")
    print("  Open  http://localhost:%d" % port)
    print("=" * 60 + "\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
