"""Unit tests for public-API key management (isolated temp DB, no network)."""
import importlib
import os
import tempfile
import unittest


class ApiKeysTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        os.environ["DB_PATH"] = self.tmp.name
        import store
        self.store = importlib.reload(store)
        import apikeys
        self.k = importlib.reload(apikeys)

    def tearDown(self):
        try:
            os.unlink(self.tmp.name)
        except OSError:
            pass
        os.environ.pop("DB_PATH", None)

    def test_issue_returns_raw_once_and_stores_hash(self):
        raw, rec = self.k.issue("my key")
        self.assertTrue(raw.startswith("te_"))
        self.assertNotIn("hash", rec)          # public record hides the hash
        self.assertEqual(rec["label"], "my key")
        # stored list never exposes the raw key or lets it be reconstructed
        stored = self.k.list_keys()
        self.assertEqual(len(stored), 1)
        self.assertNotIn("hash", stored[0])

    def test_verify_valid_and_invalid(self):
        raw, _ = self.k.issue()
        rec = self.k.verify(raw)
        self.assertIsNotNone(rec)
        self.assertEqual(rec["calls"], 1)      # usage counter bumped
        self.assertIsNone(self.k.verify("te_wrongkey"))
        self.assertIsNone(self.k.verify(""))
        self.assertIsNone(self.k.verify("nokeyprefix"))

    def test_calls_increment(self):
        raw, _ = self.k.issue()
        self.k.verify(raw)
        self.k.verify(raw)
        rec = self.k.verify(raw)
        self.assertEqual(rec["calls"], 3)

    def test_revoke_blocks_verify(self):
        raw, rec = self.k.issue()
        self.assertTrue(self.k.revoke(rec["id"]))
        self.assertIsNone(self.k.verify(raw))
        self.assertFalse(self.k.revoke("missing"))

    def test_two_keys_are_distinct(self):
        a, _ = self.k.issue("a")
        b, _ = self.k.issue("b")
        self.assertNotEqual(a, b)
        self.assertIsNotNone(self.k.verify(a))
        self.assertIsNotNone(self.k.verify(b))


if __name__ == "__main__":
    unittest.main()
