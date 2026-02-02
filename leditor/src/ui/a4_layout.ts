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
  exitFootnoteMode?: () => void;
  isFootnoteMode?: () => boolean;
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
  /* Minimal reserved height for footnotes when none measured; keep at 0 so we only grow when content exists. */
  --footnote-area-height: 0px;
  /* Reserve space for footnotes only when the page actually has footnote entries. */
  --page-footnote-height: 0px;
  /* Gap between the last body line and the footnote band to prevent overlap / caret loss. */
  --page-footnote-gap: 12px;
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

/* When the Source Checks rail is visible, reserve a right gutter in the scroll container so
   rail cards never get clipped by overflow-x: hidden. */
.leditor-app.leditor-app--source-checks-open .leditor-doc-shell {
  padding-right: 380px;
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

/* Legacy PDF pane frame (kept scoped so it doesn't override the embedded split PDF panel). */
.leditor-pdf-pane .leditor-pdf-frame {
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
  color: #1d4ed8;
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  cursor: pointer;
}

.leditor-app .ProseMirror a.leditor-citation-anchor {
  display: inline-flex;
  align-items: baseline;
  background: rgba(29, 78, 216, 0.07);
  border: 1px solid rgba(29, 78, 216, 0.18);
  border-radius: 6px;
  padding: 1px 5px;
  transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
}
.leditor-app .ProseMirror a.leditor-citation-anchor:hover {
  background: rgba(29, 78, 216, 0.10);
  border-color: rgba(29, 78, 216, 0.28);
}
.leditor-app .ProseMirror a.leditor-citation-anchor:active {
  transform: translateY(1px);
}

.leditor-app.theme-dark .ProseMirror a,
.leditor-app.theme-dark .ProseMirror a * {
  color: #93c5fd;
}
.leditor-app.theme-dark .ProseMirror a.leditor-citation-anchor {
  background: rgba(147, 197, 253, 0.12);
  border-color: rgba(147, 197, 253, 0.22);
}
.leditor-app.theme-dark .ProseMirror a.leditor-citation-anchor:hover {
  background: rgba(147, 197, 253, 0.16);
  border-color: rgba(147, 197, 253, 0.30);
}

@keyframes leditor-citation-flash {
  0% { box-shadow: 0 0 0 0 rgba(93, 213, 255, 0.0); transform: translateY(0); }
  20% { box-shadow: 0 0 0 3px rgba(93, 213, 255, 0.30); transform: translateY(-0.5px); }
  100% { box-shadow: 0 0 0 0 rgba(93, 213, 255, 0.0); transform: translateY(0); }
}

.leditor-app .ProseMirror a.leditor-citation-anchor.leditor-citation-anchor--flash {
  animation: leditor-citation-flash 0.6s ease-out;
}

/* Make citation anchors feel like real links even when the A4/pagination layer renders content
   outside the raw ".ProseMirror" container. */
.leditor-app a.leditor-citation-anchor,
.leditor-app a.leditor-citation-anchor *,
.leditor-app a.leditor-citation-anchor *::before,
.leditor-app a.leditor-citation-anchor *::after {
  cursor: pointer !important;
}
.leditor-app a.leditor-citation-anchor {
  user-select: text;
  -webkit-user-select: text;
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
  position: relative;
  z-index: 1200;
  pointer-events: auto;
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
  background: transparent;
}

.leditor-footnote-entry--continuation {
  opacity: 0.9;
}

.leditor-footnote-entry--continuation .leditor-footnote-entry-number {
  opacity: 0.7;
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
  background: transparent;
  pointer-events: none;
  user-select: none;
}

.leditor-endnote-entry-text:empty::before {
  content: attr(data-placeholder);
  opacity: 0.55;
  background: transparent;
  pointer-events: none;
  user-select: none;
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
  pointer-events: none;
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

/* Visual debug: flash page background when footnote reflow triggers. */
.leditor-page.leditor-footnote-reflow,
.leditor-page .leditor-footnote-reflow {
  outline: 2px solid rgba(96, 165, 250, 0.8);
  outline-offset: 4px;
  transition: outline 0.2s ease-out;
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

.leditor-debug-footnotes .leditor-page-content {
  outline: 2px solid rgba(59, 130, 246, 0.55);
  outline-offset: -2px;
}

.leditor-debug-footnotes .leditor-page-overlay .leditor-page-footnotes {
  outline: 2px solid rgba(16, 185, 129, 0.6);
  background: rgba(16, 185, 129, 0.05);
}

.leditor-debug-footnotes .leditor-page-overlay .leditor-page-footnotes::after {
  content: attr(data-debug-footnote-height);
  position: absolute;
  right: 6px;
  top: -16px;
  font-size: 10px;
  font-weight: 600;
  color: #047857;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: 6px;
  padding: 2px 6px;
  pointer-events: none;
}

.leditor-header-footer-editing .leditor-page-overlays {
  pointer-events: none;
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

/* In footnote editing mode, overlays remain present but only footnote areas are interactive. */
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
  min-height: 0;
  pointer-events: none;
}
.leditor-footnote-editing .leditor-page-overlay .leditor-page-footnotes.leditor-page-footnotes--active {
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

/* When the embedded PDF panel is open, keep the A4 content left-aligned so the PDF viewer
   can occupy the right side without the page stack staying visually centered. */
.leditor-app.leditor-pdf-open .leditor-a4-canvas {
  align-items: flex-start;
}
.leditor-app.leditor-pdf-open .leditor-a4-zoom {
  justify-content: flex-start;
}
.leditor-app.leditor-pdf-open .leditor-a4-zoom-content {
  transform-origin: top left;
}
.leditor-app.leditor-pdf-open .leditor-page-stack,
.leditor-app.leditor-pdf-open .leditor-page-overlays {
  margin-left: 0;
  margin-right: 0;
}
.leditor-app.leditor-pdf-open .leditor-page-stack[data-grid-mode="stack"],
.leditor-app.leditor-pdf-open .leditor-page-overlays[data-grid-mode="stack"] {
  align-items: flex-start;
  margin-left: 0;
  margin-right: 0;
}
.leditor-app.leditor-pdf-open .leditor-page-stack[data-grid-mode^="grid-"],
.leditor-app.leditor-pdf-open .leditor-page-overlays[data-grid-mode^="grid-"],
.leditor-app.leditor-pdf-open .leditor-page-stack.is-two-page,
.leditor-app.leditor-pdf-open .leditor-page-overlays.is-two-page {
  justify-content: flex-start;
  margin-left: 0;
  margin-right: 0;
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

/* Hide internal "start bibliography on new page" breaks. */
.leditor-break[data-break-kind="page"][data-section-id="bibliography"],
.leditor-break[data-break-kind="page"][data-section-id="bibliography"]::before,
.leditor-break[data-break-kind="page"][data-section-id="bibliography"]::after {
  display: none !important;
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
              var(--doc-footer-distance, 0px) +
              var(--footer-height, 0px) +
              var(--page-footnote-height, 0px) +
              var(--page-footnote-gap, 0px)
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
  background: var(--page-background, #ffffff);
  z-index: 1;
  box-sizing: border-box;
}
.leditor-page-footnotes.leditor-page-footnotes--active {
  border-top: var(--footnote-separator-height) solid var(--footnote-separator-color);
  padding-top: var(--footnote-spacing);
  background: var(--page-background, #ffffff);
  min-height: 0;
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

  // NOTE: `mountA4Layout` mounts onto the scroll container (`.leditor-doc-shell`), but several
  // systems (notably the ribbon dispatcher) key off `#leditor-app` for overlay edit-mode detection.
  // Mirror our mode classes to `#leditor-app` so ribbon commands do not steal focus back to
  // ProseMirror while the user is typing in overlay editors (footnotes/header/footer).
  const appShell = document.getElementById("leditor-app");
  const setModeClass = (className: string, enabled: boolean) => {
    appRoot.classList.toggle(className, enabled);
    if (appShell && appShell !== appRoot) {
      appShell.classList.toggle(className, enabled);
    }
  };

  const attachedEditorHandle = editorHandle ?? null;
  // Footnote text edits happen in overlay contenteditables. We keep drafts in-memory while typing to
  // avoid ProseMirror focus/selection churn (which presents as caret loss + ribbon flicker).
  // IMPORTANT: autosave/export calls `EditorHandle.getContent()/getJSON()` frequently; we must not
  // dispatch ProseMirror transactions in those paths while the user is editing footnotes.
  //
  // Single source of truth:
  // - persisted: `footnote` node attrs.text
  // - in-session edits: `footnoteTextDraft` (overrides attrs.text until committed)
  const footnoteTextDraft = new Map<string, string>();

  const injectFootnoteDraftsIntoHtml = (html: unknown): unknown => {
    if (typeof html !== "string") return html;
    if (footnoteTextDraft.size === 0) return html;
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const nodes = Array.from(doc.querySelectorAll<HTMLElement>("span[data-footnote][data-footnote-id]"));
      for (const el of nodes) {
        const id = (el.getAttribute("data-footnote-id") || "").trim();
        if (!id) continue;
        if (!footnoteTextDraft.has(id)) continue;
        const nextText = (footnoteTextDraft.get(id) ?? "").trim();
        if (nextText.length > 0) {
          el.setAttribute("data-footnote-text", nextText);
        } else {
          el.removeAttribute("data-footnote-text");
        }
      }
      return doc.body.innerHTML;
    } catch {
      return html;
    }
  };

  const injectFootnoteDraftsIntoJson = (json: any): any => {
    if (!json || footnoteTextDraft.size === 0) return json;
    const visit = (node: any) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "footnote" && node.attrs && typeof node.attrs.footnoteId === "string") {
        const id = String(node.attrs.footnoteId).trim();
        if (id && footnoteTextDraft.has(id)) {
          node.attrs.text = (footnoteTextDraft.get(id) ?? "").trim();
        }
      }
      const content = Array.isArray(node.content) ? node.content : null;
      if (content) content.forEach(visit);
    };
    try {
      visit(json);
      return json;
    } catch {
      return json;
    }
  };

  if (attachedEditorHandle && !(attachedEditorHandle as any).__leditorFootnoteSerializeWrapped) {
    (attachedEditorHandle as any).__leditorFootnoteSerializeWrapped = true;
    const originalGetContent = (attachedEditorHandle as any).getContent?.bind(attachedEditorHandle);
    const originalGetJSON = (attachedEditorHandle as any).getJSON?.bind(attachedEditorHandle);
    if (typeof originalGetContent === "function") {
      (attachedEditorHandle as any).getContent = (opts: any) => {
        const result = originalGetContent(opts);
        return injectFootnoteDraftsIntoHtml(result);
      };
    }
    if (typeof originalGetJSON === "function") {
      (attachedEditorHandle as any).getJSON = () => {
        const result = originalGetJSON();
        return injectFootnoteDraftsIntoJson(result);
      };
    }
  }
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
      : "";
  let footerHtml =
    typeof options.footerHtml === "string" && options.footerHtml.trim().length > 0
      ? options.footerHtml
      : "<span class=\"leditor-page-number\"></span>";
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
  let suspendPageObserverReleaseHandle = 0;
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
    try {
      leftSliderInstance?.updateOptions({ range: { min: 0, max: horizontalMax } }, false);
      rightSliderInstance?.updateOptions({ range: { min: 0, max: horizontalMax } }, false);
      topSliderInstance?.updateOptions({ range: { min: 0, max: verticalMax } }, false);
      bottomSliderInstance?.updateOptions({ range: { min: 0, max: verticalMax } }, false);
      leftSliderInstance?.set(leftMm);
      rightSliderInstance?.set(rightMm);
      topSliderInstance?.set(topMm);
      bottomSliderInstance?.set(bottomMm);
    } catch (error) {
      // nouislider can throw if the instance was destroyed but a queued update still runs.
      // Never crash the editor UI; disable sliders for this session instead.
      console.warn("[A4][margins] slider update failed; disabling sliders", error);
      leftSliderInstance = null;
      rightSliderInstance = null;
      topSliderInstance = null;
      bottomSliderInstance = null;
    }
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
	    const viewDom = (editorInstance?.view?.dom as HTMLElement | null) ?? null;
	    // In pagination/rehydration flows, `view.dom` can momentarily point at a detached node.
	    // Always fall back to the currently-mounted ProseMirror root inside `editorEl`.
	    const proseRoots: HTMLElement[] = [];
	    if (viewDom && viewDom.isConnected) proseRoots.push(viewDom);
	    proseRoots.push(
	      ...Array.from(editorEl.querySelectorAll<HTMLElement>(".tiptap.ProseMirror, .ProseMirror")).filter(
	        (el) => el.isConnected
	      )
	    );
	    // Dedupe in case viewDom is also found by the selector.
	    const prose = Array.from(new Set(proseRoots));
	    if (prose.length === 0) return;
	    // Prefer the editor API when available so ProseMirror plugins also respect the state.
	    try {
	      const anyEditor = editorInstance as any;
	      if (typeof anyEditor?.setEditable === "function") {
	        anyEditor.setEditable(editable);
	      }
	    } catch {
	      // ignore
	    }
	    prose.forEach((root) => {
	      root.contentEditable = editable ? "true" : "false";
	      root.setAttribute("aria-disabled", editable ? "false" : "true");
	    });
	    if (!editable) {
	      // Avoid focus fights: blur ProseMirror so overlay editors can own the caret deterministically.
	      prose.forEach((root) => {
	        try {
	          root.blur();
	        } catch {
	          // ignore
	        }
	      });
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
      return;
    }
    const target = overlay.querySelector<HTMLElement>(
      region === "header" ? ".leditor-page-header" : ".leditor-page-footer"
    );
    if (!target) {
      return;
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
        // Pagination/rehydration can replace text nodes between frames. Skip detached nodes.
        if (!(node as any).isConnected) {
          node = walker.nextNode() as Text | null;
          continue;
        }
        const len = node.data.length;
        if (remaining <= len) {
          range.setStart(node, remaining);
          range.collapse(true);
          try {
            selection.removeAllRanges();
            selection.addRange(range);
          } catch {
            // ignore
          }
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
    const view = editorInstance?.view ?? null;
    const prose = (view?.dom as HTMLElement | null) ?? null;
    if (!prose || !editorEl.contains(prose) || !prose.isConnected) return;
    try {
      // Prefer ProseMirror's focus method when available (it ensures selection is synced).
      view?.focus?.();
    } catch {
      // ignore
    }
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
    // Failsafe: if we're not in an overlay editing mode, the body editor must remain editable.
    // (Several focus/rehydration edge-cases can leave ProseMirror `contenteditable=false`,
    // which looks like "I can't edit anything".)
    if (!footnoteMode && !headerFooterMode) {
      const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
      const prose =
        (editorInstance?.view?.dom as HTMLElement | null) ??
        editorEl.querySelector<HTMLElement>(".tiptap.ProseMirror, .ProseMirror");
      if (prose && prose.isConnected && prose.contentEditable !== "true") {
        setEditorEditable(true);
      }
      return;
    }
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
    // Otherwise, exit footnote mode.
    // If the user clicked in the actual ProseMirror surface, let ProseMirror handle the click-based
    // caret placement naturally (avoid forcing a selection with posAtCoords, which is brittle under zoom).
    // If they clicked outside ProseMirror (canvas/page shell), fall back to restoring the last body selection.
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const prose = (editorInstance?.view?.dom as HTMLElement | null) ?? null;
    const inProse = !!prose && (target === prose || prose.contains(target));
    if (inProse) {
      // Exit footnote mode and let the subsequent click event place the caret naturally now that
      // ProseMirror is editable again. Forcing posAtCoords/focus here fights with ProseMirror and
      // can result in "caret jumps to end/start" reports.
      exitFootnoteMode({ restore: false });
      // Fallback: if the click doesn't end up focusing ProseMirror (e.g. it landed on a page shell
      // element under the overlay), focus the body after the click completes so the caret becomes visible.
      window.setTimeout(() => {
        if (footnoteMode || headerFooterMode) return;
        const editorInstance2 = attachedEditorHandle?.getEditor?.() ?? null;
        const prose2 = (editorInstance2?.view?.dom as HTMLElement | null) ?? null;
        const active = document.activeElement as HTMLElement | null;
        if (prose2 && prose2.isConnected && (!active || !(active === prose2 || prose2.contains(active)))) {
          try {
            focusBody();
          } catch {
            // ignore
          }
        }
      }, 0);
      return;
    }
    // Click was outside ProseMirror (canvas/page shell): restore deterministically using coords.
    exitFootnoteMode({ restore: true, coords: { x: event.clientX, y: event.clientY } });
    // Ensure the body regains focus so the caret becomes visible.
    window.requestAnimationFrame(() => {
      try {
        focusBody();
      } catch {
        // ignore
      }
    });
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
  let lastFootnoteExitAt = 0;
  let footnoteFocusRetryToken = 0;
	  let footnoteCaretToken = 0;
	  let suppressBodyFocusUntil = 0;
	  let footnoteTypingPaginationTimer: number | null = null;
	  let lastFootnoteInputAt = 0;
	  let pendingFootnoteRefocusId: string | null = null;
  // Only repaginate from footnote-height changes when the user actually edited footnote text
  // (or just inserted a footnote). This prevents pagination/focus oscillation loops caused by
  // 1px layout jitter while the footnote editor is focused.
  let footnotePaginationArmed = false;

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
		      try {
		        (window as any).__leditorFootnoteMode = true;
		      } catch {
		        // ignore
		      }
		      setModeClass("leditor-footnote-editing", true);
		      setEditorEditable(false);
		      // Allow a single responsive repagination right after entering footnote mode so the body can
		      // make room for the footnote area (Word-like).
		      footnotePaginationArmed = true;
	    }
	    activeFootnoteId = footnoteId;
	    caretState.active = "footnotes";
    // Prevent ProseMirror focus fights for a brief window while we focus the overlay editor.
    suppressBodyFocusUntil = Date.now() + 600;
  };

	  const exitFootnoteMode = (opts?: { restore?: boolean; coords?: { x: number; y: number } }) => {
	    if (!footnoteMode) return;
	    const restore = opts?.restore !== false;
	    const coords = opts?.coords ?? null;

    // Never leave the editor stuck non-editable: always unwind mode flags/classes even if
    // selection restoration fails.
    try {
      lastFootnoteExitAt = Date.now();
      flushPendingFootnoteTextCommits("exitFootnoteMode");
    } catch {
      // ignore
    }

    try {
      // Cancel any in-flight caret loop tied to footnote mode.
      footnoteCaretToken += 1;
      // Cancel any in-flight async focus retry so it doesn't re-enter footnote mode after exit.
      footnoteFocusRetryToken += 1;
      pendingFootnoteSourceSelection.clear();
      if (footnoteDraftFlushTimer != null) {
        window.clearTimeout(footnoteDraftFlushTimer);
        footnoteDraftFlushTimer = null;
      }
      if (footnoteTypingPaginationTimer != null) {
        window.clearTimeout(footnoteTypingPaginationTimer);
        footnoteTypingPaginationTimer = null;
      }
      pendingFootnoteRefocusId = null;
      footnotePaginationArmed = false;
    } catch {
      // ignore
	    } finally {
	      footnoteMode = false;
	      try {
	        (window as any).__leditorFootnoteMode = false;
	      } catch {
	        // ignore
	      }
	      activeFootnoteId = null;
	      caretState.active = "body";
	      setModeClass("leditor-footnote-editing", false);
	      setEditorEditable(true);
	      suppressBodyFocusUntil = Date.now() + 250;
    }

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
        const nextHtml = normalizeHeaderFooterHtml(getSectionHeaderContent(sectionId));
        if (header.innerHTML !== nextHtml) {
          header.innerHTML = nextHtml;
        }
      }
      if (footer) {
        const nextHtml = normalizeHeaderFooterHtml(getSectionFooterContent(sectionId));
        if (footer.innerHTML !== nextHtml) {
          footer.innerHTML = nextHtml;
        }
      }
    });
    const pageNodes = editorEl.querySelectorAll<HTMLElement>(".leditor-page");
    pageNodes.forEach((page, index) => {
      const sectionInfo = pageSections[index] ?? null;
      const sectionId = sectionInfo?.sectionId ?? DEFAULT_SECTION_ID;
      const header = page.querySelector(".leditor-page-header");
      const footer = page.querySelector(".leditor-page-footer");
      if (header) {
        const nextHtml = normalizeHeaderFooterHtml(getSectionHeaderContent(sectionId));
        if (header.innerHTML !== nextHtml) {
          header.innerHTML = nextHtml;
        }
      }
      if (footer) {
        const nextHtml = normalizeHeaderFooterHtml(pageStackFooterHtml);
        if (footer.innerHTML !== nextHtml) {
          footer.innerHTML = nextHtml;
        }
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

  // IMPORTANT: Do not continuously write footnote text back into the ProseMirror document while the
  // user is actively editing the overlay footnote editor. Dispatching transactions during footnote
  // mode can cause ProseMirror to steal focus/selection, leading to caret loss, ribbon flicker, and
  // "can't edit anything" moments. We keep an in-memory draft and flush it on explicit boundaries.
  let footnoteDraftFlushTimer: number | null = null;

  const shouldAddFootnoteCommitToHistory = (reason: string): boolean => {
    // Writes triggered by autosave/export/unload should not pollute the undo history.
    if (reason.startsWith("EditorHandle.getContent")) return false;
    if (reason.startsWith("EditorHandle.getJSON")) return false;
    if (reason === "pagehide" || reason === "beforeunload" || reason.startsWith("visibilitychange")) return false;
    // Normal editing boundaries should remain undoable.
    return true;
  };

  const flushPendingFootnoteTextCommits = (reason: string) => {
    const addToHistory = shouldAddFootnoteCommitToHistory(reason);
    for (const [id, text] of Array.from(footnoteTextDraft.entries())) {
      try {
        const ok = setFootnotePlainTextById(id, text, { addToHistory });
        if (ok) {
          footnoteTextDraft.delete(id);
        }
      } catch {
        // ignore
      }
    }
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][text] flushed", { reason, draftCount: footnoteTextDraft.size });
    }
  };
  // NOTE: serialization is handled by the `EditorHandle.getContent/getJSON` wrappers above; do not
  // export ad-hoc globals from here (it breaks renderer boot if the symbol is missing).

  const collectFootnoteEntries = () => {
    // Single source of truth: derive footnotes from the ProseMirror document, not from
    // `.leditor-footnote` DOM markers (which can be missing during pagination churn).
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const doc = editorInstance?.state?.doc ?? null;
    const entries: FootnoteRenderEntry[] = [];
    const numbering = doc ? reconcileFootnotes(doc).numbering : new Map<string, number>();

    const footnoteType = editorInstance?.state?.schema?.nodes?.footnote ?? null;
    const pageType = editorInstance?.state?.schema?.nodes?.page ?? null;
    if (!doc || !footnoteType) return entries;

    const pushEntry = (id: string, kind: FootnoteKind, source: "manual" | "citation", pageIndex: number, text: string) => {
      const mapped = numbering.get(id);
      const numberLabel = mapped ? String(mapped) : "";
      entries.push({
        footnoteId: id,
        number: numberLabel || "1",
        text,
        kind,
        source,
        pageIndex
      });
    };

    // Fast path: doc is a list of `page` nodes.
    if (pageType && doc.childCount > 0 && Array.from({ length: doc.childCount }).every((_, i) => doc.child(i).type === pageType)) {
      for (let pageIndex = 0; pageIndex < doc.childCount; pageIndex += 1) {
        const pageNode = doc.child(pageIndex);
        pageNode.descendants((node) => {
          if (node.type !== footnoteType) return true;
          const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
          if (!id) return true;
          const rawKind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "footnote";
          const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
          const citationId = typeof (node.attrs as any)?.citationId === "string" ? String((node.attrs as any).citationId).trim() : "";
          const source: "manual" | "citation" = citationId ? "citation" : "manual";
          const draft = footnoteTextDraft.get(id);
          const attrText = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
          const text = typeof draft === "string" ? draft : attrText;
          pushEntry(id, kind, source, kind === "endnote" ? 0 : pageIndex, text);
          return true;
        });
      }
      // Fill missing numbering labels deterministically for legacy ids if needed.
      let counterByKind: Record<FootnoteKind, number> = { footnote: 0, endnote: 0 };
      entries.forEach((entry) => {
        if (entry.number && entry.number !== "1") return;
        const mapped = numbering.get(entry.footnoteId);
        if (mapped) {
          entry.number = String(mapped);
          return;
        }
        counterByKind[entry.kind] += 1;
        entry.number = String(counterByKind[entry.kind]);
      });
      return entries;
    }

    // Fallback: traverse the whole doc and approximate page index by counting page nodes.
    let currentPageIndex = 0;
    doc.descendants((node) => {
      if (pageType && node.type === pageType) {
        currentPageIndex += 1;
        return true;
      }
      if (node.type !== footnoteType) return true;
      const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
      if (!id) return true;
      const rawKind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "footnote";
      const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
      const citationId = typeof (node.attrs as any)?.citationId === "string" ? String((node.attrs as any).citationId).trim() : "";
      const source: "manual" | "citation" = citationId ? "citation" : "manual";
      const draft = footnoteTextDraft.get(id);
      const attrText = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
      const text = typeof draft === "string" ? draft : attrText;
      pushEntry(id, kind, source, kind === "endnote" ? 0 : Math.max(0, currentPageIndex - 1), text);
      return true;
    });
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

  // (moved) footnoteTextDraft/commit timers declared above.
  let lastFootnoteRenderSignature = "";
  let lastFootnoteRenderPageCount = -1;

  const renderFootnoteSections = () => {
    const entries = collectFootnoteEntries();
    // Skip expensive re-renders when nothing relevant changed. This is critical to avoid
    // caret-loss/flicker loops while typing (especially in the overlay footnote editor).
    {
      const overlayCount = overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay").length;
      const needsFootnoteRows = entries.some((entry) => entry.kind === "footnote");
      const hasFootnoteRows = overlayLayer.querySelectorAll(".leditor-footnote-entry").length > 0;
      const signature = [
        `pages:${pageCount}`,
        `overlays:${overlayCount}`,
        ...entries
        .map((entry) => {
          const trimmed = (entry.text || "").trim();
          // Do not include the actively edited footnote's text in the signature; otherwise every
          // keystroke would trigger a re-render. The overlay is already the source of truth while
          // typing, and we avoid clobbering caret by not rewriting the active node anyway.
          const isActiveManualFootnote =
            footnoteMode &&
            activeFootnoteId === entry.footnoteId &&
            entry.kind === "footnote" &&
            entry.source !== "citation";
          const textSig = isActiveManualFootnote ? "active" : `${trimmed.length}:${trimmed.slice(0, 80)}`;
          return `${entry.kind}:${entry.footnoteId}:${entry.number}:${entry.pageIndex}:${entry.source}:${textSig}`;
        })
      ].join("|");
      const signatureUnchanged = signature === lastFootnoteRenderSignature;
      lastFootnoteRenderSignature = signature;
      const pageCountUnchanged = lastFootnoteRenderPageCount === pageCount;
      lastFootnoteRenderPageCount = pageCount;
      // IMPORTANT: overlays can be rebuilt by pagination even when the logical entries signature
      // does not change. If we early-return in that situation, footnote rows can disappear until
      // another change forces a render.
      // Only skip when the DOM already matches the logical need. If the document has no footnotes
      // but stale rows exist (or vice versa), we must re-render to avoid "ghost" footnotes and
      // incorrect reserved heights.
      const safeToSkip =
        signatureUnchanged &&
        pageCountUnchanged &&
        !headerFooterMode &&
        needsFootnoteRows === hasFootnoteRows;
      if (safeToSkip) {
        // Still measure heights so body layout reserves enough space as the user types.
        scheduleFootnoteHeightMeasurement();
        return;
      }
    }
    // Prune stale per-footnote state so deleted markers don't leave behind "ghost" rows or
    // resurrected numbering/text on the next insertion.
    {
      const liveIds = new Set(entries.map((entry) => entry.footnoteId));
      for (const id of Array.from(footnoteTextDraft.keys())) {
        if (!liveIds.has(id)) footnoteTextDraft.delete(id);
      }
      for (const id of Array.from(caretState.footnotes.byId.keys())) {
        if (!liveIds.has(id)) caretState.footnotes.byId.delete(id);
      }
      for (const id of Array.from(pendingFootnoteSourceSelection.keys())) {
        if (!liveIds.has(id)) pendingFootnoteSourceSelection.delete(id);
      }
      if (footnoteMode && activeFootnoteId && !liveIds.has(activeFootnoteId)) {
        // Active footnote was deleted from the document; return to body mode.
        exitFootnoteMode({ restore: true });
      }
    }
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

    scheduleFootnoteHeightMeasurement(true);
  };

  const focusFootnoteEntry = (footnoteId: string, behavior: "preserve" | "end" = "end"): boolean => {
    const id = (footnoteId ?? "").trim();
    if (!id) return false;

    // If we're already focused in this exact footnote editor, don't re-run scroll/focus/caret logic.
    // Repeated calls here were a primary source of "blinking" caret and ribbon flicker.
    if (footnoteMode && activeFootnoteId === id) {
      const active = document.activeElement as HTMLElement | null;
      if (
        active?.classList?.contains("leditor-footnote-entry-text") &&
        (active.getAttribute("data-footnote-id") || "").trim() === id &&
        active.getAttribute("contenteditable") === "true"
      ) {
        return true;
      }
    }

    // Throttle duplicate requests (prevents blinking when pagination refocuses).
    const focusNow = Date.now();
    const lastFocusAtById =
      ((window as any).__leditorFootnoteFocusAtById as Map<string, number> | undefined) ?? new Map<string, number>();
    (window as any).__leditorFootnoteFocusAtById = lastFocusAtById;
    const lastFocusAt = lastFocusAtById.get(id) ?? 0;
    const activeEl = document.activeElement as HTMLElement | null;
    if (
      focusNow - lastFocusAt < 200 &&
      activeEl?.classList?.contains("leditor-footnote-entry-text") &&
      (activeEl.getAttribute("data-footnote-id") || "").trim() === id
    ) {
      return true;
    }
    lastFocusAtById.set(id, focusNow);

    // Resolve page index + kind from the document (authoritative).
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const doc = editorInstance?.state?.doc ?? null;
    const footnoteType = editorInstance?.state?.schema?.nodes?.footnote ?? null;
    const pageType = editorInstance?.state?.schema?.nodes?.page ?? null;
    let kind: FootnoteKind = "footnote";
    let pageIndex = 0;
    if (doc && footnoteType) {
      if (pageType && doc.childCount > 0 && Array.from({ length: doc.childCount }).every((_, i) => doc.child(i).type === pageType)) {
        outer: for (let i = 0; i < doc.childCount; i += 1) {
          const page = doc.child(i);
          let found = false;
          page.descendants((node) => {
            if (node.type !== footnoteType) return true;
            const nodeId = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
            if (nodeId !== id) return true;
            const rawKind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "footnote";
            kind = rawKind === "endnote" ? "endnote" : "footnote";
            pageIndex = i;
            found = true;
            return false;
          });
          if (found) break outer;
        }
      } else {
        let currentPageIndex = 0;
        doc.descendants((node) => {
          if (pageType && node.type === pageType) {
            currentPageIndex += 1;
            return true;
          }
          if (node.type !== footnoteType) return true;
          const nodeId = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
          if (nodeId !== id) return true;
          const rawKind = typeof (node.attrs as any)?.kind === "string" ? String((node.attrs as any).kind) : "footnote";
          kind = rawKind === "endnote" ? "endnote" : "footnote";
          pageIndex = Math.max(0, currentPageIndex - 1);
          return false;
        });
      }
    }

    if ((kind as FootnoteKind) === "endnote") {
      focusEndnoteEntry(id);
      return true;
    }

    const sourceSelection = pendingFootnoteSourceSelection.get(id) ?? null;
    pendingFootnoteSourceSelection.delete(id);
    // Only enter/re-enter footnote mode when needed. Repeated calls can cause focus suppression
    // to continuously reset, presenting as flicker/caret loss.
    if (!footnoteMode || activeFootnoteId !== id) {
      enterFootnoteMode(id, sourceSelection);
    }

    const overlays = Array.from(overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay"));
    const maxOverlayIndex = Math.max(0, overlays.length - 1);
    const clampedPageIndex = clamp(pageIndex, 0, maxOverlayIndex);
    const overlay =
      overlayLayer.querySelector<HTMLElement>(`.leditor-page-overlay[data-page-index="${clampedPageIndex}"]`) ??
      overlays[clampedPageIndex] ??
      null;
    const container = overlay?.querySelector<HTMLElement>(".leditor-page-footnotes") ?? null;

    const locateTextEl = (): HTMLElement | null => {
      if (overlay) {
        const within = overlay.querySelector<HTMLElement>(`.leditor-footnote-entry-text[data-footnote-id="${id}"]`);
        if (within) return within;
      }
      return overlayLayer.querySelector<HTMLElement>(`.leditor-footnote-entry-text[data-footnote-id="${id}"]`);
    };
    let textEl = locateTextEl();
    if (!textEl) {
      // Ensure entries exist before we attempt to focus.
      renderFootnoteSections();
      scheduleFootnoteHeightMeasurement();
      textEl = locateTextEl();
    }
    if (!textEl) {
      // If overlays were just rebuilt, allow one render frame and let the focus event retry loop pick it up.
      scheduleFootnoteUpdate();
      return false;
    }

    const row = textEl.closest<HTMLElement>(".leditor-footnote-entry");
    if (row) {
      row.classList.add("leditor-footnote-entry--active");
      window.setTimeout(() => row.classList.remove("leditor-footnote-entry--active"), 900);
    }

    // Ensure the footnote editor is visible in the scroll container. `scrollIntoView` can be
    // inconsistent under transformed (zoomed) surfaces, so we also apply a deterministic scrollTop
    // adjustment against the known scroller (`appRoot`).
    const scrollIntoScroller = (el: HTMLElement | null, align: "center" | "nearest") => {
      if (!el) return;
      try {
        el.scrollIntoView({ block: align === "center" ? "center" : "nearest", inline: "nearest", behavior: "auto" });
      } catch {
        // ignore
      }
      try {
        const scroller = appRoot;
        const s = scroller.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (!Number.isFinite(r.top) || !Number.isFinite(s.top)) return;
        const pad = 28;
        const topBound = s.top + pad;
        const bottomBound = s.bottom - pad;
        const isVisible = r.top >= topBound && r.bottom <= bottomBound;
        if (isVisible) return;
        const desiredTop = align === "center" ? s.top + s.height * 0.4 : topBound;
        const delta = r.top - desiredTop;
        if (!Number.isFinite(delta)) return;
        scroller.scrollTo({ top: scroller.scrollTop + delta, left: scroller.scrollLeft, behavior: "auto" });
      } catch {
        // ignore
      }
    };
    scrollIntoScroller(container, behavior === "preserve" ? "nearest" : "center");
    scrollIntoScroller(textEl, "nearest");

    // Cancel any in-flight caret loop for other footnotes.
    footnoteCaretToken += 1;
    const token = footnoteCaretToken;
    const start = performance.now();
    let attempts = 0;

    const ensureFocused = () => {
      if (token !== footnoteCaretToken) return;
      if (!footnoteMode || activeFootnoteId !== id) return;
      attempts += 1;

      // Re-resolve the node if pagination replaced it.
      if (!textEl || !textEl.isConnected) {
        textEl = locateTextEl();
      }
      if (!textEl || !textEl.isConnected) return;

      try {
        textEl.focus({ preventScroll: true } as any);
      } catch {
        try {
          textEl.focus();
        } catch {
          // ignore
        }
      }

      const storedOffset = caretState.footnotes.byId.get(id);
      const offset = behavior === "preserve" && storedOffset != null ? storedOffset : Number.POSITIVE_INFINITY;
      applyContentEditableCaret(textEl, offset);

      const sel = window.getSelection?.();
      const active = document.activeElement as HTMLElement | null;
      const ok =
        active === textEl &&
        !!sel &&
        sel.rangeCount > 0 &&
        (sel.anchorNode ? textEl.contains(sel.anchorNode) : true);
      if (ok) {
        const nextOffset = getCharOffsetInContentEditable(textEl);
        if (nextOffset != null) caretState.footnotes.byId.set(id, nextOffset);
        if ((window as any).__leditorCaretDebug) {
          console.info("[Footnote][focus][caret]", { footnoteId: id, behavior, attempts });
        }
        return;
      }

      if (attempts >= 8 || performance.now() - start > 500) return;
      window.requestAnimationFrame(ensureFocused);
    };
    ensureFocused();
    return true;
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

  const setFootnotePlainTextById = (
    footnoteId: string,
    text: string,
    opts?: { addToHistory?: boolean }
  ): boolean => {
    if (!attachedEditorHandle) return false;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return false;
    const footnoteType = view.state.schema.nodes.footnote;
    if (!footnoteType) return false;
    let foundPos: number | null = null;
    let foundNode: any = null;
    view.state.doc.descendants((node, pos) => {
      if (node.type !== footnoteType) return true;
      const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId) : "";
      if (id === footnoteId) {
        foundPos = pos;
        foundNode = node;
        return false;
      }
      return true;
    });
    if (foundPos == null || !foundNode) return false;
    const trimmed = typeof text === "string" ? text : "";
    const current = typeof (foundNode.attrs as any)?.text === "string" ? String((foundNode.attrs as any).text).trim() : "";
    if (current === trimmed.trim()) return true;
    try {
      const nextAttrs = { ...(foundNode.attrs as any), text: trimmed };
      // Keep nodeSize stable by storing text in attrs and clearing node content.
      const nextNode = footnoteType.create(nextAttrs, [], foundNode.marks);
      const fromPos = Number(foundPos);
      const rawNodeSize =
        typeof foundNode.nodeSize === "number" ? foundNode.nodeSize : Number((foundNode as any).nodeSize);
      const nodeSize = Number.isFinite(rawNodeSize) ? rawNodeSize : 0;
      const prevSelection = view.state.selection;
      let tr = view.state.tr.replaceWith(fromPos, fromPos + nodeSize, nextNode);
      // Preserve the current ProseMirror selection. Updating a footnote node's attrs must not
      // reset the selection to start/end-of-doc (caret poison) or steal focus from overlay editors.
      try {
        const mapped = prevSelection.map(tr.doc, tr.mapping);
        tr = tr.setSelection(mapped);
      } catch {
        // ignore
      }
      const addToHistory = opts?.addToHistory !== false;
      tr = tr.setMeta("addToHistory", addToHistory);
      view.dispatch(tr);
      return true;
    } catch {
      return false;
    }
  };

  const scheduleFootnoteTextCommit = (footnoteId: string, rawText: string) => {
    const id = (footnoteId ?? "").trim();
    if (!id) return;
    const nextText = typeof rawText === "string" ? rawText : "";
    footnoteTextDraft.set(id, nextText);
    // Persist drafts into the ProseMirror document on idle, but only while *not* in footnote mode.
    // Autosave/export uses getContent/getJSON; we inject drafts there without dispatching transactions.
    // Committing to the doc while footnote mode is active causes focus ping-pong in ProseMirror.
    if (footnoteDraftFlushTimer != null) {
      window.clearTimeout(footnoteDraftFlushTimer);
    }
    if (footnoteMode) return;
    const delay = 300;
    footnoteDraftFlushTimer = window.setTimeout(() => {
      footnoteDraftFlushTimer = null;
      flushPendingFootnoteTextCommits(footnoteMode ? "idle:footnote" : "idle");
    }, delay);
  };

	  const handleFootnoteEntryInput = (event: Event) => {
	    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".leditor-footnote-entry-text");
	    if (!target) return;
	    const footnoteId = target.dataset.footnoteId;
	    if (!footnoteId) return;
	    const text = target.textContent ?? "";
	    scheduleFootnoteTextCommit(footnoteId, text);
	    // The user edited footnote text; allow a responsive repagination to make room.
	    footnotePaginationArmed = true;
	    lastFootnoteInputAt = Date.now();
	    scheduleFootnoteHeightMeasurement();
	  };

  const deleteFootnoteNodeById = (footnoteId: string): boolean => {
    if (!attachedEditorHandle) return false;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return false;
    const footnoteType = view.state.schema.nodes.footnote;
    if (!footnoteType) return false;
    const positions: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (node.type === footnoteType && String((node.attrs as any)?.footnoteId ?? "") === footnoteId) {
        positions.push(pos);
      }
      return true;
    });
    if (!positions.length) return false;
    positions.sort((a, b) => b - a);
    let tr = view.state.tr;
    for (const pos of positions) {
      const node = tr.doc.nodeAt(pos);
      if (!node) continue;
      tr = tr.delete(pos, pos + node.nodeSize);
    }
    view.dispatch(tr.scrollIntoView());
    return true;
  };

  const handleFootnoteEntryKeydown = (event: KeyboardEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".leditor-footnote-entry-text");
    if (!target) return;
    const footnoteId = (target.dataset.footnoteId ?? "").trim();
    if (!footnoteId) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const text = (target.textContent ?? "").trim();
    if (text.length > 0) return;
    // When the footnote text is empty, Backspace/Delete removes the footnote marker in the document
    // (Word-like behavior). This prevents "ghost footnotes" from reappearing later.
    event.preventDefault();
    event.stopPropagation();
    const removed = deleteFootnoteNodeById(footnoteId);
    if (removed) {
      footnoteTextDraft.delete(footnoteId);
      // Exit footnote mode back to the stored body selection.
      exitFootnoteMode({ restore: true });
      scheduleFootnoteUpdate();
    }
  };

  const focusEndnoteEntry = (footnoteId: string) => {
    const entry = appRoot.querySelector<HTMLElement>(
      `.leditor-endnote-entry[data-footnote-id="${footnoteId}"]`
    );
    if (!entry) return;
    entry.scrollIntoView({ block: "center", behavior: "auto" });
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
    const text = target.textContent ?? "";
    scheduleFootnoteTextCommit(footnoteId, text);
  };

  let footnoteHeightHandle = 0;
  const footnoteHeightCache = new Map<number, number>();
  const footnoteLayoutVarsByPage = new Map<
    number,
    { height: number; effectiveBottom: number; gap: number }
  >();
  // Rounded pixel values can still jitter by 1px across layout passes (scrollbar toggles, font hinting).
  // Use the smallest delta so a new footnote line always triggers a repagination.
  const FOOTNOTE_HEIGHT_DIRTY_THRESHOLD = 1;
  const FOOTNOTE_BODY_GAP_PX = 12;
  let lastFootnoteDebugLogAt = 0;
  const isFootnoteLayoutDebug = () => Boolean((window as any).__leditorFootnoteLayoutDebug);
  const syncFootnoteDebugClass = () => {
    appRoot.classList.toggle("leditor-debug-footnotes", isFootnoteLayoutDebug());
  };
  const setFootnoteLayoutVars = (
    target: HTMLElement | null,
    heightPx: number,
    effectiveBottomPx: number,
    gapPx: number
  ) => {
    if (!target) return;
    target.style.setProperty("--page-footnote-gap", `${gapPx}px`);
    target.style.setProperty("--page-footnote-height", `${Math.max(0, Math.round(heightPx))}px`);
    target.style.setProperty("--effective-margin-bottom", `${Math.max(0, Math.round(effectiveBottomPx))}px`);
  };
  const getPageStackPages = () => {
    const pages = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page"));
    if (pages.length > 0) return pages;
    return Array.from(document.querySelectorAll<HTMLElement>(".leditor-page"));
  };
  const getPageContentNodes = () => {
    const nodes = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page-content"));
    if (nodes.length > 0) return nodes;
    return Array.from(document.querySelectorAll<HTMLElement>(".leditor-page-content"));
  };
  let footnoteLayoutSyncHandle = 0;
  let footnoteLayoutSyncRetries = 0;
  let footnoteLayoutSyncRaf = 0;
  const requestEditorPagination = () => {
    try {
      const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
      const viewDom = (editorInstance?.view?.dom as HTMLElement | null) ?? null;
      const target = viewDom ?? editorEl;
      target.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
    } catch {
      // ignore
    }
  };
  const syncFootnoteLayoutVarsToPages = () => {
    const pages = getPageStackPages();
    if (pages.length === 0) {
      if (footnoteLayoutVarsByPage.size > 0 && footnoteLayoutSyncHandle === 0 && footnoteLayoutSyncRetries < 6) {
        footnoteLayoutSyncRetries += 1;
        footnoteLayoutSyncHandle = window.requestAnimationFrame(() => {
          footnoteLayoutSyncHandle = 0;
          syncFootnoteLayoutVarsToPages();
        });
      }
      return;
    }
    footnoteLayoutSyncRetries = 0;
    const pageContents = getPageContentNodes();
    let applied = 0;
    pages.forEach((page, index) => {
      const raw = (page.dataset.pageIndex ?? "").trim();
      const parsed = raw.length > 0 ? Number(raw) : Number.NaN;
      const pageIndex = Number.isFinite(parsed) ? parsed : index;
      const entry = footnoteLayoutVarsByPage.get(pageIndex);
      if (!entry) return;
      setFootnoteLayoutVars(page, entry.height, entry.effectiveBottom, entry.gap);
      const pageContent = pageContents[pageIndex] ?? pageContents[index] ?? null;
      setFootnoteLayoutVars(pageContent, entry.height, entry.effectiveBottom, entry.gap);
      applied += 1;
    });
    if (applied === 0 && footnoteLayoutVarsByPage.size > 0 && footnoteLayoutSyncHandle === 0 && footnoteLayoutSyncRetries < 6) {
      footnoteLayoutSyncRetries += 1;
      footnoteLayoutSyncHandle = window.requestAnimationFrame(() => {
        footnoteLayoutSyncHandle = 0;
        syncFootnoteLayoutVarsToPages();
      });
    }
  };
  const scheduleFootnoteLayoutVarSync = () => {
    if (footnoteLayoutSyncRaf) return;
    footnoteLayoutSyncRaf = window.requestAnimationFrame(() => {
      footnoteLayoutSyncRaf = 0;
      window.requestAnimationFrame(() => syncFootnoteLayoutVarsToPages());
    });
  };
  const updateFootnoteDebugData = (
    container: HTMLElement,
    payload: { appliedHeight: number; overlap: boolean }
  ) => {
    if (!isFootnoteLayoutDebug()) {
      container.removeAttribute("data-debug-footnote-height");
      container.removeAttribute("data-debug-footnote-overlap");
      return;
    }
    container.dataset.debugFootnoteHeight = `${Math.max(0, Math.round(payload.appliedHeight))}px`;
    if (payload.overlap) {
      container.dataset.debugFootnoteOverlap = "true";
    } else {
      container.removeAttribute("data-debug-footnote-overlap");
    }
  };
  const flashFootnoteReflow = (pageIndex: number) => {
    try {
      const pageEl = editorEl.querySelectorAll<HTMLElement>(".leditor-page")[pageIndex] ?? null;
      if (!pageEl) return;
      pageEl.classList.add("leditor-footnote-reflow");
      setTimeout(() => pageEl.classList.remove("leditor-footnote-reflow"), 220);
    } catch {
      // ignore
    }
  };
  function scheduleFootnoteHeightMeasurement(force = false) {
    if (footnoteHeightHandle) {
      if (!force) return;
      window.cancelAnimationFrame(footnoteHeightHandle);
      footnoteHeightHandle = 0;
    }
    footnoteHeightHandle = window.requestAnimationFrame(() => {
      footnoteHeightHandle = 0;
      const footnoteContainers = Array.from(
        overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay .leditor-page-footnotes")
      );
      const pageStackPages = getPageStackPages();
      const pageContents = getPageContentNodes();
      const pageHeightPx = measurePageHeight() || 1122; // fallback
      const rootTokens = getComputedStyle(document.documentElement);
      const docFooterDistancePx = Number.parseFloat(rootTokens.getPropertyValue("--doc-footer-distance").trim() || "48");
      const footerHeightPx = Number.parseFloat(rootTokens.getPropertyValue("--footer-height").trim() || "48");
      const footerReservePx =
        (Number.isFinite(docFooterDistancePx) ? docFooterDistancePx : 48) +
        (Number.isFinite(footerHeightPx) ? footerHeightPx : 48);
      let earliestDirtyPage: number | null = null;
      // Prune cached heights for pages that no longer exist.
      for (const pageIndex of Array.from(footnoteHeightCache.keys())) {
        if (pageIndex < 0 || pageIndex >= footnoteContainers.length) {
          footnoteHeightCache.delete(pageIndex);
        }
      }
      syncFootnoteDebugClass();
      const debugEnabled = isFootnoteLayoutDebug();

      footnoteContainers.forEach((container, containerIndex) => {
        const host = container.closest<HTMLElement>(".leditor-page-overlay");
        const rawIndex = (host?.dataset.pageIndex ?? "").trim();
        const parsedIndex = rawIndex.length > 0 ? Number(rawIndex) : Number.NaN;
        const pageIndex = Number.isFinite(parsedIndex) ? parsedIndex : containerIndex;
        const pageStackPage = pageIndex >= 0 ? (pageStackPages[pageIndex] ?? null) : null;
        const pageContent =
          pageStackPage?.querySelector<HTMLElement>(".leditor-page-content") ??
          pageContents[pageIndex] ??
          pageContents[containerIndex] ??
          null;
        const hasEntries = container.querySelector(".leditor-footnote-entry") != null;
        const containerStyle = getComputedStyle(container);
        const paddingTopPx = Number.parseFloat(containerStyle.paddingTop || "0") || 0;
        const borderTopPx = Number.parseFloat(containerStyle.borderTopWidth || "0") || 0;
        const borderBottomPx = Number.parseFloat(containerStyle.borderBottomWidth || "0") || 0;
        const chromePx = Math.max(0, paddingTopPx + borderTopPx + borderBottomPx);
        // When there are no entries, we should not reserve the base footnote-area-height. Only reserve
        // the footer distance + footer height in that case (Word-like behavior).
        if (!hasEntries) {
          const reservePx = footnoteMode ? Math.max(18, Math.round(footerReservePx * 0.35)) : 0;
          const effectiveBottomPx = Math.max(0, footerReservePx + reservePx + FOOTNOTE_BODY_GAP_PX);
          if (pageIndex >= 0) {
            if (reservePx > 0) {
              footnoteLayoutVarsByPage.set(pageIndex, {
                height: reservePx,
                effectiveBottom: effectiveBottomPx,
                gap: FOOTNOTE_BODY_GAP_PX
              });
            } else {
              footnoteLayoutVarsByPage.delete(pageIndex);
            }
          }
          container.classList.remove("leditor-page-footnotes--active");
          container.setAttribute("aria-hidden", "true");
          container.style.height = `${reservePx}px`;
          container.style.overflowY = "hidden";
          container.style.setProperty("--page-footnote-height", `${reservePx}px`);
          setFootnoteLayoutVars(host, reservePx, effectiveBottomPx, FOOTNOTE_BODY_GAP_PX);
          if (pageIndex >= 0) {
            setFootnoteLayoutVars(pageStackPage, reservePx, effectiveBottomPx, FOOTNOTE_BODY_GAP_PX);
            setFootnoteLayoutVars(pageContent, reservePx, effectiveBottomPx, FOOTNOTE_BODY_GAP_PX);
            const prevHeight = footnoteHeightCache.get(pageIndex);
            const appliedHeight = reservePx;
            if (prevHeight === undefined || Math.abs(appliedHeight - prevHeight) >= FOOTNOTE_HEIGHT_DIRTY_THRESHOLD) {
              footnoteHeightCache.set(pageIndex, appliedHeight);
              earliestDirtyPage = earliestDirtyPage === null ? pageIndex : Math.min(earliestDirtyPage, pageIndex);
              if (reservePx > 0) flashFootnoteReflow(pageIndex);
            }
            updateFootnoteDebugData(container, { appliedHeight, overlap: false });
          }
          return;
        }
        // Measure only the actual list content to avoid including container padding/margins that make
        // the box jump on every character.
        const listEl = container.querySelector<HTMLElement>(".leditor-footnote-list");
        const measuredHeight = hasEntries
          ? Math.max(0, Math.round((listEl ?? container).scrollHeight + chromePx))
          : 0;
        // Hard cap: never let footnotes consume more than ~35% of the page height (Word-like guardrail).
        const hardCapPx = Math.max(0, Math.round(pageHeightPx * 0.35));

        // Snap growth to full lines to avoid per-character expansion jitter.
        const linePx = (() => {
          const raw = getComputedStyle(container).lineHeight;
          const v = Number.parseFloat((raw || "").trim());
          if (Number.isFinite(v) && v > 0) return v;
          return 18; // sensible fallback
        })();
        const currentBoxPx = Number.parseFloat(getComputedStyle(container).height || "0") || 0;
        // Minimum visible height: a single line.
        const minFootnotePx = Math.max(linePx + chromePx, 12);

        let appliedHeight = Math.min(Math.max(measuredHeight, minFootnotePx), hardCapPx);
        if (hasEntries && pageStackPage) {
          const contentEl = pageContent;
          const currentFootnotePx = Number.parseFloat(
            getComputedStyle(pageStackPage).getPropertyValue("--page-footnote-height").trim() || "0"
          );
          const baseContentPx =
            (contentEl?.getBoundingClientRect().height ?? 0) + (Number.isFinite(currentFootnotePx) ? currentFootnotePx : 0);
          // Preserve a minimum amount of body space so the page can still display the line containing the
          // footnote marker (Word-like). Otherwise a large footnote collapses the body to 0px, which causes
          // unstable pagination and confusing "missing text" moments.
          const minBodyPx = (() => {
            const raw = contentEl ? getComputedStyle(contentEl).lineHeight : "";
            const lh = Number.parseFloat((raw || "").trim());
            if (Number.isFinite(lh) && lh > 0) return Math.max(12, Math.min(36, Math.round(lh)));
            return 18;
          })();
          const maxFootnotePx = Math.max(0, Math.floor(baseContentPx - minBodyPx));
          if (Number.isFinite(maxFootnotePx) && maxFootnotePx > 0) {
            appliedHeight = Math.min(appliedHeight, maxFootnotePx);
          }
        }

        // Snap to whole-line increments; grow immediately when needed.
        const step = Math.max(linePx, 4);
        appliedHeight = Math.max(minFootnotePx, Math.ceil(appliedHeight / step) * step);
        const currentMarginBottomPx = Number.parseFloat(
          getComputedStyle(host ?? container).getPropertyValue("--current-margin-bottom").trim() || "0"
        );
        const effectiveBottomPx = Math.max(
          currentMarginBottomPx,
          footerReservePx + appliedHeight + FOOTNOTE_BODY_GAP_PX
        );
        if (pageIndex >= 0) {
          footnoteLayoutVarsByPage.set(pageIndex, {
            height: appliedHeight,
            effectiveBottom: effectiveBottomPx,
            gap: FOOTNOTE_BODY_GAP_PX
          });
        }

        // Force the body to reflow instead of adding a scrollbar.
        container.style.overflowY = "hidden";
        container.style.height = hasEntries ? `${appliedHeight}px` : "0px";
        container.style.setProperty("--page-footnote-height", `${appliedHeight}px`);
        setFootnoteLayoutVars(host, appliedHeight, effectiveBottomPx, FOOTNOTE_BODY_GAP_PX);
        if (pageIndex >= 0) {
          setFootnoteLayoutVars(pageStackPage, appliedHeight, effectiveBottomPx, FOOTNOTE_BODY_GAP_PX);
          setFootnoteLayoutVars(pageContent, appliedHeight, effectiveBottomPx, FOOTNOTE_BODY_GAP_PX);
          const prevHeight = footnoteHeightCache.get(pageIndex);
          if (prevHeight === undefined || Math.abs(appliedHeight - prevHeight) >= FOOTNOTE_HEIGHT_DIRTY_THRESHOLD) {
            footnoteHeightCache.set(pageIndex, appliedHeight);
            earliestDirtyPage =
              earliestDirtyPage === null ? pageIndex : Math.min(earliestDirtyPage, pageIndex);
            flashFootnoteReflow(pageIndex);
          }
          const overlap =
            debugEnabled && pageContent
              ? pageContent.getBoundingClientRect().bottom > container.getBoundingClientRect().top - 1
              : false;
          updateFootnoteDebugData(container, { appliedHeight, overlap });
          if (debugEnabled) {
            const logNow = Date.now();
            if (overlap || logNow - lastFootnoteDebugLogAt > 750) {
              lastFootnoteDebugLogAt = logNow;
              console.info("[Footnote][layout]", {
                pageIndex,
                appliedHeight,
                measuredHeight,
                chromePx,
                effectiveBottomPx,
                overlap,
                footnoteVars: pageStackPage
                  ? {
                      height: getComputedStyle(pageStackPage).getPropertyValue("--page-footnote-height").trim(),
                      gap: getComputedStyle(pageStackPage).getPropertyValue("--page-footnote-gap").trim(),
                      effectiveBottom: getComputedStyle(pageStackPage)
                        .getPropertyValue("--effective-margin-bottom")
                        .trim()
                    }
                  : null
              });
            }
          }
        }
      });
      // Re-apply cached footnote vars in case pagination replaced page nodes after measurement.
      syncFootnoteLayoutVarsToPages();
      // IMPORTANT: Never apply the "max across all pages" footnote height globally. That causes
      // every page to reserve space for the largest footnote, producing huge blank gaps and
      // truncated lines on pages without footnotes.
      zoomLayer.style.setProperty("--page-footnote-gap", `${FOOTNOTE_BODY_GAP_PX}px`);
      zoomLayer.style.setProperty("--page-footnote-height", "0px");
      const baseMarginBottomPx = Number.parseFloat(
        getComputedStyle(zoomLayer).getPropertyValue("--current-margin-bottom").trim() || "0"
      );
      const effectiveBottomPx = Math.max(baseMarginBottomPx, footerReservePx);
      zoomLayer.style.setProperty("--effective-margin-bottom", `${Math.max(0, Math.round(effectiveBottomPx))}px`);
      if (earliestDirtyPage !== null) {
        const shouldPaginate = !footnoteMode || footnotePaginationArmed;
        if (!shouldPaginate) return;
        // Repaginate immediately so body text yields space as soon as footnotes grow.
        footnotePaginationArmed = false;
        if (footnoteTypingPaginationTimer != null) {
          window.clearTimeout(footnoteTypingPaginationTimer);
          footnoteTypingPaginationTimer = null;
        }
        if (footnoteMode) {
          pendingFootnoteRefocusId = activeFootnoteId ?? pendingFootnoteRefocusId;
          (window as any).__leditorPreserveScrollOnNextPagination = true;
        }
        requestEditorPagination();
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
    // Overlays are visual-only by default; only show/activate footnotes when there are entries.
    footnotes.setAttribute("aria-hidden", "true");
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
    const desiredCount = Math.max(0, columns - 1);
    if (guide.childElementCount === desiredCount) {
      return;
    }
    guide.innerHTML = "";
    for (let i = 0; i < desiredCount; i += 1) {
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
    syncFootnoteLayoutVarsToPages();
    scheduleFootnoteUpdate();
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
    // In overlay edit modes (footnotes / header-footer), overlays must receive pointer events.
    // Failsafe: explicitly disable overlay pointer events when not in an overlay edit mode.
    overlayLayer.style.pointerEvents = footnoteMode || headerFooterMode ? "" : "none";
	    overlayLayer.style.zIndex = "3";
	    // IMPORTANT: do not reset mode flags here. Pagination/layout churn can call attachEditorForMode
	    // while the user is editing footnotes/header/footer; clearing mode state causes caret loss and
	    // makes the body appear non-editable.
	    setModeClass("leditor-header-footer-editing", headerFooterMode);
	    setModeClass("leditor-footnote-editing", footnoteMode);
	    updateHeaderFooterEditability();
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
    // Never steal focus from overlay editors (footnotes / header/footer).
    // Doing so causes a focus tug-of-war that looks like "blinking" and breaks caret tracking.
    if (!footnoteMode && !headerFooterMode) {
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !editorEl.contains(activeEl)) {
        prose.focus({ preventScroll: true });
      }
    }
	    updateHeaderFooterEditability();
	    // Preserve editor editability across pagination churn: in footnote mode, the overlay owns the caret.
	    // Heal a common stuck state: footnote mode flag true but no active footnote and no focused
	    // overlay editor. This leaves the body non-editable and makes the app feel "frozen".
	    if (footnoteMode) {
	      const activeEl = document.activeElement as HTMLElement | null;
	      const activeInFootnotes =
	        Boolean(activeEl?.closest?.(".leditor-footnote-entry-text")) ||
	        Boolean(activeEl?.closest?.(".leditor-page-footnotes"));
	      if (!activeFootnoteId && !activeInFootnotes) {
	        footnoteMode = false;
	        try {
	          (window as any).__leditorFootnoteMode = false;
	        } catch {
	          // ignore
	        }
	        setModeClass("leditor-footnote-editing", false);
	      }
	    }
	    setEditorEditable(!footnoteMode && !headerFooterMode);
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
          scheduleFootnoteLayoutVarSync();
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
        scheduleFootnoteLayoutVarSync();
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
      scheduleFootnoteLayoutVarSync();
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
      // When pagination was explicitly triggered from footnote typing, re-focus the active footnote
      // once the overlays are rebuilt. This is opt-in and does not run for normal pagination churn.
      if (footnoteMode && pendingFootnoteRefocusId) {
        const id = pendingFootnoteRefocusId;
        pendingFootnoteRefocusId = null;
        window.requestAnimationFrame(() => {
          try {
            focusFootnoteEntry(id, "preserve");
          } catch {
            // ignore
          }
        });
      }
      // Note: do not try to "re-arm" footnote focus from pagination/layout churn.
      // That causes a feedback loop (pagination -> steal focus -> re-focus -> pagination) which
      // presents to the user as blinking and caret loss. Footnote focus should only be driven by
      // explicit user actions and the one-shot insert flow.
      if (suspendPageObserverReleaseHandle) {
        try {
          window.cancelAnimationFrame(suspendPageObserverReleaseHandle);
        } catch {
          // ignore
        }
        suspendPageObserverReleaseHandle = 0;
      }
      suspendPageObserverReleaseHandle = window.requestAnimationFrame(() => {
        suspendPageObserverReleaseHandle = 0;
        suspendPageObserver = false;
      });
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
	    setModeClass("leditor-header-footer-editing", true);
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
		    setModeClass("leditor-header-footer-editing", false);
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
    // Avoid immediately re-entering footnote mode when the user just clicked out of footnotes.
    if (Date.now() - lastFootnoteExitAt < 250) return;
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

	  let lastProseStealAt = 0;
	  const handleDocumentFocusIn = (event: FocusEvent) => {
	    // Body editability failsafe: if ProseMirror ever ends up focused while not editable,
	    // restore editability immediately. (We've seen rare cases where mode flags are false
	    // but the DOM remained contenteditable=false after an error during mode switching.)
	    if (!footnoteMode && !headerFooterMode) {
	      const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
	      const prose = (editorInstance?.view?.dom as HTMLElement | null) ?? null;
	      const target = event.target as HTMLElement | null;
	      if (prose && prose.isConnected && target && (target === prose || prose.contains(target))) {
	        if (prose.contentEditable !== "true") {
	          setEditorEditable(true);
	          // Don't try to manage selection here; just ensure the editor can type again.
	        }
	      }
	      return;
	    }
	    if (!footnoteMode) return;
	    const now = Date.now();
	    // Guard against focus ping-pong (can happen when transactions or rehydration briefly focus ProseMirror).
	    if (now - lastProseStealAt < 80) return;
	    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
	    const prose = (editorInstance?.view?.dom as HTMLElement | null) ?? null;
    const target = event.target as HTMLElement | null;
    if (prose && target && (target === prose || prose.contains(target))) {
      lastProseStealAt = now;
      // While the footnote overlay editor is active, ProseMirror must not steal focus; it causes
      // the caret to jump (often to start/end-of-doc) and makes the ribbon flicker.
      try {
        prose.blur();
      } catch {
        // ignore
      }
      const active = activeFootnoteId
        ? overlayLayer.querySelector<HTMLElement>(
            `.leditor-footnote-entry-text[data-footnote-id="${activeFootnoteId}"]`
          )
        : null;
      if (active && active.isConnected) {
        try {
          active.focus({ preventScroll: true } as any);
        } catch {
          active.focus();
        }
      }
    }
  };

  canvas.addEventListener("pointerdown", ensurePointerSelection, true);
  // Capture phase so header/footer dblclick still works even if other handlers stop propagation.
  overlayLayer.addEventListener("dblclick", handleOverlayDblClick, true);
  pageStack.addEventListener("dblclick", handlePageHeaderFooterDblClick, true);
  pageStack.addEventListener("click", handlePageFootnoteClick, true);
  overlayLayer.addEventListener("input", handleOverlayInput, true);
  overlayLayer.addEventListener("click", handleOverlayClick, true);
  // Body clicks during footnote mode are handled at the canvas pointerdown capture layer
  // (ensurePointerSelection) to avoid duplicate exit/restore flows.
  appRoot.addEventListener("click", handleFootnoteEntryClick);
  appRoot.addEventListener("input", handleFootnoteEntryInput);
  appRoot.addEventListener("keydown", handleFootnoteEntryKeydown, true);
  appRoot.addEventListener("click", handleEndnoteEntryClick);
  appRoot.addEventListener("input", handleEndnoteEntryInput);
  // Global (document/window) listeners must be singletons: if the layout remounts without a clean
  // destroy (crash, hot reload, devtools reload), duplicate listeners cause focus/selection loops
  // and visible UI flicker.
  const globalKeydownKey = "__leditorA4DocKeydownHandler";
  const globalSelectionChangeKey = "__leditorA4DocSelectionChangeHandler";
  const globalFocusInKey = "__leditorA4DocFocusInHandler";
  const globalPointerDownKey = "__leditorA4DocPointerDownHandler";
  const globalClickKey = "__leditorA4DocClickHandler";
  const globalPagehideKey = "__leditorA4WinPagehideHandler";
  const globalBeforeUnloadKey = "__leditorA4WinBeforeUnloadHandler";
  const globalVisibilityChangeKey = "__leditorA4DocVisibilityChangeHandler";

  const existingDocKeydown = (window as any)[globalKeydownKey] as ((e: KeyboardEvent) => void) | undefined;
  if (existingDocKeydown) document.removeEventListener("keydown", existingDocKeydown);
  (window as any)[globalKeydownKey] = handleKeydown;
  document.addEventListener("keydown", handleKeydown);

  const existingSelectionChange = (window as any)[globalSelectionChangeKey] as (() => void) | undefined;
  if (existingSelectionChange) document.removeEventListener("selectionchange", existingSelectionChange);
  (window as any)[globalSelectionChangeKey] = handleSelectionChange;
  document.addEventListener("selectionchange", handleSelectionChange);

  // Surgical failsafe for "I can't edit anything":
  // sometimes a crash/throw during an edit-mode transition leaves ProseMirror non-editable even though
  // `footnoteMode/headerFooterMode` are false. Ensure the body is always editable on any pointerdown.
		  const handleDocumentPointerDown = (_event: PointerEvent) => {
		    if (footnoteMode || headerFooterMode) return;
		    const event = _event;
		    // Un-stick stray mode classes (flags are the source of truth).
		    setModeClass("leditor-footnote-editing", false);
		    setModeClass("leditor-header-footer-editing", false);
		    setEditorEditable(true);
		    // If the user is clicking back into the editor surface, ensure focus is restored so the caret appears.
		    const target = event.target as HTMLElement | null;
		    if (target && editorEl.contains(target)) {
          // Store the most-recent body click candidate. We'll validate / apply it on `click` (bubble),
          // after ProseMirror has had a chance to set selection normally.
          try {
            (window as any).__leditorLastBodyClick = {
              at: Date.now(),
              x: event.clientX,
              y: event.clientY,
              targetTag: target.tagName,
              targetClass: (target.getAttribute("class") || "").slice(0, 120)
            };
          } catch {
            // ignore
          }

			      // Capture selection before ProseMirror handles the click.
			      // We only apply a "failsafe" selection *after pointerup* if ProseMirror didn't move it.
			      let selectionFromBefore: number | null = null;
			      let selectionToBefore: number | null = null;
			      const selectionModifierHeld = !!(event.shiftKey || event.metaKey || event.ctrlKey || event.altKey);
			      try {
			        const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
			        const view = editorInstance?.view ?? null;
			        selectionFromBefore =
			          typeof view?.state?.selection?.from === "number" ? view.state.selection.from : null;
			        selectionToBefore =
			          typeof view?.state?.selection?.to === "number" ? view.state.selection.to : null;
			      } catch {
			        selectionFromBefore = null;
			        selectionToBefore = null;
			      }

		      const onPointerUp = (upEvent: PointerEvent) => {
		        document.removeEventListener("pointerup", onPointerUp, true);
		        document.removeEventListener("pointercancel", onPointerUp, true);
		        if (footnoteMode || headerFooterMode) return;
		        // IMPORTANT: ProseMirror often applies click-based selection on the subsequent `click` event,
		        // which fires *after* `pointerup`. If we intervene synchronously here we can overwrite the
		        // intended caret placement (observed as "always types at position 0/2"). Defer to the next
		        // task so ProseMirror can update selection first, then apply a failsafe only if needed.
		        window.setTimeout(() => {
		          if (footnoteMode || headerFooterMode) return;
		          try {
		            const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
		            const view = editorInstance?.view ?? null;
		            const prose = (view?.dom as HTMLElement | null) ?? null;
		            if (!view || !prose || !prose.isConnected) return;

			            const selectionFromAfter =
			              typeof view.state.selection?.from === "number" ? view.state.selection.from : null;
			            const selectionToAfter =
			              typeof view.state.selection?.to === "number" ? view.state.selection.to : null;
			            const selectionDidNotMove =
			              selectionFromBefore != null &&
			              selectionFromAfter != null &&
			              selectionFromBefore === selectionFromAfter &&
			              selectionToBefore != null &&
			              selectionToAfter != null &&
			              selectionToBefore === selectionToAfter;
			            const selectionWasRange =
			              selectionFromBefore != null &&
			              selectionToBefore != null &&
			              selectionFromBefore !== selectionToBefore;

			            const hitInProse = target === prose || prose.contains(target);
			            const inPageChrome =
			              !!target.closest?.(".leditor-page") && !target.closest?.(".leditor-page-content");

		            // Compute a "safe" coords point that stays inside the page content box when the user
		            // clicks on page chrome (margins/header/footer clones). This prevents posAtCoords from
		            // resolving to the page wrapper node (non-inline), which breaks typing.
		            const pageEl = (target.closest?.(".leditor-page") as HTMLElement | null) ?? null;
		            const pageContent = pageEl?.querySelector<HTMLElement>(".leditor-page-content") ?? null;
		            const rawX = upEvent.clientX;
		            const rawY = upEvent.clientY;
		            const x = (() => {
		              if (!pageContent) return rawX;
		              const r = pageContent.getBoundingClientRect();
		              return Math.min(Math.max(rawX, r.left + 4), r.right - 4);
		            })();
		            const y = (() => {
		              if (!pageContent) return rawY;
		              const r = pageContent.getBoundingClientRect();
		              return Math.min(Math.max(rawY, r.top + 4), r.bottom - 4);
		            })();
		            const coords = view.posAtCoords?.({ left: x, top: y }) ?? null;

			            const coordsPos = typeof coords?.pos === "number" ? coords.pos : null;
			            const coordsFarFromBefore =
			              selectionFromBefore != null && coordsPos != null
			                ? Math.abs(coordsPos - selectionFromBefore) > 2
			                : true;

			            // Word-like behavior: if there is an active range selection and a plain click doesn't
			            // collapse it (usually because an overlay/page chrome intercepted the event), force a
			            // caret at the click coords. Never do this when the user is holding selection modifiers.
			            if (selectionDidNotMove && selectionWasRange && !selectionModifierHeld && coordsPos != null) {
			              try {
			                const $pos = view.state.doc.resolve(coordsPos);
			                const safe = Selection.near($pos, 1);
			                view.dispatch(view.state.tr.setSelection(safe).scrollIntoView());
			              } catch {
			                // ignore
			              }
			              try {
			                view.focus();
			              } catch {
			                // ignore
			              }
			              return;
			            }

			            // Only intervene if:
			            // - click wasn't in ProseMirror (chrome), OR
			            // - selection didn't move *and* the coords indicate a different place (broken click), OR
			            // - click landed in page chrome and ProseMirror didn't map it.
		            if ((!hitInProse || inPageChrome) || (selectionDidNotMove && coordsFarFromBefore)) {
		              if (coordsPos != null) {
		                const $pos = view.state.doc.resolve(coordsPos);
		                const safe = Selection.near($pos, 1);
		                view.dispatch(view.state.tr.setSelection(safe).scrollIntoView());
		              }
		              try {
		                view.focus();
		              } catch {
		                // ignore
		              }
		            } else if (hitInProse) {
		              // Normal ProseMirror click: don't override selection, but make sure focus is on the editor.
		              const activeEl = document.activeElement as HTMLElement | null;
		              const alreadyInProse = !!activeEl && (activeEl === prose || prose.contains(activeEl));
		              if (!alreadyInProse) {
		                try {
		                  view.focus();
		                } catch {
		                  // ignore
		                }
		              }
		            }
		          } catch {
		            // ignore
		          }
		        }, 0);
		      };

		      document.addEventListener("pointerup", onPointerUp, true);
		      document.addEventListener("pointercancel", onPointerUp, true);
	    }
	  };
  const existingPointerDown = (window as any)[globalPointerDownKey] as ((e: PointerEvent) => void) | undefined;
  if (existingPointerDown) document.removeEventListener("pointerdown", existingPointerDown, true);
  (window as any)[globalPointerDownKey] = handleDocumentPointerDown;
  document.addEventListener("pointerdown", handleDocumentPointerDown, true);

  // Body click caret enforcement (bubble phase):
  // ProseMirror typically finalizes click selection on `click`. In some cases (page wrappers, overlays,
  // transient non-editable state) the selection ends up stuck at doc start. After the click has
  // propagated, force selection to the click coords if it's clearly wrong.
  const handleDocumentClick = (event: MouseEvent) => {
    if (footnoteMode || headerFooterMode) return;
    if (event.button !== 0) return;
    let target = event.target as HTMLElement | null;
    if (!target) return;

    // Leaving footnote mode: any body click outside the footnote panel should restore body editing.
    if (footnoteMode && !target.closest?.(".leditor-page-footnotes")) {
      try {
        exitFootnoteMode({ restore: true });
      } catch {
        // ignore
      }
    }

    // If the overlay layer is accidentally intercepting clicks in body mode, "pierce" it by
    // temporarily disabling pointer events and re-resolving the underlying hit target.
    if (
      target.classList.contains("leditor-page-overlays") ||
      !!target.closest?.(".leditor-page-overlays")
    ) {
      try {
        const prev = overlayLayer.style.pointerEvents;
        overlayLayer.style.pointerEvents = "none";
        const under = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
        overlayLayer.style.pointerEvents = prev;
        if (under) target = under;
      } catch {
        // ignore
      }
    }
    // Only treat clicks on actual pages as "body surface" interactions.
    // (Clicks on the canvas background should not move the caret.)
    const pageEl = (target.closest?.(".leditor-page") as HTMLElement | null) ?? null;
    if ((window as any).__leditorCaretDebug) {
      console.info("[Body][click] captured", {
        tag: target.tagName,
        className: (target.getAttribute("class") || "").slice(0, 120),
        hasPage: Boolean(pageEl),
        inPageStack: Boolean(pageEl && pageStack.contains(pageEl))
      });
    }
    if (!pageEl || !pageStack.contains(pageEl)) return;
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const view = editorInstance?.view ?? null;
    const prose = (view?.dom as HTMLElement | null) ?? null;
    if (!view || !prose || !prose.isConnected) return;

    // Clamp coords into the page content box if available.
    const pageContent = pageEl.querySelector<HTMLElement>(".leditor-page-content") ?? null;
    const rawX = event.clientX;
    const rawY = event.clientY;
    const x = (() => {
      if (!pageContent) return rawX;
      const r = pageContent.getBoundingClientRect();
      return Math.min(Math.max(rawX, r.left + 4), r.right - 4);
    })();
    const y = (() => {
      if (!pageContent) return rawY;
      const r = pageContent.getBoundingClientRect();
      return Math.min(Math.max(rawY, r.top + 4), r.bottom - 4);
    })();

    const coords = view.posAtCoords?.({ left: x, top: y }) ?? null;
    const coordsPos = typeof coords?.pos === "number" ? coords.pos : null;
    if (coordsPos == null) return;

    const currentFrom = (view.state.selection as any)?.from as number | undefined;
    const delta = typeof currentFrom === "number" ? Math.abs(currentFrom - coordsPos) : Number.POSITIVE_INFINITY;

    // Detect obviously-wrong selections:
    // - far from click, or
    // - selection anchored in a non-inline parent (e.g. page wrapper)
    let selectionInlineOk = true;
    try {
      const selFrom = typeof currentFrom === "number" ? currentFrom : 0;
      const $from = view.state.doc.resolve(Math.max(0, Math.min(view.state.doc.content.size, selFrom)));
      selectionInlineOk = !!$from.parent.inlineContent;
    } catch {
      selectionInlineOk = true;
    }

    const shouldForce = delta > 5 || !selectionInlineOk;
    if ((window as any).__leditorCaretDebug) {
      console.info("[Body][click] observed", { currentFrom, coordsPos, delta, selectionInlineOk });
    }

    // If selection is clearly wrong, force it.
    if (shouldForce) {
      try {
        const $pos = view.state.doc.resolve(coordsPos);
        const safe = Selection.near($pos, 1);
        view.dispatch(view.state.tr.setSelection(safe).scrollIntoView());
        view.focus();
        if ((window as any).__leditorCaretDebug) {
          console.info("[Body][click] forced selection", { coordsPos, currentFrom, delta });
        }
      } catch {
        // ignore
      }
    } else {
      // Ensure focus stays on the editor so caret is visible.
      const activeEl = document.activeElement as HTMLElement | null;
      const alreadyInProse = !!activeEl && (activeEl === prose || prose.contains(activeEl));
      if (!alreadyInProse) {
        try {
          view.focus();
        } catch {
          // ignore
        }
      }
    }
  };

  // NOTE: register in capture phase so we still observe clicks even if some element stops propagation
  // (we've seen this happen with overlays/legacy handlers, resulting in "no click is catched").
  const existingDocClick = (window as any)[globalClickKey] as ((e: MouseEvent) => void) | undefined;
  if (existingDocClick) document.removeEventListener("click", existingDocClick, true);
  (window as any)[globalClickKey] = handleDocumentClick;
  document.addEventListener("click", handleDocumentClick, true);

  // Some hosts (Electron + embedded devtools / legacy layers) can stop propagation before it reaches
  // `document`. Add redundant capture listeners on our known interactive roots so body clicks always
  // re-arm the caret, even if another layer interferes.
  const globalCanvasClickKey = "__leditorA4CanvasClickHandler";
  const globalEditorClickKey = "__leditorA4EditorClickHandler";
  const existingCanvasClick = (window as any)[globalCanvasClickKey] as ((e: MouseEvent) => void) | undefined;
  if (existingCanvasClick) canvas.removeEventListener("click", existingCanvasClick, true);
  (window as any)[globalCanvasClickKey] = handleDocumentClick;
  canvas.addEventListener("click", handleDocumentClick, true);
  const existingEditorClick = (window as any)[globalEditorClickKey] as ((e: MouseEvent) => void) | undefined;
  if (existingEditorClick) editorEl.removeEventListener("click", existingEditorClick, true);
  (window as any)[globalEditorClickKey] = handleDocumentClick;
  editorEl.addEventListener("click", handleDocumentClick, true);

  // Ensure footnote text drafts are persisted even if the user closes the app/window while a
  // debounce timer is pending (common source of "missing footnotes next session").
  const handleFootnoteFlushOnPageHide = () => flushPendingFootnoteTextCommits("pagehide");
  const handleFootnoteFlushOnBeforeUnload = () => flushPendingFootnoteTextCommits("beforeunload");
  const handleFootnoteFlushOnVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      flushPendingFootnoteTextCommits("visibilitychange:hidden");
    }
  };
  const existingPagehide = (window as any)[globalPagehideKey] as (() => void) | undefined;
  if (existingPagehide) window.removeEventListener("pagehide", existingPagehide);
  (window as any)[globalPagehideKey] = handleFootnoteFlushOnPageHide;
  window.addEventListener("pagehide", handleFootnoteFlushOnPageHide);

  const existingBeforeUnload = (window as any)[globalBeforeUnloadKey] as (() => void) | undefined;
  if (existingBeforeUnload) window.removeEventListener("beforeunload", existingBeforeUnload);
  (window as any)[globalBeforeUnloadKey] = handleFootnoteFlushOnBeforeUnload;
  window.addEventListener("beforeunload", handleFootnoteFlushOnBeforeUnload);

  const existingVisChange = (window as any)[globalVisibilityChangeKey] as (() => void) | undefined;
  if (existingVisChange) document.removeEventListener("visibilitychange", existingVisChange);
  (window as any)[globalVisibilityChangeKey] = handleFootnoteFlushOnVisibilityChange;
  document.addEventListener("visibilitychange", handleFootnoteFlushOnVisibilityChange);

  initTheme();
  const handleFootnoteFocusEvent = (event: Event) => {
    const e = event as CustomEvent<{ footnoteId?: string; selectionSnapshot?: StoredSelection | null }>;
    const id = (e?.detail?.footnoteId ?? "").trim();
    if (!id) return;
    // Deduplicate focus events; some hosts dispatch multiple events for a single action.
    const now = Date.now();
    const lastEventAtById =
      ((window as any).__leditorFootnoteFocusEventAtById as Map<string, number> | undefined) ??
      new Map<string, number>();
    (window as any).__leditorFootnoteFocusEventAtById = lastEventAtById;
    const lastAt = lastEventAtById.get(id) ?? 0;
    if (now - lastAt < 100) return;
    lastEventAtById.set(id, now);

    const snapshot = e?.detail?.selectionSnapshot ?? null;
    if (snapshot) {
      pendingFootnoteSourceSelection.set(id, snapshot);
    }
    // If we're already focused inside this footnote editor, do nothing.
    if (footnoteMode && activeFootnoteId === id) {
      const active = document.activeElement as HTMLElement | null;
      if (
        active?.classList?.contains("leditor-footnote-entry-text") &&
        active.getAttribute("data-footnote-id") === id
      ) {
        return;
      }
    }
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][focus][event] received", { footnoteId: id });
    }
    // Focus exactly once (plus at most one deferred retry). Repeated loops here caused app/ribbon
    // flicker, caret oscillation, and "ghost" footnote renders during pagination churn.
    footnoteFocusRetryToken += 1;
    const token = footnoteFocusRetryToken;
    const tryOnce = (phase: "now" | "raf") => {
      if (token !== footnoteFocusRetryToken) return;
      const ok = focusFootnoteEntry(id, "end");
      const active = document.activeElement as HTMLElement | null;
      const focused =
        !!active &&
        active.classList.contains("leditor-footnote-entry-text") &&
        (active.getAttribute("data-footnote-id") || "").trim() === id;
      if (ok && focused) return;
      if (phase === "now") {
        window.requestAnimationFrame(() => tryOnce("raf"));
      } else if ((window as any).__leditorCaretDebug) {
        console.warn("[Footnote][focus][event] focus retry gave up", { footnoteId: id });
      }
    };
    tryOnce("now");
  };
  // Ensure we never register multiple global listeners (can happen if A4 layout remounts after an error).
  const globalFootnoteFocusKey = "__leditorFootnoteFocusHandler";
  const existingGlobalFootnoteFocusHandler = (window as any)[globalFootnoteFocusKey] as EventListener | undefined;
  if (existingGlobalFootnoteFocusHandler) {
    window.removeEventListener("leditor:footnote-focus", existingGlobalFootnoteFocusHandler);
  }
  (window as any)[globalFootnoteFocusKey] = handleFootnoteFocusEvent as EventListener;
  window.addEventListener("leditor:footnote-focus", handleFootnoteFocusEvent as EventListener);

  // Allow non-UI callers (host / ribbon) to request leaving footnote mode without depending on
  // internal closures. This is also used to stop "focus fights" where another subsystem tries to
  // steal focus back to ProseMirror while the user is editing a footnote.
  const handleFootnoteExitEvent = () => {
    if (!footnoteMode) return;
    try {
      exitFootnoteMode({ restore: true });
    } catch {
      // ignore
    }
  };
  const globalFootnoteExitKey = "__leditorFootnoteExitHandler";
  const existingGlobalFootnoteExitHandler = (window as any)[globalFootnoteExitKey] as EventListener | undefined;
  if (existingGlobalFootnoteExitHandler) {
    window.removeEventListener("leditor:footnote-exit", existingGlobalFootnoteExitHandler);
  }
  (window as any)[globalFootnoteExitKey] = handleFootnoteExitEvent as EventListener;
  window.addEventListener("leditor:footnote-exit", handleFootnoteExitEvent as EventListener);
  const existingFocusIn = (window as any)[globalFocusInKey] as ((e: FocusEvent) => void) | undefined;
  if (existingFocusIn) document.removeEventListener("focusin", existingFocusIn, true);
  (window as any)[globalFocusInKey] = handleDocumentFocusIn;
  document.addEventListener("focusin", handleDocumentFocusIn, true);
  renderPages(pageCount);
  attachEditorForMode();
  updatePagination();
  scheduleFootnoteUpdate();

  // Drive footnote overlay updates from the editor document (not DOM mutations). Observing the
  // ProseMirror DOM causes flicker/caret loops because typing replaces DOM nodes frequently.
  const editorInstanceForFootnotes = attachedEditorHandle?.getEditor?.() ?? null;
  const computeFootnoteDocSignature = (doc: any): string => {
    if (!doc) return "";
    const parseResetFlag = (raw: unknown): boolean => {
      if (!raw) return false;
      if (raw === true) return true;
      if (typeof raw === "string") {
        const trimmed = raw.trim().toLowerCase();
        return trimmed === "true" || trimmed === "1" || trimmed === "yes";
      }
      return false;
    };
    const parts: string[] = [];
    doc.descendants?.((node: any) => {
      if (!node) return true;
      if (node.type?.name === "page_break") {
        const kind = typeof node.attrs?.kind === "string" ? String(node.attrs.kind) : "";
        if (kind.startsWith("section_")) {
          const settingsRaw = node.attrs?.sectionSettings;
          let reset = false;
          if (parseResetFlag(settingsRaw)) reset = true;
          if (typeof settingsRaw === "string") {
            try {
              const parsed = JSON.parse(settingsRaw);
              reset = parseResetFlag(parsed?.resetFootnotes);
            } catch {
              // ignore
            }
          } else if (typeof settingsRaw === "object" && settingsRaw) {
            reset = parseResetFlag((settingsRaw as any).resetFootnotes);
          }
          if (reset) parts.push("RESET");
        }
      }
      if (node.type?.name !== "footnote") return true;
      const id = typeof node.attrs?.footnoteId === "string" ? String(node.attrs.footnoteId).trim() : "";
      const rawKind = typeof node.attrs?.kind === "string" ? String(node.attrs.kind) : "footnote";
      const kind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
      const citation = typeof node.attrs?.citationId === "string" ? String(node.attrs.citationId).trim() : "";
      if (id) parts.push(`${kind}:${id}:${citation}`);
      return true;
    });
    return parts.join("|");
  };
  let lastFootnoteDocSignature = computeFootnoteDocSignature(editorInstanceForFootnotes?.state?.doc);
  const handleEditorUpdate = (payload: any) => {
    const editor = payload?.editor ?? editorInstanceForFootnotes;
    const transaction = payload?.transaction;
    if (transaction && transaction.docChanged === false) return;
    const next = computeFootnoteDocSignature(editor?.state?.doc);
    if (next === lastFootnoteDocSignature) return;
    lastFootnoteDocSignature = next;
    scheduleFootnoteUpdate();
  };
  try {
    editorInstanceForFootnotes?.on?.("update", handleEditorUpdate);
  } catch {
    // ignore
  }

  const computePaginationDocSignature = (doc: any): string => {
    if (!doc) return "";
    const size = typeof doc.content?.size === "number" ? doc.content.size : doc.nodeSize ?? 0;
    const childCount = typeof doc.childCount === "number" ? doc.childCount : 0;
    return `${size}:${childCount}`;
  };
  let lastPaginationDocSignature = computePaginationDocSignature(attachedEditorHandle?.getEditor?.()?.state?.doc);
  const pageObserver = new MutationObserver(() => {
    scheduleFootnoteLayoutVarSync();
    if (suspendPageObserver || paginationQueued || footnoteMode || headerFooterMode) return;
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const nextSignature = computePaginationDocSignature(editorInstance?.state?.doc);
    if (nextSignature === lastPaginationDocSignature) {
      if ((window as any).__leditorPaginationDebug) {
        console.info("[PaginationDebug] skip mutation (doc unchanged)");
      }
      return;
    }
    lastPaginationDocSignature = nextSignature;
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

  let lastViewportSize = { width: 0, height: 0 };
  const resizeObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    const nextWidth = Math.round(entry.contentRect.width);
    const nextHeight = Math.round(entry.contentRect.height);
    if (
      Math.abs(nextWidth - lastViewportSize.width) < 1 &&
      Math.abs(nextHeight - lastViewportSize.height) < 1
    ) {
      return;
    }
    lastViewportSize = { width: nextWidth, height: nextHeight };
    requestZoomUpdate();
  });
  // Observe the viewport shell (not the canvas) so pagination doesn't loop on content height changes.
  resizeObserver.observe(appRoot);

  return {
    updatePagination,
    destroy() {
      if (footnoteDraftFlushTimer != null) {
        try {
          window.clearTimeout(footnoteDraftFlushTimer);
        } catch {
          // ignore
        }
        footnoteDraftFlushTimer = null;
      }
      resizeObserver.disconnect();
      pageObserver.disconnect();
      try {
        editorInstanceForFootnotes?.off?.("update", handleEditorUpdate);
      } catch {
        // ignore
      }
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
      // (no-op) handleBodyPointerDown removed
      appRoot.removeEventListener("click", handleFootnoteEntryClick);
      appRoot.removeEventListener("input", handleFootnoteEntryInput);
      appRoot.removeEventListener("keydown", handleFootnoteEntryKeydown, true);
      appRoot.removeEventListener("click", handleEndnoteEntryClick);
      appRoot.removeEventListener("input", handleEndnoteEntryInput);
      const existingDocKeydown = (window as any)[globalKeydownKey] as ((e: KeyboardEvent) => void) | undefined;
      if (existingDocKeydown) {
        document.removeEventListener("keydown", existingDocKeydown);
        if (existingDocKeydown === handleKeydown) delete (window as any)[globalKeydownKey];
      }
      const existingSelectionChange = (window as any)[globalSelectionChangeKey] as (() => void) | undefined;
      if (existingSelectionChange) {
        document.removeEventListener("selectionchange", existingSelectionChange);
        if (existingSelectionChange === handleSelectionChange) delete (window as any)[globalSelectionChangeKey];
      }
      const existingPointerDown = (window as any)[globalPointerDownKey] as ((e: PointerEvent) => void) | undefined;
      if (existingPointerDown) {
        document.removeEventListener("pointerdown", existingPointerDown, true);
        if (existingPointerDown === handleDocumentPointerDown) delete (window as any)[globalPointerDownKey];
      }
      const existingPagehide = (window as any)[globalPagehideKey] as (() => void) | undefined;
      if (existingPagehide) {
        window.removeEventListener("pagehide", existingPagehide);
        if (existingPagehide === handleFootnoteFlushOnPageHide) delete (window as any)[globalPagehideKey];
      }
      const existingBeforeUnload = (window as any)[globalBeforeUnloadKey] as (() => void) | undefined;
      if (existingBeforeUnload) {
        window.removeEventListener("beforeunload", existingBeforeUnload);
        if (existingBeforeUnload === handleFootnoteFlushOnBeforeUnload) delete (window as any)[globalBeforeUnloadKey];
      }
      const existingVisChange = (window as any)[globalVisibilityChangeKey] as (() => void) | undefined;
      if (existingVisChange) {
        document.removeEventListener("visibilitychange", existingVisChange);
        if (existingVisChange === handleFootnoteFlushOnVisibilityChange) delete (window as any)[globalVisibilityChangeKey];
      }
      const existingFocusIn = (window as any)[globalFocusInKey] as ((e: FocusEvent) => void) | undefined;
      if (existingFocusIn) {
        document.removeEventListener("focusin", existingFocusIn, true);
        if (existingFocusIn === handleDocumentFocusIn) delete (window as any)[globalFocusInKey];
      }
      const existing = (window as any)[globalFootnoteFocusKey] as EventListener | undefined;
      if (existing) {
        window.removeEventListener("leditor:footnote-focus", existing);
        if (existing === (handleFootnoteFocusEvent as any)) {
          delete (window as any)[globalFootnoteFocusKey];
        }
      }
      const existingExit = (window as any)[globalFootnoteExitKey] as EventListener | undefined;
      if (existingExit) {
        window.removeEventListener("leditor:footnote-exit", existingExit);
        if (existingExit === (handleFootnoteExitEvent as any)) {
          delete (window as any)[globalFootnoteExitKey];
        }
      }
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
    exitFootnoteMode() {
      exitFootnoteMode({ restore: false });
    },
    isFootnoteMode() {
      return footnoteMode;
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



















