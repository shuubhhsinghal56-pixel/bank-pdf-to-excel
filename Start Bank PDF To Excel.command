#!/bin/zsh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_SCRIPT="$SCRIPT_DIR/scripts/start_backend.sh"
FRONTEND_SCRIPT="$SCRIPT_DIR/scripts/start_frontend.sh"

osascript <<OSA
tell application "Terminal"
  activate
  do script "zsh '$BACKEND_SCRIPT'"
  do script "zsh '$FRONTEND_SCRIPT'"
end tell
OSA
