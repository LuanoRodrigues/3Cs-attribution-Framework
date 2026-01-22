# Plan: Fix View Ribbon Commands

## Goal
Fix all View ribbon buttons so they map to valid commands, update view state, and avoid runtime errors.

## Success criteria
- No `LEditor.execCommand: unknown command` errors for View actions.
- `AllowedElements` panel opens without exceptions.
- Print preview works without “requires an editor handle.”
- View buttons trigger visible changes (page boundaries, page break marks, ruler, zoom, pagination mode, fullscreen).

## Constraints
- Follow repo AGENTS.md rules (TipTap transactions only; offline; no unsafe HTML).
- Use schema-driven commands; avoid silent fallbacks.
- Keep changes scoped to listed files.

## Scope
- `src/api/leditor.ts`
- `src/api/command_map.ts`
- `src/ui/ribbon_layout.ts`
- `src/ui/renderer.ts`
- `src/ui/allowed_elements_inspector.ts`
- `src/ui/view_state.ts`
- `src/ui/fullscreen.ts`
- `src/ui/layout_context.ts`
- `src/ui/a4_layout.ts`
- `src/extensions/plugin_debug.ts`
- `src/extensions/plugin_source_view.ts`
- `src/plugins/pasteCleaner.ts`
- `Plans/ribbon.json`

## Steps
1) Audit View command IDs used by the ribbon and map them to concrete handlers (files: `src/ui/ribbon_layout.ts`, `Plans/view.json`, `src/api/command_map.ts`).
2) Ensure plugin-registered commands are available by importing debug/source/paste plugins via TS entrypoints (files: `src/api/leditor.ts`, `src/extensions/plugin_debug.ts`, `src/extensions/plugin_source_view.ts`, `src/plugins/pasteCleaner.ts`).
3) Implement missing View command handlers and state integration (files: `src/api/command_map.ts`, `src/ui/view_state.ts`, `src/ui/layout_context.ts`, `src/ui/a4_layout.ts`, `Plans/ribbon.json`).
4) Fix Allowed Elements inspector crash (files: `src/ui/allowed_elements_inspector.ts`).
5) Fix Print Preview command wiring (files: `src/api/command_map.ts`, `src/ui/renderer.ts`).
6) Rebuild renderer bundle and verify no View command runtime errors (command: esbuild; manual click validation).

## Risk notes
- Missing CSS/state wiring could make toggles no-op; tie command handlers to layout controller and app root classes.
- Changing ribbon state contract affects UI bindings; keep additions minimal and deterministic.

## Validation
- `npx esbuild scripts/renderer-entry.ts --bundle --platform=browser --format=esm --sourcemap --outfile=dist/renderer/bootstrap.bundle.js --loader:.ttf=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl --external:@simonwep/pickr/dist/pickr.min.css`
- Manual: click each View button to confirm no console errors.

## Rollback
- `git restore src/api/leditor.ts src/api/command_map.ts src/ui/ribbon_layout.ts src/ui/renderer.ts src/ui/allowed_elements_inspector.ts src/ui/view_state.ts src/ui/fullscreen.ts src/ui/layout_context.ts src/ui/a4_layout.ts src/extensions/plugin_debug.ts src/extensions/plugin_source_view.ts src/plugins/pasteCleaner.ts Plans/ribbon.json dist/renderer/bootstrap.bundle.js`

## Progress
1) Audit View command IDs: PASS
2) Register plugin commands: PASS
3) Implement missing View handlers + state: PASS
4) Fix Allowed Elements inspector: PASS
5) Fix Print Preview wiring: PASS
6) Rebuild + validate: PASS (esbuild)
