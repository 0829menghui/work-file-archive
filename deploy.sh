#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/opt/work-file-archive}"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_SERVICE="${BACKEND_SERVICE:-work-file-archive}"
WEB_SERVICE="${WEB_SERVICE:-nginx}"
BRANCH="${BRANCH:-main}"
SKIP_FETCH="${SKIP_FETCH:-0}"

echo "[deploy] project root: $PROJECT_ROOT"

cd "$PROJECT_ROOT"
if [ "$SKIP_FETCH" != "1" ]; then
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
fi

cd "$BACKEND_DIR"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -r requirements.txt

cd "$FRONTEND_DIR"
npm ci
npm run build

sudo systemctl restart "$BACKEND_SERVICE"
sudo systemctl restart "$WEB_SERVICE"

echo "[deploy] finished"
sudo systemctl --no-pager --full status "$BACKEND_SERVICE" | sed -n '1,12p'
sudo systemctl --no-pager --full status "$WEB_SERVICE" | sed -n '1,12p'
