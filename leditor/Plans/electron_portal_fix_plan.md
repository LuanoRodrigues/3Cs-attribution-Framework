# Plan: Electron Portal Error Fix

## Goal
Eliminate the `org.freedesktop.portal.Desktop` startup error so `npm start` runs reliably in this environment.

## Success criteria
1. `npm start` no longer logs the portal error and reaches the renderer without timeout.
2. No functional regression in layout or editor startup.

## Constraints
- Follow `AGENTS.md` (fail-fast, no silent fallbacks).
- Avoid adding platform-specific hacks unless strictly required.
- No new external runtime dependencies.

## Scope
- `src/main/index.ts` or Electron entry (if exists)
- `package.json` (start script if flags are needed)
- `docs/` or `README` (if environment note required)

## Steps
1. Locate Electron main entry and determine how Electron is launched.
2. Apply a deterministic fix (e.g., disable portal use or set environment flags) scoped to Linux desktop portal failure.
3. Add a minimal startup log indicating the portal mitigation path.
4. Validate with `npm start`.

## Risk notes
- Platform-specific flags may affect file dialogs or sandbox behavior.
- Startup changes could alter window initialization order.

## Validation
- `npm start` (ensure no portal error and renderer mounts).

## Rollback
1. `git checkout -- src/main/index.ts package.json docs/README.md`

## Progress
- Step 1: PASS
- Step 2: FAIL (portal error persists after GTK portal flags)
- Step 3: PASS
- Step 4: FAIL (`npm start` still logs portal error; command timed out)
