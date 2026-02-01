# Overall App Premium Theme Plan (`leditor/`)

## Goal
Make LEditor feel “premium” via a cohesive theme system (tokens + motion + accessibility) applied consistently to *every* UI surface.

## Current reality (quick audit)
- Ribbon is tokenized (`--r-*`) and styled in:
  - `leditor/src/ui/layout_plan.ts` (token source)
  - `leditor/src/ui/ribbon_layout.ts` (writes CSS variables)
  - `leditor/src/ui/ribbon.css` (consumes tokens)
- Many other surfaces still use hard-coded, injected CSS (and a different visual language), e.g.:
  - `leditor/src/ui/search_panel.ts`
  - `leditor/src/ui/status_bar.ts`
  - `leditor/src/ui/context_menu.ts`
  - `leditor/src/ui/preview.ts`
  - `leditor/src/ui/print_preview.ts`
  - `leditor/src/ui/footnote_manager.ts`
  - `leditor/src/ui/references/sources_panel.ts`
- Some surfaces already align with modern direction:
  - `leditor/src/ui/agent_sidebar.css`
  - `leditor/src/ui/references/ref_picker.html`
  - `leditor/public/pdf_viewer.html`

## Premium design “signature”
- Calm chrome, crisp borders, restrained accent usage.
- Document page is the hero; UI chrome is supportive.
- One coherent type system: UI = sans, document = serif (by choice).

## Plan: foundations
1) Introduce shared UI tokens (`--ui-*`) alongside ribbon tokens (`--r-*`).
2) Add shared primitives (panel, overlay, button, input, menu) in static CSS.
3) Theme modes:
   - chrome: light/dark
   - document surface: light/dark “paper” variant
4) Refactor injected-style panels to static CSS + primitives.

## Acceptance checklist
- No mixed visual languages across panels/menus/modals.
- Theme switch updates ribbon + panels + overlays + PDF viewer without flash.
- Focus rings are consistent and visible everywhere.

