# PDF Viewer Window Premium Plan (`leditor/`)

## Goal
Make the PDF viewer feel like part of the same product: themed header, good metadata display, reliable loading/error UX.

## Current surfaces
- UI: `leditor/public/pdf_viewer.html`
- Electron wiring: `leditor/src/electron/main.ts`, `leditor/src/electron/preload.ts`
- Direct quote open: `leditor/src/ui/direct_quote_pdf.ts`

## Work items
1) Replace hard-coded colors with shared tokens and support light/dark.
2) Add loading state until payload arrives.
3) Improve error UI for missing payload / missing file.

## Acceptance checklist
- PDF viewer looks and feels like LEditor.

