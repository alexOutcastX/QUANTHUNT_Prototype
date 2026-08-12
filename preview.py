# Preview gate — which hostnames may see unreleased features.
#
# taureye.com and 161.118.174.177 are the SAME server: one nginx, one gunicorn,
# one database. There is no second box to stage on. So "live on the IP, not yet
# on the domain" has to be decided per request, from the Host header, rather
# than by deploying different code to different machines.
#
# Default: bare IP literals preview, named domains do not. Deploying this
# branch therefore leaves taureye.com looking exactly as it does today while
# every new surface is reachable at http://161.118.174.177.
#
# Overrides (server .env):
#   PREVIEW_HOSTS=host1,host2   also treat these hostnames as preview
#   PREVIEW_ALL=1               everything previews (use to go live)
#   PREVIEW_OFF=1               nothing previews (kill switch, wins over all)

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
    h = _bare(host)
    if h in ("localhost", "localhost.localdomain"):
        return "local development host"
    if h in _hosts():
        return "listed in PREVIEW_HOSTS"
    if is_ip(h):
        return "bare IP address — preview host"
    return "named domain — preview features are hidden here"
