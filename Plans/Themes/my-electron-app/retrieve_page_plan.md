# Retrieve Workspace Premium Plan (`my-electron-app/`)

## Goal
Make “Retrieve” feel like a premium research ingestion workflow: fast, readable, and confident (query → results → tags/datahub).

## Key surfaces
- Ribbon actions: `my-electron-app/src/ribbon/RetrieveTab.ts`
- Query builder UI: `my-electron-app/src/panels/retrieve/SearchPanel.tsx`
- DataHub panels/grids: `my-electron-app/src/panels/retrieve/*`
- Styling: `my-electron-app/src/renderer/styles.css` (retrieve section)

## Work items
1) **Query builder UX**
   - Clarify the primary action (Search) vs filters (provider/sort/years/limit).
   - Add premium micro-UX:
     - disabled states while loading
     - progress indicator
     - better error messages (provider/network)

2) **Results list**
   - Improve hierarchy:
     - title, author/year, snippet, actions
   - Add selection affordances that match the design system.

3) **Data grid**
   - Ensure table readability:
     - fixed header
     - row hover/selection
     - column resizing affordance (if supported)
   - Keep performance: large tables should not lag.

## Acceptance checklist
- Retrieve feels “tool-grade” and calm (not cluttered).
- Loading/error states are clear and non-scary.
- Selection and keyboard navigation feel consistent with panels/tabs.

