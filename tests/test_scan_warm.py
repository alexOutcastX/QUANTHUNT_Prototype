"""Unit tests for the VM-side scan warm loop.

The warm cache is what makes the screener paint instantly instead of computing
technicals per visit, so its coverage and — more importantly — its pacing are
pinned here. An unpaced sweep would starve the interactive requests it exists
to accelerate, which is a failure this codebase has already had once.
"""
import os
import unittest
from unittest import mock

try:
    import server
except Exception as e:                       # flask absent on the stdlib CI path
    server = None
    _why = str(e)


@unittest.skipUnless(server, "server import unavailable")
class ScanWarmTest(unittest.TestCase):
    def test_default_covers_more_than_one_index(self):
        """NIFTY 50 alone left every wider universe computing live."""
        names = [n.strip() for n in server.SCAN_WARM.split(",") if n.strip()]
        self.assertGreaterEqual(len(names), 2, server.SCAN_WARM)
        self.assertIn("NIFTY 50", names)

    def test_every_configured_index_is_resolvable(self):
        """A typo'd index name would silently warm nothing."""
        for name in [n.strip() for n in server.SCAN_WARM.split(",") if n.strip()]:
            self.assertIn(name.upper(), server.NSE_INDEX_MAP, f"unknown index {name!r}")

    def test_chunk_stays_within_the_scan_cap(self):
        """scanner.scan() silently truncates past 60, so a bigger chunk would
        drop symbols from the warm set without any error."""
        self.assertLessEqual(server.SCAN_WARM_CHUNK, 60)
        self.assertGreater(server.SCAN_WARM_CHUNK, 0)

    def test_cycle_is_shorter_than_the_row_ttl(self):
        """A warmed row must still be fresh when the next user arrives."""
        import scanner
        self.assertLess(server.SCAN_WARM_CYCLE, scanner._TTL)

    def test_pause_between_chunks_is_non_zero(self):
        self.assertGreater(server.SCAN_WARM_PAUSE, 0)

    def test_loop_chunks_and_paces(self):
        """Walk one cycle with the network and clock stubbed: every symbol is
        warmed, in bounded chunks, with a pause after each."""
        syms = [f"S{i}" for i in range(130)]
        scanned, sleeps = [], []

        def fake_scan(chunk):
            scanned.append(list(chunk))
            return {"count": len(chunk), "computed": len(chunk), "cached": 0}

        # Break out of the infinite loop once the cycle sleep is reached.
        class Done(Exception):
            pass

        def fake_sleep(s):
            sleeps.append(s)
            if len(sleeps) > 1 and s >= 30:      # the end-of-cycle sleep
                raise Done

        with mock.patch.object(server, "_warm_index_symbols", return_value=syms), \
             mock.patch.object(server, "SCAN_WARM", "NIFTY 50"), \
             mock.patch.object(server._scanner, "scan", side_effect=fake_scan), \
             mock.patch.object(server.time, "sleep", side_effect=fake_sleep):
            with self.assertRaises(Done):
                server._warm_scan_loop()

        self.assertEqual(len(scanned), 3, "130 symbols should warm in 3 chunks of 60")
        self.assertTrue(all(len(c) <= server.SCAN_WARM_CHUNK for c in scanned))
        self.assertEqual(sum(len(c) for c in scanned), len(syms), "symbols were dropped")
        self.assertEqual(sorted(s for c in scanned for s in c), sorted(syms))
        # One settle sleep, one pause per chunk, then the cycle sleep.
        self.assertIn(server.SCAN_WARM_PAUSE, sleeps)
        self.assertGreaterEqual(sleeps.count(server.SCAN_WARM_PAUSE), 3)

    def test_a_failing_index_does_not_stop_the_others(self):
        seen = []

        class Done(Exception):
            pass

        def flaky(name):
            seen.append(name)
            if name == "NIFTY 50":
                raise RuntimeError("index feed down")
            return ["A"]

        def fake_sleep(s):
            if s >= 30 and seen:
                raise Done

        with mock.patch.object(server, "_warm_index_symbols", side_effect=flaky), \
             mock.patch.object(server, "SCAN_WARM", "NIFTY 50,NIFTY 100"), \
             mock.patch.object(server._scanner, "scan",
                               return_value={"count": 1, "computed": 1, "cached": 0}), \
             mock.patch.object(server.time, "sleep", side_effect=fake_sleep):
            with self.assertRaises(Done):
                server._warm_scan_loop()

        self.assertEqual(seen, ["NIFTY 50", "NIFTY 100"], "a bad index aborted the cycle")

    def test_warm_is_disablable(self):
        """An operator must be able to turn the sweep off entirely."""
        started = []
        with mock.patch.object(server.threading, "Thread",
                               side_effect=lambda **kw: started.append(kw) or mock.MagicMock()):
            for off in ("0", "off", "false", "no", ""):
                with mock.patch.object(server, "SCAN_WARM", off):
                    server.start_scan_warm()
        self.assertEqual(started, [], "warm loop started despite being disabled")


if __name__ == "__main__":
    unittest.main()
