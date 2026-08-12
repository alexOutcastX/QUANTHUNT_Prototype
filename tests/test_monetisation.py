"""Wallet, referrals, subscriptions, analytics and the preview gate.

Money-adjacent code, so the tests lean on the failure modes rather than the
happy path: double-paying a referral, overdrawing a balance, referring
yourself, and a webhook delivered twice.
"""
import importlib
import os
import tempfile
import unittest


def _fresh():
    """Reload the monetisation modules against a throwaway database."""
    os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "m.db")
    os.environ["AUTH_SECRET"] = "test-secret"
    import store, wallet, referrals, billing, analytics
    importlib.reload(store)
    return (importlib.reload(wallet), importlib.reload(referrals),
            importlib.reload(billing), importlib.reload(analytics))


class WalletTest(unittest.TestCase):
    def setUp(self):
        self.w, _, _, _ = _fresh()

    def test_balance_starts_at_zero_and_follows_the_ledger(self):
        self.assertEqual(self.w.balance("alice"), 0)
        self.w.grant("alice", 100, "welcome")
        self.w.grant("alice", 50, "bonus")
        self.assertEqual(self.w.balance("alice"), 150)
        self.w.spend("alice", 30, "dossier")
        self.assertEqual(self.w.balance("alice"), 120)

    def test_spending_more_than_the_balance_is_refused(self):
        self.w.grant("bob", 10, "welcome")
        with self.assertRaises(self.w.InsufficientFunds):
            self.w.spend("bob", 11, "too much")
        # ...and the failed spend left no row behind.
        self.assertEqual(self.w.balance("bob"), 10)
        self.assertEqual(len(self.w.history("bob")), 1)

    def test_a_repeated_ref_grants_once(self):
        """A retried webhook or double-tapped button must not pay twice."""
        self.assertTrue(self.w.grant("carol", 100, "promo", ref="promo-1"))
        self.assertFalse(self.w.grant("carol", 100, "promo", ref="promo-1"))
        self.assertEqual(self.w.balance("carol"), 100)

    def test_accounts_are_isolated_and_case_folded(self):
        self.w.grant("Dave", 60, "x")
        self.assertEqual(self.w.balance("dave"), 60)
        self.assertEqual(self.w.balance("erin"), 0)

    def test_credits_and_money_are_separate_balances(self):
        self.w.grant("frank", 100, "credits")
        self.w.grant("frank", 5000, "topup", currency=self.w.INR)
        self.assertEqual(self.w.balance("frank", self.w.CREDITS), 100)
        self.assertEqual(self.w.balance("frank", self.w.INR), 5000)
        with self.assertRaises(self.w.InsufficientFunds):
            self.w.spend("frank", 200, "x", currency=self.w.CREDITS)

    def test_non_positive_amounts_rejected(self):
        self.assertFalse(self.w.grant("gina", 0, "nothing"))
        self.assertFalse(self.w.grant("gina", -5, "negative"))
        with self.assertRaises(ValueError):
            self.w.spend("gina", 0, "nothing")


class ReferralTest(unittest.TestCase):
    def setUp(self):
        self.w, self.r, _, _ = _fresh()
        self.accounts = ["alice", "bob", "carol"]

    def test_code_is_stable_unique_and_unambiguous(self):
        a = self.r.code_for("alice")
        self.assertEqual(a, self.r.code_for("ALICE "))
        self.assertNotEqual(a, self.r.code_for("bob"))
        # No characters that get misread when spoken or typed.
        for ch in "IO01":
            self.assertNotIn(ch, a)

    def test_claim_pays_both_sides(self):
        out = self.r.claim("bob", self.r.code_for("alice"), self.accounts)
        self.assertEqual(out["referrer"], "alice")
        self.assertEqual(self.w.balance("alice"), self.r.REFERRER_REWARD)
        self.assertEqual(self.w.balance("bob"), self.r.REFEREE_REWARD)

    def test_cannot_refer_yourself(self):
        with self.assertRaises(self.r.ReferralError):
            self.r.claim("alice", self.r.code_for("alice"), self.accounts)
        self.assertEqual(self.w.balance("alice"), 0)

    def test_an_account_can_only_be_referred_once(self):
        self.r.claim("bob", self.r.code_for("alice"), self.accounts)
        with self.assertRaises(self.r.ReferralError):
            self.r.claim("bob", self.r.code_for("carol"), self.accounts)
        # The second attempt paid nobody.
        self.assertEqual(self.w.balance("carol"), 0)
        self.assertEqual(self.w.balance("bob"), self.r.REFEREE_REWARD)

    def test_unknown_code_refused(self):
        with self.assertRaises(self.r.ReferralError):
            self.r.claim("bob", "ZZZZZZZ", self.accounts)

    def test_code_accepted_in_any_casing_or_spacing(self):
        code = self.r.code_for("alice").lower()
        self.r.claim("bob", f" {code} ", self.accounts)
        self.assertEqual(self.r.referred_by("bob"), "alice")

    def test_stats_report_reach_and_earnings(self):
        self.r.claim("bob", self.r.code_for("alice"), self.accounts)
        self.r.claim("carol", self.r.code_for("alice"), self.accounts)
        s = self.r.stats("alice")
        self.assertEqual(s["count"], 2)
        self.assertEqual(s["credits_earned"], 2 * self.r.REFERRER_REWARD)
        self.assertEqual(s["referred_by"], "")


class BillingTest(unittest.TestCase):
    def setUp(self):
        self.w, _, self.b, _ = _fresh()

    def test_plans_carry_price_and_features(self):
        keys = [p["key"] for p in self.b.plans()]
        self.assertEqual(keys, ["free", "member", "pro"])
        pro = [p for p in self.b.plans() if p["key"] == "pro"][0]
        self.assertIn("backtest", pro["features"])
        self.assertGreater(pro["price_paise"], 0)

    def test_member_table_plan_applies_without_any_subscription(self):
        """Owner accounts are on pro with no billing row — that must keep
        working, or shipping this would lock the owners out of their own app."""
        sub = self.b.subscription("taureye", "pro")
        self.assertEqual(sub["plan"], "pro")
        self.assertEqual(sub["status"], "none")
        self.assertTrue(self.b.allows("taureye", "backtest", "pro"))

    def test_activate_upgrades_and_grants_the_allowance(self):
        self.b.activate("alice", "pro", ref="pay-1")
        self.assertEqual(self.b.effective_plan("alice", "free"), "pro")
        self.assertEqual(self.w.balance("alice"),
                         self.b.PLANS["pro"]["credits_per_period"])

    def test_a_webhook_delivered_twice_grants_one_allowance(self):
        self.b.activate("alice", "pro", ref="pay-1")
        self.b.activate("alice", "pro", ref="pay-1")
        self.assertEqual(self.w.balance("alice"),
                         self.b.PLANS["pro"]["credits_per_period"])

    def test_expired_subscription_falls_back_to_the_member_plan(self):
        import time
        self.b.activate("alice", "pro", ref="pay-1")
        with self.b._lock:
            self.b._db().execute(
                "UPDATE subscriptions SET renews_at = ? WHERE acct = 'alice'",
                (int(time.time()) - 10,))
            self.b._db().commit()
        sub = self.b.subscription("alice", "free")
        self.assertEqual(sub["plan"], "free")
        self.assertEqual(sub["status"], "expired")
        self.assertFalse(self.b.allows("alice", "backtest", "free"))

    def test_checkout_charges_nothing_and_says_so(self):
        out = self.b.start_checkout("alice", "pro")
        self.assertEqual(out["status"], "pending")
        self.assertFalse(out["provider_configured"])
        self.assertIsNone(out["checkout_url"])
        # Crucially: the intent did NOT grant the plan.
        self.assertEqual(self.b.effective_plan("alice", "free"), "free")

    def test_checkout_rejects_unknown_and_free_plans(self):
        for bad in ("", "enterprise", "free"):
            with self.assertRaises(ValueError):
                self.b.start_checkout("alice", bad)

    def test_required_plan_is_the_cheapest_that_unlocks(self):
        self.assertEqual(self.b.required_plan("quotes"), "free")
        self.assertEqual(self.b.required_plan("screener"), "member")
        self.assertEqual(self.b.required_plan("backtest"), "pro")

    def test_cancel_drops_back_to_the_member_plan(self):
        self.b.activate("alice", "pro", ref="pay-1")
        self.b.cancel("alice")
        self.assertEqual(self.b.effective_plan("alice", "free"), "free")


class AnalyticsTest(unittest.TestCase):
    def setUp(self):
        _, _, _, self.a = _fresh()

    def test_account_is_pseudonymised_not_stored(self):
        key = self.a.account_key("alice")
        self.assertNotIn("alice", key)
        self.assertEqual(key, self.a.account_key("ALICE"))
        self.assertNotEqual(key, self.a.account_key("bob"))
        self.a.track("alice", "screener.run")
        with self.a._lock:
            rows = self.a._db().execute("SELECT akey FROM analytics_events").fetchall()
        self.assertNotIn("alice", rows[0]["akey"])

    def test_summary_counts_events_and_people(self):
        self.a.track("alice", "screener.run", plan="pro")
        self.a.track("alice", "screener.run", plan="pro")
        self.a.track("bob", "dossier.open", plan="member")
        s = self.a.summary(30)
        self.assertEqual(s["events"], 3)
        self.assertEqual(s["people"], 2)
        self.assertEqual(s["top_events"][0]["event"], "screener.run")
        self.assertEqual(s["top_events"][0]["n"], 2)

    def test_tracking_never_raises(self):
        """Analytics must not be able to break the request it rides along on."""
        self.assertFalse(self.a.track("alice", ""))
        self.assertTrue(self.a.track("alice", "x", {"bad": object()}))


class PreviewGateTest(unittest.TestCase):
    def setUp(self):
        for v in ("PREVIEW_HOSTS", "PREVIEW_ALL", "PREVIEW_OFF"):
            os.environ.pop(v, None)
        import preview
        self.p = importlib.reload(preview)

    def tearDown(self):
        for v in ("PREVIEW_HOSTS", "PREVIEW_ALL", "PREVIEW_OFF"):
            os.environ.pop(v, None)

    def test_bare_ip_previews_named_domain_does_not(self):
        self.assertTrue(self.p.enabled("161.118.174.177"))
        self.assertTrue(self.p.enabled("161.118.174.177:5000"))
        self.assertFalse(self.p.enabled("taureye.com"))
        self.assertFalse(self.p.enabled("www.taureye.com"))

    def test_localhost_previews_so_development_sees_the_new_work(self):
        self.assertTrue(self.p.enabled("localhost:8081"))

    def test_named_hosts_can_be_opted_in(self):
        os.environ["PREVIEW_HOSTS"] = "beta.taureye.com"
        self.assertTrue(self.p.enabled("beta.taureye.com"))
        self.assertFalse(self.p.enabled("taureye.com"))

    def test_preview_all_ships_it_and_preview_off_wins(self):
        os.environ["PREVIEW_ALL"] = "1"
        self.assertTrue(self.p.enabled("taureye.com"))
        os.environ["PREVIEW_OFF"] = "1"
        self.assertFalse(self.p.enabled("taureye.com"))
        self.assertFalse(self.p.enabled("161.118.174.177"))

    def test_ipv6_literal_is_a_preview_host(self):
        self.assertTrue(self.p.enabled("[::1]:5000"))

    def test_blank_host_does_not_preview(self):
        self.assertFalse(self.p.enabled(""))


class IntegrationsTest(unittest.TestCase):
    def setUp(self):
        for spec in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
                     "SUPABASE_URL", "SUPABASE_ANON_KEY"):
            os.environ.pop(spec, None)
        import integrations
        self.i = importlib.reload(integrations)

    def tearDown(self):
        for spec in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET",
                     "SUPABASE_URL", "SUPABASE_ANON_KEY"):
            os.environ.pop(spec, None)

    def test_unconfigured_services_report_what_is_missing(self):
        s = self.i.status("google_oauth")
        self.assertFalse(s["configured"])
        self.assertIn("GOOGLE_CLIENT_ID", s["env_missing"])

    def test_status_never_leaks_a_secret_value(self):
        os.environ["GOOGLE_CLIENT_ID"] = "public-id"
        os.environ["GOOGLE_CLIENT_SECRET"] = "SUPER-SECRET"
        blob = repr(self.i.all_status())
        self.assertIn("GOOGLE_CLIENT_SECRET", blob)   # the NAME is reported
        self.assertNotIn("SUPER-SECRET", blob)        # the VALUE never is

    def test_google_config_exposes_only_the_public_client_id(self):
        os.environ["GOOGLE_CLIENT_ID"] = "public-id"
        os.environ["GOOGLE_CLIENT_SECRET"] = "SUPER-SECRET"
        cfg = self.i.google_signin_config("taureye.com")
        self.assertTrue(cfg["enabled"])
        self.assertEqual(cfg["client_id"], "public-id")
        self.assertNotIn("SUPER-SECRET", repr(cfg))

    def test_supabase_withholds_the_service_key(self):
        os.environ["SUPABASE_URL"] = "https://x.supabase.co"
        os.environ["SUPABASE_ANON_KEY"] = "anon"
        os.environ["SUPABASE_SERVICE_KEY"] = "SERVICE-SECRET"
        cfg = self.i.supabase_config()
        self.assertTrue(cfg["enabled"])
        self.assertNotIn("SERVICE-SECRET", repr(cfg))
        os.environ.pop("SUPABASE_SERVICE_KEY", None)

    def test_disabled_service_reports_a_usable_reason(self):
        cfg = self.i.google_signin_config("161.118.174.177")
        self.assertFalse(cfg["enabled"])
        self.assertIn("GOOGLE_CLIENT_ID", cfg["reason"])


if __name__ == "__main__":
    unittest.main()
