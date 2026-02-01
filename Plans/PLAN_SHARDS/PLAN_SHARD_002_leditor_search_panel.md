# PLAN_SHARD_002 — LEditor: Refactor Search panel to shared CSS

## Goal
Remove injected CSS from `search_panel.ts` and rely on shared theme primitives for a premium, cohesive look.

## Success criteria
- `leditor/src/ui/search_panel.ts` no longer injects a `<style>` tag.
- Search panel uses shared primitives and remains fully functional.

## Constraints
- Preserve current behavior (SearchNext/SearchPrev/Replace/ReplaceAll/Close, ESC closes).

## Scope (exact file list)
- `leditor/src/ui/search_panel.ts`

## Steps
1) Remove `ensureSearchStyles()` injection and any style tag logic.
2) Ensure DOM classes match selectors provided by `leditor/src/ui/theme.css`.

## Risk notes
- If CSS is not loaded for some embedding mode, panel could appear unstyled.

## Validation
- `cd leditor && npm run build`

## Rollback
- `git checkout -- leditor/src/ui/search_panel.ts`

## Progress
1) Remove injected CSS: PASS
2) Validate build: PASS
