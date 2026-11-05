#!/usr/bin/env bash
# Server side of scripts/deploy.sh — runs ON the production server (piped over ssh,
# so it always matches the code being deployed). Do not run it by hand.
#
#   server-deploy.sh <release-id> <company> [<company> ...]
#
# Expects ~/releases/<release-id>/src (exact git commit, unpacked by deploy.sh).
# For each company, in order, stopping at the first failure:
#   copy src → build dir · link ~/shared/<company>.env · fresh DB + storage backup ·
#   prisma migrate deploy on that company's DB · build · smoke test on a private
#   port · switch pm2 (auto-rollback if the health check fails) · prune old releases.
#
# Migrations must stay backward compatible (additive): they run before the switch
# while the previous release is still serving, and a rollback keeps the new schema.
set -euo pipefail
umask 022

RELEASE_ID="$1"; shift
HOME_DIR=/home/rheinahr
RELEASE_ROOT="$HOME_DIR/releases/$RELEASE_ID"
KEEP_RELEASES=3

company_config() {
  case "$1" in
    rheinahr)  PM2_NAME=rheinahr-platform;  PORT=3000; SMOKE_PORT=3010; BACKUP_DIR=$HOME_DIR/backups/daily ;;
    rheinland) PM2_NAME=rheinland-platform; PORT=3001; SMOKE_PORT=3011; BACKUP_DIR=$HOME_DIR/backups/daily-rheinland ;;
    *) echo "unknown company: $1" >&2; exit 2 ;;
  esac
}

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

health() { # port, seconds
  for _ in $(seq 1 "$2"); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "127.0.0.1:$1/de/login")" == 200 ]] && return 0
    sleep 1
  done
  return 1
}

stop_port() { # kills whatever listens on 127.0.0.1:<port> (smoke-test server only)
  # `|| true`: grep finds nothing when the port is free, which pipefail + set -e
  # would otherwise turn into a silent exit of the whole deploy.
  local pids; pids="$(ss -tlnpH "sport = :$1" | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null || true
}

pm2_start() { # dir
  PORT="$PORT" pm2 start npm --name "$PM2_NAME" --cwd "$1" -- start >/dev/null
}

[[ -d "$RELEASE_ROOT/src" ]] || { echo "missing $RELEASE_ROOT/src" >&2; exit 1; }

# Dependencies once per release, shared by every company build (copied below).
if [[ ! -d "$RELEASE_ROOT/src/node_modules" ]]; then
  log "installing dependencies"
  cd "$RELEASE_ROOT/src"
  # Server npm (v10) is stricter than the Mac's about lockfile sync; fall back.
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
fi

for COMPANY in "$@"; do
  company_config "$COMPANY"
  DIR="$RELEASE_ROOT/$COMPANY"
  ENV_FILE="$HOME_DIR/shared/$COMPANY.env"
  LINK="$HOME_DIR/apps/$COMPANY"
  [[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 1; }

  log "[$COMPANY] preparing $DIR"
  rm -rf "$DIR"
  cp -a "$RELEASE_ROOT/src" "$DIR"
  ln -s "$ENV_FILE" "$DIR/.env"
  cd "$DIR"

  log "[$COMPANY] backup before migrating"
  STORAGE_DIR="$(grep -E '^LOCAL_STORAGE_DIR=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"'")"
  APP_DIR="$DIR" LOCAL_STORAGE_DIR="$STORAGE_DIR" BACKUP_DIR="$BACKUP_DIR" "$HOME_DIR/scripts/backup-db.sh"

  log "[$COMPANY] prisma migrate deploy"
  npx prisma migrate deploy
  npx prisma generate >/dev/null

  log "[$COMPANY] build"
  NODE_OPTIONS=--max-old-space-size=4096 npm run build

  log "[$COMPANY] smoke test on 127.0.0.1:$SMOKE_PORT"
  stop_port "$SMOKE_PORT"
  (PORT="$SMOKE_PORT" setsid npx next start -H 127.0.0.1 -p "$SMOKE_PORT" >"$DIR/.smoke.log" 2>&1 </dev/null &)
  if ! health "$SMOKE_PORT" 60; then
    stop_port "$SMOKE_PORT"; tail -20 "$DIR/.smoke.log"
    echo "[$COMPANY] smoke test FAILED — live site untouched" >&2; exit 1
  fi
  for path in /en/login /ar/login /de/forgot-password; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "127.0.0.1:$SMOKE_PORT$path")"
    [[ "$code" == 200 ]] || { stop_port "$SMOKE_PORT"; echo "[$COMPANY] $path → $code — live site untouched" >&2; exit 1; }
  done
  stop_port "$SMOKE_PORT"

  log "[$COMPANY] switching pm2 $PM2_NAME → $DIR"
  PREVIOUS="$(pm2 jlist | python3 -c "import json,sys; print(next((p['pm2_env']['pm_cwd'] for p in json.load(sys.stdin) if p['name']=='$PM2_NAME'), ''))")"
  pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
  pm2_start "$DIR"
  if ! health "$PORT" 60; then
    echo "[$COMPANY] health check FAILED — rolling back to $PREVIOUS" >&2
    pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
    [[ -n "$PREVIOUS" ]] && pm2_start "$PREVIOUS" && health "$PORT" 60 && echo "[$COMPANY] rolled back"
    pm2 save >/dev/null; exit 1
  fi
  [[ -n "$PREVIOUS" && "$PREVIOUS" != "$DIR" ]] && ln -sfn "$PREVIOUS" "$LINK.previous"
  ln -sfn "$DIR" "$LINK"
  [[ "$COMPANY" == rheinahr ]] && ln -sfn "$DIR" "$HOME_DIR/current"  # backup-db.sh default
  pm2 save >/dev/null
  log "[$COMPANY] LIVE on $(basename "$RELEASE_ROOT")"
done

# Keep the newest releases plus anything still linked; never touches legacy dirs.
cd "$HOME_DIR/releases"
in_use="$(readlink -f "$HOME_DIR"/apps/* 2>/dev/null | xargs -r -n1 dirname | sort -u)"
ls -1d 20[0-9][0-9][0-9][0-9][0-9][0-9]-* 2>/dev/null | sort -r | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  grep -qxF "$HOME_DIR/releases/$old" <<<"$in_use" || { rm -rf "$old"; echo "pruned release $old"; }
done
