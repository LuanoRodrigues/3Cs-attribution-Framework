# Plans/ribbon_height_plan.md — Fixed Ribbon Height & Horizontal Growth

## Goal
Enforce a stable, Word-like ribbon height so every tab (Home, Insert, View, etc.) renders with identical vertical space regardless of how many controls each group contains while allowing group clusters to extend horizontally instead of wrapping into taller stacks.

## Success criteria
1. Each ribbon panel honors `var(--r-panel-height)` as an exact height (not merely a minimum), and the panel content uses overflow-x rather than expanding vertically.
2. Group containers fill the fixed panel height without forcing the panel to grow, and cluster rows stop wrapping vertically, flowing horizontally when more controls are added.
3. The renderer still boots cleanly, and `npm run test:docx-roundtrip` passes after the layout adjustments.

## Constraints
- Must not violate the existing AGENTS instructions (plan-based execution, non-destructive edits, no eval, etc.).
- Fixed height behavior must be driven entirely by CSS layout properties; no inline styles injected at runtime except for the marker dataset described below.
- All changes must be compatible with the existing ribbon collapse/overflow logic (no new commands or control wiring).

## Scope
- `src/ui/ribbon.css` (panel height, group alignment, cluster behavior).
- `src/ui/ribbon_layout.ts` (tagging the host so the CSS can rely on a fixed-height marker).
- This plan file (`Plans/ribbon_height_plan.md`).

## Steps
1. Update `src/ui/ribbon.css` to make `.leditor-ribbon-panel` a fixed-height container, ensure `.leditor-ribbon-groups`/`.leditor-ribbon-group` stretch without growing vertically, and keep the height token centralized inside the `.leditor-ribbon-host[data-ribbon-fixed-height="true"]` scope. (Files: `src/ui/ribbon.css`.)
2. Adjust the cluster-level rules in `src/ui/ribbon.css` so row-oriented clusters no longer wrap vertically but instead allow overflowing controls to extend horizontally. (Files: `src/ui/ribbon.css`.)
3. Modify `src/ui/ribbon_layout.ts` so `renderRibbonLayout` marks the host via `dataset.ribbonFixedHeight = "true"`, enabling the CSS selector from Step 1. (Files: `src/ui/ribbon_layout.ts`.)
4. Validate by running `npm run test:docx-roundtrip` to ensure the renderer still builds correctly with the new layout. (Command: `npm run test:docx-roundtrip`.)

## Risk notes
- Horizontal overflow might hide controls if the ribbon width is limited; confirm there is still an overflow indicator (scroll or collapse/flyout) so users can reach wrapped items.
- Wired dataset changes must remain in sync with CSS selectors; forgetting to set `data-ribbon-fixed-height` would revert to the old layout.

## Validation
- `npm run test:docx-roundtrip`

## Rollback
- `git checkout -- src/ui/ribbon.css src/ui/ribbon_layout.ts Plans/ribbon_height_plan.md`

## Progress
- Step 1 (fixed-height panel/CSS scope): PASS
- Step 2 (cluster horizontal growth): PASS
- Step 3 (layout hook in ribbon_layout): PASS
- Step 4 (run docx test): PASS
