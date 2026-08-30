"""Free / Pro / Max — the published ladder, and the rename that produced it.

The tiers used to be free / member / pro. Pro is now the middle rung at
₹1,499 and Max is the top at ₹4,999, which means the word "pro" changed
meaning: it used to unlock everything and now unlocks the screener. Anything
holding a plan name from before — a member row, members.json on the server, a
saved subscription, a session still in flight — has to keep resolving to what
its holder paid for.
"""

import os
import re
import unittest

import billing
import members
import usage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class LadderTest(unittest.TestCase):
    def test_three_tiers_in_this_order(self):
        self.assertEqual(members.PLAN_LADDER, ["free", "pro", "max"])
        self.assertEqual([p["key"] for p in billing.plans()], ["free", "pro", "max"])
        self.assertEqual(list(members.PLAN_FEATURES), ["free", "pro", "max"])

    def test_the_names_a_customer_reads(self):
        names = {p["key"]: p["name"] for p in billing.plans()}
        self.assertEqual(names, {"free": "Free", "pro": "Pro", "max": "Max"})

    def test_the_prices(self):
        by = {p["key"]: p for p in billing.plans()}
        self.assertEqual(by["free"]["price_paise"], 0)
        self.assertEqual(by["pro"]["price_paise"], 149900)     # ₹1,499
        self.assertEqual(by["max"]["price_paise"], 499900)     # ₹4,999
        for p in billing.plans():
            self.assertIsInstance(p["price_paise"], int,
                                  "money is paise as an integer, never a float")
            self.assertEqual(p["period"], "forever" if p["key"] == "free" else "month")

    def test_each_rung_contains_the_one_below(self):
        """Upgrading must never take something away."""
        free, pro, mx = (set(members.features_for(k)) for k in members.PLAN_LADDER)
        self.assertTrue(free < pro < mx)

    def test_what_each_rung_buys(self):
        pro = members.features_for("pro")
        mx = members.features_for("max")
        for f in ("screener", "patterns", "recommendations", "watchlist", "portfolio"):
            self.assertIn(f, pro)
        for f in ("terminal", "backtest", "dossier", "exports", "alerts"):
            self.assertNotIn(f, pro, f"{f} is a Max feature, not a Pro one")
            self.assertIn(f, mx)

    def test_the_top_plan_is_the_top_of_the_ladder(self):
        self.assertEqual(members.TOP_PLAN, "max")
        self.assertEqual(members.TOP_PLAN, members.PLAN_LADDER[-1])


class RenameTest(unittest.TestCase):
    """Nothing that predates the rename may quietly lose what it paid for."""

    def test_the_middle_rung_kept_its_holders(self):
        self.assertEqual(members.canonical_plan("member"), "pro")
        self.assertEqual(members.features_for("member"), members.features_for("pro"))
        self.assertEqual(usage.limit_for("member", "screen_run"),
                         usage.limit_for("pro", "screen_run"))

    def test_an_unknown_name_lands_on_free_not_on_everything(self):
        self.assertEqual(members.canonical_plan("enterprise"), "free")
        self.assertEqual(members.canonical_plan(""), "free")
        self.assertEqual(members.canonical_plan(None), "free")
        self.assertEqual(members.features_for("enterprise"), members.features_for("free"))
        # and it must not read as "unlimited" to the allowance table either
        self.assertEqual(usage.limit_for("enterprise", "screen_run"),
                         usage.limit_for("free", "screen_run"))

    def test_owners_carry_across_the_rename_by_being_owners(self):
        """Their stored "pro" meant everything. The new "pro" does not, so the
        owner flag is what keeps them whole — not the string."""
        self.assertEqual(members.plan_of({"plan": "pro", "owner": True}), "max")
        for user in ("taureye", "sreeraman", "sri"):
            acct = members._DEFAULT_ACCOUNTS[user]
            self.assertTrue(acct["owner"])
            self.assertEqual(members.plan_of(acct), "max")

    def test_a_non_owner_is_not_promoted_by_that_rule(self):
        self.assertEqual(members.plan_of({"plan": "pro"}), "pro")
        self.assertEqual(members.plan_of({"plan": "free"}), "free")
        self.assertEqual(members.plan_of({}), "free")

    def test_billing_takes_an_old_name_but_refuses_a_made_up_one(self):
        self.assertEqual(billing._plan_key("member"), "pro")
        self.assertEqual(billing._plan_key("MAX"), "max")
        for bad in ("", "enterprise", "platinum", None):
            with self.assertRaises(ValueError):
                billing._plan_key(bad)

    def test_a_signup_still_lands_on_the_bottom_rung(self):
        self.assertIn(members.SIGNUP_PLAN, members.PLAN_LADDER)
        self.assertEqual(members.SIGNUP_PLAN, "free")


class ClientTest(unittest.TestCase):
    """What the app puts in front of someone must be the same ladder."""

    def setUp(self):
        with open(os.path.join(ROOT, "mobile", "src", "components", "Gate.tsx"),
                  encoding="utf-8") as fh:
            self.gate = fh.read()

    def test_the_gate_offers_the_same_three_names(self):
        labels = re.search(r"const PLAN_LABEL: Record<string, string> = \{(.*?)\};",
                           self.gate, re.S).group(1)
        self.assertIn("free:", labels)
        self.assertIn("pro:", labels)
        self.assertIn("max:", labels)
        self.assertNotIn("member:", labels)

    def test_the_gate_quotes_the_prices_the_server_charges(self):
        self.assertIn("₹1,499/month", self.gate)
        self.assertIn("₹4,999/month", self.gate)

    def test_only_the_two_paid_tiers_can_be_asked_for(self):
        self.assertIn("requiredPlan?: 'pro' | 'max';", self.gate)

    def test_every_gated_screen_asks_for_the_tier_the_server_enforces(self):
        """A screen that offers Pro for something only Max unlocks sells an
        upgrade that does not work."""
        screens = os.path.join(ROOT, "mobile", "src", "screens")
        for name in sorted(os.listdir(screens)):
            if not name.endswith(".tsx"):
                continue
            with open(os.path.join(screens, name), encoding="utf-8") as fh:
                src = fh.read()
            m = re.search(r'feature="(\w+)"', src)
            want = re.search(r'requiredPlan="(\w+)"', src)
            if not m or not want:
                continue
            with self.subTest(screen=name):
                self.assertEqual(want.group(1), billing.required_plan(m.group(1)),
                                 f"{name} names the wrong tier for {m.group(1)}")


if __name__ == "__main__":
    unittest.main()
