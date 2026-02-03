# LibreOffice Writer Core Mapping Plan (A4, Overflow, Footnotes)

## Inputs / scope
- LibreOffice core checkout: `/tmp/libreoffice-core`
- LEditor repo: `/home/pantera/projects/TEIA/leditor`
- Topics (from your questions):
  1) Writer core A4/page setup
  2) Text overflow / reflow
  3) Footnote insertion + footnote area interaction with body text

## Goal
For each topic, produce:
- LO file/entry points (paths)
- LEditor equivalents (paths)
- Gap list (what LO does that LEditor lacks)
- Implementation tasks to close gaps

---

## Topic 1: Writer core A4/page setup

### LibreOffice entry points (A4 + default page size)
- Paper enum / A4 constant:
  - `/tmp/libreoffice-core/include/i18nutil/paper.hxx` (PAPER_A4)
- Default paper by locale/system:
  - `/tmp/libreoffice-core/i18nutil/source/utility/paper.cxx` (GetDefaultPaperSize)
- Paper size conversion / lookup:
  - `/tmp/libreoffice-core/include/editeng/paperinf.hxx`
  - `/tmp/libreoffice-core/editeng/source/items/paperinf.cxx` (SvxPaperInfo::GetPaperSize, GetDefaultPaperSize)
- Writer default page size for new docs:
  - `/tmp/libreoffice-core/sw/source/core/doc/docdesc.cxx` (uses GetDefaultPaperSize)
- Page style defaults / pool:
  - `/tmp/libreoffice-core/sw/source/core/doc/DocumentStylePoolManager.cxx`
- Core page/layout frames (page model):
  - `/tmp/libreoffice-core/sw/source/core/layout/wsfrm.cxx`
  - `/tmp/libreoffice-core/sw/source/core/layout/pagechg.cxx`

### LEditor mapping (A4/page setup)
- Page surface + sizing + margins:
  - `leditor/src/ui/a4_layout.ts`
  - `leditor/src/ui/layout_settings.ts`
  - `leditor/src/ui/pagination/document_layout_state.ts`
- Pagination + page nodes:
  - `leditor/src/extensions/extension_page.ts`
  - `leditor/src/extensions/extension_page_break.ts`
  - `leditor/src/extensions/extension_page_layout.ts`
  - `leditor/src/ui/pagination/paginator.ts`
  - `leditor/src/ui/pagination/page_metrics.ts`
  - `leditor/src/ui/pagination/layout_spec.ts`
  - `leditor/src/ui/pagination/index.ts`

### Missing vs LibreOffice (A4/page setup)
- Locale/system default paper size selection (A4 vs Letter) tied to OS/locale.
- Full paper size catalog (Paper enum) and printer-aware size overrides.
- Page styles as first-class objects (per-section/page style, style inheritance).
- First-page / left-right page style variants.
- Per-section page size and margin changes tied to page styles.
- Page style UI / manage style sets (not just commands).
- Page format metadata persistence (LO keeps it in style pools).

### Planned implementation tasks
1) Add paper-size registry + locale default in LEditor (A4/Letter, ISO sizes).
2) Extend layout state to track page style name + style properties.
3) Add page-style node/attributes (page size, margins, header/footer flags).
4) Expose style UI for page styles (basic styles list + apply).
5) Add per-section page style switching (page break with style change).

---

## Topic 2: Text overflow / reflow

### LibreOffice entry points (overflow, flow, splitting)
- Text frame split and follow creation:
  - `/tmp/libreoffice-core/sw/source/core/text/frmform.cxx` (SwTextFrame::SplitFrame)
- Flow / move forward/backward across pages/columns:
  - `/tmp/libreoffice-core/sw/source/core/layout/flowfrm.cxx` (MoveFwd/MoveBwd)
  - `/tmp/libreoffice-core/sw/source/core/layout/calcmove.cxx`
- Line formatting / underflow / portioning:
  - `/tmp/libreoffice-core/sw/source/core/text/itrform2.cxx`
  - `/tmp/libreoffice-core/sw/source/core/text/porlay.cxx`
  - `/tmp/libreoffice-core/sw/source/core/text/portxt.cxx`
- Widow/orphan control:
  - `/tmp/libreoffice-core/sw/source/core/text/widorp.cxx`
- Hyphenation:
  - `/tmp/libreoffice-core/sw/source/core/text/txthyph.cxx`
- Table flow (page split of tables):
  - `/tmp/libreoffice-core/sw/source/core/layout/tabfrm.cxx`

### LEditor mapping (overflow / pagination)
- Pagination engine and view reflow:
  - `leditor/src/extensions/extension_page.ts`
  - `leditor/src/ui/a4_layout.ts`
  - `leditor/src/ui/pagination/paginator.ts`
  - `leditor/src/ui/pagination/inline_split.ts`
  - `leditor/src/ui/pagination/selection_bookmark.ts`
  - `leditor/src/ui/pagination/scheduler.ts`

### Missing vs LibreOffice (overflow)
- Real text-frame model with master/follow frames (per-paragraph flow).
- Widow/orphan controls at paragraph level.
- Hyphenation / line-breaking engine (currently delegated to browser layout).
- Keep-with-next/keep-together rules across page boundaries.
- Table row/section splitting rules comparable to Writer.
- Object avoidance / anchored object flow impact.
- Column balancing logic.

### Planned implementation tasks
1) Add paragraph-level pagination constraints (widow/orphan counts).
2) Add keep-with-next / keep-together attributes on paragraphs/tables.
3) Improve table splitting across pages (row-level flow + header repeat).
4) Add hyphenation option with a dictionary-backed breaker (best-effort).
5) Add anchored object avoidance (basic exclusion zones per page).

---

## Topic 3: Footnotes (insertion, superscript marker, footnote area)

### LibreOffice entry points (footnotes)
- Insert footnote at cursor:
  - `/tmp/libreoffice-core/sw/source/uibase/wrtsh/wrtsh1.cxx` (SwWrtShell::InsertFootnote)
- Footnote attribute model:
  - `/tmp/libreoffice-core/sw/source/core/txtnode/atrftn.cxx` (SwFormatFootnote)
- Superscript marker portion:
  - `/tmp/libreoffice-core/sw/source/core/text/porftn.hxx` (SwFootnotePortion)
  - `/tmp/libreoffice-core/sw/source/core/text/txtftn.cxx` (NewFootnotePortion)
- Footnote area layout + reflow:
  - `/tmp/libreoffice-core/sw/source/core/layout/ftnfrm.cxx` (SwFootnoteBossFrame, AppendFootnote, RearrangeFootnotes)
  - `/tmp/libreoffice-core/sw/source/core/inc/ftnboss.hxx`

### LEditor mapping (footnotes)
- Footnote node/marker + ids:
  - `leditor/src/extensions/extension_footnote.ts`
  - `leditor/src/uipagination/footnotes/footnote_id_generator.ts`
- Footnote body container nodes:
  - `leditor/src/extensions/extension_footnote_body.ts`
- Footnote pagination + numbering:
  - `leditor/src/uipagination/footnotes/registry.ts`
  - `leditor/src/uipagination/footnotes/paginate_with_footnotes.ts`
- Footnote editing surface:
  - `leditor/src/ui/a4_layout.ts`
- Footnote area rendering per page:
  - `leditor/src/extensions/extension_page.ts`
  - `leditor/src/ui/print_export_styles.ts`

### Missing vs LibreOffice (footnotes)
- Full footnote boss frame logic (per-page/column footnote continuation).
- Automatic footnote overflow to next page with continuation labels.
- Endnotes page model and separate endnote area.
- Per-section footnote numbering (restart per page/section).
- Footnote separator styles + line rules per page style.
- Rich footnote formatting styles and style inheritance.

### Planned implementation tasks
1) Add footnote continuation support across pages/columns.
2) Add endnote area (document or section end).
3) Add numbering scope (document/section/page) and restart rules.
4) Add footnote styles (separator, font, spacing) tied to page styles.
5) Add UI for footnote formatting options.

---

## Execution checklist (no gating)
- [x] Enumerate LibreOffice entry points for each topic (paths above).
- [x] Map equivalent LEditor files (paths above).
- [x] List missing functionality vs LO.
- [x] Provide next-step implementation task list.

