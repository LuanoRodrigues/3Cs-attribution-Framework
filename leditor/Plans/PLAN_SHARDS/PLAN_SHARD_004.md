# PLAN_SHARD_004 — Phase 3 Inline Splitting + Selection Bookmarks

## Goal
Implement selection bookmarks and inline splitting for overfull blocks.

## Success criteria
1. Selection bookmarks preserve caret across pagination moves.
2. Overfull paragraphs can be split by word/character.

## Constraints
- Only apply to eligible selectors.

## Scope
- `src/ui/pagination/selection_bookmark.ts`
- `src/ui/pagination/inline_split.ts`
- `src/ui/pagination/paginator.ts`

## Steps
1. Implement bookmark save/restore with node-id + path fallback.
2. Implement inline split with Range measurement.
3. Integrate into paginator.

## Validation
- Manual overfull paragraph split check.

## Rollback
1. `git checkout -- src/ui/pagination`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Validation: FAIL (`npm start` timed out with Electron portal error: org.freedesktop.portal.Desktop)
