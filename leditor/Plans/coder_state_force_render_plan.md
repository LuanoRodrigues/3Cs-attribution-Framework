# Goal
Ensure coder_state HTML actually appears in the editor by force-setting it after init and logging the rendered length.

# Success criteria
- When coder_state is loaded, editor content is populated (length > 0) and logged.
- Existing loader logs remain intact; validations stay gated on hasInitialContent.
- Validation command passes.

# Constraints
- Follow AGENTS.md rules; minimal scoped changes.
- Do not alter autosave or schema logic.

# Scope
- src/ui/renderer.ts

# Steps
1. Add a post-init apply of coder_state HTML (only when present) and log rendered length.
2. Keep validation gating as-is; ensure no double-overwrite when coder_state absent.
3. Run validation: `npm run test:docx-roundtrip --silent`.

# Risk notes
- Double-set should not run when coder_state is missing; guard accordingly.

# Validation
- `npm run test:docx-roundtrip --silent`

# Rollback
- `git checkout -- src/ui/renderer.ts`

# Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
