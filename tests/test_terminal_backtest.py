"""Backtest stopped being a destination of its own.

It answers the second half of the question the Terminal asks — the graph says
what a company is connected to, the backtest says whether a rule would have
worked on it — and both sit on the same plan. Two top-level buttons for that
was one more than the nav bar had room for.

These tests hold the merge together: the button is gone, every key that used
to open the backtest still lands on it, and the switch does not cost the
workspace a band of height.
"""

import os
import re
import unittest

SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "mobile", "src")


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as fh:
        return fh.read()


def code_only(src: str) -> str:
    """The source with comments stripped, so an assertion cannot be satisfied
    by prose that merely mentions the thing."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return "\n".join(l for l in src.splitlines() if not l.strip().startswith("//"))


class NavButtonTest(unittest.TestCase):
    def setUp(self):
        self.shell = read("Shell.tsx")

    def test_the_backtest_button_is_gone_from_the_nav(self):
        routes = re.search(r"const ROUTES: Route\[\] = \[(.*?)\n\];", self.shell, re.S)
        self.assertIsNotNone(routes)
        self.assertNotIn("Backtest", routes.group(1))
        self.assertNotIn("'backtest'", routes.group(1))

    def test_the_terminal_route_renders_the_hub(self):
        self.assertIn("render: () => <TerminalHub />", self.shell)

    def test_the_shell_no_longer_imports_the_backtest_screen(self):
        """It arrives inside the terminal's chunk now. A second import here
        would split it across two bundles."""
        self.assertNotIn("BacktestScreen", code_only(self.shell))

    def test_backtest_is_no_longer_a_desk_section_either(self):
        hosts = code_only(read("screens", "Hosts.tsx"))
        desk = hosts.split("export function DeskHub")[1]
        self.assertNotIn("key: 'bt'", desk)
        self.assertNotIn("BacktestScreen", hosts)


class IntentTest(unittest.TestCase):
    """Every saved tab, quick-link and palette row that says "backtest"."""

    def setUp(self):
        self.shell = read("Shell.tsx")
        self.hub = read("screens", "TerminalHub.tsx")

    def test_the_old_page_key_maps_to_the_terminal(self):
        self.assertIn("const bt = 'terminal';", self.shell)

    def test_every_branch_that_used_to_reach_it_still_does(self):
        for line in ("case 'backtest':", "return sub === 'bt' ? bt : 'desk';",
                     "if (sub === 'bt') return bt;"):
            self.assertIn(line, self.shell)

    def test_the_hub_opens_on_the_backtest_when_the_intent_says_so(self):
        self.assertIn("const BT_SUBS = new Set(['bt', 'backtest']);", self.hub)
        self.assertIn("if (BT_SUBS.has(sub)) return 'bt';", self.hub)

    def test_a_bare_backtest_page_key_counts_too(self):
        """A quick-link that still says navigate('backtest') carries no sub;
        landing on the graph would read as a broken link."""
        self.assertIn("if (page && BT_SUBS.has(page)) return 'bt';", self.hub)

    def test_it_reacts_to_intents_that_arrive_while_it_is_mounted(self):
        self.assertIn("subscribeNav(", self.hub)

    def test_the_command_palette_points_at_the_terminal(self):
        pal = read("components", "CommandPalette.tsx")
        row = [l for l in pal.splitlines() if "label: 'Backtest'" in l][0]
        self.assertIn("page: 'terminal'", row)
        self.assertIn("sub: 'bt'", row)

    def test_the_deleted_route_is_named_nowhere_as_a_target(self):
        """A navigate('backtest') is fine — mapTarget rewrites it. A ROUTES
        key of 'backtest' is not, because nothing would render."""
        self.assertNotIn("k: 'backtest'", self.shell)


class LayoutTest(unittest.TestCase):
    def setUp(self):
        self.hub = read("screens", "TerminalHub.tsx")
        self.term = read("screens", "TerminalScreen.tsx")

    def test_the_switch_rides_in_the_terminals_own_header(self):
        """A band of its own would push a full-bleed workspace down the page
        to say something the header already had room for."""
        self.assertIn("switcher?: React.ReactNode", self.term)
        head = self.term.split("<View style={styles.head}>")[1].split("</View>")[0]
        self.assertIn("{switcher}", head)
        self.assertIn("<TerminalScreen switcher={sw} />", self.hub)

    def test_the_backtest_header_matches_the_terminals_to_the_pixel(self):
        """The switch must not jump when you use it."""
        term_head = re.search(r"  head: \{(.*?)\n  \},", self.term, re.S).group(1)
        hub_head = re.search(r"  btHead: \{(.*?)\n  \},", self.hub, re.S).group(1)
        for rule in ("paddingHorizontal: 14", "paddingTop: 12"):
            self.assertIn(rule, term_head)
            self.assertIn(rule, hub_head)

    def test_each_half_keeps_its_own_gate(self):
        """Gating the hub as a whole would let one plan decide both."""
        self.assertNotIn("<Gate", self.hub)
        self.assertIn('feature="terminal"', self.term)
        self.assertIn('feature="backtest"', read("screens", "BacktestScreen.tsx"))

    def test_the_graph_is_what_you_land_on(self):
        self.assertIn("|| 'graph'", self.hub)


if __name__ == "__main__":
    unittest.main()
