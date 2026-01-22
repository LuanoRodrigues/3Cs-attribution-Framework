# A4 Sheet Dependency Plan

## Goal
Prepare the underlying A4 sheet infrastructure so the INSERT tab can interact with the physical document surface (page breaks, blank pages, tables, headers/footers) by exposing a clear command bridge and any missing helpers in the A4 layout engine before wiring begins.

---

## Success Criteria
1. `src/ui/a4_layout.ts` and `src/ui/layout_engine.ts` expose an insert-friendly API that responds to `insert.*` commands with deterministic mutations (e.g., insert page, insert/remove break, render table placeholders, toggle header/footer editing).
2. All new helpers are consumable inside `renderRibbon` (e.g., via `layoutContext`) without requiring global mutations or extra ad-hoc listeners.
3. Dependency plan changes are validated via the same smoke test as the main plan (`npm run test:docx-roundtrip`) and documented within `Plans/a4sheet_dependency_plan.md`.

---

## Constraints
- Do not alter the ribbon renderer; work is limited to the layout/engine layer that feeds the A4 surface.
- Preserve the offline/security posture: no eval, remote data, or schema-breaking modifications.
- Keep `dist/` untouched; apply changes only in `src/ui` and supporting TypeScript files.

---

## Scope
- `src/ui/a4_layout.ts`
- `src/ui/layout_engine.ts`
- `src/ui/layout_context.ts`
- `src/ui/renderer.ts` (for wiring hooks if needed)
- `src/api/editor_commands.ts` (to ensure insert commands reach the layout)
- Any new helper files created under `src/ui` for A4 insert support

---

## Steps
1. **Audit current A4 layout capabilities.**  
   - Files: `src/ui/a4_layout.ts`, `src/ui/layout_engine.ts`, `src/ui/layout_context.ts`.  
   - Target: Document which insert actions (page break, tables, header/footer toggles) already exist and where new hooks need to be placed.  
   - Notes: The layout controller already exposes pagination updates, zoom/view modes, header/footer setters, and margin adjustments; there is no existing insert command bus, so we will add a router that calls these helpers plus the editor command map.
2. **Add A4 insert command handlers.**  
   - Files: `src/ui/a4_layout.ts`, `src/editor/footnote_manager.ts` (if needed).  
   - Target: Introduce a command registry or event bus inside the A4 layout that listens for `insert.*` actions (page break, table insert, header/footer edit) and mutates the document shell accordingly.  
3. **Expose layout hooks to the renderer.**  
   - Files: `src/ui/renderer.ts`, `src/ui/layout_context.ts`, `src/api/editor_commands.ts`.  
   - Target: Ensure the renderer exports the necessary callbacks so `renderRibbon` can capture the layout context and forward commands without traversing the DOM manually.  
4. **Document the dependency.**  
   - File: `Plans/a4sheet_dependency_plan.md`.  
   - Target: Update this plan with the new helper names/locations and share the manual verification steps (page break and table visibility) once the hooks are in place.

---

## Risk notes
- Adding command listeners inside the layout could clash with existing renderer commands (e.g., footnote insertion) if the bus is not isolated; validate via logging or `window.codexLog`.
- Layout mutations might require re-rendering the ribbon; ensure the separation between layout and ribbon is maintained.

---

## Validation
- `npm run test:docx-roundtrip`

---

## Rollback
1. `git checkout -- src/ui/a4_layout.ts src/ui/layout_engine.ts src/ui/layout_context.ts src/ui/renderer.ts src/api/editor_commands.ts`
2. `git reset --hard HEAD`

---

## Progress
- Step 1 — Audit current A4 capabilities: NOT STARTED
- Step 2 — Add A4 insert command handlers: NOT STARTED
- Step 3 — Expose layout hooks to renderer: NOT STARTED
- Step 4 — Document dependency: NOT STARTED
