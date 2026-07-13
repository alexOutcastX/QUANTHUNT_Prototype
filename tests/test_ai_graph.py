"""Unit tests for BYOK key handling in ai_graph (no network — requests.post stubbed)."""
import importlib
import unittest


class AiGraphByokTest(unittest.TestCase):
    def setUp(self):
        import ai_graph
        self.ai = importlib.reload(ai_graph)
        self.ai._cache = {}          # isolate from any on-disk cache
        self.captured = {}

        # A valid-looking model response for any request, capturing the key used.
        graph_json = (
            '{"companies": {"AAA": {"name": "Aaa", "listed": true},'
            ' "BBB": {"name": "Bbb", "listed": true},'
            ' "CCC": {"name": "Ccc", "listed": false},'
            ' "DDD": {"name": "Ddd", "listed": true}},'
            ' "edges": ['
            '{"src": "BBB", "dst": "AAA", "type": "supplies", "note": "x", "confidence": "high"},'
            '{"src": "AAA", "dst": "DDD", "type": "supplies", "note": "y", "confidence": "medium"},'
            '{"src": "CCC", "dst": "AAA", "type": "finances", "note": "z", "confidence": "low"}]}'
        )

        class FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"content": [{"type": "text", "text": graph_json}]}

        def fake_post(url, headers=None, json=None, timeout=None):
            self.captured["key"] = (headers or {}).get("x-api-key")
            return FakeResp()

        self.ai.requests.post = fake_post

    def test_byok_key_is_used(self):
        g = self.ai.get_graph("AAA", api_key="sk-ant-user-key")
        self.assertEqual(self.captured["key"], "sk-ant-user-key")
        self.assertIn("AAA", g["companies"])
        self.assertGreaterEqual(len(g["edges"]), 3)

    def test_server_key_used_when_no_byok(self):
        self.ai.API_KEY = "sk-ant-server"
        self.ai._cache = {}
        self.ai.get_graph("AAA")
        self.assertEqual(self.captured["key"], "sk-ant-server")

    def test_byok_overrides_server_key(self):
        self.ai.API_KEY = "sk-ant-server"
        self.ai._cache = {}
        self.ai.get_graph("AAA", api_key="sk-ant-user")
        self.assertEqual(self.captured["key"], "sk-ant-user")

    def test_no_key_raises(self):
        self.ai.API_KEY = ""
        self.ai._cache = {}
        with self.assertRaises(Exception):
            self.ai.get_graph("AAA")

    def test_cache_is_symbol_keyed_not_key_keyed(self):
        # First user generates with their key; a later call with no key reuses it.
        self.ai.API_KEY = ""
        self.ai._cache = {}
        self.ai.get_graph("AAA", api_key="sk-ant-user")
        self.captured.clear()
        g = self.ai.get_graph("AAA")          # no key, but cached → no new request
        self.assertEqual(self.captured.get("key"), None)
        self.assertIn("AAA", g["companies"])


if __name__ == "__main__":
    unittest.main()
