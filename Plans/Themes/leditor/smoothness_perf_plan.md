# Smoothness + Performance Plan (`leditor/`)

## Goal
Make interactions feel instantaneous and “buttery” on typical desktop hardware and high-DPI displays.

## Current friction points
- Many overlays/panels are shown via `style.display = "block|flex"` with no transitions.
- App-wide `transform: scale(var(--ui-scale))` exists in `leditor/src/ui/a4_layout.ts` (can reduce perceived sharpness).

## Work items
1) Define a single motion contract (`--ui-ease`, `--ui-d1`, `--ui-d2`) and reuse it everywhere.
2) Prefer animating only `opacity` and `transform`.
3) Respect `prefers-reduced-motion: reduce`.
4) Revisit scaling: prefer real sizes via tokens over `transform: scale()` where possible.

## Acceptance checklist
- All overlays open/close consistently and smoothly.
- Reduced-motion disables sliding animations.
- No obvious blur introduced by scaling.

