"""Growth fields must reach the screener's fundamentals payload.

The Custom screener has offered "Revenue Growth" and "Earnings Growth" filters
for a while, but /fundamentals/bulk never carried those keys. A range filter
compares against a null and returns false for every row, so the filters looked
like they worked and quietly matched nothing. These tests pin the keys to the
payload so that cannot regress silently.
"""
import unittest

import fundamentals as f


class GrowthFieldsTest(unittest.TestCase):
    def test_yfinance_ratios_become_percentages(self):
        row = f._map_yf({"revenueGrowth": 0.275, "earningsGrowth": 0.41})
        self.assertEqual(row["revenue_growth_pct"], 27.5)
        self.assertEqual(row["earnings_growth_pct"], 41.0)

    def test_eodhd_quarterly_yoy_becomes_percentages(self):
        row = f._map_eodhd({"Highlights": {"QuarterlyRevenueGrowthYOY": 0.182,
                                           "QuarterlyEarningsGrowthYOY": -0.05},
                            "General": {}, "Valuation": {}})
        self.assertEqual(row["revenue_growth_pct"], 18.2)
        self.assertEqual(row["earnings_growth_pct"], -5.0)

    def test_negative_growth_survives(self):
        # A contraction must read as a real negative, not get dropped to null —
        # "earnings growth < 0" is a legitimate screen.
        row = f._map_yf({"earningsGrowth": -0.23})
        self.assertEqual(row["earnings_growth_pct"], -23.0)

    def test_missing_growth_is_null_not_zero(self):
        # Zero would silently pass a "> -5%" screen and look like flat growth.
        row = f._map_yf({})
        self.assertIsNone(row["revenue_growth_pct"])
        self.assertIsNone(row["earnings_growth_pct"])

    def test_both_providers_agree_on_the_key_names(self):
        yf = f._map_yf({"revenueGrowth": 0.1})
        eo = f._map_eodhd({"Highlights": {"QuarterlyRevenueGrowthYOY": 0.1},
                           "General": {}, "Valuation": {}})
        for k in ("revenue_growth_pct", "earnings_growth_pct"):
            self.assertIn(k, yf)
            self.assertIn(k, eo)

    def test_growth_keys_are_declared_in_FIELDS(self):
        # FIELDS is the documented schema for this payload; a key the mappers
        # emit but FIELDS omits is how the screener/API drift apart.
        self.assertIn("revenue_growth_pct", f.FIELDS)
        self.assertIn("earnings_growth_pct", f.FIELDS)

    def test_no_unpopulated_growth_key_is_advertised(self):
        # Guard against re-introducing the original bug from the other side:
        # FIELDS must not promise anything the mappers never set.
        row = f._map_yf({})
        for key in f.FIELDS:
            if "growth" in key:
                self.assertIn(key, row, f"FIELDS advertises {key} but no mapper emits it")


if __name__ == "__main__":
    unittest.main()
