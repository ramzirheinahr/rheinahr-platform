# Restoring from the offsite backup (Cloudflare R2)

Backups are written nightly by `offsite-backup.sh` (cron, 03:30) to the R2 bucket
`rheinahr-server-backups` (EU jurisdiction), encrypted with rclone crypt.

You need:
- the R2 Access Key ID + Secret (Cloudflare dashboard → R2 → API tokens; create a
  new read-only token if the server is gone),
- `BACKUP_ENCRYPTION_PASSPHRASE` (password manager — **without it nothing can be decrypted**),
- `rclone` and PostgreSQL client tools **version 18 or newer** (dumps are made with `pg_dump` 18).

## 1. Configure rclone (any Linux/macOS machine)

```bash
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID='...' RCLONE_CONFIG_R2_SECRET_ACCESS_KEY='...'
export RCLONE_CONFIG_R2_ENDPOINT=https://16f88fd1e35b9c4777e884dcf5734106.eu.r2.cloudflarestorage.com
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true RCLONE_CONFIG_R2_NO_HEAD=true
export RCLONE_CONFIG_R2C_TYPE=crypt RCLONE_CONFIG_R2C_REMOTE=r2:rheinahr-server-backups/enc
export RCLONE_CONFIG_R2C_FILENAME_ENCRYPTION=standard RCLONE_CONFIG_R2C_DIRECTORY_NAME_ENCRYPTION=true
export RCLONE_CONFIG_R2C_PASSWORD="$(rclone obscure 'BACKUP_ENCRYPTION_PASSPHRASE')"
```

On the server itself: `set -a; . ~/.config/backup/r2.env; set +a` and reuse the exports
from `offsite-backup.sh`.

## 2. List what is there (names are shown decrypted)

```bash
rclone lsl r2c:rheinahr/db          # or r2c:rheinland/db
rclone lsl r2c:rheinahr/storage-archive
```

## 3. Restore a database dump

Always restore into a **new, empty** database first and check it before switching the app.

```bash
rclone copy r2c:rheinahr/db/db_backup_YYYYMMDDTHHMMSSZ.dump ./restore/
createdb -h 127.0.0.1 -U postgres restore_check
pg_restore -h 127.0.0.1 -U postgres -d restore_check --no-owner ./restore/db_backup_*.dump
```

Into PostgreSQL 16 (the production server version) pg_restore reports exactly one
error, `unrecognized configuration parameter "transaction_timeout"`, and exits 1. That
is a session setting added by pg_dump 18 and is harmless: the data restores fully
(verified 2026-11-05 — all row counts matched production for both companies).

## 4. Restore files

```bash
# Full weekly archive:
rclone cat r2c:rheinahr/storage-archive/storage_YYYYMMDDTHHMMSSZ.tar.gz | tar -xzf - -C ./restore/storage
# Plus files added after that archive:
rclone copy --ignore-existing r2c:rheinahr/storage-files ./restore/storage
```

Layout in R2 (under `enc/`, encrypted): `<company>/db/`, `<company>/storage-files/`,
`<company>/storage-archive/` for `rheinahr` and `rheinland`. Objects are locked for
30 days (cannot be deleted or overwritten) and expire after 90 days.
