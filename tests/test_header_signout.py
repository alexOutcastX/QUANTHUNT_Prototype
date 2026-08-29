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

    def test_it_is_in_the_mobile_footer_next_to_the_disclaimer(self):
        shell = self.src[self.src.index("function NewMobileShell"):]
        shell = shell[:shell.index("export default function Shell")]
        self.assertIn("<LegalLink style={styles.legalBtnMobile} />", shell)
        self.assertIn("<SignOutBtn up style={styles.signOutFooter} />", shell)

    def test_it_opens_upward_on_the_phone(self):
        """The mobile strip sits directly above the tab bar — a menu dropped
        below it would render off the bottom of the screen."""
        self.assertIn("up ? styles.signOutPopUp : styles.signOutPopDown", self.body)
        self.assertIn("signOutPopUp: { bottom: '100%'", self.src)

    def test_one_press_asks_rather_than_signing_out(self):
        arm = self.body.index("onPress={() => setArmed((v) => !v)}")
        self.assertGreater(arm, 0)
        # memberLogout is reachable only from the confirm button inside the
        # popover, which only exists while armed.
        self.assertEqual(self.body.count("memberLogout()"), 1)
        self.assertGreater(self.body.index("memberLogout()"), self.body.index("armed ? ("))

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
        pressed would push the last nav tab out of the scroller."""
        pop = re.search(r"signOutPop: \{(.*?)\n  \},", self.src, re.S).group(1)
        self.assertIn("position: 'absolute'", pop)

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
        self.assertLessEqual(pad, 12, "measured at 1360px with Back and sign-out both in the bar")

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
        self.assertIn("width >= 1360 ?", self.src)
        self.assertNotIn("width >= 1280 ?", self.src)


if __name__ == "__main__":
    unittest.main()
