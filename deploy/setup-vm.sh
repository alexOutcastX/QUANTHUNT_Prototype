#!/usr/bin/env bash
# One-time VM setup for QuantHunt — LIVE-BACKEND hosting model.
#
# Mirrors TaurEye's server setup (native nginx on a system /opt path, SELinux-
# aware, dnf/apt dual support), but because QuantHunt fetches data on demand it
# runs a resident gunicorn service and nginx REVERSE-PROXIES to it — instead of
# serving a precomputed static bundle.
#
# Run ON the VM as the deploy user (opc on Oracle Linux, ubuntu on Ubuntu), from
# a checkout of the repo:
#   git clone https://github.com/alexOutcastX/QUANTHUNT_Prototype.git
#   cd QUANTHUNT_Prototype && bash deploy/setup-vm.sh
#
# The app lives in /opt/quanthunt (a system path) — NOT /home — because Oracle
# Linux runs SELinux enforcing and denies services that execute out of user home
# dirs (user_home_t).
set -euo pipefail

USER_NAME="$(whoami)"
APP=/opt/quanthunt
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

echo "==> Creating $APP (owned by $USER_NAME)..."
sudo mkdir -p "$APP"
sudo chown -R "$USER_NAME:$USER_NAME" "$APP"

echo "==> Installing packages (nginx, python, rsync, git, curl)..."
if command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y nginx python3 python3-pip rsync git curl
  FW=firewalld
elif command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y nginx python3 python3-venv python3-pip rsync git curl
  FW=ufw
else
  echo "Unsupported OS (need dnf or apt)"; exit 1
fi

echo "==> Syncing app code into $APP..."
rsync -a --delete \
  --exclude venv --exclude .git --exclude node_modules --exclude '__pycache__' \
  "$REPO_ROOT/" "$APP/"

echo "==> Python venv + deps (incl. gunicorn)... (installs tvDatafeed from GitHub)"
python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install --upgrade pip
"$APP/venv/bin/pip" install -r "$APP/requirements.txt" gunicorn

echo "==> systemd service (gunicorn on 127.0.0.1:5000)..."
sudo cp "$HERE/quanthunt.service" /etc/systemd/system/quanthunt.service
sudo sed -i "s/__DEPLOY_USER__/$USER_NAME/" /etc/systemd/system/quanthunt.service
sudo systemctl daemon-reload
sudo systemctl enable quanthunt

echo "==> nginx reverse-proxy site..."
sudo cp "$HERE/nginx-quanthunt.conf" /etc/nginx/conf.d/quanthunt.conf
# Oracle's stock nginx.conf ships a default :80 server — neutralise it so our
# default_server wins (ignore if it isn't present).
sudo sed -i 's/^\(\s*listen\s*80\s*default_server;\)/#\1/' /etc/nginx/nginx.conf 2>/dev/null || true
# If you are REPLACING TaurEye on this same VM, drop its old site so ours is the
# only default server:
sudo rm -f /etc/nginx/conf.d/taureye.conf 2>/dev/null || true

echo "==> SELinux: allow nginx to proxy to the local gunicorn socket..."
# On Oracle Linux (SELinux enforcing) nginx cannot open a network connection to
# a backend unless this boolean is set — otherwise every request 502s. No-op on
# Ubuntu (no SELinux).
sudo setsebool -P httpd_can_network_connect 1 2>/dev/null || true

echo "==> Opening ports 80/443..."
if [ "$FW" = firewalld ]; then
  sudo firewall-cmd --permanent --add-service=http  || true
  sudo firewall-cmd --permanent --add-service=https || true
  sudo firewall-cmd --reload || true
else
  sudo ufw allow 80/tcp  || true
  sudo ufw allow 443/tcp || true
fi
# Ubuntu images also block via iptables even with ufw inactive; open there too.
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT 2>/dev/null || true
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
command -v netfilter-persistent >/dev/null 2>&1 && sudo netfilter-persistent save || true

echo "==> Starting services..."
sudo systemctl restart quanthunt
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl restart nginx

echo ""
echo "Done. QuantHunt is live behind nginx on port 80."
echo "  Local check:  curl -s http://localhost/ping"
echo "  Service logs: journalctl -u quanthunt -f"
echo ""
echo "REMEMBER: open ports 80/443 in the Oracle VCN Security List (cloud firewall) too."
