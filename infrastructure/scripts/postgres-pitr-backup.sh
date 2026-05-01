#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_DIR:=/var/lib/postgresql/data/backups}"
: "${WAL_ARCHIVE_DIR:=/var/lib/postgresql/data/backups/wal}"
: "${WAL_RECEIVER_SLOT:=medfinance_backup}"
: "${WAL_RECEIVER_RUN_SECONDS:=30}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_DIR="$BACKUP_DIR/base"
mkdir -p "$BASE_DIR" "$WAL_ARCHIVE_DIR"

if [[ ! -w "$BACKUP_DIR" || ! -w "$WAL_ARCHIVE_DIR" ]]; then
  echo "Backup directories are not writable. Ensure BACKUP_DIR and WAL_ARCHIVE_DIR are mounted persistent volumes." >&2
  exit 1
fi

BACKUP_TARGET_DIR="$BASE_DIR/${PGDATABASE}_${TS}"
BACKUP_FILE="$BASE_DIR/${PGDATABASE}_${TS}.dump"
MANIFEST_FILE="$BASE_DIR/${PGDATABASE}_${TS}.manifest"

pg_basebackup --pgdata="$BACKUP_TARGET_DIR" --format=plain --checkpoint=fast
pg_dump --format=custom --file="$BACKUP_FILE" "$PGDATABASE"

if command -v pg_receivewal >/dev/null 2>&1; then
  timeout "$WAL_RECEIVER_RUN_SECONDS" pg_receivewal \
    --directory="$WAL_ARCHIVE_DIR" \
    --slot="$WAL_RECEIVER_SLOT" \
    --create-slot \
    --if-not-exists \
    --no-loop \
    --verbose || true
  WAL_CAPTURE_MODE="pg_receivewal"
else
  WAL_CAPTURE_MODE="external_archive_command_required"
fi

chmod 700 "$BACKUP_TARGET_DIR"
chmod 600 "$BACKUP_FILE"

cat > "$MANIFEST_FILE" <<MANIFEST
backup_timestamp_utc=$TS
database=$PGDATABASE
host=$PGHOST
port=$PGPORT
basebackup_dir=$BACKUP_TARGET_DIR
dump_file=$BACKUP_FILE
wal_archive_dir=$WAL_ARCHIVE_DIR
wal_capture_mode=$WAL_CAPTURE_MODE
notes=For true PITR continuity, keep PostgreSQL archive_mode=on with archive_command writing to WAL_ARCHIVE_DIR or run pg_receivewal continuously.
MANIFEST

chmod 600 "$MANIFEST_FILE"

echo "PITR backup completed: $MANIFEST_FILE"
