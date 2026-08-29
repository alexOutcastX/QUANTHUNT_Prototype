"""Quotes over a weekend, and the NaN that came with them.

Two defects, one function. On a Saturday the home page showed every stock at
+0.00% — gainers, losers, watchlist average, and a breadth of 0 up / 0 down /
180 unchanged. The cause was `period="2d"`: two CALENDAR days are Friday and
Saturday, Saturday has no bar, so the frame held a single row and the
"previous close" fell back to that same row. The change was a stock measured
against itself, for the whole weekend and again on Monday until the open.

The second defect was visible in the same payload: RELIANCE served
`"price": NaN`. Yahoo pads frames with rows that carry a volume but no prices,
float(nan) does not raise, and a NaN reaching jsonify is written as a bare
`NaN` — which is not JSON, so the client does not degrade, it breaks.

These run on synthetic frames: the point is what the function does with the
shapes Yahoo actually returns, and a test that needs the network to say so is
a test that fails on a Sunday for the wrong reason.
"""
import datetime
import json
import math
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The CI gate runs on the stdlib alone; the trading-calendar and wording tests
# below need neither pandas nor a server import, so they must still run there.
try:
    import pandas as pd
    import server
    HAVE_FRAMES = True
except Exception:                                            # pragma: no cover
    pd = server = None
    HAVE_FRAMES = False

import holidays as H


def frame(rows):
    """rows: [(date, open, high, low, close, volume)] → a daily OHLCV frame."""
    idx = pd.to_datetime([r[0] for r in rows])
    return pd.DataFrame(
        {"Open": [r[1] for r in rows], "High": [r[2] for r in rows],
         "Low": [r[3] for r in rows], "Close": [r[4] for r in rows],
         "Volume": [r[5] for r in rows]},
        index=idx)


THU = ("2026-08-27", 1190.0, 1205.0, 1188.0, 1200.0, 500000)
FRI = ("2026-08-28", 1194.0, 1207.0, 1191.7, 1204.0, 317442)
NAN_PAD = ("2026-08-29", float("nan"), float("nan"), float("nan"), float("nan"), 6826848)


@unittest.skipUnless(HAVE_FRAMES, "pandas/server unavailable in this environment")
class QuoteFromFrameTest(unittest.TestCase):
    def test_a_weekend_quote_reports_fridays_move_not_zero(self):
        q = server._quote_from_frame(frame([THU, FRI]))
        self.assertEqual(q["price"], 1204.0)
        self.assertEqual(q["prevClose"], 1200.0)
        self.assertEqual(q["chg"], 0.33)
        self.assertEqual(q["absChg"], 4.0)

    def test_the_session_is_the_bars_own_date(self):
        """Not the server clock: on Saturday the number IS Friday's."""
        self.assertEqual(server._quote_from_frame(frame([THU, FRI]))["session"],
                         "2026-08-28")

    def test_a_padded_saturday_row_does_not_become_the_price(self):
        """The RELIANCE case: a trailing row with a volume and no prices."""
        q = server._quote_from_frame(frame([THU, FRI, NAN_PAD]))
        self.assertEqual(q["price"], 1204.0)
        self.assertEqual(q["chg"], 0.33)
        self.assertEqual(q["session"], "2026-08-28")

    def test_nothing_non_finite_ever_reaches_the_client(self):
        """allow_nan=False is what a strict JSON parser does — and what the
        browser's JSON.parse does with a bare NaN."""
        for f in (frame([THU, FRI]), frame([THU, FRI, NAN_PAD]), frame([FRI])):
            q = server._quote_from_frame(f)
            json.dumps(q, allow_nan=False)   # raises ValueError on NaN/Inf
            for k, v in q.items():
                if isinstance(v, float):
                    self.assertTrue(math.isfinite(v), f"{k} is {v}")

    def test_one_session_reports_no_change_rather_than_zero(self):
        """A listing too new to have a previous close has a gap, not a flat
        day — and +0.00% is exactly the wrong answer this whole file is about."""
        q = server._quote_from_frame(frame([FRI]))
        self.assertEqual(q["price"], 1204.0)
        self.assertIsNone(q["chg"])
        self.assertIsNone(q["absChg"])

    def test_an_all_nan_frame_is_no_quote_at_all(self):
        self.assertIsNone(server._quote_from_frame(frame([NAN_PAD])))

    def test_an_empty_or_missing_frame_is_handled(self):
        self.assertIsNone(server._quote_from_frame(None))
        self.assertIsNone(server._quote_from_frame(pd.DataFrame()))

    def test_a_zero_previous_close_does_not_divide(self):
        zero = ("2026-08-27", 0.0, 0.0, 0.0, 0.0, 0)
        q = server._quote_from_frame(frame([zero, FRI]))
        self.assertEqual(q["price"], 1204.0)
        self.assertIsNone(q["chg"])


@unittest.skipUnless(HAVE_FRAMES, "pandas/server unavailable in this environment")
class WindowTest(unittest.TestCase):
    def test_the_window_spans_more_than_a_weekend(self):
        """`2d` is the bug. The window has to cover the longest stretch the
        market is shut plus two sessions — a Friday holiday before a weekend
        already needs four days, and a Diwali cluster more."""
        self.assertNotEqual(server._YF_WINDOW, "2d")
        self.assertRegex(server._YF_WINDOW, r"^\d+d$")
        self.assertGreaterEqual(int(server._YF_WINDOW[:-1]), 7)

    def test_both_quote_paths_use_it(self):
        """The single-symbol fallback and the batch both, or the home page is
        fixed on one card and still zeroed on the next.

        Comment lines are stripped: the comment above _YF_WINDOW names the old
        `period="2d"` to explain what went wrong, and saying so is not the
        defect coming back.
        """
        with open(os.path.join(os.path.dirname(os.path.dirname(
                os.path.abspath(__file__))), "server.py"), encoding="utf-8") as fh:
            src = "\n".join(l for l in fh.read().splitlines()
                            if not l.lstrip().startswith("#"))
        self.assertNotIn('period="2d"', src)
        self.assertEqual(src.count("period=_YF_WINDOW"), 2)


class LastSessionTest(unittest.TestCase):
    def at(self, s):
        return datetime.datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=H.IST)

    def test_saturday_and_sunday_belong_to_friday(self):
        self.assertEqual(H.last_session(self.at("2026-08-29 11:25")), "2026-08-28")
        self.assertEqual(H.last_session(self.at("2026-08-30 20:00")), "2026-08-28")

    def test_monday_belongs_to_friday_until_the_open(self):
        self.assertEqual(H.last_session(self.at("2026-08-31 09:14")), "2026-08-28")
        self.assertEqual(H.last_session(self.at("2026-08-31 09:15")), "2026-08-31")

    def test_a_trading_day_is_its_own_session_once_open(self):
        self.assertEqual(H.last_session(self.at("2026-08-28 16:00")), "2026-08-28")

    def test_it_walks_back_over_a_holiday(self):
        """15 Aug 2026 (Independence Day) falls on a Saturday, so the weekend
        resolves to Friday the 14th — and so does Monday before the open."""
        self.assertEqual(H.last_session(self.at("2026-08-16 12:00")), "2026-08-14")
        self.assertEqual(H.last_session(self.at("2026-08-17 09:00")), "2026-08-14")

    def test_it_walks_back_over_a_weekday_holiday(self):
        """Gandhi Jayanti is Friday 2 Oct 2026 — the weekend after it belongs
        to Thursday the 1st."""
        self.assertEqual(H.last_session(self.at("2026-10-03 12:00")), "2026-10-01")

    def test_a_holiday_is_not_a_trading_day(self):
        self.assertFalse(H.is_trading_day("2026-08-15"))
        self.assertFalse(H.is_trading_day("2026-11-08"))
        self.assertTrue(H.is_trading_day("2026-08-28"))

    def test_it_always_returns_a_trading_day(self):
        d = datetime.date(2026, 1, 1)
        while d < datetime.date(2027, 1, 1):
            for hh, mm in ((8, 0), (12, 0), (20, 0)):
                got = H.last_session(datetime.datetime(
                    d.year, d.month, d.day, hh, mm, tzinfo=H.IST))
                self.assertTrue(H.is_trading_day(got), f"{d} {hh}:{mm} -> {got}")
                self.assertLessEqual(got, d.strftime("%Y-%m-%d"))
            d += datetime.timedelta(days=1)


@unittest.skipUnless(HAVE_FRAMES, "pandas/server unavailable in this environment")
class MoversSessionTest(unittest.TestCase):
    def rows(self, chgs, session="2026-08-28"):
        return [{"symbol": f"S{i}", "chg": c, "volume": 100000, "session": session}
                for i, c in enumerate(chgs)]

    def test_the_payload_names_the_session_it_is_reporting(self):
        p = server._movers_aggregate("NIFTY 500", self.rows([1.0, -2.0, 0.5]), 2)
        self.assertEqual(p["session"], "2026-08-28")

    def test_it_falls_back_to_the_calendar_when_rows_carry_no_stamp(self):
        rows = [{"symbol": "A", "chg": 1.0, "volume": 1} for _ in range(3)]
        p = server._movers_aggregate("NIFTY 500", rows, 2)
        self.assertTrue(H.is_trading_day(p["session"]))


@unittest.skipUnless(HAVE_FRAMES, "pandas/server unavailable in this environment")
class PlaceholderZeroTest(unittest.TestCase):
    """A feed that answers a weekend request with zeros instead of Friday.

    The NSE constituent endpoint is the other way the +0.00% page could come
    back: it returns rows and it returns a pChange, so the old code took it as
    a live session. 500 names all EXACTLY unchanged is not a session.
    """

    def setUp(self):
        self.orig = server._get_constituents
        self.quoted = {}
        self.orig_batch = server._yf_batch
        server._yf_batch = lambda syms: {s: dict(self.quoted[s]) for s in syms
                                         if s in self.quoted}

    def tearDown(self):
        server._get_constituents = self.orig
        server._yf_batch = self.orig_batch

    def feed(self, rows):
        server._get_constituents = lambda name: (rows, "NSE")

    def test_an_all_zero_feed_is_replaced_by_real_quotes(self):
        self.quoted = {"A": {"chg": 1.5, "price": 10.0, "session": "2026-08-28"},
                       "B": {"chg": -0.75, "price": 20.0, "session": "2026-08-28"}}
        self.feed([{"symbol": "A", "chg": 0.0}, {"symbol": "B", "chg": 0.0}])
        rows = server._rows_with_chg("NIFTY 500")
        self.assertEqual([r["chg"] for r in rows], [1.5, -0.75])
        self.assertEqual(rows[0]["session"], "2026-08-28")

    def test_a_real_session_is_left_alone(self):
        """One mover is enough to prove the feed is reporting a session — the
        genuinely unchanged names beside it keep their zero."""
        self.feed([{"symbol": "A", "chg": 0.0}, {"symbol": "B", "chg": 2.1}])
        rows = server._rows_with_chg("NIFTY 500")
        self.assertEqual([r["chg"] for r in rows], [0.0, 2.1])

    def test_rows_past_the_backfill_cap_become_gaps_not_flat_prints(self):
        """The backfill is capped, so a placeholder zero left on an uncovered
        row would be counted as a real unchanged print in the breadth."""
        rows_in = [{"symbol": f"S{i}", "chg": 0.0} for i in range(5)]
        self.quoted = {"S0": {"chg": 1.0}, "S1": {"chg": -1.0}}
        self.feed(rows_in)
        rows = server._rows_with_chg("NIFTY 500", cap=2)
        self.assertEqual([r["chg"] for r in rows], [1.0, -1.0, None, None, None])
        kept = [r for r in rows if r.get("chg") is not None]
        self.assertEqual(len(kept), 2, "uncovered rows must not count as flat")


class DashboardWordingTest(unittest.TestCase):
    """The other half of the bug: a Friday number labelled "today".

    Fixing the arithmetic without fixing the wording would have replaced a
    wrong number with a right number under a wrong caption. The rendered
    output is checked end-to-end in e2e/smoke.js; these guard the wiring that
    feeds it, which is what silently rots.
    """

    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "mobile", "src", "screens",
                               "DashboardScreen.tsx"), encoding="utf-8") as fh:
            self.dash = fh.read()
        with open(os.path.join(root, "mobile", "src", "format.ts"),
                  encoding="utf-8") as fh:
            self.fmt = fh.read()

    def test_the_watchlist_average_no_longer_hardcodes_today(self):
        self.assertNotIn("' avg today'", self.dash)
        self.assertIn("avg ${wlAgg.when || 'today'}", self.dash)

    def test_the_session_label_is_empty_while_the_session_is_today(self):
        """Otherwise every card would carry a date during live trading, which
        is noise — the wording only earns its place once the session has
        ended."""
        self.assertIn("if (!session || session === istToday()) return '';", self.fmt)

    def test_both_mover_lists_and_the_breadth_card_name_the_session(self):
        for place in ("Top gainers{moversWhen",
                      "Top losers{moversWhen",
                      "source={[moversWhen, 'delayed \u00b7 NSE']"):
            self.assertIn(place, self.dash)

    def test_the_index_strip_names_it_too(self):
        self.assertIn("indicesWhen", self.dash)
        self.assertIn("setIndicesSession(d.session ?? null)", self.dash)


if __name__ == "__main__":
    unittest.main()
