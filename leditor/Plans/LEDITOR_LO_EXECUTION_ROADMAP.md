# LEditor ↔ LibreOffice Parity Roadmap (Actionable + Estimates)

Estimates are rough engineering effort for a single senior dev. Dependencies are noted per task.

## Phase 0 — Prereqs (1–2 days)
- [ ] Add a feature flag matrix + telemetry hooks to measure usage/regressions.
  - Files: `leditor/src/ui/feature_flags.ts`, `leditor/src/ui/renderer.ts`
  - Est: 0.5–1d

## Phase 1 — Layout + Page Style Foundations (1–2 weeks)
1) Paper size registry + locale default
- Implement ISO/US size catalog + locale default (A4/Letter) and expose in layout settings.
- Files: `leditor/src/ui/layout_settings.ts`, `leditor/src/extensions/extension_page_layout.ts`, `leditor/src/ui/pagination/document_layout_state.ts`
- Est: 1–2d
- Depends: none

2) Style store (paragraph/character/page) and persistence
- Add a style registry persisted in doc attrs (or a dedicated node) with inheritance.
- Files: `leditor/src/extensions/extension_style_store.ts`, new `leditor/src/editor/styles/*`
- Est: 3–4d
- Depends: 1

3) Page style family + apply via section breaks
- Enable page styles as first-class (size, margins, header/footer variants). Allow applying at section breaks.
- Files: `leditor/src/extensions/extension_page.ts`, `leditor/src/extensions/extension_page_layout.ts`, `leditor/src/api/command_map.ts`, `leditor/src/ui/layout_settings.ts`
- Est: 4–6d
- Depends: 2

## Phase 2 — Layout Correctness (2–3 weeks)
4) Widow/orphan + keep-with-next at paragraph style level
- Add style attrs + paginator rules.
- Files: `leditor/src/extensions/extension_page.ts`, `leditor/src/ui/pagination/*`
- Est: 4–6d
- Depends: 2

5) Hyphenation (best‑effort)
- Integrate soft‑hyphen insertion or dictionary-backed breaker.
- Files: `leditor/src/extensions/extension_page_layout.ts`, `leditor/src/ui/pagination/inline_split.ts`
- Est: 4–6d
- Depends: 2

6) Table flow across pages (header repeat + keep rows)
- Add table split rules; keep header rows with page breaks.
- Files: `leditor/src/extensions/extension_page.ts`, `leditor/src/ui/pagination/paginator.ts`
- Est: 4–6d
- Depends: 4

## Phase 3 — Tables + Fields (2–3 weeks)
7) Table resize + properties dialog
- Enable resizable tables + UI handles; add table properties dialog for borders/spacing/alignment.
- Files: `leditor/src/api/leditor.ts`, `leditor/src/ui/ribbon_model.ts`, `leditor/src/ui/ribbon_layout.ts`, `leditor/src/api/command_map.ts`
- Est: 5–7d
- Depends: none

8) Field model + Update Fields
- Create field nodes (date/time/page number/refs) and evaluation engine; implement update commands.
- Files: new `leditor/src/extensions/extension_fields/*`, `leditor/src/api/command_map.ts`, `leditor/src/ui/theme.css`
- Est: 6–9d
- Depends: none

9) Data sources + mail merge (minimal)
- Basic data source navigator + merge-field insertion.
- Files: `leditor/src/api/command_map.ts`, new `leditor/src/ui/data_sources/*`
- Est: 6–9d
- Depends: 8

## Phase 4 — Navigator + TOC/Indexes (1–2 weeks)
10) Navigator expansion
- Add non-heading entries (tables, bookmarks, images, footnotes) and jump actions.
- Files: `leditor/src/ui/view_state.ts`
- Est: 3–5d
- Depends: 2

11) TOC options + index/TOA
- Implement TOC options dialog and TOA/index generation.
- Files: `leditor/src/extensions/extension_toc.ts`, `leditor/src/api/command_map.ts`, `leditor/src/ui/ribbon_model.ts`
- Est: 4–6d
- Depends: 2

## Phase 5 — UI Completeness (2–3 weeks)
12) Formatting dialogs (font/paragraph/borders/effects)
- Add dialog UIs + apply to selection.
- Files: `leditor/src/api/command_map.ts`, new `leditor/src/ui/dialogs/*`
- Est: 8–12d
- Depends: 2

13) Proofing UI
- Spellcheck suggestions + language packs.
- Files: `leditor/src/api/command_map.ts`, `leditor/src/ui/spellcheck/*`
- Est: 6–8d
- Depends: none

---

## Recommended sequencing
- Week 1: Tasks 1–2
- Week 2: Task 3
- Weeks 3–4: Tasks 4–6
- Weeks 5–6: Tasks 7–9
- Week 7: Tasks 10–11
- Weeks 8–9: Tasks 12–13

