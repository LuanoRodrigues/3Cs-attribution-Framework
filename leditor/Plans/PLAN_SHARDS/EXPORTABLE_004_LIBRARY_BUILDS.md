# Plan: Exportable leditor — Shard 004 (Library Builds: ESM/CJS/Global)

## Goal
Produce reusable, browser-safe library bundles for leditor from the existing codebase, without breaking the current Electron app:
- ESM bundle for modern bundlers
- CJS bundle for Node-ish consumers (optional but common)
- Global module bundle for CDN usage (`<script type="module" ...>`)

## Success criteria
- `npm run build:lib --loglevel verbose` produces files under `leditor/dist/lib/`.
- Electron app build/start scripts remain unchanged and working.
- Export surface is stable: `createLeditorApp`, `destroyLeditorApp`, `getHostAdapter`, `setHostAdapter`.

## Constraints
- No new dependencies.
- Do not commit `dist/` outputs.
- Keep config minimal; leverage existing `esbuild` usage.

## Scope (exact files)
- `leditor/scripts/lib-entry.ts` (new)
- `leditor/package.json`
- `leditor/Plans/PLAN_SHARDS/EXPORTABLE_004_LIBRARY_BUILDS.md`

## Steps
1) Add a library entry module
   - File: `leditor/scripts/lib-entry.ts`
   - Re-export:
     - `createLeditorApp`, `destroyLeditorApp`
     - `getHostAdapter`, `setHostAdapter`
     - related types

2) Add build scripts
   - File: `leditor/package.json`
   - Add scripts:
     - `build:lib:esm` → `dist/lib/index.js`
     - `build:lib:cjs` → `dist/lib/index.cjs`
     - `build:lib:global` → `dist/lib/leditor.global.js` (+ css)
     - `build:lib` runs all

3) (Optional, non-breaking) Add `exports` map for consumers
   - Keep `"main"` pointing to Electron entry (`dist/electron/main.js`).
   - Add `exports` for library consumers without impacting Electron start.

4) Validate
   - Run from `leditor/`:
     - `npm run build:lib --loglevel verbose`

## Risk notes
- Bundling may produce large artifacts; that’s acceptable for initial exportability.
- A later shard can externalize dependencies, add Web Component wrapper, and split into `packages/leditor-core`.

## Validation
- `npm run build:lib --loglevel verbose`

## Rollback
- `git restore leditor/package.json`
- `git restore leditor/scripts/lib-entry.ts`
- `git restore leditor/Plans/PLAN_SHARDS/EXPORTABLE_004_LIBRARY_BUILDS.md`

## Progress
1) Library entry module — PASS
2) Build scripts — PASS
3) Exports map — PASS
4) Library build validation — PASS
