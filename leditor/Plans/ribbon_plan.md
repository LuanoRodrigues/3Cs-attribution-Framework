# Plans/ribbon_plan.md — Ribbon Rebuild Execution Plan (Electron)

## Goal
Implement the Phase A1 baseline Word-like ribbon shell inside `src/ui` so that the tab strip, panels, and group scaffolding are rendered exactly as described by `Plans/ribbon.json`, with the CSS tokens, icons, and keyboard/ARIA expectations laid out in the spec.

## Success criteria
1. Tabs are sourced from `Plans/ribbon.json.tabs[]`, use `tabId`/`label`, and their panels load content from the JSON `source` value (defaulting to placeholders when the file does not yet exist).
2. The initial active tab equals `defaults.initialTabId` and is persisted/restored safely via `RibbonRoot` (currently `home`).
3. The tab strip/panel HTML structure uses `role="tablist"`, `role="tab"`, `role="tabpanel"` plus roving tabindex/Arrow/Home/End handling matching Word’s keyboard model implemented inside `src/ui/ribbon_primitives.ts#RibbonTabStrip`.
4. Ribbon layout tokens (tab strip height, panel height, group spacing, icon sizing) mirror the CSS variables in the spec and are applied inside `src/ui/ribbon.css` so that the ribbon renders at stable proportions across 1024–1920 px widths.
5. A deterministic group scaffold exists inside each active panel (group container with header/footer) even if individual controls are placeholders; collapse stage placeholders reference `defaults.collapseStages`.

## Constraints
- Must not execute repository-changing work until this plan is under `Plans/`. Already satisfied by this file.
- All tab/default data must come from `Plans/ribbon.json`; no hardcoded tab lists or collapse stage timelines outside the JSON.
- No editor command wiring beyond stubs in Phase A1; commands remain placeholders until Phase A4.
- Changes must preserve existing manual `renderRibbon` behavior (placeholder logging etc.).

## Scope
- `Plans/ribbon.json` (read-only reference but may be touched if tab metadata needs clarifying).
- `src/ui/ribbon.ts` (renderRibbon entry point per `Plans/ribbon.json`).
- `src/ui/ribbon_primitives.ts` (RibbonRoot/TabStrip/TabPanel keyboard and ARIA scaffolding).
- `src/ui/ribbon_placeholder.ts` (tab/panel placeholder wiring to new JSON-derived tab definitions).
- `src/ui/ribbon.css` (CSS tokens, tab strip height, panel height, group spacing, icon sizing guidance).
- This plan file itself (`Plans/ribbon_plan.md`).

## Steps
1. Align the tab metadata loader inside `src/ui/ribbon.ts#renderRibbon` with `Plans/ribbon.json` so tab definitions (tabs array, defaults) are read at runtime rather than hardcoded; include logging that references `ribbonPlan.json` values for future phases (files: `src/ui/ribbon.ts`, `Plans/ribbon.json`).
2. Update `src/ui/ribbon_placeholder.ts#createPlaceholderPanel` + `renderRibbonPlaceholder` so that each tab panel respects the `source` file (loading actual DOM or placeholder) while still creating the `RibbonTabDefinition`, and ensure the placeholder scaffolding exposes `defaults.collapseStages` for later wiring (files: `src/ui/ribbon_placeholder.ts`, `src/ui/ribbon.ts`).
3. Harden the keyboard/ARIA/token layout in `src/ui/ribbon_primitives.ts` so the TabStrip/TabPanel matches the success criteria (roles, roving tabindex, default active tab per `defaults.initialTabId`, persistence) and emits hooks for `defaults.collapseStages` (files: `src/ui/ribbon_primitives.ts`).
4. Apply the CSS tokens from the spec into `src/ui/ribbon.css` (tab strip/panel heights, group spacing, icon sizes) and ensure the ribbon class names used by the primitives share the same tokens so layout is stable in the 1024–1920 px range (file: `src/ui/ribbon.css`).

## Risk notes
- Keyboard focus could become unsynchronized if the TabStrip persists a tab ID not present in the loaded JSON; mitigate by falling back to the first tab when validation fails.
- CSS token changes may affect other UI; verify that the base ribbon styles continue to work with existing panels (particularly `ribbon-page-setup` grids).
- Placeholder panels must still render even if future `source` files are missing; ensure `createPlaceholderPanel` always produces DOM.

## Validation
- Run `npm run test:docx-roundtrip` after changes to catch runtime errors in Electron entry points (this counts as the deterministic validation after implementing Phase A1).

## Rollback
- `git checkout -- src/ui/ribbon.ts src/ui/ribbon_primitives.ts src/ui/ribbon_placeholder.ts src/ui/ribbon.css Plans/ribbon_plan.md`
- `git clean -fd Plans/PLAN_SHARDS` if Plan shards get created inadvertently (none are planned yet).

## Progress
- Step 1 (tab metadata loader in `src/ui/ribbon.ts`): PASS
- Step 2 (placeholder panel wiring to JSON `source`): PASS
- Step 3 (keyboard/ARIA `RibbonTabStrip` and hooks): PASS
- Step 4 (CSS tokens and layout stability): PASS
