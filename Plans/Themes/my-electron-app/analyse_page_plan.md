# Analyse Workspace Premium Plan (`my-electron-app/`)

## Goal
Make Analyse feel like a premium “pipeline control room”: clear navigation, stable layouts, and readable metrics.

## Current surfaces
- Pages (render functions): `my-electron-app/src/pages/analyse/*.ts`
- Workspace shell/controller: `my-electron-app/src/analyse/*` + `my-electron-app/src/renderer/index.ts`
- Styling hooks exist: `.analyse-shell`, `.analyse-page` in `my-electron-app/src/renderer/styles.css`

## Work items
1) **Reduce inline styling**
   - Many analyse pages set `element.style.*` directly.
   - Convert repeated patterns to CSS classes:
     - headers, grids, cards, forms, status bars
   - This is required for consistent theming and density modes.

2) **Navigation model**
   - Provide a consistent in-analyse navigation (tabs or sidebar) for:
     - Dashboard
     - Corpus
     - Batches
     - Sections
     - Phases
     - Audio
   - Ensure current run/base path is always visible but not noisy.

3) **Metrics and status**
   - Standardize metric cards (counts, progress, errors).
   - Add a consistent “activity log” surface for long-running operations.

## Acceptance checklist
- Analyse pages look cohesive with the rest of the app.
- Layout remains stable while runs are scanning/loading.
- Core controls remain readable in both dark and light themes.

