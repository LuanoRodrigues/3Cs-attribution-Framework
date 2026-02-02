# AI Source Checks Rail — V2 Plan (LEditor)

## Goals
- Make `leditor-source-check-rail__pCard` usable at scale:
  - Scroll works reliably inside each paragraph card body.
  - Every row expands to show full justification + suggestions.
  - Clicking a row selects and highlights the exact corresponding citation anchor in the document.
- For `needs_review` rows: offer an inline, non-destructive fix suggestion with **Accept/Reject** that:
  - Preserves citation anchors exactly (no edits inside anchors/citation nodes).
  - Edits only the surrounding claim text (deterministic transaction).
- Persist results in `.ledoc` so “Show source checks” restores prior checks (no dialogs).

## Constraints
- No file dialogs for “Show source checks”; toggles must only affect visibility.
- Never break citation anchors:
  - Do not delete/replace text ranges that contain citation marks/nodes.
  - Fix application must replace only plain text before the citation cluster.
- Debug logs must follow `[file][function][debug] ...` and avoid leaking document content.

## UX Plan
### 1) Rail scrolling
- Force wheel events to scroll the paragraph body when it is scrollable.
- Prevent the doc-shell from stealing scroll while hovering the rail list.
- Keep card max-height, add thin visible scrollbars.

### 2) Row expansion
- Add per-row expand state keyed by the check key.
- Collapsed mode:
  - 1–2 line clamp for justification text.
- Expanded mode:
  - Show full justification.
  - Show optional: `fixSuggestion`, `suggestedReplacementKey`, `claimRewrite`.

### 3) Row selection + anchor highlight
- Maintain a selected key in the rail.
- Clicking a row:
  - Scrolls the cited anchor into view.
  - Flashes the anchor.
  - Applies a persistent “selected” outline until another row is selected.
- If the key decoration isn’t found:
  - Fallback match by `href + anchor text` from persisted thread data.

### 4) Inline fix suggestion (needs_review only)
- Extend check-sources model response schema to include `claimRewrite`:
  - One sentence, **no citations**.
  - Only for needs_review; null otherwise.
- Render an inline “Fix” chip adjacent to the citation anchor when:
  - source checks are visible
  - verdict is needs_review
  - claimRewrite exists
  - fixStatus is pending
- On Apply:
  - Rewrite only the claim text before the first citation in the sentence, never touching citation marks/nodes.
  - Mark fixStatus=applied to hide the widget and persist.
- On Reject:
  - Mark fixStatus=dismissed to hide the widget and persist.

### 5) Persistence
- Store all checks (verdict/justification + suggestions + fixStatus) inside `.ledoc` history as `sourceChecksThread`.
- “Show source checks”:
  - Reattaches existing stored checks to the current doc.
  - Displays them in the rail.
  - Does not trigger any export/import or dialogs.

## Testing / Validation
- Typecheck: `npm run typecheck`
- Build: `npm run build:renderer && npm run build:electron`
- Manual sanity (in-app):
  - Run check sources for a paragraph with many citations (scroll).
  - Expand several rows and verify full text is readable.
  - Click rows; verify the exact anchor flashes and is outlined.
  - For needs_review: open Fix chip, Apply; verify anchors unchanged.
  - Save/reload `.ledoc`; verify the rail restores items.

