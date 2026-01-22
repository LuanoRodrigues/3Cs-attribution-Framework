# PLAN_SHARD_006 — Phase 5 Layout Tab Wiring + Tokens

## Goal
Wire layout tab commands to DocumentLayoutState and trigger repagination, apply CSS tokens from spec.

## Success criteria
1. Layout tab commands update DocumentLayoutState (size/orientation/margins/gutter/header/footer distances).
2. CSS tokens update in DOM root.
3. Repagination is triggered deterministically after each change.

## Constraints
- No heuristic layout; use spec-derived values.

## Scope
- `src/api/command_map.ts`
- `src/ui/pagination/document_layout_state.ts`
- `src/ui/ribbon_layout.ts`
- `Plans/layout_tab.json`

## Steps
1. Add layout command handlers to update DocumentLayoutState.
2. Apply spec tokens + schedule repagination.
3. Update layout tab JSON for any missing controls.

## Validation
- `npm start` and manual layout tab checks.

## Rollback
1. `git checkout -- src/api/command_map.ts src/ui/ribbon_layout.ts Plans/layout_tab.json src/ui/pagination`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Validation: FAIL (`npm start` timed out with Electron portal error: org.freedesktop.portal.Desktop)
