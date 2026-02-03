# Plan Shard 003 — LEDOC v2 bundle (library format + plugins)

## Goal
Update import/export plugins and LEDOC format/types to support a v2 “bundle directory” format while keeping v1 zip import compatibility.

## Success criteria
- Export produces a payload that host can write as v2 bundle.
- Import can consume v2 bundle payload and applies content/layout/registry sensibly.
- Legacy v1 zip import still works.

## Constraints
- Canonical document stays TipTap JSON.

## Scope
- `leditor/src/ledoc/format.ts`
- `leditor/src/ledoc/bundle.ts` (new)
- `leditor/src/extensions/plugin_export_ledoc.ts`
- `leditor/src/extensions/plugin_import_ledoc.ts`
- `leditor/src/api/export_ledoc.ts`
- `leditor/src/api/import_ledoc.ts`

## Steps
1) Define v2 bundle constants + types.
2) Implement bundle validator/normalizer.
3) Extend export plugin to include v2 fields (content/layout/registry/meta/version).
4) Extend import plugin to accept either v1 payload or v2 bundle payload.

## Validation
- `cd leditor && npm run typecheck`
- `cd leditor && npm run build`

## Rollback
```bash
git checkout -- leditor/src/ledoc/format.ts
git rm -- leditor/src/ledoc/bundle.ts
git checkout -- leditor/src/extensions/plugin_export_ledoc.ts
git checkout -- leditor/src/extensions/plugin_import_ledoc.ts
git checkout -- leditor/src/api/export_ledoc.ts
git checkout -- leditor/src/api/import_ledoc.ts
git checkout -- Plans/PLAN_SHARDS/PLAN_SHARD_003_ledoc_v2_bundle_library.md
```

## Progress
1) Types/constants — PASS
2) Bundle helper — PASS
3) Export plugin — PASS
4) Import plugin — PASS
5) Validation — PASS
