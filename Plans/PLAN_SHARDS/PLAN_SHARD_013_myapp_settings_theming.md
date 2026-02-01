# PLAN_SHARD_013 — my-electron-app: Theme the settings window

## Goal
Make the standalone settings window follow the same appearance system (theme/density/effects/scale/accent) as the main app.

## Success criteria
- Settings window supports dark mode and matches tokens from `src/renderer/theme/*`.
- Changing appearance settings updates settings window visuals after apply/reload.

## Scope (exact file list)
- `my-electron-app/src/windows/settings.html`
- `my-electron-app/src/windows/settingsRenderer.ts`
- `my-electron-app/src/windows/settingsWindow.ts`

## Validation
- `cd my-electron-app && npm run build`

## Rollback
- `git checkout -- my-electron-app/src/windows/settings.html`
- `git checkout -- my-electron-app/src/windows/settingsRenderer.ts`
- `git checkout -- my-electron-app/src/windows/settingsWindow.ts`

## Progress
1) Apply theme tokens in settings renderer: PASS
2) Adjust settings HTML/CSS for tokens: PASS
3) Validate build: PASS (`cd my-electron-app && npm run build`)
