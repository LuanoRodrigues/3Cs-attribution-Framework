#!/usr/bin/env bash
set -euo pipefail

#SRC="${1:-/home/pantera/annotarium/coder/0-13_cyber_attribution_corpus_records_total_included/coder_state.json}"

SRC="${1:-/home/pantera/projects/TEIA/coder_state_paper.json}"
OUT="${2:-/home/pantera/projects/TEIA/leditor/coder_state.ledoc}"

# Trim surrounding quotes if provided.
SRC="${SRC%\"}"
SRC="${SRC#\"}"
SRC="${SRC%\'}"
SRC="${SRC#\'}"

# Translate UNC WSL path into Linux path if needed.
# Normalize UNC WSL paths (handles \\wsl.localhost\Ubuntu-22.04\..., \wsl.localhost\..., or //wsl.localhost/...).
if [[ "$SRC" =~ wsl\.localhost[/\\]Ubuntu-22\.04 ]]; then
  # Convert backslashes to slashes.
  SRC="${SRC//\\//}"
  # Strip leading slashes and UNC prefix.
  SRC="${SRC#//wsl.localhost/Ubuntu-22.04}"
  SRC="${SRC#/wsl.localhost/Ubuntu-22.04}"
  SRC="${SRC#wsl.localhost/Ubuntu-22.04}"
  # Ensure leading slash.
  if [[ "$SRC" != /* ]]; then
    SRC="/$SRC"
  fi
fi

cd /home/pantera/projects/TEIA/leditor
node scripts/convert_coder_state.js "$SRC" "$OUT"
