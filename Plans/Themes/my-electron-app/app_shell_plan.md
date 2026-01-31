# App Shell Premium Plan (`my-electron-app/`)

## Goal
Make the top-level shell (ribbon + workspace + project overlay) feel cohesive, quiet, and premium.

## Primary files
- Shell markup: `my-electron-app/src/renderer/index.html`
- Shell behavior: `my-electron-app/src/renderer/index.ts`
- Base styling: `my-electron-app/src/renderer/styles.css`
- V2 overrides: `my-electron-app/src/renderer/ribbon-panels.v2.css`

## Work items
1) **Project/session overlay polish**
   - `#session-overlay` should feel like a first-class onboarding surface.
   - Improve:
     - typography hierarchy
     - button consistency (`.ribbon-button` → unify with `.ui-button`)
     - loading/error states (status line)
   - Ensure overlay transitions are consistent with the app’s motion system.

2) **Scale and DPI**
   - Keep `zoom: var(--app-scale)` (already chosen for fixed ribbon stability).
   - Ensure borders and text look crisp at 100% / 125% / 150%.

3) **Global element styling**
   - Stop relying on global `input, textarea, select { ... }` in `styles.css` for everything.
   - Move to a component-level system to avoid “accidental” styling side effects.

## Acceptance checklist
- Project overlay looks like the same product as the workspace.
- UI scale changes don’t cause shimmer or blurry text.

