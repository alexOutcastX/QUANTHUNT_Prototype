"""Unit tests for the grounded entity graph (pure, no network)."""
import importlib
import unittest


class EntityGraphTest(unittest.TestCase):
    def setUp(self):
        import entity_graph
        self.g = importlib.reload(entity_graph)

    def test_norm_entity_collapses_boilerplate(self):
        k1, d1 = self.g.norm_entity("HDFC Mutual Fund")
        k2, d2 = self.g.norm_entity("HDFC MUTUAL FUND A/C SMALL CAP")
        k3, _ = self.g.norm_entity("HDFC Asset Management Company Ltd")
        self.assertEqual(k1, k2)          # account descriptor + case collapse
        self.assertEqual(k1, "HDFC")
        self.assertTrue(k3.startswith("HDFC"))

    def test_norm_entity_all_boilerplate_keeps_something(self):
        k, d = self.g.norm_entity("Mutual Fund")
        self.assertTrue(k)                 # never returns empty for a real name

    def _deals(self):
        return {"bulk": [
            {"kind": "bulk", "date": "2026-07-10", "symbol": "TATASTEEL",
             "client": "ABC Mutual Fund", "side": "BUY", "qty": 1000, "price": 145.0},
            {"kind": "bulk", "date": "2026-07-12", "symbol": "TATASTEEL",
             "client": "ABC Mutual Fund A/C Growth", "side": "BUY", "qty": 500, "price": 147.0},
            {"kind": "bulk", "date": "2026-07-11", "symbol": "TATASTEEL",
             "client": "XYZ Capital", "side": "SELL", "qty": 800, "price": 146.0},
        ], "block": [
            {"kind": "block", "date": "2026-07-09", "symbol": "INFY",
             "client": "ABC Mutual Fund", "side": "SELL", "qty": 200, "price": 1500.0},
        ]}

    def test_build_flows_aggregates_and_resolves(self):
        gr = self.g.build_flows(self._deals())
        # ABC's two TATASTEEL buys (diff account strings) collapse to ONE edge
        abc_tata = [e for e in gr["edges"]
                    if e["entity"] == "ABC" and e["symbol"] == "TATASTEEL"]
        self.assertEqual(len(abc_tata), 1)
        edge = abc_tata[0]
        self.assertEqual(edge["buy_qty"], 1500)
        self.assertEqual(edge["net_qty"], 1500)
        self.assertEqual(edge["deal_count"], 2)
        self.assertEqual(len(edge["citations"]), 2)
        self.assertEqual(edge["first_date"], "2026-07-10")
        self.assertEqual(edge["last_date"], "2026-07-12")
        self.assertEqual(edge["avg_price"], 146.0)

    def test_entity_breadth(self):
        gr = self.g.build_flows(self._deals())
        abc = next(e for e in gr["nodes"]["entities"] if e["id"] == "ABC")
        self.assertEqual(abc["breadth"], 2)      # TATASTEEL + INFY
        self.assertEqual(sorted(abc["symbols"]), ["INFY", "TATASTEEL"])

    def test_symbol_flows_net_sorted(self):
        gr = self.g.build_flows(self._deals())
        flows = self.g.symbol_flows(gr, "TATASTEEL")
        self.assertEqual(flows[0]["entity"], "ABC")   # +1500 net first
        self.assertEqual(flows[-1]["entity"], "XYZ")  # -800 net last
        self.assertEqual(flows[-1]["net_qty"], -800)

    def test_entity_positions_normalises_query(self):
        gr = self.g.build_flows(self._deals())
        pos = self.g.entity_positions(gr, "abc mutual fund a/c whatever")
        syms = sorted(p["symbol"] for p in pos)
        self.assertEqual(syms, ["INFY", "TATASTEEL"])

    def test_asof_range(self):
        gr = self.g.build_flows(self._deals())
        self.assertEqual(gr["asof"]["first"], "2026-07-09")
        self.assertEqual(gr["asof"]["last"], "2026-07-12")

    def test_empty(self):
        gr = self.g.build_flows({"bulk": [], "block": []})
        self.assertEqual(gr["edges"], [])
        self.assertEqual(gr["nodes"]["entities"], [])

    def test_enrich_company(self):
        node = {"id": "TATASTEEL", "kind": "company"}
        shp = {"latest": {"date": "Jun 2026", "promoter": 45.3, "fii": 22.1,
                          "dii": 18.0, "public": 14.6, "pledge": 1.2}}
        out = self.g.enrich_company(node, shp)
        self.assertEqual(out["shareholding"]["promoter"], 45.3)
        self.assertEqual(out["shareholding"]["period"], "Jun 2026")
        self.assertNotIn("shareholding", node)  # original not mutated


if __name__ == "__main__":
    unittest.main()
