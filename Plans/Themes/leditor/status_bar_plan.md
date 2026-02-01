# Status Bar Premium Plan (`leditor/`)

## Goal
Deliver a status bar that looks intentional, matches the theme, and feels like a desktop editor (not a debug strip).

## Current implementation
- `leditor/src/ui/status_bar.ts` injects its own CSS (dark + serif).

## Work items
1) Restyle using shared primitives and `--ui-*` tokens.
2) Ensure it respects theme mode (light/dark).
3) Polish zoom/view controls (consistent hit targets + slider styling).

## Acceptance checklist
- Status bar typography/colors match ribbon and panels.
- It stays readable but visually quiet.

