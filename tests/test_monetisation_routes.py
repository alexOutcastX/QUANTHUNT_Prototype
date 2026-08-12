"""The monetisation routes, and — the point of the exercise — that the preview
gate really does hide them on taureye.com while serving them on the bare IP.

Both hostnames are the same server and the same process, so this is the only
thing standing between "testing on the IP" and "shipped to the domain".
"""
import os
import tempfile
import unittest


class MonetisationRouteTest(unittest.TestCase):
    IP = "161.118.174.177"
    DOMAIN = "taureye.com"

    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        os.environ["TRADELOG_BACKFILL"] = "0"
        os.environ["AUTH_SECRET"] = "route-test-secret"
        for v in ("PREVIEW_HOSTS", "PREVIEW_ALL", "PREVIEW_OFF"):
            os.environ.pop(v, None)
        try:
            import server
        except Exception as e:            # flask absent in the stdlib CI path
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        cls._warm = server._warm_universe_async
        server._warm_universe_async = lambda: None
        # Sign in ONCE. /auth/member/login is rate-limited to 10 per 5 minutes,
        # which a per-test login blows through — and the resulting 429 looks
        # like a broken route rather than a throttled fixture. The token is a
        # signed string, so replaying it needs no client state.
        boot = server.app.test_client()
        r = boot.post("/auth/member/login",
                      json={"username": "sri", "password": "STI123"},
                      headers={"Host": cls.IP})
        assert r.status_code == 200, r.data[:200]
        cls.token = r.json["token"]

    @classmethod
    def tearDownClass(cls):
        cls.server._warm_universe_async = cls._warm
        os.environ.pop("AUTH_SECRET", None)

    def setUp(self):
        # A fresh client per test. The Flask test client keeps a cookie jar, so
        # one shared across tests carries the session from whichever test
        # logged in first — and every "anonymous" assertion would then be made
        # while quietly signed in, passing for the wrong reason.
        self.client = self.server.app.test_client()

    def anon(self):
        """A client that has never signed in."""
        return self.server.app.test_client()

    def _auth(self, host=None):
        return {"Host": host or self.IP, "X-TE-Member": "Bearer " + self.token}

    # ── the gate ──
    def test_preview_endpoint_reports_per_host(self):
        ip = self.client.get("/preview", headers={"Host": self.IP}).json
        dom = self.client.get("/preview", headers={"Host": self.DOMAIN}).json
        self.assertTrue(ip["preview"])
        self.assertFalse(dom["preview"])
        self.assertIn("IP", ip["reason"])

    def test_every_preview_route_is_404_on_the_domain(self):
        """404 rather than 403: an unreleased feature should look absent on the
        public domain, not merely forbidden."""
        h = self._auth(host=self.DOMAIN)
        for path in ("/wallet", "/referral", "/billing/plans",
                     "/billing/subscription", "/paywall/backtest",
                     "/integrations/public", "/analytics/summary"):
            r = self.client.get(path, headers=h)
            self.assertEqual(r.status_code, 404, f"{path} leaked on the domain")

    def test_the_same_routes_serve_on_the_ip(self):
        h = self._auth()
        for path in ("/wallet", "/referral", "/billing/plans",
                     "/billing/subscription", "/paywall/backtest",
                     "/integrations/public"):
            r = self.client.get(path, headers=h)
            self.assertEqual(r.status_code, 200, f"{path} -> {r.status_code}")

    def test_existing_routes_are_untouched_on_the_domain(self):
        """The gate must not collaterally break what already ships."""
        for path in ("/ping", "/auth/member"):
            r = self.client.get(path, headers={"Host": self.DOMAIN})
            self.assertEqual(r.status_code, 200, path)

    # ── auth ──
    def test_wallet_requires_a_signed_in_member(self):
        r = self.anon().get("/wallet", headers={"Host": self.IP})
        self.assertEqual(r.status_code, 401)

    def test_signout_clears_both_identities(self):
        r = self.client.post("/auth/member/logout", headers=self._auth())
        self.assertEqual(r.status_code, 200)
        cookies = " ".join(r.headers.getlist("Set-Cookie"))
        self.assertIn("te_member=;", cookies)
        self.assertIn("Max-Age=0", cookies)

    # ── wallet / referrals ──
    def test_wallet_starts_empty_and_reports_both_currencies(self):
        r = self.client.get("/wallet", headers=self._auth())
        self.assertEqual(r.json["balances"]["credits"], 0)
        self.assertIn("INR", r.json["balances"])

    def test_referral_returns_a_code_for_the_signed_in_account(self):
        r = self.client.get("/referral", headers=self._auth())
        self.assertEqual(len(r.json["code"]), 7)
        self.assertEqual(r.json["count"], 0)
        self.assertGreater(r.json["reward_referrer"], 0)

    def test_claiming_your_own_code_is_refused_with_a_readable_reason(self):
        h = self._auth()
        code = self.client.get("/referral", headers=h).json["code"]
        r = self.client.post("/referral/claim", json={"code": code}, headers=h)
        self.assertEqual(r.status_code, 400)
        self.assertIn("yourself", r.json["detail"])

    def test_a_bad_code_does_not_500(self):
        r = self.client.post("/referral/claim", json={"code": "NOPE123"},
                             headers=self._auth())
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json["error"], "referral-refused")

    # ── billing / paywall ──
    def test_plans_are_listed_with_prices(self):
        r = self.client.get("/billing/plans", headers={"Host": self.IP})
        keys = [p["key"] for p in r.json["plans"]]
        self.assertEqual(keys, ["free", "member", "pro"])
        self.assertFalse(r.json["provider_configured"])

    def test_checkout_is_honest_about_not_charging(self):
        r = self.client.post("/billing/checkout", json={"plan": "pro"},
                             headers=self._auth())
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json["status"], "pending")
        self.assertFalse(r.json["provider_configured"])
        self.assertIn("not connected", r.json["message"])

    def test_checkout_rejects_a_bogus_plan(self):
        r = self.client.post("/billing/checkout", json={"plan": "enterprise"},
                             headers=self._auth())
        self.assertEqual(r.status_code, 400)

    def test_paywall_reports_what_unlocks_a_feature(self):
        r = self.client.get("/paywall/backtest", headers=self._auth())
        self.assertEqual(r.json["required_plan"], "pro")
        self.assertTrue(r.json["allowed"])        # sri is a pro owner account
        anon = self.anon().get("/paywall/backtest", headers={"Host": self.IP})
        self.assertFalse(anon.json["allowed"])
        self.assertFalse(anon.json["signed_in"])

    # ── integrations ──
    def test_public_integration_config_is_present_but_disabled(self):
        r = self.client.get("/integrations/public", headers={"Host": self.IP})
        self.assertFalse(r.json["google"]["enabled"])
        self.assertFalse(r.json["supabase"]["enabled"])
        self.assertIn("reason", r.json["google"])

    def test_integration_status_is_refused_to_a_stranger(self):
        r = self.anon().get("/integrations", headers={"Host": self.IP})
        self.assertIn(r.status_code, (401, 403))

    def test_integration_status_is_served_to_an_owner_member(self):
        """members.py deliberately lets an owner-flagged member session stand
        in for the owner passcode, so one sign-in covers the whole app."""
        r = self.client.get("/integrations", headers=self._auth())
        self.assertEqual(r.status_code, 200)
        keys = [i["key"] for i in r.json["integrations"]]
        self.assertIn("google_oauth", keys)
        self.assertIn("supabase", keys)

    # ── analytics ──
    def test_events_can_be_tracked_without_signing_in(self):
        r = self.client.post("/analytics/track",
                             json={"event": "app.open", "props": {"screen": "home"}},
                             headers={"Host": self.IP})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json["ok"])

    def test_summary_is_refused_to_a_stranger(self):
        r = self.anon().get("/analytics/summary", headers={"Host": self.IP})
        self.assertIn(r.status_code, (401, 403))

    def test_summary_is_served_to_an_owner_member(self):
        r = self.client.get("/analytics/summary", headers=self._auth())
        self.assertEqual(r.status_code, 200)
        self.assertIn("top_events", r.json)


if __name__ == "__main__":
    unittest.main()
