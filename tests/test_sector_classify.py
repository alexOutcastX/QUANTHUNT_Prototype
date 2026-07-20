"""Unit tests for sectors.py — the app-wide NSE sector classifier + heatmap
aggregate. Pure logic only (no network): the NSE-index fetch is injected."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sectors  # noqa: E402


class TestCanon(unittest.TestCase):
    def test_alias_folds_to_canonical(self):
        self.assertEqual(sectors._canon("FMCG"), "Fast Moving Consumer Goods")
        self.assertEqual(sectors._canon(" it "), "Information Technology")
        self.assertEqual(sectors._canon("Oil & Gas"), "Oil Gas & Consumable Fuels")

    def test_canonical_passthrough_case_insensitive(self):
        self.assertEqual(sectors._canon("financial services"), "Financial Services")
        self.assertEqual(sectors._canon("REALTY"), "Realty")

    def test_unknown_label_titlecased_not_dropped(self):
        self.assertEqual(sectors._canon("shipbuilding"), "Shipbuilding")

    def test_empty(self):
        self.assertEqual(sectors._canon(""), "")
        self.assertEqual(sectors._canon(None), "")


class TestTranslateGics(unittest.TestCase):
    def test_each_gics_maps_to_a_real_nse_sector(self):
        gics = ["Financial Services", "Technology", "Healthcare", "Consumer Cyclical",
                "Consumer Defensive", "Basic Materials", "Energy", "Industrials",
                "Real Estate", "Utilities", "Communication Services"]
        for g in gics:
            nse = sectors.translate_gics(g)
            self.assertIn(nse, sectors.NSE_SECTORS, f"{g} -> {nse}")

    def test_empty(self):
        self.assertEqual(sectors.translate_gics(""), "")
        self.assertEqual(sectors.translate_gics(None), "")


class TestSectorOfAndRecord(unittest.TestCase):
    def setUp(self):
        # isolate the module map per test
        sectors._map = {}
        sectors._fetched_ts = 0

    def test_sector_of_prefers_index_map(self):
        sectors._map["TCS"] = "Information Technology"
        # even with a conflicting GICS hint, the authoritative map wins
        self.assertEqual(sectors.sector_of("TCS", "Consumer Cyclical"), "Information Technology")

    def test_sector_of_falls_back_to_translated_gics(self):
        self.assertEqual(sectors.sector_of("UNKNOWN", "Energy"), "Oil Gas & Consumable Fuels")

    def test_sector_of_empty_when_nothing_known(self):
        self.assertEqual(sectors.sector_of("UNKNOWN", None), "")

    def test_record_fills_gap_only(self):
        sectors.record("ABC", "Technology")
        self.assertEqual(sectors._map["ABC"], "Information Technology")
        # an index mapping is never clobbered by a later GICS guess
        sectors._map["ABC"] = "Healthcare"
        sectors.record("ABC", "Technology")
        self.assertEqual(sectors._map["ABC"], "Healthcare")

    def test_record_ignores_blanks(self):
        sectors.record("", "Technology")
        sectors.record("XYZ", "")
        self.assertNotIn("XYZ", sectors._map)


class TestParseIndexCsv(unittest.TestCase):
    def test_parses_symbol_and_industry(self):
        csv_text = (
            "Company Name,Industry,Symbol,Series,ISIN Code\n"
            "Tata Consultancy,Information Technology,TCS,EQ,INE467B01029\n"
            "Reliance,Oil Gas & Consumable Fuels,RELIANCE,EQ,INE002A01018\n"
        )
        out = dict(sectors._parse_index_csv(csv_text))
        self.assertEqual(out["TCS"], "Information Technology")
        self.assertEqual(out["RELIANCE"], "Oil Gas & Consumable Fuels")

    def test_missing_columns_yields_nothing(self):
        out = list(sectors._parse_index_csv("a,b\n1,2\n"))
        self.assertEqual(out, [])


class TestRefreshClassification(unittest.TestCase):
    def setUp(self):
        sectors._map = {}
        sectors._fetched_ts = 0

    def test_refresh_merges_index_files_and_is_authoritative(self):
        seed = {
            "ind_niftytotalmarket_list.csv":
                "Company,Industry,Symbol,Series,ISIN\nTata,Information Technology,TCS,EQ,X\n",
        }

        def fetch(path):
            name = path.rsplit("/", 1)[-1]
            if name in seed:
                return seed[name]
            raise RuntimeError("404")

        # a stale GICS guess exists first...
        sectors._map["TCS"] = "Healthcare"
        n = sectors.refresh_classification(fetch, force=True)
        self.assertGreaterEqual(n, 1)
        # ...the index file overwrites it (index is authoritative)
        self.assertEqual(sectors._map["TCS"], "Information Technology")

    def test_failed_fetch_is_best_effort(self):
        def fetch(path):
            raise RuntimeError("network down")
        # no exception should escape; map simply stays empty
        n = sectors.refresh_classification(fetch, force=True)
        self.assertEqual(n, 0)


class TestBuildHeatmap(unittest.TestCase):
    def setUp(self):
        sectors._map = {
            "TCS": "Information Technology",
            "INFY": "Information Technology",
            "HDFCBANK": "Financial Services",
        }
        sectors._fetched_ts = 0

    def test_aggregates_by_sector_with_value_weighting(self):
        universe = [
            {"symbol": "TCS", "chg": 2.0, "turnover": 100.0},
            {"symbol": "INFY", "chg": -1.0, "turnover": 100.0},
            {"symbol": "HDFCBANK", "chg": 1.5, "turnover": 50.0},
            {"symbol": "SMEONLY", "chg": 9.0, "turnover": 10.0},  # unclassified -> excluded
        ]
        res = sectors.build_heatmap(universe)
        self.assertEqual(res["universe"], 4)
        self.assertEqual(res["mapped"], 3)
        by = {r["sector"]: r for r in res["sectors"]}
        self.assertEqual(by["Information Technology"]["count"], 2)
        # equal turnover -> simple average of +2 and -1 = +0.5
        self.assertAlmostEqual(by["Information Technology"]["chg"], 0.5, places=2)
        self.assertEqual(by["Financial Services"]["count"], 1)

    def test_gics_fallback_classifies_unmapped(self):
        universe = [{"symbol": "NEWCO", "chg": 1.0, "turnover": 5.0, "sector": "Utilities"}]
        res = sectors.build_heatmap(universe)
        self.assertEqual(res["mapped"], 1)
        self.assertEqual(res["sectors"][0]["sector"], "Power")

    def test_empty_universe(self):
        res = sectors.build_heatmap([])
        self.assertEqual(res, {"universe": 0, "mapped": 0, "sectors": []})


if __name__ == "__main__":
    unittest.main()
