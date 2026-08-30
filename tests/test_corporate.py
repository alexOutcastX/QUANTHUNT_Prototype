"""Unit tests for corporate-data parsers (crafted payloads, no network)."""
import importlib
import unittest


class CorporateTest(unittest.TestCase):
    def setUp(self):
        import corporate
        self.c = importlib.reload(corporate)

    def test_announcements(self):
        raw = [
            {"an_dt": "12-Jul-2026", "desc": "Board Meeting Outcome", "attchmntText": "Approved results"},
            {"sort_date": "11-Jul-2026", "subject": "Dividend declared"},
            {"desc": "", "attchmntText": ""},  # dropped (empty)
        ]
        out = self.c.parse_announcements(raw)
        self.assertEqual(out["source"], "NSE")
        self.assertEqual(len(out["items"]), 2)
        self.assertEqual(out["items"][0]["subject"], "Board Meeting Outcome")

    def test_actions(self):
        raw = {"data": [
            {"subject": "Dividend - Rs 5", "exDate": "20-Jul-2026", "recDate": "21-Jul-2026"},
            {"purpose": "Stock Split 1:2"},
            {"subject": ""},  # dropped
        ]}
        out = self.c.parse_actions(raw)
        self.assertEqual(len(out["items"]), 2)
        self.assertEqual(out["items"][0]["ex_date"], "20-Jul-2026")

    def test_shareholding(self):
        """The keys NSE actually serves — see tests/test_shareholding.py for
        why the old ones read as nothing."""
        raw = [{"date": "30-JUN-2026", "pr_and_prgrp": "45.3", "public_val": "54.7",
                "employeeTrusts": "0"}]
        out = self.c.parse_shareholding(raw)
        self.assertEqual(out["latest"]["promoter"], 45.3)
        self.assertEqual(out["latest"]["public"], 54.7)
        self.assertIsNone(self.c.parse_shareholding([])["latest"])

    def test_deals(self):
        raw = {"BULK_DEALS_DATA": [
            {"date": "12-Jul-2026", "symbol": "TATASTEEL", "clientName": "Some Fund",
             "buySell": "BUY", "qty": "100000", "price": "145.5"},
            {"symbol": ""},  # dropped
        ], "BLOCK_DEALS_DATA": [
            {"symbol": "INFY", "clientName": "Big FII", "buySell": "SELL", "qty": "50000", "price": "1500"},
        ]}
        out = self.c.parse_deals(raw)
        self.assertEqual(len(out["bulk"]), 1)
        self.assertEqual(out["bulk"][0]["qty"], 100000)
        self.assertEqual(len(out["block"]), 1)
        self.assertEqual(out["block"][0]["symbol"], "INFY")

    def test_cache_and_failure_lastgood(self):
        calls = {"n": 0}

        def ok_fetch(url):
            calls["n"] += 1
            return [{"an_dt": "x", "desc": "hello"}]

        a = self.c.announcements("TCS", ok_fetch)
        self.assertEqual(a["items"][0]["subject"], "hello")
        self.c.announcements("TCS", ok_fetch)  # cached → no second fetch
        self.assertEqual(calls["n"], 1)

        # failure keeps last-good
        def boom(url):
            raise RuntimeError("down")
        self.c._cache.clear()
        self.c.announcements("TCS", ok_fetch)          # seed
        self.c._cache["ann:TCS"] = (0, self.c._cache["ann:TCS"][1])  # expire
        again = self.c.announcements("TCS", boom)
        self.assertEqual(again["items"][0]["subject"], "hello")  # served last-good


if __name__ == "__main__":
    unittest.main()
