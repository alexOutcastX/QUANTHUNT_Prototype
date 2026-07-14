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
import scanner as _scanner     # live per-symbol technical scan for the screener
import relations as _relations # curated company-relationship graph (Terminal tab)
import news as _news           # RSS news aggregation (Terminal news panel)
import ai_graph as _ai         # AI-generated relationship graphs (any symbol)
import broker as _broker       # BYOB Zerodha connect (read-only, single user)
import holidays as _holidays   # NSE trading holidays + market open/closed status
import auth as _auth           # owner passcode gate for owner-only endpoints
import store as _store         # SQLite persistence (kv + snapshots)
import corporate as _corp       # corporate actions/announcements/shareholding/deals (NSE)
import derivatives as _deriv     # F&O option-chain analytics (PCR/max-pain/ATM IV) from NSE
import risk as _risk            # portfolio risk analytics (VaR/beta/drawdown/correlation)
import entity_graph as _egraph   # grounded institution⇄company graph from NSE deal records
import alerts as _alerts        # server-side price/technical alerts (store-backed)
import apikeys as _apikeys      # public-API key issue/verify (hashed, store-backed)

# Support both normal run and PyInstaller frozen exe
_BASE_DIR = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
app = Flask(__name__, template_folder=_BASE_DIR, static_folder=_BASE_DIR)
# Same-origin by default; set CORS_ORIGINS (comma-separated) to allow specific
# cross-origin callers. The SPA is served same-origin, so no wildcard needed.
_CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
CORS(app, origins=_CORS_ORIGINS or [], supports_credentials=True)
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

def yf_price(symbol):
    """Fetch price from Yahoo Finance using NSE suffix (.NS)."""
    try:
        yf = yf_session()
        ticker = yf.Ticker(f"{symbol}.NS")
        h = ticker.history(period="2d")
        if h.empty:
            return None
        row = h.iloc[-1]
        prev_row = h.iloc[-2] if len(h) >= 2 else None
        close = float(row["Close"])
        prev  = float(prev_row["Close"]) if prev_row is not None else close
        chg   = round((close - prev) / prev * 100, 2) if prev else 0
        return {
            "price":     round(close, 2),
            "prevClose": round(prev, 2),
            "chg":       chg,
            "absChg":    round(close - prev, 2),
            "open":      float(row.get("Open", close)),
            "high":      float(row.get("High", close)),
            "low":       float(row.get("Low",  close)),
            "volume":    int(row.get("Volume", 0)),
            "source":    "YF",
        }
    except Exception as e:
        log.debug("YF fallback failed for %s: %s", symbol, e)
        return None


# ── Universe cache (bhavcopy + microcap index) ───────────────────────────────
_universe_cache = []
_universe_ts    = 0
_universe_lock  = threading.Lock()
_UNIVERSE_TTL   = 6 * 3600   # refresh every 6 hours


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
            # column ' SERIES' has a leading space
            series_col = next((k for k in (rows[0].keys() if rows else [])
                               if 'SERIES' in k), None)
            if not series_col:
                continue
            eq = [
                {"symbol": row["SYMBOL"].strip(), "exchange": "NSE",
                 "price": float(row[" CLOSE_PRICE"].strip()) if " CLOSE_PRICE" in row else 0}
                for row in rows
                if row.get(series_col, "").strip() in ("EQ", "BE")
                and row.get("SYMBOL", "").strip()
            ]
            log.info("Bhavcopy %s: %d EQ/BE symbols", d, len(eq))
            return eq, d
        except Exception as e:
            log.warning("Bhavcopy %s failed: %s", d, e)
    return [], None


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
        # Attach real company names (bhavcopy has none). Prefer the official
        # equity master list; fall back to any name the microcap feed carried.
        names = _load_equity_names()
        for item in bhav:
            nm = names.get(item["symbol"]) or item.get("name") or ""
            item["name"] = nm
        _universe_cache = bhav
        _universe_ts    = time.time()
        log.info("Universe ready: %d symbols (bhavcopy date: %s)", len(bhav), bhav_date)
        return _universe_cache


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
def _no_cache(response):
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# Exported React Native web build (Expo). When present it becomes the live UI;
# the legacy single-file HTML stays available at /legacy and as a fallback.
WEB_DIR = os.path.join(_BASE_DIR, "mobile", "dist")
_WEB_INDEX = os.path.join(WEB_DIR, "index.html")


@app.route("/")
def index():
    if os.path.exists(_WEB_INDEX):
        return _no_cache(send_from_directory(WEB_DIR, "index.html"))
    return _no_cache(send_from_directory(_BASE_DIR, "StockScreenPro.html"))


@app.route("/legacy")
def legacy_ui():
    return _no_cache(send_from_directory(_BASE_DIR, "StockScreenPro.html"))


@app.route("/<path:fname>")
def static_files(fname):
    # 1) Prefer the RN-web bundle (index.html SPA shell, _expo/*, assets/*, favicon)
    if os.path.isfile(os.path.join(WEB_DIR, fname)):
        return _no_cache(send_from_directory(WEB_DIR, fname))
    # 2) Fall back to repo-root files (StockScreenPro.html, VERSION, legacy assets)
    if os.path.isfile(os.path.join(_BASE_DIR, fname)):
        return _no_cache(send_from_directory(_BASE_DIR, fname))
    # 3) SPA fallback: unknown non-API paths → the web shell (API routes are
    #    matched by Flask before this catch-all, so they're unaffected)
    if os.path.exists(_WEB_INDEX):
        return _no_cache(send_from_directory(WEB_DIR, "index.html"))
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


@app.before_request
def _req_start():
    request._t0 = time.time()


@app.after_request
def _security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
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
        if not _auth.configured():
            return jsonify({"error": "owner-auth-required",
                            "detail": "This feature needs an owner passcode. Set "
                                      "APP_PASSWORD on the server to enable it."}), 403
        if not _auth.is_owner(request.cookies.get(_auth.COOKIE, "")):
            return jsonify({"error": "unauthorized",
                            "detail": "Owner login required."}), 401
        return fn(*a, **kw)
    return wrapper


@app.route("/auth/status")
def auth_status():
    return jsonify({"configured": _auth.configured(),
                    "owner": _auth.is_owner(request.cookies.get(_auth.COOKIE, ""))})


@app.route("/auth/login", methods=["POST"])
@rate_limit("auth-login", 8, 300)
def auth_login():
    body = request.get_json(silent=True) or {}
    if not _auth.configured():
        return jsonify({"error": "not-configured",
                        "detail": "No owner passcode is set on this server."}), 403
    if not _auth.check_password(body.get("password", "")):
        return jsonify({"error": "bad-password"}), 401
    resp = jsonify({"owner": True})
    resp.set_cookie(_auth.COOKIE, _auth.make_cookie(), max_age=_auth.TTL,
                    httponly=True, samesite="Lax",
                    secure=request.headers.get("X-Forwarded-Proto") == "https")
    return resp


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    resp = jsonify({"owner": False})
    resp.delete_cookie(_auth.COOKIE)
    return resp


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


@app.route("/ltp")
def ltp():
    raw = request.args.get("symbols", "").strip().upper()
    if not raw:
        return jsonify({"error": "No symbols"}), 400
    symbols = [s.strip() for s in raw.split(",") if s.strip()]
    out = {}

    # Skip symbols that aren't NSE-listed without touching the network — graph
    # nodes include foreign names (MICROSOFT, ARAMCO, …) that would otherwise
    # each burn a slow NSE+YF failure and time the whole batch out. Soft check:
    # only applied once the universe cache is warm.
    known = {u["symbol"] for u in (_universe_cache or [])}

    def _resolve(sym):
        res = {}
        if known and sym not in known and sym not in SYMBOL_ALIASES:
            res[sym] = {"error": "not NSE-listed", "source": "skip"}
            return res
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

    # Fetch concurrently — sequential NSE+YF lookups made big graphs (15+
    # symbols) exceed the frontend timeout, so no prices rendered at all.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=8) as pool:
        for res in pool.map(_resolve, symbols[:100]):
            out.update(res)

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
_INDEX_MEM_TTL = 60      # NSE live quotes go stale fast; CSV lists barely change


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


@app.route("/index")
def index_constituents():
    name = request.args.get("name", "").strip().upper()
    key  = NSE_INDEX_MAP.get(name)
    if not key:
        return jsonify({"error": f"Unknown index '{name}'", "available": list(NSE_INDEX_MAP)}), 400

    hit = _INDEX_MEM.get(name)
    if hit and (time.time() - hit[0]) < _INDEX_MEM_TTL:
        return jsonify({"index": name, "count": len(hit[1]), "data": hit[1], "source": hit[2]})

    # 1) NSE Direct — live quotes (often blocked from cloud IPs)
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
            return jsonify({"index": name, "count": len(rows), "data": rows, "source": "nse"})
    except Exception as e:
        log.warning("NSE index fetch failed for %s: %s", name, e)

    # 2) niftyindices.com constituent CSV — symbols only; the frontend backfills
    #    prices and technicals from /scan, so the screener stays fully live.
    try:
        rows = _fetch_niftyindices_csv(name)
        if rows:
            _index_cache_write(name, rows, "niftyindices-csv")
            return jsonify({"index": name, "count": len(rows), "data": rows,
                            "source": "niftyindices-csv"})
    except Exception as e:
        log.warning("niftyindices CSV fetch failed for %s: %s", name, e)

    # 3) last-good disk cache (survives restarts)
    rows, source = _index_cache_read(name)
    if rows:
        return jsonify({"index": name, "count": len(rows), "data": rows,
                        "source": f"stale-{source}"})

    return jsonify({"error": f"All constituent sources failed for {name}", "data": []}), 502


@app.route("/universe")
def universe():
    items = get_universe()
    return jsonify({
        "ready":   bool(items),
        "total":   len(items),
        "nse":     len(items),
        "bse":     0,
        "symbols": [{"symbol": x["symbol"], "name": x.get("name") or x["symbol"],
                     "exchange": x["exchange"]}
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


@app.route("/history")
def history():
    sym      = request.args.get("symbol", "").strip().upper()
    period   = request.args.get("period",   "1y")   # 1d 5d 1mo 3mo 6mo 1y 2y 5y
    interval = request.args.get("interval", "1d")   # 1m 5m 15m 1h 1d 1wk 1mo
    if not sym:
        return jsonify({"error": "symbol required"}), 400
    try:
        import yfinance as yf
        # For intraday ≤15m yfinance caps at 60 days — prefer tvDatafeed for longer history
        yf_limited = interval in ('1m', '5m', '15m')
        df = None

        if yf_limited:
            df = _fetch_tv_data(sym, interval, period)

        if df is None or df.empty:
            # yfinance caps: 5m/15m → 60d, 1h → 730d; cap period to avoid empty response
            yf_period_cap = {'1m': '7d', '5m': '60d', '15m': '60d', '1h': '2y'}
            yf_period = yf_period_cap.get(interval, period)
            yf_sym = sym if sym.startswith('^') else f"{sym}.NS"
            ticker = yf.Ticker(yf_sym)
            for attempt in range(3):
                df = ticker.history(period=yf_period, interval=interval, auto_adjust=True)
                if not df.empty:
                    break
                if attempt < 2:
                    time.sleep(1.5 ** attempt)
                    ticker = yf.Ticker(yf_sym)

        if (df is None or df.empty) and not yf_limited:
            df = _fetch_tv_data(sym, interval, period)

        if df is None or df.empty:
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

        return jsonify({
            "symbol":   sym,
            "period":   period,
            "interval": interval,
            "count":    len(candles),
            "candles":  candles,
        })
    except Exception as e:
        log.error("History error for %s: %s", sym, e)
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
        import yfinance as yf
        ticker = yf.Ticker(f"{sym}.NS")
        df = ticker.history(period=period, interval="1d", auto_adjust=True)
        if df.empty:
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
            "sector":       info.get("sector"),
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
    return jsonify(_fund.bulk(syms))


@app.route("/returns")
def returns():
    """Bulk 1Y/3Y/5Y return calculator — per-symbol with threading."""
    raw = request.args.get("symbols", "").strip().upper()
    if not raw:
        return jsonify({"error": "symbols required"}), 400
    symbols = [s.strip() for s in raw.split(",") if s.strip()][:50]
    import yfinance as yf
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _calc_one(sym):
        yf_sym = sym if sym.startswith("^") else f"{sym}.NS"
        try:
            df = yf.Ticker(yf_sym).history(period="5y", interval="1mo", auto_adjust=True)
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
# Pre-computes technicals for the default screener index so first visitors hit
# a hot cache instead of waiting out a cold 50-symbol yfinance sweep. Refreshes
# just inside scanner's 5-min TTL. Disable with SCAN_WARM=off; point at another
# index with e.g. SCAN_WARM="NIFTY 100".
SCAN_WARM = os.environ.get("SCAN_WARM", "NIFTY 50").strip()


def _warm_scan_loop():
    time.sleep(15)  # let the service settle before hitting data sources
    while True:
        try:
            key = NSE_INDEX_MAP.get(SCAN_WARM.upper())
            syms = []
            if key:
                data = nse_get("/api/equity-stockIndices", params={"index": key})
                syms = [it.get("symbol") for it in data.get("data", [])
                        if it.get("symbol") and it.get("symbol") != key]
            if syms:
                res = _scanner.scan(syms)
                log.info("Scan warm: %s -> %d/%d rows (%d computed)",
                         SCAN_WARM, res["count"], len(syms[:60]), res["computed"])
        except Exception as e:
            log.warning("Scan warm failed: %s", e)
        time.sleep(240)


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
        note = ("Relationship edges for this company need the AI graph — add an AI "
                "key (Claude/Gemini/Grok/OpenAI) from the ⚙ AI KEY field to unlock them."
                if reason == "no-key"
                else "Couldn't build a relationship graph right now — showing the "
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
    try:
        g = _ai.get_graph(sym, user_key, user_provider, user_model)
    except Exception as e:
        logging.warning("AI graph generation failed for %s: %s", sym, e)
        if user_key:
            return jsonify({"error": "ai-key-failed", "ai": True,
                            "detail": "Couldn't generate with your API key — check it's "
                                      "valid, has credit, and try again."}), 400
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
    return jsonify(_news.get_news(sym, q, force))


@app.route("/holidays")
def market_holidays():
    """NSE trading-holiday calendar + live market open/closed status (IST)."""
    s = _holidays.market_status()
    return jsonify({**s, "holidays": _holidays.holidays(),
                    "note": "Indicative list — verify with NSE circulars."})


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
_INDEX_LISTS = {
    "domestic":      _MAJOR_INDICES,
    "international": _INTL_INDICES,
    "depository":    _DR_INDICES,
}
# Per-category cache: category → {"ts": float, "data": [...]}
_indices_cache = {}
_INDICES_TTL = 300   # 5 minutes


def _fetch_index_row(key, name, yf_sym):
    """One index snapshot: last close, % day change, % 1-year return.

    Tolerates short-history symbols (some ADRs/foreign tickers): `level` is
    always computed, while `chg`/`y1` fall back to None when there aren't
    enough closes to compute them.
    """
    import yfinance as yf
    df = yf.Ticker(yf_sym).history(period="1y", interval="1d")
    closes = df["Close"].dropna()
    last = float(closes.iloc[-1])
    prev = float(closes.iloc[-2]) if len(closes) >= 2 else None
    first = float(closes.iloc[0]) if len(closes) >= 2 else None
    return {"key": key, "name": name, "symbol": yf_sym,
            "level": round(last, 2),
            "chg": round((last / prev - 1) * 100, 2) if prev else None,
            "y1": round((last / first - 1) * 100, 1) if first else None}


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
    cached = entry is not None and entry["data"] is not None and (now - entry["ts"]) < _INDICES_TTL
    if not cached:
        rows = []
        for key, name, yf_sym in _INDEX_LISTS[category]:
            try:
                row = _fetch_index_row(key, name, yf_sym)
                row["category"] = category
                rows.append(row)
            except Exception as e:
                log.debug("Index fetch failed for %s: %s", yf_sym, e)
        entry = {"ts": now, "data": rows}
        _indices_cache[category] = entry
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
    return jsonify({"indices": entry["data"],
                    "asof": int(time.time()), "cached": cached})


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
    try:
        df = yf.Ticker(f"{sym}.NS").history(period=period, interval="1d", auto_adjust=True)
        if df is None or df.empty:
            return []
        return [float(x) for x in df["Close"].tolist() if x == x]
    except Exception:
        return []


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

    # Benchmark: NIFTY index via ^NSEI so beta is against the market.
    idx = None
    try:
        df = yf.Ticker("^NSEI").history(period="1y", interval="1d", auto_adjust=True)
        if df is not None and not df.empty:
            idx = [float(x) for x in df["Close"].tolist() if x == x]
    except Exception:
        idx = None

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

    Query: ?symbols=A,B,C (max 60). Returns computed + cached rows; call again
    for the same symbols within the cache TTL to get instant results.
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

        # ── Balance Sheet ──────────────────────────────────────────────────────
        bs = {}
        try:
            bal = ticker.balance_sheet
            if bal is not None and not bal.empty:
                c = bal.columns[0]
                def bv(k): return bal.loc[k, c] if k in bal.index else None
                bs = {
                    "total_debt":   fmt_cr(bv("Total Debt")),
                    "total_assets": fmt_cr(bv("Total Assets")),
                    "equity":       fmt_cr(bv("Stockholders Equity")),
                    "cash":         fmt_cr(bv("Cash And Cash Equivalents")),
                    "inventory":    fmt_cr(bv("Inventory")),
                    "receivables":  fmt_cr(bv("Accounts Receivable")),
                }
        except Exception as e:
            log.warning("Balance sheet error %s: %s", sym, e)

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
            hist = yf.Ticker(f"{sym}.NS").history(period="1y", interval="1d", auto_adjust=True)
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

        return _no_cache(jsonify({
            "symbol": sym,
            "name": info.get("longName") or info.get("shortName", sym),
            "sector": info.get("sector"),
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
        }))
    except Exception as e:
        log.error("Report error for %s: %s", sym, e)
        return jsonify({"error": str(e)}), 502


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
    print("\n" + "=" * 60)
    print("  QuantHunt — NSE Direct + YF fallback")
    print("  Universe: bhavcopy EQ/BE + NIFTY MICROCAP 250")
    print("  Open  http://localhost:%d" % port)
    print("=" * 60 + "\n")
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
