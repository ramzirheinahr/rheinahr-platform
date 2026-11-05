#!/usr/bin/env bash
# Switches a company back to the release that was live before the last deploy.
# Database migrations are not reverted (they are additive by convention).
#
#   scripts/rollback.sh rheinahr|rheinland
set -euo pipefail

COMPANY="${1:?usage: scripts/rollback.sh rheinahr|rheinland}"
case "$COMPANY" in
  rheinahr)  PM2_NAME=rheinahr-platform;  PORT=3000 ;;
  rheinland) PM2_NAME=rheinland-platform; PORT=3001 ;;
  *) echo "unknown company: $COMPANY" >&2; exit 2 ;;
esac

ssh rheinahr bash -s -- "$COMPANY" "$PM2_NAME" "$PORT" <<'REMOTE'
set -euo pipefail
COMPANY="$1"; PM2_NAME="$2"; PORT="$3"
LINK="$HOME/apps/$COMPANY"
TARGET="$(readlink -f "$LINK.previous")" || { echo "no previous release recorded" >&2; exit 1; }
CURRENT="$(readlink -f "$LINK")"
echo "Rolling $COMPANY back: $CURRENT → $TARGET"
pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
PORT="$PORT" pm2 start npm --name "$PM2_NAME" --cwd "$TARGET" -- start >/dev/null
for _ in $(seq 1 60); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "127.0.0.1:$PORT/de/login")" == 200 ]] && break
  sleep 1
done
ln -sfn "$TARGET" "$LINK"; ln -sfn "$CURRENT" "$LINK.previous"
[[ "$COMPANY" == rheinahr ]] && ln -sfn "$TARGET" "$HOME/current"
pm2 save >/dev/null
echo "$COMPANY now serves $(curl -s -o /dev/null -w '%{http_code}' "127.0.0.1:$PORT/de/login") from $TARGET"
REMOTE
