# Smoothness + Performance Plan (`my-electron-app/`)

## Goal
Deliver a “buttery” desktop experience: stable layout, predictable animation, and no jank during resizing, dragging, or switching tools.

## Current strengths
- Theme manager already sets `--app-scale` via `zoom` (not `transform`) in `my-electron-app/src/renderer/styles.css`.
- Dragging splitters uses RAF throttling when V2 is enabled (`my-electron-app/src/layout/PanelGrid.ts`).
- Ribbon height sync is debounced and disabled entirely in V2 mode (`my-electron-app/src/renderer/index.ts`).

## Plan: interaction contract
1) **Motion tokens**
   - Standardize `--ease` (e.g. `cubic-bezier(.2,.8,.2,1)`) and reuse density’s `--motion-*`.
   - Use a single open/close animation for menus and panels (opacity + translateY only).
   - Respect `prefers-reduced-motion: reduce` by disabling transforms and shortening durations.

2) **Drag & resize**
   - Ensure all pointermove-heavy paths are RAF-throttled (already true for V2 splitter; confirm floating drag + other drags).
   - Keep hit targets generous (splitter hit area already tokenized in `ribbon-panels.v2.css`).
   - Avoid triggering full reflows (no forced layout reads in tight loops).

3) **Scrolling**
   - Make scroll containers explicit:
     - panel content areas
     - tool surfaces
     - long lists/grids
   - Prefer `content-visibility: auto` only where it doesn’t break measurement or focus.

4) **“No flicker” policy**
   - Avoid DOM rebuilds on focus (already handled in `PanelLayoutRoot.focusTool`).
   - Keep embedded apps stable (LEditor, PDF viewer iframe).

## Acceptance checklist
- Dragging splitters and floating panels does not drop frames on typical hardware.
- Switching tabs/tools does not cause visible relayout flicker.
- Context menus open instantly and close predictably (ESC/click-outside).

