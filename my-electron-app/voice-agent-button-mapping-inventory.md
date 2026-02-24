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
- `agent-chat-fab` / `agent-chat-dock` z-index raised so voice UI is visible on top of app layers.
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
- Inputs and selectors controlled by voice mapping:
  - `Provider`
  - `Sort`
  - `Year from`
  - `Year to`
  - `Limit`
  - `Author contains`
  - `Venue contains`
  - `DOI only` (checkbox)
  - `Abstract only` (checkbox)

### `my-electron-app/src/panels/retrieve/SearchPanel.tsx` (`legacy query builder`)
- Buttons:
  - `Search`
  - `Load more results`
- Inputs/selectors:
  - `Provider`, `Sort`, `Year from`, `Year to`, `Limit`
  - Tag controls:
    - `Add` (tag)
    - tag chip remove (`×`)
  - Row controls are dynamic (`Load more`, `Open`, `Add tags`, etc.) and handled by visible-button matcher fallback.
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

## Mapping strategy by priority
1. **Direct action mapping first**
   - `VOICE_ACTION_MANUAL_ALIASES` + `VOICE_ACTION_SEEDS` in `src/renderer/index.ts`.
2. **Fallback voice button matcher second**
   - `VOICE_BUTTON_SELECTOR` / `getVoiceButtonCandidates()` clicks matching visible `<button>` and `[role='button']` nodes.
3. **Route-aware defaults propagation**
   - retrieve defaults updates are now emitted via `retrieve:query-defaults-updated`, with `SearchAppPanel` subscribed so voice set commands reflect immediately.

## Open items (optional hardening)
- Add golden command checks for retrieve pages (`search`, `provider`, `sort`, `years`, `limit`, and all retrieve route buttons).
