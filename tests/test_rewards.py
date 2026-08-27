"""Daily bonus, streaks and credit pricing.

The rule that matters: a streak counts INDIAN TRADING DAYS. Someone who claims
on Friday and again on Monday has not missed anything — the market was shut.
Getting that wrong is the most common complaint about streak systems and it
punishes exactly the casual user the mechanic is meant to build a habit in.
"""
import datetime as dt
import os
import tempfile
import unittest


class RewardsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        os.environ.pop("NSE_HOLIDAYS", None)
        import importlib
        import wallet
        import rewards
        cls.wallet = importlib.reload(wallet)
        cls.rewards = importlib.reload(rewards)

    def setUp(self):
        # A fresh ledger per test; these all share one account name.
        self.wallet._reset_for_tests()

    # ── the calendar ──
    def test_weekends_are_not_trading_days(self):
        self.assertFalse(self.rewards.is_trading_day(dt.date(2026, 8, 29)))  # Sat
        self.assertFalse(self.rewards.is_trading_day(dt.date(2026, 8, 30)))  # Sun
        self.assertTrue(self.rewards.is_trading_day(dt.date(2026, 8, 28)))   # Fri

    def test_the_day_before_monday_is_friday(self):
        self.assertEqual(self.rewards.previous_trading_day(dt.date(2026, 8, 31)),
                         dt.date(2026, 8, 28))

    def test_a_configured_holiday_is_skipped(self):
        os.environ["NSE_HOLIDAYS"] = "2026-08-27"
        import importlib
        r = importlib.reload(self.rewards)
        try:
            self.assertFalse(r.is_trading_day(dt.date(2026, 8, 27)))
            self.assertEqual(r.previous_trading_day(dt.date(2026, 8, 28)),
                             dt.date(2026, 8, 26))
        finally:
            os.environ.pop("NSE_HOLIDAYS", None)
            importlib.reload(self.rewards)

    def test_the_holiday_walk_is_bounded(self):
        """A bad holiday list must not hang the request."""
        os.environ["NSE_HOLIDAYS"] = ",".join(
            (dt.date(2026, 8, 26) - dt.timedelta(days=i)).isoformat() for i in range(40))
        import importlib
        r = importlib.reload(self.rewards)
        try:
            r.previous_trading_day(dt.date(2026, 8, 26))   # must return, not spin
        finally:
            os.environ.pop("NSE_HOLIDAYS", None)
            importlib.reload(self.rewards)

    # ── claiming ──
    def test_a_claim_pays_and_opens_a_streak(self):
        out = self.rewards.claim_daily("sri", dt.date(2026, 8, 26))
        self.assertTrue(out["ok"])
        self.assertEqual(out["awarded"], self.rewards.DAILY_CREDITS)
        self.assertEqual(out["streak"], 1)
        self.assertEqual(self.wallet.balance("sri"), self.rewards.DAILY_CREDITS)

    def test_claiming_twice_in_a_day_pays_once(self):
        day = dt.date(2026, 8, 26)
        self.rewards.claim_daily("sri", day)
        again = self.rewards.claim_daily("sri", day)
        self.assertFalse(again["ok"])
        self.assertEqual(again["error"], "already-claimed")
        self.assertEqual(self.wallet.balance("sri"), self.rewards.DAILY_CREDITS)

    def test_a_weekend_does_not_break_a_streak(self):
        """Thursday, Friday, then Monday is a 3-day streak."""
        for d in (dt.date(2026, 8, 27), dt.date(2026, 8, 28), dt.date(2026, 8, 31)):
            out = self.rewards.claim_daily("sri", d)
            self.assertTrue(out["ok"], d)
        self.assertEqual(out["streak"], 3)

    def test_a_missed_weekday_does_break_it(self):
        self.rewards.claim_daily("sri", dt.date(2026, 8, 25))
        out = self.rewards.claim_daily("sri", dt.date(2026, 8, 27))   # skipped the 26th
        self.assertEqual(out["streak"], 1)

    def test_a_milestone_pays_its_bonus_once(self):
        for d in (dt.date(2026, 8, 27), dt.date(2026, 8, 28), dt.date(2026, 8, 31)):
            out = self.rewards.claim_daily("sri", d)
        self.assertEqual(out["streak_bonus"], self.rewards.STREAK_BONUS[3])
        expected = 3 * self.rewards.DAILY_CREDITS + self.rewards.STREAK_BONUS[3]
        self.assertEqual(self.wallet.balance("sri"), expected)

    def test_claiming_at_the_weekend_settles_against_friday(self):
        """Refusing would punish the casual user this exists to reach."""
        out = self.rewards.claim_daily("sri", dt.date(2026, 8, 29))   # Saturday
        self.assertTrue(out["ok"])
        self.assertEqual(out["day"], "2026-08-28")

    def test_no_account_is_refused(self):
        self.assertFalse(self.rewards.claim_daily("", dt.date(2026, 8, 26))["ok"])

    # ── status & pricing ──
    def test_status_reports_the_next_milestone(self):
        self.rewards.claim_daily("sri", dt.date(2026, 8, 26))
        st = self.rewards.status("sri", dt.date(2026, 8, 26))
        self.assertFalse(st["claimable"])
        self.assertEqual(st["next_milestone"], 3)
        self.assertEqual(st["next_milestone_bonus"], self.rewards.STREAK_BONUS[3])

    def test_every_price_is_positive_and_labelled(self):
        for item in self.rewards.price_list():
            self.assertGreater(item["credits"], 0, item["action"])
            self.assertTrue(item["label"], item["action"])
            self.assertNotEqual(item["label"], item["action"],
                                "the price list is user-facing; it needs real words")

    def test_free_things_are_not_in_the_price_list(self):
        """Quotes, charts, news and the watchlist are the habit. Charging for
        them kills everything downstream."""
        priced = {i["action"] for i in self.rewards.price_list()}
        for free in ("quote", "chart", "news", "watchlist", "heatmap"):
            self.assertNotIn(free, priced)

    def test_an_unknown_action_costs_nothing(self):
        """price() returning 0 is what makes the route reject it with a 400
        rather than silently charging."""
        self.assertEqual(self.rewards.price("nonsense"), 0)

    def test_earn_list_reflects_claim_state(self):
        day = dt.date(2026, 8, 26)
        before = {w["key"]: w for w in self.rewards.earn_list("sri", day)}
        self.assertTrue(before["daily"]["available"])
        self.rewards.claim_daily("sri", day)
        after = {w["key"]: w for w in self.rewards.earn_list("sri", day)}
        self.assertFalse(after["daily"]["available"])


class LedgerReadCostTest(unittest.TestCase):
    """One ledger read per streak, not one per day walked.

    The first implementation asked "was day X claimed?" separately for every
    day it stepped back through, so a long streak cost 180 full history queries
    and 70ms — on every wallet load AND every header poll. The whole answer is
    available in a single read, and this test is here because that regression
    would be invisible until the ledger got big.
    """

    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        import importlib
        import wallet
        import rewards
        cls.wallet = importlib.reload(wallet)
        cls.rewards = importlib.reload(rewards)

    def setUp(self):
        self.wallet._reset_for_tests()
        # A long history, so a per-day implementation would be obvious.
        for i in range(120):
            d = dt.date(2026, 8, 26) - dt.timedelta(days=i)
            self.wallet.grant("x", 5, "Daily bonus", ref=self.rewards._ref("x", d))

    def _count_reads(self, fn):
        calls = {"n": 0}
        original = self.rewards._wallet.history

        def counted(*a, **k):
            calls["n"] += 1
            return original(*a, **k)

        self.rewards._wallet.history = counted
        try:
            fn()
        finally:
            self.rewards._wallet.history = original
        return calls["n"]

    def test_streak_reads_the_ledger_once(self):
        n = self._count_reads(lambda: self.rewards.streak("x", dt.date(2026, 8, 26)))
        self.assertEqual(n, 1, f"streak() made {n} ledger reads; it needs 1")

    def test_status_reads_the_ledger_once(self):
        n = self._count_reads(lambda: self.rewards.status("x", dt.date(2026, 8, 26)))
        self.assertEqual(n, 1, f"status() made {n} ledger reads; it needs 1")

    def test_the_earn_route_path_reads_once(self):
        """What /wallet/earn actually does: one status, reused by earn_list."""
        def path():
            st = self.rewards.status("x", dt.date(2026, 8, 26))
            self.rewards.earn_list("x", dt.date(2026, 8, 26), st=st)
        n = self._count_reads(path)
        self.assertEqual(n, 1, f"the /wallet/earn path made {n} ledger reads; it needs 1")

    def test_a_long_streak_is_still_correct(self):
        """Speed must not have cost accuracy."""
        n = self.rewards.streak("x", dt.date(2026, 8, 26))
        self.assertGreater(n, 50)


if __name__ == "__main__":
    unittest.main()
