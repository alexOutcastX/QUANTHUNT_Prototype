"""The scan cache: durable across restarts, and never blocking a read.

This module used to be memory-only and fully blocking, while fundamentals.py
right beside it was disk-backed and non-blocking. The asymmetry was the whole
reason a wide screen crawled: every deploy wiped the technicals and the next
visitor paid a cold sweep of 1447 upstream history fetches through a 4-wide
semaphore, serialised 60 symbols at a time, while the financials on the same
row came straight off disk.

What is pinned here is the shape of the fix, not the indicator maths (that
lives in test_scanner.py): reads are served from cache, misses are queued
rather than waited on, a merely-stale row is shown while it refreshes, and the
cache survives a process restart.
"""
import json
import queue
import os
import tempfile
import threading
import time
import unittest
from unittest import mock

import scanner


def _row(rsi=55.0):
    return {"price": 100.0, "rsi": rsi, "d50": 1.2}


class ScanReadPathTest(unittest.TestCase):
    def setUp(self):
        self._cache = dict(scanner._CACHE)
        self.addCleanup(self._restore)
        # Keep the background pool off the network: an un-stubbed enqueue here
        # reaches for the NIFTY 50 series to compute beta.
        p = mock.patch.object(scanner, "_index_returns", return_value=None)
        p.start()
        self.addCleanup(p.stop)
        scanner._CACHE.clear()
        scanner._inflight.clear()

    def _restore(self):
        scanner._CACHE.clear()
        scanner._CACHE.update(self._cache)
        scanner._inflight.clear()

    def test_a_fresh_row_is_served_and_nothing_is_queued(self):
        scanner._CACHE["AAA"] = (time.time(), _row())
        with mock.patch.object(scanner, "enqueue") as q:
            res = scanner.scan(["AAA"])
        self.assertEqual(res["data"]["AAA"]["rsi"], 55.0)
        self.assertEqual(res["pending"], [])
        q.assert_called_once_with([])

    def test_a_miss_returns_immediately_and_names_itself_pending(self):
        """THE point of the change. A cold symbol must not hold the request
        open — it comes back in `pending` and is computed behind the response."""
        with mock.patch.object(scanner, "_compute_row",
                               side_effect=AssertionError("scan() blocked on the network")):
            res = scanner.scan(["COLD"])
        self.assertEqual(res["data"], {})
        self.assertEqual(res["pending"], ["COLD"])

    def test_a_miss_is_queued_for_the_background_pool(self):
        with mock.patch.object(scanner, "enqueue") as q:
            scanner.scan(["COLD"])
        q.assert_called_once_with(["COLD"])

    def test_a_stale_row_is_served_now_and_refreshed_behind(self):
        """Daily-bar indicators: a fifteen-minute-old RSI beats an em-dash."""
        scanner._CACHE["AAA"] = (time.time() - scanner._TTL - 60, _row(31.0))
        with mock.patch.object(scanner, "enqueue") as q:
            res = scanner.scan(["AAA"])
        self.assertEqual(res["data"]["AAA"]["rsi"], 31.0, "a usable row was withheld")
        self.assertEqual(res["pending"], [], "a served row must not also be pending")
        self.assertEqual(res["stale"], 1)
        q.assert_called_once_with(["AAA"])

    def test_a_row_older_than_the_stale_bound_is_withheld(self):
        """Past this it is not 'slightly old', it is a previous session — which
        would be actively misleading rather than merely imprecise."""
        scanner._CACHE["AAA"] = (time.time() - scanner._STALE_MAX - 60, _row())
        with mock.patch.object(scanner, "enqueue"):
            res = scanner.scan(["AAA"])
        self.assertEqual(res["data"], {})
        self.assertEqual(res["pending"], ["AAA"])

    def test_a_symbol_that_just_failed_is_not_retried_immediately(self):
        scanner._CACHE["DEAD"] = (time.time(), None)
        with mock.patch.object(scanner, "enqueue") as q:
            res = scanner.scan(["DEAD"])
        self.assertEqual(res["pending"], ["DEAD"])
        q.assert_called_once_with([])       # cooling off — not re-queued

    def test_the_failure_cooloff_expires(self):
        scanner._CACHE["DEAD"] = (time.time() - scanner._NEG_TTL - 5, None)
        with mock.patch.object(scanner, "enqueue") as q:
            scanner.scan(["DEAD"])
        q.assert_called_once_with(["DEAD"])

    def test_symbols_are_normalised(self):
        scanner._CACHE["AAA"] = (time.time(), _row())
        res = scanner.scan([" aaa ", "", None])
        self.assertIn("AAA", res["data"])

    def test_the_request_cap_is_wide_enough_for_a_whole_universe_in_a_few_calls(self):
        """The old cap of 60 existed because every miss was computed inline. It
        made ALL MARKETS 121 round trips; a cache read does not need that."""
        self.assertGreaterEqual(scanner.MAX_SYMBOLS, 500)

    def test_the_cap_is_still_enforced(self):
        with mock.patch.object(scanner, "enqueue"):
            res = scanner.scan([f"S{i}" for i in range(scanner.MAX_SYMBOLS + 50)])
        self.assertEqual(len(res["pending"]), scanner.MAX_SYMBOLS)


class BlockingModeTest(unittest.TestCase):
    def setUp(self):
        scanner._CACHE.clear()
        scanner._inflight.clear()

    def test_wait_true_computes_inline(self):
        """The warm loop has nobody waiting on it and exists to do this work."""
        with mock.patch.object(scanner, "_compute_row", return_value=_row(70.0)), \
             mock.patch.object(scanner, "_index_returns", return_value=None):
            res = scanner.scan(["AAA"], wait=True)
        self.assertEqual(res["data"]["AAA"]["rsi"], 70.0)
        self.assertEqual(res["pending"], [])

    def test_wait_true_still_reports_a_symbol_it_could_not_compute(self):
        with mock.patch.object(scanner, "_compute_row", return_value=None), \
             mock.patch.object(scanner, "_index_returns", return_value=None):
            res = scanner.scan(["AAA"], wait=True)
        self.assertEqual(res["data"], {})
        self.assertEqual(res["pending"], ["AAA"])


class EnqueueTest(unittest.TestCase):
    def setUp(self):
        scanner._inflight.clear()
        self.addCleanup(scanner._inflight.clear)

    def test_a_symbol_already_running_is_not_resubmitted(self):
        """A polling client re-asks for its pending list every couple of
        seconds; without this the queue fills with duplicates of work already
        in progress and the real backlog never drains."""
        q = queue.Queue(maxsize=100)
        with mock.patch.object(scanner, "_queue", q), \
             mock.patch.object(scanner, "_start_workers"):
            self.assertEqual(scanner.enqueue(["AAA", "BBB"]), ["AAA", "BBB"])
            self.assertEqual(scanner.enqueue(["AAA", "CCC"]), ["CCC"])
        self.assertEqual([q.get() for _ in range(3)], ["AAA", "BBB", "CCC"])

    def test_the_queue_is_bounded(self):
        """Unbounded, one visitor opening ALL MARKETS parks every later
        visitor's symbols behind a 1447-deep backlog."""
        q = queue.Queue(maxsize=5)
        with mock.patch.object(scanner, "_queue", q), \
             mock.patch.object(scanner, "_start_workers"):
            taken = scanner.enqueue([f"S{i}" for i in range(50)])
        self.assertEqual(len(taken), 5, "the queue bound was not enforced")
        # Dropped symbols must not be left marked in-flight, or they can never
        # be queued again and stay pending forever.
        self.assertEqual(len(scanner._inflight), 5)

    def test_the_pool_is_not_wider_than_the_upstream_gate(self):
        """More threads here buys no more concurrency — ydata's semaphore is
        the real ceiling — it only steals workers from serving requests."""
        import ydata
        self.assertLessEqual(scanner._POOL_SIZE, max(4, ydata._MAX))

    def test_workers_are_daemons(self):
        """A ThreadPoolExecutor joins its threads at exit, so a deep queue
        turns every gunicorn restart into a wait for the backlog to drain —
        and the cache flush never runs."""
        scanner._start_workers()
        live = [t for t in threading.enumerate() if t.name.startswith("scan-")]
        self.assertTrue(live, "no scan workers running")
        self.assertTrue(all(t.daemon for t in live), "a non-daemon worker blocks shutdown")

    def test_a_completed_symbol_leaves_the_inflight_set(self):
        with mock.patch.object(scanner, "_compute_row", return_value=_row()), \
             mock.patch.object(scanner, "_index_returns", return_value=None):
            scanner._inflight.add("AAA")
            scanner._compute_into_cache("AAA")
        self.assertNotIn("AAA", scanner._inflight, "a leak here wedges the symbol forever")

    def test_a_failed_symbol_also_leaves_the_inflight_set(self):
        with mock.patch.object(scanner, "_compute_row", side_effect=RuntimeError("upstream")), \
             mock.patch.object(scanner, "_index_returns", return_value=None):
            scanner._inflight.add("AAA")
            self.assertIsNone(scanner._compute_into_cache("AAA"))
        self.assertNotIn("AAA", scanner._inflight)


class PersistenceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.path = os.path.join(self.tmp, "scan_cache.json")
        self._file = scanner._FILE
        scanner._FILE = self.path
        self._cache = dict(scanner._CACHE)
        scanner._CACHE.clear()
        self.addCleanup(self._restore)

    def _restore(self):
        scanner._FILE = self._file
        scanner._CACHE.clear()
        scanner._CACHE.update(self._cache)

    def test_a_round_trip_survives_a_restart(self):
        """The whole reason technicals reset to zero on every deploy."""
        scanner._CACHE["AAA"] = (time.time(), _row(44.0))
        scanner._save()
        scanner._CACHE.clear()
        scanner._load()
        self.assertEqual(scanner._CACHE["AAA"][1]["rsi"], 44.0)

    def test_a_restored_row_is_served_without_a_network_call(self):
        scanner._CACHE["AAA"] = (time.time(), _row(44.0))
        scanner._save()
        scanner._CACHE.clear()
        scanner._load()
        with mock.patch.object(scanner, "_compute_row",
                               side_effect=AssertionError("recomputed a restored row")):
            res = scanner.scan(["AAA"])
        self.assertEqual(res["data"]["AAA"]["rsi"], 44.0)

    def test_failures_are_not_persisted(self):
        """A None row carries a 45s cool-off. On disk it would outlive that by
        days and silently blank the symbol."""
        scanner._CACHE["DEAD"] = (time.time(), None)
        scanner._CACHE["AAA"] = (time.time(), _row())
        scanner._save()
        with open(self.path) as f:
            disk = json.load(f)
        self.assertIn("AAA", disk["rows"])
        self.assertNotIn("DEAD", disk["rows"])

    def test_rows_past_the_stale_bound_are_not_restored(self):
        scanner._CACHE["OLD"] = (time.time() - scanner._STALE_MAX - 60, _row())
        scanner._CACHE["NEW"] = (time.time(), _row())
        scanner._save()
        scanner._CACHE.clear()
        scanner._load()
        self.assertIn("NEW", scanner._CACHE)
        self.assertNotIn("OLD", scanner._CACHE)

    def test_a_corrupt_file_is_a_cold_start_not_a_crash(self):
        with open(self.path, "w") as f:
            f.write("{ this is not json")
        scanner._load()          # must not raise
        self.assertEqual(scanner._CACHE, {})

    def test_a_missing_file_is_a_cold_start(self):
        os.unlink(self.path) if os.path.exists(self.path) else None
        scanner._load()
        self.assertEqual(scanner._CACHE, {})

    def test_the_write_is_atomic(self):
        """A kill mid-write must not leave a truncated file that _load then
        discards — taking the whole cache with it."""
        scanner._CACHE["AAA"] = (time.time(), _row())
        scanner._save()
        first = open(self.path).read()
        with mock.patch.object(scanner.json, "dump", side_effect=RuntimeError("disk full")):
            scanner._save()
        self.assertEqual(open(self.path).read(), first, "a failed write clobbered the cache")
        self.assertFalse(os.path.exists(self.path + ".tmp"), "temp file left behind")


class ConcurrencyTest(unittest.TestCase):
    def test_reads_and_writes_do_not_race(self):
        scanner._CACHE.clear()
        stop = threading.Event()

        def writer():
            i = 0
            while not stop.is_set():
                with scanner._CACHE_LOCK:
                    scanner._CACHE[f"S{i % 50}"] = (time.time(), _row())
                i += 1

        t = threading.Thread(target=writer, daemon=True)
        t.start()
        try:
            for _ in range(200):
                with mock.patch.object(scanner, "enqueue"):
                    scanner.scan([f"S{i}" for i in range(50)])
                scanner._save()
        finally:
            stop.set()
            t.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
