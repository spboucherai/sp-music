#!/bin/bash
# =============================================================================
#                  SP BOUCHER | INFRASTRUCTURE & AUTOMATION
#             ARTIFICIAL INTELLIGENCE • FINANCE • ENGINEERING
# =============================================================================
#
# Project          : Music SP
# File             : scripts/test.sh
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

# Integration tests: fresh database + storage, real production build, real worker, real ffmpeg.
#   scripts/test.sh            (set SKIP_BUILD=1 to reuse .next)
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/opt/postgresql@17/bin:/opt/homebrew/bin:$PATH"
PORT="${TEST_PORT:-8691}"
ROOT="$(mktemp -d /tmp/sp-music-test.XXXXXX)"
DB="sp_music_test"
export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
export APP_URL="http://localhost:$PORT" TEST_BASE_URL="http://localhost:$PORT"
export APP_SECRET="test-secret-test-secret-test-secret-0123456789"
export OWNER_EMAIL="owner@example.test" OWNER_NAME="Propriétaire Test"
export DATABASE_URL="postgres://127.0.0.1:5432/$DB"
export STORAGE_ROOT="$ROOT/library" SETUP_URL_FILE="$ROOT/setup-url.txt" TEST_FIXTURES="$ROOT/fixtures"
export BACKUP_DIR="$ROOT/backups" BACKUP_PASSPHRASE_FILE="$ROOT/pass"
export UPLOAD_MAX_FILE_MB=50 UPLOAD_MAX_CHUNK_MB=4 ARCHIVE_MAX_TOTAL_MB=30 RENDITIONS=auto TRANSCODE_DSD=false LIBRARY_QUOTA_GB=0
unset WEBAUTHN_RP_ID TMP_DIR || true
# Lyrics tests need a local mlx-whisper virtualenv; without one they are skipped (and say so).
if [ -x "${LYRICS_PYTHON:-$HOME/.venvs/whisper/bin/python}" ]; then export LYRICS=manual LYRICS_PYTHON="${LYRICS_PYTHON:-$HOME/.venvs/whisper/bin/python}"; else export LYRICS=off; unset LYRICS_PYTHON || true; fi
echo "test-passphrase" > "$BACKUP_PASSPHRASE_FILE"

dropdb --if-exists "$DB"; createdb "$DB"
mkdir -p "$TEST_FIXTURES"; F="$TEST_FIXTURES"
ff() { ffmpeg -v error -nostdin -y "$@"; }
# Synthetic audio only (sine waves): no commercial recording is ever part of the repository or the tests.
ff -f lavfi -i "color=c=teal:s=600x600" -frames:v 1 "$F/cover.png"
ff -f lavfi -i "color=c=orange:s=900x700" -frames:v 1 "$F/cover2.jpg"
ff -f lavfi -i "sine=frequency=440:duration=6" -i "$F/cover.png" -map 0:a -map 1:v -c:a flac -c:v mjpeg -disposition:v attached_pic \
   -metadata title="Onde À" -metadata artist="Les Sinusoïdes" -metadata album="Fréquences" -metadata album_artist="Les Sinusoïdes" -metadata track="1/2" -metadata date="2024" -metadata genre="Test" "$F/a.flac"
ff -f lavfi -i "sine=frequency=660:duration=5" -c:a flac -metadata title="Onde B" -metadata artist="Les Sinusoïdes" -metadata album="Fréquences" -metadata album_artist="Les Sinusoïdes" -metadata track="2/2" -metadata date="2024" "$F/b.flac"
ff -f lavfi -i "sine=frequency=330:duration=4" -c:a libmp3lame -b:a 128k -metadata title="Onde MP3" -metadata artist="Autre Artiste" -metadata album="Compressé" "$F/c.mp3"
ff -f lavfi -i "sine=frequency=550:duration=4" -c:a alac -metadata title="Onde ALAC" -metadata artist="Autre Artiste" -metadata album="Sans perte Apple" "$F/d.m4a"
ff -f lavfi -i "sine=frequency=220:duration=3" -c:a pcm_s16le "$F/03 Sans Tags.wav"
ff -f lavfi -i "sine=frequency=880:duration=3" -c:a flac -metadata title="Zip Un" -metadata artist="Archive" -metadata album="Zippé" -metadata track=1 "$F/z1.flac"
ff -f lavfi -i "sine=frequency=990:duration=3" -c:a flac -metadata title="Zip Deux" -metadata artist="Archive" -metadata album="Zippé" -metadata track=2 "$F/z2.flac"
ff -f lavfi -i "sine=frequency=445:duration=6" -c:a flac -metadata title="Onde À" -metadata artist="Les Sinusoïdes" -metadata album="Fréquences" -metadata album_artist="Les Sinusoïdes" -metadata track="1/2" "$F/a-other-encoding.flac"
ff -f lavfi -i "anullsrc=r=44100:cl=stereo" -t 250 -c:a pcm_s16le "$F/silence.wav"
# Spoken fixture (macOS speech synthesis) for the lyrics transcription test.
say -o "$F/speech.aiff" "The quick brown fox jumps over the lazy dog. Music lives on the cluster tonight." 2>/dev/null \
  && ff -i "$F/speech.aiff" -c:a flac -metadata title="Paroles Test" -metadata artist="Synthèse" -metadata album="Voix" "$F/speech.flac" || true
printf 'MZ\x90\x00\x03\x00\x00\x00 this is not audio, it is a program' > "$F/program.flac"
printf 'just some text pretending to be music\n' > "$F/text.mp3"
{ printf 'fLaC'; head -c 4000 /dev/urandom; } > "$F/broken.flac"
python3 -I - "$F" <<'PY'
import sys, zipfile
f = sys.argv[1]
with zipfile.ZipFile(f + "/album.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.write(f + "/z1.flac", "Album/01 un.flac")
    z.write(f + "/z2.flac", "Album/sub/02 deux.flac")
    z.writestr("Album/notes.txt", "not audio")
    z.writestr("__MACOSX/._01 un.flac", "resource fork")
with zipfile.ZipFile(f + "/bomb.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.write(f + "/silence.wav", "silence.wav")
with zipfile.ZipFile(f + "/evil.zip", "w") as z:
    z.write(f + "/z1.flac", "ok.flac")
    z.writestr("../../../evil-escape.flac", open(f + "/z2.flac", "rb").read())   # path traversal attempt
with zipfile.ZipFile(f + "/noaudio.zip", "w") as z:
    z.writestr("readme.txt", "nothing here")
PY

node_modules/.bin/tsx scripts/migrate.ts
node_modules/.bin/tsx scripts/bootstrap.ts
[ "${SKIP_BUILD:-}" = 1 ] && [ -d .next ] || node_modules/.bin/next build >/dev/null

PIDS=()
start() {
  PORT="$PORT" HOST=127.0.0.1 node node_modules/tsx/dist/cli.mjs server.ts > "$ROOT/web.log" 2>&1 & PIDS+=($!)
  node node_modules/tsx/dist/cli.mjs src/worker/index.ts > "$ROOT/worker.log" 2>&1 & PIDS+=($!)
  for _ in $(seq 1 60); do curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "server did not start"; cat "$ROOT/web.log"; return 1
}
stop() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null || true; done; wait 2>/dev/null || true; PIDS=(); }
trap 'stop; echo "logs and data kept in $ROOT"' EXIT

start
node_modules/.bin/vitest run tests/unit.test.ts tests/api.test.ts

echo "── restart: data must survive ──"
stop; start
node_modules/.bin/vitest run tests/restart.test.ts

echo "── backup → restore into a fresh database and storage ──"
bash scripts/backup.sh
dropdb --if-exists "${DB}_restore"; createdb "${DB}_restore"
bash scripts/restore.sh db "$(ls "$BACKUP_DIR"/db/*.dump.enc | tail -1)" "postgres://127.0.0.1:5432/${DB}_restore"
bash scripts/restore.sh library "$BACKUP_DIR/library" "$ROOT/library-restored"
DATABASE_URL="postgres://127.0.0.1:5432/${DB}_restore" STORAGE_ROOT="$ROOT/library-restored" node_modules/.bin/tsx scripts/rebuild-derived.ts
a=$(psql -Atc "select count(*) from tracks" "$DATABASE_URL"); b=$(psql -Atc "select count(*) from tracks" "postgres://127.0.0.1:5432/${DB}_restore")
[ "$a" = "$b" ] && [ "$a" -gt 0 ] && echo "restore ok: $b tracks, originals verified" || { echo "RESTORE MISMATCH $a vs $b"; exit 1; }
dropdb --if-exists "${DB}_restore"
echo "ALL TESTS PASSED"
