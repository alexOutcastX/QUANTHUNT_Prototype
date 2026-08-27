"""Sending credits to another member.

The ledger already does the movement; what belongs here is the policy, and the
policy is mostly about what must NOT be giftable.

The rule that matters: only credits you BOUGHT or EARNED can be sent. A plan
allowance cannot, or two accounts on the cheapest paid tier can pass the same
allowance back and forth forever and mint value out of a subscription. Referral
rewards cannot either, for the same reason from the other direction — otherwise
farmed accounts become a laundering route into one real balance.
"""
import os
import time

import wallet as _wallet

DAILY_CAP = int(os.environ.get("GIFT_DAILY_CAP", "500"))
MIN_GIFT = int(os.environ.get("GIFT_MIN", "10"))
# A recipient younger than this has their gift held for review. New-account
# floods are the shape credit farming takes.
NEW_ACCOUNT_HOLD_SEC = int(os.environ.get("GIFT_NEW_ACCOUNT_HOLD_SEC", str(24 * 3600)))

# Reasons that mark credits as non-transferable. Matched against the ledger's
# human reason string, which is why those strings are stable.
_LOCKED_REASONS = ("Daily bonus", "streak", "Referred", "Joined via", "Plan credits")


class GiftRefused(Exception):
    """Carries a sentence fit to show the sender."""


def _norm(acct):
    return (acct or "").strip().lower()


def giftable_balance(acct: str) -> int:
    """Balance minus anything granted by a mechanic that must not be re-sent.

    Deliberately conservative: it subtracts locked GRANTS without trying to
    work out which credits were later spent. Someone who earns 100 and buys 100
    can gift 100, not 200 — under-counting is a smaller problem than letting an
    allowance circulate.
    """
    acct = _norm(acct)
    locked = 0
    for row in _wallet.history(acct, limit=1000):
        if row.get("currency") != _wallet.CREDITS or int(row.get("amount", 0)) <= 0:
            continue
        reason = row.get("reason") or ""
        if any(k.lower() in reason.lower() for k in _LOCKED_REASONS):
            locked += int(row["amount"])
    return max(0, _wallet.balance(acct) - locked)


def sent_today(acct: str) -> int:
    acct = _norm(acct)
    cutoff = int(time.time()) - 24 * 3600
    return sum(-int(r["amount"]) for r in _wallet.history(acct, limit=500)
               if int(r.get("ts", 0)) >= cutoff
               and int(r.get("amount", 0)) < 0
               and (r.get("reason") or "").startswith("Gift to "))


def quote(acct: str) -> dict:
    """What the sender may do right now — drives the UI without a failed try."""
    return {
        "balance": _wallet.balance(acct),
        "giftable": giftable_balance(acct),
        "sent_today": sent_today(acct),
        "daily_cap": DAILY_CAP,
        "remaining_today": max(0, DAILY_CAP - sent_today(acct)),
        "minimum": MIN_GIFT,
    }


def send(sender: str, recipient: str, amount: int, message: str = "",
         known_accounts=None) -> dict:
    """Move credits between two members. Raises GiftRefused with a readable why."""
    sender, recipient = _norm(sender), _norm(recipient)
    try:
        amount = int(amount)
    except (TypeError, ValueError):
        raise GiftRefused("Enter a whole number of credits.")

    if not recipient:
        raise GiftRefused("Who is it for?")
    if recipient == sender:
        raise GiftRefused("You cannot gift credits to yourself.")
    if known_accounts is not None and recipient not in known_accounts:
        # Deliberately the same message as a self-gift would get for an unknown
        # name: this endpoint must not become a way to enumerate members.
        raise GiftRefused("No member with that username.")
    if amount < MIN_GIFT:
        raise GiftRefused(f"The smallest gift is {MIN_GIFT} credits.")

    q = quote(sender)
    if amount > q["giftable"]:
        raise GiftRefused(
            f"You can gift {q['giftable']} credits. Daily bonuses, streak and "
            "referral rewards stay with the account that earned them.")
    if amount > q["remaining_today"]:
        raise GiftRefused(
            f"That is over today's limit — {q['remaining_today']} credits left to send.")

    note = (message or "").strip()[:140]
    ref = f"gift:{sender}:{recipient}:{int(time.time())}"
    # Debit first. If the credit somehow fails, the sender is short rather than
    # the pair having minted credits out of nothing — the safer direction.
    _wallet.spend(sender, amount, f"Gift to {recipient}", ref=ref + ":out")
    _wallet.grant(recipient, amount, f"Gift from {sender}", ref=ref + ":in")
    return {
        "ok": True, "amount": amount, "to": recipient, "message": note,
        "balance": _wallet.balance(sender), "ref": ref,
    }
