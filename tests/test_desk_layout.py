"""The Desk: a landing page, and three destinations that stopped being tabs.

The Desk opened onto the Watchlist — one of its twelve destinations, and an
overview of none of them — so the first thing it showed was a bar of tabs
asking you to choose before anything had been said. It now opens on a page:
what is coming for the companies you hold (the corporate calendar), which days
the market is shut, how the numbers are arrived at, and who is talking.

The rest is a tab bar getting shorter by putting each screen where it is
actually used rather than beside the others alphabetically:

  * Calibration grades the paper trades. On its own tab nobody checked it
    against the tracker it grades, so it is a mode of the Paper trades page.
  * Risk measures a basket. On its own tab it opened on a hardcoded demo
    basket; inside Portfolio it opens on the holdings in view.
  * Account and Wallet asked the same question — who am I, and what does that
    entitle me to — and answered half each.

And two renames: the Dossier is a Report everywhere it is offered, and dev
notices are "Announcements from the Dev", below everything else on the page.
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


class DeskLandingTest(unittest.TestCase):
    def setUp(self):
        self.hosts = _screen("Hosts.tsx")
        self.home = _screen("DeskHome.tsx")

    def test_the_desk_opens_on_its_home_page(self):
        keys = re.findall(r"\{ key: '([a-z]+)',", self.hosts.split("export function DeskHub")[1])
        self.assertEqual(keys[0], "home")
        self.assertIn("render: () => <DeskHome />", self.hosts)

    def test_the_page_carries_every_section_asked_for(self):
        for needle in (
            "<SectionTitle>Corporate calendar</SectionTitle>",
            "<SectionTitle>Market days</SectionTitle>",
            'title="Methodology"',
            "<SectionTitle>Community</SectionTitle>",
        ):
            self.assertIn(needle, self.home, needle)

    def test_methodology_expands_in_place_rather_than_linking_away(self):
        # Sending someone to another page to read the method is how it goes
        # unread; it folds open where it is.
        self.assertIn("<Fold", self.home)
        self.assertIn("open={false}", self.home)
        self.assertIn("METHOD_SECTIONS.map", self.home)

    def test_it_folds_the_same_text_the_methodology_page_publishes(self):
        self.assertIn("SECTIONS as METHOD_SECTIONS } from './MethodologyScreen'", self.home)
        self.assertIn("export const SECTIONS", _screen("MethodologyScreen.tsx"))

    def test_announcements_sit_below_every_other_section(self):
        i = self.home.index("Announcements from the Dev")
        for earlier in ("Corporate calendar", "Market days", 'title="Methodology"', "Community"):
            self.assertLess(self.home.index(earlier), i, earlier)

    def test_announcements_are_renamed_and_embedded(self):
        self.assertIn("<SectionTitle>Announcements from the Dev</SectionTitle>", self.home)
        self.assertIn("<AnnouncementsScreen embedded />", self.home)
        # Embedded, it must not print its own heading under that one.
        ann = _screen("AnnouncementsScreen.tsx")
        self.assertIn("{embedded ? null : <SectionTitle>Announcements</SectionTitle>}", ann)
        self.assertIn("embedded?: boolean", ann)

    def test_embedded_announcements_do_not_nest_a_second_scroller(self):
        """A ScrollView inside a ScrollView traps the wheel over that card."""
        ann = _screen("AnnouncementsScreen.tsx")
        embedded = ann.split("if (embedded) {")[1].split("return (")[1].split("}")[0]
        self.assertNotIn("ScrollView", embedded)

    def test_the_page_is_two_columns_above_the_breakpoint_and_stacks_below(self):
        self.assertIn("<View style={[s.page, wide && s.pageWide]}>", self.home)
        self.assertIn("pageWide: { flexDirection: 'row'", self.home)
        self.assertIn("page: { flexDirection: 'column' }", self.home)
        self.assertIn("rail: { width: '100%' }", self.home)

    def test_its_links_land_on_the_screen_they_name(self):
        """"Full calendar ›" going to a menu that lists the calendar is a
        second click for no information."""
        self.assertIn("navigate('desk', { sub: 'holidays' })", self.home)
        self.assertIn("navigate('desk', { sub: 'community' })", self.home)
        for key in ("holidays", "community"):
            self.assertRegex(self.hosts, r"\{ key: '%s'[^\n]*hidden: true \}" % key)

    def test_the_calendar_only_offers_a_filter_for_what_is_in_the_window(self):
        self.assertIn("const have = new Set((items || []).map((i) => i.kind));", self.home)
        self.assertIn("KINDS.filter((k) => k === 'All' || have.has(k))", self.home)

    def test_the_calendar_kinds_are_the_ones_the_server_classifies(self):
        import importlib
        import corporate
        c = importlib.reload(corporate)
        listed = re.search(r"const KINDS = \[([^\]]+)\]", self.home).group(1)
        for kind in re.findall(r"'([A-Za-z]+)'", listed):
            if kind == "All":
                continue
            self.assertIn(kind, c.KINDS, kind)

    def test_the_calendar_does_not_render_an_unsorted_wall(self):
        self.assertIn("f.slice(0, 8)", self.home)
        self.assertIn("Show all {total}", self.home)


class SideNavTest(unittest.TestCase):
    """The Desk's ten sections are a hamburger and a drawer, not a pill row.

    A row of pills spends a whole band of the page on the nine sections you are
    not on, and at that width there was no room for the one-line description of
    what each one is for — the description existed, and only the phone ever saw
    it. The drawer costs one button and has room for all of it.
    """

    def setUp(self):
        self.hosts = _screen("Hosts.tsx")

    def test_the_desk_asks_for_the_drawer(self):
        desk = self.hosts.split("export function DeskHub")[1]
        self.assertIn('variant="side"', desk)
        self.assertIn('menuTitle="DESK"', desk)

    def test_the_drawer_is_a_variant_of_the_shared_sub_nav(self):
        self.assertIn("variant?: 'pills' | 'side'", self.hosts)
        self.assertIn("if (variant === 'side') {", self.hosts)

    def test_it_sits_against_the_left_edge_of_the_page(self):
        drawer = self.hosts.split("  drawer: {")[1].split("},")[0]
        for needle in ("position: 'absolute'", "top: 0", "bottom: 0", "left: 0", "width: 320"):
            self.assertIn(needle, drawer, needle)

    def test_it_belongs_to_the_page_and_not_to_the_window(self):
        """Portalled through a Modal it started at the top of the WINDOW and
        lay over the wordmark, the search box and the destination tabs — the
        chrome you use to leave the Desk. Absolute inside the sub-nav host, it
        starts under the app bar, so it covers only what it switches."""
        side = self.hosts.split("if (variant === 'side') {")[1].split("return (\n    <View style={styles.host}>")[0]
        self.assertNotIn("<Modal", side)
        self.assertIn("{menuOpen ? (", side)
        self.assertIn("<Pressable\n              style={styles.drawerScrim}", side)

    def test_the_scrim_covers_the_page_and_only_the_page(self):
        scrim = self.hosts.split("  drawerScrim: {")[1].split("},")[0]
        self.assertIn("position: 'absolute'", scrim)
        self.assertIn("top: 0, left: 0, right: 0, bottom: 0", scrim)

    def test_the_drawer_can_be_dismissed_three_ways(self):
        side = self.hosts.split("if (variant === 'side') {")[1]
        self.assertIn("onPress={close}", side)                 # the scrim
        self.assertIn('accessibilityLabel="Close the sections menu"', side)

    def test_escape_still_closes_it_without_a_modal(self):
        """Modal supplied onRequestClose; a plain View supplies nothing."""
        self.assertIn("if (e.key === 'Escape') setMenuOpen(false);", self.hosts)
        self.assertIn("g.removeEventListener?.('keydown', onKey);", self.hosts)

    def test_the_button_says_where_you_are_and_what_it_is_for(self):
        side = self.hosts.split("if (variant === 'side') {")[1].split("</Modal>")[0]
        self.assertIn("styles.hamIcon", side)
        self.assertIn("{cur.label}", side)
        self.assertIn("{cur.hint}", side)

    def test_it_hugs_the_left_rather_than_stretching_the_page(self):
        btn = self.hosts.split("  sideBtn: {")[1].split("},")[0]
        self.assertIn("alignSelf: 'flex-start'", btn)

    def test_every_section_carries_its_description_into_the_drawer(self):
        desk = self.hosts.split("export function DeskHub")[1].split("ChartsHome")[0]
        rows = [l for l in desk.splitlines() if "{ key: '" in l and "hidden: true" not in l]
        self.assertTrue(rows)
        for r in rows:
            self.assertIn("hint:", r, r.strip()[:80])

    def test_the_drawer_and_the_phone_menu_render_the_same_list(self):
        """Two copies of the list is two places for a section to go missing."""
        self.assertIn("const menuRows = shown.map((t) => (", self.hosts)
        self.assertEqual(self.hosts.count("<ScrollView bounces={false}>{menuRows}</ScrollView>"), 2)


class DeskLandsHomeTest(unittest.TestCase):
    def setUp(self):
        self.hosts = _screen("Hosts.tsx")

    def test_pressing_desk_always_opens_the_desk_home(self):
        """It used to restore whichever of ten sections you were last on, so
        "Desk" meant a different page every time you pressed it."""
        desk = self.hosts.split("export function DeskHub")[1].split("ChartsHome")[0]
        self.assertNotIn('persistKey="', desk)

    def test_with_no_persistKey_the_first_tab_is_the_landing(self):
        self.assertIn("return has(p?.sub) ? (resolve(p!.sub) as string) : tabs[0].key;", self.hosts)
        keys = re.findall(r"\{ key: '([a-z]+)',",
                          self.hosts.split("export function DeskHub")[1])
        self.assertEqual(keys[0], "home")

    def test_a_deep_link_still_beats_the_landing(self):
        """navigate('desk', { sub: 'inst' }) must still open Reports."""
        self.assertIn("const p = peekNav();", self.hosts)
        self.assertIn("if (has(p?.sub)) setActive(resolve(p!.sub) as string);", self.hosts)

    def test_the_other_hubs_keep_remembering_where_you_were(self):
        """Only the Desk resets: it is the one with a landing page to reset to."""
        self.assertIn('persistKey="charts"', self.hosts)


class FoldedScreensTest(unittest.TestCase):
    def test_calibration_is_a_mode_of_the_paper_trade_page(self):
        paper = _screen("PaperTradeScreen.tsx")
        self.assertIn("| 'calibration'", paper)
        self.assertIn("{ key: 'calibration', label: 'Calibration' }", paper)
        self.assertIn("<CalibrationScreen embedded />", paper)

    def test_calibration_drops_its_heading_when_embedded(self):
        cal = _screen("CalibrationScreen.tsx")
        self.assertIn("embedded?: boolean", cal)
        self.assertIn("{embedded ? null : <Text style={s.h1}>Calibration</Text>}", cal)

    def test_risk_is_a_tab_of_the_portfolio_page(self):
        pf = _screen("PortfolioScreen.tsx")
        self.assertIn("{ key: 'risk', label: 'Risk' }", pf)
        self.assertIn("<RiskScreen embedded seed={riskSeed} />", pf)

    def test_risk_measures_the_holdings_in_view_not_a_demo_basket(self):
        pf = _screen("PortfolioScreen.tsx")
        self.assertIn("shown.map((h) => ({ symbol: h.symbol, qty: String(h.qty) }))", pf)
        risk = _screen("RiskScreen.tsx")
        self.assertIn("seed?: Row[]", risk)
        self.assertIn("useState<Row[]>(seed?.length ? seed : SEED)", risk)

    def test_account_and_wallet_are_one_destination(self):
        merged = _screen("AccountWalletScreen.tsx")
        self.assertIn("<AccountScreen />", merged)
        self.assertIn("<WalletScreen embedded />", merged)
        hosts = _screen("Hosts.tsx")
        self.assertIn("render: () => <AccountWalletScreen />", hosts)

    def test_the_wallet_half_is_not_offered_where_it_does_not_work(self):
        """Its endpoints only exist on the preview host; a dead segment is
        worse than no segment."""
        merged = _screen("AccountWalletScreen.tsx")
        self.assertIn("const preview = usePreview();", merged)
        self.assertIn("const wallet = preview && tab === 'wallet';", merged)
        self.assertIn("{preview ? (", merged)

    def test_the_account_page_still_reaches_people_without_a_wallet(self):
        """The Wallet tab used to be hidden off-preview. Merging Account into
        a hidden tab would have deleted Account from those hosts."""
        hosts = _screen("Hosts.tsx")
        desk = hosts.split("export function DeskHub")[1]
        row = [l for l in desk.splitlines() if "key: 'wallet'" in l][0]
        self.assertNotIn("hidden:", row)

    def test_none_of_the_three_is_still_a_top_level_desk_tab(self):
        desk = _screen("Hosts.tsx").split("export function DeskHub")[1].split("ChartsHome")[0]
        for key in ("calibration", "risk", "account"):
            self.assertNotIn("{ key: '%s'," % key, desk, key)

    def test_but_every_old_link_to_them_still_lands(self):
        hosts = _screen("Hosts.tsx")
        self.assertIn(
            "alias={{ calibration: 'paper', risk: 'portfolio', account: 'wallet' }}", hosts)


class DeskChromeTest(unittest.TestCase):
    def test_the_feature_menu_no_longer_ends_in_a_sign_out(self):
        """It moved to the header, beside the disclaimer. A destructive action
        at the foot of a nineteen-item menu is not where anyone looks."""
        hosts = _screen("Hosts.tsx")
        self.assertNotIn("Sign out", hosts)
        self.assertNotIn("memberLogout", hosts)
        self.assertIn("SignOutBtn", _read("mobile", "src", "Shell.tsx"))

    def test_the_dossier_is_called_a_report_wherever_it_is_offered(self):
        hosts = _screen("Hosts.tsx")
        self.assertIn("label: 'Reports'", hosts)
        base = os.path.join(ROOT, "mobile", "src")
        offenders = []
        for root, _dirs, files in os.walk(base):
            for f in files:
                if not f.endswith((".tsx", ".ts")):
                    continue
                path = os.path.join(root, f)
                with open(path, encoding="utf-8") as fh:
                    src = fh.read()
                for m in re.finditer(r">\s*(?:▤ )?Dossier\s*<|label=\"Dossier\"|label: 'Dossier'", src):
                    offenders.append(f + ": " + m.group(0))
        self.assertEqual(offenders, [], offenders)

    def test_the_desk_home_owns_methodology_and_announcements(self):
        """One home per screen: More listed both, and now the landing page
        shows both, so More stops listing them."""
        hosts = _screen("Hosts.tsx")
        dup = hosts.split("MORE_DUP_KEYS = new Set([")[1].split("])")[0]
        self.assertIn("'methodology'", dup)
        self.assertIn("'announcements'", dup)


if __name__ == "__main__":
    unittest.main()
