"""The screening console: one toolbar, and presets that build something you
can read.

The complaint that drove this was "custom preset scans don't work — selecting
Minervini should build a screen out of its elements, not just set minervini =
true". It was exactly right, and the fix is the interesting part.

`minervini` is a single boolean the server computes from nine rules. Selecting
the preset put ONE row on the screen saying "Minervini Trend Template is true":
nothing to read, nothing to loosen, nothing to learn. The whole point of a
custom screener is that a preset is a starting position.

Decomposing it needed one thing that did not exist — a filter for the 50 > 150
> 200 moving-average stack. It turns out to be derivable from fields already on
every row: d50/d150/d200 are each (price / that DMA − 1) × 100, so a SMALLER
percentage means a HIGHER average, and sma50 > sma150 is exactly d50 < d150.

The decomposition therefore has to be EQUIVALENT, not merely similar — a
screen that quietly returns a superset while calling itself Minervini is worse
than the opaque flag. tests/fixtures/scan_minervini.json is a real scan of 118
NIFTY 500 names taken from the live server; the equivalence is asserted against
it symbol by symbol.
"""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def _preset(src, pid):
    """The `filters: { … }` block of one preset, as text."""
    m = re.search(r"\{ id: '" + pid + r"'.*?filters: \{(.*?)\n?\s*\} \},", src, re.S)
    return m.group(1) if m else None


class MinerviniDecompositionTest(unittest.TestCase):
    """The rules, and the proof they add up to the same screen."""

    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, "tests", "fixtures", "scan_minervini.json"),
                  encoding="utf-8") as fh:
            cls.scan = json.load(fh)
        cls.presets = _read("mobile", "src", "presets.ts")
        cls.screener = _read("mobile", "src", "screener.ts")

    # ── the rules the client now applies, mirroring the preset exactly ──
    @staticmethod
    def decomposed(s):
        """None when a rule cannot be evaluated — the same thing the screener
        does when a row has no value for a filtered field."""
        d50, d150, d200 = s.get("d50"), s.get("d150"), s.get("d200")
        pl, ph, r6 = s.get("pct_from_low"), s.get("pct_from_high"), s.get("ret_6m")
        if None in (d50, d150, d200, pl, ph, r6):
            return None
        return (d50 >= 0 and d150 >= 0 and d200 >= 0
                and d50 < d150 < d200                  # the 50>150>200 stack
                and s.get("dma200_rising") is True
                and pl >= 30 and ph >= -25 and r6 >= 0)

    def test_the_fixture_is_worth_testing_against(self):
        """A sample where nothing passes would prove nothing."""
        self.assertGreaterEqual(len(self.scan), 100)
        passing = [k for k, v in self.scan.items() if v["minervini"]]
        self.assertGreaterEqual(len(passing), 5, "need real positives to compare")

    def test_it_agrees_with_the_server_on_every_evaluable_symbol(self):
        agree = dis = 0
        wrong = []
        for sym, s in self.scan.items():
            got = self.decomposed(s)
            if got is None:
                continue
            if got == bool(s["minervini"]):
                agree += 1
            else:
                dis += 1
                wrong.append((sym, s["minervini"], got))
        self.assertGreater(agree, 50, "too few comparable rows to conclude anything")
        self.assertEqual(dis, 0, f"decomposition disagrees with the server: {wrong[:5]}")

    def test_a_symbol_it_cannot_evaluate_never_passes_server_side_either(self):
        """Rows missing a moving average are dropped by the decomposition. That
        is only safe because the server fails them too — otherwise the preset
        would silently lose names that genuinely qualify."""
        for sym, s in self.scan.items():
            if self.decomposed(s) is None:
                self.assertFalse(s["minervini"], f"{sym} passes server-side but cannot be evaluated")

    def test_the_stack_rule_is_derived_the_right_way_round(self):
        """d50 < d150 means sma50 > sma150. Getting the inequality backwards
        would still typecheck and would still return rows."""
        stack = re.search(r"key: 'dma_stack'.*?\n  \},", self.screener, re.S).group(0)
        self.assertIn("a < b && b < c", stack)
        self.assertIn("d50", stack)
        self.assertIn("d150", stack)
        self.assertIn("d200", stack)

    def test_the_preset_no_longer_sets_the_opaque_flag(self):
        block = _preset(self.presets, "minervini")
        self.assertIsNotNone(block)
        self.assertNotIn("minervini: true", block)

    def test_it_carries_every_rule_as_its_own_row(self):
        block = _preset(self.presets, "minervini")
        for key in ("d50", "d150", "d200", "dma_stack", "dma200_rising",
                    "pct_from_low", "pct_from_high", "ret_6m"):
            self.assertIn(key + ":", block, f"{key} is not in the decomposition")

    def test_the_thresholds_are_minervinis_own(self):
        block = _preset(self.presets, "minervini")
        self.assertIn("pct_from_low: { min: 30 }", block)     # ≥30% off the low
        self.assertIn("pct_from_high: { min: -25 }", block)   # within 25% of the high


class ToolbarTest(unittest.TestCase):
    """One row: which screener, over what, looking for what."""

    def setUp(self):
        self.screener = _read("mobile", "src", "screens", "ScreenerScreen.tsx")
        self.hosts = _read("mobile", "src", "screens", "Hosts.tsx")

    def test_presets_moved_out_of_the_filter_panel(self):
        """It was a button buried inside the filter builder; it belongs beside
        the universe, because they are the two halves of one question."""
        self.assertIn("function PresetMenu(", self.screener)
        top = self.screener[self.screener.index("<View style={styles.topBar}>"):]
        top = top[:top.index("</View>\n\n      {isDesktop")]
        self.assertIn("PRESET SCANS", top)
        self.assertIn("UNIVERSE", top)
        self.assertIn("SCREEN", top)

    def test_the_screener_bars_are_gone(self):
        """Two stacked pill rows above the page said what one dropdown says."""
        self.assertIn("return <ScreenerHub />;", self.hosts)
        self.assertNotIn("SCREENER_TABS", self.hosts)

    def test_every_screener_is_in_the_dropdown(self):
        for key in ("'custom'", "'mb'", "'momentum'", "'penny'", "'reco'", "'patterns'"):
            self.assertIn(f"key: {key}", self.hosts)

    def test_the_heatmap_kept_its_route_but_lost_its_tab(self):
        """It is on the home page now; every existing intent must still land."""
        line = [l for l in self.hosts.splitlines() if "key: 'heatmap'" in l]
        self.assertTrue(line)
        self.assertIn("hidden: true", line[0])
        self.assertIn("heatmap: 'heatmap'", self.hosts)

    def test_screens_that_have_no_toolbar_still_get_the_picker(self):
        """Otherwise picking Momentum is a one-way trip."""
        self.assertIn("function ScreenPicker(", self.hosts)
        self.assertIn("<ScreenPicker choices={SCREEN_CHOICES}", self.hosts)


class DefaultScreenTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "screens", "ScreenerScreen.tsx")

    def test_it_opens_on_the_golden_crossover(self):
        self.assertIn("export const DEFAULT_PRESET_ID = 'golden-cross';",
                      _read("mobile", "src", "presets.ts"))
        self.assertIn("filtersToExpr(defaultPreset().filters, 'preset:' + DEFAULT_PRESET_ID)",
                      self.src)

    def test_the_default_is_the_50_200_cross(self):
        block = _preset(_read("mobile", "src", "presets.ts"), "golden-cross")
        self.assertIn("golden_cross: true", block)

    def test_last_sessions_filters_are_no_longer_restored(self):
        """"Every load" means every load — a screener that reopens mid-thought
        is one you have to clear before you can think. Deliberately kept
        screens have their own home under Save screen."""
        self.assertNotIn("setExpr(parsed.filter((e) =>", self.src)
        self.assertIn("Filters are NOT restored", self.src)

    def test_a_shared_link_still_wins(self):
        """A link someone sent you is a stronger intent than any default."""
        self.assertIn("setExpr(shared.expr?.length ? shared.expr : filtersToExpr(shared.active));",
                      self.src)


class DefaultPresetInteractionTest(unittest.TestCase):
    """What happens when the opening screen meets a chosen one.

    Presets stack by design — that is what makes them composable. But the
    console now opens on the golden crossover on every load, and that screen is
    a SUGGESTION, not a choice anybody made. Stacking on top of it gives
    "golden cross AND Minervini", which almost always returns nothing and reads
    as a broken preset rather than as two screens combined.
    """

    def setUp(self):
        self.src = _read("mobile", "src", "screens", "ScreenerScreen.tsx")
        m = re.search(r"const togglePresetExpr = \(p: Preset\) => \{.*?\n  \};", self.src, re.S)
        self.assertIsNotNone(m, "togglePresetExpr not found")
        self.body = m.group(0)

    def test_an_untouched_default_steps_aside(self):
        self.assertIn("const untouched = prev.length > 0 && prev.every((e) => e.src === DEFAULT_TAG);",
                      self.body)
        self.assertIn("const base = untouched && tag !== DEFAULT_TAG ? [] : prev;", self.body)

    def test_a_screen_you_have_built_still_stacks(self):
        """`every` is the whole safeguard: edit, add or remove one row and this
        is no longer the default but a screen in progress."""
        self.assertIn("prev.every((e) => e.src === DEFAULT_TAG)", self.body)
        self.assertIn("[...base, ...filtersToExpr(p.filters, tag)]", self.body)

    def test_toggling_the_default_itself_off_still_works(self):
        """`tag !== DEFAULT_TAG` — otherwise re-picking the golden cross would
        clear itself and immediately re-add it, which is a no-op that looks
        like a broken toggle."""
        self.assertIn("tag !== DEFAULT_TAG", self.body)
        self.assertIn("if (prev.some((e) => e.src === tag)) return prev.filter((e) => e.src !== tag);",
                      self.body)


class StillScanningTest(unittest.TestCase):
    """An empty table during the sweep is not an empty result.

    /scan streams in behind the page, so a screen evaluated in the first second
    is filtering rows that carry no technicals — every one fails. The table said
    "No matches. Loosen or clear a filter", blaming the screen for something
    that was merely unfinished, and with the console now opening on a filtered
    screen that was the first thing you saw on every load.
    """

    def setUp(self):
        self.src = _read("mobile", "src", "screens", "ScreenerScreen.tsx")

    def test_it_counts_what_the_sweep_has_not_reached(self):
        self.assertIn("const techWaiting = useMemo(", self.src)
        self.assertIn("Math.max(0, rows.length - techCount)", self.src)

    def test_it_only_applies_when_a_filter_actually_needs_the_scan(self):
        """A screen filtered on price alone can match immediately; saying
        "still scanning" there would be an excuse, not an explanation."""
        self.assertIn("const SCAN_FREE = new Set(['price', 'chg', 'volume']);", self.src)
        self.assertIn("!SCAN_FREE.has(e.key) && !DEF_BY_KEY[e.key]?.fund", self.src)

    def test_the_empty_state_says_so_and_shows_progress(self):
        self.assertIn("'Still scanning…'", self.src)
        self.assertIn("${techCount} of ${rows.length} symbols have their technicals so far",
                      self.src)

    def test_a_genuinely_empty_result_still_says_no_matches(self):
        """Once the sweep has landed, an empty table IS the screen's answer."""
        self.assertIn("'No matches'", self.src)
        self.assertIn("Loosen or clear a filter", self.src)


class SheetStackingTest(unittest.TestCase):
    """The universe picker's missing close button.

    It was never missing: it was underneath the header bar. z-index only
    compares inside a stacking context, and the header took one of its own when
    the sign-out confirmation was added — so it began painting over the top of
    every full-height sheet in the app, which is exactly where sheet titles and
    close buttons live.
    """

    def test_sheets_are_portalled_out_of_the_page(self):
        ui = _read("mobile", "src", "ui.tsx")
        body = ui[ui.index("export function Sheet("):ui.index("const sh = StyleSheet.create(")]
        self.assertIn("<Modal visible transparent", body)
        self.assertIn("</Modal>", body)

    def test_the_reason_is_written_down(self):
        ui = _read("mobile", "src", "ui.tsx")
        self.assertIn("z-index is only comparable INSIDE a", ui)


if __name__ == "__main__":
    unittest.main()
