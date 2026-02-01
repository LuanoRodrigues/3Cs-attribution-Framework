# PLAN_SHARD_004 — LEditor: Refactor Context menu to shared CSS

## Goal
Remove injected CSS from `context_menu.ts` and make context menu match the app’s premium theme.

## Success criteria
- `leditor/src/ui/context_menu.ts` no longer injects a `<style>` tag.
- Menu remains functional and readable.

## Scope (exact file list)
- `leditor/src/ui/context_menu.ts`

## Steps
1) Remove style injection.
2) Keep menu DOM and class names; rely on shared CSS.

## Validation
- `cd leditor && npm run build`

## Rollback
- `git checkout -- leditor/src/ui/context_menu.ts`

## Progress
1) Remove injected CSS: PASS
2) Validate build: PASS
