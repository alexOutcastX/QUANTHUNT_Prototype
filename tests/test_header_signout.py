"""The sign-out control in the app chrome.

Signing out used to live only as a row inside More → Account, five items deep
in a menu nobody opens looking for the way out. This puts it in the chrome
beside the disclaimer, at both widths.

Two things can regress here and neither needs a browser to catch:

  * the control quietly losing its confirmation step, turning a 32px target a
    few pixels from the theme toggle into a one-click logout on a site with no
    self-service password reset; and
  * the desktop header, whose width budget is fully spent, going back to
    padding that no longer leaves room for every nav tab.

The layout itself is measured against a real browser in e2e/smoke.js.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHELL = os.path.join(ROOT, "mobile", "src", "Shell.tsx")
ICONS = os.path.join(ROOT, "mobile", "src", "icons.tsx")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class SignOutControlTest(unittest.TestCase):
    def setUp(self):
        self.src = _read(SHELL)
        m = re.search(r"function SignOutBtn\(.*?\n\}\n", self.src, re.S)
        self.assertIsNotNone(m, "SignOutBtn not found in Shell.tsx")
        self.body = m.group(0)

    def test_it_is_in_the_desktop_bar_next_to_the_disclaimer(self):
        bar = self.src[self.src.index("function NewDesktopShell"):]
        bar = bar[:bar.index("function NewMobileShell")]
        self.assertIn("<LegalLink />", bar)
        self.assertIn("<SignOutBtn />", bar)
        self.assertLess(bar.index("<LegalLink />"), bar.index("<SignOutBtn />"))

    def test_it_is_in_the_phone_header_beside_the_account_name(self):
        """It used to sit in a strip above the tab bar at 10px, half off the
        edge — the two account controls, in the one place nobody looks for
        account controls. The strip now holds the disclaimer alone, which is
        what lets "centred" mean centred."""
        shell = self.src[self.src.index("function NewMobileShell"):]
        shell = shell[:shell.index("export default function Shell")]
        head = shell[shell.index("styles.headerRight"):shell.index("headerRow2")]
        self.assertIn("<AccountChip style={styles.acctBtnMobile} />", head)
        self.assertIn("<SignOutBtn />", head)
        strip = shell[shell.index("styles.footerBar"):]
        self.assertIn("<LegalLink style={styles.legalBtnMobile} />", strip)
        self.assertNotIn("SignOutBtn", strip)

    def test_the_confirmation_is_portalled_rather_than_clipped(self):
        """A React Native View clips its children. In a two-row phone header
        the confirmation was cut off at the header's bottom edge, losing the
        "signed in as" line and half the question."""
        self.assertIn("const anchor = useMenuAnchor();", self.body)
        self.assertIn("<AnchoredMenu anchor={anchor.anchor} width={214} align=\"right\"", self.body)
        self.assertNotIn("signOutPopUp", self.src)
        self.assertNotIn("signOutPopDown", self.src)

    def test_one_press_asks_rather_than_signing_out(self):
        self.assertIn("if (armed) close();", self.body)
        # memberLogout is reachable only from the confirm button inside the
        # popover, which only exists while armed.
        self.assertEqual(self.body.count("memberLogout()"), 1)
        self.assertGreater(self.body.index("memberLogout()"), self.body.index("armed && anchor.anchor ? ("))

    def test_arming_expires_on_its_own(self):
        """A mis-click must not leave a red 'sign out?' hanging over the page
        for the rest of the session."""
        self.assertRegex(self.body, r"setTimeout\(\(\) => setArmed\(false\), \d+\)")
        self.assertIn("clearTimeout(t)", self.body)

    def test_there_is_a_way_out_of_the_confirmation(self):
        self.assertIn("Stay", self.body)
        self.assertIn("accessibilityLabel=\"Stay signed in\"", self.body)

    def test_it_hides_itself_when_nobody_is_signed_in(self):
        self.assertIn("if (!member) return null;", self.body)

    def test_it_redraws_when_the_session_changes(self):
        """Without the subscription the button would keep showing a stale
        member name — or keep showing at all — after a sign-out elsewhere."""
        self.assertIn("subscribeMember(", self.body)

    def test_it_names_who_is_signed_in_to_a_screen_reader(self):
        self.assertIn('accessibilityRole="button"', self.body)
        self.assertIn("Sign out of TaurEye. Signed in as ${member.username}", self.body)

    def test_the_confirmation_cannot_widen_the_bar(self):
        """The desktop header is fully subscribed; a control that grew when
        pressed would push the last nav tab out of the scroller. AnchoredMenu
        renders it outside the bar entirely."""
        ui = _read(os.path.join(ROOT, "mobile", "src", "ui.tsx"))
        # AnchoredMenu's own panel — `am`, not the Sheet's.
        am = ui.split("const am = StyleSheet.create({", 1)[1]
        panel = re.search(r"panel: \{(.*?)\n  \},", am, re.S).group(1)
        self.assertIn("position: 'absolute'", panel)

    def test_the_confirmation_paints_above_the_page(self):
        """It hangs off the bottom of the bar, over the ticker strip and the
        screen below — both of which come later in the tree."""
        bar = re.search(r"brandBar: \{(.*?)\n  \},", self.src, re.S).group(1)
        self.assertIn("zIndex", bar)
        self.assertIn("signOutWrap: { zIndex:", self.src)

    def test_the_mark_exists(self):
        icons = _read(ICONS)
        self.assertIn("'signOut'", icons)
        self.assertRegex(icons, r"\n  signOut: \{ d: '")


class HeaderWidthBudgetTest(unittest.TestCase):
    """The nav is a horizontal ScrollView, which is why this needs a test.

    An over-subscribed bar does not overflow visibly — the scroller absorbs it
    and the last tab is simply not on screen. Nothing looks broken, so nothing
    gets noticed. The measured budget at 1280px only closes with tab padding
    at 12; putting 16 back clipped the nav by 20px.
    """

    def setUp(self):
        self.src = _read(SHELL)

    def test_nav_tab_padding_stays_within_the_measured_budget(self):
        item = re.search(r"pageItem: \{(.*?)\n  \},", self.src, re.S).group(1)
        pad = int(re.search(r"paddingHorizontal: (\d+)", item).group(1))
        # 16 fits again now that Home and Symbol have given up their tabs; it
        # was 12 when six tabs had to share the bar with the sign-out button.
        self.assertLessEqual(pad, 16, "measured at 1180px with Back and sign-out both in the bar")

    def test_the_search_box_is_the_elastic_one_not_the_nav(self):
        """Both used to shrink, so an over-subscribed bar took width from the
        nav — silently, because it scrolls — while the search box beside it
        still had ~110px it could have given up."""
        nav = re.search(r"navScroll: \{(.*?)\},", self.src, re.S).group(1)
        self.assertIn("flexShrink: 0", nav)
        search = re.search(r"searchBtn: \{(.*?)\n  \},", self.src, re.S).group(1)
        self.assertIn("flexShrink: 1", search)

    def test_tab_labels_appear_only_where_they_were_measured_to_fit(self):
        """1280 was measured without the Back affordance, so the labels showed
        at a width where the nav clipped as soon as you had navigated
        anywhere."""
        self.assertIn("width >= 1180 ?", self.src)
        self.assertNotIn("width >= 1280 ?", self.src)


if __name__ == "__main__":
    unittest.main()

class BackButtonBudgetTest(unittest.TestCase):
    """The back chevron is part of the phone header's width budget.

    It is 28px plus a gap on the left of the identity row, and the row was
    sized as though it were not there: at 390px with Back showing, the
    sign-out button sat 7px off the right edge. Measured by the smoke suite
    ("both sit fully on screen"), not guessed.
    """

    def setUp(self):
        import os
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "mobile", "src", "Shell.tsx"), encoding="utf-8") as fh:
            self.src = fh.read()

    def test_the_chevron_is_subtracted_before_the_market_chip_decides(self):
        self.assertIn("width - (showBack ? BACK_W : 0) >= 360", self.src)

    def test_its_cost_is_named_once(self):
        self.assertIn("const BACK_W = 28 + 8;", self.src)
