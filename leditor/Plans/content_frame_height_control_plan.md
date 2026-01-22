# Plan: Content Frame Height Control Button

## Goal
Add a Page Setup control that lets users increase/decrease the `leditor-content-frame` height and clamp it to a max of 700px.

## Success criteria
1. Layout tab shows a new height control (+ / -) under Page Setup.
2. Pressing + / - updates the `leditor-content-frame` height deterministically.
3. Height is clamped to a maximum of 700px (and a safe minimum).
4. Height changes persist for the session and trigger a repagination/update.

## Constraints
- Follow `AGENTS.md` (no silent fallbacks, fail fast on invalid inputs).
- Use existing command dispatch and layout controller wiring.
- Keep changes scoped to layout UI + layout controller.

## Scope
- `Plans/layout_tab.json`
- `src/ui/ribbon_layout.ts` (if new control type needed)
- `src/api/editor_commands.ts`
- `src/api/command_map.ts`
- `src/ui/a4_layout.ts`

## Steps
1. Add new command IDs for height +/− in `src/api/editor_commands.ts`.
2. Add command handlers in `src/api/command_map.ts` to adjust a new layout height state and apply it.
3. Add height state + setter in `src/ui/a4_layout.ts` and wire it to `.leditor-content-frame` style with max clamp 700px.
4. Add the new Page Setup control in `Plans/layout_tab.json`.

## Risk notes
- Incorrect clamping could shrink content too far.
- Needs to avoid impacting pagination when enabled.

## Validation
- `npm start` (manual: click +/− and confirm height changes; clamp at 700px).

## Rollback
1. `git checkout -- Plans/layout_tab.json src/api/editor_commands.ts src/api/command_map.ts src/ui/a4_layout.ts src/ui/ribbon_layout.ts`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Validation: FAIL (`npm start` timed out with Electron portal error: org.freedesktop.portal.Desktop)
