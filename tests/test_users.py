"""Unit tests for user accounts (OTP, sessions, per-user data; temp DB)."""
import importlib
import os
import tempfile
import unittest


class UsersTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        os.environ["DB_PATH"] = self.tmp.name
        os.environ["AUTH_SECRET"] = "test-secret"
        import store
        self.store = importlib.reload(store)
        import auth
        self.auth = importlib.reload(auth)
        import users
        self.u = importlib.reload(users)

    def tearDown(self):
        try:
            os.unlink(self.tmp.name)
        except OSError:
            pass
        os.environ.pop("DB_PATH", None)
        os.environ.pop("AUTH_SECRET", None)

    def test_email_validation(self):
        self.assertTrue(self.u.valid_email("a@b.co"))
        self.assertTrue(self.u.valid_email("  A@B.CO  "))
        self.assertFalse(self.u.valid_email("nope"))
        self.assertFalse(self.u.valid_email(""))
        self.assertFalse(self.u.valid_email("a b@c.d"))

    def test_otp_roundtrip(self):
        code = self.u.issue_otp("a@b.co")
        self.assertEqual(len(code), 6)
        self.assertFalse(self.u.verify_otp("a@b.co", "000000" if code != "000000" else "111111"))
        self.assertTrue(self.u.verify_otp("a@b.co", code))
        # single-use: the same code must not verify twice
        self.assertFalse(self.u.verify_otp("a@b.co", code))

    def test_otp_attempt_lockout(self):
        code = self.u.issue_otp("a@b.co")
        wrong = "999999" if code != "999999" else "888888"
        for _ in range(self.u.OTP_MAX_ATTEMPTS):
            self.assertFalse(self.u.verify_otp("a@b.co", wrong))
        # attempts exhausted: even the right code is dead now
        self.assertFalse(self.u.verify_otp("a@b.co", code))

    def test_new_user_requires_consent(self):
        user, created = self.u.get_or_create_user("new@x.co", consent=False)
        self.assertIsNone(user)
        user, created = self.u.get_or_create_user("new@x.co", consent=True)
        self.assertTrue(created)
        self.assertEqual(user["email"], "new@x.co")
        self.assertIsNotNone(user["consent_ts"])
        # returning user doesn't need the checkbox again
        user2, created2 = self.u.get_or_create_user("new@x.co", consent=False)
        self.assertFalse(created2)
        self.assertEqual(user2["id"], user["id"])

    def test_session_cookie_roundtrip(self):
        user, _ = self.u.get_or_create_user("s@x.co", consent=True)
        cookie = self.u.make_session_cookie(user["id"])
        self.assertEqual(self.u.session_user_id(cookie), user["id"])
        self.assertIsNone(self.u.session_user_id(cookie + "tamper"))
        self.assertIsNone(self.u.session_user_id(""))

    def test_data_roundtrip_and_lww(self):
        user, _ = self.u.get_or_create_user("d@x.co", consent=True)
        uid = user["id"]
        self.assertIsNone(self.u.data_get(uid, "watchlist_v1"))
        self.u.data_put(uid, "watchlist_v1", ["TCS", "INFY"], ts=100)
        doc = self.u.data_get(uid, "watchlist_v1")
        self.assertEqual(doc["v"], ["TCS", "INFY"])
        self.assertEqual(doc["ts"], 100)
        # newer write wins
        self.u.data_put(uid, "watchlist_v1", ["RELIANCE"], ts=200)
        self.assertEqual(self.u.data_get(uid, "watchlist_v1")["v"], ["RELIANCE"])

    def test_delete_purges_everything(self):
        user, _ = self.u.get_or_create_user("gone@x.co", consent=True)
        uid = user["id"]
        self.u.data_put(uid, "papertrades_v1", [{"sym": "TCS"}], ts=1)
        self.u.delete_user(uid)
        self.assertIsNone(self.u.get_user(uid))
        self.assertIsNone(self.u.data_get(uid, "papertrades_v1"))

    def test_disabled_without_secret(self):
        os.environ.pop("AUTH_SECRET", None)
        os.environ.pop("APP_PASSWORD", None)
        import users
        u2 = importlib.reload(users)
        self.assertFalse(u2.enabled())
        self.assertIsNone(u2.session_user_id("anything"))


if __name__ == "__main__":
    unittest.main()
