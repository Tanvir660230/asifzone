#!/usr/bin/env bash
# Nightly backup — database + uploaded images — run on the VPS host (not inside a container) via cron:
#   0 2 * * * /path/to/docker/backup.sh >> /var/log/clothing-brand-backup.log 2>&1
#
# Optional off-server copy: set RCLONE_REMOTE (e.g. "b2:my-bucket/backups") after configuring
# `rclone config` once on the VPS — a local-only backup doesn't protect against losing the VPS itself.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/clothing-brand}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
COMPOSE_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/docker-compose.yml"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
DB_FILE="$BACKUP_DIR/clothing_brand-$TIMESTAMP.sql.gz"
UPLOADS_FILE="$BACKUP_DIR/uploads-$TIMESTAMP.tar.gz"

mkdir -p "$BACKUP_DIR"

# 1. Database dump
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U postgres clothing_brand | gzip > "$DB_FILE"

# 2. Uploaded product/category/banner images — a separate Docker volume, not covered by the DB dump.
# Tarred from inside the already-running api container (which mounts it) rather than by guessing
# Compose's auto-generated volume name, which changes if the project directory is ever renamed.
docker compose -f "$COMPOSE_FILE" exec -T api \
  tar czf - -C /repo/apps/api/uploads . > "$UPLOADS_FILE"

# 3. Prune local copies past retention
find "$BACKUP_DIR" -name "clothing_brand-*.sql.gz" -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime "+$RETENTION_DAYS" -delete

# 4. Off-server copy (skipped automatically until RCLONE_REMOTE is set up)
if [ -n "${RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null 2>&1; then
  rclone copy "$DB_FILE" "$RCLONE_REMOTE" --quiet
  rclone copy "$UPLOADS_FILE" "$RCLONE_REMOTE" --quiet
  echo "Copied to off-server remote: $RCLONE_REMOTE"
else
  echo "RCLONE_REMOTE not set — backups are local-only on this VPS. See comment at top of this script."
fi

echo "Backup written: $DB_FILE and $UPLOADS_FILE"
