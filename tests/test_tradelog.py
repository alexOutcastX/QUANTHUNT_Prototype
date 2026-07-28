"""Unit tests for the recommendation track record (isolated temp DB, no network).

The ledger is the app's honesty surface — if it can double-count a pick, drop a
loss, or quietly mis-settle a trade, the win rate on the Historic tab is a lie.
These tests pin the settlement rules and the arithmetic.
"""
import importlib
import os
import tempfile
import time
import unittest


class TradeLogTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        os.environ["DB_PATH"] = self.tmp.name
        import store
        self.store = importlib.reload(store)
        import tradelog
        self.t = importlib.reload(tradelog)
        self.now = int(time.time())

    def tearDown(self):
        try:
            os.unlink(self.tmp.name)
        except OSError:
            pass
        os.environ.pop("DB_PATH", None)

    # ── recording ────────────────────────────────────────────────────────────
    def _buy(self, symbol="TCS", **kw):
        rec = {"symbol": symbol, "name": symbol, "action": "BUY", "entry": 100.0,
               "stop": 90.0, "target": 130.0, "confidence": 70,
               "rationale": ["Above the 50-DMA"]}
        rec.update(kw)
        return rec

    def test_records_a_buy(self):
        self.assertEqual(self.t.record_reco(self._buy()), 1)
        rows = self.t.ledger()["trades"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["symbol"], "TCS")
        self.assertEqual(rows[0]["status"], "open")
        self.assertEqual(rows[0]["entry"], 100.0)
        self.assertEqual(rows[0]["rationale"], ["Above the 50-DMA"])

    def test_watch_and_avoid_are_not_trades(self):
        self.assertEqual(self.t.record_reco(self._buy(action="WATCH")), 0)
        self.assertEqual(self.t.record_reco(self._buy(action="AVOID")), 0)
        self.assertEqual(self.t.record_reco(self._buy(action="SKIP")), 0)
        self.assertEqual(self.t.ledger()["summary"]["total"], 0)

    def test_repeat_recommendation_does_not_duplicate(self):
        """A name shown a hundred times is still one call — otherwise merely
        browsing the app would pad the record."""
        self.t.record_reco(self._buy())
        for _ in range(5):
            self.t.record_reco(self._buy(entry=105.0))
        self.assertEqual(self.t.ledger()["summary"]["total"], 1)

    def test_reopens_once_the_earlier_call_is_settled(self):
        self.t.record_reco(self._buy())
        self.t.reconcile({"TCS": 130.0})
        self.assertEqual(self.t.record_reco(self._buy()), 1)
        self.assertEqual(self.t.ledger()["summary"]["total"], 2)

    def test_each_source_tracks_its_own_symbol(self):
        self.t.record_reco(self._buy("INFY"))
        self.t.record_momentum([{"symbol": "INFY", "price": 100, "score": 80,
                                 "target": 120, "setup": "fired", "signals": ["x"]}])
        self.assertEqual(self.t.ledger()["summary"]["total"], 2)
        self.assertEqual(self.t.ledger(source="reco")["summary"]["total"], 1)

    def test_entryless_picks_are_skipped(self):
        """No price, no trade — a record needs a level to measure from."""
        self.assertEqual(self.t.record("momentum", [{"symbol": "X", "entry": None}]), 0)
        self.assertEqual(self.t.record("momentum", [{"symbol": "X", "entry": 0}]), 0)
        self.assertEqual(self.t.record("momentum", [{"symbol": "", "entry": 10}]), 0)

    def test_unknown_source_rejected(self):
        self.assertEqual(self.t.record("hunch", [{"symbol": "X", "entry": 10}]), 0)

    # ── momentum / multibagger recording rules ───────────────────────────────
    def _mom(self, n, score=80):
        return [{"symbol": f"S{i}", "name": f"Stock {i}", "price": 100.0, "target": 120.0,
                 "score": score, "setup": "pullback", "signals": ["Trend intact"]}
                for i in range(n)]

    def test_momentum_takes_only_the_top_slice(self):
        self.assertEqual(self.t.record_momentum(self._mom(60)), self.t.MOM_TOP)

    def test_momentum_below_the_bar_is_ignored(self):
        self.assertEqual(self.t.record_momentum(self._mom(5, score=self.t.MOM_MIN_SCORE - 1)), 0)
        self.assertEqual(self.t.record_momentum(self._mom(5, score=self.t.MOM_MIN_SCORE)), 5)

    def test_momentum_keeps_the_highest_scores(self):
        picks = [{"symbol": "LOW", "price": 100, "score": 61, "setup": "fired", "signals": []},
                 {"symbol": "HIGH", "price": 100, "score": 95, "setup": "fired", "signals": []}]
        self.t.MOM_TOP = 1
        try:
            self.t.record_momentum(picks)
        finally:
            importlib.reload(self.t)
        rows = self.t.ledger()["trades"]
        self.assertEqual([r["symbol"] for r in rows], ["HIGH"])

    def test_momentum_publishes_no_stop(self):
        """The radar doesn't produce a stop-loss, so the ledger must not invent
        one — an invented stop would settle trades the engine never called."""
        self.t.record_momentum(self._mom(1))
        self.assertIsNone(self.t.ledger()["trades"][0]["stop"])

    def test_multibagger_has_no_price_objective(self):
        self.t.record_multibagger([{"symbol": "ABC", "price": 500.0, "score": 78,
                                    "tier": "Tier A", "roe": 22.5, "debt_equity": 0.1}])
        row = self.t.ledger()["trades"][0]
        self.assertIsNone(row["target"])
        self.assertIsNone(row["stop"])
        self.assertEqual(row["horizon_days"], self.t.HORIZON["multibagger"])
        self.assertIn("Analyser 78/100", row["strategy"])
        self.assertTrue(any("Return on equity" in r for r in row["rationale"]))

    def test_multibagger_takes_only_the_top_slice(self):
        picks = [{"symbol": f"S{i}", "price": 10.0, "score": 60 + i} for i in range(40)]
        self.assertEqual(self.t.record_multibagger(picks), self.t.MB_TOP)

    # ── settlement ───────────────────────────────────────────────────────────
    def test_target_settles_at_the_target_not_the_spike(self):
        """A gap through the target fills at the target. Marking the spike would
        credit the record with a price the trade never realistically got."""
        self.t.record_reco(self._buy())
        res = self.t.reconcile({"TCS": 180.0})
        self.assertEqual(res["won"], 1)
        row = self.t.ledger()["trades"][0]
        self.assertEqual(row["status"], "won")
        self.assertEqual(row["exit"], 130.0)
        self.assertEqual(row["pl_pct"], 30.0)

    def test_stop_settles_at_the_stop(self):
        self.t.record_reco(self._buy())
        res = self.t.reconcile({"TCS": 50.0})
        self.assertEqual(res["lost"], 1)
        row = self.t.ledger()["trades"][0]
        self.assertEqual(row["status"], "lost")
        self.assertEqual(row["exit"], 90.0)
        self.assertEqual(row["pl_pct"], -10.0)

    def test_horizon_closes_at_the_market(self):
        self.t.record_reco(self._buy())
        later = self.now + (self.t.HORIZON["reco"] + 1) * self.t.DAY
        res = self.t.reconcile({"TCS": 112.0}, now=later)
        self.assertEqual(res["closed"], 1)
        row = self.t.ledger()["trades"][0]
        self.assertEqual(row["status"], "closed")
        self.assertEqual(row["exit"], 112.0)
        self.assertEqual(row["pl_pct"], 12.0)

    def test_running_trade_is_only_marked(self):
        self.t.record_reco(self._buy())
        res = self.t.reconcile({"TCS": 110.0})
        self.assertEqual((res["won"], res["lost"], res["closed"], res["marked"]), (0, 0, 0, 1))
        row = self.t.ledger()["trades"][0]
        self.assertEqual(row["status"], "open")
        self.assertEqual(row["pl_pct"], 10.0)
        self.assertIsNone(row["exit"])

    def test_target_wins_over_a_simultaneous_stop(self):
        """Both levels can't be checked intrabar from a daily close; the ledger
        resolves the ambiguity the same way every time so the record is
        reproducible."""
        self.t.record("reco", [{"symbol": "Z", "entry": 100, "stop": 120, "target": 110}])
        self.t.reconcile({"Z": 130})
        self.assertEqual(self.t.ledger()["trades"][0]["status"], "won")

    def test_missing_price_leaves_the_trade_untouched(self):
        self.t.record_reco(self._buy())
        before = self.t.ledger()["trades"][0]
        self.t.reconcile({})
        self.t.reconcile({"TCS": None})
        after = self.t.ledger()["trades"][0]
        self.assertEqual(after["status"], "open")
        self.assertEqual(after["marked"], before["marked"])

    def test_settled_trades_are_not_re_settled(self):
        self.t.record_reco(self._buy())
        self.t.reconcile({"TCS": 130.0})
        res = self.t.reconcile({"TCS": 50.0})     # a later crash must not undo the win
        self.assertEqual(res, {"won": 0, "lost": 0, "closed": 0, "marked": 0,
                               "open": 0, "priced": 0})
        self.assertEqual(self.t.ledger()["trades"][0]["status"], "won")

    def test_short_side_settles_inverted(self):
        self.t.record("reco", [{"symbol": "S", "side": "short", "entry": 100,
                                "stop": 110, "target": 90}])
        self.t.reconcile({"S": 88})
        row = self.t.ledger()["trades"][0]
        self.assertEqual(row["status"], "won")
        self.assertEqual(row["pl_pct"], 10.0)

    def test_a_stop_free_trade_runs_to_target_or_horizon(self):
        self.t.record_momentum(self._mom(1))
        self.t.reconcile({"S0": 1.0})             # would be a catastrophic stop-out
        self.assertEqual(self.t.ledger()["trades"][0]["status"], "open")

    # ── derived numbers ──────────────────────────────────────────────────────
    def test_hold_days_counts_to_the_close(self):
        self.t.record_reco(self._buy())
        self.t.reconcile({"TCS": 130.0}, now=self.now + 9 * self.t.DAY)
        self.assertEqual(self.t.ledger()["trades"][0]["hold_days"], 9)

    def test_open_hold_days_counts_to_now(self):
        old = self.now - 5 * self.t.DAY
        self.t.record("reco", [{"symbol": "O", "entry": 100, "target": 200}], now=old)
        self.assertEqual(self.t.ledger()["trades"][0]["hold_days"], 5)

    def test_pl_amount_uses_the_flat_notional(self):
        self.t.record_reco(self._buy())
        self.t.reconcile({"TCS": 130.0})
        row = self.t.ledger()["trades"][0]
        self.assertEqual(row["pl_amt"], round(self.t.NOTIONAL * 0.30, 2))

    def test_pnl_pct_respects_side(self):
        self.assertEqual(self.t.pnl_pct(100, 110), 10.0)
        self.assertEqual(self.t.pnl_pct(100, 110, "short"), -10.0)
        self.assertIsNone(self.t.pnl_pct(0, 110))
        self.assertIsNone(self.t.pnl_pct(100, None))

    def test_reco_horizon_follows_the_engine_eta(self):
        self.t.record_reco(self._buy("A", eta_days=10))
        self.t.record_reco(self._buy("B", eta_days=200))
        rows = {r["symbol"]: r for r in self.t.ledger()["trades"]}
        self.assertEqual(rows["A"]["horizon_days"], 21)      # floored
        self.assertEqual(rows["B"]["horizon_days"], 180)     # capped

    # ── summary ──────────────────────────────────────────────────────────────
    def test_summary_counts_only_settled_trades_in_the_win_rate(self):
        self.t.record("reco", [{"symbol": "W", "entry": 100, "stop": 90, "target": 110},
                               {"symbol": "L", "entry": 100, "stop": 90, "target": 110},
                               {"symbol": "R", "entry": 100, "stop": 90, "target": 110}])
        self.t.reconcile({"W": 115, "L": 85, "R": 101})
        s = self.t.ledger()["summary"]
        self.assertEqual((s["total"], s["settled"], s["open"]), (3, 2, 1))
        self.assertEqual((s["won"], s["lost"]), (1, 1))
        self.assertEqual(s["win_rate"], 50.0)
        self.assertEqual(s["best"]["symbol"], "W")
        self.assertEqual(s["worst"]["symbol"], "L")

    def test_summary_separates_booked_from_running_money(self):
        self.t.record("reco", [{"symbol": "W", "entry": 100, "stop": 90, "target": 110},
                               {"symbol": "R", "entry": 100, "stop": 90, "target": 200}])
        self.t.reconcile({"W": 115, "R": 105})
        s = self.t.ledger()["summary"]
        self.assertEqual(s["total_pl_amt"], round(self.t.NOTIONAL * 0.10, 2))
        self.assertEqual(s["open_pl_amt"], round(self.t.NOTIONAL * 0.05, 2))
        self.assertEqual(s["open_avg_pl_pct"], 5.0)

    def test_empty_ledger_summarises_without_dividing_by_zero(self):
        s = self.t.ledger()["summary"]
        self.assertEqual(s["total"], 0)
        self.assertIsNone(s["win_rate"])
        self.assertIsNone(s["avg_pl_pct"])
        self.assertIsNone(s["best"])
        self.assertEqual(s["total_pl_amt"], 0.0)

    # ── filtering / reading ──────────────────────────────────────────────────
    def test_filters_by_source_and_status(self):
        self.t.record_reco(self._buy("A"))
        self.t.record_multibagger([{"symbol": "B", "price": 50.0, "score": 70}])
        self.t.reconcile({"A": 130.0})
        self.assertEqual(len(self.t.ledger(source="reco")["trades"]), 1)
        self.assertEqual(len(self.t.ledger(source="multibagger")["trades"]), 1)
        self.assertEqual(len(self.t.ledger(status="won")["trades"]), 1)
        self.assertEqual(len(self.t.ledger(status="open")["trades"]), 1)
        self.assertEqual(self.t.ledger()["by_source"], {"reco": 1, "multibagger": 1})

    def test_by_source_counts_the_whole_ledger_not_the_filtered_page(self):
        self.t.record_reco(self._buy("A"))
        self.t.record_multibagger([{"symbol": "B", "price": 50.0, "score": 70}])
        self.assertEqual(self.t.ledger(source="reco")["by_source"], {"reco": 1, "multibagger": 1})

    def test_newest_first(self):
        self.t.record("reco", [{"symbol": "OLD", "entry": 10}], now=self.now - 86400)
        self.t.record("reco", [{"symbol": "NEW", "entry": 10}], now=self.now)
        self.assertEqual([r["symbol"] for r in self.t.ledger()["trades"]], ["NEW", "OLD"])

    def test_limit_is_bounded(self):
        self.t.record("reco", [{"symbol": f"S{i}", "entry": 10} for i in range(5)])
        self.assertEqual(len(self.t.ledger(limit=2)["trades"]), 2)
        self.assertEqual(len(self.t.ledger(limit=0)["trades"]), 5)      # clamped to >=1 … of 5

    def test_rules_are_published_with_the_record(self):
        """The page states the recording bars; they must come from the code, not
        from a hard-coded string in the UI."""
        rules = self.t.ledger()["rules"]
        self.assertEqual(rules["momentum_top"], self.t.MOM_TOP)
        self.assertEqual(rules["momentum_min_score"], self.t.MOM_MIN_SCORE)
        self.assertEqual(rules["multibagger_top"], self.t.MB_TOP)
        self.assertEqual(rules["notional"], self.t.NOTIONAL)
        self.assertEqual(set(rules["horizon_days"]), {"reco", "momentum", "multibagger"})

    def test_open_symbols_lists_live_trades_only(self):
        self.t.record("reco", [{"symbol": "A", "entry": 100, "target": 110},
                               {"symbol": "B", "entry": 100, "target": 110}])
        self.t.reconcile({"A": 120})
        self.assertEqual(self.t.open_symbols(), ["B"])

    def test_ledger_survives_corrupt_json_columns(self):
        self.t.record_reco(self._buy())
        self.store.execute("UPDATE tradelog SET rationale='{oops', meta='nope'")
        row = self.t.ledger()["trades"][0]
        self.assertEqual(row["rationale"], [])
        self.assertEqual(row["meta"], {})


if __name__ == "__main__":
    unittest.main()
