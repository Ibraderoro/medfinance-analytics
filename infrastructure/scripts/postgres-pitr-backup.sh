#!/usr/bin/env bash
set -euo pipefail

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${BACKUP_DIR:=/var/backups/postgres}"
: "${WAL_ARCHIVE_DIR:=/var/backups/postgres/wal}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE_DIR="$BACKUP_DIR/base"
mkdir -p "$BASE_DIR" "$WAL_ARCHIVE_DIR"

BACKUP_FILE="$BASE_DIR/${PGDATABASE}_${TS}.dump"
MANIFEST_FILE="$BASE_DIR/${PGDATABASE}_${TS}.manifest"

pg_basebackup --pgdata="$BASE_DIR/${PGDATABASE}_${TS}" --format=tar --gzip --wal-method=stream --checkpoint=fast
pg_dump --format=custom --file="$BACKUP_FILE" "$PGDATABASE"

cat > "$MANIFEST_FILE" <<MANIFEST
backup_timestamp_utc=$TS
database=$PGDATABASE
host=$PGHOST
port=$PGPORT
basebackup_dir=${BASE_DIR}/${PGDATABASE}_${TS}
dump_file=$BACKUP_FILE
wal_archive_dir=$WAL_ARCHIVE_DIR
MANIFEST

echo "PITR backup completed: $MANIFEST_FILE"
