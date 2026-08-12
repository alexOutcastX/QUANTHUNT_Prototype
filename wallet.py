# Wallet — one append-only ledger for credits and money.
#
# Balances are never stored, only derived by summing the ledger. That is the
# whole point: a stored balance and a transaction list can disagree, and when
# they do there is no way to tell which one lied. Summing cannot drift.
#
# Two currencies share the table:
#   "credits"  the in-app unit that referrals grant and paid features spend
#   "INR"      real money (top-ups, payouts) — recorded here, moved by a
#              payment provider that is not wired up yet (see integrations.py)
#
# Every row is signed: `amount` is positive for money in, negative for money
# out. Spending checks the balance inside the same lock that writes the row, so
# two concurrent spends cannot both pass the check and overdraw.

import sqlite3
import threading
import time

from store import DB_PATH

CREDITS = "credits"
INR = "INR"
CURRENCIES = (CREDITS, INR)

_lock = threading.Lock()
_conn = None


def _db():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS wallet_ledger (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                acct     TEXT NOT NULL,
                currency TEXT NOT NULL,
                amount   INTEGER NOT NULL,     -- signed; credits are whole units
                reason   TEXT NOT NULL,
                ref      TEXT,                 -- idempotency key / external id
                ts       INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_wallet_acct ON wallet_ledger(acct, currency);
            -- Idempotency: a retried grant with the same ref must not pay twice.
            CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_ref
                ON wallet_ledger(acct, currency, ref) WHERE ref IS NOT NULL;
            """
        )
        _conn.commit()
    return _conn


def _norm(acct: str) -> str:
    return (acct or "").strip().lower()


class InsufficientFunds(Exception):
    """Raised instead of writing a row that would overdraw the balance."""


def balance(acct: str, currency: str = CREDITS) -> int:
    if not _norm(acct):
        return 0
    with _lock:
        row = _db().execute(
            "SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_ledger"
            " WHERE acct = ? AND currency = ?", (_norm(acct), currency)).fetchone()
    return int(row["bal"] or 0)


def balances(acct: str) -> dict:
    return {c: balance(acct, c) for c in CURRENCIES}


def _insert(conn, acct, currency, amount, reason, ref):
    try:
        conn.execute(
            "INSERT INTO wallet_ledger (acct, currency, amount, reason, ref, ts)"
            " VALUES (?,?,?,?,?,?)",
            (acct, currency, int(amount), reason, ref, int(time.time())))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        # Same (acct, currency, ref) already recorded — a duplicate delivery of
        # a webhook or a double-tapped button. Treat as already done.
        conn.rollback()
        return False


def grant(acct: str, amount: int, reason: str, ref: str = None,
          currency: str = CREDITS) -> bool:
    """Add funds. Returns False when `ref` was already granted (no double-pay)."""
    acct = _norm(acct)
    if not acct or int(amount) <= 0:
        return False
    with _lock:
        return _insert(_db(), acct, currency, int(amount), reason or "grant", ref)


def spend(acct: str, amount: int, reason: str, ref: str = None,
          currency: str = CREDITS) -> int:
    """Deduct funds, returning the new balance.

    The balance is read and the row written under one lock — otherwise two
    concurrent spends could both see a sufficient balance and both succeed.
    """
    acct = _norm(acct)
    amount = int(amount)
    if not acct or amount <= 0:
        raise ValueError("amount must be positive")
    with _lock:
        conn = _db()
        row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_ledger"
            " WHERE acct = ? AND currency = ?", (acct, currency)).fetchone()
        bal = int(row["bal"] or 0)
        if bal < amount:
            raise InsufficientFunds(f"balance {bal} < {amount} {currency}")
        _insert(conn, acct, currency, -amount, reason or "spend", ref)
        return bal - amount


def history(acct: str, limit: int = 50, currency: str = None) -> list:
    acct = _norm(acct)
    if not acct:
        return []
    q = ("SELECT id, currency, amount, reason, ref, ts FROM wallet_ledger"
         " WHERE acct = ?")
    args = [acct]
    if currency:
        q += " AND currency = ?"
        args.append(currency)
    q += " ORDER BY id DESC LIMIT ?"
    args.append(max(1, min(int(limit), 500)))
    with _lock:
        rows = _db().execute(q, args).fetchall()
    return [dict(r) for r in rows]


def _reset_for_tests():
    with _lock:
        _db().execute("DELETE FROM wallet_ledger")
        _db().commit()
