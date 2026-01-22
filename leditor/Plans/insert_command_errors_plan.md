# Insert Command Errors Plan

## Goal
Eliminate all “unknown command” errors in the INSERT tab and correct its layout so controls expand horizontally (Word-like) without vertical stacking.

## Success Criteria
1. Clicking any INSERT control (pages, tables, illustrations/media, links, comments, header/footer, text, symbols) produces no console errors about unknown commands or missing payloads.
2. All INSERT commands are mapped to existing editor commands and supply required defaults (rows/cols, payload, etc.).
3. INSERT group clusters remain on a single horizontal line with horizontal overflow instead of vertical stacking.
4. `npm run test:docx-roundtrip` passes.

## Constraints
- Touch only INSERT-related config/renderer/CSS; leave Home/View behavior unchanged.
- Fail-fast: if a control cannot be mapped, throw with the `controlId`.
- No edits to `dist/` outputs.

## Scope
- `Plans/insert.json`
- `src/ui/ribbon_layout.ts`
- `src/ui/ribbon_controls.ts`
- `src/ui/ribbon_menu.ts`
- `src/ui/ribbon.css`

## Steps
1. **Map page/section break commands**  
   - Map `insert.coverPage.*`, `insert.pageBreak`, `insert.blankPage`, `insert.sectionBreak.*` to valid engine commands with defaults.
2. **Map tables commands**  
   - Map all `insert.table.*`, `table.accessibility.openDialog` to `TableInsert` (with payload defaults).
3. **Map illustrations/media commands**  
   - Map `insert.image.*`, `insert.icon.*`, `insert.smartArt.*`, `insert.chart.*`, `insert.screenshot.open`, `insert.video.*`, `insert.embed.*`, `insert.audio.*`, `insert.file.*` to existing insertable command ids.
4. **Map links/comments/header-footer/text/symbols**  
   - Map `link.*`, `insert.bookmark.*`, `insert.crossReference.*`, `comments.*`, `insert.header/footer/pageNumber.*`, `insert.textBox/quickParts/wordArt/dropCap/signature/dateTime/object/placeholder/shortcode/textFromFile`, `insert.equation/symbol/emoji` to valid commands.
5. **Fix INSERT layout stacking**  
   - Update CSS for INSERT clusters to force horizontal flow with horizontal overflow and stable gaps.
6. **Validation**  
   - Run `npm run test:docx-roundtrip`.
   - Manual: click one control per INSERT group; ensure no console errors and layout stays horizontal.

## Risk Notes
- Mapping to a generic command (e.g., `InsertImage`) could mask missing feature handlers; fail-fast logging will surface unmapped cases.
- CSS tweak must not affect Home/View; scope selectors to `[data-tab-id=\"insert\"]`.

## Validation
- `npm run test:docx-roundtrip`

## Rollback
```bash
git checkout -- Plans/insert.json src/ui/ribbon_layout.ts src/ui/ribbon_controls.ts src/ui/ribbon_menu.ts src/ui/ribbon.css
git reset --hard HEAD
```

## Progress
- Step 1 — Map page/section break commands: PASS
- Step 2 — Map tables commands: PASS
- Step 3 — Map illustrations/media commands: PASS
- Step 4 — Map links/comments/header-footer/text/symbols: PASS
- Step 5 — Fix INSERT layout stacking: PASS
- Step 6 — Validation: PASS
