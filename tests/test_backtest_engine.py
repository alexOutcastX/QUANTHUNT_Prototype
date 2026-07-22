"""Unit tests for the institutional backtest engine (backtest_engine.py).

The engine takes constituents / OHLC loaders as injected callables, so these
tests run stdlib-only on synthetic candles — no network, no pandas. They pin
the behaviours professionals rely on: T+1-open execution (no lookahead),
gap-aware stop fills, whole-share sizing under a cash constraint, the cost
stack, time stops, metrics math and the job lifecycle.
"""
import time
import unittest

import backtest_engine as bt

DAY = 86400
T0 = 1_600_000_000 - (1_600_000_000 % DAY)


def mk(prices, t0=T0, spread=0.0):
    """Build daily candles from (open, high, low, close) tuples or flat closes."""
    out = []
    for i, p in enumerate(prices):
        if isinstance(p, tuple):
            o, h, l, c = p
        else:
            o = h = l = c = float(p)
            h += spread
            l -= spread
        out.append({"t": t0 + i * DAY, "o": float(o), "h": float(h),
                    "l": float(l), "c": float(c), "v": 1000})
    return out


ZERO_COSTS = {"brokerage_pct": 0, "brokerage_cap": 0, "stt_pct": 0, "exchange_pct": 0,
              "sebi_pct": 0, "gst_pct": 0, "stamp_pct": 0, "slippage_bps": 0}


def base_cfg(**kw):
    cfg = {
        "symbols": ["AAA"], "period": "1y", "capital": 100000,
        "strategy": {"key": "custom",
                     "buy": [{"ind": "close", "op": "gt", "target": "value", "value": 0}],
                     "sell": []},
        "sizing": {"mode": "equal"}, "max_positions": 1,
        "execution": "next_open", "costs": ZERO_COSTS, "risk": {},
    }
    cfg.update(kw)
    return cfg


def simulate(series, cfg, signals=None):
    if signals is None:
        strat = cfg["strategy"]
        if strat["key"] == "custom":
            signals = {s: bt._custom_signals(cs, strat.get("buy"), strat.get("sell"))
                       for s, cs in series.items()}
        else:
            signals = {s: bt._signals(cs, strat["key"], strat.get("params"))
                       for s, cs in series.items()}
    return bt._simulate(series, signals, cfg)


class ExecutionTest(unittest.TestCase):
    def test_signal_on_close_fills_at_next_open(self):
        # Signal fires on bar 1 (close 100 > 0); entry must be bar 2's OPEN.
        cs = mk([(100, 101, 99, 100), (100, 101, 99, 100), (105, 106, 104, 105),
                 (106, 107, 105, 106), (106, 107, 105, 106)])
        sig = {"AAA": [0, 1, 0, 0, 0]}
        sim = simulate({"AAA": cs}, base_cfg(), signals=sig)
        self.assertEqual(len(sim["trades"]), 1)
        self.assertAlmostEqual(sim["trades"][0]["entry_px"], 105.0)  # bar 2 open, NOT bar 1 close

    def test_same_close_mode_fills_on_signal_close(self):
        cs = mk([(100, 101, 99, 100), (100, 101, 99, 102), (105, 106, 104, 105)])
        sig = {"AAA": [0, 1, 0]}
        sim = simulate({"AAA": cs}, base_cfg(execution="same_close"), signals=sig)
        self.assertAlmostEqual(sim["trades"][0]["entry_px"], 102.0)

    def test_exit_signal_fills_next_open(self):
        cs = mk([(100,) * 4, (100,) * 4, (100,) * 4, (110, 111, 109, 112), (108, 109, 107, 108)])
        sig = {"AAA": [1, 0, 0, -1, 0]}
        sim = simulate({"AAA": cs}, base_cfg(), signals=sig)
        t = sim["trades"][0]
        self.assertEqual(t["reason"], "Signal")
        self.assertAlmostEqual(t["exit_px"], 108.0)  # next bar's open, not 112


class SizingTest(unittest.TestCase):
    def test_whole_shares_and_cash_constraint(self):
        cs = mk([(100,) * 4] * 5)
        sig = {"AAA": [1, 0, 0, 0, 0]}
        sim = simulate({"AAA": cs}, base_cfg(capital=1050), signals=sig)
        self.assertEqual(sim["trades"][0]["qty"], 10)  # floor(1050/100), never fractional

    def test_equal_weight_splits_across_slots(self):
        a = mk([(100,) * 4] * 6)
        b = mk([(50,) * 4] * 6)
        sig = {"AAA": [1, 0, 0, 0, 0, 0], "BBB": [1, 0, 0, 0, 0, 0]}
        sim = simulate({"AAA": a, "BBB": b},
                       base_cfg(symbols=["AAA", "BBB"], max_positions=2, capital=100000),
                       signals=sig)
        qty = {t["symbol"]: t["qty"] for t in sim["trades"]}
        self.assertEqual(qty["AAA"], 500)   # 50k / 100
        self.assertEqual(qty["BBB"], 1000)  # 50k / 50

    def test_max_positions_respected_with_momentum_ranking(self):
        flat = [(100,) * 4] * 70
        rising = [(100 + i, 100 + i, 100 + i, 100 + i) for i in range(70)]
        a, b = mk(flat), mk(rising)
        sig_on = [0] * 69 + [0]
        sig_a = list(sig_on)
        sig_b = list(sig_on)
        sig_a[65] = sig_b[65] = 1
        sim = simulate({"AAA": a, "BBB": b},
                       base_cfg(symbols=["AAA", "BBB"], max_positions=1),
                       signals={"AAA": sig_a, "BBB": sig_b})
        # Only one slot: the higher-momentum name (BBB) must win it.
        self.assertEqual({t["symbol"] for t in sim["trades"]}, {"BBB"})

    def test_risk_sizing_uses_stop_distance(self):
        cs = mk([(100,) * 4] * 10)
        sig = {"AAA": [1] + [0] * 9}
        cfg = base_cfg(capital=100000,
                       sizing={"mode": "risk", "value": 1},          # risk 1% of equity
                       risk={"sl_type": "pct", "sl_val": 5})         # stop 5% away
        sim = simulate({"AAA": cs}, cfg, signals=sig)
        # risk ₹1000 / (5% of ₹100) = 200 shares → ₹20k position
        self.assertEqual(sim["trades"][0]["qty"], 200)


class StopsTest(unittest.TestCase):
    def test_stop_intrabar_fills_at_stop_price(self):
        cs = mk([(100,) * 4, (100, 101, 99, 100), (100, 100, 90, 95), (95,) * 4])
        sig = {"AAA": [1, 0, 0, 0]}
        cfg = base_cfg(risk={"sl_type": "pct", "sl_val": 5})
        sim = simulate({"AAA": cs}, cfg, signals=sig)
        t = sim["trades"][0]
        self.assertEqual(t["reason"], "Stop")
        self.assertAlmostEqual(t["exit_px"], 95.0)  # 100 − 5%

    def test_gap_through_stop_fills_at_open_not_stop(self):
        cs = mk([(100,) * 4, (100, 101, 99, 100), (85, 86, 84, 85), (85,) * 4])
        sig = {"AAA": [1, 0, 0, 0]}
        cfg = base_cfg(risk={"sl_type": "pct", "sl_val": 5})
        sim = simulate({"AAA": cs}, cfg, signals=sig)
        t = sim["trades"][0]
        self.assertEqual(t["reason"], "Stop (gap)")
        self.assertAlmostEqual(t["exit_px"], 85.0)  # the real (worse) open

    def test_take_profit_and_time_stop(self):
        # Day 2 opens BELOW the 110 target and tags it intra-bar → fill at the level.
        cs = mk([(100,) * 4, (100, 105, 99, 104), (105, 112, 104, 108), (108,) * 4, (108,) * 4])
        sig = {"AAA": [1, 0, 0, 0, 0]}
        cfg = base_cfg(risk={"tp_type": "pct", "tp_val": 10})
        sim = simulate({"AAA": cs}, cfg, signals=sig)
        self.assertEqual(sim["trades"][0]["reason"], "Target")
        self.assertAlmostEqual(sim["trades"][0]["exit_px"], 110.0)

        cfg2 = base_cfg(risk={"max_hold_days": 2})
        sim2 = simulate({"AAA": mk([(100,) * 4] * 6)}, cfg2, signals={"AAA": [1, 0, 0, 0, 0, 0]})
        self.assertEqual(sim2["trades"][0]["reason"], "Time")

    def test_trailing_stop(self):
        cs = mk([(100,) * 4, (100, 120, 100, 120), (120, 121, 106, 107), (107,) * 4])
        sig = {"AAA": [1, 0, 0, 0]}
        cfg = base_cfg(risk={"trail_pct": 10})
        sim = simulate({"AAA": cs}, cfg, signals=sig)
        t = sim["trades"][0]
        self.assertEqual(t["reason"], "Trail")
        self.assertAlmostEqual(t["exit_px"], 121 * 0.9, places=2)


class CostsTest(unittest.TestCase):
    def test_charges_booked_per_fill_and_in_blotter(self):
        cs = mk([(100,) * 4] * 4)
        sig = {"AAA": [1, 0, 0, 0]}
        costs = dict(ZERO_COSTS, brokerage_pct=0.1, brokerage_cap=0)  # 0.1% each side
        sim = simulate({"AAA": cs}, base_cfg(capital=100000, costs=costs), signals=sig)
        t = sim["trades"][0]
        val = t["qty"] * 100.0
        self.assertAlmostEqual(t["charges"], val * 0.001 * 2, places=2)
        self.assertAlmostEqual(sim["total_charges"], t["charges"], places=2)
        self.assertAlmostEqual(t["net_pnl"], t["gross_pnl"] - t["charges"], places=2)

    def test_brokerage_cap_applies(self):
        self.assertAlmostEqual(
            bt._order_charges(1_000_000, "sell", dict(bt.DEFAULT_COSTS, stt_pct=0, exchange_pct=0,
                                                      sebi_pct=0, gst_pct=0, stamp_pct=0)),
            20.0)  # 0.03% of 10L = ₹300 → capped at ₹20

    def test_slippage_moves_fill_against_you(self):
        costs = dict(ZERO_COSTS, slippage_bps=100)  # 1%
        self.assertAlmostEqual(bt._slip(100, "buy", costs), 101.0)
        self.assertAlmostEqual(bt._slip(100, "sell", costs), 99.0)


class MetricsTest(unittest.TestCase):
    def _steady(self):
        # 100 → 110 in a clean staircase: no drawdown.
        n = 253
        return mk([(100 + i * 0.04,) * 4 for i in range(n)])

    def test_no_drawdown_on_monotonic_curve(self):
        cs = self._steady()
        sig = {"AAA": [1] + [0] * (len(cs) - 1)}
        sim = simulate({"AAA": cs}, base_cfg(), signals=sig)
        m = bt._metrics(sim)
        self.assertEqual(m["max_drawdown_pct"], 0.0)
        self.assertGreater(m["cagr_pct"], 0)
        self.assertEqual(m["trades"], 1)
        self.assertEqual(m["win_rate_pct"], 100.0)

    def test_drawdown_depth_and_duration(self):
        curve = [{"t": T0 + i * DAY, "eq": eq}
                 for i, eq in enumerate([100, 120, 90, 96, 120, 130])]
        sim = {"equity_curve": curve, "trades": [], "capital": 100,
               "invested_frac": [1] * 6, "total_traded": 0, "total_charges": 0}
        m = bt._metrics(sim)
        self.assertAlmostEqual(m["max_drawdown_pct"], 25.0)  # 120 → 90
        self.assertEqual(m["max_drawdown_days"], 3)          # peak day1 → recovery day4

    def test_monthly_table_and_per_symbol(self):
        cs = self._steady()
        sig = {"AAA": [1] + [0] * (len(cs) - 1)}
        sim = simulate({"AAA": cs}, base_cfg(), signals=sig)
        m = bt._metrics(sim)
        self.assertTrue(m["monthly_returns"])
        row = m["monthly_returns"][0]
        self.assertIn("year", row)
        self.assertEqual(len(row["months"]), 12)
        self.assertEqual(m["per_symbol"][0]["symbol"], "AAA")

    def test_benchmark_equal_weight_buy_and_hold(self):
        a = mk([(100,) * 4, (110,) * 4])   # +10%
        b = mk([(100,) * 4, (90,) * 4])    # −10%
        curve = bt._benchmark({"AAA": a, "BBB": b}, 100000)
        self.assertAlmostEqual(curve[0]["eq"], 100000, places=0)
        self.assertAlmostEqual(curve[-1]["eq"], 100000, places=0)  # +10 & −10 cancel


class CustomRulesTest(unittest.TestCase):
    def test_rsi_cross_rule_fires(self):
        closes = [100 - i for i in range(20)] + [80 + i * 2 for i in range(20)]
        cs = mk([(c,) * 4 for c in closes])
        sig = bt._custom_signals(
            cs, [{"ind": "rsi", "period": 14, "op": "cross_above", "target": "value", "value": 30}], [])
        self.assertIn(1, sig)

    def test_validation_rejects_bad_config(self):
        self.assertIsNotNone(bt.validate_config({"strategy": {"key": "nope"}, "symbols": ["A"]}))
        self.assertIsNotNone(bt.validate_config({"strategy": {"key": "custom", "buy": []}, "symbols": ["A"]}))
        self.assertIsNotNone(bt.validate_config({"strategy": {"key": "ema_cross"}}))
        self.assertIsNone(bt.validate_config({"strategy": {"key": "ema_cross"}, "symbols": ["A"]}))


class JobTest(unittest.TestCase):
    def _wait(self, run_id, deadline=15):
        t0 = time.time()
        while time.time() - t0 < deadline:
            snap = bt.snapshot(run_id)
            if snap["status"] in ("done", "error"):
                return snap
            time.sleep(0.05)
        self.fail("job never finished")

    def test_full_job_lifecycle(self):
        cs = mk([(100 + i,) * 4 for i in range(80)])
        run_id, err = bt.start(
            {"symbols": ["AAA"], "period": "1y", "capital": 500000,
             "strategy": {"key": "price_ema", "params": {"period": 10}},
             "costs": ZERO_COSTS},
            lambda name: ([], "test"), lambda s, p, i: cs)
        self.assertIsNone(err)
        snap = self._wait(run_id)
        self.assertEqual(snap["status"], "done", snap.get("error"))
        r = snap["result"]
        self.assertEqual(r["universe"], ["AAA"])
        self.assertTrue(r["equity_curve"])
        self.assertEqual(len(r["benchmark_curve"]), len(r["equity_curve"]))
        for key in ("cagr_pct", "sharpe", "sortino", "max_drawdown_pct", "exposure_pct",
                    "turnover_x", "expectancy", "monthly_returns", "per_symbol"):
            self.assertIn(key, r["stats"])

    def test_index_universe_resolution_and_no_data_error(self):
        run_id, err = bt.start(
            {"index": "NIFTY 50", "period": "1y",
             "strategy": {"key": "ema_cross"}},
            lambda name: ([{"symbol": "XXX"}], "test"), lambda s, p, i: [])
        self.assertIsNone(err)
        snap = self._wait(run_id)
        self.assertEqual(snap["status"], "error")

    def test_unknown_run_id(self):
        self.assertEqual(bt.snapshot("nope")["status"], "unknown")

    def test_strategies_meta_shape(self):
        meta = bt.strategies_meta()
        self.assertGreaterEqual(len(meta), 12)
        self.assertTrue(all("key" in m and "label" in m and "params" in m for m in meta))


if __name__ == "__main__":
    unittest.main()
