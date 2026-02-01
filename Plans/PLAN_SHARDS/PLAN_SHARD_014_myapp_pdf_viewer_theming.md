# PLAN_SHARD_014 — my-electron-app: PDF viewer theming parity

## Goal
Ensure the PDF viewer experience matches the app theme tokens.

## Success criteria
- Viewer uses CSS variables for background/text/accent.
- Viewer updates when theme changes (best-effort within iframe).

## Scope (exact file list)
- `my-electron-app/src/renderer/index.ts`
- `my-electron-app/resources/viewer.html`

## Validation
- `cd my-electron-app && npm run build`

## Rollback
- `git checkout -- my-electron-app/src/renderer/index.ts`
- `git checkout -- my-electron-app/resources/viewer.html`

## Progress
1) Update viewer to accept tokens: PASS
2) Update syncPdfViewerTheme wiring: PASS
3) Validate build: PASS (`cd my-electron-app && npm run build`)
