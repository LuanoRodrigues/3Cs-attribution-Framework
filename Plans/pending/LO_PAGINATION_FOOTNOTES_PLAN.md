# LibreOffice Mapping Plan (Pagination + Footnotes)

Goal: Translate LibreOffice Writer’s layout/footnote responsibilities into concrete LEditor phases. Focus on deterministic page overflow, line splitting, and footnote continuation without overlap.

## LibreOffice Responsibilities Inventory (What LO does)

Core objects (source: /tmp/libreoffice-core/sw/source/core/layout):
- SwDoc: document model and text/footnote anchors.
- SwLayoutFrame / SwPageFrame: page containers and page flow.
- SwFootnoteBossFrame: page/column owner that reserves footnote area.
- SwFootnoteContFrame: per-page footnote container (variable height).
- SwFootnoteFrame: individual footnote frames chained across pages.
- SwTxtFrm + SwFlowFrm: text layout, line breaking, and flow decisions.
- SwLayAction: layout actions and incremental reflow.
- SwPageDesc / SwPageFootnoteInfo: margins, footnote separator, max footnote height.

Footnote sizing and separation (ftnfrm.cxx):
- Footnote separator height and spacing derived from paragraph attributes.
- Footnote container grows/shrinks within max footnote height rules.
- Footnote frames can chain to next page when overflow.
- Page layout accounts for footnote container height before body flow finalizes.

Overflow handling:
- Text flow splits at line boundaries with hyphenation rules.
- Keep-with-next (headings) moves block if insufficient lines remain.
- Page join occurs when space allows after edits.

## LEditor Mappings (Current Architecture)

- Document model: ProseMirror schema in renderer.
- Pagination: src/extensions/extension_page.ts (split/join, keep-with-next).
- Page layout & overlays: src/ui/a4_layout.ts (page stack + overlays).
- Footnote registry + DOM: footnote overlay container and CSS vars.
- Measurement: Range/DOM rect logic for line splits.

## Phase Plan

Phase 1 — Page/Footnote Ownership (LO FootnoteBossFrame equivalent)
- Ensure page-content height = page height - margins - footer - footnoteHeight - footnoteGap.
- Single authoritative height source (no duplicate CSS vars across overlay/stack).
- Add a “FootnoteBoss” adapter in pagination logic that reads the computed footnote band for each page and feeds it into split thresholds.

Phase 2 — Line Split Engine (LO SwTxtFrm/SwFlowFrm equivalent)
- Line-level split search using Range bounds (binary search).
- Ensure split happens inside paragraph and respects block boundaries.
- Add fallback when DOM rect is clipped (page boundary overlay).
- Implement “minimum last line” rule (reserve 1–2 lines for body if footnotes expand).

Phase 3 — Keep-with-next & Heading Constraints
- Implement “keep-with-next” as LO: move heading with at least N lines of following paragraph.
- Ensure headings do not orphan at page end; allow split inside paragraph if necessary.
- Add keep-with-next override only when block is heading + paragraph (never for inline marks).

Phase 4 — Footnote Continuation (LO FootnoteFrame chaining)
- Implement footnote overflow as chained footnote entries (continuation on next page).
- Each footnote entry can be split into continuation nodes with stable anchor IDs.
- Render “continued on next page” UI if needed (optional).

Phase 5 — Incremental Reflow (LO SwLayAction)
- For edits: reflow only affected pages + forward, do not repaginate entire doc.
- Use “dirty range” markers (min page index) and stop when stable.
- Stabilize pagination to avoid join/split loops.

Phase 6 — Validation & Regression Harness
- Pagination audit script captures page text/lines; fail on fragment pages.
- Simulate Enter at end of page and Backspace at start of page.
- Verify footnote/body separation and continuation behavior.

## Deliverables

- LEditor pagination split engine rewritten to mirror LO’s line-level flow.
- Footnote height correctly reserved in body layout before split.
- Stable reflow with no oscillation (split/join loops).
- Regression script that guarantees no pages with “few words only” for same document.

