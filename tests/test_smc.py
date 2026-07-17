"""Unit tests for the ICT/SMC screener (smc.py)."""
import unittest

import smc


def _candles(vals, vols=None, t0=1700000000):
    out = []
    for i, c in enumerate(vals):
        o = vals[i - 1] if i else c
        out.append({"t": t0 + i * 86400, "o": o, "h": max(o, c) * 1.006,
                    "l": min(o, c) * 0.994, "c": c, "v": (vols[i] if vols else 100000)})
    return out


# uptrend → confirmed swing low → drift up → return down that sweeps the swing
# low and reclaims (a discount liquidity-sweep reversal).
def _sweep_series():
    up = [100 + i * 0.5 for i in range(120)]
    dip = [160 - i * 2 for i in range(8)]
    rec = [147 + i * 1.4 for i in range(10)]
    cont = [160 + i * 0.3 for i in range(24)]
    sweep = [150, 146, 141]
    reclaim = [147, 148.5]
    return up + dip + rec + cont + sweep + reclaim


DOWNTREND = [300 - i * 0.9 for i in range(200)]


class SmcEngineTest(unittest.TestCase):
    def test_short_series_skips(self):
        r = smc.analyze("X", _candles([100, 101, 102, 103]))
        self.assertEqual(r["action"], "SKIP")
        self.assertFalse(r["qualifies"])
        self.assertEqual(r["strategies"], [])

    def test_sweep_reversal_detected(self):
        vals = _sweep_series()
        vv = [100000] * len(vals)
        vv[-3] = 300000
        r = smc.analyze("SWP", _candles(vals, vv), name="Sweep Co")
        keys = {s["key"] for s in r["strategies"]}
        self.assertIn("sweep", keys)
        self.assertIn(r["action"], ("LONG", "WATCH"))
        self.assertEqual(r["zone"], "discount")
        self.assertGreaterEqual(r["conf_count"], 3)
        # structural stop sits below the swept wick, below entry
        self.assertLess(r["stop"], r["entry"])
        self.assertGreater(r["target"], r["entry"])

    def test_downtrend_no_long(self):
        r = smc.analyze("DN", _candles(DOWNTREND))
        self.assertNotEqual(r["action"], "LONG")

    def test_confluences_and_models_shape(self):
        vals = _sweep_series()
        r = smc.analyze("SWP", _candles(vals))
        self.assertIsInstance(r["confluences"], list)
        for s in r["strategies"]:
            self.assertIn(s["key"], smc.STRATEGIES)
            self.assertTrue(s["label"])
            self.assertTrue(s["note"])

    def test_not_automated_surfaced(self):
        r = smc.analyze("SWP", _candles(_sweep_series()))
        self.assertTrue(r["not_automated"])
        self.assertTrue(any("NY Open" in n for n in r["not_automated"]))

    def test_required_fields_present(self):
        r = smc.analyze("SWP", _candles(_sweep_series()))
        for k in ("action", "qualifies", "score", "strategies", "confluences", "conf_count",
                  "zone", "primary", "primary_key", "trend", "rsi", "entry", "stop", "stop_pct",
                  "target", "target2", "upside_pct", "rr", "eta_days", "eta", "support",
                  "resistance", "max_dd", "reasons"):
            self.assertIn(k, r)

    def test_score_bounded(self):
        r = smc.analyze("SWP", _candles(_sweep_series()))
        self.assertGreaterEqual(r["score"], 0)
        self.assertLessEqual(r["score"], 100)


if __name__ == "__main__":
    unittest.main()
