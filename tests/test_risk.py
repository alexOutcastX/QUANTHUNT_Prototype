"""Unit tests for portfolio risk analytics (pure maths, no network)."""
import importlib
import math
import unittest


class RiskTest(unittest.TestCase):
    def setUp(self):
        import risk
        self.r = importlib.reload(risk)

    def test_returns(self):
        out = self.r.returns([100, 110, 121])
        self.assertEqual(len(out), 2)
        self.assertAlmostEqual(out[0], 0.1)
        self.assertAlmostEqual(out[1], 0.1)
        # zero / None gaps are skipped without corrupting the chain
        gap = self.r.returns([100, None, 110])
        self.assertEqual(len(gap), 1)
        self.assertAlmostEqual(gap[0], 0.1)

    def test_stdev_mean(self):
        self.assertAlmostEqual(self.r.mean([1, 2, 3]), 2.0)
        self.assertAlmostEqual(self.r.stdev([2, 4, 4, 4, 5, 5, 7, 9], sample=False), 2.0)

    def test_volatility_annualises(self):
        rets = [0.01, -0.01, 0.02, -0.02, 0.0]
        daily = self.r.stdev(rets)
        self.assertAlmostEqual(self.r.volatility(rets), daily * math.sqrt(252))

    def test_historical_var(self):
        rets = [(-0.05 + 0.001 * i) for i in range(100)]  # -0.05 .. 0.049
        var = self.r.historical_var(rets, 0.95)
        # 5th percentile of a linear ramp from -0.05 sits near -0.045 => ~0.045 loss
        self.assertTrue(0.04 <= var <= 0.05)

    def test_var_needs_enough_data(self):
        self.assertIsNone(self.r.historical_var([0.01, -0.01], 0.95))
        self.assertIsNone(self.r.parametric_var([0.01, -0.01], 0.95))

    def test_beta_of_self_is_one(self):
        rets = [0.01, -0.02, 0.015, -0.005, 0.02]
        self.assertAlmostEqual(self.r.beta(rets, rets), 1.0, places=4)

    def test_beta_scaled(self):
        idx = [0.01, -0.02, 0.015, -0.005, 0.02]
        asset = [2 * x for x in idx]
        self.assertAlmostEqual(self.r.beta(asset, idx), 2.0, places=4)

    def test_correlation(self):
        a = [0.01, -0.02, 0.015, -0.005, 0.02]
        self.assertAlmostEqual(self.r.correlation(a, a), 1.0, places=4)
        self.assertAlmostEqual(self.r.correlation(a, [-x for x in a]), -1.0, places=4)

    def test_max_drawdown(self):
        dd = self.r.max_drawdown([100, 120, 90, 110, 60, 80])
        # peak 120 -> trough 60 = 50% drawdown
        self.assertAlmostEqual(dd["mdd"], 0.5, places=4)
        self.assertEqual(dd["peak"], 120)
        self.assertEqual(dd["trough"], 60)

    def test_portfolio_series_weights(self):
        holdings = [{"symbol": "A", "qty": 10}, {"symbol": "B", "qty": 5}]
        hist = {"A": [10, 11, 12], "B": [20, 20, 20]}
        equity, weights = self.r.portfolio_series(holdings, hist)
        self.assertEqual(len(equity), 3)
        # last: A 10*12=120, B 5*20=100 => total 220
        self.assertAlmostEqual(weights["A"], round(120 / 220, 4))
        self.assertAlmostEqual(weights["B"], round(100 / 220, 4))

    def test_analyze_full(self):
        holdings = [{"symbol": "A", "qty": 1}, {"symbol": "B", "qty": 1}]
        # 60 days of gently trending prices so there is enough history for VaR.
        a = [100 + i + (i % 5) for i in range(60)]
        b = [50 + 0.5 * i - (i % 3) for i in range(60)]
        idx = [200 + i for i in range(60)]
        rep = self.r.analyze(holdings, {"A": a, "B": b}, index_prices=idx, conf=0.95)
        self.assertTrue(rep["ok"])
        self.assertIn("A", rep["weights"])
        self.assertIsNotNone(rep["volatility_annual"])
        self.assertIsNotNone(rep["drawdown"])
        self.assertEqual(rep["days"], 59)

    def test_analyze_insufficient(self):
        rep = self.r.analyze([{"symbol": "A", "qty": 1}], {"A": [100]}, conf=0.95)
        self.assertFalse(rep["ok"])


if __name__ == "__main__":
    unittest.main()
