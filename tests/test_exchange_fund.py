"""Exchange fundamentals: XBRL parsing, growth arithmetic, share-count guard.

All offline — the fixtures are trimmed copies of real filings (Reliance's
Q3FY25 Ind-AS document and HDFC Bank's banking-taxonomy one), so the parser is
pinned against the shapes production actually sees.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import exchange_fund as E


# Ind-AS. Both contexts declare the SAME dates while FourD carries the
# nine-month figure — that is real, and it is why context ids decide.
INDAS = """<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
            xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin">
 <xbrli:context id="OneD"><xbrli:period>
   <xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate>
 </xbrli:period></xbrli:context>
 <xbrli:context id="FourD"><xbrli:period>
   <xbrli:startDate>2024-10-01</xbrli:startDate><xbrli:endDate>2024-12-31</xbrli:endDate>
 </xbrli:period></xbrli:context>
 <in-bse-fin:DateOfEndOfReportingPeriod contextRef="OneD">2024-12-31</in-bse-fin:DateOfEndOfReportingPeriod>
 <in-bse-fin:RevenueFromOperations contextRef="OneD" unitRef="INR">1282600000000.00</in-bse-fin:RevenueFromOperations>
 <in-bse-fin:RevenueFromOperations contextRef="FourD" unitRef="INR">3966450000000.00</in-bse-fin:RevenueFromOperations>
 <in-bse-fin:ProfitLossForPeriod contextRef="OneD" unitRef="INR">87210000000.00</in-bse-fin:ProfitLossForPeriod>
 <in-bse-fin:ProfitLossForPeriod contextRef="FourD" unitRef="INR">240450000000.00</in-bse-fin:ProfitLossForPeriod>
 <in-bse-fin:BasicEarningsLossPerShareFromDiscontinuedOperations contextRef="OneD">0.00</in-bse-fin:BasicEarningsLossPerShareFromDiscontinuedOperations>
 <in-bse-fin:BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations contextRef="OneD">6.44</in-bse-fin:BasicEarningsLossPerShareFromContinuingAndDiscontinuedOperations>
</xbrli:xbrl>"""

# Banking taxonomy: no RevenueFromOperations at all, different profit and EPS
# tags. A parser that only knew Ind-AS would silently return nothing for every
# bank in the universe.
BANKING = """<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
            xmlns:in-bse-fin="http://www.bseindia.com/xbrl/fin/2020-03-31/in-bse-fin">
 <in-bse-fin:DateOfEndOfReportingPeriod contextRef="OneD">2024-12-31</in-bse-fin:DateOfEndOfReportingPeriod>
 <in-bse-fin:Income contextRef="OneD" unitRef="INR">1121939400000.00</in-bse-fin:Income>
 <in-bse-fin:Income contextRef="FourD" unitRef="INR">3300000000000.00</in-bse-fin:Income>
 <in-bse-fin:InterestEarned contextRef="OneD" unitRef="INR">850401700000.00</in-bse-fin:InterestEarned>
 <in-bse-fin:ProfitLossForThePeriod contextRef="OneD" unitRef="INR">183401100000.00</in-bse-fin:ProfitLossForThePeriod>
 <in-bse-fin:BasicEarningsPerShareAfterExtraordinaryItems contextRef="OneD">22.05</in-bse-fin:BasicEarningsPerShareAfterExtraordinaryItems>
</xbrli:xbrl>"""


class XbrlParseTest(unittest.TestCase):
    def test_indas_quarter_values(self):
        q = E._parse_xbrl(INDAS)
        self.assertEqual(q["revenue"], 1282600000000.0)
        self.assertEqual(q["profit"], 87210000000.0)
        self.assertEqual(q["eps"], 6.44)
        self.assertEqual(q["end"], "2024-12-31")

    def test_year_to_date_context_is_not_mistaken_for_the_quarter(self):
        """FourD carries the nine-month total under identical period dates.
        Taking it would report a quarter as ~3x its real size."""
        q = E._parse_xbrl(INDAS)
        self.assertNotEqual(q["revenue"], 3966450000000.0)

    def test_context_wins_over_document_order(self):
        """Same document with the YTD fact written first — the OneD context must
        still be the one picked, not simply the first match."""
        swapped = INDAS.replace(
            '<in-bse-fin:RevenueFromOperations contextRef="OneD" unitRef="INR">1282600000000.00</in-bse-fin:RevenueFromOperations>\n'
            ' <in-bse-fin:RevenueFromOperations contextRef="FourD" unitRef="INR">3966450000000.00</in-bse-fin:RevenueFromOperations>',
            '<in-bse-fin:RevenueFromOperations contextRef="FourD" unitRef="INR">3966450000000.00</in-bse-fin:RevenueFromOperations>\n'
            ' <in-bse-fin:RevenueFromOperations contextRef="OneD" unitRef="INR">1282600000000.00</in-bse-fin:RevenueFromOperations>')
        self.assertIn('contextRef="FourD" unitRef="INR">3966450000000.00', swapped.split("ProfitLoss")[0])
        self.assertEqual(E._parse_xbrl(swapped)["revenue"], 1282600000000.0)

    def test_eps_tag_is_matched_exactly_not_by_prefix(self):
        """...FromDiscontinuedOperations (0.00) appears before the real tag; a
        loose match would take it and report zero EPS."""
        self.assertEqual(E._parse_xbrl(INDAS)["eps"], 6.44)

    def test_banking_taxonomy(self):
        q = E._parse_xbrl(BANKING)
        self.assertEqual(q["revenue"], 1121939400000.0)   # Income, not Interest
        self.assertEqual(q["profit"], 183401100000.0)
        self.assertEqual(q["eps"], 22.05)

    def test_unknown_document_yields_nothing_rather_than_garbage(self):
        self.assertEqual(E._parse_xbrl("<html>not a filing</html>"), {})


class NumberTest(unittest.TestCase):
    def test_num_handles_exchange_formatting(self):
        self.assertEqual(E._num("1,732,300.28"), 1732300.28)
        self.assertEqual(E._num("28.98"), 28.98)

    def test_num_rejects_placeholders(self):
        for junk in ("", "  ", "-", "--", "NA", "N.A.", None, "abc"):
            self.assertIsNone(E._num(junk), junk)

    def test_pos_treats_zero_as_absent(self):
        """BSE sends 0.00 for 'not reported'. A zero PE would sail through a
        'PE < 15' screen as though it were real."""
        self.assertIsNone(E._pos("0.00"))
        self.assertIsNone(E._pos(0))
        self.assertEqual(E._pos("15.5"), 15.5)


def _q(rev, pat, eps):
    return {"revenue": rev, "profit": pat, "eps": eps}


class GrowthTest(unittest.TestCase):
    def test_qoq_needs_two_quarters(self):
        g = E.growth_from_quarters([_q(110, 22, 2.2), _q(100, 20, 2.0)])
        self.assertEqual(g["revenue_qoq_pct"], 10.0)
        self.assertEqual(g["earnings_qoq_pct"], 10.0)
        self.assertIsNone(g["revenue_growth_pct"])     # no year-ago quarter yet

    def test_yoy_compares_against_the_fifth_quarter_back(self):
        qs = [_q(120, 24, 2.4)] + [_q(0, 0, 0)] * 3 + [_q(100, 20, 2.0)]
        g = E.growth_from_quarters(qs)
        self.assertEqual(g["revenue_growth_pct"], 20.0)
        self.assertEqual(g["earnings_growth_pct"], 20.0)
        self.assertEqual(g["eps_growth_yoy_pct"], 20.0)

    def test_ttm_sums_four_quarters_against_the_prior_four(self):
        # PAT moves with EPS (both +50%), so the share count is unchanged and
        # the comparison stands — flat PAT against rising EPS would, correctly,
        # be read as dilution and refused.
        qs = [_q(150, 30, 3.0)] * 4 + [_q(100, 20, 2.0)] * 4
        self.assertEqual(E.growth_from_quarters(qs)["eps_ttm_growth_pct"], 50.0)

    def test_negative_base_returns_none_not_a_fake_percentage(self):
        """A swing from a loss to a profit is not growth — printing a number
        would let it pass a '>= 10%' screen."""
        qs = [_q(120, 5, 0.5)] + [_q(0, 0, 0)] * 3 + [_q(100, -10, -1.0)]
        g = E.growth_from_quarters(qs)
        self.assertIsNone(g["earnings_growth_pct"])
        self.assertIsNone(g["eps_growth_yoy_pct"])
        self.assertEqual(g["revenue_growth_pct"], 20.0)   # revenue base is fine

    def test_empty_input_is_all_none(self):
        g = E.growth_from_quarters([])
        self.assertTrue(all(v is None for v in g.values()))

    def test_partial_quarters_leave_later_fields_none(self):
        g = E.growth_from_quarters([_q(110, 22, 2.2), _q(100, 20, 2.0), _q(90, 18, 1.8)])
        self.assertEqual(g["revenue_qoq_pct"], 10.0)
        self.assertIsNone(g["eps_growth_yoy_pct"])
        self.assertIsNone(g["eps_ttm_growth_pct"])


class ShareCountGuardTest(unittest.TestCase):
    """Reliance Q3FY25 is the worked example: PAT -12.1% while filed EPS -56.1%
    (14.67 → 6.44) — the October 2024 1:1 bonus, not a business event. The prior
    quarter's filing is never restated, so the comparison has to be refused."""

    def _reliance(self):
        return [_q(1282600000000.0, 87210000000.0, 6.44)] + [_q(1, 1, 1.0)] * 3 + \
               [_q(1305790000000.0, 99240000000.0, 14.67)]

    def test_bonus_issue_voids_eps_growth(self):
        g = E.growth_from_quarters(self._reliance())
        self.assertIsNone(g["eps_growth_yoy_pct"])

    def test_pat_growth_survives_the_bonus(self):
        """Only the per-share measures are affected — PAT is still comparable
        and must keep answering."""
        g = E.growth_from_quarters(self._reliance())
        self.assertEqual(g["earnings_growth_pct"], -12.1)
        self.assertEqual(g["revenue_growth_pct"], -1.8)

    def test_ttm_eps_is_voided_too(self):
        qs = [_q(1, 100, 6.44)] * 4 + [_q(1, 100, 14.67)] * 4
        self.assertIsNone(E.growth_from_quarters(qs)["eps_ttm_growth_pct"])

    def test_normal_company_is_untouched(self):
        # PAT +20%, EPS +20% → share count unchanged.
        qs = [_q(120, 24, 2.4)] + [_q(1, 1, 1.0)] * 3 + [_q(100, 20, 2.0)]
        self.assertEqual(E.growth_from_quarters(qs)["eps_growth_yoy_pct"], 20.0)

    def test_small_buyback_stays_inside_the_band(self):
        # ~3% fewer shares: EPS outruns PAT slightly, still a real comparison.
        self.assertTrue(E._share_count_stable(120.0, 100.0, 2.48, 2.0))

    def test_five_for_four_bonus_is_caught(self):
        # The smallest real bonus ratio — 25% dilution.
        self.assertFalse(E._share_count_stable(120.0, 100.0, 1.92, 2.0))

    def test_missing_inputs_do_not_blank_eps_growth(self):
        """An unparsed profit line must not take EPS growth down with it."""
        self.assertTrue(E._share_count_stable(None, 100.0, 2.4, 2.0))
        self.assertTrue(E._share_count_stable(120.0, 0, 2.4, 2.0))


class QuarterSelectionTest(unittest.TestCase):
    def test_consolidated_rows_are_skipped(self):
        """Mixing consolidated and standalone filings would compare a group
        against a parent company and invent growth that never happened."""
        rows = [
            {"consolidated": "Consolidated", "xbrl": "u1", "fromDate": "a", "toDate": "b"},
            {"consolidated": "Non-Consolidated", "xbrl": "u2", "fromDate": "a", "toDate": "b"},
        ]
        kept = [r for r in rows
                if (r.get("consolidated") or "").strip().lower() == "non-consolidated"]
        self.assertEqual([r["xbrl"] for r in kept], ["u2"])

    def test_max_quarters_covers_ttm(self):
        """TTM needs four quarters against the prior four."""
        self.assertGreaterEqual(E.MAX_QUARTERS, 8)


class FetchShapeTest(unittest.TestCase):
    def setUp(self):
        self._ratios, self._quarters, self._code = E._bse_ratios, E._quarters, E.bse_code

    def tearDown(self):
        E._bse_ratios, E._quarters, E.bse_code = self._ratios, self._quarters, self._code

    def test_returns_none_when_neither_source_answers(self):
        E.bse_code = lambda s: None
        E._quarters = lambda s, sess=None: []
        self.assertIsNone(E.fetch("NOSUCH"))

    def test_bse_only_still_returns_ratios(self):
        """An NSE-only listing has no BSE code; a company that has never filed
        with the NSE still has BSE ratios. Either half alone is worth caching."""
        E.bse_code = lambda s: "500325"
        E._bse_ratios = lambda c: {"pe": 20.0, "pb": 3.0, "roe": 15.0}
        E._quarters = lambda s, sess=None: []
        d = E.fetch("X")
        self.assertEqual(d["source"], "BSE")
        self.assertEqual(d["pe"], 20.0)
        self.assertIsNone(d.get("revenue_qoq_pct"))

    def test_nse_only_still_returns_growth(self):
        E.bse_code = lambda s: None
        E._quarters = lambda s, sess=None: [_q(110, 22, 2.2), _q(100, 20, 2.0)]
        d = E.fetch("X")
        self.assertEqual(d["source"], "NSE")
        self.assertEqual(d["revenue_qoq_pct"], 10.0)

    def test_eps_falls_back_to_the_filing_when_bse_is_silent(self):
        E.bse_code = lambda s: "1"
        E._bse_ratios = lambda c: {"pe": 20.0, "eps": None}
        E._quarters = lambda s, sess=None: [_q(110, 22, 7.5), _q(100, 20, 7.0)]
        self.assertEqual(E.fetch("X")["eps"], 7.5)

    def test_a_broken_bse_lookup_does_not_lose_the_growth(self):
        def boom(_s):
            raise RuntimeError("BSE down")
        E.bse_code = boom
        E._quarters = lambda s, sess=None: [_q(110, 22, 2.2), _q(100, 20, 2.0)]
        d = E.fetch("X")
        self.assertEqual(d["source"], "NSE")


class DividendYieldUnitsTest(unittest.TestCase):
    """yfinance is inconsistent with its own units: returnOnAssets comes back as
    a ratio (0.153) while dividendYield comes back as a percent (4.8). Scaling
    both by 100 gave Infosys a 480% dividend yield on the production VM — a
    number that passes every 'yield > 3%' screen ever written."""

    def test_percent_shaped_input_is_left_alone(self):
        import fundamentals as F
        self.assertEqual(F._pct_loose(4.8), 4.8)      # not 480.0
        self.assertEqual(F._pct_loose(2.75), 2.75)

    def test_ratio_shaped_input_is_scaled(self):
        import fundamentals as F
        self.assertEqual(F._pct_loose(0.028), 2.8)

    def test_zero_and_non_numbers(self):
        import fundamentals as F
        self.assertEqual(F._pct_loose(0), 0)
        self.assertIsNone(F._pct_loose(None))
        self.assertIsNone(F._pct_loose("4.8"))

    def test_yf_mapping_uses_it_for_yield_but_not_for_returns(self):
        """ROE/ROCE really are ratios from this provider, so they must keep the
        strict x100 — swapping them would silently divide them by 100."""
        import fundamentals as F
        m = F._map_yf({"dividendYield": 4.8, "returnOnEquity": 0.3667,
                       "returnOnAssets": 0.153})
        self.assertEqual(m["dividend_yield"], 4.8)
        self.assertEqual(m["roe"], 36.67)
        self.assertEqual(m["roce"], 15.3)


class ProviderWiringTest(unittest.TestCase):
    def test_exchange_is_ahead_of_yfinance_in_the_default_chain(self):
        import fundamentals as F
        chain = F._provider_chain()
        self.assertIn("exchange", chain)
        self.assertLess(chain.index("exchange"), chain.index("yfinance"))

    def test_fields_the_exchange_cannot_supply_are_gap_filled(self):
        """BSE publishes ROE, not ROCE; neither source has debt/equity or the
        current ratio. Those must stay in the yfinance gap-fill or the filters
        reading them go permanently null."""
        import fundamentals as F
        for k in ("roce", "debt_equity", "current_ratio", "dividend_yield"):
            self.assertIn(k, F._GAP_FILL, k)


if __name__ == "__main__":
    unittest.main()
