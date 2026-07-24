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
        self.assertEqual(m["plan"], "pro")

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
        self.assertEqual(live["plan"], "pro")
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
            {"Alpha": {"password": "pw1", "plan": "member", "name": "Alpha"}})
        try:
            self.assertIsNone(members.check_login("Taureye", "TaureyePW"))
            m = members.check_login("alpha", "pw1")
            self.assertIsNotNone(m)
            self.assertEqual(m["plan"], "member")
        finally:
            os.environ.pop("MEMBER_ACCOUNTS_JSON", None)

    def test_plan_features_ladder(self):
        free = members.features_for("free")
        pro = members.features_for("pro")
        self.assertIn("heatmap", free)
        self.assertNotIn("backtest", free)
        self.assertIn("backtest", pro)
        # unknown plan degrades to free, never to full access
        self.assertEqual(members.features_for("nonsense"), free)
