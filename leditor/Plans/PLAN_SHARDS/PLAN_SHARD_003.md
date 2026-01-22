# PLAN_SHARD_003 — Phase 2 Incremental Pagination + Dirty Tracking

## Goal
Add dirty tracking and incremental repagination to avoid full reflows.

## Success criteria
1. Dirty tracker maps mutations to earliest dirty block.
2. Repagination starts from the page containing that block.
3. Scheduler coalesces mutations and runs once per RAF.

## Constraints
- Must not repaginate during IME composition.

## Scope
- `src/ui/pagination/dirty_tracker.ts`
- `src/ui/pagination/scheduler.ts`
- `src/ui/pagination/paginator.ts`
- `src/ui/a4_layout.ts`

## Steps
1. Implement dirty tracker with MutationObserver.
2. Add RAF scheduler + composition deferral.
3. Integrate into paginator pipeline.

## Validation
- Manual typing in large doc remains responsive.

## Rollback
1. `git checkout -- src/ui/pagination src/ui/a4_layout.ts`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Validation: FAIL (`npm start` timed out with Electron portal error: org.freedesktop.portal.Desktop)
