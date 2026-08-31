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
        top = self.screener[self.screener.index("<View style={styles.dropRow}>"):]
        top = top[:top.index("</View>\n        {/* Absolutely placed")]
        self.assertIn("PRESET SCANS", top)
        self.assertIn("UNIVERSE", top)
        self.assertIn("SCREEN", top)

    # ── the settings block ──────────────────────────────────────────────
    # The pickers, the filter rows and the button that collapses them used to
    # sit loose on the page background looking like part of the results, so
    # "Minimise" was a guess: nothing on screen said what it would take away.

    def test_the_settings_are_one_bounded_block(self):
        """A shade off the page, with a border and a radius — so the thing
        Minimise collapses has visible edges."""
        style = re.search(r"  settings: \{(.*?)\n  \},", self.screener, re.S).group(1)
        self.assertIn("backgroundColor: theme.surface", style)
        self.assertIn("borderWidth: 1", style)
        self.assertIn("borderRadius", style)
        self.assertIn("marginHorizontal", style)

    def test_the_panel_no_longer_draws_a_card_of_its_own(self):
        """It is the body of the block above it; a second card edge inside the
        first read as two panels rather than one collapsible thing."""
        style = re.search(r"  panel: \{(.*?)\n  \},", self.screener, re.S).group(1)
        self.assertNotIn("backgroundColor", style)
        self.assertNotIn("borderBottomWidth", style)

    def test_the_minimise_button_is_inside_what_it_minimises(self):
        block = self.screener[self.screener.index("<View style={[styles.settings"):]
        block = block[:block.index("<View style={styles.statsRow}>")]
        self.assertIn("onPress={toggleCfgMin}", block)
        self.assertIn("<FilterPanel", block)
        self.assertIn("styles.dropRow", block)

    def test_the_pickers_are_centred_on_the_page(self):
        row = re.search(r"  dropRow: \{(.*?)\n  \},", self.screener, re.S).group(1)
        self.assertIn("justifyContent: 'center'", row)
        bar = re.search(r"  topBar: \{(.*?)\n  \},", self.screener, re.S).group(1)
        self.assertIn("justifyContent: 'center'", bar)

    def test_the_minimise_button_cannot_pull_them_off_centre(self):
        """A button in the flow shifts the three pickers left by half its
        width, which is the off-centre look this replaced."""
        style = re.search(r"  cfgMinBtn: \{(.*?)\n  \},", self.screener, re.S).group(1)
        self.assertIn("position: 'absolute'", style)
        self.assertIn("right:", style)

    def test_collapsed_it_still_says_what_it_holds(self):
        block = self.screener[self.screener.index("{isDesktop && cfgMin ? ("):]
        block = block[:block.index("{isDesktop && !cfgMin ? (")]
        self.assertIn("exprSummary(expr)", block)
        self.assertIn("<RunBtn", block)

    # ── running a screen ────────────────────────────────────────────────

    def test_there_is_a_run_button_at_every_width(self):
        for anchor in ("styles.mobileFilterRow", "{isDesktop && cfgMin ? (", "styles.ctrlRight"):
            with self.subTest(where=anchor):
                block = self.screener[self.screener.index(anchor):][:900]
                self.assertIn("<RunBtn", block)

    def test_run_refetches_rather_than_pretending_to_apply(self):
        """The filter rows are applied live — applyExpr runs on every
        keystroke — so a button that claimed to "apply" them would be a lie in
        the shape of a control. What it re-runs is the part that is NOT live:
        the universe, its quotes and the technical sweep."""
        self.assertIn("applyExpr(rows, expr)", self.screener)
        self.assertIn("onRun={onRefresh}", self.screener)
        self.assertIn("load(indexSel, true)", self.screener)

    def test_run_bypasses_the_index_cache(self):
        """/index is cached for ten minutes, so without this an explicit Run
        inside that window re-rendered the same rows and called it a refresh —
        a control that appears to do work and does none. The load on mount
        still uses the cache, which is what the cache is for."""
        self.assertIn("api.indexConstituents(n, force)", self.screener)
        self.assertIn("async (sel: string[], force = false)", self.screener)
        run = re.search(r"const onRefresh = useCallback\((.*?)\}, \[", self.screener, re.S).group(1)
        self.assertIn("load(indexSel, true)", run)
        # …and the automatic one does not force, or every mount would miss
        # the cache that exists to make opening the console instant.
        self.assertIn("setLoading(true);\n    load(indexSel);", self.screener)

    def test_it_says_when_it_is_running_and_refuses_to_double_fire(self):
        fn = self.screener[self.screener.index("function RunBtn("):]
        fn = fn[:fn.index("\nfunction FilterPanel(")]
        self.assertIn("disabled={running}", fn)
        self.assertIn("Running…", fn)
        self.assertIn("accessibilityLabel", fn)

    def test_running_from_the_phone_sheet_closes_it(self):
        """The point of pressing Run is to look at the rows, and on a phone
        they are behind the sheet."""
        self.assertIn("onRun={() => { setFiltersOpen(false); onRefresh(); }}", self.screener)

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
    """The console opens on nothing.

    It used to open on the golden crossover, which meant the first thing it
    ever showed was somebody else's screen — three names out of five hundred,
    behind a filter you had to notice before you could look at the market. A
    suggestion belongs in the preset menu, where it is offered; as the opening
    state it is a filter nobody asked for.
    """

    def setUp(self):
        self.src = _read("mobile", "src", "screens", "ScreenerScreen.tsx")
        self.presets = _read("mobile", "src", "presets.ts")

    def test_it_opens_with_no_filters(self):
        self.assertIn("const [expr, setExpr] = useState<ExprRow[]>([]);", self.src)

    def test_nothing_still_reaches_for_a_default_preset(self):
        """A leftover import would put the old screen back the moment anyone
        wired it up again."""
        self.assertNotIn("defaultPreset", self.src)
        self.assertNotIn("DEFAULT_PRESET_ID", self.src)
        self.assertNotIn("DEFAULT_TAG", self.src)

    def test_the_module_no_longer_claims_to_have_a_default(self):
        """An exported name nothing imports is a claim the module makes about
        itself that is not true."""
        self.assertNotIn("export const DEFAULT_PRESET_ID", self.presets)
        self.assertNotIn("export function defaultPreset", self.presets)

    def test_the_golden_cross_is_still_a_preset_you_can_pick(self):
        """Removed as the default, not removed."""
        block = _preset(self.presets, "golden-cross")
        self.assertIsNotNone(block)
        self.assertIn("golden_cross: true", block)

    def test_the_empty_console_says_what_it_is_showing(self):
        """No filters is a state, not a blank — it has to read as the whole
        universe rather than as a screen that failed."""
        self.assertIn("No filters — showing the full universe.", self.src)

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


class PresetStackingTest(unittest.TestCase):
    """Presets stack, and now nothing has to guess whether they should.

    There was an exception here: an untouched opening screen stepped aside so
    that picking a preset did not silently mean "golden cross AND that". It is
    gone with the opening screen it existed for — nothing is on the console
    unless somebody put it there.
    """

    def setUp(self):
        self.src = _read("mobile", "src", "screens", "ScreenerScreen.tsx")
        m = re.search(r"const togglePresetExpr = \(p: Preset\) => \{.*?\n  \};", self.src, re.S)
        self.assertIsNotNone(m, "togglePresetExpr not found")
        self.body = m.group(0)

    def test_a_preset_adds_to_whatever_is_there(self):
        self.assertIn("return [...prev, ...filtersToExpr(p.filters, tag)];", self.body)

    def test_picking_the_same_one_twice_removes_it(self):
        self.assertIn("if (prev.some((e) => e.src === tag)) return prev.filter((e) => e.src !== tag);",
                      self.body)

    def test_the_special_case_is_gone_rather_than_left_unreachable(self):
        """Dead code that guards a state that can no longer happen is a
        question the next reader has to answer for nothing.

        Asserted against the CODE, not the comment above it — the comment
        explains what was removed and says the word."""
        code = "\n".join(l for l in self.body.splitlines()
                          if not l.strip().startswith("//"))
        self.assertNotIn("untouched", code)
        self.assertNotIn("DEFAULT_TAG", code)


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


class AnchoredMenuTest(unittest.TestCase):
    """The toolbar dropdowns, and why "transparent" was the wrong diagnosis.

    Both menus were absolutely-positioned siblings with a high z-index, and
    they still came out UNDERNEATH the results table. That reads as a
    see-through menu, because what shows through is the table painted on top —
    but their background was opaque the whole time.

    z-index only ranks siblings inside one stacking context, and a menu in the
    toolbar is not a sibling of the table's. Nothing a menu sets about itself
    wins that argument. It has to leave the page — the same conclusion the
    Sheet reached, one commit earlier, for the same reason.
    """

    def setUp(self):
        self.ui = _read("mobile", "src", "ui.tsx")
        self.screener = _read("mobile", "src", "screens", "ScreenerScreen.tsx")
        self.hosts = _read("mobile", "src", "screens", "Hosts.tsx")
        self.body = self.ui[self.ui.index("export function AnchoredMenu("):
                            self.ui.index("export function Btn(")]

    def test_it_leaves_the_page_rather_than_raising_its_z_index(self):
        self.assertIn("<Modal visible transparent", self.body)
        menu = re.search(r"const am = StyleSheet\.create\(\{(.*?)\n\}\);", self.ui, re.S).group(1)
        self.assertNotIn("zIndex", menu, "a z-index here would be treating the symptom")

    def test_the_surface_is_opaque(self):
        """It floats over live data; anything showing through it is a
        misreading waiting to happen."""
        menu = re.search(r"const am = StyleSheet\.create\(\{(.*?)\n\}\);", self.ui, re.S).group(1)
        self.assertIn("backgroundColor: theme.surface", menu)
        self.assertNotIn("rgba", menu)
        self.assertNotIn("opacity", menu)

    def test_it_is_placed_by_measuring_its_trigger(self):
        self.assertIn("export function useMenuAnchor()", self.ui)
        self.assertIn("node.measureInWindow(", self.ui)

    def test_it_cannot_open_off_screen(self):
        """A button near the right edge would otherwise open past it, and a
        long menu would run off the bottom with its last row unreachable."""
        self.assertIn("Math.max(8, Math.min(wanted, winW - w - 8))", self.body)
        self.assertIn("Math.max(160, winH - top - 12)", self.body)

    def test_a_trigger_that_cannot_be_measured_still_opens(self):
        """No measurement is a reason to place it badly, not to swallow the
        click."""
        self.assertIn("setAnchor({ x: 8, y: 56, w: 0, h: 0 })", self.ui)

    def test_clicking_away_closes_it(self):
        self.assertIn("<Pressable style={StyleSheet.absoluteFill} onPress={onClose} />", self.body)

    def test_both_toolbar_menus_use_it(self):
        self.assertIn("anchor={presetMenu.anchor}", self.screener)
        self.assertIn("<AnchoredMenu anchor={screenMenu.anchor}", self.screener)
        self.assertIn("<AnchoredMenu anchor={menu.anchor}", self.hosts)

    def test_opening_one_closes_the_other(self):
        """Two open at once was the overlap in the report."""
        self.assertIn("const openPresets = () => {\n    screenMenu.close();", self.screener)
        self.assertIn("const openScreens = () => {\n    presetMenu.close();", self.screener)


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
