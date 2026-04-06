#!/bin/zsh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"

cd "$FRONTEND_DIR"

printf "EXPO_PUBLIC_BACKEND_URL=http://localhost:8000\n" > .env

if [ ! -d "node_modules" ]; then
  npm install
fi

exec npx expo start --web
