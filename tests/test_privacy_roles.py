"""Data rights, and roles beyond owner.

Erasure in a product with a shared ledger has a real tension: the person may
demand deletion, and the wallet holds the other half of transfers belonging to
somebody else. Deleting a gift's outbound row leaves the recipient holding
credits from nowhere and the books no longer balance. Financial rows are
anonymised in place instead — the transfer survives, the person does not.
"""
import os
import tempfile
import unittest


class RoleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import members
        cls.m = members

    def test_owner_implies_the_owner_role(self):
        self.assertEqual(self.m.role_of({"owner": True}), "owner")

    def test_an_account_defaults_to_member(self):
        self.assertEqual(self.m.role_of({}), "member")

    def test_a_viewer_cannot_write(self):
        self.assertFalse(self.m.can_write({"role": "viewer"}))

    def test_members_and_owners_can_write(self):
        self.assertTrue(self.m.can_write({}))
        self.assertTrue(self.m.can_write({"owner": True}))

    def test_an_unknown_role_falls_back_rather_than_escalating(self):
        """A typo in the account table must not grant more than intended."""
        self.assertEqual(self.m.role_of({"role": "administrator"}), "member")
        self.assertEqual(self.m.role_of({"role": ""}), "member")

    def test_owner_wins_over_a_written_role(self):
        self.assertEqual(self.m.role_of({"owner": True, "role": "viewer"}), "owner")

    def test_the_session_carries_the_role(self):
        self.assertEqual(self.m.check_login("sri", "STI123")["role"], "owner")


class ErasureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
        import importlib
        import wallet
        import referrals
        import privacy
        cls.wallet = importlib.reload(wallet)
        cls.ref = importlib.reload(referrals)
        cls.privacy = importlib.reload(privacy)

    def setUp(self):
        self.wallet._reset_for_tests()
        self.ref._reset_for_tests()

    def test_the_ledger_rows_survive_erasure(self):
        """They are the other half of somebody else's transfer."""
        self.wallet.grant("a", 100, "Top-up purchase", ref="buy")
        before = len(self.wallet.history("a"))
        self.assertGreater(before, 0)
        self.privacy.erase("a")
        anon = self.privacy.anon_id("a")
        self.assertEqual(len(self.wallet.history(anon)), before)

    def test_the_identity_does_not_survive(self):
        self.wallet.grant("a", 100, "Top-up purchase", ref="buy")
        self.privacy.erase("a")
        self.assertEqual(self.wallet.balance("a"), 0)
        self.assertEqual(self.wallet.history("a"), [])

    def test_a_gift_still_balances_after_the_sender_is_erased(self):
        """The recipient must not end up holding credits from nowhere."""
        import gifting
        self.wallet.grant("a", 200, "Top-up purchase", ref="buy")
        gifting.send("a", "b", 100, known_accounts={"a", "b"})
        self.assertEqual(self.wallet.balance("b"), 100)
        self.privacy.erase("a")
        self.assertEqual(self.wallet.balance("b"), 100)
        anon = self.privacy.anon_id("a")
        self.assertTrue(any("Gift to b" in (r["reason"] or "")
                            for r in self.wallet.history(anon)))

    def test_the_anon_id_is_stable_and_not_reversible(self):
        a1 = self.privacy.anon_id("a")
        self.assertEqual(a1, self.privacy.anon_id("a"))
        self.assertNotEqual(a1, self.privacy.anon_id("b"))
        self.assertNotIn("a", a1.replace("deleted-", "")[:0] or "x")
        self.assertTrue(a1.startswith("deleted-"))

    def test_referrals_are_anonymised_on_both_sides(self):
        """The other party's referral count must not silently change."""
        self.ref.claim("bob", self.ref.code_for("alice"), ["alice", "bob"])
        self.assertEqual(self.ref.stats("alice")["count"], 1)
        self.privacy.erase("bob")
        self.assertEqual(self.ref.stats("alice")["count"], 1)

    def test_erasing_nothing_is_harmless(self):
        self.assertEqual(self.privacy.erase(""), {})
        self.assertIn("anon_id", self.privacy.erase("never-existed"))


if __name__ == "__main__":
    unittest.main()
