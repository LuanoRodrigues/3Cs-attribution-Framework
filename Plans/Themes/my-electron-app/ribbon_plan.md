# Ribbon Premium Plan (`my-electron-app/`)

## Goal
Make the ribbon feel like a premium desktop “command surface”: readable, fast, and consistent with panel UI.

## Current implementation
- Tabs + activation: `my-electron-app/src/layout/TabRibbon.ts`
- Tab definitions/actions: `my-electron-app/src/ribbon/*.ts`
- Context menu: `my-electron-app/src/renderer/ribbonContextMenu.ts`
- Styling:
  - base: `my-electron-app/src/renderer/styles.css`
  - V2: `my-electron-app/src/renderer/ribbon-panels.v2.css`

## Work items
1) **Visual hierarchy**
   - Tabs: reduce visual noise; use one clear active indicator (underline or pill, not both).
   - Action groups: consistent spacing and alignment across tabs.
   - Icons: ensure consistent size and stroke; avoid mixed icon styles.

2) **Overflow + responsiveness**
   - V2 already uses horizontal scrolling for actions: keep it but add:
     - subtle scroll affordance (fade edges)
     - keyboard scroll support (optional)

3) **Interaction polish**
   - Standardize hover/pressed/active states across:
     - `.tab-button`
     - `.ribbon-button`
     - context menu items
   - Ensure focus-visible rings are consistent with `--focus` tokens.

4) **Customization posture**
   - `ribbonContextMenu` already supports hiding groups. Make the UX premium:
     - show a non-destructive “Hidden groups” restore affordance
     - persist hidden state per workspace/session (optional)

## Acceptance checklist
- Ribbon looks calm and premium (not overly “glowy” by default).
- Actions are readable and don’t clip at compact widths.
- Context menu matches the theme and animates in/out consistently.

