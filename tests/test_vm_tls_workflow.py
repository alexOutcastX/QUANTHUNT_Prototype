"""Guards on the workflow that runs privileged commands on the VM.

vm-tls.yml SSHes into production with the deploy key and runs certbot + sudo.
Two properties matter more than anything it does:

  1. Its dispatch inputs land inside a remote shell command, so they must be
     validated against a hostname/email character set BEFORE any step uses
     them — otherwise a crafted input runs arbitrary commands as the deploy
     user on the live VM.
  2. It must default to read-only. Issuing a certificate into the wrong nginx
     server block is not something to do by accident.
"""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF = os.path.join(ROOT, ".github", "workflows", "vm-tls.yml")


class VmTlsWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(WF, encoding="utf-8") as f:
            cls.yml = f.read()

    def test_parses_as_yaml(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("pyyaml not installed")
        d = yaml.safe_load(self.yml)
        job = d["jobs"]["cutover"]
        names = [s.get("name") or s.get("uses") for s in job["steps"]]
        self.assertIn("Validate inputs", names)
        # Validation must come before anything that reaches the VM.
        self.assertLess(names.index("Validate inputs"),
                        names.index("Configure SSH"))

    def test_defaults_to_read_only(self):
        try:
            import yaml
        except ImportError:
            self.skipTest("pyyaml not installed")
        d = yaml.safe_load(self.yml)
        inputs = d[True]["workflow_dispatch"]["inputs"]
        self.assertEqual(inputs["mode"]["default"], "diagnose")
        # The steps that change the VM are gated on mode=enable.
        for s in d["jobs"]["cutover"]["steps"]:
            name = s.get("name") or ""
            if name.startswith("Enable") or name.startswith("Verify"):
                self.assertIn("enable", s.get("if", ""), f"{name} is not gated")

    def test_inputs_are_validated_before_interpolation(self):
        """A domain containing shell syntax must be rejected, not run."""
        self.assertIn("Validate inputs", self.yml)
        self.assertIn("*[!a-zA-Z0-9.-]*", self.yml)     # domain charset
        self.assertIn("*[!a-zA-Z0-9.@_+-]*", self.yml)  # email charset

    def test_cannot_run_concurrently_with_a_deploy(self):
        """Both restart gunicorn and touch nginx; overlapping them can leave
        the service down. Same concurrency group as deploy.yml."""
        self.assertIn("group: deploy-vm", self.yml)
        # ...and must not cancel a deploy that is mid-rsync.
        self.assertIn("cancel-in-progress: false", self.yml)

    def test_manual_dispatch_only(self):
        """No push trigger — this must never fire off a branch update."""
        self.assertIn("workflow_dispatch:", self.yml)
        self.assertNotIn("\n  push:", self.yml)

    def test_certbot_email_is_required_to_enable(self):
        self.assertIn("email is required for mode=enable", self.yml)

    def test_env_write_is_idempotent(self):
        """Re-running must not stack duplicate SESSION_COOKIE_DOMAIN keys."""
        self.assertIn("grep -q '^SESSION_COOKIE_DOMAIN=' /opt/quanthunt/.env", self.yml)

    def test_http_redirect_defaults_off(self):
        """Turning it on stops the bare IP from serving, which is what every
        installed APK calls. Must never be the default."""
        try:
            import yaml
        except ImportError:
            self.skipTest("pyyaml not installed")
        d = yaml.safe_load(self.yml)
        self.assertIs(d[True]["workflow_dispatch"]["inputs"]["redirect_http"]["default"], False)

    def test_verify_proves_the_bare_ip_still_serves(self):
        """With the redirect off, the check must assert plain HTTP still works
        — otherwise a silent 404 on the default_server path ships unnoticed."""
        self.assertIn("installed APKs would break", self.yml)
        self.assertIn("http://127.0.0.1/ping", self.yml)

    def test_verify_checks_the_shell_decodes(self):
        """Assets ship precompressed; a bad variant is a 200 that renders blank,
        so the check must decode the body, not just read the status code."""
        self.assertIn("--compressed", self.yml)
        self.assertIn('id="root"', self.yml)


if __name__ == "__main__":
    unittest.main()
