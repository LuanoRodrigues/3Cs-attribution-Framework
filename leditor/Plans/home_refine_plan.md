# HOME Tab Refinement Plan — Collapse, Layout, Icons, Commands

## Goal
Refine the HOME ribbon tab so groups honor Word-like horizontal growth (bounded vertical rows), wire real editor commands for all HOME controls, and correct missing/mismatched icons for Paragraph, Styles, and Editing.

## Success Criteria
1. Clipboard, Font, Paragraph, Styles, and Editing groups render with horizontal growth and ≤5 rows; Clipboard uses two rows; Font first row hosts font family and size dropdowns with “Times New Roman” default.
2. All HOME controls dispatch real editor commands (no placeholders/aliases); dispose/unmount cleans up collapse/flyout listeners without leaks.
3. Paragraph, Styles, and Editing controls display valid icons consistent with plan icon keys.
4. Stage A/B/C collapse and flyout remain functional after layout changes.

## Constraints
- Must follow AGENTS.md: schema-driven ribbon, no defensive fallbacks, fail-fast on missing config/icon.
- Desktop Electron, offline; no network features.
- Keep rows ≤5; prioritize horizontal expansion before new rows.
- Preserve plan-driven rendering from `Plans/home.json` and `ribbon_layout`.

## Scope (files)
- src/ui/ribbon_layout.ts
- src/ui/ribbon_icons.ts
- src/ui/ribbon.css
- src/ui/ribbon.ts (only if wiring hooks is required)
- Plans/home_plan.md (progress updates)

## Steps
1) Layout rows per group  
   - Update `ribbon_layout.ts` to respect `maxRows` per group (hardcode: Clipboard 2, Font 3, Paragraph 3, Styles 2, Editing 1–2) with horizontal fill before row break.  
   - Add CSS to allow horizontal growth and cap vertical rows; ensure group height tokens stay stable.
2) Clipboard row composition  
   - Render Paste column + secondary column split into two rows (Cut/Copy/Format Painter on row1; Undo/Redo on row2); ensure collapse directives persist.
3) Font row composition  
   - Row1: Font family combobox (default “Times New Roman”), Font size spinner; row2/3: toggles and color/case/clear buttons; align to icon sizes.  
   - Wire true commands (`FontFamily`, `FontSize`, underline variants if available).
4) Paragraph & Styles icons/commands  
   - Map missing icons to valid RibbonIconName entries; ensure list/alignment/spacing/borders/blockquote/HR use correct command IDs (no aliases).  
   - Verify Styles gallery buttons use appropriate style icons or placeholders; keep within 2 rows.
5) Editing icons & commands  
   - Add valid icons for Find/Replace/Select; ensure command wiring matches editor (SearchReplace for find/replace; selection commands if exposed).  
   - Keep layout to 1 row unless overflow; validate collapse.
6) Disposal & collapse integrity  
   - Ensure collapse/flyout listeners and ResizeObserver are cleaned on unmount; keep Stage A/B/C behavior after row limits.
7) Validation  
   - Manual: resize ribbon through breakpoints to confirm A/B/C; verify row caps.  
   - Automated: run existing ribbon build (if present) and lint; smoke run of Electron renderer if available.

## Risk Notes
- Missing editor command IDs for some menu items could still exist; will fail-fast; may need to stub or surface TODO.
- Layout row logic could mis-measure heights; mitigate with CSS grid and explicit row-gap.
- Icon mapping might conflict with existing names; ensure additions don’t break other tabs.

## Validation
- `npm test` (if available) or `npm run lint` (if available).  
- Manual ribbon render in dev build: verify row counts and icons; resize to trigger collapse A/B/C.

## Rollback
- Revert touched files: `git checkout -- src/ui/ribbon_layout.ts src/ui/ribbon_icons.ts src/ui/ribbon.css src/ui/ribbon.ts Plans/home_plan.md`  
- If build breaks, restore previous bundle or disable ribbon via feature flag.

## Progress
- [x] Step 1
- [x] Step 2
- [x] Step 3
- [x] Step 4
- [x] Step 5
- [x] Step 6
- [x] Step 7
