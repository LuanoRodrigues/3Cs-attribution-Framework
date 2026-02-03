# Context Menu Combobox (Agent / Dictionary / Ref)

## Goal
Replace the current “flat” editor context menu with a compact, category-driven UI that only exposes:

- **Agent** (AI editing actions)
- **Dictionary** (lexicon helpers: definition/synonyms/antonyms/collocation)
- **Ref** (reference workflow: picker/bibliography/style/update)

and removes unrelated editor formatting controls (bold/italic/clear formatting, table insert, footnote panel).

## Success criteria
- Right-click in the editor shows a **single** menu with a category selector (“combobox-like”).
- Category selector switches the action list with **no flicker** and no selection loss.
- Dictionary items that require a selection are **disabled** when no selection exists.
- Menu never renders off-screen (clamped).
- Agent/Dictionary/Ref actions route through the existing command/event bridges:
  - Agent actions → `EditorHandle.execCommand("agent.action", { id })`
  - Ref actions → `window.dispatchEvent("leditor-context-action")` + optional host bridge `leditorHost.onContextAction`
- Zero context-menu entries remain for: Bold/Italic/ClearFormatting/TableInsert/FootnotePanel.

## Non-goals (explicitly out of scope for this plan)
- Implementing new LLM endpoints or providers.
- Changing ribbon layout.
- Changing document schema.

## Architecture + wiring
### UI structure
- Context menu container: `.leditor-context-menu`
- Category selector row: `.leditor-context-menu__header`
- Category tabs: `.leditor-context-menu__tab` (active = `.is-active`)
- Action list: `.leditor-context-menu__items`
- Action button: `.leditor-context-menu__item`

### Categories and actions
**Agent**
- refine / paraphrase / shorten / proofread / substantiate
- check_sources / clear_checks

**Dictionary**
- synonyms / antonyms (requires selection)
- (planned next) definition / collocation (requires selection)

**Ref**
- open picker, insert bibliography, update from editor, style presets
- link context: edit link, remove link

### Context gating rules
- If the right-click context is inside an image → no menu.
- If inside tables → menu suppressed (no table actions exposed).
- Dictionary items are disabled if selection is empty.

### Selection stability
- Preserve the “Word-like” behavior already implemented: right-click in an existing selection does not collapse it.

## Implementation steps
1) Refactor `src/ui/context_menu.ts`:
   - Replace `buildMenuItems(context)` with `buildMenuGroups(context)` returning `{ agent, dictionary, ref }`.
   - Render menu with header + items container and switch active group in-place.
   - Clamp the menu within viewport after mount.
2) Update styling in `src/ui/theme.css`:
   - Add styles for `__header`, `__tab`, `__items`, `__item`, and disabled state.
3) Validate command routing:
   - Agent commands dispatch to `agent.action`.
   - Ref actions dispatch to `leditor-context-action`.
4) Regression checks:
   - Right-click in selection keeps selection.
   - Right-click with no selection disables dictionary actions.
   - Menu closes on click outside, scroll, ESC.

## Follow-ups (next iteration)
- Add Dictionary “Definition” + “Collocation”:
  - Extend `leditorHost.lexicon` contract to accept modes `definition` and `collocation` (or add a new host method).
  - Reuse the existing popup UI used by synonyms/antonyms.
- Add keyboard navigation within the menu (arrow keys) for accessibility.

## Validation
- `npm run typecheck`
- `npm run build`

## Rollback
- Revert `src/ui/context_menu.ts` and `src/ui/theme.css` changes and rebuild.

