# LEditor — Word-like Editing UX Execution Plan

## Goal
Make LEditor feel “Word smooth” for core editing interactions (caret placement, selection, keyboard shortcuts, paste modes, drag/drop indicator) while staying within TipTap/ProseMirror’s transactional model and existing architecture.

## Success criteria
- No unhandled exceptions during mount/destroy or drag/drop teardown.
- Single click reliably focuses and shows caret; plain click collapses selection to caret.
- Right click does not unintentionally collapse/move selection when clicking inside an existing selection.
- Word-like shortcuts exist for redo, paste-plain, word delete, and Home/End navigation.
- Drop cursor indicator works and does not crash on teardown.
- `cd leditor && npm run typecheck` passes.
- `cd leditor && npm run build` passes.

## Constraints
- Canonical document state is TipTap/ProseMirror JSON; edits via transactions/commands only.
- No contenteditable DOM editing hacks for document state.
- Offline-first; no network requirements.
- Security: keep paste/import schema-driven and sanitized.

## Scope (exact files)
- `leditor/src/ui/a4_layout.ts`
- `leditor/src/ui/context_menu.ts`
- `leditor/src/extensions/extension_word_shortcuts.ts`
- `leditor/src/extensions/extension_dropcursor_safe.ts` (new)
- `leditor/src/api/leditor.ts`
- `Plans/LEDITOR_WORDLIKE_UX_EXECUTION_PLAN.md` (this file, progress updates)

## Steps
1) Mouse/selection reliability
   - Ensure plain click collapses “stuck” range selections (esp. when overlays/page chrome intercept events).
   - Ensure right click inside selection does not move selection prior to opening context menu.
   - Files: `leditor/src/ui/a4_layout.ts`, `leditor/src/ui/context_menu.ts`

2) Keyboard shortcuts (Word-like defaults)
   - Add redo shortcuts (`Mod-Y`, `Mod-Shift-Z`).
   - Add paste-plain shortcut (`Mod-Shift-V`) wired to existing `PastePlain` command behavior.
   - Add word delete (`Ctrl/Mod-Backspace/Delete` on Win/Linux; `Alt-Backspace/Delete` on Mac).
   - Add Home/End block navigation (+ Shift variants); add Ctrl+Home/Ctrl+End doc navigation (Win/Linux).
   - File: `leditor/src/extensions/extension_word_shortcuts.ts`

3) Safe drop cursor
   - Add a patched drop cursor extension that cannot throw on teardown (null parent/element safe removal).
   - Disable StarterKit’s built-in dropcursor and register the safe extension instead.
   - Files: `leditor/src/extensions/extension_dropcursor_safe.ts`, `leditor/src/api/leditor.ts`

4) Validation
   - Run: `cd leditor && npm run typecheck`
   - Run: `cd leditor && npm run build`

## Risk notes
- Keymap overrides can conflict with TipTap/ProseMirror defaults; prefer additive mappings and avoid overriding Mac Cmd+Backspace semantics.
- Context-menu right-click interception must not break native context menu behavior outside the editor.
- Drop cursor plugin must remove timers/listeners and DOM safely across remounts.

## Validation
- `cd leditor && npm run typecheck`
- `cd leditor && npm run build`

## Rollback
```bash
git checkout -- leditor/src/ui/a4_layout.ts
git checkout -- leditor/src/ui/context_menu.ts
git checkout -- leditor/src/extensions/extension_word_shortcuts.ts
git checkout -- leditor/src/api/leditor.ts
git rm -- leditor/src/extensions/extension_dropcursor_safe.ts
git checkout -- Plans/LEDITOR_WORDLIKE_UX_EXECUTION_PLAN.md
```

## Progress
1) Mouse/selection reliability — PASS
2) Keyboard shortcuts — PASS
3) Safe drop cursor — PASS
4) Validation — PASS
