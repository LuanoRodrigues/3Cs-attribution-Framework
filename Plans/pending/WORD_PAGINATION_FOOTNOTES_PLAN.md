# Word Mapping Plan (Pagination + Footnotes)

Goal: Emulate Microsoft Word’s layout expectations for body/footnote flow, orphan control, and caret continuity, translated to LEditor.

## Word Responsibilities Inventory (Behavioral)

- Continuous document flow, with page boundaries as visual overlays.
- Inline anchors for footnotes that do not interrupt paragraph flow.
- Footnote area reserves space on the page; body text pushes down and onto next page.
- Line breaks chosen by actual rendered widths (not character counts).
- Keep-with-next and widow/orphan control for headings and paragraphs.
- Backspace at top of a page merges with previous page; Enter at end pushes to next.
- Reflow is incremental, not full-doc after each keystroke.

## LEditor Mappings

- ProseMirror document model + pagination plugin.
- Page overlays and content stack.
- Footnote overlay container and CSS vars.

## Phase Plan

Phase 1 — Unified Content Flow
- Ensure page content is measured in a single flow (body + reserved footnote band).
- Remove any per-page independent measurement that prevents cross-page merges.

Phase 2 — Word-like Line Breaking
- Use Range-based line measurement to compute exact break points.
- Implement “last line reserve” to avoid cut-off text at page bottom.
- Guarantee minimum readable lines after headings (keep-with-next).

Phase 3 — Widow/Orphan Control
- Minimum 2 lines on each page for a paragraph by default.
- If split causes single-line orphan, move paragraph to next page.

Phase 4 — Footnote Continuation
- Allow footnotes to break across pages.
- Ensure footnote continuation does not steal body space beyond max footnote height.

Phase 5 — Caret & Editing Semantics
- Backspace/Enter across pages triggers join/split even when boundary page has no local blocks.
- Ensure caret restoration on refocus from ribbon/footnote edits.

Phase 6 — Validation
- Scripted audit of page content with expected fragments.
- Simulate cursor boundaries and confirm page merge/split behavior.

## Deliverables

- Word-like page breaks without fragment-only pages.
- Predictable caret behavior at boundaries.
- Stable, incremental reflow without oscillations.

