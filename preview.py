# Preview gate — which hostnames may see unreleased features.
#
# taureye.com and 161.118.174.177 are the SAME server: one nginx, one gunicorn,
# one database. There is no second box to stage on. So "live on the IP, not yet
# on the domain" has to be decided per request, from the Host header, rather
# than by deploying different code to different machines.
#
# Default: EVERY host sees everything. The gate was built to hold the
# monetisation surface — wallet, credits, referrals, plans, gifting — back to
# the bare IP while it was unfinished, so taureye.com kept looking as it did.
# It is finished, and a feature that answers 401 on the IP and 404 on the
# domain is not staged, it is hidden from the people it was built for.
#
# The machinery stays, because it is the only staging this single-box setup
# has: set PREVIEW_OFF=1 to put everything behind the gate again, in one env
# var and a restart, without a deploy.
#
# Overrides (server .env):
#   PREVIEW_OFF=1               hide preview features from every host
#                               (kill switch, wins over everything)
#   PREVIEW_IPONLY=1            the old default: bare IPs and localhost only
#   PREVIEW_HOSTS=host1,host2   also treat these hostnames as preview, which
#                               only means anything alongside PREVIEW_IPONLY
#   PREVIEW_ALL=1               redundant now, and still honoured

import ipaddress
import os


def _hosts() -> set:
    raw = os.environ.get("PREVIEW_HOSTS", "")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def _bare(host: str) -> str:
    """Hostname without port. IPv6 literals arrive bracketed ([::1]:5000)."""
    h = (host or "").strip().lower()
    if h.startswith("["):
        return h[1:h.index("]")] if "]" in h else h[1:]
    return h.rsplit(":", 1)[0] if ":" in h else h


def is_ip(host: str) -> bool:
    """Accepts a raw Host header or an already-stripped hostname.

    Both, because _bare() is not idempotent for IPv6: it turns "[::1]:5000"
    into "::1" correctly, but a second pass splits that on its last colon and
    leaves ":". Trying the value as-is first makes double-stripping harmless.
    """
    for candidate in (host, _bare(host)):
        try:
            ipaddress.ip_address(candidate)
            return True
        except ValueError:
            continue
    return False


def enabled(host: str) -> bool:
    """True when this Host may see preview features."""
    if os.environ.get("PREVIEW_OFF") == "1":
        return False
    if os.environ.get("PREVIEW_ALL") == "1":
        return True
    if os.environ.get("PREVIEW_IPONLY") != "1":
        return True
    h = _bare(host)
    if not h:
        return False
    # localhost covers `npm start` and the e2e fixture, so development is never
    # accidentally staring at the shipped-only build.
    if h in ("localhost", "localhost.localdomain"):
        return True
    return h in _hosts() or is_ip(h)


def reason(host: str) -> str:
    """Human-readable explanation, for the status endpoint."""
    if os.environ.get("PREVIEW_OFF") == "1":
        return "disabled by PREVIEW_OFF"
    if os.environ.get("PREVIEW_ALL") == "1":
        return "enabled for every host by PREVIEW_ALL"
    if os.environ.get("PREVIEW_IPONLY") != "1":
        return "enabled for every host (the default)"
    h = _bare(host)
    if h in ("localhost", "localhost.localdomain"):
        return "local development host"
    if h in _hosts():
        return "listed in PREVIEW_HOSTS"
    if is_ip(h):
        return "bare IP address — preview host"
    return "named domain — preview features are hidden here"
