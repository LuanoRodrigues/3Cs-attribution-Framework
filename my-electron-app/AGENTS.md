# AGENTS.md (project: my-electron-app)

## Project identity
Project: my-electron-app (Electron + TypeScript + esbuild)

Goal:
A desktop-first Electron application with a TipTap/ProseMirror editor core, built with TypeScript and bundled via esbuild.

---

## Setup & Validation (authoritative for this project)
Use these commands when you need to install, run, or validate changes in THIS project:

- Install deps:
  - `npm ci`

- Run app:
  - `npm run start`

- Lint (TypeScript typecheck):
  - `npm run lint`

- Build (full pipeline):
  - `npm run build`
    - includes:
      - `npm run build:main`
      - `npm run build:renderer`
      - `npm run build:settings`
      - `npm run validate:leditor-assets`
      - `npm run copy-static`

- Packaging / dist:
  - `npm run dist`

- Targeted validations (run as relevant to the change):
  - `npm run validate:settings`
  - `npm run validate:secrets`
  - `npm run validate:bundle`
  - `npm run smoke:analyse`

Notes:
- `npm test` is not a real test suite here (it exits 1). Do not use it as validation.

---

## Always-on product constraints (project-specific)
### Canonical representation
- Canonical document format is ProseMirror/TipTap JSON.
- Markdown/HTML are derived formats only; never the source of truth.

### Editor core
- Use TipTap/ProseMirror transactions/commands for all edits.
- Do not implement editing by manipulating DOM contenteditable directly.

### Offline / desktop
- Offline-first. No requirement for network access to use core functionality by default.

### Security / sensitive data
- This project has explicit secret checks:
  - prefer `npm run validate:secrets` when working on config/auth/packaging
- Do not introduce:
  - runtime eval
  - remote script loading
  - untrusted HTML injection in renderer windows

---

## Workflow
This file does NOT change the global workflow rules; it only provides this project’s commands and expectations.

### Default behavior (no plan explicitly provided)
- If the user requests repo changes: implement directly.
- Do not require a plan.
- Do not create a plan unless the user explicitly asks.

### Multi-hour autonomous runs (only when a plan is explicitly provided)
A “plan is provided” only if:
- the user gives a plan path under `Plans/` (example: `Plans/my-electron-app_some_work.md`), OR
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
- Electron main process entry:
  - `dist/main.js` (runtime)
  - TypeScript source entry (find in repo)
- Renderer entry:
  - `src/renderer/index.ts` -> `dist/renderer/renderer.js`
- Settings window renderer:
  - `src/windows/settingsRenderer.ts` -> `dist/windows/settings.js`
- Storage layer (SQLite / electron-store / keytar)
- Import/export pipeline (marked / prosemirror-markdown, etc.)
- Scripts:
  - `scripts/start.js`
  - validators under `scripts/`

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
- packaged artifacts, exported PDFs, logs, large data files

If such files appear:
- add `.gitignore` rules
- remove from tracking with `git rm --cached`
- keep them local only
