# Pagination Rules (Deterministic Contract)

This README documents the deterministic pagination contract currently enforced by the pagination engine.

## Core Definitions

For each page, pagination uses the following measured values:

- `lineHeightPx`: computed line height in pixels for `.leditor-page-content`.
- `paddingBottomPx`: computed padding-bottom for `.leditor-page-content`.
- `contentHeightPx`: `clientHeight` of `.leditor-page-content`.
- `tolerancePx`: pagination measurement tolerance from `layout_spec.ts`.

Derived line budget:

- `maxLines = floor((contentHeightPx - paddingBottomPx + tolerancePx) / lineHeightPx)`
- `usedLines = ceil((pageContent.scrollHeight - paddingBottomPx) / lineHeightPx)`

Line height is required to be explicit (unitless multiplier or px). `line-height: normal` is rejected for determinism.

## Rule Order (Hard-Coded)

The paginator enforces the following rule order per page:

1. Hard breaks always win.
- Manual page breaks and forced section breaks immediately end the page.

2. Headings do not end a page.
- If a heading would be the last block on a page, move it to the next page unless that would create an empty page.

3. Atomic blocks move whole.
- If an atomic block does not fit and the page has content, move it to the next page.
- If the page is empty, allow it to overflow so pagination always makes progress.

4. Splittable paragraphs are split by line budget.
- Eligible selectors are split only if needed to fit remaining lines.
- Splits must satisfy `orphansMinLines` for the head and `widowsMinLines` for the tail.
- Split boundaries prefer word boundaries and fall back to character boundaries.

5. If no valid split exists:
- Move the paragraph to the next page.
- If the page is empty, allow overflow to avoid infinite loops.

## Policy Source of Truth

All policy is declared in `layout_spec.ts`:

- `blockPagination.headingSelectors`
- `blockPagination.atomicSelectors`
- `inlineSplit.eligibleSelectors`
- `inlineSplit.widowsMinLines`
- `inlineSplit.orphansMinLines`
- `inlineSplit.headingKeepWithNext`
- `inlineSplit.headingMinNextLines`

The paginator reads these values directly and does not duplicate defaults elsewhere.

## Inline Split Behavior

Inline splits are deterministic and line-budgeted:

- Split candidates are generated from the paragraph text.
- Candidates are tested in a binary search to find the latest valid split that:
  - fits the page line budget
  - satisfies `orphansMinLines` on the head
  - satisfies `widowsMinLines` on the tail

Split fragment styling:

- `head` is marked with `.leditor-split-fragment--head`
- `tail` is marked with `.leditor-split-fragment--tail`
- The head fragment has `margin-bottom: 0` to avoid double paragraph spacing at the page bottom.

## Selection Stability on Split

When a block is split:

- The head keeps the original `data-leditor-node-id`.
- The tail is assigned `data-leditor-node-id = originalId + ":cont:" + splitIndex`.
- The selection bookmark is remapped so the caret stays in the correct fragment and offset.

## Break Markers and Measurement

Debug page break markers must not affect layout measurement:

- `.leditor-break` is zero-height and has no margins or padding.
- Visuals are drawn using absolutely positioned pseudo-elements.

This ensures "show page breaks" never changes pagination.

## Columns

Paged mode is forced to a single column:

- `.leditor-page-content` uses `column-count: 1` with `!important`.
- Column leaks are guarded in tests.

## Tests and Guards

The audit pipeline exports per-page metrics that are used by guards:

- No forced `<br>` inside paragraphs.
- No excessive single-word lines in paragraphs.
- Split continuity: tails must be first block on the next page and parents last block on the previous page.
- No unexpected column counts.
- Minimum content width constraint (configurable via `MIN_CONTENT_WIDTH_PX`).

## Relevant Files

- `layout_spec.ts`: declarative policy source of truth.
- `page_metrics.ts`: line budget measurements.
- `inline_split.ts`: deterministic inline split algorithm.
- `paginator.ts`: rule order and page construction.
- `a4_layout.ts`: CSS constraints for pagination determinism.
- `pagination_audit.cjs`: page diagnostics.
- `pagination_linebreak_guard.cjs`: regression guards.
