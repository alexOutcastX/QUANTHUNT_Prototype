"""The top bar's destinations, and which of them earn a tab.

Two tabs were removed and neither screen was. That distinction is the whole
risk here, so it is what these assert:

  * Home is where the wordmark goes and where a fresh sign-in lands. A tab for
    it was a second button for something the brand mark already does.
  * Symbol is a destination, not a place you browse to. Every mover row,
    watchlist row, sector member and search result opens a specific company,
    and the header search reaches any of them by name. The tab landed on
    whichever stock you last looked at, which is the redundant part. Deleting
    the SCREEN would have left every one of those rows with nowhere to go.

So both keys must still resolve, still restore across a reload, and still be
absent from the tab strip.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class RouteTableTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "Shell.tsx")
        m = re.search(r"const ROUTES: Route\[\] = \[(.*?)\n\];", self.src, re.S)
        self.assertIsNotNone(m, "ROUTES table not found")
        self.routes = m.group(1)

    def test_every_destination_still_renders(self):
        for screen in ("DashboardScreen", "ScreensHub", "StockScreen",
                       "DeskHub", "BacktestScreen", "TerminalScreen"):
            self.assertIn(screen, self.routes, f"{screen} lost its route")

    def test_home_and_symbol_are_routes_without_tabs(self):
        for line in self.routes.splitlines():
            if "k: HOME" in line or "k: 'stock'" in line:
                self.assertIn("tab: false", line, line.strip())

    def test_the_tab_strip_is_the_routes_that_kept_one(self):
        self.assertIn("const NAV = ROUTES.filter((r) => r.tab !== false);", self.src)

    def test_no_today_or_symbol_tab_remains(self):
        """Neither may carry a tab label in the strip. `Home` survives as the
        route's name, not as a tab."""
        tabs = "\n".join(l for l in self.routes.splitlines() if "tab: false" not in l)
        self.assertNotIn("'Today'", tabs)
        self.assertNotIn("'Symbol'", tabs)

    def test_screens_are_rendered_from_routes_not_from_the_tab_strip(self):
        """Rendering off NAV would blank the page on Home and on Symbol."""
        self.assertIn("const cur = ROUTES.find((t) => t.k === active) || ROUTES[0];", self.src)
        self.assertIn("const tab = ROUTES.find((t) => t.k === active) || ROUTES[0];", self.src)

    def test_a_reload_can_restore_a_tabless_destination(self):
        """Validating the restored key against NAV would bounce you to Home
        from Symbol on every reload."""
        self.assertIn("if (v && ROUTES.some((t) => t.k === v)) setActive(v);", self.src)
        self.assertNotIn("NAV.some((t) => t.k === v)", self.src)


class BrandGoesHomeTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "Shell.tsx")
        m = re.search(r"function Brand\(.*?\n\}\n", self.src, re.S)
        self.assertIsNotNone(m, "Brand not found")
        self.body = m.group(0)

    def test_the_wordmark_navigates_home(self):
        self.assertIn("onPress={() => navigate(HOME)}", self.body)

    def test_it_is_reachable_and_announced(self):
        self.assertIn('accessibilityRole="link"', self.body)
        self.assertIn("TaurEye — go to the home page", self.body)

    def test_it_is_a_real_target_not_a_bare_word(self):
        self.assertIn("hitSlop=", self.body)


class LandingTest(unittest.TestCase):
    def test_signing_in_lands_on_home(self):
        gate = _read("mobile", "src", "components", "LoginGate.tsx")
        self.assertIn("await landOnHome();", gate)
        # …and after the session is established, or the key would be written
        # and then overwritten by the restore.
        self.assertLess(gate.index("await memberLogin("), gate.index("await landOnHome();"))

    def test_the_landing_helper_writes_the_key_shell_reads(self):
        nav = _read("mobile", "src", "navIntent.ts")
        self.assertIn("export const TAB_KEY = 'taureye.nav.tab2';", nav)
        self.assertIn("export const HOME_TAB = 'today';", nav)
        self.assertIn("AsyncStorage.setItem(TAB_KEY, HOME_TAB)", nav)
        shell = _read("mobile", "src", "Shell.tsx")
        self.assertIn("TAB_KEY", shell)
        self.assertNotIn("const TAB_KEY =", shell)

    def test_a_storage_failure_cannot_break_signing_in(self):
        nav = _read("mobile", "src", "navIntent.ts")
        body = nav[nav.index("export async function landOnHome"):]
        self.assertIn("try {", body)
        self.assertIn("catch", body)


if __name__ == "__main__":
    unittest.main()
