# E2E Chat Coding Test Report

Date: 2026-02-21
App: `TEIA/electron_zotero`
Runner: `scripts/run_e2e_chat_verbatim.sh`
JSON evidence: `state/e2e_reports/chat_verbatim_e2e_2026-02-21T12-10-05-698Z.json`

## Scenario
- Collection selection strategy: last collection whose label contains `framework` (fallback: last visible collection).
- Initial command: `code this collection about cyber attribution and frameworks and models`
- Feedback command: refine questions for literature-review contribution + strengths/weaknesses.
- Approval: `yes`

## Observed Flow
1. Renderer loaded and collection tree became available.
2. Collection selected: `016_framework_model_NA`.
3. Initial coding command sent in chat.
4. Agent produced 5 research questions and asked for confirmation.
5. Feedback sent to refine questions.
6. Agent refined questions and asked again for confirmation.
7. `yes` sent successfully.
8. App status changed to `Executing intent…`.

## Blocking Point
- Execution did not return a chat completion/failure message within timeout window.
- Final report state:
  - `status`: `failed`
  - `error`: `timeout waiting for assistant message`
  - `statusLine`: `Executing intent…`
  - Last transcript entry: user `yes`

## What This Means
- Intent resolution + question generation + question refinement + approval loop are working.
- The block occurs **after approval**, in execution path (`executeResolvedIntent -> zotero:intent-execute -> feature.run`).

## Most Likely Runtime Area
- `renderer/app.js` in `executeResolvedIntent(...)` is waiting for `window.zoteroBridge.executeIntent(...)`.
- `main.js` handles this through `zotero:intent-execute` and feature worker execution (`featureWorker.run`).
- So the stall is likely in feature execution (`set_eligibility_criteria` preflight and/or `Verbatim_Evidence_Coding`).

## Added Automation Assets
- Harness in main process (env-gated):
  - `ZOTERO_E2E_CHAT_RUN=1`
  - `ZOTERO_E2E_CHAT_SCENARIO` JSON
  - `ZOTERO_E2E_CHAT_EXIT_ON_DONE=1`
- Script: `scripts/run_e2e_chat_verbatim.sh`
- Automatic JSON report output: `state/e2e_reports/chat_verbatim_e2e_*.json`
