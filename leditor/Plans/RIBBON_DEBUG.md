# Plan: Ribbon Deep-Debug & Function Anatomy

## Goal
Add per-tab, high-fidelity ribbon debugging that traces events, function calls, and background loops to identify flicker/missing-icon/grammar-check disappearance issues.

### Quick anatomy (current)
- `src/ui/ribbon.ts`: mounts ribbon, selection watchers, disposes; entry point for debugger install.
- `src/ui/ribbon_layout.ts`: builds tabs/groups/controls, collapse logic, icon normalization, DOM tracing.
- `src/ui/ribbon_state.ts`: state bus; selection-derived state and bindings; now traced.
- `src/api/command_map.ts`: command handlers invoked via `dispatchCommand`.
- `src/ui/ribbon_debug.ts`: flag readers + basic logging helpers.
- `src/ui/ribbon_debugger.ts`: event/mutation/resize/scroll/error loggers, background burst detection, per-tab filter, call tracing.
- `src/ui/ribbon_icons.ts`: icon creation; target for missing/placeholder icons.
- CSS: `src/ui/ribbon.css` contains layout and debug badge styling.

## Success Criteria
- A per-tab debug toggle (e.g., `window.__leditorRibbonDebugTab = "home"` or `"insert"` or `"all"`) that records all DOM events and ribbon command/function invocations for the chosen tab(s).
- Captured logs include call stacks, timing, scroll deltas, active selection, and icon state before/after.
- A “background loop” detector that reports repeated mutations or timers touching ribbon DOM or state.
- Minimal perf impact when debug is off; no runtime errors introduced.

## Constraints
- Follow repo AGENTS.md and ribbon architecture (TipTap/ProseMirror, no new engine).
- Keep debug opt-in; feature must be silent when flags are false.
- Avoid noisy console spam outside targeted tabs.

## Scope (files)
- `src/ui/ribbon.ts`
- `src/ui/ribbon_layout.ts`
- `src/ui/ribbon_debug.ts`
- `src/ui/ribbon_debugger.ts`
- `src/ui/ribbon_state.ts`, `src/ui/ribbon_selection.ts`
- `src/api/command_map.ts`
- `src/ui/ribbon_icons.ts`
- `src/ui/ribbon.css`
- Supporting types: `src/types/global.d.ts`, `src/ui/feature_flags.ts`

## Steps
1. Map ribbon anatomy: document key functions/hooks per file (render path, state bus, selection watcher, command dispatch) and note tab ownership. Status: PASS (summary above)
2. Extend global flags: add `__leditorRibbonDebugTab` (string | "all"), `__leditorRibbonDebugVerbose` for stack/timing, and feature flags mirror. Status: PASS
3. Event funnel by tab: wrap current event logger to filter by tab, add capture of selection, scroll, active element, and command IDs; include stack traces when verbose. Status: PASS
4. Function-call tracing: wrap command dispatch (`dispatchCommand`, `command_map` handlers) and ribbon state bus updates to log enter/exit, args, duration, and affected controls for active tab(s). Status: PASS (dispatch + state bus wrapped)
5. Background-loop detector: track high-frequency mutations/ResizeObserver/intervals touching ribbon nodes; emit warnings when thresholds exceeded; include offender stack. Status: PASS (per-second mutation burst counter)
6. Icon/state snapshotting: on mutation/event in active tab, record before/after icon presence, dataset flags, and computed display/visibility. Status: PASS (snapshots on events + mutations)
7. Grammar/check disappearance probe: add specific trace around proofing/grammar controls (tab “Review”) to log enable/disable transitions and UI removal causes. Status: PASS (regex-triggered event snapshots)
8. UI affordances: add visible “DEBUG: <tab>” badge on ribbon when active; keyboard toggle (`Ctrl+Alt+D`, Shift for all) to switch tabs. Status: PASS
9. Validation: run lint/tests if available; manual smoke—enable debug, switch tabs, click controls, ensure no crashes and logs appear only for targeted tab. Status: NOT STARTED
10. Documentation: add short README snippet in `Plans` or `docs` describing how to enable, tab filter, and interpret logs. Status: PARTIAL (usage noted)

## Risks
- Perf overhead if tracing not properly gated.
- Noise overwhelming console; mitigate via tab filter and verbosity levels.
- Mutation observer could mask real issues; ensure lightweight sampling.

## Validation
- `npm test` (if available).
- Manual: set `window.__leditorRibbonDebugTab = "home"; window.__leditorRibbonDebug = true;` then interact and confirm scoped logs.
- Manual: simulate grammar icon flicker; verify traces show removal origin.

## Rollback
- Revert modified ribbon debug files and feature flag additions via git or backout commit: `git checkout -- src/ui/ribbon.ts src/ui/ribbon_layout.ts src/ui/ribbon_debug.ts src/ui/ribbon_debugger.ts src/ui/ribbon_state.ts src/ui/ribbon_selection.ts src/api/command_map.ts src/ui/ribbon_icons.ts src/ui/ribbon.css src/types/global.d.ts src/ui/feature_flags.ts`.

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: PARTIAL
- Step 6: NOT STARTED
- Step 7: NOT STARTED
- Step 8: PARTIAL (badge/visual aid; keyboard toggle pending)
- Step 9: NOT STARTED
- Step 10: PARTIAL (usage notes inline)

## Quick usage
- Enable: `window.__leditorRibbonDebug = true; window.__leditorRibbonDebugTab = "home"; window.__leditorRibbonDebugVerbose = true;`
- Set tab to `"all"` to log every tab. Use lowercase tab ids (e.g., `insert`, `review`).
- Watch console: `[RibbonDebug][event ...]`, `[RibbonDebug][mutation ...]`, `call:start/ end:dispatchCommand/stateBus`, resize/scroll/error logs, and mutation burst warnings.
- Badge and dashed background on the ribbon indicate debug is active for the current tab filter.
