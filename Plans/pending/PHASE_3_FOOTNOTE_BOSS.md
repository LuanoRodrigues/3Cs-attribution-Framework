# PHASE 3 — Footnote Boss (LibreOffice-style Flow)

## Goal
Implement a LO-style footnote boss flow: footnotes are measured and allocated in the page flow so body text always yields space and footnotes continue across pages when needed.

## Success criteria
- Footnote area never overlaps body text.
- When footnotes grow, body text pushes down immediately and overflows to the next page.
- If a footnote exceeds its page allocation, continuation appears in the next page’s footnote area.
- Pagination audit shows no fragment-only pages caused by footnote expansion.

## Constraints
- Footnote overlay remains editable; must not move footnote editor into the body DOM.
- Must preserve footnote numbering and anchors.

## Scope (exact file list)
- `leditor/src/ui/a4_layout.ts`
- `leditor/src/uipagination/footnotes/*`
- `leditor/src/extensions/extension_footnote_body.ts`
- `leditor/scripts/pagination_audit.cjs`

## Steps
1) Align footnote height and page-content bottom limit via shared CSS tokens (single source of truth).
2) Implement continuation allocation: split footnote text into per-page slices when height exceeds the cap.
3) Ensure footnote growth triggers immediate pagination and scroll-preserving reflow.
4) Validate with pagination audit and manual footnote growth tests.

## Risk notes
- Incorrect footnote slicing can desync numbering or break anchors.
- Over-tight coupling between overlay and page content can reintroduce caret flicker.

## Validation
- `cd /home/pantera/projects/TEIA/leditor && npm run build:renderer`
- `cd /home/pantera/projects/TEIA/leditor && ELECTRON_DISABLE_SANDBOX=1 npx electron --no-sandbox --disable-setuid-sandbox --disable-gpu-sandbox --disable-dev-shm-usage --disable-features=UsePortal ./scripts/pagination_audit.cjs ./coder_state.ledoc ./pagination_audit.json --expect ./expected_fragments.json`

## Rollback
- `git -C /home/pantera/projects/TEIA checkout -- leditor/src/ui/a4_layout.ts leditor/src/uipagination/footnotes leditor/src/extensions/extension_footnote_body.ts`

## Progress
1) Footnote height + bottom limit sync — NOT STARTED
2) Footnote continuation allocation — NOT STARTED
3) Immediate pagination on growth — NOT STARTED
4) Audit validation pass — NOT STARTED
