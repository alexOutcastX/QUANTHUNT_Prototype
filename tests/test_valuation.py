"""Valuation engine: the arithmetic, and the cases where it must refuse.

The refusals matter more than the maths here. A valuation section that prints a
confident number for a loss-making company is worse than one that prints
nothing, because a screen will act on it.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import valuation as V


# A profitable, cash-generating, dividend-paying company.
GOOD = dict(
    price=3900, eps=138.71, pe=28.1, pb=12.0, market_cap_cr=830405,
    fcf_cr=42000, total_debt_cr=8000, cash_cr=45000, revenue_cr=240000,
    op_income_cr=60000, dividend_yield_pct=3.2, earnings_growth_pct=10.0,
    fin_years=[{"net_income": 46000}, {"net_income": 42000}, {"net_income": 38300},
               {"net_income": 33400}, {"net_income": 32400}],
)


class GrowthTest(unittest.TestCase):
    def test_cagr_preferred_over_single_year(self):
        g, basis = V.earnings_growth(GOOD["fin_years"], 10.0)
        self.assertIn("CAGR", basis)
        # 32400 → 46000 over 4 years ≈ 9.2%
        self.assertAlmostEqual(g, 0.092, places=2)

    def test_falls_back_to_yoy_without_a_series(self):
        g, basis = V.earnings_growth([], 12.0)
        self.assertAlmostEqual(g, 0.12, places=4)
        self.assertIn("YoY", basis)

    def test_growth_is_capped(self):
        g, basis = V.earnings_growth([], 80.0)
        self.assertEqual(g, V.MAX_GROWTH)
        self.assertIn("capped", basis)

    def test_shrinking_earnings_floor_at_zero_not_negative(self):
        """A negative rate in a DCF asserts the company winds itself down —
        a far stronger claim than a few bad years support."""
        g, _ = V.earnings_growth([], -30.0)
        self.assertEqual(g, 0.0)

    def test_loss_making_series_is_not_used_for_cagr(self):
        g, basis = V.earnings_growth(
            [{"net_income": -100}, {"net_income": -200}, {"net_income": -50}], None)
        self.assertIsNone(g)
        self.assertIn("no usable", basis)

    def test_no_inputs_at_all(self):
        self.assertEqual(V.earnings_growth(None, None), (None, "no usable earnings history"))


class ModelTest(unittest.TestCase):
    def test_dcf_grows_with_growth(self):
        lo = V.dcf_per_share(1000, 100, 0.05)
        hi = V.dcf_per_share(1000, 100, 0.15)
        self.assertGreater(hi, lo)

    def test_dcf_refuses_negative_cash_flow(self):
        self.assertIsNone(V.dcf_per_share(-500, 100, 0.10))

    def test_dcf_refuses_when_discount_below_terminal(self):
        """The Gordon denominator would go negative and hand back a
        confident-looking negative value."""
        self.assertIsNone(V.dcf_per_share(1000, 100, 0.05, discount=0.03, terminal=0.04))

    def test_implied_growth_round_trips_against_the_dcf(self):
        """The reverse DCF must invert the forward one: price the DCF at a known
        growth, then recover that growth from the price."""
        px = V.dcf_per_share(1000, 100, 0.11)
        got = V.implied_growth(px, 1000, 100)
        self.assertAlmostEqual(got, 0.11, places=3)

    def test_implied_growth_none_when_price_below_no_growth_value(self):
        cheap = V.dcf_per_share(1000, 100, 0.0) * 0.5
        self.assertIsNone(V.implied_growth(cheap, 1000, 100))

    def test_graham_number(self):
        # sqrt(22.5 * 10 * 100) = 150
        self.assertAlmostEqual(V.graham_number(10, 100), 150.0, places=6)

    def test_graham_refuses_losses_and_negative_book(self):
        self.assertIsNone(V.graham_number(-5, 100))
        self.assertIsNone(V.graham_number(10, -100))

    def test_earnings_power_value_ignores_growth(self):
        self.assertAlmostEqual(V.earnings_power_value(13), 100.0, places=4)
        self.assertIsNone(V.earnings_power_value(-1))

    def test_dividend_model_skips_token_payers(self):
        self.assertIsNone(V.dividend_discount(1000, 0.2, 0.05))
        self.assertIsNotNone(V.dividend_discount(1000, 3.0, 0.05))

    def test_dividend_model_refuses_growth_above_discount(self):
        self.assertIsNone(V.dividend_discount(1000, 3.0, 0.99))


class FairValueTest(unittest.TestCase):
    def test_floor_methods_do_not_drag_the_midpoint(self):
        """Graham and EPV assume NO growth by construction. Averaging them with
        the DCF would call every quality compounder expensive — the midpoint
        must come from the growth methods alone."""
        r = V.value(**GOOD)
        fair = r["fair_value"]
        growth_vals = [e["value"] for e in r["estimates"]
                       if e["kind"] == V.KIND_GROWTH and e["value"] is not None]
        floor_vals = [e["value"] for e in r["estimates"]
                      if e["kind"] == V.KIND_FLOOR and e["value"] is not None]
        self.assertTrue(growth_vals and floor_vals)
        self.assertEqual(fair["methods"], len(growth_vals))
        self.assertGreaterEqual(fair["mid"], min(growth_vals))
        self.assertLessEqual(fair["mid"], max(growth_vals))
        self.assertEqual(fair["floor"], max(floor_vals))

    def test_every_estimate_carries_its_inputs_or_a_reason(self):
        for e in V.value(**GOOD)["estimates"]:
            self.assertTrue(e["note"], e["method"])
            if e["value"] is not None:
                self.assertTrue(e["inputs"], e["method"])

    def test_assumptions_are_returned(self):
        a = V.value(**GOOD)["assumptions"]
        self.assertEqual(a["discount_rate_pct"], 13.0)
        self.assertEqual(a["horizon_years"], V.DCF_YEARS)


class VerdictTest(unittest.TestCase):
    def test_deep_value_reads_undervalued(self):
        r = V.value(price=300, eps=60, pe=5.0, pb=0.8, market_cap_cr=6000,
                    fcf_cr=900, total_debt_cr=500, cash_cr=800, revenue_cr=12000,
                    op_income_cr=1200, dividend_yield_pct=5.0, earnings_growth_pct=8.0,
                    fin_years=[{"net_income": 1200}, {"net_income": 1100},
                               {"net_income": 950}, {"net_income": 900}])
        self.assertEqual(r["verdict"], "undervalued")
        self.assertTrue(any("below the no-growth floor" in x for x in r["reasons"]))

    def test_loss_maker_is_unrated_not_fairly_valued(self):
        """No method could value it. Landing on 'fairly valued' would dress
        absence of evidence as a finding."""
        r = V.value(price=120, eps=-8, pb=3.0, market_cap_cr=4000, fcf_cr=-300,
                    total_debt_cr=2000, cash_cr=100,
                    fin_years=[{"net_income": -200}, {"net_income": -150}])
        self.assertEqual(r["verdict"], "unrated")
        self.assertIsNone(r["fair_value"])

    def test_empty_input_is_unrated(self):
        r = V.value()
        self.assertEqual(r["verdict"], "unrated")
        self.assertIsNone(r["fair_value"])

    def test_caveats_always_present(self):
        self.assertTrue(V.value()["caveats"])
        self.assertTrue(V.value(**GOOD)["caveats"])


class MultiplesTest(unittest.TestCase):
    def test_enterprise_value_adds_debt_and_removes_cash(self):
        m = V.value(**GOOD)["multiples"]
        self.assertAlmostEqual(m["ev_cr"], 830405 + 8000 - 45000, places=2)

    def test_yields_are_reciprocals(self):
        m = V.value(**GOOD)["multiples"]
        self.assertAlmostEqual(m["earnings_yield_pct"], 100.0 / 28.1, places=1)
        self.assertAlmostEqual(m["fcf_yield_pct"], 42000 / 830405 * 100, places=1)

    def test_peg_uses_the_growth_actually_used(self):
        r = V.value(**GOOD)
        g = r["growth"]["used_pct"]
        self.assertAlmostEqual(r["multiples"]["peg"], 28.1 / g, places=1)

    def test_no_peg_without_growth(self):
        r = V.value(price=100, eps=10, pe=10.0)
        self.assertIsNone(r["multiples"]["peg"])

    def test_nan_and_bool_inputs_are_rejected(self):
        r = V.value(price=float("nan"), eps=True, pe=float("inf"))
        self.assertIsNone(r["price"])
        self.assertIsNone(r["multiples"]["pe"])


class RouteWiringTest(unittest.TestCase):
    def test_report_route_exposes_valuation(self):
        try:
            import server
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        self.assertIs(server._valuation, V)


if __name__ == "__main__":
    unittest.main()
