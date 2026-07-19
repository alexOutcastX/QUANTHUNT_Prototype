"""Unit tests for the in-app messaging engine (chat.py) — pure stdlib.

Each test runs against a fresh temp SQLite DB so the store/chat tables are
isolated. chat.py binds to store's connection at import, so we point DB_PATH at
a temp file and reset the shared connection before importing.
"""
import os
import tempfile
import unittest


def _fresh_chat():
    """(re)import store + chat against a brand-new temp DB and return chat."""
    import importlib
    import store
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    os.environ["DB_PATH"] = path
    store.DB_PATH = path
    store._conn = None  # force a reconnect to the temp DB
    import chat
    importlib.reload(chat)  # re-runs _init() against the new DB
    return chat, path


class ChatTest(unittest.TestCase):
    def setUp(self):
        self.chat, self._path = _fresh_chat()

    def tearDown(self):
        try:
            import store
            store._conn = None
            os.remove(self._path)
            for ext in ("-wal", "-shm"):
                if os.path.exists(self._path + ext):
                    os.remove(self._path + ext)
        except Exception:
            pass

    def test_identity_mint_and_update(self):
        a = self.chat.upsert_user("", "Alice!")
        self.assertTrue(a["user_id"])
        self.assertEqual(a["handle"], "Alice")  # '!' stripped
        again = self.chat.upsert_user(a["user_id"], "Alice2")
        self.assertEqual(again["user_id"], a["user_id"])
        self.assertEqual(again["handle"], "Alice2")

    def test_handle_cleaning(self):
        self.assertEqual(self.chat.clean_handle("  bad<>chars!!  "), "badchars")
        self.assertEqual(self.chat.clean_handle("x" * 50), "x" * 24)

    def test_global_post_and_fetch(self):
        a = self.chat.upsert_user("", "Alice")
        m1 = self.chat.post(self.chat.GLOBAL, a["user_id"], "hi")
        m2 = self.chat.post(self.chat.GLOBAL, a["user_id"], "again")
        msgs = self.chat.messages(self.chat.GLOBAL)
        self.assertEqual([m["text"] for m in msgs], ["hi", "again"])
        # since-cursor
        after = self.chat.messages(self.chat.GLOBAL, since_id=m1["id"])
        self.assertEqual([m["id"] for m in after], [m2["id"]])

    def test_empty_and_invalid_rejected(self):
        a = self.chat.upsert_user("", "Alice")
        self.assertIsNone(self.chat.post(self.chat.GLOBAL, a["user_id"], "   "))
        self.assertIsNone(self.chat.post("channel:does-not-exist", a["user_id"], "hi"))
        self.assertIsNone(self.chat.post("bogus", a["user_id"], "hi"))

    def test_dm_roundtrip_and_peer(self):
        a = self.chat.upsert_user("", "Alice")
        b = self.chat.upsert_user("", "Bob")
        conv = self.chat.dm_conv(a["user_id"], b["user_id"])
        # deterministic regardless of arg order
        self.assertEqual(conv, self.chat.dm_conv(b["user_id"], a["user_id"]))
        self.assertTrue(self.chat.valid_conv(conv))
        self.assertEqual(self.chat.dm_peer(conv, a["user_id"]), b["user_id"])
        self.chat.post(conv, a["user_id"], "hey bob")
        self.assertEqual(len(self.chat.messages(conv)), 1)

    def test_user_search(self):
        a = self.chat.upsert_user("", "Alice")
        self.chat.upsert_user("", "Bobby")
        self.chat.upsert_user("", "Bobbie")
        hits = self.chat.find_users("bob", exclude=a["user_id"])
        self.assertEqual({h["handle"] for h in hits}, {"Bobby", "Bobbie"})
        self.assertEqual(self.chat.find_users("zzz"), [])

    def test_overview_unread_and_mark_read(self):
        a = self.chat.upsert_user("", "Alice")
        b = self.chat.upsert_user("", "Bob")
        # Bob posts in a channel → unread for Alice, but Alice's own posts aren't.
        self.chat.post("channel:nifty", b["user_id"], "nifty up")
        self.chat.post(self.chat.GLOBAL, a["user_id"], "my own msg")
        ov = self.chat.overview(a["user_id"])
        by_conv = {r["conv"]: r for r in ov["rooms"]}
        self.assertEqual(by_conv["channel:nifty"]["unread"], 1)
        self.assertEqual(by_conv[self.chat.GLOBAL]["unread"], 0)  # own message
        last_nifty = self.chat.recent("channel:nifty")[-1]["id"]
        self.chat.mark_read(a["user_id"], "channel:nifty", last_nifty)
        ov2 = self.chat.overview(a["user_id"])
        self.assertEqual({r["conv"]: r for r in ov2["rooms"]}["channel:nifty"]["unread"], 0)

    def test_overview_lists_dms(self):
        a = self.chat.upsert_user("", "Alice")
        b = self.chat.upsert_user("", "Bob")
        conv = self.chat.dm_conv(a["user_id"], b["user_id"])
        self.chat.post(conv, b["user_id"], "yo")
        ov = self.chat.overview(a["user_id"])
        self.assertEqual(len(ov["dms"]), 1)
        self.assertEqual(ov["dms"][0]["name"], "Bob")
        self.assertEqual(ov["dms"][0]["unread"], 1)

    def test_delete_author_only_unless_owner(self):
        a = self.chat.upsert_user("", "Alice")
        b = self.chat.upsert_user("", "Bob")
        m = self.chat.post(self.chat.GLOBAL, a["user_id"], "delete me")
        self.assertFalse(self.chat.delete(m["id"], b["user_id"]))        # not author
        self.assertTrue(self.chat.delete(m["id"], b["user_id"], is_owner=True))  # owner moderates
        self.assertEqual(self.chat.messages(self.chat.GLOBAL), [])


if __name__ == "__main__":
    unittest.main()
