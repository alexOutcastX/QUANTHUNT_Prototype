"""Session cookies across apex + www, and the HTTPS enabler's invariants.

Once taureye.com and www.taureye.com both serve the app, a host-only cookie set
on one is not sent to the other — a user who logs in on www looks logged out on
the apex. SESSION_COOKIE_DOMAIN=.taureye.com fixes that, but only if the LOGOUT
path clears the cookie with the same domain: a host-only delete leaves a
parent-domain cookie in place and logout silently does nothing.
"""
import os
import re
import unittest

DEPLOY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy")


def _cookie_bits(src: str) -> str:
    """The body of server.py's cookie helpers, without importing the app
    (importing server.py pulls in the whole data stack)."""
    start = src.index("def _session_cookie(")
    end = src.index("def _bearer(")
    return src[start:end]


class CookieDomainTest(unittest.TestCase):
    def setUp(self):
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        with open(os.path.join(root, "server.py"), encoding="utf-8") as fh:
            self.src = fh.read()

    def test_domain_comes_from_env_and_defaults_to_none(self):
        self.assertIn('_COOKIE_DOMAIN = (os.environ.get("SESSION_COOKIE_DOMAIN")', self.src)
        # Blank/unset must collapse to None, not "" — Flask treats "" as a real
        # domain attribute and the browser then drops the cookie.
        line = [l for l in self.src.splitlines() if l.startswith("_COOKIE_DOMAIN =")][0]
        self.assertTrue(line.rstrip().endswith("or None"), line)

    def test_set_cookie_passes_the_domain(self):
        self.assertIn("domain=_COOKIE_DOMAIN", _cookie_bits(self.src))

    def test_every_clear_uses_the_same_domain(self):
        """Any raw resp.delete_cookie() outside the helper would fail to clear a
        parent-domain cookie — logout would appear to work and not."""
        raw = re.findall(r"resp\.delete_cookie\([^)]*\)", self.src)
        self.assertEqual(len(raw), 1, f"expected only the helper's call, got {raw}")
        self.assertIn("domain=_COOKIE_DOMAIN", raw[0])
        # ...and the logout routes must actually route through it.
        self.assertGreaterEqual(self.src.count("_clear_cookie(resp,"), 3)


class EnableHttpsScriptTest(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(DEPLOY, "enable-https.sh"), encoding="utf-8") as fh:
            self.src = fh.read()

    def test_www_is_included_on_the_certificate(self):
        self.assertIn('"www.$DOMAIN"', self.src)

    def test_unresolvable_names_are_dropped_not_requested(self):
        """certbot fails the whole issuance if one name does not validate, so a
        name without DNS must be skipped rather than sent."""
        self.assertIn('getent hosts "$n"', self.src)
        self.assertIn("has no DNS record", self.src)

    def test_refuses_to_run_against_a_conflicting_server_block(self):
        """A leftover block claiming the domain beats `server_name _`, so the
        old site keeps serving and certbot patches the wrong block."""
        self.assertIn("sites-enabled", self.src)
        self.assertRegex(self.src, r"already claims these names")
        self.assertIn("exit 1", self.src)

    def test_server_name_rewrite_is_idempotent(self):
        """Matching the pristine `server_name _;` would no-op on a second run —
        and miss the 443 block certbot adds. Match any server_name instead."""
        self.assertIn("s/^([[:space:]]*)server_name[[:space:]]+[^;]*;/", self.src)
        self.assertNotIn("s/server_name _;/", self.src)

    def test_installs_certbot_on_both_distro_families(self):
        self.assertIn("dnf install", self.src)
        self.assertIn("apt-get install", self.src)

    def test_bails_when_the_app_conf_is_missing(self):
        self.assertIn('[ -f "$CONF" ]', self.src)

    def test_certbot_is_installed_before_nginx_is_touched(self):
        """The first enable run died on `Unable to find a match: certbot` —
        AFTER server_name had already been rewritten and nginx reloaded. A
        failed install must leave nginx exactly as it was found."""
        self.assertLess(self.src.index("install_certbot\n"),
                        self.src.index("sudo sed -i -E"))

    def test_certbot_install_falls_back_past_the_distro_package(self):
        """certbot is not in Oracle Linux's default repos — it lives in EPEL,
        which ships disabled. Try the package, then EPEL, then upstream's venv
        install, which needs only python3."""
        self.assertIn("oracle-epel-release-el", self.src)
        self.assertIn("_developer_EPEL", self.src)
        self.assertIn("python3 -m venv /opt/certbot", self.src)
        self.assertIn("certbot certbot-nginx", self.src)

    def test_http_redirect_is_opt_in(self):
        """certbot's --redirect rewrites the port-80 block and appends
        `return 404` for unmatched hosts. That block is `listen 80
        default_server` — the one answering for the bare IP, which every
        installed APK uses as its API base. Defaulting it on would 404 the
        whole fleet the moment the cert is issued."""
        self.assertIn('if [ "${REDIRECT:-}" = "1" ]', self.src)
        self.assertIn("--no-redirect", self.src)
        # --redirect must appear only inside the opt-in branch, never on the
        # certbot line itself.
        certbot_line = [l for l in self.src.splitlines()
                        if l.startswith("sudo certbot ")][0]
        self.assertNotIn("--redirect", certbot_line, certbot_line)


if __name__ == "__main__":
    unittest.main()
