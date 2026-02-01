# PLAN_SHARD_005 — LEditor: Refactor Preview + Print Preview modals

## Goal
Remove injected CSS from preview modals and unify overlay/dialog visuals.

## Success criteria
- `leditor/src/ui/preview.ts` and `leditor/src/ui/print_preview.ts` no longer inject CSS.
- Focus/ESC behavior unchanged.

## Scope (exact file list)
- `leditor/src/ui/preview.ts`
- `leditor/src/ui/print_preview.ts`

## Steps
1) Remove injected style blocks and rely on shared CSS.
2) Ensure overlay/panel class names align with theme primitives.

## Validation
- `cd leditor && npm run build`

## Rollback
- `git checkout -- leditor/src/ui/preview.ts`
- `git checkout -- leditor/src/ui/print_preview.ts`

## Progress
1) Remove injected CSS (preview): PASS
2) Remove injected CSS (print preview): PASS
3) Validate build: PASS
