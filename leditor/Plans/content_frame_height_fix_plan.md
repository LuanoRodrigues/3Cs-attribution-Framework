# content_frame_height_fix_plan.md — Make Content Frame Height Margin-Aware

## Goal
Remove fixed `min-height` on `leditor-content-frame` and tie its height to top/bottom margin variables so the editable region flexes correctly and respects header/footer spacing.

## Success criteria
1. `leditor-content-frame` no longer uses a fixed pixel min-height.
2. The content frame height is derived from current margin values (top/bottom) and page height.
3. The caret stays within the body rectangle, not overlapping header/footer.

## Constraints
- Use existing CSS variables for margins and page size.
- No ad-hoc JS resizing loops; keep layout in CSS unless a controlled update is required.
- Preserve existing pagination logic.

## Scope
- `src/ui/a4_layout.ts` (style block)

## Steps
1. **Locate fixed min-height**: identify the hard-coded `min-height` on `.leditor-content-frame`.
2. **Replace with margin-aware sizing**: compute `min-height` or `height` using `var(--page-height)` and margin variables.
3. **Verify layout**: ensure body region remains within margins and header/footer are not editable.

## Validation
- `npm start` and verify the caret starts inside the body rectangle and the content frame respects margins.

## Rollback
1. `git checkout -- src/ui/a4_layout.ts`
2. `git checkout -- Plans/content_frame_height_fix_plan.md`

## Progress
- Step 1 — Locate fixed min-height: PASS
- Step 2 — Replace with margin-aware sizing: PASS
- Step 3 — Verify layout: FAIL (npm start timed out; Electron portal error)
