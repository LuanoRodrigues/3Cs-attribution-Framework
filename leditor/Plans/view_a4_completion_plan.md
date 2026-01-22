# Plans/view_a4_completion_plan.md — Finalize View ribbon + A4 validation

## Goal
Close the remaining plan work for the View ribbon fix and the A4 centering/header-focus plan by validating the declarative View tab metadata, ensuring the full ribbon/front-end bundle builds/resolves the legacy externals, and rerunning the regression tests that anchor the existing ribbon/style work (`Plans/ribbon_plan.md`, `Plans/ribbon_full_plan.md`, `Plans/ribbon_height_plan.md`).

## Success criteria
1. `Plans/view.json` defines every View tab control expected by the spec (`view.source.selector`, `view.cleanHtml`, `view.allowedElements`, `view.formattingMarks`), and a new validation script confirms those IDs are present before we build.
2. The renderer bundle rebuild for A4/ ribbon fidelity uses `--external:node:fs/promises` and `--external:@simonwep/pickr/dist/pickr.min.css` so that the legacy plan’s validation command succeeds.
3. `npm run test:docx-roundtrip` passes once more after the bundle rebuild, offering the deterministic verification required by the referenced plans.

## Constraints
- Follow AGENTS.md (plan-based execution, no eval, desktop/offline constraints).  
- The new script must run via the existing Node toolchain; avoid transpilation dependencies.  
- Maintain the schema-centric ribbon expectations from `Plans/ribbon_plan.md`, the extensive primitives coverage from `Plans/ribbon_full_plan.md`, and the fixed-height results from `Plans/ribbon_height_plan.md`.

## Scope
- `scripts/validate_view_tab.js` (new Node script).
- `Plans/view.json` (declarative tab description verified by the script).
- All existing ribbon-related plans referenced above, since their success criteria rely on the validations we will rerun via this plan.
- This plan file itself (`Plans/view_a4_completion_plan.md`).

## Steps
1. Implement `scripts/validate_view_tab.js` so it reads `Plans/view.json`, extracts every control ID (including nested menu items), and fails fast if any required View controls (Source view selector, Clean HTML, Allowed elements, Formatting marks) are missing. (files: `scripts/validate_view_tab.js`, `Plans/view.json`)
2. Run `node scripts/validate_view_tab.js` locally to confirm the View definition matches the spec. Record the result inside this plan’s progress. (command: `node scripts/validate_view_tab.js`)
3. Rebuild the renderer via `npx esbuild scripts/renderer-entry.ts --bundle --platform=browser --format=esm --sourcemap --outfile=dist/renderer/bootstrap.bundle.js --loader:.ttf=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl --external:node:fs/promises --external:@simonwep/pickr/dist/pickr.min.css` per the A4 plan’s Step 5 validation. (command: same as above)
4. Run `npm run test:docx-roundtrip` as the deterministic validation required by the ribbon plans. (command: `npm run test:docx-roundtrip`)

## Risk notes
- If `Plans/view.json` loses a control ID, the new validation script will fail fast; fix the JSON before rerunning the plan.  
- The esbuild command relies on externalizing the missing CSS/FS modules; forgetting the `--external` flags will break the bundle.  
- Running the docx test repeatedly can take time; the plan anticipates this cost but records the last success path.

## Validation
- `node scripts/validate_view_tab.js`  
- `npx esbuild scripts/renderer-entry.ts --bundle --platform=browser --format=esm --sourcemap --outfile=dist/renderer/bootstrap.bundle.js --loader:.ttf=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl --external:node:fs/promises --external:@simonwep/pickr/dist/pickr.min.css`  
- `npm run test:docx-roundtrip`

## Rollback
- `git checkout -- scripts/validate_view_tab.js Plans/view_a4_completion_plan.md`
- Re-run the esbuild command with the same flags to regenerate `dist/renderer/bootstrap.bundle.js` if necessary.

## Progress
- Step 1 (validation script): PASS  
- Step 2 (validate View JSON): PASS  
- Step 3 (esbuild rebuild with externals): PASS  
- Step 4 (docx roundtrip test): PASS
