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


# A cut-down screener.in company page: the #quarters and #profit-loss tables in
# the shape the real page uses (label cell + one cell per period, oldest first).
SCREENER_HTML = """
<html><body>
<ul id="top-ratios">
  <li><span class="name">Stock P/E</span><span class="value"><span class="number">24.5</span></span></li>
  <li><span class="name">Current Price</span><span class="value">₹ <span class="number">1,320</span></span></li>
</ul>
<section id="quarters"><table>
  <tr><th>+</th><th>Jun 2024</th><th>Sep 2024</th><th>Dec 2024</th><th>Mar 2025</th><th>Jun 2025</th></tr>
  <tr><td>Sales&nbsp;+</td><td>1,000</td><td>1,100</td><td>1,150</td><td>1,200</td><td>1,300</td></tr>
  <tr><td>Net Profit&nbsp;+</td><td>100</td><td>110</td><td>120</td><td>130</td><td>150</td></tr>
  <tr><td>EPS in Rs</td><td>10</td><td>11</td><td>12</td><td>13</td><td>15</td></tr>
</table></section>
<section id="profit-loss"><table>
  <tr><th>+</th><th>Mar 2023</th><th>Mar 2024</th><th>Mar 2025</th></tr>
  <tr><td>Sales&nbsp;+</td><td>3,600</td><td>4,000</td><td>4,450</td></tr>
  <tr><td>EPS in Rs</td><td>36</td><td>40</td><td>46</td></tr>
</table></section>
</body></html>
"""


class ScreenerGrowthTest(unittest.TestCase):
    """Growth parsed from the page we already download for #top-ratios.

    This is what makes QoQ and real EPS growth affordable in a 200-symbol scan:
    zero extra requests. yfinance/EODHD carry neither in their per-symbol payload.
    """

    def setUp(self):
        try:
            import bs4  # noqa: F401
        except ImportError:
            self.skipTest("beautifulsoup4 not installed")
        self.g = f._parse_screener(SCREENER_HTML)

    def test_revenue_qoq_is_sequential_quarters(self):
        # 1300 vs 1200
        self.assertAlmostEqual(self.g["revenue_qoq_pct"], 8.3, places=1)

    def test_revenue_yoy_compares_the_same_quarter_last_year(self):
        # Jun 2025 (1300) vs Jun 2024 (1000) — four quarters back, not the
        # previous quarter, so Indian seasonality does not distort it.
        self.assertAlmostEqual(self.g["revenue_growth_pct"], 30.0, places=1)

    def test_profit_qoq_and_yoy(self):
        self.assertAlmostEqual(self.g["earnings_qoq_pct"], 15.4, places=1)   # 150 vs 130
        self.assertAlmostEqual(self.g["earnings_growth_pct"], 50.0, places=1)  # 150 vs 100

    def test_annual_eps_growth_year_on_year(self):
        # FY25 EPS 46 vs FY24 EPS 40
        self.assertAlmostEqual(self.g["eps_growth_yoy_pct"], 15.0, places=1)

    def test_ttm_eps_growth_needs_eight_quarters(self):
        # Only five quarters in the fixture — must be null, not a wrong number.
        self.assertIsNone(self.g["eps_ttm_growth_pct"])

    def test_bank_style_revenue_label_is_understood(self):
        # Banks/NBFCs say "Revenue" where others say "Sales".
        html = SCREENER_HTML.replace("Sales&nbsp;+", "Revenue&nbsp;+")
        g = f._parse_screener(html)
        self.assertAlmostEqual(g["revenue_qoq_pct"], 8.3, places=1)

    def test_missing_tables_yield_nulls_not_errors(self):
        g = f._parse_screener('<ul id="top-ratios"></ul>')
        for k in ("revenue_qoq_pct", "earnings_qoq_pct", "eps_growth_yoy_pct"):
            self.assertIsNone(g[k])


class GrowthMathTest(unittest.TestCase):
    def test_negative_base_returns_none_not_a_fake_percentage(self):
        # A swing from a loss to a profit is not "150% growth". Reporting one
        # would let a loss-making company pass a ">= 10% growth" screen.
        self.assertIsNone(f._growth(5, -10))
        self.assertIsNone(f._growth(5, 0))

    def test_ordinary_growth_and_contraction(self):
        self.assertEqual(f._growth(110, 100), 10.0)
        self.assertEqual(f._growth(80, 100), -20.0)

    def test_missing_operand_is_none(self):
        self.assertIsNone(f._growth(None, 100))
        self.assertIsNone(f._growth(100, None))


if __name__ == "__main__":
    unittest.main()
