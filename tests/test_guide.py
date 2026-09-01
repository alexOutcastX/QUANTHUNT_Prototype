"""The in-app guide, and the two ways a manual rots.

A guide goes wrong in one of two directions: it describes something the app no
longer has, or the app grows something the guide never mentions. Both are
invisible to anyone who already knows their way around, which is everyone who
would notice. So the tests read the guide against the app's own route tables
rather than against a list written here.
"""

import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "mobile", "src")


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as fh:
        return fh.read()


class ContentTest(unittest.TestCase):
    def setUp(self):
        self.guide = read("guide.ts")

    def test_it_covers_every_top_level_destination(self):
        """Shell's ROUTES is the list of places you can be. A destination the
        guide does not name is one nobody can look up."""
        shell = read("Shell.tsx")
        routes = re.search(r"const ROUTES: Route\[\] = \[(.*?)\n\];", shell, re.S).group(1)
        labels = re.findall(r"label: '([^']+)'", routes)
        self.assertTrue(labels)
        low = self.guide.lower()
        for label in labels:
            with self.subTest(destination=label):
                self.assertIn(label.lower(), low, f"the guide never mentions {label}")

    def test_it_covers_every_desk_section(self):
        hosts = read("screens", "Hosts.tsx")
        desk = hosts.split("export function DeskHub")[1]
        rows = [l for l in desk.splitlines() if "key: '" in l and "label: '" in l]
        self.assertTrue(rows)
        low = self.guide.lower()
        for row in rows:
            if "hidden: true" in row:
                continue
            label = re.search(r"label: '([^']+)'", row).group(1)
            with self.subTest(section=label):
                self.assertIn(label.lower(), low, f"the guide never mentions Desk ▸ {label}")

    def test_it_explains_the_signal_it_prints_on_every_row(self):
        """BUY on a row is a tally, and a user who reads it as a view has been
        misled by the app rather than by the market."""
        self.assertIn("BUY / SELL / NEUTRAL", self.guide)
        self.assertIn("not advice", self.guide.lower())

    def test_it_explains_the_dma_distance_convention(self):
        """d20 is the DISTANCE from the average, not the average. Anyone who
        assumes otherwise builds a filter that means the opposite."""
        self.assertIn("DISTANCE", self.guide)
        self.assertIn("d20 > 0", self.guide)

    def test_it_states_the_credit_rule(self):
        """The rule the whole billing model rests on."""
        low = self.guide.lower()
        self.assertIn("never buy the feature", low)
        self.assertIn("no balance unlocks it", low)

    def test_it_names_the_tiers_that_actually_exist(self):
        for tier in ("Free", "Pro", "Max"):
            self.assertIn(f"term: '{tier}'", self.guide)
        self.assertNotIn("term: 'Member'", self.guide)

    def test_it_warns_where_the_data_is_thin(self):
        """ROCE and current ratio reach a small minority of rows. A guide that
        did not say so would leave people thinking their screen was broken."""
        low = self.guide.lower()
        self.assertIn("roce", low)
        self.assertIn("current ratio", low)
        self.assertIn("coverage", low)

    def test_it_does_not_recommend_anything(self):
        """A guide that drifts into advice is a compliance problem, not a
        writing one."""
        for phrase in ("you should buy", "we recommend", "a good buy",
                       "guaranteed", "will go up", "sure thing"):
            self.assertNotIn(phrase, self.guide.lower())

    def test_the_closing_note_points_at_the_disclaimer(self):
        self.assertIn("GUIDE_NOTE", self.guide)
        self.assertIn("DISCLAIMER", self.guide)

    def test_every_chapter_has_a_blurb_and_sections(self):
        ids = re.findall(r"\n    id: '([a-z]+)'", self.guide)
        self.assertGreaterEqual(len(ids), 8, "a detailed guide, not a leaflet")
        self.assertEqual(len(ids), len(set(ids)), "duplicate chapter ids")
        # `blurb: '` — the type declaration also says `blurb: string;`, and
        # counting that made this assert one chapter too many.
        self.assertEqual(self.guide.count("blurb: '"), len(ids))

    def test_it_is_substantial(self):
        """The ask was 'in detail'. This is a floor, not a target — it exists so
        the guide cannot be quietly gutted to a stub."""
        prose = re.findall(r"text: '((?:[^'\\]|\\.)*)'", self.guide)
        words = sum(len(t.split()) for t in prose)
        self.assertGreater(words, 2500, f"the guide is only {words} words")


class SheetTest(unittest.TestCase):
    def setUp(self):
        self.sheet = read("components", "GuideSheet.tsx")
        self.shell = read("Shell.tsx")

    def test_it_draws_over_the_page_and_gives_it_back(self):
        """The same decision the disclaimer got: something you open with a
        question is a sheet, not a destination you have to escape."""
        self.assertIn("<Sheet onClose={onClose}", self.sheet)
        self.assertIn("Close the guide", self.sheet)

    def test_a_chapter_can_be_left_without_closing_the_whole_thing(self):
        self.assertIn("Back to the guide contents", self.sheet)

    def test_it_can_be_searched(self):
        """Nobody reads a manual in order; they arrive with a word."""
        self.assertIn("Search the guide", self.sheet)
        self.assertIn("hay.includes(query)", self.sheet)

    def test_the_search_looks_inside_chapters_not_just_at_titles(self):
        """Searching "RSI" has to find the momentum section, which no chapter
        is titled."""
        self.assertIn("function haystack(", self.sheet)
        self.assertIn("parts.push(b.text)", self.sheet)

    def test_the_button_is_in_the_chrome_at_both_widths(self):
        self.assertIn("function GuideLink(", self.shell)
        self.assertEqual(self.shell.count("<GuideLink"), 2,
                         "the guide must be reachable on desktop AND on a phone")

    def test_it_is_not_gated(self):
        """Someone who cannot yet use the screener is exactly who needs to read
        what it does."""
        link = self.shell[self.shell.index("function GuideLink("):]
        link = link[:link.index("function LegalLink(")]
        self.assertNotIn("<Gate", link)
        self.assertNotIn("hasFeature", link)

    def test_the_footer_strip_lays_two_items_out_as_a_centred_row(self):
        """It holds two now. Left as a column they would stack; left without
        justification one would take the leftover width, which is not the
        middle of anything."""
        style = re.search(r"  footerBar: \{(.*?)\n  \},", self.shell, re.S).group(1)
        self.assertIn("flexDirection: 'row'", style)
        self.assertIn("justifyContent: 'center'", style)


if __name__ == "__main__":
    unittest.main()
