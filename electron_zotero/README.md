# Electron Zotero UI (Back_end_assis)

Internal Electron Zotero control UI inspired by TEIA Retrieve/DataHub patterns.

## Features

- Fetch full Zotero collection tree (folders + subfolders)
- Show item previews directly inside expanded folder tree (Zotero-like)
- Search/filter collections and items
- Load collection items from cache or fresh API
- Select items and inspect metadata
- Fetch and inspect item children (attachments/notes/annotations)
- Context menus for collection/item/child actions
- Advanced search modal with saved-search persistence
- Virtualized item list rendering for large collections
- Desktop menu + global shortcuts (`Cmd/Ctrl+Shift+F`, `Cmd/Ctrl+Shift+S`, `Cmd/Ctrl+Shift+O`)
- Reader window support (for `http/https/file` reader targets)
- Local persistence/sync scaffold (JSON-backed local DB + sync state machine)
- Main Zotero function buttons:
  - refresh tree
  - purge cache
  - sync now
  - advanced search
  - open reader
  - load selected collection (cache/fresh)
  - open selected collection/item in Zotero
  - open item URL/DOI/PDF
  - copy collection/item keys

## Environment

Create `Back_end_assis/.env` (or `electron_zotero/.env`) with:

```env
LIBRARY_ID="your_library_id"
LIBRARY_TYPE="user" # or "group"
API_KEY="your_zotero_api_key"
```

Accepted alternatives:

- `ZOTERO_LIBRARY_ID`
- `ZOTERO_LIBRARY_TYPE`
- `ZOTERO_API_KEY`

## Run

```bash
cd electron_zotero
npm install
npm run start
```

## Notes

- Cache is stored in Electron userData under `zotero-cache`.
- Local persistent metadata is stored in Electron userData under `zotero_local_db.json`.
- Tree/items can be refreshed without restarting the app.
- Performance/cache strategy:
  - In-memory hot cache for collections/items/children.
  - Disk cache with TTL (`collections: 60m`, `items: 30m`, `children: 10m`).
  - In-flight request deduplication (parallel same-key requests reuse one fetch).
  - Renderer search debounce + stale-response guards to avoid UI thrash.
  - Virtualized item viewport (windowed rendering) for large loaded result sets.
