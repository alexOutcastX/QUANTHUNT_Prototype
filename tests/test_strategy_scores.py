"""Unit tests for the per-strategy scorecard builder (pure stdlib)."""
import unittest

import strategy_scores as ss


class BuildScoresTest(unittest.TestCase):
    def _by_id(self, rows):
        return {r["id"]: r for r in rows}

    def test_minervini_from_rules(self):
        rows = self._by_id(ss.build_scores({}, None, {"minervini_rules": 9, "minervini": True}))
        self.assertEqual(rows["minervini"]["score"], 100)
        self.assertTrue(rows["minervini"]["pass"])
        rows2 = self._by_id(ss.build_scores({}, None, {"minervini_rules": 4}))
        self.assertEqual(rows2["minervini"]["score"], 44)
        self.assertFalse(rows2["minervini"]["pass"])

    def test_fundamental_pillars_map(self):
        pillars = {"growth": 90, "cashflow": 80, "leverage": 60, "valuation": 40}
        rows = self._by_id(ss.build_scores(pillars, 84, None))
        self.assertEqual(rows["growth"]["score"], 90)
        self.assertTrue(rows["growth"]["pass"])
        self.assertEqual(rows["cashflow"]["score"], 80)
        self.assertEqual(rows["leverage"]["score"], 60)
        self.assertFalse(rows["leverage"]["pass"])
        self.assertEqual(rows["value"]["score"], 40)
        self.assertEqual(rows["multibagger"]["score"], 84)

    def test_candlestick_bias(self):
        self.assertEqual(self._by_id(ss.build_scores({}, None, {"cs_bullish": True}))["candles"]["score"], 78)
        self.assertEqual(self._by_id(ss.build_scores({}, None, {"cs_bearish": True}))["candles"]["score"], 25)

    def test_breakout_near_high(self):
        rows = self._by_id(ss.build_scores({}, None, {"pct_from_high": -2, "new_high_52w": True, "cs_bullish": True}))
        self.assertGreaterEqual(rows["breakout"]["score"], 90)
        far = self._by_id(ss.build_scores({}, None, {"pct_from_high": -30}))
        self.assertEqual(far["breakout"]["score"], 0)

    def test_missing_data_is_none_not_crash(self):
        rows = ss.build_scores({}, None, None)
        # every strategy present, all scores None (or computed), never raising
        self.assertTrue(all("id" in r and "name" in r for r in rows))
        by = self._by_id(rows)
        self.assertIsNone(by["minervini"]["score"])
        self.assertIsNone(by["growth"]["score"])

    def test_always_returns_full_set(self):
        rows = ss.build_scores({}, 50, {"minervini_rules": 5, "rsi": 55})
        ids = {r["id"] for r in rows}
        self.assertEqual(ids, {"minervini", "momentum", "breakout", "candles",
                               "growth", "cashflow", "leverage", "value", "multibagger"})


if __name__ == "__main__":
    unittest.main()
