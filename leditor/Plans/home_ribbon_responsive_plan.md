Title: Home ribbon responsive polish
Created: 2026-01-21 00:00
Status: PLANNED
Plan File Path (must be saved as): Plans/home_ribbon_responsive_plan.md

Progress:
- [x] Phase 1 — Restructure Home panel rows + overflow hook (PASS)
- [x] Phase 2 — Add responsive CSS, ellipsis toggle, small-screen behavior (PASS)
- [ ] Phase 3 — Manual validation and deployment notes (PENDING)

## Goal
Ensure the Home ribbon mirrors a Word-style layout with dedicated Clipboard/Font, Paragraph, and Editing rows while staying horizontally aligned, then layer in responsive behavior so smaller screens collapse additional rows under an ellipsis toggle that reveals them on demand.

## Success criteria
1. Home panel renders exactly three `.leditor-ribbon-home-row` rows, each containing the right group(s), and keeps rows full-width with no vertical wrapping on desktop.
2. Small screens hide the Paragraph/Editing rows until the ellipsis button is tapped, at which point the hidden rows appear as stacked content while remaining aligned with the first row.
3. Ribbon CSS and helpers live inside `src/ui/ribbon.ts` and `src/ui/ribbon.css`, reusing existing grid utilities and honoring the current command dispatch/navigation architecture.

## Constraints
- Keep all UI wiring inside the existing ribbon helpers (`createRibbonGrid`, `createRibbonGridFromRows`) and continue dispatching through `dispatchCommand`.
- No third-party layout frameworks; rely on the current CSS tokens defined in `src/ui/ribbon.css`.
- Responsive behavior must degrade gracefully (ellipsis only appears when needed, rows always align), no raw DOM `contenteditable` workarounds.

## Scope
- `src/ui/ribbon.ts` (grid helpers, Home panel structure, overflow toggle state)
- `src/ui/ribbon.css` (grid layout, home-row styling, ellipsis button, responsive toggle rules)

## Steps
1. Phase 1 — Extend the ribbon grid helpers to accept row metadata and rebuild the Home panel into three class-based rows (Clipboard+Font, Paragraph, Editing). Attach an overflow toggle to the primary row and track expansion state via `data-home-rows-expanded`. Keep `ControlRegistry` wiring intact.
2. Phase 2 — Craft CSS for `.leditor-ribbon-grid`, `.leditor-ribbon-grid-row`, `.leditor-ribbon-home-row`, and `.leditor-ribbon-home-overflow` so large screens show all rows and small screens hide secondary rows until the toggle is activated. Ensure ellipsis button styling matches Fluent/Word tokens and no extra vertical wrapping occurs.
3. Phase 3 — (Manual) Open the renderer (or a representative layout preview), verify the three rows render, confirm the ellipsis toggles visible rows on narrow widths, and note any follow-up adjustments.

## Risk notes
- Mobile or narrow viewport hiding might inadvertently conceal commands when the ellipsis toggle fails; test by toggling `grid.dataset.homeRowsExpanded`.
- CSS selectors must stay scoped to `.leditor-*` to avoid bleeding into the editor canvas.
- Adding the overflow button should not break keyboard navigation; verify focus order in the Home row remains natural.

## Validation
- Manual ribbon walkthrough (verify three rows, ellipsis toggles, responsive behavior; not run in headless environment).

## Rollback
- `git checkout -- src/ui/ribbon.ts src/ui/ribbon.css`

