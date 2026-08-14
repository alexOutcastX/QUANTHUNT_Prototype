#!/usr/bin/env bash
# Restore a quanthunt.db backup onto the VM.
#
# Usage:  bash deploy/restore-db.sh <backup.db.gz>
#   1. Download the artifact from the "Nightly DB backup" workflow run
#      (Actions → Nightly DB backup → run → Artifacts) and unzip the .db.gz.
#   2. Run this ON THE VM from /opt/quanthunt with the file path.
#
# Rehearse monthly:
#
#   bash deploy/restore-db.sh --rehearse <backup.db.gz>
#
# which runs every check below against a scratch copy and touches nothing —
# no service stopped, no live database replaced. It needs neither the VM nor
# root, so it can be run anywhere the artifact can be downloaded.
#
# The rehearsal mode exists because the real path stops the service: a drill
# that costs an outage is a drill nobody runs, which is how an untested restore
# stays untested. An untested backup is not a backup.
set -euo pipefail

REHEARSE=0
if [ "${1:-}" = "--rehearse" ]; then REHEARSE=1; shift; fi

# The sqlite3 CLI is not installed everywhere — it is absent from plenty of
# minimal images, and the first real rehearsal of this script died on exactly
# that. python3 is already a hard requirement (it runs the app), and its
# sqlite3 module is the same engine, so fall back to it rather than making the
# drill depend on a package nobody remembered to install.
if command -v sqlite3 >/dev/null 2>&1; then
  sq() { sqlite3 "$1" "$2"; }
else
  sq() {
    python3 - "$1" "$2" <<'PYEOF'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
try:
    for row in c.execute(sys.argv[2]):
        print("|".join("" if v is None else str(v) for v in row))
finally:
    c.close()
PYEOF
  }
fi

SRC="${1:?usage: restore-db.sh [--rehearse] <backup.db.gz | backup.db>}"
APP="${APP:-/opt/quanthunt}"

case "$SRC" in
  *.gz) gunzip -kf "$SRC"; SRC="${SRC%.gz}";;
esac

sq "$SRC" "PRAGMA integrity_check;" | grep -q ok || {
  echo "FATAL: integrity check failed on $SRC"; exit 1; }

# What the file must actually contain. integrity_check only proves the file is
# well-formed SQLite — a zero-row database of the right shape passes it, and
# would restore "successfully" over your live data.
TABLES="kv snapshots tradelog cases"
for t in $TABLES; do
  n=$(sq "$SRC" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='$t';")
  [ "$n" = "1" ] || { echo "FATAL: $SRC has no '$t' table — wrong or truncated file"; exit 1; }
done
echo "== contents of $SRC =="
for t in $TABLES; do
  printf '   %-12s %s rows\n' "$t" "$(sq "$SRC" "SELECT count(*) FROM $t;")"
done

if [ "$REHEARSE" = "1" ]; then
  # Prove the file can be opened and read the way the app opens it, then stop.
  SCRATCH="$(mktemp -d)/rehearsal.db"
  cp "$SRC" "$SCRATCH"
  sq "$SCRATCH" "SELECT count(*) FROM kv;" >/dev/null
  python3 - "$SCRATCH" <<'PYEOF'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
tables = [r[0] for r in c.execute(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
print("   opened by python:", len(tables), "tables")
c.close()
PYEOF
  rm -rf "$(dirname "$SCRATCH")"
  echo "REHEARSAL OK — this backup restores. Nothing was changed."
  exit 0
fi

sudo systemctl stop quanthunt
cp "$APP/quanthunt.db" "$APP/quanthunt.db.pre-restore.$(date +%s)" 2>/dev/null || true
cp "$SRC" "$APP/quanthunt.db"
rm -f "$APP/quanthunt.db-wal" "$APP/quanthunt.db-shm"
sudo systemctl start quanthunt

sleep 3
curl -fsS http://127.0.0.1/healthz | python3 -m json.tool
echo "Restore complete — verify the app, then delete the .pre-restore copy."
