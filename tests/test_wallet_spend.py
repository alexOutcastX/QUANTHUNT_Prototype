"""Spending credits, and the routes that do it.

wallet.spend() had zero call sites for the whole life of the feature: credits
arrived by referral and plan renewal and could never leave. A currency you
cannot spend is a number on a page.

The retry case is the one that matters. A dropped connection makes the client
resend, and the ledger's unique index on (acct, currency, ref) is what stops
that becoming a second charge.
"""
import os
import tempfile
import unittest


class SpendUnitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        import importlib
        import wallet
        cls.wallet = importlib.reload(wallet)

    def setUp(self):
        self.wallet._reset_for_tests()
        self.wallet.grant("a", 100, "seed", ref="seed")

    def test_a_spend_deducts(self):
        self.assertEqual(self.wallet.spend("a", 10, "thing", ref="x"), 90)
        self.assertEqual(self.wallet.balance("a"), 90)

    def test_a_retry_with_the_same_ref_does_not_charge_twice(self):
        self.wallet.spend("a", 10, "thing", ref="x")
        self.wallet.spend("a", 10, "thing", ref="x")
        self.assertEqual(self.wallet.balance("a"), 90)

    def test_a_retry_reports_the_balance_that_actually_exists(self):
        """The bug this test was written for: the duplicate row was correctly
        refused, but spend() still returned bal - amount, so the caller showed a
        balance too low by the price of whatever they had just retried."""
        self.wallet.spend("a", 10, "thing", ref="x")
        returned = self.wallet.spend("a", 10, "thing", ref="x")
        self.assertEqual(returned, self.wallet.balance("a"))
        self.assertEqual(returned, 90)

    def test_different_refs_charge_separately(self):
        self.wallet.spend("a", 10, "thing", ref="x")
        self.wallet.spend("a", 10, "thing", ref="y")
        self.assertEqual(self.wallet.balance("a"), 80)

    def test_spending_more_than_you_have_is_refused(self):
        with self.assertRaises(self.wallet.InsufficientFunds):
            self.wallet.spend("a", 500, "too much", ref="z")
        self.assertEqual(self.wallet.balance("a"), 100)

    def test_a_refused_spend_writes_nothing(self):
        try:
            self.wallet.spend("a", 500, "too much", ref="z")
        except self.wallet.InsufficientFunds:
            pass
        self.assertNotIn("z", [r.get("ref") for r in self.wallet.history("a")])


class SpendRouteTest(unittest.TestCase):
    IP = "161.118.174.177"

    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        os.environ["TRADELOG_BACKFILL"] = "0"
        os.environ["AUTH_SECRET"] = "spend-route-test"
        try:
            import server
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        server._warm_universe_async = lambda: None
        # /auth/member/login is capped at 10 hits per 5 minutes per IP, and every
        # test module in the suite shares that window. Arriving after a few of
        # them have signed in leaves nothing left, and the 429 surfaces here as
        # a failure that has nothing to do with wallets.
        with server._RL_LOCK:
            server._RL.clear()
        boot = server.app.test_client()
        r = boot.post("/auth/member/login",
                      json={"username": "sri", "password": "STI123"},
                      headers={"Host": cls.IP})
        assert r.status_code == 200, r.data[:200]
        cls.token = r.json["token"]

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("AUTH_SECRET", None)
        # Leave the shared quota as we found it, or the next module inherits an
        # exhausted window.
        with cls.server._RL_LOCK:
            cls.server._RL.clear()

    def setUp(self):
        self.client = self.server.app.test_client()
        self.h = {"Host": self.IP, "X-TE-Member": "Bearer " + self.token}

    def _fund(self, amount=200):
        """Top the account up directly. The daily bonus is capped per trading
        day, so it cannot be used to fund a test."""
        import wallet
        wallet.grant("sri", amount, "test seed", ref=f"seed:{id(self)}")

    def test_daily_claim_then_repeat_is_409(self):
        first = self.client.post("/wallet/daily", headers=self.h)
        self.assertIn(first.status_code, (200, 409))
        again = self.client.post("/wallet/daily", headers=self.h)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json["error"], "already-claimed")

    def test_earn_lists_ways_and_prices(self):
        r = self.client.get("/wallet/earn", headers=self.h)
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json["prices"])
        self.assertIn("daily", [w["key"] for w in r.json["earn"]])

    def test_an_unpriced_action_is_rejected(self):
        r = self.client.post("/wallet/spend", json={"action": "nonsense"}, headers=self.h)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json["error"], "unknown-action")

    def test_spending_without_credits_is_402_not_500(self):
        """402 Payment Required, with what it would have cost — the client turns
        this into an upsell rather than an error."""
        self._fund()
        # Drain whatever is there, then attempt one more.
        import wallet
        bal = wallet.balance("sri")
        if bal:
            wallet.spend("sri", bal, "drain", ref=f"drain:{id(self)}")
        r = self.client.post("/wallet/spend",
                             json={"action": "dossier", "ref": f"d:{id(self)}"},
                             headers=self.h)
        self.assertEqual(r.status_code, 402)
        self.assertEqual(r.json["error"], "insufficient-credits")
        self.assertGreater(r.json["needed"], 0)

    def test_a_funded_spend_succeeds_and_is_idempotent(self):
        import wallet
        wallet.grant("sri", 100, "test", ref=f"fund:{id(self)}")
        before = wallet.balance("sri")
        ref = f"once:{id(self)}"
        a = self.client.post("/wallet/spend", json={"action": "backtest", "ref": ref}, headers=self.h)
        self.assertEqual(a.status_code, 200)
        b = self.client.post("/wallet/spend", json={"action": "backtest", "ref": ref}, headers=self.h)
        self.assertEqual(b.status_code, 200)
        self.assertEqual(wallet.balance("sri"), before - a.json["spent"],
                         "the retry charged a second time")

    def test_history_is_paginated_and_capped(self):
        r = self.client.get("/wallet/history?limit=9999", headers=self.h)
        self.assertEqual(r.status_code, 200)
        self.assertLessEqual(len(r.json["history"]), 200)

    def test_a_bad_limit_does_not_500(self):
        r = self.client.get("/wallet/history?limit=abc", headers=self.h)
        self.assertEqual(r.status_code, 200)

    def test_the_money_routes_serve_on_the_public_domain(self):
        """They were held back to the bare IP while the credit economy was
        unfinished. It is finished, so the domain gets it."""
        h = dict(self.h, Host="taureye.com")
        for path in ("/wallet/earn", "/wallet/history"):
            self.assertNotEqual(self.client.get(path, headers=h).status_code, 404, path)

    def test_staging_can_still_hide_them(self):
        os.environ["PREVIEW_IPONLY"] = "1"
        try:
            h = dict(self.h, Host="taureye.com")
            for path in ("/wallet/earn", "/wallet/history"):
                self.assertEqual(self.client.get(path, headers=h).status_code, 404, path)
            self.assertEqual(self.client.post("/wallet/daily", headers=h).status_code, 404)
        finally:
            os.environ.pop("PREVIEW_IPONLY", None)

    def test_signing_out_locks_the_wallet(self):
        anon = self.server.app.test_client()
        self.assertEqual(anon.get("/wallet/earn", headers={"Host": self.IP}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
