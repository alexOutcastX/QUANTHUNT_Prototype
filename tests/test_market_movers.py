"""The day's biggest movers across the whole market, and the two things that
would otherwise make that list a lie.

Every movers list on the page was scoped to a constituent list — NIFTY 500 for
breadth, NIFTY 50 and SENSEX in the slider — so the day's biggest actual moves,
which are almost never large caps, appeared nowhere.

Ranking ~5,700 bhavcopy rows by change is one sort. Doing it HONESTLY is the
work, and it needs two filters:

  * A turnover floor. With none, the list is rights entitlements and shells
    that printed a single trade, several pegged at exactly ±20% because they
    hit the circuit band rather than because anyone moved them.

  * A comparable previous close. The bhavcopy's PREV_CLOSE is raw — unadjusted
    for splits, bonuses and demergers, and on a listing day it is the issue
    price. A 1:10 split prints as −90% and a listing pop as +95%, and both
    would top the list while describing nothing that happened in the market.

The second is the subtle one, and the test that matters most here: the tell is
not the SIZE of the change (a stock really can fall 20%) but that the stock
never traded anywhere near its stated previous close.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import server
except Exception:                                            # pragma: no cover
    server = None                     # the stdlib CI gate has no Flask


def row(symbol, price, prev, low=None, high=None, turnover=5e8, name=None):
    chg = round((price - prev) / prev * 100, 2) if prev else None
    return {"symbol": symbol, "exchange": "NSE", "name": name or symbol,
            "price": price, "prevClose": prev, "chg": chg,
            "absChg": round(price - prev, 2),
            "low": low if low is not None else min(price, prev),
            "high": high if high is not None else max(price, prev),
            "volume": 100000, "turnover": turnover}


@unittest.skipUnless(server, "server import unavailable")
class ComparablePrevCloseTest(unittest.TestCase):
    """Real numbers from the session this was written."""

    def test_a_ten_to_one_split_is_not_a_ninety_percent_fall(self):
        """GOLDADD: 152.98 -> 15.36. It never traded within ten times its
        stated previous close."""
        self.assertFalse(server._comparable_prev_close(
            row("GOLDADD", 15.36, 152.98, low=15.09, high=15.49)))

    def test_a_listing_pop_is_not_a_ninety_five_percent_gain(self):
        """TEMPSENS: the 'previous close' is the issue price, 300, and the
        stock traded 551-635 all day. It did not move 95%; it listed."""
        self.assertFalse(server._comparable_prev_close(
            row("TEMPSENS", 586.65, 300.0, low=551.15, high=634.85)))

    def test_a_stock_locked_at_its_lower_circuit_is_a_real_move(self):
        """WEL: −19.99%, and it traded only at 99.80 against a previous close
        of 124.74. The widest real gap in the whole session, and it must
        survive — this is the case a blunt size threshold would destroy."""
        self.assertTrue(server._comparable_prev_close(
            row("WEL", 99.8, 124.74, low=99.8, high=99.8)))

    def test_an_ordinary_gap_down_survives(self):
        self.assertTrue(server._comparable_prev_close(
            row("JAYKAY", 154.11, 169.62, low=149.0, high=156.8)))

    def test_a_previous_close_inside_the_days_range_is_always_comparable(self):
        self.assertTrue(server._comparable_prev_close(
            row("ORDINARY", 105.0, 100.0, low=98.0, high=107.0)))

    def test_a_row_with_nothing_to_judge_on_is_kept(self):
        """No OHLC is not evidence of a corporate action, and silently
        dropping rows is worse than keeping an uncertain one."""
        self.assertTrue(server._comparable_prev_close(
            {"symbol": "X", "prevClose": 100.0, "chg": 5.0}))
        self.assertTrue(server._comparable_prev_close(
            {"symbol": "X", "prevClose": None, "low": 1, "high": 2}))

    def test_the_threshold_sits_above_the_widest_price_band(self):
        """NSE's widest band is 20%, so a gap of half again cannot happen in
        an ordinary session — which is what makes this rule safe."""
        self.assertGreater(server._PREV_CLOSE_GAP, 1.2)


@unittest.skipUnless(server, "server import unavailable")
class MarketMoversRouteTest(unittest.TestCase):
    UNIVERSE = [
        row("REALUP", 120.0, 100.0, low=101.0, high=121.0),          # +20.00
        row("MIDUP", 110.0, 100.0, low=100.0, high=111.0),           # +10.00
        row("SMALLUP", 103.0, 100.0),                                #  +3.00
        row("FLAT", 100.0, 100.0),                                   #   0.00
        row("SMALLDN", 97.0, 100.0),                                 #  -3.00
        row("MIDDN", 90.0, 100.0, low=89.0, high=100.0),             # -10.00
        row("REALDN", 80.0, 100.0, low=80.0, high=80.0),             # -20.00
        # Excluded: a 1:10 split, which is not a −90% day.
        row("SPLIT", 10.0, 100.0, low=9.8, high=10.4),
        # Excluded: illiquid, and it printed one trade at the circuit.
        row("SHELL", 240.0, 200.0, low=239.0, high=240.0, turnover=1e5),
    ]

    def setUp(self):
        self.saved = server._universe_cache, server._universe_ts
        server._universe_cache = list(self.UNIVERSE)
        server._universe_ts = 1e12          # far future: never looks stale
        server._RL.clear()
        self.c = server.app.test_client()

    def tearDown(self):
        server._universe_cache, server._universe_ts = self.saved

    def get(self, qs=""):
        r = self.c.get("/movers/market" + qs)
        self.assertEqual(r.status_code, 200)
        return r.get_json()

    def test_it_ranks_the_whole_market_not_an_index(self):
        d = self.get("?n=2")
        self.assertEqual([g["symbol"] for g in d["gainers"]], ["REALUP", "MIDUP"])
        self.assertEqual([l["symbol"] for l in d["losers"]], ["REALDN", "MIDDN"])

    def test_losers_are_worst_first(self):
        d = self.get("?n=3")
        chgs = [l["chg"] for l in d["losers"]]
        self.assertEqual(chgs, sorted(chgs))

    def test_a_split_never_reaches_the_list(self):
        d = self.get("?n=9")
        self.assertNotIn("SPLIT", [l["symbol"] for l in d["losers"]])
        self.assertEqual(d["excluded"], 1)

    def test_an_illiquid_scrip_is_below_the_floor(self):
        d = self.get("?n=9")
        self.assertNotIn("SHELL", [g["symbol"] for g in d["gainers"]])

    def test_the_floor_is_adjustable_and_reported(self):
        d = self.get("?n=9&min_turnover=0")
        self.assertIn("SHELL", [g["symbol"] for g in d["gainers"]])
        self.assertEqual(d["min_turnover"], 0)

    def test_it_says_how_many_names_it_ranked(self):
        """'Top movers' over a filtered subset is a different claim from 'top
        movers', and the UI needs the numbers to say which one it is."""
        d = self.get()
        self.assertEqual(d["universe"], 7)      # 9 rows, minus the split and the shell
        self.assertEqual(d["traded"], 9)
        self.assertEqual(d["excluded"], 1)

    def test_the_page_size_is_bounded(self):
        self.assertLessEqual(len(self.get("?n=9999")["gainers"]), 25)

    def test_a_bad_floor_falls_back_rather_than_failing(self):
        self.assertEqual(self.get("?min_turnover=abc")["min_turnover"],
                         server._MARKET_MOVERS_FLOOR)

    def test_a_negative_floor_cannot_be_asked_for(self):
        self.assertGreaterEqual(self.get("?min_turnover=-5")["min_turnover"], 0)

    def test_a_cold_universe_says_it_is_warming_rather_than_blocking(self):
        """A multi-second bhavcopy fetch on a request thread; a handful of
        those together saturate the worker pool.

        The warm is stubbed: letting it run would have this test download the
        day's bhavcopy, which is neither what it is checking nor something a
        unit test should need a network for.
        """
        warmed = []
        saved = server._warm_universe_async
        server._warm_universe_async = lambda: warmed.append(True)
        server._universe_cache = []
        server._universe_ts = 0
        try:
            d = self.get()
        finally:
            server._warm_universe_async = saved
        self.assertEqual(d["gainers"], [])
        self.assertTrue(d["running"])
        self.assertTrue(warmed, "a cold request should kick a background warm")


if __name__ == "__main__":
    unittest.main()
