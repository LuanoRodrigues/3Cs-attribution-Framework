# Plan: Content Frame Height + Margin/ Header/Footer Cutout

## Goal
Ensure `leditor-content-frame` height responds to margin presets (including top/bottom) and excludes header/footer space so the editable area starts within margins.

## Success criteria
1. Margin presets (Normal/Narrow/Moderate/Wide) adjust top/bottom margins as well as left/right.
2. `.leditor-content-frame` height is derived from page size minus margins and header/footer distances (no fixed magic numbers).
3. Cursor starts inside the body content rectangle (not header/footer zones).

## Constraints
- Must follow `AGENTS.md` rules (no schema-breaking, no unsafe HTML).
- Changes must be deterministic and use layout spec/token values.
- No defensive fallbacks; fail fast on invalid inputs.

## Scope
- `src/ui/a4_layout.ts`
- `src/ui/layout_settings.ts`
- `src/ui/pagination/document_layout_state.ts`
- `Plans/layout_tab.json`

## Steps
1. Audit current margin preset application and CSS variables for top/bottom vs left/right in `src/ui/layout_settings.ts` and `src/ui/a4_layout.ts`.
2. Wire margin preset updates to `DocumentLayoutState` so top/bottom values update CSS tokens and margin variables used by `.leditor-content-frame`.
3. Replace any fixed/min-height logic on `.leditor-content-frame` with computed height using page height minus margins and header/footer distances.
4. Add a small debug-only log (gated by existing debug shortcut) to report computed content-frame height and margin values.

## Risk notes
- Changing height calculations could affect pagination and footnote placement.
- Incorrect unit conversion could shift content by a few px.

## Validation
- `npm start` (manual: switch margin presets and confirm top/bottom content bounds adjust and cursor starts inside body).

## Rollback
1. `git checkout -- src/ui/a4_layout.ts src/ui/layout_settings.ts src/ui/pagination/document_layout_state.ts Plans/layout_tab.json`

## Progress
- Step 1: PASS
- Step 2: PASS
- Step 3: PASS
- Step 4: PASS
- Validation: FAIL (`npm start` timed out with Electron portal error: org.freedesktop.portal.Desktop)
