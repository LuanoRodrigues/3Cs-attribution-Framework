# Plans/PLAYBOOK_EXECUTION.md

This playbook applies only when an explicit plan is provided under `Plans/` or pasted and adopted as the active plan.

## Plan requirements (normalize if missing)
Active plan must contain:
- Goal (1–2 sentences)
- Success criteria (verifiable)
- Constraints
- Scope (exact file list)
- Steps (numbered, with file paths and target symbols)
- Risk notes
- Validation (commands/checks Codex will run)
- Rollback (explicit git commands)
- Progress (NOT STARTED / PASS / FAIL per step)

If Progress is missing: add it (initialize all to NOT STARTED) before execution begins.

## No gating
During execution:
- Do not ask the user to validate phases/batches.
- Do not pause for approval.
- Run validation yourself and record outcomes.

## Batching
Execute in batches:
- 1–5 files per batch OR one cohesive subsystem per batch.

After each batch:
- Update Progress in the active plan
- Record validation outcomes
- Continue automatically

## Dependency plan
If prerequisites are missing:
- Create `Plans/DEPENDENCIES.md` (same plan format)
- Execute it fully first
- Record insertion and results in `Plans/EXECUTION_INDEX.md`
- Resume the active plan

## Sharding for very large plans
If the active plan is too large for one run:
- Create/update `Plans/EXECUTION_INDEX.md`
- Create `Plans/PLAN_SHARDS/PLAN_SHARD_001.md`, `PLAN_SHARD_002.md`, ...
  - each shard is a valid plan with Progress
  - shard scope is tight (1–5 files or one subsystem)
- Execute shards sequentially without user interaction

## Validation behavior
- Prefer deterministic commands (tests/build) over manual checks.
- If validation fails, attempt to fix within scope before moving on.
- If a failure cannot be resolved without breaking constraints/scope, record it clearly and continue only if subsequent steps do not depend on the failure being fixed.

## Mandatory final report
At the end:
1) Execution statistics (steps PASS/FAIL)
2) Failure index (step, symptom, subsystem)
3) Next-step recommendations (required / recommended / optional)
