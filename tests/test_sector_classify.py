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


class TestIndustryToMacro(unittest.TestCase):
    def test_maps_granular_bse_industries(self):
        cases = {
            "IT - Software": "Information Technology",
            "Banks": "Financial Services",
            "Pharmaceuticals & Biotechnology": "Healthcare",
            "Auto Ancillaries": "Automobile and Auto Components",
            "Cement & Cement Products": "Construction Materials",
            "Ferrous Metals": "Metals & Mining",
            "Petroleum Products": "Oil Gas & Consumable Fuels",
            "Textiles - Cotton": "Textiles",
            "Realty": "Realty",
            "Power Generation & Distribution": "Power",
            "Telecom - Services": "Telecommunication",
            "Paper": "Forest Materials",
            "Fertilizers": "Chemicals",
            "Retailing": "Consumer Services",
        }
        for raw, expect in cases.items():
            self.assertEqual(sectors.industry_to_macro(raw), expect, raw)

    def test_specific_beats_generic(self):
        # cement must not be swallowed by "construction"
        self.assertEqual(sectors.industry_to_macro("Cement"), "Construction Materials")
        # ferrous must not be a generic metal-only match issue
        self.assertEqual(sectors.industry_to_macro("Ferrous Metals"), "Metals & Mining")

    def test_unknown_industry_still_classified(self):
        # never silently dropped — passes through canonicalised
        self.assertTrue(sectors.industry_to_macro("Some Exotic Trade"))

    def test_empty(self):
        self.assertEqual(sectors.industry_to_macro(""), "")
        self.assertEqual(sectors.industry_to_macro(None), "")


class TestRefreshBseLayer(unittest.TestCase):
    def setUp(self):
        sectors._map = {}
        sectors._fetched_ts = 0

    def test_bse_rows_populate_and_nse_overwrites(self):
        bse = [("TCS", "IT - Software"), ("SOMESME", "Textiles - Cotton"),
               ("HDFCBANK", "Banks")]
        seed = {
            "ind_niftytotalmarket_list.csv":
                "Company,Industry,Symbol,Series,ISIN\nHDFC Bank,Financial Services,HDFCBANK,EQ,X\n",
        }

        def fetch(path):
            name = path.rsplit("/", 1)[-1]
            if name in seed:
                return seed[name]
            raise RuntimeError("404")

        n = sectors.refresh_classification(fetch, bse_rows=bse, force=True)
        self.assertGreaterEqual(n, 3)
        # BSE-only SME still classified
        self.assertEqual(sectors._map["SOMESME"], "Textiles")
        self.assertEqual(sectors._map["TCS"], "Information Technology")
        # NSE index is authoritative — HDFCBANK keeps the NSE macro sector
        self.assertEqual(sectors._map["HDFCBANK"], "Financial Services")

    def test_bse_only_still_works_without_nse(self):
        def fetch(path):
            raise RuntimeError("nse down")
        n = sectors.refresh_classification(fetch, bse_rows=[("XYZ", "Banks")], force=True)
        self.assertEqual(n, 1)
        self.assertEqual(sectors._map["XYZ"], "Financial Services")


class TestCacheVersion(unittest.TestCase):
    def test_stale_version_cache_is_discarded(self):
        import json
        import tempfile
        # write a cache stamped with an old version
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"version": sectors.CACHE_VERSION - 1,
                       "map": {"TCS": "Information Technology"}, "fetched_ts": 9e9}, f)
            path = f.name
        orig_file, orig_map, orig_ts = sectors._FILE, dict(sectors._map), sectors._fetched_ts
        try:
            sectors._FILE = path
            sectors._map = {}
            sectors._fetched_ts = 0
            sectors._load_disk()
            # old-version cache ignored → map stays empty so a re-pull is forced
            self.assertEqual(sectors._map, {})
            self.assertEqual(sectors._fetched_ts, 0)
        finally:
            sectors._FILE, sectors._map, sectors._fetched_ts = orig_file, orig_map, orig_ts
            os.unlink(path)

    def test_current_version_cache_loads(self):
        import json
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"version": sectors.CACHE_VERSION,
                       "map": {"TCS": "Information Technology"}, "fetched_ts": 123}, f)
            path = f.name
        orig_file, orig_map, orig_ts = sectors._FILE, dict(sectors._map), sectors._fetched_ts
        try:
            sectors._FILE = path
            sectors._map = {}
            sectors._fetched_ts = 0
            sectors._load_disk()
            self.assertEqual(sectors._map.get("TCS"), "Information Technology")
        finally:
            sectors._FILE, sectors._map, sectors._fetched_ts = orig_file, orig_map, orig_ts
            os.unlink(path)


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
