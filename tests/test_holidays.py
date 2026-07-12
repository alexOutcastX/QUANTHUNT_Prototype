"""Stdlib-only unit tests for market-status logic (no network/deps)."""
import datetime as dt
import unittest

import holidays as h

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


class HolidaysTest(unittest.TestCase):
    def test_weekend_closed(self):
        # 2026-07-12 is a Sunday
        self.assertFalse(h.market_status(dt.datetime(2026, 7, 12, 11, 0, tzinfo=IST))["open"])

    def test_weekday_hours(self):
        mon = dt.datetime(2026, 7, 13, 10, 0, tzinfo=IST)  # Monday 10:00
        self.assertTrue(h.market_status(mon)["open"])
        self.assertFalse(h.market_status(mon.replace(hour=9, minute=14))["open"])
        self.assertFalse(h.market_status(mon.replace(hour=15, minute=31))["open"])

    def test_holiday_closed(self):
        # Republic Day 2026-01-26 (Monday) is a holiday
        s = h.market_status(dt.datetime(2026, 1, 26, 11, 0, tzinfo=IST))
        self.assertFalse(s["open"])

    def test_shape(self):
        s = h.market_status(dt.datetime(2026, 7, 13, 10, 0, tzinfo=IST))
        for k in ("open", "now_ist", "next_holiday"):
            self.assertIn(k, s)
        rows = h.holidays()
        self.assertTrue(rows and all({"date", "name", "day"} <= set(r) for r in rows))
        # sorted by date
        self.assertEqual(rows, sorted(rows, key=lambda r: r["date"]))


if __name__ == "__main__":
    unittest.main()
