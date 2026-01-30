# Plan: Exportable leditor — Shard 002 (Host Adapter Abstraction)

## Goal
Introduce a single host integration boundary (`HostAdapter`) so editor code no longer depends directly on `window.leditorHost`. This is a prerequisite for extracting a browser-only `leditor-core` package.

## Success criteria
- A new `HostAdapter` interface exists and can be provided/overridden by the runtime.
- Existing Electron app behavior remains unchanged (default adapter uses `window.leditorHost`).
- Key Electron-dependent plugins use the adapter instead of direct `window.leditorHost` access.
- `npm run build` succeeds in `leditor/`.

## Constraints
- Do not break current Electron renderer boot.
- No sensitive content logging.
- Keep changes minimal and localized (adapter module + a few targeted call sites).

## Scope (exact files)
- `leditor/src/host/host_adapter.ts` (new)
- `leditor/src/types/global.d.ts` (update type for optional adapter injection, if needed)
- `leditor/src/plugins/aiAgent.ts`
- `leditor/src/editor/bootstrap.ts`
- `leditor/src/extensions/plugin_export_docx.ts`
- `leditor/src/extensions/plugin_import_docx.ts`
- `leditor/src/extensions/plugin_export_pdf.ts`

## Steps
1) Add `HostAdapter` interface and accessors
   - File: `leditor/src/host/host_adapter.ts`
   - Exports:
     - `export type HostAdapter = { ... }` (subset of current `window.leditorHost`)
     - `getHostAdapter(): HostAdapter | null`
     - `setHostAdapter(adapter: HostAdapter | null): void`
   - Default adapter source: `window.leditorHost` (backwards compatible)

2) Update plugin integrations to use `getHostAdapter()`
   - Files:
     - `leditor/src/plugins/aiAgent.ts`
     - `leditor/src/extensions/plugin_export_docx.ts`
     - `leditor/src/extensions/plugin_import_docx.ts`
     - `leditor/src/extensions/plugin_export_pdf.ts`
   - Behavior:
     - If adapter method is missing, keep current user-facing error behavior.

3) Update bootstrap phase marker calls to use adapter
   - File: `leditor/src/editor/bootstrap.ts`

4) Validate build
   - Run from `leditor/`:
     - `npm run build --loglevel verbose`

## Risk notes
- There may be implicit reliance on `window.leditorHost` being mutable; adapter must preserve that behavior.
- Types may drift vs the full host surface; keep adapter type minimal and extend as needed per usage.

## Validation
- `npm run build --loglevel verbose`

## Rollback
- `git restore leditor/src/plugins/aiAgent.ts leditor/src/editor/bootstrap.ts leditor/src/extensions/plugin_export_docx.ts leditor/src/extensions/plugin_import_docx.ts leditor/src/extensions/plugin_export_pdf.ts leditor/src/types/global.d.ts`
- `git restore leditor/src/host/host_adapter.ts`
- `git restore leditor/Plans/PLAN_SHARDS/EXPORTABLE_002_HOST_ADAPTER.md`

## Progress
1) Add HostAdapter interface — PASS
2) Migrate plugins to adapter — PASS
3) Migrate bootstrap to adapter — PASS
4) Build validation — PASS
