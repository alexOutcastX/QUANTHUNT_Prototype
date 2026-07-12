# Public-API key management (stdlib only).
#
# Keys are shown ONCE at issue time; only their SHA-256 hash is stored (in
# store.py kv), so a store leak never exposes usable keys. Verification is a
# constant-time hash compare. The owner issues/revokes keys; callers pass the
# raw key as `X-API-Key` to the /api/v1/* endpoints.

import hashlib
import hmac
import secrets
import time

import store as _store

KEY = "apikeys"
PREFIX = "te_"


def _now():
    return int(time.time())


def _hash(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _load():
    return _store.kv_get(KEY, []) or []


def _save(keys):
    _store.kv_set(KEY, keys)


def issue(label=""):
    """Create a key. Returns (raw_key, record). The raw key is not stored."""
    raw = PREFIX + secrets.token_urlsafe(24)
    rec = {
        "id": secrets.token_hex(6),
        "hash": _hash(raw),
        "label": str(label or "")[:60],
        "created": _now(),
        "last_used": None,
        "calls": 0,
        "active": True,
    }
    keys = _load()
    keys.append(rec)
    _save(keys)
    # never hand back the hash to the caller UI
    return raw, {k: v for k, v in rec.items() if k != "hash"}


def verify(raw):
    """Return the (public) record for a valid, active key, else None. Bumps
    usage counters as a side effect."""
    if not raw or not raw.startswith(PREFIX):
        return None
    h = _hash(raw)
    keys = _load()
    for rec in keys:
        if rec.get("active") and hmac.compare_digest(rec.get("hash", ""), h):
            rec["last_used"] = _now()
            rec["calls"] = int(rec.get("calls", 0)) + 1
            _save(keys)
            return {k: v for k, v in rec.items() if k != "hash"}
    return None


def revoke(key_id):
    keys = _load()
    hit = False
    for rec in keys:
        if rec.get("id") == key_id:
            rec["active"] = False
            hit = True
    _save(keys)
    return hit


def list_keys():
    """Public view (no hashes) of all issued keys."""
    return [{k: v for k, v in rec.items() if k != "hash"} for rec in _load()]
