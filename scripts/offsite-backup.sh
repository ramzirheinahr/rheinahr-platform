#!/usr/bin/env bash
# Nightly offsite backup of both platforms hosted on this server to Cloudflare R2.
#
#   1. Local RheinLand backup (DB dump + storage snapshot) via backup-db.sh.
#      RheinAhr's local backup already runs from cron at 03:00.
#   2. Uploads every local DB dump of both companies that is not yet in R2.
#   3. Uploads new storage files of both companies (documents, photos, contracts).
#   4. Once a week, a full storage archive per company.
#
# Everything in R2 is encrypted client-side (rclone crypt, names included) with
# BACKUP_ENCRYPTION_PASSPHRASE. The bucket has a 30-day Bucket Lock (no delete/
# overwrite) and a 90-day lifecycle rule, so uploads never overwrite objects.
#
# Credentials: ~/.config/backup/r2.env (chmod 600). Restore: see RESTORE-OFFSITE.md.
# Read-only towards the databases and storage directories.
set -euo pipefail
umask 077

HOME_DIR="/home/rheinahr"
SCRIPTS_DIR="$HOME_DIR/scripts"
LOG_DIR="$HOME_DIR/backups/logs"
CREDENTIALS="$HOME_DIR/.config/backup/r2.env"
WEEKLY_ARCHIVE_DAYS=7

# company | app dir | storage dir | local backup dir
COMPANIES=(
  "rheinahr|$HOME_DIR/apps/rheinahr|$HOME_DIR/data/storage|$HOME_DIR/backups/daily"
  "rheinland|$HOME_DIR/apps/rheinland|$HOME_DIR/data/storage_rheinland|$HOME_DIR/backups/daily-rheinland"
)

mkdir -p "$LOG_DIR"
chmod 700 "$LOG_DIR"
exec >>"$LOG_DIR/offsite-backup.log" 2>&1

# One run at a time.
exec 9>"$LOG_DIR/.offsite-backup.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) another run is in progress — skipping"; exit 0; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
trap 'log "FAILED (line $LINENO)"' ERR

set -a
# shellcheck source=/dev/null
. "$CREDENTIALS"
set +a
for var in R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_ENDPOINT R2_BUCKET BACKUP_ENCRYPTION_PASSPHRASE; do
  [[ -n "${!var:-}" && "${!var}" != PASTE_* ]] || { log "missing $var in $CREDENTIALS"; exit 1; }
done

# rclone remotes from the environment only — no secrets in rclone.conf.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true  # token is scoped to one bucket
export RCLONE_CONFIG_R2_NO_HEAD=true          # R2 answers HEAD ?versionId= with 501
export RCLONE_CONFIG_R2C_TYPE=crypt
export RCLONE_CONFIG_R2C_REMOTE="r2:$R2_BUCKET/enc"
export RCLONE_CONFIG_R2C_FILENAME_ENCRYPTION=standard
export RCLONE_CONFIG_R2C_DIRECTORY_NAME_ENCRYPTION=true
RCLONE_CONFIG_R2C_PASSWORD="$(rclone obscure "$BACKUP_ENCRYPTION_PASSPHRASE")"
export RCLONE_CONFIG_R2C_PASSWORD
export RCLONE_CONFIG="/dev/null"
RCLONE=(rclone --retries 3 --low-level-retries 10 --stats-one-line --stats 0 -q)

log "=== offsite backup start"

# 1. Local RheinLand backup (same script and retention as RheinAhr).
APP_DIR="$HOME_DIR/apps/rheinland" \
LOCAL_STORAGE_DIR="$HOME_DIR/data/storage_rheinland" \
BACKUP_DIR="$HOME_DIR/backups/daily-rheinland" \
  "$SCRIPTS_DIR/backup-db.sh"
log "rheinland local backup done"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
for entry in "${COMPANIES[@]}"; do
  IFS="|" read -r company _app_dir storage_dir backup_dir <<<"$entry"

  # 2. DB dumps not yet in R2 (dumps are timestamped, so nothing is overwritten).
  latest="$(find "$backup_dir" -maxdepth 1 -name 'db_backup_*.dump' -mmin -1500 | sort | tail -n 1)"
  [[ -n "$latest" ]] || { log "$company: no dump from the last 25h in $backup_dir"; exit 1; }
  "${RCLONE[@]}" copy --ignore-existing --include 'db_backup_*.dump' "$backup_dir" "r2c:$company/db"
  log "$company: db dumps uploaded (latest $(basename "$latest"))"

  # Read storage from the local snapshot taken next to the dump: it is static
  # (no files changing mid-upload) and consistent with the DB dump.
  snapshot="$(find "$backup_dir" -maxdepth 1 -mindepth 1 -type d -name 'storage_*' ! -name '*.incomplete' | sort | tail -n 1)"
  [[ -n "$snapshot" ]] || { log "$company: no storage snapshot in $backup_dir (live dir: $storage_dir)"; exit 1; }

  # 3. New storage files (existing ones are locked and never rewritten).
  "${RCLONE[@]}" copy --ignore-existing "$snapshot" "r2c:$company/storage-files"
  log "$company: storage files uploaded from $(basename "$snapshot")"

  # 4. Weekly full storage archive, catching files that changed in place.
  if [[ -z "$("${RCLONE[@]}" lsf --max-age "${WEEKLY_ARCHIVE_DAYS}d" "r2c:$company/storage-archive" 2>/dev/null || true)" ]]; then
    # Via a local file, not `rclone rcat`: rcat's post-upload check uses
    # HEAD ?versionId=, which R2 answers with 501 on a locked bucket.
    archive="$backup_dir/.storage_${timestamp}.tar.gz"
    tar -C "$snapshot" -czf "$archive" .
    "${RCLONE[@]}" copyto "$archive" "r2c:$company/storage-archive/storage_${timestamp}.tar.gz" || { rm -f "$archive"; false; }
    rm -f "$archive"
    log "$company: weekly storage archive uploaded"
  fi
done

printf '%s\n' "$timestamp" >"$LOG_DIR/offsite-last-success"
log "=== offsite backup OK"
