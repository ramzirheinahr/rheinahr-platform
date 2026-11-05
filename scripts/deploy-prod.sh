#!/usr/bin/env bash
# Retired: it rebuilt the live RheinAhr directory in place (breaking the running app
# mid-build) and never updated RheinLand. Use scripts/deploy.sh (both companies,
# separate release dirs, smoke test, auto-rollback) instead.
echo "deploy-prod.sh is retired — use: scripts/deploy.sh" >&2
exit 1
