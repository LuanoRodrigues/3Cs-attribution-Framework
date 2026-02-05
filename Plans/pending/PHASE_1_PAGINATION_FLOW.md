# PHASE 1 — Pagination Flow (LO-like Page Thread)

## Goal
Rebuild page-flow logic so document content behaves as a single continuous thread (Word/LibreOffice-like), while the page nodes remain a layout artifact that can be split/joined deterministically.

## Success criteria
- Page 1/2 boundary responds to Enter/Backspace: Enter at last visible line moves content to next page; Backspace at page start pulls content up.
- No underfilled pages caused by premature block moves; page fills until the bottom limit within 1–2 lines.
- Pagination audit passes: `scripts/pagination_audit.cjs` reports 0 failed expectations and boundary interaction expectations pass.

## Constraints
- Must preserve ProseMirror schema invariants (page node content = block+).
- No masking fallbacks that hide failures; explicit errors for invalid positions.
- Only changes within pagination + layout scope.

## Scope (exact file list)
- `leditor/src/extensions/extension_page.ts`
- `leditor/src/ui/a4_layout.ts`
- `leditor/scripts/pagination_audit.cjs`
- `leditor/scripts/convert_coder_state.js`
- `leditor/run_convert_coder_state.sh`
- `leditor/expected_fragments.json`

## Steps
1) Instrument pagination flow to expose per-page bottom limits + line utilization (add a deterministic debug summary to the audit script).
2) Normalize page boundary calculations to use a single source of truth (bottomLimit + guard) and remove mismatched DOM vs model heights.
3) Ensure join logic triggers on page-start backspace and split logic triggers on page-end enter (explicitly validate page boundary positions).
4) Stabilize split/join oscillation (tighten buffers + lock behavior around split boundaries).
5) Validate with pagination audit (must pass expectations + interactions).

## Risk notes
- Changing boundary calculations may shift pagination globally and alter the audit baselines.
- Aggressive join/split may cause oscillation; must use lockouts and minimal buffers.

## Validation
- `cd /home/pantera/projects/TEIA/leditor && npm run build:renderer`
- `cd /home/pantera/projects/TEIA/leditor && ELECTRON_DISABLE_SANDBOX=1 npx electron --no-sandbox --disable-setuid-sandbox --disable-gpu-sandbox --disable-dev-shm-usage --disable-features=UsePortal ./scripts/pagination_audit.cjs ./coder_state.ledoc ./pagination_audit.json --expect ./expected_fragments.json`

## Rollback
- `git -C /home/pantera/projects/TEIA checkout -- leditor/src/extensions/extension_page.ts leditor/src/ui/a4_layout.ts leditor/scripts/pagination_audit.cjs leditor/expected_fragments.json`

## Progress
1) Instrument pagination flow — NOT STARTED
2) Normalize boundary calculations — NOT STARTED
3) Page-boundary Enter/Backspace correctness — NOT STARTED
4) Split/join oscillation stability — NOT STARTED
5) Audit validation pass — NOT STARTED
