# Paged Mode Help

## Getting started
- The paged layout mounts the ProseMirror view inside each `.leditor-page-body`; typing stays inside the margins defined by the tokens in `src/ui/a4_layout.ts` (@see `--page-margin-*`, `--header-height`, `--footer-height`).
- Use `Ctrl+Shift+M` to reveal the dashed margin guide and confirm you are typing within the editable bounds.

## Headers, footers, and footnotes
- Double-click any header or footer overlay to enter header/footer edit mode; press `Escape` or click back into the body to return to regular text editing.
- Page numbers appear in the bottom-right footer via `.leditor-page-number` nodes and stay in sync even as pages add/remove.
- Footnote markers render in the body and the matching entries live in `.leditor-page-footnotes` just above the footer; they share the same page index and renumber automatically.

## Page breaks and pagination
- Automatic pagination pushes whole block nodes onto subsequent pages and never splits paragraphs/tables by default.
- Insert a semantic page break with `Ctrl+Enter` to force the next block onto the following page; a labelled `.leditor-break` appears between pages and disappears when removed.
- Scroll through the vertical stack of `.leditor-page` containers when the document grows beyond a single page.

## Zoom, grid layouts, and view modes
- Zoom using the toolbar slider, `Ctrl+Plus`, `Ctrl+Minus`, or the mouse wheel (when focused on the canvas). The same zoom state drives layout mode:
  - **≤ 120%**: single-column stack, one page per row.
  - **121%–180%**: grid-2 shows two side-by-side pages.
  - **181%–250%**: grid-4 arranges the first four pages in a 2×2 window.
  - **> 250%**: grid-9 renders a 3×3 window so you can review larger sections at once.
- Each grid mode keeps the ruler and margins aligned to whichever page is currently in focus, and keyboard navigation updates the visible window.

## Theme customization
- `Ctrl+Shift+D` toggles the light/dark UI theme via the `theme-dark` CSS class, while `Ctrl+Shift+P` toggles the `page-surface-dark` class that repaints the page background without altering the page geometry.
- Swap palettes or background textures by overriding tokens like `--page-canvas-bg`, `--page-bg`, `--page-border-color`, and `--page-shadow` in `src/ui/a4_layout.ts` (or your own theme layer) so the margins, rulers, and header/footer spacing stay untouched.
- Letter-size sections can be introduced by applying `--page-width-letter`/`--page-height-letter` (and their mm counterparts) for the frame and then overriding the margin tokens on section containers for binding or narrow presets.

## Integration and QA
- Load `docs/test_documents/a4_integration_full.json` via the local file loader to stress-test headers, multi-section margins, columns, tables, images, footnotes, and page breaks in a 100+ page scenario.
- Follow `docs/a4_integration_test.md` for the checklist that validates header/footer edits, footnote renumbering, manual breaks, and zoom-driven grid layouts.
- After every major change, run `npm run build:renderer` to confirm the renderer bundles with the new CSS/JS tokens.
