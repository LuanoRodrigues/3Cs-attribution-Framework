# PLAN_SHARD_005 — Phase 4 Section Settings + Odd/Even Parity

## Goal
Handle section settings and enforce odd/even parity section breaks.

## Success criteria
1. Section breaks create new section records with inherited settings.
2. odd/even parity inserts blank pages as needed.
3. Per-section metrics are respected.

## Constraints
- Must follow `document_layout.json` rules.

## Scope
- `src/ui/pagination/page_metrics.ts`
- `src/ui/pagination/paginator.ts`
- `src/ui/a4_layout.ts`

## Steps
1. Implement section model and settings resolution.
2. Enforce parity in page break logic.
3. Integrate metrics per page.

## Validation
- Manual section break tests.

## Rollback
1. `git checkout -- src/ui/pagination src/ui/a4_layout.ts`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Validation: FAIL (`npm start` timed out with Electron portal error: org.freedesktop.portal.Desktop)
