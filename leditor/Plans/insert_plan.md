# Plans/insert_plan.md — INSERT Tab Plan (Compliant with AGENTS.md)

## Goal
Implement the Microsoft Word–fidelity **INSERT** ribbon tab in the Electron renderer using the existing config-driven ribbon system, including deterministic collapse behavior and explicitly-scoped rich-text editor extensions (embeds, audio, file attachment, responsive tables, placeholders/shortcodes). :contentReference[oaicite:0]{index=0}

---

## Success Criteria
1. **Visual fidelity (Word-like at 100% zoom)**
   - INSERT group order matches the reference specification (Pages → … → Symbols).
   - Group separators render **between groups only** and match the ribbon separator style.
   - Large/medium/small controls render with consistent sizing tiers across groups.
   - Icon sizing is enforced:
     - **16px** for small/medium controls
     - **20px** for large controls
   - Group footers render correctly:
     - group title centered/baseline aligned
     - optional dialog launcher positioned bottom-right.

2. **Deterministic behavior**
   - Rendering is driven exclusively by `ribbon.json`, `layout.json`, and `insert.json`.
   - Stage A/B/C behavior follows explicit `collapse` directives only.
   - Stage B consolidation ordering follows the defined collapse priority list.

3. **Functional completeness**
   - Every described control renders and dispatches its configured `command.id`.
   - Menus/galleries/pickers render through the ribbon portal and do not clip.
   - Enable/disable behavior is correct based on the state contract (`canInsert`, `selectionContext`, `linkActive`, etc.).

4. **Electron compatibility**
   - Implementation runs in Electron renderer with DOM/CSS only.
   - No dependency on browser-only APIs unavailable in Electron.

---

## Constraints
- **Plan compliance is mandatory**: this file is the execution authority for INSERT work. :contentReference[oaicite:1]{index=1}
- **Fail-fast**: missing required config keys (control type, iconKey, command.id, etc.) must raise; no fallback behavior. :contentReference[oaicite:2]{index=2}
- **No heuristic layout**: no implicit hiding/reflow beyond explicit `collapse` rules. :contentReference[oaicite:3]{index=3}
- **Security**: no remote script loading, no runtime eval, no unsafe HTML injection for embed code; embed insertion must remain schema/command driven. :contentReference[oaicite:4]{index=4}
- **Portal required**: menus/flyouts/pickers must render in the portal container to avoid clipping.

---

## Scope (Exact file list)
This Plan authorizes changes only to:
1. `Plans/insert_plan.md` (this file; progress updates during execution)
2. `insert.json`
3. `ribbon.json` (only if required to register/route the INSERT tab)
4. `layout.json` (only if required for tokens/z-index/portal alignment)
5. `ribbon.css` (only INSERT-specific popover/picker styles; no unrelated refactors)
6. `ribbon.js` (only if required to support picker/gallery rendering primitives already referenced by config)

---

## Steps (Numbered; with file paths + target symbols)

### 1) Confirm INSERT tab registration and routing
- File: `ribbon.json`
- Target: `tabs[]` entry for `{ tabId: "insert", source: "insert.json" }`
- Outcome: INSERT tab can be selected and loads `insert.json`.

### 2) Author `insert.json` group structure (Stage A)
- File: `insert.json`
- Targets:
  - `tabId: "insert"`
  - `groups[]` in this exact order:
    1. `pages`
    2. `tables`
    3. `illustrations`
    4. `addins`
    5. `media`
    6. `links`
    7. `comments`
    8. `headerFooter`
    9. `text`
    10. `symbols`
- Outcome: Groups render in correct order and match Word-like footprint.

### 3) Define group cluster layouts and controls (Stage A)
- File: `insert.json`
- Targets: For each `groupId`, define `clusters[]` and `controls[]` with:
  - `controlId`, `label`, `type`, `size`, `iconKey`, `command.id`
  - `menu[]` with explicit separators where needed
  - `state.binding` and `enabledWhen` where required
- Outcome: Full Stage A INSERT tab content matches reference spec.

### 4) Implement INSERT pickers/galleries wiring (if not already available)
- File: `ribbon.js`
- Targets (symbols vary by repo; bind to existing primitives rather than inventing):
  - Menu/popup renderer for:
    - `gallery` popover (cover page, shapes, text box, equation)
    - `tableGridPicker` popover
    - `embedDialog` popover/modal (portal-rendered)
  - Ensure each popover is portal-rendered and anchored to invoker bounds.
- Outcome: Picker-type controls open correctly without clipping.

### 5) Add INSERT-specific CSS primitives (popovers/pickers)
- File: `ribbon.css`
- Targets:
  - `.rgallery`, `.rgallery__grid`, `.rgallery__item`
  - `.rtablePicker`, `.rtablePicker__grid`, `.rtablePicker__cell`
  - `.rembed`, `.rembed textarea`
  - Icon sizing enforcement:
    - `.rctl__icon` (16px)
    - `.rctl--lg .rctl__icon` (20px)
- Outcome: Popovers and pickers match Word-like visual density and render cleanly.

### 6) Stage B deterministic collapse directives
- File: `insert.json`
- Targets:
  - Populate each control’s `collapse` mapping (`A`, `B`, `C`)
  - Implement Stage B moves using explicit directives:
    - `inMenuOf:<controlId>`
    - `inOverflowOf:<controlId>`
    - `dropdownOnly`
    - `iconOnly`
    - `medium`
- Outcome: At 1280px and 1024px widths, INSERT consolidates deterministically.

### 7) Stage B ordering (collapse priority)
- File: `insert.json`
- Targets:
  - `priority` per group and per control (or a dedicated per-control field if supported by your schema)
  - Use this ordering (lowest collapses first):
    - Pages: Cover Page 60, Blank Page 90, Page Break 95
    - Tables: Responsive toggle 40, Draw/Convert/QuickTables 50, Insert Table 95
    - Illustrations: Screenshot 30, SmartArt 35, Icons 55, Chart 70, Shapes 80, Pictures 95
    - Add-ins: My Add-ins 50, Get Add-ins 60
    - Media: File 35, Audio 40, Online Video 65, Embed 80
    - Links: Cross-reference 30, Bookmark 45, Link 90
    - Comments: New Comment 85
    - Header & Footer: Page Number 75, Footer 80, Header 85
    - Text: Object 25, Signature 30, DropCap 35, WordArt 40, Placeholder/Shortcode 45, QuickParts 75, DateTime 70, TextBox 85
    - Symbols: Emoji 40, Equation 75, Symbol 80
- Outcome: If multiple items must collapse into overflow/menu, ordering is stable and matches the intended UX.

### 8) Stage C group flyouts for INSERT
- File: `insert.json`
- Targets:
  - Group-level `collapse.C` set to `groupFlyout`
  - Group flyout renders the group’s Stage A layout
- File (if needed): `ribbon.js` flyout renderer must support group flyouts via portal
- Outcome: Narrow widths keep all functionality accessible via flyouts.

### 9) State contract bindings for enable/disable + toggles
- File: `insert.json`
- Targets:
  - `canInsert` gating on insert actions (disable group or controls if false)
  - `selectionContext` gating for header/footer commands (disable if unsupported)
  - `linkActive` enables edit/remove link items
  - Optional toggles:
    - `autoLink`
    - `tableDrawMode`
    - `responsiveTableDefault`
    - `textBoxDrawMode`
- Outcome: UI state reflects editor state deterministically.

---

## Risk Notes
1. **Visual drift**
   - Risk: CSS tokens differ from Word-like density (spacing/icon optical size).
   - Detection: screenshot comparisons at fixed widths; verify 16/20 icon sizes and group footer alignment.

2. **Picker clipping**
   - Risk: popovers render inside ribbon container and clip under overflow/scroll.
   - Detection: open each picker near right edge; verify portal render and correct z-index.

3. **Non-deterministic collapse**
   - Risk: any heuristic “fit” logic overrides config ordering.
   - Detection: repeated resize passes at the same widths must produce identical DOM ordering and overflow content.

4. **Unsupported feature UI**
   - Risk: header/footer or excel embed actions exist but editor does not support them.
   - Detection: ensure controls can be disabled via `selectionContext`/capability flags; no broken invocations.

---

## Validation (Commands or deterministic checks Codex will run)
1. **Build / run (repo-standard)**
   - Run the project’s standard build command (e.g., `npm test` / `npm run build` / `npm run lint` / `npm run dev`), selecting those that exist in the repository.

2. **Deterministic UI checks**
   - Launch app and validate (by direct observation and DOM structure checks in code where applicable):
     - INSERT tab shows all 10 groups in correct order.
     - Open each:
       - Cover page gallery
       - Table grid picker
       - Shapes gallery
       - Embed dialog
     - Verify portal is used (popovers are children of `#ribbon-portal`).
     - Resize to 1440px / 1280px / 1024px and confirm:
       - Stage A at wide
       - Stage B consolidation ordering
       - Stage C flyouts at narrow
     - Verify icon sizing:
       - 16px on small/medium controls
       - 20px on large controls

3. **Command dispatch smoke**
   - Click each primary control once and confirm command dispatcher receives the configured `command.id` (instrumentation allowed in code, temporary and localized).

---

## Rollback (Explicit git commands)
1. Hard rollback to last commit:
```bash
git reset --hard HEAD
```

## Progress
- Step 1 — Confirm INSERT tab registration and routing: PASS
- Step 2 — Author `insert.json` group structure (Stage A): PASS
- Step 3 — Define group cluster layouts and controls (Stage A): PASS
- Step 4 — Implement INSERT pickers/galleries wiring: PASS
- Step 5 — Add INSERT-specific CSS primitives (popovers/pickers): PASS
- Step 6 — Stage B deterministic collapse directives: PASS
- Step 7 — Stage B ordering (collapse priority): PASS
- Step 8 — Stage C group flyouts for INSERT: PASS
- Step 9 — State contract bindings for enable/disable + toggles: PASS
