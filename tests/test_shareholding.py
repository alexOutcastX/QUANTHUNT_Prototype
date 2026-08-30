"""The shareholding panel, and why every cell in it was an em-dash.

NSE's corporate-share-holdings-master feed carries a date, promoter-and-
promoter-group, public, employee trusts and depository receipts. The parser was
reading `promoter` / `publicShareholding` / `fii` / `dii` / `pledge` — names
that endpoint has never served. So the panel showed a correct DATE above five
dashes, which reads as "no data for this company" rather than "this code is
asking for the wrong keys".

Two separate defects, and only the first is a typo:

  * promoter and public are there, under `pr_and_prgrp` and `public_val`.
  * FII, DII and promoter pledge are NOT there, under any key. Three labelled
    cells that could never fill, for every company, always. They are in the
    XBRL document each row links to, which is a fetch and a parse of its own —
    so the panel now shows what the feed has and says where the rest lives.
"""
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import corporate as _corp

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


# One real row, trimmed, exactly as NSE served it for RELIANCE.
NSE_ROW = {
    "broadcastDate": "16-JUL-2026 19:24:44",
    "date": "30-JUN-2026",
    "employeeTrusts": "0",
    "name": "Reliance Industries Limited",
    "pr_and_prgrp": "50.48",
    "public_val": "49.52",
    "recordId": "211570",
    "submissionDate": "16-JUL-2026",
    "symbol": "RELIANCE",
    "underlyingDrs": None,
    "xbrl": "https://nsearchives.nseindia.com/corporate/xbrl/SHP_1694620_WEB.xml",
}


class ParseTest(unittest.TestCase):
    def setUp(self):
        self.c = importlib.reload(_corp)

    def test_it_reads_the_keys_nse_actually_serves(self):
        """The whole bug: 50.48 and 49.52 were in the payload the entire time."""
        got = self.c.parse_shareholding([NSE_ROW])["latest"]
        self.assertEqual(got["promoter"], 50.48)
        self.assertEqual(got["public"], 49.52)
        self.assertEqual(got["date"], "30-JUN-2026")

    def test_a_zero_holding_is_zero_and_not_missing(self):
        """HDFCBANK really is promoter 0 / public 100. `or` would have turned
        that zero into a dash."""
        got = self.c.parse_shareholding(
            [dict(NSE_ROW, pr_and_prgrp="0", public_val="100")])["latest"]
        self.assertEqual(got["promoter"], 0.0)
        self.assertEqual(got["public"], 100.0)

    def test_it_carries_the_link_to_the_rest(self):
        got = self.c.parse_shareholding([NSE_ROW])["latest"]
        self.assertTrue(got["xbrl"].endswith(".xml"))
        self.assertEqual(got["name"], "Reliance Industries Limited")

    def test_it_no_longer_claims_fields_the_feed_does_not_have(self):
        got = self.c.parse_shareholding([NSE_ROW])["latest"]
        for gone in ("fii", "dii", "pledge"):
            self.assertNotIn(gone, got, gone)

    def test_the_documented_key_names_still_work(self):
        """If NSE ever serves the names its own docs use, they still parse."""
        got = self.c.parse_shareholding(
            [{"date": "x", "promoter": "55.5", "publicShareholding": "44.5"}])["latest"]
        self.assertEqual(got["promoter"], 55.5)
        self.assertEqual(got["public"], 44.5)

    def test_an_empty_or_odd_payload_is_no_data_rather_than_a_crash(self):
        for raw in ([], None, {}, {"data": []}, "error", [None], [7]):
            out = self.c.parse_shareholding(raw)
            self.assertIn("latest", out)


class PanelTest(unittest.TestCase):
    """Three screens rendered the phantom fields. All three had to change."""

    def test_the_type_only_declares_what_the_feed_carries(self):
        api = _read("mobile", "src", "api.ts")
        block = api.split("export type Shareholding = {", 1)[1].split("};", 1)[0]
        # Field names, not the comment that explains where they went.
        fields = [l.split(":", 1)[0].strip().rstrip("?")
                  for l in block.splitlines()
                  if ":" in l and not l.strip().startswith(("//", "*", "/*"))]
        for gone in ("fii", "dii", "pledge"):
            self.assertNotIn(gone, fields, gone)
        for kept in ("promoter", "public", "trusts", "drs", "xbrl"):
            self.assertIn(kept, block, kept)

    def test_the_desk_corporate_card_drops_the_empty_cells(self):
        src = _read("mobile", "src", "screens", "CorporateScreen.tsx")
        self.assertNotIn('label="FII"', src)
        self.assertNotIn('label="DII"', src)
        self.assertNotIn('label="Pledge"', src)
        self.assertIn('label="Promoter"', src)
        self.assertIn('label="Public"', src)

    def test_the_shareholders_screen_charts_only_real_bars(self):
        src = _read("mobile", "src", "screens", "EntityGraphScreen.tsx")
        rows = src.split("function SharePattern", 1)[1].split("].filter", 1)[0]
        self.assertIn("k: 'Promoters'", rows)
        self.assertIn("k: 'Public'", rows)
        self.assertNotIn("k: 'FII'", rows)
        self.assertNotIn("k: 'DII'", rows)

    def test_the_report_takes_each_row_from_the_source_that_has_it(self):
        """Promoter and public from the filing; the institutional split from
        screener.in, which is the only source that carries it."""
        src = _read("mobile", "src", "screens", "AnalysisScreen.tsx")
        self.assertIn("v={num(d.hold.promoter ?? sh?.promoter ?? null, 2, '%')}", src)
        self.assertIn("v={num(sh?.fii ?? null, 2, '%')}", src)
        self.assertIn("v={num(sh?.dii ?? null, 2, '%')}", src)
        self.assertNotIn("d.hold.fii", src)
        self.assertNotIn("d.hold.pledge", src)

    def test_every_panel_says_where_the_rest_lives(self):
        """Silently showing two of five categories would read as the whole
        pattern."""
        for screen, needle in (("CorporateScreen.tsx", "XBRL filing"),
                               ("EntityGraphScreen.tsx", "XBRL filing")):
            self.assertIn(needle, _read("mobile", "src", "screens", screen), screen)


if __name__ == "__main__":
    unittest.main()
