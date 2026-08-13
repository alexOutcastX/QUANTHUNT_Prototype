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
    start = src.index("def _cookie_domain(")
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

    def test_set_cookie_passes_the_scoped_domain(self):
        """_cookie_domain(), not the raw env value: a Domain that does not
        cover the request host is rejected and the cookie never stored."""
        self.assertIn("domain=_cookie_domain()", _cookie_bits(self.src))

    def test_every_clear_uses_the_same_domain(self):
        """Any raw resp.delete_cookie() outside the helper would fail to clear a
        parent-domain cookie — logout would appear to work and not."""
        raw = re.findall(r"resp\.delete_cookie\([^)]*\)", self.src)
        self.assertEqual(len(raw), 1, f"expected only the helper's call, got {raw}")
        # Same scoping as the set path, or the clear silently misses.
        self.assertIn("domain=_cookie_domain()", raw[0])
        # ...and the logout routes must actually route through it.
        self.assertGreaterEqual(self.src.count("_clear_cookie(resp,"), 3)


class OpenFirewallPortTest(unittest.TestCase):
    """443 was refused from outside — immediately, not a timeout, so the cloud
    security list allows it and the HOST firewall was rejecting. certbot's
    http-01 challenge only needs port 80, so the certificate would issue while
    https went on refusing connections: a closed port wearing the costume of a
    broken certificate."""

    def setUp(self):
        with open(os.path.join(DEPLOY, "open-firewall-port.sh"), encoding="utf-8") as fh:
            self.src = fh.read()

    def test_picks_one_firewall_backend_not_both(self):
        """firewalld owns the chains while it runs; a hand-inserted iptables
        rule is ignored or wiped on its next reload."""
        self.assertIn("elif command -v iptables", self.src)

    def test_iptables_rule_goes_above_the_catch_all_reject(self):
        """Oracle's images end INPUT with a catch-all REJECT — an appended
        ACCEPT below it never matches."""
        self.assertIn('$2=="REJECT"||$2=="DROP"', self.src)
        self.assertIn("iptables -I INPUT", self.src)

    def test_rule_is_persisted(self):
        """Otherwise https dies at the next reboot with no code change to
        explain it."""
        for how in ("netfilter-persistent", "iptables.init", "service iptables save"):
            self.assertIn(how, self.src)
        self.assertIn("could not persist", self.src)

    def test_port_argument_is_validated(self):
        self.assertIn("is not a port number", self.src)


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


class CookieDomainScopingTest(unittest.TestCase):
    """A Domain attribute that does not cover the request host is rejected by
    every browser — the cookie is silently never stored, so login returns 200
    and the user is immediately signed out again.

    SESSION_COOKIE_DOMAIN=.taureye.com did exactly that to sign-in on the bare
    IP, which is the host used for preview testing.
    """

    @classmethod
    def setUpClass(cls):
        import tempfile
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        os.environ["TRADELOG_BACKFILL"] = "0"
        os.environ["AUTH_SECRET"] = "cookie-scope-test"
        os.environ["SESSION_COOKIE_DOMAIN"] = ".taureye.com"
        try:
            import importlib
            import server
            cls.server = importlib.reload(server)
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server._warm_universe_async = lambda: None

    @classmethod
    def tearDownClass(cls):
        os.environ.pop("SESSION_COOKIE_DOMAIN", None)
        os.environ.pop("AUTH_SECRET", None)
        # Leave the shared login quota as we found it. This class signs in far
        # more than the 10-per-5-minutes cap allows, and an exhausted window
        # makes the NEXT test module fail with a 429 that has nothing to do
        # with what it is testing.
        with cls.server._RL_LOCK:
            cls.server._RL.clear()

    def setUp(self):
        # /auth/member/login is capped at 10 hits per 5 minutes per IP, and
        # every request here comes from the same one. Clearing the window keeps
        # the throttle intact in production while letting the suite exercise
        # more than ten sign-ins — a 429 here would look like a broken cookie.
        with self.server._RL_LOCK:
            self.server._RL.clear()

    def _login(self, host):
        c = self.server.app.test_client()
        r = c.post("/auth/member/login",
                   json={"username": "sri", "password": "STI123"},
                   headers={"Host": host})
        self.assertEqual(r.status_code, 200, r.data[:160])
        return c, " ".join(r.headers.getlist("Set-Cookie"))

    def test_a_host_outside_the_domain_gets_a_host_only_cookie(self):
        for host in ("161.118.174.177", "localhost", "example.org"):
            _, sc = self._login(host)
            self.assertNotIn("Domain=", sc, f"{host} was sent an unusable Domain")

    def test_hosts_inside_the_domain_still_span_apex_and_www(self):
        for host in ("taureye.com", "www.taureye.com"):
            _, sc = self._login(host)
            self.assertIn("Domain=taureye.com", sc, host)

    def test_a_lookalike_host_does_not_get_the_domain(self):
        """nottaureye.com ends with 'taureye.com' as a substring but is a
        different site — a suffix check without the dot would hand it a cookie
        scoped to someone else's domain."""
        _, sc = self._login("nottaureye.com")
        self.assertNotIn("Domain=", sc)

    def test_the_session_actually_sticks_on_every_host(self):
        """The symptom this fixes: login succeeded, the cookie was dropped, and
        the next request was anonymous again."""
        for host in ("161.118.174.177", "taureye.com", "localhost"):
            c, _ = self._login(host)
            r = c.get("/auth/member", headers={"Host": host})
            self.assertIsNotNone(r.json.get("member"), f"session lost on {host}")

    def test_logout_clears_with_the_same_scope_it_set(self):
        for host in ("161.118.174.177", "taureye.com"):
            c, sc = self._login(host)
            out = c.post("/auth/member/logout", headers={"Host": host})
            cleared = " ".join(out.headers.getlist("Set-Cookie"))
            self.assertEqual("Domain=" in sc, "Domain=" in cleared,
                             f"{host}: set and clear disagree on scope")
            r = c.get("/auth/member", headers={"Host": host})
            self.assertIsNone(r.json.get("member"), f"still signed in on {host}")


class StartPageCachingTest(unittest.TestCase):
    """`/` returns different documents to signed-in and signed-out visitors, so
    a cache that ignores the cookie will serve one to the other — which looks
    exactly like a broken login."""

    @classmethod
    def setUpClass(cls):
        import tempfile
        os.environ.setdefault("DB_PATH", tempfile.mktemp(suffix=".db"))
        os.environ["TRADELOG_BACKFILL"] = "0"
        try:
            import server
        except Exception as e:
            raise unittest.SkipTest("server import unavailable: %s" % e)
        cls.server = server
        cls.server._warm_universe_async = lambda: None

    def test_the_landing_is_never_stored(self):
        r = self.server.app.test_client().get("/", headers={"Host": "taureye.com"})
        self.assertIn("no-store", r.headers.get("Cache-Control", ""))

    def test_it_varies_on_the_cookie(self):
        r = self.server.app.test_client().get("/", headers={"Host": "taureye.com"})
        self.assertIn("Cookie", r.headers.get("Vary", ""))
