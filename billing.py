# Subscriptions and the paywall.
#
# members.PLAN_FEATURES already decides what each plan unlocks; this adds the
# commercial layer on top — price, credit allowance, and which plan an account
# is actually on right now.
#
# The account's plan comes from the member table (its `plan` field) unless an
# active subscription row overrides it. That ordering matters: it means the
# owner accounts keep working exactly as they do today with no subscription
# rows at all, and a subscription is purely additive.
#
# No payment provider is connected. start_checkout records a PENDING intent and
# reports which provider would handle it and whether that provider is
# configured; nothing charges anyone. activate() is the seam a real webhook
# calls once money moves — it is written and tested so the provider swap is a
# credentials change, not a redesign.

import os
import sqlite3
import threading
import time

import members as _members
import wallet as _wallet
from store import DB_PATH

# Price in paise (integer — never float money). Credits are granted per period.
PLANS = {
    "free": {
        "name": "Free", "price_paise": 0, "period": "forever",
        "credits_per_period": 0,
        "blurb": "Quotes, heatmap, news and the stock universe.",
    },
    "pro": {
        "name": "Pro", "price_paise": 149900, "period": "month",
        "credits_per_period": 500,
        "blurb": "Screeners, patterns, recommendations, watchlist and portfolio.",
    },
    "max": {
        "name": "Max", "price_paise": 499900, "period": "month",
        "credits_per_period": 2000,
        "blurb": "Everything: the terminal and its backtests, dossiers, alerts and exports.",
    },
}
PLAN_ORDER = _members.PLAN_LADDER

_PERIOD_SECONDS = {"month": 30 * 24 * 3600, "year": 365 * 24 * 3600}

_lock = threading.Lock()
_conn = None


def _db():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS subscriptions (
                acct       TEXT PRIMARY KEY,
                plan       TEXT NOT NULL,
                status     TEXT NOT NULL,       -- active | pending | cancelled
                provider   TEXT,
                ref        TEXT,
                started_at INTEGER,
                renews_at  INTEGER
            );
            CREATE TABLE IF NOT EXISTS billing_intents (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                acct     TEXT NOT NULL,
                plan     TEXT NOT NULL,
                provider TEXT NOT NULL,
                status   TEXT NOT NULL,
                ts       INTEGER NOT NULL
            );
            """
        )
        _conn.commit()
    return _conn


def _norm(acct: str) -> str:
    return (acct or "").strip().lower()


def _plan_key(plan: str) -> str:
    """A plan name from anywhere — a request, a webhook, an old row — or raise.

    Legacy names resolve; unknown ones are refused rather than quietly treated
    as free, because the caller here is about to take money for one.
    """
    key = (plan or "").strip().lower()
    key = _members.LEGACY_PLANS.get(key, key)
    if key not in PLANS:
        raise ValueError(f"unknown plan {plan!r}")
    return key


def provider() -> str:
    """Which payment provider would take the money."""
    return (os.environ.get("PAYMENT_PROVIDER") or "razorpay").strip().lower()


def provider_configured() -> bool:
    p = provider()
    if p == "razorpay":
        return bool(os.environ.get("RAZORPAY_KEY_ID") and
                    os.environ.get("RAZORPAY_KEY_SECRET"))
    if p == "stripe":
        return bool(os.environ.get("STRIPE_SECRET_KEY"))
    return False


def plans() -> list:
    out = []
    for key in PLAN_ORDER:
        p = dict(PLANS[key])
        p["key"] = key
        p["features"] = _members.features_for(key)
        p["price_inr"] = p["price_paise"] / 100.0
        out.append(p)
    return out


def _row(acct: str):
    with _lock:
        return _db().execute("SELECT * FROM subscriptions WHERE acct = ?",
                             (_norm(acct),)).fetchone()


def subscription(acct: str, member_plan: str = "") -> dict:
    """The account's live subscription state.

    An expired row is reported as such rather than deleted, so the history of
    what someone used to be on is not silently erased.
    """
    row = _row(acct)
    base = _members.canonical_plan(member_plan)
    if not row:
        return {"plan": base, "status": "none", "source": "member-table",
                "provider": None, "renews_at": None, "expired": False}

    expired = bool(row["renews_at"]) and row["renews_at"] < time.time()
    active = row["status"] == "active" and not expired
    # The member table wins when it grants MORE than the subscription — that is
    # how the owner accounts stay on the top plan without a billing row.
    plan = _members.canonical_plan(row["plan"]) if active else base
    if PLAN_ORDER.index(base) > PLAN_ORDER.index(plan):
        plan = base
    return {
        "plan": plan,
        "status": "expired" if expired else row["status"],
        "source": "subscription" if active else "member-table",
        "provider": row["provider"],
        "renews_at": row["renews_at"],
        "expired": expired,
    }


def effective_plan(acct: str, member_plan: str = "") -> str:
    return subscription(acct, member_plan)["plan"]


def features(acct: str, member_plan: str = "") -> list:
    return _members.features_for(effective_plan(acct, member_plan))


def allows(acct: str, feature: str, member_plan: str = "") -> bool:
    return feature in features(acct, member_plan)


def required_plan(feature: str) -> str:
    """Cheapest plan that unlocks `feature` — what the paywall should offer."""
    for key in PLAN_ORDER:
        if feature in _members.features_for(key):
            return key
    return PLAN_ORDER[-1]


def start_checkout(acct: str, plan: str) -> dict:
    """Record the intent to subscribe. Charges nothing.

    Returns everything the client needs to show an honest state, including
    whether a provider is actually connected — so the UI can say "payments are
    not connected yet" instead of failing at the payment sheet.
    """
    acct = _norm(acct)
    plan = _plan_key(plan)
    if plan == "free":
        raise ValueError("the free plan needs no checkout")

    with _lock:
        conn = _db()
        cur = conn.execute(
            "INSERT INTO billing_intents (acct, plan, provider, status, ts)"
            " VALUES (?,?,?,?,?)",
            (acct, plan, provider(), "pending", int(time.time())))
        conn.commit()
        intent_id = cur.lastrowid

    return {
        "intent_id": intent_id,
        "acct": acct,
        "plan": plan,
        "amount_paise": PLANS[plan]["price_paise"],
        "amount_inr": PLANS[plan]["price_paise"] / 100.0,
        "provider": provider(),
        "provider_configured": provider_configured(),
        "status": "pending",
        "checkout_url": None,
        "message": ("Payments are not connected yet — this records your interest "
                    "and unlocks nothing."),
    }


def activate(acct: str, plan: str, provider_name: str = "manual",
             ref: str = None, period: str = None) -> dict:
    """Put an account on a plan. The seam a payment webhook calls.

    Also grants the plan's credit allowance, keyed on `ref` so a webhook
    delivered twice does not hand out two months of credits.
    """
    acct = _norm(acct)
    plan = _plan_key(plan)
    now = int(time.time())
    length = _PERIOD_SECONDS.get(period or PLANS[plan]["period"], _PERIOD_SECONDS["month"])
    renews = now + length

    with _lock:
        conn = _db()
        conn.execute(
            "INSERT INTO subscriptions (acct, plan, status, provider, ref, started_at, renews_at)"
            " VALUES (?,?,?,?,?,?,?)"
            " ON CONFLICT(acct) DO UPDATE SET plan=excluded.plan, status=excluded.status,"
            " provider=excluded.provider, ref=excluded.ref, renews_at=excluded.renews_at",
            (acct, plan, "active", provider_name, ref, now, renews))
        conn.commit()

    allowance = PLANS[plan]["credits_per_period"]
    if allowance:
        _wallet.grant(acct, allowance, f"{PLANS[plan]['name']} plan credits",
                      ref=f"plan:{ref or acct + ':' + str(renews)}")
    return subscription(acct)


def cancel(acct: str) -> dict:
    with _lock:
        conn = _db()
        conn.execute("UPDATE subscriptions SET status = 'cancelled' WHERE acct = ?",
                     (_norm(acct),))
        conn.commit()
    return subscription(acct)


def _reset_for_tests():
    with _lock:
        conn = _db()
        conn.execute("DELETE FROM subscriptions")
        conn.execute("DELETE FROM billing_intents")
        conn.commit()
