# PLAN_SHARD_007 — LEditor: Theme PDF viewer + references picker

## Goal
Ensure cross-surface parity for LEditor: PDF viewer window and references picker match theme tokens and light/dark modes.

## Success criteria
- `leditor/public/pdf_viewer.html` uses token-driven styling and supports light/dark.
- References picker keeps its premium look and inherits accent/theme where feasible.

## Scope (exact file list)
- `leditor/public/pdf_viewer.html`
- `leditor/src/ui/references/picker.ts`
- `leditor/src/ui/references/ref_picker.html`

## Validation
- `cd leditor && npm run build`

## Rollback
- `git checkout -- leditor/public/pdf_viewer.html`
- `git checkout -- leditor/src/ui/references/picker.ts`
- `git checkout -- leditor/src/ui/references/ref_picker.html`

## Progress
1) Update PDF viewer theme: PASS
2) Update references picker theme sync: PASS
3) Validate build: PASS (`cd leditor && npm run build`)
