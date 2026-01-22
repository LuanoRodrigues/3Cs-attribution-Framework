# Goal
Expose coder_state first node details in logs and via Ctrl+Shift+R so loaded content is verifiable.

# Success criteria
- On coder_state load, console prints first `nodes[0]` (id/name/type and editedHtml length) alongside the path.
- Pressing Ctrl+Shift+R logs the same first-node info (or a clear message if not loaded).
- Existing loader/preview logs stay intact.
- Validation command passes.

# Constraints
- Follow AGENTS.md execution rules; touch only scoped files.
- No defensive fallbacks that hide errors.

# Scope
- src/ui/renderer.ts
- src/ui/shortcuts.ts

# Steps
1) Extend coder_state parsing to retain the first node metadata and store it for later use.
2) Emit a log on successful load showing nodes[0] summary; add Ctrl+Shift+R shortcut to re-print it.
3) Run validation: `npm run test:docx-roundtrip --silent`.

# Risk notes
- Ensure new logging doesn’t crash when coder_state is absent (log a concise “not loaded” message).

# Validation
- `npm run test:docx-roundtrip --silent`

# Rollback
- `git checkout -- src/ui/renderer.ts src/ui/shortcuts.ts`

# Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
