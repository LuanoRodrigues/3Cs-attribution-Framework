# PLAN_SHARD_006 — LEditor: Refactor Footnotes + Sources panels

## Goal
Remove injected CSS from footnotes manager and sources panel, and align with shared panel primitives.

## Success criteria
- `leditor/src/ui/footnote_manager.ts` and `leditor/src/ui/references/sources_panel.ts` no longer inject CSS.

## Scope (exact file list)
- `leditor/src/ui/footnote_manager.ts`
- `leditor/src/ui/references/sources_panel.ts`

## Validation
- `cd leditor && npm run build`

## Rollback
- `git checkout -- leditor/src/ui/footnote_manager.ts`
- `git checkout -- leditor/src/ui/references/sources_panel.ts`

## Progress
1) Remove injected CSS (footnotes): PASS
2) Remove injected CSS (sources): PASS
3) Validate build: PASS
