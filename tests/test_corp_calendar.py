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
        self.assertEqual(len(seen), 1)
        url = seen[0]
        self.assertTrue(url.startswith("https://"), url)
        self.assertIn("corporates-corporateActions", url)
        self.assertIn("from_date=", url)
        self.assertIn("to_date=", url)

    def test_clamps_an_absurd_window(self):
        seen = []
        self.c.calendar(lambda u: seen.append(u) or {"data": []}, 9999)
        self.c.calendar(lambda u: seen.append(u) or {"data": []}, -5)
        self.assertEqual(len(seen), 2)   # both ran; neither raised

    def test_caches_so_a_reload_is_not_a_second_nse_hit(self):
        calls = []
        fetch = lambda u: calls.append(u) or {"data": []}     # noqa: E731
        self.c.calendar(fetch, 30)
        self.c.calendar(fetch, 30)
        self.assertEqual(len(calls), 1)


@unittest.skipUnless(server, "needs Flask")
class CalendarRouteTest(unittest.TestCase):
    def setUp(self):
        server.app.config["TESTING"] = True
        self.client = server.app.test_client()

    def test_it_serves_the_calendar_as_json(self):
        import corporate
        real = corporate.calendar
        corporate.calendar = lambda fetch, days=30: {
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
