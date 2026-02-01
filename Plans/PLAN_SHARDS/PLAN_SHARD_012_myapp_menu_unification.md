# PLAN_SHARD_012 — my-electron-app: Menu unification

## Goal
Unify ribbon context menu, panel context menu, and coder context menu into one consistent premium menu grammar.

## Success criteria
- Menu styling is consistent across:
  - `.ribbon-context-menu`
  - `.panel-context-menu`
  - `.coder-context-menu`
- Z-index and motion behavior consistent.

## Scope (exact file list)
- `my-electron-app/src/renderer/ribbon-panels.v2.css`
- `my-electron-app/src/renderer/styles.css`
- `my-electron-app/src/panels/coder/coderStyles.css`

## Validation
- `cd my-electron-app && npm run build`

## Rollback
- `git checkout -- my-electron-app/src/renderer/ribbon-panels.v2.css`
- `git checkout -- my-electron-app/src/renderer/styles.css`
- `git checkout -- my-electron-app/src/panels/coder/coderStyles.css`

## Progress
1) Unify menu CSS: PASS
2) Validate build: PASS (`cd my-electron-app && npm run build`)
