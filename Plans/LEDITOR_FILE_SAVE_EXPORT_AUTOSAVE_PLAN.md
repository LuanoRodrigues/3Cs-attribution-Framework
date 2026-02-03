# LEditor — File/Save/Export + Enforced LEDOC Autosave Plan

## Goal
Add a Word-like **File** experience:
1) **Save / Save As / Open / New** (in “File” tab)
2) **Export** dropdown for **PDF** and **Word (DOCX)**
3) A robust **autosave system** that always persists to disk using an enforced `*.ledoc/` bundle structure.

## Success criteria (verifiable)
- “File” tab exists in ribbon and exposes: **New**, **Open**, **Save**, **Save As**, **Export (DOCX/PDF)**.
- “Save” writes to the *current* document path without prompting; “Save As” prompts for a location/name.
- After any content change, autosave persists to disk within ≤ 2 seconds (debounced), when a document path exists.
- Autosave never prompts; if a document is “untitled”, it autosaves to a deterministic default path (userData) or forces an initial Save As (pick one and implement consistently).
- `.ledoc` storage is enforced to match the bundle structure below (missing/extra files handled deterministically).
- Import supports legacy `.ledoc` zip (v1) and migrates forward to the bundle structure (v2) without data loss (within our supported payload).
- `cd leditor && npm run typecheck` PASS
- `cd leditor && npm run build` PASS
- (host) `my-electron-app` build/run path still functions for import/export.

## Constraints
- Canonical document content is TipTap/ProseMirror JSON; edits only via transactions/commands.
- Offline-first; no network.
- No untrusted HTML injection; keep existing sanitization posture.
- LEDOC must be versioned and migratable (explicit `version.txt` + schema checks).

## Target storage format (enforced)
`<name>.ledoc/`
```
<name>.ledoc/
├── content.json        # ProseMirror/TipTap document JSON (canonical)
├── layout.json         # Pagination + footnote layout metadata (cache + hints)
├── registry.json       # Footnote id/counter registry + active/deleted state
├── media/
│   ├── image-1.png
│   └── ...
├── meta.json           # App version, timestamps, title/authorship
└── version.txt         # Format version string (for migrations)
```

### Format versioning
- Define **LEDOC v2** as the above bundle format.
- Keep **legacy v1 zip** support for reading (current `document.json/meta.json/...` zip payload).
- On first save after opening a v1 file, migrate to v2 bundle (either in-place with backup or “Save As” flow).

### File schemas (minimum viable)
- `version.txt`: `"2.0"` (single line, trimmed).
- `content.json`: TipTap JSON (`editor.getJSON()`).
- `meta.json`:
  - `version`: `"2.0"`
  - `title`: string
  - `authors`: string[]
  - `created`: ISO string
  - `lastModified`: ISO string
  - `appVersion`: string (optional)
  - `sourceFormat`: `"bundle"` | `"zip-v1"` (optional, diagnostic)
- `layout.json` (cache/hints; can be regenerated):
  - `pageSize`: string
  - `margins`: { top: number; bottom: number; left: number; right: number } (units must be defined: cm or px)
  - `pagination`: { pageCount?: number; computedAt?: ISO string; engine?: string }
  - `footnotes`: { offset?: number; computedAt?: ISO string }
- `registry.json`:
  - `footnoteIdState`: { counters: { footnote: number; endnote: number } }
  - `knownFootnotes`: Array<{ id: string; kind: "footnote"|"endnote"; index?: number; deleted?: boolean; citationId?: string }>

## Scope (files to change)
LEditor (renderer/library):
- `leditor/src/ui/ribbon_model.ts` (add File tab descriptor + tab model)
- `leditor/src/ui/ribbon_config.ts` (register new tab source)
- `leditor/src/ui/shortcuts.ts` (add file shortcuts: Save, Save As, Open)
- `leditor/src/api/editor_commands.ts` (add command ids: `Save`, `SaveAs`, `Open`, `New`, `Export` split helpers if needed)
- `leditor/src/api/command_map.ts` (implement Save/Open/SaveAs/New command handlers + export routing)
- `leditor/src/extensions/plugin_export_ledoc.ts` (export v2 payload + metadata needed for bundle)
- `leditor/src/extensions/plugin_import_ledoc.ts` (import v2 bundle + legacy v1 zip; surface migration warnings)
- `leditor/src/ledoc/format.ts` (introduce v2 constants/paths; keep v1 compat types as needed)
- `leditor/src/ledoc/zip.ts` (legacy v1 reader; optional)
- `leditor/src/ledoc/bundle.ts` (new: bundle validator + normalize)
- `leditor/src/ui/renderer.ts` (wire “current doc path”, autosave policy, and save-state UI hooks)

Host (Electron app):
- `my-electron-app/src/main.ts` (implement LEDOC bundle read/write; add filesystem IPC for directories/media if needed)
- `my-electron-app/src/preload.ts` (expose new host APIs to renderer)
- `my-electron-app/src/pages/WritePage.tsx` (ensure leditor integration passes/receives current doc path and save state)

## Step-by-step implementation plan (phased)

### Phase 1 — “File” tab + Save/Open UX
1. Add a new `file` tab to ribbon:
   - Add tab descriptor in `leditor/src/ui/ribbon_model.ts` registry.
   - Add `fileTab` model with:
     - Group “Document”: `New`, `Open`, `Save`, `Save As`
     - Group “Export”: `Export` split/dropdown (DOCX, PDF)
2. Add new `EditorCommandId`s:
   - `Save`, `SaveAs`, `Open`, `New`, and `ExportPdf`/`ExportDOCX` are already present.
3. Implement command handlers:
   - `Save`: if current LEDOC path known → export without prompt; else route to `SaveAs`.
   - `SaveAs`: prompt via host; sets current path on success.
   - `Open`: prompt via host; loads selected document; sets current path.
   - `New`: creates a blank document; resets current path (or creates new default doc path).
4. Shortcuts:
   - `Mod-S` Save, `Mod-Shift-S` Save As, `Mod-O` Open (avoid conflicting existing shortcuts; update `leditor/src/ui/shortcuts.ts`).

### Phase 2 — Export dropdown (PDF/Word)
1. Implement File→Export as a split/dropdown:
   - Primary action: `ExportDOCX` (Word)
   - Menu items: `ExportDOCX`, `ExportPdf`
2. Ensure export uses the latest page settings:
   - reuse existing DOCX export options and PDF export pipeline (host `exportPDF`).
3. Optional: auto-save before export (Word-like):
   - If dirty and autosave disabled/unavailable, run `Save` before exporting.

### Phase 3 — Enforced LEDOC autosave manager (library-side)
1. Introduce a single “document session” state machine (module-level singleton):
   - `currentDocPath` (string | null)
   - `dirty` flag
   - `saving` flag + last error
   - `lastSavedAt`
2. Hook editor updates:
   - On transactions that change doc: set dirty, schedule debounced autosave.
3. Autosave rules:
   - Must not prompt.
   - If `currentDocPath` is null:
     - Option A (recommended): autosave to host-provided default path (userData `coder_state.ledoc` style), then treat it as current.
     - Option B: require Save As before enabling autosave (less Word-like).
   - Always update `meta.json.lastModified` on save.
4. Save atomicity:
   - Implement atomic write at host level (write temp → rename).
5. UI feedback:
   - Status bar: “Saved” / “Saving…” / “Autosave failed” with retry.

### Phase 4 — LEDOC v2 bundle format + migration
1. Define v2 format constants:
   - `LEDOC_BUNDLE_VERSION = "2.0"`
   - `LEDOC_BUNDLE_PATHS` for `content.json`, `layout.json`, `registry.json`, `meta.json`, `version.txt`, `media/`
2. Export payload changes:
   - Extend export to include:
     - `content.json` from `editorHandle.getJSON()`
     - `layout.json` from layout settings + pagination/footnote metadata (even if minimal initially)
     - `registry.json` from footnote id generator state + derived numbering
     - media manifest (optional v1): if images are external paths, copy into `media/` and rewrite attrs to relative `media/...`
3. Import logic:
   - If chosen path is directory ending with `.ledoc`: read bundle files, validate `version.txt`, load `content.json`, apply `layout.json` settings.
   - Else if chosen path is a `.ledoc` file: treat as legacy zip v1 (existing behavior), then convert in memory to v2 structures.
4. Enforce structure:
   - On save/autosave, always write all required files.
   - If optional files missing on load: regenerate with defaults and record warning.

### Phase 5 — Host (Electron) filesystem support
1. Extend IPC for bundle operations:
   - `leditor:export-ledoc-bundle` (write directory bundle)
   - `leditor:import-ledoc-bundle` (read directory bundle)
   - Keep existing `leditor:export-ledoc` and `leditor:import-ledoc` for v1 zip (or route them internally).
2. Implement:
   - Directory creation, recursive mkdir for `media/`
   - Binary file read/write for media assets
   - Atomic write helper for JSON/text (write temp then rename)
3. Dialogs:
   - Save As: choose a directory name ending in `.ledoc` (or choose parent dir + auto-create `<name>.ledoc/`).
   - Open: allow selecting directory `.ledoc` and legacy `.ledoc` file.

## Risk notes
- Introducing a directory bundle changes assumptions in export/import; must retain v1 zip support to avoid breaking existing documents.
- Autosave without prompts requires a stable default path strategy to avoid “silent writes to nowhere”.
- Image/media copying requires a clear rule for `src` rewriting and a migration path for existing docs.
- Cross-platform path handling (Windows vs macOS) for “directory with .ledoc extension” must be tested.

## Validation
LEditor:
- `cd leditor && npm run typecheck`
- `cd leditor && npm run build`
Host:
- `cd my-electron-app && npm run build` (or the project’s equivalent)
- Manual smoke:
  - Open → edit → autosave writes bundle
  - Save As creates `<name>.ledoc/` with required files
  - Export dropdown produces DOCX and PDF

## Rollback
```bash
git checkout -- leditor/src/ui/ribbon_model.ts
git checkout -- leditor/src/ui/ribbon_config.ts
git checkout -- leditor/src/ui/shortcuts.ts
git checkout -- leditor/src/api/editor_commands.ts
git checkout -- leditor/src/api/command_map.ts
git checkout -- leditor/src/extensions/plugin_export_ledoc.ts
git checkout -- leditor/src/extensions/plugin_import_ledoc.ts
git checkout -- leditor/src/ledoc/format.ts
git checkout -- leditor/src/ledoc/zip.ts
git rm -- leditor/src/ledoc/bundle.ts
git checkout -- my-electron-app/src/main.ts
git checkout -- my-electron-app/src/preload.ts
git checkout -- my-electron-app/src/pages/WritePage.tsx
git checkout -- Plans/LEDITOR_FILE_SAVE_EXPORT_AUTOSAVE_PLAN.md
```

## Progress
1) File tab + Save/Open UX — PASS
2) Export dropdown (PDF/Word) — PASS
3) Autosave manager — PASS
4) LEDOC v2 bundle + migration — PASS
5) Host filesystem support — PASS
