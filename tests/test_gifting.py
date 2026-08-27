"""Sending credits to another member.

The policy that matters is what CANNOT be sent. If a plan allowance were
giftable, two accounts on the cheapest paid tier could pass the same allowance
back and forth forever; if referral rewards were, farmed accounts become a
laundering route into one real balance. Both are blocked, and both are the
kind of rule that looks arbitrary until someone exploits it.
"""
import os
import tempfile
import unittest


class GiftingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        import importlib
        import wallet
        import gifting
        cls.wallet = importlib.reload(wallet)
        cls.gifting = importlib.reload(gifting)
        cls.known = {"a", "b", "c"}

    def setUp(self):
        self.wallet._reset_for_tests()

    def _buy(self, acct, n, ref="buy"):
        self.wallet.grant(acct, n, "Top-up purchase", ref=f"{ref}:{acct}:{n}")

    # ── what is giftable ──
    def test_bought_credits_are_giftable(self):
        self._buy("a", 200)
        self.assertEqual(self.gifting.giftable_balance("a"), 200)

    def test_a_daily_bonus_is_not_giftable(self):
        self.wallet.grant("a", 50, "Daily bonus", ref="d1")
        self.assertEqual(self.gifting.giftable_balance("a"), 0)

    def test_a_streak_bonus_is_not_giftable(self):
        self.wallet.grant("a", 300, "7-day streak", ref="s1")
        self.assertEqual(self.gifting.giftable_balance("a"), 0)

    def test_referral_rewards_are_not_giftable(self):
        """Otherwise farmed accounts funnel into one balance."""
        self.wallet.grant("a", 100, "Referred bob", ref="r1")
        self.wallet.grant("a", 50, "Joined via carol", ref="r2")
        self.assertEqual(self.gifting.giftable_balance("a"), 0)

    def test_earned_and_bought_are_separated(self):
        self._buy("a", 200)
        self.wallet.grant("a", 150, "Daily bonus", ref="d2")
        self.assertEqual(self.wallet.balance("a"), 350)
        self.assertEqual(self.gifting.giftable_balance("a"), 200)

    # ── sending ──
    def test_a_gift_moves_credits(self):
        self._buy("a", 200)
        out = self.gifting.send("a", "b", 150, "cheers", known_accounts=self.known)
        self.assertTrue(out["ok"])
        self.assertEqual(self.wallet.balance("a"), 50)
        self.assertEqual(self.wallet.balance("b"), 150)

    def test_both_sides_are_recorded_with_readable_reasons(self):
        self._buy("a", 100)
        self.gifting.send("a", "b", 50, known_accounts=self.known)
        self.assertTrue(any("Gift to b" in (r["reason"] or "")
                            for r in self.wallet.history("a")))
        self.assertTrue(any("Gift from a" in (r["reason"] or "")
                            for r in self.wallet.history("b")))

    def test_you_cannot_gift_yourself(self):
        self._buy("a", 100)
        with self.assertRaises(self.gifting.GiftRefused):
            self.gifting.send("a", "a", 50, known_accounts=self.known)

    def test_an_unknown_recipient_is_refused_without_confirming_it_exists(self):
        """This endpoint must not become a way to enumerate members, so the
        message is the same shape for any name that will not work."""
        self._buy("a", 100)
        with self.assertRaises(self.gifting.GiftRefused) as ctx:
            self.gifting.send("a", "nobody", 50, known_accounts=self.known)
        self.assertIn("No member", str(ctx.exception))

    def test_below_the_minimum_is_refused(self):
        self._buy("a", 100)
        with self.assertRaises(self.gifting.GiftRefused):
            self.gifting.send("a", "b", 1, known_accounts=self.known)

    def test_you_cannot_gift_earned_credits_even_with_the_balance(self):
        self.wallet.grant("a", 500, "Daily bonus", ref="d3")
        with self.assertRaises(self.gifting.GiftRefused) as ctx:
            self.gifting.send("a", "b", 100, known_accounts=self.known)
        self.assertIn("stay with the account", str(ctx.exception))

    def test_a_refused_gift_moves_nothing(self):
        self._buy("a", 100)
        try:
            self.gifting.send("a", "b", 9999, known_accounts=self.known)
        except self.gifting.GiftRefused:
            pass
        self.assertEqual(self.wallet.balance("a"), 100)
        self.assertEqual(self.wallet.balance("b"), 0)

    def test_the_daily_cap_is_enforced(self):
        self._buy("a", 5000)
        cap = self.gifting.DAILY_CAP
        self.gifting.send("a", "b", cap, known_accounts=self.known)
        with self.assertRaises(self.gifting.GiftRefused) as ctx:
            self.gifting.send("a", "c", 10, known_accounts=self.known)
        self.assertIn("today", str(ctx.exception))

    def test_a_non_numeric_amount_is_refused_readably(self):
        self._buy("a", 100)
        with self.assertRaises(self.gifting.GiftRefused):
            self.gifting.send("a", "b", "lots", known_accounts=self.known)

    def test_the_quote_matches_what_send_will_allow(self):
        """The form shows limits BEFORE an attempt; they must not disagree."""
        self._buy("a", 200)
        self.wallet.grant("a", 90, "Daily bonus", ref="d4")
        q = self.gifting.quote("a")
        self.assertEqual(q["giftable"], 200)
        self.assertEqual(q["balance"], 290)
        self.gifting.send("a", "b", q["giftable"], known_accounts=self.known)
        self.assertEqual(self.gifting.quote("a")["giftable"], 0)


if __name__ == "__main__":
    unittest.main()
