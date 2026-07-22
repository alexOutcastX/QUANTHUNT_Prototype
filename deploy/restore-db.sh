#!/usr/bin/env bash
# Restore a quanthunt.db backup onto the VM.
#
# Usage:  bash deploy/restore-db.sh <backup.db.gz>
#   1. Download the artifact from the "Nightly DB backup" workflow run
#      (Actions → Nightly DB backup → run → Artifacts) and unzip the .db.gz.
#   2. Run this ON THE VM from /opt/quanthunt with the file path.
#
# Rehearse monthly: restore into a scratch path and open it with sqlite3 to
# verify tables — an untested backup is not a backup.
set -euo pipefail

SRC="${1:?usage: restore-db.sh <backup.db.gz | backup.db>}"
APP=/opt/quanthunt

case "$SRC" in
  *.gz) gunzip -kf "$SRC"; SRC="${SRC%.gz}";;
esac

sqlite3 "$SRC" "PRAGMA integrity_check;" | grep -q ok || {
  echo "FATAL: integrity check failed on $SRC"; exit 1; }

sudo systemctl stop quanthunt
cp "$APP/quanthunt.db" "$APP/quanthunt.db.pre-restore.$(date +%s)" 2>/dev/null || true
cp "$SRC" "$APP/quanthunt.db"
rm -f "$APP/quanthunt.db-wal" "$APP/quanthunt.db-shm"
sudo systemctl start quanthunt

sleep 3
curl -fsS http://127.0.0.1/healthz | python3 -m json.tool
echo "Restore complete — verify the app, then delete the .pre-restore copy."
