# Plans/home_ribbon_improvement_plan.md — Home ribbon fidelity and responsiveness

## Goal
Restore a Word-like Home tab that is light, three rows deep, and handles smaller screens by collapsing secondary rows under a tactile overflow affordance. Give the crucial Clipboard/Font/Paragraph/Editing commands premium Fluent-style icons, two-row group bodies, and clear font/paragraph styling dropdowns so academic users have Word-level familiarity.

## Success criteria
1. `Home` panel renders exactly three `.leditor-ribbon-home-row` chunks (Clipboard+Font, Paragraph, Editing) that span horizontally on wide layouts without any extra vertical wrapping and expose an ellipsis toggle on narrow viewports.
2. Each ribbon button inside the Home tab now shows a Fluent-inspired SVG glyph (from `@fluentui/react-icons` path data) instead of the earlier placeholder glyphs while falling back to existing icons outside of the home scope.
3. `.leditor-ribbon-group-body` rows clamp at two lines via CSS tokens, and font/paragrah dropdowns expose Normal / Title / Heading 1–6 plus five academic fonts (Times New Roman, Arial, Aptos, Cambria, Georgia) so the Home tab feels like Word’s styling section.
4. Console tracing in `renderRibbon` confirms the updated Home panel build path during dev-time so we can prove we work on the right ribbon.

## Constraints
- Work only inside the existing ribbon helpers; commands must still go through `dispatchCommand` and no raw DOM `contenteditable` hacks may be introduced.
- Honor the structured JSON ribbon schema; no new editor engines or cloud streams, and keep offline/electron-first semantics (per `AGENTS.md`).
- Keep icons and drop-down wiring within `ribbon.ts`/`ribbon_icons.ts`; CSS adjustments belong in `src/ui/ribbon.css` without adding new frameworks.

## Scope
- `src/ui/ribbon.ts` (Home panel layout, logging, dropdown wiring)
- `src/ui/ribbon_icons.ts` (Fluent SVG glyph mapping and icon factory)
- `src/ui/ribbon.css` (tab styling, grid row limits, responsive overflow)
- `Plans/EXECUTION_INDEX.md` (track this plan as active)

## Steps
1. Update `createRibbonGridFromRows`, `createRibbonGrid`, and `createHomePanel` inside `src/ui/ribbon.ts` so the Home tab always builds three named rows (primary, paragraph, editing), injects the overflow toggle, and logs when those rows render; keep the dispatch wiring intact. (Step touches `createRibbonGridFromRows`, `createHomePanel`, `createHomeOverflowButton`.)
2. Replace the home-specific glyphs inside `src/ui/ribbon_icons.ts` with Fluent-inspired SVGs by adding a `fluentGlyphs` map, provider, and `viewBox` metadata (fall back to lucide for other icons). Ensure each home-only icon (paste/copy/cut/format painter, bold/italic/underline/strikethrough/super/sub, change case, highlight/color, style/font/family/size, paragraph/indent/direction/spacing, and find/replace/select) gets a premium SVG.
3. Harden `src/ui/ribbon.css` so `leditor-ribbon-tabs` stays light, `.leditor-ribbon-grid-row`/`.leditor-ribbon-group-body` cap to two lines, `.leditor-ribbon-home-row` manages overflow cleanly, and the ellipsis toggle shows only on small screens while keeping buttons aligned; also add responsive rules that hide extra rows and let the toggle expand them.
4. Record this plan as active in `Plans/EXECUTION_INDEX.md`, noting the previous plan’s status and pointing future readers to `Plans/home_ribbon_improvement_plan.md`. (This keeps the execution index accurate.)

## Risk notes
- Mapping numerous icons to Fluent paths increases the chance of typos; verify each glyph renders by checking the DOM for the new SVG viewBox code.
- Tightening the grid to two rows could overflow some groups; test by resizing the ribbon to confirm no controls clip.
- Moving home rows into a stack with overflow toggling can hide commands; ensure the ellipsis button toggles `data-home-rows-expanded` and `aria-expanded` consistently.

## Validation
- Manual check in the renderer: open the Home tab, confirm three rows, ellipsis toggle, responsive collapse, and Fluent-style icons, then note console log `[RibbonDebug] home-panel layout` (added). No automated command run.

## Rollback
1. `git checkout -- src/ui/ribbon.ts src/ui/ribbon_icons.ts src/ui/ribbon.css Plans/home_ribbon_improvement_plan.md Plans/EXECUTION_INDEX.md`

## Progress
- Step 1 — Home layout & logging update (NOT STARTED)
- Step 2 — Fluent icon glyphs (NOT STARTED)
- Step 3 — Ribbon CSS for rows/responsive (NOT STARTED)
- Step 4 — Execution index update (NOT STARTED)
