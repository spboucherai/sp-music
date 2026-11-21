#!/bin/bash
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : Music SP
# File             : scripts/backup.sh
# Module           : scripts
# Repository       : https://git.spboucher.ai/sp-music
# Project Website  : https://music.spboucher.ai
# Created          : 2026-11-17
# Last Modified    : 2026-11-17
#
# Author           : Simon-Pierre Boucher
# Position         : Professor of Finance
# Institution      : Université du Québec en Outaouais (UQO)
# Organization     : SP Boucher
# Website          : https://spboucher.ai
# Git              : https://git.spboucher.ai
#
# Preferred Contact: support@spboucher.ai
# Technical Contact: dev@spboucher.ai
# Security/Admin   : admin@spboucher.ai
#
# Copyright (c) 2026
# Simon-Pierre Boucher
# All rights reserved where applicable. This file is governed by the
# applicable project license, copyright notices and relevant law.
# Existing third-party rights and notices remain unaffected.
#
# License          : None specified (no license file in this repository)
#
# Do not embed credentials, private keys, access tokens,
# certificates or confidential personal information.
#
# =============================================================================
# END OF SP BOUCHER SOURCE HEADER
# =============================================================================

# Music SP backup. Run daily (PM2 cron). Two separate parts:
#   1. database  — pg_dump (custom format) | AES-256 (openssl, PBKDF2) → $BACKUP_DIR/db/sp-music-YYYYmmdd-HHMMSS.dump.enc (30 days kept)
#   2. library   — mirror of the originals and cover art → $BACKUP_DIR/library ; files removed from the library are
#                  moved to $BACKUP_DIR/trash/<date> and purged after BACKUP_TRASH_DAYS (default 30).
#      Renditions and thumbnails are derived data and are not backed up (they are rebuilt from the originals).
# Restore: scripts/restore.sh — see docs/OPERATIONS.md
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  while IFS='=' read -r k v; do
    case "$k" in DATABASE_URL|BACKUP_DIR|BACKUP_PASSPHRASE_FILE|STORAGE_ROOT|BACKUP_TRASH_DAYS)
      v="${v%\"}"; v="${v#\"}"; [ -n "${!k:-}" ] || export "$k=$v" ;;
    esac
  done < .env
fi
: "${DATABASE_URL:?DATABASE_URL missing}"; : "${BACKUP_DIR:?BACKUP_DIR missing}"; : "${BACKUP_PASSPHRASE_FILE:?BACKUP_PASSPHRASE_FILE missing}"; : "${STORAGE_ROOT:?STORAGE_ROOT missing}"
export PATH="/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH"
[ -s "$BACKUP_PASSPHRASE_FILE" ] || { echo "passphrase file missing or empty" >&2; exit 1; }
umask 077
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/library" "$BACKUP_DIR/trash"; chmod 700 "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"

out="$BACKUP_DIR/db/sp-music-$stamp.dump.enc"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$BACKUP_PASSPHRASE_FILE" -out "$out.tmp"
mv "$out.tmp" "$out"
# The archive must decrypt and be readable by pg_restore, otherwise the run fails loudly.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$BACKUP_PASSPHRASE_FILE" -in "$out" | pg_restore --list >/dev/null
/usr/bin/find "$BACKUP_DIR/db" -name 'sp-music-*.dump.enc' -mtime +30 -delete

for part in originals art; do
  [ -d "$STORAGE_ROOT/$part" ] || continue
  mkdir -p "$BACKUP_DIR/library/$part"
  rsync -a --delete --backup --backup-dir="$BACKUP_DIR/trash/$stamp/$part" --exclude='*.part' "$STORAGE_ROOT/$part/" "$BACKUP_DIR/library/$part/"
done
/usr/bin/find "$BACKUP_DIR/trash" -mindepth 1 -maxdepth 1 -type d -mtime +"${BACKUP_TRASH_DAYS:-30}" -exec rm -rf {} +
rmdir "$BACKUP_DIR/trash/$stamp" 2>/dev/null || true

files=$(/usr/bin/find "$BACKUP_DIR/library/originals" -type f 2>/dev/null | wc -l | tr -d ' ')
bytes=$(du -sk "$BACKUP_DIR/library" | cut -f1)
printf '{"at":"%s","database":true,"library":true,"files":%s,"bytes":%s}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$files" "$((bytes * 1024))" > "$BACKUP_DIR/last-backup.json.tmp"
mv "$BACKUP_DIR/last-backup.json.tmp" "$BACKUP_DIR/last-backup.json"
echo "backup ok: $out ($(du -h "$out" | cut -f1)), library mirror: $files originals"
