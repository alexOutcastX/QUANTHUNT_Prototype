import json
import os
import time
import unittest

import members


class TestMemberLogin(unittest.TestCase):
    def setUp(self):
        os.environ.pop("MEMBER_ACCOUNTS_JSON", None)
        os.environ.pop("AUTH_SECRET", None)

    def test_placeholder_credentials_accepted(self):
        m = members.check_login("Taureye", "TaureyePW")
        self.assertIsNotNone(m)
        self.assertEqual(m["username"], "Taureye")
        self.assertEqual(m["plan"], "max")

    def test_username_case_insensitive_password_exact(self):
        self.assertIsNotNone(members.check_login("TAUREYE", "TaureyePW"))
        self.assertIsNotNone(members.check_login("  taureye ", "TaureyePW"))
        self.assertIsNone(members.check_login("Taureye", "taureyepw"))

    def test_wrong_credentials_rejected(self):
        self.assertIsNone(members.check_login("Taureye", "wrong"))
        self.assertIsNone(members.check_login("someone", "TaureyePW"))
        self.assertIsNone(members.check_login("", ""))
        self.assertIsNone(members.check_login("someone", ""))

    def test_cookie_roundtrip(self):
        m = members.check_login("Taureye", "TaureyePW")
        tok = members.make_cookie(m)
        live = members.from_cookie(tok)
        self.assertIsNotNone(live)
        self.assertEqual(live["uname"], "taureye")
        self.assertEqual(live["plan"], "max")
        self.assertIn("backtest", live["features"])

    def test_tampered_or_garbage_cookie_rejected(self):
        m = members.check_login("Taureye", "TaureyePW")
        tok = members.make_cookie(m)
        self.assertIsNone(members.from_cookie(tok[:-2] + "zz"))
        self.assertIsNone(members.from_cookie("not-a-token"))
        self.assertIsNone(members.from_cookie(""))
        self.assertIsNone(members.from_cookie(None))

    def test_expired_cookie_rejected(self):
        m = members.check_login("Taureye", "TaureyePW")
        payload = json.dumps({"m": m["uname"], "exp": int(time.time()) - 10}).encode()
        self.assertIsNone(members.from_cookie(members._sign(payload)))

    def test_env_account_override(self):
        os.environ["MEMBER_ACCOUNTS_JSON"] = json.dumps(
            {"Alpha": {"password": "pw1", "plan": "pro", "name": "Alpha"}})
        try:
            self.assertIsNone(members.check_login("Taureye", "TaureyePW"))
            m = members.check_login("alpha", "pw1")
            self.assertIsNotNone(m)
            self.assertEqual(m["plan"], "pro")
        finally:
            os.environ.pop("MEMBER_ACCOUNTS_JSON", None)

    def test_plan_features_ladder(self):
        free = members.features_for("free")
        pro = members.features_for("pro")
        mx = members.features_for("max")
        self.assertIn("heatmap", free)
        self.assertNotIn("screener", free)
        self.assertIn("screener", pro)
        # Pro is the middle rung: the screener, not the terminal.
        self.assertNotIn("backtest", pro)
        self.assertNotIn("terminal", pro)
        self.assertIn("backtest", mx)
        self.assertIn("terminal", mx)
        # Each rung contains the one below it, so upgrading never takes
        # anything away.
        self.assertTrue(set(free) <= set(pro) <= set(mx))
        # unknown plan degrades to free, never to full access
        self.assertEqual(members.features_for("nonsense"), free)

    def test_the_old_tier_names_still_resolve(self):
        """Accounts predate the free/member/pro → free/pro/max rename. A stored
        name that no longer exists must not silently drop someone to free."""
        self.assertEqual(members.canonical_plan("member"), "pro")
        self.assertEqual(members.canonical_plan("MEMBER"), "pro")
        self.assertEqual(members.features_for("member"), members.features_for("pro"))
        self.assertEqual(members.canonical_plan("free"), "free")
        self.assertEqual(members.canonical_plan(""), "free")
        self.assertEqual(members.canonical_plan(None), "free")

    def test_an_owner_sits_on_the_top_plan_whatever_the_row_says(self):
        """The old "pro" meant everything and the new one does not, so the
        owner accounts are carried by being owners, not by their stored name."""
        self.assertEqual(members.plan_of({"plan": "pro", "owner": True}), "max")
        self.assertEqual(members.plan_of({"plan": "free", "owner": True}), "max")
        self.assertEqual(members.plan_of({"owner": True}), "max")
        # and a non-owner is not promoted by the same rule
        self.assertEqual(members.plan_of({"plan": "pro"}), "pro")
        self.assertEqual(members.plan_of({"plan": "free"}), "free")


class MultipleAccountsTest(unittest.TestCase):
    """Three owner accounts, not one.

    The table started as a single placeholder credential, so anything that
    assumed exactly one account would have kept working while quietly locking
    the other two out. Each is checked end to end.
    """

    ACCOUNTS = [("Sreeraman", "SreeramPW"), ("Sri", "STI123"), ("Taureye", "TaureyePW")]

    def test_every_account_signs_in(self):
        for user, pw in self.ACCOUNTS:
            with self.subTest(user=user):
                self.assertIsNotNone(members.check_login(user, pw),
                                     f"{user} cannot sign in")

    def test_every_account_is_on_the_top_plan_and_an_owner(self):
        """Owner is what lets a session reach the broker, alerts and developer
        screens without a separate passcode — so this is the line between a
        login and full control of the instance. Asserted, not assumed."""
        for user, pw in self.ACCOUNTS:
            with self.subTest(user=user):
                m = members.check_login(user, pw)
                self.assertEqual(m["plan"], "max")
                self.assertTrue(m["owner"], f"{user} lost owner rights")

    def test_the_display_name_keeps_its_casing(self):
        self.assertEqual(members.check_login("sreeraman", "SreeramPW")["username"], "Sreeraman")
        self.assertEqual(members.check_login("SRI", "STI123")["username"], "Sri")

    def test_passwords_are_not_interchangeable(self):
        """A bug that accepted any known password for any known user would look
        exactly like working software."""
        for user, _ in self.ACCOUNTS:
            for _, other_pw in self.ACCOUNTS:
                if (user, other_pw) in self.ACCOUNTS:
                    continue
                with self.subTest(user=user, pw=other_pw):
                    self.assertIsNone(members.check_login(user, other_pw))

    def test_each_account_gets_the_full_feature_set(self):
        for user, pw in self.ACCOUNTS:
            feats = members.features_for(members.check_login(user, pw)["plan"])
            for f in ("backtest", "terminal", "dossier", "exports", "alerts"):
                self.assertIn(f, feats, f"{user} is missing {f}")
