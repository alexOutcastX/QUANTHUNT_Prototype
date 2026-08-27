"""The glossary, and the affordance that surfaces it.

The audit counted 195 numbers on the home screen and 421 on Backtest, none of
which said what they were or whether higher was better. One JSON file shared by
every use is the smallest thing that fixes that without changing a layout.
"""
import json
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "mobile", "src")
GLOSSARY = os.path.join(SRC, "data", "glossary.json")


class GlossaryDataTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(GLOSSARY, encoding="utf-8") as fh:
            cls.terms = json.load(fh)

    def test_it_covers_the_product(self):
        self.assertGreaterEqual(len(self.terms), 55)

    def test_every_entry_is_complete(self):
        for t in self.terms:
            with self.subTest(term=t.get("id")):
                for k in ("id", "term", "plain", "better", "detail"):
                    self.assertTrue(t.get(k), f"{t.get('id')} missing {k}")

    def test_ids_are_unique(self):
        ids = [t["id"] for t in self.terms]
        self.assertEqual(len(ids), len(set(ids)))

    def test_better_is_one_of_three_values(self):
        for t in self.terms:
            self.assertIn(t["better"], ("higher", "lower", "context"), t["id"])

    def test_the_plain_meaning_is_actually_plain(self):
        """One sentence, no jargon defined with more jargon."""
        for t in self.terms:
            with self.subTest(term=t["id"]):
                self.assertLessEqual(len(t["plain"]), 90, "not a one-liner")
                self.assertEqual(t["plain"].count("."), 1, "more than one sentence")

    def test_the_worst_offenders_are_covered(self):
        """Every metric the Backtest screen shows unlabelled."""
        ids = {t["id"] for t in self.terms}
        for needed in ("sharpe", "sortino", "calmar", "max_dd", "dd_length",
                       "volatility", "win_rate", "profit_factor", "expectancy",
                       "payoff", "exposure", "turnover"):
            self.assertIn(needed, ids)

    def test_the_home_screen_jargon_is_covered(self):
        ids = {t["id"] for t in self.terms}
        for needed in ("advance_decline", "market_breadth", "rsi", "macd", "dma"):
            self.assertIn(needed, ids)

    def test_no_entry_explains_a_term_with_itself(self):
        for t in self.terms:
            with self.subTest(term=t["id"]):
                first_word = t["term"].split()[0].lower()
                if len(first_word) > 4:      # skip short words like "P/E"
                    self.assertNotIn(first_word, t["plain"].lower(),
                                     f"{t['id']} defines itself with its own name")


class TermTipTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(SRC, "components", "TermTip.tsx"), encoding="utf-8") as fh:
            cls.src = fh.read()

    def test_an_unknown_id_still_renders_its_children(self):
        """A typo in a term id must not swallow the number it was wrapping."""
        self.assertIn("if (!term) return <>{children}</>;", self.src)

    def test_it_says_whether_higher_is_better(self):
        self.assertIn("BETTER_LABEL", self.src)
        self.assertIn("Higher is better", self.src)
        self.assertIn("Lower is better", self.src)

    def test_it_is_reachable_by_a_screen_reader(self):
        self.assertIn("accessibilityRole=\"button\"", self.src)
        self.assertIn("What does this mean?", self.src)

    def test_it_costs_no_layout(self):
        """It wraps existing content rather than replacing it."""
        self.assertIn("{children}", self.src)
        self.assertIn("borderBottomWidth: 1", self.src)


class BacktestWiringTest(unittest.TestCase):
    def test_the_backtest_metrics_are_wired_to_terms(self):
        with open(os.path.join(SRC, "screens", "BacktestScreen.tsx"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertIn("TILE_TERMS", src)
        self.assertIn("<TermTip id={term}", src)
        with open(GLOSSARY, encoding="utf-8") as fh:
            ids = {t["id"] for t in json.load(fh)}
        # Every id the screen references must exist, or the tip silently does nothing.
        block = src[src.index("TILE_TERMS"):src.index("const tile =")]
        for ref in re.findall(r"'([a-z_0-9]+)'", block):
            self.assertIn(ref, ids, f"BacktestScreen references unknown term {ref!r}")


if __name__ == "__main__":
    unittest.main()
