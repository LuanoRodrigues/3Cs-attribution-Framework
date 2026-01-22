# Insert Tab Menu Enhancements Plan

## Goal
Bring the INSERT tab implementation fully in line with `Plans/insert_plan.md` by extending the ribbon renderer so the gallery, custom table picker, dynamic add-in list, and media/embed affordances defined in `Plans/insert.json` render reliably inside the Electron ribbon.

---

## Success Criteria
1. The ribbon menu builder accepts the extra `gallery`, `custom`, `dynamic`, and `sectionHeader` menu types referenced by `Plans/insert.json` without throwing and dispatches the configured commands.
2. The table grid picker widget (payload `rows`/`cols`) highlights the hovered selection, dispatches the command when a cell is clicked, and closes the menu afterwards.
3. Gallery menus show meaningful entries (cover templates, shape/word-art presets, header/footer/equation samples) built from `getTemplates()` and curated lists, and their CSS matches the new `.rgallery` spec.
4. Dynamic add-ins populate from `window.leditorHost?.getInstalledAddins` (with a safe fallback), and the menu shows a message when no add-ins are provided.
5. The new CSS for gallery, table picker, embed dialog, and menu headers integrates with the existing ribbon styles without breaking other tabs.

---

## Constraints
- Follow the AGENTS instructions: work inside the Electron ribbon renderer, drive everything from schema-based JSON (`Plans/insert.json`), and keep the experience desktop/offline and free of remote HTML injection or eval.
- Do not invent new editor engines or swap out ProseMirror; `renderRibbonLayout` must remain the transaction-driven entry point.
- Preserve existing build artifacts; do not touch `dist/` or generated files.

---

## Scope
- `src/ui/ribbon_layout.ts` (menu builder, dynamic sources, table grid widget, gallery providers)
- `src/ui/ribbon.css` + `src/ui/toolbar_styles.ts` (gallery/table/menu styling and embed textarea styles)
- `src/types/global.d.ts` (optional host API for add-in discovery)

---

## Steps
1. **Extend the menu builder to support gallery, custom, dynamic, and section-header entries.**
   - File: `src/ui/ribbon_layout.ts` near `buildMenu`/`buildControl`
   - Target: new helpers for `gallery` items (looping through provider data, binding to `item.command`), `custom` widgets, `dynamic` sources, and `sectionHeader` cards.
   - Ensure each helper closes the menu after dispatch and that mapped `controlId`s from `Plans/insert.json` have a provider.
2. **Implement the table grid picker widget used by `tables.gridPicker`.**
   - File: `src/ui/ribbon_layout.ts`
   - Target: `createTableGridPicker` helper that renders a 10×8 grid, updates `data-active`, shows a summary label, and invokes the `insert.table.apply` command with `{ rows, cols }` on click.
3. **Hook up gallery data providers and dynamic add-in sources, including host typing.**
   - Files: `src/ui/ribbon_layout.ts`, `src/types/global.d.ts`
   - Target: provider registry keyed by `controlId` (cover templates from `getTemplates()`, shapes/word art/header/footer/equation presets) and a fallback for missing data; add `window.leditorHost?.getInstalledAddins` (and optional `installedAddins` list) so the dynamic menu can resolve.
4. **Add styling for the new gallery/picker/menu headers and embed textarea.**
   - Files: `src/ui/ribbon.css`, `src/ui/toolbar_styles.ts`
   - Target: `.rgallery`, `.rtablePicker`, `.rtablePicker__grid`, `.rembed`, `.leditor-menu-section-header`, and any related helpers so the new widgets look cohesive with the Ribbon.

---

## Risk notes
- Gallery or picker markup may steal focus from existing menu items; verify keyboard navigation still works and the menu closes after selection.
- dispatching commands with wrong payloads could throw; double-check each provider supplies the expected schema (e.g., `{ templateId }`, `{ rows, cols }`).
- Dynamic add-in API is currently undefined; if it returns unexpected shapes the menu should degrade gracefully (show a placeholder instead of crashing).

---

## Validation
- `npm run test:docx-roundtrip` (verifies ribbon rendering and command wiring do not break the existing docx round-trip smoke test)

---

## Rollback
1. `git checkout -- src/ui/ribbon_layout.ts src/ui/ribbon.css src/ui/toolbar_styles.ts src/types/global.d.ts`
2. `git reset --hard HEAD`

---

## Progress
- Step 1 — Extended menu builder: PASS
- Step 2 — Table grid picker widget: PASS
- Step 3 — Gallery/dynamic providers & host API: PASS
- Step 4 — Gallery/picker/menu/embedding CSS: PASS
