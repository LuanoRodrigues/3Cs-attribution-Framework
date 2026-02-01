# Master Plan — Premium Theme Upgrade (LEditor + Annotarium Panels)

## Goal
Upgrade **both** Electron apps in this repo to a cohesive, premium, minimalist design system with consistent tokens, motion, and UX polish:
1) `leditor/` (LEditor app)
2) `my-electron-app/` (Annotarium Panels app)

This master plan executes the per-app plans under `Plans/Themes/` in two phases.

## Success criteria
- Both apps share a consistent, recognizable design “signature” (tokens + typography + radii + elevation + motion).
- No “mixed design system” surfaces remain (menus/panels/modals/settings windows included).
- Theme switching works end-to-end:
  - `leditor/`: ribbon + panels + overlays + references iframe + PDF viewer window
  - `my-electron-app/`: workspace + ribbon + panel system + embedded LEditor + settings window + PDF viewer
- “Smoothness” standards are met:
  - panel drag/resize is stable
  - menus open/close predictably
  - reduced-motion is respected
- Builds succeed for both apps (see Validation).

## Constraints
- Follow repo constraints in `AGENTS.md` (offline-first, no untrusted HTML injection, schema-driven editor).
- Keep changes minimal and cohesive; no unrelated refactors.
- Avoid adding generated artifacts, secrets, caches, or build outputs to git.
- When scope is too large, **shard** into executable sub-plans under `Plans/PLAN_SHARDS/` with explicit file lists.

## Scope (exact file list)
This master plan’s direct scope is **planning + execution control artifacts**:
- `Plans/MASTER_PREMIUM_THEME.md`
- `Plans/EXECUTION_INDEX.md` (create/update)
- `Plans/DEPENDENCIES.md` (create only if required)
- `Plans/PLAN_SHARDS/PLAN_SHARD_*.md` (create/update)
- `Plans/Themes/README.md`
- `Plans/Themes/leditor/README.md`
- `Plans/Themes/leditor/overall_app_plan.md`
- `Plans/Themes/leditor/smoothness_perf_plan.md`
- `Plans/Themes/leditor/write_page_plan.md`
- `Plans/Themes/leditor/ribbon_plan.md`
- `Plans/Themes/leditor/panels_plan.md`
- `Plans/Themes/leditor/overlays_plan.md`
- `Plans/Themes/leditor/status_bar_plan.md`
- `Plans/Themes/leditor/references_plan.md`
- `Plans/Themes/leditor/print_preview_plan.md`
- `Plans/Themes/leditor/pdf_viewer_plan.md`
- `Plans/Themes/leditor/rollout_roadmap.md`
- `Plans/Themes/my-electron-app/README.md`
- `Plans/Themes/my-electron-app/overall_app_plan.md`
- `Plans/Themes/my-electron-app/smoothness_perf_plan.md`
- `Plans/Themes/my-electron-app/app_shell_plan.md`
- `Plans/Themes/my-electron-app/ribbon_plan.md`
- `Plans/Themes/my-electron-app/panels_plan.md`
- `Plans/Themes/my-electron-app/write_page_plan.md`
- `Plans/Themes/my-electron-app/retrieve_page_plan.md`
- `Plans/Themes/my-electron-app/analyse_page_plan.md`
- `Plans/Themes/my-electron-app/visualiser_page_plan.md`
- `Plans/Themes/my-electron-app/settings_plan.md`
- `Plans/Themes/my-electron-app/pdf_viewer_plan.md`
- `Plans/Themes/my-electron-app/rollout_roadmap.md`

Implementation code changes are **out of scope for this master file** and must be executed via shard plans that each enumerate their own exact file lists.

## Steps

### Phase 0 — Prepare execution control (required)
1) Create `Plans/EXECUTION_INDEX.md` to track shard cursor, outcomes, and validation logs.
2) If required dependencies/prereqs are missing, create `Plans/DEPENDENCIES.md` (valid plan format) and execute it first.
3) Generate shard plans in `Plans/PLAN_SHARDS/`:
   - Each shard must be a valid plan with the required sections and an explicit file list.
   - Each shard scope is tight: **1–5 files** or one cohesive subsystem.
   - Shards must be ordered and reference the relevant `Plans/Themes/...` plan sections.

### Phase 1 — Execute LEditor premium theme (finish all `Plans/Themes/leditor/*`)
4) Execute shards that implement the foundations for `leditor/`:
   - token system alignment (`--ui-*` alongside `--r-*`)
   - shared primitives (panels/overlays/buttons/inputs/menus)
   - motion + reduced-motion
5) Execute shards that convert injected-style UI surfaces into themeable primitives:
   - search panel, status bar, context menu, preview/print preview, footnotes, sources panel, etc.
6) Execute shards that finalize ribbon + menu cohesion and density edge cases.
7) Execute shards that ensure iframe references picker + PDF viewer window match the theme.
8) Run `leditor/` validation commands (see Validation) and record results in `Plans/EXECUTION_INDEX.md`.

### Phase 2 — Execute Annotarium Panels premium theme (finish all `Plans/Themes/my-electron-app/*`)
9) Execute shards that unify the `my-electron-app/` design system:
   - confirm token contract + primitives
   - decide/lock “V2” styling posture and eliminate drift
10) Execute shards that remove fragile inline styling in theme-critical surfaces:
   - Visualiser page inline-style migration to CSS classes
   - Analyse pages class-based styling (reduce `element.style.*`)
11) Execute shards that polish the panel system and unify menu systems:
   - ribbon context menu, panel grid menu, coder context menu (one visual grammar)
12) Execute shards that improve Write integration (embedded LEditor parity, loading/error UX).
13) Execute shards that theme the settings window and PDF viewer to match main app tokens.
14) Run `my-electron-app/` validation commands (see Validation) and record results in `Plans/EXECUTION_INDEX.md`.

### Phase 3 — Final QA pass (both apps)
15) Perform a final consistency pass (theme/density/effects/scale) and close remaining gaps.
16) Update `Plans/Themes/*/rollout_roadmap.md` checklists with PASS/FAIL notes (optional).

## Risk notes
- **Theme drift**: two apps, two token systems; must explicitly map what is shared vs app-specific.
- **Embedded editor stability**: Write mode embeds LEditor; avoid DOM rebuilds during user interaction.
- **DPI scaling**: `my-electron-app` uses `zoom`; `leditor` uses `transform: scale()` today—changes can affect sharpness.
- **Menu/portal z-index**: inconsistent z-index policies can cause “menus behind panels” bugs.
- **Inline-style debt**: Visualiser/Analyse inline styles can block theme/density improvements until migrated.

## Validation
Run validations after relevant shards and record results in `Plans/EXECUTION_INDEX.md`.

### LEditor (`leditor/`)
- Install (if needed): `npm ci`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Optional targeted checks:
  - `npm run test:print-pdf-headless`
  - `npm run test:pagination`

### Annotarium Panels (`my-electron-app/`)
- Install (if needed): `npm ci`
- Lint/typecheck: `npm run lint`
- Build: `npm run build`
- Optional smoke checks:
  - `npm run smoke:analyse`
  - `npm run perf:analyse`

## Rollback
- Discard all changes: `git reset --hard`
- Remove untracked files: `git clean -fd`
- Roll back a specific file: `git checkout -- <path>`

## Progress
0) Phase 0 — Prepare execution control: PASS
1) Phase 1 — LEditor foundations + primitives: PASS
2) Phase 1 — LEditor surface conversions: PASS
3) Phase 1 — LEditor cross-surface parity (iframe + PDF): PASS
4) Phase 1 — LEditor validation: PASS
5) Phase 2 — my-electron-app foundations + primitives: PASS
6) Phase 2 — my-electron-app inline-style migrations (Visualiser/Analyse): PASS
7) Phase 2 — my-electron-app panels/menus polish: PASS
8) Phase 2 — my-electron-app settings + PDF parity: PASS
9) Phase 2 — my-electron-app validation: PASS
10) Phase 3 — Final QA pass (both apps): PASS
