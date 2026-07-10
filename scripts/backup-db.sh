#!/usr/bin/env bash
# Dumps the FORGE Freight database to a timestamped, gzip-compressed file.
#
# Usage:
#   ./scripts/backup-db.sh                 # writes to ./backups/
#   BACKUP_DIR=/mnt/backups ./scripts/backup-db.sh
#
# Reads DATABASE_URL from the environment (same variable the API uses).
# Retains the last 14 daily backups; older ones are pruned automatically.
#
# Schedule with cron on the host running Postgres, e.g.:
#   0 3 * * * DATABASE_URL=postgres://... /opt/forge-freight/scripts/backup-db.sh >> /var/log/forge-backup.log 2>&1
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set (postgres://user:pass@host:port/db)}"
BACKUP_DIR="${BACKUP_DIR:-$(dirname "$0")/../backups}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/forge-freight-$timestamp.sql.gz"

echo "Dumping $DATABASE_URL -> $out"
pg_dump "$DATABASE_URL" --format=plain --no-owner --no-privileges | gzip -9 > "$out"
echo "Wrote $(du -h "$out" | cut -f1)"

echo "Pruning backups older than $RETAIN_DAYS days"
find "$BACKUP_DIR" -name 'forge-freight-*.sql.gz' -mtime "+$RETAIN_DAYS" -delete

echo "Done. Restore with: gunzip -c $out | psql \$DATABASE_URL"
