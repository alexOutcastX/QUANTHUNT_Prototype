"""Unit tests for the historical replay that seeds the track record.

The replay decides what the Historic page shows on day one, so the rules that
stop it flattering itself — no look-ahead, next-open fills, stop-first when a
bar covers both levels — are pinned here.
"""
import importlib
import os
import tempfile
import time
import unittest

DAY = 86400

try:                      # the replay itself needs pandas + ta; walk_forward does not
    import pandas  # noqa: F401
    import ta      # noqa: F401
    HAVE_FRAMES = True
except Exception:
    HAVE_FRAMES = False


def _c(t, o, h, l, close, v=1e6):
    return {"t": t, "o": o, "h": h, "l": l, "c": close, "v": v}


def _series(prices, start=1_700_000_000, spread=0.0):
    """Flat-ish bars at the given closes, with an optional high/low spread."""
    return [_c(start + i * DAY, p, p + spread, p - spread, p) for i, p in enumerate(prices)]


class WalkForwardTest(unittest.TestCase):
    def setUp(self):
        import backfill
        self.b = importlib.reload(backfill)

    def test_target_settles_at_the_target(self):
        candles = _series([100, 105, 130, 140])
        res = self.b.walk_forward(candles, 0, 100, 90, 120, 60)
        self.assertEqual(res[0], "won")
        self.assertEqual(res[1], 120)                 # not the 130 print
        self.assertEqual(res[2], candles[2]["t"])

    def test_stop_settles_at_the_stop(self):
        candles = _series([100, 95, 80, 70])
        res = self.b.walk_forward(candles, 0, 100, 90, 130, 60)
        self.assertEqual((res[0], res[1]), ("lost", 90))
        self.assertEqual(res[2], candles[2]["t"])

    def test_a_bar_covering_both_levels_is_a_stop_out(self):
        """Daily data can't order intrabar moves, so the replay resolves the
        ambiguity against itself — otherwise every whipsaw reads as a win."""
        candles = [_c(0, 100, 100, 100, 100), _c(DAY, 100, 200, 50, 120)]
        res = self.b.walk_forward(candles, 0, 100, 90, 150, 60)
        self.assertEqual(res[0], "lost")

    def test_horizon_closes_at_the_market(self):
        candles = _series([100] * 10)
        res = self.b.walk_forward(candles, 0, 100, 50, 500, 5)
        self.assertEqual(res[0], "closed")
        self.assertEqual(res[1], 100)

    def test_still_running_returns_none(self):
        res = self.b.walk_forward(_series([100, 101, 102]), 0, 100, 50, 500, 365)
        self.assertIsNone(res)

    def test_a_trade_with_no_stop_cannot_be_stopped_out(self):
        """Momentum publishes no stop; the replay must not invent one."""
        candles = _series([100, 40, 30])
        res = self.b.walk_forward(candles, 0, 100, None, 500, 365)
        self.assertIsNone(res)

    def test_a_trade_with_no_target_runs_to_horizon(self):
        candles = _series([100] * 6)
        res = self.b.walk_forward(candles, 0, 100, None, None, 3)
        self.assertEqual(res[0], "closed")

    def test_short_side_is_inverted(self):
        candles = _series([100, 95, 85])
        res = self.b.walk_forward(candles, 0, 100, 110, 90, 60, side="short")
        self.assertEqual((res[0], res[1]), ("won", 90))

    def test_settlement_never_looks_before_the_entry_bar(self):
        """A dip that happened before the trade opened must not stop it out."""
        candles = _series([50, 100, 101, 102])
        res = self.b.walk_forward(candles, 1, 100, 90, 500, 365)
        self.assertIsNone(res)

    def test_start_past_the_end(self):
        self.assertIsNone(self.b.walk_forward(_series([100]), 5, 100, 90, 110, 30))


@unittest.skipUnless(HAVE_FRAMES, "pandas/ta not installed in this environment")
class ToCandlesTest(unittest.TestCase):
    def setUp(self):
        import backfill
        self.b = importlib.reload(backfill)

    def test_frame_becomes_chronological_candles(self):
        pd = __import__("pandas")
        idx = pd.date_range("2025-01-01", periods=4, freq="D")
        df = pd.DataFrame({"Open": [1, 2, 3, 4], "High": [2, 3, 4, 5], "Low": [0.5, 1, 2, 3],
                           "Close": [1.5, 2.5, 3.5, 4.5], "Volume": [10, 20, 30, 40]}, index=idx)
        cs = self.b.to_candles(df)
        self.assertEqual(len(cs), 4)
        self.assertEqual(cs[0]["c"], 1.5)
        self.assertEqual([c["t"] for c in cs], sorted(c["t"] for c in cs))


@unittest.skipUnless(HAVE_FRAMES, "pandas/ta not installed in this environment")
class ReplayTest(unittest.TestCase):
    """The replay end to end, against a frame built to trigger a signal."""

    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        os.environ["DB_PATH"] = self.tmp.name
        import store
        importlib.reload(store)
        import tradelog
        self.t = importlib.reload(tradelog)
        import backfill
        self.b = importlib.reload(backfill)

    def tearDown(self):
        try:
            os.unlink(self.tmp.name)
        except OSError:
            pass
        os.environ.pop("DB_PATH", None)

    def _uptrend(self, n=320):
        pd = __import__("pandas")
        idx = pd.date_range("2024-06-03", periods=n, freq="B")
        p = [100.0]
        for i in range(1, n):
            p.append(p[-1] * 1.004)
        return pd.DataFrame({"Open": [x * 0.999 for x in p], "High": [x * 1.01 for x in p],
                             "Low": [x * 0.99 for x in p], "Close": p,
                             "Volume": [1e6] * n}, index=idx)

    def test_replay_writes_backfilled_trades(self):
        res = self.b.replay_symbol("UP", self._uptrend(), "Uptrend Co", days=25)
        self.assertGreater(res["opened"], 0)
        led = self.t.ledger()
        self.assertEqual(led["by_origin"]["live"], 0)
        self.assertEqual(led["by_origin"]["backfilled"], led["summary"]["total"])
        self.assertTrue(all(t["backfilled"] for t in led["trades"]))

    def test_a_repeating_signal_is_one_trade_not_thirty(self):
        """A steady uptrend fires the same setup every single day. If each one
        opened a trade the record would be thirty copies of one call."""
        self.b.replay_symbol("UP", self._uptrend(), None, days=30)
        per_source = {}
        for t in self.t.ledger()["trades"]:
            per_source[t["source"]] = per_source.get(t["source"], 0) + 1
        for source, n in per_source.items():
            self.assertLess(n, 12, f"{source} opened {n} trades in 30 days")

    def test_entries_fill_at_a_tradeable_price(self):
        """The entry must be a bar the signal did not see — you cannot buy at
        the close that produced it."""
        df = self._uptrend()
        self.b.replay_symbol("UP", df, None, days=20)
        closes = {round(float(c), 2) for c in df["Close"]}
        for t in self.t.ledger()["trades"]:
            self.assertNotIn(round(t["entry"], 2), closes)

    def test_replay_is_deterministic(self):
        df = self._uptrend()
        a = self.b.replay_symbol("UP", df, None, days=20)
        self.t.store.execute("DELETE FROM tradelog")
        b = self.b.replay_symbol("UP", df, None, days=20)
        self.assertEqual(a, b)

    def test_short_history_is_skipped(self):
        pd = __import__("pandas")
        idx = pd.date_range("2025-01-01", periods=30, freq="B")
        df = pd.DataFrame({"Open": [100] * 30, "High": [101] * 30, "Low": [99] * 30,
                           "Close": [100] * 30, "Volume": [1e6] * 30}, index=idx)
        self.assertEqual(self.b.replay_symbol("SHORT", df, None), {"opened": 0, "settled": 0})

    def test_progress_reports_a_percentage(self):
        p = self.b.progress()
        self.assertIn("pct", p)
        self.assertFalse(p["running"])


if __name__ == "__main__":
    unittest.main()
