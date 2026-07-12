"""Stdlib-only unit tests for the owner-auth cookie layer (no network/deps)."""
import importlib
import os
import unittest


class AuthTest(unittest.TestCase):
    def setUp(self):
        os.environ["APP_PASSWORD"] = "s3cret-pass"
        os.environ.pop("APP_SECRET", None)
        import auth
        self.auth = importlib.reload(auth)

    def tearDown(self):
        os.environ.pop("APP_PASSWORD", None)

    def test_configured(self):
        self.assertTrue(self.auth.configured())

    def test_password_check_constant(self):
        self.assertTrue(self.auth.check_password("s3cret-pass"))
        self.assertFalse(self.auth.check_password("wrong"))
        self.assertFalse(self.auth.check_password(""))

    def test_cookie_roundtrip(self):
        tok = self.auth.make_cookie()
        self.assertTrue(self.auth.is_owner(tok))

    def test_tampered_cookie_rejected(self):
        tok = self.auth.make_cookie()
        body, sig = tok.split(".", 1)
        self.assertFalse(self.auth.is_owner(body + "." + ("0" * len(sig))))
        self.assertFalse(self.auth.is_owner("garbage"))
        self.assertFalse(self.auth.is_owner(""))

    def test_secret_rotates_with_password(self):
        tok = self.auth.make_cookie()
        os.environ["APP_PASSWORD"] = "different-pass"
        a2 = importlib.reload(self.auth)
        # cookie signed under the old password must no longer verify
        self.assertFalse(a2.is_owner(tok))

    def test_open_mode_disabled(self):
        os.environ.pop("APP_PASSWORD", None)
        a = importlib.reload(self.auth)
        self.assertFalse(a.configured())
        self.assertFalse(a.is_owner(a.make_cookie()))  # no owner when unconfigured


if __name__ == "__main__":
    unittest.main()
