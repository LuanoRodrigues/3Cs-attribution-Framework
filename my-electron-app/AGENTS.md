# AGENTS.md (project: leditor)

## Project identity
Project: leditor (Electron + TipTap/ProseMirror)

Goal:
A desktop-first, offline academic document editor with Word-like fidelity, built on TipTap/ProseMirror and packaged with Electron.

---

## Setup & Validation (authoritative for leditor)
Use these commands when you need to install, run, or validate changes in THIS project. Default to the “Verbose debug run” for any bugfix or hypothesis-testing work so logs are captured automatically.

- Install deps:
  - `npm ci`

- Run app (standard):
  - `npm run start`

- Run app (verbose debug run — default for debugging / hypothesis testing):
  - `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run build && npm run start --loglevel verbose`

- Environment defaults for autonomous runs (logs/caches/offline)
  Use these when the environment has restricted home dir permissions or no network:
  - Local npm logs + cache (avoids EACCES on ~/.npm and preserves logs as artifacts):
    - `export npm_config_logs_dir="$PWD/.npm-logs"`
    - `export npm_config_cache="$PWD/.npm-cache"`
  - Prefer offline / avoid registry hits when deps are already present:
    - `export npm_config_prefer_offline=true`
    - `export npm_config_audit=false`
    - `export npm_config_fund=false`
  - If network is unavailable, hard-fail on missing cached packages (deterministic):
    - `npm ci --prefer-offline --no-audit --no-fund --loglevel verbose`

- Validations (run as relevant to the change):
  - DOCX roundtrip:
    - `npm run test:docx-roundtrip`
  - Generate roundtrip fixture (only when fixtures need updating):
    - `npm run generate:round-trip-fixture`
  - Headless PDF print check:
    - `npm run test:print-pdf-headless`

Notes:
- This project runs Electron directly (`electron .`).
- Prefer the scripts above over manual UI checks.
- When investigating an issue, keep iterating (instrument → run → inspect logs → refine) until the issue is resolved. Do not stop at typechecks alone.

Offline validation bundle (use when network is unavailable):
- `export npm_config_logs_dir="$PWD/.npm-logs" npm_config_cache="$PWD/.npm-cache" npm_config_prefer_offline=true npm_config_audit=false npm_config_fund=false`
- `npm ci --prefer-offline --no-audit --no-fund --loglevel verbose`
- `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run build --loglevel verbose`
- `npm run typecheck --loglevel verbose`

---
## Always-on product constraints (leditor-specific)

## Debugging & logging expectations (leditor-specific)
When debugging, the agent must operate autonomously:
- Form a concrete hypothesis.
- Add targeted logs to validate/refute it.
- Run the **Verbose debug run** (see Setup & Validation) to capture full runtime warnings/deprecations/stack dumps.
- Iterate until the issue is solved (do not stop after “npm typecheck” or a single run).

### Log format (required)
All new debug logs must use this format:
- `[file name][function][debug] <message>`

Example:
- `[home.ts][render][debug] selection updated: from=12 to=24`

### Logging rules
- Prefer logging at subsystem boundaries (import/export pipeline, persistence, schema/commands, Electron main/renderer boundary).
- Logs must be easy to delete or downgrade once the issue is resolved (keep them clearly tagged `[debug]`).
- Avoid logging sensitive document contents by default; log sizes, counts, node types, positions, ids, and state transitions.

### Canonical representation
- Canonical document format is ProseMirror/TipTap JSON.
- HTML/Markdown are derived only; never the source of truth.


### Editor core
- Use TipTap/ProseMirror transactions/commands for all edits.
- Do not implement editing by manipulating DOM contenteditable directly.
- When debugging schema/transaction issues, add temporary runtime assertions near the source (e.g., node types, positions, selection invariants) and remove or downgrade them once resolved.

### Offline / desktop
- Offline-first. No requirement for network access to use core functionality.
- Persist documents locally (no cloud dependency).

### Network posture for CI/agent environments
- Assume network may be unavailable.
- Do not rely on registry fetches at runtime for builds/tests; prefer cached/offline npm settings.
- If npm emits network errors (e.g., EAI_AGAIN), treat it as a signal that the run is non-deterministic unless `npm ci --prefer-offline` succeeds and validations pass.
- When network is available, it is allowed for dependency installation only (never required for core app functionality).

### Security / import pipeline
- HTML/MD import must be schema-driven and sanitized.
- Unknown constructs are dropped by parser rules (not preserved as raw HTML).
- Do not introduce runtime eval, remote script loading, or untrusted HTML injection.
- Sanitization should remain explicit (this repo uses `sanitize-html`).

---

## Workflow
This file does NOT change the global workflow rules; it only provides leditor-specific commands and expectations.

## Autonomous debug protocol (mandatory when fixing issues)
Stop condition: do not stop until the issue is resolved AND validated by at least one relevant validation or a reproduced/verified fix via the verbose debug run.

### Default loop (repeat until solved)
1) State a falsifiable hypothesis (one sentence).
2) Add targeted instrumentation logs using `[file][function][debug]`.
3) Run:
   - `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run build && npm run start --loglevel verbose`
4) Record observations (what the logs show; what changed).
5) Update hypothesis and narrow the search space.
6) Apply the fix.
7) Re-run relevant validation(s) from “Setup & Validation”.

### Evidence checklist (must be present in final write-up)
- Repro steps (minimal).
- Root cause (mechanism; not just symptom).
- Fix description (what changed and why).
- Validation evidence (which command(s) ran, and what passed).

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

### Default behavior (no plan explicitly provided)
- If the user requests repo changes: implement directly.
- Do not require a plan.
- Do not create a plan unless the user explicitly asks.
- For bugs/uncertainty: operate autonomously using a hypothesis-driven loop (instrument → run with verbose debug run → inspect logs → refine) and continue until the issue is solved.
- Default execution for debugging is:
  - `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run build && npm run start --loglevel verbose`

### Multi-hour autonomous runs (only when a plan is explicitly provided)

A “plan is provided” only if:
- the user gives a plan path under `Plans/pending/` (example: `Plans/pending/leditor_some_work.md`), OR
- the user pastes a plan and asks you to adopt it as the execution plan.

#### Plans folder invariants (mandatory)

- Ensure these directories exist in the repo root; create them if missing:
  - `Plans/`
  - `Plans/pending/`
  - `Plans/legacy/`

- All newly created plans MUST be created under `Plans/pending/` only.
- Once a plan is finished (all steps attempted), move it from `Plans/pending/` to `Plans/legacy/` and update `Plans/EXECUTION_INDEX.md` accordingly.

#### Plan execution authority (mandatory)

- Execute only plans you have created OR plans the user explicitly instructs you to run.
- Do NOT execute or adopt any other plans found in the repository implicitly.
- Never operate on plans located in `Plans/legacy/`.

#### Scope discipline (mandatory)

- Any change in the codebase MUST be strictly related to the active Codex task scope.
- Do NOT refactor, reformat, rename, or modify unrelated files.
- Do NOT restore, revert, or adjust previous work unless it is explicitly part of the active plan.

#### Execution behavior when a plan is provided

- Execute autonomously with no user validation gating.
- Track progress inside the active plan.
- Batch work (1–5 files or one subsystem).
- If prerequisites are missing, create `Plans/DEPENDENCIES.md` and execute it first.
- If the plan is too large, shard under `Plans/pending/PLAN_SHARDS/` and track cursor in `Plans/pending/EXECUTION_INDEX.md`.

---

## Repo map (fill in as you confirm structure)
Prefer referencing concrete entry points and subsystems by path once known.
Typical areas to document here:
- Electron main process entry (points to `dist/electron/electron/electron/main.js` at runtime)
- Renderer UI entry
- Editor schema/extensions
- Storage layer (local persistence)
- Import/export pipeline (DOCX/HTML/MD/PDF)

## Repro fixtures & golden paths (use to prevent regressions)
When a bug is non-trivial or likely to recur:
- Create the smallest deterministic repro you can:
  - Prefer adding/adjusting test fixtures for roundtrip tests (DOCX/HTML/MD) over ad-hoc manual steps.
  - If the bug is in UI/editor behavior, create a minimal document JSON fixture and a scripted interaction if the repo has that harness.
- Encode “golden path” assertions where possible (roundtrip equivalence, schema invariants, no dropped nodes except per parser rules).
- Avoid flaky timing-based assertions; prefer deterministic state checks.

When discussing code, cite locations as:
- `relative/path.ext:L120–L188`
Include function/class name and a stable snippet anchor.

---

## Change delivery format
If the user requests a specific change format, comply exactly:
- continuous blocks
- no diff markers
- no fragmented replacements

## Logging helpers (convention)
When adding multiple logs in a file, prefer a single local helper at top-of-file:
- `const dbg = (fn: string, msg: string) => console.debug(\`[<file>][\${fn}][debug] \${msg}\`);`
Then call `dbg("functionName", "message")` instead of repeating format strings.

Rules:
- Do not introduce global logging frameworks.
- Keep it local and easy to delete after issue resolution.

## Code correctness constraints (FAIL-FAST)

- Errors are signals. Prefer a crash to ambiguous behavior.
- Do not add safety fallbacks, guards, or silent coercions to hide missing keys or attributes.
- If correctness cannot be guaranteed without adding such fallbacks, stop and explain the ambiguity instead of masking it.

### Avoid masking (mandatory)

- Do not introduce patterns that hide correctness issues.
- Avoid CSS `!important` unless the active task explicitly requires it.
- Avoid reflective or defensive constructs such as:
  - optional chaining used only to suppress errors,
  - `hasattr` / “hasAttribute” style checks,
  - runtime feature detection used to bypass invariants.
- Do not implement silent error swallowing, default fallbacks, or hidden coercions.

## Git hygiene
Never add generated artifacts, caches, secrets, build outputs, or local datasets.
Examples:
- `.env`, secrets
- `.idea/`, `.vscode/`
- `__pycache__/`, `*.pyc`
- `node_modules/`
- exported PDFs, logs, large data files


If such files appear:
- add `.gitignore` rules
- remove from tracking with `git rm --cached`
- keep them local only
