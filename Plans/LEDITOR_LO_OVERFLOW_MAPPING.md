# LibreOffice Writer → LEditor Overflow Mapping

## Scope
Map LibreOffice Writer’s overflow/page-flow mechanisms to LEditor’s pagination/selection logic and note parity work applied.

## LO: Text overflow / line fit
- LO implementation
  - `sw/source/core/text/frmform.cxx`: `SwTextFrame::SplitFrame`, `SwTextFrame::CalcFollow`
  - `sw/source/core/layout/flowfrm.cxx`: `SwFlowFrame::MoveFwd`
  - `sw/source/core/layout/calcmove.cxx`: `SwContentFrame::MakeAll` (calls MoveFwd/MoveBwd)
- LEditor analog
  - `leditor/src/extensions/extension_page.ts`: `findLineSplitPos`, `paginateView`, `attemptManualPageSplit`
  - `leditor/src/extensions/extension_page.ts`: line rect collection + widow/orphan guards
- Parity notes
  - Line-level splitting now works for paragraphs, list items, blockquotes, headings, and pre blocks.

## LO: Backward flow / join when content shrinks
- LO implementation
  - `sw/source/core/text/frmform.cxx`: `SwTextFrame::JoinFrame`
  - `sw/source/core/layout/flowfrm.cxx`: `SwFlowFrame::MoveBwd`
- LEditor analog
  - `leditor/src/extensions/extension_page.ts`: join logic in `paginateView` + `attemptManualPageJoin`
  - `leditor/src/extensions/extension_page.ts`: Backspace at page start joins/jumps backward (`handlePageBoundaryBackspace`)

## LO: Enter at last line → next page
- LO implementation
  - Paragraph split + follow calc (`SplitFrame`, `CalcFollow`) and forward flow (`MoveFwd`).
- LEditor analog
  - `leditor/src/extensions/extension_page.ts`: `handlePageBoundaryEnter` forces a split and page split at boundary.

## LO: Footnote dead line (body vs footnote area)
- LO implementation
  - `sw/source/core/inc/ftnboss.hxx`: `SetFootnoteDeadLine`, max height
  - `sw/source/core/text/txtftn.cxx`: `SwTextFrame::ConnectFootnote` uses deadline + `RearrangeFootnotes`
  - `sw/source/core/layout/ftnfrm.cxx`: `SwFootnoteContFrame::GrowFrame` enforces max
- LEditor analog
  - `leditor/src/ui/a4_layout.ts`: footnote measurement → CSS vars `--page-footnote-height`, `--effective-margin-bottom`
  - `leditor/src/extensions/extension_page.ts`: `getContentMetrics` uses the effective bottom to compute usable height

## LO: Tables across pages
- LO implementation
  - `sw/source/core/layout/tabfrm.cxx`: `MoveFwd`, `MoveBwd`, table follow handling
- LEditor analog
  - `leditor/src/extensions/extension_page.ts`: table row split (`findTableSplitPos` + `splitTableNode`)
  - Repeats header row on split when the first row uses `tableHeader` cells.

## Column flow (LO columns)
- LO implementation
  - `sw/source/core/layout/flowfrm.cxx`: column-aware `MoveFwd`/`MoveBwd`
- LEditor analog
  - `leditor/src/ui/a4_layout.ts`: CSS `column-count` + `column-gap`
  - Pagination remains page-level; column-aware flow relies on CSS layout.

## Applied parity work
- Page-boundary Backspace/Enter behaviors added.
- Line-level overflow splitting expanded to headings/lists/blockquote.
- Table row split + header row repetition on split.
- Keep‑together CSS for tables/figures/images.
