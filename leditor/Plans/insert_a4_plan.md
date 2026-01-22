# Insert → A4 Integration Plan

## Goal
Improve the INSERT tab so its dropdown controls show meaningful icons/default values and every Insert command is wired through the ribbon renderer into the A4 layout (page breaks, tables, illustrations, headers/footers, etc.) so the tab can actually manipulate the academic sheet.

---

## Success Criteria
1. Every dropdown/split-button in `Plans/insert.json` has a defined icon that matches its intent, there is no fallback “?” glyph, and the default tooltip/size stays consistent even if the command has no label text.
2. The ribbon renderer emits the expected `insert.*` command IDs with the right payloads whenever a control is triggered (gallery/tables/cover dialogs) so that the editor command map receives them.
3. The A4 layout (page surface) listens for the same `insert.*` commands and applies the matching actions (cover/blank page, page break, table insertion, header/footer edits) so dragging/dropping, resizes, and collapsed states remain synchronized.
4. Manual verification of page break and table workflows (within the A4 document shell) succeeds: clicking the INSERT controls produces the expected structural change in the editor surface, and the layout engine does not throw.

---

## Constraints
- Follow the AGENTS instructions: schema-driven ribbon, no direct DOM hacks, no remote/eval HTML, and keep all content transactional.
- Desktop-first (Electron) requirement persists: rely on local `A4sheet` layout code and renderer entry points.
- Do not touch `dist/` or generated bundles; work only in `src/` and `Plans/`.

---

## Scope
- `Plans/insert.json` (icon keys, dropdown metadata)
- `src/ui/ribbon_icons.ts` (icon mapping and placeholders)
- `src/ui/ribbon_controls.ts` (dropdown defaults)
- `src/ui/ribbon_layout.ts` (control building and command dispatch)
- `src/api/editor_commands.ts` (ensure insert command IDs route to the renderer)
- `src/ui/a4_layout.ts` and `src/ui/layout_engine.ts` (A4 sheet handling of insert command payloads)
- `src/ui/ribbon.ts` (event wiring between ribbon and renderer hooks)
- `src/ui/ribbon.css` / `src/ui/toolbar_styles.ts` (visual defaults for dropdown controls where needed)

---

## Steps
1. **Assign explicit icons/defaults per control.**  
   - Files: `Plans/insert.json`, `src/ui/ribbon_icons.ts`, `src/ui/ribbon.css`.  
   - Target: Update `Plans/insert.json` entries that currently omit `iconKey` so each dropdown/control has a meaningful icon (e.g., command-specific lumens), and extend `ribbon_icons.ts` with the required glyphs or typography tokens instead of the “?” placeholder.  
2. **Centralize dropdown defaults.**  
   - File: `src/ui/ribbon_controls.ts`.  
   - Target: Give `createRibbonDropdownButton` a deterministic default icon/tooltip (e.g., `chevronDown`), ensure dropdown labels do not render a separate “?” icon, and expose a hook so ribbon_layout can override the icon without re-creating buttons.  
3. **Guarantee ribbon_layout propagates the right icon/payload/command.**  
   - File: `src/ui/ribbon_layout.ts`.  
   - Target: When building dropdown/split-button controls for insert, pass the resolved icon and any default args (e.g., `insert.table.openGridPicker` should include row/col defaults) so the generated buttons never rely on fallback icons and always emit payloads matching `Plans/insert.json`.  
4. **Connect commands to the A4 surface.**  
   - Files: `src/ui/ribbon.ts`, `src/api/editor_commands.ts`, `src/ui/a4_layout.ts`, `src/ui/layout_engine.ts`.  
   - Target: Ensure dispatcher hooks in `renderRibbon`/`RibbonStateBus` observe the inserted commands and forward them to A4 layout handlers (e.g., `insert.pageBreak`, `insert.table.apply`, `insert.coverPage.default`). Add listeners or a command registry in `a4_layout` that performs the real DOM change and updates layout context.  
5. **Document and verify the flow.**  
   - Files: `Plans/insert_a4_plan.md`, `src/ui/ribbon_layout.ts` (via inline comments) and `Plans/insert.json`.  
   - Target: Add short comments describing the mapping (command → A4 action), revise `Plans/insert.json` if necessary, and outline manual smoke tests for page break/table/cover in the plan’s risk/validation sections.

---

## Risk notes
- Icon misalignment might look wrong in Word-style UI; confirm new glyphs match the rest of the ribbon.
- A4 layout might not expose every editor command yet, so wiring may throw; guard dispatchers with `try/catch` only if necessary and log missing handlers.
- Changing dropdown defaults could disrupt keyboard navigation; double-check focus stays on the menu button.

---

## Validation
- `npm run test:docx-roundtrip`
- Manual user story: open Insert tab, click Page Break, insert table, add cover page, and verify the A4 canvas updates without console errors.

---

## Rollback
1. `git checkout -- src/ui/ribbon_icons.ts src/ui/ribbon_controls.ts src/ui/ribbon_layout.ts src/ui/ribbon.ts src/api/editor_commands.ts src/ui/a4_layout.ts src/ui/layout_engine.ts src/ui/ribbon.css src/ui/toolbar_styles.ts Plans/insert.json`
2. `git reset --hard HEAD`

---

## Progress
- Step 1 — Assign explicit icons/defaults: NOT STARTED
- Step 2 — Centralize dropdown defaults: NOT STARTED
- Step 3 — Ribbon layout propagation: NOT STARTED
- Step 4 — Command wiring to A4: NOT STARTED
- Step 5 — Documentation & verification: NOT STARTED
