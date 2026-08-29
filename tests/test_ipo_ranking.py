"""One ranking of the public issues, so two views of it cannot disagree.

The Desk's corporate calendar said "IPO 0" while the home page, three sections
below, listed five upcoming issues. Both read the same NSE feed. Two causes,
both worth fixing:

  * The calendar cached the MERGED list. Right after a restart the /ipos feed
    has not warmed, so the first caller merged no issues — and that emptiness
    was what got cached, for the next half hour. Only the expensive half (the
    NSE actions fetch) is cached now; the issues are merged fresh per request.

  * The home card rendered the feed raw: `items.slice(0, 5)`. Feed order is not
    date order, so "the next five" were five arbitrary ones; NSE's own `status`
    field says only which of its two lists a row came from, and its "upcoming"
    list carries books that are open right now; and nothing dropped a book that
    had already closed, so an issue you could no longer apply to still read
    "SOON".

The ranking is applied when the feed is SERVED, not when it is cached: all
three answers are functions of today's date, and the payload behind it can be a
disk copy written days ago.
"""
import datetime
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import primary_feeds as pf

TODAY = datetime.date(2026, 8, 29)


def ipo(sym, start, end, status="upcoming"):
    return {"symbol": sym, "name": sym + " Ltd", "series": "EQ",
            "start": start, "end": end, "price_band": "", "size": "",
            "status": status}


class RankIposTest(unittest.TestCase):
    def setUp(self):
        self.pf = importlib.reload(pf)

    def test_a_closed_book_is_dropped(self):
        rows = self.pf.rank_ipos(
            [ipo("ANNU", "25-Aug-2026", "28-Aug-2026")], TODAY)
        self.assertEqual(rows, [])

    def test_a_book_closing_today_is_still_live(self):
        rows = self.pf.rank_ipos(
            [ipo("LUMINO", "27-Aug-2026", "29-Aug-2026")], TODAY)
        self.assertEqual([r["symbol"] for r in rows], ["LUMINO"])
        self.assertEqual(rows[0]["status"], "open")

    def test_status_comes_from_the_dates_not_from_nse(self):
        """NSE's "upcoming" list carries books that are open right now, so its
        own status field made every badge read SOON."""
        rows = self.pf.rank_ipos([
            ipo("OPENNOW", "28-Aug-2026", "01-Sep-2026", status="upcoming"),
            ipo("LATER", "05-Sep-2026", "09-Sep-2026", status="upcoming"),
        ], TODAY)
        by = {r["symbol"]: r["status"] for r in rows}
        self.assertEqual(by, {"OPENNOW": "open", "LATER": "upcoming"})

    def test_rows_are_ordered_by_the_day_they_open(self):
        rows = self.pf.rank_ipos([
            ipo("C", "05-Sep-2026", "09-Sep-2026"),
            ipo("A", "29-Aug-2026", "02-Sep-2026"),
            ipo("B", "01-Sep-2026", "03-Sep-2026"),
        ], TODAY)
        self.assertEqual([r["symbol"] for r in rows], ["A", "B", "C"])

    def test_it_sorts_by_real_dates_not_by_string(self):
        """'01-Sep' sorts before '29-Aug' as text; for a calendar that is the
        one thing that must not happen."""
        rows = self.pf.rank_ipos([
            ipo("SEP", "01-Sep-2026", "03-Sep-2026"),
            ipo("AUG", "29-Aug-2026", "31-Aug-2026"),
        ], TODAY)
        self.assertEqual([r["symbol"] for r in rows], ["AUG", "SEP"])

    def test_it_exposes_the_parsed_dates(self):
        rows = self.pf.rank_ipos([ipo("A", "29-Aug-2026", "02-Sep-2026")], TODAY)
        self.assertEqual(rows[0]["opens_on"], "2026-08-29")
        self.assertEqual(rows[0]["closes_on"], "2026-09-02")

    def test_it_does_not_mutate_the_cached_rows(self):
        """The payload it reads is the process-wide feed cache."""
        src = [ipo("A", "29-Aug-2026", "02-Sep-2026", status="upcoming")]
        self.pf.rank_ipos(src, TODAY)
        self.assertEqual(src[0]["status"], "upcoming")
        self.assertNotIn("opens_on", src[0])

    def test_an_undated_row_is_kept_but_sorts_last(self):
        """Better a row with no window than a silently dropped issue."""
        rows = self.pf.rank_ipos([
            {"symbol": "NODATE", "name": "No Date Ltd"},
            ipo("DATED", "29-Aug-2026", "02-Sep-2026"),
        ], TODAY)
        self.assertEqual([r["symbol"] for r in rows], ["DATED", "NODATE"])

    def test_it_survives_a_payload_that_is_not_a_list(self):
        for bad in (None, {}, "error", 7):
            self.assertEqual(self.pf.rank_ipos(bad, TODAY), [])

    def test_it_skips_rows_that_are_not_objects(self):
        rows = self.pf.rank_ipos(
            ["nonsense", ipo("A", "29-Aug-2026", "02-Sep-2026")], TODAY)
        self.assertEqual([r["symbol"] for r in rows], ["A"])


try:
    import server
except Exception:                                            # pragma: no cover
    server = None                     # the stdlib CI gate has no Flask


@unittest.skipUnless(server, "needs Flask")
class SharedRankingTest(unittest.TestCase):
    """Both views read the same ranked rows — that is the whole fix."""

    def test_the_two_routes_share_one_ranking_helper(self):
        src = open(os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server.py"),
            encoding="utf-8").read()
        self.assertIn("def _ipo_items():", src)
        # Two call sites — the count includes the definition line.
        self.assertEqual(src.count("_ipo_items()") - src.count("def _ipo_items()"), 2)
        self.assertIn("_primary.rank_ipos(", src)

    def test_the_ipo_route_serves_ranked_rows(self):
        server.app.config["TESTING"] = True
        client = server.app.test_client()
        real = server._feed_payload
        server._feed_payload = lambda name: {"items": [
            ipo("CLOSED", "01-Aug-2026", "05-Aug-2026"),
            ipo("LATER", "01-Dec-2026", "05-Dec-2026"),
        ], "asof": "x"}
        try:
            body = client.get("/ipos").get_json()
            self.assertEqual([i["symbol"] for i in body["items"]], ["LATER"])
        finally:
            server._feed_payload = real


if __name__ == "__main__":
    unittest.main()
