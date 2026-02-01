# Ribbon Premium Plan (`leditor/`)

## Goal
Ship a ribbon that feels “Word-like” in capability and “premium” in execution: consistent spacing, crisp icons, clean states, smooth overflow.

## Current implementation
- Tokens: `leditor/src/ui/layout_plan.ts` → applied in `leditor/src/ui/ribbon_layout.ts`
- Styling: `leditor/src/ui/ribbon.css`
- Layout engine: `leditor/src/ui/ribbon_layout.ts` + `leditor/src/ui/ribbon_primitives.ts`
- Menus: `leditor/src/ui/ribbon_menu.ts`

## Work items
1) Ensure every consumed token is defined (no implicit colors/borders).
2) Unify micro-interactions across all ribbon controls.
3) Make menus/flyouts inherit theme tokens reliably (portal-safe).
4) Validate density mode behavior (no clipping).

## Acceptance checklist
- Ribbon matches the rest of the app (shared type + surfaces).
- Menus never clip and feel smooth.
- Focus rings are consistent on every control.

