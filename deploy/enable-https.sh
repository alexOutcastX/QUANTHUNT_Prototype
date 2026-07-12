#!/usr/bin/env bash
# One-time HTTPS setup for the TaurEye VM.
#
# Prereqs: a domain with an A record pointing at this VM's public IP
# (and ports 80+443 open in the Oracle security list + OS firewall).
#
# Usage:  sudo bash deploy/enable-https.sh taureye.example.com you@email.com
set -euo pipefail

DOMAIN="${1:?usage: enable-https.sh <domain> <email>}"
EMAIL="${2:?usage: enable-https.sh <domain> <email>}"

# Point the server block at the real hostname so certbot can match it.
sudo sed -i "s/server_name _;/server_name ${DOMAIN};/" /etc/nginx/conf.d/quanthunt.conf
sudo nginx -t && sudo systemctl reload nginx

# Install certbot and issue the certificate (auto-configures nginx + renewal).
if ! command -v certbot >/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq certbot python3-certbot-nginx
fi
sudo certbot --nginx -d "${DOMAIN}" -m "${EMAIL}" --agree-tos --no-eff-email --redirect

sudo nginx -t && sudo systemctl reload nginx
echo
echo "HTTPS enabled: https://${DOMAIN}"
echo "Renewal is automatic (systemd timer). Next steps:"
echo "  - Native/mobile builds: set EXPO_PUBLIC_API_BASE=https://${DOMAIN}"
echo "  - Verify: curl -s https://${DOMAIN}/ping"
