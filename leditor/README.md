# leditor (Standalone Academic Editor)

`leditor/` is a desktop-first, offline academic document editor built on **TipTap/ProseMirror** (schema-based editing). It can run as a **standalone Electron app** and can also be consumed as a **bundled library** by `my-electron-app/`.

## Core principles
- Canonical document format is **ProseMirror/TipTap JSON** (HTML/Markdown are derived outputs).
- All content changes go through editor transactions/commands (no raw `contenteditable` editing).
- Offline-first by default (no network required to edit documents).

## Features

### Document editing
- Page-based layout (`A4`/print-style surfaces), margins, pagination.
- Footnotes/endnotes rendered and edited in a dedicated footnote surface.
- Search panel and status bar.

### Citations & references
- CSL-driven citations/bibliography and references UI.

### Import / export
- DOCX import/export.
- PDF export/print preview.
- **`.ledoc`** import/export: a zip-based document bundle (see `docs/ledoc.md`).

### AI-assisted workflows
- Agent sidebar + action prompts.
- Source-check badges/rail with threaded “verified / needs review” feedback.

## Running (standalone Electron)
From `leditor/`:
```bash
npm ci
npm run build
npm run start
```

Useful validations:
```bash
npm run test:docx-roundtrip
npm run test:print-pdf-headless
npm run test:footnote-layout
npm run lint:icons
```

## Using as a library
`leditor` builds ESM/CJS outputs and a global bundle:
- `npm run build:lib` (produces `dist/lib/*`)
- Package entrypoints are defined in `leditor/package.json` under `exports`.

## Docs
See `leditor/docs/README.md`.

