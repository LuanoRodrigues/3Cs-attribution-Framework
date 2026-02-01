# Overlays + Dialogs Premium Plan (`leditor/`)

## Goal
Make all overlays (modals, menus, context menus) consistent, accessible, and premium.

## Surfaces
- Context menu: `leditor/src/ui/context_menu.ts`
- Preview: `leditor/src/ui/preview.ts`
- Print preview: `leditor/src/ui/print_preview.ts`
- Source view: `leditor/src/ui/source_view.ts`
- Allowed elements inspector: `leditor/src/ui/allowed_elements_inspector.ts`
- Style mini app: `leditor/src/ui/style_mini_app.*`

## Work items
1) Define overlay primitives (`.ui-overlay`, `.ui-dialog`, `.ui-popover`, `.ui-menu`).
2) Normalize z-index scale (remove ad-hoc huge values).
3) Ensure focus trap + restore for dialogs.
4) Replace parchment injected styles with tokenized primitives.

## Acceptance checklist
- Any overlay instantly reads as “this app”.
- Focus never gets lost behind an overlay.
- Motion is consistent and reduced-motion-safe.

