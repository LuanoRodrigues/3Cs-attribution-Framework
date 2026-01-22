# A4 Layout Command Verification Notes

## Step 1 — Inventory of layout controls
- **Page setup row**: the dedicated layout panel exposes Margins, Orientation, Size, Columns, Breaks, Line numbers, and Hyphenation dropdowns, plus paragraph indent/spacing shortcuts for density control. Each control lives inside `createPageSetupGroup`/`createParagraphLayoutGroup` so it is always rendered inside the Layout tab (`src/ui/ribbon.ts:2023–2333`).
- **Margins**: `SetPageMargins` is triggered from a stacked dropdown (`createMarginsDropdown`) with preset and custom values; the menu resyncs whenever `subscribeToLayoutChanges` fires, ensuring the UI reflects the layout state (`src/ui/ribbon.ts:2023–2069`).
- **Size/Orientation/Columns**: `SetPageSize`, `SetPageOrientation`, and `SetSectionColumns` each dispatch via stacked dropdowns (custom prompts included) that read the current CSS-backed state through `getCurrentPageSize`, `getOrientation`, and `getLayoutColumns` (`src/ui/ribbon.ts:2085–2190`).
- **Breaks, Line numbers, Hyphenation**: small drop-downs call `InsertPageBreak`, `SetLineNumbering`, and `SetHyphenation`, respectively, providing quick access to pagination helpers without extra collapse metadata (`src/ui/ribbon.ts:2193–2277`).
- **Paragraph spacing/indent**: the supplementary paragraph group wires `SpaceBefore`, `SpaceAfter`, and `SetParagraphIndent` (via spinner controls) directly into ribbon commands so A4-specific spacing adjustments sit inside the same panel (`src/ui/ribbon.ts:2304–2333`).

## Step 2 — Trace dispatch → layout bindings
| Command | Command handler | Layout/system update | Notes |
| - | - | - | - |
| `SetPageMargins` | `src/api/command_map.ts:1116–1138` | calls `tiptap.commands.setPageMargins` then `layout?.setMargins` (falling back to `setPageMargins` when the controller is unavailable) | ensures CSS vars update and layout controller margins are in sync. |
| `SetPageOrientation` | `src/api/command_map.ts:1140–1154` | tiptap orientation API plus `setPageOrientation` (which writes to the shared layout state) | toggles width/height axes in the same state that drives `applyLayoutStyles`. |
| `SetPageSize` | `src/api/command_map.ts:1155–1167` | tiptap page-size hook then `setPageSize` with optional overrides | updates `layoutState.pageSize` and notifies listeners of the new physical dimensions. |
| `SetSectionColumns` | `src/api/command_map.ts:1168–1182` | tiptap columns API then `setSectionColumns` | changes the `layoutState.columns` count/mode for two- and three-column layouts. |
| `SetLineNumbering` | `src/api/command_map.ts:1183–1193` | tiptap line-numbering (no layout settings update) | still part of layout panel but routes entirely through TipTap. |
| `SetHyphenation` | `src/api/command_map.ts:1194–1203` | tiptap hyphenation (no layout state update) | mirrors Word interactions but relies on the editor’s hyphenation support. |

## Step 3 — Layout settings reactivity
- `layout_settings.ts` keeps `layoutState` with orientation, margins, page size, and column counts; `withLayoutUpdate` wraps each setter so `notifyLayoutChange` calls `applyLayoutStyles` and fires all subscribers (`src/ui/layout_settings.ts:32–112`).
- `applyLayoutStyles` writes `--page-width-mm`, `--page-height-mm`, and margin CSS variables as centimeter strings, while maintaining inside/outside analogues (`src/ui/layout_settings.ts:32–82`).
- `refreshLayoutView` (used by the renderer via `subscribeToLayoutChanges`) reruns `applyPageSizeVariables` and `applyMarginVariables`, then updates the A4 layout controller’s pagination so DOM and pagination stay synchronized (`src/ui/layout_engine.ts:7–31`).
- The renderer wires `subscribeToLayoutChanges(() => refreshLayoutView())` inside `renderer.ts`, guaranteeing every layout state change triggers CSS variable updates before returns to the layout surface.

## Step 4 — DOM / CSS anchors for verification
- The A4 surface defines default `:root` variables for page dimensions, margins, column gaps, and shadows, so layout updates always override these tokens rather than manipulating inline styles (`src/ui/a4_layout.ts:60–140`).
- `layout_settings.ts` and `layout_engine.ts` cooperate to mirror the same names (`--page-width-mm`, `--page-margin-top`, etc.), so checking `document.documentElement.style.getPropertyValue("--page-margin-top")` before and after a command runs provides a deterministic signal that the ribbon control succeeded.
- Column count is surfaced through `--page-columns`, while orientation size flips swap width/height values when `applyLayoutStyles` calls `snapshotStateForListeners`, making the actual pixel reflow part of the same update cycle.

## Step 5 — Verification instructions
1. `npm start` to boot Electron (renderer bundle logs `[RibbonDebug] renderer mount`) and open devtools.
2. Open the Layout tab (Page Setup group) and interact with each dropdown:
   - Margins: choose “Narrow” and inspect `document.documentElement.style.getPropertyValue("--page-margin-top")` / `--page-margin-left` to confirm the values shrink to ~`0.5in`.
   - Size: pick “A3” or “Letter,” then verify `--page-width-mm` / `--page-height-mm` reflect the chosen preset (`getPageSizeDefinitions` also shows human-readable labels).
   - Orientation: toggle between Portrait/Landscape and observe the swap between width/height through CSS and the page grid transform.
   - Columns: switch to 2 or 3 columns; `--page-columns` should update and the document shell will reflow into multiple column tracks.
   - Breaks: insert repeated page/section breaks and ensure the layout controller prints additional pages (check `leditor-page` elements).
   - Line numbers / Hyphenation: run the dropdowns and confirm TipTap logs (via `[RIBBON_COMMAND] SetLineNumbering` / `SetHyphenation`) while the content reflows accordingly.
3. Each dropdown uses `dispatchCommand`, so the console should show `[RIBBON_COMMAND] SetPageMargins` (etc.) for every action (`src/api/editor_commands.ts:155–168`).
4. Track layout updates by polling CSS vars before/after commands; compare the DevTools Computed pane or run `document.documentElement.style.getPropertyValue("--page-width-mm")` to surface the change.

## Step 6 — Regression coverage plan
- Use `window.codexLog` messages as a lightweight telemetry bus: every ribbon control logs `[RIBBON_COMMAND] commandId`, and layout setters log the same update cycle, so filtering the console for those tags gives per-command coverage (`src/api/editor_commands.ts:155–168` and `src/api/command_map.ts:1116–1204`).
- Combine log inspection with CSS-var probes from Step 5 so each control has two assertions: (a) the logger reported the expected command and (b) the relevant `--page-*` variable changed in the expected direction.
- When automating checks in the future, a test can call `dispatchCommand` via a headless context (or the editor handle) and assert that `getMarginValues()`/`getCurrentPageSize()` agree with the requested values before returning the CSS snapshot.
