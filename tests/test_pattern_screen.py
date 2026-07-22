"""Unit tests for the index-wide chart-pattern screener (pattern_screen.py).

The module takes its constituents / OHLC / detector functions as injected
callables, so these tests run stdlib-only with fakes — no network, no pandas.
"""
import os
import tempfile
import time
import unittest

import pattern_screen as ps


def _candles(n=260, base=100.0):
    out = []
    t0 = int(time.time()) - n * 86400
    for i in range(n):
        px = base + i * 0.1
        out.append({"t": t0 + i * 86400, "o": px, "h": px + 1, "l": px - 1,
                    "c": px, "v": 1000})
    return out


def _pattern(end_index, confidence, ptype="double_bottom", candles=None):
    # Mirrors the real detect() output shape: bar indices are STRIPPED before
    # detections are returned — only start_ts/end_ts timestamps survive. The
    # screener's recency filter must therefore work off end_ts.
    cs = candles or _candles()
    i = max(0, min(end_index, len(cs) - 1))
    return {"type": ptype, "label": "Double Bottom", "bias": "bullish",
            "category": "reversal", "status": "confirmed",
            "confidence": confidence, "continuation": 66,
            "expansion_pct": 5.0, "target": 120.0,
            "start_ts": cs[max(0, i - 30)]["t"], "end_ts": cs[i]["t"]}


class PatternScreenTest(unittest.TestCase):
    def setUp(self):
        # isolate disk cache + state per test
        self._file = ps._FILE
        ps._FILE = os.path.join(tempfile.mkdtemp(), "pattern_screen.json")
        ps._states = {}
        ps._threads = {}

    def tearDown(self):
        ps._FILE = self._file

    def _sweep(self, detect, syms=("AAA", "BBB")):
        rows = [{"symbol": s} for s in syms]
        ps.ensure("NIFTY 50", lambda _n: (rows, "test"),
                  lambda s, p, i: _candles(), detect)
        deadline = time.time() + 10
        while time.time() < deadline:
            snap = ps.snapshot("NIFTY 50")
            if snap["status"] in ("done", "error") and not snap["refreshing"]:
                return snap
            time.sleep(0.05)
        self.fail("sweep never finished")

    def test_fresh_confident_pattern_is_a_hit(self):
        n = len(_candles())
        snap = self._sweep(lambda cs: {"patterns": [_pattern(n - 2, 80)]})
        self.assertEqual(snap["status"], "done")
        self.assertEqual(snap["universe"], 2)
        self.assertEqual(snap["matches"], 2)  # both symbols hit
        hit = snap["results"][0]
        self.assertEqual(hit["label"], "Double Bottom")
        self.assertEqual(hit["bias"], "bullish")
        self.assertGreaterEqual(hit["confidence"], ps.MIN_CONF)
        self.assertIsNotNone(hit["price"])

    def test_stale_or_weak_patterns_are_filtered(self):
        n = len(_candles())
        old = _pattern(n - 100, 90)          # months old
        weak = _pattern(n - 2, ps.MIN_CONF - 5)  # fresh but low confidence
        snap = self._sweep(lambda cs: {"patterns": [old, weak]})
        self.assertEqual(snap["matches"], 0)

    def test_snapshot_survives_reload_from_disk(self):
        n = len(_candles())
        self._sweep(lambda cs: {"patterns": [_pattern(n - 1, 70)]})
        ps._states = {}
        ps._load_disk()
        snap = ps.snapshot("NIFTY 50")
        self.assertEqual(snap["status"], "done")
        self.assertEqual(snap["matches"], 2)

    def test_empty_constituents_is_an_error_not_a_crash(self):
        ps.ensure("NIFTY 50", lambda _n: ([], "test"),
                  lambda s, p, i: [], lambda cs: {"patterns": []})
        deadline = time.time() + 5
        while time.time() < deadline:
            snap = ps.snapshot("NIFTY 50")
            if snap["status"] == "error":
                break
            time.sleep(0.05)
        self.assertEqual(snap["status"], "error")
        self.assertTrue(snap["error"])

    def test_rate_limited_symbols_counted_and_marked_partial(self):
        # Feed refuses every symbol → the sweep must say so (partial, no_data)
        # instead of finishing as a clean "done · 0 hits".
        rows = [{"symbol": s} for s in ("AAA", "BBB", "CCC")]
        calls = []
        def load(sym, p, i):
            calls.append(sym)
            return []
        ps.ensure("NIFTY 50", lambda _n: (rows, "test"), load,
                  lambda cs: {"patterns": []})
        deadline = time.time() + 10
        while time.time() < deadline:
            snap = ps.snapshot("NIFTY 50")
            if snap["status"] == "done" and not snap["refreshing"]:
                break
            time.sleep(0.05)
        self.assertEqual(snap["status"], "done")
        self.assertTrue(snap["partial"])
        self.assertEqual(snap["no_data"], 3)
        self.assertEqual(snap["scanned_ok"], 0)
        # every symbol was retried once after the first refusal
        self.assertEqual(len(calls), 6)

    def test_real_detector_output_shape_produces_hits(self):
        # Regression: detect_patterns() strips bar indices from its output, so
        # the sweep's recency filter must work off end_ts. A synthetic series
        # that oscillates right up to the last bar must produce fresh hits when
        # scanned with the REAL detector (not a fake).
        import math
        import random
        from patterns import detect_patterns
        n = 260
        t0 = int(time.time()) - n * 86400
        random.seed(7)
        cs = []
        for i in range(n):
            if i < 200:
                px = 100 + i * 0.3 + random.uniform(-1, 1)
            else:
                px = 160 + 6 * math.sin((i - 200) * math.pi / 10) + random.uniform(-0.5, 0.5)
            cs.append({"t": t0 + i * 86400, "o": px, "h": px + 1.2,
                       "l": px - 1.2, "c": px, "v": 1000})
        rows = [{"symbol": "AAA"}]
        ps.ensure("NIFTY 50", lambda _n: (rows, "test"),
                  lambda s, p, i: cs, detect_patterns)
        deadline = time.time() + 10
        while time.time() < deadline:
            snap = ps.snapshot("NIFTY 50")
            if snap["status"] in ("done", "error") and not snap["refreshing"]:
                break
            time.sleep(0.05)
        self.assertEqual(snap["status"], "done")
        self.assertGreaterEqual(snap["matches"], 1)
        self.assertTrue(all(h["confidence"] >= ps.MIN_CONF for h in snap["results"]))

    def test_results_sorted_by_confidence(self):
        n = len(_candles())
        def detect(cs):
            return {"patterns": [_pattern(n - 1, 60, "rectangle"),
                                 _pattern(n - 1, 90, "bull_flag")]}
        snap = self._sweep(detect, syms=("AAA",))
        confs = [h["confidence"] for h in snap["results"]]
        self.assertEqual(confs, sorted(confs, reverse=True))


class RecentIposTest(unittest.TestCase):
    """recent_ipos() (mb_screen) — the RECENT IPOS custom index source."""

    def test_only_last_year_and_newest_first(self):
        import mb_screen as mbs
        now = time.time()
        with mbs._lock:
            old_state = mbs._state.get("recent_ipos")
            mbs._state["recent_ipos"] = {
                "NEW1": {"symbol": "NEW1", "listed_ts": int(now - 30 * 86400), "price": 100},
                "NEW2": {"symbol": "NEW2", "listed_ts": int(now - 300 * 86400), "price": 50},
                "OLD": {"symbol": "OLD", "listed_ts": int(now - 400 * 86400), "price": 10},
            }
        try:
            rows = mbs.recent_ipos()
            syms = [r["symbol"] for r in rows]
            self.assertEqual(syms, ["NEW1", "NEW2"])  # OLD aged out, newest first
        finally:
            with mbs._lock:
                mbs._state["recent_ipos"] = old_state
