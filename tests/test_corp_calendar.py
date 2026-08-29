"""The market-wide corporate-action calendar behind the Desk home page.

Per-symbol actions already existed; what the Desk landing page needs is the
opposite question — not "what is coming for RELIANCE" but "what is coming, for
anyone". Two things make that list usable rather than merely present:

  * A parsed date. NSE writes "31-Aug-2026", and sorting those strings puts
    every August before every February. For a calendar — a list whose entire
    job is order — that is not a cosmetic bug.

  * A type. NSE publishes no type code, only free-text subjects ("Face Value
    Split (Sub-Division) - From Rs 10/- To Rs 2/-"), so dividend / bonus /
    split / rights / buyback has to be read out of the words before the page
    can offer a filter for it.
"""
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import server
except Exception:                                            # pragma: no cover
    server = None                     # the stdlib CI gate has no Flask


class CalendarParseTest(unittest.TestCase):
    def setUp(self):
        import corporate
        self.c = importlib.reload(corporate)

    # ── dates ────────────────────────────────────────────────────────────────
    def test_parses_nse_date_format(self):
        self.assertEqual(self.c.parse_ca_date("31-Aug-2026"), "2026-08-31")
        self.assertEqual(self.c.parse_ca_date("01-Jan-2027"), "2027-01-01")
        self.assertEqual(self.c.parse_ca_date(" 5-feb-2026 "), "2026-02-05")

    def test_rejects_what_it_cannot_read(self):
        for bad in (None, "", "soon", "2026-08-31-01", "31-Foo-2026", "aa-Aug-2026"):
            self.assertIsNone(self.c.parse_ca_date(bad), bad)

    def test_sorted_by_real_date_not_by_string(self):
        raw = {"data": [
            {"symbol": "AAA", "subject": "Dividend", "exDate": "31-Aug-2026"},
            {"symbol": "BBB", "subject": "Dividend", "exDate": "02-Feb-2026"},
            {"symbol": "CCC", "subject": "Dividend", "exDate": "15-Mar-2026"},
        ]}
        out = self.c.parse_calendar(raw)
        self.assertEqual([i["symbol"] for i in out["items"]], ["BBB", "CCC", "AAA"])

    def test_undated_rows_sort_last(self):
        raw = {"data": [
            {"symbol": "NODATE", "subject": "Dividend"},
            {"symbol": "DATED", "subject": "Dividend", "exDate": "10-Sep-2026"},
        ]}
        items = self.c.parse_calendar(raw)["items"]
        self.assertEqual([i["symbol"] for i in items], ["DATED", "NODATE"])
        self.assertIsNone(items[1]["ex_date"])

    # ── types ────────────────────────────────────────────────────────────────
    def test_classifies_every_kind_the_ui_filters_on(self):
        cases = {
            "Dividend - Rs 16 Per Share": "Dividend",
            "Interim Dividend Rs 4/-": "Dividend",
            "Bonus 1:1": "Bonus",
            "Face Value Split (Sub-Division) - From Rs 10/- To Rs 2/-": "Split",
            "Stock Split From Rs 10 To Re 1": "Split",
            "Rights Issue 1:4": "Rights",
            "Buy Back of Shares": "Buyback",
            "Buyback": "Buyback",
            "Scheme of Arrangement": "Other",
        }
        for subject, kind in cases.items():
            self.assertEqual(self.c.classify_action(subject), kind, subject)

    def test_every_kind_it_returns_is_one_the_ui_knows(self):
        # The chip row is built from a fixed list; a kind outside it would be
        # unfilterable and invisible.
        for subject in ("Dividend", "Bonus 2:1", "Split", "Rights", "Buyback", "Anything else"):
            self.assertIn(self.c.classify_action(subject), self.c.KINDS)

    def test_a_bonus_issue_is_not_filed_as_a_dividend(self):
        # Order in the table matters: the subject mentions both words.
        self.assertEqual(
            self.c.classify_action("Bonus Issue And Interim Dividend"), "Bonus")

    # ── shape ────────────────────────────────────────────────────────────────
    def test_drops_rows_with_nothing_to_show(self):
        raw = {"data": [
            {"symbol": "", "subject": "Dividend"},
            {"symbol": "AAA", "subject": ""},
            "not a dict",
            {"symbol": "GOOD", "subject": "Dividend", "exDate": "01-Sep-2026"},
        ]}
        items = self.c.parse_calendar(raw)["items"]
        self.assertEqual([i["symbol"] for i in items], ["GOOD"])

    def test_carries_the_fields_the_row_renders(self):
        raw = {"data": [{
            "symbol": "TCS", "comp": "Tata Consultancy Services Ltd",
            "subject": "Interim Dividend - Rs 11 Per Share",
            "exDate": "17-Sep-2026", "recDate": "18-Sep-2026", "series": "EQ",
        }]}
        it = self.c.parse_calendar(raw)["items"][0]
        self.assertEqual(it["symbol"], "TCS")
        self.assertEqual(it["name"], "Tata Consultancy Services Ltd")
        self.assertEqual(it["kind"], "Dividend")
        self.assertEqual(it["ex_date"], "2026-09-17")
        self.assertEqual(it["record_date"], "2026-09-18")
        self.assertEqual(it["series"], "EQ")

    def test_name_falls_back_to_the_symbol(self):
        raw = {"data": [{"symbol": "AAA", "subject": "Dividend"}]}
        self.assertEqual(self.c.parse_calendar(raw)["items"][0]["name"], "AAA")

    def test_survives_a_payload_that_is_not_a_list(self):
        for raw in (None, {}, {"data": None}, "error", 7):
            self.assertEqual(self.c.parse_calendar(raw)["items"], [])

    def test_accepts_a_bare_list_too(self):
        out = self.c.parse_calendar([{"symbol": "AAA", "subject": "Dividend"}])
        self.assertEqual(len(out["items"]), 1)

    # ── the fetch ────────────────────────────────────────────────────────────
    def test_asks_nse_for_a_bounded_window_by_full_url(self):
        seen = []

        def fetch(url):
            seen.append(url)
            return {"data": []}

        self.c.calendar(fetch, 30)
        acts = [u for u in seen if "corporateActions" in u]
        self.assertEqual(len(acts), 1)
        url = acts[0]
        self.assertTrue(url.startswith("https://"), url)
        self.assertIn("from_date=", url)
        self.assertIn("to_date=", url)

    def test_it_does_not_fetch_nse_twice_for_the_issues(self):
        """The public issues arrive from the feed /ipos already serves."""
        seen = []
        self.c.calendar(lambda u: seen.append(u) or [], 30)
        self.assertEqual(len(seen), 1, seen)

    def test_clamps_an_absurd_window(self):
        big = self.c.calendar(lambda u: {"data": []}, 9999)
        small = self.c.calendar(lambda u: {"data": []}, -5)
        self.assertEqual(big["days"], 90)
        self.assertEqual(small["days"], 1)

    def test_caches_so_a_reload_is_not_a_second_nse_hit(self):
        calls = []
        fetch = lambda u: calls.append(u) or {"data": []}     # noqa: E731
        self.c.calendar(fetch, 30)
        before = len(calls)
        self.c.calendar(fetch, 30)
        self.assertEqual(len(calls), before)

    # ── public issues ────────────────────────────────────────────────────────
    def test_an_open_issue_is_kept_even_though_it_started_yesterday(self):
        """The most actionable row on the page is the book that closes on
        Thursday; dropping it for opening before today would be exactly
        wrong."""
        import datetime
        today = datetime.date(2026, 8, 29)
        rows = self.c.ipo_rows([{
            "symbol": "ESDS", "name": "ESDS Software Solution Limited",
            "start": "28-Aug-2026", "end": "01-Sep-2026",
            "price_band": "Rs.408 to Rs.429", "series": "EQ",
        }], today, today + datetime.timedelta(days=30))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["kind"], "IPO")
        self.assertEqual(rows[0]["date"], "2026-08-28")
        self.assertEqual(rows[0]["close_date"], "2026-09-01")
        self.assertIn("Rs.408 to Rs.429", rows[0]["subject"])
        self.assertIn("closes 2026-09-01", rows[0]["subject"])

    def test_a_closed_book_is_history(self):
        import datetime
        today = datetime.date(2026, 8, 29)
        rows = self.c.ipo_rows([{
            "symbol": "OLD", "name": "Old Ltd",
            "start": "01-Aug-2026", "end": "05-Aug-2026",
        }], today, today + datetime.timedelta(days=30))
        self.assertEqual(rows, [])

    def test_an_issue_beyond_the_window_is_not_shown_yet(self):
        import datetime
        today = datetime.date(2026, 8, 29)
        rows = self.c.ipo_rows([{
            "symbol": "LATER", "name": "Later Ltd",
            "start": "01-Dec-2026", "end": "05-Dec-2026",
        }], today, today + datetime.timedelta(days=30))
        self.assertEqual(rows, [])

    def test_public_issues_sort_into_the_same_list_as_the_actions(self):
        import datetime
        soon = datetime.date.today() + datetime.timedelta(days=4)
        later = datetime.date.today() + datetime.timedelta(days=9)
        fetch = lambda u: {"data": [{"symbol": "AAA", "subject": "Dividend",     # noqa: E731
                                     "exDate": later.strftime("%d-%b-%Y")}]}
        out = self.c.calendar(fetch, 30, [{
            "symbol": "NEWCO", "name": "New Co",
            "start": soon.strftime("%d-%b-%Y"), "end": later.strftime("%d-%b-%Y"),
        }])
        self.assertEqual([i["kind"] for i in out["items"]], ["IPO", "Dividend"])

    def test_a_missing_ipo_feed_does_not_empty_the_actions(self):
        out = self.c.calendar(
            lambda u: {"data": [{"symbol": "AAA", "subject": "Dividend",
                                 "exDate": "01-Sep-2026"}]}, 30, None)
        self.assertEqual(len(out["items"]), 1)
        self.assertEqual(out["items"][0]["kind"], "Dividend")

    def test_an_empty_issue_feed_is_not_frozen_into_the_cache(self):
        """The bug this exists for: right after a restart the /ipos feed has
        not warmed, so the first caller merged NO issues — and because the
        merged list was what got cached, the calendar served "IPO 0" for the
        next half hour while the home page, reading the same feed directly,
        listed five. Two views of one feed disagreeing on screen is worse than
        either being briefly empty."""
        import datetime
        soon = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%d-%b-%Y")
        shut = (datetime.date.today() + datetime.timedelta(days=6)).strftime("%d-%b-%Y")
        calls = []
        fetch = lambda u: calls.append(u) or {"data": []}      # noqa: E731

        cold = self.c.calendar(fetch, 30, [])                  # feed not warm yet
        self.assertEqual([i for i in cold["items"] if i["kind"] == "IPO"], [])

        warm = self.c.calendar(fetch, 30, [
            {"symbol": "NEWCO", "name": "New Co", "start": soon, "end": shut}])
        self.assertEqual([i["symbol"] for i in warm["items"] if i["kind"] == "IPO"], ["NEWCO"])
        # …and the expensive half was still only fetched once.
        self.assertEqual(len(calls), 1, calls)

    def test_the_cached_half_is_never_mutated_by_a_merge(self):
        """It is shared with every later caller; appending issues to it in
        place would make the list grow by one copy of them per request."""
        fetch = lambda u: {"data": [{"symbol": "AAA", "subject": "Dividend",   # noqa: E731
                                     "exDate": "01-Sep-2026"}]}
        import datetime
        soon = (datetime.date.today() + datetime.timedelta(days=2)).strftime("%d-%b-%Y")
        shut = (datetime.date.today() + datetime.timedelta(days=6)).strftime("%d-%b-%Y")
        ipos = [{"symbol": "NEWCO", "name": "New Co", "start": soon, "end": shut}]
        first = self.c.calendar(fetch, 30, ipos)
        second = self.c.calendar(fetch, 30, ipos)
        self.assertEqual(len(first["items"]), len(second["items"]))
        self.assertEqual(len(second["items"]), 2)

    def test_it_reports_every_kind_it_can_contain(self):
        """An absent chip and an absent feature look identical. The page can
        only say "no bonus issues" if the server says bonus is in scope."""
        out = self.c.calendar(lambda u: {"data": []}, 30)
        self.assertEqual(out["covers"], list(self.c.KINDS))
        for kind in ("Dividend", "Bonus", "Split", "Rights", "Buyback", "IPO"):
            self.assertIn(kind, out["covers"])


@unittest.skipUnless(server, "needs Flask")
class CalendarRouteTest(unittest.TestCase):
    def setUp(self):
        server.app.config["TESTING"] = True
        self.client = server.app.test_client()

    def test_it_serves_the_calendar_as_json(self):
        import corporate
        real = corporate.calendar
        corporate.calendar = lambda fetch, days=30, ipos=None: {
            "items": [{"symbol": "AAA", "name": "AAA", "kind": "Dividend",
                       "subject": "Dividend", "ex_date": "2026-09-01",
                       "record_date": None, "series": "EQ"}],
            "source": "NSE",
        }
        try:
            r = self.client.get("/corporate/calendar?days=30")
            self.assertEqual(r.status_code, 200)
            body = r.get_json()
            self.assertEqual(body["items"][0]["symbol"], "AAA")
            self.assertEqual(body["source"], "NSE")
        finally:
            corporate.calendar = real


if __name__ == "__main__":
    unittest.main()
