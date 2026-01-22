# Codex Implementation Plan: True On-Screen Pagination (Word-like Pages)

## Objective

Implement live, interactive pagination so that when content exceeds page height, it flows into the next page container (like Word). Page breaks and section breaks should force boundaries. The solution must remain performant and preserve caret/selection.

---

## Constraints / Non-goals

This is not a full Word layout engine. We will prioritize:

- Block-level splitting first (MVP)
- Then inline splitting for long paragraphs (Phase 2)

Additional constraints:

- No heuristic “hide controls.” All pagination is deterministic and measurable.
- Must work in Electron renderer with DOM measurement APIs.

---

## 1) Architecture Overview

### 1.1 Create a dedicated pagination subsystem

Add a new module set under (suggested):

- `src/ui/pagination/`

Files:

- `src/ui/pagination/paginator.ts` — core algorithm
- `src/ui/pagination/page_model.ts` — types + page sizing
- `src/ui/pagination/selection.ts` — selection save/restore across DOM moves/splits
- `src/ui/pagination/dirty_tracker.ts` — mutation tracking + incremental repaginate
- `src/ui/pagination/debug_overlay.ts` — optional debug toggles (dev only)

### 1.2 Upgrade A4 layout from “visual pages” to “structural pages”

Currently, `a4_layout.ts` renders page shells and sets min-height. Replace this with:

- A PageHost container that contains N page elements
- Each page element contains a PageContent container that holds actual editor content nodes

#### DOM structure target

```html
<div class="leditor-page-host">
  <div class="leditor-page" data-page="1">
    <div class="leditor-page-content" contenteditable="true"> ... </div>
  </div>
  <div class="leditor-page" data-page="2">
    <div class="leditor-page-content" contenteditable="true"> ... </div>
  </div>
</div>
Key: You will either:

Keep a single contenteditable root and move nodes between pages (preferred), or

Make each page contenteditable (harder for selection and IME)

Recommended approach: keep a single contenteditable root inside host, but physically distribute block nodes across page content containers while preserving a single logical editing surface using selection mapping and event delegation.

2) Data Model and CSS Contracts
2.1 Page metrics must be measured, not guessed
Implement measurePageMetrics() using actual DOM:

Create one “probe page” and measure:

Page height

Content height (page height minus padding/margins/header/footer if any)

Content width

Store:

pageHeightPx

contentHeightPx

contentWidthPx

Make it deterministic by reading computed styles of .leditor-page and .leditor-page-content.

2.2 CSS requirements (Word-like)
Add/adjust CSS so pages behave like Word:

Fixed page size

Content clipped to page

Visible page gap

No “flow” within a page (content container must not auto expand beyond contentHeight)

Required CSS behaviors:

.leditor-page { height: var(--page-height); }

.leditor-page-content { height: var(--content-height); overflow: hidden; }

Page host scrolls vertically

Also include:

Break markers visible (optional) as overlays, not affecting measurement.

3) Core Pagination Algorithm (Deterministic)
3.1 Inputs
root: the editor content root that holds block nodes (paragraphs, headings, lists, tables, etc.)

pageHost: where pages are rendered

metrics: contentHeightPx and widths

3.2 Output
pages[]: each page owns a set of DOM nodes and optional split fragments

3.3 Basic (Phase 1) algorithm — block-level pagination
Goal: split at block boundaries only.

Steps
Flatten the editor root into an ordered list of “pageable blocks”.

Define isPageBlock(node):

P, H1-H6, UL, OL, TABLE, BLOCKQUOTE, PRE, HR, .leditor-break, ...

For lists/tables: treat them as atomic blocks initially.

Create Page 1, move blocks into it sequentially until overflow.

Append block to current page content.

After each append, measure current page content height (e.g., pageContent.scrollHeight).

If scrollHeight > contentHeightPx:

Remove the last block from this page

Start a new page

Append the block there

Manual page breaks:

If block is .leditor-break[data-break-kind="page"], it ends the current page and starts the next page.

Option: keep break marker at bottom of previous page or top of next; for Word-like, it behaves as boundary and may be rendered as a non-printing mark.

Ensure at least one page always exists.

Determinism notes
No “fit best” heuristics.

Always move blocks in strict DOM order.

Always start new page only when boundary rule triggers.

Performance notes
Avoid measuring on every block with forced layout thrash:

Use a “staging content container” and batch measure via requestAnimationFrame.

Or measure after N blocks, then backtrack using binary search to find overflow point (preferred).

3.4 Enhanced (Phase 1.5) algorithm — binary-search fit
Instead of add-and-measure per block:

For current page, compute max prefix of remaining blocks that fits:

Use binary search on number of blocks appended to staging container.

Move that prefix to the page.

Repeat.

This reduces layout passes from O(n) to O(log n) per page.

4) Phase 2: Inline Splitting (Long Paragraphs)
Block-only pagination will fail Word fidelity when:

A single paragraph is taller than a page.

Implement inline splitting for paragraphs and similar text blocks.

4.1 Inline split strategy
When a block itself exceeds contentHeightPx on an empty page:

Split the block into two blocks at a character/word boundary.

Implementation approach
Clone the block (shallow clone tag + attrs).

Move its children/text progressively into the first block until it fits.

Put remaining into second block.

For text nodes:

Use Range measurement:

Binary search on character offset to find max fit.

Create two text nodes via splitText(offset).

For inline elements:

Recursively split child nodes:

Preserve formatting spans

Avoid breaking inside non-splittable inline widgets (treat as atomic)

Deterministic rules
Break at nearest word boundary before overflow.

If no word boundary, break at character boundary.

If still cannot fit (e.g., large inline widget), allow overflow and mark as “unsplittable overflow” (and display warning in dev).

4.2 Selection preservation is mandatory here
Splitting text nodes changes node identity. You must implement robust selection mapping (see Section 6).

5) Section Breaks / Headers / Footers (optional but Word-like)
If you want closer Word fidelity, implement “section settings” that affect page metrics:

Margins

Header/footer content

Different first page / odd-even (optional)

This can be Phase 3.

For now:

Page metrics can be uniform

Section breaks force new page and can store metadata for future.

6) Caret/Selection Preservation (Critical)
You must preserve:

Caret position

Selection ranges

IME composition stability (best-effort)

6.1 Save selection as a “stable address”
Implement:

saveSelection(root): SelectionBookmark

restoreSelection(root, bookmark)

Bookmark format:

For each endpoint (anchor/focus):

Path of child indices from root to node OR a unique node-id attribute

Text offset within text node

Also include:

Direction and whether selection is collapsed

Recommendation (robust)
Introduce data-leditor-node-id on blocks and key inline nodes, assigned deterministically by editor model (if you have one). If you do not, implement a fallback “path-based” address with careful handling.

6.2 During pagination, wrap operations
When repaginating:

bookmark = saveSelection(editorRoot)

Perform DOM moves/splits

restoreSelection(editorRoot, bookmark)

For composition events:

Detect compositionstart → postpone repagination until compositionend.

7) Incremental Repagination (Performance + Stability)
Rebuilding pages on every keystroke will be slow and jittery.

7.1 Dirty tracker
Implement MutationObserver on the editor root:

Track changed block(s)

Compute earliest affected block index

Repaginate from that block forward only

Mechanism:

Assign block ids and measure “page start block id”

When mutation occurs inside block X:

Repaginate starting at page containing X

Reflow content forward, reusing existing pages where possible

7.2 Scheduling
Use:

requestAnimationFrame for near-term updates

requestIdleCallback (if available) for deferred “full cleanup”

Debounce resize events

Avoid multiple repaginates in the same frame:

Coalesce dirty regions.

8) Integration Points in Your Codebase
You already have:

/mnt/data/a4_layout.ts and /mnt/data/a4_layout.js

/mnt/data/print_preview.ts and /mnt/data/print_preview.js

8.1 Replace “visual only” page count logic
In a4_layout.ts, remove/disable:

“compute pageCount from scrollHeight and manual breaks”

“set minHeight to total virtual pages”

Instead:

Initialize PageHost and call paginate() to physically distribute blocks into pages.

8.2 Print preview remains separate
Leave print preview rendering as-is for now, but ensure:

It uses the same page metrics tokens

It respects manual breaks similarly

Later, you can reuse the same paginator in “print mode” if desired.

9) Handling UI features that depend on scrollHeight
Anything that currently relies on a single continuous scrollHeight must be updated:

Scroll-to-caret

Page number indicator

Selection highlight overlays

Comment anchors, etc.

Plan:

Provide helper getCaretPageIndex()

Map DOM position to page number by closest ancestor .leditor-page

10) Developer Controls and Debugging
Add a dev-only toggle:

Show per-page content height line

Show overflow warnings

Show block boundary boxes

Show “repaginate from page X” logs

This will accelerate correctness.

11) Acceptance Criteria / Test Matrix (Codex must implement)
11.1 Functional
Typing past bottom of page pushes content into next page.

Deleting content pulls content back to previous page.

Inserting manual page break forces new page.

Caret does not jump after pagination.

Selection across page boundary is stable.

Copy/paste across pages works.

11.2 Performance
No continuous reflow loops.

Repagination is debounced and incremental.

Large documents (e.g., 30 pages) remain interactive.

11.3 Visual
Page size matches A4/Letter settings (whichever you support).

Page gap and margins resemble Word.

Break indicators do not affect layout measurements.

12) Implementation Phases (Deliver in order)
Phase 1 (MVP, 1–2 days)
PageHost + per-page containers

Block-level pagination only

Manual page breaks force boundary

Selection save/restore across DOM moves

Basic incremental repagination (repaginate whole doc on change is acceptable initially, but must be debounced)

Phase 2 (Word-like, 3–7 days)
Inline splitting for overfull paragraphs

Better incremental repagination from dirty block

Composition/IME safety (postpone during composition)

Phase 3 (High fidelity, optional)
Tables/list partial splitting

Section breaks with per-section metrics

Header/footer regions

Widow/orphan control (optional; can be deterministic rules)

13) Concrete Task List for Codex (Do Not Skip)
Create new folder src/ui/pagination/ with modules listed above.

Implement measurePageMetrics() that reads computed styles from page templates.

Implement paginate(root, pageHost, metrics, options):

Clears pageHost pages

Paginates blocks deterministically

Enforces manual page breaks

Integrate into a4_layout.ts:

Replace virtual page counting with real pagination call

Ensure pagination runs on:

Initial mount

Editor content mutation (debounced)

Resize

Implement selection bookmark save/restore:

Path-based first

Add node-id support if feasible

Add MutationObserver + scheduler.

Add CSS updates so .leditor-page-content has fixed height and overflow: hidden.

Add debug overlay (optional but recommended in dev).

Write a small regression harness in regression.ts:

Generate 10+ pages of dummy content

Run pagination

Assert page count and that each page does not exceed contentHeightPx

Insert page break and verify page boundary exists