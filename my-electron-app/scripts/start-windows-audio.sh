#!/usr/bin/env bash
set -euo pipefail

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "[start-windows-audio] powershell.exe not found. Run this from WSL on Windows."
  exit 1
fi

if ! command -v wslpath >/dev/null 2>&1; then
  echo "[start-windows-audio] wslpath not found."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_ROOT="$(wslpath -w "$ROOT_DIR")"
if [[ "$WIN_ROOT" == \\\\wsl$\\* ]]; then
  WIN_ROOT="\\\\wsl.localhost\\${WIN_ROOT#\\\\wsl$\\}"
fi

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "\$root='$WIN_ROOT'; if (-not (Test-Path -LiteralPath \$root)) { Write-Error \"Path not found: \$root\"; exit 1 }; Set-Location -LiteralPath \$root; \$env:AGENT_CLI_HOST='0.0.0.0'; node -r ./scripts/load-dotenv.js scripts/start.js"
