# Plans/tab_source_fix_plan.md — View Tab Source Map Fix

## Goal
Ensure the ribbon loader recognizes `view.json` so the View tab defined in `Plans/ribbon.json` materializes without runtime errors.

## Success criteria
1. `renderRibbonLayout` can resolve `view.json` via `TAB_SOURCE_MAP`, allowing all tabs declared in `Plans/ribbon.json.tabs[]` to render.
2. Runtime no longer throws “Tab source not found: view.json” when launching the renderer.
3. `npm run test:docx-roundtrip` still passes after the change.

## Constraints
- Must keep `Plans/tab_source_fix_plan.md` format-compliant.
- Changes limited to ribbon metadata/config and loader logic; no new UX features.
- Follow existing AGENTS.md instructions about non-destructive editing and plan-based execution.

## Scope
- `Plans/ribbon.json`
- `src/ui/ribbon_layout.ts`
- `Plans/tab_source_fix_plan.md`

## Steps
1. Add `view.json` to `TAB_SOURCE_MAP` so the loader knows where to fetch the View tab metadata. (files: `src/ui/ribbon_layout.ts`)
2. Re-run `npm run test:docx-roundtrip` to confirm the runtime change is stable and no new regressions appear. (command: `npm run test:docx-roundtrip`)

## Risk notes
- Missing any tab entry in `TAB_SOURCE_MAP` will immediately throw; keep the map in sync with `Plans/ribbon.json`.
- Binding order matters; ensure map additions do not break existing tab load sequencing.

## Validation
- `npm run test:docx-roundtrip`

## Rollback
- `git checkout -- src/ui/ribbon_layout.ts Plans/tab_source_fix_plan.md`

## Progress
- Step 1 (TAB_SOURCE_MAP update): PASS
- Step 2 (`npm run test:docx-roundtrip`): PASS
