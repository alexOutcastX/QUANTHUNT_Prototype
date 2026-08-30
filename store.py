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
        -- Self-service member accounts (see members.py).
        --
        -- Separate from the configured table in members.py on purpose: those
        -- are instance OWNERS, set by whoever runs the server, and a row here
        -- must never be able to shadow one. The merge in members.accounts()
        -- gives the configured table the last word.
        CREATE TABLE IF NOT EXISTS member_accounts (
            uname    TEXT PRIMARY KEY,      -- lowercased; the login name
            name     TEXT NOT NULL,         -- the casing to show back
            password TEXT NOT NULL,         -- scrypt hash, never plaintext
            plan     TEXT NOT NULL,
            created  INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tradelog (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            source   TEXT NOT NULL,        -- reco | momentum | multibagger
            symbol   TEXT NOT NULL,
            name     TEXT,
            side     TEXT NOT NULL DEFAULT 'long',
            strategy TEXT,                 -- the engine's own label for the pick
            entry    REAL NOT NULL,
            stop     REAL,                 -- null when the engine publishes no stop
            target   REAL,
            horizon_days INTEGER,
            opened   INTEGER NOT NULL,     -- epoch seconds
            status   TEXT NOT NULL,        -- open | won | lost | closed
            exit     REAL,
            closed   INTEGER,
            last     REAL,                 -- last mark-to-market price
            marked   INTEGER,              -- when that mark was taken
            rationale TEXT,                -- JSON list of strings
            meta     TEXT                  -- JSON dict (scores, sector, …)
        );
        -- A month of headlines. An RSS feed is a WINDOW, not an archive: it
        -- carries whatever the publisher has up right now, so anything older
        -- than a few hours is simply gone unless it was written down as it
        -- went past. Keyed on a hash of the link so the same story arriving
        -- from two polls, or from two feeds, is one row.
        CREATE TABLE IF NOT EXISTS news_items (
            id      TEXT PRIMARY KEY,     -- sha1 of the link
            ts      INTEGER NOT NULL,     -- publication time, epoch seconds
            title   TEXT NOT NULL,
            link    TEXT NOT NULL,
            source  TEXT,
            summary TEXT,
            seen    INTEGER NOT NULL      -- when this row was first recorded
        );
        CREATE INDEX IF NOT EXISTS ix_news_ts ON news_items (ts DESC);
        CREATE INDEX IF NOT EXISTS ix_tl_status ON tradelog (status, symbol);
        CREATE INDEX IF NOT EXISTS ix_tl_src ON tradelog (source, opened);
        CREATE TABLE IF NOT EXISTS cases (
            id       TEXT PRIMARY KEY,     -- slug, e.g. 'sector-information-technology'
            name     TEXT NOT NULL,
            kind     TEXT NOT NULL,        -- multibagger | sector | cap | strategy
            theme    TEXT,
            blurb    TEXT,
            vintage  INTEGER,              -- year this basket was struck
            created  INTEGER,
            rebalanced INTEGER,
            min_investment REAL,
            meta     TEXT                  -- JSON: reserve bench, deployed/cash
        );
        CREATE TABLE IF NOT EXISTS case_holdings (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id  TEXT NOT NULL,
            symbol   TEXT NOT NULL,
            name     TEXT,
            weight   REAL,                 -- target weight, 0-1
            entry    REAL,
            entry_ts INTEGER,
            shares   INTEGER,              -- at the case's minimum investment
            status   TEXT NOT NULL,        -- held | booked | exited | rebalanced
            exit     REAL,
            exit_ts  INTEGER,
            score    REAL,
            sector   TEXT,
            meta     TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_ch_case ON case_holdings (case_id, status);
        CREATE TABLE IF NOT EXISTS case_actions (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            case_id  TEXT NOT NULL,
            ts       INTEGER NOT NULL,
            action   TEXT NOT NULL,        -- add | book | exit | rebalance
            symbol   TEXT,
            price    REAL,
            qty_pct  REAL,
            pl_pct   REAL,
            note     TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_ca_case ON case_actions (case_id, ts);
        """
    )
    # Columns added after the table shipped. CREATE TABLE IF NOT EXISTS won't
    # touch a database that already has the table, so each one needs its own
    # guarded ALTER.
    _add_column(conn, "tradelog", "backfilled", "INTEGER NOT NULL DEFAULT 0")
    conn.commit()


def _add_column(conn, table: str, column: str, decl: str) -> None:
    """Add a column unless it's already there. Idempotent across restarts."""
    have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in have:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


# ── generic SQL access (schema lives above; semantics live in the caller) ──
def execute(sql: str, params=()) -> int:
    """Run one statement. Returns lastrowid for INSERTs, rowcount otherwise."""
    with _lock:
        c = _connect()
        cur = c.execute(sql, params)
        c.commit()
        return cur.lastrowid if cur.lastrowid else cur.rowcount


def query(sql: str, params=()) -> list:
    with _lock:
        rows = _connect().execute(sql, params).fetchall()
    return [dict(r) for r in rows]


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
