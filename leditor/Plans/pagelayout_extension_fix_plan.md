# Plan: Fix PageLayoutExtension Undefined

## Goal
Resolve `Uncaught ReferenceError: PageLayoutExtension is not defined` so the editor initializes with page layout support.

## Success criteria
1. App boots without `PageLayoutExtension` reference errors.
2. `PageLayoutExtension` is imported and registered in the editor extensions list.
3. Layout commands (page size/orientation/margins) work without throwing.

## Constraints
- Follow `AGENTS.md` (fail fast, no silent fallbacks).
- Update both TS and runtime JS when required.
- Do not introduce new external dependencies.

## Scope
- `src/api/leditor.ts`
- `src/api/leditor.js`
- `dist/renderer/bootstrap.bundle.js` (runtime bundle if required)

## Steps
1. Verify `PageLayoutExtension` import/export in `src/api/leditor.ts` and usage in the extensions array.
2. Ensure runtime JS (`src/api/leditor.js`) includes the import and uses it in extensions.
3. Patch renderer bundle to align runtime with the JS source if necessary.
4. Validate with `npm start`.

## Risk notes
- Mismatched runtime JS vs TS can reintroduce undefined references.

## Validation
- `npm start` (confirm editor mounts and no `PageLayoutExtension` error).

## Rollback
1. `git checkout -- src/api/leditor.ts src/api/leditor.js dist/renderer/bootstrap.bundle.js`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: FAIL (`npm start` logs portal error: org.freedesktop.portal.Desktop)
