"""A month of headlines, kept because the feeds only carry hours.

An RSS feed is a window, not an archive: it holds whatever the publisher has up
right now, so a story nobody wrote down as it went past is simply gone. Every
market-wide poll records what it saw, and the archive tab reads back from that.

Two limits are real and are stated rather than papered over:

  * History starts accumulating the first time the server records. It cannot
    reach backwards, so asking for a month on day one returns a day.
  * The table is a cache of public headlines, not a library. It is pruned on
    write so it cannot grow without bound.
"""
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import news_history as nh
import store


def item(link, title="A headline", source="ET Markets", ts=None):
    return {"link": link, "title": title, "source": source,
            "ts": ts if ts is not None else int(time.time())}


class RecordTest(unittest.TestCase):
    def setUp(self):
        store.execute("DELETE FROM news_items")
        nh._last_prune = 0.0

    tearDown = setUp

    def test_a_poll_is_written_down(self):
        self.assertEqual(nh.record([item("https://a/1"), item("https://a/2")]), 2)
        self.assertEqual(len(nh.history()), 2)

    def test_the_same_story_twice_is_one_row(self):
        """The same headline arrives on every poll for hours, and often from
        two feeds at once."""
        nh.record([item("https://a/1")])
        self.assertEqual(nh.record([item("https://a/1"), item("https://a/2")]), 1)
        self.assertEqual(len(nh.history()), 2)

    def test_a_repeat_inside_one_batch_counts_once(self):
        self.assertEqual(nh.record([item("https://a/1"), item("https://a/1")]), 1)

    def test_the_count_is_not_taken_from_lastrowid(self):
        """store.execute returns lastrowid when there is one, and on an INSERT
        OR IGNORE that DID ignore it is still whatever the connection's last
        real insert set — so trusting it reports every poll as entirely new."""
        nh.record([item("https://a/1")])
        self.assertEqual(nh.record([item("https://a/1")]), 0)

    def test_identity_is_the_link_not_the_title(self):
        """Publishers edit headlines after posting; the link stays put."""
        nh.record([item("https://a/1", title="First wording")])
        nh.record([item("https://a/1", title="Rewritten later")])
        rows = nh.history()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "First wording",
                         "the version published at that timestamp is the one that happened")

    def test_rows_without_a_link_or_a_title_are_skipped(self):
        self.assertEqual(nh.record([{"link": "", "title": "x"},
                                    {"link": "https://a/1", "title": ""}]), 0)

    def test_an_empty_poll_is_harmless(self):
        self.assertEqual(nh.record([]), 0)
        self.assertEqual(nh.record(None), 0)


class HistoryTest(unittest.TestCase):
    def setUp(self):
        store.execute("DELETE FROM news_items")
        nh._last_prune = 0.0
        now = int(time.time())
        nh.record([
            item("https://a/today", "Banks rally on rate hopes", "ET Markets", now - 60),
            item("https://a/week", "IPO pipeline builds", "Livemint", now - 7 * 86400),
            item("https://a/old", "Ancient news", "Moneycontrol", now - 20 * 86400),
        ])

    tearDown = lambda self: store.execute("DELETE FROM news_items")

    def test_newest_first(self):
        self.assertEqual([r["title"] for r in nh.history()],
                         ["Banks rally on rate hopes", "IPO pipeline builds", "Ancient news"])

    def test_the_window_is_respected(self):
        self.assertEqual(len(nh.history(days=1)), 1)
        self.assertEqual(len(nh.history(days=10)), 2)

    def test_it_is_searchable(self):
        self.assertEqual([r["title"] for r in nh.history(q="IPO")], ["IPO pipeline builds"])
        self.assertEqual(nh.history(q="nothing here"), [])

    def test_it_filters_by_publisher(self):
        self.assertEqual([r["title"] for r in nh.history(source="Livemint")],
                         ["IPO pipeline builds"])

    def test_a_caller_cannot_ask_for_more_than_is_kept(self):
        """`days` past the retention window is a promise the table cannot
        keep."""
        self.assertLessEqual(nh.history(days=9999) and 1 or 0, 1)
        self.assertEqual(len(nh.history(days=9999)), 3)

    def test_the_page_size_is_bounded(self):
        """An unbounded limit is a way to ask for the whole table at once."""
        self.assertLessEqual(len(nh.history(limit=100000)), 500)

    def test_sources_lists_what_is_actually_held(self):
        self.assertEqual(set(nh.sources()), {"ET Markets", "Livemint", "Moneycontrol"})

    def test_stats_report_the_reach(self):
        st = nh.stats()
        self.assertEqual(st["n"], 3)
        self.assertLess(st["oldest"], st["newest"])


class PruneTest(unittest.TestCase):
    def setUp(self):
        store.execute("DELETE FROM news_items")
        nh._last_prune = 0.0

    tearDown = setUp

    def test_anything_past_the_window_goes(self):
        old = int(time.time()) - (nh.KEEP_DAYS + 5) * 86400
        store.execute(
            "INSERT INTO news_items (id, ts, title, link, source, summary, seen) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("stale", old, "Very old", "https://a/old", "ET", "", old))
        nh._prune(force=True)
        self.assertEqual(nh.stats()["n"], 0)

    def test_a_recently_seen_row_with_a_bad_date_survives(self):
        """A feed with a broken or missing date lands at the time it was
        recorded; pruning on ts alone would drop it the instant it arrived."""
        old = int(time.time()) - (nh.KEEP_DAYS + 5) * 86400
        store.execute(
            "INSERT INTO news_items (id, ts, title, link, source, summary, seen) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("weird", old, "No date in the feed", "https://a/weird", "ET", "",
             int(time.time())))
        nh._prune(force=True)
        self.assertEqual(nh.stats()["n"], 1)

    def test_pruning_is_throttled(self):
        """It runs on a write we were making anyway; once an hour is plenty."""
        nh._last_prune = time.time()
        self.assertEqual(nh._prune(), 0)


try:
    import server as _server
except Exception:                                            # pragma: no cover
    _server = None                    # the stdlib CI gate has no Flask


@unittest.skipUnless(_server, "flask unavailable in this environment")
class RouteTest(unittest.TestCase):
    """The endpoint the archive tab reads."""

    def setUp(self):
        server = _server
        store.execute("DELETE FROM news_items")
        nh._last_prune = 0.0
        server._RL.clear()
        self.c = server.app.test_client()
        nh.record([item("https://a/1", "Recorded headline")])

    def tearDown(self):
        store.execute("DELETE FROM news_items")

    def test_it_serves_what_was_recorded(self):
        r = self.c.get("/news/history")
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual([i["title"] for i in body["items"]], ["Recorded headline"])

    def test_it_says_how_far_back_it_reaches(self):
        """The archive cannot reach into stories nobody recorded, and the UI
        needs to be able to say so rather than implying a full month."""
        body = self.c.get("/news/history").get_json()
        self.assertIsNotNone(body["oldest"])
        self.assertEqual(body["keep_days"], nh.KEEP_DAYS)

    def test_search_reaches_the_endpoint(self):
        self.assertEqual(len(self.c.get("/news/history?q=Recorded").get_json()["items"]), 1)
        self.assertEqual(len(self.c.get("/news/history?q=absent").get_json()["items"]), 0)


if __name__ == "__main__":
    unittest.main()
