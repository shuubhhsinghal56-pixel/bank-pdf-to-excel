#!/bin/zsh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"

cd "$BACKEND_DIR"

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi

source .venv/bin/activate

if ! python -c "import fastapi, pdfplumber, openpyxl, dotenv, multipart, uvicorn" >/dev/null 2>&1; then
  pip install -r requirements.txt
fi

exec python -m uvicorn server:app --host 0.0.0.0 --port 8000 --reload
