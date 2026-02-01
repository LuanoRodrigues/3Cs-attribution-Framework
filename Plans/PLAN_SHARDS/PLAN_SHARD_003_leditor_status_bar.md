# PLAN_SHARD_003 — LEditor: Refactor Status bar to shared CSS

## Goal
Remove injected CSS from `status_bar.ts` and align status bar visuals with theme tokens and UI font.

## Success criteria
- `leditor/src/ui/status_bar.ts` no longer injects a `<style>` tag.
- Status bar uses theme tokens and remains functional (stats, pages, zoom).

## Scope (exact file list)
- `leditor/src/ui/status_bar.ts`

## Steps
1) Remove `ensureStatusBarStyles()` injection.
2) Keep DOM structure but ensure class names align with theme CSS.

## Validation
- `cd leditor && npm run build`

## Rollback
- `git checkout -- leditor/src/ui/status_bar.ts`

## Progress
1) Remove injected CSS: PASS
2) Validate build: PASS
