"""Unit tests for the sectoral aggregate helpers (pure stdlib — no yfinance).

mb_screen imports only the standard library at module scope (multibagger is
imported lazily inside the worker), so it is safe to import here.
"""
import unittest

import mb_screen as ms


class AccSectorTest(unittest.TestCase):
    def test_ignores_missing_sector(self):
        acc = {}
        ms._acc_sector(acc, None, 1.0, 100)
        ms._acc_sector(acc, "", 1.0, 100)
        self.assertEqual(acc, {})

    def test_cap_weighted_average(self):
        acc = {}
        # Two Tech names: a big cap up 2%, a small cap down 4%. Cap-weighting must
        # pull the sector average toward the big cap.
        ms._acc_sector(acc, "Technology", 2.0, 900)
        ms._acc_sector(acc, "Technology", -4.0, 100)
        rows = ms.sectors_from_acc(acc)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["sector"], "Technology")
        self.assertEqual(row["count"], 2)
        self.assertEqual(row["market_cap_cr"], 1000.0)
        # (2*900 + -4*100) / 1000 = 1.4
        self.assertEqual(row["chg"], 1.4)

    def test_equal_weight_fallback_when_mcap_missing(self):
        acc = {}
        ms._acc_sector(acc, "Energy", 3.0, None)
        ms._acc_sector(acc, "Energy", 1.0, 0)
        rows = ms.sectors_from_acc(acc)
        self.assertEqual(rows[0]["count"], 2)
        self.assertIsNone(rows[0]["market_cap_cr"])
        self.assertEqual(rows[0]["chg"], 2.0)  # (3+1)/2 equal weight

    def test_none_chg_excluded_from_average(self):
        acc = {}
        ms._acc_sector(acc, "Utilities", None, 500)
        ms._acc_sector(acc, "Utilities", 2.0, 500)
        rows = ms.sectors_from_acc(acc)
        self.assertEqual(rows[0]["count"], 2)          # both counted
        self.assertEqual(rows[0]["chg"], 2.0)          # only the numeric one averaged

    def test_all_chg_missing_yields_none(self):
        acc = {}
        ms._acc_sector(acc, "Healthcare", None, 500)
        rows = ms.sectors_from_acc(acc)
        self.assertEqual(rows[0]["count"], 1)
        self.assertIsNone(rows[0]["chg"])

    def test_sorted_by_count_desc(self):
        acc = {}
        ms._acc_sector(acc, "Financial Services", 1.0, 100)
        ms._acc_sector(acc, "Financial Services", 1.0, 100)
        ms._acc_sector(acc, "Industrials", 1.0, 100)
        rows = ms.sectors_from_acc(acc)
        self.assertEqual([r["sector"] for r in rows], ["Financial Services", "Industrials"])

    def test_empty_acc(self):
        self.assertEqual(ms.sectors_from_acc({}), [])


if __name__ == "__main__":
    unittest.main()
