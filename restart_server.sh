#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-ubuntu@124.223.78.223}"
BACKEND_SERVICE="${BACKEND_SERVICE:-work-file-archive}"
WEB_SERVICE="${WEB_SERVICE:-nginx}"

ssh "$REMOTE_HOST" "\
  sudo systemctl restart '$BACKEND_SERVICE' && \
  sudo systemctl restart '$WEB_SERVICE' && \
  echo '[restart] finished' && \
  sudo systemctl --no-pager --full status '$BACKEND_SERVICE' | sed -n '1,12p' && \
  sudo systemctl --no-pager --full status '$WEB_SERVICE' | sed -n '1,12p'\
"
