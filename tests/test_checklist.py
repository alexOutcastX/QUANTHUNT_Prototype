"""Unit tests for checklist.build — the pure 10-point fundamental scorecard."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import checklist as cl  # noqa: E402


class TestHelpers(unittest.TestCase):
    def test_cagr(self):
        self.assertAlmostEqual(cl._cagr([100, 110, 121, 133.1]), 10.0, places=1)
        self.assertIsNone(cl._cagr([100]))
        self.assertIsNone(cl._cagr([-5, 10]))       # base not positive
        self.assertIsNone(cl._cagr([100, -10]))     # final not positive

    def test_yoy(self):
        self.assertAlmostEqual(cl._yoy([10, 20]), 100.0, places=1)
        self.assertIsNone(cl._yoy([0, 20]))         # base not positive
        self.assertIsNone(cl._yoy([5]))

    def test_verdict(self):
        self.assertEqual(cl._verdict(20, 15, 8), "good")
        self.assertEqual(cl._verdict(10, 15, 8), "ok")
        self.assertEqual(cl._verdict(3, 15, 8), "bad")
        self.assertEqual(cl._verdict(None, 15, 8), "na")
        # lower-is-better (PEG, PE, D/E)
        self.assertEqual(cl._verdict(0.8, 1.0, 2.0, higher_better=False), "good")
        self.assertEqual(cl._verdict(1.5, 1.0, 2.0, higher_better=False), "ok")
        self.assertEqual(cl._verdict(3.0, 1.0, 2.0, higher_better=False), "bad")


class TestBuild(unittest.TestCase):
    def _strong(self):
        return {
            "rev_series": [100, 130, 170, 220],     # ~30% CAGR
            "pat_series": [10, 14, 20, 28],         # ~41% CAGR
            "eps_series": [5, 7, 10, 14],           # ~41% CAGR, +40% yoy
            "pe": 22.0,
            "ocf_cr": 30.0,
            "net_profit_cr": 28.0,
            "total_debt_cr": 5.0,
            "debt_equity": 0.15,
            "ebit_cr": 40.0,
            "interest_cr": 4.0,                     # ICR 10x
        }

    def test_strong_company_scores_high(self):
        out = cl.build(self._strong())
        self.assertEqual(out["total"], 10)
        by = {i["key"]: i for i in out["items"]}
        self.assertEqual(by["sales_cagr"]["verdict"], "good")
        self.assertEqual(by["pat_cagr"]["verdict"], "good")
        self.assertEqual(by["eps_yoy"]["verdict"], "good")
        self.assertEqual(by["pe"]["verdict"], "good")        # 22 <= 25
        self.assertEqual(by["ocf"]["verdict"], "good")
        self.assertEqual(by["ocf_net"]["verdict"], "good")   # 30/28 ≈ 1.07x
        self.assertEqual(by["debt"]["verdict"], "good")      # D/E 0.15
        self.assertEqual(by["icr"]["verdict"], "good")       # 10x
        # PEG = 22 / 40 ≈ 0.55 → good
        self.assertEqual(by["peg"]["value"], "0.55")
        self.assertEqual(by["peg"]["verdict"], "good")
        self.assertGreaterEqual(out["passed"], 8)
        self.assertGreaterEqual(out["score"], 80)

    def test_weak_company(self):
        out = cl.build({
            "rev_series": [100, 98, 95, 92],   # shrinking → CAGR None (last>0 but declining) -> actually positive base/last
            "pat_series": [20, 10, 5, 2],
            "eps_series": [10, 6, 3, 1],       # -70% yoy
            "pe": 80.0,
            "ocf_cr": -15.0,
            "net_profit_cr": 2.0,
            "total_debt_cr": 500.0,
            "debt_equity": 3.5,
            "ebit_cr": 10.0,
            "interest_cr": 12.0,               # ICR 0.83
        })
        by = {i["key"]: i for i in out["items"]}
        self.assertEqual(by["eps_yoy"]["verdict"], "bad")
        self.assertEqual(by["pe"]["verdict"], "bad")
        self.assertEqual(by["ocf"]["verdict"], "bad")
        self.assertEqual(by["debt"]["verdict"], "bad")
        self.assertEqual(by["icr"]["verdict"], "bad")
        self.assertLess(out["score"], 40)

    def test_missing_data_is_na_not_error(self):
        out = cl.build({})
        self.assertEqual(len(out["items"]), 10)
        self.assertTrue(all(i["verdict"] == "na" for i in out["items"]))
        self.assertEqual(out["scored"], 0)
        self.assertIsNone(out["score"])

    def test_debt_free_is_good(self):
        out = cl.build({"total_debt_cr": 0})
        by = {i["key"]: i for i in out["items"]}
        self.assertEqual(by["debt"]["verdict"], "good")
        self.assertEqual(by["debt"]["value"], "Debt-free")

    def test_peg_na_when_eps_growth_not_positive(self):
        out = cl.build({"pe": 30, "eps_series": [10, 5]})  # negative yoy
        by = {i["key"]: i for i in out["items"]}
        self.assertEqual(by["peg"]["verdict"], "na")
        self.assertIsNone(by["peg"]["value"])

    def test_no_interest_burden_is_good(self):
        out = cl.build({"ebit_cr": 50, "interest_cr": 0})
        by = {i["key"]: i for i in out["items"]}
        self.assertEqual(by["icr"]["verdict"], "good")
        self.assertEqual(by["icr"]["value"], "—")


if __name__ == "__main__":
    unittest.main()
