# Plan Shard 002 — LEditor autosave manager (library-side)

## Goal
Create a single autosave manager that tracks current document path + dirty state and triggers non-prompting saves on change.

## Success criteria
- Any edit schedules an autosave (debounced).
- Autosave never prompts; uses current path (or deterministic default path when none exists).
- Save state is visible via status logs or status bar hooks (minimal for now).

## Constraints
- Uses host adapter (`__leditorAutoExportLEDOC`) only; no fs.

## Scope
- `leditor/src/ui/renderer.ts`
- `leditor/src/types/global.d.ts` (if new globals are introduced)

## Steps
1) Introduce session state: current path, dirty, saving.
2) Hook `window.leditor.on("change")` to schedule autosave.
3) Update current path on Import/Save results.
4) Ensure autosave is disabled for synthetic docs/tests.

## Validation
- `cd leditor && npm run typecheck`
- `cd leditor && npm run build`

## Rollback
```bash
git checkout -- leditor/src/ui/renderer.ts
git checkout -- leditor/src/types/global.d.ts
git checkout -- Plans/PLAN_SHARDS/PLAN_SHARD_002_leditor_autosave_manager.md
```

## Progress
1) Session state — PASS
2) Change hook — PASS
3) Path wiring — PASS
4) Validation — PASS
