# Goal
Stop validation smoke tests from overwriting loaded coder_state content so the first node renders in the editor.

# Success criteria
- When coder_state.json loads, its HTML appears in the editor (no test content replaces it).
- Existing validations still run when no coder state is loaded.
- Validation command passes.

# Constraints
- Follow AGENTS.md rules; touch only necessary files.
- Keep loader logs intact; no new fallbacks that hide failures.

# Scope
- src/ui/renderer.ts

# Steps
1. Identify where mountEditor overwrites content after initialization.
2. Guard destructive smoke-test content setters to run only when no coder-state content was loaded.
3. Run validation: `npm run test:docx-roundtrip --silent`.

# Risk notes
- Skipping validations must be conditional only when initial content exists to preserve test coverage otherwise.

# Validation
- `npm run test:docx-roundtrip --silent`

# Rollback
- `git checkout -- src/ui/renderer.ts`

# Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
