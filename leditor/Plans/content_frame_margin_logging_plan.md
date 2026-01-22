# content_frame_margin_logging_plan.md — Log Content Frame Sizing + Tie to Margins

## Goal
Instrument the A4 layout to log `leditor-content-frame` dimensions and ensure its height adapts to current margin settings so the editable body region changes when margin presets are applied.

## Success criteria
1. `Ctrl+Shift+M` logs `leditor-content-frame` and margin frame dimensions in the console.
2. `leditor-content-frame` height responds to margin changes (top/bottom) and no longer remains fixed when margin presets change.
3. The body editing region stays within margins and does not overlap header/footer.

## Constraints
- Keep instrumentation localized to `src/ui/a4_layout.ts`.
- No devtools console commands required from the user.
- Fail fast if margin sizes cannot be resolved.

## Scope
- `src/ui/a4_layout.ts`

## Steps
1. Add strict margin measurement helper for CSS length values (convert to px via a temporary element).
2. Use the measured margin values in `updateContentHeight` to compute body height per page and apply it to `leditor-content-frame`.
3. Extend `Ctrl+Shift+M` logging to include `contentFrame` and `marginFrame` rects and current margin values.
4. Verify logs and sizing by launching the app and toggling margin presets.

## Validation
- `npm start` and verify console logs on `Ctrl+Shift+M`, then apply margin presets and observe updated logs and body region size.

## Rollback
1. `git checkout -- src/ui/a4_layout.ts`
2. `git checkout -- Plans/content_frame_margin_logging_plan.md`

## Progress
- Step 1 — Add margin measurement helper: PASS
- Step 2 — Apply margin-aware content height: PASS
- Step 3 — Add logging on Ctrl+Shift+M: PASS
- Step 4 — Validation: FAIL (npm start timed out; Electron portal error)
