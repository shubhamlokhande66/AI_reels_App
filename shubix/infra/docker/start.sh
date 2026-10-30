#!/bin/sh
# The container's start: mount the R2 bucket (when configured), then the API and the web server.
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
# CONTAINER_ROLE=api: the API alone, on API_PORT (the website runs elsewhere, e.g. Vercel, and sends /api here)
if [ "${CONTAINER_ROLE:-all}" = "api" ]; then cd /app/api && exec node --conditions=shubix-dist dist/main.js; fi
# the API reads its data files from src/server (cwd = the api folder)
(cd /app/api && exec node --conditions=shubix-dist dist/main.js) &
api_pid=$!
(cd /app/web/FE/web-app && exec node server.js) &
web_pid=$!
# either one stops: stop the container (Cloudflare starts a new one)
while kill -0 "$api_pid" 2>/dev/null && kill -0 "$web_pid" 2>/dev/null; do sleep 2; done
echo "a server stopped" >&2
kill "$api_pid" "$web_pid" 2>/dev/null || true
exit 1
