#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
REMOTE_HOST="${REMOTE_HOST:-ubuntu@124.223.78.223}"
REMOTE_PROJECT_ROOT="${REMOTE_PROJECT_ROOT:-/opt/work-file-archive}"
BRANCH="${BRANCH:-main}"
REMOTE_BUNDLE_PATH="${REMOTE_BUNDLE_PATH:-/tmp/work-file-archive.bundle}"
REMOTE_ORIGIN_URL="${REMOTE_ORIGIN_URL:-https://github.com/0829menghui/work-file-archive.git}"
COMMIT_MESSAGE="${1:-chore: update work file archive}"

cd "$PROJECT_ROOT"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[publish] current directory is not a git repository"
  exit 1
fi

git add .

if ! git diff --cached --quiet; then
  git commit -m "$COMMIT_MESSAGE"
else
  echo "[publish] no staged changes, skip commit"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git push origin "$BRANCH"
else
  echo "[publish] remote origin is not configured, skip GitHub push"
  echo "[publish] after creating GitHub repo, run:"
  echo "          git remote add origin $REMOTE_ORIGIN_URL"
  echo "          git push -u origin $BRANCH"
fi

TMP_BUNDLE="$(mktemp -t work-file-archive-bundle-XXXXXX.bundle)"
trap 'rm -f "$TMP_BUNDLE"' EXIT
git bundle create "$TMP_BUNDLE" "$BRANCH"
scp "$TMP_BUNDLE" "$REMOTE_HOST:$REMOTE_BUNDLE_PATH"

ssh "$REMOTE_HOST" "\
  git config --global --add safe.directory '$REMOTE_PROJECT_ROOT' >/dev/null 2>&1 || true && \
  if [ ! -d '$REMOTE_PROJECT_ROOT/.git' ]; then \
    echo '[publish] remote path is not a git repository: $REMOTE_PROJECT_ROOT'; \
    echo '[publish] create it once from the uploaded bundle before publishing'; \
    exit 2; \
  fi && \
  cd '$REMOTE_PROJECT_ROOT' && \
  git fetch '$REMOTE_BUNDLE_PATH' '$BRANCH' && \
  git checkout '$BRANCH' && \
  git reset --hard FETCH_HEAD && \
  git remote set-url origin '$REMOTE_ORIGIN_URL' >/dev/null 2>&1 || git remote add origin '$REMOTE_ORIGIN_URL' && \
  git update-ref 'refs/remotes/origin/$BRANCH' HEAD && \
  rm -f '$REMOTE_BUNDLE_PATH' && \
  SKIP_FETCH=1 BRANCH='$BRANCH' bash deploy.sh\
"
