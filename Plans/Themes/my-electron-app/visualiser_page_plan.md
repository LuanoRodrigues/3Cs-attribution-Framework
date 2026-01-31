# Visualiser Workspace Premium Plan (`my-electron-app/`)

## Goal
Make the Visualiser experience premium and maintainable (themeable), without relying on giant inline style strings.

## Current reality
- `my-electron-app/src/pages/VisualiserPage.tsx` builds large HTML strings with inline `style="..."`.
- This makes:
  - density modes harder
  - theme tweaks fragile
  - UI consistency difficult

## Work items
1) **Move inline styles to CSS classes**
   - Replace the `PANEL_STYLE`/`PANEL_HEAD_STYLE`/etc string constants with classes:
     - `.visualiser-panel`, `.visualiser-header`, `.visualiser-surface`, `.visualiser-thumbs`, `.visualiser-stage`
   - Keep inline only for truly dynamic layout values.

2) **Componentize repeated UI**
   - Tabs (Slide/Table), nav (Prev/Next), log panel, section picker.
   - Use shared primitives for buttons/inputs rather than one-off classes.

3) **Premium polish**
   - Better empty states (“No deck loaded”, “No sections configured”).
   - Clearer focus/selection visuals within the stage.

## Acceptance checklist
- Visualiser is fully themeable via CSS variables and density modes.
- No large inline style blocks remain for core layout.

