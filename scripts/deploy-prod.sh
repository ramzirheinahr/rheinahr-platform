#!/bin/bash
set -e

echo "Deploying to production server rheinahr..."

rsync -avz \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.env*' \
  --exclude='backups' \
  --exclude='video_sample' \
  --exclude='*.mp4' \
  ./ rheinahr:/home/rheinahr/releases/local-storage-current/

ssh rheinahr "cd /home/rheinahr/releases/local-storage-current && npm run build && pm2 restart rheinahr-platform"

echo "Deployment complete."
