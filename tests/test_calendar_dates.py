"""The three dates a corporate action has, and where each one comes from.

A calendar row is filed under one date and the card shows that one, which left
"1 Sep" meaning whichever date the reader assumed. A dividend has an
announcement, a record date and an ex-date; they are days or weeks apart, and
which one you are looking at decides whether you can still buy the stock and be
paid.

Two of the three are in NSE's corporate-actions feed and were already parsed —
they simply were not rendered. The third is not in that feed at all:
`caBroadcastDate` is null on every row it serves. So it is joined from the
filings feed, and these tests fix what that join is allowed to claim.
"""
import importlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class IndexTest(unittest.TestCase):
    def setUp(self):
        import corporate
        self.c = importlib.reload(corporate)

    # ── reading the filings feed ─────────────────────────────────────────────
    def test_indexes_only_record_date_filings(self):
        """The one filing that is unambiguously about a coming action.

        The board meeting that declares a dividend files as "Outcome of Board
        Meeting" with the dividend inside the attached PDF — the row's own text
        never names it, so there is nothing to match on and matching anyway
        would attach the date of an unrelated quarterly result.
        """
        idx = self.c.parse_record_intimations({"data": [
            {"symbol": "AAA", "desc": "Record Date", "sort_date": "2026-08-17 10:00:00"},
            {"symbol": "AAA", "desc": "Outcome of Board Meeting",
             "attchmntText": "declared a dividend", "sort_date": "2026-08-05 16:07:12"},
            {"symbol": "AAA", "desc": "Copy of Newspaper Publication",
             "sort_date": "2026-08-18 09:00:00"},
        ]})
        self.assertEqual(idx, {"AAA": ["2026-08-17"]})

    def test_takes_the_day_out_of_either_timestamp_nse_writes(self):
        one = self.c.parse_record_intimations([
            {"symbol": "AAA", "desc": "Record Date", "sort_date": "2026-08-17 10:00:00"}])
        two = self.c.parse_record_intimations([
            {"symbol": "AAA", "desc": "Record Date", "an_dt": "17-Aug-2026 10:00:00"}])
        self.assertEqual(one, two)
        self.assertEqual(one, {"AAA": ["2026-08-17"]})

    def test_a_revised_record_date_files_a_second_row(self):
        idx = self.c.parse_record_intimations([
            {"symbol": "AAA", "desc": "Revised Record date", "sort_date": "2026-08-07 10:00:00"},
            {"symbol": "AAA", "desc": "Record Date", "sort_date": "2026-07-10 10:00:00"},
        ])
        self.assertEqual(idx["AAA"], ["2026-07-10", "2026-08-07"])   # oldest first

    def test_survives_what_nse_serves_on_a_bad_day(self):
        for bad in (None, "", "error", {"data": "nope"}, [1, 2], [{"desc": "Record Date"}],
                    [{"symbol": "AAA", "desc": "Record Date", "sort_date": "soon"}]):
            self.assertEqual(self.c.parse_record_intimations(bad), {}, bad)

    # ── the join ─────────────────────────────────────────────────────────────
    def _row(self, **kw):
        row = {"symbol": "AAA", "kind": "Dividend", "subject": "Dividend - Rs 3",
               "date": "2026-09-01", "ex_date": "2026-09-01", "record_date": "2026-09-02"}
        row.update(kw)
        return row

    def test_announced_is_the_first_time_it_was_said(self):
        """Not the latest filing: a company that moves its record date files a
        second row, and the announcement is the original, not the correction."""
        idx = {"AAA": ["2026-07-10", "2026-08-07"]}
        self.assertEqual(self.c.announced_on(self._row(), idx), "2026-07-10")

    def test_an_older_action_does_not_lend_its_date(self):
        """An interim dividend last quarter is not this one's announcement."""
        idx = {"AAA": ["2026-01-05"]}
        self.assertIsNone(self.c.announced_on(self._row(), idx))

    def test_a_filing_after_the_ex_date_is_not_an_announcement(self):
        idx = {"AAA": ["2026-09-04"]}
        self.assertIsNone(self.c.announced_on(self._row(), idx))

    def test_a_symbol_with_no_filings_gets_nothing_rather_than_a_guess(self):
        self.assertIsNone(self.c.announced_on(self._row(), {"BBB": ["2026-08-07"]}))

    def test_a_row_with_no_ex_date_is_left_alone(self):
        idx = {"AAA": ["2026-08-07"]}
        self.assertIsNone(self.c.announced_on(self._row(date=None, ex_date=None), idx))

    def test_the_join_never_raises_on_junk(self):
        for idx in (None, {}, "x", {"AAA": "2026-08-07"}, {"AAA": None}):
            self.assertIsNone(self.c.announced_on(self._row(), idx), idx)
        for row in ({}, {"symbol": "AAA"}, {"symbol": "AAA", "ex_date": "soon"},
                    {"symbol": "AAA", "ex_date": 20260901}):
            self.assertIsNone(self.c.announced_on(row, {"AAA": ["2026-08-07"]}), row)

    def test_with_announced_attaches_only_what_it_knows(self):
        rows = [self._row(), self._row(symbol="BBB")]
        self.c.with_announced(rows, {"AAA": ["2026-08-07"]})
        self.assertEqual(rows[0]["announced"], "2026-08-07")
        self.assertNotIn("announced", rows[1])

    # ── the fetch stays off the request path ─────────────────────────────────
    def test_the_calendar_does_not_fetch_the_filings_index(self):
        """It is sixty days of every equity filing — 26 MB and seconds. A
        calendar row is worth serving with two dates on it while the third
        warms in the background."""
        seen = []
        self.c.calendar(lambda u: seen.append(u) or {"data": []}, 30)
        self.assertEqual([u for u in seen if "announcements" in u], [])

    def test_the_calendar_uses_the_index_once_it_is_warm(self):
        raw = {"data": [{"symbol": "AAA", "subject": "Dividend - Rs 3",
                         "exDate": "01-Sep-2026", "recDate": "02-Sep-2026"}]}
        ann = [{"symbol": "AAA", "desc": "Record Date", "sort_date": "2026-08-07 10:00:00"}]

        def fetch(url, timeout=None):
            return ann if "announcements" in url else raw

        self.c.record_index(fetch)
        row = self.c.calendar(fetch, 30)["items"][0]
        self.assertEqual(row["announced"], "2026-08-07")
        self.assertEqual(row["ex_date"], "2026-09-01")
        self.assertEqual(row["record_date"], "2026-09-02")

    def test_the_index_asks_for_a_bounded_window_and_a_longer_timeout(self):
        seen = []

        def fetch(url, timeout=None):
            seen.append((url, timeout))
            return []

        self.c.record_index(fetch)
        url, timeout = seen[0]
        self.assertIn("corporate-announcements", url)
        self.assertIn("from_date=", url)
        self.assertIn("to_date=", url)
        self.assertGreater(timeout, 12)          # 26 MB is not an interactive read

    def test_a_fetch_that_takes_no_timeout_still_works(self):
        """The injected fetch is the parsers' seam; the timeout is offered."""
        idx = self.c.record_index(lambda u: [
            {"symbol": "AAA", "desc": "Record Date", "sort_date": "2026-08-07 10:00:00"}])
        self.assertEqual(idx, {"AAA": ["2026-08-07"]})

    def test_a_bad_nse_minute_keeps_the_last_good_index(self):
        good = self.c.record_index(lambda u: [
            {"symbol": "AAA", "desc": "Record Date", "sort_date": "2026-08-07 10:00:00"}])
        self.assertEqual(good, {"AAA": ["2026-08-07"]})

        def broken(url):
            raise RuntimeError("NSE corporate fetch failed")

        self.assertEqual(self.c.record_index(broken), {"AAA": ["2026-08-07"]})
        self.assertEqual(self.c.peek_record_index(), {"AAA": ["2026-08-07"]})

    def test_nothing_in_hand_means_no_column_not_a_crash(self):
        self.assertEqual(self.c.peek_record_index(), {})
        self.assertIsNone(self.c.record_index_age())
        row = self.c.calendar(lambda u: {"data": [
            {"symbol": "AAA", "subject": "Dividend", "exDate": "01-Sep-2026"}]}, 30)["items"][0]
        self.assertNotIn("announced", row)


class WiringTest(unittest.TestCase):
    """The warm loop is production wiring, so it is checked as source."""

    def test_the_warmer_is_started_by_both_entrypoints(self):
        self.assertIn("start_corp_warm()", _read("wsgi.py"))
        main = _read("server.py").split('if __name__ == "__main__":')[-1]
        self.assertIn("start_corp_warm()", main)

    def test_the_client_names_each_date_it_shows(self):
        src = _read("mobile", "src", "screens", "DeskHome.tsx")
        code = "\n".join(l for l in src.splitlines() if not l.strip().startswith(("//", "*", "/*")))
        for label in ("Announced ", "Ex ", "Record "):
            self.assertIn(f"`{label}", code, label)
        self.assertIn("a.record_date", code)
        self.assertIn("a.announced", code)

    def test_the_type_carries_the_announcement(self):
        self.assertIn("announced?: string | null;", _read("mobile", "src", "api.ts"))


if __name__ == "__main__":
    unittest.main()
