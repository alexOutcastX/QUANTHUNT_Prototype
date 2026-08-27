"""Erasing an account, without corrupting the records of other people.

The tension DPDP creates in a product with a shared ledger: a person may demand
their data be erased, and the wallet holds the other half of transfers that
belong to somebody else. Deleting a gift's outbound row leaves the recipient
holding credits that came from nowhere, and the books stop balancing.

So: identifying data is removed, and financial rows are ANONYMISED in place.
The transfer survives, the person does not.
"""
import hashlib
import os
import sqlite3
import time

from store import DB_PATH

# A one-way label so anonymised rows can still be grouped for accounting
# without being traced back. Keyed on the same secret as the rest of the app,
# so it cannot be recomputed from public code alone.
_SALT = os.environ.get("AUTH_SECRET", "") or "te-privacy"


def anon_id(acct: str) -> str:
    return "deleted-" + hashlib.sha256(
        (_SALT + "::" + (acct or "").strip().lower()).encode()).hexdigest()[:12]


def erase(acct: str) -> dict:
    """Anonymise everything this account owns. Returns what was touched."""
    acct = (acct or "").strip().lower()
    if not acct:
        return {}
    anon = anon_id(acct)
    touched = {}
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.row_factory = sqlite3.Row
        existing = {r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}

        # Money: keep the rows, drop the identity.
        if "wallet_ledger" in existing:
            n = conn.execute("UPDATE wallet_ledger SET acct = ? WHERE acct = ?",
                             (anon, acct)).rowcount
            touched["wallet_ledger"] = f"{n} rows anonymised"

        # Referrals: both sides, same reasoning — the other party's count must
        # not silently change.
        if "referrals" in existing:
            a = conn.execute("UPDATE referrals SET referrer = ? WHERE referrer = ?",
                             (anon, acct)).rowcount
            b = conn.execute("UPDATE referrals SET referee = ? WHERE referee = ?",
                             (anon, acct)).rowcount
            touched["referrals"] = f"{a + b} rows anonymised"

        # Everything below is only about this account, so it goes.
        for table, col in (("usage_counters", "acct"),
                           ("subscriptions", "acct"),
                           ("billing_intents", "acct")):
            if table in existing:
                n = conn.execute(f"DELETE FROM {table} WHERE {col} = ?", (acct,)).rowcount
                touched[table] = f"{n} rows deleted"
        conn.commit()
    finally:
        conn.close()
    touched["anon_id"] = anon
    touched["at"] = int(time.time())
    return touched
