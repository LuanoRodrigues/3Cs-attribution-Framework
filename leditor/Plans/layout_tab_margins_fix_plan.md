# layout_tab_margins_fix_plan.md — Fix Layout Tab Margin Commands

## Goal
Ensure Layout tab controls for Margins, Orientation, and Size dispatch valid commands with required arguments so they no longer throw and correctly update the A4 layout.

## Success criteria
1. Layout tab buttons no longer call `SetPageMargins`/`SetPageOrientation`/`SetPageSize` without arguments.
2. Each control provides explicit menu items with command args for presets.
3. Clicking a menu item updates layout state without throwing.

## Constraints
- Use declarative JSON (`Plans/layout_tab.json`) as the source of truth.
- Avoid adding silent defaults in command handlers.
- Keep collapse behavior intact.

## Scope
- `Plans/layout_tab.json`
- `Plans/EXECUTION_INDEX.md`
- `Plans/layout_tab_margins_fix_plan.md`

## Steps
1. Update Layout tab controls to dropdowns with menu items that include required command args.
2. Align icon keys with existing ribbon icon names (margin/orientation/pageSize).
3. Validation via `npm start` (manual).

## Validation
- `npm start` and use Layout tab menus; confirm no console error and layout updates.

## Rollback
1. `git checkout -- Plans/layout_tab.json`
2. `git checkout -- Plans/layout_tab_margins_fix_plan.md`

## Progress
- Step 1 — Update controls with menu args: PASS
- Step 2 — Align icon keys: PASS
- Step 3 — Validation: FAIL (npm start timed out; Electron portal error)
