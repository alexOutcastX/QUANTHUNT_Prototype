"""Daily bonus, streaks and the credit price list.

Two things live here that the wallet deliberately does not know about:

  1. WHAT things cost. wallet.py is a ledger — it moves integers and enforces
     idempotency. Deciding that a dossier costs 25 credits is product policy,
     and putting it here keeps the ledger free of pricing.

  2. The daily bonus, which is keyed on the INDIAN TRADING DAY rather than a
     rolling 24 hours. A streak that breaks because you opened the app at 11pm
     on Friday and 9am on Monday is the single most common complaint about
     streak systems, and it is entirely avoidable: weekends and exchange
     holidays are not missed days, because the market was shut.

Everything is deterministic. No wheel, no random multiplier — a financial
product borrowing casino mechanics invites regulatory attention nobody wants.
"""
import datetime as _dt
import os

import wallet as _wallet

# ── prices ──────────────────────────────────────────────────────────────────
# Metered because each one costs real compute or real money, and because a
# heavy user wants far more of them than a light one. Looking at a price, a
# chart, the news or your own watchlist is never metered: that is the habit,
# and charging for it would kill everything downstream.
PRICES = {
    "dossier": int(os.environ.get("PRICE_DOSSIER", "25")),
    "backtest": int(os.environ.get("PRICE_BACKTEST", "10")),
    "export": int(os.environ.get("PRICE_EXPORT", "10")),
    "extra_alert": int(os.environ.get("PRICE_EXTRA_ALERT", "5")),
    # Deliberately absent: "ai_explain" and "deep_scan".
    #
    # The plan priced both, and neither maps to anything a user actually does.
    # There is no AI feature — Chat is trader-to-trader. And the screener does
    # not have a "scan the universe" button: it sweeps incrementally as you
    # page, so charging per scan would charge for scrolling.
    #
    # The screener's cost is real but continuous, which is what ALLOWANCES are
    # for — see usage.py. Pricing something nobody can buy puts a lie in the
    # wallet's "What credits buy" list.
}

PRICE_LABELS = {
    "dossier": "Full company dossier",
    "backtest": "Backtest run",
    "export": "Export to CSV or Excel",
    "extra_alert": "Price alert beyond the free five",
}

# Which plan feature each priced action belongs to.
#
# This is the line credits may not cross. Credits meter how MUCH of a feature
# you use; the plan decides WHETHER you may use it at all. An account whose
# plan does not carry the feature cannot buy its way in with credits at any
# price — see server.wallet_spend, which refuses rather than charging.
#
# Without this map the wallet was a second, cheaper paywall running beside the
# real one: a free account with a few daily bonuses could open the backtest,
# which is the one thing the ladder exists to sell.
ACTION_FEATURE = {
    "dossier": "dossier",
    "backtest": "backtest",
    "export": "exports",
    "extra_alert": "alerts",
}


def feature_for(action: str) -> str:
    """The plan feature an action needs, or "" when it needs none."""
    return ACTION_FEATURE.get((action or "").strip(), "")

# ── earning ─────────────────────────────────────────────────────────────────
DAILY_CREDITS = int(os.environ.get("DAILY_BONUS_CREDITS", "5"))
STREAK_BONUS = {3: 15, 7: 50, 30: 300}
REPAIRS_PER_MONTH = 1

# NSE trading holidays. Kept short and overridable rather than pulling the whole
# calendar in: a wrong holiday costs someone a streak, so the failure mode of an
# incomplete list (a holiday counted as a missed day) is handled by the repair
# below rather than by pretending this is authoritative.
_HOLIDAYS = {h.strip() for h in os.environ.get("NSE_HOLIDAYS", "").split(",") if h.strip()}


def _today(now: _dt.date = None) -> _dt.date:
    return now or _dt.datetime.utcnow().date()


def is_trading_day(d: _dt.date) -> bool:
    """Weekday and not a listed holiday. Saturday and Sunday are not misses."""
    if d.weekday() >= 5:
        return False
    return d.isoformat() not in _HOLIDAYS


def previous_trading_day(d: _dt.date) -> _dt.date:
    p = d - _dt.timedelta(days=1)
    # Bounded: a fortnight of consecutive non-trading days cannot happen, and an
    # unbounded loop on a bad holiday list would hang the request.
    for _ in range(14):
        if is_trading_day(p):
            return p
        p -= _dt.timedelta(days=1)
    return p


def _ref(acct: str, day: _dt.date) -> str:
    return f"daily:{acct}:{day.isoformat()}"


def _claimed_days(acct: str) -> set:
    """Every day this account has claimed, as a set of ISO dates.

    Read ONCE per call. The first version asked the ledger "was day X claimed?"
    separately for each day it walked, which meant one full history query per
    step — 180 queries and 70ms to compute a single streak, repeated on every
    wallet load and every header poll. The whole answer is in one read.
    """
    prefix = f"daily:{acct}:"
    return {r["ref"][len(prefix):] for r in _wallet.history(acct, limit=1000)
            if r.get("ref", "").startswith(prefix)}


def _claimed_on(acct: str, day: _dt.date, claimed: set = None) -> bool:
    days = _claimed_days(acct) if claimed is None else claimed
    return day.isoformat() in days


def streak(acct: str, now: _dt.date = None, claimed: set = None) -> int:
    """Consecutive trading days claimed, counting back from the last claim."""
    days = _claimed_days(acct) if claimed is None else claimed
    day = _today(now)
    if not is_trading_day(day):
        day = previous_trading_day(day)
    if day.isoformat() not in days:
        day = previous_trading_day(day)
        if day.isoformat() not in days:
            return 0
    n = 0
    # Bounded by the ledger page rather than a magic number: you cannot have a
    # longer streak than there are claim rows.
    for _ in range(len(days) + 1):
        if day.isoformat() not in days:
            break
        n += 1
        day = previous_trading_day(day)
    return n


def status(acct: str, now: _dt.date = None) -> dict:
    day = _today(now)
    trading = is_trading_day(day)
    claim_day = day if trading else previous_trading_day(day)
    days = _claimed_days(acct)
    claimed = claim_day.isoformat() in days
    n = streak(acct, now, claimed=days)
    nxt = next((k for k in sorted(STREAK_BONUS) if k > n), None)
    return {
        "claimable": not claimed,
        "claimed_today": claimed,
        "trading_day": trading,
        "day": claim_day.isoformat(),
        "streak": n,
        "credits": DAILY_CREDITS,
        "next_milestone": nxt,
        "next_milestone_bonus": STREAK_BONUS.get(nxt) if nxt else None,
        "milestones": STREAK_BONUS,
    }


def claim_daily(acct: str, now: _dt.date = None) -> dict:
    """Claim today's bonus. Idempotent: a second call the same day pays nothing.

    Claimable on a non-trading day too — it settles against the most recent
    trading day, so someone who only opens the app at weekends still keeps a
    streak. Refusing would punish exactly the casual user this is meant to build
    a habit in.
    """
    acct = (acct or "").strip().lower()
    if not acct:
        return {"ok": False, "error": "no-account"}
    day = _today(now)
    if not is_trading_day(day):
        day = previous_trading_day(day)
    if _claimed_on(acct, day):
        return {"ok": False, "error": "already-claimed", **status(acct, now)}

    paid = _wallet.grant(acct, DAILY_CREDITS, "Daily bonus", ref=_ref(acct, day))
    if not paid:
        return {"ok": False, "error": "already-claimed", **status(acct, now)}

    n = streak(acct, now)
    bonus = STREAK_BONUS.get(n, 0)
    if bonus:
        _wallet.grant(acct, bonus, f"{n}-day streak", ref=f"streak:{acct}:{n}")
    out = status(acct, now)
    out.update({"ok": True, "awarded": DAILY_CREDITS, "streak_bonus": bonus,
                "balance": _wallet.balance(acct)})
    return out


def price(action: str) -> int:
    return PRICES.get(action, 0)


def price_list() -> list:
    return [{"action": k, "label": PRICE_LABELS.get(k, k), "credits": v}
            for k, v in PRICES.items()]


def earn_list(acct: str, now: _dt.date = None, st: dict = None) -> list:
    """Ways to earn, with what is available right now — the wallet's 'what next'.

    Accepts a status dict so a caller that already has one (the /wallet/earn
    route does) does not pay for a second ledger read.
    """
    st = st or status(acct, now)
    import referrals as _ref_mod
    return [
        {"key": "daily", "label": "Daily bonus", "credits": DAILY_CREDITS,
         "available": st["claimable"],
         # The copy has to follow the state, not just the streak: telling
         # someone to "claim to keep the streak" on a day they have already
         # claimed reads as a task they have failed to do.
         "detail": ("Claimed today — back tomorrow" if not st["claimable"]
                    else f"Day {st['streak']} — claim to keep the streak"
                    if st["streak"] else "Opens your streak")},
        {"key": "streak", "label": "Streak milestone", "credits": st["next_milestone_bonus"] or 0,
         "available": False,
         "detail": (f"{st['next_milestone'] - st['streak']} more day(s) to "
                    f"{st['next_milestone']}") if st["next_milestone"] else "All reached"},
        {"key": "referral", "label": "Refer a friend", "credits": _ref_mod.REFERRER_REWARD,
         "available": True, "detail": "They get credits too"},
    ]
