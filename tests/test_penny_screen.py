"""Unit tests for the penny-stock screen.

This screen covers the segment where the difference between a small real
business and a shell is the whole question, so the grading is pinned hard: a
liquid profitable small-cap and an illiquid loss-making shell must never come
out looking alike.
"""
import unittest

import penny_screen as ps

CR = 1e7
LAKH = 1e5


def _u(symbol, price, turnover, name=None, chg=0.0, exchange="NSE"):
    return {"symbol": symbol, "name": name or f"{symbol} Ltd", "price": price,
            "turnover": turnover, "chg": chg, "exchange": exchange}


GOOD = {"eps": 2.1, "roe": 18.0, "debt_equity": 0.25, "ocf_cr": 40.0,
        "market_cap_cr": 900.0, "pb": 1.8, "revenue_growth_pct": 20.0,
        "sector": "Capital Goods"}
SHELL = {"eps": -1.2, "roe": -14.0, "debt_equity": 4.0, "ocf_cr": -18.0,
         "market_cap_cr": 40.0, "pb": -0.6, "revenue_growth_pct": -30.0,
         "sector": "Textiles"}


class LiquidityTest(unittest.TestCase):
    def test_grades(self):
        self.assertEqual(ps.liquidity_grade(5 * CR), "tradeable")
        self.assertEqual(ps.liquidity_grade(1 * CR), "thin")
        self.assertEqual(ps.liquidity_grade(2 * LAKH), "illiquid")

    def test_boundaries_are_inclusive_at_the_floor(self):
        self.assertEqual(ps.liquidity_grade(ps.LIQ_TRADEABLE), "tradeable")
        self.assertEqual(ps.liquidity_grade(ps.LIQ_TRADEABLE - 1), "thin")
        self.assertEqual(ps.liquidity_grade(ps.LIQ_THIN), "thin")
        self.assertEqual(ps.liquidity_grade(ps.LIQ_THIN - 1), "illiquid")

    def test_no_turnover_is_unknown_not_zero_risk(self):
        for v in (None, 0, "", "abc"):
            self.assertEqual(ps.liquidity_grade(v), "unknown")


class BandTest(unittest.TestCase):
    def test_narrowest_band_wins(self):
        self.assertEqual(ps.band_of(4.0), "under10")
        self.assertEqual(ps.band_of(22.0), "10to50")
        self.assertEqual(ps.band_of(75.0), "50to100")

    def test_boundaries(self):
        self.assertEqual(ps.band_of(9.99), "under10")
        self.assertEqual(ps.band_of(10.0), "10to50")
        self.assertEqual(ps.band_of(50.0), "50to100")

    def test_outside_every_band(self):
        self.assertIsNone(ps.band_of(250.0))
        self.assertIsNone(ps.band_of(0))
        self.assertIsNone(ps.band_of(None))


class AssessTest(unittest.TestCase):
    def test_a_liquid_profitable_smallcap_reads_moderate(self):
        a = ps.assess(_u("GOODCO", 8.0, 5 * CR), GOOD)
        self.assertEqual(a["risk_grade"], "moderate")
        self.assertEqual(a["liquidity"], "tradeable")
        self.assertFalse(a["flags"])
        self.assertTrue(a["positives"])

    def test_an_illiquid_shell_reads_extreme(self):
        a = ps.assess(_u("SHELL", 2.0, 1 * LAKH), SHELL)
        self.assertEqual(a["risk_grade"], "extreme")
        self.assertEqual(a["liquidity"], "illiquid")
        self.assertGreaterEqual(len(a["flags"]), 5)

    def test_the_two_are_never_confusable(self):
        good = ps.assess(_u("GOODCO", 8.0, 5 * CR), GOOD)
        shell = ps.assess(_u("SHELL", 2.0, 1 * LAKH), SHELL)
        self.assertLess(good["risk_score"], shell["risk_score"] - 40)

    def test_missing_fundamentals_is_itself_a_finding(self):
        """Silence about a ₹3 scrip is information, not a neutral blank."""
        a = ps.assess(_u("NODATA", 3.0, 5 * CR), None)
        self.assertFalse(a["has_fundamentals"])
        self.assertTrue(any("No fundamental data" in f for f in a["flags"]))
        self.assertGreaterEqual(a["risk_score"], ps.RISK["no_fundamentals"])

    def test_liquidity_alone_can_lift_the_grade(self):
        """Even a sound business is dangerous if you can't sell it."""
        a = ps.assess(_u("STUCK", 6.0, 50000), GOOD)
        self.assertEqual(a["liquidity"], "illiquid")
        self.assertNotEqual(a["risk_grade"], "moderate")
        self.assertTrue(any("Illiquid" in f for f in a["flags"]))

    def test_negative_book_value_is_flagged(self):
        a = ps.assess(_u("NEG", 4.0, 3 * CR), {"pb": -1.2, "eps": 0.5, "market_cap_cr": 500})
        self.assertTrue(any("Negative book value" in f for f in a["flags"]))

    def test_nano_cap_is_flagged(self):
        a = ps.assess(_u("TINY", 4.0, 3 * CR), {"market_cap_cr": 45.0, "eps": 0.2})
        self.assertTrue(any("Nano-cap" in f for f in a["flags"]))

    def test_loss_making_is_flagged_with_the_number(self):
        a = ps.assess(_u("LOSS", 4.0, 3 * CR), {"eps": -0.8, "market_cap_cr": 500})
        self.assertTrue(any("Loss-making" in f and "-0.80" in f for f in a["flags"]))

    def test_cash_burn_is_flagged_separately_from_losses(self):
        a = ps.assess(_u("BURN", 4.0, 3 * CR), {"eps": 0.4, "ocf_cr": -25.0, "market_cap_cr": 500})
        self.assertTrue(any("Burning cash" in f for f in a["flags"]))
        self.assertFalse(any("Loss-making" in f for f in a["flags"]))

    def test_score_is_capped_at_100(self):
        a = ps.assess(_u("WORST", 1.0, 0), {**SHELL, "market_cap_cr": 5.0})
        self.assertLessEqual(a["risk_score"], 100)

    def test_every_flag_reads_as_a_sentence(self):
        """These strings are the whole product on this screen — a bare token
        like 'illiquid' would tell the user nothing they can act on."""
        a = ps.assess(_u("SHELL", 2.0, 1 * LAKH), SHELL)
        for f in a["flags"]:
            self.assertGreater(len(f), 30, f)
            self.assertTrue(f[0].isupper(), f)
            self.assertTrue(f.rstrip().endswith("."), f)


class ScreenTest(unittest.TestCase):
    def setUp(self):
        self.uni = [
            _u("GOODCO", 8.0, 5 * CR),
            _u("SHELL", 2.0, 1 * LAKH),
            _u("THIN", 9.5, 60 * LAKH),
            _u("MID", 30.0, 8 * CR),
            _u("BIG", 2400.0, 90 * CR),
        ]
        self.funds = {"GOODCO": GOOD, "SHELL": SHELL, "MID": GOOD}

    def test_band_filters_by_price(self):
        r = ps.screen(self.uni, self.funds, band="under10")
        self.assertEqual({x["symbol"] for x in r["rows"]}, {"GOODCO", "SHELL", "THIN"})

    def test_a_wider_band_includes_more(self):
        r = ps.screen(self.uni, self.funds, band="under100")
        self.assertIn("MID", {x["symbol"] for x in r["rows"]})
        self.assertNotIn("BIG", {x["symbol"] for x in r["rows"]})

    def test_most_tradeable_comes_first(self):
        """Sorting cheapest-first would put the most dangerous scrip on top."""
        rows = ps.screen(self.uni, self.funds, band="under10")["rows"]
        self.assertEqual(rows[0]["symbol"], "GOODCO")
        self.assertEqual(rows[-1]["symbol"], "SHELL")

    def test_volume_floor_excludes_the_untradeable(self):
        rows = ps.screen(self.uni, self.funds, band="under100", min_turnover=1 * CR)["rows"]
        self.assertEqual({x["symbol"] for x in rows}, {"GOODCO", "MID"})

    def test_risk_cap_excludes_the_dangerous(self):
        rows = ps.screen(self.uni, self.funds, band="under10", max_risk="moderate")["rows"]
        self.assertEqual({x["symbol"] for x in rows}, {"GOODCO"})

    def test_nothing_is_silently_dropped(self):
        """Unfiltered, every scrip in the band appears — including the shells."""
        r = ps.screen(self.uni, self.funds, band="under10")
        self.assertEqual(r["matches"], r["in_band"])
        self.assertEqual(r["matches"], 3)

    def test_counts_are_reported(self):
        r = ps.screen(self.uni, self.funds, band="under10")
        self.assertEqual(sum(r["grades"].values()), 3)
        self.assertEqual(sum(r["liquidity_mix"].values()), 3)
        self.assertEqual(r["with_fundamentals"], 2)

    def test_truncation_is_declared(self):
        big = [_u(f"S{i}", 5.0, 3 * CR) for i in range(40)]
        r = ps.screen(big, {}, band="under10", limit=10)
        self.assertTrue(r["truncated"])
        self.assertEqual(r["count"], 10)
        self.assertEqual(r["matches"], 40)

    def test_no_truncation_flag_when_everything_fits(self):
        r = ps.screen(self.uni, self.funds, band="under10", limit=100)
        self.assertFalse(r["truncated"])

    def test_rows_carry_what_the_page_shows(self):
        row = ps.screen(self.uni, self.funds, band="under10")["rows"][0]
        for k in ("symbol", "name", "price", "chg", "turnover_cr", "risk_grade",
                  "risk_score", "liquidity", "flags", "positives", "has_fundamentals"):
            self.assertIn(k, row)

    def test_junk_rows_are_ignored(self):
        uni = [{"symbol": "", "price": 5}, {"symbol": "X"}, {"symbol": "Y", "price": 0},
               {"symbol": "Z", "price": -3}]
        self.assertEqual(ps.screen(uni, {}, band="under10")["matches"], 0)

    def test_empty_universe(self):
        r = ps.screen([], {}, band="under10")
        self.assertEqual(r["rows"], [])
        self.assertEqual(r["matches"], 0)

    def test_unknown_band_falls_back_to_the_default(self):
        r = ps.screen(self.uni, self.funds, band="not-a-band")
        self.assertEqual(r["band_label"], ps.BANDS[ps.DEFAULT_BAND]["label"])

    def test_bands_are_published_for_the_picker(self):
        r = ps.screen(self.uni, self.funds)
        keys = {b["key"] for b in r["bands"]}
        self.assertEqual(keys, set(ps.BANDS))
        self.assertTrue(all(b.get("note") for b in r["bands"]))


class RouteTest(unittest.TestCase):
    """The /penny/screen route against a seeded universe cache.

    Pinned because the first cut of this route iterated
    get_universe_nonblocking() as a list when it actually returns
    (rows, warming) — which 500'd the whole tab.
    """

    @classmethod
    def setUpClass(cls):
        import os
        import tempfile
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        os.environ["TRADELOG_BACKFILL"] = "0"
        try:
            import server
        except Exception as e:                      # flask absent in the stdlib CI path
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        cls.client = server.app.test_client()
        # A cold-cache request kicks a background bhavcopy fetch that would
        # replace the seeded universe mid-test (NSE is reachable from CI).
        # Stub it — these tests are about the route, not the loader.
        cls._warm = server._warm_universe_async
        server._warm_universe_async = lambda: None

    @classmethod
    def tearDownClass(cls):
        cls.server._warm_universe_async = cls._warm

    def _seed(self, rows):
        import time
        self.server._universe_cache = rows
        self.server._universe_ts = time.time() if rows else 0

    def test_route_returns_a_graded_screen(self):
        self._seed([
            {"symbol": "GOOD", "name": "Good", "price": 5.0, "turnover": 3e7,
             "chg": 1.0, "exchange": "NSE"},
            {"symbol": "SHELL", "name": "Shell", "price": 2.0, "turnover": 1e5,
             "chg": 9.0, "exchange": "NSE"},
            {"symbol": "BIG", "name": "Big", "price": 2400.0, "turnover": 9e8,
             "chg": 0.1, "exchange": "NSE"},
        ])
        r = self.client.get("/penny/screen?band=under10")
        self.assertEqual(r.status_code, 200)
        d = r.get_json()
        self.assertEqual(d["matches"], 2)
        self.assertEqual({x["symbol"] for x in d["rows"]}, {"GOOD", "SHELL"})
        self.assertFalse(d["warming"])

    def test_cold_universe_does_not_error(self):
        self._seed([])
        r = self.client.get("/penny/screen")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.get_json()["warming"])
        self.assertEqual(r.get_json()["matches"], 0)

    def test_filters_pass_through(self):
        self._seed([
            {"symbol": "LIQUID", "name": "Liquid", "price": 5.0, "turnover": 5e7,
             "chg": 0.0, "exchange": "NSE"},
            {"symbol": "DEAD", "name": "Dead", "price": 5.0, "turnover": 1e4,
             "chg": 0.0, "exchange": "NSE"},
        ])
        r = self.client.get("/penny/screen?band=under10&min_turnover=10000000")
        self.assertEqual([x["symbol"] for x in r.get_json()["rows"]], ["LIQUID"])


class BackfillUniverseTest(unittest.TestCase):
    """The replay takes the same universe callable — and hit the same bug."""

    def test_accepts_both_universe_shapes(self):
        import backfill
        rows = [{"symbol": "A", "name": "A Ltd"}, {"symbol": "B", "name": "B Ltd"}]
        self.assertEqual(len(backfill.rows_of(rows)), 2)              # get_universe
        self.assertEqual(len(backfill.rows_of((rows, False))), 2)     # …_nonblocking
        self.assertEqual(backfill.rows_of((rows, True))[0]["symbol"], "A")

    def test_survives_junk(self):
        import backfill
        self.assertEqual(backfill.rows_of(None), [])
        self.assertEqual(backfill.rows_of(([], True)), [])
        self.assertEqual(backfill.rows_of(["not-a-dict", None, 7]), [])
        self.assertEqual(backfill.rows_of([{"name": "no symbol"}]), [])


if __name__ == "__main__":
    unittest.main()
