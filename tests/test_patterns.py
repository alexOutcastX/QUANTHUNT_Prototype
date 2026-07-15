"""Unit tests for the chart-pattern detection engine (patterns.py)."""
import math
import unittest

import patterns


def _seg(a, b, n):
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def _path(anchors):
    """Piecewise-linear path from (value, n_bars) legs — no duplicated junction
    bars, so each turn is a single clean swing pivot."""
    vals = [anchors[0][0]]
    for tgt, nb in anchors[1:]:
        start = vals[-1]
        for i in range(1, nb + 1):
            vals.append(start + (tgt - start) * i / nb)
    return vals


def _candles(vals, t0=1600000000):
    out = []
    for i, c in enumerate(vals):
        o = vals[i - 1] if i else c
        hi = max(o, c) + abs(c) * 0.006
        lo = min(o, c) - abs(c) * 0.006
        out.append({"t": t0 + i * 86400, "o": o, "h": hi, "l": lo, "c": c, "v": 100000})
    return out


def _types(result):
    return {p["type"] for p in result["patterns"]}


class PatternEngineTest(unittest.TestCase):
    def test_too_short_series_is_safe(self):
        r = patterns.detect_patterns(_candles([100, 101, 102]))
        self.assertEqual(r["count"], 0)
        self.assertIsNone(r["current"])
        self.assertIn("note", r)

    def test_double_top(self):
        v = _path([(100, 0), (120, 18), (109, 10), (120.5, 11), (104, 14)])
        r = patterns.detect_patterns(_candles(v))
        self.assertIn("double_top", _types(r))
        dt = next(p for p in r["patterns"] if p["type"] == "double_top")
        self.assertEqual(dt["bias"], "bearish")
        self.assertLess(dt["expansion_pct"], 0)          # bearish → negative move
        self.assertGreaterEqual(dt["confidence"], 50)
        self.assertGreaterEqual(dt["continuation"], 35)
        self.assertLessEqual(dt["continuation"], 90)
        self.assertLess(dt["start_ts"], dt["end_ts"])    # started before it ended

    def test_double_bottom(self):
        v = _path([(120, 0), (100, 18), (111, 10), (99.5, 11), (116, 14)])
        r = patterns.detect_patterns(_candles(v))
        self.assertIn("double_bottom", _types(r))
        db = next(p for p in r["patterns"] if p["type"] == "double_bottom")
        self.assertEqual(db["bias"], "bullish")
        self.assertGreater(db["expansion_pct"], 0)

    def test_head_and_shoulders(self):
        v = _path([(100, 0), (113, 14), (105, 7), (125, 11), (104, 10), (112, 9), (96, 12)])
        r = patterns.detect_patterns(_candles(v))
        self.assertIn("head_shoulders", _types(r))

    def test_ascending_triangle(self):
        lows = _seg(120, 147, 7)
        anchors = [(lows[0], 0)]
        for i in range(7):
            anchors.append((150, 5))
            anchors.append((lows[i], 5))
        r = patterns.detect_patterns(_candles(_path(anchors)))
        # a flat-topped rising structure should surface an ascending triangle
        self.assertIn("ascending_triangle", _types(r))

    def test_cup_and_handle(self):
        cup = _seg(100, 100, 3) + [100 - 25 * math.sin(math.pi * i / 40) for i in range(41)] \
            + _seg(100, 96, 4) + _seg(96, 99, 4)
        r = patterns.detect_patterns(_candles(cup))
        self.assertTrue({"cup_and_handle", "rounding_bottom"} & _types(r))

    def test_every_pattern_has_required_fields(self):
        v = _path([(100, 0), (120, 18), (109, 10), (120.5, 11), (104, 14)])
        r = patterns.detect_patterns(_candles(v))
        for p in r["patterns"]:
            for key in ("type", "label", "bias", "start_ts", "end_ts",
                        "confidence", "continuation", "expansion_pct", "status"):
                self.assertIn(key, p)
            self.assertIn(p["bias"], ("bullish", "bearish", "neutral"))
            self.assertGreaterEqual(p["confidence"], 0)
            self.assertLessEqual(p["confidence"], 100)
            # start/end indices are stripped from the public payload
            self.assertNotIn("start_index", p)

    def test_current_flag_marks_at_most_one(self):
        v = _path([(100, 0), (120, 18), (109, 10), (120.5, 11), (104, 14)])
        r = patterns.detect_patterns(_candles(v))
        currents = [p for p in r["patterns"] if p.get("current")]
        self.assertLessEqual(len(currents), 1)
        if r["current"]:
            self.assertEqual(len(currents), 1)

    def test_flat_series_finds_nothing_crazy(self):
        # A dead-flat line must not crash or invent dozens of patterns.
        r = patterns.detect_patterns(_candles([100.0] * 120))
        self.assertLess(r["count"], 6)


if __name__ == "__main__":
    unittest.main()
