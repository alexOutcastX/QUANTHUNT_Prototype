"""Offline tests for the NSE IPO / G-Sec feed parsers (primary_feeds.py)."""
import unittest

import primary_feeds as pf


def fake_fetch(responses):
    """fetch(path, params) that serves canned responses and records calls."""
    calls = []

    def fetch(path, params=None):
        calls.append((path, params))
        r = responses.get(path)
        if isinstance(r, Exception):
            raise r
        return r

    fetch.calls = calls
    return fetch


class IpoParseTest(unittest.TestCase):
    def test_merges_current_and_upcoming_with_dedup(self):
        fetch = fake_fetch({
            "/api/ipo-current-issues": {"data": [
                {"symbol": "ABCLTD", "companyName": "ABC Ltd", "series": "EQ",
                 "issueStartDate": "21-Jul-2026", "issueEndDate": "24-Jul-2026",
                 "priceBand": "95-100", "issueSize": "1200000"},
            ]},
            "/api/all-upcoming-issues": {"data": [
                # duplicate of the open issue — the 'open' row must win
                {"symbol": "ABCLTD", "companyName": "ABC Ltd", "series": "EQ"},
                {"symbol": "XYZSME", "companyName": "XYZ Industries", "series": "SME",
                 "issueStartDate": "28-Jul-2026", "issueEndDate": "30-Jul-2026"},
            ]},
        })
        items, err = pf.parse_ipos(fetch)
        self.assertIsNone(err)
        self.assertEqual([i["symbol"] for i in items], ["ABCLTD", "XYZSME"])
        self.assertEqual(items[0]["status"], "open")
        self.assertEqual(items[0]["price_band"], "95-100")
        self.assertEqual(items[1]["status"], "upcoming")

    def test_key_aliases_and_bare_list(self):
        fetch = fake_fetch({
            "/api/ipo-current-issues": [
                {"sym": "ALIAS", "issuer": "Alias Corp", "startDate": "01-Aug-2026",
                 "endDate": "05-Aug-2026", "issuePrice": "310"},
            ],
            "/api/all-upcoming-issues": {"data": []},
        })
        items, err = pf.parse_ipos(fetch)
        self.assertIsNone(err)
        self.assertEqual(items[0]["symbol"], "ALIAS")
        self.assertEqual(items[0]["name"], "Alias Corp")
        self.assertEqual(items[0]["start"], "01-Aug-2026")
        self.assertEqual(items[0]["price_band"], "310")

    def test_one_feed_down_keeps_the_other(self):
        fetch = fake_fetch({
            "/api/ipo-current-issues": RuntimeError("blocked"),
            "/api/all-upcoming-issues": {"data": [
                {"symbol": "OKIPO", "companyName": "OK IPO Ltd"},
            ]},
        })
        items, err = pf.parse_ipos(fetch)
        self.assertEqual(len(items), 1)
        self.assertIsNone(err)  # partial success is not an error

    def test_all_down_reports_error(self):
        fetch = fake_fetch({
            "/api/ipo-current-issues": RuntimeError("blocked"),
            "/api/all-upcoming-issues": RuntimeError("blocked"),
        })
        items, err = pf.parse_ipos(fetch)
        self.assertEqual(items, [])
        self.assertIn("blocked", err)

    def test_junk_rows_skipped(self):
        fetch = fake_fetch({
            "/api/ipo-current-issues": {"data": ["junk", {"noSymbol": True}]},
            "/api/all-upcoming-issues": {"data": []},
        })
        items, err = pf.parse_ipos(fetch)
        self.assertEqual(items, [])


class GsecParseTest(unittest.TestCase):
    def test_parses_both_kinds_gsec_first(self):
        fetch = fake_fetch({
            "/api/liveBonds-traded-on-cds": None,  # replaced below per params
        })

        def fetch2(path, params=None):
            if params and params.get("type") == "gsec":
                return {"data": [
                    {"symbol": "726GS2033", "series": "GS", "lastPrice": "99.61",
                     "pChange": "0.12", "yield": "7.02", "couponRate": "7.26",
                     "maturityDate": "22-Aug-2033"},
                ]}
            return {"data": [
                {"symbol": "SGBAUG29", "series": "GB", "averagePrice": "7350",
                 "averageYield": "2.5", "redemptionDate": "11-Aug-2029"},
            ]}

        items, err = pf.parse_gsec(fetch2)
        self.assertIsNone(err)
        self.assertEqual([i["kind"] for i in items], ["gsec", "sgb"])
        self.assertEqual(items[0]["yld"], 7.02)
        self.assertEqual(items[0]["ltp"], 99.61)
        self.assertEqual(items[1]["ltp"], 7350.0)
        self.assertEqual(items[1]["yld"], 2.5)

    def test_numeric_junk_becomes_none(self):
        def fetch(path, params=None):
            return {"data": [{"symbol": "X", "lastPrice": "n/a", "yield": ""}]}
        items, err = pf.parse_gsec(fetch)
        self.assertEqual(len(items), 2)  # one per kind (same canned row)
        self.assertIsNone(items[0]["ltp"])
        self.assertIsNone(items[0]["yld"])

    def test_all_down_reports_error(self):
        def fetch(path, params=None):
            raise RuntimeError("403")
        items, err = pf.parse_gsec(fetch)
        self.assertEqual(items, [])
        self.assertIn("403", err)


if __name__ == "__main__":
    unittest.main()
