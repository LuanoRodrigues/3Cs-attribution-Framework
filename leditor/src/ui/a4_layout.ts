import { getFootnoteRegistry } from "../extensions/extension_footnote.ts";
import { allocateSectionId, defaultSectionMeta, parseSectionMeta, type SectionMeta } from "../editor/section_state.ts";
import interact from "interactjs";
import nouislider from "nouislider";
import "nouislider/dist/nouislider.css";
import opentype from "opentype.js";
import {
  getLayoutColumns,
  getOrientation,
  getMarginValues,
  getCurrentPageSize,
  setPageMargins,
  resetMargins,
  setSectionColumns,
  subscribeToLayoutChanges
} from "../ui/layout_settings.ts";
import type { MarginValues } from "../ui/layout_settings.ts";
import { THEME_CHANGE_EVENT } from "./theme_events.ts";
import {
  applyDocumentLayoutTokenDefaults,
  applyDocumentLayoutTokens
} from "./pagination/index.ts";
import { featureFlags } from "../ui/feature_flags.ts";
import type { EditorHandle } from "../api/leditor.ts";
import { reconcileFootnotes } from "../uipagination/footnotes/registry.ts";
import { paginateWithFootnotes, type PageFootnoteState } from "../uipagination/footnotes/paginate_with_footnotes.ts";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { StoredSelection } from "../utils/selection_snapshot";
import { applySnapshotToTransaction } from "../utils/selection_snapshot";
import type { FootnoteRenderEntry, FootnoteKind } from "../uipagination/footnotes/model.ts";

type A4ViewMode = "single" | "fit-width" | "two-page";
type GridMode = "stack" | "grid-2" | "grid-4" | "grid-9";
type InteractDragEvent = {
  pageX: number;
};

type A4LayoutController = {
  updatePagination: () => void;
  destroy: () => void;
  setZoom: (value: number) => void;
  getZoom: () => number;
  setViewMode: (mode: A4ViewMode) => void;
  getViewMode: () => A4ViewMode;
  getPageCount: () => number;
  setHeaderContent: (html: string) => void;
  setFooterContent: (html: string) => void;
  getHeaderContent: () => string;
  getFooterContent: () => string;
  enterHeaderFooterMode: (target?: "header" | "footer") => void;
  exitHeaderFooterMode: () => void;
  isHeaderFooterMode: () => boolean;
  setTheme: (mode: "light" | "dark", surface?: "light" | "dark") => void;
  toggleTheme: () => void;
  togglePageSurface: () => void;
  getTheme: () => { mode: "light" | "dark"; surface: "light" | "dark" };
  setMargins: (values: Partial<MarginValues> & { inside?: string; outside?: string }) => void;
  setContentFrameHeight: (value: number) => void;
  adjustContentFrameHeight: (delta: number) => void;
  resetContentFrameHeight: () => void;
};

type A4LayoutOptions = {
  headerHtml?: string;
  footerHtml?: string;
};

const STYLE_ID = "leditor-a4-layout-styles";
const PAGE_BOUNDARY_KINDS = new Set(["page", "section_next", "section_even", "section_odd"]);

const DEFAULT_SECTION_ID = allocateSectionId();
type PageSectionInfo = {
  sectionId: string;
  meta: SectionMeta;
  parity: "odd" | "even";
};
const sectionHeaderContent = new Map<string, string>();
const sectionFooterContent = new Map<string, string>();
let pageSections: PageSectionInfo[] = [];
const SECTION_KINDS = new Set(["section_next", "section_continuous", "section_even", "section_odd"]);
let didLogLayoutDebug = false;

const createGlyphEntry = (unicode: number, advanceWidth: number) =>
  new opentype.Glyph({
    name: `glyph-${unicode}`,
    unicode,
    advanceWidth
  });

const glyphAdvance: Record<string, number> = {
  " ": 420,
  M: 620,
  m: 600,
  "0": 520,
  "1": 520,
  "2": 520,
  "3": 520,
  "4": 520,
  "5": 520,
  "6": 520,
  "7": 520,
  "8": 520,
  "9": 520
};

const measureTextWidth = (text: string, size = 12) => {
  let advance = 0;
  for (const ch of text) {
    advance += glyphAdvance[ch] ?? 520;
  }
  return (advance / 1000) * size;
};

const ensureStyles = () => {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
:root {
  --page-width-mm: 210;
  --page-height-mm: 297;
  --page-width: calc(var(--page-width-mm) * 1mm);
  --page-height: calc(var(--page-height-mm) * 1mm);
  --page-width-landscape: calc(var(--page-height-mm) * 1mm);
  --page-height-landscape: calc(var(--page-width-mm) * 1mm);
  --page-width-letter-mm: 215.9;
  --page-height-letter-mm: 279.4;
  --page-width-letter: calc(var(--page-width-letter-mm) * 1mm);
  --page-height-letter: calc(var(--page-height-letter-mm) * 1mm);
  --page-margin-top: 2.5cm;
  --page-margin-right: 2.5cm;
  --page-margin-bottom: 2.5cm;
  --page-margin-left: 2.5cm;
  --page-margin-narrow: 0.5in;
  --page-margin-moderate-vertical: 1in;
  --page-margin-moderate-horizontal: 0.75in;
  --heading1-break-before: page;
  --heading1-break-after: avoid;
  --heading2-break-after: avoid;
  --widow-lines: 2;
  --orphan-lines: 2;
  --header-height: 0.5in;
  --footer-height: 0.5in;
  --header-offset: 0px;
  --footer-offset: 0px;
  --footnote-area-height: 0.55in;
  /* Reserve space for footnotes only when the page actually has footnote entries. */
  --page-footnote-height: 0px;
  --footnote-separator-height: 1px;
  --footnote-separator-color: rgba(0, 0, 0, 0.25);
  --footnote-spacing: 6px;
  --footnote-font-size: 11px;
  --page-break-line-height: 1px;
  --page-break-line-style: dashed;
  --page-break-line-color: rgba(46, 46, 46, 0.45);
  --page-bg-light: #ffffff;
  --page-bg-dark: #1b1b1b;
  --page-bg: var(--page-bg-light);
  --page-border-color: rgba(0, 0, 0, 0.12);
  --page-border-color-dark: rgba(255, 255, 255, 0.16);
  --page-border-width: 1px;
  --page-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
  --page-shadow-dark: 0 16px 40px rgba(0, 0, 0, 0.55);
  --page-gap: 16px;
  --page-margin-inside: 2.5cm;
  --page-margin-outside: 2.5cm;
  --column-separator-color: rgba(0, 0, 0, 0.25);
  --page-canvas-bg: radial-gradient(circle at 18% 18%, #f8f9fb 0%, #e9ecf3 45%, #d8dbe6 90%);
  --page-canvas-bg-dark: radial-gradient(circle at 30% 16%, #1d2431 0%, #141924 55%, #0c1018 100%);
  --min-zoom: 0.3;
  --max-zoom: 3;
  --zoom-step: 0.1;
  --page-zoom: 1;
  --ruler-height: 24px;
  --ruler-color: rgba(0, 0, 0, 0.55);
  --ruler-bg: rgba(255, 255, 255, 0.7);
  --ruler-border: rgba(0, 0, 0, 0.2);
  --page-font-family: "Times New Roman", "Times", "Georgia", serif;
  --page-font-size: 12pt;
  --page-line-height: 1.15;
  --page-body-color: #1c1c1c;
  --page-header-color: #2d2d2d;
  --page-footer-color: #3a3a3a;
  --page-footnote-color: #4c4c4c;
  --ui-surface: rgba(255, 255, 255, 0.9);
  --ui-surface-dark: rgba(24, 28, 36, 0.85);
  --ui-text: #1b1b1b;
  --ui-text-inverse: #f7f7f7;
  /* Slightly tighter overall UI scale (renderer can override). */
  --ui-scale: 1.5;
}

html, body {
  height: 100%;
  overflow: hidden;
}
.leditor-app {
  position: relative;
  /* Scale the whole app without shifting the visual center. */
  min-height: calc(100dvh / var(--ui-scale));
  height: calc(100dvh / var(--ui-scale));
  width: calc(100dvw / var(--ui-scale));
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--page-canvas-bg);
  overflow: hidden;
  color: var(--ui-text);
  --leditor-ribbon-height: 0px;
  --leditor-header-height: 0px;
  transform: scale(var(--ui-scale));
  transform-origin: top left;
}

.leditor-app-header {
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  z-index: 1000;
  background: var(--r-bg);
}

.leditor-doc-shell {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  /* Single scroll container for the document surface. */
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 0;
}

.leditor-split-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  overflow: hidden;
}

.leditor-editor-pane {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  /* Keep centering accurate; "both-edges" reserves space on the left too and shifts the page right. */
  scrollbar-gutter: stable;
}

.leditor-editor-pane.is-split {
  flex: 1 1 60%;
}

.leditor-pdf-pane {
  flex: 0 0 40%;
  min-width: 320px;
  max-width: 760px;
  display: none;
  flex-direction: column;
  background: rgba(10, 14, 20, 0.92);
  border-left: 1px solid rgba(148, 163, 184, 0.25);
  overflow: hidden;
}

.leditor-pdf-pane.is-open {
  display: flex;
}

.leditor-pdf-header {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.25);
  color: #f1f5f9;
  position: sticky;
  top: 0;
  z-index: 2;
  background: rgba(10, 14, 20, 0.92);
}

.leditor-pdf-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  font-weight: 650;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.leditor-pdf-close {
  flex: 0 0 auto;
  border: 1px solid rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.06);
  color: #f1f5f9;
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.leditor-pdf-close:hover {
  background: rgba(255, 255, 255, 0.1);
}

.leditor-pdf-frame {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #0b1220;
}

.leditor-toc {
  margin: 24px auto;
  width: min(720px, 100%);
  padding: 18px 24px;
  border-radius: 12px;
  background: var(--ui-surface);
  border: 1px solid rgba(0, 0, 0, 0.2);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.12);
}
.leditor-toc[data-toc-style="auto2"] {
  background: rgba(235, 243, 255, 0.85);
  border-color: rgba(30, 126, 234, 0.35);
  box-shadow: 0 12px 32px rgba(30, 126, 234, 0.15);
}
.leditor-toc-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--ui-text);
}
.leditor-toc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.leditor-toc-entry {
  border: none;
  appearance: none;
  text-align: left;
  padding: 8px 0;
  font-size: 14px;
  background: none;
  cursor: pointer;
  border-bottom: 1px dashed rgba(0, 0, 0, 0.15);
  color: var(--ui-text);
}
.leditor-toc-entry:last-child {
  border-bottom: none;
}
.leditor-toc-entry:hover {
  color: #1c64f2;
}
.leditor-toc[data-toc-style="auto2"] .leditor-toc-entry {
  border-bottom-color: rgba(30, 126, 234, 0.4);
}

.leditor-app .ProseMirror a,
.leditor-app .ProseMirror a * {
  color: #5dd5ff;
  text-decoration: underline;
  cursor: pointer;
}

.leditor-app .ProseMirror a.leditor-citation-anchor {
  display: inline-block;
  background: rgba(93, 213, 255, 0.14);
  border: 1px solid rgba(93, 213, 255, 0.35);
  border-radius: 6px;
  padding: 1px 4px;
}

@keyframes leditor-citation-flash {
  0% { box-shadow: 0 0 0 0 rgba(93, 213, 255, 0.0); transform: translateY(0); }
  20% { box-shadow: 0 0 0 3px rgba(93, 213, 255, 0.30); transform: translateY(-0.5px); }
  100% { box-shadow: 0 0 0 0 rgba(93, 213, 255, 0.0); transform: translateY(0); }
}

.leditor-app .ProseMirror a.leditor-citation-anchor.leditor-citation-anchor--flash {
  animation: leditor-citation-flash 0.6s ease-out;
}

.leditor-app.theme-dark {
  --page-canvas-bg: var(--page-canvas-bg-dark);
  --page-border-color: var(--page-border-color-dark);
  --page-shadow: var(--page-shadow-dark);
  --page-body-color: #f4f6f8;
  --page-header-color: #f1f3f5;
  --page-footer-color: #d7d8e4;
  --page-footnote-color: #c1c4cf;
  color-scheme: dark;
  color: var(--ui-text-inverse);
  background: var(--page-canvas-bg);
}

.leditor-app.page-surface-dark {
  --page-bg: var(--page-bg-dark);
  --page-border-color: var(--page-border-color-dark);
  --page-shadow: var(--page-shadow-dark);
}

#toolbar {
  flex: 0 0 auto;
  width: 100%;
  z-index: 4;
}


.leditor-a4-canvas {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  /* Bring the first page closer to the ribbon. */
  padding: 12px 20px 64px;
  background: var(--page-canvas-bg);
  overflow: visible;
}

.leditor-a4-zoom {
  position: relative;
  width: 100%;
  max-width: 100%;
  margin: 0;
  /* Size is computed in JS; keep it visually centered. */
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.leditor-a4-zoom-content {
  transform-origin: top center;
  width: fit-content;
  position: relative;
}

.leditor-page-stack,
.leditor-page-overlays {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--page-gap);
  width: fit-content;
  margin: 0 auto;
}

.leditor-page-overlays {
  pointer-events: none;
}

.leditor-page-stack.is-two-page,
.leditor-page-overlays.is-two-page {
  display: grid;
  grid-template-columns: repeat(2, var(--page-width));
  justify-content: center;
  width: calc(var(--page-width) * 2 + var(--page-gap));
  margin: 0 auto;
}

.leditor-page-stack {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}


.leditor-page {
  width: var(--local-page-width, var(--page-width));
  height: var(--local-page-height, var(--page-height));
  background: var(--page-bg);
  border: var(--page-border-width) solid var(--page-border-color);
  box-shadow: var(--page-shadow);
  border-radius: 6px;
  position: relative;
  overflow: hidden;
  box-sizing: border-box;
}

.leditor-page.is-landscape,
.leditor-page-overlay.is-landscape {
  --local-page-width: var(--page-height);
  --local-page-height: var(--page-width);
}

.leditor-footnote-list,
.leditor-endnotes-entries {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.leditor-footnote-entry,
.leditor-endnote-entry {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: var(--footnote-font-size);
  line-height: 1.4;
  cursor: text;
}

.leditor-footnote-entry-number,
.leditor-endnote-entry-number {
  font-weight: 600;
  min-width: 1.5em;
  user-select: none;
}

.leditor-footnote {
  position: relative;
  display: inline-flex;
  align-items: baseline;
}

.leditor-footnote-marker {
  font-size: 0.7em;
  line-height: 1;
  vertical-align: super;
  font-variant-position: super;
  position: relative;
  top: -0.35em;
  cursor: pointer;
}

.leditor-footnote-entry.leditor-footnote-entry--active {
  background: rgba(255, 228, 140, 0.35);
  border-radius: 4px;
}

.leditor-footnote-popover {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  left: 0;
  display: none;
}

.leditor-footnote-entry-text,
.leditor-endnote-entry-text {
  flex: 1;
  white-space: pre-wrap;
  outline: none;
  display: inline-block;
  min-width: 0.5ch;
  min-height: 1em;
  cursor: text;
  caret-color: currentColor;
}

.leditor-footnote-entry-text:empty::before {
  content: attr(data-placeholder);
  opacity: 0.55;
}

.leditor-endnote-entry-text:empty::before {
  content: attr(data-placeholder);
  opacity: 0.55;
}

.leditor-endnote-empty {
  color: rgba(0, 0, 0, 0.45);
  font-size: 11px;
  font-style: italic;
}

.leditor-page-footer .leditor-page-number {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-size: 10pt;
  color: var(--page-footer-color);
}

/* overlay/content frame styles removed */



/* overlay/content frame styles removed */

.leditor-page-footer .leditor-page-number {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
  font-size: 10pt;
  color: var(--page-footer-color);
}

.leditor-page-number {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
}

/* overlay/content layer removed – real content lives inside .leditor-page-content */

.leditor-page-overlays {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  transform: none;
  width: fit-content;
  /* Keep overlays above the page stack so header/footer text is visible. */
  z-index: 3;
  /* Allow interaction only where children opt-in with pointer-events: auto. */
  pointer-events: auto;
}

.leditor-page-overlay {
  width: var(--page-width);
  height: var(--page-height);
  position: relative;
  pointer-events: none;
}

.leditor-page-overlay .leditor-page-header,
.leditor-page-overlay .leditor-page-footer {
  pointer-events: none;
}

.leditor-page-overlay .leditor-page-footnotes {
  display: block;
  min-height: var(--footnote-area-height);
  pointer-events: none;
}

.leditor-margin-guide {
  position: absolute;
  top: calc(var(--local-page-margin-top, var(--page-margin-top)) + var(--header-height) + var(--header-offset));
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  bottom: calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-height) + var(--footer-offset) + var(--footnote-area-height));
  border: 1px dashed rgba(200, 40, 40, 0.65);
  border-radius: 2px;
  pointer-events: none;
  display: none;
  box-sizing: border-box;
}

.leditor-debug-margins .leditor-margin-guide {
  display: block;
}

.leditor-debug-margins .leditor-margins-frame {
  outline: 1px dashed rgba(200, 40, 40, 0.35);
  outline-offset: -1px;
}

.leditor-header-footer-editing .leditor-page-overlays {
  pointer-events: auto;
}

.leditor-header-footer-editing .leditor-page-overlay {
  pointer-events: auto;
}

.leditor-header-footer-editing .leditor-page-overlay .leditor-page-header,
.leditor-header-footer-editing .leditor-page-overlay .leditor-page-footer {
  pointer-events: auto;
  opacity: 1;
  color: var(--page-header-color);
  outline: none;
  background: transparent;
}

.leditor-header-footer-editing .leditor-page-overlay .leditor-page-header[data-leditor-placeholder]:empty::before {
  content: attr(data-leditor-placeholder);
  opacity: 0.65;
  pointer-events: none;
}

.leditor-page-header[data-leditor-placeholder]:empty::before,
.leditor-page-footer[data-leditor-placeholder]:empty::before,
.leditor-page-footnotes[data-leditor-placeholder]:empty::before {
  content: attr(data-leditor-placeholder);
  opacity: 0.65;
  pointer-events: none;
}

.leditor-header-footer-editing .leditor-page-content {
  pointer-events: none;
}

.leditor-header-footer-editing #editor .ProseMirror {
  pointer-events: none;
}

.leditor-footnote-editing .leditor-page-overlays {
  pointer-events: auto;
}

/* In footnote editing mode, only the footnote area should capture pointer events.
   The rest of the overlay must be transparent so clicks in the body fall through. */
.leditor-footnote-editing .leditor-page-overlay {
  pointer-events: none;
}

.leditor-footnote-editing .leditor-page-overlay .leditor-page-footnotes {
  pointer-events: auto;
}

/* Allow clicking the body to exit footnote mode. The editor is still non-editable via JS. */
.leditor-footnote-editing .leditor-page-content {
  pointer-events: auto;
}

.leditor-footnote-editing #editor .ProseMirror {
  pointer-events: auto;
}

/* Hide the non-editable header/footer clones inside the page stack while editing overlays. */
.leditor-header-footer-editing .leditor-page-stack .leditor-page-header,
.leditor-header-footer-editing .leditor-page-stack .leditor-page-footer {
  opacity: 0;
  pointer-events: none;
}

/* Prefer overlay header/footer as the visible source-of-truth; avoid double-rendering. */
.leditor-page-stack .leditor-page .leditor-page-header,
.leditor-page-stack .leditor-page .leditor-page-footer,
.leditor-page-stack .leditor-page .leditor-page-footnotes,
.leditor-page-stack .leditor-page .leditor-footnote-continuation {
  display: none;
}

.leditor-page-overlay .leditor-page-header,
.leditor-page-overlay .leditor-page-footer {
  position: absolute;
  left: var(--current-margin-left, var(--page-margin-left));
  right: var(--current-margin-right, var(--page-margin-right));
}

.leditor-page-overlay .leditor-page-header {
  top: var(
    --doc-header-distance,
    calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-offset))
  );
  height: var(--header-height);
  color: var(--page-header-color);
}

.leditor-page-overlay .leditor-page-footer {
  bottom: var(
    --doc-footer-distance,
    calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
  );
  height: var(--footer-height);
}

.leditor-page-overlay .leditor-page-footnotes {
  /* Footnotes render in the overlay so they can be edited without ProseMirror stealing focus. */
  display: block;
  min-height: var(--footnote-area-height);
}
.leditor-page-overlay .leditor-page-footnotes.leditor-page-footnotes--active {
  pointer-events: auto;
}

#editor {
  width: 100%;
  margin: 0;
  box-sizing: border-box;
  padding: 0;
}

#editor .ProseMirror {
  width: 100%;
  max-width: 100%;
  outline: none;
  border: none;
  box-shadow: none;
  background: transparent;
  font-family: var(--page-font-family);
  font-size: var(--page-font-size);
  line-height: var(--page-line-height);
  color: var(--page-body-color);
  min-height: 1px;
  overflow-wrap: anywhere;
  word-break: break-word;
  caret-color: currentColor;
  overflow: hidden;
}

.leditor-app:not(.leditor-app--pagination-continuous) #editor .ProseMirror {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--page-gap);
}

#editor .ProseMirror:focus-visible {
  outline: none;
}

#editor .ProseMirror p,
#editor .ProseMirror h1,
#editor .ProseMirror h2,
#editor .ProseMirror h3,
#editor .ProseMirror h4,
#editor .ProseMirror h5,
#editor .ProseMirror h6 {
  margin: 0 0 10px;
}

#editor .ProseMirror h1 {
  page-break-before: var(--heading1-break-before, auto);
  break-before: var(--heading1-break-before, auto);
}

#editor .ProseMirror h1,
#editor .ProseMirror h2 {
  page-break-after: var(--heading1-break-after, avoid);
  break-after: var(--heading1-break-after, avoid);
}

#editor .ProseMirror h2 {
  page-break-after: var(--heading2-break-after, avoid);
  break-after: var(--heading2-break-after, avoid);
}

#editor .ProseMirror p {
  widows: var(--widow-lines, 2);
  orphans: var(--orphan-lines, 2);
}

#editor .ProseMirror[data-bullet-style="disc"] ul {
  list-style-type: disc;
}

#editor .ProseMirror[data-bullet-style="circle"] ul {
  list-style-type: circle;
}

#editor .ProseMirror[data-bullet-style="square"] ul {
  list-style-type: square;
}

#editor .ProseMirror[data-number-style="decimal"] ol {
  list-style-type: decimal;
}

#editor .ProseMirror[data-number-style="lower-alpha"] ol {
  list-style-type: lower-alpha;
}

#editor .ProseMirror[data-number-style="upper-alpha"] ol {
  list-style-type: upper-alpha;
}

#editor .ProseMirror[data-number-style="lower-roman"] ol {
  list-style-type: lower-roman;
}

#editor .ProseMirror[data-number-style="upper-roman"] ol {
  list-style-type: upper-roman;
}

#editor .ProseMirror table {
  width: 100%;
  max-width: 100%;
  table-layout: fixed;
  page-break-inside: avoid;
  break-inside: avoid;
}

#editor .ProseMirror table tr {
  break-inside: avoid;
}

#editor .ProseMirror td,
#editor .ProseMirror th {
  max-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  overflow-wrap: anywhere;
  word-break: break-word;
}

#editor .ProseMirror figure,
#editor .ProseMirror img {
  max-width: 100%;
  height: auto;
  page-break-inside: avoid;
  break-inside: avoid;
}

.leditor-comment,
.leditor-change {
  break-inside: avoid;
}

.leditor-comment {
  background: rgba(255, 229, 100, 0.35);
  border-bottom: 2px solid rgba(245, 158, 11, 0.9);
  border-radius: 2px;
  padding: 0 1px;
  position: relative;
}

.leditor-comment[data-comment-text]:hover::after,
.leditor-comment[data-comment-text]:focus-visible::after {
  content: attr(data-comment-text);
  position: absolute;
  left: 0;
  top: 100%;
  margin-top: 4px;
  min-width: 160px;
  max-width: 280px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(17, 17, 17, 0.9);
  color: #ffffff;
  font-size: 12px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  z-index: 20;
  white-space: pre-wrap;
}

.leditor-break {
  position: relative;
  margin: 16px 0;
  padding: 6px 0;
  text-align: center;
  font-size: 11px;
  color: #4a4a4a;
}

.leditor-break::before {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: var(--page-break-line-height) var(--page-break-line-style) var(--page-break-line-color);
  transform: translateY(-50%);
}

.leditor-break::after {
  content: attr(data-break-label);
  position: relative;
  background: #f7f3e9;
  padding: 0 8px;
}
.leditor-break, .leditor-break::before, .leditor-break::after {
  display: none;
}

.leditor-page-column-guide {
  position: absolute;
  inset: var(--page-margin-top) var(--page-margin-right) var(--page-margin-bottom) var(--page-margin-left);
  pointer-events: none;
  display: flex;
  justify-content: space-between;
  align-items: stretch;
}
.leditor-page-column-guide span {
  width: 1px;
  background: var(--column-separator-color);
  opacity: 0.6;
}
.leditor-endnotes-panel {
  width: var(--page-width);
  background: var(--page-bg);
  border: var(--page-border-width) solid var(--page-border-color);
  box-shadow: var(--page-shadow);
  border-radius: 6px;
  margin-top: var(--page-gap);
  padding: var(--page-margin-top) var(--page-margin-right) var(--page-margin-bottom) var(--page-margin-left);
  box-sizing: border-box;
}
.leditor-endnotes-title {
  font-family: var(--page-font-family);
  font-size: 12pt;
  font-weight: bold;
  margin-bottom: 8px;
}
.leditor-endnotes-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.leditor-ruler {
  position: sticky;
  top: 0;
  align-self: center;
  left: auto;
  transform: none;
  width: calc(var(--page-width) * var(--page-zoom));
  height: var(--ruler-height);
  background: var(--ruler-bg);
  border-bottom: 1px solid var(--ruler-border);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  font-size: 10px;
  color: var(--ruler-color);
  z-index: 5;
}

.leditor-ruler-track {
  width: calc(var(--page-width) * var(--page-zoom));
  display: flex;
  justify-content: space-between;
  padding: 0 6px 4px;
  box-sizing: border-box;
}

.leditor-ruler-tick {
  flex: 1;
  border-left: 1px solid var(--ruler-border);
  padding-left: 4px;
  box-sizing: border-box;
}

.leditor-app.theme-dark .leditor-ruler {
  background: rgba(255, 255, 255, 0.06);
  border-bottom-color: rgba(255, 255, 255, 0.2);
  color: var(--ui-text-inverse);
}

.leditor-app.theme-dark .leditor-ruler-tick {
  border-left-color: rgba(255, 255, 255, 0.2);
}
.leditor-app:not(.leditor-app--show-ruler) .leditor-ruler {
  display: none;
}
.leditor-app:not(.leditor-app--show-page-boundaries) .leditor-page,
.leditor-app:not(.leditor-app--show-page-boundaries) .leditor-page-overlay {
  border: none;
  box-shadow: none;
}
.leditor-app:not(.leditor-app--show-page-breaks) .leditor-break {
  display: none;
}
.leditor-app.leditor-app--pagination-continuous {
  --page-gap: 0px;
  --page-border-width: 0px;
  --page-shadow: none;
}
.leditor-page-stack[data-grid-mode="stack"],
.leditor-page-overlays[data-grid-mode="stack"] {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--page-gap);
  width: fit-content;
  margin: 0 auto;
}

.leditor-page-stack[data-grid-mode="grid-2"],
.leditor-page-stack[data-grid-mode="grid-4"],
.leditor-page-overlays[data-grid-mode="grid-2"],
.leditor-page-overlays[data-grid-mode="grid-4"] {
  display: grid;
  grid-template-columns: repeat(2, var(--page-width));
  grid-auto-rows: var(--page-height);
  gap: var(--page-gap);
  justify-content: center;
  position: relative;
  width: fit-content;
  margin: 0 auto;
}

.leditor-page-stack[data-grid-mode="grid-9"],
.leditor-page-overlays[data-grid-mode="grid-9"] {
  display: grid;
  grid-template-columns: repeat(3, var(--page-width));
  grid-auto-rows: var(--page-height);
  gap: var(--page-gap);
  justify-content: center;
  position: relative;
  width: fit-content;
  margin: 0 auto;
}

.leditor-page-overlays[data-grid-mode^="grid-"] {
  position: relative;
  left: auto;
  transform: none;
  width: fit-content;
}

.leditor-break,
.leditor-break::before,
.leditor-break::after {
  display: block;
}

.leditor-break {
  position: relative;
  margin: 18px 0;
  padding: 6px 0;
  text-align: center;
  font-size: 11px;
  color: rgba(34, 34, 34, 0.75);
  pointer-events: none;
}

.leditor-break::before {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  border-top: var(--page-break-line-height) var(--page-break-line-style) var(--page-break-line-color);
  transform: translateY(-50%);
}

.leditor-break::after {
  content: attr(data-break-label);
  display: inline-block;
  position: relative;
  padding: 0 12px;
  background: var(--page-bg);
  color: rgba(34, 34, 34, 0.85);
  font-size: 10px;
  font-weight: 600;
}
`;
  style.textContent += `
.leditor-page-inner {
  position: absolute;
  inset: 0;
  padding: 0;
  box-sizing: border-box;
}

.leditor-page-header,
.leditor-page-footer {
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  font-size: 10pt;
  font-weight: bold;
  text-transform: uppercase;
  font-family: var(--page-font-family);
  opacity: 1;
  pointer-events: auto;
  box-sizing: border-box;
}

.leditor-page-header {
  top: var(
    --doc-header-distance,
    calc(var(--local-page-margin-top, var(--page-margin-top)) + var(--header-offset))
  );
  height: var(--header-height);
}

.leditor-page-footer {
  bottom: var(
    --doc-footer-distance,
    calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
  );
  height: var(--footer-height);
  text-transform: none;
}

.leditor-page-content {
  position: absolute;
  top: var(--local-page-margin-top, var(--page-margin-top));
  left: var(--local-page-margin-left, var(--page-margin-left));
  width: calc(
    var(--local-page-width, var(--page-width)) -
      (var(--local-page-margin-left, var(--page-margin-left)) +
        var(--local-page-margin-right, var(--page-margin-right)))
  );
  height: calc(
    var(--local-page-height, var(--page-height)) -
      (var(--local-page-margin-top, var(--page-margin-top)) +
        var(
          --effective-margin-bottom,
          calc(
            var(--local-page-margin-bottom, var(--page-margin-bottom)) +
              var(--page-footnote-height, 0px)
          )
        ))
  );
  padding: 0;
  overflow: hidden;
  pointer-events: auto;
}

.leditor-page-footnotes {
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  bottom: calc(
    var(
        --doc-footer-distance,
        calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
      ) + var(--footer-height)
  );
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: var(--page-footnote-color);
}
.leditor-page-footnotes.leditor-page-footnotes--active {
  border-top: var(--footnote-separator-height) solid var(--footnote-separator-color);
  padding-top: var(--footnote-spacing);
  background: transparent;
  min-height: var(--footnote-area-height);
}

.leditor-footnote-continuation {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  display: none;
  flex-direction: column;
  gap: 4px;
  font-size: var(--footnote-font-size);
  color: var(--page-footnote-color);
  justify-content: flex-end;
}
.leditor-footnote-continuation--active {
  display: flex;
}
.leditor-footnote-continuation-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.leditor-page-stack {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.leditor-page-overlays {
  position: absolute;
  inset: 0;
  /* Overlays must sit above the page stack so header/footer/footnote UIs are usable. */
  z-index: 3;
  /* Allow interaction only where children opt-in with pointer-events: auto. */
  pointer-events: auto;
}
.leditor-a4-zoom {
  position: relative;
  width: 100%;
  max-width: 100%;
  margin: 0;
  display: flex;
  justify-content: center;
  align-items: flex-start;
}

.leditor-a4-zoom-content {
  width: fit-content;
  position: relative;
  transform-origin: top center;
}
.leditor-page-inner > .leditor-page-header {
  top: var(
    --doc-header-distance,
    calc(var(--local-page-margin-top, var(--page-margin-top)) + var(--header-offset))
  );
  height: var(--header-height);
}
.leditor-page-inner > .leditor-page-footer {
  bottom: var(
    --doc-footer-distance,
    calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
  );
  height: var(--footer-height);
  z-index: 2;
}
.leditor-page-inner > .leditor-page-footnotes {
  bottom: calc(
    var(
        --doc-footer-distance,
        calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
      ) + var(--footer-height)
  );
  z-index: 3;
}
.leditor-page-overlay > .leditor-page-header {
  top: var(
    --doc-header-distance,
    calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-offset))
  );
  height: var(--header-height);
}
.leditor-page-overlay > .leditor-page-footer {
  bottom: var(
    --doc-footer-distance,
    calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
  );
  height: var(--footer-height);
  z-index: 2;
}
.leditor-page-overlay > .leditor-page-footnotes {
  bottom: calc(
    var(
        --doc-footer-distance,
        calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
      ) + var(--footer-height)
  );
  z-index: 3;
}
.leditor-page-overlay .leditor-page-header {
  top: var(
    --doc-header-distance,
    calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-offset))
  );
  height: var(--header-height);
}

.leditor-page-overlay .leditor-page-footer {
  bottom: var(
    --doc-footer-distance,
    calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset))
  );
  height: var(--footer-height);
}

.leditor-page-overlay .leditor-page-footnotes {
  display: none;
  pointer-events: auto;
}
.leditor-page-overlay .leditor-page-footnotes.leditor-page-footnotes--active {
  display: block;
  pointer-events: auto;
}

/* Debug regions removed. */

`;
  document.head.appendChild(style);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const determineGridMode = (zoom: number): GridMode => {
  if (zoom > 2.5) return "grid-9";
  if (zoom > 1.8) return "grid-4";
  if (zoom > 1.2) return "grid-2";
  return "stack";
};

const getCssNumber = (element: HTMLElement, name: string, fallback: number) => {
  const raw = getComputedStyle(element).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const countManualPageBreaks = (editorEl: HTMLElement) => {
  const breaks = editorEl.querySelectorAll(".leditor-break[data-break-kind]");
  let count = 0;
  breaks.forEach((node) => {
    const kind = (node as HTMLElement).dataset.breakKind;
    if (kind && PAGE_BOUNDARY_KINDS.has(kind)) {
      count += 1;
    }
  });
  return count;
};

export const mountA4Layout = (
  appRoot: HTMLElement,
  editorEl: HTMLElement,
  editorHandle?: EditorHandle | null,
  options: A4LayoutOptions = {}
): A4LayoutController => {
  ensureStyles();
  applyDocumentLayoutTokenDefaults(document.documentElement);
  applyDocumentLayoutTokens(document.documentElement);

  const attachedEditorHandle = editorHandle ?? null;
  const getFootnoteNumbering = (): Map<string, number> => {
    if (!attachedEditorHandle) return new Map();
    const editorInstance = attachedEditorHandle.getEditor();
    if (!editorInstance) return new Map();
    return reconcileFootnotes(editorInstance.state.doc).numbering;
  };

  const canvas = document.createElement("div");
  canvas.className = "leditor-a4-canvas";

  const ruler = document.createElement("div");
  ruler.className = "leditor-ruler";
  const rulerTrack = document.createElement("div");
  rulerTrack.className = "leditor-ruler-track";
  for (let i = 0; i <= 10; i += 1) {
    const tick = document.createElement("div");
    tick.className = "leditor-ruler-tick";
    const label = document.createElement("span");
    label.className = "leditor-ruler-mark";
    const labelText = `${i * 10} mm`;
    label.textContent = labelText;
    const labelWidth = Math.ceil(measureTextWidth(labelText, 11));
    label.style.minWidth = `${labelWidth}px`;
    tick.appendChild(label);
    rulerTrack.appendChild(tick);
  }
  ruler.appendChild(rulerTrack);

  const marginHandles = document.createElement("div");
  marginHandles.className = "leditor-margin-handles";
  const leftHandle = document.createElement("div");
  leftHandle.className = "leditor-margin-handle margin-left";
  const rightHandle = document.createElement("div");
  rightHandle.className = "leditor-margin-handle margin-right";
  marginHandles.append(leftHandle, rightHandle);
  ruler.appendChild(marginHandles);

  const marginControls = document.createElement("div");
  marginControls.className = "leditor-margin-controls";
  const horizontalControls = document.createElement("div");
  horizontalControls.className = "leditor-margin-slider-row";
  const leftSliderEl = document.createElement("div");
  leftSliderEl.className = "leditor-margin-slider horizontal left";
  const rightSliderEl = document.createElement("div");
  rightSliderEl.className = "leditor-margin-slider horizontal right";
  horizontalControls.append(leftSliderEl, rightSliderEl);
  const verticalControls = document.createElement("div");
  verticalControls.className = "leditor-margin-slider-column";
  const topSliderEl = document.createElement("div");
  topSliderEl.className = "leditor-margin-slider vertical top";
  const bottomSliderEl = document.createElement("div");
  bottomSliderEl.className = "leditor-margin-slider vertical bottom";
  verticalControls.append(topSliderEl, bottomSliderEl);
  marginControls.append(horizontalControls, verticalControls);
  ruler.appendChild(marginControls);

  const zoomLayer = document.createElement("div");
  zoomLayer.className = "leditor-a4-zoom";

  const zoomContent = document.createElement("div");
  zoomContent.className = "leditor-a4-zoom-content";

  const pageStack = document.createElement("div");
  pageStack.className = "leditor-page-stack";
  pageStack.style.pointerEvents = "auto";
  // Keep overlays visually above the page stack (so header/footer/footnotes are visible),
  // but non-interactive unless a dedicated edit mode is active.
  pageStack.style.zIndex = "2";
  pageStack.style.position = "relative";

  const overlayLayer = document.createElement("div");
  overlayLayer.className = "leditor-page-overlays";
  overlayLayer.style.pointerEvents = "auto";
  overlayLayer.style.zIndex = "3";
  overlayLayer.style.position = "absolute";

  zoomContent.appendChild(pageStack);
  zoomContent.appendChild(overlayLayer);
  zoomLayer.appendChild(zoomContent);

  canvas.appendChild(ruler);
  canvas.appendChild(zoomLayer);

  const endnotesPanel = document.createElement("div");
  endnotesPanel.className = "leditor-endnotes-panel";
  endnotesPanel.style.display = "none";
  const endnotesTitle = document.createElement("div");
  endnotesTitle.className = "leditor-endnotes-title";
  endnotesTitle.textContent = "Endnotes";
  const endnotesList = document.createElement("div");
  endnotesList.className = "leditor-endnotes-list";
  endnotesPanel.appendChild(endnotesTitle);
  endnotesPanel.appendChild(endnotesList);
  canvas.appendChild(endnotesPanel);

  appRoot.appendChild(canvas);
  const DEFAULT_PAGE_ZOOM = 1;
  canvas.style.setProperty("--page-zoom", String(DEFAULT_PAGE_ZOOM));
  zoomContent.style.transform = `scale(${DEFAULT_PAGE_ZOOM})`;

  // Force a single-page default after first layout. Some environments can persist view state externally.
  window.requestAnimationFrame(() => {
    try {
      viewMode = "single";
      pageStack.classList.remove("is-two-page");
      overlayLayer.classList.remove("is-two-page");
    } catch {
      // ignore
    }
  });

  let didInitialCenter = false;
  const centerDocHorizontally = () => {
    // Single source of truth: keep the document surface horizontally centered within the scroll container.
    // (This avoids subtle right-shifts caused by scroll restoration, gutters, or zoom/layout churn.)
    const scroller = appRoot;
    const max = scroller.scrollWidth - scroller.clientWidth;
    if (max <= 1) return;
    // With absolute centering, we should never need horizontal scroll; keep at 0.
    scroller.scrollLeft = 0;
  };

  let pageCount = 1;
  let viewMode: A4ViewMode = "single";
  let zoomValue = DEFAULT_PAGE_ZOOM;
  let headerHtml =
    typeof options.headerHtml === "string" && options.headerHtml.trim().length > 0
      ? options.headerHtml
      : "this is the header";
  let footerHtml =
    typeof options.footerHtml === "string" && options.footerHtml.trim().length > 0
      ? options.footerHtml
      : "this is the footer <span class=\"leditor-page-number\"></span>";
  // Important: header/footer exist in two DOM trees:
  // - overlay pages: user-editable header/footer UI
  // - page stack pages: non-editable clones used for layout/content flow
  // Keep the page stack footer minimal to avoid confusing the user with two different "footers".
  const pageStackFooterHtml = "<span class=\"leditor-page-number\"></span>";
  let headerFooterMode = false;
  let activeRegion: "header" | "footer" | null = null;
  let activeHeaderFooterPageIndex: string | null = null;
  type CaretSurface = "body" | "header" | "footer" | "footnotes";
  const caretState: {
    active: CaretSurface;
    body: { bookmark: unknown | null; from: number; to: number };
    header: { byPage: Map<string, number> };
    footer: { byPage: Map<string, number> };
    footnotes: { byId: Map<string, number> };
  } = {
    active: "body",
    body: { bookmark: null, from: 0, to: 0 },
    header: { byPage: new Map<string, number>() },
    footer: { byPage: new Map<string, number>() },
    footnotes: { byId: new Map<string, number>() }
  };
  let footnoteMode = false;
  let activeFootnoteId: string | null = null;

  let themeMode: "light" | "dark" = "light";
  let pageSurfaceMode: "light" | "dark" = "light";
  const THEME_STORAGE_KEY = "leditor:theme";
  const PAGE_SURFACE_STORAGE_KEY = "leditor:page-surface";
  const MARGINS_STORAGE_KEY = "leditor:margins";

  let paginationQueued = false;
  let gridMode: GridMode = "stack";
  const paginationEnabled = featureFlags.paginationEnabled;
  let suspendPageObserver = false;
  // NOTE: scrolling happens on the layout host (doc shell), not the canvas itself.
  let lastUserScrollAt = 0;
  appRoot.addEventListener("scroll", () => {
    lastUserScrollAt = performance.now();
  });

  const getTargetGridMode = () => (viewMode === "two-page" ? "grid-2" : determineGridMode(zoomValue));

  const applyGridMode = () => {
    gridMode = getTargetGridMode();
    pageStack.dataset.gridMode = gridMode;
    overlayLayer.dataset.gridMode = gridMode;
  };

  const syncCurrentMargins = (
    top: string,
    bottom: string,
    left: string,
    right: string
  ) => {
    zoomLayer.style.setProperty("--current-margin-top", top);
    zoomLayer.style.setProperty("--current-margin-bottom", bottom);
    zoomLayer.style.setProperty("--current-margin-left", left);
    zoomLayer.style.setProperty("--current-margin-right", right);
    pageStack.style.setProperty("--current-margin-top", top);
    pageStack.style.setProperty("--current-margin-bottom", bottom);
    pageStack.style.setProperty("--current-margin-left", left);
    pageStack.style.setProperty("--current-margin-right", right);
  };

  const marginHandlesElements = {
    left: leftHandle,
    right: rightHandle
  };
  const sliderElements = {
    left: leftSliderEl,
    right: rightSliderEl,
    top: topSliderEl,
    bottom: bottomSliderEl
  };

  let sliderSuppress = false;
  let marginUpdate = () => {};
  let leftSliderInstance: nouislider.API | null = null;
  let rightSliderInstance: nouislider.API | null = null;
  let topSliderInstance: nouislider.API | null = null;
  let bottomSliderInstance: nouislider.API | null = null;

  const parseMarginValue = (value: string, fallback: number): number => {
    const normalized = (value ?? "").trim().toLowerCase();
    if (normalized.endsWith("mm")) {
      return Number(normalized.replace("mm", "")) || fallback;
    }
    if (normalized.endsWith("cm")) {
      return (Number(normalized.replace("cm", "")) || fallback) * 10;
    }
    if (normalized.endsWith("in")) {
      return (Number(normalized.replace("in", "")) || fallback) * 25.4;
    }
    if (normalized.endsWith("pt")) {
      return ((Number(normalized.replace("pt", "")) || fallback) * 25.4) / 72;
    }
    if (normalized.endsWith("px")) {
      return ((Number(normalized.replace("px", "")) || fallback) * 25.4) / 96;
    }
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : fallback;
  };

  const formatMarginValue = (value: number) => `${Math.max(0, Number(value.toFixed(1)))}mm`;

  const updateMarginUI = () => {
    const margins = getMarginValues();
    const pageSize = getCurrentPageSize();
    const horizontalMax = Math.max(40, Math.min(120, pageSize.widthMm / 2 - 5));
    const verticalMax = Math.max(30, Math.min(90, pageSize.heightMm / 2 - 5));
    const leftMm = parseMarginValue(margins.left, 25);
    const rightMm = parseMarginValue(margins.right, 25);
    const topMm = parseMarginValue(margins.top, 25);
    const bottomMm = parseMarginValue(margins.bottom, 25);
    const trackRect = rulerTrack.getBoundingClientRect();
    const trackWidth = Math.max(trackRect.width, 1);
    const leftPct = clamp((leftMm / pageSize.widthMm) * 100, 0, 100);
    const rightPct = clamp((rightMm / pageSize.widthMm) * 100, 0, 100);
    marginHandlesElements.left.style.left = `${leftPct}%`;
    marginHandlesElements.right.style.right = `${rightPct}%`;
    sliderSuppress = true;
    leftSliderInstance?.updateOptions({ range: { min: 0, max: horizontalMax } }, false);
    rightSliderInstance?.updateOptions({ range: { min: 0, max: horizontalMax } }, false);
    topSliderInstance?.updateOptions({ range: { min: 0, max: verticalMax } }, false);
    bottomSliderInstance?.updateOptions({ range: { min: 0, max: verticalMax } }, false);
    leftSliderInstance?.set(leftMm);
    rightSliderInstance?.set(rightMm);
    topSliderInstance?.set(topMm);
    bottomSliderInstance?.set(bottomMm);
    sliderSuppress = false;
  };

  const applyMarginChange = (updates: Partial<MarginValues>) => {
    setPageMargins(updates);
    const margins = getMarginValues();
    window.localStorage?.setItem(MARGINS_STORAGE_KEY, JSON.stringify(margins));
    syncCurrentMargins(margins.top, margins.bottom, margins.left, margins.right);
    marginUpdate();
    updateMarginUI();
  };

  const bindSlider = (instance: nouislider.API, key: keyof MarginValues) => {
    instance.on("update", (values: Array<string | number>) => {
      if (sliderSuppress) return;
      const numeric = Number(values[0]);
      if (!Number.isFinite(numeric)) return;
      applyMarginChange({ [key]: formatMarginValue(numeric) });
    });
  };

  const instantiateSlider = (
    element: HTMLElement,
    options: nouislider.Options
  ): nouislider.API => nouislider.create(element, options);

  leftSliderInstance = instantiateSlider(leftSliderEl, {
    start: 25,
    connect: [true, false],
    step: 1,
    range: { min: 0, max: 80 },
    behaviour: "tap-drag"
  });
  bindSlider(leftSliderInstance, "left");
  rightSliderInstance = instantiateSlider(rightSliderEl, {
    start: 25,
    connect: [true, false],
    step: 1,
    range: { min: 0, max: 80 },
    behaviour: "tap-drag"
  });
  bindSlider(rightSliderInstance, "right");
  topSliderInstance = instantiateSlider(topSliderEl, {
    start: 20,
    orientation: "vertical",
    direction: "rtl",
    step: 1,
    range: { min: 0, max: 90 },
    behaviour: "tap-drag"
  });
  bindSlider(topSliderInstance, "top");
  bottomSliderInstance = instantiateSlider(bottomSliderEl, {
    start: 20,
    orientation: "vertical",
    direction: "rtl",
    step: 1,
    range: { min: 0, max: 90 },
    behaviour: "tap-drag"
  });
  bindSlider(bottomSliderInstance, "bottom");

  const unsubscribeMarginControls = subscribeToLayoutChanges(() => {
    updateMarginUI();
  });

  const loadStoredMargins = () => {
    // Ignore any previously stored margin tweaks to avoid drift across runs.
    try {
      window.localStorage?.removeItem(MARGINS_STORAGE_KEY);
    } catch {
      // ignore
    }
    resetMargins();
  };

  const handleDrag = (handleElement: HTMLElement, apply: (value: number) => void) => {
    interact(handleElement).draggable({
      modifiers: [
        interact.modifiers.restrictRect({
          restriction: rulerTrack,
          endOnly: true
        })
      ],
      listeners: {
      move(event: InteractDragEvent) {
          const trackRect = rulerTrack.getBoundingClientRect();
          if (trackRect.width <= 0) return;
          const position = clamp(event.pageX - trackRect.left, 0, trackRect.width);
          const pageSize = getCurrentPageSize();
          const mm = (position / trackRect.width) * pageSize.widthMm;
          apply(mm);
        }
      }
    });
  };

  handleDrag(marginHandlesElements.left, (value) => applyMarginChange({ left: formatMarginValue(value) }));
  handleDrag(marginHandlesElements.right, (value) =>
    applyMarginChange({
      right: formatMarginValue(
        Math.max(0, getCurrentPageSize().widthMm - value)
      )
    })
  );


  const normalizeHeaderFooterHtml = (html: string) =>
    html.replace(/\{pageNumber\}/gi, '<span class="leditor-page-number"></span>');

  const getOverlayHeaderFooter = (overlay: HTMLElement) => {
    const header = overlay.querySelector<HTMLElement>(".leditor-page-header");
    const footer = overlay.querySelector<HTMLElement>(".leditor-page-footer");
    if (!header || !footer) {
      throw new Error("Header/footer overlay missing header/footer nodes.");
    }
    return { header, footer };
  };

  const setRegionEditable = (element: HTMLElement, editable: boolean) => {
    element.contentEditable = editable ? "true" : "false";
    element.tabIndex = editable ? 0 : -1;
    element.setAttribute("aria-disabled", editable ? "false" : "true");
  };

  const setEditorEditable = (editable: boolean) => {
    const editorInstance = attachedEditorHandle?.getEditor();
    const prose = editorInstance?.view?.dom as HTMLElement | null;
    if (!prose || !editorEl.contains(prose)) {
      throw new Error("ProseMirror root missing when updating editability.");
    }
    // Prefer the editor API when available so ProseMirror plugins also respect the state.
    try {
      const anyEditor = editorInstance as any;
      if (typeof anyEditor?.setEditable === "function") {
        anyEditor.setEditable(editable);
      }
    } catch {
      // ignore
    }
    prose.contentEditable = editable ? "true" : "false";
    prose.setAttribute("aria-disabled", editable ? "false" : "true");
    if (!editable) {
      // Avoid focus fights: blur ProseMirror so overlay editors can own the caret deterministically.
      try {
        prose.blur();
      } catch {
        // ignore
      }
    }
  };

  const updateHeaderFooterEditability = () => {
    const overlays = overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay");
    overlays.forEach((overlay) => {
      const { header, footer } = getOverlayHeaderFooter(overlay);
      setRegionEditable(header, headerFooterMode && activeRegion === "header");
      setRegionEditable(footer, headerFooterMode && activeRegion === "footer");
    });
  };

  const focusHeaderFooterRegion = (region: "header" | "footer", pageIndex?: string | null) => {
    const overlays = Array.from(overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay"));
    const byIndex = pageIndex
      ? overlayLayer.querySelector<HTMLElement>(`.leditor-page-overlay[data-page-index="${pageIndex}"]`)
      : null;
    const overlay =
      byIndex ??
      (() => {
        if (!pageIndex) return overlays[0] ?? null;
        const idx = Number(pageIndex);
        if (!Number.isFinite(idx)) return overlays[0] ?? null;
        const clamped = Math.min(Math.max(0, idx), Math.max(0, overlays.length - 1));
        return overlays[clamped] ?? overlays[0] ?? null;
      })();
    if (!overlay) {
      throw new Error("Header/footer overlay missing for focus.");
    }
    const target = overlay.querySelector<HTMLElement>(
      region === "header" ? ".leditor-page-header" : ".leditor-page-footer"
    );
    if (!target) {
      throw new Error(`Header/footer region "${region}" missing.`);
    }
    const pageKey = (overlay.dataset.pageIndex ?? pageIndex ?? "0").trim() || "0";
    const storedOffset =
      region === "header" ? caretState.header.byPage.get(pageKey) : caretState.footer.byPage.get(pageKey);
    const desiredOffset = storedOffset ?? Number.POSITIVE_INFINITY;
    try {
      target.focus({ preventScroll: true } as any);
    } catch {
      target.focus();
    }
    applyContentEditableCaret(target, desiredOffset);
    // Some browsers reset selection on focus; re-apply once after layout.
    window.requestAnimationFrame(() => applyContentEditableCaret(target, desiredOffset));
  };

  const getCharOffsetInContentEditable = (root: HTMLElement): number | null => {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0) return null;
    const anchorNode = selection.anchorNode;
    if (!anchorNode) return null;
    if (!root.contains(anchorNode)) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(root);
      range.setEnd(anchorNode, selection.anchorOffset);
      return range.toString().length;
    } catch {
      return null;
    }
  };

  const applyContentEditableCaret = (root: HTMLElement, charOffset: number) => {
    // Can be called from async focus flows; if the node was replaced during pagination,
    // setting a Range will throw "The given range isn't in document."
    if (!root.isConnected) return;
    const selection = window.getSelection?.();
    if (!selection) return;
    const range = document.createRange();

    // If there is no text content, place the caret at the start of the element.
    const totalText = root.textContent ?? "";
    const targetOffset = Number.isFinite(charOffset) ? Math.max(0, Math.min(totalText.length, charOffset)) : totalText.length;

    // For truly empty contenteditables (no text nodes), select the element boundary directly.
    // This avoids DOM errors from selectNodeContents()/addRange() in some browsers.
    if (root.childNodes.length === 0) {
      try {
        range.setStart(root, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {
        // ignore
      }
      return;
    }

    let remaining = targetOffset;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Text | null = walker.nextNode() as Text | null;
    try {
      while (node) {
        const len = node.data.length;
        if (remaining <= len) {
          range.setStart(node, remaining);
          range.collapse(true);
          selection.removeAllRanges();
          selection.addRange(range);
          return;
        }
        remaining -= len;
        node = walker.nextNode() as Text | null;
      }
    } catch {
      return;
    }

    // No text nodes (or offset beyond end): collapse at end of element.
    try {
      range.selectNodeContents(root);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch {
      // ignore
    }
  };

  let selectionChangeQueued = false;
  const handleSelectionChange = () => {
    if (selectionChangeQueued) return;
    selectionChangeQueued = true;
    window.requestAnimationFrame(() => {
      selectionChangeQueued = false;
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0) return;
      const anchorNode = selection.anchorNode;
      const anchorEl =
        anchorNode instanceof HTMLElement
          ? anchorNode
          : (anchorNode as any)?.parentElement
            ? ((anchorNode as any).parentElement as HTMLElement)
            : null;
      if (!anchorEl) return;

      // Footnotes
      const footnoteText = anchorEl.closest<HTMLElement>(".leditor-footnote-entry-text[contenteditable=\"true\"]");
      if (footnoteText) {
        const id = (footnoteText.dataset.footnoteId ?? "").trim();
        const offset = getCharOffsetInContentEditable(footnoteText);
        if (id && offset != null) {
          caretState.active = "footnotes";
          caretState.footnotes.byId.set(id, offset);
          activeFootnoteId = id;
        }
        return;
      }

      // Header/footer (overlay editable)
      const overlayHeader = anchorEl.closest<HTMLElement>(".leditor-page-overlay .leditor-page-header[contenteditable=\"true\"]");
      if (overlayHeader) {
        const overlay = overlayHeader.closest<HTMLElement>(".leditor-page-overlay");
        const pageKey = (overlay?.dataset.pageIndex ?? "0").trim() || "0";
        const offset = getCharOffsetInContentEditable(overlayHeader);
        if (offset != null) {
          caretState.active = "header";
          caretState.header.byPage.set(pageKey, offset);
        }
        return;
      }
      const overlayFooter = anchorEl.closest<HTMLElement>(".leditor-page-overlay .leditor-page-footer[contenteditable=\"true\"]");
      if (overlayFooter) {
        const overlay = overlayFooter.closest<HTMLElement>(".leditor-page-overlay");
        const pageKey = (overlay?.dataset.pageIndex ?? "0").trim() || "0";
        const offset = getCharOffsetInContentEditable(overlayFooter);
        if (offset != null) {
          caretState.active = "footer";
          caretState.footer.byPage.set(pageKey, offset);
        }
        return;
      }

      // Body
      const editorInstance = attachedEditorHandle?.getEditor();
      const view = editorInstance?.view;
      const prose = view?.dom as HTMLElement | null;
      if (view && prose && prose.contains(anchorEl) && !headerFooterMode && !footnoteMode) {
        try {
          caretState.active = "body";
          caretState.body.bookmark = view.state.selection.getBookmark();
          caretState.body.from = (view.state.selection as any)?.from ?? caretState.body.from;
          caretState.body.to = (view.state.selection as any)?.to ?? caretState.body.to;
        } catch {
          // ignore
        }
      }
    });
  };

  const captureBodySelection = (source: string) => {
    if (!attachedEditorHandle) return;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return;
    try {
      const sel: any = view.state.selection as any;
      const docSize = view.state.doc.content.size;
      const clamp = (pos: number) => Math.min(Math.max(0, pos), docSize);
      const rawFrom = clamp(Number(sel?.from ?? 0));
      const rawTo = clamp(Number(sel?.to ?? rawFrom));
      const $from = view.state.doc.resolve(rawFrom);
      const safeSelection = $from.parent.inlineContent
        ? sel
        : Selection.near($from, 1);
      caretState.body.bookmark = safeSelection.getBookmark();
      caretState.body.from = clamp(Number((safeSelection as any)?.from ?? rawFrom));
      caretState.body.to = clamp(Number((safeSelection as any)?.to ?? caretState.body.from));
      if ((window as any).__leditorCaretDebug) {
        console.info("[HeaderFooter][selection] captured", {
          source,
          type: safeSelection?.constructor?.name ?? "unknown",
          from: (safeSelection as any)?.from,
          to: (safeSelection as any)?.to
        });
      }
    } catch (error) {
      console.warn("[HeaderFooter][selection] capture failed", { source, error });
      caretState.body.bookmark = null;
    }
  };

  const focusBody = () => {
    const editorInstance = attachedEditorHandle?.getEditor();
    const prose = editorInstance?.view?.dom as HTMLElement | null;
    if (!prose || !editorEl.contains(prose)) {
      throw new Error("ProseMirror root missing for body focus.");
    }
    prose.focus();
  };

  const restoreBodySelection = (source: string) => {
    if (!attachedEditorHandle) return;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return;
    try {
      const bookmark = caretState.body.bookmark as any;
      const resolved = bookmark?.resolve?.(view.state.doc);
      if (resolved) {
        const sel: any = resolved as any;
        const $from = view.state.doc.resolve(Math.max(0, Math.min(view.state.doc.content.size, sel.from ?? 0)));
        const safe = $from.parent.inlineContent ? resolved : Selection.near($from, 1);
        view.dispatch(view.state.tr.setSelection(safe).scrollIntoView());
      } else {
        const docSize = view.state.doc.content.size;
        const clamp = (pos: number) => Math.min(Math.max(0, pos), docSize);
        const from = clamp(caretState.body.from);
        const to = clamp(caretState.body.to);
        try {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView());
        } catch {
          const $from = view.state.doc.resolve(from);
          view.dispatch(view.state.tr.setSelection(Selection.near($from, 1)).scrollIntoView());
        }
      }
      view.focus();
      if ((window as any).__leditorCaretDebug) {
        console.info("[HeaderFooter][selection] restored", {
          source,
          type: resolved?.constructor?.name ?? "unknown",
          from: (resolved as any)?.from,
          to: (resolved as any)?.to
        });
      }
    } catch (error) {
      console.warn("[HeaderFooter][selection] restore failed", { source, error });
      focusBody();
    }
  };

  const ensurePointerSelection = (event: PointerEvent) => {
    // ProseMirror owns caret placement in body mode.
    // However, in footnote mode we need a reliable "click anywhere in the document body exits footnotes"
    // handler because clicks can land on non-editor elements (canvas/page shell) and bypass editorEl listeners.
    if (!footnoteMode || headerFooterMode) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // If the click is inside the footnote UI, do nothing (the footnote editor owns the caret).
    if (target.closest(".leditor-page-footnotes, .leditor-footnote-entry, .leditor-footnote-entry-text")) {
      return;
    }
    // Otherwise, exit footnote mode and attempt to place the caret at the click coordinates.
    // Prefer restoring to the click point, but fall back to the last stored body selection.
    exitFootnoteMode({ restore: true, coords: { x: event.clientX, y: event.clientY } });
  };

  const setBodySelectionFromSnapshot = (source: string, snapshot: StoredSelection) => {
    if (!attachedEditorHandle) return;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return;
    try {
      let tr = applySnapshotToTransaction(view.state.tr, snapshot);
      const sel: any = tr.selection as any;
      const from = Number.isFinite(sel?.from) ? sel.from : snapshot.from;
      const $from = tr.doc.resolve(Math.max(0, Math.min(tr.doc.content.size, from)));
      if (!$from.parent.inlineContent) {
        tr = tr.setSelection(Selection.near($from, 1));
      }
      const safeSelection: any = tr.selection;
      caretState.body.bookmark = safeSelection.getBookmark();
      caretState.body.from = Number((safeSelection as any)?.from ?? snapshot.from);
      caretState.body.to = Number((safeSelection as any)?.to ?? snapshot.to);
      if ((window as any).__leditorCaretDebug) {
        console.info("[HeaderFooter][selection] captured", {
          source,
          type: safeSelection?.constructor?.name ?? "unknown",
          from: caretState.body.from,
          to: caretState.body.to
        });
      }
    } catch (error) {
      console.warn("[HeaderFooter][selection] capture failed", { source, error });
    }
  };

  const pendingFootnoteSourceSelection = new Map<string, StoredSelection>();

  const enterFootnoteMode = (footnoteId: string, sourceSelection?: StoredSelection | null) => {
    if (!footnoteId) return;
    if (headerFooterMode) {
      // Do not allow competing edit modes.
      exitHeaderFooterMode();
    }
    if (!footnoteMode) {
      if (sourceSelection) {
        setBodySelectionFromSnapshot("enterFootnote", sourceSelection);
      } else {
        captureBodySelection("enterFootnote");
      }
      footnoteMode = true;
      appRoot.classList.add("leditor-footnote-editing");
      overlayLayer.style.zIndex = "4";
      pageStack.style.zIndex = "2";
      overlayLayer.style.pointerEvents = "auto";
      setEditorEditable(false);
    }
    activeFootnoteId = footnoteId;
    caretState.active = "footnotes";
  };

	  const exitFootnoteMode = (opts?: { restore?: boolean; coords?: { x: number; y: number } }) => {
	    if (!footnoteMode) return;
	    footnoteMode = false;
	    activeFootnoteId = null;
	    caretState.active = "body";
	    appRoot.classList.remove("leditor-footnote-editing");
	    overlayLayer.style.zIndex = "3";
	    pageStack.style.zIndex = "2";
	    overlayLayer.style.pointerEvents = "none";
	    setEditorEditable(true);

	    const restore = opts?.restore !== false;
	    const coords = opts?.coords ?? null;
	    if (coords && attachedEditorHandle) {
	      const view = attachedEditorHandle.getEditor()?.view;
	      try {
	        const pos = view?.posAtCoords?.({ left: coords.x, top: coords.y }) ?? null;
	        if (pos?.pos != null) {
	          const $pos = view.state.doc.resolve(pos.pos);
	          const safe = $pos.parent.inlineContent ? Selection.near($pos, 1) : Selection.near($pos, 1);
	          view.dispatch(view.state.tr.setSelection(safe).scrollIntoView());
	          view.focus();
	          caretState.body.bookmark = view.state.selection.getBookmark();
	          caretState.body.from = (view.state.selection as any)?.from ?? caretState.body.from;
	          caretState.body.to = (view.state.selection as any)?.to ?? caretState.body.to;
	          if ((window as any).__leditorCaretDebug) {
	            console.info("[Footnote][exit] restored selection from coords", {
	              x: coords.x,
	              y: coords.y,
	              from: caretState.body.from,
	              to: caretState.body.to
	            });
	          }
	          return;
	        }
	      } catch {
	        // fall back to stored restore
	      }
	    }
	    if (restore) {
	      restoreBodySelection("exitFootnote");
	    }
	  };

  const measureCssLength = (value: string, anchor: HTMLElement): number => {
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.width = value;
    anchor.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    if (!Number.isFinite(width)) {
      throw new Error(`Unable to resolve CSS length: "${value}".`);
    }
    return width;
  };

  const getSectionHeaderContent = (sectionId: string) => {
    const value = sectionHeaderContent.get(sectionId);
    return typeof value === "string" && value.trim().length > 0 ? value : headerHtml;
  };
  const getSectionFooterContent = (sectionId: string) => {
    const value = sectionFooterContent.get(sectionId);
    return typeof value === "string" && value.trim().length > 0 ? value : footerHtml;
  };
  const applyFirstPageRegionLabels = (_reason: string) => {};

  const syncHeaderFooter = () => {
    const overlays = overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay");
    overlays.forEach((overlay) => {
      const sectionId = overlay.dataset.sectionId ?? DEFAULT_SECTION_ID;
      const header = overlay.querySelector(".leditor-page-header");
      const footer = overlay.querySelector(".leditor-page-footer");
      if (header) {
        header.innerHTML = normalizeHeaderFooterHtml(getSectionHeaderContent(sectionId));
      }
      if (footer) {
        footer.innerHTML = normalizeHeaderFooterHtml(getSectionFooterContent(sectionId));
      }
    });
    const pageNodes = editorEl.querySelectorAll<HTMLElement>(".leditor-page");
    pageNodes.forEach((page, index) => {
      const sectionInfo = pageSections[index] ?? null;
      const sectionId = sectionInfo?.sectionId ?? DEFAULT_SECTION_ID;
      const header = page.querySelector(".leditor-page-header");
      const footer = page.querySelector(".leditor-page-footer");
      if (header) {
        header.innerHTML = normalizeHeaderFooterHtml(getSectionHeaderContent(sectionId));
      }
      if (footer) {
        footer.innerHTML = normalizeHeaderFooterHtml(pageStackFooterHtml);
      }
    });
  };

  const dispatchThemeChange = () => {
    if (typeof document === "undefined") return;
    const event = new CustomEvent(THEME_CHANGE_EVENT, {
      detail: {
        mode: themeMode,
        surface: pageSurfaceMode
      }
    });
    document.dispatchEvent(event);
  };

  const applyTheme = (mode: "light" | "dark", surface: "light" | "dark" = pageSurfaceMode) => {
    themeMode = mode;
    pageSurfaceMode = surface;
    appRoot.classList.toggle("theme-dark", themeMode === "dark");
    appRoot.classList.toggle("theme-light", themeMode === "light");
    appRoot.classList.toggle("page-surface-dark", pageSurfaceMode === "dark");
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themeMode);
      localStorage.setItem(PAGE_SURFACE_STORAGE_KEY, pageSurfaceMode);
    } catch (error) {
      console.warn("theme persistence failed", error);
    }
    dispatchThemeChange();
  };

  const toggleTheme = () => applyTheme(themeMode === "light" ? "dark" : "light");
  const togglePageSurface = () => applyTheme(themeMode, pageSurfaceMode === "light" ? "dark" : "light");

  const initTheme = () => {
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === "light" || storedTheme === "dark") {
        themeMode = storedTheme;
      }
      const storedSurface = localStorage.getItem(PAGE_SURFACE_STORAGE_KEY);
      if (storedSurface === "light" || storedSurface === "dark") {
        pageSurfaceMode = storedSurface;
      }
    } catch {
      // ignore storage failures
    }
    applyTheme(themeMode, pageSurfaceMode);
  };

  const updatePageNumbers = () => {
    const overlays = overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay");
    overlays.forEach((overlay, index) => {
      const label = String(index + 1);
      const footerNumber = overlay.querySelector(".leditor-page-footer .leditor-page-number");
      if (footerNumber) {
        footerNumber.textContent = label;
      }
      const headerNumber = overlay.querySelector(".leditor-page-header .leditor-page-number");
      if (headerNumber) {
        headerNumber.textContent = label;
      }
    });
  };

  const determineFootnotePageIndex = (
    node: HTMLElement,
    pageElements: HTMLElement[],
    pageHeight: number,
    editorRect: DOMRect
  ) => {
    const maxPageIndex = Math.max(0, pageCount - 1);
    if (pageElements.length > 0) {
      const pageIndex = pageElements.findIndex((page) => page.contains(node));
      if (pageIndex >= 0) {
        return clamp(pageIndex, 0, maxPageIndex);
      }
    }
    if (pageHeight <= 0) return 0;
    const markerRect = node.getBoundingClientRect();
    const relativeTop = Math.max(0, markerRect.top - editorRect.top);
    const rawIndex = Math.floor(relativeTop / pageHeight);
    return clamp(rawIndex, 0, maxPageIndex);
  };

  const renderEndnotes = (entries: FootnoteRenderEntry[]) => {
    endnotesList.innerHTML = "";
    if (entries.length === 0) {
      endnotesPanel.style.display = "none";
      return;
    }
    endnotesPanel.style.display = "block";
    const list = document.createElement("ol");
    list.className = "leditor-endnotes-entries";
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "leditor-endnote-entry";
      item.dataset.footnoteId = entry.footnoteId;
      if (entry.source === "citation") {
        item.dataset.footnoteSource = "citation";
      } else {
        item.dataset.footnoteSource = "manual";
      }
      const number = document.createElement("span");
      number.className = "leditor-endnote-entry-number";
      number.textContent = entry.number;
      const text = document.createElement("span");
      text.className = "leditor-endnote-entry-text";
      const value = (entry.text || "").trim();
      text.textContent = value;
      text.dataset.placeholder = "Type endnote…";
      text.contentEditable = entry.source === "citation" ? "false" : "true";
      text.setAttribute("role", "textbox");
      text.setAttribute("spellcheck", "false");
      item.appendChild(number);
      item.appendChild(text);
      list.appendChild(item);
    });
    endnotesList.appendChild(list);
  };

  const collectFootnoteEntries = () => {
    const registry = getFootnoteRegistry();
    const nodes = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-footnote"));
    const entries: FootnoteRenderEntry[] = [];
    const numbering = getFootnoteNumbering();
    let fallbackCounter = 0;
    const pageElements = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page"));
    const pageHeight = measurePageHeight();
    const editorRect = editorEl.getBoundingClientRect();
    for (const node of nodes) {
      const id = node.dataset.footnoteId ?? "";
      const view = id ? registry.get(id) : null;
      let numberLabel = "";
      const mappedNumber = numbering.get(id);
      if (mappedNumber) {
        numberLabel = String(mappedNumber);
      } else if (view?.getNumber()) {
        numberLabel = view.getNumber();
      } else if (node.dataset.footnoteNumber) {
        numberLabel = node.dataset.footnoteNumber;
      } else {
        fallbackCounter += 1;
        numberLabel = String(fallbackCounter);
      }
      const text = view?.getPlainText() || footnoteTextFallback.get(id) || "";
      const rawKind = (node.dataset.footnoteKind ?? "footnote").toLowerCase();
      const source: "manual" | "citation" = node.dataset.footnoteSource === "citation" ? "citation" : "manual";
      const pageIndex =
        rawKind === "footnote" ? determineFootnotePageIndex(node, pageElements, pageHeight, editorRect) : 0;
      const normalizedKind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
      entries.push({
        footnoteId: id || `fn-${numberLabel}-${pageIndex}`,
        number: numberLabel,
        text,
        kind: normalizedKind,
        source,
        pageIndex
      });
    }
    return entries;
  };

	  const buildFootnotePageStates = (): PageFootnoteState[] => {
	    const overlays = Array.from(overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay"));
	    return overlays
	      .map((overlay, index): PageFootnoteState | null => {
	        const container = overlay.querySelector<HTMLElement>(".leditor-page-footnotes");
	        let continuation = overlay.querySelector<HTMLElement>(".leditor-footnote-continuation");
	        const content = overlay.querySelector<HTMLElement>(".leditor-page-content");
	        if (container && !continuation) {
	          continuation = document.createElement("div");
	          continuation.className = "leditor-footnote-continuation";
	          continuation.setAttribute("aria-hidden", "true");
	          continuation.contentEditable = "false";
	          container.insertAdjacentElement("beforebegin", continuation);
	        }
	        if (!container || !continuation) return null;
	        return {
	          pageIndex: Number(overlay.dataset.pageIndex ?? String(index)),
	          pageElement: overlay,
	          contentElement: content ?? null,
	          footnoteContainer: container,
	          continuationContainer: continuation
	        };
	      })
	      .filter((state): state is PageFootnoteState => state != null);
	  };

  let pendingFootnoteFocusId: string | null = null;
  const pendingFootnoteFocusAttempts = new Map<string, number>();
  const footnoteTextFallback = new Map<string, string>();

  const renderFootnoteSections = () => {
    const entries = collectFootnoteEntries();
    const pageStates = buildFootnotePageStates();
    const footnoteEntries = entries.filter((entry) => entry.kind === "footnote");
    try {
      paginateWithFootnotes({
        entries: footnoteEntries,
        pageStates
      });
    } catch (error) {
      console.warn("[Footnote] paginateWithFootnotes failed", {
        error,
        pageStateCount: pageStates.length,
        entryCount: entries.length
      });
    }
    // Fallback: if we have footnote markers but pagination didn't render any entry rows, render them
    // directly into the first matching page's footnote container so the user can type.
    if (footnoteEntries.length > 0 && appRoot.querySelectorAll(".leditor-footnote-entry").length === 0) {
      const renderFallback = (container: HTMLElement, list: typeof footnoteEntries) => {
        container.innerHTML = "";
        container.classList.add("leditor-page-footnotes--active");
        container.setAttribute("aria-hidden", "false");
        const hostList = document.createElement("div");
        hostList.className = "leditor-footnote-list";
        list.forEach((entry) => {
          const row = document.createElement("div");
          row.className = "leditor-footnote-entry";
          row.dataset.footnoteId = entry.footnoteId;
          if (entry.source === "citation") {
            row.classList.add("leditor-footnote-entry--citation");
          }
          const number = document.createElement("span");
          number.className = "leditor-footnote-entry-number";
          number.textContent = entry.number;
          const text = document.createElement("span");
          text.className = "leditor-footnote-entry-text";
          text.dataset.footnoteId = entry.footnoteId;
          text.dataset.placeholder = "Type footnote…";
          text.textContent = (entry.text || "").trim();
          text.contentEditable = entry.source === "citation" ? "false" : "true";
          text.tabIndex = entry.source === "citation" ? -1 : 0;
          text.setAttribute("role", "textbox");
          text.setAttribute("spellcheck", "false");
          row.appendChild(number);
          row.appendChild(text);
          hostList.appendChild(row);
        });
        container.appendChild(hostList);
      };

      const first = footnoteEntries[0];
      const preferred = pageStates.find((state) => state.pageIndex === first.pageIndex) ?? pageStates[0] ?? null;
      if (preferred?.footnoteContainer) {
        renderFallback(preferred.footnoteContainer, footnoteEntries.filter((e) => e.pageIndex === preferred.pageIndex));
        if ((window as any).__leditorFootnoteDebug) {
          console.info("[Footnote] fallback renderer used", {
            pageIndex: preferred.pageIndex,
            count: footnoteEntries.length
          });
        }
      } else {
        console.warn("[Footnote] fallback renderer unable to find footnote container", {
          pageStateCount: pageStates.length,
          entryCount: footnoteEntries.length
        });
      }
    }
    renderEndnotes(entries.filter((entry) => entry.kind === "endnote"));

    scheduleFootnoteHeightMeasurement();
    if (pendingFootnoteFocusId) {
      const targetId = pendingFootnoteFocusId;
      const nextAttempt = (pendingFootnoteFocusAttempts.get(targetId) ?? 0) + 1;
      pendingFootnoteFocusAttempts.set(targetId, nextAttempt);
      // Optimistically clear the pending id; focusFootnoteEntry will recreate the entry in the overlay
      // if pagination did not render it yet.
      pendingFootnoteFocusId = null;
      focusFootnoteEntry(targetId);

      const entry = overlayLayer.querySelector<HTMLElement>(`.leditor-footnote-entry[data-footnote-id="${targetId}"]`);
      if (entry) {
        pendingFootnoteFocusAttempts.delete(targetId);
      } else {
        // Re-arm for another render pass; this usually means pages are being rebuilt.
        pendingFootnoteFocusId = targetId;
        if (nextAttempt === 30) {
          console.info("[Footnote][focus][pending] waiting for entry render", {
            footnoteId: targetId,
            attempt: nextAttempt,
            markerCount: editorEl.querySelectorAll(".leditor-footnote").length,
            renderedEntryCount: overlayLayer.querySelectorAll(".leditor-footnote-entry").length,
            entriesCount: entries.length,
            pageStateCount: pageStates.length
          });
        }
        if (nextAttempt > 180) {
          console.warn("[Footnote][focus][pending] giving up (entry never rendered)", {
            footnoteId: targetId,
            attempt: nextAttempt
          });
          pendingFootnoteFocusId = null;
          pendingFootnoteFocusAttempts.delete(targetId);
        }
      }
    }
  };

  const focusFootnoteEntry = (footnoteId: string, behavior: "preserve" | "end" = "end") => {
    const ensureOverlayEntryForFootnote = (id: string): HTMLElement | null => {
      const marker = editorEl.querySelector<HTMLElement>(`.leditor-footnote[data-footnote-id="${id}"]`);
      if (!marker) return null;
      const rawKind = (marker.dataset.footnoteKind ?? "footnote").toLowerCase();
      const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
      if (kind !== "footnote") return null;

      const pageElements = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page"));
      const pageHeight = measurePageHeight();
      const editorRect = editorEl.getBoundingClientRect();
      const pageIndex = determineFootnotePageIndex(marker, pageElements, pageHeight, editorRect);
      const overlay = overlayLayer.querySelector<HTMLElement>(`.leditor-page-overlay[data-page-index="${pageIndex}"]`);
      const container = overlay?.querySelector<HTMLElement>(".leditor-page-footnotes") ?? null;
      if (!container) return null;

      const numbering = getFootnoteNumbering();
      const registry = getFootnoteRegistry();
      const view = registry.get(id) ?? null;
      const numberLabel = numbering.get(id) ? String(numbering.get(id)) : view?.getNumber?.() || marker.dataset.footnoteNumber || "1";
      const source: "manual" | "citation" = marker.dataset.footnoteSource === "citation" ? "citation" : "manual";
      const text = view?.getPlainText?.() || footnoteTextFallback.get(id) || "";

      container.classList.add("leditor-page-footnotes--active");
      container.setAttribute("aria-hidden", "false");

      let list = container.querySelector<HTMLElement>(".leditor-footnote-list");
      if (!list) {
        container.innerHTML = "";
        list = document.createElement("div");
        list.className = "leditor-footnote-list";
        container.appendChild(list);
      }

      let row = list.querySelector<HTMLElement>(`.leditor-footnote-entry[data-footnote-id="${id}"]`);
      if (!row) {
        row = document.createElement("div");
        row.className = "leditor-footnote-entry";
        row.dataset.footnoteId = id;
        if (source === "citation") {
          row.classList.add("leditor-footnote-entry--citation");
        }
        const number = document.createElement("span");
        number.className = "leditor-footnote-entry-number";
        const body = document.createElement("span");
        body.className = "leditor-footnote-entry-text";
        body.dataset.footnoteId = id;
        body.dataset.placeholder = "Type footnote…";
        body.setAttribute("role", "textbox");
        body.setAttribute("spellcheck", "false");
        row.appendChild(number);
        row.appendChild(body);
        list.appendChild(row);
      }

      const numberEl = row.querySelector<HTMLElement>(".leditor-footnote-entry-number");
      if (numberEl) numberEl.textContent = numberLabel;

      const bodyEl = row.querySelector<HTMLElement>(".leditor-footnote-entry-text");
      if (bodyEl) {
        bodyEl.contentEditable = source === "citation" ? "false" : "true";
        bodyEl.tabIndex = source === "citation" ? -1 : 0;
        const currentText = bodyEl.textContent ?? "";
        if (currentText !== text) {
          bodyEl.textContent = text.trim();
        }
      }

      return row;
    };

    let entry =
      overlayLayer.querySelector<HTMLElement>(`.leditor-footnote-entry[data-footnote-id="${footnoteId}"]`) ??
      ensureOverlayEntryForFootnote(footnoteId);
    if (!entry) return;
    const sourceSelection = pendingFootnoteSourceSelection.get(footnoteId) ?? null;
    pendingFootnoteSourceSelection.delete(footnoteId);
    enterFootnoteMode(footnoteId, sourceSelection);
    try {
      entry.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch {
      // ignore
    }
    entry.classList.add("leditor-footnote-entry--active");
    window.setTimeout(() => entry.classList.remove("leditor-footnote-entry--active"), 900);
    let text = entry.querySelector<HTMLElement>(".leditor-footnote-entry-text");
    if (text) {
      const applyCaret = () => {
        if (!text.isConnected) {
          const freshEntry = overlayLayer.querySelector<HTMLElement>(
            `.leditor-footnote-entry[data-footnote-id="${footnoteId}"]`
          );
          text = freshEntry?.querySelector<HTMLElement>(".leditor-footnote-entry-text") ?? null;
        }
        if (!text || !text.isConnected) return;
        try {
          text.focus({ preventScroll: true } as any);
        } catch {
          text.focus();
        }
        const storedOffset = caretState.footnotes.byId.get(footnoteId);
        const offset =
          behavior === "preserve" && storedOffset != null ? storedOffset : Number.POSITIVE_INFINITY;
        applyContentEditableCaret(text, offset);
        const nextOffset = getCharOffsetInContentEditable(text);
        if (nextOffset != null) {
          caretState.footnotes.byId.set(footnoteId, nextOffset);
        }
      };

      // Focus/caret placement can be stolen immediately after insertion by unrelated focus handlers.
      // Keep trying for a short window until selection is actually inside the footnote editor.
      const start = performance.now();
      let attempts = 0;
      const lastCaretLogAtById =
        ((window as any).__leditorFootnoteCaretLogAtById as Map<string, number> | undefined) ??
        new Map<string, number>();
      (window as any).__leditorFootnoteCaretLogAtById = lastCaretLogAtById;
      const ensureFocused = () => {
        attempts += 1;
        applyCaret();
        const sel = window.getSelection?.();
        const active = document.activeElement as HTMLElement | null;
        const ok =
          !!text &&
          text.isConnected &&
          active === text &&
          !!sel &&
          sel.rangeCount > 0 &&
          (sel.anchorNode ? text.contains(sel.anchorNode) : false);
        if (ok) {
          // Make sure the caret is actually visible to the user (scroll the app scroller if needed).
          try {
            const scroller = appRoot;
            const scrollerRect = scroller.getBoundingClientRect();
            const caretRect = text.getBoundingClientRect();
            const needsScroll =
              caretRect.top < scrollerRect.top + 12 || caretRect.bottom > scrollerRect.bottom - 12;
            if (needsScroll) {
              text.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
            }
          } catch {
            // ignore
          }
          if ((window as any).__leditorCaretDebug) {
            const lastAt = lastCaretLogAtById.get(footnoteId) ?? 0;
            const now = Date.now();
            if (now - lastAt > 750) {
              lastCaretLogAtById.set(footnoteId, now);
              console.info("[Footnote][focus][caret]", {
                footnoteId,
                behavior,
                attempts,
                activeEl: (document.activeElement as HTMLElement | null)?.className ?? null,
                contentEditable: text?.getAttribute("contenteditable"),
                rangeCount: sel?.rangeCount ?? 0
              });
            }
          }
          return;
        }
        if (attempts >= 12) {
          if ((window as any).__leditorCaretDebug) {
            console.warn("[Footnote][focus][caret] failed to land selection inside footnote editor", {
              footnoteId,
              behavior,
              attempts,
              elapsedMs: Math.round(performance.now() - start),
              activeEl: (document.activeElement as HTMLElement | null)?.className ?? null
            });
          }
          return;
        }
        if (performance.now() - start > 500) {
          if ((window as any).__leditorCaretDebug) {
            console.warn("[Footnote][focus][caret] timeout", {
              footnoteId,
              behavior,
              attempts,
              elapsedMs: Math.round(performance.now() - start)
            });
          }
          return;
        }
        window.requestAnimationFrame(ensureFocused);
      };
      ensureFocused();
    }
  };

  const handleFootnoteEntryClick = (event: MouseEvent) => {
    const targetEl = event.target as HTMLElement | null;
    const target = targetEl?.closest<HTMLElement>(".leditor-footnote-entry");
    if (!target) return;
    const footnoteId = target.dataset.footnoteId;
    if (!footnoteId) return;
    const textEl = targetEl?.closest?.<HTMLElement>(".leditor-footnote-entry-text");
    // Keep clicks inside the footnote UI from falling through to body handlers that restore the ProseMirror caret.
    // If the user clicked in the text area, ensure focus without forcibly moving the caret (browser places it).
    if (textEl) {
      event.stopPropagation();
      if (!footnoteMode || activeFootnoteId !== footnoteId) {
        event.preventDefault();
        focusFootnoteEntry(footnoteId, "preserve");
        return;
      }
      try {
        textEl.focus({ preventScroll: true } as any);
      } catch {
        textEl.focus();
      }
      return;
    }

    // Click on the row (number etc): enter footnote mode and place caret at the stored position.
    if (!footnoteMode || activeFootnoteId !== footnoteId) {
      event.preventDefault();
      event.stopPropagation();
      focusFootnoteEntry(footnoteId, "preserve");
      return;
    }
  };

  const handleFootnoteEntryInput = (event: Event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".leditor-footnote-entry-text");
    if (!target) return;
    const footnoteId = target.dataset.footnoteId;
    if (!footnoteId) return;
    const view = getFootnoteRegistry().get(footnoteId);
    const text = target.textContent ?? "";
    if (!view) {
      footnoteTextFallback.set(footnoteId, text);
      return;
    }
    view.setPlainText(text);
  };

  const focusEndnoteEntry = (footnoteId: string) => {
    const entry = appRoot.querySelector<HTMLElement>(
      `.leditor-endnote-entry[data-footnote-id="${footnoteId}"]`
    );
    if (!entry) return;
    entry.scrollIntoView({ block: "center", behavior: "smooth" });
    const text = entry.querySelector<HTMLElement>(".leditor-endnote-entry-text");
    text?.focus();
  };

  const handleEndnoteEntryClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".leditor-endnote-entry");
    if (!target) return;
    const footnoteId = target.dataset.footnoteId;
    if (!footnoteId) return;
    focusEndnoteEntry(footnoteId);
  };

  const handleEndnoteEntryInput = (event: Event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".leditor-endnote-entry-text");
    if (!target) return;
    const host = target.closest<HTMLElement>(".leditor-endnote-entry");
    const footnoteId = host?.dataset.footnoteId;
    if (!footnoteId) return;
    const view = getFootnoteRegistry().get(footnoteId);
    const text = target.textContent ?? "";
    if (!view) {
      footnoteTextFallback.set(footnoteId, text);
      return;
    }
    view.setPlainText(text);
  };

  let footnoteHeightHandle = 0;
  const footnoteHeightCache = new Map<number, number>();
  const FOOTNOTE_HEIGHT_DIRTY_THRESHOLD = 0.75;
  function scheduleFootnoteHeightMeasurement() {
    if (footnoteHeightHandle) return;
    footnoteHeightHandle = window.requestAnimationFrame(() => {
      footnoteHeightHandle = 0;
      const footnoteContainers = Array.from(
        overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay .leditor-page-footnotes")
      );
      const editorInstance = attachedEditorHandle?.getEditor();
      const proseRoot = (editorInstance?.view?.dom as HTMLElement | null) ?? null;
      const pageStackPages = proseRoot
        ? Array.from(proseRoot.querySelectorAll<HTMLElement>(".leditor-page"))
        : Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page"));
      const rootTokens = getComputedStyle(document.documentElement);
      const docFooterDistancePx = Number.parseFloat(rootTokens.getPropertyValue("--doc-footer-distance").trim() || "48");
      const footerHeightPx = Number.parseFloat(rootTokens.getPropertyValue("--footer-height").trim() || "48");
      let maxHeight = 0;
      let earliestDirtyPage: number | null = null;
      footnoteContainers.forEach((container) => {
        const host = container.closest<HTMLElement>(".leditor-page-overlay");
        const hasEntries = container.querySelector(".leditor-footnote-entry") != null;
        // When there are no entries, we should not reserve the base footnote-area-height. Only reserve
        // the footer distance + footer height in that case (Word-like behavior).
        if (!hasEntries) {
          container.classList.remove("leditor-page-footnotes--active");
          container.setAttribute("aria-hidden", "true");
          container.style.setProperty("--page-footnote-height", "0px");
          if (host) {
            host.style.setProperty("--page-footnote-height", "0px");
          }
        }
        const height = hasEntries ? Math.max(0, Math.round(container.scrollHeight)) : 0;
        container.style.setProperty("--page-footnote-height", `${height}px`);
        if (host) {
          host.style.setProperty("--page-footnote-height", `${height}px`);
          const currentMarginBottomPx = Number.parseFloat(
            getComputedStyle(host).getPropertyValue("--current-margin-bottom").trim() || "0"
          );
          const effectiveBottomPx = Math.max(
            currentMarginBottomPx,
            (Number.isFinite(docFooterDistancePx) ? docFooterDistancePx : 48) +
              (Number.isFinite(footerHeightPx) ? footerHeightPx : 48) +
              height
          );
          host.style.setProperty("--effective-margin-bottom", `${Math.max(0, Math.round(effectiveBottomPx))}px`);
          const pageIndex = Number(host.dataset.pageIndex ?? "-1");
          if (pageIndex >= 0) {
            const pageStackPage = pageStackPages[pageIndex] ?? null;
            pageStackPage?.style.setProperty("--page-footnote-height", `${height}px`);
            pageStackPage?.style.setProperty(
              "--effective-margin-bottom",
              `${Math.max(0, Math.round(effectiveBottomPx))}px`
            );
            const prevHeight = footnoteHeightCache.get(pageIndex);
            if (prevHeight === undefined || Math.abs(height - prevHeight) >= FOOTNOTE_HEIGHT_DIRTY_THRESHOLD) {
              footnoteHeightCache.set(pageIndex, height);
              earliestDirtyPage =
                earliestDirtyPage === null ? pageIndex : Math.min(earliestDirtyPage, pageIndex);
            }
          }
        }
        if (height > maxHeight) {
          maxHeight = height;
        }
      });
      zoomLayer.style.setProperty("--page-footnote-height", `${maxHeight}px`);
      const baseMarginBottomPx = Number.parseFloat(
        getComputedStyle(zoomLayer).getPropertyValue("--current-margin-bottom").trim() || "0"
      );
      const effectiveBottomPx = Math.max(
        baseMarginBottomPx,
        (Number.isFinite(docFooterDistancePx) ? docFooterDistancePx : 48) +
          (Number.isFinite(footerHeightPx) ? footerHeightPx : 48) +
          maxHeight
      );
      zoomLayer.style.setProperty("--effective-margin-bottom", `${Math.max(0, Math.round(effectiveBottomPx))}px`);
      if (earliestDirtyPage !== null) {
        requestPagination();
      }
    });
  }

  let footnoteUpdateHandle = 0;
  const scheduleFootnoteUpdate = () => {
    if (footnoteUpdateHandle) return;
    footnoteUpdateHandle = window.requestAnimationFrame(() => {
      footnoteUpdateHandle = 0;
      renderFootnoteSections();
    });
  };

  const buildOverlayPage = (index: number) => {
    const overlay = document.createElement("div");
    overlay.className = "leditor-page-overlay";
    overlay.dataset.pageIndex = String(index);
    const header = document.createElement("div");
    header.className = "leditor-page-header";
    header.dataset.leditorPlaceholder = "Header";
    header.contentEditable = "false";
    header.innerHTML = normalizeHeaderFooterHtml(headerHtml);
    const footer = document.createElement("div");
    footer.className = "leditor-page-footer";
    footer.dataset.leditorPlaceholder = "Footer";
    footer.contentEditable = "false";
    footer.innerHTML = normalizeHeaderFooterHtml(footerHtml);
    const footnotes = document.createElement("div");
    footnotes.className = "leditor-page-footnotes";
    footnotes.dataset.leditorPlaceholder = "Footnotes";
    footnotes.textContent = "";
    footnotes.setAttribute("aria-hidden", "false");
    footnotes.contentEditable = "false";
    const marginGuide = document.createElement("div");
    marginGuide.className = "leditor-margin-guide";
    overlay.appendChild(header);
    overlay.appendChild(footnotes);
    overlay.appendChild(footer);
    overlay.appendChild(marginGuide);
    return overlay;
  };

  const normalizePageInnerOrder = (inner: HTMLElement) => {
    const header = inner.querySelector<HTMLElement>(".leditor-page-header");
    const content = inner.querySelector<HTMLElement>(".leditor-page-content");
    const continuation = inner.querySelector<HTMLElement>(".leditor-footnote-continuation");
    const footnotes = inner.querySelector<HTMLElement>(".leditor-page-footnotes");
    const footer = inner.querySelector<HTMLElement>(".leditor-page-footer");
    if (!header || !content || !footnotes || !footer || !continuation) return;
    inner.appendChild(header);
    inner.appendChild(content);
    inner.appendChild(continuation);
    inner.appendChild(footnotes);
    inner.appendChild(footer);
  };

  const buildPageShell = (index: number) => {
    const page = document.createElement("div");
    page.className = "leditor-page";
    page.dataset.pageIndex = String(index);
    const inner = document.createElement("div");
    inner.className = "leditor-page-inner";
    const header = document.createElement("div");
    header.className = "leditor-page-header";
    header.dataset.leditorPlaceholder = "Header";
    header.innerHTML = normalizeHeaderFooterHtml(headerHtml);
    header.setAttribute("aria-hidden", "true");
    header.contentEditable = "false";
    const footer = document.createElement("div");
    footer.className = "leditor-page-footer";
    footer.dataset.leditorPlaceholder = "Footer";
    footer.innerHTML = normalizeHeaderFooterHtml(pageStackFooterHtml);
    footer.setAttribute("aria-hidden", "true");
    footer.contentEditable = "false";
    const footnotes = document.createElement("div");
    footnotes.className = "leditor-page-footnotes";
    footnotes.dataset.leditorPlaceholder = "Footnotes";
    footnotes.setAttribute("aria-hidden", "true");
    footnotes.contentEditable = "false";
    const content = document.createElement("div");
    content.className = "leditor-page-content";
    content.contentEditable = "true";
    content.setAttribute("role", "textbox");
    content.setAttribute("translate", "no");
    const continuation = document.createElement("div");
    continuation.className = "leditor-footnote-continuation";
    continuation.setAttribute("aria-hidden", "true");
    continuation.contentEditable = "false";
    inner.appendChild(header);
    inner.appendChild(content);
    inner.appendChild(continuation);
    inner.appendChild(footnotes);
    inner.appendChild(footer);
    normalizePageInnerOrder(inner);
    page.appendChild(inner);
    const columnGuide = document.createElement("div");
    columnGuide.className = "leditor-page-column-guide";
    page.appendChild(columnGuide);
    return page;
  };

  const createPageTemplate = (index: number) => {
    const page = buildPageShell(index);
    const content = page.querySelector<HTMLElement>(".leditor-page-content");
    if (!content) {
      throw new Error("Page template missing content container.");
    }
    return { page, content };
  };

  const ensureOverlayCount = (count: number) => {
    if (count < 1) {
      throw new Error("Overlay count must be at least 1.");
    }
    while (overlayLayer.children.length > count) {
      overlayLayer.lastElementChild?.remove();
    }
    while (overlayLayer.children.length < count) {
      const index = overlayLayer.children.length;
      overlayLayer.appendChild(buildOverlayPage(index));
    }
  };

  const updateColumnGuide = (page: HTMLElement, columns: number) => {
    const guide = page.querySelector(".leditor-page-column-guide");
    if (!guide) return;
    guide.innerHTML = "";
    for (let i = 1; i < columns; i += 1) {
      guide.appendChild(document.createElement("span"));
    }
  };

  type SectionBoundary = {
    startPage: number;
    sectionId: string;
    meta: SectionMeta;
  };

  const computeSectionStartPage = (
    kind: string,
    element: HTMLElement,
    pageHeight: number,
    editorRect: DOMRect,
    pageCount: number
  ) => {
    const rect = element.getBoundingClientRect();
    const offset = rect.top - editorRect.top;
    let start = Math.floor(offset / pageHeight);
    if (kind !== "section_continuous") {
      start += 1;
    }
    start = Math.max(0, start);
    if ((kind === "section_even" || kind === "section_odd") && start < pageCount) {
      const desiredParity = kind === "section_even" ? 0 : 1;
      while (start < pageCount && ((start + 1) % 2 !== desiredParity)) {
        start += 1;
      }
    }
    return start;
  };

  const computePageSections = (count: number): PageSectionInfo[] => {
    if (count <= 0) return [];
    const layoutOrientation = getOrientation();
    const layoutColumns = Math.max(1, Math.min(2, getLayoutColumns()));
    const sections: SectionBoundary[] = [
      {
        startPage: 0,
        sectionId: DEFAULT_SECTION_ID,
        meta: {
          ...defaultSectionMeta,
          orientation: layoutOrientation,
          columns: layoutColumns as SectionMeta["columns"]
        }
      }
    ];
    const pageHeight = measurePageHeight();
    if (pageHeight > 0) {
      const editorRect = editorEl.getBoundingClientRect();
      Array.from(editorEl.querySelectorAll(".leditor-break[data-break-kind]")).forEach(
        (node, index) => {
          const element = node as HTMLElement;
          const kind = element.dataset.breakKind;
          if (!kind || !SECTION_KINDS.has(kind)) return;
          const startPage = computeSectionStartPage(
            kind,
            element,
            pageHeight,
            editorRect,
            count
          );
          if (startPage >= count) return;
          const sectionId = element.dataset.sectionId ?? `${DEFAULT_SECTION_ID}-${index + 1}`;
          const meta = parseSectionMeta(element.dataset.sectionSettings);
          sections.push({ startPage, sectionId, meta });
        }
      );
    }
    sections.sort((a, b) => a.startPage - b.startPage);
    const pageInfos: PageSectionInfo[] = [];
    let boundaryIndex = 0;
    for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
      while (
        boundaryIndex + 1 < sections.length &&
        pageIndex >= sections[boundaryIndex + 1].startPage
      ) {
        boundaryIndex += 1;
      }
      const section = sections[boundaryIndex];
      const parity = (pageIndex + 1) % 2 === 0 ? "even" : "odd";
      pageInfos.push({
        sectionId: section.sectionId,
        meta: section.meta,
        parity
      });
    }
    return pageInfos;
  };

const PAGE_MARGIN_TOP_VAR = "var(--page-margin-top)";
const PAGE_MARGIN_BOTTOM_VAR = "var(--page-margin-bottom)";

const setOverlayMarginVars = (
  overlay: HTMLElement,
  top: string,
  bottom: string,
  left: string,
  right: string
) => {
  overlay.style.setProperty("--current-margin-top", top);
  overlay.style.setProperty("--current-margin-bottom", bottom);
  overlay.style.setProperty("--current-margin-left", left);
  overlay.style.setProperty("--current-margin-right", right);
  overlay.style.setProperty("--local-page-margin-top", top);
  overlay.style.setProperty("--local-page-margin-bottom", bottom);
  overlay.style.setProperty("--local-page-margin-left", left);
  overlay.style.setProperty("--local-page-margin-right", right);
};

const applySectionStyling = (page: HTMLElement, sectionInfo: PageSectionInfo | null, index: number) => {
  const info = sectionInfo ?? {
    sectionId: DEFAULT_SECTION_ID,
    meta: defaultSectionMeta,
    parity: (index + 1) % 2 === 0 ? "even" : "odd"
    };
    page.dataset.sectionId = info.sectionId;
    const isLandscape = info.meta.orientation === "landscape";
    const width = isLandscape ? "var(--page-height)" : "var(--page-width)";
    const height = isLandscape ? "var(--page-width)" : "var(--page-height)";
    page.style.setProperty("--local-page-width", width);
    page.style.setProperty("--local-page-height", height);
    page.style.setProperty("--local-page-margin-top", "var(--page-margin-top)");
    page.style.setProperty("--local-page-margin-bottom", "var(--page-margin-bottom)");
    const leftMargin = info.meta.mirrored
      ? info.parity === "odd"
        ? "var(--page-margin-inside)"
        : "var(--page-margin-outside)"
      : "var(--page-margin-left)";
    const rightMargin = info.meta.mirrored
      ? info.parity === "odd"
        ? "var(--page-margin-outside)"
        : "var(--page-margin-inside)"
      : "var(--page-margin-right)";
    page.style.setProperty("--local-page-margin-left", leftMargin);
    page.style.setProperty("--local-page-margin-right", rightMargin);
    page.classList.toggle("is-landscape", isLandscape);

    const topMargin = "var(--local-page-margin-top, var(--page-margin-top))";
    const bottomMargin = "var(--local-page-margin-bottom, var(--page-margin-bottom))";
    const computedStyle = getComputedStyle(page);
    const resolvedTopMargin = computedStyle.getPropertyValue("--local-page-margin-top").trim() || topMargin;
    const resolvedBottomMargin =
      computedStyle.getPropertyValue("--local-page-margin-bottom").trim() || bottomMargin;
    const resolvedLeftMargin = computedStyle.getPropertyValue("--local-page-margin-left").trim() || leftMargin;
    const resolvedRightMargin = computedStyle.getPropertyValue("--local-page-margin-right").trim() || rightMargin;

    if (index === 0) {
      zoomLayer.style.setProperty("--local-page-width", width);
      zoomLayer.style.setProperty("--local-page-height", height);
      syncCurrentMargins(resolvedTopMargin, resolvedBottomMargin, resolvedLeftMargin, resolvedRightMargin);
    }

    const columns = Math.max(1, info.meta.columns ?? 1);
    updateColumnGuide(page, columns);
    return {
      top: resolvedTopMargin || topMargin,
      bottom: resolvedBottomMargin || bottomMargin,
      left: resolvedLeftMargin || leftMargin,
      right: resolvedRightMargin || rightMargin
    };
  };

  const applySectionLayouts = (count: number) => {
    pageSections = computePageSections(count);
    const sectionOrder: string[] = [];
    pageSections.forEach((info) => {
      const lastId = sectionOrder[sectionOrder.length - 1];
      if (info.sectionId !== lastId) {
        sectionOrder.push(info.sectionId);
      }
    });
    let inheritedHeader = headerHtml;
    let inheritedFooter = footerHtml;
    sectionOrder.forEach((sectionId) => {
      if (!sectionHeaderContent.has(sectionId)) {
        sectionHeaderContent.set(sectionId, inheritedHeader);
      }
      if (!sectionFooterContent.has(sectionId)) {
        sectionFooterContent.set(sectionId, inheritedFooter);
      }
      inheritedHeader = sectionHeaderContent.get(sectionId) ?? headerHtml;
      inheritedFooter = sectionFooterContent.get(sectionId) ?? footerHtml;
    });
  const pages = (paginationEnabled
    ? Array.from(editorEl.querySelectorAll(".leditor-page"))
    : Array.from(pageStack.children)) as HTMLElement[];
  const overlays = Array.from(overlayLayer.children) as HTMLElement[];
  pages.forEach((page, index) => {
    const margins = applySectionStyling(page, pageSections[index] ?? null, index);
    const overlay = overlays[index];
    if (overlay) {
      setOverlayMarginVars(overlay, margins.top, margins.bottom, margins.left, margins.right);
      const sectionInfo = pageSections[index];
      overlay.dataset.sectionId = sectionInfo ? sectionInfo.sectionId : DEFAULT_SECTION_ID;
    }
  });
  };

const renderPages = (count: number) => {
  // The overlay DOM gets rebuilt here. If a footnote render is already queued, it may render
  // into stale containers and then get "lost" when overlays are recreated. Cancel and allow
  // a fresh render to run after the new overlays exist.
  if (footnoteUpdateHandle) {
    window.cancelAnimationFrame(footnoteUpdateHandle);
    footnoteUpdateHandle = 0;
  }
  if (footnoteHeightHandle) {
    window.cancelAnimationFrame(footnoteHeightHandle);
    footnoteHeightHandle = 0;
  }
  if (paginationEnabled) {
    Array.from(pageStack.children).forEach((child) => {
      if (child !== editorEl) child.remove();
    });
    overlayLayer.innerHTML = "";
    if (window.__leditorPaginationDebug) {
      console.info("[PaginationDebug] renderPages start (paginationEnabled)", {
        requestedCount: count,
        editorPages: editorEl.querySelectorAll(".leditor-page").length
      });
    }
    attachEditorForMode();
    const pageCount = Math.max(1, editorEl.querySelectorAll(".leditor-page").length);
    for (let i = 0; i < pageCount; i += 1) {
      overlayLayer.appendChild(buildOverlayPage(i));
    }
    if (window.__leditorPaginationDebug) {
      console.info("[PaginationDebug] renderPages pages appended", { overlayCount: overlayLayer.children.length });
    }
    applySectionLayouts(pageCount);
    syncHeaderFooter();
    updatePageNumbers();
    applyGridMode();
    return;
  }
    pageStack.innerHTML = "";
    overlayLayer.innerHTML = "";
    for (let i = 0; i < count; i += 1) {
      pageStack.appendChild(buildPageShell(i));
      overlayLayer.appendChild(buildOverlayPage(i));
    }
    applySectionLayouts(count);
    syncHeaderFooter();
    updatePageNumbers();
    applyGridMode();
    scheduleFootnoteUpdate();
    updateHeaderFooterEditability();
  };

  let missingProseRootRetries = 0;
  const attachEditorForMode = () => {
    // If the host detaches the editor (panel switches / DOM rebuild), avoid doing
    // pagination work until we're connected again.
    if (!editorEl.isConnected || !appRoot.isConnected) {
      missingProseRootRetries = 0;
      return;
    }
    if (editorEl.parentElement !== pageStack) {
      pageStack.appendChild(editorEl);
    }
    editorEl.style.width = "100%";
    overlayLayer.style.display = "";
    pageStack.style.pointerEvents = "auto";
    pageStack.style.zIndex = "2";
    // In normal body editing, overlays must be visual-only and must not block ProseMirror caret placement.
    overlayLayer.style.pointerEvents = "none";
    overlayLayer.style.zIndex = "3";
    headerFooterMode = false;
    activeRegion = null;
    appRoot.classList.remove("leditor-header-footer-editing");
    const editorInstance = attachedEditorHandle?.getEditor();
    const prose = (editorInstance?.view?.dom as HTMLElement | null) ?? editorEl.querySelector<HTMLElement>(".ProseMirror");
    if (!prose) {
      // In embedded hosts, DOM reparenting or transient layout churn can momentarily detach/rebuild
      // the ProseMirror root. Avoid crashing; retry a few times and then degrade gracefully.
      missingProseRootRetries += 1;
      if (missingProseRootRetries <= 10) {
        console.warn("[a4_layout.ts][attachEditorForMode][debug] ProseMirror root missing; retrying", {
          attempt: missingProseRootRetries,
          editorChildCount: editorEl.childElementCount,
          editorIsConnected: editorEl.isConnected
        });
        window.requestAnimationFrame(() => {
          try {
            attachEditorForMode();
          } catch {
            // ignore
          }
        });
        return;
      }
      console.error("[a4_layout.ts][attachEditorForMode][debug] ProseMirror root missing; disabling pagination attach", {
        attempts: missingProseRootRetries,
        editorChildCount: editorEl.childElementCount,
        editorIsConnected: editorEl.isConnected
      });
      return;
    }
    missingProseRootRetries = 0;
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl || !editorEl.contains(activeEl)) {
      prose.focus({ preventScroll: true });
    }
    updateHeaderFooterEditability();
    setEditorEditable(true);
    if (!didLogLayoutDebug) {
      didLogLayoutDebug = true;
      const firstPage = editorEl.querySelector<HTMLElement>(".leditor-page");
      const pageInner = firstPage?.querySelector<HTMLElement>(".leditor-page-inner") ?? null;
      const pageHeader = pageInner?.querySelector<HTMLElement>(".leditor-page-header") ?? null;
      const pageFooter = pageInner?.querySelector<HTMLElement>(".leditor-page-footer") ?? null;
      const pageFootnotes = pageInner?.querySelector<HTMLElement>(".leditor-page-footnotes") ?? null;
      const rect = (el: HTMLElement | null) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, left: r.left, width: r.width, height: r.height, bottom: r.bottom };
      };
      const cssBox = (el: HTMLElement | null) => {
        if (!el) return null;
        const styles = getComputedStyle(el);
        return {
          display: styles.display,
          position: styles.position,
          inset: styles.inset,
          top: styles.top,
          right: styles.right,
          bottom: styles.bottom,
          left: styles.left,
          height: styles.height,
          minHeight: styles.minHeight,
          zIndex: styles.zIndex,
          backgroundColor: styles.backgroundColor
        };
      };
      const cssVars = (el: HTMLElement | null, keys: string[]) => {
        if (!el) return null;
        const styles = getComputedStyle(el);
        const out: Record<string, string> = {};
        keys.forEach((key) => {
          out[key] = styles.getPropertyValue(key).trim();
        });
        return out;
      };
      const styleAttr = (el: HTMLElement | null) => (el ? el.getAttribute("style") || "" : "");
      const payload = {
        pageStackPointerEvents: getComputedStyle(pageStack).pointerEvents,
        overlayPointerEvents: getComputedStyle(overlayLayer).pointerEvents,
        pageStackZIndex: getComputedStyle(pageStack).zIndex,
        overlayZIndex: getComputedStyle(overlayLayer).zIndex,
        zoomPointerEvents: getComputedStyle(zoomLayer).pointerEvents,
        appRootPointerEvents: getComputedStyle(appRoot).pointerEvents,
        headerFooterClassActive: appRoot.classList.contains("leditor-header-footer-editing"),
        pageStackPointerEventsInline: pageStack.style.pointerEvents || "",
        overlayPointerEventsInline: overlayLayer.style.pointerEvents || "",
        editorPointerEvents: getComputedStyle(prose).pointerEvents,
        editorEditable: prose.contentEditable,
        headerFooterMode,
        pageCount: editorEl.querySelectorAll(".leditor-page").length,
        pageFootnotesCount: editorEl.querySelectorAll(".leditor-page .leditor-page-footnotes").length,
        overlayFootnotesCount: overlayLayer.querySelectorAll(".leditor-page-overlay .leditor-page-footnotes").length,
        firstPageRect: rect(firstPage),
        firstHeaderRect: rect(pageHeader),
        firstFooterRect: rect(pageFooter),
        firstFootnotesRect: rect(pageFootnotes),
        firstHeaderComputed: cssBox(pageHeader),
        firstFooterComputed: cssBox(pageFooter),
        firstFootnotesComputed: cssBox(pageFootnotes),
        firstHeaderStyleAttr: styleAttr(pageHeader),
        firstFooterStyleAttr: styleAttr(pageFooter),
        firstFootnotesStyleAttr: styleAttr(pageFootnotes),
        headerSelectorMatches: {
          headerIsDirectChild: Boolean(pageHeader && pageHeader.parentElement === pageInner),
          footerIsDirectChild: Boolean(pageFooter && pageFooter.parentElement === pageInner),
          footnotesIsDirectChild: Boolean(pageFootnotes && pageFootnotes.parentElement === pageInner),
          headerMatches: Boolean(pageHeader?.matches(".leditor-page-inner > .leditor-page-header")),
          footerMatches: Boolean(pageFooter?.matches(".leditor-page-inner > .leditor-page-footer")),
          footnotesMatches: Boolean(pageFootnotes?.matches(".leditor-page-inner > .leditor-page-footnotes"))
        },
        headerInlinePriority: pageHeader
          ? {
              top: pageHeader.style.getPropertyPriority("top"),
              bottom: pageHeader.style.getPropertyPriority("bottom"),
              inset: pageHeader.style.getPropertyPriority("inset")
            }
          : null,
        firstPageVars: cssVars(firstPage, [
          "--doc-header-distance",
          "--doc-footer-distance",
          "--page-margin-top",
          "--page-margin-bottom",
          "--header-height",
          "--footer-height",
          "--header-offset",
          "--footer-offset",
          "--footnote-area-height",
          "--page-footnote-height",
          "--local-page-margin-top",
          "--local-page-margin-bottom"
        ])
      };
      if ((window as any).__leditorA4Debug) {
        console.info("[Footnote][debug] attachEditorForMode::json", JSON.stringify(payload));
      }
    }
  };

  const measurePageHeight = () => {
    const page = pageStack.querySelector(".leditor-page") as HTMLElement | null;
    if (!page) return 0;
    return page.getBoundingClientRect().height;
  };

  const measurePageGap = () => {
    const styles = getComputedStyle(pageStack);
    const gap = Number.parseFloat(styles.rowGap || styles.gap || "0");
    return Number.isFinite(gap) ? gap : 0;
  };

  // The A4 page stack must be allowed to grow to the full document height so the shell can scroll.
  // Only clamp *manual* overrides to avoid absurd values.
  const CONTENT_FRAME_MAX_PX = 200000;
  const CONTENT_FRAME_MIN_PX = 200;
  let manualContentFrameHeight: number | null = null;
  const clampContentFrameHeight = (value: number) =>
    Math.max(CONTENT_FRAME_MIN_PX, Math.min(CONTENT_FRAME_MAX_PX, Math.round(value)));
  const updateContentHeight = () => {
    const pageHeight = measurePageHeight();
    const gap = measurePageGap();
    if (pageHeight <= 0) return;
    const total = pageCount * pageHeight + Math.max(0, pageCount - 1) * gap;
    const nextHeight = manualContentFrameHeight != null ? clampContentFrameHeight(manualContentFrameHeight) : Math.ceil(total);
    pageStack.style.minHeight = `${nextHeight}px`;
  };

  const syncZoomBox = () => {
    // CSS transforms don't affect layout sizing; keep the zoom wrapper sized to the scaled content
    // so the "center" calculation remains visually centered.
    // IMPORTANT: measure the intrinsic (untransformed) content, not the zoom wrapper.
    // zoomContent can stretch to the current wrapper width, which would create feedback loops.
    const unscaledW = pageStack.scrollWidth || pageStack.offsetWidth;
    const unscaledH = pageStack.scrollHeight || pageStack.offsetHeight;
    if (unscaledW <= 0 || unscaledH <= 0) return;
    zoomLayer.style.width = "100%";
    zoomLayer.style.height = `${Math.ceil(unscaledH * zoomValue)}px`;
  };

  const syncZoomTransform = () => {
    zoomContent.style.transform = `scale(${zoomValue})`;
  };

  const computeHeightPages = () => {
    const pageHeight = measurePageHeight();
    if (pageHeight <= 0) return 1;
    const gap = measurePageGap();
    const contentHeight = editorEl.scrollHeight;
    const total = pageHeight + gap;
    return Math.max(1, Math.ceil((contentHeight + gap) / total));
  };

  const updatePagination = () => {
    suspendPageObserver = true;
    const scrollTopBefore = appRoot.scrollTop;
    const scrollLeftBefore = appRoot.scrollLeft;
    try {
      const rootStyle = getComputedStyle(document.documentElement);
      const pageColumns = rootStyle.getPropertyValue("--page-columns").trim();
      if (pageColumns && pageColumns !== "1") {
        console.warn("[PaginationDebug] forcing page columns to 1", { pageColumns });
        setSectionColumns(1);
        return;
      }
      if (window.__leditorPaginationDebug) {
        console.info("[PaginationDebug] css tokens", {
          pageWidth: rootStyle.getPropertyValue("--page-width").trim(),
          pageHeight: rootStyle.getPropertyValue("--page-height").trim(),
          marginTop: rootStyle.getPropertyValue("--page-margin-top").trim(),
          marginRight: rootStyle.getPropertyValue("--page-margin-right").trim(),
          marginBottom: rootStyle.getPropertyValue("--page-margin-bottom").trim(),
          marginLeft: rootStyle.getPropertyValue("--page-margin-left").trim(),
          docPageWidth: rootStyle.getPropertyValue("--doc-page-width").trim(),
          docPageHeight: rootStyle.getPropertyValue("--doc-page-height").trim(),
          docMarginTop: rootStyle.getPropertyValue("--doc-margin-top").trim(),
          docMarginRight: rootStyle.getPropertyValue("--doc-margin-right").trim(),
          docMarginBottom: rootStyle.getPropertyValue("--doc-margin-bottom").trim(),
          docMarginLeft: rootStyle.getPropertyValue("--doc-margin-left").trim(),
          pageColumns
        });
        const sampleContent = editorEl.querySelector<HTMLElement>(".leditor-page-content");
        if (sampleContent) {
          const rect = sampleContent.getBoundingClientRect();
          const contentStyle = getComputedStyle(sampleContent);
          console.info("[PaginationDebug] content rect", {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left,
            columnCount: contentStyle.columnCount,
            columnGap: contentStyle.columnGap
          });
        }
      }
      const overlayPageCount = overlayLayer.children.length;
      const editorPageCount = editorEl.querySelectorAll(".leditor-page").length;
      const firstOverlay = overlayLayer.querySelector<HTMLElement>(".leditor-page-overlay");
      const overlayInfo = {
        overlayPageCount,
        overlayChildCount: overlayLayer.children.length,
        overlayVisible: overlayLayer.style.display || window.getComputedStyle(overlayLayer).display,
        overlayHeight: firstOverlay?.offsetHeight ?? null,
        overlayWidth: firstOverlay?.offsetWidth ?? null
      };
      const pageStackInfo = {
        stackChildCount: pageStack.children.length,
        stackDisplay: pageStack.style.display || window.getComputedStyle(pageStack).display,
        stackPointerEvents: pageStack.style.pointerEvents
      };
      if (window.__leditorPaginationDebug) {
        const pageStackRect = pageStack.getBoundingClientRect();
        console.info("[PaginationDebug] pagination state", {
          paginationEnabled,
          pageCount,
          editorPageCount,
          editorScrollHeight: editorEl.scrollHeight,
          overlayInfo,
          pageStackInfo,
          pageStackVisible: pageStackInfo.stackDisplay,
          pageStackHeight: pageStackRect.height,
          editorPageHeight: measurePageHeight()
        });
      }
      const ensureOverlayPages = (count: number): boolean => {
        const current = overlayLayer.children.length;
        if (current !== count) {
          renderPages(count);
          return true;
        }
        return false;
      };

      if (paginationEnabled) {
        const nextCount = Math.max(1, editorEl.querySelectorAll(".leditor-page").length);
        if (ensureOverlayPages(nextCount)) {
          applySectionLayouts(nextCount);
          syncHeaderFooter();
          updatePageNumbers();
          scheduleFootnoteUpdate();
          syncZoomBox();
          return;
        }
        if (nextCount !== pageCount) {
          pageCount = nextCount;
          renderPages(pageCount);
        } else {
          applySectionLayouts(pageCount);
          syncHeaderFooter();
          updatePageNumbers();
        }
        scheduleFootnoteUpdate();
        syncZoomBox();
        return;
      }

      const heightCount = computeHeightPages();
      const manualCount = countManualPageBreaks(editorEl) + 1;
      const nextCount = Math.max(heightCount, manualCount);
      if (nextCount !== pageCount) {
        pageCount = nextCount;
        renderPages(pageCount);
        attachEditorForMode();
      } else {
        applySectionLayouts(pageCount);
        syncHeaderFooter();
      }
      updateContentHeight();
      syncZoomBox();
    } finally {
      const now = performance.now();
      const preserveScroll = Boolean((window as any).__leditorPreserveScrollOnNextPagination);
      if (preserveScroll) {
        (window as any).__leditorPreserveScrollOnNextPagination = false;
        appRoot.scrollTop = scrollTopBefore;
        appRoot.scrollLeft = scrollLeftBefore;
      } else if (now - lastUserScrollAt < 250) {
        appRoot.scrollTop = scrollTopBefore;
        appRoot.scrollLeft = scrollLeftBefore;
      }
      if (!didInitialCenter && now - lastUserScrollAt >= 250) {
        didInitialCenter = true;
        // Defer to allow layout sizing (scrollWidth/clientWidth) to settle.
        window.requestAnimationFrame(() => centerDocHorizontally());
      }
      // Preserve the user's editing surface across pagination/layout churn.
      if (headerFooterMode && activeRegion) {
        window.requestAnimationFrame(() => {
          try {
            focusHeaderFooterRegion(activeRegion!, activeHeaderFooterPageIndex);
          } catch {
            // ignore
          }
        });
      }
      if (footnoteMode && activeFootnoteId) {
        // Re-arm focus only if we don't already have focus inside the active footnote editor.
        const active = document.activeElement as HTMLElement | null;
        const sel = window.getSelection?.();
        const focusedText =
          !!activeFootnoteId &&
          !!active &&
          active.classList?.contains("leditor-footnote-entry-text") &&
          active.getAttribute("data-footnote-id") === activeFootnoteId &&
          !!sel &&
          sel.rangeCount > 0 &&
          (sel.anchorNode ? active.contains(sel.anchorNode) : false);
        if (!focusedText) {
          pendingFootnoteFocusId = activeFootnoteId;
          if (!pendingFootnoteFocusAttempts.has(activeFootnoteId)) {
            pendingFootnoteFocusAttempts.set(activeFootnoteId, 0);
          }
          scheduleFootnoteUpdate();
        }
      }
      suspendPageObserver = false;
    }
  };

  function requestPagination() {
    if (paginationQueued) return;
    paginationQueued = true;
    window.requestAnimationFrame(() => {
      paginationQueued = false;
      updatePagination();
    });
  }

  let zoomQueued = false;
  const requestZoomUpdate = () => {
    if (zoomQueued) return;
    zoomQueued = true;
    window.requestAnimationFrame(() => {
      zoomQueued = false;
      updateZoomForViewMode();
    });
  };

  const setContentFrameHeight = (value: number) => {
    if (!Number.isFinite(value)) {
      throw new Error("Content frame height must be a finite number.");
    }
    manualContentFrameHeight = clampContentFrameHeight(value);
    updateContentHeight();
    requestPagination();
  };

  const adjustContentFrameHeight = (delta: number) => {
    if (!Number.isFinite(delta)) {
      throw new Error("Content frame height delta must be finite.");
    }
    const base =
      manualContentFrameHeight ??
      CONTENT_FRAME_MAX_PX;
    manualContentFrameHeight = clampContentFrameHeight(base + delta);
    updateContentHeight();
    requestPagination();
  };

  const resetContentFrameHeight = () => {
    manualContentFrameHeight = null;
    updateContentHeight();
    requestPagination();
  };

  marginUpdate = updatePagination;
  loadStoredMargins();

  const updateZoomForViewMode = () => {
    if (viewMode === "single") return;
    const containerWidth = canvas.getBoundingClientRect().width;
    const pageWidth = (pageStack.querySelector(".leditor-page") as HTMLElement | null)?.getBoundingClientRect().width;
    if (!pageWidth || containerWidth <= 0) return;
    const gap = measurePageGap();
    const columns = viewMode === "two-page" ? 2 : 1;
    // pageWidth is unscaled (we no longer use CSS zoom); targetWidth is unscaled too.
    const targetWidth = columns * pageWidth + Math.max(0, columns - 1) * gap;
    if (targetWidth <= 0) return;
    const minZoom = getCssNumber(canvas, "--min-zoom", 0.3);
    const maxZoom = getCssNumber(canvas, "--max-zoom", 3);
    const nextZoom = clamp(containerWidth / targetWidth, minZoom, maxZoom);
    zoomValue = nextZoom;
    canvas.style.setProperty("--page-zoom", String(zoomValue));
    syncZoomTransform();
    applyGridMode();
    syncZoomBox();
  };

  const setZoom = (value: number) => {
    const minZoom = getCssNumber(canvas, "--min-zoom", 0.3);
    const maxZoom = getCssNumber(canvas, "--max-zoom", 3);
    zoomValue = clamp(value, minZoom, maxZoom);
    viewMode = "single";
    canvas.style.setProperty("--page-zoom", String(zoomValue));
    syncZoomTransform();
    if (appRoot?.classList.contains("leditor-app--show-ruler")) {
      const rulerTrack = canvas.querySelector<HTMLElement>(".leditor-ruler-track");
      if (rulerTrack) {
        rulerTrack.style.width = `calc(var(--page-width) * ${zoomValue})`;
      }
    }
    applyGridMode();
    syncZoomBox();
  };

  const setViewMode = (mode: A4ViewMode) => {
    viewMode = mode;
    pageStack.classList.toggle("is-two-page", mode === "two-page");
    overlayLayer.classList.toggle("is-two-page", mode === "two-page");
    if (mode === "single") {
      canvas.style.setProperty("--page-zoom", String(zoomValue));
      syncZoomTransform();
      applyGridMode();
      syncZoomBox();
      return;
    }
    requestZoomUpdate();
    applyGridMode();
    syncZoomBox();
  };

  const enterHeaderFooterMode = (target?: "header" | "footer", pageIndex?: string | null) => {
    headerFooterMode = true;
    if (!target) {
      throw new Error("Header/footer edit mode requires an active region.");
    }
    captureBodySelection("enter");
    activeRegion = target;
    activeHeaderFooterPageIndex = pageIndex ?? null;
    caretState.active = target;
    appRoot.classList.add("leditor-header-footer-editing");
    // Bring overlays above the page stack for editing.
    overlayLayer.style.zIndex = "4";
    pageStack.style.zIndex = "2";
    overlayLayer.style.pointerEvents = "auto";
    updateHeaderFooterEditability();
    setEditorEditable(false);
    focusHeaderFooterRegion(target, activeHeaderFooterPageIndex);
  };

  const resolvePageIndexFromTarget = (target: HTMLElement | null): string | null => {
    if (!target) return null;
    const overlay = target.closest<HTMLElement>(".leditor-page-overlay");
    const overlayIndex = (overlay?.dataset.pageIndex ?? "").trim();
    if (overlayIndex) return overlayIndex;

    const page = target.closest<HTMLElement>(".leditor-page");
    const pageIndexAttr = (page?.dataset.pageIndex ?? "").trim();
    if (pageIndexAttr) return pageIndexAttr;

    // Fallback: infer from DOM order within the primary ProseMirror.
    const editorInstance = attachedEditorHandle?.getEditor();
    const prose = editorInstance?.view?.dom as HTMLElement | null;
    if (!prose || !page) return null;
    const pages = Array.from(prose.querySelectorAll<HTMLElement>(".leditor-page"));
    const idx = pages.indexOf(page);
    return idx >= 0 ? String(idx) : null;
  };

  const resolvePageIndexFromPoint = (x: number, y: number): string | null => {
    const pages = Array.from(pageStack.querySelectorAll<HTMLElement>(".leditor-page"));
    for (let i = 0; i < pages.length; i += 1) {
      const rect = pages[i]?.getBoundingClientRect();
      if (!rect) continue;
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        const attr = (pages[i].dataset.pageIndex ?? "").trim();
        return attr || String(i);
      }
    }
    return null;
  };

  const resolvePageIndexFromEvent = (event: MouseEvent): string | null => {
    const target = event.target as HTMLElement | null;
    const fromTarget = resolvePageIndexFromTarget(target);
    if (fromTarget) return fromTarget;
    return resolvePageIndexFromPoint(event.clientX, event.clientY);
  };

  const resolveHeaderFooterRegionFromPoint = (
    pageIndex: string | null,
    x: number,
    y: number
  ): "header" | "footer" | null => {
    if (!pageIndex) return null;
    const overlay = overlayLayer.querySelector<HTMLElement>(
      `.leditor-page-overlay[data-page-index="${pageIndex}"]`
    );
    if (!overlay) return null;
    const header = overlay.querySelector<HTMLElement>(".leditor-page-header");
    const footer = overlay.querySelector<HTMLElement>(".leditor-page-footer");
    const within = (rect: DOMRect | null) =>
      !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    if (within(header?.getBoundingClientRect() ?? null)) return "header";
    if (within(footer?.getBoundingClientRect() ?? null)) return "footer";
    return null;
  };

	  const exitHeaderFooterMode = () => {
    headerFooterMode = false;
    activeRegion = null;
    activeHeaderFooterPageIndex = null;
    caretState.active = "body";
	    appRoot.classList.remove("leditor-header-footer-editing");
	    overlayLayer.style.zIndex = "3";
	    pageStack.style.zIndex = "2";
	    overlayLayer.style.pointerEvents = "none";
	    updateHeaderFooterEditability();
	    setEditorEditable(true);
	    restoreBodySelection("exit");
	  };

  const handleOverlayDblClick = (event: MouseEvent) => {
    if (headerFooterMode || footnoteMode) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const pageIndex = resolvePageIndexFromEvent(event);
    const region = resolveHeaderFooterRegionFromPoint(pageIndex, event.clientX, event.clientY);
    if (region) {
      enterHeaderFooterMode(region, pageIndex);
    }
  };

  const handlePageHeaderFooterDblClick = (event: MouseEvent) => {
    if (headerFooterMode || footnoteMode) return;
    const pageIndex = resolvePageIndexFromEvent(event);
    const region = resolveHeaderFooterRegionFromPoint(pageIndex, event.clientX, event.clientY);
    if (!region) return;
    event.preventDefault();
    enterHeaderFooterMode(region, pageIndex);
  };

  const resolveFootnoteFromPoint = (
    pageIndex: string | null,
    x: number,
    y: number
  ): { pageIndex: string; footnoteId: string } | null => {
    if (!pageIndex) return null;
    const overlay = overlayLayer.querySelector<HTMLElement>(
      `.leditor-page-overlay[data-page-index="${pageIndex}"]`
    );
    if (!overlay) return null;
    const container = overlay.querySelector<HTMLElement>(".leditor-page-footnotes");
    if (!container || container.getAttribute("aria-hidden") === "true") return null;
    const containerRect = container.getBoundingClientRect();
    const within =
      x >= containerRect.left && x <= containerRect.right && y >= containerRect.top && y <= containerRect.bottom;
    if (!within) return null;
    const entries = Array.from(container.querySelectorAll<HTMLElement>(".leditor-footnote-entry[data-footnote-id]"));
    if (!entries.length) return null;

    // Prefer exact hit on an entry row (by rect), else choose the nearest-by-y.
    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const entry of entries) {
      const rect = entry.getBoundingClientRect();
      const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      const distance = inside ? 0 : Math.abs(y - (rect.top + rect.height / 2));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }
    const footnoteId = (best?.dataset.footnoteId ?? "").trim();
    if (!footnoteId) return null;
    return { pageIndex, footnoteId };
  };

  const handlePageFootnoteClick = (event: MouseEvent) => {
    // In normal mode we keep overlays non-interactive so the body caret works.
    // That means a click in the reserved footnotes band will land on the page stack.
    // Detect it and delegate into footnote edit mode.
    if (headerFooterMode || footnoteMode) return;
    if (event.button !== 0) return;
    const pageIndex = resolvePageIndexFromEvent(event);
    const hit = resolveFootnoteFromPoint(pageIndex, event.clientX, event.clientY);
    if (!hit) return;
    event.preventDefault();
    focusFootnoteEntry(hit.footnoteId, "preserve");
  };

  const handleOverlayInput = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Overlays can emit input events outside header/footer mode (e.g., footnote editors).
    // Never throw here; it can black-screen the app.
    if (!headerFooterMode) return;
    const overlay = target.closest<HTMLElement>(".leditor-page-overlay");
    const sectionId = overlay?.dataset.sectionId ?? DEFAULT_SECTION_ID;
    if (target.classList.contains("leditor-page-header")) {
      sectionHeaderContent.set(sectionId, target.innerHTML);
      syncHeaderFooter();
      return;
    }
    if (target.classList.contains("leditor-page-footer")) {
      sectionFooterContent.set(sectionId, target.innerHTML);
      syncHeaderFooter();
    }
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (!headerFooterMode && !footnoteMode) {
      const target = event.target as HTMLElement | null;
      const footnoteText = target?.closest?.<HTMLElement>(".leditor-footnote-entry-text");
      if (footnoteText) {
        const footnoteId = (footnoteText.dataset.footnoteId ?? "").trim();
        if (footnoteId) {
          focusFootnoteEntry(footnoteId, "preserve");
          return;
        }
      }
    }
    if (footnoteMode && !headerFooterMode) {
      const target = event.target as HTMLElement | null;
      const inFootnotes = target?.closest?.(".leditor-page-footnotes, .leditor-footnote-entry, .leditor-footnote-entry-text");
      if (!inFootnotes) {
        // Treat clicks outside the footnote UI as an intent to return to the body at that click.
        exitFootnoteMode({ restore: true, coords: { x: event.clientX, y: event.clientY } });
      }
      return;
    }
    if (!headerFooterMode) return;
    const target = event.target as HTMLElement | null;
    const inHeader = target?.closest?.(".leditor-page-header");
    const inFooter = target?.closest?.(".leditor-page-footer");
    if (activeRegion === "header" && inHeader) {
      const overlay = (inHeader as HTMLElement).closest<HTMLElement>(".leditor-page-overlay");
      focusHeaderFooterRegion("header", overlay?.dataset.pageIndex ?? null);
      return;
    }
    if (activeRegion === "footer" && inFooter) {
      const overlay = (inFooter as HTMLElement).closest<HTMLElement>(".leditor-page-overlay");
      focusHeaderFooterRegion("footer", overlay?.dataset.pageIndex ?? null);
      return;
    }
    if (!target || (!inHeader && !inFooter)) {
      exitHeaderFooterMode();
    }
  };

  const handleBodyPointerDown = (event: PointerEvent) => {
    // When footnote mode is active, clicks on the body should exit footnote mode and restore the
    // last body selection. Since overlays are usually pointer-events:none, we can't rely on overlay
    // click handlers to catch this.
    if (!footnoteMode || headerFooterMode) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    // Ignore clicks inside overlay footnote UI.
    if (target.closest(".leditor-page-overlays")) {
      return;
    }
    // Click in the body should exit footnote mode and place the caret at the clicked position.
    if (editorEl.contains(target)) {
      exitFootnoteMode({ restore: true, coords: { x: event.clientX, y: event.clientY } });
    }
  };

  const logLayoutDiagnostics = () => {
    const page = pageStack.querySelector<HTMLElement>(".leditor-page");
    const content = page?.querySelector<HTMLElement>(".leditor-page-content");
    const header = page?.querySelector<HTMLElement>(".leditor-page-header");
    const footer = page?.querySelector<HTMLElement>(".leditor-page-footer");
    const footnotes = page?.querySelector<HTMLElement>(".leditor-page-footnotes");
    const overlay = overlayLayer.querySelector<HTMLElement>(".leditor-page-overlay");
    const pageRect = page?.getBoundingClientRect() ?? null;
    const contentRect = content?.getBoundingClientRect() ?? null;
    const headerRect = header?.getBoundingClientRect() ?? null;
    const footerRect = footer?.getBoundingClientRect() ?? null;
    const footnoteRect = footnotes?.getBoundingClientRect() ?? null;
    const overlayRect = overlay?.getBoundingClientRect() ?? null;
    const editorPageCount = editorEl.querySelectorAll(".leditor-page").length;
    const overlayPageCount = overlayLayer.querySelectorAll(".leditor-page-overlay").length;
    const pageStackDisplay =
      pageStack.style.display || window.getComputedStyle(pageStack).display;
    const overlayLayerDisplay =
      overlayLayer.style.display || window.getComputedStyle(overlayLayer).display;
    const pageStackRect = pageStack.getBoundingClientRect();
    const metrics = {
      pageHeight: pageRect?.height ?? null,
      pageWidth: pageRect?.width ?? null,
      contentHeight: contentRect?.height ?? null,
      contentInsetTop:
        pageRect && contentRect ? contentRect.top - pageRect.top : null,
      contentInsetBottom:
        pageRect && contentRect ? pageRect.bottom - contentRect.bottom : null,
      headerHeight: headerRect?.height ?? null,
      footerHeight: footerRect?.height ?? null,
      footnoteHeight: footnoteRect?.height ?? null,
      overlayHeight: overlayRect?.height ?? null,
      editorPageCount,
      overlayPageCount,
      paginationEnabled,
      pageStackChildCount: pageStack.children.length,
      pageStackDisplay,
      overlayLayerDisplay,
      headerFooterMode,
      editorScrollHeight: editorEl.scrollHeight,
      pageStackHeight: pageStackRect.height,
      pageStackScroll: pageStack.scrollHeight
    };
    console.info("[A4 layout debug]", metrics);
  };

  const logMissingRibbonIcons = () => {
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(".leditor-ribbon [data-control-id]")
    );
    const supported = new Set([
      "button",
      "toggleButton",
      "splitButton",
      "splitToggleButton",
      "colorSplitButton",
      "dropdown",
      "colorPicker",
      "dialogLauncher"
    ]);
    const emptyControls = controls
      .filter((el) => {
        const type = el.dataset.controlType;
        return type && supported.has(type);
      })
      .map((el) => {
        const icon = el.querySelector(".leditor-ribbon-icon");
        const hasIcon = icon && !icon.classList.contains("leditor-ribbon-icon-placeholder");
        return {
          controlId: el.dataset.controlId ?? "",
          controlType: el.dataset.controlType ?? "",
          hasIcon
        };
      })
      .filter((entry) => !entry.hasIcon);
    if (emptyControls.length) {
      console.info(
        "[Ribbon] Controls missing icons:",
        emptyControls.map((entry) => entry.controlId)
      );
      console.table(emptyControls);
    } else {
      console.info("[Ribbon] All icon-capable controls have icons.");
    }
  };

  const handleKeydown = (event: KeyboardEvent) => {
    const keyTarget = event.target as HTMLElement | null;
    if (event.key === "Escape") {
      if (headerFooterMode) {
        event.preventDefault();
        exitHeaderFooterMode();
        return;
      }
      if (footnoteMode) {
        event.preventDefault();
        exitFootnoteMode();
        return;
      }
    }
    if (
      keyTarget?.closest(
        ".leditor-footnote-entry-text, .leditor-endnote-entry-text, .leditor-footnote-editor, .footnote-inner-editor"
      )
    ) {
      return;
    }
    // Debug shortcut removed (was easy to trigger and caused confusing log storms + flicker reports).
    if (event.ctrlKey && event.shiftKey && (event.key === "M" || event.key === "m")) {
      event.preventDefault();
      const editorHandle = (
        window as typeof window & { leditor?: { execCommand: (name: string, args?: any) => void } }
      ).leditor;
      editorHandle?.execCommand("SetPageMargins", {
        margins: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }
      });
      const next = !appRoot.classList.contains("leditor-debug-margins");
      appRoot.classList.toggle("leditor-debug-margins", next);
      const proseMirror = editorEl.querySelector<HTMLElement>(".ProseMirror");
      if (!proseMirror) {
        return;
      }
      proseMirror.focus();
      const proseRect = proseMirror.getBoundingClientRect();
      if (next) {
        const root = getComputedStyle(document.documentElement);
        const info = {
          pageWidth: root.getPropertyValue("--page-width").trim(),
          pageHeight: root.getPropertyValue("--page-height").trim(),
          marginTop: root.getPropertyValue("--page-margin-top").trim(),
          marginRight: root.getPropertyValue("--page-margin-right").trim(),
          marginBottom: root.getPropertyValue("--page-margin-bottom").trim(),
          marginLeft: root.getPropertyValue("--page-margin-left").trim()
        };
        const overlay = overlayLayer.querySelector<HTMLElement>(".leditor-page-overlay");
        const guide = overlay?.querySelector<HTMLElement>(".leditor-margin-guide");
        const guideRect = guide?.getBoundingClientRect();
        const pageRect = overlay?.getBoundingClientRect();
        console.info("[A4 margins]", {
          info,
          pageRect,
          guideRect,
          proseRect,
          debugMargins: next
        });
      } else {
        console.info("[A4 margins] shortcut focus", {
          proseRect,
          debugMargins: next
        });
      }
      return;
    }
    if (event.ctrlKey && event.shiftKey && (event.key === "D" || event.key === "d")) {
      event.preventDefault();
      toggleTheme();
      return;
    }
    if (event.ctrlKey && event.shiftKey && (event.key === "P" || event.key === "p")) {
      event.preventDefault();
      togglePageSurface();
      return;
    }
    // Escape handling is above to work even when a footnote/inner editor has focus.
  };

  canvas.addEventListener("pointerdown", ensurePointerSelection, true);
  // Capture phase so header/footer dblclick still works even if other handlers stop propagation.
  overlayLayer.addEventListener("dblclick", handleOverlayDblClick, true);
  pageStack.addEventListener("dblclick", handlePageHeaderFooterDblClick, true);
  pageStack.addEventListener("click", handlePageFootnoteClick, true);
  overlayLayer.addEventListener("input", handleOverlayInput, true);
  overlayLayer.addEventListener("click", handleOverlayClick, true);
  editorEl.addEventListener("pointerdown", handleBodyPointerDown, { capture: true });
  appRoot.addEventListener("click", handleFootnoteEntryClick);
  appRoot.addEventListener("input", handleFootnoteEntryInput);
  appRoot.addEventListener("click", handleEndnoteEntryClick);
  appRoot.addEventListener("input", handleEndnoteEntryInput);
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("selectionchange", handleSelectionChange);

  initTheme();
  const handleFootnoteFocusEvent = (event: Event) => {
    const e = event as CustomEvent<{ footnoteId?: string; selectionSnapshot?: StoredSelection | null }>;
    const id = (e?.detail?.footnoteId ?? "").trim();
    if (!id) return;
    const snapshot = e?.detail?.selectionSnapshot ?? null;
    if (snapshot) {
      pendingFootnoteSourceSelection.set(id, snapshot);
    }
    pendingFootnoteFocusId = id;
    pendingFootnoteFocusAttempts.set(id, 0);
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][focus][event] received", { footnoteId: id });
    }
    scheduleFootnoteUpdate();
  };
  window.addEventListener("leditor:footnote-focus", handleFootnoteFocusEvent as EventListener);
  renderPages(pageCount);
  attachEditorForMode();
  updatePagination();
  scheduleFootnoteUpdate();

  const footnoteObserver = new MutationObserver(() => scheduleFootnoteUpdate());
  footnoteObserver.observe(editorEl, { childList: true, subtree: true, characterData: true });

  const pageObserver = new MutationObserver(() => {
    if (suspendPageObserver) return;
    requestPagination();
  });
  pageObserver.observe(editorEl, { childList: true, subtree: true });

  const marginDebug = {
    log() {
      const root = getComputedStyle(document.documentElement);
      const info = {
        pageWidth: root.getPropertyValue("--page-width").trim(),
        pageHeight: root.getPropertyValue("--page-height").trim(),
        marginTop: root.getPropertyValue("--page-margin-top").trim(),
        marginRight: root.getPropertyValue("--page-margin-right").trim(),
        marginBottom: root.getPropertyValue("--page-margin-bottom").trim(),
        marginLeft: root.getPropertyValue("--page-margin-left").trim()
      };
      const overlay = overlayLayer.querySelector<HTMLElement>(".leditor-page-overlay");
      const guide = overlay?.querySelector<HTMLElement>(".leditor-margin-guide");
      const guideRect = guide?.getBoundingClientRect();
      const pageRect = overlay?.getBoundingClientRect();
      console.info("[A4 margins]", { info, pageRect, guideRect });
    },
    toggle(force?: boolean) {
      const next = force === undefined ? !appRoot.classList.contains("leditor-debug-margins") : !!force;
      appRoot.classList.toggle("leditor-debug-margins", next);
      if (next) {
        this.log();
      }
      return next;
    }
  };
  (window as typeof window & { leditorMarginDebug?: any }).leditorMarginDebug = marginDebug;

  const themeControl = {
    set(mode: "light" | "dark", surface?: "light" | "dark") {
      applyTheme(mode, surface ?? pageSurfaceMode);
    },
    toggle: toggleTheme,
    togglePageSurface,
    get() {
      return { mode: themeMode, surface: pageSurfaceMode };
    }
  };
  (window as typeof window & { leditorTheme?: any }).leditorTheme = themeControl;

  const resizeObserver = new ResizeObserver(() => {
    requestPagination();
    requestZoomUpdate();
  });
  resizeObserver.observe(canvas);

  return {
    updatePagination,
    destroy() {
      resizeObserver.disconnect();
      footnoteObserver.disconnect();
      pageObserver.disconnect();
      if (footnoteUpdateHandle) {
        window.cancelAnimationFrame(footnoteUpdateHandle);
        footnoteUpdateHandle = 0;
      }
      leftSliderInstance?.destroy();
      rightSliderInstance?.destroy();
      topSliderInstance?.destroy();
      bottomSliderInstance?.destroy();
      unsubscribeMarginControls();
      canvas.removeEventListener("pointerdown", ensurePointerSelection, true);
      overlayLayer.removeEventListener("dblclick", handleOverlayDblClick, true);
      pageStack.removeEventListener("dblclick", handlePageHeaderFooterDblClick, true);
      pageStack.removeEventListener("click", handlePageFootnoteClick, true);
      overlayLayer.removeEventListener("input", handleOverlayInput, true);
      overlayLayer.removeEventListener("click", handleOverlayClick, true);
      editorEl.removeEventListener("pointerdown", handleBodyPointerDown, { capture: true } as any);
      appRoot.removeEventListener("click", handleFootnoteEntryClick);
      appRoot.removeEventListener("input", handleFootnoteEntryInput);
      appRoot.removeEventListener("click", handleEndnoteEntryClick);
      appRoot.removeEventListener("input", handleEndnoteEntryInput);
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("selectionchange", handleSelectionChange);
    },
    setZoom,
    getZoom() {
      return zoomValue;
    },
    setViewMode,
    getViewMode() {
      return viewMode;
    },
    getPageCount() {
      if (paginationEnabled) {
        return document.querySelectorAll(".leditor-page").length || 1;
      }
      return pageCount;
    },
    setHeaderContent(html: string) {
      headerHtml = html;
      syncHeaderFooter();
    },
    setFooterContent(html: string) {
      footerHtml = html;
      syncHeaderFooter();
      updatePageNumbers();
    },
    getHeaderContent() {
      return headerHtml;
    },
    getFooterContent() {
      return footerHtml;
    },
    enterHeaderFooterMode,
    exitHeaderFooterMode,
    isHeaderFooterMode() {
      return headerFooterMode;
    },
    setTheme: applyTheme,
    toggleTheme,
    togglePageSurface,
    getTheme() {
      return { mode: themeMode, surface: pageSurfaceMode };
    },
    setMargins(values) {
      applyMarginChange(values);
    },
    setContentFrameHeight,
    adjustContentFrameHeight,
    resetContentFrameHeight
  };
};

export type { A4LayoutController, A4ViewMode };



















