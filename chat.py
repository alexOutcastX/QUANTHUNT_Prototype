"""In-app messaging: one global room, topic channels, and 1:1 DMs.

Identity is device-based (a persistent user_id + a chosen handle) — no login,
which fits the app's model. Global / channel / DM are unified as "conversations"
addressed by a conv id:
    global                     the community room everyone shares
    channel:<slug>             a topic channel (fixed seed list below)
    dm:<uidA>|<uidB>           a 1:1 DM (the two ids sorted, so it's stable)

Storage reuses store.py's single SQLite connection + lock (WAL), so it stays
correct under the 1-worker/8-thread gunicorn model. Stdlib only → unit-testable
in CI. Delivery is HTTP polling with an id cursor (see the /chat routes);
messages persist so history survives restarts.
"""
import re
import time
import uuid

import store

MAXLEN = 1000
GLOBAL = "global"

# Fixed seed channels. (User-created channels can come later; this keeps v1
# moderated and predictable.)
CHANNELS = [
    {"id": "channel:general", "name": "General", "desc": "Anything markets"},
    {"id": "channel:nifty", "name": "Nifty & indices", "desc": "Index moves, macro, F&O"},
    {"id": "channel:smallcaps", "name": "Small & mid caps", "desc": "Multibaggers, microcaps"},
    {"id": "channel:setups", "name": "Trade setups", "desc": "Ideas, entries, levels, patterns"},
]
_CHANNEL_IDS = {c["id"] for c in CHANNELS}

_HANDLE_RE = re.compile(r"[^A-Za-z0-9_. -]")
_DM_RE = re.compile(r"^dm:([A-Za-z0-9-]+)\|([A-Za-z0-9-]+)$")


def _now() -> int:
    return int(time.time())


def _db():
    return store._connect()


def _init() -> None:
    with store._lock:
        _db().executescript(
            """
            CREATE TABLE IF NOT EXISTS chat_users (
                user_id   TEXT PRIMARY KEY,
                handle    TEXT NOT NULL,
                created   INTEGER NOT NULL,
                last_seen INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_chat_handle ON chat_users (handle);
            CREATE TABLE IF NOT EXISTS chat_msgs (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                conv    TEXT NOT NULL,
                user_id TEXT,
                handle  TEXT,
                text    TEXT NOT NULL,
                ts      INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS ix_chat_conv ON chat_msgs (conv, id);
            CREATE TABLE IF NOT EXISTS chat_reads (
                user_id TEXT NOT NULL,
                conv    TEXT NOT NULL,
                last_id INTEGER NOT NULL,
                PRIMARY KEY (user_id, conv)
            );
            """
        )
        _db().commit()


_init()


# ── identity ─────────────────────────────────────────────────────────────────
def clean_handle(h: str) -> str:
    h = _HANDLE_RE.sub("", (h or "").strip())[:24].strip()
    return h


def upsert_user(user_id: str, handle: str) -> dict:
    """Create or update a device account. A blank user_id mints a new one."""
    uid = (user_id or "").strip() or uuid.uuid4().hex[:16]
    hd = clean_handle(handle) or ("trader-" + uid[:4])
    now = _now()
    with store._lock:
        c = _db()
        row = c.execute("SELECT created FROM chat_users WHERE user_id=?", (uid,)).fetchone()
        if row:
            c.execute("UPDATE chat_users SET handle=?, last_seen=? WHERE user_id=?", (hd, now, uid))
        else:
            c.execute("INSERT INTO chat_users(user_id, handle, created, last_seen) VALUES(?,?,?,?)",
                      (uid, hd, now, now))
        c.commit()
    return {"user_id": uid, "handle": hd}


def get_user(user_id: str) -> dict:
    with store._lock:
        row = _db().execute("SELECT user_id, handle FROM chat_users WHERE user_id=?",
                            (user_id,)).fetchone()
    return dict(row) if row else None


def touch(user_id: str) -> None:
    if not user_id:
        return
    with store._lock:
        _db().execute("UPDATE chat_users SET last_seen=? WHERE user_id=?", (_now(), user_id))
        _db().commit()


def find_users(q: str, limit: int = 20, exclude: str = None) -> list:
    q = clean_handle(q)
    if not q:
        return []
    with store._lock:
        rows = _db().execute(
            "SELECT user_id, handle FROM chat_users WHERE handle LIKE ? AND user_id != ? "
            "ORDER BY last_seen DESC LIMIT ?",
            (f"%{q}%", exclude or "", int(limit))).fetchall()
    return [dict(r) for r in rows]


def online_count(window: int = 300) -> int:
    with store._lock:
        row = _db().execute("SELECT COUNT(*) n FROM chat_users WHERE last_seen >= ?",
                            (_now() - window,)).fetchone()
    return row["n"] if row else 0


# ── conversations ────────────────────────────────────────────────────────────
def dm_conv(a: str, b: str) -> str:
    x, y = sorted([a, b])
    return f"dm:{x}|{y}"


def dm_peer(conv: str, me: str) -> str:
    m = _DM_RE.match(conv or "")
    if not m:
        return None
    a, b = m.group(1), m.group(2)
    return b if a == me else a


def valid_conv(conv: str) -> bool:
    return conv == GLOBAL or conv in _CHANNEL_IDS or bool(_DM_RE.match(conv or ""))


# ── messages ─────────────────────────────────────────────────────────────────
def post(conv: str, user_id: str, text: str) -> dict:
    """Append a message. Returns the stored row, or None if rejected."""
    text = (text or "").strip()[:MAXLEN]
    if not text or not valid_conv(conv):
        return None
    u = get_user(user_id) or {"handle": "trader"}
    now = _now()
    with store._lock:
        c = _db()
        cur = c.execute(
            "INSERT INTO chat_msgs(conv, user_id, handle, text, ts) VALUES(?,?,?,?,?)",
            (conv, user_id, u["handle"], text, now))
        c.commit()
        mid = cur.lastrowid
    return {"id": mid, "conv": conv, "user_id": user_id, "handle": u["handle"],
            "text": text, "ts": now}


def messages(conv: str, since_id: int = 0, limit: int = 100) -> list:
    """Messages in a conversation with id > since_id (chronological)."""
    if not valid_conv(conv):
        return []
    with store._lock:
        rows = _db().execute(
            "SELECT id, conv, user_id, handle, text, ts FROM chat_msgs "
            "WHERE conv=? AND id>? ORDER BY id ASC LIMIT ?",
            (conv, int(since_id or 0), int(limit))).fetchall()
    return [dict(r) for r in rows]


def recent(conv: str, limit: int = 50) -> list:
    """The last `limit` messages (chronological)."""
    if not valid_conv(conv):
        return []
    with store._lock:
        rows = _db().execute(
            "SELECT id, conv, user_id, handle, text, ts FROM chat_msgs "
            "WHERE conv=? ORDER BY id DESC LIMIT ?",
            (conv, int(limit))).fetchall()
    return [dict(r) for r in reversed(rows)]


def _last(conv: str):
    with store._lock:
        return _db().execute(
            "SELECT id, handle, text, ts FROM chat_msgs WHERE conv=? ORDER BY id DESC LIMIT 1",
            (conv,)).fetchone()


def mark_read(user_id: str, conv: str, last_id: int) -> None:
    if not user_id or not valid_conv(conv):
        return
    with store._lock:
        _db().execute(
            "INSERT INTO chat_reads(user_id, conv, last_id) VALUES(?,?,?) "
            "ON CONFLICT(user_id, conv) DO UPDATE SET last_id=MAX(last_id, excluded.last_id)",
            (user_id, conv, int(last_id)))
        _db().commit()


def _read_map(user_id: str) -> dict:
    with store._lock:
        rows = _db().execute("SELECT conv, last_id FROM chat_reads WHERE user_id=?",
                            (user_id,)).fetchall()
    return {r["conv"]: r["last_id"] for r in rows}


def _unread(conv: str, after_id: int, exclude_user: str) -> int:
    with store._lock:
        row = _db().execute(
            "SELECT COUNT(*) n FROM chat_msgs WHERE conv=? AND id>? AND "
            "(user_id IS NULL OR user_id!=?)",
            (conv, int(after_id or 0), exclude_user or "")).fetchone()
    return row["n"] if row else 0


def _user_dms(user_id: str) -> list:
    """DM conversations this user is part of."""
    with store._lock:
        rows = _db().execute(
            "SELECT DISTINCT conv FROM chat_msgs WHERE conv LIKE 'dm:%' AND "
            "(conv LIKE ? OR conv LIKE ?)",
            (f"dm:{user_id}|%", f"dm:%|{user_id}")).fetchall()
    return [r["conv"] for r in rows]


def overview(user_id: str) -> dict:
    """Everything the chat list needs: global + channels + the user's DMs, each
    with its last message and this user's unread count."""
    reads = _read_map(user_id)

    def entry(conv, name, kind, extra=None):
        last = _last(conv)
        e = {"conv": conv, "name": name, "kind": kind,
             "unread": _unread(conv, reads.get(conv, 0), user_id)}
        if last:
            e["last"] = {"handle": last["handle"], "text": last["text"], "ts": last["ts"]}
        if extra:
            e.update(extra)
        return e

    rooms = [entry(GLOBAL, "Global community", "global")]
    rooms += [entry(c["id"], c["name"], "channel", {"desc": c["desc"]}) for c in CHANNELS]
    dms = []
    for conv in _user_dms(user_id):
        peer = dm_peer(conv, user_id)
        pu = get_user(peer) if peer else None
        dms.append(entry(conv, (pu or {}).get("handle", "trader"), "dm", {"peer": peer}))
    dms.sort(key=lambda d: (d.get("last") or {}).get("ts", 0), reverse=True)
    return {"rooms": rooms, "dms": dms, "online": online_count()}


def delete(msg_id: int, requester_id: str, is_owner: bool = False) -> bool:
    """Delete a message if the requester is its author or the app owner."""
    with store._lock:
        c = _db()
        row = c.execute("SELECT user_id FROM chat_msgs WHERE id=?", (int(msg_id),)).fetchone()
        if not row:
            return False
        if not is_owner and row["user_id"] != requester_id:
            return False
        c.execute("DELETE FROM chat_msgs WHERE id=?", (int(msg_id),))
        c.commit()
    return True
