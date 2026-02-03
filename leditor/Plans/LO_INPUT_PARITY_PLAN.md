# LibreOffice Input Parity Plan

## Goal
Implement the missing LibreOffice-style input behaviors (shortcuts + selection/mouse interactions) identified in the inventory, with best-effort parity inside leditor.

## Success criteria
- All missing keyboard shortcuts from the inventory are bound and actionable in leditor.
- Multi-click selection supports word/sentence/paragraph selection (double/triple/quadruple).
- Selection mode toggles (extend/add/block) are wired with clear fallback messaging for unsupported multi-range/block selections.
- Insert/overwrite toggle, word completion, AutoText, and field-related shortcuts have working best‑effort behaviors.
- Table-specific shortcut behavior (Ctrl+A inside table, Ctrl+Home/End, Ctrl+Tab) is implemented.
- Validation checks confirm new bindings and commands exist in code.

## Constraints
- Follow repo AGENTS.md (transactional editor, no raw contenteditable edits).
- Avoid non-ASCII in source; use Unicode escapes when inserting special characters.
- No user gating between steps; execute sequentially.

## Scope
- leditor/src/extensions/extension_word_shortcuts.ts
- leditor/src/extensions/extension_indent.ts
- leditor/src/extensions/extension_underline.ts
- leditor/src/ui/a4_layout.ts
- leditor/src/ui/shortcuts.ts
- leditor/src/ui/status_bar.ts
- leditor/src/api/editor_commands.ts
- leditor/src/api/command_map.ts
- New helpers under leditor/src/editor/

## Steps
1) Add helper modules for selection modes, word completion, AutoText, overwrite mode, sentence utilities, and block movement.
2) Update WordShortcutsExtension with new LO keybindings and integrate helpers (selection modes, overwrite, paragraph move, table behavior).
3) Update a4_layout selection handling (sentence + paragraph multi-click) and track last caret position for Shift+F5.
4) Update formatting/indent extensions (double underline attr + shortcut mappings, remove conflicting Mod-M indent binding).
5) Update global shortcuts and status bar indicators for modes and function keys.
6) Add/extend command map + editor command IDs for new commands (Navigator, fields, field shading, update fields, etc.).
7) Run validation checks and update Progress.

## Risk notes
- ProseMirror does not support true multi-range selection; add/block modes will be best-effort with clear messaging.
- Some LibreOffice features (Navigator, fields, docking) will be placeholder behaviors due to missing UI infrastructure.
- Keybinding conflicts (e.g., Ctrl+M) will be resolved in favor of LibreOffice parity.

## Validation
- `rg -n "F8|Shift\+F8|Ctrl\+Shift\+F8|Navigator|FieldShading|Overwrite" leditor/src`
- `rg -n "Ctrl\+Enter|Ctrl\+Shift\+Enter|Ctrl\+F2|F9|Ctrl\+F9|Ctrl\+Shift\+F9|F7|Ctrl\+F7|F11|Shift\+F11|Ctrl\+Shift\+F11" leditor/src`
- `rg -n "double underline|underlineStyle|AutoText|word completion" leditor/src`

## Rollback
- `git -C /home/pantera/projects/TEIA reset --hard HEAD`

## Progress
1) PASS
2) PASS
3) PASS
4) PASS
5) PASS
6) PASS
7) PASS
