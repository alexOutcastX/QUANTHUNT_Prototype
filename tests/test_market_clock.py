"""The market clock, and the one thing it is honest about not knowing.

The clock takes a market and shows that market's local time, date and session
state. Two things in it are easy to get quietly wrong:

  * Zones. New York, London, Frankfurt and Sydney all shift for daylight
    saving, on four different weekends. A stored UTC offset is wrong for weeks
    of the year in each of them, which for a market clock means telling someone
    the NYSE is shut when it has been open for an hour. So the times come from
    Intl with a real IANA zone, never from arithmetic on an offset.

  * Holidays. Only the NSE calendar is published in this app. Every other
    market here knows its weekday and its session hours and nothing else, so a
    foreign market closed for a national holiday still reads as open. That is a
    real limit and the UI states it rather than implying a certainty it does
    not have.

Source-level, because the alternative is a browser test whose expected answer
changes twice a year in four countries.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


class MarketTableTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "markets.ts")
        self.table = re.search(r"export const MARKETS: Market\[\] = \[(.*?)\n\];",
                               self.src, re.S).group(1)
        # Entries wrap across lines, so split on the record boundary rather
        # than assuming one market per line.
        self.entries = ["{ key:" + e for e in self.table.split("{ key:")[1:]]

    def test_india_is_the_default(self):
        self.assertIn("export const DEFAULT_MARKET = 'IN';", self.src)
        self.assertIn("key: 'IN'", self.entries[0], "India should lead the list it defaults to")

    def test_it_covers_the_sessions_an_indian_trader_actually_watches(self):
        for key in ("'IN'", "'US'", "'UK'", "'JP'", "'HK'", "'DE'", "'SG'", "'AU'"):
            self.assertIn(f"key: {key}", self.table)

    def test_every_market_names_a_real_iana_zone(self):
        zones = re.findall(r"tz: '([^']+)'", self.table)
        self.assertEqual(len(zones), len(self.entries))
        for z in zones:
            self.assertRegex(z, r"^[A-Za-z]+/[A-Za-z_]+$", z)

    def test_no_market_stores_a_utc_offset(self):
        """An offset is wrong for weeks of the year anywhere that observes
        daylight saving, and being wrong about that is being wrong about
        whether a market is open."""
        self.assertNotRegex(self.table, r"offset\s*:")
        self.assertNotRegex(self.table, r"utc\s*:")

    def test_the_time_comes_from_intl_with_the_zone(self):
        self.assertIn("timeZone: tz", self.src)
        self.assertIn("formatToParts", self.src)

    def test_written_abbreviations_only_where_the_clock_never_shifts(self):
        """A zone with daylight saving has two abbreviations a year; hardcoding
        one guarantees being wrong for half of it. Intl already picks correctly
        there, so only DST-free zones carry a label."""
        labelled = set()
        for entry in self.entries:
            key = re.search(r"key: '(\w+)'", entry).group(1)
            if "zoneLabel" in entry:
                labelled.add(key)
        self.assertEqual(labelled, {"IN", "JP", "HK", "SG"},
                         "only zones that never shift may hardcode an abbreviation")

    def test_only_india_claims_to_know_its_holidays(self):
        known = [re.search(r"key: '(\w+)'", e).group(1)
                 for e in self.entries if "holidaysKnown: true" in e]
        self.assertEqual(known, ["IN"])


class StatusTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "markets.ts")
        self.body = re.search(r"export function marketStatus\(.*?\n\}", self.src, re.S).group(0)

    def test_the_servers_answer_wins_for_india(self):
        """holidays.py has the published NSE calendar and the client cannot
        derive it, so a computed 'open' must never override it."""
        self.assertIn("if (override != null && m.holidaysKnown)", self.body)

    def test_a_weekend_is_closed_everywhere(self):
        self.assertIn("at.day === 0 || at.day === 6", self.body)

    def test_a_midday_break_reads_as_closed(self):
        """Tokyo and Hong Kong shut for an hour at lunch; 'open' through it
        would be wrong for an hour a day."""
        self.assertIn("m.lunch", self.body)
        self.assertIn("Midday break", self.body)

    def test_before_the_open_is_distinguished_from_after_the_close(self):
        self.assertIn("Pre-open", self.body)

    def test_a_missing_zone_database_says_nothing_rather_than_the_wrong_time(self):
        """Without ICU the local clock is right for one market and wrong for
        every other; stating it confidently would be the worst answer."""
        self.assertIn("'--:--:--'", self.body)
        self.assertIn("clock unavailable", self.body)


class WidgetTest(unittest.TestCase):
    def setUp(self):
        self.src = _read("mobile", "src", "components", "MarketClock.tsx")

    def test_the_chip_row_shows_every_market_with_an_open_closed_dot(self):
        self.assertIn("MARKETS.map", _read("mobile", "src", "components", "MarketClock.tsx"))
        self.assertIn("all.map(({ m, st: ms })", self.src)
        self.assertIn("backgroundColor: ms.open ? theme.green : theme.red", self.src)

    def test_the_chips_sit_above_the_picker(self):
        self.assertLess(self.src.index("s.chips"), self.src.index("<Dropdown"))

    def test_picking_a_market_changes_the_clock_and_sticks(self):
        self.assertIn("const at = zonedNow(market.tz, now, market.zoneLabel);", self.src)
        self.assertIn("AsyncStorage.setItem(KEY, k)", self.src)

    def test_it_says_when_holidays_are_not_tracked(self):
        self.assertIn("holidays not tracked", self.src)

    def test_the_chip_row_is_not_recomputed_every_second(self):
        """Eight Intl formatters a second, for a row of dots that can only
        change on a minute boundary."""
        self.assertIn("const minute = Math.floor(now.getTime() / 60000);", self.src)
        self.assertIn("[minute, indiaOpen]", self.src)

    def test_the_old_india_only_pill_is_gone(self):
        """It was a second answer to the question the clock is already being
        asked, and it only ever spoke for one market."""
        dash = _read("mobile", "src", "screens", "DashboardScreen.tsx")
        self.assertNotIn("Market closed", dash)
        self.assertIn("<MarketClock indiaOpen={market ? market.open : null} />", dash)


if __name__ == "__main__":
    unittest.main()
