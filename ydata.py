"""Resilient yfinance access.

yfinance has no built-in throttle, and this backend fans out to Yahoo from
several 8-worker thread pools (screener scan, /returns, /ltp) plus the
recommendation / SMC / swing / institutional analysis paths. Run at the same
time they stack dozens of concurrent Yahoo requests and trip its rate limiter —
which is exactly the intermittent "Analyse failed" / blank-quote symptom.

Every heavy Yahoo fetch should route through here. It provides:
  • one shared yfinance module handle,
  • a global bounded semaphore so total concurrent Yahoo calls are capped across
    ALL endpoints (not just within one pool),
  • 429 / "Too Many Requests" detection with exponential backoff + jitter,
  • functions that never raise — they return a DataFrame / dict, or None on
    failure, so callers can fall back (tvDatafeed, last-good cache) cleanly.

Tunable via env: YF_MAX_CONCURRENCY (default 4).
"""
import logging
import os
import random
import threading
import time

log = logging.getLogger("quanthunt.ydata")

# Global cap on concurrent outbound Yahoo requests across the whole process.
_MAX = max(1, int(os.environ.get("YF_MAX_CONCURRENCY", "4") or "4"))
_sem = threading.BoundedSemaphore(_MAX)

_yf = None
_yf_lock = threading.Lock()


def yf():
    """The yfinance module (imported lazily, once)."""
    global _yf
    if _yf is None:
        with _yf_lock:
            if _yf is None:
                import yfinance as _m
                _yf = _m
    return _yf


def is_rate_limit(err) -> bool:
    """True if an exception looks like a Yahoo rate-limit / throttle."""
    s = str(err).lower()
    return (
        "429" in s
        or "too many requests" in s
        or "rate limit" in s
        or "ratelimit" in s
        or "rate-limit" in s
    )


def _backoff(attempt, base=1.6, cap=8.0):
    # Jittered exponential backoff, capped. Slept OUTSIDE the semaphore so a
    # backing-off caller doesn't hold a concurrency slot while it waits.
    time.sleep(min(cap, base ** attempt) + random.uniform(0, 0.4))


def history(symbol, period, interval="1d", tries=3, auto_adjust=True):
    """Fetch OHLC history under the global limiter with rate-limit backoff.

    Returns a non-empty DataFrame on success, or None (never raises). An empty
    result or a rate-limit error is retried with backoff; a hard error that
    isn't a rate-limit is retried once then given up (the caller has a fallback).
    """
    m = yf()
    for attempt in range(tries):
        try:
            with _sem:
                df = m.Ticker(symbol).history(
                    period=period, interval=interval, auto_adjust=auto_adjust
                )
            if df is not None and not df.empty:
                return df
        except Exception as e:  # noqa: BLE001 - deliberately broad; we return None
            if not is_rate_limit(e) and attempt >= 1:
                log.debug("yf history %s gave up: %s", symbol, e)
                return None
        if attempt < tries - 1:
            _backoff(attempt)
    return None


def info(symbol, tries=3, min_keys=5):
    """Fetch .info (fundamentals) under the global limiter with rate-limit
    backoff. `.info` is the endpoint Yahoo throttles hardest.

    Returns a populated dict on success, or None (never raises). A sparse dict
    (fewer than `min_keys` keys) is treated as a probable soft rate-limit and
    retried with backoff.
    """
    m = yf()
    for attempt in range(tries):
        try:
            with _sem:
                d = m.Ticker(symbol).info
            if d and len(d) > min_keys:
                return d
        except Exception as e:  # noqa: BLE001
            if not is_rate_limit(e) and attempt >= 1:
                log.debug("yf info %s gave up: %s", symbol, e)
                return None
        if attempt < tries - 1:
            _backoff(attempt)
    return None
