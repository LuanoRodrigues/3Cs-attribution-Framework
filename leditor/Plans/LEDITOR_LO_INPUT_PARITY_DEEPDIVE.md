# LEditor <-> LibreOffice Input Parity Deep Dive (Selection, Mouse, Shortcuts)

## LibreOffice reference points (event + selection core)
- /tmp/libreoffice-core/sw/source/uibase/docvw/edtwin.cxx (SwEditWin mouse/key input; selection hold on mouseup, multi-click, autoscroll)
- /tmp/libreoffice-core/sw/source/uibase/docvw/edtdd.cxx (drag/drop with selection state)
- /tmp/libreoffice-core/sw/source/uibase/docvw/srcedtw.cxx (source view selection + context menu/wheel)
- /tmp/libreoffice-core/sw/source/uibase/docvw/SidebarTxtControl.cxx (selection change + mouse events)
- /tmp/libreoffice-core/sw/source/uibase/docvw/romenu.cxx (readonly selection mode)

## LEditor entry points (current)
- `leditor/src/ui/a4_layout.ts` (pointerdown/up/click, selectionchange, multi-click selection)
- `leditor/src/ui/pagination/selection_bookmark.ts` (DOM selection bookmark for pagination)
- `leditor/src/utils/selection_snapshot.ts` (snapshot/restore selection for commands)
- `leditor/src/extensions/extension_word_shortcuts.ts` (cursor movement + selection by char/line/para, tables)
- `leditor/src/ui/shortcuts.ts` (global LO-like shortcuts)
- `leditor/src/ui/context_menu.ts` (right click selection hold)
- `leditor/src/api/leditor.ts` (selectionUpdate events)
- `leditor/src/ui/pagination/scheduler.ts` (IME composition events)

## Parity gaps observed

### A) Selection stability
- Issue: selection can collapse on mouseup after drag or multi-click (user report).
- LO: g_bHoldSelection in `edtwin.cxx` defers selection revocation.
- LEditor: pointerup/click failsafes in `a4_layout.ts` can override multi-click or drag selections.
- Missing: explicit "hold selection" gating to avoid collapsing after multi-click/drag; clear only after click completion.

### B) Word/paragraph selection drag
- LO: double-click selects word and drag extends by word; triple-click selects paragraph and drag extends by paragraph.
- LEditor: multi-click selection exists but no word/paragraph drag extension.
- Missing: tracking selection granularity (word/sentence/paragraph) + pointermove expansion.

### C) Margin selection + line select
- LO: click left margin selects line/paragraph; double-click in margin selects paragraph; drag selects multiple lines/paras.
- LEditor: clicks on page chrome are ignored or converted to caret placement.
- Missing: margin hit detection + line/paragraph selection in `a4_layout.ts`.

### D) Auto-scroll during selection drag
- LO: auto-scroll when pointer goes outside viewport while selecting.
- LEditor: no autoscroll during pointer drag.
- Missing: pointermove-based autoscroll in `a4_layout.ts` using `.leditor-doc-shell`.

### E) Block (column) selection
- LO: block selection mode (Alt+drag).
- LEditor: `SelectionMode` has "block" but no implementation.
- Missing: rectangular selection overlay + copy/delete semantics.

### F) Multi-range "add selection"
- LO: add selection mode allows multiple ranges.
- LEditor: `SelectionMode` has "add" but no multi-range support in ProseMirror.
- Missing: plugin for multi-range or "virtual" selection overlay; needs design decision.

### G) Drag and drop selection move/copy
- LO: drag selected text to move/copy.
- LEditor: Safe dropcursor exists; selection drag not explicit.
- Missing: dragstart/drop handlers; confirm if ProseMirror native drag is disabled.

## Implementation plan (ordered)
1) Selection stability guard (1-2d)
- Add selectionHold state in `leditor/src/ui/a4_layout.ts`.
- Gate pointerup + click selection fixes when selectionHold is active.
- Clear hold after a short debounce or after selectionchange.

2) Word/paragraph drag selection (2-3d)
- Add activeGranularity state in `leditor/src/ui/a4_layout.ts`.
- On double/triple click set anchor boundaries; on pointermove (while button down) expand selection to word/paragraph bounds.
- Reuse `selectWordAtPos` / `selectSentenceAtPos` / `selectParagraphAtPos` helpers.

3) Margin selection (1-2d)
- Detect margin clicks in `handleDocumentClick` based on `pageContent` rect.
- Single click in margin -> select paragraph at y-pos.
- Double click in margin -> select paragraph; drag -> select multiple paragraphs.
- Add margin cursor affordance in `leditor/src/ui/theme.css`.

4) Auto-scroll during selection drag (1d)
- In `handleGlobalPointerMove`, if pointerDownActive && pointerMoved, scroll `.leditor-doc-shell` by a speed based on distance outside viewport.
- Keep selection updates in sync (reuse pointermove for word/para drag expansion).

5) Block selection mode (3-6d)
- Create `leditor/src/extensions/extension_block_selection.ts` with plugin state storing rectangles and decoration highlights.
- Bind Alt+drag to enter block mode (via `extension_word_shortcuts.ts` or `a4_layout.ts`).
- Implement copy/delete for block selection.

6) Add selection mode (multi-range) (3-6d)
- Decide approach: ProseMirror does not support multiple native ranges.
- Implement virtual selections using decorations; commands operate over ranges.

7) Selection DnD (1-3d)
- Ensure dragstart on selection, drop moves/copies text.
- Check `leditor/src/extensions/extension_dropcursor_safe.ts` integration.

## Validation checklist
- Double click selects word; drag extends by word.
- Triple click selects paragraph; drag extends by paragraph.
- Drag selection outside viewport auto-scrolls.
- Selection persists after mouseup (no collapse).
- Margin click selects paragraph; margin drag selects multiple.
- No regressions in footnote/header/footer modes.
