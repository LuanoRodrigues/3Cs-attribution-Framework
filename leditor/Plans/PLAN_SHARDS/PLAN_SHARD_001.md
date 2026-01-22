# PLAN_SHARD_001 — Phase 0 Scaffolding + State Store

## Goal
Introduce pagination feature flags and a DocumentLayoutState store backed by `document_layout.json` to provide derived metrics and CSS token application.

## Success criteria
1. Feature flags exist for pagination (`pagination.enabled`, `pagination.incremental.enabled`, `pagination.debugOverlay.enabled`).
2. `DocumentLayoutState` loads `Plans/document_layout.json` and exposes current spec + derived px utilities.
3. CSS tokens from spec defaults apply to the document root without errors.

## Constraints
- No behavioral changes to pagination yet; scaffolding only.
- Must not introduce heuristic fallbacks.

## Scope
- `src/ui/feature_flags.ts`
- `src/ui/pagination/document_layout_state.ts` (new)
- `src/ui/pagination/index.ts` (new)
- `src/ui/a4_layout.ts` (token application hook if needed)

## Steps
1. Add pagination feature flags to `src/ui/feature_flags.ts`.
2. Implement `DocumentLayoutState` to load `Plans/document_layout.json` and expose tokens/units.
3. Add a small helper to apply CSS token defaults on startup (no pagination changes).

## Risk notes
- Incorrect JSON typing may cause runtime errors when accessed.

## Validation
- `npm start` (manual) to ensure no startup errors.

## Rollback
1. `git checkout -- src/ui/feature_flags.ts src/ui/a4_layout.ts`
2. `git checkout -- src/ui/pagination`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
 - Validation: FAIL (npm start timed out; Electron portal error)
