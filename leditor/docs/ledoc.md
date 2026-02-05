# `.ledoc` (LEditor Document Bundle)

`.ledoc` is a zip-based bundle used to move an editor document between the standalone `leditor` app and the desktop shell.

## What’s inside

The bundle is defined in `leditor/src/ledoc/format.ts` and uses these paths:
- `document.json`: canonical ProseMirror/TipTap JSON document
- `meta.json`: title, timestamps, app version
- `settings.json`: page/margins and other editor settings
- `footnotes.json`: footnote registry payload (id/text/index)
- `styles.json`: optional style payload
- `history.json`: optional history payload (source-check thread, agent history)
- `preview.png`: optional thumbnail/preview
- `media/`: optional directory for future embedded media

## Exporting
- In the Electron build, export uses the host bridge (`leditorHost.exportLEDOC`) to show a save prompt and write the bundle.
- Default suggested filename is derived from the current document title and saved with a `.ledoc` extension.

## Importing
- Import uses the host bridge (`leditorHost.importLEDOC`) to pick/read a `.ledoc` bundle and restore:
  - `document.json` into the editor
  - `settings.json` (page size/margins, etc.)
  - title (from `meta.json`)
- The last imported `.ledoc` path is cached in `localStorage` under `leditor.lastLedocPath` for optional auto-reopen flows.
