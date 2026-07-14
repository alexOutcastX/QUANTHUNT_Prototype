"""Unit tests for the momentum setup classifier (pure stdlib)."""
import unittest

import momentum_screen as ms


BREAKOUT_COIL = {
    "sqzOn": True, "sqzFire": False, "sqzMom": 0.4,
    "pct_from_high": -2.1, "new_high_52w": False,
    "relvol": 2.4, "d20": 3, "d50": 6, "d200": 18,
    "rsi": 62, "macd": 0.8, "macd_bull_cross": False,
    "price": 500, "r1": 507, "chg": 1.2,
}

BREAKOUT_TRIGGER = {
    "sqzOn": False, "sqzFire": True, "sqzMom": 1.1,
    "pct_from_high": 0.0, "new_high_52w": True,
    "relvol": 3.0, "d20": 4, "d50": 8, "d200": 22,
    "rsi": 66, "macd_bull_cross": True, "price": 900, "chg": 4.0,
}

PULLBACK_DIP = {
    "d20": -3.5, "d50": 2, "d200": 14,
    "rsi": 34, "willr": -88, "bollb": 0.12,
    "price": 300, "s1": 296, "relvol": 0.7, "chg": -0.8,
    "macd_bull_cross": False,
}

DOWNTREND = {
    "d20": -4, "d50": -6, "d200": -12,
    "rsi": 28, "willr": -92, "bollb": 0.05,
    "price": 100, "s1": 98, "relvol": 0.8,
}


class MomentumClassifyTest(unittest.TestCase):
    def test_coiling_breakout_watch(self):
        r = ms.classify(BREAKOUT_COIL)
        self.assertIsNotNone(r)
        self.assertEqual(r["setup"], "breakout")
        self.assertGreaterEqual(r["score"], 60)
        self.assertTrue(any("squeeze ON" in s for s in r["signals"]))

    def test_trigger_bar_is_fired(self):
        r = ms.classify(BREAKOUT_TRIGGER)
        self.assertIsNotNone(r)
        self.assertEqual(r["setup"], "fired")
        self.assertGreaterEqual(r["score"], 70)

    def test_pullback_in_uptrend(self):
        r = ms.classify(PULLBACK_DIP)
        self.assertIsNotNone(r)
        self.assertEqual(r["setup"], "pullback")
        self.assertTrue(any("Orderly pullback" in s for s in r["signals"]))
        self.assertTrue(any("quiet volume" in s for s in r["signals"]))

    def test_downtrend_never_qualifies_as_pullback(self):
        # Oversold below the 200-DMA is a downtrend, not a dip-buy.
        self.assertIsNone(ms.classify(DOWNTREND))

    def test_cautions_subtract_from_score(self):
        clean = ms.classify(BREAKOUT_TRIGGER)
        weak = ms.classify({**BREAKOUT_TRIGGER, "relvol": 0.5, "rsi": 82})
        self.assertIsNotNone(clean)
        self.assertIsNotNone(weak)
        self.assertLess(weak["score"], clean["score"])
        self.assertTrue(any("below-average volume" in c for c in weak["cautions"]))

    def test_probability_bounds(self):
        for t in (BREAKOUT_COIL, BREAKOUT_TRIGGER, PULLBACK_DIP):
            r = ms.classify(t)
            self.assertIsNotNone(r)
            self.assertGreaterEqual(r["probability"], 25)
            self.assertLessEqual(r["probability"], 75)

    def test_empty_snapshot_is_none(self):
        self.assertIsNone(ms.classify({}))
        self.assertIsNone(ms.classify(None))


if __name__ == "__main__":
    unittest.main()
