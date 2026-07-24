"""Offline tests for the Trade-Scan setup derivation (pattern_screen.trade_setup)."""
import unittest

from pattern_screen import trade_setup


class TradeSetupTest(unittest.TestCase):
    def test_bullish_with_key_level_stop(self):
        s = trade_setup({"bias": "bullish", "target": 110.0, "level": 96.0}, 100.0)
        self.assertEqual(s["entry"], 100.0)
        self.assertEqual(s["target"], 110.0)
        self.assertEqual(s["stop"], 96.0)          # key level below entry wins
        self.assertEqual(s["rr"], 2.5)             # 10 reward / 4 risk

    def test_bullish_without_level_uses_half_move(self):
        s = trade_setup({"bias": "bullish", "target": 110.0}, 100.0)
        self.assertEqual(s["stop"], 95.0)          # half the measured move
        self.assertEqual(s["rr"], 2.0)

    def test_bullish_level_above_entry_falls_back(self):
        # A key level ABOVE entry can't be a long stop — fall back to half-move.
        s = trade_setup({"bias": "bullish", "target": 110.0, "level": 104.0}, 100.0)
        self.assertEqual(s["stop"], 95.0)

    def test_bearish_setup(self):
        s = trade_setup({"bias": "bearish", "target": 90.0, "level": 105.0}, 100.0)
        self.assertEqual(s["stop"], 105.0)         # key level above entry
        self.assertEqual(s["rr"], 2.0)

    def test_target_from_expansion_pct(self):
        s = trade_setup({"bias": "bullish", "expansion_pct": 5.0}, 200.0)
        self.assertEqual(s["target"], 210.0)

    def test_incoherent_geometry_returns_none(self):
        # Bullish but target below price / bearish but target above price.
        self.assertIsNone(trade_setup({"bias": "bullish", "target": 95.0}, 100.0))
        self.assertIsNone(trade_setup({"bias": "bearish", "target": 105.0}, 100.0))
        self.assertIsNone(trade_setup({"bias": "bullish"}, 100.0))
        self.assertIsNone(trade_setup(None, 100.0))
        self.assertIsNone(trade_setup({"bias": "bullish", "target": 110.0}, None))


if __name__ == "__main__":
    unittest.main()
