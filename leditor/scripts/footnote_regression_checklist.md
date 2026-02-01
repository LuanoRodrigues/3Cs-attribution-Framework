# Footnote Regression Checklist

Goal: verify that footnote layout never overlaps body text, never shows a footnote scrollbar,
and body text jumps to the next page immediately when footnotes grow.

## Prep
- Build: `npm run build:electron`
- Launch: `npm run start:dev` (or your normal start command)
- Optional debug overlays:
  - Open devtools console and run:
    - `window.__leditorFootnoteLayoutDebug = true`

## Repro Template (Minimal)
Option A (fixture):
1. Run `node scripts/pagination_fixture.mjs` (creates `docs/test_documents/footnote_regression.json`).
2. Open the fixture file in LEDitor.
3. Click the footnote marker and edit the footnote text.

Option B (manual):
1. New document.
2. Paste a long paragraph until the first page is ~90% full.
3. Insert a footnote marker near the bottom of the page (last or second‑last line).
4. Click the footnote text area.

## Tests
1. **Single‑line growth**
   - Type a short footnote (1 line).
   - Expected: no overlap; body line above footnote remains visible; no footnote scrollbar.
2. **Line‑by‑line growth**
   - Press Enter (or type enough text to wrap) to create 3–5 lines.
   - Expected: each new line immediately pushes body content down; if body exceeds page, it
     jumps to the next page on that keystroke (no delay).
3. **Near‑full page**
   - Ensure body is full to the bottom line.
   - Add a new footnote line.
   - Expected: last body line jumps to next page immediately; no overlap.
4. **Long footnote cap**
   - Keep adding lines until footnote is large.
   - Expected: footnote stops growing around ~35% of page height; body still shows at least one line.
5. **Exit footnote mode**
   - Click back into body text.
   - Expected: caret restores correctly; no scroll jump.
6. **Zoom & font changes**
   - Change zoom and font size; repeat steps 1–3.
   - Expected: same behavior (no overlap, instant jump).

## Pass/Fail Notes
- Record page number, zoom, and whether overlap/scrollbar was observed.
- If overlap occurs, capture a screenshot and keep `window.__leditorFootnoteLayoutDebug = true`
  so the overlay shows computed height and gap.
