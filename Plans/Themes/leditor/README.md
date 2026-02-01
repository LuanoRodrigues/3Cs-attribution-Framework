# Premium Theme Upgrade Plans — `leditor/`

This folder shards the “premium-style” UI/UX upgrade into per-surface plans for the Electron app in `leditor/`.

## Design intent
- Minimalist, calm, desktop-first.
- Word-like fidelity (document + ribbon affordances) without looking “webby”.
- Cohesive tokens (color/type/spacing/radius/elevation) across *all* surfaces.
- “Smoothness” as a first-class feature (motion, focus, scroll, latency).

## Scope map (where the UI lives today)
- App shell + document surface: `leditor/src/ui/renderer.ts`, `leditor/src/ui/a4_layout.ts`
- Ribbon: `leditor/src/ui/ribbon.css`, `leditor/src/ui/ribbon_layout.ts`, `leditor/src/ui/ribbon_*.ts`
- Panels & utilities: `leditor/src/ui/*` (many panels inject CSS via `style.textContent`)
- References picker (iframe): `leditor/src/ui/references/ref_picker.html`
- PDF viewer window: `leditor/public/pdf_viewer.html`

## Recommended execution order
1) `overall_app_plan.md`
2) `smoothness_perf_plan.md`
3) `write_page_plan.md`
4) `ribbon_plan.md`
5) `panels_plan.md`
6) `overlays_plan.md`
7) `status_bar_plan.md`
8) `references_plan.md`
9) `print_preview_plan.md`
10) `pdf_viewer_plan.md`
11) `rollout_roadmap.md`

