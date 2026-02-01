# PLAN_SHARD_011 — my-electron-app: Analyse CSS migration

## Goal
Reduce `element.style.*` usage in Analyse pages by introducing stable CSS classes for consistent theming/density.

## Success criteria
- At least the most visible Analyse pages rely primarily on classes (welcome + dashboard + one more), not inline styles.

## Scope (exact file list)
- `my-electron-app/src/pages/analyse/welcome.ts`
- `my-electron-app/src/pages/analyse/dashboard.ts`
- `my-electron-app/src/pages/analyse/sections.ts`
- `my-electron-app/src/renderer/styles.css`

## Validation
- `cd my-electron-app && npm run build`

## Rollback
- `git checkout -- my-electron-app/src/pages/analyse/welcome.ts`
- `git checkout -- my-electron-app/src/pages/analyse/dashboard.ts`
- `git checkout -- my-electron-app/src/pages/analyse/sections.ts`
- `git checkout -- my-electron-app/src/renderer/styles.css`

## Progress
1) Refactor to classes: PASS
2) Validate build: PASS (`cd my-electron-app && npm run build`)
