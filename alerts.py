# Server-side price/technical alerts.
#
# An alert is a simple rule over a symbol's live quote. The RULE EVALUATION is
# a pure function (testable offline); persistence is via store.py (SQLite kv),
# and delivery is pluggable — on trigger we stamp the alert and, if an
# ALERT_WEBHOOK is configured, POST it. Push/email need external services
# (FCM / SMTP) and are wired via the same webhook seam rather than baked in.
#
# Rule types (value = threshold):
#   price_above / price_below      → compares quote price
#   pct_above   / pct_below        → compares day % change
#   rsi_above   / rsi_below        → compares RSI (when the quote carries it)

import time
import uuid

import store as _store

KEY = "alerts"
TYPES = {"price_above", "price_below", "pct_above", "pct_below", "rsi_above", "rsi_below"}


def _now():
    return int(time.time())


def _field(rule_type):
    if rule_type.startswith("price"):
        return "price"
    if rule_type.startswith("pct"):
        return "chg"
    return "rsi"


def evaluate(rule, quote) -> bool:
    """True if the alert condition is met by this quote. Pure."""
    t = rule.get("type")
    if t not in TYPES:
        return False
    val = quote.get(_field(t))
    if val is None:
        return False
    try:
        val = float(val)
        thr = float(rule.get("value"))
    except (TypeError, ValueError):
        return False
    if t.endswith("_above"):
        return val >= thr
    if t.endswith("_below"):
        return val <= thr
    return False


def list_alerts():
    return _store.kv_get(KEY, []) or []


def _save(alerts):
    _store.kv_set(KEY, alerts)


def create(symbol, rule_type, value, note=""):
    if rule_type not in TYPES:
        raise ValueError("bad alert type")
    sym = (symbol or "").strip().upper()
    if not sym:
        raise ValueError("symbol required")
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ValueError("numeric value required")
    alert = {
        "id": uuid.uuid4().hex[:12],
        "symbol": sym,
        "type": rule_type,
        "value": value,
        "note": str(note or "")[:200],
        "active": True,
        "created": _now(),
        "triggered_at": None,
        "last_value": None,
    }
    alerts = list_alerts()
    alerts.append(alert)
    _save(alerts)
    return alert


def delete(alert_id):
    alerts = list_alerts()
    kept = [a for a in alerts if a.get("id") != alert_id]
    _save(kept)
    return len(kept) != len(alerts)


def set_active(alert_id, active):
    alerts = list_alerts()
    hit = False
    for a in alerts:
        if a.get("id") == alert_id:
            a["active"] = bool(active)
            if active:                     # re-arming clears the last trigger
                a["triggered_at"] = None
            hit = True
    _save(alerts)
    return hit


def check(quotes, notify=None):
    """Evaluate all active, un-triggered alerts against a {symbol: quote} map.
    Newly-fired alerts are stamped (triggered_at, last_value) and returned. An
    optional `notify(alert, quote)` callback delivers each fire."""
    alerts = list_alerts()
    fired = []
    for a in alerts:
        if not a.get("active") or a.get("triggered_at"):
            continue
        q = quotes.get(a.get("symbol"))
        if not q:
            continue
        if evaluate(a, q):
            a["triggered_at"] = _now()
            a["last_value"] = q.get(_field(a["type"]))
            fired.append(a)
            if notify:
                try:
                    notify(a, q)
                except Exception:
                    pass
    if fired:
        _save(alerts)
    return fired


def symbols_watched():
    """Distinct symbols across active, un-triggered alerts (to fetch quotes)."""
    return sorted({a["symbol"] for a in list_alerts()
                   if a.get("active") and not a.get("triggered_at")})
