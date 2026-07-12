# Persistent store — SQLite, thread-safe, stdlib only.
#
# Replaces the app's ephemeral in-memory/localStorage-only state for things that
# must survive restarts: a generic key/value store, and time-stamped snapshots
# (index levels, later portfolio/alerts) that give the app a real history.
#
# One file (DB_PATH, default quanthunt.db beside the code). Git-ignored and
# rsync-excluded on deploy so it persists across releases. A single connection
# guarded by a lock keeps it simple and correct under the 1-worker/8-thread
# gunicorn model.

import json
import os
import sqlite3
import threading
import time

DB_PATH = os.environ.get("DB_PATH",
                         os.path.join(os.path.dirname(os.path.abspath(__file__)), "quanthunt.db"))

_lock = threading.Lock()
_conn = None


def _connect():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _migrate(_conn)
    return _conn


def _migrate(conn):
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS kv (
            k TEXT PRIMARY KEY,
            v TEXT NOT NULL,
            ts INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,          -- e.g. 'index'
            key  TEXT NOT NULL,          -- e.g. 'NIFTY 50'
            ts   INTEGER NOT NULL,       -- epoch seconds
            data TEXT NOT NULL           -- JSON payload
        );
        CREATE INDEX IF NOT EXISTS ix_snap ON snapshots (kind, key, ts);
        """
    )
    conn.commit()


# ── key/value ──
def kv_set(key: str, value) -> None:
    with _lock:
        c = _connect()
        c.execute("INSERT INTO kv(k, v, ts) VALUES(?,?,?) "
                  "ON CONFLICT(k) DO UPDATE SET v=excluded.v, ts=excluded.ts",
                  (key, json.dumps(value), int(time.time())))
        c.commit()


def kv_get(key: str, default=None):
    with _lock:
        row = _connect().execute("SELECT v FROM kv WHERE k=?", (key,)).fetchone()
    if not row:
        return default
    try:
        return json.loads(row["v"])
    except Exception:
        return default


# ── snapshots (append-only history) ──
def snap_put(kind: str, key: str, data, ts: int = None) -> None:
    with _lock:
        c = _connect()
        c.execute("INSERT INTO snapshots(kind, key, ts, data) VALUES(?,?,?,?)",
                  (kind, key, int(ts or time.time()), json.dumps(data)))
        c.commit()


def snap_latest(kind: str, key: str):
    with _lock:
        row = _connect().execute(
            "SELECT ts, data FROM snapshots WHERE kind=? AND key=? ORDER BY ts DESC LIMIT 1",
            (kind, key)).fetchone()
    if not row:
        return None
    return {"ts": row["ts"], "data": json.loads(row["data"])}


def snap_series(kind: str, key: str, limit: int = 400):
    with _lock:
        rows = _connect().execute(
            "SELECT ts, data FROM snapshots WHERE kind=? AND key=? ORDER BY ts DESC LIMIT ?",
            (kind, key, limit)).fetchall()
    return [{"ts": r["ts"], "data": json.loads(r["data"])} for r in reversed(rows)]


def stats() -> dict:
    with _lock:
        try:
            c = _connect()
            kv = c.execute("SELECT COUNT(*) n FROM kv").fetchone()["n"]
            snaps = c.execute("SELECT COUNT(*) n FROM snapshots").fetchone()["n"]
            return {"ok": True, "kv": kv, "snapshots": snaps, "path": os.path.basename(DB_PATH)}
        except Exception as e:
            return {"ok": False, "error": type(e).__name__}
