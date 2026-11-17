#!/bin/bash
# Restores a Music SP backup.
#   scripts/restore.sh db <backup.dump.enc> <postgres URL of an EMPTY target database>
#   scripts/restore.sh library <backup dir>/library <target STORAGE_ROOT>
# After both: start the app; renditions and thumbnails missing on disk are rebuilt with
#   tsx scripts/rebuild-derived.ts
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    case "$k" in BACKUP_PASSPHRASE_FILE) v="${v%\"}"; v="${v#\"}"; [ -n "${!k:-}" ] || export "$k=$v" ;; esac
  done < .env
fi
export PATH="/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH"
case "${1:-}" in
  db)
    file="${2:?backup file}"; target="${3:?target database URL}"
    : "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE missing}"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$file" | pg_restore --no-owner --no-privileges --exit-on-error -d "$target"
    echo "database restored from $file" ;;
  library)
    src="${2:?library backup directory}"; dest="${3:?target STORAGE_ROOT}"
    mkdir -p "$dest"; chmod 700 "$dest"
    rsync -a "$src/" "$dest/"
    echo "library restored into $dest" ;;
  *) sed -n 2,6p "$0"; exit 2 ;;
esac
