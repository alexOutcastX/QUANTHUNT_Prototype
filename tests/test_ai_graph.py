"""Unit tests for BYOK multi-provider handling in ai_graph (no network/deps — requests faked)."""
import importlib
import types
import unittest


GRAPH_JSON = (
    '{"companies": {"AAA": {"name": "Aaa", "listed": true},'
    ' "BBB": {"name": "Bbb", "listed": true},'
    ' "CCC": {"name": "Ccc", "listed": false},'
    ' "DDD": {"name": "Ddd", "listed": true}},'
    ' "edges": ['
    '{"src": "BBB", "dst": "AAA", "type": "supplies", "note": "x", "confidence": "high"},'
    '{"src": "AAA", "dst": "DDD", "type": "supplies", "note": "y", "confidence": "medium"},'
    '{"src": "CCC", "dst": "AAA", "type": "finances", "note": "z", "confidence": "low"}]}'
)


class AiGraphByokTest(unittest.TestCase):
    def setUp(self):
        import ai_graph
        self.ai = importlib.reload(ai_graph)
        self.ai._cache = {}          # isolate from any on-disk cache
        self.cap = {}

        def fake_post(url, headers=None, json=None, timeout=None):
            self.cap["url"] = url
            self.cap["headers"] = headers or {}
            self.cap["body"] = json or {}
            # Return each provider's own response envelope.
            if "anthropic" in url:
                payload = {"content": [{"type": "text", "text": GRAPH_JSON}]}
            elif "generativelanguage" in url:            # Gemini
                payload = {"candidates": [{"content": {"parts": [{"text": GRAPH_JSON}]}}]}
            else:                                        # OpenAI / Grok chat-completions
                payload = {"choices": [{"message": {"content": GRAPH_JSON}}]}

            class Resp:
                def raise_for_status(self_inner):
                    pass

                def json(self_inner):
                    return payload

            return Resp()

        # Inject a fake `requests` so the test runs with no third-party deps.
        self.ai.requests = types.SimpleNamespace(post=fake_post)

    def test_default_provider_is_anthropic(self):
        g = self.ai.get_graph("AAA", api_key="sk-ant-user")
        self.assertIn("anthropic", self.cap["url"])
        self.assertEqual(self.cap["headers"].get("x-api-key"), "sk-ant-user")
        self.assertEqual(self.cap["body"]["model"], self.ai.DEFAULT_MODELS["anthropic"])
        self.assertIn("AAA", g["companies"])

    def test_gemini_routing_and_auth(self):
        self.ai.get_graph("AAA", api_key="AIzaKEY", provider="gemini")
        self.assertIn("generativelanguage.googleapis.com", self.cap["url"])
        self.assertIn("gemini-2.0-flash", self.cap["url"])   # default model in the path
        self.assertEqual(self.cap["headers"].get("x-goog-api-key"), "AIzaKEY")

    def test_grok_routing_and_bearer(self):
        self.ai.get_graph("AAA", api_key="xai-KEY", provider="grok")
        self.assertIn("api.x.ai", self.cap["url"])
        self.assertEqual(self.cap["headers"].get("authorization"), "Bearer xai-KEY")

    def test_openai_routing_and_bearer(self):
        self.ai.get_graph("AAA", api_key="sk-openai", provider="openai")
        self.assertIn("api.openai.com", self.cap["url"])
        self.assertEqual(self.cap["headers"].get("authorization"), "Bearer sk-openai")

    def test_custom_model_override(self):
        self.ai.get_graph("AAA", api_key="sk-ant", provider="anthropic", model="claude-opus-4-8")
        self.assertEqual(self.cap["body"]["model"], "claude-opus-4-8")

    def test_unknown_provider_falls_back_to_anthropic(self):
        self.ai.get_graph("AAA", api_key="k", provider="bogus")
        self.assertIn("anthropic", self.cap["url"])

    def test_byok_overrides_server_key(self):
        self.ai.API_KEY = "sk-ant-server"
        self.ai._cache = {}
        self.ai.get_graph("AAA", api_key="sk-ant-user")
        self.assertEqual(self.cap["headers"].get("x-api-key"), "sk-ant-user")

    def test_non_anthropic_needs_byok_key(self):
        # A non-anthropic provider has no server-key fallback.
        self.ai.API_KEY = "sk-ant-server"
        self.ai._cache = {}
        with self.assertRaises(Exception):
            self.ai.get_graph("AAA", provider="gemini")

    def test_no_key_raises(self):
        self.ai.API_KEY = ""
        self.ai._cache = {}
        with self.assertRaises(Exception):
            self.ai.get_graph("AAA")

    def test_cache_is_symbol_keyed(self):
        self.ai.API_KEY = ""
        self.ai._cache = {}
        self.ai.get_graph("AAA", api_key="xai-KEY", provider="grok")
        self.cap.clear()
        g = self.ai.get_graph("AAA")          # no key/provider, but cached → no new request
        self.assertEqual(self.cap.get("url"), None)
        self.assertIn("AAA", g["companies"])


if __name__ == "__main__":
    unittest.main()
