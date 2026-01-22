# A4 Page Requirements

The paged A4 layout in LEditor targets Word-like fidelity for academic documents. This document collects the authoritative sizing, layout, and interaction requirements that guide the paged editor implementation.

## 1. Page size standards
- ISO 216 **A4** portrait: 210 × 297?mm; portrait pixel approximate at 96?DPI: **794?×?1123?px**. Landscape is the dimension swap (297?×?210?mm / ~1123?×?794?px).
- Keep the canonical units in millimetres for CSS tokens (--page-width-mm, --page-height-mm) and translate to px when rendering for the viewport.

## 2. Margin standards and presets
- **Normal (Word default)** – 1?inch (2.54?cm) on all sides.
- **Narrow** – 0.5?inch on all sides for tighter academic notes.
- **Moderate** – 1?inch top/bottom with 0.75?inch left/right, matching Word’s moderate preset.
- **Academic binding** – 1.25?inch left margin with 1?inch on the other sides to simulate a binding gutter.
- Margin presets must remain overrideable at section or document scope via design tokens.

## 3. Header requirements
- Headers sit directly below the top 1?inch margin and respect header tokens (--header-height, --header-offset).
- Default formatting: centred, bold, all-caps to satisfy many thesis/proceedings style guides.
- Headers remain consistent across the document until sections unlink in later phases.

## 4. Footnotes and endnotes behaviour
- Footnote references render as superscript markers and link to the footnote area at the bottom of the same page.
- Insertion mirrors Word: insert marker, focus the footnote entry, and rely on automatic numbering/renumbering whenever references change.
- Shortcuts: **Alt+Ctrl+F** for footnotes and **Alt+Ctrl+D** for endnotes.
- Each page hosts a .editor-footnotes region separated by the footnote separator token and constrained by the reserved area token.
- Overflowing footnotes move deterministically to the next page’s footnote region.
- Endnotes aggregate inside .editor-endnotes at the document end while still obeying numbering rules.
- Editing/removing references reruns numbering and underscores the importance of cross-link jumps between markers and notes.

## 5. Zoom and view modes
- Zoom slider with +/- buttons plus a percentage label, clamped by tokens like --min-zoom, --max-zoom, and --zoom-step.
- Presets include One Page, Multiple Pages, Page Width (fit width), and Fit Page (fit height).
- Vertical paged is the default; multi-page grid or side-by-side views must document their scaling strategy (locked-fit vs. manual zoom).
- Support Ctrl+Plus/Ctrl+Minus and optionally Ctrl+MouseWheel for zoom adjustments.
- Vertical mode scrolls naturally; multi-page uses deterministic wrapping or horizontal flow to keep pagination stable.

## 6. Manual page breaks
- Provide a semantic page_break node and expose it via toolbar/menu plus Ctrl+Enter.
- Manual page breaks force the subsequent content onto the next page, regardless of remaining space, with a visible indicator using page-break tokens.
- Removing the node reflows content and repaginates while keeping tables and paragraphs intact.

## 7. Headers/footers insertion conventions
- Double-clicking header/footer enters edit mode; exit via Escape or clicking back into the body.
- Header and footer DOM containers sit inside the margin-respecting tokens so they never overlap body content.
- Page number fields come later (Phase 10), but Phase 1 clarifies the editing workflow and insertion surface.

## 8. Ruler and measurement options
- Default horizontal ruler with an optional vertical ruler toggle.
- Configurable units (inches, cm, mm, points) that align with the layout tokens driving margins.
- Rulers highlight margin gutters visually with draggable markers tied to the margin tokens.

## 9. Theme tokens and page-surface toggles
- Guide all colour/typography choices with tokens such as `--page-bg`, `--page-border-color`, `--page-canvas-bg`, `--page-header-color`, `--page-footer-color`, `--page-footnote-color`, `--ui-surface`, and `--ui-text`. Any custom theme or palette swap should stay within these tokens so the layout measurements remain untouched.
- The toolbar exposes `Ctrl+Shift+D` to toggle the overall UI theme (light/dark) and `Ctrl+Shift+P` to switch the page surface (white vs. dark page). Both shortcuts merely flip CSS classes; they do not change margins, header/footer spacing, or zoom.
- When adjusting the theme or surface, keep the dotted margin guides, ruler alignment, and footnote separators anchored to the same tokens so the visual margins stay consistent across themes.

## 10. Additional page presets and measurement overrides
- In addition to `--page-width-mm`/`--page-height-mm` for A4, expose letter-size tokens (`--page-width-letter-mm`, `--page-height-letter-mm`, `--page-width-letter`, `--page-height-letter`) for North American documents. Toggleable tokens should let sections rehydrate the letter frame without rewriting every style rule.
- Preserve the canonical units in millimetres/points so any preset can be converted to `calc(var(--page-width-mm) * 1mm)` or similar formulas when applied.
- Customize margins, columns, or orientation per section by overriding the token values on the relevant section container rather than hardcoding pixel sizes; this keeps schema data consistent while letting the view respond to the chosen preset.

This requirements collection keeps the canonical JSON schema, token design, and editorial UX aligned as the paged mode features roll out.
