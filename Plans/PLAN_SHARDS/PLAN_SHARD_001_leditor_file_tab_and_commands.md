# Plan Shard 001 — LEditor File tab + commands

## Goal
Add a Word-like **File** tab to the LEditor ribbon and implement the core file commands: **New**, **Open**, **Save**, **Save As**, plus **Export** (DOCX/PDF).

## Success criteria
- Ribbon shows a new **File** tab.
- File tab offers: New, Open, Save, Save As, Export (DOCX/PDF).
- Shortcuts: `Mod+S` Save, `Mod+Shift+S` Save As, `Mod+O` Open.
- Save uses current document path without prompting; Save As prompts.
- `cd leditor && npm run typecheck` PASS.

## Constraints
- Commands must route through `EditorHandle.execCommand` and host adapter IPC (no direct fs).

## Scope
- `leditor/src/ui/ribbon_model.ts`
- `leditor/src/ui/ribbon_config.ts`
- `leditor/src/ui/shortcuts.ts`
- `leditor/src/api/editor_commands.ts`
- `leditor/src/api/command_map.ts`
- `Plans/EXECUTION_INDEX.md`

## Steps
1) Add `file` tab model + registry entry.
2) Add command ids (`Save`, `SaveAs`, `Open`, `New`) if missing.
3) Implement command handlers in `command_map.ts` (thin routing via `window.__leditorAutoImportLEDOC` / `window.__leditorAutoExportLEDOC`).
4) Add global keyboard shortcuts in `ui/shortcuts.ts`.

## Risk notes
- Must not break existing ribbon model validation (missing icons/commands are fatal in some cases).

## Validation
- `cd leditor && npm run typecheck`

## Rollback
```bash
git checkout -- leditor/src/ui/ribbon_model.ts
git checkout -- leditor/src/ui/ribbon_config.ts
git checkout -- leditor/src/ui/shortcuts.ts
git checkout -- leditor/src/api/editor_commands.ts
git checkout -- leditor/src/api/command_map.ts
git checkout -- Plans/EXECUTION_INDEX.md
git checkout -- Plans/PLAN_SHARDS/PLAN_SHARD_001_leditor_file_tab_and_commands.md
```

## Progress
1) File tab model — PASS
2) Command ids — PASS
3) Command handlers — PASS
4) Shortcuts — PASS
5) Validation — PASS
