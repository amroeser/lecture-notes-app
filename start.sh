#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Ensure common Homebrew binaries are on PATH (Apple Silicon)
export PATH="/opt/homebrew/bin:$PATH"

echo "[start] Lecture Notes App"

if ! command -v node >/dev/null 2>&1; then
  echo "[error] node not found. Please install Node.js (LTS) first." >&2
  exit 1
fi

PKG_MGR=""
if command -v npm >/dev/null 2>&1; then
  PKG_MGR="npm"
elif command -v pnpm >/dev/null 2>&1; then
  PKG_MGR="pnpm"
elif command -v yarn >/dev/null 2>&1; then
  PKG_MGR="yarn"
else
  echo "[error] No package manager found (npm/pnpm/yarn)." >&2
  exit 1
fi

echo "[start] Using package manager: $PKG_MGR"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "[warn] ffmpeg not found. MP4->Audio extraction will fail." >&2
  echo "       Install on macOS: brew install ffmpeg" >&2
fi

ENV_FILE=""
if [[ -f .env.local ]]; then
  ENV_FILE=".env.local"
elif [[ -f .env ]]; then
  ENV_FILE=".env"
fi

if [[ -z "$ENV_FILE" ]]; then
  echo "[warn] No env file found (.env.local or .env). Create one (copy from .env.example) and set OPENAI_API_KEY." >&2
else
  echo "[start] Detected env file: $ENV_FILE"
  if ! grep -E -q '^[[:space:]]*OPENAI_API_KEY[[:space:]]*=[[:space:]]*.+[[:space:]]*$' "$ENV_FILE"; then
    echo "[warn] OPENAI_API_KEY is missing/empty in $ENV_FILE." >&2
  fi
fi

if [[ ! -d node_modules ]]; then
  echo "[start] Installing dependencies…"
  if [[ "$PKG_MGR" == "npm" ]]; then
    npm install
  elif [[ "$PKG_MGR" == "pnpm" ]]; then
    pnpm install
  else
    yarn install
  fi
fi

echo "[start] Starting dev server…"
if [[ "$PKG_MGR" == "npm" ]]; then
  npm run dev
elif [[ "$PKG_MGR" == "pnpm" ]]; then
  pnpm dev
else
  yarn dev
fi
