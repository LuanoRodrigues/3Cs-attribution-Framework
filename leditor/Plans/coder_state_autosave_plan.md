# Coder State Autosave Plan

## Goal
Make the editor always load its initial content from `\\wsl$\Ubuntu-20.04\home\pantera\annotarium\coder\0-13_cyber_attribution_corpus_records_total_included\coder_state.json` and continuously autosave back to that file.

## Success Criteria
1. On start, the editor loads HTML from the fixed coder_state path without consulting query params or localStorage.
2. Autosave writes the current editor HTML back to the same path at a fixed interval without errors when `window.leditorHost.writeFile` is available.
3. If the host write is unavailable, we log a single warning and keep running (no silent failures).
4. `npm run test:docx-roundtrip` passes.

## Constraints
- Only touch source files under `src/ui/renderer.ts`; do not modify dist outputs.
- Fail-fast on missing/malformed content when loading; autosave should not swallow write errors (log once per failure type).
- Keep autosave interval reasonable (reuse existing autosave 1s interval unless otherwise specified).

## Scope
- `src/ui/renderer.ts`

## Steps
1. Hard-pin the coder state path to the provided WSL location (remove query/localStorage overrides in `resolveCoderStatePath`).
2. Wire autosave to write the current HTML to that path using `window.leditorHost.writeFile` (or noop with warning if unavailable).
3. Ensure load uses the same path and surfaces clear logs on failure.
4. Validate with `npm run test:docx-roundtrip`.

## Risk Notes
- Host write API might be missing; handle gracefully with a warning without crashing the editor.
- Path must stay in UNC form; ensure normalization doesn’t break WSL access.

## Validation
- `npm run test:docx-roundtrip`

## Rollback
```bash
git checkout -- src/ui/renderer.ts
git reset --hard HEAD
```

## Progress
- Step 1 — Pin path: PASS
- Step 2 — Autosave wiring: PASS
- Step 3 — Load/logging: PASS
- Step 4 — Validation: PASS
