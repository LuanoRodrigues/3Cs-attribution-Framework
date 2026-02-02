# LEditor — Word-like Editing UX Plan

## Goal
Make text editing feel “Word smooth” (fast, predictable, forgiving) across:
- single click caret placement (always reliable)
- selection (mouse + keyboard)
- shortcuts (Word-ish defaults, discoverable)
- drag/drop + clipboard (no surprises)
- high-DPI + pagination overlays (no “stuck caret” or click loss)

This plan focuses on **editor interaction correctness**. For UI motion/perf polish, also see `Plans/Themes/leditor/smoothness_perf_plan.md`.

## Non-goals (for now)
- Perfect parity with Microsoft Word’s full feature set.
- Collaborative editing / multi-cursor.
- Full accessibility certification (but we should avoid regressions and add basics).

---

## What “Word smooth” means (requirements)

### 1) Mouse + caret
**Must-have behaviors**
- Single click inside text:
  - focuses the editor (caret visible immediately)
  - collapses selection to caret at click point (unless Shift is held)
  - never leaves a “highlighted word” without a caret after click
- Single click on page chrome (margins/header/footer clones):
  - resolves to nearest valid text position inside the page content area
  - never lands selection on a wrapper/non-inline node
- Double click:
  - selects word under pointer (stable word boundaries)
- Triple click:
  - selects paragraph (or line, depending on our desired rule; pick one and be consistent)
- Click-and-drag:
  - starts selection immediately (no delayed capture)
  - autoscrolls when dragging outside viewport
  - selection remains stable while pagination reflows
- Right click:
  - does not unexpectedly move selection if click is inside existing selection (Word behavior)
  - context menu shows selection-aware actions (Cut/Copy/Paste, formatting)

**Nice-to-have**
- Alt/Option + drag: column selection (hard; defer).
- Selection handles on touch devices (likely out of scope for Electron desktop).

### 2) Keyboard navigation + selection
**Must-have**
- Arrows move caret predictably across pagination boundaries.
- Shift + arrows extends selection.
- Home/End:
  - (Win) Home/End move to line start/end; Ctrl+Home/End to doc start/end.
  - (Mac) Cmd+←/→ for line start/end; Cmd+↑/↓ for doc start/end.
- Word navigation:
  - Ctrl+←/→ (Win/Linux) / Option+←/→ (Mac) moves by word boundaries.
  - Ctrl+Shift+←/→ extends selection by word.
- Deletion:
  - Backspace/Delete remove expected content
  - Ctrl+Backspace/Delete (or Option on Mac) deletes word left/right
- Tab/Shift+Tab:
  - consistent indent/outdent rules in lists and paragraphs
  - table navigation respects cells (Tab moves next cell, adds row at end if desired)
- Undo/Redo:
  - Ctrl+Z / Ctrl+Y (Win/Linux), Cmd+Z / Cmd+Shift+Z (Mac)
  - predictable grouping (typing bursts grouped, formatting actions atomic)

### 3) Selection semantics (text model)
**Must-have**
- Selecting across:
  - inline marks (bold/italic/etc.)
  - footnote references and bodies (clear rule: are footnotes “in-flow” or separate editors?)
  - page breaks and layout nodes
- Copy:
  - preserves basic formatting
  - never copies layout wrapper nodes
- Paste:
  - “Paste” keeps reasonable formatting, sanitized
  - “Paste as plain text” always available (shortcut + menu)
- Find/Replace:
  - selection integrates with search result navigation
  - replacing doesn’t break the caret or scroll position

### 4) Drag & drop
**Must-have**
- Drag selected text to move/copy (copy with modifier key like Ctrl on Win).
- Drop indicator (cursor) should not crash during teardown and should not get “stuck”.

### 5) Visual + performance requirements
**Must-have**
- Caret paints immediately after interactions (no “dead click” feeling).
- No reflow storms while selecting (pagination updates should be throttled/coalesced).
- Scroll stays anchored: editing near page boundary shouldn’t jump the viewport.

### 6) Resilience + correctness
**Must-have**
- Editor never gets “stuck non-editable” after leaving special modes (footnotes, header/footer).
- No unhandled exceptions during:
  - opening/closing the editor
  - switching modes
  - drag/drop
  - undo/redo after mode changes

---

## What LEditor currently does (observed in code) and likely gaps

### Already present (good foundations)
- Global “caret enforcement” hooks in `leditor/src/ui/a4_layout.ts` attempt to recover from:
  - clicks on page chrome
  - overlays intercepting clicks
  - selection ending up on a non-inline wrapper node
- Word-ish formatting shortcuts in `leditor/src/extensions/extension_word_shortcuts.ts`:
  - alignment (Mod-Shift-L/E/R/J)
  - heading levels (Mod-Alt-1/2/3)
  - insert table / insert footnote shortcut
- Sanitized HTML paste in `leditor/src/api/leditor.ts` (basic script stripping + event-attr stripping).

### Missing or inconsistent (priority suspects)
- **Selection collapse on click** when an existing word/phrase selection is active and an overlay/page chrome intercepts the event (caret doesn’t appear).
- **Drop cursor teardown crash** (from `prosemirror-dropcursor`) can throw during editor destroy.
- **Triple click behavior** is not explicitly specified/verified.
- **Right click selection rules** likely default ProseMirror behavior; verify matches Word expectations.
- **Autoscroll while drag-selecting** may be inconsistent with pagination overlays; verify.
- **Undo grouping** across pagination/layout transforms may feel “chunky”; verify and tune transaction grouping.

---

## Execution phases

### Phase 0 — Stop crashes + “stuck caret” bugs (stability)
Acceptance:
- No unhandled exceptions during close/destroy.
- Any single click in body text always results in a visible caret (unless user is actively extending selection with modifiers).

Work:
- Remove/replace the drop cursor plugin until it can be patched safely.
- Make caret enforcement collapse stuck range selections reliably.

### Phase 1 — Mouse interaction parity
Acceptance:
- Single/double/triple click rules documented and consistent.
- Range selection drag feels immediate and stable.

Work:
- Validate click timing (pointerdown vs click) so we never override legitimate selections.
- Add explicit dblclick/tripleclick handling if overlays interfere.
- Confirm right-click behavior and context menu selection policy.

### Phase 2 — Keyboard navigation + deletion parity
Acceptance:
- Word-like navigation and selection shortcuts behave correctly on Win/Mac/Linux.

Work:
- Audit current keymaps (Tiptap/ProseMirror defaults + `WordShortcutsExtension`).
- Add missing bindings (home/end, word-jump, word-delete, redo).
- Ensure tables/lists have correct Tab semantics.

### Phase 3 — Clipboard and paste modes
Acceptance:
- Paste is safe and predictable; “paste plain” is always available.

Work:
- Add “Paste as plain text” command and shortcut.
- Improve HTML sanitization rules (preserve lists/tables when desired, drop hostile styles/scripts).
- Add small regression fixtures for paste edge cases (Word/Google Docs/HTML snippets).

### Phase 4 — Drag & drop polish (reintroduce drop cursor safely)
Acceptance:
- Drop indicator works and never throws on teardown.

Work:
- Implement a patched drop cursor plugin (either vendored copy with safety checks or a maintained alternative).
- Ensure destroy clears timers and removes cursor element safely.

### Phase 5 — Perf + “buttery” feel validation
Acceptance:
- No noticeable lag in typing, selection, scrolling.

Work:
- Add lightweight perf instrumentation around pagination and selection updates.
- Throttle/debounce any heavy layout updates triggered by mouse moves.

---

## Test plan (pragmatic)
- Manual scripts:
  - “click inside selected word collapses to caret”
  - “click in margin places caret near click”
  - “double click selects word; triple click selects paragraph”
  - “drag-select across page boundary autoscrolls”
  - “close editor immediately after dragover doesn’t throw”
- Automated (where feasible):
  - unit-ish tests for helper functions (sanitization, selection mapping)
  - smoke tests for mount/destroy flows in Electron headless scripts

