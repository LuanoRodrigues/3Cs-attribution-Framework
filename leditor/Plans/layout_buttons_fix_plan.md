# Plan: Fix All Layout Ribbon Buttons

## Goal
Ensure all Layout ribbon buttons dispatch valid commands and do not throw unknown/failed-command errors.

## Success criteria
1. No unknown-command errors for layout buttons (margins, size, orientation, gutter, header/footer distance, height controls).
2. `SetPageSize` and `SetPageOrientation` succeed and apply layout updates.
3. Runtime JS command map and editor command registry are in sync.

## Constraints
- Follow `AGENTS.md` rules (fail fast, no silent fallbacks).
- Update both TS sources and runtime JS where required.
- Keep changes scoped to layout/ribbon command paths.

## Scope
- `src/api/editor_commands.ts`
- `src/api/command_map.ts`
- `src/api/command_map.js`
- `src/api/editor_commands.js` (if needed)
- `src/extensions/extension_page_layout.ts`
- `src/ui/layout_settings.ts`
- `src/ui/a4_layout.ts`
- `Plans/layout_tab.json`

## Steps
1. Ensure all layout-related command IDs are in `src/api/editor_commands.ts`.
2. Ensure command handlers exist in `src/api/command_map.ts` for all layout buttons.
3. Sync runtime JS (`src/api/command_map.js` and `src/api/editor_commands.js`) with TS changes.
4. Instrument `SetPageSize` and `SetPageOrientation` to log command availability/return.
5. Verify `extension_page_layout` commands return true and are registered.
6. Validate layout button flows with `npm start`.

## Risk notes
- Inconsistent TS/JS may still cause runtime command lookup failures.
- Layout extension mismatch can cause setPageSize/setPageOrientation to return false.

## Validation
- `npm start` (manual: click each layout button and confirm no errors).

## Rollback
1. `git checkout -- src/api/editor_commands.ts src/api/command_map.ts src/api/command_map.js src/api/editor_commands.js src/extensions/extension_page_layout.ts src/ui/layout_settings.ts src/ui/a4_layout.ts Plans/layout_tab.json`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: PASS
- Step 6: FAIL (`npm start` logs portal error: org.freedesktop.portal.Desktop)
