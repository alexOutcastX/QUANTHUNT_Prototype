"""Throwaway static server for headless verification. Serves mobile/dist; stubs API as empty."""
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIST = os.path.join(os.path.dirname(__file__), "mobile", "dist")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5056


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
        }.get(cat, [])
        rows = [{"key": k, "name": n, "level": lv, "chg": c, "y1": y, "category": cat}
                for (k, n, lv, c, y) in sample]
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"indices": rows, "asof": 1752350000, "cached": False}).encode())

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
        rows = [{"symbol": s, "price": 1000 + i * 137.5, "prevClose": 990 + i * 137.0,
                 "chg": (-2.5 + i * 0.6), "absChg": 10 + i, "volume": 1500000 + i * 250000}
                for i, s in enumerate(self.SYMS)]
        self._json({"index": "NIFTY 50", "count": len(rows), "data": rows})

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
        data = {s: {"pe": 20 + i, "pb": 2 + i * 0.3, "roe": 10 + (i % 12) * 2, "roce": 14 + i,
                    "debt_equity": round(0.1 + (i % 7) * 0.12, 2), "dividend_yield": round(0.5 + i * 0.2, 1),
                    "market_cap_cr": mcaps[i % 6], "sector": secs[i % 6]}
                for i, s in enumerate(self.SYMS)}
        self._json({"data": data, "pending": [], "provider": "stub", "cached": len(data), "total": len(data)})

    def _history(self):
        import math
        candles = []
        px = 500.0
        for i in range(126):
            px *= 1 + 0.004 * math.sin(i / 9.0) + 0.0012
            candles.append({"t": 1735689600 + i * 86400, "o": round(px * 0.995, 2),
                            "h": round(px * 1.01, 2), "l": round(px * 0.985, 2),
                            "c": round(px, 2), "v": 100000 + i * 900})
        self._json({"symbol": "STUB", "period": "6mo", "interval": "1d",
                    "count": len(candles), "candles": candles})

    def _json(self, payload):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode())

    def _universe(self):
        syms = [{"symbol": s, "name": f"{s.title()} Industries Limited", "exchange": "NSE"}
                for s in self.SYMS]
        # BSE-only scrips (never on NSE) — must be searchable in predictive too.
        syms.append({"symbol": "CIANAGRO", "name": "Cian Agro Industries & Infrastructure Ltd",
                     "exchange": "BSE"})
        self._json({"ready": True, "total": len(syms), "nse": len(self.SYMS),
                    "bse": 1, "symbols": syms})

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
                      "low": round(base * 0.98, 2), "volume": 120000 + i * 45000, "source": "stub"}
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

    def _smc(self):
        from urllib.parse import urlparse, parse_qs
        import smc as S
        q = parse_qs(urlparse(self.path).query)
        sym = (q.get("symbol", ["STUB"])[0]).upper()
        name = q.get("name", [None])[0]
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
        res = S.analyze(sym, cndls, name)
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
        if path == "/momentum/screen":
            return self._mom_screen()
        if path == "/multibagger/screen":
            return self._mb_screen()
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
        if path == "/fundamentals/bulk":
            return self._fund_bulk()
        if path == "/graph":
            return self._graph()
        if path == "/entity-graph":
            return self._entity_graph()
        if path == "/corporate/shareholding":
            return self._shareholding()
        if path == "/indices":
            return self._indices()
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

    def do_POST(self):
        self._api()


ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
