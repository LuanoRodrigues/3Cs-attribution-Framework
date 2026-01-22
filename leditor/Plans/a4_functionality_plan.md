# a4_functionality_plan.md — Ribbon → A4 Layout Command Verification

## Goal
Confirm every ribbon control that is supposed to affect the A4 layout surface (margins, page size/orientation, columns, pagination, layout view toggles, etc.) actually updates the underlying `layout_settings` / `layout_engine` state so that the rendered A4 page and CSS variables respond deterministically in Electron.

## Success criteria
1. Every margin/orientation/column control dispatches a known `EditorCommandId` that reaches the layout controller (`layout_context`, `layout_engine`, `layout_settings`) and mutates the visible document shell accordingly.
2. Orientation switches update the DOM (`A4LayoutController` state, CSS vars) so that the A4 surface is re-rendered in the new orientation without needing a restart.
3. Margin, column-count, page size and layout toggles update the per-page CSS variables defined in `layoutPlan.tokens` (e.g., `--page-width-mm`, `--page-margin-*`) and keep the `layout-engine` pagination in sync.
4. No ribbon layout control wired to A4/margins/orientation is left untested; inspection or instrumentation covers each control referenced in `Plans/layout.json`, `Plans/home.json`, and `Plans/insert.json`.
5. Any automation or manual verification includes cross-checking the ribbon plan metadata, ensuring config-driven collapse behavior does not mute functionality.

## Constraints
- Operate inside the existing repository (`leditor`) without changing external infrastructure.
- Focus on checking wiring and observable layout updates; do not implement new editor features.
- Maintain schema-driven layout rules from `Plans/layout.json` and per-tab JSON; missing configuration must remain treated as fatal.
- No plan execution or instrumentation should require network access or remote tooling (Electron must run locally via `npm start` if needed).
- Observe AGENTS.md rule: plan must stay within AGENTS definitions, referencing only writable files under `Plans/` and `src/ui/`.

## Scope
- Files to inspect/modify in support of the plan:
  - `Plans/layout.json`, `Plans/home.json`, `Plans/insert.json`
  - `src/ui/ribbon.ts`
  - `src/ui/ribbon_layout.ts`
  - `src/ui/layout_settings.ts`
  - `src/ui/layout_context.ts`
  - `src/ui/layout_engine.ts`
  - `src/ui/a4_layout.ts`, `src/ui/a4_layout.ts`
  - `src/ui/view_state.ts` (if layout toggles routed here)
  - `src/ui/layout_settings.ts`
  - `src/api/editor_commands.ts` (ensure commands exist)

## Steps
1. **Inventory ribbon-to-layout controls**: catalog every ribbon control (Home/Insert groups) described in `Plans/layout.json` + per-tab JSON whose `command.id` or `state.binding` maps to layout-relevant commands (margins, page size, orientation, columns, layout view flags). Reference the files `src/ui/ribbon_layout.ts`, `Plans/home.json`, `Plans/insert.json` for this mapping and mark any missing `collapse` metadata that may impact functionality.
2. **Trace dispatch→layout bindings**: for each command identified in Step 1, follow its implementation in `src/api/editor_commands.ts` (and the actual command handler definitions) to ensure it updates `layout_settings` (e.g., `setMarginValues`, `setOrientation`) or other `layout_context` helpers. Document cases where a command is missing or updates different subsystem.
3. **Verify layout settings reactivity**: inspect `src/ui/layout_settings.ts`, `layout_context.ts`, `layout_engine.ts`, and `a4_layout.ts` to understand how CSS variables and pagination respond to state changes (margin/orientation/columns). Plan instrumentation or assertions (e.g., via `window.codexLog` or explicit DOM queries) to confirm that when commands fire, the expected CSS vars (`--page-width-mm`, `--page-height-mm`, `--page-margin-*`) change and `getLayoutController().updatePagination()` is invoked.
4. **Map orientation/margins to DOM output**: identify the DOM selectors/attributes (e.g., `.leditor-page`, `:root` vars) that should update for orientation/margin changes. Plan to capture before/after snapshots via either automated DOM reads (via Puppeteer or manual devtools) or logs when manually exercising `document.documentElement.style` updates.
5. **Define manual/automated verification steps**: write detailed instructions for running `npm start`, opening the ribbon, interacting with the relevant buttons/dropdowns, and observing the A4 layout changes (margins shrink/expand, orientation flips). Include margin combinations (top/right/bottom/left), orientation toggles, and column changes. Specify how to observe the layout engine's reaction (e.g., console logs, finite state checks).
6. **Plan regression coverage**: if possible, outline how to capture telemetry via existing `window.codexLog` or adding temporary instrumentation to log `layout` events, enabling a checklist that each button produces the expected `layout` log entry. Map those checks back to the planned `Verification Checklist` (a table or list enumerating each button/command and expected layout effect).

## Risk notes
| Risk | Mitigation |
|---|---|
| Controls dispatch commands that no longer affect layout state due to API drift. | Verify command map (`editor_commands.ts`) and add documentation/logs checking `dispatchCommand` arguments. |
| CSS variables or pagination updates fail silently when `layout_engine.refreshLayoutView` isn’t triggered. | Instrument `layout_engine.ts` to log or assert when pagination updates start/end; include fallback manual check (page visibly resizes). |
| Orientation/margin commands mutate global state but the ribbon collapse pipeline hides relevant controls. | Include `Plans/layout.json` collapse metadata in the checklist to ensure each control remains reachable at Stage A/B/C. |
| Running Electron locally for manual testing may be time-consuming. | Prepare pre-checklist of quick Chrome devtools steps (document root checks, margin highlight) to make testing efficient. |

## Validation
- `npm start` while recording devtools console output; interact with every A4-related ribbon control and confirm console/instrumentation logs show the expected `layout` mutation and CSS var updates.
- (Optional) Scripted DOM snapshot: run `npx playwright test` or `node scripts/check_layout.js` (if created) that toggles commands via the command API and asserts CSS var differences.

## Rollback
1. `git checkout -- src/ui/ribbon_layout.ts src/ui/layout_settings.ts src/ui/layout_engine.ts src/ui/a4_layout.ts src/ui/ribbon.ts`
2. `git checkout -- Plans/a4_functionality_plan.md`

## Progress
- Step 1 — Inventory controls: PASS
- Step 2 — Trace dispatch bindings: PASS
- Step 3 — Verify layout settings reactivity: PASS
- Step 4 — Map DOM output: PASS
- Step 5 — Define verification steps: PASS
- Step 6 — Plan regression coverage: PASS
