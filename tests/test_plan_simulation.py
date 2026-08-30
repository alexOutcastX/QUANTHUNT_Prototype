"""Viewing the app as another plan, for testing.

An owner account holds every feature, which makes it the one account that can
never see whether a paywall works. Reading the ladder is not the same test: the
client gates on the feature list that rides down with the session, and a bug
there looks exactly like working software from an account that has everything.

The control has to be safe enough to leave in a shipped build, so these tests
are mostly about what it CANNOT do: it cannot be asked for by a non-owner, it
cannot be forged by editing a cookie, it cannot raise anyone's access, and it
cannot outlive the session that asked for it.
"""

import json
import os
import re
import tempfile
import unittest

import members

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "mobile", "src")


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as fh:
        return fh.read()


class ClaimTest(unittest.TestCase):
    """members.simulated_plan is the whole security argument, so it is tested
    directly rather than only through a route."""

    OWNER = {"plan": "max", "owner": True, "name": "Owner"}
    MEMBER = {"plan": "free"}

    def test_an_owner_may_stand_on_a_lower_rung(self):
        self.assertEqual(members.simulated_plan(self.OWNER, "pro"), "pro")
        self.assertEqual(members.simulated_plan(self.OWNER, "free"), "free")

    def test_asking_for_the_plan_you_are_already_on_is_not_a_simulation(self):
        """Otherwise the interface would report an owner as "simulating MAX",
        which is a warning about nothing."""
        self.assertEqual(members.simulated_plan(self.OWNER, "max"), "")

    def test_nobody_else_may_use_the_claim_at_all(self):
        """Checked on every request, not only where the token was minted — a
        replayed or leaked token must not elevate the account holding it."""
        for claim in ("max", "pro", "free"):
            with self.subTest(claim=claim):
                self.assertEqual(members.simulated_plan(self.MEMBER, claim), "")
        self.assertEqual(members.simulated_plan({}, "max"), "")
        self.assertEqual(members.simulated_plan(None, "max"), "")

    def test_an_unrecognised_claim_does_nothing(self):
        """canonical_plan() lands anything unknown on free, which rescues a
        stored plan name and would silently turn a typo here into a
        simulation."""
        for claim in ("platinum", "enterprise", "", None, "  "):
            with self.subTest(claim=claim):
                self.assertEqual(members.simulated_plan(self.OWNER, claim), "")

    def test_a_plan_name_from_before_the_rename_still_works(self):
        self.assertEqual(members.simulated_plan(self.OWNER, "member"), "pro")

    def test_it_can_only_ever_reduce_what_an_owner_sees(self):
        """The argument that makes this safe to ship: owners are on the top
        plan, so every reachable simulation is a downgrade."""
        real = set(members.features_for(members.plan_of(self.OWNER)))
        for claim in members.PLAN_LADDER:
            got = members.simulated_plan(self.OWNER, claim)
            if got:
                self.assertTrue(set(members.features_for(got)) < real,
                                f"simulating {claim} did not reduce anything")


class CookieTest(unittest.TestCase):
    def setUp(self):
        os.environ["AUTH_SECRET"] = "simulate-test-secret"

    def tearDown(self):
        os.environ.pop("AUTH_SECRET", None)

    def test_the_claim_rides_in_the_signed_token(self):
        m = members.check_login("taureye", "TaureyePW")
        tok = members.make_cookie(m, simulate="pro")
        live = members.from_cookie(tok)
        self.assertEqual(live["plan"], "pro")
        self.assertTrue(live["simulating"])
        self.assertEqual(live["real_plan"], "max")
        self.assertNotIn("backtest", live["features"])

    def test_no_claim_means_the_real_plan(self):
        m = members.check_login("taureye", "TaureyePW")
        live = members.from_cookie(members.make_cookie(m))
        self.assertEqual(live["plan"], "max")
        self.assertFalse(live["simulating"])
        self.assertIn("backtest", live["features"])

    def test_a_tampered_token_is_rejected_outright(self):
        """Not "ignored" — the signature covers the claim, so editing it
        invalidates the whole session rather than dropping one field."""
        m = members.check_login("taureye", "TaureyePW")
        tok = members.make_cookie(m, simulate="free")
        self.assertIsNone(members.from_cookie(tok[:-3] + "aaa"))

    def test_a_claim_cannot_be_smuggled_in_by_hand(self):
        """Someone who can read the code still cannot mint one: forging the
        payload needs the signing key."""
        forged = json.dumps({"m": "taureye", "exp": 2 ** 31, "p": "free"}).encode()
        import base64
        body = base64.urlsafe_b64encode(forged).decode().rstrip("=")
        self.assertIsNone(members.from_cookie(body + ".not-a-signature"))

    def test_an_unknown_plan_is_never_written_into_a_token(self):
        m = members.check_login("taureye", "TaureyePW")
        tok = members.make_cookie(m, simulate="platinum")
        self.assertEqual(members.from_cookie(tok)["plan"], "max")


class RouteTest(unittest.TestCase):
    IP = "161.118.174.177"

    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        os.environ["TRADELOG_BACKFILL"] = "0"
        os.environ["AUTH_SECRET"] = "simulate-route-test"
        try:
            import server
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        server._warm_universe_async = lambda: None
        with server._RL_LOCK:
            server._RL.clear()
        boot = server.app.test_client()
        r = boot.post("/auth/member/login",
                      json={"username": "sri", "password": "STI123"},
                      headers={"Host": cls.IP})
        assert r.status_code == 200, r.data[:200]
        cls.owner_token = r.json["token"]
        # A real non-owner account, removed again in tearDownClass. DB_PATH is
        # read when `store` is first imported, which has already happened by
        # the time this class runs, so the row lands in whichever database the
        # process is using — leaving it behind would fail the next run with
        # "that username is taken".
        cls.plain = "simplain"
        cls._drop_plain()
        r = boot.post("/auth/member/register",
                      json={"username": cls.plain, "password": "a-good-password"},
                      headers={"Host": cls.IP})
        assert r.status_code == 200, r.data[:200]
        cls.plain_token = r.json["token"]

    @classmethod
    def _drop_plain(cls):
        try:
            import store
            store.execute("DELETE FROM member_accounts WHERE uname=?", (cls.plain,))
        except Exception:
            pass

    @classmethod
    def tearDownClass(cls):
        cls._drop_plain()
        os.environ.pop("AUTH_SECRET", None)
        with cls.server._RL_LOCK:
            cls.server._RL.clear()

    def setUp(self):
        self.client = self.server.app.test_client()

    def _h(self, token):
        return {"Host": self.IP, "X-TE-Member": "Bearer " + token}

    def _post(self, token, plan):
        return self.client.post("/auth/member/simulate-plan",
                                json={"plan": plan}, headers=self._h(token))

    def test_an_owner_can_switch_down_and_back(self):
        r = self._post(self.owner_token, "pro")
        self.assertEqual(r.status_code, 200, r.data[:200])
        self.assertEqual(r.json["member"]["plan"], "pro")
        self.assertTrue(r.json["member"]["simulating"])
        self.assertNotIn("terminal", r.json["member"]["features"])

        back = self._post(r.json["token"], "")
        self.assertEqual(back.status_code, 200)
        self.assertEqual(back.json["member"]["plan"], "max")
        self.assertFalse(back.json["member"]["simulating"])
        self.assertIn("terminal", back.json["member"]["features"])

    def test_the_simulated_session_is_gated_like_the_real_thing(self):
        """The point of the whole control: the server must refuse the
        simulated session the same way it refuses a real Free account."""
        tok = self._post(self.owner_token, "free").json["token"]
        r = self.client.post("/wallet/spend",
                             json={"action": "backtest", "ref": "sim:bt"},
                             headers=self._h(tok))
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json["error"], "plan-required")

    def test_the_real_session_is_untouched_by_a_simulation(self):
        """It is the SESSION that pretends, not the account. Another session
        for the same person must see the truth — otherwise this would be an
        account-level switch wearing a session-level label."""
        self._post(self.owner_token, "free")
        # A separate client: the one above now carries the simulated cookie,
        # which is exactly the session that is SUPPOSED to be pretending.
        other = self.server.app.test_client()
        me = other.get("/auth/member", headers=self._h(self.owner_token))
        self.assertEqual(me.json["member"]["plan"], "max")
        self.assertFalse(me.json["member"]["simulating"])

    def test_the_switch_also_moves_the_browser_session(self):
        """The cookie is the session on the web, so re-signing it is what makes
        the next page load simulate too."""
        self._post(self.owner_token, "free")
        me = self.client.get("/auth/member", headers={"Host": self.IP})
        self.assertEqual(me.json["member"]["plan"], "free")
        self.assertTrue(me.json["member"]["simulating"])

    def test_a_plain_member_is_refused(self):
        r = self._post(self.plain_token, "max")
        self.assertEqual(r.status_code, 403)
        self.assertEqual(r.json["error"], "owner-required")

    def test_a_plain_member_cannot_even_reach_their_own_plan(self):
        """No argument to be had about "it is only a downgrade" — the control
        is not theirs at all."""
        r = self._post(self.plain_token, "free")
        self.assertEqual(r.status_code, 403)

    def test_an_anonymous_request_is_refused(self):
        r = self.client.post("/auth/member/simulate-plan", json={"plan": "max"},
                             headers={"Host": self.IP})
        self.assertEqual(r.status_code, 401)

    def test_an_unknown_plan_is_a_400_that_lists_the_real_ones(self):
        r = self._post(self.owner_token, "platinum")
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json["plans"], members.PLAN_LADDER)

    def test_every_rung_of_the_ladder_can_be_asked_for(self):
        for plan in members.PLAN_LADDER:
            with self.subTest(plan=plan):
                r = self._post(self.owner_token, plan)
                self.assertEqual(r.status_code, 200)
                self.assertEqual(r.json["member"]["plan"], plan)
                self.assertEqual(r.json["member"]["features"],
                                 members.PLAN_FEATURES[plan])


class ScreenTest(unittest.TestCase):
    def setUp(self):
        self.src = read("screens", "AccountScreen.tsx")

    def test_the_switcher_is_offered_to_owners_only(self):
        self.assertIn("member?.owner ? (", self.src)

    def test_it_offers_the_three_rungs(self):
        for label in ("FREE", "PRO", "MAX"):
            self.assertIn(f"label: '{label}'", self.src)

    def test_it_says_plainly_that_it_is_a_test(self):
        self.assertIn("TESTING · VIEW AS A PLAN", self.src)
        self.assertIn("this session only", self.src)

    def test_a_simulated_session_says_so_on_screen(self):
        """A simulation that looked identical to a real session is how someone
        ends up debugging a paywall that was never broken."""
        self.assertIn("member.simulating ? (", self.src)
        self.assertIn("your real plan is", self.src)

    def test_choosing_your_real_plan_clears_the_simulation(self):
        self.assertIn("pl.key === (member.real_plan || '') ? '' : pl.key", self.src)

    def test_the_gates_on_screen_are_told(self):
        """Every Gate reads hasFeature(); a switch that did not notify them
        would leave the old plan's UI on screen."""
        self.assertIn("emit();", read("member.ts"))
        self.assertIn("export async function simulatePlan", read("member.ts"))


if __name__ == "__main__":
    unittest.main()
