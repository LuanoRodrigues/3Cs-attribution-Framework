# Annotarium Project & App Data Layout

## Overview
All heavy data is centralized under the app home `~/.annotarium/`, while each project keeps its own root under `~/Documents/Annotarium Projects/<project-name>/`.

## App home (`~/.annotarium/`)
- `config/` — settings store (`settings.json`), migrations.
- `projects/` — `project-metadata.json` (recent list, session cache).
- `coder/` — coder payload cache.
- `analyse/` — feature data by collection:
  - `<collection>/runs/...` (batches/sections files like `pyr_l1_batches.json`, `pyr_l1_sections.json`, etc.)
  - `<collection>/cache/` (derived indexes/stats).
- `exports/` — project export archives (each with `manifest.json`).
- `logs/` — optional logs.

## Project root (`~/Documents/Annotarium Projects/<project-name>/`)
- `project.json` — metadata (`projectId`, `name`, timestamps, app/manifest versions).
- `session.json` — canonical session state (layout, panel grid, code, analyse state).
- `assets/` — project-local assets.

## Export/Import
- Exports include: project root (with `project.json`, `session.json`, `assets/`), settings snapshot, project-metadata store, coder cache, and the referenced `analyse/<collection>/...`.
- `manifest.json` records all included paths plus collection names; import recreates them under `~/.annotarium/` and rewrites `session.analyse.baseDir` and run paths.

## Notes
- Analyse base dir is always `~/.annotarium/analyse/<collection>/`.
- Coder cache is always `~/.annotarium/coder/`.
- Exports are written to `~/.annotarium/exports/`.
