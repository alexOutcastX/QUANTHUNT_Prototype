# BYOB broker connect — Zerodha Kite Connect, READ-ONLY, single user.
#
# The self-hosted owner brings their own Kite Connect app credentials
# (KITE_API_KEY / KITE_API_SECRET in /opt/quanthunt/.env; the app's redirect
# URL must be  http(s)://<your-host>/broker/callback ). TaurEye then supports
# the daily Kite login flow, holdings sync, and broker LTP quotes.
#
# Hard security rules (do not relax):
#   - READ ONLY: only session/token, portfolio/holdings and quote/ltp are
#     ever called. There is no order code and none may be added here.
#   - The API secret never leaves the server; it is never logged or returned.
#   - The daily access token is held in memory and mirrored to a 0600 file so
#     a service restart within the same trading day keeps the session.
#     Kite tokens expire daily (~7:30 IST) regardless.

import hashlib
import json
import os
import stat
import threading
import time

import requests

API_KEY = os.environ.get("KITE_API_KEY", "").strip()
API_SECRET = os.environ.get("KITE_API_SECRET", "").strip()
BASE = "https://api.kite.trade"
TOKEN_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "broker_token.json")
TIMEOUT = 15

_lock = threading.Lock()
_session = {"access_token": None, "user": None, "ts": 0}


def configured() -> bool:
    return bool(API_KEY and API_SECRET)


def _save_token():
    try:
        with open(TOKEN_FILE, "w") as f:
            json.dump(_session, f)
        os.chmod(TOKEN_FILE, stat.S_IRUSR | stat.S_IWUSR)  # 0600
    except Exception:
        pass


def _load_token():
    try:
        with open(TOKEN_FILE) as f:
            data = json.load(f)
        # Kite access tokens die daily; treat anything older than 20h as gone.
        if data.get("access_token") and time.time() - data.get("ts", 0) < 20 * 3600:
            _session.update(data)
    except Exception:
        pass


_load_token()


def connected() -> bool:
    return bool(_session["access_token"])


def status() -> dict:
    return {
        "configured": configured(),
        "connected": connected(),
        "user": _session.get("user"),
        "login_url": ("https://kite.zerodha.com/connect/login?v=3&api_key=" + API_KEY)
        if configured() and not connected() else None,
        "read_only": True,
    }


def complete_login(request_token: str) -> dict:
    """Exchange the post-login request_token for the daily access token."""
    if not configured():
        raise RuntimeError("broker not configured")
    checksum = hashlib.sha256(
        (API_KEY + request_token + API_SECRET).encode()
    ).hexdigest()
    r = requests.post(
        BASE + "/session/token",
        headers={"X-Kite-Version": "3"},
        data={"api_key": API_KEY, "request_token": request_token, "checksum": checksum},
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    d = r.json().get("data") or {}
    if not d.get("access_token"):
        raise RuntimeError("no access token in response")
    with _lock:
        _session["access_token"] = d["access_token"]
        _session["user"] = d.get("user_name") or d.get("user_id")
        _session["ts"] = int(time.time())
        _save_token()
    return {"connected": True, "user": _session["user"]}


def logout():
    with _lock:
        _session.update({"access_token": None, "user": None, "ts": 0})
        try:
            os.remove(TOKEN_FILE)
        except OSError:
            pass


def _auth_headers() -> dict:
    if not connected():
        raise RuntimeError("broker not connected")
    return {
        "X-Kite-Version": "3",
        "Authorization": "token %s:%s" % (API_KEY, _session["access_token"]),
    }


def _get(path: str, params=None) -> dict:
    r = requests.get(BASE + path, headers=_auth_headers(), params=params or {}, timeout=TIMEOUT)
    if r.status_code == 403:  # daily token expired / revoked
        logout()
        raise RuntimeError("broker session expired — log in again")
    r.raise_for_status()
    return r.json().get("data")


def holdings() -> list:
    """Read-only demat holdings, normalised for the Portfolio tab."""
    raw = _get("/portfolio/holdings") or []
    out = []
    for h in raw:
        try:
            out.append({
                "symbol": h.get("tradingsymbol"),
                "exchange": h.get("exchange"),
                "qty": (h.get("quantity") or 0) + (h.get("t1_quantity") or 0),
                "avg_price": h.get("average_price"),
                "ltp": h.get("last_price"),
                "pnl": h.get("pnl"),
            })
        except Exception:
            continue
    return [h for h in out if h["symbol"] and h["qty"]]


def ltp(symbols: list) -> dict:
    """Broker LTP for NSE symbols (the user's own market-data entitlement)."""
    if not symbols:
        return {}
    keys = ["NSE:" + s for s in symbols[:100]]
    raw = _get("/quote/ltp", params={"i": keys}) or {}
    out = {}
    for k, v in raw.items():
        sym = k.split(":", 1)[-1]
        out[sym] = {"price": v.get("last_price")}
    return out
