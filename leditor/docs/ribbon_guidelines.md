# Ribbon Guidelines

## Architecture Overview
- The ribbon is rendered from `src/ui/ribbon.ts` via `renderRibbon`, which instantiates one `RibbonPanel` per tab and wires them through `renderRibbonPlaceholder`.
- Each panel is composed of groups created by helper functions (e.g. `createHomePanel`, `createReferencesPanel`, `createViewPanel`) and uses `appendGroupsWithSeparators` to keep spacing consistent.
- `RibbonGroup` (`src/ui/ribbon_primitives.ts`) wraps controls, applies `role="toolbar"`, and now handles keyboard navigation plus Escape-to-editor focus.
- Tabs, toggle state tracking, and `RibbonControl` are centralized to keep the DOM structure predictable and schema-driven.

## Icon Naming Conventions
- Icons live in `src/ui/ribbon_icons.ts`. Every entry in `ICON_CREATORS` returns a small DOM node and is keyed by a descriptive name (`bold`, `gridlines`, `ViewSinglePage`).
- Use `createTypographyIcon` for alphanumeric labels and `createInlineIcon` for glyphs, then register the name in `RibbonIconName`. New icons should follow a `nounVerb` or `contextAction` pattern so they are easy to map to buttons.
- When wiring new buttons, reference the icon through `createIconButton({ icon: "yourIcon" })` so styling stays consistent with the rest of the ribbon.

## Extending the Ribbon
1. **Define the command**: update `EditorCommandId` (`src/api/editor_commands.ts`), add your handler to `commandMap` (`src/api/command_map.ts`), and, if needed, persist state in modules such as `view_state.ts`.
2. **Add UI controls**: in `src/ui/ribbon.ts`, add a new helper group returning `createRibbonGroup("Label", [...])`, using `createIconButton`, `createDropdownButton`, or `createModeToggleButton` so the group stays keyboard-aware.
3. **Wire the panel**: include the group in the desired panel (e.g. `createViewPanel`) and ensure each panel registers `role="region"` + `aria-label` before the tab renders it.
4. **Update Layout/Icon state**: if the control toggles view-only features, add the state helpers in `src/ui/view_state.ts` and expose getters (e.g. `isReadMode`).
5. **Validation**: rerun `npm run build:renderer` to ensure TypeScript and bundling remain clean.

## Quick Tips
- Funnel all DOM interactions through ribbon helpers to keep the schema-driven document model intact.
- Commands should never mutate DOM directly; they should update TipTap state via `editor.chain()` to preserve undo/redo.
- The ribbon is mounted inside `src/ui/renderer.ts`, which now primes `view_state` before calling `renderRibbon`, so any view toggles have a stable backing store.
