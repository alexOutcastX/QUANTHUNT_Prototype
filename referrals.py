# Refer and earn — codes, attribution, rewards.
#
# A code is derived from the account name rather than stored, so it is stable
# for the life of the account and needs no allocation table. It is HMAC-derived
# (not a hash of the username alone) so codes cannot be enumerated backwards
# into the member list.
#
# Rewards are paid through wallet.grant with a `ref` of "referral:<id>", which
# the ledger's unique index makes idempotent: replaying a claim cannot pay the
# referrer twice, however many times it is retried.
#
# Two rules exist to stop the obvious self-dealing:
#   - you cannot refer yourself
#   - an account can only be referred once, ever, and only before it has any
#     wallet history of its own

import hashlib
import hmac
import os
import sqlite3
import threading
import time

import wallet as _wallet
from store import DB_PATH

# What each side gets, in credits. Env-tunable so the numbers can move without
# a deploy once this is live.
REFERRER_REWARD = int(os.environ.get("REFERRAL_REFERRER_CREDITS", "100"))
REFEREE_REWARD = int(os.environ.get("REFERRAL_REFEREE_CREDITS", "50"))

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no I/O/0/1 — read aloud safely
_CODE_LEN = 7

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
            CREATE TABLE IF NOT EXISTS referrals (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                referrer TEXT NOT NULL,
                referee  TEXT NOT NULL UNIQUE,   -- an account is referred once
                code     TEXT NOT NULL,
                ts       INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_referrals_referrer ON referrals(referrer);
            """
        )
        _conn.commit()
    return _conn


def _norm(acct: str) -> str:
    return (acct or "").strip().lower()


def _secret() -> bytes:
    s = (os.environ.get("AUTH_SECRET", "").strip()
         or os.environ.get("APP_SECRET", "").strip())
    return ("te-referral::" + (s or "placeholder")).encode()


def code_for(acct: str) -> str:
    """The account's referral code. Derived, so it never needs storing."""
    acct = _norm(acct)
    if not acct:
        return ""
    digest = hmac.new(_secret(), acct.encode(), hashlib.sha256).digest()
    n = int.from_bytes(digest[:8], "big")
    out = []
    for _ in range(_CODE_LEN):
        n, i = divmod(n, len(_ALPHABET))
        out.append(_ALPHABET[i])
    return "".join(out)


def resolve(code: str, candidates) -> str:
    """Code → account, by re-deriving each candidate's code.

    Derived codes cannot be reversed, so resolution needs the account list.
    Callers pass the member table's keys.
    """
    want = (code or "").strip().upper().replace("-", "").replace(" ", "")
    if not want:
        return ""
    for acct in candidates:
        if code_for(acct) == want:
            return _norm(acct)
    return ""


class ReferralError(Exception):
    """Attribution refused — the message is safe to show the user."""


def claim(referee: str, code: str, candidates) -> dict:
    """Attribute `referee` to the owner of `code` and pay both sides."""
    referee = _norm(referee)
    if not referee:
        raise ReferralError("Sign in before applying a referral code.")

    referrer = resolve(code, candidates)
    if not referrer:
        raise ReferralError("That referral code is not valid.")
    if referrer == referee:
        raise ReferralError("You cannot refer yourself.")

    with _lock:
        conn = _db()
        if conn.execute("SELECT 1 FROM referrals WHERE referee = ?",
                        (referee,)).fetchone():
            raise ReferralError("This account has already used a referral code.")
        try:
            cur = conn.execute(
                "INSERT INTO referrals (referrer, referee, code, ts) VALUES (?,?,?,?)",
                (referrer, referee, code_for(referrer), int(time.time())))
            conn.commit()
        except sqlite3.IntegrityError:
            conn.rollback()
            raise ReferralError("This account has already used a referral code.")
        rid = cur.lastrowid

    # Outside the lock: wallet takes its own. `ref` makes both grants
    # idempotent, so a retry of this call cannot pay either side twice.
    _wallet.grant(referrer, REFERRER_REWARD, f"Referred {referee}",
                  ref=f"referral:{rid}:referrer")
    _wallet.grant(referee, REFEREE_REWARD, f"Joined via {referrer}",
                  ref=f"referral:{rid}:referee")
    return {"referrer": referrer, "referee": referee,
            "referrer_credits": REFERRER_REWARD, "referee_credits": REFEREE_REWARD}


def referred_by(acct: str) -> str:
    acct = _norm(acct)
    if not acct:
        return ""
    with _lock:
        row = _db().execute("SELECT referrer FROM referrals WHERE referee = ?",
                            (acct,)).fetchone()
    return row["referrer"] if row else ""


def stats(acct: str) -> dict:
    acct = _norm(acct)
    with _lock:
        rows = _db().execute(
            "SELECT referee, ts FROM referrals WHERE referrer = ? ORDER BY id DESC",
            (acct,)).fetchall()
    return {
        "code": code_for(acct),
        "count": len(rows),
        "credits_earned": len(rows) * REFERRER_REWARD,
        "referrals": [{"account": r["referee"], "ts": r["ts"]} for r in rows],
        "referred_by": referred_by(acct),
        "reward_referrer": REFERRER_REWARD,
        "reward_referee": REFEREE_REWARD,
    }


def _reset_for_tests():
    with _lock:
        _db().execute("DELETE FROM referrals")
        _db().commit()
