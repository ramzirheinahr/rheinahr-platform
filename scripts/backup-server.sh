#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-/home/rheinahr/current}"
STORAGE_DIR="${LOCAL_STORAGE_DIR:-/home/rheinahr/data/storage}"
BACKUP_DIR="${BACKUP_DIR:-/home/rheinahr/backups/daily}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

dump="$BACKUP_DIR/db_backup_${timestamp}.dump"
APP_DIR="$APP_DIR" DUMP_PATH="$dump" python3 - <<'PY'
from pathlib import Path
from urllib.parse import unquote, urlparse
import os
import subprocess

env_file = Path(os.environ["APP_DIR"]) / ".env"
raw = env_file.read_text().splitlines()
url = next((line.split("=", 1)[1].strip('"\'') for line in raw if line.startswith("DIRECT_URL=")), None)
if not url:
    raise SystemExit("DIRECT_URL is missing")
parsed = urlparse(url)
credentials = os.environ.copy()
credentials["PGPASSWORD"] = unquote(parsed.password or "")
subprocess.run([
    "pg_dump", "-h", parsed.hostname or "127.0.0.1",
    "-p", str(parsed.port or 5432), "-U", unquote(parsed.username or "postgres"),
    "-d", parsed.path.lstrip("/"), "-Fc", "-f", os.environ["DUMP_PATH"],
], env=credentials, check=True)
subprocess.run(["pg_restore", "--list", os.environ["DUMP_PATH"]], stdout=subprocess.DEVNULL, check=True)
PY

snapshot="$BACKUP_DIR/storage_${timestamp}"
temporary="$snapshot.incomplete"
mkdir -p "$temporary"
trap 'rm -rf "$temporary"' EXIT
previous="$(find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name 'storage_*' ! -name '*.incomplete' | sort | tail -n 1)"
if [[ -n "$previous" ]]; then
  rsync -a --delete --link-dest="$previous" "$STORAGE_DIR/" "$temporary/"
else
  rsync -a --delete "$STORAGE_DIR/" "$temporary/"
fi
mv "$temporary" "$snapshot"
trap - EXIT

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'db_backup_*.dump' -mtime +14 -delete
find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name 'storage_*' ! -name '*.incomplete' -mtime +14 -prune -exec rm -rf -- {} +
printf 'Backup complete: %s\n' "$timestamp"
