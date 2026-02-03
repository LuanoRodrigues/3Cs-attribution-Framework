# LEditor vs LibreOffice Gap Scan (file-level)

This is a code-scan based inventory of LEditor implementation gaps relative to LibreOffice Writer features. It is grounded in file-level evidence (placeholders, stubs, configuration flags, and missing commands) and grouped by feature area. LibreOffice references are taken from the local checkout at `/tmp/libreoffice-core`.

## Scan inputs
- Placeholder/NYI stubs: `leditor/src/api/command_map.ts`, `leditor/src/extensions/extension_word_shortcuts.ts`
- Page layout + pagination: `leditor/src/extensions/extension_page.ts`, `leditor/src/extensions/extension_page_layout.ts`, `leditor/src/ui/pagination/*`, `leditor/src/ui/a4_layout.ts`
- Styles/Navigator: `leditor/src/ui/styles_pane.ts`, `leditor/src/ui/view_state.ts`, `leditor/src/extensions/extension_style_store.ts`
- Tables: `leditor/src/api/leditor.ts`, `leditor/src/extensions/extension_word_shortcuts.ts`
- Footnotes/Endnotes: `leditor/src/extensions/extension_footnote.ts`, `leditor/src/extensions/extension_footnote_body.ts`, `leditor/src/uipagination/footnotes/*`, `leditor/src/ui/a4_layout.ts`
- TOC: `leditor/src/extensions/extension_toc.ts`, `leditor/src/api/command_map.ts`

---

## 1) Page setup, paper size, and page styles

**LibreOffice reference files**
- Paper constants + default paper by locale:
  - `/tmp/libreoffice-core/include/i18nutil/paper.hxx`
  - `/tmp/libreoffice-core/i18nutil/source/utility/paper.cxx`
- Paper size lookup:
  - `/tmp/libreoffice-core/include/editeng/paperinf.hxx`
  - `/tmp/libreoffice-core/editeng/source/items/paperinf.cxx`
- Writer defaults + style pool:
  - `/tmp/libreoffice-core/sw/source/core/doc/docdesc.cxx`
  - `/tmp/libreoffice-core/sw/source/core/doc/DocumentStylePoolManager.cxx`
- Page styles UI:
  - `/tmp/libreoffice-core/sw/source/uibase/sidebar/PageStylesPanel.cxx`

**LEditor entry points**
- `leditor/src/extensions/extension_page_layout.ts` (doc attrs: pageSizeId, margins, columns, lineNumbering, hyphenation)
- `leditor/src/ui/layout_settings.ts`
- `leditor/src/ui/pagination/document_layout_state.ts`
- `leditor/src/extensions/extension_page.ts`
- `leditor/src/ui/a4_layout.ts`

**Missing vs LibreOffice**
- Locale/system default paper size selection (A4 vs Letter) and full paper catalog (LO has Paper enum + GetDefaultPaperSize). LEditor hardcodes `pageSizeId: "a4"` without locale logic.
- Printer-aware paper sizing and paper-size mapping tables (LO uses SvxPaperInfo). No equivalent registry.
- Page styles as first-class objects (per-style size/margins/header/footer variants, style inheritance). LEditor keeps page layout on doc attrs only.
- Per-section page style changes tied to page break types (continuous/even/odd/next). Commands exist (`InsertSectionBreak*`) but no style-application layer.

---

## 2) Overflow / pagination / reflow

**LibreOffice reference files**
- Text frame split and flow:
  - `/tmp/libreoffice-core/sw/source/core/text/frmform.cxx`
  - `/tmp/libreoffice-core/sw/source/core/layout/flowfrm.cxx`
  - `/tmp/libreoffice-core/sw/source/core/layout/calcmove.cxx`
- Line formatting and line-breaking:
  - `/tmp/libreoffice-core/sw/source/core/text/itrform2.cxx`
  - `/tmp/libreoffice-core/sw/source/core/text/portxt.cxx`
- Widow/orphan + hyphenation:
  - `/tmp/libreoffice-core/sw/source/core/text/widorp.cxx`
  - `/tmp/libreoffice-core/sw/source/core/text/txthyph.cxx`
- Table flow across pages:
  - `/tmp/libreoffice-core/sw/source/core/layout/tabfrm.cxx`

**LEditor entry points**
- `leditor/src/extensions/extension_page.ts` (DOM-based page splitting)
- `leditor/src/ui/pagination/paginator.ts`
- `leditor/src/ui/pagination/inline_split.ts`
- `leditor/src/ui/a4_layout.ts`

**Missing vs LibreOffice**
- Frame-based text flow (master/follow frames) and full keep/flow engine (LO: SwFlowFrame/MoveFwd/MoveBwd). LEditor uses DOM height measurement + split markers.
- Widow/orphan enforcement (CSS only: `widows`/`orphans` in `leditor/src/ui/a4_layout.ts` and `leditor/src/ui/print_export_styles.ts`, no actual layout control).
- Hyphenation engine (LEditor only stores `hyphenation` attr; no line breaker).
- Keep-with-next per paragraph style (LEditor has limited heading-based keep logic in `extension_page.ts`).
- Table row splitting rules comparable to LO (keep header row, split/flow rules).
- Anchored object avoidance/flow impact is not modeled.

---

## 3) Footnotes / endnotes

**LibreOffice reference files**
- Insert footnote + model:
  - `/tmp/libreoffice-core/sw/source/uibase/wrtsh/wrtsh1.cxx`
  - `/tmp/libreoffice-core/sw/source/core/txtnode/atrftn.cxx`
- Superscript marker portion:
  - `/tmp/libreoffice-core/sw/source/core/text/txtftn.cxx`
  - `/tmp/libreoffice-core/sw/source/core/text/porftn.hxx`
- Footnote area layout:
  - `/tmp/libreoffice-core/sw/source/core/layout/ftnfrm.cxx`
  - `/tmp/libreoffice-core/sw/source/core/inc/ftnboss.hxx`

**LEditor entry points**
- `leditor/src/extensions/extension_footnote.ts`
- `leditor/src/extensions/extension_footnote_body.ts`
- `leditor/src/uipagination/footnotes/*`
- `leditor/src/ui/a4_layout.ts`
- `leditor/src/api/command_map.ts` (`footnote.options.openDialog` placeholder)

**Missing vs LibreOffice**
- Footnote options dialog (placeholder in `leditor/src/api/command_map.ts`).
- Full footnote style configuration (separator line, spacing, numbering formats) is stored in doc attrs but lacks UI.
- Per-section or per-page footnote numbering controls (data model exists, no UI or section scoping).

---

## 4) Styles (paragraph/character/page)

**LibreOffice reference files**
- Page/paragraph/character styles UI:
  - `/tmp/libreoffice-core/sw/source/uibase/sidebar/PageStylesPanel.cxx`
  - `/tmp/libreoffice-core/sw/source/uibase/sidebar/StylePresetsPanel.cxx`
- Style name mapping + utilities:
  - `/tmp/libreoffice-core/sw/source/uibase/utlui/uitool.cxx`
- Style pool defaults:
  - `/tmp/libreoffice-core/sw/source/core/doc/DocumentStylePoolManager.cxx`

**LEditor entry points**
- `leditor/src/extensions/extension_style_store.ts` (empty)
- `leditor/src/ui/styles_pane.ts` (minimal style list)
- `leditor/src/api/command_map.ts` (`styles.manage`, `styles.options`, `styles.io` placeholders)

**Missing vs LibreOffice**
- Style storage/inheritance system (style store is a no-op).
- Manage Styles UI (placeholder commands).
- Import/export styles and style sets (placeholders in `command_map.ts`).
- Page style family (distinct from paragraph/character styles) and style sets.

---

## 5) Navigator

**LibreOffice reference files**
- Navigator panel + content tree:
  - `/tmp/libreoffice-core/sw/source/uibase/utlui/navipi.cxx`
  - `/tmp/libreoffice-core/sw/source/uibase/utlui/content.cxx`
  - `/tmp/libreoffice-core/sw/source/uibase/utlui/glbltree.cxx`

**LEditor entry points**
- `leditor/src/ui/view_state.ts` (Navigator panel uses headings only)
- `leditor/src/ui/shortcuts.ts` (F5, Ctrl+Shift+F10)

**Missing vs LibreOffice**
- Navigator content types beyond headings (tables, bookmarks, images, sections, indexes, footnotes).
- Global document outline management (drag/reorder, outline levels, entries from styles).

---

## 6) Fields, data sources, and mail merge

**LibreOffice reference files**
- Field dialog/manager:
  - `/tmp/libreoffice-core/sw/source/uibase/fldui/fldmgr.cxx`
  - `/tmp/libreoffice-core/sw/source/uibase/fldui/fldwrap.cxx`
- Field implementations:
  - `/tmp/libreoffice-core/sw/source/core/fields`
- Mail merge + data sources:
  - `/tmp/libreoffice-core/sw/source/uibase/dbui/dbmgr.cxx`
  - `/tmp/libreoffice-core/sw/source/uibase/dbui/dbtree.cxx`
  - `/tmp/libreoffice-core/sw/source/uibase/dbui/mailmergehelper.cxx`

**LEditor entry points**
- `leditor/src/api/command_map.ts` (`InsertField` inserts bracketed text; `ToggleFieldCodes`/`FieldShadingToggle` are CSS)
- `leditor/src/ui/theme.css` (field shading styles)

**Missing vs LibreOffice**
- Real field model (date/time, page number, references) and field evaluation.
- Update Fields / Update Input Fields implementation (placeholders).
- Data source navigator + mail merge UI (placeholders).

---

## 7) Tables

**LibreOffice reference files**
- Table core:
  - `/tmp/libreoffice-core/sw/source/core/table`
  - `/tmp/libreoffice-core/sw/source/core/layout/tabfrm.cxx`
- Table UI:
  - `/tmp/libreoffice-core/sw/source/uibase/table`

**LEditor entry points**
- `leditor/src/api/leditor.ts` (`Table.configure({ resizable: false })`)
- `leditor/src/extensions/extension_word_shortcuts.ts` (resize keys are placeholders)
- `leditor/src/api/command_map.ts` (basic insert/row/col add/delete/merge)
- `leditor/src/ui/ribbon_model.ts` (commands for draw/convert/quick tables but no handlers)

**Missing vs LibreOffice**
- Column/row resize and drag handles (explicitly disabled, placeholder shortcuts).
- Table properties dialog (borders, spacing, alignment) not implemented.
- Draw Table / Convert Text to Table / Quick Tables (ribbon commands have no handlers).
- Table styles and autoformat.

---

## 8) TOC / Indexes / Table of Authorities

**LibreOffice reference files**
- TOC/Index engines:
  - `/tmp/libreoffice-core/sw/source/core/tox`
- TOC/Index UI:
  - `/tmp/libreoffice-core/sw/source/uibase/index`
- Authority fields (TOA):
  - `/tmp/libreoffice-core/sw/source/uibase/fldui/fldmgr.cxx`

**LEditor entry points**
- `leditor/src/extensions/extension_toc.ts` (TOC node view)
- `leditor/src/api/command_map.ts` (Insert/Update/Remove TOC; "Do not show in TOC" not supported)
- `leditor/src/ui/ribbon_model.ts` (TOA/Index controls)

**Missing vs LibreOffice**
- TOC options dialog (no handler for `toc.options.openDialog`).
- Excluding headings from TOC (`Do not show in TOC` is not supported).
- Table of Authorities commands not implemented (ribbon exists, no `toa.*` handlers).
- Index/table-of-figures generation not implemented.

---

## 9) Selection / object selection

**LibreOffice reference files**
- Writer selection + object handling:
  - `/tmp/libreoffice-core/sw/source/core/draw`
  - `/tmp/libreoffice-core/sw/source/uibase/docvw`

**LEditor entry points**
- `leditor/src/editor/input_modes.ts` (selection modes tracked, no multi-range)
- `leditor/src/extensions/extension_word_shortcuts.ts` (F8 modes; block/add selection placeholders)
- `leditor/src/api/command_map.ts` (`SelectObjects`, `SelectSimilarFormatting` placeholders)

**Missing vs LibreOffice**
- True multi-range and block selection.
- Object selection mode (images/frames/shapes).
- Select similar formatting.

---

## 10) Formatting dialogs / text effects

**LibreOffice reference files**
- Character/paragraph formatting dialogs:
  - `/tmp/libreoffice-core/sw/source/uibase/chrdlg`
  - `/tmp/libreoffice-core/sw/source/uibase/frmdlg`
  - `/tmp/libreoffice-core/sw/source/uibase/dialog`

**LEditor entry points**
- `leditor/src/api/command_map.ts` placeholders: Font Options, Text Effects, Underline Color, Paragraph Options/Spacing/Borders, Clipboard Options

**Missing vs LibreOffice**
- All dialog-level formatting UIs (Font, Paragraph, Borders, Effects, Clipboard) are placeholders.

---

## 11) Proofing

**LibreOffice reference files**
- Linguistics/proofing:
  - `/tmp/libreoffice-core/sw/source/uibase/lingu`

**LEditor entry points**
- `leditor/src/api/command_map.ts` (`Spelling`, `Thesaurus`, `ProofingPanel`) use lightweight local helpers

**Missing vs LibreOffice**
- Full dictionary-based spellcheck/thesaurus UI (suggestions, language packs, grammar rules).

---

## Summary of highest-impact gaps
- Page styles + locale-based paper size selection.
- Real layout controls: widow/orphan, hyphenation, keep rules, object flow.
- Styles system (store/inheritance/manage/import/export).
- Fields + mail merge.
- Table resizing and table property dialogs.
- TOA/Index generation.
- Multi-range/block selection + object selection.

---

## Prioritized execution roadmap

**Phase 1: Foundation (layout + styles core)**
- Add paper-size registry + locale default selection (A4/Letter) and expose in layout settings.
- Implement style store with inheritance and persistence (paragraph/character/page styles).
- Wire basic page styles (size/margins/header/footer variants) + apply via section breaks.

**Phase 2: Layout correctness**
- Widow/orphan controls + keep-with-next at paragraph style level.
- Basic hyphenation (dictionary-backed or soft-hyphen insertion pass).
- Table split rules with header repeat on page breaks.

**Phase 3: Tables + fields**
- Enable table resizing (column/row drag handles) and properties dialog.
- Implement field model (date/time/page number/etc) + Update Fields.
- Add Data Source navigator + minimal mail-merge merge‑fields.

**Phase 4: Navigator + TOC/Indexes**
- Expand Navigator beyond headings (tables, bookmarks, images, sections, footnotes).
- Implement TOC options (exclude from TOC, styles/levels mapping).
- Add TOA/Index generation using authority fields.

**Phase 5: UI completeness**
- Implement formatting dialogs (font/paragraph/borders/effects).
- Proofing UI with suggestions and language packs.

