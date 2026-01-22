# PLAN_SHARD_002 — Phase 1 Structural Pages + Block Pagination MVP

## Goal
Implement structural page containers and MVP block pagination that moves blocks between per-page content nodes.

## Success criteria
1. Pages are real DOM containers with header/content/footer.
2. Blocks flow into next page when content overflows.
3. Manual page breaks force new pages.

## Constraints
- No inline splitting yet.
- Header/footer are visual only (non-editable).

## Scope
- `src/ui/pagination/page_host.ts`
- `src/ui/pagination/page_metrics.ts`
- `src/ui/pagination/paginator.ts`
- `src/ui/a4_layout.ts` (integration)

## Steps
1. Implement `PageHost` DOM creation and recycling.
2. Implement `computeSpecPx` and page metric derivation.
3. Implement MVP paginator using binary search fit.
4. Wire paginator into `a4_layout` with a feature flag toggle.

## Risk notes
- Moving DOM nodes may disrupt selection.

## Validation
- `npm start` (manual typing across pages).

## Rollback
1. `git checkout -- src/ui/pagination src/ui/a4_layout.ts`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Validation: FAIL (`npm start` timed out with Electron portal error: org.freedesktop.portal.Desktop)
