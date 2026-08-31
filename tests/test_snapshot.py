"""The prebuilt screener payload, and the schedule that builds it.

The console used to open in four waves — /index for constituents and quotes,
/universe for names, /scan in three batches, /fundamentals/bulk in three more.
Seven requests, most waiting on the one before, for a table whose every number
comes from daily bars. The caches behind them were already warm (NIFTY 500 came
back 500/500 cached on the live server); the cost was the shape of the
conversation, not the computation.

So the merge is done on a schedule and served in one response. These tests hold
the two things that make that safe: the merge is correct, and a snapshot too
old to trust is never served.
"""

import datetime as _dt
import os
import tempfile
import unittest

os.environ.setdefault("SNAPSHOT_FILE", tempfile.mktemp(suffix=".json"))

import snapshot


class ScheduleTest(unittest.TestCase):
    """16:00 and 02:00 IST, in IST, whatever the server thinks the time is."""

    IST = snapshot.IST

    def _at(self, h, m=0, day=15):
        return _dt.datetime(2026, 6, day, h, m, tzinfo=self.IST)

    def test_the_afternoon_build_is_after_the_close(self):
        """The NSE closes at 15:30 and the bhavcopy settles shortly after, so
        16:00 is the first moment the day's real closing numbers exist."""
        self.assertIn("16:00", snapshot.TIMES)
        self.assertIn("02:00", snapshot.TIMES)

    def test_it_picks_the_next_time_not_a_fixed_interval(self):
        """"Twelve hours from boot" would move the close-of-day build to
        whenever the service happened to restart."""
        nxt = snapshot.next_run_at(["16:00", "02:00"], self._at(9, 0))
        self.assertEqual(_dt.datetime.fromtimestamp(nxt, self.IST), self._at(16, 0))

    def test_after_the_afternoon_build_the_next_one_is_overnight(self):
        nxt = snapshot.next_run_at(["16:00", "02:00"], self._at(16, 1))
        self.assertEqual(_dt.datetime.fromtimestamp(nxt, self.IST), self._at(2, 0, day=16))

    def test_just_before_a_build_it_does_not_skip_a_day(self):
        """A restart at 15:59 must still build at 16:00, not tomorrow."""
        nxt = snapshot.next_run_at(["16:00", "02:00"], self._at(15, 59))
        self.assertEqual(_dt.datetime.fromtimestamp(nxt, self.IST), self._at(16, 0))

    def test_late_evening_rolls_to_the_small_hours(self):
        nxt = snapshot.next_run_at(["16:00", "02:00"], self._at(23, 30))
        self.assertEqual(_dt.datetime.fromtimestamp(nxt, self.IST), self._at(2, 0, day=16))

    def test_a_time_it_cannot_parse_does_not_stop_the_loop(self):
        """A bad SNAPSHOT_TIMES must degrade to "build sometime", never to a
        crash in a daemon thread nobody is watching."""
        nxt = snapshot.next_run_at(["not-a-time"], self._at(9, 0))
        self.assertGreater(nxt, self._at(9, 0).timestamp())


class BuildTest(unittest.TestCase):
    CONS = [
        {"symbol": "AAA", "price": 100.0, "prevClose": 99.0, "chg": 1.01, "volume": 1000},
        {"symbol": "BBB", "price": 50.0, "prevClose": 51.0, "chg": -1.96, "volume": 2000},
        {"symbol": "CCC", "price": 10.0, "prevClose": 10.0, "chg": 0.0, "volume": 300},
    ]
    TECH = {"AAA": {"rsi": 61.0, "d50": 4.2, "price": 99.5},
            "BBB": {"rsi": 44.0, "d50": -2.0}}
    FUND = {"AAA": {"pe": 20.0, "sector": "IT"}}
    NAMES = {"AAA": {"name": "Alpha Ltd", "exchange": "NSE"},
             "BBB": {"name": "Beta Ltd", "exchange": "BSE"}}

    def setUp(self):
        self.snap = snapshot.build("NIFTY TEST", self.CONS, self.TECH, self.FUND, self.NAMES)
        self.rows = {r["sym"]: r for r in self.snap["rows"]}

    def test_every_constituent_becomes_a_row(self):
        self.assertEqual(self.snap["count"], 3)
        self.assertEqual(sorted(self.rows), ["AAA", "BBB", "CCC"])

    def test_a_row_carries_all_four_sources_at_once(self):
        """The whole point: one response, nothing left to fetch."""
        r = self.rows["AAA"]
        self.assertEqual(r["name"], "Alpha Ltd")       # /universe
        self.assertEqual(r["volume"], 1000)            # /index
        self.assertEqual(r["rsi"], 61.0)               # /scan
        self.assertEqual(r["_fund"]["pe"], 20.0)       # /fundamentals/bulk

    def test_the_quote_feed_wins_over_the_scan_row(self):
        """A scan row's price can be a bar older than the constituent feed's,
        and the constituent feed is what the close came from."""
        self.assertEqual(self.rows["AAA"]["price"], 100.0)

    def test_a_row_with_no_technicals_is_still_a_row(self):
        """Dropping it would silently shrink the universe to whatever the sweep
        had finished — which is the failure the snapshot exists to end."""
        self.assertIn("CCC", self.rows)
        self.assertIsNone(self.rows["CCC"].get("rsi"))

    def test_missing_fundamentals_are_null_not_absent(self):
        self.assertIsNone(self.rows["BBB"]["_fund"])

    def test_the_name_falls_back_to_the_symbol(self):
        self.assertEqual(self.rows["CCC"]["name"], "CCC")
        self.assertEqual(self.rows["CCC"]["exchange"], "NSE")

    def test_it_counts_what_it_actually_covered(self):
        """The build log and /screener/snapshot/status are how a half-filled
        sweep is noticed at all."""
        self.assertEqual(self.snap["technicals"], 2)
        self.assertEqual(self.snap["fundamentals"], 1)

    def test_a_symbol_with_no_name_is_skipped_rather_than_keyed_on_blank(self):
        snap = snapshot.build("X", [{"symbol": ""}, {"symbol": "AAA"}], {}, {}, {})
        self.assertEqual(snap["count"], 1)

    def test_it_survives_every_source_being_empty(self):
        snap = snapshot.build("X", [], None, None, None)
        self.assertEqual(snap["count"], 0)


class ServingTest(unittest.TestCase):
    def setUp(self):
        snapshot._reset_for_tests()
        self.snap = snapshot.build("NIFTY TEST", BuildTest.CONS, BuildTest.TECH, {}, {})

    def tearDown(self):
        snapshot._reset_for_tests()

    def test_a_fresh_snapshot_is_served(self):
        snapshot.put("NIFTY TEST", self.snap)
        self.assertEqual(snapshot.get("NIFTY TEST")["count"], 3)

    def test_an_unknown_universe_is_none(self):
        self.assertIsNone(snapshot.get("NIFTY NOPE"))

    def test_one_too_old_is_not_served(self):
        """Age is checked where it is read, not by each caller — a route that
        forgot to look would otherwise serve last week's closes as today's."""
        stale = dict(self.snap)
        stale["built_at"] = int(snapshot._now() - snapshot.MAX_AGE - 60)
        snapshot.put("NIFTY TEST", stale)
        self.assertIsNone(snapshot.get("NIFTY TEST"))

    def test_the_window_covers_a_missed_build_and_a_weekend(self):
        self.assertGreaterEqual(snapshot.MAX_AGE, 24 * 3600)
        self.assertLessEqual(snapshot.MAX_AGE, 4 * 24 * 3600)

    def test_a_failed_build_keeps_the_previous_snapshot(self):
        """A snapshot from this morning beats no snapshot."""
        snapshot.put("NIFTY TEST", self.snap)
        snapshot.INDICES_BACKUP = list(snapshot.INDICES)
        try:
            snapshot.INDICES[:] = ["NIFTY TEST"]

            def boom(_name):
                raise RuntimeError("upstream down")

            snapshot.run_once(boom)
            self.assertEqual(snapshot.get("NIFTY TEST")["count"], 3)
        finally:
            snapshot.INDICES[:] = snapshot.INDICES_BACKUP

    def test_an_empty_build_also_keeps_the_previous_one(self):
        snapshot.put("NIFTY TEST", self.snap)
        backup = list(snapshot.INDICES)
        try:
            snapshot.INDICES[:] = ["NIFTY TEST"]
            snapshot.run_once(lambda _n: snapshot.build("NIFTY TEST", [], {}, {}, {}))
            self.assertEqual(snapshot.get("NIFTY TEST")["count"], 3)
        finally:
            snapshot.INDICES[:] = backup

    def test_status_reports_enough_to_tell_a_stalled_builder(self):
        snapshot.put("NIFTY TEST", self.snap)
        st = snapshot.status()
        self.assertEqual(st["times_ist"], snapshot.TIMES)
        self.assertIn("NIFTY TEST", st["snapshots"])
        self.assertGreaterEqual(st["snapshots"]["NIFTY TEST"]["age_sec"], 0)
        self.assertGreater(st["next_run_at"], snapshot._now())


try:
    import server
except Exception:                                            # stdlib CI path
    server = None


@unittest.skipUnless(server, "needs Flask")
class RouteTest(unittest.TestCase):
    IP = "161.118.174.177"

    def setUp(self):
        snapshot._reset_for_tests()
        self.client = server.app.test_client()

    def tearDown(self):
        snapshot._reset_for_tests()

    def test_it_404s_rather_than_serving_an_empty_market(self):
        """The client has a working multi-request fallback; a 200 with no rows
        would look like a universe with nothing in it."""
        r = self.client.get("/screener/snapshot?index=NIFTY%20500", headers={"Host": self.IP})
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.json["error"], "no-snapshot")

    def test_a_built_snapshot_is_served_whole(self):
        server._snapshot.put("NIFTY 500", snapshot.build(
            "NIFTY 500", BuildTest.CONS, BuildTest.TECH, BuildTest.FUND, BuildTest.NAMES))
        r = self.client.get("/screener/snapshot?index=NIFTY%20500", headers={"Host": self.IP})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json["count"], 3)
        self.assertEqual(len(r.json["rows"]), 3)
        self.assertEqual(r.json["rows"][0]["rsi"], 61.0)

    def test_it_is_cacheable(self):
        """Identical for everyone and changes twice a day."""
        server._snapshot.put("NIFTY 500", snapshot.build("NIFTY 500", BuildTest.CONS, {}, {}, {}))
        r = self.client.get("/screener/snapshot?index=NIFTY%20500", headers={"Host": self.IP})
        self.assertIn("max-age", r.headers.get("Cache-Control", ""))

    def test_the_status_route_answers_without_a_snapshot(self):
        r = self.client.get("/screener/snapshot/status", headers={"Host": self.IP})
        self.assertEqual(r.status_code, 200)
        self.assertIn("next_run_at", r.json)

    def test_the_builder_is_wired_to_the_schedule(self):
        self.assertTrue(callable(server._build_snapshot))
        self.assertTrue(callable(server.start_snapshots))


if __name__ == "__main__":
    unittest.main()
