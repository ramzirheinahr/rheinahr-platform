#!/usr/bin/env bash
# Deploys the current git commit to BOTH companies on the production server:
# RheinLand first (canary, fewer users), then RheinAhr. Same code, each built with
# its own ~/shared/<company>.env and migrated on its own database.
#
#   scripts/deploy.sh                 # both companies
#   scripts/deploy.sh rheinahr        # only one
#
# Only committed code is deployed (git archive of HEAD), so the server always runs
# an identifiable commit. Rollback: scripts/rollback.sh <company>.
set -euo pipefail

HOST=rheinahr
if [[ $# -gt 0 ]]; then COMPANIES=("$@"); else COMPANIES=(rheinland rheinahr); fi

cd "$(dirname "$0")/.."

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Uncommitted changes — commit first, only committed code is deployed:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

echo "Type-checking…"
npx tsc --noEmit

COMMIT="$(git rev-parse --short HEAD)"
RELEASE_ID="$(date +%Y%m%d-%H%M%S)-$COMMIT"
echo "Deploying $COMMIT ($(git log -1 --format=%s)) as $RELEASE_ID to: ${COMPANIES[*]}"

ssh "$HOST" "mkdir -p ~/releases/$RELEASE_ID/src"
git archive --format=tar HEAD | ssh "$HOST" "tar -x -C ~/releases/$RELEASE_ID/src"
# Keep the server's backup scripts in step with the repo.
scp -q scripts/backup-server.sh "$HOST:scripts/backup-db.sh"
scp -q scripts/offsite-backup.sh scripts/RESTORE-OFFSITE.md "$HOST:scripts/"

ssh -o ServerAliveInterval=30 "$HOST" "bash -s -- $RELEASE_ID ${COMPANIES[*]}" < scripts/server-deploy.sh

for company in "${COMPANIES[@]}"; do
  case "$company" in
    rheinahr)  url=https://platform.rheinahr-gmbh.de/de/login ;;
    rheinland) url=https://platform.rheinland-gmbh.de/de/login ;;
  esac
  echo "$company: $(curl -s -o /dev/null -w '%{http_code}' "$url") $url"
done
echo "Deployment of $COMMIT complete."
