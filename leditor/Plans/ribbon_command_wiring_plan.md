# Ribbon Command Wiring Plan

## Goal
Make every ribbon control (Home, Insert, View) dispatch a known `LEditor.execCommand` with the required payload so clicking any button/menu item no longer throws “unknown command” or “requires { value }” errors.

## Success Criteria
1. No runtime “unknown command” or “requires { value }” errors when activating any ribbon control in Home/Insert/View tabs.
2. All commands emitted from ribbon controls map deterministically to existing editor command IDs or adapters, with default payloads supplied where the engine requires them.
3. Color/size/spinner controls always supply a value on primary click; split buttons and menus pass the configured payloadSchema fields.
4. Smoke test `npm run test:docx-roundtrip` completes without ribbon-triggered exceptions in the console.

## Constraints
- Obey AGENTS fail-fast rules: no silent fallbacks; throw if a control’s command cannot be resolved after mapping.
- Do not change editor semantics; only map/route commands or add required payload defaults.
- Keep modifications within ribbon config/renderer and command mapping; do not edit `dist/` outputs.

## Scope (files only)
- `Plans/home.json`, `Plans/insert.json`, `Plans/view.json`
- `src/ui/ribbon_layout.ts` (command resolution and payload application)
- `src/api/editor_commands.ts` (alias map/dispatcher)
- `src/ui/ribbon_controls.ts` and `src/ui/ribbon_menu.ts` (default payload hooks)
- `src/ui/ribbon_icons.ts` only if icon keys need alignment with command ids

## Steps
1. **Audit command ids vs engine map**  
   - Files: `Plans/home.json`, `Plans/insert.json`, `Plans/view.json`, `src/api/editor_commands.ts`, `src/ui/ribbon_layout.ts`.  
   - Output: list of controlIds whose `command.id` is not understood by `resolveCommandId` or `LEditor.execCommand`.
2. **Expand alias mapping for missing commands**  
   - File: `src/ui/ribbon_layout.ts` (COMMAND_ALIASES / resolveCommandId).  
   - Target: map home/insert/view command ids (e.g., `font.style.set`, `font.effects.*`, `font.size.grow`) to existing engine commands; add explicit throws for unmappable ids.
3. **Inject required payload defaults**  
   - Files: `Plans/home.json`, `Plans/insert.json`, `Plans/view.json`, `src/ui/ribbon_controls.ts`, `src/ui/ribbon_layout.ts`.  
   - Target: ensure color, highlight, font size, line spacing, table/grid pickers, and other payloaded commands always pass required keys (`value`, `valuePx`, etc.) on primary click; add menu defaults where missing.
4. **Harden menu/primary dispatchers**  
   - Files: `src/ui/ribbon_menu.ts`, `src/ui/ribbon_layout.ts`.  
   - Target: add pre-dispatch validation that payload matches expected schema; surface a clear error message that includes controlId if validation fails.
5. **Validate**  
   - Command: `npm run test:docx-roundtrip`.  
   - Manual: click representative controls across Home/Insert/View to confirm no console errors and that commands reach the engine.

## Risk Notes
- Mapping to the wrong engine command could change behavior; minimize by reusing existing command_map entries and keeping a mapping table in one place.
- Adding default payloads might mask missing user input; keep defaults conservative (e.g., current color swatch, 12pt font size).

## Validation
- Run `npm run test:docx-roundtrip`.
- Manual ribbon smoke pass (Home/Insert/View) with console open; expect zero errors.

## Rollback
```bash
git checkout -- Plans/home.json Plans/insert.json Plans/view.json \
  src/ui/ribbon_layout.ts src/api/editor_commands.ts \
  src/ui/ribbon_controls.ts src/ui/ribbon_menu.ts src/ui/ribbon_icons.ts
git reset --hard HEAD
```

## Progress
- Step 1 — Audit command ids vs engine map: NOT STARTED
- Step 2 — Expand alias mapping for missing commands: NOT STARTED
- Step 3 — Inject required payload defaults: NOT STARTED
- Step 4 — Harden menu/primary dispatchers: NOT STARTED
- Step 5 — Validate: NOT STARTED
