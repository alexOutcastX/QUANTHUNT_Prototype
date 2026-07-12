"""Unit tests for server-side alerts (isolated temp DB, no network)."""
import importlib
import os
import tempfile
import unittest


class AlertsTest(unittest.TestCase):
    def setUp(self):
        # Fresh temp DB per test so store state doesn't leak between cases.
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.tmp.close()
        os.environ["DB_PATH"] = self.tmp.name
        import store
        self.store = importlib.reload(store)
        import alerts
        self.a = importlib.reload(alerts)

    def tearDown(self):
        try:
            os.unlink(self.tmp.name)
        except OSError:
            pass
        os.environ.pop("DB_PATH", None)

    def test_evaluate_price(self):
        r = {"type": "price_above", "value": 100}
        self.assertTrue(self.a.evaluate(r, {"price": 105}))
        self.assertFalse(self.a.evaluate(r, {"price": 95}))
        rb = {"type": "price_below", "value": 100}
        self.assertTrue(self.a.evaluate(rb, {"price": 95}))

    def test_evaluate_pct_and_rsi(self):
        self.assertTrue(self.a.evaluate({"type": "pct_above", "value": 5}, {"chg": 6}))
        self.assertTrue(self.a.evaluate({"type": "rsi_below", "value": 30}, {"rsi": 28}))
        self.assertFalse(self.a.evaluate({"type": "rsi_below", "value": 30}, {"rsi": 40}))

    def test_evaluate_missing_field(self):
        self.assertFalse(self.a.evaluate({"type": "rsi_above", "value": 70}, {"price": 100}))
        self.assertFalse(self.a.evaluate({"type": "bogus", "value": 1}, {"price": 100}))

    def test_crud(self):
        a = self.a.create("RELIANCE", "price_above", 3000, "breakout")
        self.assertEqual(a["symbol"], "RELIANCE")
        self.assertEqual(len(self.a.list_alerts()), 1)
        self.assertTrue(self.a.delete(a["id"]))
        self.assertEqual(len(self.a.list_alerts()), 0)
        self.assertFalse(self.a.delete("nope"))

    def test_create_validates(self):
        self.assertRaises(ValueError, self.a.create, "X", "bad_type", 1)
        self.assertRaises(ValueError, self.a.create, "", "price_above", 1)
        self.assertRaises(ValueError, self.a.create, "X", "price_above", "abc")

    def test_check_fires_once(self):
        self.a.create("RELIANCE", "price_above", 3000)
        self.a.create("TCS", "price_below", 3000)
        fired = []
        got = self.a.check({"RELIANCE": {"price": 3100}, "TCS": {"price": 3500}},
                           notify=lambda al, q: fired.append(al["symbol"]))
        self.assertEqual([f["symbol"] for f in got], ["RELIANCE"])
        self.assertEqual(fired, ["RELIANCE"])
        # already triggered → does not fire again
        again = self.a.check({"RELIANCE": {"price": 3200}})
        self.assertEqual(again, [])

    def test_symbols_watched_excludes_triggered(self):
        self.a.create("RELIANCE", "price_above", 3000)
        self.a.create("TCS", "price_above", 3000)
        self.a.check({"RELIANCE": {"price": 3100}})
        self.assertEqual(self.a.symbols_watched(), ["TCS"])

    def test_toggle_rearms(self):
        a = self.a.create("RELIANCE", "price_above", 3000)
        self.a.check({"RELIANCE": {"price": 3100}})
        self.assertIsNotNone(self.a.list_alerts()[0]["triggered_at"])
        self.a.set_active(a["id"], True)   # re-arm clears the trigger
        self.assertIsNone(self.a.list_alerts()[0]["triggered_at"])


if __name__ == "__main__":
    unittest.main()
