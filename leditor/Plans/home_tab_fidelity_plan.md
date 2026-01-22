# Plans/home_tab_fidelity_plan.md — Home tab commands + Word-like layout

## Goal
Eliminate Home tab command errors by wiring every Home ribbon control to a valid command with proper payloads, and tighten the ribbon CSS so controls are spaced and laid out with Word-like padding and alignment.

## Success criteria
1. All Home tab commands execute without `LEditor.execCommand: unknown command` or `{ value }` payload errors when triggered from the ribbon.
2. Color split buttons (font color/highlight) apply a deterministic current color on primary click and honor palette selections.
3. Font size grow/shrink buttons adjust to the next/previous preset from the Home tab presets without throwing.
4. Styles menu actions have concrete handlers (apply/clear/set/open) that do not throw, with at least basic editor effects for apply/clear.
5. Ribbon controls no longer visually overlap; group/cluster spacing respects padding and gaps from `--r-panel-pad-x/y`.
6. Validation passes: `npm run test:docx-roundtrip`.

## Constraints
- Follow AGENTS.md (plan-based execution, no defensive silent fallbacks; use deterministic mappings).
- Keep schema-based editing (TipTap/ProseMirror only); do not add contenteditable hacks.
- Use existing command architecture (`command_map`, `editor_commands`, ribbon layout).

## Scope
- `src/ui/ribbon_layout.ts` (command mapping, payloadSchema handling, color palettes, font size grow/shrink wiring).
- `src/ui/ribbon.ts` (pass ribbon state bus into layout renderer).
- `src/ui/ribbon.css` (panel/group/cluster spacing to prevent overlap).
- `src/api/editor_commands.ts` (add new command IDs for styles + font size grow/shrink if needed).
- `src/api/command_map.ts` (implement style handlers and font size grow/shrink logic).
- This plan file (`Plans/home_tab_fidelity_plan.md`).

## Steps
1. Extend `src/ui/ribbon_layout.ts` to honor `payloadSchema` for menu items, update color palette parsing to read `palette.rows`, store/reuse last-picked colors for split buttons, and map Home-specific command IDs (`paste.textOnly`, `font.size.grow`, `font.size.shrink`, styles actions) to valid command IDs. (files: `src/ui/ribbon_layout.ts`)
2. Thread the ribbon state bus into the layout renderer so controls can read current font size/color when building payloads. (files: `src/ui/ribbon.ts`, `src/ui/ribbon_layout.ts`)
3. Add concrete command handlers for Home styles actions and font-size grow/shrink (using the Home preset list) so they do not throw. (files: `src/api/editor_commands.ts`, `src/api/command_map.ts`)
4. Adjust ribbon CSS spacing so controls are padded and don’t overlap (panel padding + cluster item sizing). (files: `src/ui/ribbon.css`)
5. Run `npm run test:docx-roundtrip` to validate that the renderer and command map remain stable. (command)

## Risk notes
- Incorrect payload schema handling can break existing menu items; keep it scoped to explicit payloadSchema usage.
- Style commands are minimal; they must still be deterministic and not silently ignore clicks.
- CSS padding changes can impact collapse thresholds; verify in ribbon layout after changes.

## Validation
- `npm run test:docx-roundtrip`

## Rollback
- `git checkout -- src/ui/ribbon_layout.ts src/ui/ribbon.ts src/ui/ribbon.css src/api/editor_commands.ts src/api/command_map.ts Plans/home_tab_fidelity_plan.md`

## Progress
- Step 1 (ribbon_layout command/payload fixes): PASS
- Step 2 (state bus wiring): PASS
- Step 3 (command_map + editor_commands handlers): PASS
- Step 4 (CSS spacing): PASS
- Step 5 (docx roundtrip test): PASS
