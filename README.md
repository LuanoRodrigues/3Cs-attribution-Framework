# Three-C Electron Viewer (Annotarium)

Run from this folder:

```bash
cd /home/pantera/projects/TEIA/annotarium/threec_electron_viewer
npm install
npm run start
```

Release and auto-update setup:
- Git remote: `git@github.com:LuanoRodrigues/3Cs-attribution-Framework.git`
- Build installers locally: `npm run dist`
- Publish to GitHub Releases locally: `npm run release`
- CI release flow: push a version tag like `v0.1.0` to trigger `.github/workflows/release.yml`
- Auto-updates are enabled via `update-electron-app` (uses `update.electronjs.org` with GitHub Releases for public repos)

Notes:
- Default source JSON: `annotarium/outputs/reports/apt1_exposing_one_of_china_s_cyber_espionage_units_report.json`
- Pipeline file list (APT1 preloaded): `annotarium/threec_electron_viewer/pipeline_files.json`
- UI can add PDFs and run full pipeline (PDF -> markdown -> extraction -> validation -> scoring -> figures)
- UI includes `Rescore` to rerun scoring scripts on the currently loaded report and refresh values/figures.
- UI includes a `Centralized` workspace tab with filter panel, card panel, and detail panel for claims/sources/artifacts.
- Dashboard tab now lists loaded PDFs; clicking a PDF path loads its generated figures.
- Dashboard HTML now uses per-figure tabs (no contents sidebar).
- Reports are enriched with `enrichment` payload (image paths, markdown tables, figures, artifact links) for detailed rendering.
- Backend orchestration service: `annotarium/threec_electron_viewer/backend/pipeline_backend.js`
- Generator script lives in this folder: `threec_viewer_widget (1).py`
- Built dashboard output: `./reports_results/*_threec_viewer.html`
