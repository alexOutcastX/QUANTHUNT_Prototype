"""Monthly allowances, and the referral payout split.

Two things the plan asked for that turned out to be the same idea from
different directions: a cost that is real but continuous cannot be charged
per-action (that charges for scrolling), and a reward paid entirely on signup
pays for the one thing that is trivial to manufacture.
"""
import os
import tempfile
import time
import unittest


class AllowanceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        import importlib
        import usage
        cls.usage = importlib.reload(usage)

    def setUp(self):
        self.usage._reset_for_tests()

    def test_free_gets_a_small_monthly_allowance(self):
        self.assertEqual(self.usage.limit_for("free", "screen_run"), 3)

    def test_max_is_unlimited(self):
        """None, not a large number — an 'unlimited' that is really 9999 is a
        bug waiting for a power user."""
        self.assertIsNone(self.usage.limit_for("max", "screen_run"))
        self.assertIsNone(self.usage.remaining("a", "screen_run", "max"))
        self.assertTrue(self.usage.allows("a", "screen_run", "max"))

    def test_pro_sits_between_the_two(self):
        self.assertEqual(self.usage.limit_for("pro", "screen_run"), 100)
        self.assertEqual(self.usage.limit_for("pro", "backtest"), 5)

    def test_a_plan_name_from_before_the_rename_gets_its_heir(self):
        """A session still carrying "member" must get Pro's allowance, not the
        empty dict that reads as unlimited."""
        self.assertEqual(self.usage.limit_for("member", "screen_run"),
                         self.usage.limit_for("pro", "screen_run"))
        # and an unrecognised name lands on free, never on unlimited
        self.assertEqual(self.usage.limit_for("nonsense", "screen_run"), 3)

    def test_an_allowance_runs_out(self):
        for _ in range(3):
            self.assertTrue(self.usage.allows("a", "screen_run", "free"))
            self.usage.record("a", "screen_run")
        self.assertFalse(self.usage.allows("a", "screen_run", "free"))

    def test_a_zero_allowance_blocks_immediately(self):
        self.assertEqual(self.usage.limit_for("free", "backtest"), 0)
        self.assertFalse(self.usage.allows("a", "backtest", "free"))

    def test_counters_are_per_account(self):
        for _ in range(3):
            self.usage.record("a", "screen_run")
        self.assertTrue(self.usage.allows("b", "screen_run", "free"))

    def test_counters_are_per_action(self):
        for _ in range(3):
            self.usage.record("a", "screen_run")
        self.assertEqual(self.usage.used("a", "dossier"), 0)

    def test_a_new_month_starts_clean(self):
        """The period is part of the key, so a month rolls over without
        anything having to run at midnight."""
        now = int(time.time())
        last_month = now - 40 * 24 * 3600
        for _ in range(3):
            self.usage.record("a", "screen_run", ts=last_month)
        self.assertFalse(self.usage.allows("a", "screen_run", "free", ts=last_month))
        self.assertTrue(self.usage.allows("a", "screen_run", "free", ts=now))

    def test_summary_shows_a_limit_before_it_bites(self):
        self.usage.record("a", "screen_run")
        s = self.usage.summary("a", "free")["actions"]["screen_run"]
        self.assertEqual((s["used"], s["limit"], s["remaining"]), (1, 3, 2))
        self.assertFalse(s["unlimited"])

    def test_an_empty_account_records_nothing(self):
        self.assertEqual(self.usage.record("", "screen_run"), 0)


class ReferralSplitTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        import importlib
        import wallet
        import referrals
        cls.wallet = importlib.reload(wallet)
        cls.ref = importlib.reload(referrals)

    def setUp(self):
        self.wallet._reset_for_tests()
        self.ref._reset_for_tests()
        self.cands = ["alice", "bob", "carol"]

    def _claim(self, referee="bob", referrer="alice"):
        return self.ref.claim(referee, self.ref.code_for(referrer), self.cands)

    def test_signup_pays_only_a_share(self):
        out = self._claim()
        self.assertLess(out["referrer_credits"], self.ref.REFERRER_REWARD)
        self.assertGreater(out["referrer_credits"], 0)
        self.assertGreater(out["pending_referrer"], 0)

    def test_activation_pays_the_rest_and_the_total_is_exact(self):
        """Rounding must not lose or invent a credit."""
        self._claim()
        self.ref.activate("bob")
        self.assertEqual(self.wallet.balance("alice"), self.ref.REFERRER_REWARD)
        self.assertEqual(self.wallet.balance("bob"), self.ref.REFEREE_REWARD)

    def test_activation_is_idempotent(self):
        self._claim()
        self.ref.activate("bob")
        again = self.ref.activate("bob")
        self.assertFalse(again["ok"])
        self.assertEqual(again["reason"], "already-activated")
        self.assertEqual(self.wallet.balance("alice"), self.ref.REFERRER_REWARD)

    def test_an_account_that_never_activates_earns_only_the_share(self):
        """The whole point: a farm of signups that do nothing is cheap."""
        self._claim()
        self.assertLess(self.wallet.balance("alice"), self.ref.REFERRER_REWARD)

    def test_activating_an_unreferred_account_is_a_no_op(self):
        r = self.ref.activate("carol")
        self.assertFalse(r["ok"])
        self.assertEqual(r["reason"], "not-referred")

    def test_activation_without_an_account_is_refused(self):
        self.assertFalse(self.ref.activate("")["ok"])

    def test_the_split_never_loses_a_credit(self):
        for total in range(0, 40):
            now, rest = self.ref._split(total)
            with self.subTest(total=total):
                self.assertEqual(now + rest, total)
                self.assertGreaterEqual(now, 0)
                self.assertGreaterEqual(rest, 0)

    def test_self_referral_is_still_blocked(self):
        with self.assertRaises(self.ref.ReferralError):
            self.ref.claim("alice", self.ref.code_for("alice"), self.cands)

    def test_one_referral_per_account_still_holds(self):
        self._claim()
        with self.assertRaises(self.ref.ReferralError):
            self.ref.claim("bob", self.ref.code_for("carol"), self.cands)


if __name__ == "__main__":
    unittest.main()
