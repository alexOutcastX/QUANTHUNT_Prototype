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


class SmcGeometryTest(unittest.TestCase):
    """The shapes the card draws.

    A model that can only be described but not located is a model you cannot
    check, so each detector emits the bars and prices it actually fired on.
    """

    def setUp(self):
        self.candles = _candles(_sweep_series())
        self.r = smc.analyze("SWP", self.candles)
        self.times = {c["t"] for c in self.candles}

    def test_zones_emitted_with_a_known_shape(self):
        self.assertTrue(self.r["zones"], "no geometry emitted for a matched setup")
        for z in self.r["zones"]:
            self.assertIn(z["kind"], smc.ZONE_KINDS)
            self.assertIn(z["bias"], ("bullish", "bearish", "neutral"))
            self.assertTrue(z["label"])
            for k in ("owner", "t0", "t1", "lo", "hi", "extend"):
                self.assertIn(k, z)

    def test_every_anchor_is_a_real_bar(self):
        # A zone anchored off-grid cannot be positioned on the chart.
        for z in self.r["zones"]:
            for t in (z["t0"], z["t1"]):
                if t is not None:
                    self.assertIn(t, self.times, f"{z['kind']} anchored off-grid")

    def test_bands_are_ordered_low_to_high(self):
        for z in self.r["zones"]:
            if z["lo"] is not None and z["hi"] is not None:
                self.assertLessEqual(z["lo"], z["hi"], f"{z['kind']} band is inverted")

    def test_open_ended_zones_are_marked_extend(self):
        for z in self.r["zones"]:
            if z["t1"] is None:
                self.assertTrue(z["extend"], f"{z['kind']} has no end and no extend flag")

    def test_matched_models_own_their_shapes(self):
        keys = {m["key"] for m in self.r["strategies"]}
        owners = {z["owner"] for z in self.r["zones"]} - {"context"}
        self.assertTrue(owners, "no model-owned zones")
        self.assertTrue(owners <= keys, f"zones owned by unmatched models: {owners - keys}")

    def test_context_geometry_always_present(self):
        kinds = {z["kind"] for z in self.r["zones"] if z["owner"] == "context"}
        for k in ("range", "equilibrium", "discount", "premium", "ote"):
            self.assertIn(k, kinds, f"missing context zone: {k}")

    def test_ote_band_matches_the_scored_band(self):
        # The drawn OTE must be the same 62–79% the in_ote flag is computed
        # from, or the picture disagrees with the score.
        rng = next(z for z in self.r["zones"] if z["owner"] == "context" and z["kind"] == "range")
        ote = next(z for z in self.r["zones"] if z["kind"] == "ote")
        span = rng["hi"] - rng["lo"]
        self.assertAlmostEqual(ote["lo"], rng["lo"] + 0.205 * span, places=1)
        self.assertAlmostEqual(ote["hi"], rng["lo"] + 0.385 * span, places=1)

    def test_focus_window_is_bounded_and_inside_the_series(self):
        first, last = self.candles[0]["t"], self.candles[-1]["t"]
        for m in self.r["strategies"]:
            f = m.get("focus")
            self.assertIsNotNone(f, f"{m['key']} has no focus window")
            self.assertGreaterEqual(f["from"], first)
            self.assertEqual(f["to"], last)
            bars = (f["to"] - f["from"]) // 86400
            self.assertLessEqual(bars, smc.FOCUS_MAX_BARS,
                                 f"{m['key']} focus is wider than the cap")
            self.assertGreaterEqual(bars, smc.FOCUS_MIN_BARS,
                                    f"{m['key']} focus is too narrow to read")

    def test_levels_are_the_trade_plan(self):
        got = {lv["kind"]: lv["price"] for lv in self.r["levels"]}
        self.assertEqual(got["entry"], self.r["entry"])
        self.assertEqual(got["stop"], self.r["stop"])
        self.assertEqual(got["target"], self.r["target"])
        self.assertEqual(got["target2"], self.r["target2"])

    def test_without_timestamps_geometry_is_skipped_not_faked(self):
        # Callers may pass bare OHLC. Scores must be unchanged and no zone may
        # be invented with a null anchor the client would try to plot.
        bare = [{k: v for k, v in c.items() if k != "t"} for c in self.candles]
        r = smc.analyze("SWP", bare)
        self.assertEqual(r["zones"], [])
        self.assertEqual(r["levels"], [])
        self.assertEqual([m["score"] for m in r["strategies"]],
                         [m["score"] for m in self.r["strategies"]])
        self.assertTrue(all("focus" not in m for m in r["strategies"]))

    def test_volume_imbalance_requires_overlapping_wicks(self):
        # A true price gap (no wick overlap) is not a VI — that is an FVG.
        opens = [10, 12]
        highs = [10.5, 12.5]
        lows = [9.5, 11.5]          # lows[1] > highs[0] → no overlap
        closes = [10, 12]
        cs = [{"t": 1}, {"t": 2}]
        self.assertEqual(
            smc._volume_imbalances(cs, opens, highs, lows, closes, atr=1.0), [])


if __name__ == "__main__":
    unittest.main()
