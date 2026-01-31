# Overall App Premium Theme Plan (`my-electron-app/`)

## Goal
Make the app feel premium through a cohesive, minimalist theme system applied consistently across ribbon, panels, tools, overlays, and the standalone settings window.

## Current reality (quick audit)
- Strong existing token system based on CSS variables:
  - Base tokens live in `my-electron-app/src/renderer/theme/tokens.ts`
  - Applied via `my-electron-app/src/renderer/theme/manager.ts` (`--bg`, `--panel`, `--accent`, `--shadow`, etc.)
  - Density + effects via `my-electron-app/src/renderer/theme/density.ts`
- Ribbon/panels have a “V2” variant gated by `html.ribbon-panels-v2` in `my-electron-app/src/renderer/ribbon-panels.v2.css`.
- Some surfaces are still hard to theme because they rely on inline style strings:
  - `my-electron-app/src/pages/VisualiserPage.tsx` (large inline styles)
  - Some Analyse pages use `element.style.*` extensively.
- The settings window has its own palette and CSS (light, IBM Plex) in `my-electron-app/src/windows/settings.html`, which can feel like a different product than the main (often dark) app.

## Premium “signature” for this app
- **Editorial minimalism**: fewer gradients by default; depth comes from subtle elevation + crisp borders.
- **One accent**: accent is a focus and selection color, not a background everywhere.
- **Consistency over novelty**: every control belongs to the same system (button/input/menu/panel).

## Plan: foundations
1) **Declare the design system contract (tokens + primitives)**
   - Keep the existing token naming (`--bg`, `--panel`, `--panel-2`, `--surface`, `--border`, `--text`, `--muted`, `--accent`, `--focus`, etc.).
   - Add (or standardize) missing semantic tokens used across components:
     - `--radius-*`, `--space-*`, `--shadow-ambient/elevated/overlay` (some already exist in density/effects)
     - `--motion-fast/medium/slow` (already in `density.ts`) + consistent easing token (add `--ease`).
   - Create a “primitive class layer” in CSS (no framework required):
     - `.ui-button` (default/primary/ghost/danger)
     - `.ui-input`, `.ui-select`, `.ui-textarea`
     - `.ui-panel`, `.ui-panel__header/body/footer`
     - `.ui-menu`, `.ui-menu__item`, `.ui-divider`
   - Target file: `my-electron-app/src/renderer/styles.css` (or a new `ui-primitives.css` imported there).

2) **Pick a default look that is minimalist**
   - Reduce “always-on” glow/gradient usage (keep it as an optional “Colorful” theme, not baseline).
   - Make “Dark” and “Light” the primary premium identities; keep warm/cold/high-contrast as variants.
   - Ensure the default theme works with long reading sessions (contrast, line height).

3) **Unify theme across windows**
   - Settings window should follow the same theme tokens and allow dark mode.
   - Approach:
     - Expose appearance settings to settings window and apply the same CSS variables there.
     - Replace hard-coded palette in `my-electron-app/src/windows/settings.html` with token wiring.

4) **V2 gating strategy**
   - Decide whether `ribbon-panels-v2` and `panels-v2` are:
     - the new default (recommended), or
     - an experiment that can be removed.
   - Remove duplicate styling paths after the decision to avoid drift.

## Acceptance checklist
- Every surface uses the same typography, radii, and spacing rhythm.
- Theme changes affect: main app + embedded leditor + PDF viewer + settings window.
- No major feature relies on inline CSS strings for layout/typography/colors (except where unavoidable).

