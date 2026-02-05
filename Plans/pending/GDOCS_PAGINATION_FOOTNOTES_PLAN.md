# Google Docs Mapping Plan (Pagination + Footnotes)

Goal: Emulate Google Docs’ continuous-flow feel with page overlays, while retaining print-accurate pagination and footnote flow in LEditor.

## Google Docs Responsibilities Inventory (Behavioral)

- Continuous vertical flow; pages are visual guides, not independent DOM stacks.
- Fast incremental layout updates and virtualization for large docs.
- Footnotes appear per page with a clear separator; body text yields space instantly.
- No internal scrollbars in footnote areas; footnotes continue to next page.
- Selection and caret never jump unexpectedly across UI interactions.

## LEditor Mappings

- Keep page overlays, but ensure content measurement is consistent with a single continuous flow.
- Use DOM measurement to compute breakpoints, but avoid “page-local” logic that prevents joins.

## Phase Plan

Phase 1 — Continuous Flow Emulation
- Treat page content as a single flow for measurements; overlays only display.
- Consolidate measurement to avoid differences between page stack and overlay.

Phase 2 — Split/Join Stability
- Replace oscillating split/join loops with deterministic thresholds.
- Keep “layout settling” guardrails to avoid ping-pong.

Phase 3 — Footnote Band Management
- Compute footnote height band in real time and feed into page split thresholds.
- Expand footnote band before body reflow (so body never overlays footnotes).
- Implement continuation nodes for long footnotes.

Phase 4 — Performance & Virtualization
- Only reflow pages impacted by edits.
- Cache line measurements and paragraph heights to reduce repeated rect queries.

Phase 5 — Interaction Guarantees
- Ensure Enter/Backspace at page boundaries performs split/join instantly.
- Prevent ribbon interactions from changing selection or scroll position.

Phase 6 — Validation
- Automated pagination audit script to detect fragment-only pages.
- Smoke test for page boundary edits and footnote insertions.

## Deliverables

- Smooth, continuous-flow pagination with reliable page boundaries.
- Footnotes that grow without overlap, continuing on next page when needed.
- Stable cursor and selection across ribbon and footnote edits.

