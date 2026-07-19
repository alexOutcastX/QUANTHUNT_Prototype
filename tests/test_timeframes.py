"""Unit tests for the multi-timeframe scorer (pure stdlib — no pandas)."""
import unittest

import timeframes as tf


class ScoreReadTest(unittest.TestCase):
    def test_all_bullish(self):
        score, bias = tf.score_read(price=110, ema20=100, ema50=90, rsi=65, macd=0.5)
        self.assertEqual(score, 100)
        self.assertEqual(bias, "bullish")

    def test_all_bearish(self):
        score, bias = tf.score_read(price=90, ema20=100, ema50=110, rsi=35, macd=-0.5)
        self.assertEqual(score, 0)
        self.assertEqual(bias, "bearish")

    def test_neutral_mixed(self):
        # price>ema20 (+1), ema20<ema50 (-1), rsi mid (0), macd>0 (+1) → 50+12.5→ 62/63?
        score, bias = tf.score_read(price=105, ema20=100, ema50=110, rsi=50, macd=0.1)
        self.assertTrue(40 <= score <= 75)
        self.assertIn(bias, ("neutral", "bullish"))

    def test_none_inputs_are_neutral(self):
        score, bias = tf.score_read(price=None, ema20=None, ema50=None, rsi=None, macd=None)
        self.assertEqual(score, 50)
        self.assertEqual(bias, "neutral")

    def test_bias_thresholds(self):
        self.assertEqual(tf.score_read(100, 90, 80, 60, 1)[1], "bullish")   # all four up → 100
        # three up, one flat (rsi mid) → +3 → 88 → bullish
        self.assertEqual(tf.score_read(100, 90, 80, 50, 1), (88, "bullish"))
        # exactly-neutral: two up, two down → 50
        s, b = tf.score_read(110, 100, 110, 40, 0.1)  # +1, -1, -1, +1 → 50
        self.assertEqual(s, 50)
        self.assertEqual(b, "neutral")


if __name__ == "__main__":
    unittest.main()
