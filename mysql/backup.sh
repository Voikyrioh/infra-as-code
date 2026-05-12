#!/bin/sh
set -e

DATE=$(date +%Y%m%d_%H%M)
BACKUP_FILE="/backups/mysql_${DATE}.sql"

echo "[$(date)] Starting MySQL backup..."
mysqldump \
  -h shared_mysql \
  -u root \
  -p"${MYSQL_ROOT_PASSWORD}" \
  --all-databases \
  --single-transaction \
  --routines \
  --triggers \
  > "$BACKUP_FILE"

echo "[$(date)] Backup written to $BACKUP_FILE ($(du -sh "$BACKUP_FILE" | cut -f1))"

find /backups -name "*.sql" -mtime +7 -delete
echo "[$(date)] Old backups cleaned up. Current backups:"
ls -lh /backups/
