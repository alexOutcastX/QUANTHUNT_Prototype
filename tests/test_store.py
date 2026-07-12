"""Stdlib-only unit tests for the SQLite persistence layer."""
import importlib
import os
import tempfile
import unittest


class StoreTest(unittest.TestCase):
    def setUp(self):
        os.environ["DB_PATH"] = os.path.join(tempfile.mkdtemp(), "t.db")
        import store
        self.store = importlib.reload(store)

    def test_kv_roundtrip(self):
        self.assertIsNone(self.store.kv_get("missing"))
        self.assertEqual(self.store.kv_get("missing", 42), 42)
        self.store.kv_set("a", {"x": 1})
        self.assertEqual(self.store.kv_get("a"), {"x": 1})
        self.store.kv_set("a", [1, 2, 3])  # upsert
        self.assertEqual(self.store.kv_get("a"), [1, 2, 3])

    def test_snapshots(self):
        for i, ts in enumerate([100, 200, 300]):
            self.store.snap_put("index", "NIFTY 50", {"level": 10 + i}, ts=ts)
        latest = self.store.snap_latest("index", "NIFTY 50")
        self.assertEqual(latest["ts"], 300)
        self.assertEqual(latest["data"]["level"], 12)
        series = self.store.snap_series("index", "NIFTY 50")
        self.assertEqual([s["ts"] for s in series], [100, 200, 300])  # chronological
        self.assertIsNone(self.store.snap_latest("index", "UNKNOWN"))

    def test_stats(self):
        self.store.kv_set("k", 1)
        self.store.snap_put("index", "X", {"v": 1})
        st = self.store.stats()
        self.assertTrue(st["ok"] and st["kv"] >= 1 and st["snapshots"] >= 1)


if __name__ == "__main__":
    unittest.main()
