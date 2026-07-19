"""Unit tests for the resilient yfinance wrapper (ydata) — pure stdlib.

These exercise the retry / rate-limit / None-on-failure contract without any
network by injecting a fake yfinance module handle and neutering the backoff
sleep.
"""
import unittest

import ydata


class _FakeTicker:
    def __init__(self, symbol, script):
        self.symbol = symbol
        self._script = script  # list of results/exceptions, consumed per call

    def _next(self):
        r = self._script.pop(0) if self._script else None
        if isinstance(r, Exception):
            raise r
        return r

    @property
    def info(self):
        return self._next()

    def history(self, *a, **k):
        return self._next()


class _FakeDF:
    def __init__(self, empty=False):
        self.empty = empty


class _FakeYF:
    def __init__(self, scripts):
        self._scripts = scripts  # symbol -> list

    def Ticker(self, symbol):
        # Share the same script list across Ticker() calls — ydata builds a fresh
        # Ticker on every retry attempt, so the script must advance across them.
        return _FakeTicker(symbol, self._scripts.setdefault(symbol, []))


class YDataTest(unittest.TestCase):
    def setUp(self):
        self._saved_yf = ydata._yf
        self._saved_backoff = ydata._backoff
        ydata._backoff = lambda *a, **k: None  # no real sleeping in tests

    def tearDown(self):
        ydata._yf = self._saved_yf
        ydata._backoff = self._saved_backoff

    # ---- rate-limit detection ----
    def test_is_rate_limit_matches(self):
        for msg in ("HTTP 429", "Too Many Requests", "rate limit hit", "YFRateLimitError"):
            self.assertTrue(ydata.is_rate_limit(Exception(msg)), msg)

    def test_is_rate_limit_ignores_other(self):
        for msg in ("connection reset", "no data", "404 not found"):
            self.assertFalse(ydata.is_rate_limit(Exception(msg)), msg)

    # ---- history ----
    def test_history_returns_first_nonempty(self):
        ydata._yf = _FakeYF({"AAA.NS": [_FakeDF(empty=False)]})
        df = ydata.history("AAA.NS", "1y", "1d")
        self.assertIsNotNone(df)
        self.assertFalse(df.empty)

    def test_history_retries_rate_limit_then_succeeds(self):
        ydata._yf = _FakeYF({"AAA.NS": [
            RuntimeError("429 Too Many Requests"),
            _FakeDF(empty=False),
        ]})
        df = ydata.history("AAA.NS", "1y", "1d", tries=3)
        self.assertIsNotNone(df)

    def test_history_none_when_all_rate_limited(self):
        ydata._yf = _FakeYF({"AAA.NS": [RuntimeError("429")] * 5})
        self.assertIsNone(ydata.history("AAA.NS", "1y", "1d", tries=3))

    def test_history_gives_up_fast_on_non_rate_limit(self):
        # A non-rate-limit error should not burn all retries: one retry then None.
        calls = {"n": 0}

        class _Boom(_FakeYF):
            def Ticker(self, symbol):
                calls["n"] += 1
                return _FakeTicker(symbol, [ConnectionError("reset")])

        ydata._yf = _Boom({})
        self.assertIsNone(ydata.history("AAA.NS", "1y", "1d", tries=5))
        self.assertEqual(calls["n"], 2)  # initial try + one retry, then give up

    def test_history_never_raises(self):
        ydata._yf = _FakeYF({"AAA.NS": [ValueError("boom")] * 5})
        self.assertIsNone(ydata.history("AAA.NS", "1y", "1d", tries=2))

    # ---- info ----
    def test_info_returns_populated(self):
        full = {f"k{i}": i for i in range(10)}
        ydata._yf = _FakeYF({"AAA.NS": [full]})
        self.assertEqual(ydata.info("AAA.NS"), full)

    def test_info_treats_sparse_as_rate_limit_and_gives_up(self):
        # A dict below min_keys is retried and ultimately None (soft rate-limit).
        ydata._yf = _FakeYF({"AAA.NS": [{"a": 1}, {"a": 1}, {"a": 1}]})
        self.assertIsNone(ydata.info("AAA.NS", tries=3, min_keys=5))


if __name__ == "__main__":
    unittest.main()
