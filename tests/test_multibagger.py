"""Unit tests for the multibagger-potential scoring engine (pure stdlib)."""
import unittest

import multibagger as mb


STRONG_SMALLCAP = {
    "mcap_cr": 1800,
    "revenue_growth_pct": 28,
    "earnings_growth_pct": 35,
    "roe_pct": 24,
    "op_margin_pct": 18,
    "debt_equity": 0.12,
    "current_ratio": 2.4,
    "fcf_cr": 120,
    "insider_pct": 62,
    "institution_pct": 8,
    "pe": 22,
    "peg": 0.8,
    "vs_200dma_pct": 6,
    "pct_from_high_pct": -8,
    "price_cagr_3y_pct": 32,
}

WEAK_LARGECAP = {
    "mcap_cr": 450000,
    "revenue_growth_pct": 4,
    "earnings_growth_pct": -6,
    "roe_pct": 7,
    "op_margin_pct": 5,
    "debt_equity": 1.9,
    "current_ratio": 0.7,
    "fcf_cr": -800,
    "insider_pct": 10,
    "institution_pct": 55,
    "pe": 70,
    "peg": 5.2,
    "vs_200dma_pct": -18,
    "pct_from_high_pct": -65,
    "price_cagr_3y_pct": -4,
}


class MultibaggerScoreTest(unittest.TestCase):
    def test_strong_smallcap_scores_high(self):
        r = mb.score(STRONG_SMALLCAP)
        self.assertGreaterEqual(r["score"], 75)
        self.assertEqual(r["tier"], "HIGH POTENTIAL")
        self.assertEqual(r["coverage_pct"], 100)
        self.assertTrue(any("Small base" in s for s in r["strengths"]))
        self.assertEqual(r["red_flags"], [])

    def test_weak_largecap_scores_low(self):
        r = mb.score(WEAK_LARGECAP)
        self.assertLess(r["score"], 40)
        self.assertIn(r["tier"], ("WEAK", "LOW"))
        self.assertTrue(any("large base" in f or "cr company" in f for f in r["red_flags"]))
        self.assertTrue(any("leverage" in f.lower() for f in r["red_flags"]))

    def test_probability_is_bounded_and_monotonic(self):
        hi = mb.score(STRONG_SMALLCAP)["probability_pct"]
        lo = mb.score(WEAK_LARGECAP)["probability_pct"]
        self.assertGreater(hi, lo)
        for p in (hi, lo):
            self.assertGreaterEqual(p, 2)
            self.assertLessEqual(p, 70)

    def test_empty_metrics_do_not_crash(self):
        r = mb.score({})
        self.assertEqual(r["score"], 0)
        self.assertEqual(r["coverage_pct"], 0)
        self.assertEqual(len(r["pillars"]), len(mb.PILLARS))
        self.assertTrue(all(p["score"] is None for p in r["pillars"]))
        # Every checklist item is unknown, none silently pass/fail.
        self.assertTrue(all(c["state"] == "unknown" for c in r["checklist"]))
        self.assertTrue(any("Growth data unavailable" in f for f in r["red_flags"]))

    def test_partial_metrics_score_covered_pillars_only(self):
        r = mb.score({"mcap_cr": 900, "roe_pct": 30, "op_margin_pct": 25})
        # size (18) + quality (18) covered out of 100 -> 36% coverage
        self.assertEqual(r["coverage_pct"], 36)
        self.assertGreaterEqual(r["score"], 90)  # both covered pillars are strong

    def test_checklist_states(self):
        r = mb.score(STRONG_SMALLCAP)
        by_label = {c["label"]: c["state"] for c in r["checklist"]}
        self.assertEqual(by_label["Small-cap base (< ₹5,000 cr)"], "pass")
        self.assertEqual(by_label["Debt/equity < 0.5"], "pass")
        r2 = mb.score(WEAK_LARGECAP)
        by_label2 = {c["label"]: c["state"] for c in r2["checklist"]}
        self.assertEqual(by_label2["Small-cap base (< ₹5,000 cr)"], "fail")
        self.assertEqual(by_label2["Price above 200-DMA (uptrend)"], "fail")

    def test_pillar_weights_sum_to_100(self):
        self.assertEqual(sum(w for _, _, w, _ in mb.PILLARS), 100)


if __name__ == "__main__":
    unittest.main()


class ResolveResilienceTest(unittest.TestCase):
    """fetch_metrics/_resolve must tolerate a flaky Yahoo: retry, fall back to
    BSE, and raise a clean ValueError (→ 404) rather than propagating an
    exception (which the route turned into a 502)."""

    def setUp(self):
        import sys
        self._saved = sys.modules.get("yfinance")

    def tearDown(self):
        import sys
        if self._saved is not None:
            sys.modules["yfinance"] = self._saved
        else:
            sys.modules.pop("yfinance", None)

    @staticmethod
    def _install(behavior):
        import sys, types

        class _FakeTicker:
            def __init__(self, symbol):
                self.symbol = symbol

            @property
            def info(self):
                b = behavior.get(self.symbol)
                if isinstance(b, Exception):
                    raise b
                return b or {}

            def history(self, *a, **k):
                class _Empty:
                    empty = True
                return _Empty()

        mod = types.ModuleType("yfinance")
        mod.Ticker = _FakeTicker
        sys.modules["yfinance"] = mod

    def test_nse_hit_no_fallback(self):
        self._install({"DEEPINDS.NS": {"longName": "Deep Industries", "regularMarketPrice": 100}})
        t, info = mb._resolve("DEEPINDS", retries=0)
        self.assertEqual(t.symbol, "DEEPINDS.NS")
        self.assertEqual(info["longName"], "Deep Industries")

    def test_falls_back_to_bse_when_nse_raises(self):
        self._install({
            "DEEPINDS.NS": RuntimeError("rate limited"),
            "DEEPINDS.BO": {"shortName": "Deep Ind", "regularMarketPrice": 100},
        })
        t, info = mb._resolve("DEEPINDS", retries=0)
        self.assertEqual(t.symbol, "DEEPINDS.BO")
        self.assertTrue(info.get("shortName"))

    def test_both_exchanges_raise_yield_valueerror(self):
        self._install({"X.NS": RuntimeError("boom"), "X.BO": RuntimeError("boom")})
        with self.assertRaises(ValueError):
            mb.fetch_metrics("X", with_history=False, retries=0)

    def test_empty_info_yields_valueerror(self):
        self._install({"X.NS": {}, "X.BO": {}})
        with self.assertRaises(ValueError):
            mb.fetch_metrics("X", with_history=False, retries=0)

    def test_metrics_built_from_resolved_info(self):
        self._install({"GOOD.NS": {
            "longName": "Good Co", "regularMarketPrice": 250, "marketCap": 18_000_000_000,
            "returnOnEquity": 0.24, "sector": "Industrials",
        }})
        metrics, ident = mb.fetch_metrics("GOOD", with_history=False, retries=0)
        self.assertEqual(ident["name"], "Good Co")
        self.assertEqual(ident["price"], 250)
        self.assertEqual(metrics["roe_pct"], 24.0)
        self.assertIsInstance(mb.score(metrics)["score"], int)


class ProbeFallbackTest(unittest.TestCase):
    """When `.info` is rate-limited but the chart/history API still returns a
    price, a user-initiated lookup (retries > 0) must resolve via the probe
    instead of failing — but the mass screen (retries = 0) must NOT probe."""

    def setUp(self):
        import sys
        self._saved = sys.modules.get("yfinance")

    def tearDown(self):
        import sys
        if self._saved is not None:
            sys.modules["yfinance"] = self._saved
        else:
            sys.modules.pop("yfinance", None)

    @staticmethod
    def _install(last_close):
        import sys, types

        class _Iloc:
            def __init__(self, v):
                self._v = v

            def __getitem__(self, i):
                return self._v[i]

        class _Series:
            def __init__(self, v):
                self._v = v

            def dropna(self):
                return self

            def __len__(self):
                return len(self._v)

            @property
            def iloc(self):
                return _Iloc(self._v)

        class _Frame:
            def __init__(self, closes):
                self._c = _Series(closes)

            def __getitem__(self, k):
                return self._c

        class _FakeTicker:
            def __init__(self, symbol):
                self.symbol = symbol

            @property
            def info(self):
                return {}  # always rate-limited / sparse

            def history(self, *a, **k):
                # 3y monthly call (fetch_metrics) and the 5d probe both land here.
                return _Frame([last_close] * 30)

        mod = types.ModuleType("yfinance")
        mod.Ticker = _FakeTicker
        sys.modules["yfinance"] = mod

    def test_user_lookup_probes_price_when_info_sparse(self):
        self._install(last_close=142.5)
        t, info = mb._resolve("SMALLCAP", retries=1)
        self.assertEqual(info.get("regularMarketPrice"), 142.5)
        metrics, ident = mb.fetch_metrics("SMALLCAP", retries=1)
        self.assertEqual(ident["price"], 142.5)
        # A valid (if sparse) report is produced rather than a ValueError.
        self.assertIsInstance(mb.score(metrics)["score"], int)

    def test_mass_screen_does_not_probe(self):
        self._install(last_close=142.5)
        # retries=0 (mass screen): no probe → sparse info → ValueError.
        with self.assertRaises(ValueError):
            mb.fetch_metrics("SMALLCAP", with_history=False, retries=0)


class ScreenCacheTest(unittest.TestCase):
    """The background screen stores each hit's full metrics so a rate-limited
    live report can be rebuilt from it (mb_screen.cached)."""

    def test_cached_returns_stored_metrics(self):
        import mb_screen
        mb_screen._state["results"] = [
            {"symbol": "GOKULAGRO", "score": 68, "name": "Gokul Agro",
             "sector": "Consumer", "price": 210.0, "metrics": dict(STRONG_SMALLCAP)},
        ]
        hit = mb_screen.cached("gokulagro")
        self.assertIsNotNone(hit)
        self.assertEqual(hit["metrics"]["roe_pct"], STRONG_SMALLCAP["roe_pct"])
        self.assertIsNone(mb_screen.cached("NOTLISTED"))
        # A full report can be rebuilt from the cached metrics.
        report = mb.score(hit["metrics"])
        self.assertGreaterEqual(report["score"], 75)
