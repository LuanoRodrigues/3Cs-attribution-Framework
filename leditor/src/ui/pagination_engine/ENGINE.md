# Pagination Engine

This engine provides deterministic pagination for LEditor using a two-phase pass:

1. Phase 1 (Overflow): resolve overflow by splitting pages.
2. Phase 2 (Underfill): optimize underfilled pages by joining when safe.

It relies on line budgets derived from `.leditor-page-content` measurements:

- `maxLines = floor((contentHeightPx - paddingBottomPx + tolerancePx) / lineHeightPx)`
- `usedLines = ceil((scrollHeightPx - paddingBottomPx) / lineHeightPx)`

Debug fields are exposed on `window` after each run:

- `__leditorPaginationLastSnapshotSig`
- `__leditorPaginationLastPhase`
- `__leditorPaginationLastAction`
- `__leditorPaginationLastOverflowPages`
- `__leditorPaginationLastStable`

This module is intentionally small and deterministic; future refinements can extend
split target selection and underfill pull-up logic.
