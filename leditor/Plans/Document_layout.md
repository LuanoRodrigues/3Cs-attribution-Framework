# Codex Implementation Plan: True On-Screen Pagination + Layout Tab Wiring (Word-like Pages)

## Objective
Implement live, interactive pagination where content **physically flows into the next page container** (Word-like), honoring:
- Page size presets (A4/Letter/Legal)
- Orientation (portrait/landscape)
- Margins + gutter + mirrored margins
- Header/footer distances and visual regions
- DOM-driven page breaks and section breaks
- Deterministic pagination with measurable constraints
- Performance and selection/caret stability

Additionally, wire all **Layout tab** ribbon controls (margins/orientation/size/breaks) to update the **Document Layout Spec** and trigger re-pagination.

---

## Goals
1. **True pagination (not virtual)**  
   When content exceeds a page’s content box, it moves to the next page container.
2. **Deterministic behavior**  
   No heuristic hiding: page boundaries are produced by measurable overflow and explicit break nodes/settings.
3. **Word-like layout controls**  
   Layout tab changes (margins/orientation/size/gutter/header/footer distance) update tokens/spec and reflow pages.
4. **Selection stability**  
   Caret/selection must not jump on repagination; IME composition must be protected.
5. **Incremental performance**  
   Repagination should be incremental from dirty blocks and scheduled (RAF), and remain responsive for multi-page docs.

---

## Constraints / Non-goals
- Not a full Word layout engine (no complex widow/orphan, no full table splitting in MVP).
- MVP prioritizes **block-level splitting**, then **inline split** for single overfull blocks.
- Header/footer are **visual regions** in MVP (non-editable), unless explicitly extended later.
- Must run in Electron renderer; can use DOM measurement APIs (ResizeObserver, getComputedStyle).
- All behavior must be driven by JSON config/spec and deterministic rules.

---

## Key Inputs (Machine-readable)
- `documentLayoutSpec` (your latest `wordLikePages` JSON)
- `layout.json` (Layout tab ribbon config; commands map to spec updates)
- DOM break nodes:
  - `.leditor-break[data-break-kind='page']`
  - `.leditor-break[data-break-kind='section'][data-kind=...]`

---

## Output / Acceptance Criteria
### Functional
- Typing past bottom of page pushes blocks to next page.
- Deleting pulls blocks back.
- Manual page break forces new page.
- Section break “nextPage/odd/even” forces new page; “continuous” does not.
- Changing margins/orientation/page size updates page geometry and repaginates.
- No menu/overlay clipping; debug guides do not affect measurement.

### UX/Selection
- Caret does not jump after pagination.
- Selection across pages is stable.
- IME composition does not break; pagination is deferred during composition.

### Performance
- No reflow loops.
- Pagination scheduled and coalesced.
- 30+ pages remain interactive.

---

## Architecture Overview

### Modules (recommended paths)
- `src/ui/pagination/page_metrics.ts`
  - `computeSpecPx(spec, pageIndex, sectionSettings) -> derivedPx`
  - token + px rounding policy
- `src/ui/pagination/page_host.ts`
  - PageHost DOM creation and recycling
- `src/ui/pagination/paginator.ts`
  - deterministic block fit + binary search fit + manual break handling
- `src/ui/pagination/inline_split.ts`
  - paragraph splitting via Range measurement (Phase 2)
- `src/ui/pagination/selection_bookmark.ts`
  - save/restore selection; node-id preferred, path fallback
- `src/ui/pagination/dirty_tracker.ts`
  - MutationObserver, map mutations to “earliest dirty block”
- `src/ui/pagination/scheduler.ts`
  - RAF coalescing + resize debounce + composition deferral
- `src/ui/pagination/debug_overlay.ts`
  - margin/content rect guides; overflow warnings; dev-only

### Data flow
1. Ribbon command → LayoutController updates documentLayoutSpec state
2. LayoutController applies CSS tokens / spec values
3. Scheduler triggers paginator
4. Paginator moves blocks into page content containers
5. SelectionBookmark restores caret/selection

---

## DOM Contract (Structural Pages)

### Target structure
```html
<div class="leditor-page-host">
  <div class="leditor-page" data-page="1">
    <div class="leditor-page-header" aria-hidden="true"></div>
    <div class="leditor-page-content" contenteditable="true"></div>
    <div class="leditor-page-footer" aria-hidden="true"></div>
  </div>
</div>
Required invariants
Pages are structural containers: blocks are physically moved between .leditor-page-content nodes.

Margins are applied via padding on .leditor-page-content (deterministic content box).

Header/footer are visual regions placed using distances/tokens; by default they do not reduce content height.

Deterministic Pagination Rules
Inputs
Ordered list of “pageable blocks” (DOM order)

Derived page metrics in px:

pageWidthPx, pageHeightPx

marginTop/Right/Bottom/Left px

contentWidthPx, contentHeightPx

Manual break nodes and section break nodes

Rule set
Blocks move in strict DOM order.

Manual page break ends current page immediately.

Section break:

nextPage/oddPage/evenPage: ends current page; starts new section

continuous: starts new section but may remain on same page

Fill each page until scrollHeight > contentHeightPx:

If overflow after appending a block: move that block to the next page

If the block overflows an empty page:

Phase 1: mark as unsplittable (dev warning)

Phase 2: attempt inline split (eligible selectors)

Deterministic rounding and tolerance:

Use integer px rounding for spec-derived values

Use tolerancePx to avoid 1px thrash

Performance approach
Use binary search fit per page for fewer layout passes:

find maximum prefix of remaining blocks that fits

commit that prefix to the page

continue

Layout Tab Wiring (Commands → Spec updates)
Required commands (minimum set)
Page Size preset: layout.pageSize.setPreset({ presetId })

Orientation: layout.orientation.set({ orientation })

Margins preset: layout.margins.setPreset({ presetId })

Margins custom: layout.margins.setCustom({ top,right,bottom,left })

Gutter: layout.gutter.set({ enabled, valueIn, positionId })

Header distance: layout.headerDistance.set({ valueIn })

Footer distance: layout.footerDistance.set({ valueIn })

Break insertion:

layout.break.insertPage()

layout.break.insertSection({ kind })

Spec update contract
All Layout commands update a single source of truth:

DocumentLayoutState contains:

active preset IDs

custom overrides

current section settings

After any layout change:

apply CSS tokens

invalidate metrics cache

schedule repagination

Fallback Strategy
Fallback A (MVP-safe)
If inline split is not implemented or fails:

allow a single overfull block to overflow (dev warning overlay)

keep document editable

do not loop pagination

Fallback B (Performance safety)
If incremental pagination causes instability:

temporarily repaginate the whole document on change (debounced)

keep incremental tracker behind a feature flag:

pagination.incremental.enabled

Fallback C (IME safety)
During composition:

defer pagination until compositionend

enforce a max deferral window (e.g., 60s); if exceeded, run once safely

Risks and Mitigations
Risk	Mitigation
Caret jumps due to DOM moves	Bookmark selection by node-id + offsets, restore after operations
Layout thrash from measuring too often	Binary search fit + RAF batching
Infinite repagination loops	tolerancePx, stable rounding, and no re-entry in same frame
Overfull blocks (large tables/images)	Phase-gated splitting; otherwise unsplittable warnings
Header/footer affecting measurements unexpectedly	reserveSpaceInContentBox=false, overlay/guides not counted

Phases (Deliver in Order)
Phase 0 — Preconditions (Scaffolding)
Deliverables

Feature flags:

pagination.enabled

pagination.incremental.enabled

pagination.debugOverlay.enabled

Introduce DocumentLayoutState store:

holds spec + current settings + derived px metrics cache

Exit criteria

Can toggle pagination mode on/off without breaking editor.

Phase 1 — Structural Pages + Block Pagination (MVP)
Work items
PageHost

Implement .leditor-page-host container that owns N pages

Create a page template (header/content/footer)

Implement page recycling (reuse DOM nodes when page count changes)

Metrics

Implement computeSpecPx() from documentLayoutSpec:

apply preset size + orientation

apply margins + gutter + mirrored margins

produce contentWidthPx/contentHeightPx

Implement measurePageMetrics():

create a probe page and read computed styles

validate computed height/width align with spec-derived px (dev asserts)

Block pagination

Flatten blocks using selectors list

Handle manual page breaks:

break node ends page and remains where configured (overlay/marker policy)

Fit blocks using binary search per page

Ensure at least 1 page exists

Selection preservation

Implement saveSelection() / restoreSelection()

Use data-leditor-node-id if present; fallback to DOM index path

Wrap every paginate() with bookmark save/restore

Scheduling

Debounced repagination on:

input changes (temporary: repaginate full doc on every change in RAF)

window resize / zoom change

Guard against re-entrancy

Exit criteria
Content flows across pages.

Manual page break forces new page.

Caret stable after pagination in normal typing/deleting.

Phase 2 — Incremental Repagination + Dirty Tracking
Work items
DirtyTracker

MutationObserver on the editor root

Map mutation target to containing “block root”

Determine earliest dirty block and repaginate starting from its page

Page boundary index

Maintain mapping: pageIndex → firstBlockId

On partial repaginate:

rebuild pages from the page containing dirty block forward

reuse earlier pages unchanged

Coalescing

Combine multiple mutations per frame

One repaginate per RAF

Exit criteria
Large docs remain responsive.

Typing only repaginates from the impacted page forward.

Phase 3 — Inline Splitting (Overfull Paragraphs)
Work items
Eligibility detection

If a block overflows an empty page and matches eligible selectors:

attempt inline split

Split implementation

Clone block node

Use Range measurement + binary search to find split point

Preserve inline formatting spans

Ensure deterministic split boundary preference:

word boundary, else character

Selection mapping

If split occurs inside selection endpoints:

update bookmark mapping to new text nodes/offsets

Exit criteria
Single long paragraph can span pages cleanly.

Caret remains stable.

Phase 4 — Section Settings + Odd/Even Behaviors (Word-like)
Work items
Section model

Track section settings in state

Section break nodes create/modify section records

Forced page behaviors

odd/even section breaks:

force next page parity (insert blank page if needed)

Per-section metrics

Allow section settings to change page size/margins/orientation

Paginator must compute metrics per page based on current section

Exit criteria
Section breaks behave deterministically and match configured rules.

Phase 5 — Layout Tab Wiring (Complete)
Work items
Ribbon layout tab

Ensure Layout tab exists and is wired:

Size, Orientation, Margins, Gutter, Breaks, Header/Footer distances

Each control dispatches a command that updates DocumentLayoutState

Token application

Apply CSS variables:

--doc-page-width/height, --doc-margin-*, --doc-content-*, --doc-page-gap, etc.

Ensure token application triggers repagination (scheduled)

UI feedback

Optional: show current preset names and values in UI

Debug overlay toggles in View tab (dev-only)

Exit criteria
Changing any Layout control updates geometry and repaginates immediately and correctly.

Phase 6 — Hard Cases (Optional / Later)
Table row splitting

List item splitting

Image/widget atomic placement rules

Widow/orphan deterministic rules

Editable header/footer mode

Test Matrix (Codex must implement)
Functional tests
Typing produces new pages at correct overflow boundary

Delete pulls content backward

Insert page break: forces new page

Insert section break:

nextPage: new page

continuous: same page allowed

odd/even: enforces parity

Change margins/orientation/size: repaginates with new content rect

Selection tests
Caret stable on repagination

Selection spanning pages stable

Copy/paste across pages

Performance tests
30-page doc: no continuous repagination loops

Incremental repagination only from dirty page forward

Implementation Checklist (Do Not Skip)
 Create pagination module directory and core files

 Implement PageHost + template + recycling

 Implement spec→px derivation with gutter + mirrored rules

 Apply margins as .leditor-page-content padding

 Implement deterministic block pagination (binary search fit)

 Implement selection bookmarks (node-id preferred)

 Add scheduler + composition deferral

 Add dirty tracking + incremental rebuild

 Implement inline splitting (Phase 3)

 Implement section model + odd/even enforcement (Phase 4)

 Wire Layout tab controls to spec updates + repagination

 Add regression harness + debug overlay

