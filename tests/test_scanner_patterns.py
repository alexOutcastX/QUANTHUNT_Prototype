"""Unit tests for the pure-Python candlestick + Minervini helpers in scanner.py
(no pandas / ta needed — they operate on plain float sequences)."""
import unittest

import scanner as s


class CandlestickTest(unittest.TestCase):
    def test_doji(self):
        f = s.candlesticks([10], [10.6], [9.4], [10.02])
        self.assertTrue(f["cs_doji"])
        self.assertFalse(f["cs_bullish"])

    def test_hammer(self):
        # tiny body at the top, long lower shadow, negligible upper shadow
        f = s.candlesticks([10.0], [10.06], [8.0], [10.05])
        self.assertTrue(f["cs_hammer"])
        self.assertTrue(f["cs_bullish"])

    def test_shooting_star(self):
        f = s.candlesticks([10.0], [12.0], [9.95], [10.05])
        self.assertTrue(f["cs_shooting_star"])
        self.assertTrue(f["cs_bearish"])

    def test_bullish_engulfing(self):
        # prev bearish 10->8, current bullish 7->11 engulfs the prior body
        f = s.candlesticks([10, 7], [10.5, 11.2], [7.5, 6.8], [8, 11])
        self.assertTrue(f["cs_bull_engulf"])
        self.assertTrue(f["cs_bullish"])

    def test_bearish_engulfing(self):
        f = s.candlesticks([8, 11], [8.5, 11.5], [7.8, 7.5], [10, 7.5])
        self.assertTrue(f["cs_bear_engulf"])
        self.assertTrue(f["cs_bearish"])

    def test_three_white_soldiers(self):
        f = s.candlesticks([10, 11, 12], [11, 12.5, 13.5], [9.8, 10.9, 11.9], [11, 12.3, 13.4])
        self.assertTrue(f["cs_three_white"])

    def test_no_pattern_on_flat_series(self):
        f = s.candlesticks([10, 10, 10], [10.2, 10.2, 10.2], [9.8, 9.8, 9.8], [10.05, 10.05, 10.05])
        # doji-ish bodies; must not fire directional bull/bear roll-ups
        self.assertFalse(f["cs_bullish"])
        self.assertFalse(f["cs_bearish"])

    def test_empty_is_safe(self):
        f = s.candlesticks([], [], [], [])
        self.assertFalse(any(v for v in f.values()))


class MinerviniTest(unittest.TestCase):
    def test_full_pass(self):
        ok, passed = s.minervini(120, 110, 100, 90, 88, 40, -10, True)
        self.assertTrue(ok)
        self.assertEqual(passed, 9)

    def test_below_200dma_fails(self):
        ok, passed = s.minervini(80, 110, 100, 90, 88, 40, -10, True)
        self.assertFalse(ok)
        self.assertLess(passed, 9)

    def test_weak_rs_fails_template(self):
        ok, passed = s.minervini(120, 110, 100, 90, 88, 40, -10, False)
        self.assertFalse(ok)          # RS proxy off → template not fully met
        self.assertEqual(passed, 8)

    def test_missing_mas_safe(self):
        ok, passed = s.minervini(120, None, None, None, None, None, None, False)
        self.assertFalse(ok)
        self.assertEqual(passed, 0)
