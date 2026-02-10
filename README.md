# TEIA (Desktop Research + Writing Suite)

TEIA is an offline-first Electron desktop app for academic workflows: **retrieve** literature, **screen** and **analyse** corpora, **write** with Word-like fidelity, and **visualise/export** results.

This repo contains two main applications:
- `my-electron-app/`: the **desktop shell** (Electron + panel grid + multi-workspace ribbon).
- `leditor/`: the **document editor** (TipTap/ProseMirror) embedded by the shell, and also runnable standalone.

Docs:
- Desktop shell overview: `my-electron-app/AGENTS.md`
- Standalone editor overview: `leditor/README.md`

## Pages / Workspaces (features)

The app is organized around ribbon tabs/workspaces. Each workspace can open tools in different panels (drag tabs to rearrange).

### Write (document editor)
Backed by `leditor/` and shown as the Write workspace in the desktop shell.

Key features:
- Page-based A4 layout with print/preview surfaces.
- Footnotes/endnotes with a dedicated footnote surface (no legacy popover).
- Citations + bibliography pipeline (CSL-driven) and references UI.
- Import/export:
  - `.docx` import/export.
  - PDF export/print flows.
  - `.ledoc` project/document bundle (zip-based) import/export.
- AI-assisted workflows:
  - Agent sidebar + prompt/action scaffolding.
  - Source-check badges/rail + threaded feedback UI for “verified” vs “needs review” ranges.

Main code:
- `leditor/src/api/leditor.ts`
- `leditor/src/ui/a4_layout.ts`
- `leditor/src/extensions/`
- `leditor/src/electron/main.ts`

### Retrieve (search + DataHub)
Build queries, import records, and manage a working table of sources.

Key features (ribbon actions + tools):
- Academic database query builder with configurable:
  - Provider, sort, year range, and result limit.
- Data loading:
  - Zotero import.
  - Local CSV/Excel import.
- DataHub table utilities:
  - Export CSV / Excel.
  - Resolve missing values (“Resolve NA”) and flag missing values (“Flag NA”).
  - Apply codebook columns and coding columns filters.
- Citation tooling:
  - Citations list tool and citation graph tool.

Main code:
- `my-electron-app/src/ribbon/RetrieveTab.ts`
- `my-electron-app/src/tools/retrieve/`
- `my-electron-app/src/main/ipc/retrieve_ipc.ts`
- `my-electron-app/src/main/services/retrieve/`

### Analyse (corpus + rounds)
Load analysis runs, browse corpus batches, and navigate round-based sections.

Key features (ribbon actions + pages):
- Dashboard: run summaries and active-run selection.
- Corpus: batch browsing with filters/cards.
- Round views: Round 1 / Round 2 / Round 3 section browsers.
- Contextual tools docked from the Analyse workspace:
  - PDF viewer routing for selected payloads.
  - Coder panel integration for qualitative coding.

Main code:
- `my-electron-app/src/ribbon/AnalyseTab.ts`
- `my-electron-app/src/analyse/` (workspace, store, pages, data)

### Screen (triage)
Quickly triage candidate studies and log screening notes.

Key features (ribbon actions):
- Exclude item
- Tag for inclusion
- Write a screening note
- Screening settings panel

Main code:
- `my-electron-app/src/ribbon/ScreenTab.ts`
- `my-electron-app/src/tools/screen/`

### Visualise (visualiser + slide build)
Explore previews/thumbnails and build visual outputs.

Key features (ribbon actions):
- Rebuild preview inputs (“Run Inputs”)
- Refresh thumbnails/slide counts (“Refresh Preview”)
- Build slide deck (“Build Slides”)
- Diagnostics (“Diag”) + copy/clear export status log

Main code:
- `my-electron-app/src/ribbon/VisualiserTab.ts`
- `my-electron-app/src/pages/VisualiserPage.tsx`
- `my-electron-app/src/main/services/visualiseBridge.ts`
- `my-electron-app/shared/python_backend/visualise/`

### Export (project outputs)
Key features (ribbon actions):
- Export to Word
- Export to JSON
- Save project snapshot
- Export project ZIP

Main code:
- `my-electron-app/src/ribbon/ExportTab.ts`

### Tools (utilities)
Key features (ribbon actions):
- Open the PDF viewer tool.
- Open the Coder tool/panel.

Main code:
- `my-electron-app/src/ribbon/ToolsTab.ts`
- `my-electron-app/src/tools/`

### Settings
Standalone settings app for author profiles, Zotero integration, and model API configuration.

Main code:
- `my-electron-app/src/pages/SettingsPage.tsx`
- `my-electron-app/src/windows/settings*`

**Pagination Notes**
- Background: pagination should behave like a mini layout agent (LibreOffice/Word‑style) with deterministic, stable outputs across runs. Stability is a first-class goal, not a best-effort.
- Issue: hidden right-column / horizontal flow caused page count collapse. Solution: force single-column CSS on `.leditor-page-content` and the inner ProseMirror root, clamp widths, and add overflow detection that stamps `__leditorPaginationOverflowAt`.
- Issue: page count oscillation (e.g., 27↔28) from unstable merges/joins. Solution: removed `mergeSparsePages` call, added ABAB oscillation detection in pagination guards, and introduced a two-phase engine (overflow split first, underfill join later).
- Issue: large bottom whitespace from stale per-page footnote reserves after page rebuilds. Solution: clear footnote layout caches and reset per-page CSS vars in `renderPages`, and track footnote layout epochs for diagnostics.
- Issue: horizontal overflow was hard to reproduce in CI. Solution: added `pagination_horizontal_flow_guard.cjs` and expanded `pagination_smoke.cjs` to emit scroll widths, right-edge deltas, and offending node metadata.
- Issue: pages appear to overflow into a right-hand column instead of flowing vertically; each page holds a full column and the “excess” appears to the right. Solution: reset multicol formatting (`columns` / `column-count` / `column-width`) to `auto` on `.leditor-page`, `.leditor-page-inner`, `.leditor-page-content`, and the paginated ProseMirror root; neutralize column breaks in pagination mode; add horizontal-flow guards that verify no shifted blocks or scroll-left drift.
- Issue: inline splits at the bottom of a page could continue content to the right (page-sized columns), so pages stop overflowing vertically. Solution: treat right-shifted blocks as horizontal overflow inside the pagination snapshot so the engine splits before the shifted column even when `scrollWidth` does not exceed `clientWidth`, and clamp column properties back to `auto` when overflow is detected.
- Issue: hard-to-debug pagination churn. Solution: added `pagination_debug_watch.cjs`, `pagination_debug_analyze.cjs`, and `pagination_oscillation_guard.cjs` with trace/epoch sampling.
- Recovery: if a document is already paginated and shows extreme skew (e.g., 1–10 words on early pages and thousands on the last), run `view.pagination.reflow` to flatten and reflow pages, then re‑paginate from a clean slate.

## Running locally

### Prerequisites
- Node.js + npm
- Python 3 (used by DataHub / Analyse / Visualise bridges). You can override with `PYTHON` or `PYTHON3`.

### my-electron-app (desktop shell)
```bash
cd my-electron-app
npm ci
npm run build
npm run start
```

### leditor (standalone editor)
```bash
cd leditor
npm ci
npm run build
npm run start
```
