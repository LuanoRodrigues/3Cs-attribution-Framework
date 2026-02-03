# Plan Shard 004 — my-electron-app LEDOC bundle host support

## Goal
Update the Electron host IPC to read/write the v2 `.ledoc/` directory bundle format, while keeping legacy v1 `.ledoc` zip file support.

## Success criteria
- Open dialog supports selecting either `.ledoc` directory bundle or legacy `.ledoc` zip file.
- Save/Save As can write a `.ledoc` directory bundle (default).
- Export handler accepts both `targetPath` and `suggestedPath`.
- Bundle writes required files (`version.txt`, `content.json`, `layout.json`, `registry.json`, `meta.json`, `media/`).

## Scope
- `my-electron-app/src/main.ts`
- `my-electron-app/src/preload.ts`
- `my-electron-app/src/renderer/global.d.ts` (if needed)
- `my-electron-app/src/pages/WritePage.tsx` (stop duplicate autosave; rely on leditor)

## Steps
1) Implement bundle read/write helpers (atomic JSON/text writes).
2) Update `leditor:import-ledoc` to detect directory vs file.
3) Update `leditor:export-ledoc` to write bundle by default and accept `targetPath`.
4) Update preload to pass through new options/paths.

## Validation
- `cd my-electron-app && npm run build` (and/or lint if configured)

## Rollback
```bash
git checkout -- my-electron-app/src/main.ts
git checkout -- my-electron-app/src/preload.ts
git checkout -- my-electron-app/src/renderer/global.d.ts
git checkout -- Plans/PLAN_SHARDS/PLAN_SHARD_004_myapp_ledoc_bundle_host.md
```

## Progress
1) Bundle helpers — PASS
2) Import handler — PASS
3) Export handler — PASS
4) Preload/types — PASS
5) Validation — PASS
