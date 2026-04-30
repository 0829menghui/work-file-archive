#!/usr/bin/env bash
set -euo pipefail

# One-command local publish:
# 1. git add / commit
# 2. git push origin main
# 3. upload bundle to server
# 4. deploy and restart work-file-archive + nginx

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
COMMIT_MESSAGE="${1:-chore: deploy work file archive}"

cd "$PROJECT_ROOT"
bash publish.sh "$COMMIT_MESSAGE"
