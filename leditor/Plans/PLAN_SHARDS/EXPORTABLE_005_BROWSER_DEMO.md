# Plan: Exportable leditor — Shard 005 (Browser Demo Page)

## Goal
Add a minimal static demo page that loads the exported library bundle (ESM global module + CSS) and mounts the editor in a plain browser context (no Electron).

## Success criteria
- A new demo HTML page exists under `leditor/public/` and gets copied into `leditor/dist/public/` via the existing `build:public` step.
- With `npm run build:lib` run beforehand, the demo can load:
  - `../lib/leditor.global.css`
  - `../lib/leditor.global.mjs`
- The demo mounts the editor with `requireHostContract: false` and `enableCoderStateImport: false`.

## Constraints
- No new dependencies.
- Keep the demo simple and deterministic (no network access).

## Scope (exact files)
- `leditor/public/lib_demo.html` (new)
- `leditor/Plans/PLAN_SHARDS/EXPORTABLE_005_BROWSER_DEMO.md`

## Steps
1) Add `public/lib_demo.html`
   - Load CSS: `../lib/leditor.global.css`
   - Load module: `../lib/leditor.global.mjs` (attaches `globalThis.LEditor`)
   - Call `globalThis.LEditor.createLeditorApp({ container, elementId, requireHostContract: false, enableCoderStateImport: false })`

2) Validate build chain
   - Run from `leditor/`:
     - `npm run build:lib`
     - `npm run build:public`
   - Confirm `dist/public/lib_demo.html` exists and references the sibling `dist/lib/*` assets correctly.

## Validation
- `npm run build:lib`
- `npm run build:public`

## Rollback
- `git restore leditor/public/lib_demo.html`
- `git restore leditor/Plans/PLAN_SHARDS/EXPORTABLE_005_BROWSER_DEMO.md`

## Progress
1) Demo HTML page — PASS
2) Build validation — PASS
