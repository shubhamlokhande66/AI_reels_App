#!/bin/sh
# Container start: with R2 settings (Cloudflare), mount the bucket at STORAGE_PATH so uploads and Reels are kept in R2
# (the container's own disk is temporary); without them, the folder is a plain directory (docker compose, a VPS).
set -eu
STORAGE_PATH="${STORAGE_PATH:-/data/storage}"
mkdir -p "$STORAGE_PATH" "${SCRATCH_PATH:-/tmp/reel-scratch}"

if [ -n "${R2_BUCKET:-}" ] && [ -n "${R2_ACCOUNT_ID:-}" ]; then
  export AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
  export AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
  /usr/local/bin/tigrisfs --endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" --region auto -f "$R2_BUCKET" "$STORAGE_PATH" &
  fuse_pid=$!
  attempt=0
  until mountpoint -q "$STORAGE_PATH"; do
    if ! kill -0 "$fuse_pid" 2>/dev/null; then echo "R2 mount failed: tigrisfs exited" >&2; exit 1; fi
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then echo "R2 mount timed out" >&2; exit 1; fi
    sleep 1
  done
  export STORAGE_MOUNTED=true
  echo "R2 bucket $R2_BUCKET mounted at $STORAGE_PATH"
fi

exec node server.js
