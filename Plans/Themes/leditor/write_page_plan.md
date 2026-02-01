# Write Page (Main Editor Shell) Premium Plan (`leditor/`)

## Goal
Make the main editing experience feel like a premium desktop document editor: calm chrome, crisp canvas, clear hierarchy.

## Primary surfaces
- Shell creation: `leditor/src/ui/renderer.ts`
- Canvas + pagination styling: `leditor/src/ui/a4_layout.ts`
- Base HTML: `leditor/public/index.html`

## Work items
1) Unify shell tokens under `--ui-*` and keep ribbon under `--r-*`.
2) Revisit `--ui-scale` strategy (avoid blur).
3) Align canvas/background palette with chrome tokens (light/dark).
4) Standardize scroll containers and scrollbar styling.

## Acceptance checklist
- Main page has a cohesive chrome/canvas palette.
- UI font is consistent (sans), document is serif (intentional).
- No layout shifts when opening sidebars/panels.

