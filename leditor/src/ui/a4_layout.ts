import { getFootnoteRegistry } from "../extensions/extension_footnote.ts";
import { allocateSectionId, defaultSectionMeta, parseSectionMeta, type SectionMeta } from "../legacy/editor/section_state.js";
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
  setSectionColumns,
  subscribeToLayoutChanges
} from "../legacy/ui/layout_settings.js";
import type { MarginValues } from "../legacy/ui/layout_settings.js";
import { THEME_CHANGE_EVENT } from "./theme_events.js";
import {
  applyDocumentLayoutTokenDefaults,
  applyDocumentLayoutTokens
} from "./pagination/index.js";
import { featureFlags } from "../legacy/ui/feature_flags.js";
import type { EditorHandle } from "../api/leditor.ts";
import { reconcileFootnotes } from "../uipagination/footnotes/registry.ts";
import { paginateWithFootnotes, type PageFootnoteState } from "../uipagination/footnotes/paginate_with_footnotes.ts";
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
const A4_BUNDLE_ID = "a4-layout-src-2026-01-20";
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
  --page-margin-top: 1in;
  --page-margin-right: 1in;
  --page-margin-bottom: 1in;
  --page-margin-left: 1in;
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
  --header-offset: 0;
  --footer-offset: 0;
  --footnote-area-height: 0.55in;
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
  --page-gap: 22px;
  --page-margin-inside: 1.25in;
  --page-margin-outside: 1in;
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
  --page-font-size: 11pt;
  --page-line-height: 1.15;
  --page-body-color: #1c1c1c;
  --page-header-color: #2d2d2d;
  --page-footer-color: #3a3a3a;
  --page-footnote-color: #4c4c4c;
  --ui-surface: rgba(255, 255, 255, 0.9);
  --ui-surface-dark: rgba(24, 28, 36, 0.85);
  --ui-text: #1b1b1b;
  --ui-text-inverse: #f7f7f7;
  --ui-scale: 1.15;
}

html, body {
  height: 100%;
  overflow: hidden;
}
.leditor-app {
  position: relative;
  min-height: 100vh;
  height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--page-canvas-bg);
  overflow: hidden;
  color: var(--ui-text);
  transform: scale(var(--ui-scale));
  transform-origin: top left;
  width: calc(100% / var(--ui-scale));
}

.leditor-app-header {
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  z-index: 40;
}

.leditor-doc-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.leditor-app .ProseMirror a,
.leditor-app .ProseMirror a * {
  color: #5dd5ff;
  text-decoration: underline;
  cursor: pointer;
}

.leditor-app .ProseMirror a.leditor-citation-anchor {
  background: rgba(93, 213, 255, 0.14);
  border: 1px solid rgba(93, 213, 255, 0.35);
  border-radius: 6px;
  padding: 1px 4px;
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
  padding: 32px 24px 80px;
  background: var(--page-canvas-bg);
  overflow: auto;
}

.leditor-a4-zoom {
  position: relative;
  zoom: var(--page-zoom);
  transform-origin: top center;
  width: fit-content;
  margin: 0 auto;
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

.leditor-page-inner {
  position: absolute;
  inset: 0;
  padding: 0;
  display: block;
  box-sizing: border-box;
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
        var(--local-page-margin-bottom, var(--page-margin-bottom)) +
        var(--page-footnote-height, 0px))
  );
  padding: 0;
  overflow: hidden;
}

.leditor-page-header,
.leditor-page-footer {
  font-family: var(--page-font-family);
  font-size: 10pt;
  text-transform: uppercase;
  font-weight: bold;
  color: var(--page-header-color);
  min-height: var(--header-height);
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  box-sizing: border-box;
}

.leditor-page-header {
  top: var(--header-offset);
  opacity: 1;
  pointer-events: auto;
}

.leditor-page-footer {
  bottom: calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
  justify-content: flex-end;
  text-transform: none;
  color: var(--page-footer-color);
  z-index: 2;
}

.leditor-page-footnotes {
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  bottom: calc(
    var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: var(--page-footnote-color);
  z-index: 3;
}
.leditor-page-footnotes.leditor-page-footnotes--active {
  border-top: var(--footnote-separator-height) solid var(--footnote-separator-color);
  padding-top: var(--footnote-spacing);
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
}

.leditor-footnote-entry-number,
.leditor-endnote-entry-number {
  font-weight: 600;
  min-width: 1.5em;
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
  cursor: pointer;
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

.leditor-page-number {
  display: inline-flex;
  gap: 4px;
  align-items: baseline;
}

/* legacy overlay/content frame styles removed */
.leditor-page-overlays {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--page-gap);
  width: fit-content;
  margin: 0 auto;
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

.leditor-page-inner {
  position: absolute;
  inset: 0;
  padding: 0;
  display: block;
  box-sizing: border-box;
}

.leditor-page-header,
.leditor-page-footer {
  font-family: var(--page-font-family);
  font-size: 10pt;
  text-transform: uppercase;
  font-weight: bold;
  color: var(--page-header-color);
  min-height: var(--header-height);
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  box-sizing: border-box;
}

.leditor-page-header {
  top: var(--header-offset);
  opacity: 1;
  pointer-events: auto;
}

.leditor-page-footer {
  bottom: calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
  justify-content: flex-end;
  text-transform: none;
}

.leditor-page-footnotes {
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  bottom: calc(
    var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: #262626;
}
.leditor-page-footnotes.leditor-page-footnotes--active {
  border-top: var(--footnote-separator-height) solid var(--footnote-separator-color);
  padding-top: var(--footnote-spacing);
}

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

.leditor-page-overlays {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--page-gap);
  width: fit-content;
  margin: 0 auto;
}

.leditor-page-stack.is-two-page,
.leditor-page-overlays.is-two-page {
  display: grid;
  grid-template-columns: repeat(2, var(--page-width));
  justify-content: center;
  width: calc(var(--page-width) * 2 + var(--page-gap));
  margin: 0 auto;
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

.leditor-page-inner {
  position: absolute;
  inset: 0;
  padding: 0;
  display: block;
  box-sizing: border-box;
}

.leditor-page-header,
.leditor-page-footer {
  font-family: var(--page-font-family);
  font-size: 10pt;
  text-transform: uppercase;
  font-weight: bold;
  color: var(--page-header-color);
  min-height: var(--header-height);
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  box-sizing: border-box;
}

.leditor-page-header {
  top: var(--header-offset);
  opacity: 1;
  pointer-events: auto;
}

.leditor-page-footer {
  bottom: calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
  justify-content: flex-end;
  text-transform: none;
  color: var(--page-footer-color);
}

.leditor-page-footnotes {
  position: absolute;
  left: var(--local-page-margin-left, var(--page-margin-left));
  right: var(--local-page-margin-right, var(--page-margin-right));
  bottom: calc(
    var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: #262626;
}
.leditor-page-footnotes.leditor-page-footnotes--active {
  border-top: var(--footnote-separator-height) solid var(--footnote-separator-color);
  padding-top: var(--footnote-spacing);
}

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

/* legacy overlay/content layer removed – real content lives inside .leditor-page-content */

.leditor-page-overlays {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  transform: none;
  width: fit-content;
  z-index: 1;
  pointer-events: none;
}

.leditor-page-overlay {
  width: var(--page-width);
  height: var(--page-height);
  position: relative;
}

.leditor-page-overlay .leditor-page-header,
.leditor-page-overlay .leditor-page-footer {
  pointer-events: auto;
}

.leditor-page-overlay .leditor-page-footnotes {
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

.leditor-header-footer-editing .leditor-page-overlay .leditor-page-header,
.leditor-header-footer-editing .leditor-page-overlay .leditor-page-footer {
  pointer-events: auto;
  opacity: 1;
  color: var(--page-header-color);
  outline: 1px dashed rgba(69, 82, 107, 0.6);
  background: rgba(255, 255, 255, 0.85);
}

.leditor-header-footer-editing .leditor-page-content {
  pointer-events: none;
}

.leditor-header-footer-editing #editor .ProseMirror {
  pointer-events: none;
}

.leditor-page-overlay .leditor-page-header,
.leditor-page-overlay .leditor-page-footer {
  position: absolute;
  left: var(--current-margin-left, var(--page-margin-left));
  right: var(--current-margin-right, var(--page-margin-right));
}

.leditor-page-overlay .leditor-page-header {
  top: calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-offset));
  height: var(--header-height);
}

.leditor-page-overlay .leditor-page-footer {
  bottom: calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
  height: var(--footer-height);
}

.leditor-page-overlay .leditor-page-footnotes {
  position: absolute;
  left: var(--current-margin-left, var(--page-margin-left));
  right: var(--current-margin-right, var(--page-margin-right));
  bottom: calc(
    var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: var(--page-footnote-color);
}
.leditor-page-overlay .leditor-page-footnotes.leditor-page-footnotes--active {
  border-top: var(--footnote-separator-height) solid var(--footnote-separator-color);
  padding-top: var(--footnote-spacing);
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
  top: calc(var(--local-page-margin-top, var(--page-margin-top)) + var(--header-offset));
  height: var(--header-height);
}

.leditor-page-footer {
  bottom: calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
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
        var(--local-page-margin-bottom, var(--page-margin-bottom)) +
        var(--page-footnote-height, var(--footnote-area-height)))
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
    var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: var(--page-footnote-color);
}
.leditor-page-footnotes.leditor-page-footnotes--active {
  border-top: var(--footnote-separator-height) solid var(--footnote-separator-color);
  padding-top: var(--footnote-spacing);
}

.leditor-page-stack {
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.leditor-page-overlays {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
.leditor-a4-zoom {
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.leditor-a4-zoom > .leditor-page-stack,
.leditor-a4-zoom > .leditor-page-overlays {
  width: fit-content;
  margin: 0 auto;
}
.leditor-a4-zoom > .leditor-page-overlays {
  inset: 0;
  left: 0;
  right: 0;
  transform: none;
}
.leditor-page-inner > .leditor-page-header {
  top: calc(var(--local-page-margin-top, var(--page-margin-top)) + var(--header-offset));
  height: var(--header-height);
}
.leditor-page-inner > .leditor-page-footer {
  bottom: calc(var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
  height: var(--footer-height);
  z-index: 2;
}
.leditor-page-inner > .leditor-page-footnotes {
  bottom: calc(
    var(--local-page-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  z-index: 3;
}
.leditor-page-overlay > .leditor-page-header {
  top: calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-offset));
  height: var(--header-height);
}
.leditor-page-overlay > .leditor-page-footer {
  bottom: calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
  height: var(--footer-height);
  z-index: 2;
}
.leditor-page-overlay > .leditor-page-footnotes {
  bottom: calc(
    var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  z-index: 3;
}
.leditor-page-overlay .leditor-page-header {
  top: calc(var(--current-margin-top, var(--page-margin-top)) + var(--header-offset));
  height: var(--header-height);
}

.leditor-page-overlay .leditor-page-footer {
  bottom: calc(var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset));
  height: var(--footer-height);
}

.leditor-page-overlay .leditor-page-footnotes {
  position: absolute;
  left: var(--current-margin-left, var(--page-margin-left));
  right: var(--current-margin-right, var(--page-margin-right));
  bottom: calc(
    var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset) + var(--footer-height)
  );
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: var(--page-footnote-color);
}
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
  console.info("[A4Debug] mountA4Layout", { bundle: A4_BUNDLE_ID });
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

  const pageStack = document.createElement("div");
  pageStack.className = "leditor-page-stack";
  pageStack.style.pointerEvents = "auto";
  pageStack.style.zIndex = "2";
  pageStack.style.position = "relative";

  const overlayLayer = document.createElement("div");
  overlayLayer.className = "leditor-page-overlays";
  overlayLayer.style.pointerEvents = "none";
  overlayLayer.style.zIndex = "1";
  overlayLayer.style.position = "absolute";

  zoomLayer.appendChild(pageStack);
  zoomLayer.appendChild(overlayLayer);

  canvas.appendChild(ruler);
  canvas.appendChild(zoomLayer);

  const endnotesPanel = document.createElement("div");
  endnotesPanel.className = "leditor-endnotes-panel";
  const endnotesTitle = document.createElement("div");
  endnotesTitle.className = "leditor-endnotes-title";
  endnotesTitle.textContent = "Endnotes";
  const endnotesList = document.createElement("div");
  endnotesList.className = "leditor-endnotes-list";
  endnotesPanel.appendChild(endnotesTitle);
  endnotesPanel.appendChild(endnotesList);
  canvas.appendChild(endnotesPanel);

  appRoot.appendChild(canvas);
  canvas.style.setProperty("--page-zoom", "1");

  let pageCount = 1;
  let viewMode: A4ViewMode = "single";
  let zoomValue = 1;
  let headerHtml = options.headerHtml ?? "";
  let footerHtml = options.footerHtml ?? "<span class=\"leditor-page-number\"></span>";
  let headerFooterMode = false;
  let activeRegion: "header" | "footer" | null = null;

  let themeMode: "light" | "dark" = "light";
  let pageSurfaceMode: "light" | "dark" = "light";
  const THEME_STORAGE_KEY = "leditor:theme";
  const PAGE_SURFACE_STORAGE_KEY = "leditor:page-surface";
  const MARGINS_STORAGE_KEY = "leditor:margins";

  let paginationQueued = false;
  let gridMode: GridMode = "stack";
  const paginationEnabled = featureFlags.paginationEnabled;
  let suspendPageObserver = false;
  let lastUserScrollAt = 0;
  canvas.addEventListener("scroll", () => {
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
    const raw = window.localStorage?.getItem(MARGINS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<MarginValues> | null;
    if (!parsed) return;
    applyMarginChange(parsed);
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
    const prose = editorEl.querySelector<HTMLElement>(".ProseMirror");
    if (!prose) {
      throw new Error("ProseMirror root missing when updating editability.");
    }
    prose.contentEditable = editable ? "true" : "false";
    prose.setAttribute("aria-disabled", editable ? "false" : "true");
  };

  const updateHeaderFooterEditability = () => {
    const overlays = overlayLayer.querySelectorAll<HTMLElement>(".leditor-page-overlay");
    overlays.forEach((overlay) => {
      const { header, footer } = getOverlayHeaderFooter(overlay);
      setRegionEditable(header, headerFooterMode && activeRegion === "header");
      setRegionEditable(footer, headerFooterMode && activeRegion === "footer");
    });
  };

  const focusHeaderFooterRegion = (region: "header" | "footer") => {
    const overlay = overlayLayer.querySelector<HTMLElement>(".leditor-page-overlay");
    if (!overlay) {
      throw new Error("Header/footer overlay missing for focus.");
    }
    const target = overlay.querySelector<HTMLElement>(
      region === "header" ? ".leditor-page-header" : ".leditor-page-footer"
    );
    if (!target) {
      throw new Error(`Header/footer region "${region}" missing.`);
    }
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    target.focus();
  };

  const focusBody = () => {
    const prose = editorEl.querySelector<HTMLElement>(".ProseMirror");
    if (!prose) {
      throw new Error("ProseMirror root missing for body focus.");
    }
    prose.focus();
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

  const getSectionHeaderContent = (sectionId: string) => sectionHeaderContent.get(sectionId) ?? headerHtml;
  const getSectionFooterContent = (sectionId: string) => sectionFooterContent.get(sectionId) ?? footerHtml;

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
        footer.innerHTML = normalizeHeaderFooterHtml(getSectionFooterContent(sectionId));
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
    const footers = overlayLayer.querySelectorAll(".leditor-page-footer");
    footers.forEach((footer, index) => {
      const pageNumber = footer.querySelector(".leditor-page-number");
      if (pageNumber) {
        pageNumber.textContent = String(index + 1);
      }
    });
  };

  const determineFootnotePageIndex = (node: HTMLElement, pageHeight: number, editorRect: DOMRect) => {
    if (pageHeight <= 0) return 0;
    const markerRect = node.getBoundingClientRect();
    const relativeTop = Math.max(0, markerRect.top - editorRect.top);
    const rawIndex = Math.floor(relativeTop / pageHeight);
    return clamp(rawIndex, 0, Math.max(0, pageCount - 1));
  };

  const renderEndnotes = (entries: FootnoteEntry[]) => {
    endnotesList.innerHTML = "";
    if (entries.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "leditor-endnote-empty";
      placeholder.textContent = "No endnotes yet.";
      endnotesList.appendChild(placeholder);
      return;
    }
    const list = document.createElement("ol");
    list.className = "leditor-endnotes-entries";
    entries.forEach((entry) => {
      const item = document.createElement("li");
      item.className = "leditor-endnote-entry";
      const number = document.createElement("span");
      number.className = "leditor-endnote-entry-number";
      number.textContent = entry.number;
      const text = document.createElement("span");
      text.className = "leditor-endnote-entry-text";
      text.textContent = entry.text.trim().length > 0 ? entry.text : "Empty endnote";
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
      const text = view?.getPlainText() || "";
      const rawKind = (node.dataset.footnoteKind ?? "footnote").toLowerCase();
      const pageIndex = rawKind === "footnote" ? determineFootnotePageIndex(node, pageHeight, editorRect) : 0;
      const normalizedKind: FootnoteKind = rawKind === "endnote" ? "endnote" : "footnote";
      entries.push({
        footnoteId: id || `fn-${numberLabel}-${pageIndex}`,
        number: numberLabel,
        text,
        kind: normalizedKind,
        pageIndex
      });
    }
    return entries;
  };

  const renderFootnoteSections = () => {
    const containers = Array.from(
      appRoot.querySelectorAll<HTMLElement>(".leditor-page .leditor-page-footnotes")
    );
    const entries = collectFootnoteEntries();
    const footnoteMap = new Map<number, FootnoteEntry[]>();
    const endnoteEntries: FootnoteEntry[] = [];
    entries.forEach((entry) => {
      if (entry.kind === "endnote") {
        endnoteEntries.push(entry);
        return;
      }
      const pageList = footnoteMap.get(entry.pageIndex) ?? [];
      pageList.push(entry);
      footnoteMap.set(entry.pageIndex, pageList);
    });
    containers.forEach((container) => {
      const parent = container.closest<HTMLElement>(".leditor-page");
      const pageIndex = Number(parent?.dataset.pageIndex ?? "0");
      container.innerHTML = "";
      const pageEntries = footnoteMap.get(pageIndex) ?? [];
      const hasEntries = pageEntries.length > 0;
      container.classList.toggle("leditor-page-footnotes--active", hasEntries);
      if (!hasEntries) {
        return;
      }
      const list = document.createElement("ol");
      list.className = "leditor-footnote-list";
      pageEntries.forEach((entry) => {
        const item = document.createElement("li");
        item.className = "leditor-footnote-entry";
        const number = document.createElement("span");
        number.className = "leditor-footnote-entry-number";
        number.textContent = entry.number;
        const text = document.createElement("span");
        text.className = "leditor-footnote-entry-text";
        text.textContent = entry.text.trim().length > 0 ? entry.text : "Empty footnote";
        item.appendChild(number);
        item.appendChild(text);
        list.appendChild(item);
      });
      container.appendChild(list);
    });
    renderEndnotes(endnoteEntries);
    scheduleFootnoteHeightMeasurement();
  };

  let footnoteHeightHandle = 0;
  function scheduleFootnoteHeightMeasurement() {
    if (footnoteHeightHandle) return;
    footnoteHeightHandle = window.requestAnimationFrame(() => {
      footnoteHeightHandle = 0;
      const footnoteContainers = Array.from(
        appRoot.querySelectorAll<HTMLElement>(".leditor-page .leditor-page-footnotes")
      );
      let maxHeight = 0;
      footnoteContainers.forEach((container) => {
        const host =
          container.closest<HTMLElement>(".leditor-page") ?? container.closest<HTMLElement>(".leditor-page-overlay");
        const height = Math.max(0, Math.round(container.getBoundingClientRect().height));
        container.style.setProperty("--page-footnote-height", `${height}px`);
        if (host) {
          host.style.setProperty("--page-footnote-height", `${height}px`);
        }
        if (height > maxHeight) {
          maxHeight = height;
        }
      });
      zoomLayer.style.setProperty("--page-footnote-height", `${maxHeight}px`);
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
    header.contentEditable = "false";
    header.innerHTML = normalizeHeaderFooterHtml(headerHtml);
    const footer = document.createElement("div");
    footer.className = "leditor-page-footer";
    footer.contentEditable = "false";
    footer.innerHTML = normalizeHeaderFooterHtml(footerHtml);
    const footnotes = document.createElement("div");
    footnotes.className = "leditor-page-footnotes";
    footnotes.textContent = "";
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
    const footnotes = inner.querySelector<HTMLElement>(".leditor-page-footnotes");
    const footer = inner.querySelector<HTMLElement>(".leditor-page-footer");
    if (!header || !content || !footnotes || !footer) return;
    inner.appendChild(header);
    inner.appendChild(content);
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
    header.innerHTML = normalizeHeaderFooterHtml(headerHtml);
    header.setAttribute("aria-hidden", "true");
    header.contentEditable = "false";
    const footer = document.createElement("div");
    footer.className = "leditor-page-footer";
    footer.innerHTML = normalizeHeaderFooterHtml(footerHtml);
    footer.setAttribute("aria-hidden", "true");
    footer.contentEditable = "false";
    const footnotes = document.createElement("div");
    footnotes.className = "leditor-page-footnotes";
    footnotes.setAttribute("aria-hidden", "true");
    footnotes.contentEditable = "false";
    const content = document.createElement("div");
    content.className = "leditor-page-content";
    content.contentEditable = "true";
    content.setAttribute("role", "textbox");
    content.setAttribute("translate", "no");
    inner.appendChild(header);
    inner.appendChild(content);
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

  const attachEditorForMode = () => {
    if (editorEl.parentElement !== pageStack) {
      pageStack.appendChild(editorEl);
    }
    editorEl.style.width = "100%";
    overlayLayer.style.display = "";
    pageStack.style.pointerEvents = "auto";
    pageStack.style.zIndex = "2";
    overlayLayer.style.pointerEvents = "none";
    overlayLayer.style.zIndex = "1";
    headerFooterMode = false;
    activeRegion = null;
    appRoot.classList.remove("leditor-header-footer-editing");
    const prose = editorEl.querySelector<HTMLElement>(".ProseMirror");
    if (!prose) {
      throw new Error("ProseMirror root missing after attach.");
    }
    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl || !editorEl.contains(activeEl)) {
      prose.focus({ preventScroll: true });
    }
    updateHeaderFooterEditability();
    setEditorEditable(true);
    if (!didLogLayoutDebug) {
      didLogLayoutDebug = true;
      console.info("[Footnote][debug] attachEditorForMode", {
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
        headerFooterMode
      });
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

  const CONTENT_FRAME_MAX_PX = 700;
  const CONTENT_FRAME_MIN_PX = 200;
  let manualContentFrameHeight: number | null = null;
  const clampContentFrameHeight = (value: number) =>
    Math.max(CONTENT_FRAME_MIN_PX, Math.min(CONTENT_FRAME_MAX_PX, Math.round(value)));
  const updateContentHeight = () => {
    const pageHeight = measurePageHeight();
    const gap = measurePageGap();
    if (pageHeight <= 0) return;
    const total = pageCount * pageHeight + Math.max(0, pageCount - 1) * gap;
    const nextHeight = manualContentFrameHeight ?? Math.ceil(total);
    const clamped = clampContentFrameHeight(nextHeight);
    pageStack.style.minHeight = `${clamped}px`;
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
    const scrollTopBefore = canvas.scrollTop;
    const scrollLeftBefore = canvas.scrollLeft;
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
    } finally {
      const now = performance.now();
      if (now - lastUserScrollAt < 250) {
        canvas.scrollTop = scrollTopBefore;
        canvas.scrollLeft = scrollLeftBefore;
      }
      suspendPageObserver = false;
    }
  };

  const requestPagination = () => {
    if (paginationQueued) return;
    paginationQueued = true;
    window.requestAnimationFrame(() => {
      paginationQueued = false;
      updatePagination();
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
    const targetWidth = columns * pageWidth + Math.max(0, columns - 1) * gap;
    if (targetWidth <= 0) return;
    const minZoom = getCssNumber(canvas, "--min-zoom", 0.3);
    const maxZoom = getCssNumber(canvas, "--max-zoom", 3);
    const nextZoom = clamp(containerWidth / targetWidth, minZoom, maxZoom);
    zoomValue = nextZoom;
    canvas.style.setProperty("--page-zoom", String(zoomValue));
    applyGridMode();
  };

  const setZoom = (value: number) => {
    const minZoom = getCssNumber(canvas, "--min-zoom", 0.3);
    const maxZoom = getCssNumber(canvas, "--max-zoom", 3);
    zoomValue = clamp(value, minZoom, maxZoom);
    viewMode = "single";
    canvas.style.setProperty("--page-zoom", String(zoomValue));
    if (appRoot?.classList.contains("leditor-app--show-ruler")) {
      const rulerTrack = canvas.querySelector<HTMLElement>(".leditor-ruler-track");
      if (rulerTrack) {
        rulerTrack.style.width = `calc(var(--page-width) * ${zoomValue})`;
      }
    }
    applyGridMode();
  };

  const setViewMode = (mode: A4ViewMode) => {
    viewMode = mode;
    pageStack.classList.toggle("is-two-page", mode === "two-page");
    overlayLayer.classList.toggle("is-two-page", mode === "two-page");
    if (mode === "single") {
      canvas.style.setProperty("--page-zoom", String(zoomValue));
      applyGridMode();
      return;
    }
    updateZoomForViewMode();
    applyGridMode();
  };

  const enterHeaderFooterMode = (target?: "header" | "footer") => {
    headerFooterMode = true;
    if (!target) {
      throw new Error("Header/footer edit mode requires an active region.");
    }
    activeRegion = target;
    appRoot.classList.add("leditor-header-footer-editing");
    overlayLayer.style.pointerEvents = "auto";
    updateHeaderFooterEditability();
    setEditorEditable(false);
    focusHeaderFooterRegion(target);
  };

  const exitHeaderFooterMode = () => {
    headerFooterMode = false;
    activeRegion = null;
    appRoot.classList.remove("leditor-header-footer-editing");
    overlayLayer.style.pointerEvents = "none";
    updateHeaderFooterEditability();
    setEditorEditable(true);
    focusBody();
  };

  const handleOverlayDblClick = (event: MouseEvent) => {
    if (headerFooterMode) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (target.classList.contains("leditor-page-header")) {
      enterHeaderFooterMode("header");
      return;
    }
    if (target.classList.contains("leditor-page-footer")) {
      enterHeaderFooterMode("footer");
    }
  };

  const handlePageHeaderFooterDblClick = (event: MouseEvent) => {
    if (headerFooterMode) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const header = target.closest<HTMLElement>(".leditor-page-header");
    if (header && pageStack.contains(header)) {
      event.preventDefault();
      enterHeaderFooterMode("header");
      return;
    }
    const footer = target.closest<HTMLElement>(".leditor-page-footer");
    if (footer && pageStack.contains(footer)) {
      event.preventDefault();
      enterHeaderFooterMode("footer");
    }
  };

  const handleOverlayInput = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    if (!headerFooterMode) {
      throw new Error("Header/footer input received outside edit mode.");
    }
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
    if (!target || (!target.classList.contains("leditor-page-header") && !target.classList.contains("leditor-page-footer"))) {
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
    if (event.ctrlKey && event.shiftKey && (event.key === "R" || event.key === "r")) {
      event.preventDefault();
      logLayoutDiagnostics();
      logMissingRibbonIcons();
      const win = window as typeof window & { __leditorPaginationDebug?: boolean };
      win.__leditorPaginationDebug = !win.__leditorPaginationDebug;
      console.info("[PaginationDebug] toggled", { enabled: win.__leditorPaginationDebug });
      return;
    }
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
    if (event.key === "Escape" && headerFooterMode) {
      exitHeaderFooterMode();
    }
  };

  const shouldForwardOverlayEvent = (target: HTMLElement | null): boolean => {
    if (!target) return false;
    return (
      !target.closest(".leditor-page-header") &&
      !target.closest(".leditor-page-footer") &&
      !target.closest(".leditor-page-footnotes") &&
      !target.closest(".leditor-margin-guide")
    );
  };

  const forwardOverlayInteraction = (event: MouseEvent | PointerEvent) => {
    if (!shouldForwardOverlayEvent(event.target as HTMLElement | null)) return;
    const prose = editorEl.querySelector<HTMLElement>(".ProseMirror");
    if (!prose) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const dispatchTarget = hit && prose.contains(hit) ? hit : prose;
    const mouseInit: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      button: "button" in event ? event.button : 0,
      buttons: "buttons" in event ? event.buttons : 1,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey
    };
    const forwarded =
      event instanceof PointerEvent
        ? new PointerEvent(event.type, {
            ...mouseInit,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            pressure: event.pressure,
            tiltX: event.tiltX,
            tiltY: event.tiltY,
            width: event.width,
            height: event.height,
            tangentialPressure: event.tangentialPressure
          })
        : new MouseEvent(event.type, mouseInit);
    dispatchTarget.dispatchEvent(forwarded);
    event.preventDefault();
    event.stopPropagation();
  };

  overlayLayer.addEventListener("pointerdown", forwardOverlayInteraction);
  overlayLayer.addEventListener("contextmenu", forwardOverlayInteraction);
  overlayLayer.addEventListener("dblclick", handleOverlayDblClick);
  pageStack.addEventListener("dblclick", handlePageHeaderFooterDblClick);
  overlayLayer.addEventListener("input", handleOverlayInput, true);
  overlayLayer.addEventListener("click", handleOverlayClick);
  document.addEventListener("keydown", handleKeydown);

  initTheme();
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
    updateZoomForViewMode();
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
      overlayLayer.removeEventListener("dblclick", handleOverlayDblClick);
      pageStack.removeEventListener("dblclick", handlePageHeaderFooterDblClick);
      overlayLayer.removeEventListener("input", handleOverlayInput, true);
      overlayLayer.removeEventListener("click", handleOverlayClick);
      document.removeEventListener("keydown", handleKeydown);
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



















