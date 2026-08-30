"""Self-service accounts: who may create one, and what they get.

Until now the only way in was a credential the operator hardcoded. This adds a
sign-up form, and with it the questions a sign-up form has to answer before it
is safe to expose:

  * A new account must never be able to BECOME an operator. The configured
    table holds instance owners — an owner session is accepted by the broker,
    alerts and developer screens instead of a passcode — so a registered row
    must not be able to shadow one, whatever else goes wrong.
  * It must not arrive with the operator's plan. What a stranger can see is a
    pricing decision, and the default is the bottom rung of the ladder.
  * Its password must be stored as a hash. The existing table is plaintext
    because those passwords were published anyway and hashing them would
    change nothing; new code has no such excuse.
  * The refusals must not leak. "That username is taken" is all an outsider
    learns, whether the name belongs to a member or to the owner.
"""
import importlib
import logging
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import members as _members_mod


class SignupTest(unittest.TestCase):
    def setUp(self):
        # A database of its own per test, so nothing here can touch real rows.
        self.tmp = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "_signup_test.db")
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(self.tmp + suffix)
            except OSError:
                pass
        os.environ["DB_PATH"] = self.tmp
        for key in ("MEMBER_SIGNUP", "MEMBER_SIGNUP_CODE", "MEMBER_SIGNUP_PLAN"):
            os.environ.pop(key, None)
        import store
        self.store = importlib.reload(store)
        self.m = importlib.reload(_members_mod)

    def tearDown(self):
        try:
            self.store._conn.close()
        except Exception:
            pass
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(self.tmp + suffix)
            except OSError:
                pass
        os.environ.pop("DB_PATH", None)

    # ── the happy path ───────────────────────────────────────────────────────
    def test_a_new_account_can_be_created_and_signed_in(self):
        member, err = self.m.register("newperson", "a-good-password")
        self.assertIsNone(err)
        self.assertEqual(member["uname"], "newperson")
        back = self.m.check_login("newperson", "a-good-password")
        self.assertIsNotNone(back)
        self.assertEqual(back["uname"], "newperson")

    def test_the_name_keeps_its_casing_but_the_login_does_not_care(self):
        self.m.register("AlexM", "a-good-password")
        self.assertEqual(self.m.check_login("alexm", "a-good-password")["username"], "AlexM")
        self.assertIsNotNone(self.m.check_login("ALEXM", "a-good-password"))

    def test_the_wrong_password_is_still_wrong(self):
        self.m.register("newperson", "a-good-password")
        self.assertIsNone(self.m.check_login("newperson", "a-good-passwore"))

    # ── what a new account is NOT ────────────────────────────────────────────
    def test_it_is_never_an_owner(self):
        """An owner session is accepted instead of a passcode by the broker,
        alerts and developer screens. Signing up must not grant that."""
        member, _ = self.m.register("newperson", "a-good-password")
        self.assertFalse(member["owner"])
        self.assertEqual(member["role"], "member")
        self.assertFalse(self.m.check_login("newperson", "a-good-password")["owner"])

    def test_it_lands_on_the_bottom_of_the_plan_ladder(self):
        member, _ = self.m.register("newperson", "a-good-password")
        self.assertEqual(member["plan"], "free")
        feats = self.m.features_for(member["plan"])
        self.assertIn("quotes", feats)
        for paid in ("backtest", "terminal", "exports", "alerts", "screener"):
            self.assertNotIn(paid, feats, paid)

    def test_the_operator_can_move_that_in_one_env_var(self):
        os.environ["MEMBER_SIGNUP_PLAN"] = "member"
        m = importlib.reload(_members_mod)
        member, err = m.register("newperson", "a-good-password")
        self.assertIsNone(err)
        self.assertEqual(member["plan"], "member")

    def test_the_password_is_stored_hashed(self):
        self.m.register("newperson", "a-good-password")
        row = self.store.query(
            "SELECT password FROM member_accounts WHERE uname='newperson'")[0]
        self.assertTrue(row["password"].startswith("scrypt$"), row["password"][:20])
        self.assertNotIn("a-good-password", row["password"])

    # ── names it must refuse ─────────────────────────────────────────────────
    def test_it_cannot_take_over_a_configured_account(self):
        """The whole point: the operator's own login must be unclaimable."""
        for name in self.m.configured_accounts():
            _, err = self.m.register(name, "a-good-password")
            self.assertIsNotNone(err, name)
            # …and the configured account still signs in with ITS password.
        self.assertIsNotNone(self.m.check_login("taureye", "TaureyePW"))

    def test_a_registered_row_can_never_shadow_a_configured_one(self):
        """Belt and braces: even a row inserted around register() loses."""
        self.store.execute(
            "INSERT INTO member_accounts (uname, name, password, plan, created)"
            " VALUES (?, ?, ?, ?, ?)",
            ("taureye", "Impostor", self.m.hash_password("impostor-pw"), "pro", 0))
        self.assertIsNone(self.m.check_login("taureye", "impostor-pw"))
        who = self.m.check_login("taureye", "TaureyePW")
        self.assertIsNotNone(who)
        self.assertEqual(who["username"], "Taureye")
        self.assertTrue(who["owner"])

    def test_reserved_names_are_refused(self):
        for name in ("admin", "root", "support", "billing", "api", "TaurEye"):
            _, err = self.m.register(name, "a-good-password")
            self.assertIsNotNone(err, name)

    def test_a_name_cannot_be_taken_twice(self):
        self.m.register("newperson", "a-good-password")
        _, err = self.m.register("NEWPERSON", "another-password")
        self.assertEqual(err, "That username is taken.")

    def test_the_refusal_does_not_say_which_table_holds_the_name(self):
        """An outsider must not be able to enumerate the operator's logins."""
        _, taken = self.m.register("sreeraman", "a-good-password")
        self.m.register("newperson", "a-good-password")
        _, dupe = self.m.register("newperson", "a-good-password")
        self.assertEqual(taken, dupe)

    def test_the_shape_of_a_username_is_checked(self):
        for bad, why in (("ab", "too short"), ("a" * 25, "too long"),
                         ("9lives", "starts with a digit"), ("has space", "space"),
                         ("emoji✨", "non-ascii"), ("has/slash", "slash")):
            _, err = self.m.register(bad, "a-good-password")
            self.assertIsNotNone(err, why)
        for good in ("alex", "alex.m", "alex_m", "alex-m", "a" * 24):
            member, err = self.m.register(good, "a-good-password")
            self.assertIsNone(err, f"{good}: {err}")
            self.assertIsNotNone(member)

    def test_a_short_password_is_refused(self):
        _, err = self.m.register("newperson", "short12")
        self.assertIn("8", err)
        self.assertIsNone(self.m.check_login("newperson", "short12"))

    def test_the_password_may_not_be_the_username(self):
        _, err = self.m.register("newperson", "NewPerson")
        self.assertIsNotNone(err)

    # ── the switches the operator has ────────────────────────────────────────
    def test_signup_can_be_closed(self):
        os.environ["MEMBER_SIGNUP"] = "closed"
        m = importlib.reload(_members_mod)
        self.assertFalse(m.signup_open())
        _, err = m.register("newperson", "a-good-password")
        self.assertIsNotNone(err)
        # …and the existing accounts still work.
        self.assertIsNotNone(m.check_login("taureye", "TaureyePW"))

    def test_signup_can_be_held_behind_an_invite_code(self):
        os.environ["MEMBER_SIGNUP_CODE"] = "let-me-in"
        m = importlib.reload(_members_mod)
        _, err = m.register("newperson", "a-good-password")
        self.assertIsNotNone(err)
        _, err = m.register("newperson", "a-good-password", "wrong")
        self.assertIsNotNone(err)
        member, err = m.register("newperson", "a-good-password", "let-me-in")
        self.assertIsNone(err)
        self.assertIsNotNone(member)

    def test_an_unreachable_database_does_not_close_the_front_door(self):
        """A signup table that cannot be read must not take the login page
        down with it — the owners still need to get in and fix it."""
        real = self.m.registered_accounts

        def boom():
            raise RuntimeError("no database")

        self.m.registered_accounts = boom
        try:
            # The logged traceback is the point of the test, not a surprise:
            # silence it so a passing run does not read like a failing one.
            logging.disable(logging.CRITICAL)
            self.assertIsNotNone(self.m.check_login("taureye", "TaureyePW"))
        except RuntimeError:
            self.fail("a broken signup table took the login with it")
        finally:
            logging.disable(logging.NOTSET)
            self.m.registered_accounts = real


try:
    import server
except Exception:                                            # pragma: no cover
    server = None                     # the stdlib CI gate has no Flask


@unittest.skipUnless(server, "needs Flask")
class SignupRouteTest(unittest.TestCase):
    def setUp(self):
        server.app.config["TESTING"] = True
        self.client = server.app.test_client()
        self.made = []

    def tearDown(self):
        import store
        for uname in self.made:
            store.execute("DELETE FROM member_accounts WHERE uname=?", (uname,))

    def test_the_form_can_ask_what_the_rules_are(self):
        body = self.client.get("/auth/member/signup-policy").get_json()
        self.assertIn("open", body)
        self.assertEqual(body["username_min"], server._members.USERNAME_MIN)
        self.assertEqual(body["password_min"], server._members.PASSWORD_MIN)
        self.assertEqual(body["plan"], server._members.SIGNUP_PLAN)

    def test_creating_an_account_signs_you_in(self):
        """Making someone retype the password they just chose, into the form
        they just left, is a step that exists for no one."""
        self.made.append("routetester")
        r = self.client.post("/auth/member/register",
                             json={"username": "routetester", "password": "a-good-password"})
        self.assertEqual(r.status_code, 200)
        body = r.get_json()
        self.assertEqual(body["member"]["uname"], "routetester")
        self.assertFalse(body["member"]["owner"])
        self.assertIn("Set-Cookie", r.headers)
        # …and the session is live on the very next request.
        me = self.client.get("/auth/member").get_json()
        self.assertEqual(me["member"]["uname"], "routetester")

    def test_a_refusal_says_why(self):
        r = self.client.post("/auth/member/register",
                             json={"username": "ab", "password": "a-good-password"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("3", r.get_json()["detail"])

    def test_it_never_answers_with_an_owner_session(self):
        self.made.append("notanowner")
        body = self.client.post(
            "/auth/member/register",
            json={"username": "notanowner", "password": "a-good-password"}).get_json()
        self.assertFalse(body["member"]["owner"])
        self.assertEqual(body["member"]["role"], "member")
        self.assertNotIn("backtest", body["member"]["features"])

    def test_the_route_is_rate_limited(self):
        """The only caller who needs to create accounts quickly is someone
        enumerating names."""
        src = open(os.path.join(os.path.dirname(os.path.dirname(
            os.path.abspath(__file__))), "server.py"), encoding="utf-8").read()
        block = src.split('@app.route("/auth/member/register"', 1)[1].split("def ", 1)[0]
        self.assertIn("@rate_limit(", block)


if __name__ == "__main__":
    unittest.main()
