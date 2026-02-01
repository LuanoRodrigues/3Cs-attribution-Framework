# Print Preview Premium Plan (`leditor/`)

## Goal
Make print preview feel reliable and polished: accurate page splitting, premium modal chrome, readable pages.

## Current surfaces
- `leditor/src/ui/print_preview.ts` (modal + page splitting)
- `leditor/src/ui/preview.ts` (non-page-splitting preview)

## Work items
1) Replace injected UI styling with overlay/dialog primitives and `--ui-*` tokens.
2) Ensure page surface matches main canvas tokens.
3) Optional: merge preview and print preview to reduce duplication.

## Acceptance checklist
- Print preview looks like a premium app modal, not a debug tool.

