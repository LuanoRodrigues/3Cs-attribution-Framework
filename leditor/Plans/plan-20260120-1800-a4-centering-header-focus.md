# Plan: A4 centering, header focus, ribbon icons, zoom default 100%

## Goal
Center the A4 canvas with correct zoom (100% by default), ensure the cursor blinks/keeps focus in the body, header becomes editable only on double-click and starts at the beginning, and restore paragraph align icons in the Home ribbon.

## Success criteria
- A4 sheet appears centered; default zoom = 100% (no unintended 150% scale) while preserving page size and margin fidelity.
- Cursor blinks inside the document body; focus returns after ribbon actions; header/footer not focused unless double-clicked.
- Double-click on header/footer activates edit; caret starts at beginning of the region.
- Home > Paragraph align buttons show icons (left/center/right/justify) and execute commands.
- No console errors on launch.

## Constraints
- Follow AGENTS.md (schema-based editing, no defensive catch-alls, offline).
- Avoid altering content schema; only UI/layout/focus/commands.
- Keep assets local; reuse existing Fluent/lucide icons.

## Scope
- `src/ui/a4_layout.ts` (centering, zoom default, header focus handling, cursor focus)
- `src/ui/view_state.ts` (zoom default reset if needed)
- `src/ui/ribbon.ts`, `src/ui/ribbon_icons.ts`, `src/ui/toolbar_styles.ts` (paragraph icons, spacing)
- `dist/renderer/bootstrap.bundle.js` (rebuilt)

## Steps
1. Centering & zoom: set default zoom to 1.0; ensure zoom layer/canvas CSS centers; remove leftover 1.5 defaults.
2. Cursor/focus: enforce body focus after ribbon actions; ensure ProseMirror gains focus on mount and keeps blinking.
3. Header/footer activation: require double-click; when activated place caret at start; disable auto-focus otherwise.
4. Paragraph icons: add/ensure proper icons for align left/center/right/justify in Home ribbon; verify commands fire.
5. Validation: rebuild renderer bundle; manual sanity (centered page, header edit only on double-click, blinking cursor, icons visible).

## Risk notes
- Changing zoom default may affect page grid/two-page modes; recheck.
- Focus adjustments must not block dialogs.
- Icon swap should not regress other ribbon buttons.

## Validation
- `npx esbuild scripts/renderer-entry.ts --bundle --platform=browser --format=esm --sourcemap --outfile=dist/renderer/bootstrap.bundle.js --loader:.ttf=dataurl --loader:.woff=dataurl --loader:.woff2=dataurl --external:node:fs/promises --external:@simonwep/pickr/dist/pickr.min.css`
- Manual visual checks (centering, header dblclick, cursor blink, align icons).

## Rollback
- `git checkout -- src/ui/a4_layout.ts src/ui/view_state.ts src/ui/ribbon.ts src/ui/ribbon_icons.ts src/ui/toolbar_styles.ts`
- Rebuild bundle with the same esbuild command.

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Step 5: NOT STARTED
