Goal  
Remove the legacy ribbon source path (`src/ui/ribbon.js` and its direct import chain) so the project uses the TypeScript ribbon exclusively, and list the authoritative ribbon files.

Success criteria  
- Legacy ribbon source files eliminated from src (no imports targeting `ribbon.js`).  
- Renderer entrypoints import the TS ribbon (`ribbon.ts` / `renderer.ts`).  
- Build inputs reference TS files only; lint/type builds succeed (network permitting).  
- Output: a clear list of current ribbon-relevant files delivered to user.

Constraints  
- Follow AGENTS.md: schema-based editor, offline-first, no defensive fallbacks.  
- No destructive git resets; keep dist artifacts unless rebuild succeeds.  
- Offline constraint may block esbuild; record validation status if so.  
- Avoid touching dist outputs manually.

Scope  
- `src/ui/ribbon.js` (remove)  
- `src/ui/renderer.js` (update import target or remove)  
- `scripts/renderer-entry.ts`, `src/editor/bootstrap.ts` (update imports)  
- `src/ui/renderer.ts` (already points to TS)  
- Optionally remove redundant compiled JS siblings: `scripts/renderer-entry.js`, `src/editor/bootstrap.js` if safe.

Steps  
1) Scan imports referencing `ribbon.js`/`renderer.js` within src/scripts; map replacements to `.ts`.  
2) Update TS entrypoints to import TS modules; delete legacy `src/ui/ribbon.js`.  
3) Remove redundant compiled JS entry stubs (`scripts/renderer-entry.js`, `src/editor/bootstrap.js`) if not needed for build.  
4) Run validation (`npm run test:docx-roundtrip` or esbuild) if network allows; otherwise record blocker.  
5) Provide final list of authoritative ribbon files and status.

Risk notes  
- Deleting compiled JS may break tooling if something still resolves to .js; must ensure all entry imports updated.  
- Build may still rely on dist artefacts; without rebuild, runtime may still load old ribbon until re-bundled.

Validation  
- `npx esbuild scripts/renderer-entry.ts --bundle --sourcemap --outfile=dist/renderer/bootstrap.bundle.js` (may fail offline; record)  
- If time permits: `npm run test:docx-roundtrip`

Rollback  
- `git restore src/ui/ribbon.js src/ui/renderer.js scripts/renderer-entry.ts src/editor/bootstrap.ts scripts/renderer-entry.js src/editor/bootstrap.js`

Progress  
- Step 1: PASS (imports mapped; legacy targets identified)  
- Step 2: PASS (TS entry imports updated; removed `src/ui/ribbon.js`)  
- Step 3: PASS (removed compiled stubs: `scripts/renderer-entry.js`, `src/editor/bootstrap.js`, `src/ui/renderer.js`)  
- Step 4: FAIL (esbuild bundle blocked offline: EAI_AGAIN to registry.npmjs.org)  
- Step 5: PASS (authoritative ribbon file list prepared for report)
