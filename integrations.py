# External services — one registry of every seam, and whether it is connected.
#
# Everything here is a PLACEHOLDER by request: the code paths, env var names
# and readiness reporting exist so that connecting a service later is filling
# in credentials rather than writing a feature. Nothing calls out to any of
# these providers yet.
#
# The registry is also the honest answer to "is Google sign-in working?" —
# /integrations reports configured true/false per service from the environment,
# so the UI can grey a button out instead of failing at the provider.
#
# Secrets are NEVER returned. Only the names of the variables and whether each
# one is set — a status page that leaks the key it is reporting on is worse
# than no status page.

import os

# name -> (label, [env vars], what it would do, docs)
REGISTRY = {
    "google_oauth": {
        "label": "Google Sign-In",
        "env": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "purpose": "One-tap sign-in and signup without a password.",
        "docs": "https://console.cloud.google.com/apis/credentials",
        # Google rejects bare IPs and plain http as OAuth origins, so this
        # cannot be switched on from the preview host — it needs the domain.
        "requires_https_domain": True,
    },
    "supabase": {
        "label": "Supabase",
        "env": ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_KEY"],
        "purpose": "Hosted Postgres + auth, if the SQLite store is outgrown.",
        "docs": "https://supabase.com/dashboard",
        "requires_https_domain": False,
    },
    "razorpay": {
        "label": "Razorpay",
        "env": ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"],
        "purpose": "Subscription payments and UPI top-ups (India).",
        "docs": "https://dashboard.razorpay.com/app/keys",
        "requires_https_domain": True,
    },
    "stripe": {
        "label": "Stripe",
        "env": ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
        "purpose": "Subscription payments (international).",
        "docs": "https://dashboard.stripe.com/apikeys",
        "requires_https_domain": True,
    },
    "smtp": {
        "label": "Email (SMTP)",
        "env": ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"],
        "purpose": "OTP sign-in codes, receipts and referral invites.",
        "docs": "",
        "requires_https_domain": False,
    },
}


def _set(name: str) -> bool:
    return bool((os.environ.get(name) or "").strip())


def status(name: str) -> dict:
    spec = REGISTRY[name]
    present = [v for v in spec["env"] if _set(v)]
    missing = [v for v in spec["env"] if not _set(v)]
    return {
        "key": name,
        "label": spec["label"],
        "purpose": spec["purpose"],
        "docs": spec["docs"],
        "requires_https_domain": spec["requires_https_domain"],
        "configured": not missing,
        # Names only — never values.
        "env": spec["env"],
        "env_present": present,
        "env_missing": missing,
    }


def all_status() -> list:
    return [status(k) for k in REGISTRY]


def configured(name: str) -> bool:
    return name in REGISTRY and not status(name)["env_missing"]


def google_signin_config(host: str = "") -> dict:
    """What the client needs to decide whether to show the Google button.

    Returns the PUBLIC client id only when configured — that value is designed
    to be public. The secret never leaves the server.
    """
    ready = configured("google_oauth")
    return {
        "enabled": ready,
        "client_id": (os.environ.get("GOOGLE_CLIENT_ID") or "") if ready else "",
        "reason": ("" if ready else
                   "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the server. "
                   "Google will not accept a bare IP or plain http as an origin, "
                   "so add https://taureye.com as the authorised origin."),
    }


def supabase_config() -> dict:
    """Client-safe Supabase settings. The service key is server-only and is
    deliberately not included — it bypasses row-level security."""
    ready = bool(_set("SUPABASE_URL") and _set("SUPABASE_ANON_KEY"))
    return {
        "enabled": ready,
        "url": (os.environ.get("SUPABASE_URL") or "") if ready else "",
        "anon_key": (os.environ.get("SUPABASE_ANON_KEY") or "") if ready else "",
        "reason": "" if ready else "Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.",
    }
