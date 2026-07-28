"""Fundamentals warm sweep: progress accounting, cancellation and the routes.

The sweep is what makes the valuation/growth filters answer instantly instead
of the first visitor paying for ~1500 cold scrapes, and the developer portal
reads its progress verbatim — so the counters have to be honest, especially
after a stop.
"""
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import fundamentals as F


class WarmProgressTest(unittest.TestCase):
    def setUp(self):
        # Isolate from any sweep a previous test (or import) left behind.
        with F._warm_lock:
            F._warm.update({
                "running": False, "cancel": False,
                "total": 0, "done": 0, "ok": 0, "failed": 0, "skipped": 0,
                "started": 0.0, "updated": 0.0, "finished": 0.0,
                "universe": "", "last_error": "",
            })

    def test_idle_snapshot_is_zeroed_and_safe(self):
        p = F.warm_progress()
        self.assertFalse(p["running"])
        self.assertEqual(p["pct"], 0.0)
        self.assertEqual(p["total"], 0)
        self.assertIsNone(p["eta_sec"])          # no division by zero
        self.assertEqual(p["schema"], F.SCHEMA_V)
        self.assertEqual(p["workers"], F.WARM_WORKERS)

    def test_pct_rate_and_eta(self):
        with F._warm_lock:
            F._warm.update({"running": True, "total": 100, "done": 25,
                            "started": time.time() - 10, "updated": time.time()})
        p = F.warm_progress()
        self.assertEqual(p["pct"], 25.0)
        # 25 symbols in ~10 s → ~150/min, 75 left → ~30 s
        self.assertGreater(p["rate_per_min"], 100)
        self.assertLess(p["rate_per_min"], 200)
        self.assertGreater(p["eta_sec"], 15)
        self.assertLess(p["eta_sec"], 60)

    def test_elapsed_tracks_wall_clock_while_running(self):
        """A stalled provider must not freeze the ETA: `updated` can be stale,
        so elapsed is measured against now, not against the last symbol."""
        with F._warm_lock:
            F._warm.update({"running": True, "total": 100, "done": 10,
                            "started": time.time() - 30,
                            "updated": time.time() - 25})   # nothing for 25 s
        self.assertGreaterEqual(F.warm_progress()["elapsed_sec"], 29)

    def test_finished_sweep_freezes_elapsed(self):
        fin = time.time() - 5
        with F._warm_lock:
            F._warm.update({"running": False, "total": 10, "done": 10,
                            "started": fin - 20, "updated": fin, "finished": fin})
        p = F.warm_progress()
        self.assertEqual(p["elapsed_sec"], 20)   # not 25 — the clock stopped
        self.assertEqual(p["pct"], 100.0)

    def test_cache_counters_come_from_the_live_cache(self):
        with F._lock:
            F._cache["WARMTEST"] = {"data": {"pe": 10}, "ts": time.time(), "v": F.SCHEMA_V}
        try:
            p = F.warm_progress()
            self.assertGreaterEqual(p["cache_size"], 1)
            self.assertGreaterEqual(p["cache_fresh"], 1)
        finally:
            with F._lock:
                F._cache.pop("WARMTEST", None)


class WarmRunTest(unittest.TestCase):
    def setUp(self):
        self._real = F._fetch_one
        # A finished sweep calls _save(), which would otherwise write these
        # synthetic symbols into the developer's real fund_cache.json.
        self._tmp = tempfile.mkdtemp()
        self._real_file = F._FILE
        F._FILE = os.path.join(self._tmp, "fund_cache.json")
        with F._warm_lock:
            F._warm.update({"running": False, "cancel": False, "total": 0, "done": 0,
                            "ok": 0, "failed": 0, "skipped": 0, "started": 0.0,
                            "updated": 0.0, "finished": 0.0, "universe": "",
                            "last_error": ""})

    def tearDown(self):
        F._fetch_one = self._real
        F._FILE = self._real_file
        shutil.rmtree(self._tmp, ignore_errors=True)
        for s in ("AAA", "BBB", "CCC", "FRESH", "BOOM"):
            with F._lock:
                F._cache.pop(s, None)

    def _wait(self, timeout=5.0):
        end = time.time() + timeout
        while time.time() < end:
            if not F.warm_progress()["running"]:
                return True
            time.sleep(0.02)
        return False

    def test_sweep_populates_the_cache_and_counts_ok(self):
        def fake(sym, gap_fill=True):
            with F._lock:
                F._cache[sym] = {"data": {"pe": 12.0}, "ts": time.time(), "v": F.SCHEMA_V}
                F._inflight.discard(sym)
        F._fetch_one = fake

        started = F.warm_start(["AAA", "BBB", "CCC"], "TESTIDX")
        self.assertTrue(started["started"])
        self.assertEqual(started["total"], 3)
        self.assertTrue(self._wait(), "sweep did not finish")

        p = F.warm_progress()
        self.assertEqual((p["done"], p["ok"], p["failed"]), (3, 3, 0))
        self.assertEqual(p["universe"], "TESTIDX")
        self.assertEqual(p["pct"], 100.0)
        with F._lock:
            self.assertIn("AAA", F._cache)

    def test_already_fresh_symbols_are_skipped_not_refetched(self):
        calls = []
        F._fetch_one = lambda s, gap_fill=True: calls.append(s)
        with F._lock:
            F._cache["FRESH"] = {"data": {"pe": 9}, "ts": time.time(), "v": F.SCHEMA_V}

        F.warm_start(["FRESH"], "TESTIDX")
        self.assertTrue(self._wait())
        self.assertEqual(calls, [])
        p = F.warm_progress()
        self.assertEqual((p["skipped"], p["done"], p["ok"]), (1, 1, 0))

    def test_one_bad_symbol_does_not_stop_the_sweep(self):
        def fake(sym, gap_fill=True):
            if sym == "BOOM":
                raise RuntimeError("provider exploded")
            with F._lock:
                F._cache[sym] = {"data": {"pe": 1.0}, "ts": time.time(), "v": F.SCHEMA_V}
                F._inflight.discard(sym)
        F._fetch_one = fake

        F.warm_start(["AAA", "BOOM", "BBB"], "TESTIDX")
        self.assertTrue(self._wait())
        p = F.warm_progress()
        self.assertEqual(p["done"], 3)
        self.assertEqual(p["failed"], 1)
        self.assertEqual(p["ok"], 2)
        self.assertIn("BOOM", p["last_error"])
        with F._lock:                       # and it must not leak an inflight slot
            self.assertNotIn("BOOM", F._inflight)

    def test_empty_result_counts_as_failed_not_ok(self):
        def fake(sym, gap_fill=True):
            with F._lock:
                F._cache[sym] = {"data": {}, "ts": time.time(), "v": F.SCHEMA_V}
                F._inflight.discard(sym)
        F._fetch_one = fake
        F.warm_start(["AAA"], "TESTIDX")
        self.assertTrue(self._wait())
        p = F.warm_progress()
        self.assertEqual((p["ok"], p["failed"]), (0, 1))

    def test_stop_leaves_done_below_total(self):
        """A stopped sweep must read 'stopped at N/total', never as complete —
        the portal decides between the two by comparing done to total."""
        def slow(sym, gap_fill=True):
            time.sleep(0.05)
            with F._lock:
                F._cache[sym] = {"data": {"pe": 1.0}, "ts": time.time(), "v": F.SCHEMA_V}
                F._inflight.discard(sym)
        F._fetch_one = slow

        syms = ["S%03d" % i for i in range(200)]
        F.warm_start(syms, "TESTIDX")
        time.sleep(0.15)
        self.assertTrue(F.warm_stop()["stopping"])
        self.assertTrue(self._wait(timeout=10))

        p = F.warm_progress()
        self.assertTrue(p["cancel"])
        self.assertFalse(p["running"])
        self.assertLess(p["done"], p["total"])
        for s in syms:
            with F._lock:
                F._cache.pop(s, None)

    def test_second_start_is_refused_while_one_runs(self):
        def slow(sym, gap_fill=True):
            time.sleep(0.05)
            with F._lock:
                F._inflight.discard(sym)
        F._fetch_one = slow
        syms = ["T%03d" % i for i in range(100)]
        F.warm_start(syms, "TESTIDX")
        try:
            second = F.warm_start(["AAA"], "OTHER")
            self.assertFalse(second["started"])
            self.assertIn("already running", second["reason"])
        finally:
            F.warm_stop()
            self._wait(timeout=10)
            for s in syms:
                with F._lock:
                    F._cache.pop(s, None)

    def test_sweep_does_not_run_the_yfinance_gap_fill(self):
        """The gap-fill calls yfinance .info, and every Yahoo request in this
        process shares one semaphore of 4 with the scanner. A universe sweep
        holding it blanks the live prices — which is exactly what happened in
        production. The sweep must ask for exchange data only."""
        seen = []

        def fake(sym, gap_fill=True):
            seen.append(gap_fill)
            with F._lock:
                F._cache[sym] = {"data": {"pe": 1.0}, "ts": time.time(),
                                 "v": F.SCHEMA_V, "gap": False}
                F._inflight.discard(sym)
        F._fetch_one = fake
        F.warm_start(["AAA", "BBB"], "TESTIDX")
        self.assertTrue(self._wait())
        self.assertEqual(seen, [False, False])

    def test_blank_symbols_are_dropped_and_case_normalised(self):
        seen = []
        F._fetch_one = lambda s, gap_fill=True: seen.append(s)
        F.warm_start(["aaa", "", "  ", " bbb "], "TESTIDX")
        self.assertTrue(self._wait())
        self.assertEqual(sorted(seen), ["AAA", "BBB"])


class ProviderChainTest(unittest.TestCase):
    """screener.in is a derived source and its terms do not allow automated
    access. The exchanges publish the same numbers first-hand, so nothing may
    reach for it on its own — pin that so it cannot drift back in."""

    def test_default_chain_excludes_screener(self):
        self.assertNotIn("screener", F._provider_chain())

    def test_default_chain_still_has_yfinance(self):
        self.assertIn("yfinance", F._provider_chain())

    def test_explicit_opt_in_still_works(self):
        real = F.FUND_SOURCE
        try:
            F.FUND_SOURCE = "screener,yfinance"
            self.assertEqual(F._provider_chain(), ["screener", "yfinance"])
        finally:
            F.FUND_SOURCE = real


class WarmRouteTest(unittest.TestCase):
    """The routes are owner-gated — an unauthenticated caller must not be able
    to kick off a 1500-symbol scrape."""

    @classmethod
    def setUpClass(cls):
        try:
            import server  # noqa: F401
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        cls.client = server.app.test_client()

    def test_status_requires_owner(self):
        self.assertIn(self.client.get("/fundamentals/warm").status_code, (401, 403))

    def test_start_requires_owner(self):
        self.assertIn(self.client.post("/fundamentals/warm", json={"scope": "ALL"}).status_code,
                      (401, 403))

    def test_stop_requires_owner(self):
        self.assertIn(self.client.post("/fundamentals/warm/stop").status_code, (401, 403))

    def test_scope_resolution_rejects_unknown_index(self):
        syms, label = self.server._warm_symbols("NOT AN INDEX")
        self.assertEqual(syms, [])
        self.assertEqual(label, "NOT AN INDEX")

    def test_scope_all_is_the_default(self):
        for scope in ("", "ALL", "all", "universe"):
            _syms, label = self.server._warm_symbols(scope)
            self.assertEqual(label, "ALL NSE")

    def test_scope_all_excludes_bse_only_scrips(self):
        """The provider chain is NSE-symbol keyed, and a cached empty result is
        'fresh' for the full TTL — so BSE-only scrips must never enter a sweep."""
        items = self.server.get_universe() or []
        if not any(x.get("exchange") == "BSE" for x in items):
            self.skipTest("universe has no BSE rows in this environment")
        syms, _label = self.server._warm_symbols("ALL")
        nse = {x["symbol"] for x in items if x.get("exchange") == "NSE"}
        self.assertTrue(syms)
        self.assertTrue(set(syms) <= nse)


if __name__ == "__main__":
    unittest.main()
