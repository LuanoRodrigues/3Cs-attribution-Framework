#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

python3 "${REPO_ROOT}/annotarium/scripts/build_result_template.py" \
  --outputs-root "${REPO_ROOT}/annotarium/outputs" \
  --results-root "${REPO_ROOT}/annotarium/outputs/results" \
  --result-file results_aggregated.json
