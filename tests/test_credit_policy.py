"""Credits meter usage. They never sell entitlement.

The wallet used to be a second, cheaper paywall running beside the real one:
Gate offered "Use 10 credits" next to the upgrade, and chargeFor refused to
bill anyone whose plan already covered the feature. Between them, the only
people credits touched were the ones who had NOT paid — a fortnight of daily
bonuses bought the backtest, which is the single feature the top tier exists
to sell.

It is the other way round now. The plan decides WHETHER a feature opens; the
credit balance decides HOW MUCH of it you use. These tests hold that line on
the server, where it has to be held — a paywall a client can talk its way past
is not one.
"""

import os
import re
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "mobile", "src")


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as fh:
        return fh.read()


class ActionFeatureMapTest(unittest.TestCase):
    def setUp(self):
        import rewards
        self.rw = rewards

    def test_every_priced_action_names_the_feature_it_needs(self):
        """An action with no feature is an action credits can buy outright —
        which is the thing this map exists to prevent."""
        for action in self.rw.PRICES:
            with self.subTest(action=action):
                self.assertTrue(self.rw.feature_for(action),
                                f"{action} is priced but belongs to no feature")

    def test_each_named_feature_is_one_the_ladder_actually_grants(self):
        import members
        every = set(members.PLAN_FEATURES["max"])
        for action, feature in self.rw.ACTION_FEATURE.items():
            with self.subTest(action=action):
                self.assertIn(feature, every)

    def test_an_unknown_action_belongs_to_nothing(self):
        self.assertEqual(self.rw.feature_for("nonsense"), "")
        self.assertEqual(self.rw.feature_for(""), "")
        self.assertEqual(self.rw.feature_for(None), "")


class SpendRefusalTest(unittest.TestCase):
    """The rule, on the server, against a real free account."""

    IP = "161.118.174.177"

    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        os.environ["TRADELOG_BACKFILL"] = "0"
        os.environ["AUTH_SECRET"] = "credit-policy-test"
        try:
            import server
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        server._warm_universe_async = lambda: None
        with server._RL_LOCK:
            server._RL.clear()
        boot = server.app.test_client()
        r = boot.post("/auth/member/register",
                      json={"username": "creditfree", "password": "a-good-password"},
                      headers={"Host": cls.IP})
        assert r.status_code == 200, r.data[:200]
        cls.free_token = r.json["token"]
        assert r.json["member"]["plan"] == "free", r.json["member"]

        with server._RL_LOCK:
            server._RL.clear()
        r = boot.post("/auth/member/login",
                      json={"username": "sri", "password": "STI123"},
                      headers={"Host": cls.IP})
        assert r.status_code == 200, r.data[:200]
        cls.owner_token = r.json["token"]

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("AUTH_SECRET", None)
        with cls.server._RL_LOCK:
            cls.server._RL.clear()

    def setUp(self):
        self.client = self.server.app.test_client()

    def _h(self, token):
        return {"Host": self.IP, "X-TE-Member": "Bearer " + token}

    def _fund(self, acct, amount=1000):
        # Through the server's own wallet module, not a fresh `import wallet`.
        # Other modules in the suite reload the monetisation modules against
        # throwaway databases, and a test that funds one ledger while the route
        # writes to another passes or fails for reasons unrelated to the rule
        # it is meant to be checking.
        self.server._wallet.grant(acct, amount, "test seed",
                                  ref=f"seed:{acct}:{id(self)}:{amount}")

    def _balance(self, acct):
        return self.server._wallet.balance(acct)

    def test_a_rich_free_account_still_cannot_buy_a_backtest(self):
        """The whole point: no balance is enough, because the balance is not
        what is being asked for."""
        self._fund("creditfree", 100000)
        before = self._balance("creditfree")
        r = self.client.post("/wallet/spend",
                             json={"action": "backtest", "ref": "policy:bt"},
                             headers=self._h(self.free_token))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json["error"], "plan-required")
        self.assertEqual(r.json["feature"], "backtest")
        self.assertEqual(r.json["required_plan"], "max")
        self.assertEqual(self._balance("creditfree"), before,
                         "a refused action must not take the money anyway")

    def test_the_refusal_names_the_plan_and_says_what_credits_are_for(self):
        r = self.client.post("/wallet/spend",
                             json={"action": "dossier", "ref": "policy:d"},
                             headers=self._h(self.free_token))
        self.assertEqual(r.status_code, 403)
        self.assertIn("Max", r.json["detail"])
        self.assertIn("not for the plan itself", r.json["detail"])

    def test_every_priced_action_is_refused_to_a_free_account(self):
        import rewards
        self._fund("creditfree", 100000)
        for action in rewards.PRICES:
            with self.subTest(action=action):
                r = self.client.post("/wallet/spend",
                                     json={"action": action, "ref": f"policy:{action}"},
                                     headers=self._h(self.free_token))
                self.assertEqual(r.status_code, 403, action)
                self.assertEqual(r.json["error"], "plan-required")

    def test_an_account_that_has_the_feature_is_charged_for_using_it(self):
        """The other half. Metering only means something if the people on the
        plan are the ones it applies to."""
        self._fund("sri", 1000)
        before = self._balance("sri")
        r = self.client.post("/wallet/spend",
                             json={"action": "backtest", "ref": f"policy:bt:{id(self)}"},
                             headers=self._h(self.owner_token))
        self.assertEqual(r.status_code, 200, r.data[:200])
        self.assertGreater(r.json["spent"], 0)
        self.assertEqual(self._balance("sri"), before - r.json["spent"])
        self.assertEqual(r.json["balance"], before - r.json["spent"],
                         "the balance the client is told must be the real one")

    def test_an_unpriced_action_is_still_refused_before_any_plan_check(self):
        r = self.client.post("/wallet/spend",
                             json={"action": "nonsense"},
                             headers=self._h(self.owner_token))
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json["error"], "unknown-action")


class ClientPolicyTest(unittest.TestCase):
    """The app must not re-implement, soften or route around the rule."""

    def test_the_gate_offers_exactly_one_way_through(self):
        gate = read("components", "Gate.tsx")
        self.assertNotIn("chargeFor", gate)
        self.assertNotIn("creditAction", gate)
        self.assertIn("hasFeature(feature)", gate)

    def test_no_screen_decides_entitlement_before_charging(self):
        """chargeFor used to take a { feature } and skip the charge when the
        plan covered it. That single option is what inverted the whole model."""
        credits = read("credits.ts")
        self.assertNotIn("hasFeature", credits)
        self.assertNotIn("opts.feature", credits)
        self.assertIn("chargeFor(action: string, ref: string)", credits)

    def test_the_metered_actions_are_charged_where_the_work_happens(self):
        bt = read("screens", "BacktestScreen.tsx")
        self.assertIn("chargeFor('backtest'", bt)
        self.assertLess(bt.index("chargeFor('backtest'"), bt.index("api.btRun("),
                        "the run must be charged before it is launched")
        an = read("screens", "AnalysisScreen.tsx")
        self.assertIn("chargeFor('dossier'", an)

    def test_a_refusal_stops_the_work_and_an_outage_does_not(self):
        credits = read("credits.ts")
        self.assertIn("return !r.ok && r.reason !== 'unavailable';", credits)

    def test_the_wallet_says_what_credits_are_and_are_not(self):
        w = read("screens", "WalletScreen.tsx")
        self.assertIn("they do not buy a plan", w)

    def test_the_refusal_body_survives_the_throw(self):
        """The client branches on the tag and reads the plan out of the body;
        an error carrying only a sentence would make it guess."""
        api = read("api.ts")
        self.assertIn("err.body = d;", api)


if __name__ == "__main__":
    unittest.main()
