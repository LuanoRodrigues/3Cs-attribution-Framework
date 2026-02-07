#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-/tmp/leditor-logs}"
mkdir -p "$LOG_DIR"

ts="$(date +"%Y%m%d_%H%M%S")"
LOG_FILE="${1:-${LOG_FILE:-$LOG_DIR/leditor_${ts}.log}}"

export npm_config_logs_dir="${NPM_LOGS_DIR:-$ROOT/.npm-logs}"
export npm_config_cache="${NPM_CACHE_DIR:-$ROOT/.npm-cache}"
export npm_config_prefer_offline="${NPM_PREFER_OFFLINE:-true}"
export npm_config_audit="${NPM_AUDIT:-false}"
export npm_config_fund="${NPM_FUND:-false}"

export NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps"
export ELECTRON_ENABLE_LOGGING=1
export ELECTRON_ENABLE_STACK_DUMPING=1

cd "$ROOT"

echo "[run] log_file=$LOG_FILE"
echo "[run] start_time=$(date -Iseconds)"

if command -v stdbuf >/dev/null 2>&1; then
  PIPE=(stdbuf -oL -eL tee "$LOG_FILE")
else
  PIPE=(tee "$LOG_FILE")
fi

{
  echo "[run] npm run build --loglevel verbose"
  npm run build --loglevel verbose
  echo "[run] npm run start --loglevel verbose"
  npm run start --loglevel verbose
} 2>&1 | "${PIPE[@]}"
