"""What the deploy must not delete from the VM.

rsync runs with --delete, so a cache file that isn't excluded is removed on
every push. scan_cache.json exists precisely so technicals survive a restart;
letting the deploy wipe it would restore the behaviour it was written to fix.
"""
import os
import re
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


class ScanBatchTest(unittest.TestCase):
    """The client's /scan batch must fit nginx's STOCK request-line limit.

    Correctness cannot depend on the tuning drop-in being deployed: it lives in
    a separate PR, and when the batch was sized for the tuned 32k limit every
    /scan was rejected with a 414 before Flask saw it. The screener showed
    "technicals 0/1444" while the server's health probe reported a working
    upstream and an empty queue — nothing was arriving to be queued.
    """

    NGINX_DEFAULT_LIMIT = 8 * 1024
    AVG_SYMBOL_LEN = 12          # generous: most NSE tickers are 6-10 chars

    def test_a_full_batch_fits_the_stock_limit_with_room_to_spare(self):
        api = os.path.join(ROOT, "mobile", "src", "api.ts")
        with open(api) as f:
            src = f.read()
        m = re.search(r"const SCAN_BATCH = (\d+);", src)
        self.assertIsNotNone(m, "SCAN_BATCH is gone — did the batching change?")
        batch = int(m.group(1))
        # symbol + the URL-encoded comma between them
        query_bytes = batch * (self.AVG_SYMBOL_LEN + 3)
        self.assertLess(
            query_bytes, self.NGINX_DEFAULT_LIMIT // 2,
            f"SCAN_BATCH={batch} makes a ~{query_bytes}B query string; nginx's "
            f"default request line is {self.NGINX_DEFAULT_LIMIT}B and headers "
            f"share it. This shipped twice — keep well under half.")
