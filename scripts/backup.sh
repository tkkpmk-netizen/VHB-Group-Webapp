#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"

docker exec vhb_postgres pg_dump -U vhb -d vhb -Fc \
  > "$BACKUP_DIR/postgres-$STAMP.dump"

docker run --rm \
  --network docker_default \
  --entrypoint /bin/sh \
  -v "$(cd "$BACKUP_DIR" && pwd):/backup" \
  minio/mc:RELEASE.2025-04-16T18-13-26Z \
  sh -c "mc alias set local http://vhb_minio:9000 vhb_minio vhb_minio_secret &&
         mc mirror local/vhb-assets /backup/minio-$STAMP"

find "$BACKUP_DIR" -type f -mtime +7 -delete
echo "Backup completed: $STAMP"
