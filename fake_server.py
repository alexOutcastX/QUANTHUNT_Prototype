"""Throwaway static server for headless verification. Serves mobile/dist; stubs API as empty."""
import json, math, os, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import backtest_engine as bte  # stdlib-only: the REAL engine runs in the fake server
import valuation as _val       # stdlib-only: the REAL valuation engine too

# The Historic tab is served by the REAL ledger, seeded into a throwaway DB —
# so what the headless run verifies is the shipping settlement logic, not a
# hand-written JSON blob that could drift from it.
os.environ.setdefault("DB_PATH", os.path.join(
    os.environ.get("TMPDIR", "/tmp"), "taureye-fake-tradelog.db"))
import tradelog as _tlog       # noqa: E402  (must follow the DB_PATH default)
import cases as _tcases        # noqa: E402  the REAL case engine too
import penny_screen as _penny  # noqa: E402  the REAL penny grader too

DIST = os.path.join(os.path.dirname(__file__), "mobile", "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5056

_MEMBER_TOKEN = "fake-member-token"

# The trading session every stubbed quote belongs to. A fixed PAST date on
# purpose: it is what makes the dashboard render its "not today" wording, which
# is the thing the smoke suite checks. (Thursday 23 July 2026 — the same day
# the movers fixture is stamped with.)
_SESSION = "2026-07-23"
_MEMBER = {"username": "Taureye", "uname": "taureye", "plan": "pro", "owner": True,
           "features": ["quotes", "heatmap", "news", "universe", "screener", "patterns",
                        "recommendations", "watchlist", "portfolio", "backtest",
                        "trade_scan", "terminal", "dossier", "exports", "alerts"]}

_BT_SYMS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "SBIN"]

_tl_seeded = [False]


def _seed_tradelog():
    """Put one trade of each outcome into the throwaway ledger, then settle them
    through the real reconcile() — a winner, a stopped loser, a horizon close and
    two still running, spread across all three sources."""
    if _tl_seeded[0]:
        return
    _tl_seeded[0] = True
    try:
        _tlog.store.execute("DELETE FROM tradelog")
    except Exception:
        pass
    day = _tlog.DAY
    now = int(time.time())
    _tlog.record("reco", [
        {"symbol": "TCS", "name": "Tata Consultancy Services", "entry": 3200.0,
         "stop": 3040.0, "target": 3680.0, "strategy": "BUY · 74% confidence",
         "rationale": ["Trading above the 50 & 200-DMA — uptrend intact",
                       "RSI 61 in the momentum zone",
                       "Setup ≈ 3.0:1 reward-to-risk to ₹3,680"],
         "meta": {"confidence": 74, "momentum_score": 71, "rr": 3.0}},
        {"symbol": "HDFCBANK", "name": "HDFC Bank", "entry": 1700.0, "stop": 1615.0,
         "target": 1950.0, "strategy": "BUY · 66% confidence",
         "rationale": ["Reclaimed the 50-DMA", "Volume 1.6× average — participation building"],
         "meta": {"confidence": 66, "momentum_score": 58}},
    ], now=now - 40 * day)
    _tlog.record("reco", [
        {"symbol": "RELIANCE", "name": "Reliance Industries", "entry": 2900.0,
         "stop": 2755.0, "target": 3300.0, "strategy": "BUY · 69% confidence",
         "rationale": ["EMAs stacked 20 > 50 > 200", "4.1% from the 52-week high — near breakout"],
         "meta": {"confidence": 69, "momentum_score": 74}},
    ], now=now - 6 * day)
    _tlog.record_momentum([
        {"symbol": "INFY", "name": "Infosys", "price": 1500.0, "target": 1720.0,
         "score": 82, "probability": 63, "setup": "fired", "rsi": 64.0, "relvol": 2.1,
         "signals": ["TTM squeeze just FIRED with positive momentum — compression is releasing upward.",
                     "Volume 2.1× average — institutions participating.",
                     "Fresh 52-week high on the latest bar — breakout in progress."]},
    ])
    _tlog.record_multibagger([
        {"symbol": "SBIN", "name": "State Bank of India", "price": 780.0, "score": 74,
         "tier": "Tier A", "probability_pct": 58, "coverage_pct": 88, "roe": 17.4,
         "debt_equity": 0.32, "vs_200dma": 8.6, "sector": "Financial Services"},
    ])
    # Settle: TCS runs through its target, HDFCBANK takes out its stop, the two
    # newest stay open. RELIANCE is aged past its horizon so a timed-out close
    # renders too.
    _tlog.reconcile({"TCS": 3720.0, "HDFCBANK": 1590.0, "INFY": 1585.0, "SBIN": 812.0})
    _tlog.store.execute("UPDATE tradelog SET opened=? WHERE symbol='RELIANCE'",
                        (now - 200 * day,))
    _tlog.reconcile({"RELIANCE": 3010.0})
    # A couple of replayed rows so the live-vs-simulated split renders.
    _tlog.record("reco", [
        {"symbol": "ITC", "name": "ITC", "entry": 430.0, "stop": 408.0, "target": 495.0,
         "strategy": "BUY · 63% confidence", "backfilled": True,
         "rationale": ["Reclaimed the 50-DMA", "RSI 57 in the momentum zone"],
         "meta": {"confidence": 63}},
    ], now=now - 26 * day)
    _tlog.record("momentum", [
        {"symbol": "LT", "name": "Larsen & Toubro", "entry": 3500.0, "target": 3900.0,
         "strategy": "Pullback reversal", "backfilled": True,
         "rationale": ["Orderly pullback — 3.2% under the 20-DMA, not a breakdown."],
         "meta": {"score": 71}},
    ], now=now - 18 * day)
    _tlog.reconcile({"ITC": 495.0, "LT": 3610.0})


_cases_seeded = [False]

# A scored universe for the case engine — the same shape mb_screen publishes.
_IT = "Information Technology"
_FIN = "Financial Services"
_HC = "Healthcare"
_AUTO = "Automobile and Auto Components"
# Real symbol → real sector, so the sector cases in a screenshot read as they
# would in production rather than shuffling names into the wrong bucket.
_CASE_NAMES = [
    ("TCS", _IT), ("INFY", _IT), ("WIPRO", _IT), ("HCLTECH", _IT), ("LTIM", _IT),
    ("HDFCBANK", _FIN), ("ICICIBANK", _FIN), ("SBIN", _FIN), ("AXISBANK", _FIN),
    ("KOTAKBANK", _FIN),
    ("SUNPHARMA", _HC), ("CIPLA", _HC), ("DRREDDY", _HC), ("LUPIN", _HC), ("DIVISLAB", _HC),
    ("MARUTI", _AUTO), ("M&M", _AUTO), ("TATAMOTORS", _AUTO), ("BAJAJ-AUTO", _AUTO),
    ("EICHERMOT", _AUTO),
]


def _case_universe():
    rows = []
    for i, (sym, sector) in enumerate(_CASE_NAMES):
        rows.append({
            "symbol": sym, "name": sym.title(), "score": 86 - i * 1.4, "tier": "Tier A",
            "price": round(300 + (i * 371) % 3200, 2),
            "market_cap_cr": [180000, 45000, 12000][i % 3],
            "roe": 24 - (i % 10), "debt_equity": 0.08 + (i % 4) * 0.18,
            "sector": sector, "vs_200dma": 12 - (i % 18),
            "pct_from_high": -(i % 20),
            "metrics": {"pe": 11 + (i % 18), "pb": 1.4 + (i % 4) * 0.7,
                        "dividend_yield": round((i % 5) * 0.7, 2)},
        })
    return rows


def _seed_cases():
    """Build the real cases from a fixture universe, then let the engine act on
    one of them so the action ledger has something in it."""
    if _cases_seeded[0]:
        return
    _cases_seeded[0] = True
    rows = _case_universe()
    _tcases.build_and_review(rows)
    cid = "multibagger-flagship"
    hs = _tcases.holdings_of(cid)
    if not hs:
        return
    quotes = {h["symbol"]: h["entry"] for h in hs}
    quotes[hs[0]["symbol"]] = hs[0]["entry"] * 1.8          # a runner to book
    scores = {r["symbol"]: r["score"] for r in rows}
    scores[hs[1]["symbol"]] = 20                            # a broken thesis to exit
    acts = _tcases.review_actions(hs, quotes, scores)
    bench = [{"symbol": "TITAN", "name": "Titan", "score": 68, "price": 3400.0}]
    _tcases.apply_actions(cid, acts, bench)


def _case_quotes(syms):
    """Fixture prices: every holding up ~9% on its entry so the cards show a
    live P/L rather than a row of zeros."""
    out = {}
    for c in _tcases.all_cases():
        for h in _tcases.holdings_of(c["id"]):
            if h["symbol"] in syms and h["entry"]:
                out[h["symbol"]] = round(h["entry"] * 1.09, 2)
    return out

# Fundamentals warm sweep: a clock-driven fake so the developer portal's
# progress bar actually moves under the headless checks. 20 symbols/second, so
# a 120-symbol sweep finishes in 6 s — long enough to observe mid-flight.
_WARM = {"running": False, "cancel": False, "total": 0, "started": 0.0, "universe": ""}
_WARM_RATE = 20.0


def _warm_begin(scope):
    if _WARM["running"]:
        return {"started": False, "reason": "already running"}
    _WARM.update({"running": True, "cancel": False, "total": 120,
                  "started": time.time(), "universe": scope.upper()})
    return {"started": True, "total": 120, "universe": scope.upper()}


def _warm_snapshot():
    total = _WARM["total"]
    elapsed = (time.time() - _WARM["started"]) if _WARM["started"] else 0.0
    done = min(total, int(elapsed * _WARM_RATE)) if _WARM["started"] else 0
    if _WARM["running"] and done >= total:
        _WARM["running"] = False
    running = _WARM["running"]
    ok = max(0, done - done // 6 - done // 20)
    return {
        "running": running, "cancel": _WARM["cancel"], "total": total, "done": done,
        "ok": ok, "failed": done // 20, "skipped": done // 6,
        "started": _WARM["started"], "updated": time.time(),
        "finished": 0.0 if running else time.time(),
        "universe": _WARM["universe"], "last_error": "",
        "rate_per_min": round(_WARM_RATE * 60, 1) if running else 0.0,
        "eta_sec": int((total - done) / _WARM_RATE) if running else None,
        "elapsed_sec": int(elapsed), "pct": round(done / total * 100, 1) if total else 0.0,
        "cache_size": 40 + done, "cache_fresh": 40 + ok, "inflight": 4 if running else 0,
        "schema": "5237f2e7", "workers": 4,
    }


def _bt_candles(sym, period, interval):
    """Deterministic synthetic daily series (per-symbol phase, mild trend +
    sine swings) so backtests are reproducible in headless checks."""
    seed = sum(ord(c) for c in sym)
    t0 = 1_700_000_000 - (1_700_000_000 % 86400)
    out = []
    px = 100.0 + seed % 40
    for i in range(420):
        drift = 0.0006 * px
        swing = math.sin((i + seed) / 9.0) * 0.02 * px
        o = px
        c = px + drift + swing
        h = max(o, c) * 1.003
        l = min(o, c) * 0.997
        out.append({"t": t0 + i * 86400, "o": round(o, 2), "h": round(h, 2),
                    "l": round(l, 2), "c": round(c, 2), "v": 100000 + (seed + i) % 5000})
        px = c
    return out


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _api(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        # Permissive shape: every plausible array key is an empty list so the
        # frontend never reads .length of undefined during headless verification.
        payload = {"ok": True}
        for k in ("data", "items", "indices", "constituents", "results", "rows",
                  "holidays", "alerts", "keys", "quotes", "list", "gainers",
                  "losers", "sectors", "news", "events", "entities", "nodes",
                  "edges", "strikes", "symbols"):
            payload[k] = []
        self.wfile.write(json.dumps(payload).encode())

    def _report(self):
        """Dossier payload. The valuation is computed by the real engine from
        these fixture financials, so the headless check exercises the shipped
        arithmetic rather than a hand-written blob that could drift from it."""
        fin_years = [
            {"year": "2025", "revenue": 240000, "net_income": 46000, "op_income": 60000, "ni_growth": 9.5},
            {"year": "2024", "revenue": 225000, "net_income": 42000, "op_income": 55000, "ni_growth": 9.7},
            {"year": "2023", "revenue": 211000, "net_income": 38300, "op_income": 50000, "ni_growth": 14.7},
            {"year": "2022", "revenue": 191000, "net_income": 33400, "op_income": 44000, "ni_growth": 3.1},
            {"year": "2021", "revenue": 164000, "net_income": 32400, "op_income": 42000, "ni_growth": None},
        ]
        bs = {"total_debt": 8000, "cash": 45000, "equity": 90000, "total_assets": 150000}
        cf = {"ocf": 48000, "fcf": 42000, "capex": -6000}
        val = _val.value(price=3900, eps=138.71, pe=28.1, pb=12.0, market_cap_cr=830405,
                         fcf_cr=cf["fcf"], ocf_cr=cf["ocf"], total_debt_cr=bs["total_debt"],
                         cash_cr=bs["cash"], revenue_cr=fin_years[0]["revenue"],
                         op_income_cr=fin_years[0]["op_income"], dividend_yield_pct=3.2,
                         earnings_growth_pct=9.5, fin_years=fin_years, roe_pct=52.0,
                         sector="Information Technology",
                         peers={"pe": 22.0, "pb": 6.0, "roe": 24.0,
                                "dividend_yield": 1.8, "n": 31})
        return self._json({
            "symbol": "RELIANCE", "name": "Reliance Industries Limited",
            "sector": "Energy", "industry": "Refineries", "market_cap_cr": 830405,
            "pe": 28.1, "forward_pe": 26.0, "pb": 12.0, "eps": 138.71,
            "dividend_yield": 3.2, "roe": 52.0, "roce": 41.0,
            "description": "Fixture company for headless verification.",
            "fin_years": fin_years, "fin_quarters": [],
            "balance_sheet": bs, "cash_flow": cf,
            "technical": {"price": 3900}, "quality_score": 72, "grade": "A",
            "valuation": val,
        })

    def _pattern_screen(self):
        hits = [
            {"symbol": "RELIANCE", "price": 2980.5, "type": "cup_and_handle",
             "label": "Cup and Handle", "bias": "bullish", "category": "continuation",
             "status": "confirmed", "confidence": 82, "continuation": 70,
             "expansion_pct": 8.4, "target": 3230.0, "start_ts": 1750000000, "end_ts": 1752300000},
            {"symbol": "TCS", "price": 4120.0, "type": "double_top",
             "label": "Double Top", "bias": "bearish", "category": "reversal",
             "status": "forming", "confidence": 64, "continuation": 65,
             "expansion_pct": -5.2, "target": 3905.0, "start_ts": 1749000000, "end_ts": 1752200000},
            {"symbol": "INFY", "price": 1550.2, "type": "ascending_triangle",
             "label": "Ascending Triangle", "bias": "bullish", "category": "continuation",
             "status": "confirmed", "confidence": 61, "continuation": 68,
             "expansion_pct": 4.1, "target": 1614.0, "start_ts": 1748000000, "end_ts": 1752350000},
        ]
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({
            "status": "done", "refreshing": False, "progress": "50 scanned · 3 hits",
            "asof": 1752350000, "index": "NIFTY 50", "universe": 50, "capped": False,
            "matches": len(hits), "results": hits, "error": None,
        }).encode())

    def _indices(self):
        from urllib.parse import urlparse, parse_qs
        cat = (parse_qs(urlparse(self.path).query).get("category", ["domestic"])[0]).lower()
        sample = {
            "domestic": [("NIFTY50", "NIFTY 50", 24500.5, 0.42, 12.3),
                         ("SENSEX", "BSE SENSEX", 80500.1, 0.38, 11.8),
                         ("BANKNIFTY", "NIFTY Bank", 52100.0, -0.21, 9.4),
                         ("NIFTYIT", "NIFTY IT", 34567.8, 1.85, 22.1),
                         ("NIFTYAUTO", "NIFTY Auto", 23890.0, -1.32, 15.7),
                         ("NIFTYPHARMA", "NIFTY Pharma", 21450.3, 0.64, 8.9),
                         ("NIFTYFMCG", "NIFTY FMCG", 58200.9, -0.08, 6.2),
                         ("NIFTYMETAL", "NIFTY Metal", 9870.4, 2.71, -3.4),
                         ("NIFTYENERGY", "NIFTY Energy", 41230.6, -2.15, 4.8),
                         ("NIFTYREALTY", "NIFTY Realty", 1042.7, 3.42, 31.0)],
            "international": [("SP500", "S&P 500", 5600.2, 0.15, 18.2),
                             ("NASDAQ", "Nasdaq", 18200.7, 0.33, 25.1),
                             ("NIKKEI225", "Nikkei 225", 39100.0, -0.44, 14.0)],
            "depository": [("INFY", "Infosys", 21.4, 0.9, None),
                          ("IBN", "ICICI Bank", 31.2, -0.3, 22.5)],
            "currency": [("USDINR", "USD/INR", 83.42, 0.12, 1.8),
                        ("EURINR", "EUR/INR", 90.15, -0.08, 2.4)],
            "commodity": [("GOLD", "Gold", 2410.5, 0.55, 19.2),
                         ("BRENT", "Brent Crude", 84.3, -1.02, 3.1)],
        }.get(cat, [])
        rows = [{"key": k, "name": n, "level": lv, "chg": c, "y1": y,
                 "category": cat, "session": _SESSION}
                for (k, n, lv, c, y) in sample]
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"indices": rows, "asof": 1752350000,
                                     "session": _SESSION, "cached": False}).encode())

    def _graph(self):
        from urllib.parse import urlparse, parse_qs
        sym = (parse_qs(urlparse(self.path).query).get("symbol", [""])[0]).upper()
        # Serve the committed seed graph when available (for layout testing).
        seed_path = os.path.join(os.path.dirname(__file__), "graph_cache.seed.json")
        try:
            with open(seed_path) as f:
                seed = json.load(f)
            if sym in seed:
                rec = seed[sym]
                payload = {"companies": rec["companies"], "edges": rec["edges"],
                           "available": [sym], "source": "seed", "ai": False,
                           "disclaimer": "Seed relationship data."}
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(payload).encode())
                return
        except Exception:
            pass
        curated = {"TMCV": {"name": "Tata Motors CV", "listed": True},
                   "TATASTEEL": {"name": "Tata Steel", "listed": True},
                   "MOTHERSON": {"name": "Motherson", "listed": True}}
        byok = self.headers.get("X-AI-Key", "")
        if sym and sym not in curated:
            # Simulate an AI/minimal graph for an off-list symbol.
            if byok:
                payload = {"companies": {sym: {"name": sym, "listed": True},
                                         "XYZSUP": {"name": "Xyz Supplier", "listed": False}},
                           "edges": [{"src": "XYZSUP", "dst": sym, "type": "supplies",
                                      "note": "demo edge", "confidence": "high"}],
                           "available": [sym], "source": "ai", "ai": True,
                           "disclaimer": "AI-generated (stub)."}
            else:
                payload = {"companies": {sym: {"name": sym, "listed": True}}, "edges": [],
                           "available": [sym], "source": "minimal", "ai": False,
                           "disclaimer": "Add your Anthropic API key to unlock edges."}
        else:
            payload = {"companies": curated,
                       "edges": [{"src": "TATASTEEL", "dst": "TMCV", "type": "supplies",
                                  "note": "steel", "confidence": "high"},
                                 {"src": "MOTHERSON", "dst": "TMCV", "type": "supplies",
                                  "note": "harnesses", "confidence": "high"}],
                       "available": list(curated.keys()), "source": "demo", "ai": False,
                       "disclaimer": "Demo relationship data."}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def _entity_graph(self):
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        ents = ["HRTI", "GRAVITON", "MORGAN STANLEY", "GOLDMAN SACHS", "JANE STREET", "PLUTUS"]
        def edge(sym, ent):
            return {"symbol": sym, "entity_id": ent, "entity_name": ent, "net_qty": 55680,
                    "buy_qty": 55680, "sell_qty": 0, "deal_count": 1, "avg_price": 515.0,
                    "first_date": "10-Jul-2026", "last_date": "10-Jul-2026",
                    "citations": [{"side": "BUY", "date": "10-Jul-2026", "kind": "bulk", "qty": 55680, "price": 515.0}]}
        if q.get("entity"):
            payload = {"view": "entity", "entity": q["entity"][0],
                       "positions": [edge("KALYANKJIL", q["entity"][0])],
                       "asof": {"first": "08-Jul-2026", "last": "10-Jul-2026"}, "source": "nse"}
        elif q.get("symbol"):
            payload = {"view": "symbol", "symbol": q["symbol"][0],
                       "flows": [edge(q["symbol"][0], "HRTI")],
                       "asof": {"first": "08-Jul-2026", "last": "10-Jul-2026"}, "source": "nse"}
        else:
            payload = {"nodes": {"companies": [], "entities": [
                        {"id": e, "name": e, "breadth": 6, "deals": 8} for e in ents]},
                       "edges": [edge("KALYANKJIL", e) for e in ents],
                       "asof": {"first": "08-Jul-2026", "last": "10-Jul-2026"}, "source": "nse",
                       "disclaimer": "Grounded in NSE bulk/block deals (stub)."}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    SYMS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "TATAMOTORS",
            "SBIN", "LT", "ITC", "TITAN", "ASIANPAINT", "MARUTI"] + [
            f"STOCK{i:02d}" for i in range(48)]

    def _index_cons(self):
        # Mirrors what production actually serves: NSE Direct is blocked from
        # cloud IPs, so the constituent list comes from the quoteless CSV and
        # the server backfills prices from the daily bhavcopy. The response is
        # therefore fully priced but labelled as a settled close — and the
        # client has to keep showing it while preferring /scan's numbers.
        rows = [{"symbol": s, "price": 1000 + i * 137.5, "prevClose": 990 + i * 137.0,
                 "chg": (-2.5 + i * 0.6), "absChg": 10 + i, "volume": 1500000 + i * 250000}
                for i, s in enumerate(self.SYMS)]
        self._json({"index": "NIFTY 50", "count": len(rows), "data": rows,
                    "source": "niftyindices-csv", "quote_source": "bhavcopy",
                    "quote_date": "2026-07-28", "priced": len(rows)})

    def _scan(self):
        data = {}
        for i, s in enumerate(self.SYMS):
            data[s] = {"rsi": 25 + (i * 7) % 55, "d20": -6 + (i % 9), "d50": 1 + i * 0.5,
                       "d200": 3 + i * 0.9, "willr": -95 + (i * 11) % 80, "bollb": round(0.05 + (i % 10) * 0.1, 2),
                       "relvol": round(0.6 + (i % 8) * 0.3, 1), "beta": round(0.8 + i * 0.1, 2),
                       "sqzOn": i % 4 == 0, "sqzFire": i % 7 == 0, "sqzMom": round(-1 + (i % 5) * 0.6, 2),
                       "macd": round(-0.5 + (i % 4) * 0.4, 2), "macd_bull_cross": i % 6 == 0,
                       "pct_from_high": round(-(i % 12) * 1.4, 1), "pct_from_low": round(5 + i * 2.0, 1),
                       "new_high_52w": i % 11 == 0, "gap_up": i % 9 == 0, "volume_spike": i % 5 == 0,
                       "s1": 980 + i * 130, "s2": 960 + i * 130, "s3": 940 + i * 130,
                       "r1": 1020 + i * 140, "r2": 1040 + i * 140, "r3": 1060 + i * 140}
        self._json({"data": data, "count": len(data)})

    def _fund_bulk(self):
        secs = ["Industrials", "Financials", "Technology", "Healthcare", "Energy", "Consumer"]
        mcaps = [900, 22000, 65000, 4500, 120000, 800]  # micro/small/mid/large spread
        # Growth spans negative → strongly positive so a ">= 10%" screen picks a
        # real subset rather than everything or nothing.
        data = {s: {"pe": 20 + i, "pb": 2 + i * 0.3, "roe": 10 + (i % 12) * 2, "roce": 14 + i,
                    "debt_equity": round(0.1 + (i % 7) * 0.12, 2), "dividend_yield": round(0.5 + i * 0.2, 1),
                    "market_cap_cr": mcaps[i % 6], "sector": secs[i % 6],
                    "eps": round(5 + (i % 20) * 1.5, 2),
                    "revenue_growth_pct": round(-8 + (i % 11) * 4.5, 1),
                    "earnings_growth_pct": round(-14 + (i % 13) * 5.0, 1),
                    "revenue_qoq_pct": round(-5 + (i % 9) * 3.2, 1),
                    "earnings_qoq_pct": round(-9 + (i % 10) * 4.1, 1),
                    "eps_growth_yoy_pct": round(-6 + (i % 12) * 3.8, 1),
                    "eps_ttm_growth_pct": round(-4 + (i % 8) * 4.4, 1),
                    # Cash flow, so the Cash flow filter group has data to bite
                    # on. Every third symbol burns cash, so the "FCF positive"
                    # toggle actually excludes something.
                    "ocf_cr": round(500 + i * 137.0, 1),
                    "capex_cr": round(90 + i * 21.0, 1),
                    "fcf_cr": round((500 + i * 137.0) - (90 + i * 21.0), 1) * (-1 if i % 3 == 2 else 1),
                    "fcf_yield_pct": round(1.2 + (i % 7) * 1.3, 2),
                    "cash_conversion_pct": round(60 + (i % 9) * 12.0, 1),
                    "cashflow_year": "31-Mar-2024"}
                for i, s in enumerate(self.SYMS)}
        self._json({"data": data, "pending": [], "provider": "stub", "cached": len(data), "total": len(data)})

    def _history(self):
        import math
        from urllib.parse import urlparse, parse_qs
        q = parse_qs(urlparse(self.path).query)
        interval = (q.get("interval", ["1d"])[0])
        bar = {"5m": 300, "15m": 900, "1h": 3600, "4h": 14400,
               "1d": 86400, "1wk": 604800, "1mo": 2592000}.get(interval, 86400)
        sym = (q.get("symbol", ["STUB"])[0]).upper()
        if interval == "1d":
            # Same bars /smc analysed, so SMC zones land on the right candles.
            out = []
            for i, c in enumerate(self._smc_series(sym)):
                out.append(dict(c,
                                rsi=round(50 + 25 * math.sin(i / 7.0), 1),
                                macd=round(2 * math.sin(i / 11.0), 3),
                                macd_signal=round(2 * math.sin((i - 2) / 11.0), 3),
                                macd_hist=round(0.8 * math.sin(i / 5.0), 3)))
            return self._json({"symbol": sym, "period": q.get("period", ["2y"])[0],
                               "interval": interval, "count": len(out), "candles": out})
        candles = []
        px = 500.0
        for i in range(126):
            px *= 1 + 0.004 * math.sin(i / 9.0) + 0.0012
            candles.append({"t": 1735689600 + i * bar, "o": round(px * 0.995, 2),
                            "h": round(px * 1.01, 2), "l": round(px * 0.985, 2),
                            "c": round(px, 2), "v": 100000 + i * 900,
                            # synthetic indicator fields, same keys as /history
                            "rsi": round(50 + 25 * math.sin(i / 7.0), 1),
                            "macd": round(2 * math.sin(i / 11.0), 3),
                            "macd_signal": round(2 * math.sin((i - 2) / 11.0), 3),
                            "macd_hist": round(0.8 * math.sin(i / 5.0), 3)})
        self._json({"symbol": "STUB", "period": q.get("period", ["6mo"])[0],
                    "interval": interval, "count": len(candles), "candles": candles})

    def _tradelog(self):
        """Track record, computed by the real ledger from a seeded fixture: a
        settled winner, a stopped loser, a horizon close, and two still
        running — one per source — so every branch of the page renders."""
        _seed_tradelog()
        q = parse_qs(urlparse(self.path).query)
        self._json(_tlog.ledger(source=(q.get("source") or [None])[0],
                                status=(q.get("status") or [None])[0]))

    def _penny_screen(self):
        """Graded by the real screen from a fixture universe covering every
        outcome: a liquid profitable small-cap, a thin one, an illiquid shell,
        and a scrip with nothing published at all."""
        uni = [
            {"symbol": "GOODSMALL", "name": "Good Small Ltd", "price": 8.4,
             "turnover": 5.2e7, "chg": 2.1, "exchange": "NSE"},
            {"symbol": "STEADYCO", "name": "Steady Co", "price": 6.1,
             "turnover": 2.4e7, "chg": -0.8, "exchange": "NSE"},
            {"symbol": "THINTRADE", "name": "Thin Trade Ltd", "price": 9.2,
             "turnover": 6.0e6, "chg": 4.6, "exchange": "NSE"},
            {"symbol": "SHELLCORP", "name": "Shell Corp", "price": 2.3,
             "turnover": 1.4e5, "chg": 9.8, "exchange": "NSE"},
            {"symbol": "NODATA", "name": "No Data Industries", "price": 4.7,
             "turnover": 3.1e6, "chg": 0.0, "exchange": "NSE"},
            {"symbol": "MIDPRICED", "name": "Mid Priced Ltd", "price": 34.0,
             "turnover": 8.8e7, "chg": 1.1, "exchange": "NSE"},
        ]
        funds = {
            "GOODSMALL": {"eps": 1.9, "roe": 19.0, "debt_equity": 0.22, "ocf_cr": 38.0,
                          "market_cap_cr": 860.0, "pb": 1.7, "pe": 9.2,
                          "revenue_growth_pct": 24.0, "sector": "Capital Goods"},
            "STEADYCO": {"eps": 0.7, "roe": 13.5, "debt_equity": 0.44, "ocf_cr": 12.0,
                         "market_cap_cr": 410.0, "pb": 1.2, "pe": 8.7,
                         "revenue_growth_pct": 8.0, "sector": "Chemicals"},
            "THINTRADE": {"eps": -0.4, "roe": -6.0, "debt_equity": 1.9, "ocf_cr": -4.0,
                          "market_cap_cr": 120.0, "pb": 0.9,
                          "revenue_growth_pct": -6.0, "sector": "Textiles"},
            "SHELLCORP": {"eps": -1.4, "roe": -22.0, "debt_equity": 5.2, "ocf_cr": -21.0,
                          "market_cap_cr": 32.0, "pb": -0.8,
                          "revenue_growth_pct": -34.0, "sector": "Services"},
            "MIDPRICED": {"eps": 4.2, "roe": 16.0, "debt_equity": 0.5, "ocf_cr": 95.0,
                          "market_cap_cr": 2100.0, "pb": 2.1, "pe": 8.1,
                          "revenue_growth_pct": 12.0, "sector": "Healthcare"},
        }
        q = parse_qs(urlparse(self.path).query)
        try:
            min_turnover = float((q.get("min_turnover") or ["0"])[0])
        except ValueError:
            min_turnover = 0.0
        payload = _penny.screen(uni, funds,
                                band=(q.get("band") or [_penny.DEFAULT_BAND])[0],
                                min_turnover=min_turnover,
                                max_risk=(q.get("max_risk") or [None])[0])
        payload["universe"] = len(uni)
        payload["warming"] = False
        self._json(payload)

    def _cases(self):
        _seed_cases()
        syms = []
        for c in _tcases.all_cases():
            syms += [h["symbol"] for h in _tcases.holdings_of(c["id"])]
        payload = _tcases.overview(_case_quotes(set(syms)))
        payload["progress"] = _tcases.progress()
        self._json(payload)

    def _case_detail(self, case_id):
        _seed_cases()
        holds = _tcases.holdings_of(case_id)
        detail = _tcases.case_detail(case_id, _case_quotes({h["symbol"] for h in holds}))
        if not detail:
            return self._json({"error": f"Unknown case '{case_id}'"})
        q = parse_qs(urlparse(self.path).query)
        try:
            amount = float((q.get("amount") or ["0"])[0])
        except ValueError:
            amount = 0.0
        if amount > 0:
            legs = detail["constituents"]
            alloc = _tcases.allocate(amount, [l["price"] for l in legs],
                                     [l["weight"] for l in legs])
            for leg, a in zip(legs, alloc["legs"]):
                leg["alloc_shares"] = a["shares"]
                leg["alloc_value"] = a["value"]
                leg["alloc_weight"] = a["actual_weight"]
            detail["allocation"] = {k: alloc[k] for k in ("invested", "cash", "amount")}
        self._json(detail)

    def _json(self, payload):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def _universe(self):
        # The master list carries bhavcopy quotes, same as the real route.
        syms = [{"symbol": s, "name": f"{s.title()} Industries Limited", "exchange": "NSE",
                 "price": 1000 + i * 137.5, "chg": (-2.5 + i * 0.6),
                 "volume": 1500000 + i * 250000}
                for i, s in enumerate(self.SYMS)]
        # BSE-only scrips (never on NSE) — must be searchable in predictive too.
        syms.append({"symbol": "CIANAGRO", "name": "Cian Agro Industries & Infrastructure Ltd",
                     "exchange": "BSE", "price": 84.5, "chg": 1.2, "volume": 12000})
        self._json({"ready": True, "total": len(syms), "nse": len(self.SYMS),
                    "bse": 1, "as_of": "2026-07-28", "symbols": syms})

    def _shareholding(self):
        from urllib.parse import urlparse, parse_qs
        sym = (parse_qs(urlparse(self.path).query).get("symbol", [""])[0]).upper()
        # BSE-only names aren't on the NSE filings feed → null, to exercise the
        # graceful "unavailable" path in the UI.
        if sym in ("CIANAGRO", ""):
            return self._json({"latest": None, "source": "NSE"})
        self._json({"latest": {"date": "31-Mar-2026", "promoter": 54.32, "fii": 18.7,
                               "dii": 9.15, "public": 17.83, "pledge": 2.4}, "source": "NSE"})

    def _multibagger(self):
        from urllib.parse import urlparse, parse_qs
        sym = (parse_qs(urlparse(self.path).query).get("symbol", ["DEMO"])[0]).upper()
        import multibagger as mb
        payload = mb.score({
            "mcap_cr": 1650, "revenue_growth_pct": 27.5, "earnings_growth_pct": 41.0,
            "roe_pct": 22.3, "op_margin_pct": 16.8, "profit_margin_pct": 11.2,
            "debt_equity": 0.18, "current_ratio": 2.1, "fcf_cr": 84,
            "insider_pct": 58.4, "institution_pct": 9.6, "pe": 28.4, "pb": 5.1,
            "peg": 0.92, "vs_200dma_pct": 8.4, "pct_from_high_pct": -12.5,
            "price_cagr_3y_pct": 38.2,
        })
        payload.update({"symbol": sym, "name": f"{sym.title()} Industries Limited",
                        "sector": "Industrials", "industry": "Specialty Machinery",
                        "price": 842.55, "about": "Demo small-cap for headless verification."})
        self._json(payload)

    def _mb_screen(self):
        results = [{"symbol": s, "score": 88 - i * 2, "tier": "HIGH POTENTIAL" if i < 4 else "PROMISING",
                    "probability_pct": 46 - i, "coverage_pct": 100,
                    "price": 400 + i * 55.5, "chg": round(-1.5 + i * 0.4, 2),
                    "volume": 120000 + i * 40000, "relvol": round(0.8 + (i % 5) * 0.3, 2),
                    "vs_50dma": round(1 + i * 0.9, 1), "vs_200dma": round(2 + i * 1.7, 1),
                    "pct_from_high": round(-(i % 8) * 2.1, 1),
                    "market_cap_cr": [800, 22000, 65000, 4500, 120000, 900][i % 6], "roe": 16 + i, "debt_equity": round(0.1 + i * 0.04, 2),
                    "sector": ["Industrials","Financials","Technology","Healthcare","Energy","Consumer"][i % 6]}
                   for i, s in enumerate(self.SYMS[:14])]
        self._json({"status": "done", "refreshing": False, "progress": "", "asof": 1752470000,
                    "universe": 2087, "matches": len(results), "results": results,
                    "criteria": {"min_score": 60, "min_coverage_pct": 60},
                    "error": None})

    def _mom_screen(self):
        setups = [("breakout", "BREAKOUT WATCH"), ("fired", "BREAKOUT FIRED"), ("pullback", "PULLBACK REVERSAL")]
        results = []
        for i, sym in enumerate(self.SYMS[:18]):
            kind = setups[i % 3][0]
            price = 420 + i * 61.5
            # target = 52w-high proxy a bit above price → positive upside remaining
            upside = round(3 + (i % 7) * 2.5, 1)
            target = round(price * (1 + upside / 100), 2)
            results.append({
                "symbol": sym, "name": f"{sym.title()} Industries Limited",
                "exchange": "BSE" if i % 6 == 5 else "NSE",
                "price": price, "chg": round(-2 + i * 0.5, 2), "rsi": 28 + (i * 5) % 50,
                "relvol": round(0.7 + (i % 6) * 0.4, 2), "d200": round(4 + i * 1.1, 1),
                "pct_from_high": round(-(i % 9) * 1.5, 1),
                "target": target, "upside_pct": upside,
                "setup": kind, "score": 92 - i * 2, "probability": 68 - i,
                "signals": ["TTM squeeze ON — volatility coiling for a move.",
                            "Volume 2.1x average — accumulation building.",
                            "Price above the 20/50/200-DMA stack — full trend alignment."],
                "cautions": ([] if i % 4 else ["RSI 79 — extended; chasing here risks buying the blow-off."]),
            })
        self._json({"status": "done", "refreshing": False, "progress": "", "asof": 1752480000,
                    "universe_nse": 2087, "universe_bse": 1450, "matches": len(results),
                    "results": results, "error": None})

    def _ltp(self):
        from urllib.parse import urlparse, parse_qs
        syms = (parse_qs(urlparse(self.path).query).get("symbols", [""])[0]).split(",")
        out = {}
        for i, s in enumerate(x for x in syms if x):
            base = 100 + i * 137.5
            chg = round(-3 + (i * 1.7) % 7, 2)
            out[s] = {"price": round(base, 2), "prevClose": round(base / (1 + chg / 100), 2),
                      "chg": chg, "absChg": round(base * chg / 100, 2),
                      "open": round(base * 0.995, 2), "high": round(base * 1.02, 2),
                      "low": round(base * 0.98, 2), "volume": 120000 + i * 45000,
                      "session": _SESSION, "source": "stub"}
        self._json(out)

    def _chart_patterns(self):
        # Build a synthetic series with a few embedded formations, then run the
        # REAL patterns engine so the frontend renders genuine detections.
        import patterns as P

        def path(anchors):
            vals = [anchors[0][0]]
            for tgt, nb in anchors[1:]:
                start = vals[-1]
                for i in range(1, nb + 1):
                    vals.append(start + (tgt - start) * i / nb)
            return vals

        # uptrend → head&shoulders → recovery → double top (current)
        series = path([
            (100, 0), (135, 40),                       # long uptrend
            (150, 14), (138, 8), (168, 12), (137, 10), (149, 10), (120, 14),  # H&S
            (155, 30),                                 # recovery
            (185, 20), (168, 10), (186, 12), (150, 6),  # double top breaking down right now
        ])
        cndls = []
        for i, c in enumerate(series):
            o = series[i - 1] if i else c
            hi = max(o, c) + abs(c) * 0.006
            lo = min(o, c) - abs(c) * 0.006
            cndls.append({"t": 1700000000 + i * 86400, "o": round(o, 2),
                          "h": round(hi, 2), "l": round(lo, 2), "c": round(c, 2), "v": 100000})
        res = P.detect_patterns(cndls)
        res["symbol"] = "STUB"
        res["candles"] = [{"t": c["t"], "o": c["o"], "h": c["h"], "l": c["l"], "c": c["c"]} for c in cndls]
        self._json(res)

    def _recommendation(self):
        from urllib.parse import urlparse, parse_qs
        import recommend as R
        q = parse_qs(urlparse(self.path).query)
        sym = (q.get("symbol", ["STUB"])[0]).upper()
        name = q.get("name", [None])[0]
        fund = q.get("fund", [None])[0]
        try:
            fund_score = float(fund) if fund else None
        except ValueError:
            fund_score = None
        # bullish uptrend with a pullback → a genuine BUY setup
        base = 100 + (hash(sym) % 40)
        vals = [base + i * 0.7 for i in range(120)]
        top = vals[-1]
        vals += [top - i * 0.9 for i in range(1, 12)]
        pb = vals[-1]
        vals += [pb + i * 0.8 for i in range(1, 22)]
        cndls = []
        for i, cc in enumerate(vals):
            o = vals[i - 1] if i else cc
            hi = max(o, cc) * 1.01
            lo = min(o, cc) * 0.99
            cndls.append({"t": 1700000000 + i * 86400, "o": round(o, 2), "h": round(hi, 2),
                          "l": round(lo, 2), "c": round(cc, 2), "v": 100000 + (i % 5) * 40000})
        rec = R.analyze(sym, cndls, fund_score, name)
        rec["symbol"] = sym
        self._json(rec)

    def _swing(self):
        from urllib.parse import urlparse, parse_qs
        import swing as S
        q = parse_qs(urlparse(self.path).query)
        sym = (q.get("symbol", ["STUB"])[0]).upper()
        name = q.get("name", [None])[0]
        # uptrend that pulls back into an oversold dip then ticks up → a swing setup
        base = 100 + (hash(sym) % 60)
        vals = [base + i * 0.6 for i in range(200)]
        top = vals[-1]
        vals += [top - i * 2.2 for i in range(1, 14)]
        low = vals[-1]
        vals += [low + 2.5, low + 5.0]
        cndls = []
        for i, cc in enumerate(vals):
            o = vals[i - 1] if i else cc
            hi = max(o, cc) * 1.01
            lo = min(o, cc) * 0.99
            cndls.append({"t": 1700000000 + i * 86400, "o": round(o, 2), "h": round(hi, 2),
                          "l": round(lo, 2), "c": round(cc, 2), "v": 100000 + (i % 5) * 40000})
        res = S.analyze(sym, cndls, name)
        res["symbol"] = sym
        self._json(res)

    def _institutional(self):
        from urllib.parse import urlparse, parse_qs
        import math as _m
        import institutional as I
        q = parse_qs(urlparse(self.path).query)
        sym = (q.get("symbol", ["STUB"])[0]).upper()
        name = q.get("name", [None])[0]
        bench = [100 + i * 0.4 for i in range(300)]
        kind = hash(sym) % 4
        base = 100 + (hash(sym) % 50)
        if kind == 0:                                    # momentum / trend uptrend
            vals = [base + i * 0.6 for i in range(300)]
        elif kind == 1:                                  # mean-reversion oversold dip
            vals = [base + i * 0.5 for i in range(280)] + [base + 140 - i * 3 for i in range(20)]
        elif kind == 2:                                  # breakout from a flat base
            vals = [base + 0.4 * _m.sin(i / 3) for i in range(280)] + [base + 2 * i for i in range(1, 21)]
        else:                                            # stat-arb laggard vs index
            vals = [base + i * 0.4 for i in range(220)] + [base + 88 - i * 0.3 for i in range(80)]
        cndls = []
        for i, cc in enumerate(vals):
            o = vals[i - 1] if i else cc
            cndls.append({"t": 1700000000 + i * 86400, "o": round(o, 2), "h": round(max(o, cc) * 1.01, 2),
                          "l": round(min(o, cc) * 0.99, 2), "c": round(cc, 2), "v": 100000 + (i % 5) * 40000})
        res = I.analyze(sym, cndls, bench_closes=bench, name=name)
        res["symbol"] = sym
        self._json(res)

    # Daily series the SMC engine is run against. /history serves the SAME bars
    # for interval=1d so the card's chart sits on the exact timeline the zones
    # were measured on — otherwise the model's focus window clips to nothing
    # and no overlay can be verified end to end.
    def _smc_series(self, sym):
        base = 100 + (hash(sym) % 40)
        # uptrend → confirmed swing low → drift up → sweep it and reclaim (discount)
        up = [base + i * 0.5 for i in range(120)]
        dip = [base + 60 - i * 2 for i in range(8)]
        rec = [dip[-1] + 1 + i * 1.4 for i in range(10)]
        cont = [rec[-1] + i * 0.3 for i in range(24)]
        sweep = [cont[-1] - 6, dip[-1] - 2, dip[-1] - 5]
        reclaim = [dip[-1] + 1, dip[-1] + 2.5]
        vals = up + dip + rec + cont + sweep + reclaim
        vv = [100000] * len(vals)
        vv[-3] = 300000
        cndls = []
        for i, cc in enumerate(vals):
            o = vals[i - 1] if i else cc
            cndls.append({"t": 1700000000 + i * 86400, "o": round(o, 2), "h": round(max(o, cc) * 1.006, 2),
                          "l": round(min(o, cc) * 0.994, 2), "c": round(cc, 2), "v": vv[i]})
        return cndls

    def _smc(self):
        from urllib.parse import urlparse, parse_qs
        import smc as S
        q = parse_qs(urlparse(self.path).query)
        sym = (q.get("symbol", ["STUB"])[0]).upper()
        name = q.get("name", [None])[0]
        res = S.analyze(sym, self._smc_series(sym), name)
        res["symbol"] = sym
        self._json(res)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/smc":
            return self._smc()
        if path == "/institutional":
            return self._institutional()
        if path == "/recommendation":
            return self._recommendation()
        if path == "/swing":
            return self._swing()
        if path == "/chart-patterns":
            return self._chart_patterns()
        if path == "/ltp":
            return self._ltp()
        if path == "/tradelog":
            return self._tradelog()
        if path == "/penny/screen":
            return self._penny_screen()
        if path == "/cases":
            return self._cases()
        if path.startswith("/cases/"):
            return self._case_detail(path[len("/cases/"):])
        if path == "/momentum/screen":
            return self._mom_screen()
        if path == "/multibagger/screen":
            return self._mb_screen()
        if path == "/patterns/screen":
            return self._pattern_screen()
        if path == "/patterns/trade-scan":
            return self._json({"status": "done", "refreshing": False, "asof": 1753260000,
                               "indices": ["NIFTY 50", "NIFTY BANK", "BSE SENSEX"],
                               "results": [
                {"index": "NIFTY 50", "tf": "15m · intraday", "interval": "15m",
                 "pattern": "Bull Flag", "bias": "bullish", "status": "forming",
                 "confidence": 78, "continuation": 64, "expansion_pct": 1.8, "active": True,
                 "price": 24500.5, "entry": 24500.5, "target": 24941.5, "stop": 24280.0, "rr": 2.0},
                {"index": "NIFTY BANK", "tf": "1h · 1-5 days", "interval": "1h",
                 "pattern": "Double Top", "bias": "bearish", "status": "confirmed",
                 "confidence": 84, "continuation": 61, "expansion_pct": -2.4, "active": True,
                 "price": 52100.0, "entry": 52100.0, "target": 50849.6, "stop": 52725.2, "rr": 2.0},
                {"index": "BSE SENSEX", "tf": "1D · positional", "interval": "1d",
                 "pattern": "Ascending Triangle", "bias": "bullish", "status": "forming",
                 "confidence": 72, "continuation": 66, "expansion_pct": 3.1, "active": False,
                 "price": 80500.1, "entry": 80500.1, "target": 82995.6, "stop": 79252.3, "rr": 2.0}]})
        if path == "/backtest/strategies":
            return self._json({"strategies": bte.strategies_meta(),
                               "default_costs": bte.DEFAULT_COSTS, "max_symbols": 100})
        if path == "/backtest/status":
            q = parse_qs(urlparse(self.path).query)
            return self._json(bte.snapshot((q.get("id") or [""])[0]))
        if path == "/backtest/last":
            return self._json({"run_id": None})
        if path == "/history":
            return self._history()
        if path == "/multibagger":
            return self._multibagger()
        if path == "/universe":
            return self._universe()
        if path == "/index":
            return self._index_cons()
        if path == "/scan":
            return self._scan()
        if path == "/sector-medians":
            return self._json({"sectors": {"Information Technology":
                                           {"pe": 22.0, "pb": 6.0, "roe": 24.0,
                                            "dividend_yield": 1.8, "n": 31}},
                               "count": 1, "min_sample": 5,
                               "fields": ["pe", "pb", "roe", "dividend_yield"]})
        if path == "/report":
            return self._report()
        if path == "/fundamentals/bulk":
            return self._fund_bulk()
        if path == "/fundamentals/warm":
            return self._json(_warm_snapshot())
        if path == "/graph":
            return self._graph()
        if path == "/entity-graph":
            return self._entity_graph()
        if path == "/corporate/shareholding":
            return self._shareholding()
        if path == "/corporate/deals":
            # The generic /api stub answers without bulk/block keys, which used
            # to throw inside render and blank the whole app — see MarketDeals.
            return self._json({"source": "NSE", "bulk": [
                {"symbol": "BULKCO", "client": "Some Fund A/C One", "side": "BUY",
                 "qty": 250000, "price": 412.5, "date": "2026-07-23"},
                {"symbol": "BULKCO", "client": "Another Fund", "side": "SELL",
                 "qty": 180000, "price": 410.2, "date": "2026-07-23"},
            ], "block": [
                {"symbol": "BLOCKCO", "client": "A Big Investor", "side": "BUY",
                 "qty": 1000000, "price": 88.4, "date": "2026-07-23"},
            ]})
        if path == "/corporate/calendar":
            # A deterministic window with more rows than the card shows and
            # more than one kind, so the chip row, the "Show all" branch and —
            # via Buyback and Rights, which are deliberately absent — the
            # zero-count chip and its empty state are all exercised.
            import datetime as _dt
            _t = _dt.date.today()
            days = [(_t + _dt.timedelta(days=n)).isoformat()
                    for n in (1, 2, 3, 5, 8, 10, 13, 16, 20, 25)]
            kinds = ["Dividend"] * 7 + ["Bonus", "Split", "Other"]
            subj = {"Dividend": "Interim Dividend - Rs 6 Per Share",
                    "Bonus": "Bonus Issue 1:1",
                    "Split": "Face Value Split - From Rs 10/- To Rs 2/-",
                    "Other": "Demerger"}
            items = [
                {"symbol": f"CORP{i + 1}", "name": f"Corp {i + 1} Ltd", "kind": k,
                 "subject": subj[k], "date": d, "ex_date": d, "record_date": d,
                 "close_date": None, "series": "EQ"}
                for i, (d, k) in enumerate(zip(days, kinds))]
            def _ipo(sym, name, opens, closes):
                o = (_t + _dt.timedelta(days=opens)).isoformat()
                c = (_t + _dt.timedelta(days=closes)).isoformat()
                return {"symbol": sym, "name": name, "kind": "IPO",
                        "subject": f"IPO — Rs.100 to Rs.110 · closes {c}",
                        "date": o, "ex_date": None, "record_date": None,
                        "close_date": c, "series": "EQ"}
            # The same three live issues /ipos serves, and for the same reason:
            # the two views read one ranked feed, so they cannot disagree about
            # which books are still open. CLOSEDCO is absent from both.
            items.append(_ipo("OPENCO", "Open Issue Ltd", -1, 3))
            items.append(_ipo("XYZSME", "XYZ Industries", 2, 4))
            items.append(_ipo("LATERCO", "Later Issue Ltd", 6, 9))
            items.sort(key=lambda x: x["date"])
            return self._json({
                "source": "NSE", "days": 30, "items": items,
                "covers": ["Dividend", "Bonus", "Split", "Rights", "Buyback", "IPO", "Other"],
            })
        if path == "/holidays":
            # Ahead of today for the same reason as the calendar above: the
            # card lists only holidays still to come.
            import datetime as _dt
            _t = _dt.date.today()
            _hol = [((_t + _dt.timedelta(days=n)).isoformat(), name) for n, name in
                    ((17, "Independence Day"), (51, "Mahatma Gandhi Jayanti"),
                     (88, "Diwali Laxmi Pujan"))]
            return self._json({
                "open": False, "now_ist": "2026-07-25 11:04",
                "note": "Indicative NSE calendar",
                "next_holiday": {"date": _hol[0][0], "name": _hol[0][1], "day": "Saturday"},
                "holidays": [{"date": d, "name": n, "day": "Saturday"} for d, n in _hol]})
        if path == "/indices":
            return self._indices()
        if path == "/movers":
            rows = [{"symbol": s, "name": s.title() + " Ltd", "price": 100.0 + i * 25,
                     "prevClose": 100.0 + i * 25 - d, "chg": round(d / (100.0 + i * 25 - d) * 100, 2),
                     "absChg": d, "open": 100.0, "high": 140.0, "low": 95.0, "volume": 1000000 + i}
                    for i, (s, d) in enumerate([("GAINER1", 4.2), ("GAINER2", 3.1), ("GAINER3", 2.4),
                                                ("LOSER1", -3.8), ("LOSER2", -2.9), ("LOSER3", -1.7)])]
            return self._json({"index": "NIFTY 500",
                               "breadth": {"up": 293, "down": 182, "flat": 25, "total": 500, "ratio": 1.61},
                               "gainers": rows[:3], "losers": rows[3:],
                               "session": _SESSION, "asof": "2026-07-23T15:30:00"})
        if path == "/news":
            # Item 3 deliberately carries no summary so the popup's
            # headline-only branch is exercised by the checks.
            return self._json({"items": [
                {"title": f"Fake market headline {i} — earnings beat estimates",
                 "link": "https://example.com/n" + str(i), "source": "ET Markets",
                 "ts": 1753200000 + i * 3600, "sym": "",
                 "summary": ("" if i == 3 else
                             f"Standfirst {i}: benchmark indices rallied as banking "
                             "stocks led the gains and auto followed.")}
                for i in range(10)],
                "fetched": 1753260000, "cached": False})
        if path.startswith("/user/data/"):
            doc = self._synced.get(path)
            return self._json(doc or {"v": None, "ts": 0})
        if path == "/auth/status":
            # Mirrors server.py: an owner-flagged member IS the owner, so the
            # broker / alerts / developer screens never prompt for a passcode.
            hdr = (self.headers.get("X-TE-Member") or "").replace("Bearer ", "").strip()
            signed = "te_member=1" in (self.headers.get("Cookie") or "") or hdr == _MEMBER_TOKEN
            return self._json({"configured": True, "owner": bool(signed and _MEMBER.get("owner"))})
        if path == "/auth/me":
            hdr = (self.headers.get("X-TE-Member") or "").replace("Bearer ", "").strip()
            signed = "te_member=1" in (self.headers.get("Cookie") or "") or hdr == _MEMBER_TOKEN
            if signed:
                return self._json({"user": {"email": _MEMBER["username"], "source": "member"}})
            return self._json({"user": None})
        if path == "/auth/member":
            # Cookie (web) OR bearer header (the Capacitor shell, where the
            # WebView drops cross-site cookies) — mirrors server.py.
            hdr = (self.headers.get("X-TE-Member") or "").replace("Bearer ", "").strip()
            if "te_member=1" in (self.headers.get("Cookie") or "") or hdr == _MEMBER_TOKEN:
                return self._json({"member": _MEMBER})
            return self._json({"member": None})
        if path == "/movers/market":
            # The whole-market panel. Deterministic, and deliberately carries
            # an `excluded` count so the UI's "corporate actions excluded"
            # note is exercised.
            def mk(sym, chg, price):
                return {"symbol": sym, "name": sym.title() + " Ltd", "price": price,
                        "chg": chg, "absChg": round(price * chg / 100, 2),
                        "volume": 1000000, "turnover": 5e8}
            return self._json({
                "gainers": [mk("MKTUP1", 19.9, 240.0), mk("MKTUP2", 14.2, 88.0),
                            mk("MKTUP3", 11.7, 512.0), mk("MKTUP4", 9.4, 61.0)],
                "losers": [mk("MKTDN1", -17.6, 143.0), mk("MKTDN2", -12.1, 78.0),
                           mk("MKTDN3", -8.8, 402.0), mk("MKTDN4", -6.2, 25.0)],
                "universe": 1688, "traded": 5191, "excluded": 3,
                "min_turnover": 1e7, "session": "2026-07-23",
            })
        if path == "/news/history":
            # The archive the rail's second tab reads. Stamped older than the
            # live feed so "recorded back to" has something to say.
            base = 1753200000
            return self._json({
                "items": [{"id": f"h{i}", "title": f"Archived headline {i} — a week ago",
                           "link": f"https://example.com/h{i}", "source": "ET Markets",
                           "ts": base - i * 86400, "summary": ""} for i in range(6)],
                "sources": ["ET Markets", "Livemint"],
                "oldest": base - 6 * 86400, "newest": base,
                "total": 6, "keep_days": 35,
            })
        if path == "/wallet/earn":
            # The header's wallet chip hides itself when this 404s, and with the
            # chip gone the smoke suite would measure a header 50px narrower
            # than the real one — which is exactly the measurement the nav-clip
            # check depends on. Deterministic values: a balance and a streak,
            # nothing claimable, so the chip renders in its ordinary state.
            return self._json({"balance": 120, "prices": {},
                               "daily": {"streak": 3, "claimable": False, "amount": 5}})
        if path == "/sectors/members":
            from urllib.parse import urlparse, parse_qs
            sec = (parse_qs(urlparse(self.path).query).get("sector", ["Financials"])[0])
            return self._json({"sector": sec, "level": "macro", "parent": sec, "count": 4,
                               "items": [
                {"symbol": "HDFCBANK", "name": "HDFC Bank Ltd", "exchange": "NSE",
                 "price": 1275.0, "chg": -1.3, "turnover": 9.9e9},
                {"symbol": "SBIN", "name": "State Bank of India", "exchange": "NSE",
                 "price": 1825.0, "chg": 1.1, "turnover": 7.2e9},
                {"symbol": "RELIANCE", "name": "Reliance Industries Ltd", "exchange": "NSE",
                 "price": 1000.0, "chg": -2.5, "turnover": 6.5e9},
                {"symbol": "CIANAGRO", "name": "Cian Agro Industries", "exchange": "BSE",
                 "price": 42.5, "chg": 3.2, "turnover": 1.1e7}] + [
                {"symbol": f"FILL{i:02d}", "name": f"Filler Company {i} Ltd", "exchange": "NSE",
                 "price": 100.0 + i, "chg": round((i % 7) - 3.0, 2), "turnover": 1e7 - i}
                for i in range(1, 31)]})
        if path == "/sectors":
            return self._json({"status": "done", "refreshing": False, "asof": 1753260000,
                               "level": "macro", "universe": 2100, "mapped": 1900,
                               "sectors": [{"sector": n, "count": 40 + i, "market_cap_cr": 500000 - i * 40000,
                                            "chg": round(1.8 - i * 0.55, 2)}
                                           for i, n in enumerate(["Financials", "IT", "Energy", "Auto",
                                                                  "Pharma", "FMCG", "Metals", "SME Emerge"])]})
        if path == "/ipos":
            # Ranked the way the real route ranks: a closed book dropped, the
            # rest ordered by the day they open, OPEN/SOON from the dates. The
            # CLOSED row is here on purpose — it is what the home page used to
            # render as "SOON" for an issue nobody could apply to any more.
            import datetime as _dt
            _t = _dt.date.today()
            def _iss(sym, name, series, o, c, band):
                return {"symbol": sym, "name": name, "series": series,
                        "start": (_t + _dt.timedelta(days=o)).strftime("%d-%b-%Y"),
                        "end": (_t + _dt.timedelta(days=c)).strftime("%d-%b-%Y"),
                        "price_band": band, "size": "₹1,200 cr", "status": "upcoming"}
            raw = [
                _iss("LATERCO", "Later Issue Ltd", "EQ", 6, 9, "150-160"),
                _iss("CLOSEDCO", "Closed Issue Ltd", "EQ", -8, -4, "10-12"),
                _iss("OPENCO", "Open Issue Ltd", "EQ", -1, 3, "95-100"),
                _iss("XYZSME", "XYZ Industries", "SME", 2, 4, "55-58"),
            ]
            try:
                import primary_feeds as _pf
                raw = _pf.rank_ipos(raw)
            except Exception:
                pass
            return self._json({"items": raw, "asof": "2026-07-23T12:00:00"})
        if path == "/gsec":
            return self._json({"items": [
                {"symbol": "726GS2033", "series": "GS", "kind": "gsec", "ltp": 99.61,
                 "chg": 0.12, "yld": 7.02, "coupon": 7.26, "maturity": "22-Aug-2033"},
                {"symbol": "718GS2037", "series": "GS", "kind": "gsec", "ltp": 98.4,
                 "chg": -0.05, "yld": 7.21, "coupon": 7.18, "maturity": "24-Jul-2037"},
                {"symbol": "SGBAUG29", "series": "GB", "kind": "sgb", "ltp": 7350.0,
                 "chg": 0.4, "yld": 2.5, "coupon": 2.5, "maturity": "11-Aug-2029"}],
                "asof": "2026-07-23T12:00:00"})
        if path.startswith(("/scan", "/index", "/indices", "/quote", "/fundamentals",
                            "/alerts", "/corporate", "/entities", "/api", "/holidays",
                            "/derivatives", "/risk", "/health")):
            return self._api()
        rel = path.lstrip("/") or "index.html"
        fp = os.path.join(DIST, rel)
        if not os.path.isfile(fp):
            fp = os.path.join(DIST, "index.html")
        ctype = ("text/html" if fp.endswith(".html") else
                 "application/javascript" if fp.endswith(".js") else
                 "text/css" if fp.endswith(".css") else "application/octet-stream")
        with open(fp, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.end_headers()
        self.wfile.write(body)

    # Cloud sync (/user/data/<kind>) is a real PUT on the server. The member
    # session now provisions an account, so the app actually syncs — without
    # this the stub answered 501 and every headless run logged a console error.
    _synced = {}

    def do_PUT(self):
        path = self.path.split("?")[0]
        if path.startswith("/user/data/"):
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            self._synced[path] = {"v": body.get("v"), "ts": body.get("ts") or 0}
            return self._json({"stored": True, "ts": body.get("ts") or 0})
        return self._json({"ok": True})

    def do_POST(self):
        if self.path.split("?")[0] == "/auth/member/login":
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            ok = (body.get("username", "").strip().lower() == "taureye"
                  and body.get("password") == "TaureyePW")
            payload = json.dumps({"member": _MEMBER, "token": _MEMBER_TOKEN} if ok
                                 else {"error": "bad-credentials"}).encode()
            self.send_response(200 if ok else 401)
            self.send_header("Content-Type", "application/json")
            if ok:
                self.send_header("Set-Cookie", "te_member=1; Path=/")
            self.end_headers()
            return self.wfile.write(payload)
        if self.path.split("?")[0] == "/auth/member/logout":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Set-Cookie", "te_member=; Path=/; Max-Age=0")
            self.end_headers()
            return self.wfile.write(b'{"member": null}')
        if self.path.split("?")[0] == "/fundamentals/warm":
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
            res = _warm_begin(body.get("scope") or "ALL")
            res["progress"] = _warm_snapshot()
            return self._json(res)
        if self.path.split("?")[0] == "/fundamentals/warm/stop":
            _WARM["cancel"] = True
            _WARM["running"] = False
            return self._json({"stopping": True, "progress": _warm_snapshot()})
        if self.path.split("?")[0] == "/backtest/run":
            n = int(self.headers.get("Content-Length") or 0)
            cfg = json.loads(self.rfile.read(n) or b"{}")
            run_id, err = bte.start(
                cfg, lambda name: ([{"symbol": s} for s in _BT_SYMS], "fake"), _bt_candles)
            if err:
                return self._json({"error": err})
            return self._json({"run_id": run_id})
        self._api()


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
