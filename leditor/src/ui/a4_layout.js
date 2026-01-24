"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mountA4Layout = void 0;
const extension_footnote_js_1 = require("../extensions/extension_footnote.js");
const section_state_js_1 = require("../editor/section_state.js");
const feature_flags_js_1 = require("./feature_flags.js");
const STYLE_ID = "leditor-a4-layout-styles";
const PAGE_BOUNDARY_KINDS = new Set(["page", "section_next", "section_even", "section_odd"]);
const DEFAULT_SECTION_ID = (0, section_state_js_1.allocateSectionId)();
const sectionHeaderContent = new Map();
const sectionFooterContent = new Map();
let pageSections = [];
const SECTION_KINDS = new Set(["section_next", "section_continuous", "section_even", "section_odd"]);
const A4_BUNDLE_ID = "a4-layout-src-2026-01-20";
const ensureStyles = () => {
    if (document.getElementById(STYLE_ID))
        return;
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
  --page-border-color: rgba(0, 0, 0, 0.18);
  --page-border-color-dark: rgba(255, 255, 255, 0.18);
  --page-border-width: 1px;
  --page-shadow: 0 16px 40px rgba(0, 0, 0, 0.2);
  --page-shadow-dark: 0 16px 40px rgba(0, 0, 0, 0.55);
  --page-gap: 22px;
  --page-margin-inside: 1.25in;
  --page-margin-outside: 1in;
  --column-separator-color: rgba(0, 0, 0, 0.25);
  --page-canvas-bg: radial-gradient(circle at 20% 20%, #f4f0e5 0%, #e8e1cf 55%, #d9d0bb 100%);
  --page-canvas-bg-dark: radial-gradient(circle at 30% 10%, #1a1f2b 0%, #111621 45%, #0d1018 100%);
  --min-zoom: 0.3;
  --max-zoom: 3;
  --zoom-step: 0.1;
  --page-zoom: 1;
  --ruler-height: 24px;
  --ruler-color: rgba(0, 0, 0, 0.55);
  --ruler-bg: rgba(255, 255, 255, 0.7);
  --ruler-border: rgba(0, 0, 0, 0.2);
  --page-font-family: "Times New Roman", "Georgia", serif;
  --page-font-size: 12pt;
  --page-line-height: 1.5;
  --ui-surface: rgba(255, 255, 255, 0.82);
  --ui-surface-dark: rgba(24, 28, 36, 0.85);
  --ui-text: #1b1b1b;
  --ui-text-inverse: #f7f7f7;
}
.leditor-app {
  position: relative;
  min-height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  background: var(--page-canvas-bg);
  overflow: hidden;
  color: var(--ui-text);
}

.leditor-app.theme-dark {
  --page-canvas-bg: var(--page-canvas-bg-dark);
  --page-border-color: var(--page-border-color-dark);
  --page-shadow: var(--page-shadow-dark);
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

.leditor-page-stack.is-two-page,
.leditor-page-overlays.is-two-page {
  display: grid;
  grid-template-columns: repeat(2, var(--page-width));
  justify-content: center;
  width: calc(var(--page-width) * 2 + var(--page-gap));
  margin: 0 auto;
}

.leditor-page-stack {
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
  padding: var(--local-page-margin-top, var(--page-margin-top)) var(--local-page-margin-right, var(--page-margin-right))
    var(--local-page-margin-bottom, var(--page-margin-bottom)) var(--local-page-margin-left, var(--page-margin-left));
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-sizing: border-box;
}

.leditor-page-content {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  column-count: var(--page-columns, 1);
  column-gap: 24px;
  overflow-y: auto;
  overflow-x: hidden;
  display: block;
  pointer-events: auto;
}

.leditor-page-header,
.leditor-page-footer {
  font-family: var(--page-font-family);
  font-size: 10pt;
  text-transform: uppercase;
  font-weight: bold;
  color: var(--page-header-color);
  min-height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 12px;
  box-sizing: border-box;
  flex: 0 0 auto;
}

.leditor-page-header {
  margin-top: 0;
}

.leditor-page-footer {
  margin-top: auto;
  color: var(--page-footer-color);
  text-transform: none;
}

.leditor-page-footnotes {
  flex: 0 0 auto;
  width: 100%;
  min-height: 0;
  overflow: hidden;
  font-size: var(--footnote-font-size);
  color: var(--page-footnote-color);
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
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: var(--page-width);
  z-index: 2;
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
  color: #222222;
  outline: 1px dashed rgba(69, 82, 107, 0.6);
  background: rgba(255, 255, 255, 0.85);
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
  bottom: calc(
    var(--current-margin-bottom, var(--page-margin-bottom)) + var(--footer-offset)
  );
  height: var(--footer-height);
}

.leditor-page-overlay .leditor-page-footnotes {
  position: absolute;
  left: var(--current-margin-left, var(--page-margin-left));
  right: var(--current-margin-right, var(--page-margin-right));
  bottom: calc(
    var(--current-margin-bottom, var(--page-margin-bottom)) +
      var(--footer-offset) +
      var(--footer-height)
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
  outline: none;
  border: none;
  box-shadow: none;
  background: transparent;
  font-family: var(--page-font-family);
  font-size: var(--page-font-size);
  line-height: var(--page-line-height);
  color: #1e1e1e;
  min-height: 1px;
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

#editor .ProseMirror table,
#editor .ProseMirror figure,
#editor .ProseMirror img {
  page-break-inside: avoid;
  break-inside: avoid;
}

#editor .ProseMirror table tr {
  break-inside: avoid;
}

.leditor-comment,
.leditor-change {
  break-inside: avoid;
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
  width: var(--page-width);
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
  width: var(--page-width);
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
`;
    document.head.appendChild(style);
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const getCssNumber = (element, name, fallback) => {
    const raw = getComputedStyle(element).getPropertyValue(name).trim();
    if (!raw)
        return fallback;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
};
const countManualPageBreaks = (editorEl) => {
    const breaks = editorEl.querySelectorAll(".leditor-break[data-break-kind]");
    let count = 0;
    breaks.forEach((node) => {
        const kind = node.dataset.breakKind;
        if (kind && PAGE_BOUNDARY_KINDS.has(kind)) {
            count += 1;
        }
    });
    return count;
};
const mountA4Layout = (appRoot, editorEl, options = {}) => {
    console.info("[A4Debug] mountA4Layout", { bundle: A4_BUNDLE_ID });
    ensureStyles();
    const canvas = document.createElement("div");
    canvas.className = "leditor-a4-canvas";
    const ruler = document.createElement("div");
    ruler.className = "leditor-ruler";
    const rulerTrack = document.createElement("div");
    rulerTrack.className = "leditor-ruler-track";
    for (let i = 0; i <= 10; i += 1) {
        const tick = document.createElement("div");
        tick.className = "leditor-ruler-tick";
        tick.textContent = `${i}`;
        rulerTrack.appendChild(tick);
    }
    ruler.appendChild(rulerTrack);
    const zoomLayer = document.createElement("div");
    zoomLayer.className = "leditor-a4-zoom";
    const pageStack = document.createElement("div");
    pageStack.className = "leditor-page-stack";
    const overlayLayer = document.createElement("div");
    overlayLayer.className = "leditor-page-overlays";
    zoomLayer.appendChild(pageStack);
    zoomLayer.appendChild(overlayLayer);
    canvas.appendChild(ruler);
    canvas.appendChild(zoomLayer);
    appRoot.appendChild(canvas);
    let pageCount = 1;
    let viewMode = "single";
    let zoomValue = 1;
    let headerHtml = options.headerHtml ?? "";
    let footerHtml = options.footerHtml ?? "<span class=\"leditor-page-number\"></span>";
    let headerFooterMode = false;
    let activeRegion = null;
    let themeMode = "light";
    let pageSurfaceMode = "light";
    const THEME_STORAGE_KEY = "leditor:theme";
    const PAGE_SURFACE_STORAGE_KEY = "leditor:page-surface";
    let paginationQueued = false;
    const paginationEnabled = feature_flags_js_1.featureFlags.paginationEnabled;
    const normalizeHeaderFooterHtml = (html) => html.replace(/\{pageNumber\}/gi, '<span class="leditor-page-number"></span>');
    const setRegionEditable = (element, editable) => {
        element.contentEditable = editable ? "true" : "false";
        element.tabIndex = editable ? 0 : -1;
        element.setAttribute("aria-disabled", editable ? "false" : "true");
    };
    const setEditorEditable = (editable) => {
        const prose = editorEl.querySelector(".ProseMirror");
        if (!prose) {
            throw new Error("ProseMirror root missing when updating editability.");
        }
        prose.contentEditable = editable ? "true" : "false";
        prose.setAttribute("aria-disabled", editable ? "false" : "true");
    };
    const getSectionHeaderContent = (sectionId) => sectionHeaderContent.get(sectionId) ?? headerHtml;
    const getSectionFooterContent = (sectionId) => sectionFooterContent.get(sectionId) ?? footerHtml;
    const syncHeaderFooter = () => {
        const overlays = overlayLayer.querySelectorAll(".leditor-page-overlay");
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
    };
    const applyTheme = (mode, surface = pageSurfaceMode) => {
        themeMode = mode;
        pageSurfaceMode = surface;
        appRoot.classList.toggle("theme-dark", themeMode === "dark");
        appRoot.classList.toggle("theme-light", themeMode === "light");
        appRoot.classList.toggle("page-surface-dark", pageSurfaceMode === "dark");
        try {
            localStorage.setItem(THEME_STORAGE_KEY, themeMode);
            localStorage.setItem(PAGE_SURFACE_STORAGE_KEY, pageSurfaceMode);
        }
        catch (error) {
            console.warn("theme persistence failed", error);
        }
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
        }
        catch {
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
    const collectFootnoteEntries = () => {
        const registry = (0, extension_footnote_js_1.getFootnoteRegistry)();
        const nodes = Array.from(editorEl.querySelectorAll(".leditor-footnote"));
        const entries = [];
        let fallbackCounter = 0;
        for (const node of nodes) {
            const id = node.dataset.footnoteId;
            const view = id ? registry.get(id) : null;
            const number = view?.getNumber() || node.dataset.footnoteNumber || "";
            const text = view?.getPlainText() || "";
            fallbackCounter += 1;
            entries.push({ number: number || String(fallbackCounter), text });
        }
        return entries;
    };
    const renderFootnoteSections = () => {
        const containers = Array.from(appRoot.querySelectorAll(".leditor-page-footnotes"));
        const entries = collectFootnoteEntries();
        for (const container of containers) {
            const parent = container.closest(".leditor-page, .leditor-page-overlay");
            const pageIndex = parent?.dataset.pageIndex ?? "0";
            container.innerHTML = "";
            if (pageIndex !== "0" || entries.length === 0) {
                continue;
            }
            const list = document.createElement("ol");
            list.className = "leditor-footnote-list";
            entries.forEach((entry) => {
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
        }
    };
    let footnoteUpdateHandle = 0;
    const scheduleFootnoteUpdate = () => {
        if (footnoteUpdateHandle)
            return;
        footnoteUpdateHandle = window.requestAnimationFrame(() => {
            footnoteUpdateHandle = 0;
            renderFootnoteSections();
        });
    };
    const buildOverlayPage = (index) => {
        const overlay = document.createElement("div");
        overlay.className = "leditor-page-overlay";
        overlay.dataset.pageIndex = String(index);
        const header = document.createElement("div");
        header.className = "leditor-page-header";
        header.contentEditable = "true";
        header.innerHTML = normalizeHeaderFooterHtml(headerHtml);
        const footer = document.createElement("div");
        footer.className = "leditor-page-footer";
        footer.contentEditable = "true";
        footer.innerHTML = normalizeHeaderFooterHtml(footerHtml);
        const footnotes = document.createElement("div");
        footnotes.className = "leditor-page-footnotes";
        footnotes.textContent = "";
        const marginGuide = document.createElement("div");
        marginGuide.className = "leditor-margin-guide";
        overlay.appendChild(header);
        overlay.appendChild(footer);
        overlay.appendChild(footnotes);
        overlay.appendChild(marginGuide);
        return overlay;
    };
    const buildPageShell = (index) => {
        const page = document.createElement("div");
        page.className = "leditor-page";
        page.dataset.pageIndex = String(index);
        const inner = document.createElement("div");
        inner.className = "leditor-page-inner";
        const header = document.createElement("div");
        header.className = "leditor-page-header";
        header.innerHTML = normalizeHeaderFooterHtml(headerHtml);
        const footer = document.createElement("div");
        footer.className = "leditor-page-footer";
        footer.innerHTML = normalizeHeaderFooterHtml(footerHtml);
        const footnotes = document.createElement("div");
        footnotes.className = "leditor-page-footnotes";
        const content = document.createElement("div");
        content.className = "leditor-page-content";
        content.contentEditable = "true";
        content.setAttribute("role", "textbox");
        content.setAttribute("translate", "no");
        inner.appendChild(header);
        inner.appendChild(content);
        inner.appendChild(footnotes);
        inner.appendChild(footer);
        page.appendChild(inner);
        const columnGuide = document.createElement("div");
        columnGuide.className = "leditor-page-column-guide";
        page.appendChild(columnGuide);
        return page;
    };
    const updateColumnGuide = (page, columns) => {
        const guide = page.querySelector(".leditor-page-column-guide");
        if (!guide)
            return;
        guide.innerHTML = "";
        for (let i = 1; i < columns; i += 1) {
            guide.appendChild(document.createElement("span"));
        }
    };
    const computeSectionStartPage = (kind, element, pageHeight, editorRect, pageCount) => {
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
    const computePageSections = (count) => {
        if (count <= 0)
            return [];
        const sections = [
            { startPage: 0, sectionId: DEFAULT_SECTION_ID, meta: { ...section_state_js_1.defaultSectionMeta } }
        ];
        const pageHeight = measurePageHeight();
        if (pageHeight > 0) {
            const editorRect = editorEl.getBoundingClientRect();
            Array.from(editorEl.querySelectorAll(".leditor-break[data-break-kind]")).forEach((node, index) => {
                const element = node;
                const kind = element.dataset.breakKind;
                if (!kind || !SECTION_KINDS.has(kind))
                    return;
                const startPage = computeSectionStartPage(kind, element, pageHeight, editorRect, count);
                if (startPage >= count)
                    return;
                const sectionId = element.dataset.sectionId ?? `${DEFAULT_SECTION_ID}-${index + 1}`;
                const meta = (0, section_state_js_1.parseSectionMeta)(element.dataset.sectionSettings);
                sections.push({ startPage, sectionId, meta });
            });
        }
        sections.sort((a, b) => a.startPage - b.startPage);
        const pageInfos = [];
        let boundaryIndex = 0;
        for (let pageIndex = 0; pageIndex < count; pageIndex += 1) {
            while (boundaryIndex + 1 < sections.length &&
                pageIndex >= sections[boundaryIndex + 1].startPage) {
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
    const setOverlayMarginVars = (overlay, top, bottom, left, right) => {
        overlay.style.setProperty("--current-margin-top", top);
        overlay.style.setProperty("--current-margin-bottom", bottom);
        overlay.style.setProperty("--current-margin-left", left);
        overlay.style.setProperty("--current-margin-right", right);
        overlay.style.setProperty("--local-page-margin-top", top);
        overlay.style.setProperty("--local-page-margin-bottom", bottom);
        overlay.style.setProperty("--local-page-margin-left", left);
        overlay.style.setProperty("--local-page-margin-right", right);
    };
    const applySectionStyling = (page, sectionInfo, index) => {
        const info = sectionInfo ?? {
            sectionId: DEFAULT_SECTION_ID,
            meta: section_state_js_1.defaultSectionMeta,
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
        const resolvedBottomMargin = computedStyle.getPropertyValue("--local-page-margin-bottom").trim() || bottomMargin;
        const resolvedLeftMargin = computedStyle.getPropertyValue("--local-page-margin-left").trim() || leftMargin;
        const resolvedRightMargin = computedStyle.getPropertyValue("--local-page-margin-right").trim() || rightMargin;
        if (index === 0) {
            pageStack.style.setProperty("--local-page-width", width);
            pageStack.style.setProperty("--local-page-height", height);
            pageStack.style.setProperty("--current-margin-top", resolvedTopMargin || PAGE_MARGIN_TOP_VAR);
            pageStack.style.setProperty("--current-margin-bottom", resolvedBottomMargin || PAGE_MARGIN_BOTTOM_VAR);
            pageStack.style.setProperty("--current-margin-left", resolvedLeftMargin || leftMargin);
            pageStack.style.setProperty("--current-margin-right", resolvedRightMargin || rightMargin);
        }
        const columns = Math.max(1, info.meta.columns ?? 1);
        updateColumnGuide(page, columns);
        return { left: leftMargin, right: rightMargin };
    };
    const applySectionLayouts = (count) => {
        pageSections = computePageSections(count);
        const sectionOrder = [];
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
        const pages = Array.from(pageStack.children);
        const overlays = Array.from(overlayLayer.children);
        pages.forEach((page, index) => {
            const margins = applySectionStyling(page, pageSections[index] ?? null, index);
            const overlay = overlays[index];
            if (overlay) {
                setOverlayMarginVars(overlay, "var(--local-page-margin-top, var(--page-margin-top))", "var(--local-page-margin-bottom, var(--page-margin-bottom))", margins.left, margins.right);
                const sectionInfo = pageSections[index];
                overlay.dataset.sectionId = sectionInfo ? sectionInfo.sectionId : DEFAULT_SECTION_ID;
            }
        });
    };
    const attachEditorForMode = () => {
        if (editorEl.parentElement !== pageStack) {
            pageStack.appendChild(editorEl);
        }
        editorEl.style.width = "100%";
        overlayLayer.style.display = "";
        const prose = editorEl.querySelector(".ProseMirror");
        if (!prose) {
            throw new Error("ProseMirror root missing after attach.");
        }
        prose.focus();
        setEditorEditable(true);
    };
    const renderPages = (count) => {
        if (paginationEnabled) {
            pageStack.innerHTML = "";
            overlayLayer.innerHTML = "";
            attachEditorForMode();
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
    };
    const measurePageHeight = () => {
        const page = pageStack.querySelector(".leditor-page");
        if (!page)
            return 0;
        return page.getBoundingClientRect().height;
    };
    const measurePageGap = () => {
        const styles = getComputedStyle(pageStack);
        const gap = Number.parseFloat(styles.rowGap || styles.gap || "0");
        return Number.isFinite(gap) ? gap : 0;
    };
    const CONTENT_FRAME_MAX_PX = 700;
    const CONTENT_FRAME_MIN_PX = 200;
    let manualContentFrameHeight = null;
    const clampContentFrameHeight = (value) => Math.max(CONTENT_FRAME_MIN_PX, Math.min(CONTENT_FRAME_MAX_PX, Math.round(value)));
    const updateContentHeight = () => {
        const pageHeight = measurePageHeight();
        const gap = measurePageGap();
        if (pageHeight <= 0)
            return;
        const total = pageCount * pageHeight + Math.max(0, pageCount - 1) * gap;
        const nextHeight = manualContentFrameHeight ?? Math.ceil(total);
        const clamped = clampContentFrameHeight(nextHeight);
        pageStack.style.minHeight = `${clamped}px`;
    };
    const computeHeightPages = () => {
        const pageHeight = measurePageHeight();
        if (pageHeight <= 0)
            return 1;
        const gap = measurePageGap();
        const contentHeight = editorEl.scrollHeight;
        const total = pageHeight + gap;
        return Math.max(1, Math.ceil((contentHeight + gap) / total));
    };
  const updatePagination = () => {
    const overlayPageCount = overlayLayer.children.length;
    const editorPageCount = editorEl.querySelectorAll(".leditor-page").length;
    const firstOverlay = overlayLayer.querySelector(".leditor-page-overlay");
    const overlayInfo = {
      overlayPageCount,
      overlayVisible: overlayLayer.style.display || window.getComputedStyle(overlayLayer).display,
      overlayHeight: (firstOverlay === null || firstOverlay === void 0 ? void 0 : firstOverlay.offsetHeight) ?? null,
      overlayWidth: (firstOverlay === null || firstOverlay === void 0 ? void 0 : firstOverlay.offsetWidth) ?? null
    };
    const pageStackInfo = {
      stackChildCount: pageStack.children.length,
      stackDisplay: pageStack.style.display || window.getComputedStyle(pageStack).display,
      stackPointerEvents: pageStack.style.pointerEvents
    };
    const pageStackRect = pageStack.getBoundingClientRect();
    const editorRect = editorEl.getBoundingClientRect();
    console.info("[PaginationDebug] pagination state", {
      paginationEnabled,
      pageCount,
      editorPageCount,
      overlayInfo,
      pageStackInfo,
      pageStackHeight: pageStackRect.height,
      pageStackWidth: pageStackRect.width,
      editorHeight: editorRect.height,
      editorWidth: editorRect.width,
      editorScrollHeight: editorEl.scrollHeight,
      editorScrollWidth: editorEl.scrollWidth
    });
    const ensureOverlayPages = (count) => {
      if (overlayLayer.children.length === 0) {
        renderPages(count);
        return true;
      }
      return false;
    };
    if (paginationEnabled) {
      const nextCount = Math.max(1, editorEl.querySelectorAll(".leditor-page").length);
      if (ensureOverlayPages(nextCount)) {
        return;
      }
      if (nextCount !== pageCount) {
        pageCount = nextCount;
        renderPages(pageCount);
      }
      else {
        applySectionLayouts(pageCount);
        syncHeaderFooter();
        updatePageNumbers();
      }
      return;
    }
    const heightCount = computeHeightPages();
    const manualCount = countManualPageBreaks(editorEl) + 1;
    const nextCount = Math.max(heightCount, manualCount);
    if (nextCount !== pageCount) {
      pageCount = nextCount;
      renderPages(pageCount);
    }
    else {
      applySectionLayouts(pageCount);
      syncHeaderFooter();
    }
    updateContentHeight();
  };
    const requestPagination = () => {
        if (paginationQueued)
            return;
        paginationQueued = true;
        window.requestAnimationFrame(() => {
            paginationQueued = false;
            updatePagination();
        });
    };
    const setContentFrameHeight = (value) => {
        if (!Number.isFinite(value)) {
            throw new Error("Content frame height must be a finite number.");
        }
        manualContentFrameHeight = clampContentFrameHeight(value);
        updateContentHeight();
        requestPagination();
    };
    const adjustContentFrameHeight = (delta) => {
        if (!Number.isFinite(delta)) {
            throw new Error("Content frame height delta must be finite.");
        }
        const base = manualContentFrameHeight ?? CONTENT_FRAME_MAX_PX;
        manualContentFrameHeight = clampContentFrameHeight(base + delta);
        updateContentHeight();
        requestPagination();
    };
    const resetContentFrameHeight = () => {
        manualContentFrameHeight = null;
        updateContentHeight();
        requestPagination();
    };
    const updateZoomForViewMode = () => {
        if (viewMode === "single")
            return;
        const containerWidth = canvas.getBoundingClientRect().width;
        const pageWidth = pageStack.querySelector(".leditor-page")?.getBoundingClientRect().width;
        if (!pageWidth || containerWidth <= 0)
            return;
        const gap = measurePageGap();
        const columns = viewMode === "two-page" ? 2 : 1;
        const targetWidth = columns * pageWidth + Math.max(0, columns - 1) * gap;
        if (targetWidth <= 0)
            return;
        const minZoom = getCssNumber(canvas, "--min-zoom", 0.3);
        const maxZoom = getCssNumber(canvas, "--max-zoom", 3);
        const nextZoom = clamp(containerWidth / targetWidth, minZoom, maxZoom);
        zoomValue = nextZoom;
        canvas.style.setProperty("--page-zoom", String(zoomValue));
    };
    const setZoom = (value) => {
        const minZoom = getCssNumber(canvas, "--min-zoom", 0.3);
        const maxZoom = getCssNumber(canvas, "--max-zoom", 3);
        zoomValue = clamp(value, minZoom, maxZoom);
        viewMode = "single";
        canvas.style.setProperty("--page-zoom", String(zoomValue));
    };
    const setViewMode = (mode) => {
        viewMode = mode;
        pageStack.classList.toggle("is-two-page", mode === "two-page");
        overlayLayer.classList.toggle("is-two-page", mode === "two-page");
        if (mode === "single") {
            canvas.style.setProperty("--page-zoom", String(zoomValue));
            return;
        }
        updateZoomForViewMode();
    };
    const enterHeaderFooterMode = (target) => {
        headerFooterMode = true;
        activeRegion = target ?? null;
        appRoot.classList.add("leditor-header-footer-editing");
    };
    const exitHeaderFooterMode = () => {
        headerFooterMode = false;
        activeRegion = null;
        appRoot.classList.remove("leditor-header-footer-editing");
    };
    const handleOverlayDblClick = (event) => {
        const target = event.target;
        if (!target)
            return;
        if (target.classList.contains("leditor-page-header")) {
            enterHeaderFooterMode("header");
            target.focus();
            return;
        }
        if (target.classList.contains("leditor-page-footer")) {
            enterHeaderFooterMode("footer");
            target.focus();
        }
    };
    const handleOverlayInput = (event) => {
        const target = event.target;
        if (!target)
            return;
        const overlay = target.closest(".leditor-page-overlay");
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
    const handleOverlayClick = (event) => {
        if (!headerFooterMode)
            return;
        const target = event.target;
        if (!target || (!target.classList.contains("leditor-page-header") && !target.classList.contains("leditor-page-footer"))) {
            exitHeaderFooterMode();
        }
    };
    const logLayoutDiagnostics = () => {
        const page = pageStack.querySelector(".leditor-page");
        const content = page?.querySelector(".leditor-page-content");
        const header = page?.querySelector(".leditor-page-header");
        const footer = page?.querySelector(".leditor-page-footer");
        const footnotes = page?.querySelector(".leditor-page-footnotes");
        const overlay = overlayLayer.querySelector(".leditor-page-overlay");
        const pageRect = page?.getBoundingClientRect() ?? null;
        const contentRect = content?.getBoundingClientRect() ?? null;
        const headerRect = header?.getBoundingClientRect() ?? null;
        const footerRect = footer?.getBoundingClientRect() ?? null;
        const footnoteRect = footnotes?.getBoundingClientRect() ?? null;
        const overlayRect = overlay?.getBoundingClientRect() ?? null;
        const pageStackRect = pageStack.getBoundingClientRect();
        const metrics = {
            pageHeight: pageRect?.height ?? null,
            pageWidth: pageRect?.width ?? null,
            contentHeight: contentRect?.height ?? null,
            contentInsetTop: pageRect && contentRect ? contentRect.top - pageRect.top : null,
            contentInsetBottom: pageRect && contentRect ? pageRect.bottom - contentRect.bottom : null,
            headerHeight: headerRect?.height ?? null,
            footerHeight: footerRect?.height ?? null,
            footnoteHeight: footnoteRect?.height ?? null,
            overlayHeight: overlayRect?.height ?? null,
            headerFooterMode,
            editorScrollHeight: editorEl.scrollHeight,
            pageStackHeight: pageStackRect.height,
            pageStackScrollHeight: pageStack.scrollHeight
        };
        console.info("[A4 layout debug]", metrics);
    };
    const handleKeydown = (event) => {
        if (event.ctrlKey && event.shiftKey && (event.key === "R" || event.key === "r")) {
            event.preventDefault();
            logLayoutDiagnostics();
            const win = window;
            win.__leditorPaginationDebug = !win.__leditorPaginationDebug;
            console.info("[PaginationDebug] toggled", { enabled: win.__leditorPaginationDebug });
            return;
        }
        if (event.ctrlKey && event.shiftKey && (event.key === "M" || event.key === "m")) {
            event.preventDefault();
            const next = !appRoot.classList.contains("leditor-debug-margins");
            appRoot.classList.toggle("leditor-debug-margins", next);
            const proseMirror = editorEl.querySelector(".ProseMirror");
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
                const overlay = overlayLayer.querySelector(".leditor-page-overlay");
                const guide = overlay?.querySelector(".leditor-margin-guide");
                const guideRect = guide?.getBoundingClientRect();
                const pageRect = overlay?.getBoundingClientRect();
                console.info("[A4 margins]", { info, pageRect, guideRect, proseRect, debugMargins: next });
            }
            if (!next) {
                console.info("[A4 margins] shortcut focus", { proseRect, debugMargins: next });
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
    overlayLayer.addEventListener("dblclick", handleOverlayDblClick);
    overlayLayer.addEventListener("input", handleOverlayInput, true);
    overlayLayer.addEventListener("click", handleOverlayClick);
    document.addEventListener("keydown", handleKeydown);
    initTheme();
    renderPages(pageCount);
    updatePagination();
    scheduleFootnoteUpdate();
    const footnoteObserver = new MutationObserver(() => scheduleFootnoteUpdate());
    footnoteObserver.observe(editorEl, { childList: true, subtree: true, characterData: true });
    const pageObserver = new MutationObserver(() => requestPagination());
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
            const overlay = overlayLayer.querySelector(".leditor-page-overlay");
            const guide = overlay?.querySelector(".leditor-margin-guide");
            const guideRect = guide?.getBoundingClientRect();
            const pageRect = overlay?.getBoundingClientRect();
            const stackRect = pageStack.getBoundingClientRect();
            console.info("[A4 margins]", { info, pageRect, guideRect, stackRect });
        },
        toggle(force) {
            const next = force === undefined ? !appRoot.classList.contains("leditor-debug-margins") : !!force;
            appRoot.classList.toggle("leditor-debug-margins", next);
            if (next) {
                this.log();
            }
            return next;
        }
    };
    window.leditorMarginDebug = marginDebug;
    const themeControl = {
        set(mode, surface) {
            applyTheme(mode, surface ?? pageSurfaceMode);
        },
        toggle: toggleTheme,
        togglePageSurface,
        get() {
            return { mode: themeMode, surface: pageSurfaceMode };
        }
    };
    window.leditorTheme = themeControl;
    const resizeObserver = new ResizeObserver(() => {
        requestPagination();
        updateZoomForViewMode();
    });
    resizeObserver.observe(pageStack);
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
            overlayLayer.removeEventListener("dblclick", handleOverlayDblClick);
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
        setHeaderContent(html) {
            headerHtml = html;
            syncHeaderFooter();
        },
        setFooterContent(html) {
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
        setContentFrameHeight,
        adjustContentFrameHeight,
        resetContentFrameHeight,
        getTheme() {
            return { mode: themeMode, surface: pageSurfaceMode };
        }
    };
};
exports.mountA4Layout = mountA4Layout;
