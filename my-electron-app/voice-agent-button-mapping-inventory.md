# Voice Agent Button Mapping Inventory and Retrieval Rollout Plan

## Scope
- Goal: make retrieve controls voice-addressable by either direct action mapping or visible button fallback.
- Focus areas: `my-electron-app/src/renderer/index.ts`, `my-electron-app/src/panels/retrieve/*`, and retrieval routes.
- Status now: done for action IDs and visible button fallback, with additional defaults sync for `SearchAppPanel`.

## What is now working
- `VOICE_ACTION_MANUAL_ALIASES` includes retrieve groups:
  - `retrieve-search`
  - `retrieve-set-provider`
  - `retrieve-set-sort`
  - `retrieve-set-years`
  - `retrieve-set-limit`
  - `retrieve-load-zotero`
  - `retrieve-open-batches`
  - `retrieve-open-code`
  - `retrieve-open-screen`
  - `retrieve-load-local`
  - `retrieve-export-csv`
  - `retrieve-export-excel`
  - `retrieve-resolve-na`
  - `retrieve-flag-na`
  - `retrieve-apply-codebook`
  - `retrieve-apply-coding-columns`
- `runMappedVoiceAction` keeps provider/sort/year/limit command behavior so spoken settings update defaults and navigate back to `retrieve:search`.
- `SearchAppPanel` now listens to `retrieve:query-defaults-updated` and updates:
  - `Provider`
  - `Sort`
  - `Year from`
  - `Year to`
  - `Limit`
- Ribbon actions now also inject `data-voice-aliases` automatically from `createActionButton(...)` metadata
  (`label`, `hint`, `id`, `phase`, `group`, plus manual aliases), so most tab controls are
  voice-addressable without panel-specific alias hand-maintenance.
- Non-ribbon icon/compact buttons (for example tab-close buttons, +/- expander/controls) now get
  fallback alias expansion in `getVoiceButtonCandidates()` from CSS class hints (`close`, `next`, `prev`, `refresh`, `save`, `add`, `remove`, etc.),
  glyphs (`×`, `x`, `+`, `-`) and icon/label scanning for compact controls, so spoken commands can target them as well.
- `VOICE_BUTTON_SELECTOR` now includes role-based controls, checkboxes, `select`, and number inputs so voice targeting covers non-`<button>` controls used across retrieve pages.
- `agent-chat-fab` / `agent-chat-dock` z-index raised so voice UI is visible on top of app layers.
- `DataGrid` row activation pipeline now supports role-based row buttons, keyboard activation (Enter/Space), and row-level alias injection via `onRowRender`.
- Added explicit button-level voice aliases (`data-voice-aliases`) and stable `aria-label`s to retrieve-page buttons so speech matching is reliable for click actions across:
  - Academic database controls (`Search`, `Prev`, `Next`, `Search` legacy panel actions)
  - DataHub row controls (`Load more`, `Export`).
  - Detail actions (`Open`, `Save`, `BibTeX`, `OA`, `Network Graph`, snowball variants).
  - Citation graph controls (`Back`, `Close`, `Fullscreen`, `Detach`).
  - Zotero loader/selection controls (`Refresh`, `Load Collection`, collection rows, tags, tags chips, item rows).
  - Zotero item selection rows (`Select item` aliases).
  - Zotero detail tabs (`Info`, `Tags & Extras`, `Collection`).

## Retrieve Tab action matrix (direct mapped actions)
`my-electron-app/src/ribbon/RetrieveTab.ts`
- `retrieve-search` — Search (group: Academic Databases)
- `retrieve-set-provider` — Provider (group: Academic Databases)
- `retrieve-set-sort` — Sort (group: Academic Databases)
- `sort year` / `sort by year` commands are documented under direct sort handling.
- `retrieve-set-years` — Years (group: Academic Databases)
- `retrieve-set-limit` — Limit (group: Academic Databases)
- `retrieve-load-zotero` — Zotero (group: Zotero Loader)
- `retrieve-open-batches` — Batches (group: Zotero Loader)
- `retrieve-open-code` — Code (group: Zotero Loader)
- `retrieve-open-screen` — Screen (group: Zotero Loader)
- `retrieve-load-local` — Local (group: Data Loader)
- `retrieve-export-csv` — Export CSV (group: Export)
- `retrieve-export-excel` — Export Excel (group: Export)
- `retrieve-resolve-na` — Resolve NA (group: Tidying Data)
- `retrieve-flag-na` — Flag NA (group: Tidying Data)
- `retrieve-apply-codebook` — Apply Codebook (group: Tidying Data)
- `retrieve-apply-coding-columns` — Apply Coding (group: Tidying Data)

## Retrieve route button inventory from concrete panels
### `my-electron-app/src/panels/retrieve/SearchAppPanel.tsx` (`retrieve:search`)
- Buttons:
  - `Search`
  - `Prev`
  - `Next`
  - `Export current`
- Search result rows are now mapped with generated aliases:
  - `row N`
  - `result row N`
  - `select row N`
  - `open row N`
  - plus title/source/year/doi/paper id when available.
- Inputs and selectors controlled by voice mapping:
  - `Provider` (`data-voice-aliases="provider,provider selector,search provider,database provider"`)
  - `Sort` (`data-voice-aliases="sort,result sort,order by"`)
  - `Year from` (`data-voice-aliases="year from,publication year from,from year"`)
  - `Year to` (`data-voice-aliases="year to,publication year to,to year"`)
  - `Limit` (`data-voice-aliases="limit,results limit,result count"`)
  - `query input` (`data-voice-aliases="search query,query,search terms,academic search text"`)
  - `Author contains`
  - `Venue contains`
  - `DOI only` (checkbox)
  - `Abstract only` (checkbox)

### `my-electron-app/src/panels/retrieve/SearchPanel.tsx` (`legacy query builder`)
- Buttons:
  - `Search`
  - `Load more results`
- Search result rows are rendered as button-like targets with direct aliases:
  - `row N`
  - `select row N`
  - `open row N`
- Inputs/selectors:
  - `Provider` (`data-voice-aliases="provider,provider selector,search provider,database provider"`)
  - `Sort` (`data-voice-aliases="sort,result sort,order by"`)
  - `Year from` (`data-voice-aliases="year from,publication year from,from year"`)
  - `Year to` (`data-voice-aliases="year to,publication year to,to year"`)
  - `Limit` (`data-voice-aliases="limit,results limit,result count"`)
  - `query input` (`data-voice-aliases="search query,query,search terms,academic search text"`)
  - Tag controls:
    - `Add` (tag)
    - tag chip remove (`×`)
  - Added `aria-label` + `data-voice-aliases` for direct targeting of `Search`, `Load more`, `Add`, `Remove`.

### `my-electron-app/src/panels/retrieve/SearchMetaPanel.tsx` (`retrieve-search-selected` meta panel)
- Buttons:
  - `Open`
  - `Network Graph`
  - `Snowball: References`
  - `Snowball: Citations`
  - `Save`
  - `BibTeX`
  - `OA`
  - `Add` (tag add)
  - tag chip remove (`×`)

### `my-electron-app/src/panels/retrieve/CitationGraphPanel.tsx` (`retrieve:graph`)
- `Back`
- `Detach`
- `Fullscreen`
- `Close`

### `my-electron-app/src/panels/retrieve/ZoteroCollectionsPanel.tsx` (`retrieve:zotero` left pane)
- `Refresh` (label changes to `Reload Batches` in batch mode)
- `Load Collection` (hidden while in batch mode)
- collection row label buttons (`... [collection name]`) for tree selection
- expander controls (`+` / `-`) for nested folders
- tag chips (`button`, chip label + count)
- search input and tags filter text input are exposed to focus/input, not click navigation

### `my-electron-app/src/panels/retrieve/ZoteroItemsPanel.tsx` (`retrieve:zotero` middle pane)
- Item row buttons for selection (`button` wrappers around each row)
  - Added `aria-label` + `data-voice-aliases` with title and key for direct spoken selection.

### `my-electron-app/src/panels/retrieve/ZoteroDetailPanel.tsx` (`retrieve:zotero` right pane)
- Vertical tab buttons: `Info`, `Tags & Extras`, `Collection` (icon-only labels)
- Vertical tab buttons now include `data-voice-aliases` so "open info", "open tags", etc. resolve reliably.
- Collection tag chips remain non-button; detail rows are loaded from selected item context.

### `my-electron-app/src/panels/retrieve/DataGrid.ts`
- Row behavior:
  - Rows now expose role-based activation for voice fallback matching.
  - Enter/Space key activation support added for keyboard-driven selection.
  - `onRowRender` hook allows row aliases and labels from caller context.

## Mapping strategy by priority
1. **Direct action mapping first**
   - `VOICE_ACTION_MANUAL_ALIASES` + `VOICE_ACTION_SEEDS` in `src/renderer/index.ts`.
2. **Fallback voice button matcher second**
   - `VOICE_BUTTON_SELECTOR` / `getVoiceButtonCandidates()` matches visible `<button>`, controls roles, `select`, and numeric inputs.
3. **Route-aware defaults propagation**
   - retrieve defaults updates are now emitted via `retrieve:query-defaults-updated`, with `SearchAppPanel` subscribed so voice set commands reflect immediately.

## Open items (optional hardening)
- Continue expanding coverage for non-retrieve pages if needed (large button sets in coder/analysis screens).

## Global voice console status
- Bottom-right agentic icon (`#agentChatFab`) is globally visible across the app:
  - `shouldShowAgentChat()` returns `true` (no route-based gating).
  - `.agent-chat-fab` is fixed to the bottom-right via CSS (`right: 12px; bottom: 24px;`) and layered above app content (`z-index: 2147483647`).
- Recording/playing pulse animation is applied to both FAB and mic:
  - `recording`/`playing` classes on `#agentChatFab` mirror mic state.
  - Theme values are injected from active TTS/STT settings via `resolveAgentVoicePulseTheme`.
- Existing retrieve-route button and control alias coverage remains in place and is tracked in this inventory (`SearchAppPanel`, `SearchPanel`, Zotero panels, retrieve ribbon actions).

## Non-retrieve button expansion (current pass)

### `my-electron-app/src/panels/code/CodePanel.ts`
- `+` button (research question creation): now mapped to `add question / add research question`.
- `Code Corpus →` CTA: now mapped to `jump to code corpus`, `open corpus`, and `coder corpus`.

### `my-electron-app/src/panels/write/WritePanel.ts`
- Reference picker action row:
  - `Select all` → `select all references`
  - `Clear` → `clear selection`
  - `Cancel` → `cancel / close`
  - `Insert selected` → `insert selected references`
- Reference action dialog `Close`: `close dialog / close window`.

### `my-electron-app/src/panels/coder/CoderPanel.ts`
- Header/settings and action buttons now set explicit `aria-label` and `data-voice-aliases` at source:
  - `⚙` settings button
  - all action chips, status chips, and row icon buttons (`Rename`, `Delete`, `Next/Previous`, etc.) via helper wiring
  - context-menu actions and settings menu actions
  - help/diagnostic/file/preview overlays (close/undo/clear/copy actions)

### `my-electron-app/src/panels/PanelLayoutRoot.ts`
- Tab close button now exposes `close tab`, `close tool tab`, and `remove tab` aliases.

### Renderer matcher improvements (`src/renderer/index.ts`)
- Added glyph-to-phrase fallbacks for additional icon-only controls:
  - `⚙` → `settings / options / preferences`
  - `✎` → `rename / edit`
  - `🗑` → `delete / trash`
  - `i` → `include / included`
  - `?` → `maybe`
- Fixed Base64 audio blob decode typing to avoid shared buffer mismatch:
  - `decodeBase64ToBytes()` now uses a typed `Uint8Array(length)` path.
