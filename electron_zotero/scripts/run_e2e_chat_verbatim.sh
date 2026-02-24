#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

ANALYSE_DIR="${ZOTERO_E2E_CHAT_DIR_BASE:-$HOME/annotarium/analyse}"
COLLECTION_KEY="${ZOTERO_E2E_CHAT_COLLECTION_KEY:-44Q6VN9A}"
COLLECTION_KEYWORD="${ZOTERO_E2E_CHAT_COLLECTION_KEYWORD:-$COLLECTION_KEY}"
APP_TIMEOUT_SEC="${ZOTERO_E2E_CHAT_APP_TIMEOUT_SEC:-360}"

SCENARIO_JSON="{
  \"collectionKeyword\": \"${COLLECTION_KEYWORD}\",
  \"collectionKey\": \"${COLLECTION_KEY}\",
  \"dirBase\": \"${ANALYSE_DIR}\",
  \"initialCommand\": \"Code my collection ${COLLECTION_KEY} about cyber attribution frameworks and models, skip screening, and generate 3 to 5 strong research questions.\",
  \"feedback\": \"Could you refine the questions to cover evidence, methodology, validity, uncertainty, and policy implications?\",
  \"approve\": \"yes\",
  \"waitMs\": 120000,
  \"executionWaitMs\": 420000
}"

export ZOTERO_E2E_CHAT_RUN=1
export ZOTERO_E2E_CHAT_FULL_RUN=1
export ZOTERO_E2E_CHAT_DIR_BASE="${ANALYSE_DIR}"
export ZOTERO_E2E_CHAT_SCENARIO="${ZOTERO_E2E_CHAT_SCENARIO:-$SCENARIO_JSON}"
export ZOTERO_E2E_CHAT_EXIT_ON_DONE=1

NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" \
ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 \
timeout "${APP_TIMEOUT_SEC}s" npm run start --loglevel verbose
