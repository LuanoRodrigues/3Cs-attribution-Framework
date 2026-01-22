# Plan: Reset Auto on Spinner + Fix SetPageOrientation Failure

## Goal
Add Reset Auto to the Page Setup height spinner and instrument/fix the SetPageOrientation failure path.

## Success criteria
1. Page Setup height spinner includes a Reset Auto option that clears manual height.
2. SetPageOrientation no longer throws; logs clearly indicate success path.
3. Orientation change updates layout tokens and repagination.

## Constraints
- Follow `AGENTS.md` (no silent fallbacks, fail fast).
- Keep UI changes scoped to layout tab JSON and command handlers.
- Avoid DevTools instructions; use in-code logging only.

## Scope
- `Plans/layout_tab.json`
- `src/api/editor_commands.ts`
- `src/api/command_map.ts`
- `src/ui/a4_layout.ts`
- `src/extensions/extension_page_layout.ts` (if command returns false)
- `dist/renderer/bootstrap.bundle.js`

## Steps
1. Add a Reset Auto menu item to the height spinner control in `Plans/layout_tab.json`.
2. Add a dedicated command ID for Reset Auto if needed and wire it in `src/api/editor_commands.ts` and `src/api/command_map.ts`.
3. Instrument `SetPageOrientation` in `src/api/command_map.ts` to log the command availability and return value; ensure it throws only if truly unavailable.
4. Verify `setPageOrientation` command exists in `src/extensions/extension_page_layout.ts` and returns true.
5. Patch the runtime renderer bundle to guard `process.env` access for `GTK_USE_PORTAL`.

## Risk notes
- Orientation changes could be blocked by stale runtime JS if not kept in sync.

## Validation
- `npm start` (manual: click orientation and height reset; confirm no errors).

## Rollback
1. `git checkout -- Plans/layout_tab.json src/api/editor_commands.ts src/api/command_map.ts src/ui/a4_layout.ts src/extensions/extension_page_layout.ts dist/renderer/bootstrap.bundle.js`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: PASS
- Validation: FAIL (`npm start` logs portal error: org.freedesktop.portal.Desktop)
