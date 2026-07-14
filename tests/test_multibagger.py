"""Unit tests for the multibagger-potential scoring engine (pure stdlib)."""
import unittest

import multibagger as mb


STRONG_SMALLCAP = {
    "mcap_cr": 1800,
    "revenue_growth_pct": 28,
    "earnings_growth_pct": 35,
    "roe_pct": 24,
    "op_margin_pct": 18,
    "debt_equity": 0.12,
    "current_ratio": 2.4,
    "fcf_cr": 120,
    "insider_pct": 62,
    "institution_pct": 8,
    "pe": 22,
    "peg": 0.8,
    "vs_200dma_pct": 6,
    "pct_from_high_pct": -8,
    "price_cagr_3y_pct": 32,
}

WEAK_LARGECAP = {
    "mcap_cr": 450000,
    "revenue_growth_pct": 4,
    "earnings_growth_pct": -6,
    "roe_pct": 7,
    "op_margin_pct": 5,
    "debt_equity": 1.9,
    "current_ratio": 0.7,
    "fcf_cr": -800,
    "insider_pct": 10,
    "institution_pct": 55,
    "pe": 70,
    "peg": 5.2,
    "vs_200dma_pct": -18,
    "pct_from_high_pct": -65,
    "price_cagr_3y_pct": -4,
}


class MultibaggerScoreTest(unittest.TestCase):
    def test_strong_smallcap_scores_high(self):
        r = mb.score(STRONG_SMALLCAP)
        self.assertGreaterEqual(r["score"], 75)
        self.assertEqual(r["tier"], "HIGH POTENTIAL")
        self.assertEqual(r["coverage_pct"], 100)
        self.assertTrue(any("Small base" in s for s in r["strengths"]))
        self.assertEqual(r["red_flags"], [])

    def test_weak_largecap_scores_low(self):
        r = mb.score(WEAK_LARGECAP)
        self.assertLess(r["score"], 40)
        self.assertIn(r["tier"], ("WEAK", "LOW"))
        self.assertTrue(any("large base" in f or "cr company" in f for f in r["red_flags"]))
        self.assertTrue(any("leverage" in f.lower() for f in r["red_flags"]))

    def test_probability_is_bounded_and_monotonic(self):
        hi = mb.score(STRONG_SMALLCAP)["probability_pct"]
        lo = mb.score(WEAK_LARGECAP)["probability_pct"]
        self.assertGreater(hi, lo)
        for p in (hi, lo):
            self.assertGreaterEqual(p, 2)
            self.assertLessEqual(p, 70)

    def test_empty_metrics_do_not_crash(self):
        r = mb.score({})
        self.assertEqual(r["score"], 0)
        self.assertEqual(r["coverage_pct"], 0)
        self.assertEqual(len(r["pillars"]), len(mb.PILLARS))
        self.assertTrue(all(p["score"] is None for p in r["pillars"]))
        # Every checklist item is unknown, none silently pass/fail.
        self.assertTrue(all(c["state"] == "unknown" for c in r["checklist"]))
        self.assertTrue(any("Growth data unavailable" in f for f in r["red_flags"]))

    def test_partial_metrics_score_covered_pillars_only(self):
        r = mb.score({"mcap_cr": 900, "roe_pct": 30, "op_margin_pct": 25})
        # size (18) + quality (18) covered out of 100 -> 36% coverage
        self.assertEqual(r["coverage_pct"], 36)
        self.assertGreaterEqual(r["score"], 90)  # both covered pillars are strong

    def test_checklist_states(self):
        r = mb.score(STRONG_SMALLCAP)
        by_label = {c["label"]: c["state"] for c in r["checklist"]}
        self.assertEqual(by_label["Small-cap base (< ₹5,000 cr)"], "pass")
        self.assertEqual(by_label["Debt/equity < 0.5"], "pass")
        r2 = mb.score(WEAK_LARGECAP)
        by_label2 = {c["label"]: c["state"] for c in r2["checklist"]}
        self.assertEqual(by_label2["Small-cap base (< ₹5,000 cr)"], "fail")
        self.assertEqual(by_label2["Price above 200-DMA (uptrend)"], "fail")

    def test_pillar_weights_sum_to_100(self):
        self.assertEqual(sum(w for _, _, w, _ in mb.PILLARS), 100)


if __name__ == "__main__":
    unittest.main()
