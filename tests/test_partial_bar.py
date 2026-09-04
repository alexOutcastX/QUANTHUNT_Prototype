"""A bar that has not traded yet must not be treated as the latest bar.

Every number in a scan row is read off the LAST bar of the frame. Feeds append
a row for the session in progress before it has any trades — sometimes carrying
a volume but no close — and the arithmetic on that row produces NaN, which the
JSON layer correctly serves as null.

The result is not one empty field. It is:

    price, chg, absChg, the distance from all six moving averages, both 52-week
    extremes and the distances from them, Williams %R, Bollinger %B, all six
    pivots, the 1w/1m/6m returns, and every moving-average pair gap

null at once — and because the placeholder appears on every symbol on the same
morning, it empties the entire universe on the same morning. A screener with no
prices and no trend, and a crossover tab reporting that nothing is converging.

That is exactly what the 02:00 IST rebuild of 2026-09-04 served: 500 rows in
which rsi, macd, prevClose, volume and the Camarilla levels were fine — because
those are read off EARLIER bars — and everything read off the last bar was null.

The fix is not to null-guard each field at the point it is printed. It is to
trim the placeholder, because the last bar that actually has a close IS the
latest close and there is nothing to compute from a bar that has not happened.
"""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    import numpy as np
    import pandas as pd
    import scanner
    import ta                     # noqa: F401 — row_from_frame needs it
    HAVE = True
except Exception:                                            # pragma: no cover
    HAVE = False


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


# Fields read off the LAST bar — the ones a placeholder takes down.
LAST_BAR = ("price", "chg", "absChg", "d9", "d20", "d50", "d100", "d150", "d200",
            "high52", "low52", "pct_from_high", "pct_from_low", "willr", "bollb",
            "s1", "s2", "s3", "r1", "r2", "r3", "ret_1w", "ret_1m", "ret_6m")


@unittest.skipIf(not HAVE, "needs pandas + ta")
class PartialBarTest(unittest.TestCase):
    def frame(self, n=260):
        c = [100 + i * 0.3 + (i % 7) for i in range(n)]
        return pd.DataFrame({"Open": c, "High": [x * 1.01 for x in c],
                             "Low": [x * 0.99 for x in c], "Close": c,
                             "Volume": [1_000_000] * n})

    def placeholder(self, volume=950_000):
        """What the feed actually appends: a bar with no prices."""
        return pd.DataFrame([{"Open": np.nan, "High": np.nan, "Low": np.nan,
                              "Close": np.nan, "Volume": volume}])

    def bad(self, v=None):
        return v is None or (isinstance(v, float) and v != v)

    def test_a_placeholder_bar_changes_nothing(self):
        """The strongest statement of the fix: the row is IDENTICAL, not merely
        non-null. Trimming a bar that has not traded loses no information."""
        df = self.frame()
        clean = scanner.row_from_frame(df)
        with_ph = scanner.row_from_frame(pd.concat([df, self.placeholder()],
                                                   ignore_index=True))
        self.assertIsNotNone(clean)
        self.assertIsNotNone(with_ph)
        self.assertEqual(clean, with_ph)

    def test_every_last_bar_field_survives_it(self):
        """Named one by one, because the failure was silent: each of these came
        back null and the page rendered an empty state rather than an error."""
        row = scanner.row_from_frame(
            pd.concat([self.frame(), self.placeholder()], ignore_index=True))
        empty = [k for k in LAST_BAR if self.bad(row.get(k))]
        self.assertEqual(empty, [], f"nulled by a bar that has not traded: {empty}")

    def test_the_pair_gaps_survive_it(self):
        """The tab that made this visible: an empty ma_gaps reads as 'nothing is
        converging', which is indistinguishable from 'the data is missing'."""
        row = scanner.row_from_frame(
            pd.concat([self.frame(), self.placeholder()], ignore_index=True))
        self.assertEqual(len(row.get("ma_gaps") or {}), 4)

    def test_several_stacked_placeholders_are_all_trimmed(self):
        """A long weekend, or a feed that pads to today every time it is asked."""
        df = self.frame()
        padded = pd.concat([df] + [self.placeholder()] * 4, ignore_index=True)
        self.assertEqual(scanner.row_from_frame(padded), scanner.row_from_frame(df))

    def test_a_placeholder_with_no_volume_either_is_trimmed(self):
        """A NaN volume used to raise on int(), losing the symbol outright
        rather than merely emptying its fields."""
        row = scanner.row_from_frame(
            pd.concat([self.frame(), self.placeholder(volume=np.nan)],
                      ignore_index=True))
        self.assertIsNotNone(row)
        self.assertFalse(self.bad(row.get("price")))

    def test_a_gap_in_the_middle_is_not_trimmed(self):
        """Only the TAIL is a placeholder. An interior hole is a real gap in the
        history and shortening the frame to it would throw away the year."""
        df = self.frame()
        df.loc[100, "Close"] = np.nan
        row = scanner.row_from_frame(df)
        self.assertIsNotNone(row)
        self.assertFalse(self.bad(row.get("price")))

    def test_a_frame_with_no_close_at_all_yields_nothing(self):
        """Not a row of nulls — nothing. There is no snapshot to take."""
        df = self.frame()
        df["Close"] = np.nan
        self.assertIsNone(scanner.row_from_frame(df))

    def test_trimming_below_the_minimum_yields_nothing(self):
        df = pd.concat([self.frame(n=22), self.placeholder(), self.placeholder(),
                        self.placeholder()], ignore_index=True)
        self.assertIsNotNone(scanner.row_from_frame(df))
        short = pd.concat([self.frame(n=21)] + [self.placeholder()] * 5,
                          ignore_index=True)
        short.loc[19:20, "Close"] = np.nan          # 19 real bars left after trim
        self.assertIsNone(scanner.row_from_frame(short))

    def test_the_price_is_the_last_bar_that_traded(self):
        df = self.frame()
        last = float(df["Close"].iloc[-1])
        row = scanner.row_from_frame(
            pd.concat([df, self.placeholder()], ignore_index=True))
        self.assertEqual(row["price"], round(last, 2))

    def test_a_non_finite_price_is_never_emitted(self):
        src = read("scanner.py")
        self.assertIn("if not math.isfinite(price):", src)

    def test_the_volume_cast_cannot_raise(self):
        src = read("scanner.py")
        self.assertIn('"avgvol": int(avgvol) if avgvol and math.isfinite(avgvol)', src)


if __name__ == "__main__":
    unittest.main()
