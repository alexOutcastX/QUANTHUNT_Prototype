"""Unit tests for the institutional / algorithmic strategy screener."""
import math
import unittest

import institutional as inst


def _candles(vals, vols=None, t0=1600000000):
    out = []
    for i, c in enumerate(vals):
        o = vals[i - 1] if i else c
        out.append({"t": t0 + i * 86400, "o": o, "h": max(o, c) * 1.01,
                    "l": min(o, c) * 0.99, "c": c, "v": (vols[i] if vols else 100000)})
    return out


UPTREND = [100 + i * 0.6 for i in range(300)]
# healthy uptrend that snaps into a sharp oversold dip on the last bars
MEANREV = [100 + i * 0.5 for i in range(250)] + [225 - i * 3 for i in range(20)]
DOWNTREND = [300 - i * 0.7 + 3 * math.sin(i / 6) for i in range(220)]


class InstitutionalEngineTest(unittest.TestCase):
    def test_short_series_skips(self):
        r = inst.analyze("X", _candles([100, 101, 102, 103]))
        self.assertEqual(r["action"], "SKIP")
        self.assertFalse(r["qualifies"])
        self.assertEqual(r["strategies"], [])

    def test_uptrend_flags_momentum_or_trend(self):
        r = inst.analyze("MOM", _candles(UPTREND), name="Mom Co")
        self.assertTrue(r["qualifies"])
        self.assertEqual(r["action"], "BUY")
        keys = {s["key"] for s in r["strategies"]}
        self.assertTrue(keys & {"momentum", "trend"})
        # coherent setup
        self.assertLess(r["stop"], r["entry"])
        self.assertGreater(r["target"], r["entry"])
        self.assertIsNotNone(r["rr"])

    def test_oversold_flags_mean_reversion(self):
        r = inst.analyze("MR", _candles(MEANREV))
        keys = {s["key"] for s in r["strategies"]}
        self.assertIn("mean_rev", keys)

    def test_stat_arb_needs_benchmark(self):
        bench = [100 + i * 0.4 for i in range(300)]
        lag = [100 + i * 0.4 for i in range(200)] + [180 - i * 0.2 for i in range(100)]
        r = inst.analyze("SA", _candles(lag), bench_closes=bench)
        keys = {s["key"] for s in r["strategies"]}
        self.assertIn("stat_arb", keys)
        # without a benchmark, stat-arb can't fire
        r2 = inst.analyze("SA", _candles(lag))
        self.assertNotIn("stat_arb", {s["key"] for s in r2["strategies"]})

    def test_each_strategy_has_label_and_note(self):
        r = inst.analyze("MOM", _candles(UPTREND))
        for s in r["strategies"]:
            self.assertIn(s["key"], inst.STRATEGIES)
            self.assertTrue(s["label"])
            self.assertTrue(s["note"])
            self.assertGreaterEqual(s["score"], 0)
            self.assertLessEqual(s["score"], 100)

    def test_primary_is_top_scored(self):
        r = inst.analyze("MOM", _candles(UPTREND))
        if r["strategies"]:
            self.assertEqual(r["primary"], r["strategies"][0]["label"])
            self.assertEqual(r["primary_key"], r["strategies"][0]["key"])

    def test_required_fields_present(self):
        r = inst.analyze("MOM", _candles(UPTREND))
        for k in ("action", "qualifies", "score", "strategies", "primary", "primary_key",
                  "matched_count", "trend", "momentum", "rsi", "entry", "stop", "stop_pct",
                  "target", "upside_pct", "rr", "eta_days", "eta", "support", "resistance",
                  "max_dd", "reasons"):
            self.assertIn(k, r)

    def test_score_bounded(self):
        r = inst.analyze("MOM", _candles(UPTREND))
        self.assertGreaterEqual(r["score"], 0)
        self.assertLessEqual(r["score"], 100)


if __name__ == "__main__":
    unittest.main()
