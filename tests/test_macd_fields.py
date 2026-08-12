"""MACD + moving-average ladder on the recommendation engine, and the radar
forwarding the fields the scanner already computed.

The MACD strategy filters on these, so a wrong sign or a silently-absent field
is the difference between a screen that works and one that quietly returns
nothing — or worse, returns everything.
"""
import os
import unittest

import recommend


class MacdMathTest(unittest.TestCase):
    def test_ema_series_matches_the_scalar_helper(self):
        """_ema_series must be the same recurrence _ema already uses, or the
        MACD line drifts from every other EMA in the file."""
        vals = [10.0 + i * 0.5 for i in range(60)]
        self.assertAlmostEqual(recommend._ema_series(vals, 12)[-1],
                               recommend._ema(vals, 12), places=9)

    def test_short_history_returns_no_macd_rather_than_a_wrong_one(self):
        now, prev = recommend._macd_hist([100.0] * 10)
        self.assertIsNone(now)
        self.assertIsNone(prev)

    def test_a_flat_series_has_no_momentum(self):
        now, prev = recommend._macd_hist([100.0] * 200)
        self.assertAlmostEqual(now, 0.0, places=6)
        self.assertAlmostEqual(prev, 0.0, places=6)

    def test_a_sustained_rally_turns_the_histogram_positive(self):
        closes = [100.0] * 60 + [100.0 + i for i in range(1, 60)]
        now, prev = recommend._macd_hist(closes)
        self.assertGreater(now, 0)

    def test_a_downtrend_turns_it_negative(self):
        closes = [200.0] * 60 + [200.0 - i for i in range(1, 60)]
        now, _ = recommend._macd_hist(closes)
        self.assertLess(now, 0)

    def test_the_previous_bar_is_a_different_bar(self):
        """A cross is a sign change between consecutive bars — if prev were
        just a copy of now, no cross could ever be detected."""
        closes = [100.0] * 60 + [100.0 + i * 2 for i in range(1, 60)]
        now, prev = recommend._macd_hist(closes)
        self.assertNotAlmostEqual(now, prev, places=6)

    def test_a_turn_up_shows_as_rising_while_still_negative(self):
        """The 'slowly crossing' case the strategy is built around.

        The window is genuinely narrow: the histogram is MACD minus its own
        signal line, so it turns positive within a couple of bars of the price
        stabilising — well before price reclaims any moving average. That is
        the point of screening on it, and it is why the strategy pairs
        'rising' with a DMA position rather than using it alone.
        """
        decline = [200.0 - i for i in range(0, 80)]
        now, prev = recommend._macd_hist(decline + [120.0])
        self.assertGreater(now, prev, "histogram should be improving")
        self.assertLess(now, 0, "but not yet through zero")

    def test_the_histogram_crosses_within_a_bar_or_two_of_the_turn(self):
        """Pinning the timing, because the strategy's 'rising' mode depends on
        there being a real window before the cross — if it flipped on the same
        bar the price turned, 'rising while negative' would match nothing."""
        decline = [200.0 - i for i in range(0, 80)]
        after = [recommend._macd_hist(decline + [120.0 + i * 0.4 for i in range(0, n)])[0]
                 for n in (1, 2, 3)]
        self.assertLess(after[0], 0)
        self.assertGreater(after[1], 0)
        self.assertGreater(after[2], after[1])


class SmaDistanceTest(unittest.TestCase):
    def test_distance_sign_says_which_side_of_the_average_price_is(self):
        # Negative = below. The whole 'below the 200-DMA' screen depends on it.
        self.assertLess(recommend._dist_pct(90.0, 100.0), 0)
        self.assertGreater(recommend._dist_pct(110.0, 100.0), 0)
        self.assertEqual(recommend._dist_pct(100.0, 100.0), 0.0)

    def test_distance_is_a_percentage(self):
        self.assertAlmostEqual(recommend._dist_pct(90.0, 100.0), -10.0, places=6)

    def test_missing_or_zero_level_yields_none_not_a_division_error(self):
        self.assertIsNone(recommend._dist_pct(100.0, None))
        self.assertIsNone(recommend._dist_pct(100.0, 0))

    def test_sma_needs_a_full_window(self):
        self.assertIsNone(recommend._sma([1.0] * 10, 20))
        self.assertAlmostEqual(recommend._sma([2.0] * 20, 20), 2.0, places=9)

    def test_sma_uses_the_most_recent_window(self):
        vals = [1.0] * 50 + [10.0] * 20
        self.assertAlmostEqual(recommend._sma(vals, 20), 10.0, places=9)


class RadarForwardsTheFieldsTest(unittest.TestCase):
    """The scanner computed MACD all along; the radar only forwarded d200, so
    a MACD/DMA strategy had nothing to filter on."""

    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "momentum_screen.py"), encoding="utf-8") as fh:
            self.src = fh.read()

    def test_hit_carries_macd_and_the_whole_dma_ladder(self):
        for field in ('"macd"', '"macd_bull_cross"', '"macd_bear_cross"',
                      '"d20"', '"d50"', '"d150"', '"d200"'):
            self.assertIn(field + ": t.get(", self.src.replace("\n", " ").replace("  ", " "),
                          f"{field} is not forwarded to the hit")


class RecommendationOutputTest(unittest.TestCase):
    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "recommend.py"), encoding="utf-8") as fh:
            self.src = fh.read()

    def test_output_exposes_macd_and_dma_distances(self):
        for key in ('"macd"', '"macd_prev"', '"macd_bull_cross"',
                    '"d20"', '"d50"', '"d200"'):
            self.assertIn(key + ":", self.src, f"{key} missing from the payload")

    def test_crosses_are_none_when_the_history_is_too_short(self):
        """None, not False — 'we could not tell' and 'it did not happen' are
        different answers, and the client treats them differently."""
        self.assertIn("None if macd_now is None or macd_prev is None", self.src)


if __name__ == "__main__":
    unittest.main()
