# PDF Viewer Premium Plan (`my-electron-app/`)

## Goal
Make the PDF viewer experience feel first-class: consistent chrome, good selection UX, and theme parity.

## Current surfaces
- PDF tool: `my-electron-app/src/tools/pdf/index.ts`
- PDF viewer iframe/theme sync: `my-electron-app/src/renderer/index.ts` (syncs theme on `settings:updated`)
- Viewer asset: `my-electron-app/resources/viewer.html` (PDF.js viewer)

## Work items
1) **Theme parity**
   - Ensure PDF viewer inherits the same theme tokens:
     - background, text, accent, focus
   - Confirm dark mode styles are correct in PDF.js viewer (may require injecting CSS variables or a theme stylesheet).

2) **Selection UX**
   - The app tracks PDF selections and can auto-copy (setting: `General/pdf_selection_auto_copy`).
   - Make feedback premium:
     - subtle toast/confirmation
     - consistent selection highlight

3) **Error and loading states**
   - Missing file / invalid URL should show a clear, styled state (not a blank iframe).

## Acceptance checklist
- PDF viewer looks like part of the same app.
- Selection feedback is fast, subtle, and consistent with theme tokens.

