# AGENTS.md (generic Electron + editor/desktop app projects)

## Project identity
Project: (fill in per repo)

Goal:
Build a desktop-first, offline-capable application packaged with Electron, with deterministic builds/tests and strong import/security posture where applicable.

---

## Setup & Validation (authoritative defaults)
Use these commands when you need to install, run, or validate changes in THIS project. Default to the **Verbose debug run** for any bugfix or hypothesis-testing work so logs are captured automatically.

### Install deps
- `npm ci`

### Run app (standard)
- `npm run start`

### Verbose debug run (default for debugging / hypothesis testing)
Use this when investigating any issue (runtime errors, build failures, flakiness, Electron crashes):
- `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run build --loglevel verbose && npm run start --loglevel verbose`

### Deterministic offline + logs/caches defaults (for restricted/no-network environments)
Use these when the environment has restricted home dir permissions or no network:

- Local npm logs + cache (avoids EACCES on ~/.npm and preserves logs as artifacts):
  - `export npm_config_logs_dir="$PWD/.npm-logs"`
  - `export npm_config_cache="$PWD/.npm-cache"`

- Prefer offline / avoid registry hits when deps are already present:
  - `export npm_config_prefer_offline=true`
  - `export npm_config_audit=false`
  - `export npm_config_fund=false`

- Deterministic install in offline-ish environments:
  - `npm ci --prefer-offline --no-audit --no-fund --loglevel verbose`

### Validations (run as relevant to the change)
Run the smallest set that proves correctness, then run broader checks if risk is high.

Common scripts (use if present in the repo):
- Typecheck:
  - `npm run typecheck --loglevel verbose`
- Lint:
  - `npm run lint --loglevel verbose`
- Unit/integration tests:
  - `npm test --loglevel verbose` or `npm run test --loglevel verbose`
- Packaging/build:
  - `npm run build --loglevel verbose`
  - `npm run build:electron --loglevel verbose` (if present)

Notes:
- This project runs Electron directly (typically `electron .` under the hood).
- Prefer scripted validations over manual UI checks.
- When investigating an issue, keep iterating (instrument → run → inspect logs → refine) until the issue is resolved. Do not stop at typechecks alone.

Offline validation bundle (use when network is unavailable):
- `export npm_config_logs_dir="$PWD/.npm-logs" npm_config_cache="$PWD/.npm-cache" npm_config_prefer_offline=true npm_config_audit=false npm_config_fund=false`
- `npm ci --prefer-offline --no-audit --no-fund --loglevel verbose`
- `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run build --loglevel verbose`
- `npm run typecheck --loglevel verbose`

---

## Debugging & logging expectations (mandatory)
When debugging, operate autonomously:
- Form a concrete hypothesis.
- Add targeted logs to validate/refute it.
- Run the **Verbose debug run** to capture runtime warnings/deprecations/stack dumps.
- Iterate until the issue is solved (do not stop after a single run).

### Log format (required)
All new debug logs must use this format:
- `[file name][function][debug] <message>`

Example:
- `[home.ts][render][debug] selection updated: from=12 to=24`

### Logging rules
- Prefer logging at subsystem boundaries (Electron main/renderer boundary, persistence, import/export, IPC, updater, editor/command layers).
- Logs must be easy to delete or downgrade once the issue is resolved (keep them clearly tagged `[debug]`).
- Avoid logging sensitive user content by default; log sizes, counts, ids, node types, state transitions, and error codes.

### Logging helpers (convention)
When adding multiple logs in a file, prefer a single local helper at top-of-file:
- `const dbg = (fn: string, msg: string) => console.debug(\`[<file>][\${fn}][debug] \${msg}\`);`
Then call `dbg("functionName", "message")` instead of repeating format strings.

Rules:
- Do not introduce global logging frameworks unless explicitly requested.
- Keep it local and easy to delete after issue resolution.

---

## Always-on product constraints (generic)
### Canonical representation (if applicable)
- Prefer a single canonical internal representation for documents/state.
- Derived formats (HTML/Markdown/etc.) are outputs, not the source of truth.

### Electron / runtime integrity
- Do not introduce runtime `eval`, remote script loading, or untrusted code execution.
- Treat IPC boundaries as untrusted input; validate/sanitize messages.
- Avoid leaking secrets into logs.

### Offline / desktop
- Offline-first whenever feasible. Core functionality must not require network.
- Persist user data locally by default (no cloud dependency unless explicitly required).

### Security / import pipeline (if applicable)
- Import must be schema-driven and sanitized.
- Unknown constructs are dropped by parser rules (not preserved as raw HTML).
- Sanitization should remain explicit (e.g., sanitize-html or equivalent).

### Network posture for CI/agent environments
- Assume network may be unavailable.
- Do not rely on registry fetches at runtime for builds/tests; prefer cached/offline npm settings.
- If npm emits network errors (e.g., EAI_AGAIN), treat it as a signal that the run is non-deterministic unless `npm ci --prefer-offline` succeeds and validations pass.
- When network is available, it is allowed for dependency installation only (never required for core app functionality).

---

## Workflow
This file does NOT change global workflow rules; it only provides repo-specific commands and expectations.

### Default behavior (no plan explicitly provided)
- If the user requests repo changes: implement directly.
- Do not require a plan.
- Do not create a plan unless the user explicitly asks.
- For bugs/uncertainty: operate autonomously using a hypothesis-driven loop (instrument → run with verbose debug run → inspect logs → refine) and continue until the issue is solved.
- Default execution for debugging is:
  - `NODE_OPTIONS="--trace-warnings --trace-deprecation --enable-source-maps" ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1 npm run build --loglevel verbose && npm run start --loglevel verbose`

## Autonomous debug protocol (mandatory when fixing issues)
Stop condition: do not stop until the issue is resolved AND validated by at least one relevant validation or a reproduced/verified fix via the verbose debug run.

### Default loop (repeat until solved)
1) State a falsifiable hypothesis (one sentence).
2) Add targeted instrumentation logs using `[file][function][debug]`.
3) Run the verbose debug run.
4) Record observations (what the logs show; what changed).
5) Update hypothesis and narrow the search space.
6) Apply the fix.
7) Re-run relevant validation(s) from “Setup & Validation”.

### Evidence checklist (must be present in final write-up)
- Repro steps (minimal).
- Root cause (mechanism; not just symptom).
- Fix description (what changed and why).
- Validation evidence (which command(s) ran, and what passed).

### Multi-hour autonomous runs (only when a plan is explicitly provided)
A “plan is provided” only if:
- the user gives a plan path under `Plans/` (example: `Plans/some_work.md`), OR
- the user pastes a plan and asks you to adopt it as the execution plan.

When a plan is provided:
- Execute autonomously with no user validation gating.
- Track progress inside the plan.
- Batch work (1–5 files or one subsystem).
- If prerequisites are missing, create `Plans/DEPENDENCIES.md` and execute it first.
- If too large, shard under `Plans/PLAN_SHARDS/` and track cursor in `Plans/EXECUTION_INDEX.md`.

---

## Repro fixtures & golden paths (use to prevent regressions)
When a bug is non-trivial or likely to recur:
- Create the smallest deterministic repro you can:
  - Prefer adding/adjusting test fixtures over ad-hoc manual steps.
  - If the bug is in UI/runtime behavior, prefer a minimal state fixture and a deterministic script/harness if the repo has one.
- Encode golden path assertions where possible (roundtrip equivalence, schema invariants, IPC invariants, no dropped nodes except per parser rules).
- Avoid flaky timing-based assertions; prefer deterministic state checks.

---

## Repo map (fill in as you confirm structure)
Prefer referencing concrete entry points and subsystems by path once known.
Typical areas to document here:
- Electron main process entry
- Renderer UI entry
- IPC layer
- Storage/persistence layer
- Import/export pipeline (if any)
- Build/package configuration

When discussing code, cite locations as:
- `relative/path.ext:L120–L188`
Include function/class name and a stable snippet anchor.

---

## Change delivery format
If the user requests a specific change format, comply exactly:
- continuous blocks
- no diff markers
- no fragmented replacements

---

## Git hygiene
Never add generated artifacts, caches, secrets, build outputs, or local datasets.
Examples:
- `.env`, secrets
- `.idea/`, `.vscode/`
- `__pycache__/`, `*.pyc`
- `node_modules/`
- exported PDFs, logs, large data files
- `.npm-cache/`, `.npm-logs/`

If such files appear:
- add `.gitignore` rules
- remove from tracking with `git rm --cached`
- keep them local only
