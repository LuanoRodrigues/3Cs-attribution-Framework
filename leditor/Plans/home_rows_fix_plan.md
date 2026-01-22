# HOME Rows Fix Plan

## Goal
Make HOME ribbon groups expand horizontally (not vertically) with controlled row counts, eliminating excessive group heights.

## Success Criteria
1. Clipboard, Font, Paragraph, Styles, Editing groups flow items row-first; new columns appear before additional rows.
2. Group bodies honor max row caps; heights no longer balloon on narrow widths.
3. Collapse A/B/C continues to function after layout change.

## Constraints
- Follow AGENTS.md (schema-driven, fail-fast, no defensive fallbacks).
- Keep existing per-group row caps from layout plan; no more than 5 rows.
- Desktop/Electron offline; no new dependencies.

## Scope
- src/ui/ribbon.css
- (validate) src/ui/ribbon_layout.ts (no functional change expected)

## Steps
1) Adjust group body grid flow to row-first: set auto-flow row, template columns to auto-fit, keep max-rows variable.
2) Validate collapse stages manually (resize) to ensure A/B/C still apply.

## Risk Notes
- CSS grid change could affect other tabs; verify cross-tab layout.
- Overflow handling might need minor gap tweaks if columns shrink too far.

## Validation
- Manual: run ribbon UI, resize to trigger Stage A/B/C; confirm groups stay within intended height.

## Rollback
- `git checkout -- src/ui/ribbon.css src/ui/ribbon_layout.ts`

## Progress
- [x] Step 1
- [x] Step 2
