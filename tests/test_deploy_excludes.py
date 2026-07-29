"""What the deploy must not delete from the VM.

rsync runs with --delete, so a cache file that isn't excluded is removed on
every push. scan_cache.json exists precisely so technicals survive a restart;
letting the deploy wipe it would restore the behaviour it was written to fix.
"""
import os
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEPLOY = os.path.join(ROOT, ".github", "workflows", "deploy.yml")


class DeployExcludesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(DEPLOY) as f:
            cls.yml = f.read()

    def test_the_caches_survive_a_deploy(self):
        for name in ("fund_cache.json", "scan_cache.json", "index_cache.json",
                     "quanthunt.db*"):
            self.assertIn(name, self.yml, f"deploy would delete {name} from the VM")

    def test_the_systemd_unit_is_still_synced(self):
        """The unit carries SCAN_WARM and the gunicorn thread count; a deploy
        that stopped syncing it would silently pin production to old tuning."""
        self.assertIn("/etc/systemd/system/quanthunt.service", self.yml)
        self.assertIn("systemctl daemon-reload", self.yml)


if __name__ == "__main__":
    unittest.main()
