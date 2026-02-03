# PowerPoint Feature Map (create_power_point.py vs Visualise)

This document inventories the **PPTX building features** implemented in `python_backend.visualise.create_power_point`
and maps them to the currently exposed Visualise backend surface in `python_backend.visualise.visualise_host`
(which feeds the Electron Visualiser UI).

## Current Visualise backend surface

- Visualise RPC host: `my-electron-app/shared/python_backend/visualise/visualise_host.py`
  - Returns a **deck payload** to the UI: list of slide dicts with keys like `title`, `section`, `fig_json`, `table_html`, `img`, `notes`, `slide_id`.
  - Exposed section IDs (UI + backend): `Data_summary`, `Scope_and_shape`, `Authors_overview`, `Citations_overview`, `Words_and_topics`, `Ngrams`, `Affiliations_geo`, `Temporal_analysis`, `Research_design`, `Profiles`, `Categorical_keywords`.
  - PPT export path used by Visualise today: `visualise_host._export_pptx_from_slides(...)` (simple title + figure PNG, or text fallback).

## create_power_point.py overview

- PPTX builder: `my-electron-app/shared/python_backend/visualise/create_power_point.py`
  - Entry points:
    - `build_bibliometrics_pptx_core(df, sections, output_path, collection_name, options, progress_callback)`
    - `build_bibliometrics_pptx(...)`
  - Section routing:
    - `_get_section_registry()` provides a **registry** of section keys → handler functions.
    - `_invoke_handler(...)` invokes handlers safely (filters kwargs on mismatch, adds fallback slide on errors).
  - Most handlers build **paired outputs** (figure + table) and include rich layout logic (centering, autosizing, notes).

## Registry inventory (create_power_point.py)

Top-level registry keys and the handler they dispatch to:

- `data_summary` → `add_data_summary_slides`
  - **Visualise mapping:** `Data_summary` → `visual_helpers.add_data_summary_slides` (already exposed)

- `Scope_and_shape` → `add_scope_and_shape_section` (delegates to `shape_scope`)
  - **Visualise mapping:** `Scope_and_shape` → `visual_helpers.shape_scope` (already exposed)

- `authors` → `add_authors_slides`
  - **Missing in Visualise:** no `authors` section; Visualise instead exposes `Authors_overview` → `visual_helpers.authors_overview`

- `Authorship_institution` → `add_authorship_and_institution_section`
  - Builds **6 slides**: top authors table+fig, co-authorship pairs table, network fig, institution actors table+fig.
  - **Missing in Visualise:** not exposed as a dedicated section; partially overlaps `Authors_overview`

- `Citations_influence` → `add_citations_and_influence_section`
  - Builds **5 slides**: citation stats table, distribution figs (linear + log), top-cited table + bar fig.
  - **Missing in Visualise:** Visualise exposes `Citations_overview` using `analyze_citations_overview_plotly` (does not mirror the full stats/table set above).

- `affiliations` → `add_affiliations_slides`
  - Default plots include maps, networks, chord diagrams, institution/department views.
  - **Partial in Visualise:** Visualise exposes `Affiliations_geo` using `analyze_affiliations` (currently defaults to offline-safe plot types).

- `keywords` → `add_keywords_slides`
  - **Partial in Visualise:** Visualise exposes `Words_and_topics` via `analyze_wordanalysis_dispatcher`, which overlaps but isn’t feature-equivalent.

- `ngrams.basic` → `add_basic_ngram_analysis_slides`
  - **Partial in Visualise:** Visualise exposes `Ngrams` via `analyze_ngrams` (basic-like functionality)

- `ngrams.higher` → `add_ngram_higher_order_slides`
  - **Missing in Visualise:** not exposed as a subsection; no UI section for higher-order n-grams.

- `Thematic_method` → `add_thematic_and_method_section`
  - Cross-tabs, phase mapping, year-based mapping.
  - **Missing in Visualise:** no direct equivalent section.

- `Geo_sector` → `add_geo_and_sector_section`
  - Country + sector coverage mapping.
  - **Missing in Visualise:** no direct equivalent section.

- `Theory_empirical` → `add_theoretical_empirical_section` (if present in file / registry)
  - **Missing in Visualise:** no direct equivalent section.

## What is currently “missing” in Visualise (high-level)

Compared to `create_power_point.py`, the Visualise backend currently lacks:

- A registry-driven “PPT-first” builder with:
  - Transition slides (`_add_transition_slide`)
  - Rich table layout (autosized columns, centered tables)
  - Consistent “table + figure” pairing rules per analysis
  - Notes generation hooks (AI notes + safe fallbacks)
  - Subsection support (e.g. `ngrams.basic` vs `ngrams.higher`)
- Dedicated sections:
  - `Authorship_institution`
  - `Citations_influence`
  - `Thematic_method`
  - `Geo_sector`
  - `ngrams.higher`

## Recommended integration path

If the goal is to match `create_power_point.py` output fidelity:

1) Keep Visualise UI payload generation in `visualise_host` (for interactive Plotly).
2) For PPT export, route `export_pptx` to **create_power_point’s registry**:
   - Add a new action like `export_pptx_registry` in `visualise_host.py` that calls `build_bibliometrics_pptx_core`
   - Map Visualise “selected sections” → registry section tokens (including subsections like `ngrams.higher`)
3) Optionally extend Visualise UI to expose the missing sections/subsections, reusing the registry titles and defaults.

