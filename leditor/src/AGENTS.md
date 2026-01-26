# AGENTS.md (project: leditor)

## Project identity
Project: leditor (Electron + TipTap/ProseMirror)

Goal:
A desktop-first, offline academic document editor with Word-like fidelity, built on TipTap/ProseMirror and packaged with Electron.

---

## Setup & Validation (authoritative for leditor)
Use these commands when you need to install, run, or validate changes in THIS project:

- Install deps:
  - `npm ci`
- Run app:
  - `npm run start`
- Validations (run as relevant to the change):
  - DOCX roundtrip:
    - `npm run test:docx-roundtrip`
  - Generate roundtrip fixture (only when fixtures need updating):
    - `npm run generate:round-trip-fixture`
  - Headless PDF print check:
    - `npm run test:print-pdf-headless`

Notes:
- This project runs Electron directly (`electron .`).
- Keep validations deterministic; prefer the scripts above over manual UI checks.

---

## Always-on product constraints (leditor-specific)
### Canonical representation
- Canonical document format is ProseMirror/TipTap JSON.
- HTML/Markdown are derived only; never the source of truth.

### Editor core
- Use TipTap/ProseMirror transactions/commands for all edits.
- Do not implement editing by manipulating DOM contenteditable directly.

### Offline / desktop
- Offline-first. No requirement for network access to use core functionality.
- Persist documents locally (no cloud dependency).

### Security / import pipeline
- HTML/MD import must be schema-driven and sanitized.
- Unknown constructs are dropped by parser rules (not preserved as raw HTML).
- Do not introduce runtime eval, remote script loading, or untrusted HTML injection.
- Sanitization should remain explicit (this repo uses `sanitize-html`).

---

## Workflow
This file does NOT change the global workflow rules; it only provides leditor-specific commands and expectations.

### Default behavior (no plan explicitly provided)
- If the user requests repo changes: implement directly.
- Do not require a plan.
- Do not create a plan unless the user explicitly asks.

### Multi-hour autonomous runs (only when a plan is explicitly provided)
A “plan is provided” only if:
- the user gives a plan path under `Plans/` (example: `Plans/leditor_some_work.md`), OR
- the user pastes a plan and asks you to adopt it as the execution plan.

When a plan is provided:
- Execute autonomously with no user validation gating.
- Track progress inside the plan.
- Batch work (1–5 files or one subsystem).
- If prerequisites are missing, create `Plans/DEPENDENCIES.md` and execute it first.
- If too large, shard under `Plans/PLAN_SHARDS/` and track cursor in `Plans/EXECUTION_INDEX.md`.

---

## Repo map (fill in as you confirm structure)
Prefer referencing concrete entry points and subsystems by path once known.
Typical areas to document here:
- Electron main process entry (points to `dist/electron/electron/electron/main.js` at runtime)
- Renderer UI entry
- Editor schema/extensions
- Storage layer (local persistence)
- Import/export pipeline (DOCX/HTML/MD/PDF)

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

If such files appear:
- add `.gitignore` rules
- remove from tracking with `git rm --cached`
- keep them local only
