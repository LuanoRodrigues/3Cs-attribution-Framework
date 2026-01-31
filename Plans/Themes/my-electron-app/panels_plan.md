# Panels + Tool Tabs Premium Plan (`my-electron-app/`)

## Goal
Make the panel system (splitters, floating, tool tabs) feel like a polished IDE-grade workspace.

## Primary subsystems
- Panel grid + splitters + floating: `my-electron-app/src/layout/PanelGrid.ts`
- Tool tab model + focus: `my-electron-app/src/panels/PanelLayoutRoot.ts`
- Tool wrapper: `my-electron-app/src/panels/ToolPanel.ts`
- Tool orchestration: `my-electron-app/src/panels/PanelToolManager.ts`
- Styling: `my-electron-app/src/renderer/styles.css` and `my-electron-app/src/renderer/ribbon-panels.v2.css`

## Work items
1) **Panel chrome consistency**
   - Define a premium “panel shell”:
     - header/tabs strip
     - content surface
     - splitters/gutters
   - Ensure consistent radii and border weights.

2) **Tool tabs**
   - `PanelLayoutRoot` renders its own `.tab-strip` and `.tab-content`.
   - Improve:
     - active tab indication
     - drag feedback (ghost, drop target highlight)
     - close button affordance (hit target, hover)

3) **Context menus**
   - There are multiple menu systems:
     - ribbon context menu
     - panel grid context menu
     - coder panel context menu
   - Consolidate to one menu primitive and one z-index policy.

4) **Floating panels**
   - Make undocked panels feel intentional:
     - subtle shadow/elevation
     - snap-to-edges (optional)
     - prevent accidental drags while interacting with content

## Acceptance checklist
- Splitters and floating panels feel stable and responsive.
- Tool switching never breaks embedded UIs (Write/LEditor, PDF viewer).
- Menus look and behave consistently across the app.

