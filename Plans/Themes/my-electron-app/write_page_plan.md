# Write Page Premium Plan (`my-electron-app/` + embedded `leditor`)

## Goal
Make the Write workspace feel like a premium writing environment while preserving the embedded LEditor fidelity.

## Current implementation
- Host + lifecycle: `my-electron-app/src/pages/WritePage.tsx`
- Data sync (coder state, citations, direct quotes): `my-electron-app/src/panels/write/WritePanel.ts`
- Styling overrides for embedded LEditor: `my-electron-app/src/renderer/styles.css` (`.write-page-shell ...`)
- Theme sync to LEditor:
  - `my-electron-app/src/renderer/theme/manager.ts` dispatches `leditor:theme-change`.

## Work items
1) **Visual integration**
   - Ensure the host chrome (outside LEditor) matches the app’s tokens.
   - Reduce “double ribbon” confusion:
     - the app has its own ribbon; LEditor also has a ribbon host
     - decide whether LEditor ribbon is always visible, or only when in Write mode (and how it should visually nest).

2) **Theme mapping**
   - Confirm `leditor:theme-change` provides enough information for LEditor (mode + surface).
   - Ensure accent color and link styling match the app tokens without over-highlighting.

3) **Loading and error states**
   - Current Write host shows “Loading Write editor…”.
   - Upgrade to a premium loader:
     - skeleton/placeholder
     - clear error recovery affordance (retry / open settings / diagnostics)

4) **UX polish**
   - Ensure keyboard focus lands in the editor when entering Write mode.
   - Make citation/direct-quote links visually consistent and subtle (keep them discoverable).

## Acceptance checklist
- Write workspace looks like one product (Annotarium chrome + LEditor surface).
- Theme changes update LEditor without flash or mismatched fonts.
- Switching away and back to Write doesn’t leak old state or break focus.

