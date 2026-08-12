# Product analytics — first-party, on our own SQLite.
#
# No third-party pixel: the events describe what people do inside a paid
# product, which is exactly the data not to hand to an ad network. If a
# warehouse is wanted later, integrations.py has the Supabase seam.
#
# Account identifiers are stored HASHED. Answering "how many people used the
# screener" and "did referred users convert" needs a stable per-person key, not
# a name, and a hashed key still joins correctly while making the event table
# useless on its own if it leaks.
#
# Retention is bounded (ANALYTICS_RETENTION_DAYS) and pruned on write, so the
# table cannot grow without limit on a small VM.

import hashlib
import hmac
import os
import sqlite3
import threading
import time

from store import DB_PATH

RETENTION_DAYS = int(os.environ.get("ANALYTICS_RETENTION_DAYS", "180"))
_MAX_PROPS = 2000          # characters of JSON per event

_lock = threading.Lock()
_conn = None
_writes = 0


def _db():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS analytics_events (
                id     INTEGER PRIMARY KEY AUTOINCREMENT,
                akey   TEXT NOT NULL,          -- hashed account
                event  TEXT NOT NULL,
                props  TEXT,
                plan   TEXT,
                ts     INTEGER NOT NULL,
                day    TEXT NOT NULL           -- YYYY-MM-DD, for cheap grouping
            );
            CREATE INDEX IF NOT EXISTS ix_ana_day   ON analytics_events(day);
            CREATE INDEX IF NOT EXISTS ix_ana_event ON analytics_events(event, day);
            """
        )
        _conn.commit()
    return _conn


def _secret() -> bytes:
    s = (os.environ.get("AUTH_SECRET", "").strip()
         or os.environ.get("APP_SECRET", "").strip())
    return ("te-analytics::" + (s or "placeholder")).encode()


def account_key(acct: str) -> str:
    """Stable pseudonymous key. Same account → same key; not reversible."""
    a = (acct or "").strip().lower()
    if not a:
        return "anon"
    return hmac.new(_secret(), a.encode(), hashlib.sha256).hexdigest()[:16]


def _day(ts: int) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(ts))


def track(acct: str, event: str, props: dict = None, plan: str = "") -> bool:
    """Record one event. Never raises — analytics must not break a request."""
    event = (event or "").strip()[:80]
    if not event:
        return False
    try:
        import json
        blob = json.dumps(props or {}, default=str)[:_MAX_PROPS]
        now = int(time.time())
        with _lock:
            conn = _db()
            conn.execute(
                "INSERT INTO analytics_events (akey, event, props, plan, ts, day)"
                " VALUES (?,?,?,?,?,?)",
                (account_key(acct), event, blob, (plan or "")[:20], now, _day(now)))
            conn.commit()
            global _writes
            _writes += 1
            if _writes % 500 == 0:
                _prune(conn)
        return True
    except Exception:
        return False


def _prune(conn):
    cutoff = _day(int(time.time()) - RETENTION_DAYS * 86400)
    conn.execute("DELETE FROM analytics_events WHERE day < ?", (cutoff,))
    conn.commit()


def summary(days: int = 30) -> dict:
    """Owner-facing rollup: activity, reach and what people actually use."""
    days = max(1, min(int(days), 365))
    since = int(time.time()) - days * 86400
    with _lock:
        conn = _db()
        totals = conn.execute(
            "SELECT COUNT(*) AS events, COUNT(DISTINCT akey) AS people"
            " FROM analytics_events WHERE ts >= ?", (since,)).fetchone()
        top = conn.execute(
            "SELECT event, COUNT(*) AS n, COUNT(DISTINCT akey) AS people"
            " FROM analytics_events WHERE ts >= ?"
            " GROUP BY event ORDER BY n DESC LIMIT 25", (since,)).fetchall()
        daily = conn.execute(
            "SELECT day, COUNT(*) AS events, COUNT(DISTINCT akey) AS people"
            " FROM analytics_events WHERE ts >= ?"
            " GROUP BY day ORDER BY day", (since,)).fetchall()
        by_plan = conn.execute(
            "SELECT COALESCE(NULLIF(plan,''),'unknown') AS plan,"
            " COUNT(DISTINCT akey) AS people, COUNT(*) AS events"
            " FROM analytics_events WHERE ts >= ? GROUP BY plan ORDER BY people DESC",
            (since,)).fetchall()
    return {
        "days": days,
        "events": int(totals["events"] or 0),
        "people": int(totals["people"] or 0),
        "top_events": [dict(r) for r in top],
        "daily": [dict(r) for r in daily],
        "by_plan": [dict(r) for r in by_plan],
        "retention_days": RETENTION_DAYS,
    }


def _reset_for_tests():
    global _writes
    with _lock:
        _db().execute("DELETE FROM analytics_events")
        _db().commit()
    _writes = 0
