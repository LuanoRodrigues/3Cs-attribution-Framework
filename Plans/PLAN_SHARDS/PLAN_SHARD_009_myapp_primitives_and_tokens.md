# PLAN_SHARD_009 — my-electron-app: UI primitives + token alignment

## Goal
Introduce a shared primitive class layer and align workspace CSS to density/effects tokens to support a premium minimalist baseline.

## Success criteria
- New primitive stylesheet exists and is imported from `my-electron-app/src/renderer/styles.css`.
- Shadows/blur/motion use density/effects tokens where possible.
- Buttons/inputs/menus use consistent primitives (without breaking existing layouts).

## Scope (exact file list)
- `my-electron-app/src/renderer/styles.css`
- `my-electron-app/src/renderer/ui-primitives.css`

## Validation
- `cd my-electron-app && npm run lint`
- `cd my-electron-app && npm run build`

## Rollback
- `git checkout -- my-electron-app/src/renderer/styles.css`
- `git checkout -- my-electron-app/src/renderer/ui-primitives.css`

## Progress
1) Add primitives CSS: PASS
2) Wire primitives into styles.css: PASS
3) Validate: PASS (`cd my-electron-app && npm run lint && npm run build`)
