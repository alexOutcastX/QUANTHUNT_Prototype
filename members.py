# Membership gate — username/password login that fronts the whole app.
#
# This is the paywall foundation: every visitor must sign in with a member
# account before the app UI loads, and each account carries a PLAN whose
# feature set the client (and, via require_plan, the API) can gate on.
#
# Accounts are a placeholder for now: a hardcoded table with a single
# credential, overridable via MEMBER_ACCOUNTS_JSON (a JSON object of
# username -> {password, plan, name}) until a real billing/membership
# backend replaces it. Sessions are HMAC-signed cookies (stdlib only, same
# scheme as auth.py) keyed on AUTH_SECRET, or, when that is not set, on a
# random key generated once and kept beside the database.

import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import time

COOKIE = "te_member"
TTL = int(os.environ.get("MEMBER_TTL_SEC", str(30 * 24 * 3600)))  # 30-day session

# Plan ladder — every feature the app intends to paywall gets a key here, and
# each plan lists what it unlocks. The placeholder account is on "pro" (all
# access) so nothing is dark while memberships are wired up; real tiers get
# their feature lists trimmed when billing lands.
PLAN_FEATURES = {
    "free": ["quotes", "heatmap", "news", "universe"],
    "member": ["quotes", "heatmap", "news", "universe",
               "screener", "patterns", "recommendations", "watchlist", "portfolio"],
    "pro": ["quotes", "heatmap", "news", "universe",
            "screener", "patterns", "recommendations", "watchlist", "portfolio",
            "backtest", "trade_scan", "terminal", "dossier", "exports", "alerts"],
}

_DEFAULT_ACCOUNTS = {
    # `owner` promotes the member to the instance owner: the broker, alerts and
    # developer-key screens accept this session instead of prompting for a
    # separate passcode, so one sign-in covers the whole app.
    #
    # Keys are lowercase because check_login() lowercases whatever is typed;
    # `name` carries the casing the UI should display back.
    #
    # NOTE: every account here is an owner, so each of these is full control of
    # the instance, not merely a login.
    #
    # These passwords are committed to a PUBLIC repository, which makes them
    # public knowledge — hashing them here would change nothing, since anyone
    # can read the plaintext in git history. They are placeholders and must be
    # replaced before the site is open to strangers: rotate the credential,
    # then set MEMBER_ACCOUNTS_JSON with a hash from `python -m members hash`.
    "taureye":   {"password": "TaureyePW", "plan": "pro", "name": "Taureye",   "owner": True},
    "sreeraman": {"password": "SreeramPW", "plan": "pro", "name": "Sreeraman", "owner": True},
    "sri":       {"password": "STI123",    "plan": "pro", "name": "Sri",       "owner": True},
}


def accounts():
    """The member table: MEMBER_ACCOUNTS_JSON when set, else the placeholder."""
    raw = os.environ.get("MEMBER_ACCOUNTS_JSON", "").strip()
    if raw:
        try:
            data = json.loads(raw)
            if isinstance(data, dict) and data:
                return {str(k).strip().lower(): v for k, v in data.items()
                        if isinstance(v, dict) and v.get("password")}
        except Exception:
            pass
    return _DEFAULT_ACCOUNTS


def _key_path() -> str:
    """Where the generated session key lives when none is configured.

    Beside the database, because that is the one directory already understood
    to hold state the deploy must not delete (deploy.yml excludes it from
    rsync's --delete, and tests/test_deploy_excludes.py pins that).
    """
    p = os.environ.get("SESSION_KEY_PATH", "").strip()
    if p:
        return p
    db = os.environ.get("DB_PATH", "").strip()
    base = os.path.dirname(os.path.abspath(db)) if db else os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "quanthunt.db.session-key")


_GENERATED_KEY = None


def _generated_key() -> bytes:
    """A random key, created once and then read back on every later boot.

    The old fallback hashed the account table, which meant adding a member or
    changing a password silently signed every existing session out — a support
    problem disguised as a security feature. A key on disk keeps sessions valid
    across both restarts and account edits, and is still not derivable from
    public code.

    AUTH_SECRET remains the better answer where you can set one: it survives the
    machine itself, which a file on a single VM does not.
    """
    global _GENERATED_KEY
    if _GENERATED_KEY:
        return _GENERATED_KEY
    path = _key_path()
    try:
        with open(path, "rb") as fh:
            key = fh.read().strip()
        if len(key) >= 32:
            _GENERATED_KEY = key
            return key
    except OSError:
        pass
    key = binascii.hexlify(os.urandom(32))
    try:
        # Exclusive create, then 0600: two workers booting together must not
        # each write a different key, or half the sessions fail to verify.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            os.write(fd, key)
        finally:
            os.close(fd)
    except FileExistsError:
        try:
            with open(path, "rb") as fh:
                key = fh.read().strip() or key
        except OSError:
            pass
    except OSError:
        # Read-only filesystem: fall back to a process-local key. Sessions then
        # last only as long as this process, which is survivable; refusing to
        # start would not be.
        logging.warning("members: could not persist a session key at %s", path)
    _GENERATED_KEY = key
    return key


def _secret() -> bytes:
    s = os.environ.get("AUTH_SECRET", "").strip() or os.environ.get("APP_SECRET", "").strip()
    if s:
        return ("te-member::" + s).encode()
    return hashlib.sha256(b"te-member::" + _generated_key()).digest()


# ── Password storage ────────────────────────────────────────────────────────
# Entries may be either a scrypt hash (`scrypt$N$r$p$salt$hash`, all base64) or
# a bare plaintext string. Plaintext is still accepted because the placeholder
# table below uses it and refusing it would lock the instance out; every
# comparison is constant-time either way.
#
# Hashing does NOT rescue a password that has already been published. Rotate
# the credential first, then store its hash — `python -m members hash` prints
# one ready to paste into MEMBER_ACCOUNTS_JSON.
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P = 2 ** 14, 8, 1


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R,
                        p=_SCRYPT_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        _SCRYPT_N, _SCRYPT_R, _SCRYPT_P,
        base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of a candidate against a stored hash or plaintext.

    Returns False for an empty stored value rather than matching an empty
    password — an account with no credential must not be a way in.
    """
    stored = stored or ""
    if not stored:
        # Still do the work: a missing account must not answer faster than a
        # present one with a wrong password.
        hmac.compare_digest((password or "").encode(), b"\x00missing")
        return False
    if not stored.startswith("scrypt$"):
        return hmac.compare_digest((password or "").encode(), stored.encode())
    try:
        _, n, r, p, salt, dk = stored.split("$", 5)
        want = base64.b64decode(dk)
        got = hashlib.scrypt((password or "").encode(), salt=base64.b64decode(salt),
                             n=int(n), r=int(r), p=int(p), dklen=len(want))
    except Exception:
        logging.warning("members: unreadable password hash, refusing the login")
        return False
    return hmac.compare_digest(got, want)


def check_login(username: str, password: str):
    """Constant-time credential check → account dict (with username) or None."""
    uname = (username or "").strip().lower()
    acct = accounts().get(uname)
    ok = verify_password(password or "", (acct or {}).get("password", ""))
    if not acct or not ok:
        return None
    return {"username": acct.get("name") or uname, "uname": uname,
            "plan": acct.get("plan") or "member",
            "owner": bool(acct.get("owner"))}


def features_for(plan: str):
    return PLAN_FEATURES.get(plan or "", PLAN_FEATURES["free"])


def _sign(payload: bytes) -> str:
    import base64
    body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig


def _verify(token: str):
    import base64
    try:
        body, sig = token.split(".", 1)
    except (ValueError, AttributeError):
        return None
    expect = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expect):
        return None
    try:
        pad = "=" * (-len(body) % 4)
        data = json.loads(base64.urlsafe_b64decode(body + pad))
    except Exception:
        return None
    if data.get("exp", 0) < time.time():
        return None
    return data


def make_cookie(member: dict) -> str:
    payload = json.dumps({"m": member["uname"], "exp": int(time.time()) + TTL}).encode()
    return _sign(payload)


def from_cookie(cookie_value: str):
    """Cookie → live member dict, re-read from the account table so plan
    changes (or a deleted account) take effect on the next request."""
    data = _verify(cookie_value or "")
    if not data or "m" not in data:
        return None
    acct = accounts().get(data["m"])
    if not acct:
        return None
    plan = acct.get("plan") or "member"
    return {"username": acct.get("name") or data["m"], "uname": data["m"],
            "plan": plan, "features": features_for(plan),
            "owner": bool(acct.get("owner"))}


if __name__ == "__main__":                                   # pragma: no cover
    # `python -m members hash` — prints a scrypt hash to paste into
    # MEMBER_ACCOUNTS_JSON, without the password ever reaching a shell history
    # or a process list.
    import getpass
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "hash":
        pw = getpass.getpass("password: ")
        if pw != getpass.getpass("repeat:   "):
            print("they do not match", file=sys.stderr)
            raise SystemExit(1)
        if not pw:
            print("empty password refused", file=sys.stderr)
            raise SystemExit(1)
        print(hash_password(pw))
    else:
        print("usage: python -m members hash", file=sys.stderr)
        raise SystemExit(2)
