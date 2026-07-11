#!/usr/bin/env bash
# Instant rollback to the PREVIOUS deploy on this VM.
#
# Every deploy snapshots the live code to /opt/quanthunt.prev before overwriting
# it (see .github/workflows/deploy.yml). This restores that snapshot and restarts
# the service — use it when the newest deploy misbehaves.
#
#   bash /opt/quanthunt/deploy/rollback.sh
#
# To roll back to a SPECIFIC older version instead, re-run the "Deploy to VM"
# GitHub Action with the ref input set to a tag/sha (e.g. v1.0.0).
set -euo pipefail

APP=/opt/quanthunt
PREV="$APP.prev"

if [ ! -d "$PREV" ]; then
  echo "No previous release snapshot at $PREV — nothing to roll back to."
  echo "Use the GitHub 'Deploy to VM' workflow with a ref (tag/sha) instead."
  exit 1
fi

echo "==> Restoring previous release from $PREV ..."
rsync -a --delete --exclude venv --exclude .env \
  --exclude fund_cache.json --exclude __pycache__ \
  "$PREV"/ "$APP"/

echo "==> Reinstalling deps + restarting service ..."
"$APP/venv/bin/pip" install -q -r "$APP/requirements.txt" gunicorn || true
sudo systemctl restart quanthunt

sleep 2
if curl -fsS http://127.0.0.1/ping >/dev/null; then
  echo "Rollback complete — app is up ($(curl -s http://127.0.0.1/version))."
else
  echo "WARNING: app did not respond after rollback. Check: journalctl -u quanthunt -n 50"
  exit 1
fi
