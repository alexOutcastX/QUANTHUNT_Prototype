#!/usr/bin/env bash
# Nightly backup of TaurEye's runtime state (caches + .env) on the VM.
# Keeps the last 7 archives in /opt/backups.
#
# Install:  sudo crontab -e   and add:
#   15 2 * * * /opt/quanthunt/deploy/backup.sh >/dev/null 2>&1
set -euo pipefail

APP=/opt/quanthunt
DEST=/opt/backups
mkdir -p "$DEST"

STAMP=$(date +%Y%m%d-%H%M)
tar -czf "$DEST/taureye-$STAMP.tgz" -C "$APP" \
  --ignore-failed-read \
  .env fund_cache.json index_cache.json graph_cache.json 2>/dev/null || true

# Retention: keep the 7 newest.
ls -1t "$DEST"/taureye-*.tgz 2>/dev/null | tail -n +8 | xargs -r rm -f
echo "backup written: $DEST/taureye-$STAMP.tgz"
