#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <postgres.dump>" >&2
  exit 1
fi

docker exec -i vhb_postgres pg_restore \
  -U vhb -d vhb --clean --if-exists < "$1"
