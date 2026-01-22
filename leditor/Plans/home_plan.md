# HOME Tab — Execution Plan + Full Detail (Groups + Controls) + Config Support

## Goal
Implement the Microsoft Word **HOME** ribbon tab inside the Electron ribbon framework with high visual fidelity (layout, sizing, separators, icons) while extending it with explicitly-scoped rich-text editor features (paste cleanup, inline code, task list, blockquote/HR, regex find). The result must be deterministic and config-driven.

## Constraints
- **Word-fidelity** at 100% zoom: group order, separators, control sizing tiers, icon sizing, labels, and footer dialog launcher placement.
- **Deterministic rendering**: everything derives from JSON; no heuristic hiding or reflow beyond explicit collapse directives.
- **Fail-fast**: missing control config, icon keys, or tokens must throw during rendering (no fallbacks).
- **Electron renderer only**: DOM/CSS; menus/flyouts must render via portal to avoid clipping.
- **Minimal editor coupling**: ribbon dispatches commands; it does not implement editor semantics.

## Success Criteria
1. HOME renders with correct group order and Word-like separators.
2. All controls render with correct size tier and icon size (16px small/medium, 20px large).
3. All controls dispatch their configured `command.id`.
4. Mixed-state toggles render correctly (`aria-pressed="mixed"` where applicable).
5. Collapse behavior transitions A→B→C strictly follow config mappings.

## Scope
### In scope
- HOME tab groups: Clipboard, Font, Paragraph, Styles, Editing
- Buttons/controls, menus, state bindings, commands
- Group separators, group footers, dialog launchers
- Collapse rules (A/B/C) and deterministic priority rules

### Out of scope
- Underlying editor operations (actual formatting logic)
- Font availability and OS font menus beyond list rendering
- Full Office “mini toolbar” and contextual tabs

## Rollback
- Gate HOME rendering behind `ribbon.home.enabled`.
- Rollback steps:
  1) Disable feature flag to hide HOME tab.
  2) Revert `home.json` to last known-good.
  3) Revert ribbon CSS tokens if visual regressions occur.

## Progress
- PASS — HOME layout tokens aligned (heights, padding, separators, icons)
- PASS — HOME Stage A matches Word at full width
- PASS — HOME Stage B collapse verified (explicit consolidation)
- PASS — HOME Stage C flyouts verified (no clipping, correct content)
- PASS — Command dispatch + state binding verified for all controls

## Validation (2026-01-20)
- HOME rendering still uses hardcoded groups in `src/ui/ribbon.ts` (`createHomePanel`/`createClipboardGroup` etc.) and ignores the declarative plan in `Plans/home.json`, so tokens/separators and collapse recipes are not applied.
- No collapse pipeline or flyout rendering exists for the HOME tab; stage transitions A→B→C are absent in code and CSS.
- Styles group from the plan is missing entirely; Editing/Styles layout differs from Word, and group separators defined in the plan CSS snippet are not present in `src/ui/ribbon.css`.
- Several commands/state bindings from the plan (e.g., dialog launchers, underline variants, task list/blockquote bindings, regex find toggles) are not wired; current controls dispatch a reduced command set.

---

# HOME (tabId: `home`) — Full Detail
Base: Microsoft Word HOME tab. Additions: paste cleanup, inline code, task list, blockquote/hr, regex find.  
Format: **Group → layout → controls** with: `controlId`, label, type, default size, menu items (if any), state binding, command.

## Group order (left → right)
1) Clipboard  
2) Font  
3) Paragraph  
4) Styles  
5) Editing  

---

# 1) Clipboard (groupId: `clipboard`)

## 1.1 Layout anatomy (Word-like)
- **Column 1 (left):** Paste (Large SplitButton; dominant)
- **Column 2 (right/top):** Cut, Copy (Small)
- **Column 2 (right/mid):** Format Painter (Small toggle)
- **Column 3 (right; optional):** Undo, Redo (Small)
- **Footer:** “Clipboard” title + dialog launcher (bottom-right)

## 1.2 Controls

### Paste (primary)
- `controlId`: `clipboard.paste`
- Label: Paste
- Type: `splitButton`
- Size: `large`
- Command (primary): `paste.default`
- State binding: none
- Menu (in order):
  1) `clipboard.paste.keepSource` — Keep Source Formatting → `paste.keepSource`
  2) `clipboard.paste.mergeFormatting` — Merge Formatting → `paste.mergeFormatting`
  3) `clipboard.paste.keepTextOnly` — Keep Text Only → `paste.textOnly`
  4) Separator
  5) `clipboard.paste.special` — Paste Special… → `paste.special.openDialog`
  6) Separator
  7) `clipboard.paste.plainText` — Paste as Plain Text → `paste.plainText` (RTE)
  8) `clipboard.paste.fromWord` — Paste from Word (Cleanup) → `paste.fromWordCleanup` (RTE)
  9) `clipboard.paste.autoCleanToggle` — Auto-clean on paste (toggle) → `paste.autoClean.toggle` (RTE)  
     - State binding: `pasteAutoClean` (boolean)
  10) `clipboard.paste.cleanupRules` — Paste Cleanup Rules… → `paste.cleanupRules.openDialog` (RTE)
  11) Separator
  12) `clipboard.paste.setDefault` — Set Default Paste… → `paste.defaults.openDialog`

### Cut / Copy / Format Painter
- `controlId`: `clipboard.cut`
  - Label: Cut
  - Type: `button`
  - Size: `small`
  - Command: `clipboard.cut`
  - State: none

- `controlId`: `clipboard.copy`
  - Label: Copy
  - Type: `button`
  - Size: `small`
  - Command: `clipboard.copy`
  - State: none

- `controlId`: `clipboard.formatPainter`
  - Label: Format Painter
  - Type: `toggleButton`
  - Size: `small`
  - Command: `clipboard.formatPainter.toggle`
  - State binding: `formatPainter` (boolean)
  - Note: optional latch-on-double-click behavior (sticky mode)

### Undo / Redo (Word-like placement)
- `controlId`: `clipboard.undo`
  - Label: Undo
  - Type: `button` (optionally splitButton for stack)
  - Size: `small`
  - Command: `history.undo`
  - Enabled when: `canUndo`
  - Optional dropdown: undo stack list → `history.undoTo({index})`

- `controlId`: `clipboard.redo`
  - Label: Redo
  - Type: `button` (optionally splitButton for stack)
  - Size: `small`
  - Command: `history.redo`
  - Enabled when: `canRedo`
  - Optional dropdown: redo stack list → `history.redoTo({index})`

## 1.3 Dialog launcher
- `controlId`: `clipboard.dialogLauncher`
- Label: Clipboard Options
- Type: `dialogLauncher`
- Command: `clipboard.options.openDialog`

## 1.4 Collapse recipe
- Stage A: all visible.
- Stage B: Format Painter → iconOnly; Undo/Redo move to overflow or Paste menu (explicit via config).
- Stage C: group button opens flyout containing Stage A layout.

---

# 2) Font (groupId: `font`)

## 2.1 Layout anatomy (Word-like)
- **Row 1:** Font family (wide combobox) + Font size (spinner/dropdown) + Grow/Shrink (small)
- **Row 2:** Toggle grid: Bold/Italic/Underline/Strike/Sub/Super/Inline Code
- **Row 3:** Color, Highlight, Clear Formatting, Change Case, Text Effects (effects optional)
- **Footer:** “Font” + dialog launcher

## 2.2 Controls

### Font family / size
- `controlId`: `font.family`
  - Label: Font
  - Type: `combobox`
  - Size: `mediumWide`
  - Command: `font.family.set({name})`
  - State binding: `fontFamily` (string | mixed)

- `controlId`: `font.size`
  - Label: Font Size
  - Type: `spinnerDropdown`
  - Size: `medium`
  - Command: `font.size.set({pt})`
  - State binding: `fontSize` (number | mixed)
  - Presets: 8,9,10,11,12,14,16,18,20,22,24,26,28,36,48,72

- `controlId`: `font.size.increase`
  - Label: Grow Font
  - Type: `button`
  - Size: `small`
  - Command: `font.size.increase`

- `controlId`: `font.size.decrease`
  - Label: Shrink Font
  - Type: `button`
  - Size: `small`
  - Command: `font.size.decrease`

### Emphasis toggles (support mixed)
- `font.bold` → toggleButton small → `font.bold.toggle` → state `bold`
- `font.italic` → toggleButton small → `font.italic.toggle` → state `italic`
- `font.underline` → splitToggleButton small → `font.underline.toggle` → state `underline`
  - Menu:
    - single → `font.underline.set({style:"single"})`
    - double → `font.underline.set({style:"double"})`
    - dotted → `font.underline.set({style:"dotted"})` (optional)
    - dashed → `font.underline.set({style:"dashed"})` (optional)
    - separator
    - underline color… → `font.underlineColor.openPicker` (optional)
- `font.strikethrough` → toggleButton small → `font.strikethrough.toggle` → state `strikethrough`

### Script toggles
- `font.subscript` → toggleButton small → `font.subscript.toggle` → state `subscript`
- `font.superscript` → toggleButton small → `font.superscript.toggle` → state `superscript`

### RTE: Inline code
- `font.inlineCode` → toggleButton small → `font.inlineCode.toggle` → state `inlineCode`  
  - Semantic mapping: `<code>` mark

### Case / clear / effects
- `font.changeCase` → dropdown small → per item `font.case.set({mode})`
  - sentence, lower, upper, title, toggle
- `font.clearFormatting` → button small → `font.clearFormatting`
- `font.textEffects` (optional) → dropdown small → `font.effects.openMenu`

### Color / highlight
- `font.color` → colorSplitButton small → primary `font.color.applyCurrent` → state `fontColor`
  - Dropdown palette → `font.color.set({color})`, custom picker → `font.color.openPicker`
- `font.highlight` → colorSplitButton small → primary `font.highlight.applyCurrent` → state `highlightColor`
  - Palette → `font.highlight.set({color})`, No Color → `font.highlight.set({color:null})`

## 2.3 Dialog launcher
- `font.dialogLauncher` → `font.options.openDialog`

## 2.4 Collapse recipe
- Stage B: `textEffects`, `changeCase` move into overflow; low-priority toggle labels removed.
- Stage C: flyout with family/size pinned top.

---

# 3) Paragraph (groupId: `paragraph`)

## 3.1 Layout anatomy
- **Lists cluster:** Bullets, Numbering, Multilevel, Task list
- **Indent cluster:** Decrease/Increase indent
- **Marks cluster:** Show ¶, Sort (optional)
- **Alignment:** segmented left/center/right/justify
- **Spacing:** Line spacing dropdown
- **Borders/Shading:** Borders dropdown + shading picker
- **RTE Block:** Blockquote toggle + Horizontal Rule

## 3.2 Controls
- Lists:
  - `paragraph.bullets` splitButton small → `list.bullet.toggle` → state `listType`
  - `paragraph.numbering` splitButton small → `list.ordered.toggle` → state `listType`
  - `paragraph.multilevel` dropdown small → `list.multilevel.apply({templateId})` → state `listType`
  - `paragraph.taskList` toggleButton small → `list.task.toggle` → state `listType`

- Indent:
  - `paragraph.outdent` button small → `paragraph.outdent`
  - `paragraph.indent` button small → `paragraph.indent`

- Marks/sort:
  - `paragraph.sort` button small → `paragraph.sort.openDialog`
  - `paragraph.showMarks` toggleButton small → `view.formattingMarks.toggle` → state `showFormattingMarks`

- Alignment (mutually exclusive):
  - `paragraph.alignLeft` toggleButton small → `paragraph.align.set({mode:"left"})` → state `alignment`
  - `paragraph.alignCenter` → mode center
  - `paragraph.alignRight` → mode right
  - `paragraph.alignJustify` → mode justify

- Spacing:
  - `paragraph.spacing` dropdown small → state `lineSpacing`
  - Menu items:
    - 1.0 / 1.15 / 1.5 / 2.0 → `paragraph.lineSpacing.set({value})`
    - separator
    - add/remove space before/after
    - separator
    - options… → `paragraph.spacing.openDialog`

- Borders/shading:
  - `paragraph.borders` dropdown small → `paragraph.borders.set({preset})` → state `borders`
  - `paragraph.shading` colorPicker small → `paragraph.shading.set({color|null})` → state `shading`

- RTE block:
  - `paragraph.blockquote` toggleButton small → `paragraph.blockquote.toggle` → state `blockquote`
  - `paragraph.horizontalRule` button small → `insert.horizontalRule`

## 3.3 Dialog launcher
- `paragraph.dialogLauncher` → `paragraph.options.openDialog`

## 3.4 Collapse recipe
- Stage B: multilevel → overflow; then sort; then showMarks; then blockquote/hr.
- Stage C: flyout grouped into Lists / Alignment / Indent / Spacing / Borders / Block.

---

# 4) Styles (groupId: `styles`)

## 4.1 Layout anatomy
- Dominant Quick Styles gallery with scroll arrows
- Styles Pane button
- Optional Manage Styles dropdown
- Optional Style Set dropdown
- Footer: title + optional dialog launcher

## 4.2 Controls
- `styles.gallery` gallery → `styles.apply({styleId})` → state `activeStyle`, data `availableStyles`
- `styles.pane` button small → `styles.pane.open`
- `styles.manage` dropdown small → `styles.manage.openMenu` (optional)
- `styles.styleSet` dropdown small → `styles.styleSet.apply({setId})` → state `styleSet` (optional)

## 4.3 Dialog launcher (optional)
- `styles.dialogLauncher` → `styles.options.openDialog`

## 4.4 Collapse recipe
- Stage B: manage + styleSet to overflow; gallery shrinks
- Stage C: flyout with full vertical style list + management

---

# 5) Editing (groupId: `editing`)

## 5.1 Layout anatomy
- Find (split) + Replace + Select (Word-like)
- Regex + advanced toggles live in Find menu (RTE extension)

## 5.2 Controls
- `editing.find` splitButton medium → primary `editing.find.open`
  - Menu:
    - Find… → `editing.find.open`
    - Advanced Find… → `editing.find.advanced.openDialog`
    - Go To… → `editing.goto.openDialog`
    - separator
    - Regex Find (toggle) → `editing.find.regex.toggle` → state `findRegex`
    - Match Case (toggle) → `editing.find.matchCase.toggle` → state `findMatchCase`
    - Whole Words (toggle) → `editing.find.wholeWords.toggle` → state `findWholeWords`

- `editing.replace` button medium → `editing.replace.open`
- `editing.select` dropdown medium → menu:
  - Select All → `selection.selectAll`
  - Select Objects (optional) → `selection.selectObjects`
  - Select Similar Formatting (optional) → `selection.selectSimilarFormatting`

## 5.3 Collapse recipe
- Stage B: Replace moves into Find dropdown
- Stage C: flyout listing Find/Replace/Select

---

# HOME — Word-Fidelity Separators, Footers, and Icon Sizes

## Group separators (between groups only)
```css
.ribbon__group::after {
  content: "";
  position: absolute;
  top: var(--r-panel-pad-y);
  right: calc(-1 * (var(--r-group-gap) / 2));
  width: 1px;
  height: calc(100% - (var(--r-panel-pad-y) * 2));
  background: rgba(0,0,0,0.12);
}
.ribbon__group:last-child::after { display: none; }
