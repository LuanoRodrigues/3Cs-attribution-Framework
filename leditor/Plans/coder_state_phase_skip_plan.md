# Goal
Prevent validation phases from overwriting loaded coder_state content while keeping existing diagnostics available when no coder_state is present.

# Success criteria
- When coder_state loads, the editor preserves that content (no validation setContent overwrites).
- Validation phases still run when no coder_state content is provided.
- Validation command passes.

# Constraints
- Follow AGENTS.md rules; minimal scope edits.
- No new silent fallbacks.

# Scope
- src/ui/renderer.ts

# Steps
1. Detect existing hasInitialContent flag and use it to gate destructive validation phases.
2. Wrap Phase21/22 validation calls (and any related setContent) to run only when no initial content.
3. Run validation: `npm run test:docx-roundtrip --silent`.

# Risk notes
- Skipping validations could mask regressions; limit skip strictly to the presence of coder_state content.

# Validation
- `npm run test:docx-roundtrip --silent`

# Rollback
- `git checkout -- src/ui/renderer.ts`

# Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
