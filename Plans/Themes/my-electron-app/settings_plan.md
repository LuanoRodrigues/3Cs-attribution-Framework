# Settings Premium Plan (`my-electron-app/`)

## Goal
Deliver a premium, cohesive settings experience that matches the main app’s design system.

## Two settings surfaces (important)
1) In-workspace “SettingsPage” (simple): `my-electron-app/src/pages/SettingsPage.tsx`
2) Standalone settings window (primary):  
   - `my-electron-app/src/windows/settingsWindow.ts`  
   - `my-electron-app/src/windows/settings.html`  
   - `my-electron-app/src/windows/settingsRenderer.ts`

## Work items
1) **Unify design language with main app**
   - The settings window currently has its own palette and fonts.
   - Apply the same appearance tokens (theme/density/effects/scale/accent) used by the main app.
   - Add dark mode support in settings window (at least).

2) **Appearance preview**
   - In the Appearance section, show a small live preview card:
     - ribbon sample
     - panel sample
     - button + input sample
   - This makes theme/density decisions feel “premium”.

3) **Information architecture**
   - Keep current nav grouping, but refine:
     - clearer section headers
     - consistent help text
     - better status feedback when applying changes

4) **Secrets vault UX**
   - Make vault unlock feel safe and clear (no default passphrase vibes in UI).
   - Ensure copy-to-clipboard and reveal actions are consistent and auditable.

## Acceptance checklist
- Settings window feels like the same product as the main app.
- Appearance changes apply immediately and predictably.
- Sensitive data flows are clearly labeled and safe by default.

