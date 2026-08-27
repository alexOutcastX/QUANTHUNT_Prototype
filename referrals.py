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

# Paying the whole reward the moment someone signs in pays for signups, and
# signups are the cheapest thing in the world to manufacture. Split it: a
# little on arrival, the rest when the friend does something a bot would not
# bother to do. SIGNUP_SHARE is the fraction paid immediately.
SIGNUP_SHARE = float(os.environ.get("REFERRAL_SIGNUP_SHARE", "0.25"))
# Referrals paid per referrer per calendar month. Beyond this they accrue and
# wait for a look — a sudden spike is the shape of farming, not word of mouth.
MONTHLY_CAP = int(os.environ.get("REFERRAL_MONTHLY_CAP", "20"))


def _split(total: int):
    """(paid now, paid on activation). Never loses a credit to rounding."""
    now = int(total * SIGNUP_SHARE)
    return now, total - now

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
        # Added after the table shipped: CREATE TABLE IF NOT EXISTS will not
        # add a column to a database that already exists on the VM.
        cols = {r["name"] for r in _conn.execute("PRAGMA table_info(referrals)")}
        if "activated_at" not in cols:
            _conn.execute("ALTER TABLE referrals ADD COLUMN activated_at INTEGER")
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

    # Outside the lock: wallet takes its own. `ref` makes every grant
    # idempotent, so a retry of this call cannot pay either side twice.
    #
    # Only the signup share is paid here. The rest waits for activate(), so a
    # farm of accounts that sign up and do nothing earns a quarter of the
    # reward instead of all of it.
    r_now, _ = _split(REFERRER_REWARD)
    e_now, _ = _split(REFEREE_REWARD)
    capped = _paid_this_month(referrer) >= MONTHLY_CAP
    if not capped:
        _wallet.grant(referrer, r_now, f"Referred {referee}",
                      ref=f"referral:{rid}:referrer:signup")
    _wallet.grant(referee, e_now, f"Joined via {referrer}",
                  ref=f"referral:{rid}:referee:signup")
    return {"referrer": referrer, "referee": referee,
            "referrer_credits": 0 if capped else r_now, "referee_credits": e_now,
            "held_for_review": capped,
            "pending_referrer": REFERRER_REWARD - r_now,
            "pending_referee": REFEREE_REWARD - e_now}


def _paid_this_month(referrer: str) -> int:
    """How many referrals this account has been paid for this calendar month."""
    start = int(time.mktime(time.struct_time(
        time.gmtime()[:2] + (1, 0, 0, 0, 0, 0, 0))))
    row = _db().execute(
        "SELECT COUNT(*) AS n FROM referrals WHERE referrer = ? AND ts >= ?",
        (_norm(referrer), start)).fetchone()
    return int(row["n"] or 0)


def activate(referee: str) -> dict:
    """Pay the rest of the reward once the referred account does something real.

    Called when the friend runs a screen, adds a watchlist symbol or subscribes
    — the things a manufactured account does not bother to do. Idempotent: the
    ledger refs and the activated_at stamp both make a second call a no-op.
    """
    referee = _norm(referee)
    if not referee:
        return {"ok": False, "reason": "no-account"}
    with _lock:
        conn = _db()
        row = conn.execute(
            "SELECT id, referrer, activated_at FROM referrals WHERE referee = ?",
            (referee,)).fetchone()
        if not row:
            return {"ok": False, "reason": "not-referred"}
        if row["activated_at"]:
            return {"ok": False, "reason": "already-activated"}
        conn.execute("UPDATE referrals SET activated_at = ? WHERE id = ?",
                     (int(time.time()), row["id"]))
        conn.commit()

    rid, referrer = row["id"], row["referrer"]
    _, r_rest = _split(REFERRER_REWARD)
    _, e_rest = _split(REFEREE_REWARD)
    _wallet.grant(referrer, r_rest, f"{referee} got started",
                  ref=f"referral:{rid}:referrer:active")
    _wallet.grant(referee, e_rest, "Welcome bonus",
                  ref=f"referral:{rid}:referee:active")
    return {"ok": True, "referrer": referrer, "referrer_credits": r_rest,
            "referee_credits": e_rest}


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
