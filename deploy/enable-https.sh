#!/usr/bin/env bash
# One-time HTTPS setup for the TaurEye VM.
#
# Prereqs: an A record for every name pointing at this VM's public IP, and
# ports 80 + 443 open in both the Oracle security list and the OS firewall.
#
# Usage:  sudo bash deploy/enable-https.sh <domain> <email> [extra-name ...]
#   sudo bash deploy/enable-https.sh taureye.com you@email.com
#
# `www.<domain>` is added automatically when it resolves. certbot fails the
# WHOLE issuance if any one requested name does not validate, so names without
# a DNS record are dropped with a warning rather than taking the cert down with
# them.
#
# Safe to re-run: server_name is rewritten from whatever it currently holds, so
# adding a name later is just another run with the same arguments.
set -euo pipefail

DOMAIN="${1:?usage: enable-https.sh <domain> <email> [extra-name ...]}"
EMAIL="${2:?usage: enable-https.sh <domain> <email> [extra-name ...]}"
shift 2

# Overridable so the logic below can be exercised against a fixture instead of
# a live /etc/nginx (see tests/test_cookie_domain.py).
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
CONF="${NGINX_CONF:-$NGINX_DIR/conf.d/quanthunt.conf}"
[ -f "$CONF" ] || { echo "FAIL: $CONF not found — run deploy/setup-vm.sh first"; exit 1; }

# ── which names go on the certificate ────────────────────────────────────────
NAMES=("$DOMAIN")
for n in "www.$DOMAIN" "$@"; do
  case " ${NAMES[*]} " in *" $n "*) continue ;; esac
  if getent hosts "$n" >/dev/null 2>&1; then
    NAMES+=("$n")
  else
    echo "skip: $n has no DNS record yet (add an A record and re-run to include it)"
  fi
done
echo "==> Certificate names: ${NAMES[*]}"

# ── refuse to run while another site still claims the domain ─────────────────
# The app's block is `listen 80 default_server; server_name _;`, so it only
# catches hostnames NO other block claims. A leftover server block for the old
# site wins the match and keeps serving that domain — which is exactly how a
# retired site goes on answering a domain that was supposed to have moved.
# certbot would then also install the cert into the wrong block.
CONFLICT=""
for n in "${NAMES[@]}"; do
  esc="${n//./\\.}"
  hits="$(grep -rlE "server_name[^;]*(^|[[:space:]])${esc}([[:space:]]|;)" \
            "$NGINX_DIR/conf.d" "$NGINX_DIR/sites-enabled" 2>/dev/null \
          | grep -vx "$CONF" || true)"
  [ -n "$hits" ] && CONFLICT="$CONFLICT$(printf '\n  %s -> %s' "$n" "$(echo "$hits" | tr '\n' ' ')")"
done
if [ -n "$CONFLICT" ]; then
  echo "FAIL: another nginx server block already claims these names:$CONFLICT"
  echo "  Those blocks serve the domain instead of this app. Disable or delete"
  echo "  them (mv the file out of conf.d / sites-enabled, then 'nginx -t'),"
  echo "  and re-run. Set FORCE=1 to proceed anyway."
  [ "${FORCE:-}" = "1" ] || exit 1
  echo "  FORCE=1 set — continuing."
fi

# ── point the app's block at the real hostnames so certbot can match them ────
# Rewrites every server_name in the file (there are two once certbot has added
# the 443 block) rather than matching the pristine `server_name _;`, so this is
# idempotent across reruns.
sudo sed -i -E "s/^([[:space:]]*)server_name[[:space:]]+[^;]*;/\1server_name ${NAMES[*]};/" "$CONF"
sudo nginx -t && sudo systemctl reload nginx

# ── issue the certificate (auto-configures nginx + renewal) ──────────────────
if ! command -v certbot >/dev/null 2>&1; then
  if command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y -q certbot python3-certbot-nginx
  else
    sudo apt-get update -qq && sudo apt-get install -y -qq certbot python3-certbot-nginx
  fi
fi

CERTBOT_ARGS=()
for n in "${NAMES[@]}"; do CERTBOT_ARGS+=(-d "$n"); done
sudo certbot --nginx "${CERTBOT_ARGS[@]}" -m "${EMAIL}" --agree-tos --no-eff-email --redirect

sudo nginx -t && sudo systemctl reload nginx
echo
echo "HTTPS enabled: https://${DOMAIN}"
echo "Renewal is automatic (systemd timer). Next steps:"
if [ "${#NAMES[@]}" -gt 1 ]; then
  echo "  - Both apex and www now serve the app. Set SESSION_COOKIE_DOMAIN=.${DOMAIN}"
  echo "    in /opt/quanthunt/.env so a login on one host is valid on the other,"
  echo "    then: sudo systemctl restart quanthunt"
fi
echo "  - Native/mobile builds: set EXPO_PUBLIC_API_BASE=https://${DOMAIN}"
echo "    (GitHub -> Settings -> Variables -> TAUREYE_API_BASE)"
echo "  - Verify: curl -sS https://${DOMAIN}/ping"
