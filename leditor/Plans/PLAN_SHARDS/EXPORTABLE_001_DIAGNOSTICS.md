# Plan: Exportable leditor — Shard 001 (Diagnostics + Logging)

## Goal
Collect deterministic build/runtime evidence for leditor (current Electron app) and add targeted debug logs at Electron main/preload/renderer boundaries to support the upcoming extraction into an exportable `leditor-core` package.

## Success criteria
- `npm run build --loglevel verbose` succeeds in `leditor/`.
- If `npm run start --loglevel verbose` cannot run in this environment (e.g. missing display), the failure is captured with actionable logs (clear error + location).
- Added logs follow the required format: `[file name][function][debug] <message>`.
- No sensitive document contents are logged (sizes/counts/ids only).

## Constraints
- Follow `leditor/AGENTS.md` logging format and debugging loop.
- Keep changes minimal and easy to remove later (local `dbg()` helpers).
- Do not add or commit generated artifacts/caches (`dist/`, `node_modules/`, `.npm-cache/`, `.npm-logs/`).
- Offline-friendly: prefer local npm cache/log dirs and avoid registry hits.

## Scope (exact files)
- `leditor/src/electron/main.ts`
- `leditor/src/electron/preload.ts`
- `leditor/scripts/renderer-entry.ts`
- `leditor/Plans/PLAN_SHARDS/EXPORTABLE_001_DIAGNOSTICS.md` (this file)

## Steps
1) Add boundary logs in Electron main process
   - File: `leditor/src/electron/main.ts`
   - Targets:
     - App lifecycle: ready/activate/window-all-closed
     - BrowserWindow creation and key webPreferences (contextIsolation/nodeIntegration/preload path)
     - IPC handler registration and invocation (log channel name + timing + payload sizes only)

2) Add boundary logs in preload
   - File: `leditor/src/electron/preload.ts`
   - Targets:
     - Host contract decoding result (version/sessionId/documentId only)
     - Each exposed API method call (channel + timing + payload sizes only)

3) Confirm renderer bootstrap logs
   - File: `leditor/scripts/renderer-entry.ts`
   - Targets:
     - Ensure a single entry load and mount attempt is logged

4) Run verbose build and capture output
   - Commands (run from `leditor/`):
     - `export npm_config_logs_dir="$PWD/.npm-logs" npm_config_cache="$PWD/.npm-cache" npm_config_prefer_offline=true npm_config_audit=false npm_config_fund=false`
     - `npm run build --loglevel verbose`

5) Attempt verbose start and capture failure mode (if any)
   - Command (run from `leditor/`):
     - `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run start --loglevel verbose`

## Risk notes
- Environment may not have an X11/Wayland display; Electron start may fail. This is acceptable if the failure is captured clearly.
- Excessive logging could become noisy; logs must remain boundary-focused and easy to remove later.

## Validation
- `npm run build --loglevel verbose` (must pass)
- Start attempt command above (must produce a clear outcome; pass or a clearly captured failure)

## Rollback
- `git restore leditor/src/electron/main.ts leditor/src/electron/preload.ts leditor/scripts/renderer-entry.ts`
- `git restore leditor/Plans/PLAN_SHARDS/EXPORTABLE_001_DIAGNOSTICS.md`

## Progress
1) Boundary logs in Electron main — PASS
2) Boundary logs in preload — PASS
3) Confirm renderer bootstrap logs — PASS
4) Verbose build — PASS
5) Verbose start attempt — PASS (requires non-sandboxed run)
