"""The universe is everything LISTED, not everything that traded today.

A bhavcopy lists what printed a tick that session. Anything thinly traded
therefore fell out of the universe on any day it didn't trade — and could not
be searched for at all, even though its dossier renders fine once reached.
Taparia Tools is the case that surfaced it: BSE-only, trades rarely, absent
from both bhavcopies, missing from every predictive search bar in the app.

So the universe is now (bhavcopy union the exchange scrip masters). What is
pinned here is the shape: master-only rows are present, are findable, and
carry NO price — because they genuinely didn't trade, and anything that grades
or ranks on price must skip them rather than treat a blank as a zero.
"""
import unittest
from unittest import mock

try:
    import server
except Exception:
    server = None

import penny_screen as ps


@unittest.skipUnless(server, "server import unavailable")
class BseMasterTest(unittest.TestCase):
    def test_it_parses_the_master_payload(self):
        payload = [
            {"scrip_id": "TAPARIA", "Issuer_Name": "Taparia Tools Ltd.", "Status": "Active"},
            {"scrip_id": "GOODCO", "Scrip_Name": "Good Co Ltd", "Status": "Active"},
        ]
        with mock.patch.object(server.requests, "Session") as S:
            S.return_value.get.return_value = mock.Mock(status_code=200, json=lambda: payload)
            out = server._load_bse_master()
        self.assertEqual([r["symbol"] for r in out], ["TAPARIA", "GOODCO"])
        self.assertEqual(out[0]["name"], "Taparia Tools Ltd.")
        self.assertEqual(out[0]["exchange"], "BSE")

    def test_junk_symbols_are_dropped(self):
        payload = [{"scrip_id": "OK1", "Issuer_Name": "Fine"},
                   {"scrip_id": "BAD SYM!", "Issuer_Name": "Junk"},
                   {"scrip_id": "", "Issuer_Name": "Nameless"}]
        with mock.patch.object(server.requests, "Session") as S:
            S.return_value.get.return_value = mock.Mock(status_code=200, json=lambda: payload)
            out = server._load_bse_master()
        self.assertEqual([r["symbol"] for r in out], ["OK1"])

    def test_a_failure_is_not_fatal(self):
        """The masters widen the universe; they must never be able to empty it."""
        with mock.patch.object(server.requests, "Session", side_effect=RuntimeError("down")):
            self.assertEqual(server._load_bse_master(), [])
        with mock.patch.object(server.requests, "Session") as S:
            S.return_value.get.return_value = mock.Mock(status_code=503)
            self.assertEqual(server._load_bse_master(), [])


class PricelessRowsTest(unittest.TestCase):
    """A listed-but-untraded row has no price. Nothing may rank it as if 0."""

    UNI = [
        {"symbol": "TRADED", "exchange": "NSE", "price": 8.0, "turnover": 5e7, "chg": 1.0},
        {"symbol": "TAPARIA", "exchange": "BSE", "name": "Taparia Tools Ltd.",
         "price": None, "chg": None, "listed_only": True},
        {"symbol": "ZEROPX", "exchange": "BSE", "price": 0, "chg": None},
    ]

    def test_the_penny_screen_skips_them(self):
        """Cheapest-first is the default lens here; a null price sorting as
        zero would put every untraded shell at the top of the list."""
        out = ps.screen(self.UNI, {}, "under10", 0, None, None, 100)
        syms = [r["symbol"] for r in out["rows"]]
        self.assertIn("TRADED", syms)
        self.assertNotIn("TAPARIA", syms, "an unpriced scrip was graded as a penny stock")
        self.assertNotIn("ZEROPX", syms, "a zero close was graded as a price")

    @unittest.skipUnless(server, "server import unavailable")
    def test_the_quote_index_skips_them(self):
        """/index backfills prices from the universe — a null must not be
        offered as a quote."""
        import time
        with mock.patch.object(server, "_universe_cache", self.UNI), \
             mock.patch.object(server, "_universe_ts", time.time()):
            server._QUOTE_IDX["ts"], server._QUOTE_IDX["map"] = 0.0, {}
            m = server._quote_index()
        self.assertIn("TRADED", m)
        self.assertNotIn("TAPARIA", m)
        self.assertNotIn("ZEROPX", m)


@unittest.skipUnless(server, "server import unavailable")
class UniverseRouteTest(unittest.TestCase):
    def test_master_only_rows_are_searchable(self):
        """The whole point: you can type it into a search bar."""
        with mock.patch.object(server, "get_universe", return_value=PricelessRowsTest.UNI), \
             mock.patch.object(server, "_BHAV_DATE", "2026-07-30"):
            j = server.app.test_client().get("/universe").get_json()
        by = {s["symbol"]: s for s in j["symbols"]}
        self.assertIn("TAPARIA", by, "a listed scrip was missing from the search payload")
        self.assertEqual(by["TAPARIA"]["name"], "Taparia Tools Ltd.")
        self.assertIsNone(by["TAPARIA"]["price"], "an untraded scrip was given a price")


if __name__ == "__main__":
    unittest.main()
