# Plan: Exportable leditor — Shard 003 (Core App API: create/destroy)

## Goal
Expose a reusable, framework-agnostic mount API for leditor’s renderer so it can be packaged as a web library: `createLeditorApp({ ... })` returning a handle plus a `destroy()` cleanup function. Keep the existing Electron entry (`mountEditor()`) working unchanged.

## Success criteria
- `leditor/src/ui/renderer.ts` exports `createLeditorApp()` and `mountEditor()` continues to work by calling it.
- `createLeditorApp()` supports a “portable” mode that does **not** require the Electron host contract.
- All new host interactions at this boundary use `HostAdapter` (`getHostAdapter()` / `setHostAdapter()`), not direct `window.leditorHost` access.
- `createLeditorApp()` returns `{ handle, destroy }` and `destroy()` removes key event listeners and DOM it created.
- `npm run build --loglevel verbose` succeeds in `leditor/`.

## Constraints
- Do not introduce new dependencies.
- Keep behavior identical for Electron default path.
- Avoid logging sensitive content; log lengths/counts only.

## Scope (exact files)
- `leditor/src/ui/renderer.ts`
- `leditor/src/host/host_adapter.ts`
- `leditor/Plans/PLAN_SHARDS/EXPORTABLE_003_CORE_API.md`

## Steps
1) Add exported API types and `createLeditorApp()`
   - File: `leditor/src/ui/renderer.ts`
   - Add:
     - `export type CreateLeditorAppOptions = { ... }`
     - `export type LeditorAppInstance = { handle: EditorHandle; destroy: () => void }`
     - `export const createLeditorApp = async (options?: CreateLeditorAppOptions) => LeditorAppInstance`
   - Ensure `mountEditor()` calls `createLeditorApp()` with the current Electron defaults.

2) Make host contract and coder-state initialization optional
   - `createLeditorApp({ requireHostContract: false })` must skip/soft-fail host-only steps.
   - `mountEditor()` keeps `requireHostContract: true` and remains fail-fast.

3) Use HostAdapter at the renderer boundary
   - Replace direct `window.leditorHost.registerFootnoteHandlers` usage with `getHostAdapter()`.
   - If no host adapter exists, install a minimal in-memory adapter (via `setHostAdapter`) for footnote panel actions.

4) Add cleanup
   - Use an `AbortController` to register DOM/window listeners with `{ signal }` where supported.
   - Track and dispose:
     - Layout subscription unsubscribe function.
     - ResizeObserver (disconnect) or window resize listener (signal abort handles it).
   - `destroy()` calls `handle.destroy()`, aborts listeners, and removes `#leditor-app` root.

5) Validate
   - Run from `leditor/`:
     - `npm run build --loglevel verbose`

## Risk notes
- This file currently assumes a single global editor instance. Keep that invariant for now; multi-instance support can be a later shard.
- Some subsystems may attach listeners without teardown APIs; cleanup will cover the major boundary listeners first.

## Validation
- `npm run build --loglevel verbose`

## Rollback
- `git restore leditor/src/ui/renderer.ts leditor/src/host/host_adapter.ts`
- `git restore leditor/Plans/PLAN_SHARDS/EXPORTABLE_003_CORE_API.md`

## Progress
1) Export createLeditorApp API — PASS
2) Optionalize host-only init — PASS
3) HostAdapter at renderer boundary — PASS
4) Destroy/cleanup path — PASS
5) Build validation — PASS
