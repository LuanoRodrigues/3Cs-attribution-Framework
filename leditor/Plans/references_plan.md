# Plans/references_implementation_plan.md — REFERENCES Tab Implementation Plan (Electron Ribbon)

## Goal
Implement the **REFERENCES** ribbon tab end-to-end (layout + configs + command wiring + state binding) in the Electron renderer, using the existing config-driven ribbon architecture and TipTap/ProseMirror command dispatch so that every control renders and performs its intended editor action (or deterministically disables when unsupported).

## Success Criteria
1. **UI renders with Word-like fidelity**
   - REFERENCES tab appears in the TabStrip and activates deterministically.
   - Group order is: TOC, Footnotes, Research, Citations & Bibliography, Captions, Index, Table of Authorities.
   - Large/medium/small control tiers render correctly and group separators match ribbon rules.

2. **All controls are wired**
   - Clicking any control dispatches exactly one `command.id` with the defined args.
   - Split buttons execute primary command on main click; dropdown opens menu.
   - Toggle buttons reflect editor state (`aria-pressed=true/false/mixed` where applicable).

3. **Overlay behavior is correct**
   - Menus, galleries, pickers, flyouts, and dialogs open via portal (no clipping).
   - Z-index layering is stable: ribbon surface < popovers/menus < dialogs.

4. **Editor integration is correct**
   - Content mutations occur via TipTap/ProseMirror transactions only.
   - Canonical document is schema JSON; any HTML/MD import/export remains derived.

5. **Deterministic collapse**
   - Stage B/C collapse follows explicit `collapse` directives and priorities.
   - No heuristic hiding/reordering.

---

## Constraints
- Fail-fast: missing config keys, unknown `control.type`, unknown `command.id`, or missing icon keys must throw (no fallbacks).
- Do not implement editor features via raw DOM/contenteditable hacks; use TipTap commands/transactions.
- Offline-first: no required network calls for core functionality. Research features that imply network must be optional and/or disabled by state.
- All overlays must use the ribbon portal container (e.g., `#ribbon-portal`).
- No silent coercions or “best effort” conversions that hide schema mismatches.

---

## Scope (Exact File List)
This plan only changes:
1. `Plans/references_implementation_plan.md`
2. `references.json`
3. `ribbon.json`
4. `layout.json`
5. `ribbon.js`
6. `ribbon.css`
7. `editor/commands/references_commands.js` (or equivalent command module path in the repo)
8. `editor/state/references_state.js` (or equivalent state selector module path)
9. `editor/extensions/references/*` (only if missing required TipTap/PM extensions; otherwise do not add)

If any of these paths do not exist, execution must stop at that step and record FAIL in Progress.

---

## Steps (Numbered; with File Paths and Target Symbols)

### Phase 1 — Config + UI render (Stage A)
1) **Create/Update `references.json`**
   - **File:** `references.json`
   - **Targets:** `tabId:"references"`, `groups[]`, `controls[]`, `menu[]`, `collapse`
   - Ensure:
     - Control IDs and command IDs match what the dispatcher can resolve.
     - Menus have explicit separators.
     - Stage A layout primitives are explicit (`columns`, `grid`, etc.).
   - Outcome: REFERENCES tab config is complete and loadable.

2) **Register REFERENCES in the ribbon tab registry**
   - **Files:** `ribbon.json`, `ribbon.js`
   - **Targets:** tab registry list; tab loader mapping from `tabId -> json`
   - Ensure:
     - `tabId:"references"` exists in `ribbon.json`
     - loader resolves `references.json` deterministically (no fallback to other tabs)

3) **Confirm group separators and sizing tokens**
   - **File:** `ribbon.css`
   - **Targets:** group container, separator styling, icon sizing tiers
   - Ensure:
     - group separators render between groups only
     - icon sizing is enforced:
       - `--r-icon-sm:16px`, `--r-icon-lg:20px`
     - large tile layout matches Word-like “icon above label”

**Phase 1 exit criteria**
- REFERENCES tab renders at wide width (Stage A) without errors.

---

### Phase 2 — Command wiring (dispatcher → TipTap/PM)
4) **Add/confirm command registry entries for REFERENCES commands**
   - **File:** `editor/commands/references_commands.js` (or repo-equivalent)
   - **Targets:** exported command map; each `command.id` referenced by `references.json`
   - Implement commands as thin wrappers around TipTap/PM transactions:
     - `toc.insert.default`
     - `toc.insert.template`
     - `toc.insert.custom.openDialog`
     - `toc.update.default`, `toc.update`
     - `toc.addText.setLevel`
     - `footnote.insert`, `endnote.insert`
     - `footnote.navigate`, `footnote.showNotes.toggle`
     - `citation.insert.openDialog`, `citation.source.add.openDialog`, `citation.placeholder.add.openDialog`
     - `citation.sources.manage.openDialog`
     - `citation.style.set`, `citation.csl.import.openDialog`, `citation.csl.manage.openDialog`
     - `bibliography.insert.default`, `bibliography.insert`, `bibliography.insert.field`
     - `bibliography.export.*.openDialog`
     - `citation.citeKey.*`, `citation.inspect.openPane`
     - `caption.insert.openDialog`, `caption.tableOfFigures.*`, `caption.crossReference.openDialog`, `caption.label.setDefault`
     - `index.mark.openDialog`, `index.insert.openDialog`, `index.automark.openDialog`, `index.preview.toggle`
     - `toa.mark.openDialog`, `toa.insert.openDialog`, `toa.update`, `toa.export.*.openDialog`
   - For “openDialog/openPane” commands:
     - wire to the app’s modal/pane system (not `window.prompt`)
     - ensure dialog state is stored in app UI state, not in the document.

5) **Wire ribbon dispatcher to command registry**
   - **File:** `ribbon.js`
   - **Targets:** dispatch function that maps `command.id` to command implementation
   - Ensure:
     - Dispatcher passes `{ editor, uiState, selectionContext }` consistently
     - SplitButton main click dispatches primary command; arrow click opens menu (no ambiguity)

**Phase 2 exit criteria**
- Every control click produces a command dispatch and does not throw “unknown command” for any defined control.

---

### Phase 3 — TipTap/ProseMirror capabilities (extensions)
6) **Ensure schema supports required node/mark types**
   - **Files:** `editor/extensions/references/*` (only if missing), or existing schema extension files
   - **Targets:** footnote/endnote nodes, citation nodes/marks, bibliography block, caption blocks, index entries, TOC placeholder node
   - Implement (or confirm existing):
     - TOC represented as a schema node (e.g., `toc_block`) with attrs (templateId, depth, etc.)
     - footnote/endnote as node types or marks with referenced content
     - citation as inline node/mark with sourceId/citeKey attrs
     - bibliography as block node with style/template attrs
   - If an entire feature cannot be supported with existing schema:
     - do not remove UI; instead, disable controls via state selectors (next phase)

**Phase 3 exit criteria**
- Commands that mutate the doc execute via transactions and produce valid schema JSON.

---

### Phase 4 — State binding + enable/disable correctness
7) **Implement REFERENCES state selectors**
   - **File:** `editor/state/references_state.js` (or repo-equivalent)
   - **Targets:** bindings used by `references.json` and enablement rules
   - Provide:
     - `canInsert` (global)
     - `selectionContext` (inFootnote, inCaption, inCitation, etc.)
     - `citationStyle` current value
     - `notesPaneOpen`, `indexPreviewOpen` booleans
     - capability flags derived from schema/extension availability (fail-fast if referenced binding missing)

8) **Bind ribbon controls to state**
   - **Files:** `ribbon.js`, `references.json`
   - **Targets:** `state.binding`, `enabledWhen`, tri-state rendering if needed
   - Ensure:
     - Toggle buttons reflect binding values
     - Controls disable deterministically when unsupported (e.g., `toa.*` if TOA not implemented)
     - No control disappears without an explicit collapse directive

**Phase 4 exit criteria**
- Toggle states reflect editor/UI state; unsupported controls disable consistently.

---

### Phase 5 — Overlays (menus, galleries, dialogs) and portal
9) **Implement/confirm portal overlays for REFERENCES**
   - **Files:** `layout.json`, `ribbon.js`, `ribbon.css`
   - **Targets:** menu components, gallery component, dialog/pane mounting into portal
   - Implement/confirm:
     - TOC gallery popover (`.rtocGallery`)
     - Style chooser popover for citations (if presented as gallery)
     - Source Manager modal/pane (`.rsourceMgr`)
     - Citation Inspector pane (`.rcitePane`)
   - Ensure z-index tiering is consistent and tested.

**Phase 5 exit criteria**
- All overlays open without clipping and close restoring focus to invoker.

---

### Phase 6 — Collapse behavior (Stage B/C) is deterministic
10) **Encode Stage B rules**
   - **File:** `references.json`
   - **Targets:** `collapse.B` per control; `collapsePriority` per group
   - Ensure:
     - “Move to menu of” rules match the plan (e.g., TOC Add Text into TOC menu)
     - Priorities match the deterministic table (no heuristics)

11) **Enable Stage C group flyouts**
   - **Files:** `layout.json`, `ribbon.js`
   - **Targets:** Stage C breakpoints; group-button flyout renderer
   - Ensure:
     - Flyout renders Stage A layout for that group

**Phase 6 exit criteria**
- Resizing across thresholds always produces identical outcomes.

---

## Risk Notes
- **Schema mismatch** (commands produce invalid nodes): detected by ProseMirror transaction errors and failing tests.
- **Unknown command IDs** due to config drift: detected by dispatcher throwing.
- **Overlay clipping** due to missing portal usage: detected by opening all dropdowns/galleries at 1024px width.
- **Non-deterministic collapse** due to implicit layout wrapping: detected by repeated resize tests with identical results expected.
- **Offline constraint** for research features: if any network call exists, it must be optional and default-disabled.

---

## Validation (Commands Codex Will Run)
1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. Electron dev run script (repo-specific) and perform deterministic UI checks:
   - Open REFERENCES tab
   - Click each control once; verify no “unknown command” crash
   - Open each dropdown/gallery; verify no clipping and correct focus return
   - Resize window across Stage A/B/C thresholds and verify deterministic collapse

If any command is missing, record FAIL and stop at that point.

---

## Rollback
To revert all changes:
1. `git restore --staged .`
2. `git restore .`
3. `git clean -fd`

To rollback only REFERENCES:
- `git restore references.json ribbon.json layout.json ribbon.js ribbon.css editor/commands/references_commands.js editor/state/references_state.js`

---

## Progress
- Phase 1 — Config + UI render (Stage A): NOT STARTED
- Phase 2 — Command wiring (dispatcher → TipTap/PM): NOT STARTED
- Phase 3 — TipTap/PM capabilities (extensions): NOT STARTED
- Phase 4 — State binding + enable/disable: NOT STARTED
- Phase 5 — Overlays + portal: NOT STARTED
- Phase 6 — Deterministic collapse (Stage B/C): NOT STARTED
- Validation: NOT STARTED
 