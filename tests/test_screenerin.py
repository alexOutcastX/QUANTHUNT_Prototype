"""Unit tests for the screener.in HTML parsers (pure stdlib — no network)."""
import unittest

import screenerin as sc

SAMPLE = """
<section id="shareholding" class="card">
  <div class="responsive-holder">
    <table class="data-table responsive-text-nowrap">
      <thead><tr><th></th><th>Sep 2025</th><th>Jun 2026</th></tr></thead>
      <tbody>
        <tr><td class="text">Promoters<button class="button-plain">+</button></td><td>62.10%</td><td>63.15%</td></tr>
        <tr><td class="text">FIIs<button>+</button></td><td>8.20%</td><td>9.05%</td></tr>
        <tr><td class="text">DIIs</td><td>5.00%</td><td>6.42%</td></tr>
        <tr><td class="text">Government</td><td>0.00%</td><td>0.01%</td></tr>
        <tr><td class="text">Public</td><td>24.70%</td><td>21.37%</td></tr>
        <tr class="sub"><td class="text">No. of Shareholders</td><td>1,20,000</td><td>1,35,000</td></tr>
      </tbody>
    </table>
  </div>
</section>
<section id="balance-sheet" class="card">
  <table class="data-table">
    <thead><tr><th></th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
    <tbody>
      <tr><td class="text">Equity Capital</td><td>50</td><td>50</td></tr>
      <tr><td class="text">Reserves</td><td>1,200</td><td>1,480</td></tr>
      <tr><td class="text">Borrowings<button>+</button></td><td>310</td><td>0</td></tr>
      <tr><td class="text">Total Liabilities</td><td>2,000</td><td>2,340</td></tr>
    </tbody>
  </table>
</section>
<section id="profit-loss" class="card">
  <table class="data-table">
    <thead><tr><th></th><th>Mar 2024</th><th>Mar 2025</th><th>Mar 2026</th></tr></thead>
    <tbody>
      <tr><td class="text">Sales<button>+</button></td><td>1,000</td><td>1,250</td><td>1,600</td></tr>
      <tr><td class="text">Expenses<button>+</button></td><td>800</td><td>980</td><td>1,230</td></tr>
      <tr><td class="text">Operating Profit</td><td>200</td><td>270</td><td>370</td></tr>
      <tr><td class="text">Profit before tax</td><td>180</td><td>245</td><td>340</td></tr>
      <tr><td class="text">Net Profit<button>+</button></td><td>135</td><td>184</td><td>255</td></tr>
      <tr><td class="text">EPS in Rs</td><td>12.50</td><td>17.00</td><td>23.60</td></tr>
    </tbody>
  </table>
</section>
"""


class ShareholdingParseTest(unittest.TestCase):
    def test_latest_quarter(self):
        sh = sc.parse_shareholding(SAMPLE)
        self.assertEqual(sh["promoter"], 63.15)
        self.assertEqual(sh["fii"], 9.05)
        self.assertEqual(sh["dii"], 6.42)
        self.assertEqual(sh["public"], 21.37)
        self.assertEqual(sh["government"], 0.01)

    def test_empty_html_safe(self):
        self.assertEqual(sc.parse_shareholding("<html></html>"), {})


class BalanceParseTest(unittest.TestCase):
    def test_latest_year(self):
        b = sc.parse_balance(SAMPLE)
        self.assertEqual(b["reserves"], 1480.0)
        self.assertEqual(b["borrowings"], 0.0)
        self.assertEqual(b["equity_capital"], 50.0)
        self.assertEqual(b["total_liabilities"], 2340.0)

    def test_empty_html_safe(self):
        self.assertEqual(sc.parse_balance(""), {})


class ProfitLossParseTest(unittest.TestCase):
    def test_series_parsed_oldest_to_newest(self):
        pl = sc.parse_pl(SAMPLE)
        self.assertEqual(len(pl), 3)
        self.assertEqual(pl[0]["year"], "Mar 2024")
        self.assertEqual(pl[-1]["year"], "Mar 2026")
        self.assertEqual(pl[-1]["revenue"], 1600.0)
        self.assertEqual(pl[-1]["net_profit"], 255.0)
        self.assertEqual(pl[-1]["eps"], 23.60)

    def test_years_limit(self):
        self.assertEqual(len(sc.parse_pl(SAMPLE, years=2)), 2)

    def test_empty_html_safe(self):
        self.assertEqual(sc.parse_pl(""), [])
        self.assertEqual(sc.parse_pl("<html></html>"), [])


class FinancialsShapeTest(unittest.TestCase):
    def test_bad_symbol_never_raises(self):
        # No network in CI → _fetch returns "" → ok False, no exception.
        r = sc.financials("")
        self.assertFalse(r["ok"])
        self.assertEqual(r["shareholding"], {})
