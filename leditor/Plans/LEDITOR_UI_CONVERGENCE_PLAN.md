# Plan: Modernize Ribbon + Scale

## Goal
Bring the Home/View/References ribbon controls and the overall UI scale closer to the requested Word-like layout, ensuring the Table of Contents buttons, font dropdowns, and viewport defaults behave consistently across full-screen and windowed modes while relying on the existing Fluent UI icon layer.

## Success criteria
- Font dropdown cluster surfaces Normal plus Heading 1–6, Subtitle, and Blockquote entries with Times New Roman/Top font presets, and font size controls stay grouped with shrink/grow.
- View tab exposes the requested Views, Show, and Zoom clusters with the new toggle icons and multi-column Zoom layout.
- Table of Contents split button/menu buttons execute working commands (insert, update, remove, add levels).
- UI scale (app, ribbon, A4 canvas) is larger by default, scrollbars remain on the right, and the ribbon is no longer clipped by the OS menu bar.

## Constraints
- Reuse Fluent UI icon keys already declared in `ribbon_icons.ts`.
- Keep all ribbon definitions in `ribbon_model.ts` and command wiring in `command_map.ts`/`ribbon_command_aliases.ts`.
- Avoid `!important` overrides in CSS; adjust root variables and layout CSS instead.
- Follow the existing aliases/command registration flow.

## Scope
- `src/ui/ribbon_model.ts`
- `src/api/command_map.ts`
- `src/ui/ribbon_command_aliases.ts`
- `src/ui/a4_layout.ts`
- `src/ui/renderer.ts`
- `src/ui/references_command_contract.ts` (if needed)
- `src/ui/ribbon_layout.ts`/`ribbon_menu.ts` (for dropdown behavior)
- `Plans/LEDITOR_UI_CONVERGENCE_PLAN.md` (this file)

## Steps
1. Update font ribbon layout (styles, fonts, size controls)
2. Reshape view tab (Views/Show/Zoom clusters)
3. Wire working TOC commands and aliases
4. Adjust UI scale/scroll defaults

## Risk notes
- Dropdown restructuring can break collapse logic; keep layout definitions minimal.
- Changing icon keys may hide buttons if CSS selectors rely on old class names.
- Scaling tweaks may expose clipping if `--leditor-ribbon-height` isn’t recalculated on resize.

## Validation
- `npm run build`

## Rollback
- `git checkout -- src/ui/ribbon_model.ts src/api/command_map.ts src/ui/ribbon_command_aliases.ts src/ui/a4_layout.ts src/ui/renderer.ts src/ui/references_command_contract.ts`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
