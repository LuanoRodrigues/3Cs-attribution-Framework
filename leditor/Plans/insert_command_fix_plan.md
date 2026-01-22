# Insert Command Fix Plan

## Goal
Make every control in the INSERT ribbon tab dispatch a valid editor command without runtime errors, and fix overlapping/superposed INSERT controls so the tab renders with Word-like spacing.

## Success Criteria
1. Clicking any INSERT control (buttons, split buttons, dropdown menus) produces no “unknown command” or “requires { value }” console errors.
2. INSERT commands map to existing engine command IDs (`EditorCommandId`) with required payload defaults supplied (e.g., rows/cols for tables, value for colors).
3. INSERT group layout shows no overlapping buttons at Stage A/B; controls wrap/space consistently with Word-like ribbon density.
4. `npm run test:docx-roundtrip` completes without ribbon-related exceptions.

## Constraints
- Change only INSERT tab config and supporting ribbon code/CSS; do not touch Home/View behavior.
- Fail-fast remains: if a control cannot be mapped, raise a clear error containing the `controlId`.
- No changes to `dist/` outputs; edit source files under `src/` and `Plans/`.

## Scope (files)
- `Plans/insert.json`
- `src/ui/ribbon_layout.ts`
- `src/ui/ribbon_menu.ts`
- `src/ui/ribbon_controls.ts`
- `src/ui/ribbon.css`
- `src/api/editor_commands.ts` (type widening if needed for mapping)

## Steps
1. **Audit INSERT command IDs**  
   - File: `Plans/insert.json`, `src/api/editor_commands.ts`, `src/ui/ribbon_layout.ts`.  
   - Identify all insert controls whose `command.id` is not in `EditorCommandId` or current alias map.
2. **Add INSERT alias mapping**  
   - File: `src/ui/ribbon_layout.ts`.  
   - Extend `COMMAND_ALIASES` / resolver so each INSERT `command.id` maps to a valid `EditorCommandId` (e.g., page/section breaks → `InsertPageBreak`, table actions → `TableInsert`, media/illustrations → `InsertImage`, links → `Link`, bookmark/cross-ref → `InsertBookmark` / `InsertCrossReference`, comments → `InsertComment`, header/footer → `EditHeader`/`EditFooter`, placeholders → `InsertTemplate`).  
   - Emit a descriptive error if a control remains unmapped.
3. **Default payloads for INSERT controls**  
   - Files: `Plans/insert.json`, `src/ui/ribbon_controls.ts`, `src/ui/ribbon_layout.ts`.  
   - Ensure primary clicks and menu items supply required payload keys (`rows`, `cols`, `value`, etc.) so `LEditor.execCommand` doesn’t throw. Set conservative defaults (e.g., 2×2 table, color `#000`, font size 12pt).
4. **Fix INSERT layout overlap**  
   - File: `src/ui/ribbon.css`.  
   - Adjust flex/wrapping/gap for INSERT row clusters to prevent superposed buttons while keeping Word-like spacing (target INSERT group selectors only).
5. **Validation**  
   - Run `npm run test:docx-roundtrip`.  
   - Manual: click representative INSERT controls (pages, tables, pictures, media, links, header/footer, text, symbols) at Stage A/B widths and confirm no console errors and no overlapping controls.

## Risk Notes
- Over-mapping to a generic command (e.g., `InsertImage`) may not match user intent; document unmapped items via thrown errors.
- CSS tweaks might alter Home/View; keep selectors scoped to INSERT groups.

## Validation
- `npm run test:docx-roundtrip`
- Manual INSERT smoke click (no console errors)

## Rollback
```bash
git checkout -- Plans/insert.json src/ui/ribbon_layout.ts src/ui/ribbon_menu.ts src/ui/ribbon_controls.ts src/ui/ribbon.css src/api/editor_commands.ts
git reset --hard HEAD
```

## Progress
- Step 1 — Audit INSERT command IDs: PASS
- Step 2 — Add INSERT alias mapping: PASS
- Step 3 — Default payloads for INSERT controls: PASS
- Step 4 — Fix INSERT layout overlap: PASS
- Step 5 — Validation: PASS
