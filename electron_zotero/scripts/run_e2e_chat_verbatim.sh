#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

SCENARIO_JSON='{
  "collectionKeyword": "framework",
  "initialCommand": "code this collection about cyber attribution and frameworks and models",
  "feedback": "Could you refine the questions for literature review contribution and strengths/weaknesses of each framework?",
  "approve": "yes",
  "waitMs": 120000
}'

export ZOTERO_E2E_CHAT_RUN=1
export ZOTERO_E2E_CHAT_SCENARIO="${ZOTERO_E2E_CHAT_SCENARIO:-$SCENARIO_JSON}"
export ZOTERO_E2E_CHAT_EXIT_ON_DONE=1

NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" \
ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 \
timeout 360s npm run start --loglevel verbose
