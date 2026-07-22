# User accounts — email + OTP login, per-user JSON document storage.
#
# The tenancy foundation for a public launch: identities, consent, sessions and
# server-side copies of the state that used to live only in the device's local
# storage (watchlists, alerts, paper trades). Deliberately minimal: SQLite via
# its own WAL connection, stdlib only, signed cookies reusing auth.py's HMAC.
#
# Email delivery is env-gated (SMTP_HOST/PORT/USER/PASS/FROM). Until the owner
# configures SMTP, /auth/otp/request refuses politely — except in explicit dev
# mode (DEV_ECHO_OTP=1), where the code is returned in the response so the flow
# can be exercised end-to-end without a mail server. Sessions additionally
# require a real signing secret (AUTH_SECRET or APP_PASSWORD): without one the
# HMAC key would be derivable, so account endpoints stay disabled.

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import threading
import time

import auth as _auth
from store import DB_PATH

_lock = threading.Lock()
_conn = None

OTP_TTL = 10 * 60          # code valid 10 minutes
OTP_MAX_ATTEMPTS = 5       # then a new code is required
SESSION_TTL = 30 * 24 * 3600

# Server-side user documents — the allowlisted kinds mirror the client's
# synced AsyncStorage keys (see mobile/src/session.ts).
DATA_KINDS = {
    "watchlist_v1", "watchlist_v2", "localalerts_v1",
    "papertrades_v1", "papersim_v1", "prefs_v1",
}

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _db():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                created_ts INTEGER NOT NULL,
                consent_ts INTEGER,
                last_login_ts INTEGER
            );
            CREATE TABLE IF NOT EXISTS user_otps (
                email TEXT PRIMARY KEY,
                code_hash TEXT NOT NULL,
                expires_ts INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS user_data (
                user_id INTEGER NOT NULL,
                kind TEXT NOT NULL,
                v TEXT NOT NULL,
                ts INTEGER NOT NULL,
                PRIMARY KEY (user_id, kind)
            );
        """)
        _conn.commit()
    return _conn


def enabled() -> bool:
    """Accounts work only with a real signing secret (see module docstring)."""
    return bool(os.environ.get("AUTH_SECRET") or os.environ.get("APP_PASSWORD"))


def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    e = _norm_email(email)
    return bool(e) and len(e) <= 254 and bool(_EMAIL_RE.match(e))


# ── OTP flow ─────────────────────────────────────────────────────────────────
def _hash_code(email: str, code: str) -> str:
    return hashlib.sha256(f"{email}:{code}".encode()).hexdigest()


def issue_otp(email: str) -> str:
    """Create + store a 6-digit code for the address; returns the code
    (caller decides how to deliver it)."""
    email = _norm_email(email)
    code = f"{secrets.randbelow(1000000):06d}"
    with _lock:
        c = _db()
        c.execute("INSERT INTO user_otps(email, code_hash, expires_ts, attempts) VALUES(?,?,?,0) "
                  "ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, "
                  "expires_ts=excluded.expires_ts, attempts=0",
                  (email, _hash_code(email, code), int(time.time()) + OTP_TTL))
        c.commit()
    return code


def verify_otp(email: str, code: str) -> bool:
    email = _norm_email(email)
    now = int(time.time())
    with _lock:
        c = _db()
        row = c.execute("SELECT code_hash, expires_ts, attempts FROM user_otps WHERE email=?",
                        (email,)).fetchone()
        if not row or row["expires_ts"] < now or row["attempts"] >= OTP_MAX_ATTEMPTS:
            return False
        ok = hmac.compare_digest(row["code_hash"], _hash_code(email, (code or "").strip()))
        if ok:
            c.execute("DELETE FROM user_otps WHERE email=?", (email,))
        else:
            c.execute("UPDATE user_otps SET attempts=attempts+1 WHERE email=?", (email,))
        c.commit()
    return ok


def send_otp_email(email: str, code: str) -> bool:
    """Deliver via env-configured SMTP. Returns False when not configured."""
    host = os.environ.get("SMTP_HOST")
    if not host:
        return False
    import smtplib
    from email.message import EmailMessage
    msg = EmailMessage()
    msg["Subject"] = f"TaurEye sign-in code: {code}"
    msg["From"] = os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "no-reply@taureye"))
    msg["To"] = email
    msg.set_content(
        f"Your TaurEye sign-in code is {code}. It expires in 10 minutes.\n\n"
        "If you didn't request this, ignore this email.")
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as s:
        s.starttls()
        user = os.environ.get("SMTP_USER")
        if user:
            s.login(user, os.environ.get("SMTP_PASS", ""))
        s.send_message(msg)
    return True


# ── users & sessions ─────────────────────────────────────────────────────────
def get_or_create_user(email: str, consent: bool):
    """Returns (user_row, created). New users REQUIRE consent=True."""
    email = _norm_email(email)
    now = int(time.time())
    with _lock:
        c = _db()
        row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        if row:
            c.execute("UPDATE users SET last_login_ts=? WHERE id=?", (now, row["id"]))
            c.commit()
            return dict(row), False
        if not consent:
            return None, False
        c.execute("INSERT INTO users(email, created_ts, consent_ts, last_login_ts) VALUES(?,?,?,?)",
                  (email, now, now, now))
        c.commit()
        row = c.execute("SELECT * FROM users WHERE email=?", (email,)).fetchone()
        return dict(row), True


def get_user(uid: int):
    with _lock:
        row = _db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return dict(row) if row else None


def make_session_cookie(uid: int) -> str:
    payload = json.dumps({"u": uid, "exp": int(time.time()) + SESSION_TTL}).encode()
    return _auth._sign(payload)


def session_user_id(cookie_value: str):
    if not enabled():
        return None
    data = _auth._verify(cookie_value or "")
    return data.get("u") if data and "u" in data else None


def delete_user(uid: int) -> None:
    """DPDP deletion: purge every row belonging to the account."""
    with _lock:
        c = _db()
        c.execute("DELETE FROM user_data WHERE user_id=?", (uid,))
        c.execute("DELETE FROM users WHERE id=?", (uid,))
        c.commit()


# ── calibration (community aggregate over synced paper-trade logs) ───────────
CAL_MIN_SAMPLE = 20


def calibration():
    """Aggregate every synced paper-trade log into per-engine realised
    hit-rate / average R / sample size. Hit-rates only appear at
    CAL_MIN_SAMPLE closed trades — below that the truthful answer is
    'insufficient sample', not a percentage."""
    with _lock:
        rows = _db().execute(
            "SELECT v FROM user_data WHERE kind='papertrades_v1'").fetchall()
    by = {}
    for row in rows:
        try:
            trades = json.loads(row["v"]) or []
        except Exception:
            continue
        if not isinstance(trades, list):
            continue
        for t in trades:
            if not isinstance(t, dict):
                continue
            src = str(t.get("source") or "Unlabelled")[:40]
            b = by.setdefault(src, {"n": 0, "closed": 0, "wins": 0, "r_sum": 0.0, "r_n": 0})
            b["n"] += 1
            status = t.get("status")
            if status not in ("won", "lost"):
                continue
            b["closed"] += 1
            try:
                entry, stop, target = float(t["entry"]), float(t["stop"]), float(t["target"])
                risk = abs(entry - stop)
                if risk > 0:
                    b["r_sum"] += (abs(target - entry) / risk) if status == "won" else -1.0
                    b["r_n"] += 1
            except Exception:
                pass
            if status == "won":
                b["wins"] += 1
    engines = []
    for src, b in sorted(by.items(), key=lambda kv: -kv[1]["closed"]):
        enough = b["closed"] >= CAL_MIN_SAMPLE
        engines.append({
            "source": src, "n": b["n"], "closed": b["closed"], "wins": b["wins"],
            "hit_rate": round(b["wins"] / b["closed"], 3) if enough else None,
            "avg_r": round(b["r_sum"] / b["r_n"], 2) if enough and b["r_n"] else None,
        })
    return {"engines": engines, "min_sample": CAL_MIN_SAMPLE,
            "accounts": len(rows)}


# ── per-user documents ───────────────────────────────────────────────────────
def data_get(uid: int, kind: str):
    with _lock:
        row = _db().execute("SELECT v, ts FROM user_data WHERE user_id=? AND kind=?",
                            (uid, kind)).fetchone()
    if not row:
        return None
    try:
        return {"v": json.loads(row["v"]), "ts": row["ts"]}
    except Exception:
        return None


def data_put(uid: int, kind: str, value, ts: int) -> None:
    with _lock:
        c = _db()
        c.execute("INSERT INTO user_data(user_id, kind, v, ts) VALUES(?,?,?,?) "
                  "ON CONFLICT(user_id, kind) DO UPDATE SET v=excluded.v, ts=excluded.ts",
                  (uid, kind, json.dumps(value), int(ts)))
        c.commit()
