"""Push-notification delivery (Firebase Cloud Messaging) + device-token store.

Everything here is import-safe and inert until Firebase credentials are supplied,
so the whole system can be built and shipped now and "switched on" later by
dropping in the creds (mirrors the existing ALERT_WEBHOOK / APP_PASSWORD env
pattern). With no creds configured, sends are no-ops that just log.

Wiring:
  • device tokens live in the kv store under "push_tokens"
  • broadcasts are appended to the snapshots table (kind="broadcast") for history
  • send() delivers to FCM via the HTTP v1 API (service account) when
    FCM_SERVICE_ACCOUNT is set, else the legacy server-key API when
    FCM_SERVER_KEY is set, else no-op.

Credentials (set on the server, out of band):
  FCM_SERVICE_ACCOUNT  path to (or inline JSON of) a Firebase service-account key
                       → FCM HTTP v1 (preferred; needs `google-auth` installed)
  FCM_SERVER_KEY       legacy FCM server key → legacy HTTP API (no extra deps)
"""
import json
import logging
import os
import threading
import time

import store as _store

log = logging.getLogger("quanthunt.push")

_TOKENS_KEY = "push_tokens"
_lock = threading.Lock()

# Cache the HTTP v1 access token (they last ~1h).
_tok_cache = {"access": None, "exp": 0.0}


# ── device-token registry ────────────────────────────────────────────────────
def tokens() -> list:
    """List of registered device tokens (strings)."""
    raw = _store.kv_get(_TOKENS_KEY, []) or []
    return [t.get("token") for t in raw if isinstance(t, dict) and t.get("token")]


def _all() -> list:
    return _store.kv_get(_TOKENS_KEY, []) or []


def register(token: str, platform: str = "android", user_id: str = None) -> int:
    """Add/refresh a device token (optionally bound to a chat user_id so DMs can
    target that person's devices). Returns the total registered count."""
    token = (token or "").strip()
    if not token:
        return len(tokens())
    with _lock:
        rows = [t for t in _all() if isinstance(t, dict) and t.get("token") != token]
        rows.append({"token": token, "platform": platform,
                     "user_id": (user_id or "").strip() or None, "ts": int(time.time())})
        rows = rows[-2000:]  # bound
        _store.kv_set(_TOKENS_KEY, rows)
        return len(rows)


def tokens_for_user(user_id: str) -> list:
    """Device tokens bound to a given chat user_id (for DMs)."""
    uid = (user_id or "").strip()
    if not uid:
        return []
    return [t.get("token") for t in _all()
            if isinstance(t, dict) and t.get("token") and t.get("user_id") == uid]


def notify_dm(to_user_id: str, from_handle: str, text: str) -> dict:
    """Push a direct message to the recipient's devices."""
    toks = tokens_for_user(to_user_id)
    if not toks:
        return {"sent": 0, "reason": "recipient has no devices"}
    return send(from_handle or "New message", (text or "")[:140],
                {"kind": "dm", "from": from_handle or ""}, to=toks)


def unregister(token: str) -> int:
    token = (token or "").strip()
    with _lock:
        rows = [t for t in _all() if isinstance(t, dict) and t.get("token") != token]
        _store.kv_set(_TOKENS_KEY, rows)
        return len(rows)


def _drop_tokens(bad: set) -> None:
    """Prune tokens FCM reported as unregistered/invalid."""
    if not bad:
        return
    with _lock:
        rows = [t for t in _all() if isinstance(t, dict) and t.get("token") not in bad]
        _store.kv_set(_TOKENS_KEY, rows)


# ── configuration ────────────────────────────────────────────────────────────
def _service_account() -> dict:
    raw = (os.environ.get("FCM_SERVICE_ACCOUNT") or "").strip()
    if not raw:
        return None
    try:
        if os.path.isfile(raw):
            with open(raw) as f:
                return json.load(f)
        return json.loads(raw)
    except Exception as e:
        log.warning("FCM_SERVICE_ACCOUNT unreadable: %s", e)
        return None


def configured() -> bool:
    return bool(_service_account() or os.environ.get("FCM_SERVER_KEY", "").strip())


def _v1_access_token(sa: dict):
    now = time.time()
    if _tok_cache["access"] and now < _tok_cache["exp"] - 60:
        return _tok_cache["access"]
    # Lazy import so the module stays stdlib-only (CI) until creds are present.
    from google.oauth2 import service_account
    from google.auth.transport.requests import Request

    creds = service_account.Credentials.from_service_account_info(
        sa, scopes=["https://www.googleapis.com/auth/firebase.messaging"])
    creds.refresh(Request())
    _tok_cache["access"] = creds.token
    _tok_cache["exp"] = creds.expiry.timestamp() if creds.expiry else now + 3000
    return creds.token


# ── send ─────────────────────────────────────────────────────────────────────
def send(title: str, body: str, data: dict = None, to: list = None) -> dict:
    """Deliver a notification to `to` tokens (default: all registered). Returns
    {sent, failed, configured}. Never raises."""
    import requests
    targets = to if to is not None else tokens()
    data = {k: str(v) for k, v in (data or {}).items()}
    if not targets:
        return {"sent": 0, "failed": 0, "configured": configured(), "reason": "no tokens"}

    sa = _service_account()
    if sa:
        return _send_v1(requests, sa, targets, title, body, data)
    key = os.environ.get("FCM_SERVER_KEY", "").strip()
    if key:
        return _send_legacy(requests, key, targets, title, body, data)
    log.info("PUSH (not configured) %s — %s → %d tokens", title, body, len(targets))
    return {"sent": 0, "failed": 0, "configured": False, "reason": "no credentials"}


def _send_v1(requests, sa, targets, title, body, data) -> dict:
    try:
        access = _v1_access_token(sa)
    except Exception as e:
        log.warning("FCM v1 auth failed: %s", e)
        return {"sent": 0, "failed": len(targets), "configured": True, "reason": "auth"}
    url = f"https://fcm.googleapis.com/v1/projects/{sa.get('project_id')}/messages:send"
    hdr = {"Authorization": f"Bearer {access}", "Content-Type": "application/json"}
    sent, bad = 0, set()
    for tk in targets:
        msg = {"message": {"token": tk,
                           "notification": {"title": title, "body": body},
                           "data": data,
                           "android": {"priority": "high"}}}
        try:
            r = requests.post(url, headers=hdr, json=msg, timeout=8)
            if r.status_code == 200:
                sent += 1
            elif r.status_code in (404, 400):
                bad.add(tk)  # UNREGISTERED / invalid
        except Exception:
            pass
    _drop_tokens(bad)
    return {"sent": sent, "failed": len(targets) - sent, "configured": True}


def _send_legacy(requests, key, targets, title, body, data) -> dict:
    url = "https://fcm.googleapis.com/fcm/send"
    hdr = {"Authorization": f"key={key}", "Content-Type": "application/json"}
    sent, bad = 0, set()
    # Legacy API accepts up to 1000 registration_ids per call.
    for i in range(0, len(targets), 900):
        chunk = targets[i:i + 900]
        payload = {"registration_ids": chunk,
                   "notification": {"title": title, "body": body},
                   "data": data, "priority": "high"}
        try:
            r = requests.post(url, headers=hdr, json=payload, timeout=8)
            if r.status_code == 200:
                res = r.json()
                sent += res.get("success", 0)
                for tk, item in zip(chunk, res.get("results", [])):
                    if item.get("error") in ("NotRegistered", "InvalidRegistration"):
                        bad.add(tk)
        except Exception:
            pass
    _drop_tokens(bad)
    return {"sent": sent, "failed": len(targets) - sent, "configured": True}


# ── alert + broadcast helpers ────────────────────────────────────────────────
def notify_alert(alert: dict, quote: dict) -> dict:
    """Push a fired price/technical alert to every registered device."""
    sym = alert.get("symbol", "")
    typ = (alert.get("type") or "").replace("_", " ")
    val = alert.get("value")
    last = alert.get("last_value")
    title = f"{sym} alert"
    body = f"{sym}: {typ} {val} (now {last})"
    return send(title, body, {"kind": "alert", "symbol": sym,
                              "type": alert.get("type", ""), "id": alert.get("id", "")})


def broadcast(title: str, body: str, data: dict = None) -> dict:
    """Send a dev/announcement message to all devices and log it to history."""
    res = send(title, body, {**(data or {}), "kind": "broadcast"})
    try:
        _store.snap_put("broadcast", "all",
                        {"title": title, "body": body, "data": data or {},
                         "sent": res.get("sent", 0), "ts": int(time.time())})
    except Exception:
        pass
    return res


def broadcast_log(limit: int = 50) -> list:
    """Recent broadcasts (newest last), for an in-app announcements inbox."""
    try:
        rows = _store.snap_series("broadcast", "all", limit=limit) or []
        return [r.get("data", r) for r in rows]
    except Exception:
        return []
