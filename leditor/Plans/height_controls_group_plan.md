# Plan: Height Test Group + Reset

## Goal
Expose height controls in the Layout ribbon by creating a dedicated group and adding + / - / reset-to-auto controls that drive `leditor-content-frame` height.

## Success criteria
1. Layout tab shows a new group labeled "Height Test".
2. Group contains +, - and Reset buttons (or spinner + reset) and they are visible.
3. + / - adjust `leditor-content-frame` height with max 700px clamp.
4. Reset returns to auto (computed) height and triggers repagination.

## Constraints
- Follow `AGENTS.md` rules (no silent fallbacks, fail fast).
- Use existing command dispatch + layout controller APIs.
- Keep UI changes within `Plans/layout_tab.json`.

## Scope
- `Plans/layout_tab.json`
- `src/api/editor_commands.ts`
- `src/api/command_map.ts`
- `src/ui/a4_layout.ts`
- `src/ui/renderer.ts`

## Steps
1. Add command IDs for height increase/decrease/reset in `src/api/editor_commands.ts`.
2. Implement command handlers in `src/api/command_map.ts` to call layout controller methods.
3. Add layout controller methods for increment/decrement and reset-to-auto in `src/ui/a4_layout.ts`.
4. Add a new "Height Test" group with +, - and Reset controls in `Plans/layout_tab.json`.
5. Add missing command IDs for `view.printPreview.open`, `SetHeaderDistance`, and `SetFooterDistance` in `src/api/editor_commands.ts` and ensure command handlers exist.
6. Fix `process is not defined` in renderer by removing/guarding Node-only usage in `src/ui/renderer.ts`.

## Risk notes
- If the layout group is filtered by priority, ensure it has a visible priority.
- Reset must restore computed height and not leave stale clamp.
- Adding command IDs without handlers will still error; ensure both are wired.

## Validation
- `npm start` (manual: click + / - / reset, confirm height changes and reset restores auto).
- Manual: click print preview and header/footer distance commands; ensure no unknown-command errors.

## Rollback
1. `git checkout -- Plans/layout_tab.json src/api/editor_commands.ts src/api/command_map.ts src/ui/a4_layout.ts src/ui/renderer.ts`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: PASS
- Step 6: PASS
- Validation: FAIL (`npm start` logs portal error: org.freedesktop.portal.Desktop)
