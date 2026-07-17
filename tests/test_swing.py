"""Unit tests for the swing (short-term) trade engine (swing.py)."""
import math
import unittest

import swing


def _candles(vals, t0=1600000000):
    out = []
    for i, c in enumerate(vals):
        o = vals[i - 1] if i else c
        hi = max(o, c) * 1.01
        lo = min(o, c) * 0.99
        out.append({"t": t0 + i * 86400, "o": o, "h": hi, "l": lo, "c": c,
                    "v": 100000 + (i % 5) * 40000})
    return out


# An uptrend that pulls back into an oversold dip, then ticks up on the last bar
# — the canonical pullback-reversal swing setup.
UPTREND = [100 + i * 0.6 for i in range(200)]           # long, healthy uptrend
PULLBACK = [220 - i * 2.2 for i in range(14)]           # sharp pullback (oversold)
RESUME = [190, 192.5]                                    # turning back up
PULLBACK_REVERSAL = UPTREND + PULLBACK + RESUME

# A steady grind down — should not be a swing BUY.
DOWNTREND = [300 - i * 0.9 + 3 * math.sin(i / 6) for i in range(200)]


class SwingEngineTest(unittest.TestCase):
    def test_short_series_skips(self):
        r = swing.analyze("X", _candles([100, 101, 102, 103]))
        self.assertEqual(r["action"], "SKIP")
        self.assertFalse(r["qualifies"])

    def test_pullback_reversal_is_swing(self):
        r = swing.analyze("SW1", _candles(PULLBACK_REVERSAL), name="Swing One")
        self.assertTrue(r["qualifies"])
        self.assertEqual(r["action"], "SWING")
        # coherent long swing: stop below entry, target above, positive upside
        self.assertLess(r["stop"], r["entry"])
        self.assertGreater(r["target"], r["entry"])
        self.assertGreater(r["upside_pct"], 0)
        self.assertIsNotNone(r["rr"])
        self.assertGreaterEqual(r["rr"], 1.3)
        self.assertGreaterEqual(r["probability"], 45)
        self.assertIn(r["trend"], ("up", "side"))
        self.assertTrue(r["reasons"])

    def test_downtrend_not_swing(self):
        r = swing.analyze("DOWN", _candles(DOWNTREND))
        self.assertNotEqual(r["action"], "SWING")

    def test_required_fields_present(self):
        r = swing.analyze("SW1", _candles(PULLBACK_REVERSAL))
        for k in ("action", "qualifies", "setup", "probability", "trend", "momentum",
                  "entry", "stop", "stop_pct", "target", "upside_pct", "rr",
                  "eta_days", "eta", "support", "resistance", "rsi", "max_dd", "reasons"):
            self.assertIn(k, r)

    def test_eta_present_for_swing(self):
        r = swing.analyze("SW1", _candles(PULLBACK_REVERSAL))
        self.assertIsNotNone(r["eta_days"])
        self.assertGreaterEqual(r["eta_days"], 2)
        self.assertTrue(r["eta"])

    def test_risk_band_bounded(self):
        r = swing.analyze("SW1", _candles(PULLBACK_REVERSAL))
        # swing stop should stay within a sane band (never worse than ~-8.5%)
        self.assertGreaterEqual(r["stop_pct"], -8.5)
        self.assertLess(r["stop_pct"], 0)

    def test_max_drawdown_is_non_positive(self):
        r = swing.analyze("SW1", _candles(PULLBACK_REVERSAL))
        self.assertLessEqual(r["max_dd"], 0)

    def test_probability_bounded(self):
        r = swing.analyze("SW1", _candles(PULLBACK_REVERSAL))
        self.assertGreaterEqual(r["probability"], 0)
        self.assertLessEqual(r["probability"], 100)


if __name__ == "__main__":
    unittest.main()
