"""Unit tests for BYOK multi-provider handling + seed graphs in ai_graph (no network/deps)."""
import importlib
import json
import os
import tempfile
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

    def test_invests_is_a_valid_edge_type(self):
        # Equity-investment (investor → investee) edges must survive validation.
        g = self.ai._validate("XX", {
            "companies": {"XX": {"name": "X", "listed": True},
                          "PROMO": {"name": "Promoter", "listed": False},
                          "SUBS": {"name": "Subsidiary", "listed": True}},
            "edges": [
                {"src": "PROMO", "dst": "XX", "type": "invests", "note": "holds 60%", "confidence": "high"},
                {"src": "XX", "dst": "SUBS", "type": "invests", "note": "holds 75%", "confidence": "high"},
                {"src": "PROMO", "dst": "SUBS", "type": "group", "note": "same group", "confidence": "low"},
            ],
        })
        inv = [e for e in g["edges"] if e["type"] == "invests"]
        self.assertEqual(len(inv), 2)


class SeedGraphTest(unittest.TestCase):
    """Committed seed graphs load and serve keylessly."""

    def setUp(self):
        import ai_graph
        self.ai = importlib.reload(ai_graph)
        self.tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        json.dump({
            "ZZZ": {
                "companies": {"ZZZ": {"name": "Zzz", "listed": True},
                              "QQQ": {"name": "Qqq", "listed": True},
                              "WWW": {"name": "Www", "listed": False}},
                "edges": [
                    {"src": "QQQ", "dst": "ZZZ", "type": "supplies", "note": "n", "confidence": "high"},
                    {"src": "ZZZ", "dst": "QQQ", "type": "competitor", "note": "n", "confidence": "low"},
                    {"src": "WWW", "dst": "ZZZ", "type": "finances", "note": "n", "confidence": "medium"},
                ],
            }
        }, self.tmp)
        self.tmp.close()
        self.ai.SEED_FILE = self.tmp.name
        self.ai._cache = None          # force a reload that merges the seed

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_seed_is_served_without_a_key(self):
        g = self.ai.cached_graph("ZZZ")
        self.assertIsNotNone(g)
        self.assertIn("ZZZ", g["companies"])
        self.assertEqual(len(g["edges"]), 3)

    def test_unknown_symbol_not_in_seed(self):
        self.assertIsNone(self.ai.cached_graph("NOPE"))

    def test_rich_ai_graph_beats_seed(self):
        # A BYOK/AI-generated graph at least as rich as the seed is preserved.
        self.ai._cache = {"ZZZ": {"ts": 9_999_999_999, "src": "ai",
                                  "companies": {"ZZZ": {"name": "Real", "listed": True}},
                                  "edges": [{"src": "ZZZ", "dst": "A", "type": "supplies"}] * 5}}
        self.ai._merge_seed()
        self.assertEqual(self.ai._cache["ZZZ"]["companies"]["ZZZ"]["name"], "Real")
        self.assertEqual(self.ai._cache["ZZZ"].get("src"), "ai")

    def test_sparse_ai_entry_refreshed_from_seed(self):
        # A stale, sparse AI entry must not shadow the fuller curated seed.
        self.ai._cache = {"ZZZ": {"ts": 9_999_999_999, "src": "ai",
                                  "companies": {"ZZZ": {"name": "Stale", "listed": True}},
                                  "edges": [{"src": "ZZZ", "dst": "A", "type": "supplies"}]}}
        self.ai._merge_seed()
        self.assertEqual(len(self.ai._cache["ZZZ"]["edges"]), 3)
        self.assertEqual(self.ai._cache["ZZZ"].get("src"), "seed")

    def test_legacy_entry_refreshed_from_seed(self):
        # A stale legacy entry (no src marker) is replaced by the curated seed so
        # improved seed graphs reach production despite an old on-disk cache.
        self.ai._cache = {"ZZZ": {"ts": 9_999_999_999,
                                  "companies": {"ZZZ": {"name": "Stale", "listed": True}},
                                  "edges": []}}
        self.ai._merge_seed()
        self.assertEqual(len(self.ai._cache["ZZZ"]["edges"]), 3)
        self.assertEqual(self.ai._cache["ZZZ"].get("src"), "seed")


if __name__ == "__main__":
    unittest.main()


class AiGraphGroundingTest(unittest.TestCase):
    """Grounding context is fed to the model; a 2-edge graph is accepted; the
    outbound call is bounded by a short timeout."""

    def setUp(self):
        import ai_graph
        self.ai = importlib.reload(ai_graph)
        self.ai._cache = {}
        self.cap = {}

        def fake_post(url, headers=None, json=None, timeout=None):
            self.cap["url"] = url
            self.cap["timeout"] = timeout
            self.cap["prompt"] = (json or {}).get("messages", [{}])[0].get("content", "")
            text = ('{"companies":{"HBLENGINE":{"name":"HBL","listed":true},'
                    '"A":{"name":"A","listed":true},"B":{"name":"B","listed":true}},'
                    '"edges":[{"src":"A","dst":"HBLENGINE","type":"supplies","confidence":"high"},'
                    '{"src":"HBLENGINE","dst":"B","type":"supplies","confidence":"high"}]}')

            class Resp:
                def raise_for_status(self_inner):
                    pass

                def json(self_inner):
                    return {"content": [{"type": "text", "text": text}]}

            return Resp()

        self.ai.requests = types.SimpleNamespace(post=fake_post)

    def test_context_is_grounded_into_prompt(self):
        self.ai.get_graph("HBLENGINE", api_key="k", provider="anthropic",
                          context="HBL Engineering Ltd · Railway signalling · Industrials")
        self.assertIn("HBL Engineering Ltd", self.cap["prompt"])
        self.assertIn("HBLENGINE", self.cap["prompt"])

    def test_two_edge_graph_accepted(self):
        g = self.ai.get_graph("HBLENGINE", api_key="k", provider="anthropic")
        self.assertEqual(len(g["edges"]), 2)
        self.assertIn("HBLENGINE", g["companies"])

    def test_generation_timeout_is_short(self):
        self.ai.get_graph("HBLENGINE", api_key="k", provider="anthropic")
        self.assertEqual(self.cap["timeout"], self.ai.TIMEOUT)
        self.assertLessEqual(self.ai.TIMEOUT, 60)


if __name__ == "__main__":
    unittest.main()
