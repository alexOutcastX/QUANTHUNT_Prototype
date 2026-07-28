"""Unit tests for the Cases engine (isolated temp DB, no network).

The maths here decides what a user actually buys and how much of it, so the
weighting, sizing and management rules are pinned hard.
"""
import importlib
import os
import tempfile
import time
import unittest


def _row(sym, score=70, price=100.0, mcap=90000, sector="Information Technology",
         roe=20.0, de=0.2, pe=15.0, pb=2.0, dy=2.0, v200=5.0, pfh=-5.0):
    return {"symbol": sym, "name": f"{sym} Ltd", "score": score, "price": price,
            "market_cap_cr": mcap, "sector": sector, "roe": roe, "debt_equity": de,
            "vs_200dma": v200, "pct_from_high": pfh, "tier": "Tier A",
            "metrics": {"pe": pe, "pb": pb, "dividend_yield": dy}}


class CasesMathTest(unittest.TestCase):
    """The pure functions — no DB needed."""

    def setUp(self):
        import cases
        self.c = cases

    # ── weights ──
    def test_weights_sum_to_one(self):
        for scores in ([90, 80, 70], [95] * 8, [60, 61, 62, 63, 64, 65, 66, 90]):
            self.assertAlmostEqual(sum(self.c.weights(scores)), 1.0, places=5)

    def test_weights_follow_score_order(self):
        w = self.c.weights([90, 80, 70, 60, 55, 50, 45, 40])
        self.assertEqual(w, sorted(w, reverse=True))

    def test_no_stock_exceeds_the_cap(self):
        """A runaway score must not turn a basket into a single-stock bet."""
        w = self.c.weights([100, 5, 5, 5, 5, 5, 5, 5])
        self.assertLessEqual(max(w), self.c.MAX_WEIGHT + 1e-6)
        self.assertAlmostEqual(sum(w), 1.0, places=5)

    def test_no_stock_falls_below_the_floor(self):
        w = self.c.weights([100, 100, 100, 100, 100, 100, 100, 1])
        self.assertGreaterEqual(min(w), self.c.MIN_WEIGHT - 1e-6)
        self.assertAlmostEqual(sum(w), 1.0, places=5)

    def test_cap_and_floor_together_still_sum_to_one(self):
        w = self.c.weights([100, 90, 2, 2, 2, 2, 2, 2])
        self.assertAlmostEqual(sum(w), 1.0, places=5)
        self.assertLessEqual(max(w), self.c.MAX_WEIGHT + 1e-6)
        self.assertGreaterEqual(min(w), self.c.MIN_WEIGHT - 1e-6)

    def test_unsatisfiable_cap_falls_back_to_equal_weight(self):
        """With four names a 20% cap cannot sum to 1 — equal weight is the only
        honest answer, and it must still total 1."""
        w = self.c.weights([100, 50, 25, 10], max_w=0.20)
        self.assertEqual(w, [0.25] * 4)

    def test_zero_scores_split_evenly(self):
        self.assertEqual(self.c.weights([0, 0, 0, 0]), [0.25] * 4)

    def test_empty_scores(self):
        self.assertEqual(self.c.weights([]), [])

    # ── minimum investment ──
    def test_min_investment_buys_one_of_everything(self):
        prices, ws = [3200.0, 1700.0, 450.0, 120.0], [0.25, 0.25, 0.25, 0.25]
        mi = self.c.min_investment(prices, ws)
        alloc = self.c.allocate(mi, prices, ws)
        self.assertTrue(all(leg["shares"] >= 1 for leg in alloc["legs"]),
                        f"a leg got zero shares at the stated minimum: {alloc}")

    def test_min_investment_is_driven_by_the_worst_leg(self):
        """The expensive stock on a small weight sets the floor, not the average."""
        mi = self.c.min_investment([100.0, 5000.0], [0.9, 0.1])
        self.assertGreaterEqual(mi, 50000)

    def test_min_investment_rounds_up_to_the_step(self):
        mi = self.c.min_investment([101.0], [1.0], step=500)
        self.assertEqual(mi % 500, 0)
        self.assertGreaterEqual(mi, 101)

    def test_min_investment_ignores_broken_legs(self):
        self.assertEqual(self.c.min_investment([None, 0, -5], [0.3, 0.3, 0.4]), 0.0)

    # ── allocation ──
    def test_allocation_never_overspends(self):
        a = self.c.allocate(50000, [3200.0, 1700.0, 450.0], [0.4, 0.35, 0.25])
        self.assertLessEqual(a["invested"], 50000)
        self.assertAlmostEqual(a["invested"] + a["cash"], 50000, places=2)

    def test_allocation_reports_realised_not_target_weights(self):
        """Whole shares mean the realised split drifts; the page shows the truth."""
        a = self.c.allocate(20000, [3200.0, 120.0], [0.5, 0.5])
        self.assertNotEqual(a["legs"][0]["actual_weight"], 0.5)
        self.assertAlmostEqual(sum(l["actual_weight"] for l in a["legs"]), 1.0, places=4)

    def test_allocation_of_nothing(self):
        a = self.c.allocate(0, [100.0], [1.0])
        self.assertEqual(a["invested"], 0)
        self.assertEqual(a["legs"][0]["shares"], 0)

    # ── CAGR ──
    def test_cagr_one_year(self):
        self.assertEqual(self.c.cagr(100, 120, self.c.YEAR), 20.0)

    def test_cagr_two_years_compounds(self):
        self.assertAlmostEqual(self.c.cagr(100, 144, 2 * self.c.YEAR), 20.0, places=1)

    def test_cagr_refuses_a_short_window(self):
        """Annualising three weeks of data produces a number that means nothing."""
        self.assertIsNone(self.c.cagr(100, 120, 20 * self.c.DAY))

    def test_cagr_handles_bad_input(self):
        self.assertIsNone(self.c.cagr(0, 120, self.c.YEAR))
        self.assertIsNone(self.c.cagr(100, None, self.c.YEAR))
        self.assertIsNone(self.c.cagr(100, 120, None))

    # ── basket return ──
    def test_basket_return_is_weighted(self):
        hs = [{"symbol": "A", "weight": 0.75, "entry": 100.0, "status": "held"},
              {"symbol": "B", "weight": 0.25, "entry": 100.0, "status": "held"}]
        r = self.c.basket_return(hs, {"A": 120.0, "B": 80.0})
        self.assertEqual(r["return_pct"], 10.0)      # .75*20 + .25*(-20)

    def test_basket_return_keeps_an_exited_leg_at_its_exit(self):
        """Booking a profit must not erase it from the basket's record."""
        hs = [{"symbol": "A", "weight": 0.5, "entry": 100.0, "status": "exited", "exit": 150.0},
              {"symbol": "B", "weight": 0.5, "entry": 100.0, "status": "held"}]
        r = self.c.basket_return(hs, {"A": 10.0, "B": 100.0})
        self.assertEqual(r["return_pct"], 25.0)

    def test_basket_return_without_prices(self):
        r = self.c.basket_return([{"symbol": "A", "weight": 1, "entry": 100.0, "status": "held"}], {})
        self.assertIsNone(r["return_pct"])

    # ── review rules ──
    def _held(self, sym, entry=100.0):
        return {"symbol": sym, "weight": 0.125, "entry": entry, "status": "held"}

    def test_books_a_runner(self):
        acts = self.c.review_actions([self._held("A")], {"A": 100 * (1 + self.c.BOOK_AT_PCT / 100)},
                                     {"A": 80})
        self.assertEqual([a["action"] for a in acts], ["book"])
        self.assertEqual(acts[0]["qty_pct"], self.c.BOOK_FRACTION * 100)

    def test_exits_a_broken_thesis(self):
        acts = self.c.review_actions([self._held("A")], {"A": 110.0},
                                     {"A": self.c.EXIT_SCORE - 1})
        self.assertEqual([a["action"] for a in acts], ["exit"])
        self.assertIn("Thesis no longer holds", acts[0]["note"])

    def test_exits_a_big_loser(self):
        acts = self.c.review_actions([self._held("A")], {"A": 60.0}, {"A": 80})
        self.assertEqual([a["action"] for a in acts], ["exit"])

    def test_exit_beats_book_when_both_apply(self):
        """A name that doubled but whose thesis broke is sold, not trimmed —
        otherwise the engine keeps half a position it no longer believes in."""
        acts = self.c.review_actions([self._held("A")], {"A": 200.0},
                                     {"A": self.c.EXIT_SCORE - 1})
        self.assertEqual([a["action"] for a in acts], ["exit"])

    def test_leaves_a_normal_holding_alone(self):
        self.assertEqual(self.c.review_actions([self._held("A")], {"A": 105.0}, {"A": 75}), [])

    def test_does_not_re_book_the_same_position(self):
        h = {**self._held("A"), "booked": True}
        self.assertEqual(self.c.review_actions([h], {"A": 300.0}, {"A": 80}), [])

    def test_skips_holdings_without_a_price(self):
        self.assertEqual(self.c.review_actions([self._held("A")], {}, {"A": 10}), [])

    def test_ignores_already_exited_holdings(self):
        h = {**self._held("A"), "status": "exited"}
        self.assertEqual(self.c.review_actions([h], {"A": 1.0}, {"A": 1}), [])


class CasesBuildTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        os.environ["DB_PATH"] = self.tmp.name
        import store
        self.store = importlib.reload(store)
        import cases
        self.c = importlib.reload(cases)
        self.now = int(time.time())

    def tearDown(self):
        try:
            os.unlink(self.tmp.name)
        except OSError:
            pass
        os.environ.pop("DB_PATH", None)

    def _pool(self, n=40):
        secs = ["Information Technology", "Healthcare", "Financial Services"]
        caps = [90000, 40000, 8000]
        return [_row(f"S{i:02d}", score=88 - i * 0.7, price=100.0 + i * 11,
                     mcap=caps[i % 3], sector=secs[i % 3]) for i in range(n)]

    def test_builds_every_kind(self):
        built = self.c.build_cases(self._pool())
        kinds = {c["kind"] for c in built}
        self.assertEqual(kinds, {"multibagger", "sector", "cap", "strategy"})

    def test_case_is_capped_at_target_size(self):
        for c in self.c.build_cases(self._pool(80)):
            self.assertLessEqual(len(c["constituents"]), self.c.TARGET_N)

    def test_thin_groups_are_dropped_not_padded(self):
        """A sector with two qualifying names must not be published as a case —
        padding it with weaker stocks would misrepresent the screen."""
        pool = [_row("A", sector="Textiles"), _row("B", sector="Textiles")]
        pool += [_row(f"X{i}", sector="Healthcare") for i in range(8)]
        ids = {c["id"] for c in self.c.build_cases(pool)}
        self.assertNotIn("sector-textiles", ids)
        self.assertIn("sector-healthcare", ids)

    def test_low_scores_are_excluded(self):
        pool = [_row(f"L{i}", score=self.c.MIN_SCORE - 5) for i in range(12)]
        self.assertEqual(self.c.build_cases(pool), [])

    def test_constituents_carry_what_the_page_needs(self):
        c = self.c.build_cases(self._pool())[0]
        for k in ("symbol", "name", "weight", "price", "score", "shares", "value"):
            self.assertIn(k, c["constituents"][0])
        self.assertGreater(c["min_investment"], 0)

    def test_cap_bands_do_not_overlap(self):
        built = {c["id"]: c for c in self.c.build_cases(self._pool(60))}
        large = {k["symbol"] for k in built["cap-largecap"]["constituents"]}
        small = {k["symbol"] for k in built["cap-smallcap"]["constituents"]}
        self.assertFalse(large & small)

    def test_quality_case_only_holds_quality(self):
        pool = [_row(f"Q{i}", roe=25, de=0.1) for i in range(6)]
        pool += [_row(f"J{i}", roe=4, de=3.0) for i in range(6)]
        built = {c["id"]: c for c in self.c.build_cases(pool)}
        held = {k["symbol"] for k in built["strategy-quality"]["constituents"]}
        self.assertTrue(all(s.startswith("Q") for s in held), held)

    def test_reserve_bench_is_kept(self):
        c = [x for x in self.c.build_cases(self._pool(60)) if x["id"] == "multibagger-flagship"][0]
        self.assertTrue(c["reserve"])
        held = {k["symbol"] for k in c["constituents"]}
        self.assertFalse(held & {r["symbol"] for r in c["reserve"]})

    # ── persistence + the driver ──
    def test_saves_and_reads_back(self):
        self.c.build_and_review(self._pool())
        ov = self.c.overview({})
        self.assertGreater(ov["count"], 0)
        d = self.c.case_detail("multibagger-flagship", {})
        self.assertEqual(len(d["constituents"]), self.c.TARGET_N)
        self.assertTrue(d["actions"])       # the vintage strike is logged

    def test_second_pass_in_the_same_year_does_not_restrike(self):
        pool = self._pool()
        first = self.c.build_and_review(pool)
        second = self.c.build_and_review(pool)
        self.assertGreater(first["struck"], 0)
        self.assertEqual(second["struck"], 0)

    def test_a_new_year_restrikes_the_vintage(self):
        self.c.build_and_review(self._pool())
        c = self.c.all_cases()[0]
        self.assertFalse(self.c.needs_vintage(c))
        self.assertTrue(self.c.needs_vintage({**c, "vintage": c["vintage"] - 1}))

    def test_restriking_closes_the_old_holdings_rather_than_deleting_them(self):
        pool = self._pool()
        self.c.build_and_review(pool)
        before = self.store.query("SELECT COUNT(*) n FROM case_holdings")[0]["n"]
        c = [x for x in self.c.build_cases(pool) if x["id"] == "multibagger-flagship"][0]
        self.c.save_case({**c, "vintage": c["vintage"] + 1})
        rows = self.store.query("SELECT status, COUNT(*) n FROM case_holdings GROUP BY status")
        by = {r["status"]: r["n"] for r in rows}
        self.assertIn("rebalanced", by)
        self.assertGreater(sum(by.values()), before)

    def test_engine_actions_are_applied_and_logged(self):
        self.c.build_and_review(self._pool())
        cid = "multibagger-flagship"
        hs = self.c.holdings_of(cid)
        target = hs[0]["symbol"]
        quotes = {h["symbol"]: h["entry"] for h in hs}
        quotes[target] = hs[0]["entry"] * 2          # a runaway
        acts = self.c.review_actions(hs, quotes, {h["symbol"]: 80 for h in hs})
        self.assertEqual(self.c.apply_actions(cid, acts, []), 1)
        after = {h["symbol"]: h for h in self.c.holdings_of(cid)}
        self.assertEqual(after[target]["status"], "booked")
        self.assertAlmostEqual(after[target]["weight"], hs[0]["weight"] * 0.5, places=5)
        self.assertTrue(any(a["action"] == "book" for a in self.c.actions_of(cid)))

    def test_an_exit_is_refilled_from_the_bench(self):
        self.c.build_and_review(self._pool())
        cid = "multibagger-flagship"
        hs = self.c.holdings_of(cid)
        gone = hs[0]["symbol"]
        quotes = {h["symbol"]: h["entry"] for h in hs}
        acts = self.c.review_actions(hs, quotes,
                                     {**{h["symbol"]: 80 for h in hs}, gone: 10})
        self.c.apply_actions(cid, acts, [{"symbol": "BENCH1", "name": "Bench", "score": 70,
                                          "price": 100.0}])
        rows = {h["symbol"]: h for h in self.c.holdings_of(cid)}
        self.assertNotIn(gone, rows)
        self.assertIn("BENCH1", rows)
        # A replacement is sized like any other leg — a holding showing zero
        # shares would read as broken.
        self.assertGreater(rows["BENCH1"]["shares"], 0)
        log = [a["action"] for a in self.c.actions_of(cid)]
        self.assertIn("add", log)
        self.assertIn("exit", log)

    def test_an_empty_bench_leaves_the_slot_open(self):
        self.c.build_and_review(self._pool())
        cid = "multibagger-flagship"
        hs = self.c.holdings_of(cid)
        gone = hs[0]["symbol"]
        acts = self.c.review_actions(hs, {h["symbol"]: h["entry"] for h in hs},
                                     {**{h["symbol"]: 80 for h in hs}, gone: 10})
        self.c.apply_actions(cid, acts, [])
        self.assertEqual(len(self.c.holdings_of(cid)), self.c.TARGET_N - 1)

    def test_detail_of_an_unknown_case(self):
        self.assertIsNone(self.c.case_detail("nope", {}))

    def test_overview_publishes_the_rules(self):
        self.c.build_and_review(self._pool())
        r = self.c.overview({})["rules"]
        self.assertEqual(r["min_score"], self.c.MIN_SCORE)
        self.assertEqual(r["exit_score"], self.c.EXIT_SCORE)
        self.assertEqual(r["rebalance"], "annual")

    def test_slug_is_url_safe(self):
        self.assertEqual(self.c.slug("Oil Gas & Consumable Fuels"), "oil-gas-consumable-fuels")


if __name__ == "__main__":
    unittest.main()
