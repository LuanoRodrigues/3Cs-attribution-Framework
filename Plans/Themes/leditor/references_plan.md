# References UX + Theme Plan (`leditor/`)

## Goal
Make references feel cohesive and premium across:
1) in-document citations/bibliography
2) citation picker overlay (iframe)
3) sources utilities panel

## Current surfaces
- Inline styles: `leditor/src/ui/references.css`
- Overlay chrome: `leditor/src/ui/references_overlay.css`
- Picker UI (iframe): `leditor/src/ui/references/ref_picker.html`
- Sources panel: `leditor/src/ui/references/sources_panel.ts`

## Work items
1) Sync theme tokens across iframe boundary (bridge injection or payload).
2) Convert sources panel to shared panel primitives.
3) Ensure inline citation styles remain readable on all themes.

## Acceptance checklist
- Picker overlay + sources panel feel like part of the same product.

