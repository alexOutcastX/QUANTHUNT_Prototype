"""Password storage and the session-signing key.

Two items off the public-access checklist. Both were fine while the only
accounts were three known owners, and both stop being fine the moment a
stranger can hold an account.
"""
import os
import subprocess
import sys
import tempfile
import unittest

import members


class PasswordHashTest(unittest.TestCase):
    def test_a_hash_round_trips(self):
        h = members.hash_password("correct horse battery staple")
        self.assertTrue(h.startswith("scrypt$"))
        self.assertTrue(members.verify_password("correct horse battery staple", h))

    def test_the_wrong_password_is_refused(self):
        h = members.hash_password("hunter2")
        self.assertFalse(members.verify_password("hunter3", h))
        self.assertFalse(members.verify_password("", h))

    def test_the_same_password_hashes_differently_every_time(self):
        """A shared salt would let one crack cover every account that reused a
        password, and make equal passwords visible in the table."""
        a = members.hash_password("same")
        b = members.hash_password("same")
        self.assertNotEqual(a, b)
        self.assertTrue(members.verify_password("same", a))
        self.assertTrue(members.verify_password("same", b))

    def test_plaintext_entries_still_work(self):
        """The placeholder table is plaintext; refusing it would lock the
        instance out of its own front door."""
        self.assertTrue(members.verify_password("STI123", "STI123"))
        self.assertFalse(members.verify_password("sti123", "STI123"))

    def test_an_account_with_no_password_is_not_a_way_in(self):
        for stored in ("", None):
            self.assertFalse(members.verify_password("", stored))
            self.assertFalse(members.verify_password("anything", stored))

    def test_a_corrupt_hash_refuses_rather_than_raising(self):
        """A malformed entry must fail closed — a 500 on the login route would
        be an oracle for which accounts exist."""
        for bad in ("scrypt$", "scrypt$notanumber$8$1$xx$yy", "scrypt$16384$8$1$!!$??"):
            self.assertFalse(members.verify_password("x", bad))

    def test_login_accepts_a_hashed_account(self):
        os.environ["MEMBER_ACCOUNTS_JSON"] = (
            '{"alice": {"password": %s, "plan": "member", "name": "Alice"}}'
            % __import__("json").dumps(members.hash_password("s3cret")))
        try:
            self.assertIsNotNone(members.check_login("alice", "s3cret"))
            self.assertIsNone(members.check_login("alice", "wrong"))
        finally:
            os.environ.pop("MEMBER_ACCOUNTS_JSON", None)

    def test_the_hash_helper_runs(self):
        """`python -m members hash` is what the operator is told to use."""
        r = subprocess.run([sys.executable, "-m", "members"],
                           capture_output=True, text=True,
                           cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.assertEqual(r.returncode, 2)
        self.assertIn("python -m members hash", r.stderr)


class SessionKeyTest(unittest.TestCase):
    """The old fallback hashed the account table, so adding a member signed
    every existing session out. The key now lives in a file instead."""

    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.key = os.path.join(self.dir, "k")
        for v in ("AUTH_SECRET", "APP_SECRET"):
            os.environ.pop(v, None)
        os.environ["SESSION_KEY_PATH"] = self.key
        members._GENERATED_KEY = None

    def tearDown(self):
        os.environ.pop("SESSION_KEY_PATH", None)
        members._GENERATED_KEY = None

    def test_a_key_is_created_and_reused(self):
        first = members._generated_key()
        self.assertTrue(os.path.isfile(self.key))
        members._GENERATED_KEY = None
        self.assertEqual(members._generated_key(), first,
                         "a fresh key each boot would sign every session out on restart")

    def test_the_key_is_long_enough_to_be_worth_having(self):
        self.assertGreaterEqual(len(members._generated_key()), 32)

    def test_it_is_not_world_readable(self):
        members._generated_key()
        self.assertEqual(os.stat(self.key).st_mode & 0o077, 0,
                         "the session key is readable by other users")

    def test_changing_an_account_no_longer_rotates_the_secret(self):
        """The actual bug: editing the member table used to invalidate every
        live cookie."""
        before = members._secret()
        os.environ["MEMBER_ACCOUNTS_JSON"] = \
            '{"bob": {"password": "x", "plan": "free", "name": "Bob"}}'
        try:
            self.assertEqual(members._secret(), before)
        finally:
            os.environ.pop("MEMBER_ACCOUNTS_JSON", None)

    def test_auth_secret_still_wins_when_set(self):
        os.environ["AUTH_SECRET"] = "configured"
        try:
            members._GENERATED_KEY = None
            self.assertEqual(members._secret(), b"te-member::configured")
        finally:
            os.environ.pop("AUTH_SECRET", None)

    def test_the_key_file_is_never_committed(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".gitignore"), encoding="utf-8") as fh:
            self.assertIn("quanthunt.db.session-key", fh.read())

    def test_the_deploy_does_not_delete_it(self):
        """rsync runs with --delete: a key that is not excluded is wiped on
        every push, signing everyone out each deploy."""
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, ".github", "workflows", "deploy.yml")) as fh:
            yml = fh.read()
        import fnmatch
        self.assertIn("quanthunt.db*", yml)
        self.assertTrue(fnmatch.fnmatch("quanthunt.db.session-key", "quanthunt.db*"))


if __name__ == "__main__":
    unittest.main()
