"""The home page's shape: a market column and a rail of your own things.

News used to be a full-width card at the very top — a lot of the best space on
the screen for a list you skim, and it pushed the market data below the fold.
It reads better narrow, and the column beside it is where everything about YOU
now lives: headlines, your feeds, your portfolio, your watchlist.

What these hold:

  * The rail exists, is narrow, and stacks below its breakpoint. A 340px column
    beside anything is not a phone layout.
  * The portfolio and watchlist show ROWS, not just a total. A flat total is as
    often two big opposite moves as it is a quiet day, and the summary made you
    leave the page to find out which.
  * The movers slider leads with the whole market rather than an index, is
    customisable, and can be emptied. Removing every panel is a legitimate
    preference, not a broken page.

Geometry and clicking are checked against a real browser in e2e/smoke.js;
these guard the wiring underneath.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class RailTest(unittest.TestCase):
    def setUp(self):
        self.dash = _read("mobile", "src", "screens", "DashboardScreen.tsx")

    def test_the_page_is_two_columns_above_the_breakpoint(self):
        self.assertIn("<View style={[styles.page, wide && styles.pageWide]}>", self.dash)
        self.assertIn("pageWide: { flexDirection: 'row'", self.dash)

    def test_it_stacks_below_it(self):
        self.assertIn("page: { flexDirection: 'column' }", self.dash)
        self.assertIn("rail: { width: '100%' }", self.dash)

    def test_the_rail_does_not_stretch_to_the_main_column(self):
        """Without this the rail matches the main column's height and its last
        card floats in the middle of a very tall empty box."""
        self.assertIn("alignItems: 'flex-start'", self.dash)

    def test_the_rail_holds_what_is_yours(self):
        rail = self.dash[self.dash.index("<View style={[styles.rail"):]
        rail = rail[:rail.index("</View>\n      </View>")]
        for part in ("<NewsPanel", "MY FEEDS", "<PortfolioPanel", "<WatchlistPanel"):
            self.assertIn(part, rail, f"{part} is not in the rail")

    def test_the_market_leads_the_main_column(self):
        main = self.dash[self.dash.index("<View style={styles.mainCol}>"):]
        for a, b in (("Index tiles", "Animated market breadth"),
                     ("Animated market breadth", "Top gainers / losers")):
            self.assertLess(main.index(a), main.index(b), f"{a} should come before {b}")

    def test_the_feeds_card_no_longer_draws_a_divider_under_nothing(self):
        """It sat under the headline list and separated itself from it; in its
        own card that rule was drawing a line under nothing."""
        row = re.search(r"socialRow: \{(.*?)\n  \},", self.dash, re.S).group(1)
        self.assertNotIn("borderTopWidth", row)


class PositionsTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "components", "PositionsPanel.tsx")
        self.dash = _read("mobile", "src", "screens", "DashboardScreen.tsx")

    def test_both_panels_list_rows(self):
        self.assertIn("export function PortfolioPanel", self.src)
        self.assertIn("export function WatchlistPanel", self.src)
        self.assertIn("<Rows rows={rows}", self.src)

    def test_each_has_an_arrow_to_its_full_page(self):
        head = self.src[self.src.index("function Head("):]
        head = head[:head.index("\n}")]
        self.assertIn('name="chevronRight"', head)
        self.assertIn("navigate(to, { sub })", head)
        self.assertIn("Open the full ${title.toLowerCase()} page", head)

    def test_clicking_the_change_swaps_percent_for_rupees(self):
        self.assertIn("mode === 'pct' ? fmtPct(r.chg) : fmtAbs(r.abs)", self.src)
        self.assertIn("onPress={onToggle}", self.src)

    def test_the_choice_is_one_for_the_page_and_is_remembered(self):
        """Someone who thinks in rupees thinks in rupees in both lists."""
        self.assertIn("export function useChgMode", self.src)
        self.assertIn("AsyncStorage.setItem(MODE_KEY, next)", self.src)
        self.assertEqual(self.dash.count("mode={chgMode} onToggle={toggleChg}"), 2)

    def test_the_toggle_announces_what_it_will_do(self):
        """A bare number is not a button to a screen reader."""
        self.assertIn("Show the change in rupees", self.src)
        self.assertIn("Show the change as a percentage", self.src)

    def test_a_holding_reports_the_whole_positions_move(self):
        """One share's change is not what a portfolio is asked for."""
        self.assertIn("abs: a != null ? h.qty * a : null", self.dash)

    def test_the_rows_survive_the_aggregate(self):
        """The old loader computed a total and threw the per-holding numbers
        away, which is why you had to leave the page to see them."""
        self.assertIn("dash.pfRows = rows;", self.dash)
        self.assertIn("setPfRows(rows);", self.dash)


class SliderTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "components", "IndexSlider.tsx")

    def test_it_is_called_movers_not_index_movers(self):
        """It is no longer only about indices."""
        self.assertIn("<SectionTitle>Movers</SectionTitle>", self.src)
        self.assertNotIn("Index movers", self.src)

    def test_it_opens_on_the_market_and_the_two_it_replaced(self):
        self.assertIn("export const DEFAULT_INDICES = [MARKET, 'NIFTY 50', 'BSE SENSEX'];", self.src)
        self.assertIn("export const MARKET = '__market__';", self.src)

    def test_the_market_panel_leads(self):
        """The day's biggest moves are almost never large caps, so the panel
        that can show them should not be the one you have to swipe to."""
        table = re.search(r"DEFAULT_INDICES = \[(.*?)\];", self.src).group(1)
        self.assertTrue(table.strip().startswith("MARKET"), table)

    def test_the_market_panel_asks_a_different_endpoint(self):
        """Constituents are an index's list; the whole market is a sort over
        the bhavcopy."""
        self.assertIn("api\n          .marketMovers(4)", self.src.replace("\r", ""))
        self.assertIn("if (name === MARKET)", self.src)

    def test_it_states_the_floor_and_the_exclusions(self):
        """"Top movers" over a filtered subset is a different claim from "top
        movers"."""
        self.assertIn("names over ₹${crore(m.min_turnover)} turnover", self.src)
        self.assertIn("corporate action", self.src)

    def test_an_old_stored_default_picks_up_the_new_panel(self):
        """A list identical to the previous default was never customised — it
        is the old default sitting in storage, and freezing it would withhold
        a panel the user never had the chance to decline."""
        self.assertIn("const LEGACY_DEFAULT = ['NIFTY 50', 'BSE SENSEX'];", self.src)
        self.assertIn("untouched ? DEFAULT_INDICES : arr", self.src)

    def test_it_pages_rather_than_stacking(self):
        self.assertIn("pagingEnabled", self.src)
        self.assertIn("horizontal", self.src)

    def test_indices_can_be_added_and_removed(self):
        self.assertIn("const add = (name: string)", self.src)
        self.assertIn("const remove = (name: string)", self.src)
        self.assertIn("Add an index to this slider", self.src)

    def test_the_choice_is_remembered(self):
        self.assertIn("AsyncStorage.setItem(KEY, JSON.stringify(next))", self.src)

    def test_an_empty_slider_is_a_choice_not_a_crash(self):
        self.assertIn("!names.length ?", self.src)
        self.assertIn("No indices in the slider", self.src)

    def test_a_malformed_stored_list_is_ignored_but_an_empty_one_is_kept(self):
        self.assertIn(
            "if (!Array.isArray(arr) || !arr.every((x) => typeof x === 'string')) return;",
            self.src)

    def test_removing_the_last_panel_cannot_strand_the_page_index(self):
        self.assertIn("Math.max(0, Math.min(p, next.length - 1))", self.src)

    def test_each_index_panel_shows_that_indexs_own_level(self):
        """The market panel has no level to show — it is not an index — so it
        carries the size of the ranked set instead."""
        self.assertIn("const lv = name === MARKET ? null : level?.(name) || null;", self.src)
        self.assertIn("split?.note ? (", self.src)

    def test_the_dots_are_reachable_without_swiping(self):
        """A pager with no other control is invisible to a keyboard and to
        anyone who does not think to drag it."""
        self.assertIn("onPress={() => goto(i)}", self.src)
        self.assertIn("accessibilityLabel={`Show ${labelFor(n)}`}", self.src)


class NewsPanelTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "components", "NewsPanel.tsx")
        self.marks = _read("mobile", "src", "newsmarks.ts")

    def test_three_tabs(self):
        self.assertIn("{ k: 'latest'", self.src)
        self.assertIn("{ k: 'archive'", self.src)
        self.assertIn("{ k: 'saved'", self.src)

    def test_a_headline_can_be_saved_from_any_tab(self):
        self.assertIn("toggleNewsmark(n)", self.src)
        self.assertIn("Save ${item.title} for later", self.src)

    def test_saved_news_syncs_like_the_watchlist(self):
        session = _read("mobile", "src", "session.ts")
        self.assertIn("'taureye.newsmarks.v1': 'newsmarks_v1'", session)

    def test_a_saved_item_is_stored_whole(self):
        """The archive prunes at a month and publishers move URLs; something
        deliberately kept should outlive both."""
        self.assertIn("title: string;", self.marks)
        self.assertIn("summary?: string;", self.marks)
        self.assertIn("source?: string;", self.marks)

    def test_saved_identity_is_the_link(self):
        self.assertIn("export function newsId(link: string)", self.marks)

    def test_the_saved_list_is_bounded(self):
        self.assertIn("const MAX = 300;", self.marks)
        self.assertIn("list.slice(0, MAX)", self.marks)

    def test_searching_the_archive_is_debounced(self):
        """One request per keystroke against a table scan is not a search box."""
        self.assertIn("setTimeout(() => loadArchive(q.trim()), q ? 350 : 0)", self.src)

    def test_the_empty_archive_explains_itself(self):
        """It cannot reach backwards into stories nobody recorded, and 'no
        results' would read as a bug on the first day."""
        self.assertIn("archive is still filling", self.src)


if __name__ == "__main__":
    unittest.main()
