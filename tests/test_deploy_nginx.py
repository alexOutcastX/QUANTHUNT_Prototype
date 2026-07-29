"""The deploy's nginx handling.

Two failures are pinned here, one that happened and one that nearly did.

HAPPENED: nothing in the deploy ever copied nginx config. setup-vm.sh installs
it once at provisioning and is never run again, so an edge setting added to the
repo — the 32k header buffer that stops a long symbol list 414ing — sat there
looking deployed while every request still hit the 8k default.

NEARLY: the obvious fix is to copy deploy/nginx-quanthunt.conf over
/etc/nginx/conf.d/quanthunt.conf on each deploy. That would delete the site's
HTTPS. Once `certbot --nginx` has run it OWNS that file: the 443 server block,
the certificate paths and the 80->443 redirect all live inside it and exist
nowhere in the repo. Hence the drop-in.
"""
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOY = os.path.join(ROOT, ".github", "workflows", "deploy.yml")
TUNING = os.path.join(ROOT, "deploy", "nginx-tuning.conf")
SITE = os.path.join(ROOT, "deploy", "nginx-quanthunt.conf")


def _read(p):
    with open(p) as f:
        return f.read()


class NginxTuningDropInTest(unittest.TestCase):
    def test_the_drop_in_exists(self):
        self.assertTrue(os.path.isfile(TUNING), "deploy/nginx-tuning.conf is missing")

    def test_it_carries_the_header_buffer_fix(self):
        self.assertRegex(_read(TUNING), r"large_client_header_buffers\s+4\s+32k;")

    def test_it_is_http_context_only(self):
        """A server{} block here would apply to a port nobody asked for. These
        directives belong at http level so they also cover the 443 block
        certbot generates, which the per-server copy never reached."""
        body = re.sub(r"#.*", "", _read(TUNING))
        self.assertNotIn("server {", body)
        self.assertNotIn("listen", body)


class DeployWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.yml = _read(DEPLOY)

    def test_the_drop_in_is_installed(self):
        self.assertIn("nginx-tuning.conf", self.yml,
                      "the deploy no longer ships the nginx drop-in")
        self.assertIn("/etc/nginx/conf.d/zz-taureye-tuning.conf", self.yml)

    def test_the_config_is_tested_before_it_is_reloaded(self):
        """`nginx -t` has to gate the reload, or a bad drop-in takes the site
        down instead of failing the deploy."""
        i_test = self.yml.find("nginx -t")
        i_reload = self.yml.find("systemctl reload nginx")
        self.assertNotEqual(i_test, -1, "the deploy reloads nginx without testing it")
        self.assertLess(i_test, i_reload, "nginx -t must run before the reload")

    def test_a_bad_drop_in_is_rolled_back(self):
        self.assertIn("rm -f /etc/nginx/conf.d/zz-taureye-tuning.conf", self.yml,
                      "a drop-in that fails nginx -t must be removed again")

    def test_the_deploy_never_overwrites_the_certbot_owned_site_file(self):
        """THE important one. Once TLS is on, certbot owns quanthunt.conf —
        the 443 block and the cert paths live in it and in no repo file. A
        deploy that copies over it silently un-HTTPSes the site."""
        for line in self.yml.splitlines():
            bare = line.split("#", 1)[0]
            if "/etc/nginx/conf.d/quanthunt.conf" in bare:
                self.fail(f"deploy writes the certbot-owned site file: {line.strip()}")

    def test_the_caches_survive_a_deploy(self):
        """rsync runs with --delete, so a cache file not excluded here is
        DELETED from the VM on every push. scan_cache.json exists precisely so
        technicals survive a restart; letting the deploy wipe it would restore
        the exact behaviour it was written to fix."""
        for name in ("fund_cache.json", "scan_cache.json", "index_cache.json",
                     "quanthunt.db*"):
            self.assertIn(name, self.yml, f"deploy would delete {name} from the VM")

    def test_the_systemd_unit_is_still_synced(self):
        """The unit carries SCAN_WARM and the gunicorn thread count; a deploy
        that stopped syncing it would silently pin production to old tuning."""
        self.assertIn("/etc/systemd/system/quanthunt.service", self.yml)
        self.assertIn("systemctl daemon-reload", self.yml)


class SiteConfigTest(unittest.TestCase):
    def test_setup_still_installs_the_site_file(self):
        """A fresh VM has no drop-in yet, so the site config must still stand
        on its own until the first deploy runs."""
        setup = _read(os.path.join(ROOT, "deploy", "setup-vm.sh"))
        self.assertIn("/etc/nginx/conf.d/quanthunt.conf", setup)

    def test_the_site_file_keeps_its_own_copy_of_the_buffer_setting(self):
        """Belt and braces: between provisioning and the first deploy, the
        drop-in doesn't exist yet."""
        self.assertRegex(_read(SITE), r"large_client_header_buffers\s+4\s+32k;")


if __name__ == "__main__":
    unittest.main()
