# PHASE 2 — Line Split Engine (Deterministic Overflow)

## Goal
Ensure paragraph-level line splitting is deterministic and always finds a valid split position inside overflowing paragraphs, preventing underfilled pages and fragment-only pages.

## Success criteria
- Overflowing paragraphs split within the paragraph (not moved wholesale) unless keep-with-next explicitly forbids.
- `PaginationDebug` no longer reports repeated "skip split (canSplit=false)" for line-splittable blocks.
- Audit fragments for page 5 and page 10 are found on their expected pages.

## Constraints
- Must use schema-valid split positions only.
- Must not introduce layout-based hacks that bypass ProseMirror invariants.

## Scope (exact file list)
- `leditor/src/extensions/extension_page.ts`

## Steps
1) Harden line split candidate selection to only accept valid `canSplit` positions and add manual page split fallback for mapped split positions.
2) Adjust line split boundary resolution to prefer paragraph boundaries produced by the line split, not the DOM page boundary.
3) Add debug traces for manual page split failure cases to audit why candidates are rejected.
4) Validate with pagination audit.

## Risk notes
- Over-aggressive line splitting might produce very short lines if widow/orphan limits are wrong.
- Manual page split must preserve footnote storage nodes and schema constraints.

## Validation
- `cd /home/pantera/projects/TEIA/leditor && npm run build:renderer`
- `cd /home/pantera/projects/TEIA/leditor && ELECTRON_DISABLE_SANDBOX=1 npx electron --no-sandbox --disable-setuid-sandbox --disable-gpu-sandbox --disable-dev-shm-usage --disable-features=UsePortal ./scripts/pagination_audit.cjs ./coder_state.ledoc ./pagination_audit.json --expect ./expected_fragments.json`

## Rollback
- `git -C /home/pantera/projects/TEIA checkout -- leditor/src/extensions/extension_page.ts`

## Progress
1) Candidate validation + manual split fallback — PASS
2) Boundary resolution using mapped split positions — PASS
3) Manual split failure traces — NOT STARTED
4) Audit validation pass — NOT STARTED
