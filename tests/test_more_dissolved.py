"""The Desk's "More" menu, dissolved into the pages that use its contents.

A menu of secondary tools is where features go to be forgotten: seven entries,
each a page nobody opened twice, reached by tapping "More" and reading a list.
Every one of them either belonged to a page that already existed or did not
belong in the product at all, so the menu has nothing left to hold and is gone.

Where each went, and why:

  * Indices    → the app home. The strip at the top of every page carries a
                 dozen levels; the full board with day and year changes is the
                 thing you land on, not a menu item.
  * Charts     → TradingView stops being a page BESIDE the chart page (with its
                 own symbol box, so "the chart" was two destinations that could
                 show two different companies) and becomes a view of the chart
                 you are already looking at.
  * Holidays   → already on the Desk home, which links to the full calendar.
  * Corporate  → split by what it answers: one company's filings into the Desk
                 home's corporate card, the session's bulk and block deals —
                 a market-wide fact — onto the app home.
  * Community  → already on the Desk home, which links into the rooms.
  * Derivatives, Developer → removed.

And the signed-in name moves into the top bar, where the account controls are,
rather than being visible only inside the account page itself.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def _screen(name):
    return _read("mobile", "src", "screens", name)


def code_only(src):
    """Source with comments dropped — an assertion that a name is GONE must not
    be defeated by prose explaining why it went.

    Block comments first: a JSX `{/* … */}` spans lines whose continuations
    start with an ordinary word, so a line filter alone keeps most of them.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return "\n".join(l for l in src.splitlines() if not l.strip().startswith("//"))


class MoreMenuGoneTest(unittest.TestCase):
    def setUp(self):
        self.hosts = _screen("Hosts.tsx")

    def test_the_menu_and_its_host_are_gone(self):
        for gone in ("MORE_ITEMS", "MORE_MENU", "MORE_GROUPS", "MORE_DUP_KEYS",
                     "MoreScreen", "ChartsHome"):
            self.assertNotIn(gone, self.hosts, gone)

    def test_nothing_still_routes_to_it(self):
        base = os.path.join(ROOT, "mobile", "src")
        for root, _d, files in os.walk(base):
            for f in files:
                if not f.endswith((".ts", ".tsx")):
                    continue
                src = _read(os.path.join(root, f))
                self.assertNotIn("sub: 'more'", src, f)

    def test_the_screens_it_dropped_are_not_referenced_anywhere(self):
        """Derivatives and Developer are removed, not merely unlinked from one
        menu — a screen reachable from nowhere is dead weight in the bundle."""
        base = os.path.join(ROOT, "mobile", "src")
        for name in ("DerivativesScreen", "DeveloperScreen"):
            for root, _d, files in os.walk(base):
                for f in files:
                    if not f.endswith((".ts", ".tsx")) or f == name + ".tsx":
                        continue
                    self.assertNotIn(name, _read(os.path.join(root, f)),
                                     f"{name} still referenced from {f}")

    def test_it_left_no_orphan_styles_behind(self):
        head, styles = self.hosts.split("const styles = StyleSheet.create({", 1)
        orphans = [m.group(1) for m in re.finditer(r"^  ([A-Za-z0-9_]+):", styles, re.M)
                   if not re.search(r"styles\.%s\b" % m.group(1), head)]
        self.assertEqual(orphans, [], orphans)


class MovedHomesTest(unittest.TestCase):
    def test_index_levels_are_on_the_app_home(self):
        dash = _screen("DashboardScreen.tsx")
        self.assertIn("import IndicesScreen from './IndicesScreen';", dash)
        self.assertIn("<SectionTitle>Index levels</SectionTitle>", dash)
        self.assertIn("<IndicesScreen embedded />", dash)

    def test_and_render_without_a_second_scroller(self):
        """A ScrollView inside a ScrollView traps the wheel over the table."""
        idx = _screen("IndicesScreen.tsx")
        self.assertIn("if (embedded) return <View>{body}</View>;", idx)
        self.assertIn("embedded?: boolean", idx)

    def test_bulk_and_block_deals_are_on_the_app_home(self):
        dash = _screen("DashboardScreen.tsx")
        self.assertIn("import { MarketDeals } from './CorporateScreen';", dash)
        self.assertIn("<MarketDeals limit={12} />", dash)
        self.assertIn("Bulk &amp; block deals", dash)

    def test_one_companys_filings_are_on_the_desk_home(self):
        home = _screen("DeskHome.tsx")
        self.assertIn("import { CompanyCorporate } from './CorporateScreen';", home)
        self.assertIn("<CompanyCorporate />", home)
        self.assertIn("{ key: 'company', label: 'A company' }", home)
        self.assertIn("{ key: 'market', label: 'The market' }", home)

    def test_the_corporate_screen_is_now_two_parts_and_no_page(self):
        corp = _screen("CorporateScreen.tsx")
        self.assertIn("export function CompanyCorporate()", corp)
        self.assertIn("export function MarketDeals(", corp)
        self.assertNotIn("export default", corp)
        # neither half carries page chrome any more
        self.assertNotIn("<ScreenTitle", corp)
        self.assertNotIn("<ScrollView", corp)

    def test_tradingview_is_a_view_of_the_chart_you_opened(self):
        """The Charts page was the ONLY route to ChartScreen, so removing the
        menu entry orphaned it. The chart people actually open is the symbol
        sheet — which already had a TradingView button that navigated OUT of
        the app to tradingview.com, with no way back to the row you had open.
        That button now switches the chart in place."""
        det = _read("mobile", "src", "components", "StockDetail.tsx")
        self.assertIn("import TradingViewScreen from '../screens/TradingViewScreen';", det)
        self.assertIn("const [tv, setTv] = useState(false);", det)
        self.assertIn("<TradingViewScreen symbol={tvSymbol(row.sym)} />", det)
        self.assertIn("{tv ? 'TaurEye chart' : 'TradingView'}", det)

    def test_the_chart_no_longer_sends_you_off_the_site(self):
        det = code_only(_read("mobile", "src", "components", "StockDetail.tsx"))
        self.assertNotIn("tradingview.com", det)
        self.assertNotIn("Linking", det)

    def test_the_orphaned_chart_page_is_gone_rather_than_unreachable(self):
        self.assertFalse(os.path.exists(
            os.path.join(ROOT, "mobile", "src", "screens", "ChartScreen.tsx")))
        base = os.path.join(ROOT, "mobile", "src")
        for root, _d, files in os.walk(base):
            for f in files:
                if f.endswith((".ts", ".tsx")):
                    self.assertNotIn("ChartScreen", code_only(_read(os.path.join(root, f))), f)

    def test_it_shows_the_symbol_the_chart_is_on(self):
        """Two symbol boxes for one chart is two charts that can disagree."""
        tv = _screen("TradingViewScreen.tsx")
        self.assertIn("symbol: fixed }: { symbol?: string }", tv)
        self.assertIn("const symbol = fixed ? normSymbol(fixed) : own;", tv)
        self.assertIn("{fixed ? null : (", tv)

    def test_holidays_and_community_were_already_on_the_desk_home(self):
        home = _screen("DeskHome.tsx")
        self.assertIn("navigate('desk', { sub: 'holidays' })", home)
        self.assertIn("navigate('desk', { sub: 'community' })", home)


class AccountChipTest(unittest.TestCase):
    def setUp(self):
        self.shell = _read("mobile", "src", "Shell.tsx")

    def test_the_bar_says_who_is_signed_in(self):
        self.assertIn("function AccountChip(", self.shell)
        self.assertIn("{member.username}", self.shell)

    def test_it_sits_beside_the_disclaimer(self):
        desktop = self.shell.split("<AccountChip />")[1][:120]
        self.assertIn("<LegalLink />", desktop)

    def test_it_opens_the_account_page(self):
        chip = self.shell.split("function AccountChip(")[1].split("\n}")[0]
        self.assertIn("navigate('desk', { sub: 'wallet' })", chip)
        self.assertIn('accessibilityRole="link"', chip)

    def test_it_says_nothing_when_nobody_is_signed_in(self):
        chip = self.shell.split("function AccountChip(")[1].split("\n}")[0]
        self.assertIn("if (!member) return null;", chip)

    def test_it_follows_a_sign_in_without_a_reload(self):
        chip = self.shell.split("function AccountChip(")[1].split("\n}")[0]
        self.assertIn("subscribeMember(", chip)

    def test_it_is_on_the_phone_header_too(self):
        self.assertIn("<AccountChip style={styles.acctBtnMobile} />", self.shell)


if __name__ == "__main__":
    unittest.main()
