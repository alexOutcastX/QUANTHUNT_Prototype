"""A month of headlines, because an RSS feed is a window and not an archive.

The feeds carry whatever the publisher has up right now — a few hours, at most
a day. Anything older is gone unless it was written down as it went past. So
every poll records what it saw, and the history endpoint reads back from that.

Two consequences worth being plain about:

  * History starts accumulating the day this ships. It cannot reach backwards
    into stories that were never recorded, and asking for a month on day one
    returns a day.
  * Retention is a month and a bit. The table is a cache of public headlines,
    not a library; it is pruned on write so it cannot grow without bound.
"""
import hashlib
import time

import store

KEEP_DAYS = 35          # a month, plus slack so "last 30 days" is never short
_PRUNE_EVERY = 3600     # at most once an hour, on a write we were making anyway
_last_prune = 0.0


def item_id(link: str) -> str:
    """Stable identity for a story: its link.

    Titles get edited after publication and the same story reaches us from
    several feeds, so the link is the only thing that stays put.
    """
    return hashlib.sha1((link or "").strip().encode("utf-8", "replace")).hexdigest()


def record(items) -> int:
    """Write through whatever a poll just saw. Returns the number of NEW rows.

    Existing rows are left alone rather than updated: the first version of a
    headline is the one that was actually published at that timestamp, and a
    later poll re-reporting it with a rewritten title should not rewrite
    history.
    """
    now = int(time.time())
    rows = []
    for it in items or []:
        link = (it.get("link") or "").strip()
        title = (it.get("title") or "").strip()
        if not link or not title:
            continue
        rows.append((item_id(link), int(it.get("ts") or now), title, link,
                     it.get("source") or "", it.get("summary") or "", now))
    if not rows:
        return 0
    # Ask which ids are already here rather than trusting the insert to say so.
    # store.execute returns lastrowid when there is one, and on an INSERT OR
    # IGNORE that DID ignore, lastrowid is still whatever the connection's last
    # real insert set — so counting on its truthiness reports every poll as
    # entirely new.
    have = set()
    try:
        marks = ",".join("?" * len(rows))
        have = {r["id"] for r in store.query(
            f"SELECT id FROM news_items WHERE id IN ({marks})",
            tuple(r[0] for r in rows))}
    except Exception:
        pass
    new = 0
    for r in rows:
        try:
            store.execute(
                "INSERT OR IGNORE INTO news_items (id, ts, title, link, source, summary, seen) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)", r)
            if r[0] not in have:
                new += 1
                have.add(r[0])          # the same story twice in one batch
        except Exception:
            continue
    _prune()
    return new


def _prune(force: bool = False) -> int:
    global _last_prune
    now = time.time()
    if not force and now - _last_prune < _PRUNE_EVERY:
        return 0
    _last_prune = now
    cutoff = int(now) - KEEP_DAYS * 86400
    try:
        # `seen` as well as `ts`: a feed with a broken or missing date lands at
        # the time it was recorded, and pruning on ts alone would either keep
        # it forever or drop it instantly.
        return store.execute(
            "DELETE FROM news_items WHERE ts < ? AND seen < ?", (cutoff, cutoff))
    except Exception:
        return 0


def history(days: int = 30, limit: int = 200, offset: int = 0, q: str = "", source: str = ""):
    """Recorded headlines, newest first."""
    days = max(1, min(int(days or 30), KEEP_DAYS))
    limit = max(1, min(int(limit or 200), 500))
    offset = max(0, int(offset or 0))
    since = int(time.time()) - days * 86400
    sql = "SELECT id, ts, title, link, source, summary FROM news_items WHERE ts >= ?"
    params = [since]
    if q:
        sql += " AND (title LIKE ? OR summary LIKE ?)"
        like = "%" + q.strip() + "%"
        params += [like, like]
    if source:
        sql += " AND source = ?"
        params.append(source.strip())
    sql += " ORDER BY ts DESC LIMIT ? OFFSET ?"
    params += [limit, offset]
    try:
        return store.query(sql, tuple(params))
    except Exception:
        return []


def sources():
    """Which publishers the archive actually holds, for the filter."""
    try:
        rows = store.query(
            "SELECT source, COUNT(*) AS n FROM news_items "
            "WHERE source <> '' GROUP BY source ORDER BY n DESC")
        return [r["source"] for r in rows]
    except Exception:
        return []


def stats():
    try:
        r = store.query("SELECT COUNT(*) AS n, MIN(ts) AS oldest, MAX(ts) AS newest "
                        "FROM news_items")
        return r[0] if r else {"n": 0, "oldest": None, "newest": None}
    except Exception:
        return {"n": 0, "oldest": None, "newest": None}
