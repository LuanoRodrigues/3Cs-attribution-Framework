# A4 Integration Test Plan

Use this checklist to validate phases 11-15 end-to-end. Load `docs/test_documents/a4_integration_sample.json` via the local file loader for the quick smoke checks listed here, then, in the final run, load `docs/test_documents/a4_integration_full.json` to stress-test multiple sections, headers/footers, footnotes, columns, tables, images, manual breaks, and zoom-driven grid layouts before closing Phase 15.

## Required checks
- Margins: toggle `Ctrl+Shift+M` to show the dashed margin box and confirm text sits inside the guide on every page.
- Pagination: insert additional paragraphs until at least three pages render; confirm page numbers and page breaks stay tied to the right pages as content flows.
- Break controls: tables/images stay intact (no split rows); Heading 1 starts a new page; widows/orphans keep at least two lines together.
- Footnotes: insert a footnote near a page end; verify the note stays on the same page and renumbers after edits.
- Print/PDF: run Export PDF from the command palette; verify `@page` size matches A4 and margins mirror on all pages.
- Theme: toggle UI theme with `Ctrl+Shift+D` and the page-surface toggle with `Ctrl+Shift+P`; ensure the page background stays white until deliberately switched to `page-surface-dark`.
- Performance: scroll and type through the multi-page doc; pagination should stay smooth without visible jumps.

## Optional stress cases
- Add an image above the table and confirm it is not split across pages.
- Add a second page break in the middle of the table to confirm manual breaks override auto pagination.
- Switch zoom/view presets and confirm layouts remain centered.
