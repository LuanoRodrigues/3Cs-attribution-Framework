# AGENTS.md (repo root)

## Role
You are Codex operating inside this local repository.

Goal:
Build a desktop-first, offline academic document editor with Word-like fidelity, using a schema-based editor core (ProseMirror-family via TipTap) and Electron.

You are NOT prototyping.
You are building a runnable, extensible application that compiles and runs locally.

---

## How Codex should interpret this file
This file provides repo-wide guidance. Codex reads AGENTS.md automatically before work and may also apply more specific instructions from deeper folders if present. :contentReference[oaicite:2]{index=2}

---

## Always-on product constraints (apply to ALL work)
### Canonical representation
- The canonical document format is structured JSON (ProseMirror/TipTap document JSON).
- HTML and Markdown are derived formats only.
- HTML and Markdown must never be the source of truth.

### Editor core
- Do NOT build an editor from raw contenteditable DOM.
- Do NOT invent an editor engine.
- Use a schema-based transactional editor engine (ProseMirror-family).
- All content changes must occur via transactions/commands.

### Desktop / offline
- Desktop packaging is Electron.
- Offline-first is default: documents persist locally.
- No cloud features, no network requirement to use the editor.

### Security
- Import (HTML/MD) must be schema-driven.
- Unknown constructs must be dropped by parser rules, not preserved as raw HTML.
- Do not introduce runtime eval, remote script loading, or untrusted HTML injection.

---

## Workflow (GENERAL DEFAULT)
### If NO plan is explicitly provided
- If the user asks questions/debugging: answer and explain. Do not modify repo files unless the user explicitly asks for changes.
- If the user requests repository changes (implement/fix/build): implement directly without requiring a plan.
- Do not create a plan unless the user explicitly asks for one.

### Escalation: create deterministic tests when fixes are not converging (mandatory)
If you attempt multiple fixes for the same issue and results are still inconsistent or failing:
- Stop guessing from symptoms and create a deterministic test harness to validate the invariant before reporting back.
- Prefer automated checks over manual UI inspection, especially for layout/pagination/widget correctness.

Where to put these tests:
- Create repo-local scripts under `Plans/pending/scripts/` (create the directory if missing).
- Keep scripts narrowly scoped to the active task and easy to delete once the issue is resolved.

What “deterministic” means here:
- The script must produce a PASS/FAIL signal based on explicit invariants (no “looks ok” checks).
- The script must be runnable locally and in CI-like environments (offline, headless where possible).

Example (layout/pagination invariant):
- If a page must be “fully populated” without overflow gaps, implement a check that computes per-page line/word distribution and fails if:
  - a line contains only 1–2 words when it should be wrapped (overflow/measure bug),
  - there are unexpected empty lines,
  - content overlaps footnote containers,
  - page overflow/underflow thresholds are violated.

Required workflow under escalation:
1) Create or update the deterministic script.
2) Run the script and capture output.
3) Iterate on code until the script passes reliably.
4) Only then report the fix to the user, including the script name/path and the passing result.

---
## Workflow (MULTI-HOUR AUTONOMOUS RUNS — ONLY WHEN A PLAN IS PROVIDED)
A “plan is provided” only if:
- the user gives a plan file path under `Plans/` (example: `Plans/pending/FEATURE_X.md`), OR
- the user pastes a plan and asks you to adopt it as the execution plan.

When a plan is provided:
- Treat the plan as the single source of truth for:
  - execution order
  - scope
  - validation requirements
  - progress tracking
- Execute autonomously with NO user validation gating:
  - do not pause for approval between phases/batches
  - do not ask the user to run validation commands for you
- For long runs, rely on explicit, file-based plans because the execution agent does not infer missing intent: embed assumptions and required context in the plan itself. :contentReference[oaicite:3]{index=3}

### Plans folder invariants (mandatory)
- Ensure these directories exist in the repo root; create them if missing:
  - `Plans/`
  - `Plans/pending/`
  - `Plans/legacy/`
- All newly created plans MUST be created under `Plans/pending/` only.
- Once a plan is finished (all steps attempted), move it from `Plans/pending/` to `Plans/legacy/` and update `Plans/pending//EXECUTION_INDEX.md` accordingly.

### Plan location constraint (for plan-provided runs only)
- The active execution plan MUST live under `Plans/pending/`.
- If the user gives a plan path outside `Plans/pending/`, create a copy under `Plans/pending/` and treat that as the active plan.

### Plan execution authority (mandatory)
- Do NOT implement or execute plans you did not create and that the user did not explicitly ask you to run.
- Do NOT “discover” or pick up other plans from the repository implicitly (including older plans in `Plans/legacy/`).

### Scope discipline (mandatory)
- Any repo change MUST be strictly related to the active Codex task scope (as defined by the active plan or explicit user request).
- Do NOT refactor, reformat, rename, or “clean up” unrelated code or files.

### Plan format (required for plan-provided runs)
The active Plan MUST include:
- Goal (1–2 sentences)
- Success criteria (concrete, verifiable)
- Constraints (user + repo + this AGENTS.md)
- Scope (exact file list)
- Steps (numbered, with file paths and target symbols)
- Risk notes (what could break and how it will be detected)
- Validation (commands or deterministic checks Codex will run itself)
- Rollback (explicit git commands)
- Progress (tracks each step as NOT STARTED / PASS / FAIL)

If any of these sections are missing:
- add them to the plan (minimal, mechanical normalization)
- initialize Progress to NOT STARTED for all steps
- then begin execution

---

## Multi-hour execution semantics (applies ONLY when a plan is provided)
### Non-interactive execution
Once execution begins under an active plan, do not request confirmation to proceed. Continue until:
- all plan steps are attempted, OR
- tooling/session limits prevent further progress (in which case record the stop point in EXECUTION_INDEX.md and produce the final report).

### Execution batching (mandatory)
Execute work in batches:
- 1–5 files per batch, OR
- one cohesive subsystem per batch.

After each batch:
- update the Plan’s Progress section (mark steps PASS/FAIL as appropriate)
- record validation results in the Plan
- continue automatically to the next batch

### Dependency and gap resolution (mandatory)
If the active Plan has missing prerequisites/unresolved dependencies that would prevent correct execution:
- create `Plans/DEPENDENCIES.md` (a valid Plan with the same required sections)
- execute it fully first
- then resume the active Plan from the next unfinished step
- record this insertion and outcomes in `Plans/EXECUTION_INDEX.md`

### Sharding (mandatory when the plan is too large)
If the provided Plan is too large to complete end-to-end within practical limits:
- create/update `Plans/EXECUTION_INDEX.md`
- create `Plans/PLAN_SHARDS/PLAN_SHARD_001.md`, `PLAN_SHARD_002.md`, ...
  - each shard is a valid Plan per the format above (including Progress)
  - each shard scope is tight: 1–5 files or one cohesive subsystem
  - preserve original ordering (mechanical split, not reinterpretation)
- execute shards sequentially without user interaction
- update EXECUTION_INDEX.md after each shard with cursor + outcomes

### Validation behavior (plan-provided runs)
- Run the validation commands listed in the active plan.
- Prefer deterministic commands (tests/build) over manual checks.
- If validation fails:
  - attempt to fix within the plan’s scope
  - record failures and fixes in the plan
  - do not pause for user approval

### Mandatory post-execution summary (plan-provided runs)
At the end (completion or limits), produce exactly one final report containing:
1) Execution Statistics
- total steps attempted
- number PASS
- number FAIL

2) Failure Index
For each failed step:
- step number and title
- single most relevant failure symptom
- affected subsystem (storage, schema, UI, security, etc.)

3) Next-Step Recommendations
A non-interactive list derived only from observed failures or incomplete shards:
1. Required fixes (blocking correctness or security)
2. Strongly recommended improvements
3. Optional enhancements

---

## Code correctness constraints (FAIL-FAST)
- Errors are signals. Prefer a crash to ambiguous behavior.
- Do not add safety fallbacks, guards, or silent coercions to hide missing keys/attributes.
- If correctness cannot be guaranteed without adding such fallbacks, stop and explain what is ambiguous.

### Avoid masking (mandatory)
- Do not introduce masking patterns that hide correctness issues.
- Avoid CSS `!important` unless the active plan explicitly requires it.
- Avoid reflective/defensive patterns like `hasattr` / “hasAttribute” / optional chaining used to bypass invariants.

---

## Setup & Validation (repo-specific)
Fill these in with the real commands for this repo:
- Install deps: `<command>`
- Dev: `<command>`
- Build: `<command>`
- Test: `<command>`
- Lint/format: `<command>`

When implementing changes, run the relevant validation commands yourself and report outcomes.

---

## File / line references (“LINE CURSOR”)
When discussing code, cite locations as:
- `relative/path.ext:L120–L188`
Include function/class name and a stable snippet anchor when useful.

---

## Git hygiene (critical)
Avoid committing generated artifacts, caches, secrets, build outputs, or local datasets.

Never add:
- `.env`, secrets
- `.idea/`, `.vscode/`
- `__pycache__/`, `*.pyc`
- `node_modules/`
- Qt binaries
- Zotero, PDF, runtime caches
- exported PDFs, PPTX previews, large data files, logs

If such files appear:
- add appropriate `.gitignore` rules
- remove them from tracking with `git rm --cached`
- keep them local only

---

## Change delivery format
If the user requests a specific change format, comply exactly:
- continuous blocks
- no diff markers
- no fragmented replacements
