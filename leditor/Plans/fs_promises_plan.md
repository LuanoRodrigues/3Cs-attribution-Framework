# Plans/fs_promises_plan.md — Shim `node:fs/promises` for the renderer bundle

## Goal
Deliver a browser-safe renderer bundle that resolves `node:fs/promises` imports to the existing shim so Electron no longer tries to load `node:fs/promises` at runtime and the spell-checker warnings disappear.

## Success criteria
1. The renderer bundle resolves `node:fs/promises` via `scripts/shims/fs-promises.js` so `dist/renderer/bootstrap.bundle.js` never emits an unresolved `node:fs/promises` import and the renderer no longer logs `net::ERR_UNKNOWN_URL_SCHEME`.
2. The shim exports the same minimal API (`readFile`, `writeFile`, default) so `dictionary-en` can load without throwing, even if it still logs about missing `.aff/.dic`.
3. The esbuild command finishes without `--external:node:fs/promises`, and `npm run test:docx-roundtrip` passes, confirming both bundle and runtime stability.

## Constraints
- The shim strategy must stay offline-only; do not pull real filesystem data or call `fs` APIs.
- The shim file already exists; only resolution and minimal exports need updating.
- All tab/ribbon requirements remain unaffected; only renderer bundling is touched.

## Scope
- `package.json` (add a `browser` alias so esbuild resolves `node:fs/promises` to the shim).
- `scripts/shims/fs-promises.js` (verify exports mirror the alias target and keep the stub behavior).
- This plan file (`Plans/fs_promises_plan.md`).

## Steps
1. Add a `browser` field (or extend the existing one) in `package.json` that maps `node:fs/promises` to `./scripts/shims/fs-promises.js`, ensuring bundlers like esbuild prefer the shim over emitting the native specifier. (file: `package.json`, target symbol: `browser`)
2. Confirm `scripts/shims/fs-promises.js` exports `readFile`, `writeFile`, and a default object so the shim matches the named imports used by `dictionary-en`. (file: `scripts/shims/fs-promises.js`, target symbol: module exports)
3. Rebuild the renderer bundle without `--external:node:fs/promises` (e.g., `npx esbuild ... --loader:.ttf=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl --outfile=dist/renderer/bootstrap.bundle.js`) so the shim is included at build time, and rerun `npm run test:docx-roundtrip`. (command)

## Risk notes
- If the `browser` alias is mistyped, esbuild will still emit `node:fs/promises`, repeating the ERR_UNKNOWN_URL_SCHEME; verify the alias path is correct relative to the repo root.
- The shim returns empty strings, so dictionary loading will warn about missing `aff`/`dic` as before; those warnings are acceptable but should not throw errors.

## Validation
- `npx esbuild scripts/renderer-entry.ts --bundle --platform=browser --format=esm --sourcemap --outfile=dist/renderer/bootstrap.bundle.js --loader:.ttf=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl`
- `npm run test:docx-roundtrip`

## Rollback
- `git checkout -- package.json scripts/shims/fs-promises.js Plans/fs_promises_plan.md`

## Progress
- Step 1 (browser alias for `node:fs/promises`): PASS
- Step 2 (verify shim exports): PASS
- Step 3 (rebuild bundle + docx test): PASS
