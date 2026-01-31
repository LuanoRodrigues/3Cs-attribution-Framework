# Premium Theme Upgrade Plans — `my-electron-app/` (Annotarium Panels)

This folder contains the “premium style” upgrade plan set for the Electron app in `my-electron-app/`.

## What this app is (as implemented today)
- A multi-workspace desktop app with:
  - Fixed ribbon (`#app-ribbon`) + tab header/actions (`src/layout/TabRibbon.ts`, `src/ribbon/*`)
  - Multi-panel grid with splitters, undocking, and tool tabs (`src/layout/PanelGrid.ts`, `src/panels/*`)
  - A theme/density/effects manager built on CSS variables (`src/renderer/theme/*`)
  - A “Write” workspace embedding `leditor` as a library (`src/pages/WritePage.tsx`, `src/panels/write/WritePanel.ts`)
  - A separate settings window (`src/windows/settingsWindow.ts`, `src/windows/settings.html`, `src/windows/settingsRenderer.ts`)

## Design intent
- Minimalist, calm, “research-grade”.
- Recognizable by a consistent *shape language* (radii, spacing, typography) and “quiet depth”.
- Smoothness is a feature: resizing, dragging, panel focus, and scroll must feel stable and fast.

## Plans (recommended order)
1) `overall_app_plan.md`
2) `smoothness_perf_plan.md`
3) `app_shell_plan.md`
4) `ribbon_plan.md`
5) `panels_plan.md`
6) `write_page_plan.md`
7) `retrieve_page_plan.md`
8) `analyse_page_plan.md`
9) `visualiser_page_plan.md`
10) `settings_plan.md`
11) `pdf_viewer_plan.md`
12) `rollout_roadmap.md`

