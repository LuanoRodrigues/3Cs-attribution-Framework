# Plan: Performance + Lightweight Pass (LEditor)

## Goal
Make the app feel instant: low-latency typing and ribbon interaction, minimal background work, and fast startup while preserving Word-like fidelity.

## Success criteria
- Build passes: `npm run build` and `npm run typecheck`.
- No repeated ribbon DOM rebuilds after initial render (no flicker/remount on hover/selection).
- No periodic UI loops (intervals/observers) doing work when nothing changes.
- Ribbon state updates are coalesced (max ~1 update/frame; no tight setTimeout loops).
- Pagination/layout work is debounced; selection changes do not trigger full relayout.
- Perf telemetry can be enabled via `window.__leditorPerf = true` and prints one concise summary.

## Constraints
- Canonical document format remains TipTap/ProseMirror JSON (no HTML/MD as source of truth).
- All edits via transactions/commands; no raw contenteditable engine.
- Offline-first; no network required.
- Security: schema-driven import; no untrusted HTML injection.
- Fail-fast preferred for correctness; no silent coercions.

## Scope (exact file list)
- `src/ui/perf.ts`
- `scripts/renderer-entry.ts`
- `src/ui/renderer.ts`
- `src/ui/ribbon_layout.ts`
- `src/ui/ribbon_state.ts`
- `src/ui/a4_layout.ts`
- `src/ui/layout_engine.ts`
- `src/ui/layout_context.ts`
- `src/ui/ribbon.css`
- `package.json`

## Steps
1. Add perf instrumentation utilities and a single global flag gate.
2. Instrument renderer bootstrap and ribbon render to produce a single PerfSummary.
3. Audit and remove periodic/duplicate debug toggles and noisy polling; ensure debug is fully off when disabled.
4. Coalesce RibbonStateBus updates to one-per-frame and avoid redundant selection-change work.
5. Audit ResizeObserver/MutationObserver usage and debounce relayout/pagination work.
6. Ensure ribbon layout does not rebuild DOM after initial mount; ensure no icon reinjection loops.
7. Reduce renderer work during idle (no polling, no repeated heavy DOM queries).
8. Validate: run `npm run build` and `npm run typecheck`; record results.

## Risk notes
- Over-debouncing can make UI feel stale (needs careful thresholds).
- Changes to layout scheduling can subtly affect pagination correctness.
- Overzealous pruning of debug hooks may remove useful diagnostics (keep behind flag).

## Validation
- `npm run build`
- `npm run typecheck`

## Rollback
- `git diff`
- `git checkout -- src/ui/perf.ts scripts/renderer-entry.ts src/ui/renderer.ts src/ui/ribbon_layout.ts src/ui/ribbon_state.ts src/ui/a4_layout.ts src/ui/layout_engine.ts src/ui/layout_context.ts src/ui/ribbon.css package.json`

## Progress
1. NOT STARTED
2. NOT STARTED
3. NOT STARTED
4. NOT STARTED
5. NOT STARTED
6. NOT STARTED
7. NOT STARTED
8. NOT STARTED

