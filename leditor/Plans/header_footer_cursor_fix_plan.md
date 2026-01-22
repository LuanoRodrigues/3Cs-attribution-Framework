# header_footer_cursor_fix_plan.md — Constrain Editing to Body Area

## Goal
Ensure the editor caret and text input are constrained to the body (main content) area so typing never occurs in header/footer regions, including when entering header/footer edit mode via Ctrl+Shift+M.

## Success criteria
1. Default editing places the caret inside the body region (inside margins) and not in the header/footer areas.
2. In header/footer edit mode, only the header/footer zones are editable and the body region is read-only; in normal mode, only the body is editable.
3. The large central body rectangle accepts text input and selection; header/footer areas do not accept input unless explicitly in header/footer edit mode.
4. Cursor position and focus after toggling header/footer mode are deterministic and visible (no “floating” caret in the header area when not editing headers/footers).

## Constraints
- Must keep schema-based editing; no ad-hoc contenteditable hacks outside the editor core.
- Use existing A4 layout structures and editor APIs; avoid adding new global state unless required.
- No runtime eval or unsafe DOM injection.
- Limit changes to `src/ui` and existing editor hooks.

## Scope
- `src/ui/a4_layout.ts`
- `src/ui/layout_engine.ts`
- `src/ui/layout_context.ts`
- `src/ui/renderer.ts`
- `src/api/command_map.ts`
- `src/ui/view_state.ts` (if header/footer state is stored here)

## Steps
1. **Audit header/footer edit flow**  
   Inspect `src/ui/a4_layout.ts` header/footer DOM structure and current “edit mode” toggles. Identify where the body, header, and footer containers are defined and which nodes are currently editable.
2. **Implement editability gating**  
   Add explicit toggling so only the active region is editable: body editable in normal mode; header/footer editable only in their respective edit modes. Ensure the other regions are non-editable and not focusable.
3. **Focus and caret placement**  
   When exiting header/footer edit mode, force focus and selection back into the body area. When entering, focus into the header/footer area. Make sure focus respects margins and does not land in header/footer during normal mode.
4. **Wire command behavior**  
   Ensure commands like `EditHeader`, `EditFooter`, and `ExitHeaderFooterEdit` toggle the layout state in `a4_layout` and update focus/selection accordingly (via `command_map` and layout controller).
5. **CSS / hit‑testing adjustments**  
   If required, refine CSS to prevent pointer events or selection in header/footer regions during normal mode. Keep the body’s “big rectangle” as the only input target outside header/footer mode.
6. **Validation**  
   Run the app and verify:  
   - Typing starts inside the body rectangle.  
   - Ctrl+Shift+M toggles header/footer mode with the correct editable region.  
   - Exiting mode returns caret to body; header/footer are no longer editable.

## Risk notes
- Toggling editability may interfere with existing selection logic if DOM nodes are reused for header/footer previews.
- Focus management could conflict with TipTap editor focus if not routed through the editor view.

## Validation
- `npm start` and manual verification as described in Step 6.

## Rollback
1. `git checkout -- src/ui/a4_layout.ts src/ui/layout_engine.ts src/ui/layout_context.ts src/ui/renderer.ts src/api/command_map.ts src/ui/view_state.ts`
2. `git checkout -- Plans/header_footer_cursor_fix_plan.md`

## Progress
- Step 1 — Audit header/footer edit flow: PASS
- Step 2 — Implement editability gating: PASS
- Step 3 — Focus and caret placement: PASS
- Step 4 — Wire command behavior: PASS
- Step 5 — CSS / hit‑testing adjustments: PASS
- Step 6 — Validation: FAIL (npm start timed out; Electron portal error)
