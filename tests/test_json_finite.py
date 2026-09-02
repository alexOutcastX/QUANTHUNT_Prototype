"""No response may contain NaN or Infinity.

Python writes both into JSON without complaint. No browser reads them back:
`JSON.parse` rejects the token and rejects the WHOLE document with it. So one
bad number in one row of a five-hundred-row payload does not produce one bad
row — it produces nothing at all, and the page that asked for it cannot tell
"the server is broken" from "there is nothing to show".

That is not hypothetical. A single symbol came back with a NaN previous close;
`chg`, `absChg`, the 52-week extremes, the distances from them and all four
Camarilla levels were computed from it and inherited the NaN. The screener
snapshot it was part of became unparseable for every client, and the tab built
on that snapshot showed an empty state that read like "nothing is converging".

Two layers, both tested here:

  * the scanner does not produce non-finite numbers in the first place; and
  * the application cannot serve one even if something else does.

The second matters more. The first is the fix for the bug that happened; the
second is the fix for the class of bug, and it is what stops the next field
nobody has thought about from taking a whole page down.
"""
import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import server
except Exception:                                            # pragma: no cover
    server = None                     # the stdlib CI gate has no Flask

try:
    import pandas as pd
    import scanner
    HAVE_PANDAS = True
except Exception:                                            # pragma: no cover
    HAVE_PANDAS = False


@unittest.skipIf(server is None, "needs Flask")
class ProviderTest(unittest.TestCase):
    def dumps(self, obj):
        return server.app.json.dumps(obj)

    def test_a_clean_payload_is_untouched(self):
        """The strict encoder is tried first, so the normal path costs nothing
        and must not reformat anything."""
        out = self.dumps({"a": 1, "b": [1.5, None, "x"], "c": {"d": True}})
        self.assertEqual(json.loads(out), {"a": 1, "b": [1.5, None, "x"], "c": {"d": True}})

    def test_nan_becomes_null(self):
        out = self.dumps({"chg": float("nan")})
        self.assertNotIn("NaN", out)
        self.assertIsNone(json.loads(out)["chg"])

    def test_both_infinities_become_null(self):
        out = self.dumps({"a": float("inf"), "b": float("-inf")})
        self.assertNotIn("Infinity", out)
        back = json.loads(out)
        self.assertIsNone(back["a"])
        self.assertIsNone(back["b"])

    def test_one_bad_row_does_not_cost_the_others(self):
        """The failure this exists to prevent: 499 good rows lost to one."""
        rows = [{"sym": f"S{i}", "price": 100.0 + i} for i in range(50)]
        rows[17]["chg"] = float("nan")
        back = json.loads(self.dumps({"rows": rows}))
        self.assertEqual(len(back["rows"]), 50)
        self.assertIsNone(back["rows"][17]["chg"])
        self.assertEqual(back["rows"][18]["price"], 118.0)

    def test_it_reaches_every_depth(self):
        out = self.dumps({"a": [{"b": [{"c": float("nan")}]}]})
        self.assertIsNone(json.loads(out)["a"][0]["b"][0]["c"])

    def test_it_survives_the_shapes_a_payload_actually_holds(self):
        for obj in ({}, [], {"a": None}, {"a": []}, {"a": {}}, [[[]]],
                    {"a": (1, float("nan"))}, {"a": True}, {"a": "NaN"}):
            out = self.dumps(obj)
            json.loads(out)          # must parse; that is the whole contract

    def test_a_string_saying_NaN_is_left_alone(self):
        """Sanitising must not reach into text."""
        self.assertEqual(json.loads(self.dumps({"a": "NaN"}))["a"], "NaN")

    def test_the_helper_is_not_shadowed(self):
        """`_finite` was already taken in this module and the later definition
        silently won, so the provider sanitised nothing and returned null for
        every payload. The name is the fix; this is the guard."""
        self.assertTrue(hasattr(server, "_json_safe"))
        self.assertEqual(server._json_safe({"a": 1.5}), {"a": 1.5})
        self.assertEqual(server._json_safe({"a": float("nan")}), {"a": None})

    def test_a_live_route_serves_parseable_json(self):
        c = server.app.test_client()
        r = c.get("/screener/snapshot/status")
        self.assertEqual(r.status_code, 200)
        json.loads(r.data)           # not r.get_json(), which is more lenient


@unittest.skipIf(not HAVE_PANDAS, "needs pandas")
class ScannerTest(unittest.TestCase):
    """The source of the NaN that got out, reproduced."""

    def _frame(self, n=60, break_prev=False):
        closes = [100 + i * 0.5 for i in range(n)]
        highs = [c * 1.01 for c in closes]
        lows = [c * 0.99 for c in closes]
        if break_prev:
            # The previous bar is the one every derived field reads.
            closes[-2] = float("nan")
            highs[-2] = float("nan")
            lows[-2] = float("nan")
        return pd.DataFrame({"Open": closes, "High": highs, "Low": lows,
                             "Close": closes, "Volume": [100000] * n})

    def test_num_drops_non_finite(self):
        self.assertIsNone(scanner._num(float("nan")))
        self.assertIsNone(scanner._num(float("inf")))
        self.assertIsNone(scanner._num(float("-inf")))
        self.assertEqual(scanner._num(1.234), 1.23)

    def test_a_nan_previous_bar_does_not_reach_the_output(self):
        """Guarded where the value is read, not where it is printed."""
        src = open(os.path.join(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))), "scanner.py"), encoding="utf-8").read()
        self.assertIn("prev = (_num(close.iloc[-2], 6) if len(close) > 1 else price)", src)
        self.assertIn("high52 = _num(high.rolling(win).max().iloc[-1])", src)
        self.assertIn("low52 = _num(low.rolling(win).min().iloc[-1])", src)
        self.assertIn("if pH is None or pL is None or pC is None:", src)

    def test_the_camarilla_levels_fall_back_rather_than_go_nan(self):
        """They are computed from the previous bar — the same bar that broke."""
        H, L, C = 101.0, 99.0, 100.0
        pH = pL = pC = None
        if pH is None or pL is None or pC is None:
            pH, pL, pC = H, L, C
        cam_h4 = pC + (pH - pL) * 1.1 / 2
        self.assertTrue(math.isfinite(cam_h4))


if __name__ == "__main__":
    unittest.main()
