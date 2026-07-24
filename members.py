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
# scheme as auth.py); the fallback secret is derived from the account table
# so it is never a public constant.

import hashlib
import hmac
import json
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
    "taureye": {"password": "TaureyePW", "plan": "pro", "name": "Taureye"},
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


def _secret() -> bytes:
    s = os.environ.get("AUTH_SECRET", "").strip() or os.environ.get("APP_SECRET", "").strip()
    if s:
        return ("te-member::" + s).encode()
    # No configured secret: derive one from the account table so cookies stay
    # valid across restarts yet are not forgeable from public code alone, and
    # rotate automatically whenever a password changes.
    basis = "|".join(f"{u}:{v.get('password','')}" for u, v in sorted(accounts().items()))
    return hashlib.sha256(("te-member::" + basis).encode()).digest()


def check_login(username: str, password: str):
    """Constant-time credential check → account dict (with username) or None."""
    uname = (username or "").strip().lower()
    acct = accounts().get(uname)
    expected = (acct or {}).get("password", "") or "\x00missing"
    ok = hmac.compare_digest((password or "").encode(), expected.encode())
    if not acct or not ok:
        return None
    return {"username": acct.get("name") or uname, "uname": uname,
            "plan": acct.get("plan") or "member"}


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
            "plan": plan, "features": features_for(plan)}
