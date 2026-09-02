"""The moving-average pair gaps behind Ideas ▸ DMA crossovers.

The screener already answers "did these averages cross?" — that fires on the
day it happens, which is the day it is in every scanner in the country. This
feature answers the question before it: which pairs are still apart and
closing. That needs two things the scan did not previously carry:

  * a 100-day average, so 50/100 is expressible at all; and
  * each pair's gap NOW and a week ago, because a small gap on its own cannot
    tell a pair converging from a pair that crossed last week and is
    separating. Those are opposite situations with the same distance.

The pure helper is tested here. The client half — thresholds, direction,
sessions-to-contact — is `mobile/src/dmaCross.ts`, swept by e2e/dma.js.
"""
import os
import re
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


try:
    import scanner
except Exception:                                       # pragma: no cover
    scanner = None

try:
    import pandas                     # noqa: F401 — the stdlib CI gate has none
    HAVE_PANDAS = True
except Exception:                                       # pragma: no cover
    HAVE_PANDAS = False


@unittest.skipIf(scanner is None, "scanner did not import")
class GapTest(unittest.TestCase):
    def test_the_sign_says_which_way_a_cross_would_go(self):
        """Negative means the fast average is below the slow one, so a cross
        from here is upward. The whole direction reading rests on this."""
        self.assertLess(scanner.ma_gap(95, 100), 0)
        self.assertGreater(scanner.ma_gap(105, 100), 0)

    def test_the_gap_is_a_percentage_of_the_slow_average(self):
        self.assertEqual(scanner.ma_gap(101, 100), 1.0)
        self.assertEqual(scanner.ma_gap(99, 100), -1.0)
        self.assertEqual(scanner.ma_gap(200, 100), 100.0)

    def test_equal_averages_are_zero_not_missing(self):
        """Sitting exactly on the line is the most interesting row on the page;
        it must not be indistinguishable from having no data."""
        self.assertEqual(scanner.ma_gap(100, 100), 0.0)

    def test_it_returns_nothing_rather_than_inventing_a_number(self):
        for fast, slow in ((None, 100), (100, None), (None, None), (100, 0),
                           ("x", 100), (100, "x"), (float("nan"), 100),
                           (100, float("nan"))):
            self.assertIsNone(scanner.ma_gap(fast, slow), (fast, slow))

    def test_the_pairs_are_the_ones_asked_for(self):
        self.assertEqual(scanner.MA_PAIRS, ((9, 20), (20, 50), (50, 100), (50, 200)))

    def test_every_pair_is_fast_then_slow(self):
        """Reversing one would silently invert its direction reading."""
        for fast, slow in scanner.MA_PAIRS:
            self.assertLess(fast, slow, (fast, slow))

    def test_the_lookback_is_a_week_of_sessions(self):
        self.assertEqual(scanner.MA_GAP_LOOKBACK, 5)


@unittest.skipIf(scanner is None or not HAVE_PANDAS, "needs pandas")
class RowTest(unittest.TestCase):
    """The gaps computed over real series, rather than from two hand-picked
    numbers — this is where an off-by-one window or a reversed pair shows up."""

    def test_a_rising_series_puts_the_fast_average_above_the_slow_one(self):
        """Computed straight from the helper rather than through the network
        path: a steadily rising series must show every fast average above its
        slow one, which is the arrangement after a golden cross."""
        closes = [100 + i * 0.5 for i in range(260)]
        import pandas as pd
        s = pd.Series(closes)
        for fast, slow in scanner.MA_PAIRS:
            g = scanner.ma_gap(scanner._sma(s, fast).iloc[-1],
                               scanner._sma(s, slow).iloc[-1])
            self.assertIsNotNone(g, (fast, slow))
            self.assertGreater(g, 0, f"{fast}/{slow} on a rising series")

    def test_a_falling_series_inverts_every_pair(self):
        closes = [300 - i * 0.5 for i in range(260)]
        import pandas as pd
        s = pd.Series(closes)
        for fast, slow in scanner.MA_PAIRS:
            g = scanner.ma_gap(scanner._sma(s, fast).iloc[-1],
                               scanner._sma(s, slow).iloc[-1])
            self.assertLess(g, 0, f"{fast}/{slow} on a falling series")

    def test_a_short_series_has_no_hundred_day_average(self):
        """Newly listed companies must drop out of 50/100 rather than appear
        with a fabricated gap."""
        import pandas as pd
        s = pd.Series([100 + i for i in range(60)])
        self.assertIsNone(scanner.ma_gap(scanner._sma(s, 50).iloc[-1],
                                         scanner._sma(s, 100).iloc[-1]))


class WiringTest(unittest.TestCase):
    """Source-level checks, so they run on the stdlib-only CI path too."""

    def setUp(self):
        self.scanner = read("scanner.py")

    def test_the_scan_emits_the_hundred_day_distance(self):
        """50/100 cannot be expressed without it, and it was the one average in
        the set the scan did not compute."""
        self.assertIn('"d100": dist(sma100)', self.scanner)

    def test_the_scan_emits_the_pair_gaps(self):
        self.assertIn('"ma_gaps": ma_gaps', self.scanner)

    def test_each_pair_carries_its_own_history(self):
        """[now, then] — one number could not distinguish closing from
        separating, which is the whole point of the feature."""
        self.assertIn("ma_gaps[f\"{_f}_{_sl}\"] = [now, then]", self.scanner)

    def test_a_pair_with_no_current_gap_is_omitted_entirely(self):
        """Better an absent key than a key holding None, which a client would
        have to defend against on every read."""
        self.assertIn("if now is not None:", self.scanner)


class TabTest(unittest.TestCase):
    def setUp(self):
        self.rec = read("mobile", "src", "screens", "RecommendationsScreen.tsx")
        self.screen = read("mobile", "src", "screens", "DmaCrossScreen.tsx")
        self.logic = read("mobile", "src", "dmaCross.ts")
        self.info = read("mobile", "src", "tabInfo.ts")

    def test_the_tab_sits_beside_the_others(self):
        self.assertIn("{ key: 'dma', label: 'DMA crossovers' }", self.rec)
        self.assertIn("<DmaCrossScreen />", self.rec)

    def test_it_is_the_last_tab_after_the_smc_one(self):
        """The ask was 'beside ICT/hft', and the tabs read left to right in
        increasing specialism."""
        self.assertLess(self.rec.index("key: 'smc'"), self.rec.index("key: 'dma'"))

    def test_the_mode_survives_a_reload(self):
        self.assertIn("'dma'", self.rec.split("REC_MODES")[1][:80])

    def test_the_tab_has_its_own_explainer(self):
        self.assertIn("DMA_CROSS_INFO", self.info)
        self.assertIn("DMA_CROSS_INFO", self.rec)

    def test_all_four_pairs_are_offered(self):
        for pair in ("9_20", "20_50", "50_100", "50_200"):
            self.assertIn(f"'{pair}'", self.logic, pair)

    def test_a_widening_pair_is_dropped(self):
        """The one rule that separates this from a "close together" list."""
        code = "\n".join(l for l in self.logic.splitlines()
                         if not l.strip().startswith(("//", "*", "/*")))
        self.assertIn("Math.abs(was) < distance", code)

    def test_the_list_is_nearest_first_and_stable(self):
        self.assertIn("(a.distance - b.distance) || a.symbol.localeCompare(b.symbol)",
                      self.logic)

    def test_it_reads_the_prebuilt_snapshot(self):
        """Its sibling tabs scan symbol by symbol and take a minute. Everything
        this one needs is already in the twice-daily payload."""
        self.assertIn("api.screenerSnapshot", self.screen)

    def test_it_says_when_the_snapshot_has_no_gaps_yet(self):
        """The first deploy serves a snapshot built before this existed. That
        must read as 'not yet', not as 'nothing is converging'."""
        self.assertIn("No moving-average gaps in this snapshot", self.screen)

    def test_the_page_does_not_call_a_pending_cross_a_signal(self):
        self.assertIn("not a signal", self.screen)
        low = self.screen.lower()
        for phrase in ("you should buy", "we recommend", "guaranteed", "will cross"):
            self.assertNotIn(phrase, low)

    def test_the_guide_describes_the_tab(self):
        guide = read("mobile", "src", "guide.ts")
        self.assertIn("DMA crossovers", guide)


if __name__ == "__main__":
    unittest.main()
