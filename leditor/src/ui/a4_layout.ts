import { getFootnoteRegistry } from "../extensions/extension_footnote.ts";
import { getFootnoteBodyPlainText } from "../extensions/extension_footnote_body.ts";
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
import { EditorState, Selection, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { DOMSerializer, Fragment as PMFragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { keymap } from "@tiptap/pm/keymap";
import { baseKeymap } from "@tiptap/pm/commands";
import { history } from "@tiptap/pm/history";
import { findSentenceBounds } from "../editor/sentence_utils.ts";
import type { StoredSelection } from "../utils/selection_snapshot";
import { applySnapshotToTransaction } from "../utils/selection_snapshot";
import type { FootnoteRenderEntry, FootnoteKind } from "../uipagination/footnotes/model.ts";
import { getSelectionMode } from "../editor/input_modes.ts";
import { setVirtualSelections, type VirtualSelectionRange } from "../extensions/extension_virtual_selection.ts";

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
  restoreLastBodySelection: () => boolean;
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

const shouldForceSingleColumn = (): boolean =>
  typeof window !== "undefined" && (window as any).__leditorDisableColumns !== false;

const enforceSingleColumnStyle = (content: HTMLElement | null, force = false) => {
  if (!content) return;
  if (!force && !shouldForceSingleColumn()) return;
  content.style.setProperty("column-count", "1", "important");
  content.style.setProperty("column-gap", "0px", "important");
  content.style.setProperty("column-fill", "auto", "important");
  content.style.setProperty("column-width", "auto", "important");
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
  --page-column-gap: 24px;
  --page-column-width: auto;
  --heading1-break-before: page;
  --heading1-break-after: avoid;
  --heading2-break-after: avoid;
  --heading3-break-after: avoid;
  --heading4-break-after: avoid;
  --heading5-break-after: avoid;
  --heading6-break-after: avoid;
  --widow-lines: 1;
  --orphan-lines: 1;
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
  /* Additional guard to keep the last text line away from the footnote band. */
  --page-footnote-guard: 10px;
  /* Extra padding to prevent descenders from clipping at the bottom edge. */
  --page-line-fit-pad: 4px;
  --footnote-max-height-ratio: 1;
  --footnote-separator-height: 1px;
  --footnote-separator-color: color-mix(in srgb, var(--ui-text) 25%, transparent);
  --footnote-spacing: 6px;
  --footnote-font-size: 11px;
  --page-break-line-height: 1px;
  --page-break-line-style: dashed;
  --page-break-line-color: color-mix(in srgb, var(--ui-text) 45%, transparent);
  --page-bg-light: #ffffff;
  --page-bg-dark: #2d2d2d;
  --page-bg: var(--page-bg-light);
  --page-border-color: color-mix(in srgb, var(--ui-text) 14%, transparent);
  --page-border-color-dark: color-mix(in srgb, var(--ui-text) 18%, transparent);
  --page-border-width: 1px;
  --page-shadow: 0 16px 40px color-mix(in srgb, #000000 20%, transparent);
  --page-shadow-dark: 0 16px 40px color-mix(in srgb, #000000 55%, transparent);
  --page-gap: 12px;
  --page-margin-inside: 2.5cm;
  --page-margin-outside: 2.5cm;
  --column-separator-color: color-mix(in srgb, var(--ui-text) 25%, transparent);
  --page-column-gap: 24px;
  --page-canvas-bg: var(--ui-bg);
  --page-canvas-bg-dark: var(--ui-bg);
  --min-zoom: 0.3;
  --max-zoom: 3;
  --zoom-step: 0.1;
  --page-zoom: 1;
  --ruler-height: 24px;
  --ruler-color: color-mix(in srgb, var(--ui-text) 55%, transparent);
  --ruler-bg: color-mix(in srgb, var(--ui-surface) 70%, transparent);
  --ruler-border: color-mix(in srgb, var(--ui-text) 20%, transparent);
  --page-font-family: "Times New Roman", "Times", "Georgia", serif;
  --page-font-size: 12pt;
  --page-line-height: 1.0;
  --page-body-color: color-mix(in srgb, var(--ui-text) 92%, transparent);
  --page-header-color: color-mix(in srgb, var(--ui-text) 78%, transparent);
  --page-footer-color: color-mix(in srgb, var(--ui-text) 70%, transparent);
  --page-footnote-color: color-mix(in srgb, var(--ui-text) 60%, transparent);
  /* UI scaling is handled by --ui-scale set by renderer bootstrap. */
  --ui-scale: 1;
}

html, body {
  height: 100%;
  overflow: visible;
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

.leditor-app.leditor-app--loading {
  pointer-events: none;
}

.leditor-app.leditor-app--loading > * {
  opacity: 0;
}

.leditor-app.leditor-app--loading::before {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 28px;
  height: 28px;
  border: 2px solid color-mix(in srgb, var(--ui-text) 18%, transparent);
  border-top-color: var(--ui-text);
  border-radius: 999px;
  transform: translate(-50%, -60%) rotate(0deg);
  animation: leditor-spin 0.9s linear infinite;
  z-index: 9998;
}

.leditor-app.leditor-app--loading::after {
  content: "Loading…";
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, 10px);
  font-family: var(--ui-font-family, "Source Sans 3", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif);
  font-size: 14px;
  letter-spacing: 0.04em;
  color: var(--ui-text);
  z-index: 9998;
}

@keyframes leditor-spin {
  to {
    transform: translate(-50%, -60%) rotate(360deg);
  }
}

.leditor-app-header {
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  z-index: 1000;
  background: var(--ui-bg);
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

/* Generic right gutter for any floating feedback rail (AI drafts, source checks, etc.). */
.leditor-app.leditor-app--feedback-rail-open .leditor-doc-shell {
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
  background: var(--ui-bg);
  border-left: 1px solid var(--ui-border-color);
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
  border-bottom: 1px solid var(--ui-border-color);
  color: var(--ui-text);
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ui-surface);
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
  border: 1px solid var(--ui-border-color);
  background: color-mix(in srgb, var(--ui-surface-2) 80%, transparent);
  color: var(--ui-text);
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.leditor-pdf-close:hover {
  background: color-mix(in srgb, var(--ui-surface-2) 92%, transparent);
}

/* Legacy PDF pane frame (kept scoped so it doesn't override the embedded split PDF panel). */
.leditor-pdf-pane .leditor-pdf-frame {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  border: 0;
  background: var(--ui-bg);
}

.leditor-toc {
  margin: 24px auto;
  width: min(720px, 100%);
  padding: 18px 24px;
  border-radius: 12px;
  background: var(--ui-surface);
  border: var(--ui-border);
  box-shadow: var(--ui-shadow-1);
}
.leditor-toc[data-toc-style="auto2"] {
  background: var(--ui-surface-2);
  border-color: color-mix(in srgb, var(--ui-accent) 35%, var(--ui-border-color));
  box-shadow: 0 12px 32px color-mix(in srgb, var(--ui-accent) 20%, transparent);
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
  border-bottom: 1px dashed color-mix(in srgb, var(--ui-text) 15%, transparent);
  color: var(--ui-text);
}
.leditor-toc-entry:last-child {
  border-bottom: none;
}
.leditor-toc-entry:hover {
  color: var(--ui-accent);
}
.leditor-toc[data-toc-style="auto2"] .leditor-toc-entry {
  border-bottom-color: color-mix(in srgb, var(--ui-accent) 40%, transparent);
}

.leditor-app .ProseMirror a,
.leditor-app .ProseMirror a * {
  color: var(--ui-link);
  text-decoration: underline;
  text-decoration-color: var(--ui-link-underline);
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
  cursor: pointer;
}

.leditor-app .ProseMirror a.leditor-citation-anchor {
  display: inline-flex;
  align-items: baseline;
  background: var(--ui-link-bg);
  border: 1px solid var(--ui-link-border);
  border-radius: 6px;
  padding: 1px 5px;
  transition: background 120ms ease, border-color 120ms ease, transform 80ms ease;
}
.leditor-app .ProseMirror a.leditor-citation-anchor:hover {
  background: color-mix(in srgb, var(--ui-link) 14%, transparent);
  border-color: color-mix(in srgb, var(--ui-link) 32%, transparent);
}
.leditor-app .ProseMirror a.leditor-citation-anchor:active {
  transform: translateY(1px);
}

@keyframes leditor-citation-flash {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent) 0%, transparent); transform: translateY(0); }
  20% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ui-accent) 30%, transparent); transform: translateY(-0.5px); }
  100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-accent) 0%, transparent); transform: translateY(0); }
}

.leditor-app .ProseMirror a.leditor-citation-anchor.leditor-citation-anchor--flash {
  animation: leditor-citation-flash 0.6s ease-out;
}

/* Make citation anchors feel like real links even when the A4/pagination layer renders content
   outside the raw ProseMirror container. */
.leditor-app a.leditor-citation-anchor,
.leditor-app a.leditor-citation-anchor *,
.leditor-app a.leditor-citation-anchor *::before,
.leditor-app a.leditor-citation-anchor *::after {
  cursor: pointer;
}
.leditor-app a.leditor-citation-anchor {
  user-select: text;
  -webkit-user-select: text;
}

.leditor-app.theme-dark {
  --page-canvas-bg: var(--page-canvas-bg-dark);
  --page-border-color: var(--page-border-color-dark);
  --page-shadow: var(--page-shadow-dark);
  --page-body-color: var(--ui-text);
  --page-header-color: color-mix(in srgb, var(--ui-text) 88%, transparent);
  --page-footer-color: color-mix(in srgb, var(--ui-text) 80%, transparent);
  --page-footnote-color: color-mix(in srgb, var(--ui-text) 72%, transparent);
  color-scheme: dark;
  color: var(--ui-text);
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
  /* Keep the first page visible while leaving a small cushion below the ribbon. */
  padding: 24px 16px 56px;
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
  flex-wrap: nowrap;
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

.leditor-footnotes-container,
.leditor-footnote-body {
  display: none;
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
  white-space: normal;
  outline: none;
  display: block;
  min-width: 0.5ch;
  min-height: 1em;
  cursor: text;
  caret-color: currentColor;
}

.leditor-footnote-entry-text p,
.leditor-endnote-entry-text p {
  margin: 0;
}

.leditor-footnote-entry-text ul,
.leditor-footnote-entry-text ol,
.leditor-endnote-entry-text ul,
.leditor-endnote-entry-text ol {
  margin: 0;
  padding-left: 1.2em;
}

.leditor-footnote-entry-text .ProseMirror,
.leditor-endnote-entry-text .ProseMirror {
  outline: none;
  min-height: 1em;
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
  color: color-mix(in srgb, var(--ui-text) 45%, transparent);
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
  display: none;
  min-height: 0;
  pointer-events: none;
}

/* Visual debug: flash page background when footnote reflow triggers. */
.leditor-page.leditor-footnote-reflow,
.leditor-page .leditor-footnote-reflow {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 80%, transparent);
  outline-offset: 4px;
  transition: outline 0.2s ease-out;
}

.leditor-margin-guide {
  position: absolute;
  top: calc(var(--local-page-margin-top, var(--page-margin-top)) + var(--header-height) + var(--header-offset));
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  bottom: calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-height) + var(--footer-offset) + var(--footnote-area-height));
  border: 1px dashed color-mix(in srgb, var(--ui-danger) 65%, transparent);
  border-radius: 2px;
  pointer-events: none;
  display: none;
  box-sizing: border-box;
}

.leditor-debug-margins .leditor-margin-guide {
  display: block;
}

.leditor-debug-margins .leditor-margins-frame {
  outline: 1px dashed color-mix(in srgb, var(--ui-danger) 35%, transparent);
  outline-offset: -1px;
}

.leditor-debug-footnotes .leditor-page-content {
  outline: 2px solid color-mix(in srgb, var(--ui-accent) 55%, transparent);
  outline-offset: -2px;
}

.leditor-debug-footnotes .leditor-page-stack .leditor-page-footnotes {
  outline: 2px solid color-mix(in srgb, var(--ui-success) 60%, transparent);
  background: color-mix(in srgb, var(--ui-success) 5%, transparent);
}

.leditor-debug-footnotes .leditor-page-stack .leditor-page-footnotes::after {
  content: attr(data-debug-footnote-height);
  position: absolute;
  right: 6px;
  top: -16px;
  font-size: 10px;
  font-weight: 600;
  color: var(--ui-success);
  background: color-mix(in srgb, var(--ui-surface) 92%, transparent);
  border: 1px solid var(--ui-success-border);
  border-radius: 6px;
  padding: 2px 6px;
  pointer-events: none;
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

/* In footnote editing mode, overlays remain present but stay inert. */
.leditor-footnote-editing .leditor-page-overlays {
  pointer-events: none;
}

/* Footnotes now live in the page stack; overlays stay inert in footnote mode. */
.leditor-footnote-editing .leditor-page-overlay {
  pointer-events: none;
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
.leditor-page-stack .leditor-page .leditor-page-footer {
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
  /* Footnotes render in the page stack (siblings of body). Overlays keep header/footer only. */
  display: none;
  min-height: 0;
  pointer-events: none;
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
.leditor-app:not(.leditor-app--pagination-continuous) #editor .ProseMirror > * {
  align-self: stretch;
}
.leditor-app:not(.leditor-app--pagination-continuous) #editor .ProseMirror > .leditor-page {
  align-self: center;
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

#editor .ProseMirror p {
  text-align: justify;
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

#editor .ProseMirror h3 {
  page-break-after: var(--heading3-break-after, avoid);
  break-after: var(--heading3-break-after, avoid);
}

#editor .ProseMirror h4 {
  page-break-after: var(--heading4-break-after, avoid);
  break-after: var(--heading4-break-after, avoid);
}

#editor .ProseMirror h5 {
  page-break-after: var(--heading5-break-after, avoid);
  break-after: var(--heading5-break-after, avoid);
}

#editor .ProseMirror h6 {
  page-break-after: var(--heading6-break-after, avoid);
  break-after: var(--heading6-break-after, avoid);
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
  background: var(--ui-warning-bg);
  border-bottom: 2px solid color-mix(in srgb, var(--ui-warning) 90%, transparent);
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
  background: var(--ui-tooltip-bg);
  color: var(--ui-tooltip-text);
  font-size: 12px;
  box-shadow: 0 6px 18px color-mix(in srgb, #000000 35%, transparent);
  z-index: 20;
  white-space: pre-wrap;
}

.leditor-break {
  position: relative;
  margin: 16px 0;
  padding: 6px 0;
  text-align: center;
  font-size: 11px;
  color: var(--ui-muted-strong);
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
  background: var(--ui-bg);
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
  background: color-mix(in srgb, var(--ui-surface) 60%, transparent);
  border-bottom-color: color-mix(in srgb, var(--ui-text) 20%, transparent);
  color: var(--ui-text);
}

.leditor-app.theme-dark .leditor-ruler-tick {
  border-left-color: color-mix(in srgb, var(--ui-text) 20%, transparent);
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
  color: var(--ui-muted-strong);
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
  color: var(--ui-text);
  font-size: 10px;
  font-weight: 600;
}

/* Hide internal "start bibliography on new page" breaks. */
.leditor-break[data-break-kind="page"][data-section-id="bibliography"],
.leditor-break[data-break-kind="page"][data-section-id="bibliography"]::before,
.leditor-break[data-break-kind="page"][data-section-id="bibliography"]::after {
  display: none;
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
  box-sizing: border-box;
  padding: 0 0
    calc(
      var(--page-footnote-gap, 0px) + var(--page-footnote-guard, 0px) +
        var(--page-line-fit-pad, 0px)
    )
    0;
  overflow: hidden;
  pointer-events: auto;
  hyphens: var(--page-hyphens, manual);
  column-count: 1;
  column-gap: 0;
  column-width: auto;
  column-fill: auto;
  min-width: 0;
  word-break: normal;
  overflow-wrap: normal;
}

.leditor-page-content p,
.leditor-page-content li {
  max-width: 100%;
  box-sizing: border-box;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.leditor-page-content a,
.leditor-page-content span,
.leditor-page-content em,
.leditor-page-content i,
.leditor-page-content strong,
.leditor-page-content b {
  display: inline;
  max-width: 100%;
  box-sizing: border-box;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.leditor-page-content h1,
.leditor-page-content h2,
.leditor-page-content h3,
.leditor-page-content h4,
.leditor-page-content h5,
.leditor-page-content h6 {
  max-width: 100%;
  box-sizing: border-box;
  white-space: normal !important;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.leditor-page-content pre,
.leditor-page-content code {
  white-space: pre-wrap;
  word-break: break-word;
}

.leditor-page-content * {
  max-width: 100%;
  box-sizing: border-box;
}

/* Spacer no longer needed; footnote spacing is handled by the page height variables. */

/* Keep complex blocks together unless explicitly allowed to split. */
.leditor-page-content table,
.leditor-page-content figure,
.leditor-page-content img,
.leditor-page-content .leditor-keep-together {
  break-inside: avoid;
  page-break-inside: avoid;
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
.leditor-footnote-continuation-label {
  font-style: italic;
  opacity: 0.75;
}

.leditor-page-stack {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.leditor-page-overlays {
  position: absolute;
  inset: 0;
  /* Overlays must sit above the page stack so header/footer UIs are usable. */
  z-index: 3;
  /* Keep overlays inert unless a mode explicitly enables pointer events. */
  pointer-events: none;
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
  pointer-events: none;
}
.leditor-page-overlay .leditor-page-footnotes.leditor-page-footnotes--active {
  display: none;
  pointer-events: none;
}

/* Debug regions removed. */

`;
  document.head.appendChild(style);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const determineGridMode = (_zoom: number): GridMode => {
  // Keep a single vertical page stack unless the user explicitly selects a grid view.
  // Auto-grid based on zoom caused horizontal flow and “only two pages” layouts.
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
  try {
    (window as any).__leditorDisableColumns = true;
  } catch {
    // ignore
  }
  applyDocumentLayoutTokenDefaults(document.documentElement);
  applyDocumentLayoutTokens(document.documentElement);

  // NOTE: `mountA4Layout` mounts onto the scroll container (`.leditor-doc-shell`), but several
  // systems (notably the ribbon dispatcher) key off `#leditor-app` for overlay edit-mode detection.
  // Mirror our mode classes to `#leditor-app` so ribbon commands do not steal focus back to
  // ProseMirror while the user is typing in non-body editors (footnotes/header/footer).
  const appShell = document.getElementById("leditor-app");
  const setModeClass = (className: string, enabled: boolean) => {
    appRoot.classList.toggle(className, enabled);
    if (appShell && appShell !== appRoot) {
      appShell.classList.toggle(className, enabled);
    }
  };

  const attachedEditorHandle = editorHandle ?? null;
  const getFootnoteNumbering = (): Map<string, string> => {
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
  // Keep overlays visually above the page stack (so header/footer are visible),
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
    body: {
      bookmark: unknown | null;
      from: number;
      to: number;
      last: { bookmark: unknown | null; from: number; to: number } | null;
    };
    header: { byPage: Map<string, number> };
    footer: { byPage: Map<string, number> };
    footnotes: { byId: Map<string, number> };
  } = {
    active: "body",
    body: { bookmark: null, from: 0, to: 0, last: null },
    header: { byPage: new Map<string, number>() },
    footer: { byPage: new Map<string, number>() },
    footnotes: { byId: new Map<string, number>() }
  };
  let footnoteMode = false;
  let activeFootnoteId: string | null = null;

  let pointerDownActive = false;
  let pointerSelectionRange = false;
  let lastPointerSelectionAt = 0;
  let lastPointerDragAt = 0;
  let lastPointerDownAt = 0;
  let lastPointerUpAt = 0;
  let pointerDownX = 0;
  let pointerDownY = 0;
  let pointerMoved = false;
  let selectionHoldUntil = 0;
  const armSelectionHold = (ms = 350) => {
    selectionHoldUntil = Math.max(selectionHoldUntil, Date.now() + ms);
  };
  const selectionHoldActive = () => Date.now() < selectionHoldUntil;
  const markRangeSelection = (ms = 400) => {
    pointerSelectionRange = true;
    lastPointerSelectionAt = Date.now();
    armSelectionHold(ms);
  };
  type MultiClickDragState = {
    active: boolean;
    kind: "word" | "sentence" | "paragraph";
    anchorFrom: number;
    anchorTo: number;
    lastPos: number;
  };
  let multiClickDrag: MultiClickDragState | null = null;
  let marginSelectionActive = false;
  let marginSelectionAnchor: { from: number; to: number } | null = null;
  let lastPageContentEl: HTMLElement | null = null;
  let blockSelectionActive = false;
  let blockSelectionAnchor: { x: number; y: number } | null = null;
  let blockSelectionPageContent: HTMLElement | null = null;
  let autoScrollRaf = 0;
  let pendingAutoScroll = 0;

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
  let lastUserInputAt = 0;
  const markUserInput = () => {
    lastUserInputAt = performance.now();
  };
  appRoot.addEventListener("scroll", () => {
    lastUserScrollAt = performance.now();
  });

  const getTargetGridMode = () => (viewMode === "two-page" ? "grid-2" : determineGridMode(zoomValue));
  const logPageStackState = (label: string) => {
    try {
      if (!(window as any).__leditorPaginationDebug && !(window as any).__leditorA4LayoutDebug) {
        return;
      }
      const stackStyle = getComputedStyle(pageStack);
      const overlayStyle = getComputedStyle(overlayLayer);
      const info = {
        label,
        viewMode,
        gridMode: pageStack.dataset.gridMode,
        stackDisplay: stackStyle.display,
        stackGridCols: stackStyle.gridTemplateColumns,
        stackFlexDir: stackStyle.flexDirection,
        overlayDisplay: overlayStyle.display,
        overlayGridCols: overlayStyle.gridTemplateColumns,
        overlayFlexDir: overlayStyle.flexDirection,
        isTwoPage: pageStack.classList.contains("is-two-page"),
        stackWidth: pageStack.getBoundingClientRect().width,
        stackHeight: pageStack.getBoundingClientRect().height
      };
      console.info("[A4Layout][view]", info);
    } catch {
      // ignore
    }
  };

  const applyGridMode = () => {
    const targetGrid = getTargetGridMode();
    gridMode = targetGrid;
    pageStack.dataset.gridMode = gridMode;
    overlayLayer.dataset.gridMode = gridMode;
    if (viewMode === "single") {
      pageStack.classList.remove("is-two-page");
      overlayLayer.classList.remove("is-two-page");
      pageStack.style.display = "flex";
      pageStack.style.flexDirection = "column";
      pageStack.style.flexWrap = "nowrap";
      if (gridMode !== "stack") {
        gridMode = "stack";
        pageStack.dataset.gridMode = gridMode;
        overlayLayer.dataset.gridMode = gridMode;
      }
    }
    logPageStackState("applyGridMode");
  };

  const syncOverlayBounds = () => {
    // Keep overlay pages aligned with the page stack to prevent drifting page numbers.
    const left = pageStack.offsetLeft;
    const top = pageStack.offsetTop;
    overlayLayer.style.left = `${left}px`;
    overlayLayer.style.top = `${top}px`;
    overlayLayer.style.width = `${pageStack.offsetWidth}px`;
    overlayLayer.style.height = `${pageStack.offsetHeight}px`;
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

      // Footnotes (handled by sub-editors; no contenteditable caret tracking here).

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
          caretState.body.last = {
            bookmark: caretState.body.bookmark,
            from: caretState.body.from,
            to: caretState.body.to
          };
          caretState.body.bookmark = view.state.selection.getBookmark();
          caretState.body.from = (view.state.selection as any)?.from ?? caretState.body.from;
          caretState.body.to = (view.state.selection as any)?.to ?? caretState.body.to;
          const sel = view.state.selection as any;
          const isRange =
            typeof sel?.from === "number" &&
            typeof sel?.to === "number" &&
            sel.from !== sel.to;
          const now = Date.now();
          const recentPointer =
            pointerDownActive || now - lastPointerDownAt < 350 || now - lastPointerUpAt < 350;
          if (isRange && recentPointer) {
            markRangeSelection(450);
          }
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
      caretState.body.last = {
        bookmark: caretState.body.bookmark,
        from: caretState.body.from,
        to: caretState.body.to
      };
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

  const restoreLastBodySelection = (source: string): boolean => {
    if (!attachedEditorHandle) return false;
    const last = caretState.body.last;
    if (!last) return false;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return false;
    try {
      const bookmark = last.bookmark as any;
      const resolved = bookmark?.resolve?.(view.state.doc);
      if (resolved) {
        const sel: any = resolved as any;
        const $from = view.state.doc.resolve(Math.max(0, Math.min(view.state.doc.content.size, sel.from ?? 0)));
        const safe = $from.parent.inlineContent ? resolved : Selection.near($from, 1);
        view.dispatch(view.state.tr.setSelection(safe).scrollIntoView());
      } else {
        const docSize = view.state.doc.content.size;
        const clamp = (pos: number) => Math.min(Math.max(0, pos), docSize);
        const from = clamp(last.from);
        const to = clamp(last.to);
        try {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)).scrollIntoView());
        } catch {
          const $from = view.state.doc.resolve(from);
          view.dispatch(view.state.tr.setSelection(Selection.near($from, 1)).scrollIntoView());
        }
      }
      view.focus();
      if ((window as any).__leditorCaretDebug) {
        console.info("[Body][selection] restored last", {
          source,
          from: last.from,
          to: last.to
        });
      }
      return true;
    } catch (error) {
      console.warn("[Body][selection] restore last failed", { source, error });
      focusBody();
      return false;
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
    const handleFallback = attachedEditorHandle ?? ((window as any).leditor ?? null);
    const editorInstance = handleFallback?.getEditor?.() ?? null;
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
	  let suppressBodyFocusUntil = 0;
	  let footnoteTypingPaginationTimer: number | null = null;
	  let lastFootnoteInputAt = 0;
	  let pendingFootnoteRefocusId: string | null = null;
  // Only repaginate from footnote-height changes when the user actually edited footnote text
  // (or just inserted a footnote). This prevents pagination/focus oscillation loops caused by
  // 1px layout jitter while the footnote editor is focused.
  let footnotePaginationArmed = false;
  const FOOTNOTE_PAGINATION_IDLE_MS = 520;
  const suppressFootnotePagination = (durationMs = FOOTNOTE_PAGINATION_IDLE_MS) => {
    try {
      (window as any).__leditorDisablePaginationUntil = performance.now() + durationMs;
    } catch {
      // ignore
    }
  };
  const resumeFootnotePaginationSoon = () => {
    if (footnoteTypingPaginationTimer != null) {
      window.clearTimeout(footnoteTypingPaginationTimer);
    }
    footnoteTypingPaginationTimer = window.setTimeout(() => {
      footnoteTypingPaginationTimer = null;
      try {
        (window as any).__leditorDisablePaginationUntil = 0;
      } catch {
        // ignore
      }
      if (footnoteMode) {
        footnotePaginationArmed = true;
        requestEditorPagination();
        requestPagination();
      }
    }, FOOTNOTE_PAGINATION_IDLE_MS);
  };

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
          suppressFootnotePagination();
          resumeFootnotePaginationSoon();
	    }
    if (activeNoteEditor && activeNoteEditor.kind === "endnote") {
      destroyActiveNoteEditor();
    }
    activeEndnoteId = null;
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
      // Cancel any in-flight async focus retry so it doesn't re-enter footnote mode after exit.
      footnoteFocusRetryToken += 1;
      pendingFootnoteSourceSelection.clear();
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
        (window as any).__leditorDisablePaginationUntil = 0;
      } catch {
        // ignore
      }
      activeFootnoteId = null;
      if (activeNoteEditor && activeNoteEditor.kind === "footnote") {
        destroyActiveNoteEditor();
      }
      caretState.active = "body";
      setModeClass("leditor-footnote-editing", false);
      setEditorEditable(true);
      suppressBodyFocusUntil = Date.now() + 250;
    }

    if (coords && attachedEditorHandle) {
      const view = attachedEditorHandle.getEditor()?.view;
      try {
        const pos = view ? getCoordsPosFromPoint(view, coords.x, coords.y, lastPageContentEl) : null;
        if (pos != null) {
          setCaretAtPos(view, pos);
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

  const renderEndnotes = (entries: FootnoteRenderEntry[], serializer: DOMSerializer | null) => {
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
      const text = document.createElement("div");
      text.className = "leditor-endnote-entry-text";
      text.dataset.footnoteId = entry.footnoteId;
      const value = (entry.text || "").trim();
      text.dataset.placeholder = "Type endnote…";
      text.contentEditable = "false";
      text.setAttribute("role", "textbox");
      text.setAttribute("spellcheck", "false");
      if (serializer && entry.body && entry.body.content.size > 0) {
        text.appendChild(serializer.serializeFragment(entry.body.content));
      } else if (value) {
        text.textContent = value;
      }
      item.appendChild(number);
      item.appendChild(text);
      list.appendChild(item);
    });
    endnotesList.appendChild(list);
  };

  const collectFootnoteEntries = () => {
    // Single source of truth: derive footnotes from the ProseMirror document, not from
    // `.leditor-footnote` DOM markers (which can be missing during pagination churn).
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const doc = editorInstance?.state?.doc ?? null;
    const entries: FootnoteRenderEntry[] = [];
    const numbering = doc ? reconcileFootnotes(doc).numbering : new Map<string, string>();

    const footnoteType = editorInstance?.state?.schema?.nodes?.footnote ?? null;
    const footnoteBodyType = editorInstance?.state?.schema?.nodes?.footnoteBody ?? null;
    const pageType = editorInstance?.state?.schema?.nodes?.page ?? null;
    if (!doc || !footnoteType) return entries;
    const bodyTextById = new Map<string, string>();
    const bodyNodeById = new Map<string, ProseMirrorNode>();
    if (footnoteBodyType) {
      doc.descendants((node) => {
        if (node.type !== footnoteBodyType) return true;
        const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
        if (!id || bodyTextById.has(id)) return true;
        bodyTextById.set(id, getFootnoteBodyPlainText(node));
        bodyNodeById.set(id, node);
        return true;
      });
    }

    const resolveFootnoteText = (id: string, attrText: string, bodyText: string): string => {
      return bodyText.trim().length > 0 ? bodyText : attrText;
    };

    const pushEntry = (
      id: string,
      kind: FootnoteKind,
      source: "manual" | "citation",
      pageIndex: number,
      text: string,
      body: ProseMirrorNode | null
    ) => {
      const mapped = numbering.get(id);
      const numberLabel = mapped ? String(mapped) : "";
      entries.push({
        footnoteId: id,
        number: numberLabel || "1",
        text,
        kind,
        source,
        pageIndex,
        body
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
          const attrText = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
          const bodyText = bodyTextById.get(id) ?? "";
          const bodyNode = bodyNodeById.get(id) ?? null;
          const text = resolveFootnoteText(id, attrText, bodyText);
          pushEntry(id, kind, source, kind === "endnote" ? 0 : pageIndex, text, bodyNode);
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
      const attrText = typeof (node.attrs as any)?.text === "string" ? String((node.attrs as any).text) : "";
      const bodyText = bodyTextById.get(id) ?? "";
      const bodyNode = bodyNodeById.get(id) ?? null;
      const text = resolveFootnoteText(id, attrText, bodyText);
      pushEntry(id, kind, source, kind === "endnote" ? 0 : Math.max(0, currentPageIndex - 1), text, bodyNode);
      return true;
    });
    return entries;
  };

	  const buildFootnotePageStates = (): PageFootnoteState[] => {
	    const pages = getPageStackPages();
	    return pages
	      .map((page, index): PageFootnoteState | null => {
	        const inner = page.querySelector<HTMLElement>(".leditor-page-inner") ?? page;
	        const container = inner.querySelector<HTMLElement>(".leditor-page-footnotes");
	        let continuation = inner.querySelector<HTMLElement>(".leditor-footnote-continuation");
	        const content = inner.querySelector<HTMLElement>(".leditor-page-content");
	        if (container && !continuation) {
	          continuation = document.createElement("div");
	          continuation.className = "leditor-footnote-continuation";
	          continuation.setAttribute("aria-hidden", "true");
	          continuation.contentEditable = "false";
	          container.insertAdjacentElement("beforebegin", continuation);
	        }
	        if (!container || !continuation) return null;
	        return {
	          pageIndex: Number(page.dataset.pageIndex ?? String(index)),
	          pageElement: page,
	          contentElement: content ?? null,
	          footnoteContainer: container,
	          continuationContainer: continuation
	        };
	      })
	      .filter((state): state is PageFootnoteState => state != null);
	  };

  let lastFootnoteRenderSignature = "";
  let lastFootnoteRenderPageCount = -1;

  const renderFootnoteSections = () => {
    const entries = collectFootnoteEntries();
    // Skip expensive re-renders when nothing relevant changed. This is critical to avoid
    // caret-loss/flicker loops while typing (especially in the footnote editor).
    {
      const pageStackCount = getPageStackPages().length;
      const needsFootnoteRows = entries.some((entry) => entry.kind === "footnote");
      const hasFootnoteRows = pageStack.querySelectorAll(".leditor-footnote-entry").length > 0;
      const signature = [
        `pages:${pageCount}`,
        `stack:${pageStackCount}`,
        ...entries
        .map((entry) => {
          const trimmed = (entry.text || "").trim();
          const bodySize = entry.body?.content?.size ?? 0;
          const head = trimmed.slice(0, 80);
          const tail = trimmed.slice(Math.max(0, trimmed.length - 80));
          const textSig = `${trimmed.length}:${head}:${tail}`;
          return `${entry.kind}:${entry.footnoteId}:${entry.number}:${entry.pageIndex}:${entry.source}:${bodySize}:${textSig}`;
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
        !footnotePaginationArmed &&
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
      if (activeEndnoteId && !liveIds.has(activeEndnoteId)) {
        activeEndnoteId = null;
        if (activeNoteEditor && activeNoteEditor.kind === "endnote") {
          destroyActiveNoteEditor();
        }
      }
    }
    const pageStates = buildFootnotePageStates();
    const footnoteEntries = entries.filter((entry) => entry.kind === "footnote");
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const schema = editorInstance?.state?.schema ?? null;
    let serializer: DOMSerializer | null = null;
    if (schema) {
      try {
        serializer = DOMSerializer.fromSchema(schema);
      } catch {
        serializer = null;
      }
    }
    try {
      if (schema) {
        paginateWithFootnotes({
          entries: footnoteEntries,
          pageStates,
          schema,
          activeFootnoteId: footnoteMode ? activeFootnoteId : null
        });
      }
    } catch (error) {
      console.warn("[Footnote] paginateWithFootnotes failed", {
        error,
        pageStateCount: pageStates.length,
        entryCount: entries.length
      });
    }
    // Fallback: if we have footnote markers but pagination didn't render any entry rows, render them
    // directly into the first matching page's footnote container so the user can type.
    if (footnoteEntries.length > 0 && pageStack.querySelectorAll(".leditor-footnote-entry").length === 0) {
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
          const text = document.createElement("div");
          text.className = "leditor-footnote-entry-text";
          text.dataset.footnoteId = entry.footnoteId;
          text.dataset.footnoteFragment = "primary";
          text.dataset.placeholder = "Type footnote…";
          text.contentEditable = "false";
          text.tabIndex = entry.source === "citation" ? -1 : 0;
          text.setAttribute("aria-readonly", "true");
          text.setAttribute("role", "textbox");
          text.setAttribute("spellcheck", entry.source === "citation" ? "false" : "true");
          if (serializer && entry.body && entry.body.content.size > 0) {
            text.appendChild(serializer.serializeFragment(entry.body.content));
          } else {
            text.textContent = (entry.text || "").trim();
          }
          row.appendChild(number);
          row.appendChild(text);
          hostList.appendChild(row);
        });
        container.appendChild(hostList);
      };

      const first = footnoteEntries[0];
      const preferred = pageStates.find((state) => state.pageIndex === first.pageIndex) ?? pageStates[0] ?? null;
      if (preferred?.footnoteContainer) {
        const preferredEntries = footnoteEntries.filter((e) => e.pageIndex === preferred.pageIndex);
        const entriesToRender = preferredEntries.length > 0 ? preferredEntries : footnoteEntries;
        renderFallback(preferred.footnoteContainer, entriesToRender);
        if ((window as any).__leditorFootnoteDebug) {
          console.info("[Footnote] fallback renderer used", {
            pageIndex: preferred.pageIndex,
            count: entriesToRender.length
          });
        }
      } else {
        console.warn("[Footnote] fallback renderer unable to find footnote container", {
          pageStateCount: pageStates.length,
          entryCount: footnoteEntries.length
        });
      }
    }
    renderEndnotes(entries.filter((entry) => entry.kind === "endnote"), serializer);
    syncActiveFootnoteEditor(entries);
    syncActiveEndnoteEditor(entries);

    scheduleFootnoteHeightMeasurement(true);
  };

  const footnoteHandle = attachedEditorHandle ?? ((window as any).leditor ?? null);
  if (footnoteHandle && !(footnoteHandle as any).refreshFootnotes) {
    (footnoteHandle as any).refreshFootnotes = () => {
      renderFootnoteSections();
      return collectFootnoteEntries();
    };
  }

  const focusFootnoteEntry = (footnoteId: string, behavior: "preserve" | "end" = "end"): boolean => {
    const id = (footnoteId ?? "").trim();
    if (!id) return false;

    // If we're already focused in this exact footnote editor, don't re-run scroll/focus/caret logic.
    // Repeated calls here were a primary source of "blinking" caret and ribbon flicker.
    if (footnoteMode && activeFootnoteId === id) {
      if (activeNoteEditor && activeNoteEditor.footnoteId === id && activeNoteEditor.kind === "footnote") {
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
    const activeHost =
      activeEl?.closest?.(
        `.leditor-footnote-entry-text[data-footnote-id="${id}"]`
      ) ?? null;
    if (
      focusNow - lastFocusAt < 200 &&
      activeHost &&
      (activeHost.getAttribute("data-footnote-id") || "").trim() === id
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
    let isCitation = false;
    if (doc && footnoteType) {
      if (pageType && doc.childCount > 0 && Array.from({ length: doc.childCount }).every((_, i) => doc.child(i).type === pageType)) {
        outer: for (let i = 0; i < doc.childCount; i += 1) {
          const page = doc.child(i);
          let found = false;
          page.descendants((node) => {
            if (node.type !== footnoteType) return true;
            const nodeId = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
            if (nodeId !== id) return true;
            const citationId =
              typeof (node.attrs as any)?.citationId === "string" ? String((node.attrs as any).citationId).trim() : "";
            isCitation = Boolean(citationId);
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
          const citationId =
            typeof (node.attrs as any)?.citationId === "string" ? String((node.attrs as any).citationId).trim() : "";
          isCitation = Boolean(citationId);
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
    const allowEdit = !isCitation;
    // Only enter/re-enter footnote mode when needed. Repeated calls can cause focus suppression
    // to continuously reset, presenting as flicker/caret loss.
    if (allowEdit && (!footnoteMode || activeFootnoteId !== id)) {
      enterFootnoteMode(id, sourceSelection);
    } else if (!allowEdit && footnoteMode) {
      exitFootnoteMode({ restore: false });
    }

    const pages = getPageStackPages();
    const maxPageIndex = Math.max(0, pages.length - 1);
    const clampedPageIndex = clamp(pageIndex, 0, maxPageIndex);
    const page =
      pageStack.querySelector<HTMLElement>(`.leditor-page[data-page-index="${clampedPageIndex}"]`) ??
      pages[clampedPageIndex] ??
      null;
    const container = page?.querySelector<HTMLElement>(".leditor-page-footnotes") ?? null;

    const locateTextEl = (): HTMLElement | null => {
      const selectorPrimary = `.leditor-footnote-entry-text[data-footnote-id="${id}"][data-footnote-fragment="primary"]`;
      if (page) {
        const within = page.querySelector<HTMLElement>(selectorPrimary);
        if (within) return within;
        const fallback = page.querySelector<HTMLElement>(`.leditor-footnote-entry-text[data-footnote-id="${id}"]`);
        if (fallback) return fallback;
      }
      return (
        pageStack.querySelector<HTMLElement>(selectorPrimary) ??
        pageStack.querySelector<HTMLElement>(`.leditor-footnote-entry-text[data-footnote-id="${id}"]`)
      );
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

    if (!allowEdit) {
      return true;
    }

    if (!editorInstance) {
      return true;
    }
    const footnoteBodyType = editorInstance.state?.schema?.nodes?.footnoteBody ?? null;
    const bodyNode = footnoteBodyType
      ? findFootnoteBodyNodeById(editorInstance.state.doc, id, footnoteBodyType)?.node ?? null
      : null;
    const noteEditor = ensureNoteEditor(id, "footnote", textEl, bodyNode);
    try {
      noteEditor?.view.focus();
    } catch {
      // ignore
    }
    return true;
  };

  const handleFootnoteEntryClick = (event: MouseEvent) => {
    const targetEl = event.target as HTMLElement | null;
    const target = targetEl?.closest<HTMLElement>(".leditor-footnote-entry");
    if (!target) return;
    const footnoteId = target.dataset.footnoteId;
    if (!footnoteId) return;
    event.preventDefault();
    event.stopPropagation();
    focusFootnoteEntry(footnoteId, "preserve");
  };

  type NoteEditor = {
    footnoteId: string;
    kind: FootnoteKind;
    view: EditorView;
    host: HTMLElement;
    body: ProseMirrorNode | null;
  };

  let activeNoteEditor: NoteEditor | null = null;
  let activeEndnoteId: string | null = null;

  const findFootnoteBodyNodeById = (
    doc: ProseMirrorNode,
    footnoteId: string,
    footnoteBodyType: any
  ): { pos: number; node: ProseMirrorNode } | null => {
    let found: { pos: number; node: ProseMirrorNode } | null = null;
    doc.descendants((node, pos) => {
      if (node.type !== footnoteBodyType) return true;
      const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
      if (id === footnoteId) {
        found = { pos, node };
        return false;
      }
      return true;
    });
    return found;
  };

  const isEditorDocEmpty = (doc: ProseMirrorNode): boolean => {
    if (doc.textContent.trim().length > 0) return false;
    let hasNonText = false;
    doc.descendants((node) => {
      if (node.isText) return true;
      if (node.isLeaf) {
        hasNonText = true;
        return false;
      }
      return true;
    });
    return !hasNonText;
  };

  const buildNoteEditorState = (
    schema: any,
    bodyNode: ProseMirrorNode | null,
    footnoteId: string,
    kind: FootnoteKind
  ): EditorState => {
    const doc = schema.topNodeType.create(null, bodyNode?.content ?? PMFragment.empty);
    const handleDelete = (_state: EditorState): boolean => {
      if (!isEditorDocEmpty(_state.doc)) return false;
      const removed = deleteFootnoteNodeById(footnoteId);
      if (removed) {
        if (kind === "footnote") {
          exitFootnoteMode({ restore: true });
        }
        scheduleFootnoteUpdate();
      }
      return removed;
    };
    const deleteKeymap = keymap({
      Backspace: (state) => handleDelete(state),
      Delete: (state) => handleDelete(state)
    });
    return EditorState.create({
      schema,
      doc,
      plugins: [history(), deleteKeymap, keymap(baseKeymap)]
    });
  };

  const syncMainDocFromNoteEditor = (footnoteId: string, nextState: EditorState) => {
    if (!attachedEditorHandle) return;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return;
    const footnoteBodyType = view.state.schema.nodes.footnoteBody;
    if (!footnoteBodyType) return;
    const found = findFootnoteBodyNodeById(view.state.doc, footnoteId, footnoteBodyType);
    if (!found) return;
    const prevSelection = view.state.selection;
    let tr = view.state.tr.replaceWith(
      found.pos + 1,
      found.pos + found.node.nodeSize - 1,
      nextState.doc.content
    );
    try {
      const mapped = prevSelection.map(tr.doc, tr.mapping);
      tr = tr.setSelection(mapped);
    } catch {
      // ignore
    }
    tr = tr.setMeta("addToHistory", true);
    tr = tr.setMeta("footnoteSubdoc", footnoteId);
    view.dispatch(tr);
    footnotePaginationArmed = true;
    lastFootnoteInputAt = Date.now();
    suppressFootnotePagination();
    resumeFootnotePaginationSoon();
    scheduleFootnoteHeightMeasurement();
    scheduleFootnoteUpdate();
  };

  const destroyActiveNoteEditor = (opts?: { keepHostContent?: boolean }) => {
    if (!activeNoteEditor) return;
    try {
      activeNoteEditor.view.destroy();
    } catch {
      // ignore
    }
    if (activeNoteEditor.host) {
      activeNoteEditor.host.dataset.leditorEditor = "false";
      if (!opts?.keepHostContent) {
        activeNoteEditor.host.replaceChildren();
      }
    }
    activeNoteEditor = null;
  };

  const ensureNoteEditor = (
    footnoteId: string,
    kind: FootnoteKind,
    host: HTMLElement | null,
    bodyNode: ProseMirrorNode | null
  ): NoteEditor | null => {
    if (!attachedEditorHandle) return null;
    const editorInstance = attachedEditorHandle.getEditor();
    const schema = editorInstance?.state?.schema;
    if (!schema || !host) return null;
    if (activeNoteEditor && activeNoteEditor.footnoteId !== footnoteId) {
      destroyActiveNoteEditor();
    }
    if (activeNoteEditor && activeNoteEditor.footnoteId === footnoteId) {
      if (activeNoteEditor.host !== host) {
        destroyActiveNoteEditor();
      } else {
        const sameBody =
          (!bodyNode && !activeNoteEditor.body) ||
          (bodyNode && activeNoteEditor.body && activeNoteEditor.body.eq(bodyNode));
        if (sameBody) {
          return activeNoteEditor;
        }
      }
    }
    if (activeNoteEditor && activeNoteEditor.footnoteId === footnoteId && activeNoteEditor.host === host) {
      const nextState = buildNoteEditorState(schema, bodyNode, footnoteId, kind);
      activeNoteEditor.view.updateState(nextState);
      activeNoteEditor.body = bodyNode;
      return activeNoteEditor;
    }
    host.replaceChildren();
    host.dataset.leditorEditor = "true";
    const state = buildNoteEditorState(schema, bodyNode, footnoteId, kind);
    const view = new EditorView(host, {
      state,
      dispatchTransaction: (tr) => {
        const next = view.state.apply(tr);
        view.updateState(next);
        syncMainDocFromNoteEditor(footnoteId, next);
      }
    });
    view.dom.classList.add("leditor-footnote-editor");
    view.dom.addEventListener("focusin", () => {
      suppressFootnotePagination();
      resumeFootnotePaginationSoon();
    });
    view.dom.addEventListener("keydown", () => {
      suppressFootnotePagination();
      resumeFootnotePaginationSoon();
    });
    view.dom.addEventListener("focusout", () => {
      resumeFootnotePaginationSoon();
    });
    activeNoteEditor = { footnoteId, kind, view, host, body: bodyNode };
    return activeNoteEditor;
  };

  const syncActiveFootnoteEditor = (entries: FootnoteRenderEntry[]) => {
    if (!footnoteMode || !activeFootnoteId) {
      if (activeNoteEditor && activeNoteEditor.kind === "footnote") {
        destroyActiveNoteEditor();
      }
      return;
    }
    const entry = entries.find(
      (item) => item.kind === "footnote" && item.footnoteId === activeFootnoteId
    );
    if (!entry || entry.source === "citation") {
      if (activeNoteEditor && activeNoteEditor.kind === "footnote") {
        destroyActiveNoteEditor();
      }
      return;
    }
    const host =
      pageStack.querySelector<HTMLElement>(
        `.leditor-footnote-entry-text[data-footnote-id="${activeFootnoteId}"][data-footnote-fragment="primary"]`
      ) ??
      pageStack.querySelector<HTMLElement>(
        `.leditor-footnote-entry-text[data-footnote-id="${activeFootnoteId}"]`
      ) ??
      null;
    if (!host) {
      if (activeNoteEditor && activeNoteEditor.kind === "footnote") {
        destroyActiveNoteEditor();
      }
      return;
    }
    ensureNoteEditor(activeFootnoteId, "footnote", host, entry.body);
  };

  const syncActiveEndnoteEditor = (entries: FootnoteRenderEntry[]) => {
    if (!activeEndnoteId) {
      if (activeNoteEditor && activeNoteEditor.kind === "endnote") {
        destroyActiveNoteEditor();
      }
      return;
    }
    const entry = entries.find(
      (item) => item.kind === "endnote" && item.footnoteId === activeEndnoteId
    );
    if (!entry || entry.source === "citation") {
      if (activeNoteEditor && activeNoteEditor.kind === "endnote") {
        destroyActiveNoteEditor();
      }
      return;
    }
    const host =
      endnotesPanel.querySelector<HTMLElement>(
        `.leditor-endnote-entry-text[data-footnote-id="${activeEndnoteId}"]`
      ) ?? null;
    if (!host) {
      if (activeNoteEditor && activeNoteEditor.kind === "endnote") {
        destroyActiveNoteEditor();
      }
      return;
    }
    ensureNoteEditor(activeEndnoteId, "endnote", host, entry.body);
  };

  const deleteFootnoteNodeById = (footnoteId: string): boolean => {
    if (!attachedEditorHandle) return false;
    const editorInstance = attachedEditorHandle.getEditor();
    const view = editorInstance?.view;
    if (!view) return false;
    const footnoteType = view.state.schema.nodes.footnote;
    const footnoteBodyType = view.state.schema.nodes.footnoteBody;
    if (!footnoteType) return false;
    const positions: number[] = [];
    view.state.doc.descendants((node, pos) => {
      if (node.type === footnoteType && String((node.attrs as any)?.footnoteId ?? "") === footnoteId) {
        positions.push(pos);
      }
      if (footnoteBodyType && node.type === footnoteBodyType && String((node.attrs as any)?.footnoteId ?? "") === footnoteId) {
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
    if (activeNoteEditor && activeNoteEditor.footnoteId === footnoteId) return;
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    if (!editorInstance) return;
    const schema = editorInstance.state?.schema ?? null;
    const footnoteBodyType = schema?.nodes?.footnoteBody ?? null;
    if (!schema || !footnoteBodyType) return;
    const found = findFootnoteBodyNodeById(editorInstance.state.doc, footnoteId, footnoteBodyType);
    if (!found) return;
    const tempDoc = schema.topNodeType.create(null, found.node.content);
    if (!isEditorDocEmpty(tempDoc)) return;
    // When the footnote text is empty, Backspace/Delete removes the footnote marker in the document
    // (Word-like behavior). This prevents "ghost footnotes" from reappearing later.
    event.preventDefault();
    event.stopPropagation();
    const removed = deleteFootnoteNodeById(footnoteId);
    if (removed) {
      // Exit footnote mode back to the stored body selection.
      exitFootnoteMode({ restore: true });
      scheduleFootnoteUpdate();
    }
  };

  const focusEndnoteEntry = (footnoteId: string) => {
    if (footnoteMode) {
      exitFootnoteMode({ restore: false });
    }
    const entry = appRoot.querySelector<HTMLElement>(
      `.leditor-endnote-entry[data-footnote-id="${footnoteId}"]`
    );
    if (!entry) return;
    entry.scrollIntoView({ block: "center", behavior: "auto" });
    const text = entry.querySelector<HTMLElement>(".leditor-endnote-entry-text");
    const source = (entry.dataset.footnoteSource || "").trim();
    if (!text || source === "citation") return;
    activeEndnoteId = footnoteId;
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    if (!editorInstance) return;
    const footnoteBodyType = editorInstance.state?.schema?.nodes?.footnoteBody ?? null;
    const bodyNode = footnoteBodyType
      ? findFootnoteBodyNodeById(editorInstance.state.doc, footnoteId, footnoteBodyType)?.node ?? null
      : null;
    const noteEditor = ensureNoteEditor(footnoteId, "endnote", text, bodyNode);
    try {
      noteEditor?.view.focus();
    } catch {
      // ignore
    }
  };

  const handleEndnoteEntryClick = (event: MouseEvent) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(".leditor-endnote-entry");
    if (!target) return;
    const footnoteId = target.dataset.footnoteId;
    if (!footnoteId) return;
    event.preventDefault();
    event.stopPropagation();
    focusEndnoteEntry(footnoteId);
  };

  let footnoteHeightHandle = 0;
  const footnoteHeightCache = new Map<number, number>();
  const footnoteStackHeightHistory: number[] = [];
  let footnotePaginationCooldownUntil = 0;
  let footnotePaginationSignature = "";
  let footnotePaginationAttempts = 0;
  let footnotePaginationWindowStart = 0;
  let footnotePaginationLockedSignature = "";
  let lastFootnotePaginationDocSignature = "";
  const footnoteLayoutVarsByPage = new Map<
    number,
    { height: number; effectiveBottom: number; gap: number; guard: number }
  >();
  // Rounded pixel values can still jitter by 1px across layout passes (scrollbar toggles, font hinting).
  // Use the smallest delta so a new footnote line always triggers a repagination.
  const FOOTNOTE_HEIGHT_DIRTY_THRESHOLD = 1;
  const FOOTNOTE_PAGINATION_STACK_EPSILON = 0.5;
  const FOOTNOTE_PAGINATION_COOLDOWN_MS = 1400;
  const FOOTNOTE_PAGINATION_ATTEMPT_WINDOW_MS = 2000;
  const FOOTNOTE_PAGINATION_ATTEMPT_LIMIT = 2;
  const FOOTNOTE_BODY_GAP_FALLBACK_PX = 12;
  const getFootnoteGapPx = (target?: HTMLElement | null): number => {
    const el = target ?? document.documentElement;
    const raw = getComputedStyle(el).getPropertyValue("--page-footnote-gap").trim();
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) return parsed;
    return FOOTNOTE_BODY_GAP_FALLBACK_PX;
  };
  const FOOTNOTE_GUARD_FALLBACK_PX = 4;
  const getFootnoteGuardPx = (contentEl?: HTMLElement | null, target?: HTMLElement | null): number => {
    const el = target ?? document.documentElement;
    const raw = getComputedStyle(el).getPropertyValue("--page-footnote-guard").trim();
    const parsed = Number.parseFloat(raw);
    let base = Number.isFinite(parsed) ? parsed : FOOTNOTE_GUARD_FALLBACK_PX;
    if (contentEl) {
      const rawLineHeight = getComputedStyle(contentEl).lineHeight.trim();
      const lh = Number.parseFloat(rawLineHeight);
      if (Number.isFinite(lh) && lh > 0) {
        base = Math.max(base, Math.round(lh * 0.25));
      }
    }
    return base;
  };
  let lastFootnoteDebugLogAt = 0;
  const isFootnoteLayoutDebug = () => Boolean((window as any).__leditorFootnoteLayoutDebug);
  const isPaginationDebugVerbose = () =>
    Boolean((window as any).__leditorPaginationDebugVerbose);
  const syncFootnoteDebugClass = () => {
    appRoot.classList.toggle("leditor-debug-footnotes", isFootnoteLayoutDebug());
  };
  const setFootnoteLayoutVars = (
    target: HTMLElement | null,
    heightPx: number,
    effectiveBottomPx: number,
    gapPx: number,
    guardPx: number
  ) => {
    if (!target) return;
    target.style.setProperty("--page-footnote-gap", `${gapPx}px`);
    target.style.setProperty("--page-footnote-guard", `${Math.max(0, Math.round(guardPx))}px`);
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
      if ((window as any).__leditorDisablePaginationUntil) return;
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
      setFootnoteLayoutVars(page, entry.height, entry.effectiveBottom, entry.gap, entry.guard);
      const pageContent =
        pageContents[pageIndex] ??
        pageContents[index] ??
        editorEl.querySelector<HTMLElement>(`.leditor-page[data-page-index="${pageIndex}"] .leditor-page-content`) ??
        null;
      setFootnoteLayoutVars(pageContent, entry.height, entry.effectiveBottom, entry.gap, entry.guard);
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
      const pageStackPages = getPageStackPages();
      const footnoteContainers = pageStackPages
        .map((page) => page.querySelector<HTMLElement>(".leditor-page-footnotes"))
        .filter((container): container is HTMLElement => container != null);
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
        if (pageIndex < 0 || pageIndex >= pageStackPages.length) {
          footnoteHeightCache.delete(pageIndex);
        }
      }
      syncFootnoteDebugClass();
      const debugEnabled = isFootnoteLayoutDebug();

      let layoutChanged = false;
      footnoteContainers.forEach((container, containerIndex) => {
        const host = container.closest<HTMLElement>(".leditor-page");
        const rawIndex = (host?.dataset.pageIndex ?? "").trim();
        const parsedIndex = rawIndex.length > 0 ? Number(rawIndex) : Number.NaN;
        const pageIndex = Number.isFinite(parsedIndex) ? parsedIndex : containerIndex;
        const pageStackPage = pageIndex >= 0 ? (pageStackPages[pageIndex] ?? null) : null;
        const pageContent =
          pageStackPage?.querySelector<HTMLElement>(".leditor-page-content") ??
          pageContents[pageIndex] ??
          pageContents[containerIndex] ??
          editorEl.querySelector<HTMLElement>(`.leditor-page[data-page-index="${pageIndex}"] .leditor-page-content`) ??
          null;
        const hasEntries = container.querySelector(".leditor-footnote-entry") != null;
        const gapPxRaw = getFootnoteGapPx(host ?? pageStackPage ?? document.documentElement);
        const guardPxRaw = getFootnoteGuardPx(pageContent, host ?? pageStackPage ?? document.documentElement);
        const containerStyle = getComputedStyle(container);
        const paddingTopPx = Number.parseFloat(containerStyle.paddingTop || "0") || 0;
        const borderTopPx = Number.parseFloat(containerStyle.borderTopWidth || "0") || 0;
        const borderBottomPx = Number.parseFloat(containerStyle.borderBottomWidth || "0") || 0;
        const chromePx = Math.max(0, paddingTopPx + borderTopPx + borderBottomPx);
        if (!hasEntries) {
          // Always keep the footnote area visible so the user can see the reserved space and
          // placeholders even before any note exists. Fall back to the document-level
          // --footnote-area-height token when available; otherwise keep a small guard height.
          const defaultAreaRaw = rootTokens.getPropertyValue("--footnote-area-height").trim();
          const defaultAreaPx = Number.parseFloat(defaultAreaRaw || "0") || 0;
          const baseReservePx = defaultAreaPx > 0 ? defaultAreaPx : Math.max(18, Math.round(footerReservePx * 0.35));
          const reservePx = footnoteMode ? (baseReservePx < 18 ? Math.max(18, Math.round(footerReservePx * 0.35)) : baseReservePx) : 0;
          const gapPx = reservePx > 0 ? gapPxRaw : 0;
          const guardPx = reservePx > 0 ? guardPxRaw : 0;
          const effectiveBottomPx = Math.max(0, footerReservePx + reservePx + gapPx + guardPx);
          if (pageIndex >= 0) {
            if (reservePx > 0) {
              footnoteLayoutVarsByPage.set(pageIndex, {
                height: reservePx,
                effectiveBottom: effectiveBottomPx,
                gap: gapPx,
                guard: guardPx
              });
            } else {
              footnoteLayoutVarsByPage.delete(pageIndex);
            }
          }
          if (reservePx > 0) {
            container.classList.add("leditor-page-footnotes--active");
            container.setAttribute("aria-hidden", "false");
            if (!container.dataset.leditorPlaceholder) {
              container.dataset.leditorPlaceholder = "Footnotes";
            }
            container.style.minHeight = container.style.minHeight || "var(--footnote-area-height)";
            container.style.height = `${reservePx}px`;
          } else {
            container.classList.remove("leditor-page-footnotes--active");
            container.setAttribute("aria-hidden", "true");
            container.style.minHeight = "";
            container.style.height = "0px";
          }
          container.style.overflowY = "hidden";
          container.style.setProperty("--page-footnote-height", `${reservePx}px`);
          setFootnoteLayoutVars(host, reservePx, effectiveBottomPx, gapPx, guardPx);
          if (pageIndex >= 0) {
            setFootnoteLayoutVars(pageStackPage, reservePx, effectiveBottomPx, gapPx, guardPx);
            setFootnoteLayoutVars(pageContent, reservePx, effectiveBottomPx, gapPx, guardPx);
            const prevHeight = footnoteHeightCache.get(pageIndex);
            const appliedHeight = reservePx;
          if (prevHeight === undefined || Math.abs(appliedHeight - prevHeight) >= FOOTNOTE_HEIGHT_DIRTY_THRESHOLD) {
            footnoteHeightCache.set(pageIndex, appliedHeight);
            earliestDirtyPage = earliestDirtyPage === null ? pageIndex : Math.min(earliestDirtyPage, pageIndex);
            layoutChanged = true;
            if (reservePx > 0) flashFootnoteReflow(pageIndex);
          }
            updateFootnoteDebugData(container, { appliedHeight, overlap: false });
          }
          return;
        }
        const gapPx = gapPxRaw;
        // Measure only the actual list content to avoid including container padding/margins that make
        // the box jump on every character.
        const listEl = container.querySelector<HTMLElement>(".leditor-footnote-list");
        const measuredHeight = hasEntries
          ? Math.max(0, Math.round((listEl ?? container).scrollHeight + chromePx))
          : 0;
        const maxRatioRaw = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue("--footnote-max-height-ratio").trim() || "1"
        );
        const maxRatio = Math.min(0.9, Math.max(0, Number.isFinite(maxRatioRaw) ? maxRatioRaw : 1));
        const hardCapPx = Math.max(0, Math.round(pageHeightPx * maxRatio));

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
        const guardPx = guardPxRaw;
        const effectiveBottomPx = Math.max(
          currentMarginBottomPx,
          footerReservePx + appliedHeight + gapPx + guardPx
        );
        if (pageIndex >= 0) {
          footnoteLayoutVarsByPage.set(pageIndex, {
            height: appliedHeight,
            effectiveBottom: effectiveBottomPx,
            gap: gapPx,
            guard: guardPx
          });
        }

        // Force the body to reflow instead of adding a scrollbar.
        container.style.overflowY = "hidden";
        container.style.height = hasEntries ? `${appliedHeight}px` : "0px";
        container.style.setProperty("--page-footnote-height", `${appliedHeight}px`);
        setFootnoteLayoutVars(host, appliedHeight, effectiveBottomPx, gapPx, guardPx);
        if (pageIndex >= 0) {
          setFootnoteLayoutVars(pageStackPage, appliedHeight, effectiveBottomPx, gapPx, guardPx);
          setFootnoteLayoutVars(pageContent, appliedHeight, effectiveBottomPx, gapPx, guardPx);
          const prevHeight = footnoteHeightCache.get(pageIndex);
          if (prevHeight === undefined || Math.abs(appliedHeight - prevHeight) >= FOOTNOTE_HEIGHT_DIRTY_THRESHOLD) {
            footnoteHeightCache.set(pageIndex, appliedHeight);
            earliestDirtyPage =
              earliestDirtyPage === null ? pageIndex : Math.min(earliestDirtyPage, pageIndex);
            flashFootnoteReflow(pageIndex);
            layoutChanged = true;
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
                      guard: getComputedStyle(pageStackPage).getPropertyValue("--page-footnote-guard").trim(),
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
      // Mark global footnote layout churn so pagination can avoid join loops while height settles.
      if (layoutChanged) {
        try {
          (window as any).__leditorFootnoteLayoutChangedAt = performance.now();
        } catch {
          // ignore
        }
      }
      const recordStackHeight = (): number | null => {
        if (!pageStack) return null;
        const rect = pageStack.getBoundingClientRect();
        if (!Number.isFinite(rect.height)) return null;
        const value = Math.round(rect.height * 10) / 10;
        footnoteStackHeightHistory.push(value);
        if (footnoteStackHeightHistory.length > 8) footnoteStackHeightHistory.shift();
        return value;
      };
      const stackEq = (a: number, b: number) =>
        Math.abs(a - b) <= FOOTNOTE_PAGINATION_STACK_EPSILON;
      const detectStackOscillation = () => {
        if (footnoteStackHeightHistory.length < 6) return false;
        const recent = footnoteStackHeightHistory.slice(-6);
        const a = recent[0];
        const b = recent[1];
        const c = recent[2];
        if (
          stackEq(a, recent[2]) &&
          stackEq(a, recent[4]) &&
          stackEq(b, recent[3]) &&
          stackEq(b, recent[5]) &&
          !stackEq(a, b)
        ) {
          return true;
        }
        if (
          stackEq(a, recent[3]) &&
          stackEq(b, recent[4]) &&
          stackEq(c, recent[5]) &&
          (!stackEq(a, b) || !stackEq(b, c))
        ) {
          return true;
        }
        return false;
      };
      recordStackHeight();
      if (detectStackOscillation() && footnoteMode) {
        footnotePaginationCooldownUntil = performance.now() + FOOTNOTE_PAGINATION_COOLDOWN_MS;
        try {
          (window as any).__leditorDisablePaginationUntil = performance.now() + FOOTNOTE_PAGINATION_COOLDOWN_MS;
        } catch {
          // ignore
        }
      }
      // Re-apply cached footnote vars in case pagination replaced page nodes after measurement.
      syncFootnoteLayoutVarsToPages();
      // IMPORTANT: Never apply the "max across all pages" footnote height globally. That causes
      // every page to reserve space for the largest footnote, producing huge blank gaps and
      // truncated lines on pages without footnotes.
      const zoomGapPx = getFootnoteGapPx(zoomLayer);
      const zoomGuardPx = getFootnoteGuardPx(
        pageContents[0] ??
          editorEl.querySelector<HTMLElement>(".leditor-page-content") ??
          null,
        zoomLayer
      );
      zoomLayer.style.setProperty("--page-footnote-gap", `${zoomGapPx}px`);
      zoomLayer.style.setProperty("--page-footnote-guard", `${Math.max(0, Math.round(zoomGuardPx))}px`);
      zoomLayer.style.setProperty("--page-footnote-height", "0px");
      const baseMarginBottomPx = Number.parseFloat(
        getComputedStyle(zoomLayer).getPropertyValue("--current-margin-bottom").trim() || "0"
      );
      const effectiveBottomPx = Math.max(baseMarginBottomPx, footerReservePx);
      zoomLayer.style.setProperty("--effective-margin-bottom", `${Math.max(0, Math.round(effectiveBottomPx))}px`);
      if (earliestDirtyPage !== null) {
        if (performance.now() < footnotePaginationCooldownUntil) return;
        const signature = lastFootnoteDocSignature || "unknown";
        if (signature && signature === footnotePaginationLockedSignature) return;
        const now = performance.now();
        if (signature !== footnotePaginationSignature) {
          footnotePaginationSignature = signature;
          footnotePaginationAttempts = 0;
          footnotePaginationWindowStart = now;
        } else if (now - footnotePaginationWindowStart > FOOTNOTE_PAGINATION_ATTEMPT_WINDOW_MS) {
          footnotePaginationAttempts = 0;
          footnotePaginationWindowStart = now;
        }
        footnotePaginationAttempts += 1;
        if (footnotePaginationAttempts > FOOTNOTE_PAGINATION_ATTEMPT_LIMIT) return;
        const shouldPaginate = !footnoteMode || footnotePaginationArmed;
        if (!shouldPaginate) return;
        if (!footnotePaginationArmed && signature && signature === lastFootnotePaginationDocSignature) return;
        if ((window as any).__leditorDisablePaginationUntil) return;
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
        if (signature) {
          footnotePaginationLockedSignature = signature;
          lastFootnotePaginationDocSignature = signature;
        }
        try {
          (window as any).__leditorPaginationOrigin = "footnotes";
          (window as any).__leditorPaginationOriginAt = performance.now();
        } catch {
          // ignore
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
    enforceSingleColumnStyle(content, true);
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

    const columns = shouldForceSingleColumn() ? 1 : Math.max(1, info.meta.columns ?? 1);
    const gapIn = typeof info.meta.columnGapIn === "number" && Number.isFinite(info.meta.columnGapIn)
      ? info.meta.columnGapIn
      : null;
    const widthIn =
      typeof info.meta.columnWidthIn === "number" && Number.isFinite(info.meta.columnWidthIn)
        ? info.meta.columnWidthIn
        : null;
    if (gapIn != null) {
      page.style.setProperty("--local-page-column-gap", `${gapIn}in`);
    } else {
      page.style.removeProperty("--local-page-column-gap");
    }
    if (widthIn != null) {
      page.style.setProperty("--local-page-column-width", `${widthIn}in`);
    } else {
      page.style.removeProperty("--local-page-column-width");
    }
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
    if (window.__leditorPaginationDebug && isPaginationDebugVerbose()) {
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
    if (window.__leditorPaginationDebug && isPaginationDebugVerbose()) {
      console.info("[PaginationDebug] renderPages pages appended", { overlayCount: overlayLayer.children.length });
    }
    applySectionLayouts(pageCount);
    syncHeaderFooter();
    updatePageNumbers();
    applyGridMode();
    syncOverlayBounds();
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
    syncOverlayBounds();
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
    // Only header/footer editing should enable overlay pointer events now that footnotes live in the page stack.
    overlayLayer.style.pointerEvents = headerFooterMode ? "" : "none";
	    overlayLayer.style.zIndex = "3";
	    syncOverlayBounds();
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
    // Never steal focus from non-body editors (footnotes / header/footer).
    // Doing so causes a focus tug-of-war that looks like "blinking" and breaks caret tracking.
    if (!footnoteMode && !headerFooterMode) {
      const activeEl = document.activeElement as HTMLElement | null;
      if (!activeEl || !editorEl.contains(activeEl)) {
        const now = performance.now();
        if (now - lastUserInputAt > 500) {
          prose.focus({ preventScroll: true });
        }
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
        pageFootnotesCount: pageStack.querySelectorAll(".leditor-page .leditor-page-footnotes").length,
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

  let lastHyphenationMode: string | null = null;
  const syncHyphenation = () => {
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const rawMode = (editorInstance?.state?.doc?.attrs as any)?.hyphenation ?? "none";
    const mode = typeof rawMode === "string" ? rawMode.toLowerCase() : "none";
    const cssMode =
      mode === "auto" || mode === "full"
        ? "auto"
        : mode === "manual"
          ? "manual"
          : "manual";
    if (cssMode === lastHyphenationMode) return;
    lastHyphenationMode = cssMode;
    document.documentElement.style.setProperty("--page-hyphens", cssMode);
  };

  let paginationDebugOverlay: HTMLElement | null = null;
  let paginationDebugSeq = 0;
  let lastOverflowSignature = "";
  const ensurePaginationDebugOverlay = () => {
    if (!window.__leditorPaginationDebug) {
      if (paginationDebugOverlay) {
        paginationDebugOverlay.remove();
        paginationDebugOverlay = null;
      }
      return null;
    }
    if (paginationDebugOverlay && paginationDebugOverlay.isConnected) return paginationDebugOverlay;
    const overlay = document.createElement("div");
    overlay.className = "leditor-pagination-debug-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.pointerEvents = "none";
    overlay.style.zIndex = "9999";
    overlay.style.mixBlendMode = "multiply";
    document.body.appendChild(overlay);
    paginationDebugOverlay = overlay;
    return overlay;
  };

  const updatePaginationDebugOverlay = () => {
    const overlay = ensurePaginationDebugOverlay();
    if (!overlay) return;
    paginationDebugSeq += 1;
    const seq = paginationDebugSeq;
    overlay.innerHTML = "";
    const pages = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page-inner"));
    const contents = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page-content"));
    const overlays = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page-overlay"));
    const colors = {
      page: "rgba(80,120,255,0.5)",
      content: "rgba(255,140,0,0.6)",
      overlay: "rgba(0,180,120,0.5)"
    };
    const addBox = (rect: DOMRect, color: string, label: string) => {
      const box = document.createElement("div");
      box.style.position = "absolute";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      box.style.border = `1px dashed ${color}`;
      box.style.background = "transparent";
      box.style.boxSizing = "border-box";
      box.style.font = "11px/1.2 monospace";
      box.style.color = color;
      box.textContent = label;
      overlay.appendChild(box);
    };
    const maxPages = 3;
    pages.slice(0, maxPages).forEach((page, index) => {
      addBox(page.getBoundingClientRect(), colors.page, `page[${index}]`);
    });
    contents.slice(0, maxPages).forEach((content, index) => {
      addBox(content.getBoundingClientRect(), colors.content, `content[${index}]`);
    });
    overlays.slice(0, maxPages).forEach((layer, index) => {
      addBox(layer.getBoundingClientRect(), colors.overlay, `overlay[${index}]`);
    });
    if (window.__leditorPaginationDebug && isPaginationDebugVerbose()) {
      const overflowRows: string[] = [];
      let overflowDetailLogged = false;
      const logOverflowDetail = (content: HTMLElement, index: number) => {
        if (overflowDetailLogged) return;
        const contentRect = content.getBoundingClientRect();
        const maxRectWidth = contentRect.width + 2;
        const maxClientWidth = content.clientWidth + 2;
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_ELEMENT);
        const candidates: Array<{ el: HTMLElement; rect: DOMRect; score: number }> = [];
        let maxScrollEl: HTMLElement | null = null;
        let maxScrollDelta = 0;
        let scanned = 0;
        while (walker.nextNode() && scanned < 600) {
          const el = walker.currentNode as HTMLElement;
          scanned += 1;
          if (!el || el === content) continue;
          const rect = el.getBoundingClientRect();
          const rectOverflow = Math.max(0, rect.right - contentRect.right);
          const scrollOverflow = Math.max(0, el.scrollWidth - el.clientWidth);
          const widthOverflow = Math.max(0, rect.width - maxRectWidth);
          if (scrollOverflow > maxScrollDelta) {
            maxScrollDelta = scrollOverflow;
            maxScrollEl = el;
          }
          if (rectOverflow > 2 || scrollOverflow > 4 || widthOverflow > 2) {
            candidates.push({ el, rect, score: rectOverflow + scrollOverflow + widthOverflow });
          }
        }
        if (candidates.length === 0) return;
        candidates.sort((a, b) => b.score - a.score);
        const top = candidates.slice(0, 3);
        const candidate = top[0]?.el;
        if (!candidate) return;
        overflowDetailLogged = true;
        const style = getComputedStyle(candidate);
        const snippet = (candidate.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
        const rect = candidate.getBoundingClientRect();
        top.forEach((item, i) => {
          const r = item.rect;
          const warn = document.createElement("div");
          warn.style.position = "absolute";
          warn.style.left = `${r.left}px`;
          warn.style.top = `${r.top}px`;
          warn.style.width = `${r.width}px`;
          warn.style.height = `${r.height}px`;
          warn.style.border = `1px solid rgba(255,0,0,${0.7 - i * 0.2})`;
          warn.style.boxSizing = "border-box";
          warn.style.pointerEvents = "none";
          overlay.appendChild(warn);
        });
        console.info("[PaginationDebug] content overflow detail", {
          pageIndex: index,
          tag: candidate.tagName,
          className: candidate.className,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          clientWidth: candidate.clientWidth,
          scrollWidth: candidate.scrollWidth,
          contentClientWidth: content.clientWidth,
          contentRectWidth: Math.round(contentRect.width),
          display: style.display,
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
          wordBreak: style.wordBreak,
          position: style.position,
          snippet
        });
        if (maxScrollEl && maxScrollDelta > 8) {
          const maxStyle = getComputedStyle(maxScrollEl);
          const maxRect = maxScrollEl.getBoundingClientRect();
          console.info("[PaginationDebug] content overflow max-scroll", {
            pageIndex: index,
            tag: maxScrollEl.tagName,
            className: maxScrollEl.className,
            width: Math.round(maxRect.width),
            height: Math.round(maxRect.height),
            clientWidth: maxScrollEl.clientWidth,
            scrollWidth: maxScrollEl.scrollWidth,
            scrollDelta: Math.round(maxScrollDelta),
            display: maxStyle.display,
            whiteSpace: maxStyle.whiteSpace,
            overflowWrap: maxStyle.overflowWrap,
            wordBreak: maxStyle.wordBreak,
            position: maxStyle.position
          });
        }
      };
      contents.forEach((content, index) => {
        const style = getComputedStyle(content);
        const overflow = Math.max(0, Math.round(content.scrollWidth - content.clientWidth));
        if (overflow > 2 || style.columnCount !== "1") {
          overflowRows.push(
            `${index}:${content.clientWidth}/${content.scrollWidth} col=${style.columnCount} gap=${style.columnGap}`
          );
          logOverflowDetail(content, index);
        }
      });
      const signature = overflowRows.join("|");
      if (signature && signature !== lastOverflowSignature && seq % 2 === 0) {
        lastOverflowSignature = signature;
        console.info("[PaginationDebug] content overflow", { signature });
      }
    }
  };

  const updatePagination = () => {
    suspendPageObserver = true;
    const scrollTopBefore = appRoot.scrollTop;
    const scrollLeftBefore = appRoot.scrollLeft;
    try {
      syncHyphenation();
      const rootStyle = getComputedStyle(document.documentElement);
      if (paginationEnabled && viewMode === "single") {
        try {
          (window as any).__leditorDisableColumns = true;
        } catch {
          // ignore
        }
      }
      const pageColumns = rootStyle.getPropertyValue("--page-columns").trim();
      {
        const contents = editorEl.querySelectorAll<HTMLElement>(".leditor-page-content");
        contents.forEach((content) => enforceSingleColumnStyle(content, true));
      }
      if (window.__leditorPaginationDebug && isPaginationDebugVerbose()) {
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
            columnGap: contentStyle.columnGap,
            columnWidth: contentStyle.columnWidth,
            overflowX: contentStyle.overflowX,
            scrollWidth: sampleContent.scrollWidth,
            clientWidth: sampleContent.clientWidth,
            inlineColumnWidth: sampleContent.style.columnWidth || "",
            inlineColumnGap: sampleContent.style.columnGap || ""
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
      if (window.__leditorPaginationDebug && isPaginationDebugVerbose()) {
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
      if (window.__leditorPaginationDebug) {
        updatePaginationDebugOverlay();
      }
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
      if (!didInitialCenter && now - lastUserScrollAt >= 250 && now - lastUserInputAt >= 500) {
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
    const now = performance.now();
    const docSignature =
      lastFootnoteDocSignature ||
      computePaginationDocSignature(attachedEditorHandle?.getEditor?.()?.state?.doc) ||
      "unknown";
    if (docSignature !== paginationRequestSignature) {
      paginationRequestSignature = docSignature;
      paginationRequestCount = 0;
      paginationRequestWindowStart = now;
    } else if (now - paginationRequestWindowStart > PAGINATION_REQUEST_WINDOW_MS) {
      paginationRequestCount = 0;
      paginationRequestWindowStart = now;
    }
    paginationRequestCount += 1;
    if (paginationRequestCount > PAGINATION_REQUEST_LIMIT) return;
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
    // Force a single vertical page stack (no horizontal flow).
    const effectiveMode: A4ViewMode = mode === "two-page" ? "single" : mode;
    try {
      console.info("[A4Layout][view] setViewMode", {
        requested: mode,
        effective: effectiveMode,
        stack: new Error().stack
      });
    } catch {
      // ignore
    }
    viewMode = effectiveMode;
    pageStack.classList.remove("is-two-page");
    overlayLayer.classList.remove("is-two-page");
    if (effectiveMode === "single") {
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
    const page = pageStack.querySelector<HTMLElement>(`.leditor-page[data-page-index="${pageIndex}"]`);
    if (!page) return null;
    const container = page.querySelector<HTMLElement>(".leditor-page-footnotes");
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
    // Footnotes live in the page stack; a click in the footnote band should enter footnote mode.
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
    // Overlays should only emit input events for header/footer editing.
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
    if (
      keyTarget &&
      keyTarget.closest(".ProseMirror") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      const isTypingKey =
        event.key === "Enter" ||
        event.key === "Backspace" ||
        event.key === "Delete" ||
        event.key.length === 1;
      if (isTypingKey) {
        markUserInput();
      }
    }
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
        ? pageStack.querySelector<HTMLElement>(
            `.leditor-footnote-entry-text[data-footnote-id="${activeFootnoteId}"]`
          )
        : null;
      if (active && active.isConnected) {
        try {
          const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
          if (!editorInstance || !activeFootnoteId) return;
          const footnoteBodyType = editorInstance.state?.schema?.nodes?.footnoteBody ?? null;
          const bodyNode = footnoteBodyType
            ? findFootnoteBodyNodeById(editorInstance.state.doc, activeFootnoteId, footnoteBodyType)?.node ?? null
            : null;
          const noteEditor = ensureNoteEditor(activeFootnoteId, "footnote", active, bodyNode);
          noteEditor?.view.focus();
        } catch {
          // ignore
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
  appRoot.addEventListener("keydown", handleFootnoteEntryKeydown, true);
  appRoot.addEventListener("click", handleEndnoteEntryClick);
  // Global (document/window) listeners must be singletons: if the layout remounts without a clean
  // destroy (crash, hot reload, devtools reload), duplicate listeners cause focus/selection loops
  // and visible UI flicker.
  const globalKeydownKey = "__leditorA4DocKeydownHandler";
  const globalSelectionChangeKey = "__leditorA4DocSelectionChangeHandler";
  const globalFocusInKey = "__leditorA4DocFocusInHandler";
  const globalPointerDownKey = "__leditorA4DocPointerDownHandler";
  const globalPointerUpKey = "__leditorA4DocPointerUpHandler";
  const globalPointerMoveKey = "__leditorA4DocPointerMoveHandler";
  const globalClickKey = "__leditorA4DocClickHandler";

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
	    if (event.button !== 0) return;
	    const target = (event.target as HTMLElement | null) ?? null;
	    const inChromeUi =
	      !!target?.closest?.(
	        ".leditor-ribbon-host, .leditor-navigation-panel, .leditor-styles-panel, .leditor-pdf-shell, .leditor-agent-sidebar"
	      );
	    // Do not let the global caret/selection failsafes interfere with UI chrome interactions
	    // (navigation pane, styles pane, ribbon, embedded PDF viewer).
	    if (inChromeUi) {
	      // Still unstick mode classes (flags are the source of truth) and restore editability.
	      setModeClass("leditor-footnote-editing", false);
	      setModeClass("leditor-header-footer-editing", false);
	      setEditorEditable(true);
	      return;
	    }
	    pointerDownActive = true;
	    pointerSelectionRange = false;
	    pointerMoved = false;
	    lastPointerDownAt = Date.now();
	    pointerDownX = event.clientX;
	    pointerDownY = event.clientY;
	    multiClickDrag = null;
	    marginSelectionActive = false;
	    marginSelectionAnchor = null;
	    // Un-stick stray mode classes (flags are the source of truth).
	    setModeClass("leditor-footnote-editing", false);
	    setModeClass("leditor-header-footer-editing", false);
	    setEditorEditable(true);

    const clickCount = typeof event.detail === "number" ? event.detail : 1;
	    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
	    const view = editorInstance?.view ?? null;
	    if (view) {
      const selectionMode = getSelectionMode();
      const wantsBlock = selectionMode === "block" || event.altKey;
      const pageCtx = getPageContextFromPoint(event.clientX, event.clientY);
      if (pageCtx?.pageContent) lastPageContentEl = pageCtx.pageContent;
      if (pageCtx?.pageContent && pageCtx?.pageEl) {
        const pageRect = pageCtx.pageEl.getBoundingClientRect();
        const contentRect = pageCtx.pageContent.getBoundingClientRect();
        const inPageY = event.clientY >= pageRect.top && event.clientY <= pageRect.bottom;
        const inContentX = event.clientX >= contentRect.left && event.clientX <= contentRect.right;
        const inContentY = event.clientY >= contentRect.top && event.clientY <= contentRect.bottom;
        const inLeftMargin =
          inPageY && event.clientX >= pageRect.left && event.clientX < contentRect.left - 2;
        if (wantsBlock && inContentX && inContentY) {
          blockSelectionActive = true;
          blockSelectionAnchor = { x: event.clientX, y: event.clientY };
          blockSelectionPageContent = pageCtx.pageContent;
          const ranges = computeBlockRanges(
            view,
            blockSelectionAnchor,
            blockSelectionAnchor,
            blockSelectionPageContent
          );
          if (ranges.length) {
            setVirtualSelections({ view }, ranges, "block");
          }
          armSelectionHold(800);
        } else if (!wantsBlock && inLeftMargin) {
          const coordsPos = getCoordsPosFromPoint(view, event.clientX, event.clientY, pageCtx.pageContent);
          if (coordsPos != null) {
            const range = getParagraphRangeAtPos(view, coordsPos);
            if (range) {
              marginSelectionActive = true;
              marginSelectionAnchor = range;
              applyRangeSelection(view, range.from, range.to);
              pointerSelectionRange = true;
              lastPointerSelectionAt = Date.now();
              armSelectionHold(600);
              event.preventDefault();
            }
          }
        } else if (!wantsBlock && clickCount >= 2 && inContentX && inContentY) {
          const targetBlock = target?.closest?.(CLICK_BLOCK_SELECTOR) as HTMLElement | null;
          const coordsPos = getCoordsPosFromPoint(
            view,
            event.clientX,
            event.clientY,
            pageCtx.pageContent,
            targetBlock
          );
          if (coordsPos != null) {
            const kind = clickCount >= 4 ? "paragraph" : clickCount >= 3 ? "sentence" : "word";
            startMultiClickDrag(view, kind, coordsPos);
          }
        }
      }
    }

    // If the user is clicking back into the editor surface, ensure focus is restored so the caret appears.
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
            pointerDownActive = false;
            lastPointerUpAt = Date.now();
            if (pointerMoved) {
              lastPointerDragAt = Date.now();
              markRangeSelection(450);
            }
            try {
              const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
              const view = editorInstance?.view ?? null;
              const sel: any = view?.state?.selection ?? null;
              if (sel && typeof sel.from === "number" && typeof sel.to === "number" && sel.from !== sel.to) {
                markRangeSelection(450);
              }
            } catch {
              // ignore
            }
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
			            const holdSelection = selectionHoldActive();
			            const holdRangeSelection = selectionWasRange && holdSelection;

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
		            const coordsPos = getCoordsPosFromPoint(view, x, y, pageContent);
			            const coordsFarFromBefore =
			              selectionFromBefore != null && coordsPos != null
			                ? Math.abs(coordsPos - selectionFromBefore) > 2
			                : true;

			            // Word-like behavior: if there is an active range selection and a plain click doesn't
			            // collapse it (usually because an overlay/page chrome intercepted the event), force a
			            // caret at the click coords. Never do this when the user is holding selection modifiers.
			            if (
			              selectionDidNotMove &&
			              selectionWasRange &&
			              !selectionModifierHeld &&
			              coordsPos != null &&
			              !holdRangeSelection
			            ) {
			              setCaretAtPos(view, coordsPos);
			              return;
			            }

			            if (holdSelection) {
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
		                setCaretAtPos(view, coordsPos);
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

  const handleGlobalPointerMove = (event: PointerEvent) => {
    if (!pointerDownActive) return;
    const dx = Math.abs(event.clientX - pointerDownX);
    const dy = Math.abs(event.clientY - pointerDownY);
    if (!pointerMoved && (dx > 2 || dy > 2)) {
      pointerMoved = true;
    }

    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const view = editorInstance?.view ?? null;
    if (view && (multiClickDrag?.active || marginSelectionActive || blockSelectionActive)) {
      const pageCtx = getPageContextFromPoint(event.clientX, event.clientY);
      if (pageCtx?.pageContent) lastPageContentEl = pageCtx.pageContent;
      const pageContent = pageCtx?.pageContent ?? blockSelectionPageContent ?? lastPageContentEl;
      const coordsPos = getCoordsPosFromPoint(view, event.clientX, event.clientY, pageContent);
      if (blockSelectionActive && blockSelectionAnchor && pageContent) {
        const ranges = computeBlockRanges(
          view,
          blockSelectionAnchor,
          { x: event.clientX, y: event.clientY },
          pageContent
        );
        const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
        if (editorInstance) {
          setVirtualSelections(editorInstance, ranges, "block");
        }
        pointerSelectionRange = true;
        lastPointerSelectionAt = Date.now();
        armSelectionHold(350);
      } else if (coordsPos != null) {
        if (multiClickDrag?.active) {
          updateMultiClickDrag(view, coordsPos);
        }
        if (marginSelectionActive && marginSelectionAnchor) {
          const range = getParagraphRangeAtPos(view, coordsPos);
          if (range) {
            let from = marginSelectionAnchor.from;
            let to = marginSelectionAnchor.to;
            if (range.from < marginSelectionAnchor.from) {
              from = range.from;
              to = marginSelectionAnchor.to;
            } else if (range.to > marginSelectionAnchor.to) {
              from = marginSelectionAnchor.from;
              to = range.to;
            }
            applyRangeSelection(view, Math.min(from, to), Math.max(from, to));
            pointerSelectionRange = true;
            lastPointerSelectionAt = Date.now();
            armSelectionHold(250);
          }
        }
      }
    }

    if (!pointerMoved) return;
    const scrollRoot = appRoot;
    const rect = scrollRoot.getBoundingClientRect();
    const threshold = 40;
    let delta = 0;
    if (event.clientY < rect.top + threshold) {
      const dist = Math.max(0, rect.top + threshold - event.clientY);
      delta = -Math.ceil((dist / threshold) * 24);
    } else if (event.clientY > rect.bottom - threshold) {
      const dist = Math.max(0, event.clientY - (rect.bottom - threshold));
      delta = Math.ceil((dist / threshold) * 24);
    }
    if (delta !== 0) {
      pendingAutoScroll = delta;
      if (!autoScrollRaf) {
        autoScrollRaf = window.requestAnimationFrame(() => {
          scrollRoot.scrollBy({ top: pendingAutoScroll, behavior: "auto" });
          pendingAutoScroll = 0;
          autoScrollRaf = 0;
        });
      }
    }
  };
  const existingPointerMove = (window as any)[globalPointerMoveKey] as ((e: PointerEvent) => void) | undefined;
  if (existingPointerMove) document.removeEventListener("pointermove", existingPointerMove, true);
  (window as any)[globalPointerMoveKey] = handleGlobalPointerMove;
  document.addEventListener("pointermove", handleGlobalPointerMove, true);

  const handleGlobalPointerUp = () => {
    pointerDownActive = false;
    lastPointerUpAt = Date.now();
    if (marginSelectionActive || multiClickDrag?.active || blockSelectionActive) {
      markRangeSelection(350);
    }
    marginSelectionActive = false;
    marginSelectionAnchor = null;
    multiClickDrag = null;
    blockSelectionActive = false;
    blockSelectionAnchor = null;
    blockSelectionPageContent = null;
  };
  const existingPointerUp = (window as any)[globalPointerUpKey] as ((e: PointerEvent) => void) | undefined;
  if (existingPointerUp) document.removeEventListener("pointerup", existingPointerUp, true);
  (window as any)[globalPointerUpKey] = handleGlobalPointerUp;
  document.addEventListener("pointerup", handleGlobalPointerUp, true);

  const isWordChar = (ch: string) => {
    if (!ch) return false;
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) return true; // 0-9
    if (code >= 65 && code <= 90) return true; // A-Z
    if (code >= 97 && code <= 122) return true; // a-z
    if (ch === "_") return true;
    // Treat non-ASCII letters as word chars.
    return code > 127;
  };

  const resolveTextblockDepth = ($pos: any) => {
    let depth = $pos.depth;
    while (depth > 0 && !$pos.node(depth).isTextblock) depth -= 1;
    return depth;
  };

  const clampDocPos = (view: any, pos: number) =>
    Math.max(0, Math.min(view.state.doc.content.size, pos));

  const isAnchorInlineNode = (node: any): boolean => node?.type?.name === "anchorMarker";
  const hasLockedAnchorMark = (node: any): boolean => {
    if (!node?.isText) return false;
    const marks = node.marks ?? [];
    return marks.some((mark: any) => {
      if (mark?.type?.name !== "anchor") return false;
      const attrs = mark.attrs || {};
      return Boolean(
        attrs.dataKey ||
          attrs.dataItemKey ||
          attrs.itemKey ||
          attrs.dataDqid ||
          attrs.dataQuoteId ||
          attrs.dataQuoteText
      );
    });
  };
  const isAnchorBlockedPos = (doc: any, pos: number): boolean => {
    try {
      const $pos = doc.resolve(pos);
      const before = $pos.nodeBefore;
      const after = $pos.nodeAfter;
      const index = $pos.index();
      const parent = $pos.parent;
      const at = parent && index < parent.childCount ? parent.child(index) : null;
      return (
        isAnchorInlineNode(before) ||
        isAnchorInlineNode(after) ||
        isAnchorInlineNode(at) ||
        hasLockedAnchorMark(before) ||
        hasLockedAnchorMark(after) ||
        hasLockedAnchorMark(at)
      );
    } catch {
      return false;
    }
  };
  const findSafeCaretPos = (view: any, pos: number): number => {
    const direct = resolveInlinePos(view, pos, 1);
    if (direct != null) return direct;
    const doc = view.state.doc;
    const max = doc.content.size;
    const clamp = (p: number) => Math.max(0, Math.min(max, p));
    for (let step = 1; step <= 16; step += 1) {
      const left = resolveInlinePos(view, clamp(pos - step), -1);
      if (left != null) return left;
      const right = resolveInlinePos(view, clamp(pos + step), 1);
      if (right != null) return right;
    }
    return pos;
  };
  const resolveInlinePos = (view: any, pos: number, bias = 1): number | null => {
    const doc = view.state.doc;
    const max = doc.content.size;
    const clamp = (p: number) => Math.max(0, Math.min(max, p));
    const accept = (p: number) => {
      const $pos = doc.resolve(p);
      return $pos.parent.inlineContent && !isAnchorBlockedPos(doc, p);
    };
    let candidate = clamp(pos);
    if (accept(candidate)) return candidate;
    for (let step = 1; step <= 8; step += 1) {
      const left = clamp(candidate - step);
      if (accept(left)) return left;
      const right = clamp(candidate + step);
      if (accept(right)) return right;
    }
    try {
      const $pos = doc.resolve(candidate);
      const near = Selection.near($pos, bias);
      const nearPos = clamp((near as any)?.from ?? candidate);
      if (accept(nearPos)) return nearPos;
    } catch {
      // ignore
    }
    return null;
  };

  const CLICK_BLOCK_SELECTOR = "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6";

  const clampPosToBlock = (view: any, pos: number, blockEl: HTMLElement | null): number => {
    if (!blockEl) return pos;
    try {
      const blockPos = view.posAtDOM(blockEl, 0);
      const $block = view.state.doc.resolve(blockPos);
      const depth = resolveTextblockDepth($block);
      if (depth <= 0) return pos;
      const start = $block.start(depth);
      const end = $block.end(depth);
      let clamped = Math.max(start + 1, Math.min(end - 1, pos));
      const inline = resolveInlinePos(view, clamped, 1);
      if (inline == null) return clamped;
      if (inline < start + 1) return start + 1;
      if (inline > end - 1) return end - 1;
      return inline;
    } catch {
      return pos;
    }
  };

  const getWordRangeAtPos = (view: any, pos: number): { from: number; to: number } | null => {
    try {
      const $pos = view.state.doc.resolve(pos);
      const depth = resolveTextblockDepth($pos);
      if (depth <= 0) return null;
      const text = $pos.parent.textBetween(0, $pos.parent.content.size, "\n", "\n");
      if (!text) return null;
      const offset = Math.max(0, Math.min($pos.parentOffset, text.length));
      let start = offset;
      while (start > 0 && isWordChar(text[start - 1])) start -= 1;
      let end = offset;
      while (end < text.length && isWordChar(text[end])) end += 1;
      if (start === end) {
        start = Math.max(0, offset - 1);
        end = Math.min(text.length, offset + 1);
      }
      const blockStart = $pos.start(depth);
      const from = clampDocPos(view, blockStart + start);
      const to = Math.max(from, clampDocPos(view, blockStart + end));
      return { from, to };
    } catch {
      return null;
    }
  };

  const getSentenceRangeAtPos = (view: any, pos: number): { from: number; to: number } | null => {
    try {
      const $pos = view.state.doc.resolve(pos);
      const depth = resolveTextblockDepth($pos);
      if (depth <= 0) return null;
      const text = $pos.parent.textBetween(0, $pos.parent.content.size, "\n", "\n");
      if (!text) return null;
      const offset = Math.max(0, Math.min($pos.parentOffset, text.length));
      const bounds = findSentenceBounds(text, offset);
      if (bounds.start === bounds.end) return null;
      const blockStart = $pos.start(depth);
      const from = clampDocPos(view, blockStart + bounds.start);
      const to = Math.max(from, clampDocPos(view, blockStart + bounds.end));
      return { from, to };
    } catch {
      return null;
    }
  };

  const getParagraphRangeAtPos = (view: any, pos: number): { from: number; to: number } | null => {
    try {
      const $pos = view.state.doc.resolve(pos);
      const depth = resolveTextblockDepth($pos);
      if (depth <= 0) return null;
      const from = clampDocPos(view, $pos.start(depth));
      const to = Math.max(from, clampDocPos(view, $pos.end(depth)));
      return { from, to };
    } catch {
      return null;
    }
  };

  const applyRangeSelection = (
    view: any,
    from: number,
    to: number,
    options?: { scrollIntoView?: boolean }
  ) => {
    try {
      const selection = TextSelection.create(view.state.doc, from, to);
      const tr = view.state.tr.setSelection(selection);
      if (options?.scrollIntoView) {
        view.dispatch(tr.scrollIntoView());
      } else {
        view.dispatch(tr);
      }
      view.focus();
    } catch {
      // ignore
    }
  };

  const setCaretAtPos = (view: any, pos: number, options?: { scrollIntoView?: boolean }) => {
    try {
      const safePos = findSafeCaretPos(view, pos);
      const selection = TextSelection.create(view.state.doc, safePos, safePos);
      const tr = view.state.tr.setSelection(selection);
      if (options?.scrollIntoView) {
        view.dispatch(tr.scrollIntoView());
      } else {
        view.dispatch(tr);
      }
      view.focus();
      return true;
    } catch {
      return false;
    }
  };

  const selectWordAtPos = (view: any, pos: number): boolean => {
    const range = getWordRangeAtPos(view, pos);
    if (!range) return false;
    applyRangeSelection(view, range.from, range.to);
    return true;
  };

  const selectSentenceAtPos = (view: any, pos: number): boolean => {
    const range = getSentenceRangeAtPos(view, pos);
    if (!range) return false;
    applyRangeSelection(view, range.from, range.to);
    return true;
  };

  const selectParagraphAtPos = (view: any, pos: number): boolean => {
    const range = getParagraphRangeAtPos(view, pos);
    if (!range) return false;
    applyRangeSelection(view, range.from, range.to);
    return true;
  };

  const getRangeForKind = (
    view: any,
    kind: "word" | "sentence" | "paragraph",
    pos: number
  ): { from: number; to: number } | null => {
    if (kind === "word") return getWordRangeAtPos(view, pos);
    if (kind === "sentence") return getSentenceRangeAtPos(view, pos);
    return getParagraphRangeAtPos(view, pos);
  };

  const getPageContextFromPoint = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return null;
    const pageEl = el.closest<HTMLElement>(".leditor-page");
    if (!pageEl || !pageStack.contains(pageEl)) return null;
    const pageContent = pageEl.querySelector<HTMLElement>(".leditor-page-content") ?? null;
    return { el, pageEl, pageContent };
  };

  const getCoordsPosFromPoint = (
    view: any,
    x: number,
    y: number,
    pageContent?: HTMLElement | null,
    limitBlock?: HTMLElement | null
  ) => {
    const rawX = x;
    const rawY = y;
    const clamped = (() => {
      if (!pageContent) return { left: rawX, top: rawY };
      const r = pageContent.getBoundingClientRect();
      return {
        left: Math.min(Math.max(rawX, r.left + 4), r.right - 4),
        top: Math.min(Math.max(rawY, r.top + 4), r.bottom - 4)
      };
    })();
    const coords = view.posAtCoords?.({ left: clamped.left, top: clamped.top }) ?? null;
    if (typeof coords?.pos !== "number") return null;
    const inlinePos = resolveInlinePos(view, coords.pos, 1);
    if (inlinePos == null) return null;
    if (limitBlock) return clampPosToBlock(view, inlinePos, limitBlock);
    return inlinePos;
  };

  const getLineStep = (view: any) => {
    const style = getComputedStyle(view.dom);
    const fontSize = Number.parseFloat(style.fontSize || "14");
    let lineHeight = Number.parseFloat(style.lineHeight || "");
    if (!Number.isFinite(lineHeight)) {
      lineHeight = Number.isFinite(fontSize) ? fontSize * 1.2 : 16;
    }
    return Math.max(8, Math.min(lineHeight, 72));
  };

  const computeBlockRanges = (
    view: any,
    anchor: { x: number; y: number },
    current: { x: number; y: number },
    pageContent: HTMLElement | null
  ): VirtualSelectionRange[] => {
    if (!pageContent) return [];
    const rect = pageContent.getBoundingClientRect();
    const left = Math.min(anchor.x, current.x);
    const right = Math.max(anchor.x, current.x);
    const top = Math.min(anchor.y, current.y);
    const bottom = Math.max(anchor.y, current.y);
    const clampX = (x: number) => Math.min(Math.max(x, rect.left + 4), rect.right - 4);
    const clampY = (y: number) => Math.min(Math.max(y, rect.top + 2), rect.bottom - 2);
    const clampedLeft = clampX(left);
    const clampedRight = clampX(right);
    const clampedTop = clampY(top);
    const clampedBottom = clampY(bottom);
    if (clampedBottom <= clampedTop || clampedRight <= clampedLeft) return [];
    const step = getLineStep(view);
    const ranges: VirtualSelectionRange[] = [];
    let y = clampedTop;
    const maxY = clampedBottom + step / 2;
    while (y <= maxY) {
      const fromPos = getCoordsPosFromPoint(view, clampedLeft, y, pageContent);
      const toPos = getCoordsPosFromPoint(view, clampedRight, y, pageContent);
      if (fromPos != null && toPos != null) {
        const from = Math.min(fromPos, toPos);
        const to = Math.max(fromPos, toPos);
        if (to > from) {
          ranges.push({ from, to });
        }
      }
      y += step;
    }
    if (!ranges.length) return ranges;
    ranges.sort((a, b) => a.from - b.from || a.to - b.to);
    const merged: VirtualSelectionRange[] = [];
    let currentRange = ranges[0];
    for (let i = 1; i < ranges.length; i += 1) {
      const next = ranges[i];
      if (next.from <= currentRange.to + 1) {
        currentRange = { from: currentRange.from, to: Math.max(currentRange.to, next.to) };
      } else {
        merged.push(currentRange);
        currentRange = next;
      }
    }
    merged.push(currentRange);
    return merged;
  };

  const startMultiClickDrag = (view: any, kind: "word" | "sentence" | "paragraph", pos: number) => {
    const range = getRangeForKind(view, kind, pos);
    if (!range) return false;
    multiClickDrag = {
      active: true,
      kind,
      anchorFrom: range.from,
      anchorTo: range.to,
      lastPos: pos
    };
    applyRangeSelection(view, range.from, range.to);
    armSelectionHold(600);
    return true;
  };

  const updateMultiClickDrag = (view: any, pos: number) => {
    if (!multiClickDrag || !multiClickDrag.active) return;
    if (multiClickDrag.lastPos === pos) return;
    const range = getRangeForKind(view, multiClickDrag.kind, pos);
    if (!range) return;
    multiClickDrag.lastPos = pos;
    let from = multiClickDrag.anchorFrom;
    let to = multiClickDrag.anchorTo;
    if (pos <= multiClickDrag.anchorFrom) {
      from = range.from;
      to = multiClickDrag.anchorTo;
    } else if (pos >= multiClickDrag.anchorTo) {
      from = multiClickDrag.anchorFrom;
      to = range.to;
    }
    applyRangeSelection(view, Math.min(from, to), Math.max(from, to));
    pointerSelectionRange = true;
    lastPointerSelectionAt = Date.now();
    armSelectionHold(250);
  };

  const scheduleMultiClickSelection = (
    kind: "word" | "sentence" | "paragraph",
    view: any,
    coordsPos: number,
    snapshot: { from: number; to: number }
  ) => {
    window.setTimeout(() => {
      if (footnoteMode || headerFooterMode) return;
      try {
        const sel = view.state.selection as any;
        const alreadySelected =
          typeof sel?.from === "number" &&
          typeof sel?.to === "number" &&
          sel.from !== sel.to &&
          (sel.from !== snapshot.from || sel.to !== snapshot.to);
        if (alreadySelected) return;
        if (kind === "word") {
          if (selectWordAtPos(view, coordsPos)) return;
        } else if (kind === "sentence") {
          if (selectSentenceAtPos(view, coordsPos)) return;
        } else {
          if (selectParagraphAtPos(view, coordsPos)) return;
        }
        const $pos = view.state.doc.resolve(coordsPos);
        view.dispatch(view.state.tr.setSelection(Selection.near($pos, 1)).scrollIntoView());
        view.focus();
      } catch {
        // ignore
      }
    }, 0);
  };

  // Body click caret enforcement (bubble phase):
  // ProseMirror typically finalizes click selection on `click`. In some cases (page wrappers, overlays,
  // transient non-editable state) the selection ends up stuck at doc start. After the click has
  // propagated, force selection to the click coords if it's clearly wrong.
  const handleDocumentClick = (event: MouseEvent) => {
    if (footnoteMode || headerFooterMode) return;
    if (event.button !== 0) return;
    if (selectionHoldActive()) return;
    let target = event.target as HTMLElement | null;
    if (!target) return;

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

    const targetBlock = target.closest(CLICK_BLOCK_SELECTOR) as HTMLElement | null;
    const coordsPos = getCoordsPosFromPoint(view, x, y, pageContent, targetBlock);
    if (coordsPos == null) return;

    const clickCount = typeof event.detail === "number" ? event.detail : 1;
    if (clickCount >= 2) {
      armSelectionHold(600);
      const kind = clickCount >= 4 ? "paragraph" : clickCount >= 3 ? "sentence" : "word";
      scheduleMultiClickSelection(
        kind,
        view,
        coordsPos,
        {
          from: typeof (view.state.selection as any)?.from === "number" ? (view.state.selection as any).from : coordsPos,
          to: typeof (view.state.selection as any)?.to === "number" ? (view.state.selection as any).to : coordsPos
        }
      );
      return;
    }

    const modifierHeld = !!(event.shiftKey || event.metaKey || event.ctrlKey || event.altKey);
    const selection = view.state.selection as any;
    const selectionIsRange =
      typeof selection?.from === "number" &&
      typeof selection?.to === "number" &&
      selection.from !== selection.to;
    // Word-like: any single, unmodified click collapses an existing range to the click point.
    if (selectionIsRange && !modifierHeld && clickCount <= 1) {
      if (selectionHoldActive()) {
        return;
      }
      const now = Date.now();
      if (
        (pointerSelectionRange && now - lastPointerSelectionAt < 450) ||
        (lastPointerDragAt > 0 && now - lastPointerDragAt < 450) ||
        (lastPointerUpAt > 0 && now - lastPointerUpAt < 350)
      ) {
        pointerSelectionRange = false;
        return;
      }
      setCaretAtPos(view, coordsPos);
      return;
    }

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
      if (setCaretAtPos(view, coordsPos) && (window as any).__leditorCaretDebug) {
        console.info("[Body][click] forced selection", { coordsPos, currentFrom, delta });
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
      const activeHost =
        active?.closest?.(
          `.leditor-footnote-entry-text[data-footnote-id="${id}"]`
        ) ?? null;
      if (activeHost) {
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
        !!active.closest?.(`.leditor-footnote-entry-text[data-footnote-id="${id}"]`);
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

  // Allow non-UI callers (ribbon/commands) to request an immediate footnote overlay refresh.
  // This is needed when only footnote body text changes (the document signature used to
  // debounce updates ignores footnote text to avoid re-rendering on every keystroke).
  const handleFootnotesRefreshEvent = () => {
    // Force renders on a short cadence. Citation-driven footnotes can be inserted before
    // the EditorHandle is attached or while pagination is rebuilding shells, so a single
    // synchronous render can be a no-op. Keep this bounded to avoid loops.
    const attempts: Array<() => void> = [
      () => renderFootnoteSections(),
      () => renderFootnoteSections(),
      () => renderFootnoteSections()
    ];
    try {
      attempts[0]();
    } catch {
      // ignore
    }
    try {
      window.requestAnimationFrame(() => {
        try {
          attempts[1]();
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
    try {
      window.setTimeout(() => {
        try {
          attempts[2]();
        } catch {
          // ignore
        }
      }, 250);
    } catch {
      // ignore
    }
    scheduleFootnoteHeightMeasurement();
  };
  const globalFootnotesRefreshKey = "__leditorFootnotesRefreshHandler";
  const existingGlobalFootnotesRefreshHandler = (window as any)[globalFootnotesRefreshKey] as EventListener | undefined;
  if (existingGlobalFootnotesRefreshHandler) {
    window.removeEventListener("leditor:footnotes-refresh", existingGlobalFootnotesRefreshHandler);
  }
  (window as any)[globalFootnotesRefreshKey] = handleFootnotesRefreshEvent as EventListener;
  window.addEventListener("leditor:footnotes-refresh", handleFootnotesRefreshEvent as EventListener);
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
    footnotePaginationLockedSignature = "";
    lastFootnotePaginationDocSignature = "";
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
  let paginationRequestSignature = "";
  let paginationRequestCount = 0;
  let paginationRequestWindowStart = 0;
  const PAGINATION_REQUEST_WINDOW_MS = 1600;
  const PAGINATION_REQUEST_LIMIT = 6;
  let lastPaginationDocSignature = computePaginationDocSignature(attachedEditorHandle?.getEditor?.()?.state?.doc);
  const pageObserver = new MutationObserver(() => {
    scheduleFootnoteLayoutVarSync();
    if (suspendPageObserver || paginationQueued || footnoteMode || headerFooterMode) return;
    const editorInstance = attachedEditorHandle?.getEditor?.() ?? null;
    const nextSignature = computePaginationDocSignature(editorInstance?.state?.doc);
    if (nextSignature === lastPaginationDocSignature) {
      if ((window as any).__leditorPaginationDebug && isPaginationDebugVerbose()) {
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

  const footnoteProbe = {
    log(reason = "manual") {
      try {
        const pages = Array.from(editorEl.querySelectorAll<HTMLElement>(".leditor-page"));
        const rows: Array<Record<string, unknown>> = [];
        pages.forEach((page, index) => {
          const content = page.querySelector<HTMLElement>(".leditor-page-content");
          const footnotes = page.querySelector<HTMLElement>(".leditor-page-footnotes");
          const list = footnotes?.querySelector<HTMLElement>(".leditor-footnote-list") ?? null;
          const root = getComputedStyle(page);
          const contentRect = content?.getBoundingClientRect();
          const footRect = footnotes?.getBoundingClientRect();
          rows.push({
            index,
            hasEntries: Boolean(footnotes?.querySelector(".leditor-footnote-entry")),
            bodyHeight: contentRect?.height ?? null,
            footnoteHeight: footRect?.height ?? null,
            footnoteListScroll: list?.scrollHeight ?? null,
            vars: {
              footnoteHeight: root.getPropertyValue("--page-footnote-height").trim(),
              footnoteGap: root.getPropertyValue("--page-footnote-gap").trim(),
              effectiveBottom: root.getPropertyValue("--effective-margin-bottom").trim(),
              marginBottom: root.getPropertyValue("--local-page-margin-bottom").trim()
            }
          });
        });
        console.info("[FootnoteProbe] layout", { reason, pageCount: pages.length, rows });
      } catch (error) {
        console.warn("[FootnoteProbe] failed", { error });
      }
    },
    toggle(force?: boolean) {
      const next =
        force === undefined
          ? !(window as any).__leditorFootnoteProbe
          : Boolean(force);
      (window as any).__leditorFootnoteProbe = next;
      if (next) {
        this.log("toggle");
      }
      return next;
    }
  };
  (window as typeof window & { leditorFootnoteProbe?: any }).leditorFootnoteProbe = footnoteProbe;

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

  try {
    (window as any).__leditorDumpPageStack = () => logPageStackState("manual");
  } catch {
    // ignore
  }

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
      appRoot.removeEventListener("keydown", handleFootnoteEntryKeydown, true);
      appRoot.removeEventListener("click", handleEndnoteEntryClick);
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
      const existingPointerMove = (window as any)[globalPointerMoveKey] as ((e: PointerEvent) => void) | undefined;
      if (existingPointerMove) {
        document.removeEventListener("pointermove", existingPointerMove, true);
        if (existingPointerMove === handleGlobalPointerMove) delete (window as any)[globalPointerMoveKey];
      }
      const existingPointerUp = (window as any)[globalPointerUpKey] as ((e: PointerEvent) => void) | undefined;
      if (existingPointerUp) {
        document.removeEventListener("pointerup", existingPointerUp, true);
        if (existingPointerUp === handleGlobalPointerUp) delete (window as any)[globalPointerUpKey];
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
    restoreLastBodySelection() {
      return restoreLastBodySelection("layout");
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



















