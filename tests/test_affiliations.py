"""Unit tests for the promoter + political affiliation graphs (seed-grounded)."""
import unittest

import affiliations as aff

SEED = {
    "promoters": {
        "as_of": "FY2024 filings",
        "source": "NSE / BSE shareholding pattern",
        "groups": [
            {
                "key": "adani group",
                "name": "Adani Group",
                "companies": [
                    {"symbol": "adanient", "company": "Adani Enterprises", "stake_pct": 74},
                    {"symbol": "ADANIPORTS", "company": "Adani Ports", "stake_pct": None},
                    {"symbol": "", "company": "junk row"},
                ],
            },
            {
                "key": "SUN PHARMA",
                "name": "Sun Pharma",
                "companies": [
                    {"symbol": "SUNPHARMA", "company": "Sun Pharmaceutical", "stake_pct": 54},
                ],
            },
        ],
    },
    "political": {
        "as_of": "2019 → 2024",
        "source": "ECI / SBI electoral-bond disclosure (Mar 2024)",
        "donors": [
            {"key": "small co", "name": "Small Co", "symbol": None, "amount_cr": 50,
             "first_date": "2020-01", "last_date": "2021-01"},
            {"key": "big co", "name": "Big Co", "symbol": "BIGCO", "amount_cr": 500,
             "first_date": "2019-04", "last_date": "2024-01"},
            {"key": "mid co", "name": "Mid Co", "symbol": None, "amount_cr": 120,
             "first_date": "2019-05", "last_date": "2023-10"},
        ],
    },
}


class PromoterGraph(unittest.TestCase):
    def test_shape_and_grouping(self):
        g = aff.promoter_graph(SEED)
        self.assertEqual(g["kind"], "promoter")
        holders = {h["id"]: h for h in g["nodes"]["holders"]}
        # Adani should rank first (breadth 2) ahead of Sun Pharma (breadth 1).
        self.assertEqual(g["nodes"]["holders"][0]["id"], "ADANI GROUP")
        self.assertEqual(holders["ADANI GROUP"]["breadth"], 2)  # empty-symbol row dropped
        self.assertIn("ADANIENT", holders["ADANI GROUP"]["symbols"])

    def test_symbol_and_stake_normalised(self):
        g = aff.promoter_graph(SEED)
        adani = [h for h in g["nodes"]["holders"] if h["id"] == "ADANI GROUP"][0]
        # symbols upper-cased; disclosed stake (74) sorts before null stake.
        self.assertEqual(adani["edges"][0]["symbol"], "ADANIENT")
        self.assertEqual(adani["edges"][0]["stake_pct"], 74)
        self.assertIsNone(adani["edges"][1]["stake_pct"])
        # every edge is cited
        self.assertTrue(all(e["citation"] for e in adani["edges"]))

    def test_reverse_lookup_by_symbol(self):
        hits = aff.promoter_by_symbol("sunpharma", SEED)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["holder"], "SUN PHARMA")
        self.assertEqual(aff.promoter_by_symbol("NOPE", SEED), [])

    def test_disclaimer_mentions_retail(self):
        g = aff.promoter_graph(SEED)
        self.assertIn("retail", g["disclaimer"].lower())


class PoliticalGraph(unittest.TestCase):
    def test_ranked_by_amount(self):
        g = aff.political_graph(SEED)
        self.assertEqual(g["kind"], "political")
        donors = g["nodes"]["donors"]
        self.assertEqual([d["id"] for d in donors], ["BIG CO", "MID CO", "SMALL CO"])
        self.assertEqual(g["total_cr"], 670)
        self.assertEqual(g["count"], 3)

    def test_symbol_mapping(self):
        hits = aff.political_by_symbol("bigco", SEED)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["id"], "BIG CO")
        self.assertEqual(aff.political_by_symbol("UNMAPPED", SEED), [])

    def test_disclaimer_is_careful(self):
        g = aff.political_graph(SEED)
        low = g["disclaimer"].lower()
        # must not assert recipient party, and must note no wrongdoing
        self.assertIn("not asserted", low)
        self.assertIn("no wrongdoing", low)


class RealSeed(unittest.TestCase):
    """The shipped seed file must load and be internally consistent."""

    def test_shipped_seed_loads(self):
        aff.reload_seed()
        pg = aff.promoter_graph()
        self.assertGreater(len(pg["nodes"]["holders"]), 3)
        self.assertTrue(all(h["breadth"] >= 1 for h in pg["nodes"]["holders"]))
        pol = aff.political_graph()
        self.assertGreater(pol["total_cr"], 0)
        # donors strictly non-increasing by amount
        amts = [d["amount_cr"] for d in pol["nodes"]["donors"]]
        self.assertEqual(amts, sorted(amts, reverse=True))


if __name__ == "__main__":
    unittest.main()
