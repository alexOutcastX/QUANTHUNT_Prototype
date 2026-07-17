"""Unit tests for the buy-recommendation engine (recommend.py)."""
import math
import unittest

import recommend


def _candles(vals, t0=1600000000):
    out = []
    for i, c in enumerate(vals):
        o = vals[i - 1] if i else c
        hi = max(o, c) * 1.01
        lo = min(o, c) * 0.99
        out.append({"t": t0 + i * 86400, "o": o, "h": hi, "l": lo, "c": c,
                    "v": 100000 + (i % 5) * 40000})
    return out


UPTREND_PULLBACK = (
    [100 + i * 0.7 for i in range(120)]      # long uptrend
    + [184 - i * 0.9 for i in range(12)]     # pullback
    + [173 + i * 0.8 for i in range(20)]     # resume
)
DOWNTREND = [200 - i * 0.7 + 4 * math.sin(i / 5) for i in range(160)]


class RecommendEngineTest(unittest.TestCase):
    def test_short_series_skips(self):
        r = recommend.analyze("X", _candles([100, 101, 102, 103]))
        self.assertEqual(r["action"], "SKIP")

    def test_uptrend_is_buy_with_full_setup(self):
        r = recommend.analyze("BUY1", _candles(UPTREND_PULLBACK), fund_score=80, name="Buy One")
        self.assertEqual(r["action"], "BUY")
        # a coherent long setup: stop below entry, target above, positive upside
        self.assertLess(r["stop"], r["entry"])
        self.assertGreater(r["target"], r["entry"])
        self.assertGreater(r["upside_pct"], 0)
        self.assertIsNotNone(r["rr"])
        self.assertGreaterEqual(r["rr"], 1.2)
        # support below price, resistance above
        self.assertLess(r["support"], r["price"])
        self.assertGreater(r["resistance"], r["price"])
        self.assertGreaterEqual(r["confidence"], 58)
        self.assertTrue(r["rationale"])

    def test_downtrend_not_buy(self):
        r = recommend.analyze("DOWN", _candles(DOWNTREND), fund_score=45)
        self.assertNotEqual(r["action"], "BUY")
        self.assertLess(r["momentum_score"], 55)

    def test_confidence_blends_fundamental(self):
        strong = recommend.analyze("A", _candles(UPTREND_PULLBACK), fund_score=95)
        weak = recommend.analyze("A", _candles(UPTREND_PULLBACK), fund_score=40)
        self.assertGreater(strong["confidence"], weak["confidence"])

    def test_works_without_fundamental_score(self):
        r = recommend.analyze("A", _candles(UPTREND_PULLBACK))
        self.assertIsNone(r["fundamental_score"])
        self.assertIn(r["action"], ("BUY", "WATCH", "AVOID"))
        self.assertGreaterEqual(r["confidence"], 0)
        self.assertLessEqual(r["confidence"], 100)

    def test_required_fields_present(self):
        r = recommend.analyze("A", _candles(UPTREND_PULLBACK), fund_score=70)
        for k in ("action", "confidence", "momentum_score", "pattern_score",
                  "entry", "stop", "target", "target2", "upside_pct", "rr",
                  "eta_days", "eta", "support", "resistance", "rsi", "rationale"):
            self.assertIn(k, r)

    def test_eta_present_for_buy(self):
        r = recommend.analyze("A", _candles(UPTREND_PULLBACK), fund_score=80)
        self.assertIsNotNone(r["eta_days"])
        self.assertGreaterEqual(r["eta_days"], 2)
        self.assertTrue(r["eta"])

    def test_eta_drift_varies_with_conviction(self):
        # ETA must not collapse to a constant: a strong, trending setup should
        # reach the same ATR-distance target sooner than a weak, sideways one.
        price, atr = 1000.0, 20.0
        target = price + 3.3 * atr
        fast, _ = recommend.eta_to_target(
            price, target, atr, recommend.progress_drift(90, "up", True))
        slow, _ = recommend.eta_to_target(
            price, target, atr, recommend.progress_drift(30, "down", False))
        self.assertLess(fast, slow)
        self.assertGreaterEqual(fast, 2)

    def test_risk_band_is_bounded(self):
        # stop-loss should stay within a sane risk band (never > ~11%).
        r = recommend.analyze("A", _candles(UPTREND_PULLBACK), fund_score=70)
        self.assertGreaterEqual(r["stop_pct"], -11.0)
        self.assertLess(r["stop_pct"], 0)


if __name__ == "__main__":
    unittest.main()
