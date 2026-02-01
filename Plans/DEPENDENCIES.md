# DEPENDENCIES — Premium Theme Upgrade Run

## Goal
Restore deterministic builds/typechecks after theme work by fixing prerequisite TypeScript issues and missing modules that block validation.

## Success criteria
- `cd leditor && npm run build` succeeds
- `cd leditor && npm run typecheck` succeeds

## Constraints
- Follow repo constraints in `AGENTS.md` (offline-first, no untrusted HTML injection).
- Keep changes minimal and strictly aimed at unblocking validation.

## Scope (exact file list)
- `leditor/src/editor/source_check_badges.ts`
- `leditor/src/ui/source_check_badges.css`
- `leditor/src/ui/agent_sidebar.ts`
- `leditor/src/ui/a4_layout.ts`

## Steps
1) Add missing `source_check_badges` module + CSS required by existing imports.
2) Remove partially-integrated agent sidebar “source check/action” code paths that break typecheck.
3) Fix strict TypeScript errors in `a4_layout.ts` (nullability + numeric offsets).
4) Run validations and record results.

## Risk notes
- Incorrectly stubbing an editor extension could hide intended UI behavior; this plan keeps the extension as a no-op placeholder only to satisfy imports.
- Footnote text replacement uses ProseMirror positions; numeric coercion must not introduce NaN.

## Validation
- `cd leditor && npm run build`
- `cd leditor && npm run typecheck`

## Rollback
- `git checkout -- leditor/src/ui/agent_sidebar.ts`
- `git checkout -- leditor/src/ui/a4_layout.ts`
- `git rm -- leditor/src/editor/source_check_badges.ts`
- `git rm -- leditor/src/ui/source_check_badges.css`

## Progress
1) Add missing module/CSS: PASS
2) Fix agent sidebar typecheck: PASS
3) Fix a4_layout typecheck: PASS
4) Validate: PASS (`cd leditor && npm run build && npm run typecheck`)

