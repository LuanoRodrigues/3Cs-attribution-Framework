# Plans/pickr_css_plan.md — Pickr CSS bundling fix

## Goal
Stop esbuild from leaving `@simonwep/pickr/dist/pickr.min.css` as an unresolved module specifier by keeping only the theme stylesheet that actually exists.

## Success criteria
1. `src/ui/ribbon.ts` imports `@simonwep/pickr/dist/themes/classic.min.css` (the existing file) and no longer references the missing `pickr.min.css`.  
2. Running the renderer bundle command (`npx esbuild ...`) completes without CSS resolution errors.  
3. `npm run test:docx-roundtrip` passes after the new bundle.

## Constraints
- Use plan format compliance per AGENTS.  
- Keep changes localized to ribbon entry and the plan itself.  
- Leave existing CSS framework intact (no inline styles).

## Scope
- `src/ui/ribbon.ts`  
- `Plans/pickr_css_plan.md`

## Steps
1. Remove the outdated `@simonwep/pickr/dist/pickr.min.css` import and keep only `@simonwep/pickr/dist/themes/classic.min.css`, ensuring the referenced file exists. (files: `src/ui/ribbon.ts`)  
2. Re-run the renderer bundle command *without* marking the CSS as external and confirm it resolves, then run `npm run test:docx-roundtrip`. (command: `npx esbuild ...` + `npm run test:docx-roundtrip`)

## Risk notes
- Referencing a missing CSS path triggers bundler failure; validating the path ahead of time avoids this failure.  
- Rebuilding the bundle with the new import ensures downstream consumers pick up the fix.

## Validation
- `npx esbuild scripts/renderer-entry.ts --bundle --platform=browser --format=esm --sourcemap --outfile=dist/renderer/bootstrap.bundle.js --loader:.ttf=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl --external:node:fs/promises`  
- `npm run test:docx-roundtrip`

## Rollback
- `git checkout -- src/ui/ribbon.ts Plans/pickr_css_plan.md`

## Progress
- Step 1 (import cleanup): PASS  
- Step 2 (bundle + test): PASS
