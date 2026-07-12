# Owner authentication — a single-owner passcode gate for the self-hosted app.
#
# Purpose: the app serves mostly public market data openly, but a few
# capabilities (broker holdings/quotes, and later per-user state) must only be
# reachable by the instance owner. This provides a minimal, dependency-free
# signed-cookie session: set APP_PASSWORD in /opt/quanthunt/.env, log in once,
# and a signed cookie authorises owner-only endpoints.
#
# Design notes:
#   - HMAC-SHA256 signed cookie (stdlib only) — no JWT/library dependency.
#   - Constant-time comparisons for password and signature.
#   - APP_SECRET signs cookies; if unset it's derived from APP_PASSWORD so
#     sessions survive restarts but rotate when the password changes.
#   - If APP_PASSWORD is NOT set, the instance is "open": owner-only endpoints
#     are DISABLED entirely (you cannot connect a broker on an unauthenticated
#     instance) rather than left publicly reachable.

import base64
import hashlib
import hmac
import json
import os
import time

COOKIE = "te_owner"
TTL = int(os.environ.get("AUTH_TTL_SEC", str(7 * 24 * 3600)))  # 7-day session


def _password():
    return os.environ.get("APP_PASSWORD", "").strip()


def configured():
    """True when an owner password is set (owner features are usable)."""
    return bool(_password())


def _secret():
    s = os.environ.get("APP_SECRET", "").strip()
    if s:
        return s.encode()
    # Derive from the password so cookies stay valid across restarts and
    # invalidate automatically if the password is rotated.
    return hashlib.sha256(("te-secret::" + _password()).encode()).digest()


def _sign(payload: bytes) -> str:
    body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
    sig = hmac.new(_secret(), body.encode(), hashlib.sha256).hexdigest()
    return body + "." + sig


def _verify(token: str):
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


def check_password(candidate: str) -> bool:
    pw = _password()
    if not pw:
        return False
    return hmac.compare_digest((candidate or "").encode(), pw.encode())


def make_cookie() -> str:
    payload = json.dumps({"o": 1, "exp": int(time.time()) + TTL}).encode()
    return _sign(payload)


def is_owner(cookie_value: str) -> bool:
    if not configured():
        return False
    return _verify(cookie_value) is not None
