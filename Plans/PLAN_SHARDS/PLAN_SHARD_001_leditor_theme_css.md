# PLAN_SHARD_001 — LEditor: Add shared theme CSS primitives

## Goal
Introduce a shared, token-driven UI primitive layer for LEditor so panels/overlays can stop injecting bespoke CSS and instead consume consistent `--ui-*` tokens.

## Success criteria
- New `leditor/src/ui/theme.css` exists and provides:
  - base `--ui-*` tokens (derived/mapped from existing variables where possible)
  - reusable primitives (panel, overlay/dialog, buttons, inputs, menus)
  - component styles for legacy panels currently using injected CSS (so they remain styled once injection is removed)
- `leditor/src/ui/renderer.ts` imports `./theme.css`.

## Constraints
- Do not change editor behavior; CSS only.
- Avoid hardcoding serif/parchment styling in new primitives.
- Respect `prefers-reduced-motion`.

## Scope (exact file list)
- `leditor/src/ui/theme.css`
- `leditor/src/ui/renderer.ts`

## Steps
1) Add `leditor/src/ui/theme.css` with `--ui-*` tokens + primitives + component selectors.
2) Import `./theme.css` in `leditor/src/ui/renderer.ts`.

## Risk notes
- Token conflicts with existing `--r-*` (ribbon) and `--page-*` (pagination) variables.
- CSS specificity regressions for embedded/overlay surfaces.

## Validation
- `cd leditor && npm run build`
- `cd leditor && npm run typecheck`

## Rollback
- `git checkout -- leditor/src/ui/theme.css`
- `git checkout -- leditor/src/ui/renderer.ts`

## Progress
1) Add `theme.css`: PASS
2) Import in renderer: PASS
3) Validate build/typecheck: PASS
