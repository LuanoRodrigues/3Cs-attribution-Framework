#!/usr/bin/env bash
set -euo pipefail

INPUT_JSON="/home/pantera/annotarium/coder/0-13_cyber_attribution_corpus_records_total_included/coder_state.json"
OUTPUT_LEDOC="/home/pantera/projects/TEIA/leditor/coder_state.ledoc"

cd /home/pantera/projects/TEIA/leditor
node scripts/convert_coder_state.js "${INPUT_JSON}" "${OUTPUT_LEDOC}"
echo "[convert] wrote ${OUTPUT_LEDOC}"
