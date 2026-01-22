# content_frame_margin_fix_plan.md — Constrain Body Editing Within Margins

## Goal
Ensure the editable body area respects top/bottom margins and never overlaps the header/footer regions by adjusting the content frame layout and focus behavior.

## Success criteria
1. The caret starts inside the body rectangle (inside margins) on initial load.
2. The editable area (content frame/ProseMirror) is vertically constrained so text cannot flow into header/footer space.
3. Header/footer remain non-editable unless explicitly in header/footer edit mode.
4. The body rectangle reflects top and bottom margins in the A4 view.

## Constraints
- Use existing A4 layout containers; no ad-hoc contenteditable wrappers.
- Keep schema-driven editor behavior intact.
- No runtime eval or unsafe DOM injection.

## Scope
- `src/ui/a4_layout.ts`
- `src/ui/layout_engine.ts` (only if margin variables need adjustment)
- `src/ui/renderer.ts` (only if focus timing needs adjustment)

## Steps
1. **Audit current content frame geometry**  
   Verify how `.leditor-margins-frame`, `.leditor-content-frame`, and `.leditor-page-content` are positioned and how margin vars are applied.
2. **Apply top/bottom margin constraints**  
   Adjust CSS/layout so the content frame uses top/bottom offsets within the margin frame, preventing overlap with header/footer.
3. **Ensure focus lands in body**  
   Confirm the editor is attached/focused inside the body rectangle and not header/footer.
4. **Update header/footer edit gating if needed**  
   Ensure header/footer remain non-editable outside edit mode and pointer events don’t steal focus.
5. **Validation**  
   Launch app and confirm caret starts inside body rectangle and typing stays within margins.

## Risk notes
- Over-constraining the content frame could clip content if pagination is not updated.
- Focus timing changes could conflict with TipTap selection handling.

## Validation
- `npm start` and manual check (Ctrl+Shift+M margin overlay); caret must remain inside dashed margin rectangle.

## Rollback
1. `git checkout -- src/ui/a4_layout.ts src/ui/layout_engine.ts src/ui/renderer.ts`
2. `git checkout -- Plans/content_frame_margin_fix_plan.md`

## Progress
- Step 1 — Audit current content frame geometry: PASS
- Step 2 — Apply top/bottom margin constraints: PASS
- Step 3 — Ensure focus lands in body: PASS
- Step 4 — Update header/footer edit gating if needed: PASS
- Step 5 — Validation: FAIL (npm start timed out; Electron portal error)
