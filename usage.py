"""Monthly allowances — the middle ground between free and metered.

Some costs are real but continuous: a screener that sweeps as you page, a
dossier you might pull twice a week. Charging per action would charge for
scrolling; leaving them free gives the paid tiers nothing to sell. An allowance
per calendar month fits both.

Counters live server-side because a client-side allowance is a suggestion. They
are keyed on (acct, action, YYYY-MM), so a month rolls over by having a
different key rather than by anything needing to run at midnight.
"""
import os
import sqlite3
import threading
import time

import members as _members

DB_PATH = os.environ.get("DB_PATH", os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "quanthunt.db"))

_conn = None
_lock = threading.Lock()

# What each plan gets per calendar month. 0 means "not included at all";
# absence from a plan's dict means unlimited.
ALLOWANCES = {
    "free":   {"screen_run": 3, "dossier": 0, "backtest": 0},
    "member": {"screen_run": 100, "dossier": 2, "backtest": 5},
    "pro":    {},          # unlimited
}

LABELS = {
    "screen_run": "screen runs",
    "dossier": "dossiers",
    "backtest": "backtests",
}


def _db():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS usage_counters (
                acct   TEXT NOT NULL,
                action TEXT NOT NULL,
                period TEXT NOT NULL,      -- YYYY-MM
                n      INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (acct, action, period)
            );
            """
        )
        _conn.commit()
    return _conn


def _period(ts: int = None) -> str:
    return time.strftime("%Y-%m", time.gmtime(ts or time.time()))


def _norm(acct):
    return (acct or "").strip().lower()


def limit_for(plan: str, action: str):
    """None means unlimited."""
    return ALLOWANCES.get(plan or "free", {}).get(action)


def used(acct: str, action: str, ts: int = None) -> int:
    acct = _norm(acct)
    row = _db().execute(
        "SELECT n FROM usage_counters WHERE acct=? AND action=? AND period=?",
        (acct, action, _period(ts))).fetchone()
    return int(row["n"]) if row else 0


def remaining(acct: str, action: str, plan: str, ts: int = None):
    lim = limit_for(plan, action)
    if lim is None:
        return None                       # unlimited
    return max(0, lim - used(acct, action, ts))


def allows(acct: str, action: str, plan: str, ts: int = None) -> bool:
    left = remaining(acct, action, plan, ts)
    return left is None or left > 0


def record(acct: str, action: str, ts: int = None) -> int:
    """Count one use. Returns the new total for this month."""
    acct = _norm(acct)
    if not acct:
        return 0
    with _lock:
        conn = _db()
        conn.execute(
            "INSERT INTO usage_counters (acct, action, period, n) VALUES (?,?,?,1)"
            " ON CONFLICT(acct, action, period) DO UPDATE SET n = n + 1",
            (acct, action, _period(ts)))
        conn.commit()
    return used(acct, action, ts)


def summary(acct: str, plan: str, ts: int = None) -> dict:
    """Everything the client needs to show a limit BEFORE it is hit."""
    out = {}
    for action in LABELS:
        lim = limit_for(plan, action)
        out[action] = {
            "label": LABELS[action],
            "used": used(acct, action, ts),
            "limit": lim,                 # null = unlimited
            "remaining": remaining(acct, action, plan, ts),
            "unlimited": lim is None,
        }
    return {"period": _period(ts), "plan": plan, "actions": out}


def _reset_for_tests():
    with _lock:
        _db().execute("DELETE FROM usage_counters")
        _db().commit()
