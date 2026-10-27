#!/usr/bin/env bash
# SIMPLIFY Database Backup Script
# Usage: ./scripts/backup.sh [output_directory]

set -e

BACKUP_DIR="${1:-./backups}"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/simplify_backup_${TIMESTAMP}.dump"

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL environment variable is not set."
  echo "Example: export DATABASE_URL=postgresql://postgres:admin@localhost:5432/simplify_dev"
  exit 1
fi

echo "Starting database backup to: $BACKUP_FILE"
pg_dump -Fc "$DATABASE_URL" > "$BACKUP_FILE"
echo "Backup completed successfully! Size: $(du -h "$BACKUP_FILE" | cut -f1)"

# Retain last 7 days of backups
find "$BACKUP_DIR" -name "simplify_backup_*.dump" -mtime +7 -delete
echo "Old backups (>7 days) pruned."
