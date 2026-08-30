"""Rotating the logins, from a machine with no SSH to the VM.

The three placeholder passwords are in a public repository's history. Hashing
them changes nothing — anyone can read the plaintext — so the only fix is to
replace them, and the mechanism has to be usable by whoever runs the site
rather than by whoever happens to hold an SSH key.

So: an account table in a GitHub repo secret, written to the VM by the deploy
as a FILE. A file rather than an environment variable because the variable has
to survive two layers of quoting to get there — a shell command and a systemd
EnvironmentFile — and a scrypt hash is full of `$`.

What these hold:

  * The file replaces the placeholders completely, so a rotated instance
    cannot still be signed into with the published passwords.
  * The deploy never deletes it, never prints it, and never passes it as an
    argument (an argument is visible in `ps`).
  * A malformed table is caught in CI rather than falling back to the
    placeholders silently at boot on the VM.
"""
import importlib
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import members as _members_mod

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOY = os.path.join(ROOT, ".github", "workflows", "deploy.yml")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


class AccountsFileTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.path = os.path.join(self.dir, "members.json")
        os.environ["MEMBER_ACCOUNTS_FILE"] = self.path
        os.environ.pop("MEMBER_ACCOUNTS_JSON", None)
        self.m = importlib.reload(_members_mod)

    def tearDown(self):
        os.environ.pop("MEMBER_ACCOUNTS_FILE", None)
        os.environ.pop("MEMBER_ACCOUNTS_JSON", None)

    def _write(self, table):
        with open(self.path, "w", encoding="utf-8") as fh:
            json.dump(table, fh)

    def test_a_rotated_table_replaces_the_placeholders_entirely(self):
        """The point of rotating: the published passwords must stop working."""
        self._write({"realowner": {"password": self.m.hash_password("a-real-password"),
                                   "plan": "pro", "name": "Real Owner", "owner": True}})
        self.assertIsNotNone(self.m.check_login("realowner", "a-real-password"))
        for old, pw in (("taureye", "TaureyePW"), ("sreeraman", "SreeramPW"),
                        ("sri", "STI123")):
            self.assertIsNone(self.m.check_login(old, pw), old)

    def test_the_rotated_owner_is_still_an_owner(self):
        self._write({"realowner": {"password": self.m.hash_password("a-real-password"),
                                   "plan": "pro", "name": "Real Owner", "owner": True}})
        who = self.m.check_login("realowner", "a-real-password")
        self.assertTrue(who["owner"])
        self.assertEqual(who["role"], "owner")

    def test_the_env_var_still_wins_where_someone_uses_it(self):
        self._write({"fromfile": {"password": self.m.hash_password("file-password"),
                                  "plan": "pro", "name": "File"}})
        os.environ["MEMBER_ACCOUNTS_JSON"] = json.dumps(
            {"fromenv": {"password": self.m.hash_password("env-password"),
                         "plan": "pro", "name": "Env"}})
        m = importlib.reload(_members_mod)
        self.assertIn("fromenv", m.configured_accounts())
        self.assertNotIn("fromfile", m.configured_accounts())

    def test_no_file_means_the_placeholders_and_it_says_so(self):
        self.assertTrue(self.m.using_default_accounts())
        self.assertIsNotNone(self.m.check_login("taureye", "TaureyePW"))

    def test_a_rotated_instance_reports_that_it_is_rotated(self):
        self._write({"realowner": {"password": self.m.hash_password("a-real-password"),
                                   "plan": "pro", "name": "Real Owner", "owner": True}})
        self.assertFalse(self.m.using_default_accounts())

    def test_an_unreadable_file_does_not_lock_everyone_out(self):
        """Falling back to the placeholders is bad; refusing every login on a
        live site is worse, and leaves no way in to fix it."""
        with open(self.path, "w", encoding="utf-8") as fh:
            fh.write("{ not json")
        self.assertTrue(self.m.using_default_accounts())
        self.assertIsNotNone(self.m.check_login("taureye", "TaureyePW"))

    def test_an_empty_table_is_not_a_way_in(self):
        self._write({})
        self.assertTrue(self.m.using_default_accounts())

    def test_an_account_without_a_password_is_dropped(self):
        self._write({"nopw": {"plan": "pro", "name": "No Password"},
                     "haspw": {"password": self.m.hash_password("a-real-password"),
                               "plan": "pro", "name": "Has"}})
        self.assertNotIn("nopw", self.m.configured_accounts())
        self.assertIsNone(self.m.check_login("nopw", ""))


class DeployRotationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.yml = _read(DEPLOY)
        cls.step = cls.yml.split("Install member credentials", 1)[1].split(
            "- name: Verify the app is up", 1)[0]

    def test_the_deploy_can_install_the_table(self):
        self.assertIn("MEMBER_ACCOUNTS_JSON }}", self.step)
        self.assertIn("members.json", self.step)
        self.assertIn("systemctl restart quanthunt", self.step)

    def test_it_leaves_the_vm_alone_when_the_secret_is_unset(self):
        """Every other deploy must keep working for whoever has not set it."""
        self.assertIn('if [ -z "$ACCOUNTS" ]; then', self.step)
        self.assertIn("exit 0", self.step)

    def test_the_secret_never_reaches_a_log_or_an_argument(self):
        """An argument is visible in `ps` to every other user on the box."""
        self.assertIn('printf \'%s\' "$ACCOUNTS" | ssh', self.step)
        self.assertNotIn('echo "$ACCOUNTS"', self.step)
        self.assertNotIn("echo $ACCOUNTS", self.step)

    def test_the_file_is_written_atomically_and_kept_private(self):
        self.assertIn("umask 077", self.step)
        self.assertIn("members.json.new", self.step)
        self.assertIn("mv ", self.step)
        self.assertIn("chmod 600", self.step)

    def test_a_table_of_plaintext_passwords_is_refused_in_ci(self):
        """Rotating to plaintext would repeat the mistake in a private place."""
        self.assertIn('pw.startswith("scrypt$")', self.step)

    def test_the_validation_actually_rejects_what_it_claims_to(self):
        """The check is a here-doc inside YAML; run it for real."""
        import subprocess
        script = self.step.split("python3 -c '", 1)[1].split("\n          '", 1)[0]
        script = "\n".join(l[10:] if l.startswith(" " * 10) else l
                           for l in script.splitlines())
        good = json.dumps({"me": {"password": "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
                                  "plan": "pro", "name": "Me", "owner": True}})
        bad = [
            ("{}", "empty table"),
            ("[]", "not an object"),
            (json.dumps({"me": {"password": "plaintext"}}), "plaintext password"),
            (json.dumps({"me": {"plan": "pro"}}), "no password"),
            (json.dumps({"me": "nonsense"}), "account is not an object"),
        ]
        r = subprocess.run([sys.executable, "-c", script], input=good,
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        for payload, why in bad:
            r = subprocess.run([sys.executable, "-c", script], input=payload,
                               capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0, f"CI would have accepted: {why}")


class RotationToolTest(unittest.TestCase):
    """`deploy/rotate-logins.py` is the thing the operator actually runs, so
    what it prints has to be right the first time."""

    TOOL = os.path.join(ROOT, "deploy", "rotate-logins.py")

    def _run(self, *args):
        import subprocess
        return subprocess.run([sys.executable, self.TOOL, *args],
                              capture_output=True, text=True)

    def test_it_prints_a_table_the_deploy_would_accept(self):
        r = self._run("--names", "one,two")
        self.assertEqual(r.returncode, 0, r.stderr)
        line = [l for l in r.stdout.splitlines() if l.startswith("{")][0]
        table = json.loads(line)
        self.assertEqual(sorted(table), ["one", "two"])
        for acct in table.values():
            self.assertTrue(acct["password"].startswith("scrypt$"))
            self.assertTrue(acct["owner"])

    def test_the_passwords_it_prints_are_the_ones_it_hashed(self):
        """A tool that prints one password and installs a different one locks
        the operator out of their own site."""
        m = importlib.reload(_members_mod)
        r = self._run("--names", "one")
        table = json.loads([l for l in r.stdout.splitlines() if l.startswith("{")][0])
        shown = [l.split()[-1] for l in r.stdout.splitlines()
                 if l.strip().startswith("one ")][0]
        self.assertTrue(m.verify_password(shown, table["one"]["password"]))

    def test_the_password_never_appears_in_the_pasteable_table(self):
        r = self._run("--names", "one")
        line = [l for l in r.stdout.splitlines() if l.startswith("{")][0]
        shown = [l.split()[-1] for l in r.stdout.splitlines()
                 if l.strip().startswith("one ")][0]
        self.assertNotIn(shown, line)

    def test_two_runs_do_not_produce_the_same_password(self):
        got = set()
        for _ in range(3):
            r = self._run("--names", "one")
            got.add([l.split()[-1] for l in r.stdout.splitlines()
                     if l.strip().startswith("one ")][0])
        self.assertEqual(len(got), 3)

    def test_the_generated_password_is_long_and_unambiguous(self):
        """It gets read off a screen and typed into a phone."""
        r = self._run("--names", "one")
        shown = [l.split()[-1] for l in r.stdout.splitlines()
                 if l.strip().startswith("one ")][0]
        self.assertGreaterEqual(len(shown), 20)
        for confusable in "lIO01":
            self.assertNotIn(confusable, shown)

    def test_it_writes_nothing_to_disk(self):
        src = _read(self.TOOL)
        self.assertNotIn("open(", src.split('"""', 2)[2])


class BootWarningTest(unittest.TestCase):
    def test_the_server_says_so_at_boot_when_it_is_not_rotated(self):
        src = _read(os.path.join(ROOT, "server.py"))
        self.assertIn("if _members.using_default_accounts():", src)
        self.assertIn("SECURITY: running on the PUBLISHED placeholder logins", src)

    def test_it_does_not_tell_an_anonymous_caller(self):
        """Which credentials are in use is exactly what an attacker wants."""
        src = _read(os.path.join(ROOT, "server.py"))
        for line in src.splitlines():
            if "using_default_accounts" in line:
                self.assertNotIn("jsonify", line)
                self.assertNotIn("return", line)


if __name__ == "__main__":
    unittest.main()
