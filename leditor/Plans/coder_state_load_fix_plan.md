# Goal
Stop coder state auto-load from skipping; add a dev-friendly read fallback and emit a preview of loaded text.

# Success criteria
- Coder state loads from `\\wsl$\\Ubuntu-20.04\\home\\pantera\\annotarium\\coder\\0-13_cyber_attribution_corpus_records_total_included\\coder_state.json` even when `window.leditorHost.readFile` is missing, using a secondary fetch path.
- Console shows `[text][loader]: <absolute path>` plus a `[text][preview]` log containing a snippet of loaded HTML.
- Existing autosave behavior remains unchanged.
- Validation command passes.

# Constraints
- Follow AGENTS.md: no defensive fallbacks that hide errors; schema-based editor intact.
- Limit code edits to declared scope.
- No user interaction during execution; run validation ourselves.

# Scope
- src/ui/renderer.ts

# Steps
1. Inspect current load flow to identify where it returns null and what path/value data is available for a fallback fetch.
2. Add a Vite dev-server fallback (`/@fs/<abs-path>`) with clear logging; keep host and file:// paths intact. Add preview logging of loaded HTML snippet.
3. Run validation: `npm run test:docx-roundtrip --silent`.

# Risk notes
- Fallback URL must be same-origin to avoid CORS; ensure it only triggers when `location.protocol` is http(s).
- Preview logging must avoid large payloads; limit snippet length.

# Validation
- `npm run test:docx-roundtrip --silent`

# Rollback
- `git checkout -- src/ui/renderer.ts`

# Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
