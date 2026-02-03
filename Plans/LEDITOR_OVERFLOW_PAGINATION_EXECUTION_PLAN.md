# LEditor — Overflow + Page Boundary Execution Plan

## Goal
Match LibreOffice/Word-style page overflow behavior for body text: last-line/footnote separation, predictable page jumps on Enter/Backspace at boundaries, and line-level overflow splitting (including lists/blockquote content).

## Success criteria
- Last body line never overlaps the footnote band.
- Enter on the last visible line moves caret to the next page’s first line.
- Typing a character that exceeds the last line flows that character to the next page.
- Backspace at the very start of a page jumps to the previous page (joining pages where possible).
- Pagination remains stable (no split/join oscillation).

## Constraints
- Page nodes remain the top-level layout unit (no schema changes).
- Pagination must remain transaction-driven (no DOM-only edits).
- Respect existing footnote/layout measurement flow.

## Scope (exact files)
- `leditor/src/extensions/extension_page.ts`
- `leditor/src/ui/a4_layout.ts` (verify footnote spacing vars only; no schema edits)
- `Plans/LEDITOR_OVERFLOW_PAGINATION_EXECUTION_PLAN.md` (this file)

## Steps
1) Page-boundary keyboard behavior
   - Intercept Backspace at page start to jump/join into previous page.
   - Intercept Enter on the last visible line to split page and place caret on the next page.
   - File: `leditor/src/extensions/extension_page.ts`

2) Overflow splitting improvements
   - Extend line-splitting to headings/lists/blockquote (nested text blocks).
   - Detect overflow inside list/blockquote containers to split at the correct descendant block.
   - Split tables by row when a table overflows a page.
   - File: `leditor/src/extensions/extension_page.ts`

3) Footnote/body boundary enforcement
   - Ensure pagination uses the body’s effective height (footnote gap/height) when computing split points.
   - Confirm bottom guard stays aligned with footnote spacing.
   - Keep complex blocks (tables/figures/images) together via break-inside rules.
   - Files: `leditor/src/extensions/extension_page.ts`, `leditor/src/ui/a4_layout.ts`

4) Validation
   - `cd leditor && npm run typecheck`
   - `cd leditor && npm run build`

## Progress
1) Page-boundary keyboard behavior — PASS
2) Overflow splitting improvements — PASS
3) Footnote/body boundary enforcement — PASS
4) Validation — TODO
