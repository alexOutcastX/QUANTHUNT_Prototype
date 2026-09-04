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
class SigmaTest(unittest.TestCase):
    """How far the gap travels in a session — the input that turns a straight
    line drawn to zero into a probability."""

    def sigma(self, fast, slow):
        import pandas as pd
        return scanner.ma_gap_sigma(pd.Series(fast, dtype="float64"),
                                    pd.Series(slow, dtype="float64"))

    def test_the_gap_volatility_measures_the_change_not_the_level(self):
        """A gap that walks steadily from 5% to 1% has a huge spread of LEVELS
        and almost no session-to-session movement. Measuring the level would
        call the steadiest pair on the page the most volatile one."""
        flat = [100 + (5 - i * 0.2) for i in range(30)]       # dead straight
        sig = self.sigma(flat, [100.0] * 30)
        self.assertIsNotNone(sig)
        self.assertLess(sig, 0.01)

    def test_a_jumpy_gap_measures_wider_than_a_smooth_one(self):
        smooth = self.sigma([100 + i * 0.1 for i in range(30)], [100.0] * 30)
        jumpy = self.sigma([100 + (i % 2) * 2.0 for i in range(30)], [100.0] * 30)
        self.assertIsNotNone(smooth)
        self.assertIsNotNone(jumpy)
        self.assertGreater(jumpy, smooth)

    def test_too_little_history_gives_no_volatility_rather_than_zero(self):
        """Zero would mean 'this gap never moves', which the model reads as a
        certainty either way. Absent means 'no opinion'."""
        self.assertIsNone(self.sigma([100, 101], [100, 100]))
        self.assertIsNone(self.sigma([], []))

    def test_a_zero_average_is_dropped_rather_than_divided_by(self):
        self.assertIsNone(self.sigma([100.0] * 30, [0.0] * 30))

    def test_the_window_is_about_a_month_of_sessions(self):
        self.assertEqual(scanner.MA_GAP_VOL_WINDOW, 21)


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
        """[now, then, sigma] — one number could not distinguish closing from
        separating, which is the whole point of the feature, and two could not
        say how likely the closing is to finish."""
        self.assertIn("ma_gaps[f\"{_f}_{_sl}\"] = [now, then,", self.scanner)
        self.assertIn("ma_gap_sigma(_series[_f], _series[_sl])", self.scanner)

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
        self.assertIn("if (a.distance !== b.distance) return a.distance - b.distance;",
                      self.logic)
        self.assertIn("return a.symbol.localeCompare(b.symbol)", self.logic)

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

    def test_the_probability_is_a_closed_form_not_a_simulation(self):
        """First passage for arithmetic Brownian motion. A simulation in a
        render path would be slow, and worse, would give a different answer
        every time the list redrew."""
        self.assertIn("export function crossProbability(", self.logic)
        self.assertIn("normCdf", self.logic)
        self.assertNotIn("Math.random", self.logic)

    def test_a_pair_already_touching_is_certain_rather_than_a_division_by_zero(self):
        self.assertIn("if (d === 0) return 1;", self.logic)

    def test_the_three_sorts_are_offered(self):
        for key in ("'near'", "'probability'", "'time'"):
            self.assertIn(key, self.logic, key)
        self.assertIn("SORTS", self.screen)

    def test_an_unknown_ranks_last_rather_than_lowest(self):
        """An unmeasured probability is not a zero and an unmeasured ETA is not
        an immediate one. Sorting them as such would float the least-known rows
        to the top of a list read top-down."""
        self.assertIn("a.probability == null ? -1", self.logic)
        self.assertIn("a.eta == null ? Infinity", self.logic)

    def test_the_horizon_is_selectable_and_the_chance_follows_it(self):
        self.assertIn("HORIZONS", self.screen)
        self.assertIn("setHorizon", self.screen)
        self.assertIn("horizon, sort", self.screen)

    def test_a_row_opens_the_detail_card(self):
        card = read("mobile", "src", "components", "CrossoverCard.tsx")
        self.assertIn("CrossoverCard", self.screen)
        self.assertIn("onOpen(a)", self.screen)
        # It gets the whole snapshot row, not just the six fields an Approach
        # carries — the average levels and the technicals live there.
        self.assertIn("row={bySym.get(open.symbol) || null}", self.screen)
        self.assertIn("export default function CrossoverCard", card)

    def test_the_card_carries_the_same_actions_as_its_siblings(self):
        card = read("mobile", "src", "components", "CrossoverCard.tsx")
        for action in ("Chart", "Pattern", "Report", "Paper trade", "Watchlist", "Alert"):
            self.assertIn(action, card, action)

    def test_the_card_proposes_no_trade(self):
        """Its siblings open on an entry, a stop and a target because those
        setups have a view. This one does not have one, and must not imply it
        does by printing levels it did not choose."""
        card = read("mobile", "src", "components", "CrossoverCard.tsx")
        self.assertIn("stop: 0", card)
        self.assertIn("target: 0", card)
        low = card.lower()
        for phrase in ("you should buy", "we recommend", "guaranteed", "will cross"):
            self.assertNotIn(phrase, low)

    def test_the_two_levels_reconcile_with_the_gap_above_them(self):
        """The averages are derived from two independent distances, and the gap
        is a third number. Printing all three unreconciled lets a reader do the
        division and find the card disagreeing with itself in the last digit —
        so the fast one is always recomputed from the slow one and the gap."""
        card = read("mobile", "src", "components", "CrossoverCard.tsx")
        self.assertIn("const ratio = 1 + a.gap / 100;", card)
        self.assertIn("fastMa = slowMa * ratio;", card)
        self.assertIn("slowMa = fastMa / ratio;", card)

    def test_the_card_says_what_the_model_is_not(self):
        """The number looks like a forecast and is not one. Anywhere it is
        shown, the assumption it rests on is shown with it."""
        card = read("mobile", "src", "components", "CrossoverCard.tsx")
        self.assertIn("is not a random walk", card)
        self.assertIn("not as a forecast", card)
        self.assertIn("is not a random walk", self.logic + self.info)

    def test_the_explainer_covers_the_chance_and_the_sorts(self):
        self.assertIn("closed form", self.info)
        for word in ("Nearest", "Probability", "Soonest"):
            self.assertIn(word, self.info, word)

    def test_the_scan_can_be_refreshed_on_demand(self):
        """The pull gesture is invisible, and in a desktop browser it does not
        exist at all."""
        self.assertIn("Refresh the crossover scan", self.screen)
        self.assertIn("onPress={onRefresh}", self.screen)

    def test_a_refresh_goes_past_the_cache(self):
        """The snapshot is cached for ten minutes, so a refresh that returns the
        copy the app already had looks broken at exactly the moment someone is
        asking whether the numbers moved."""
        api = read("mobile", "src", "api.ts")
        self.assertIn("screenerSnapshot: (index: string, force = false)", api)
        self.assertIn("TTL.slow, force, 30000", api)
        self.assertIn("await load(true);", self.screen)

    def test_the_refresh_button_cannot_be_pressed_twice(self):
        self.assertIn("disabled={refreshing}", self.screen)
        self.assertIn("busy: refreshing", self.screen)

    def test_the_guide_describes_the_tab(self):
        guide = read("mobile", "src", "guide.ts")
        self.assertIn("DMA crossovers", guide)


if __name__ == "__main__":
    unittest.main()
