import type { EditorHandle } from "../api/leditor.ts";

import { TextSelection } from "@tiptap/pm/state";

import type { Editor } from "@tiptap/core";



const APP_CLASS_READ = "leditor-app--read-mode";

const APP_CLASS_HORIZONTAL = "leditor-app--horizontal-scroll";

const APP_CLASS_RULER = "leditor-app--show-ruler";
const APP_CLASS_PAGE_BOUNDARIES = "leditor-app--show-page-boundaries";
const APP_CLASS_PAGE_BREAKS = "leditor-app--show-page-breaks";
const APP_CLASS_PAGINATION_CONTINUOUS = "leditor-app--pagination-continuous";

const APP_CLASS_GRID = "leditor-app--show-gridlines";

const NAV_PANEL_ID = "leditor-navigation-panel";



let appRoot: HTMLElement | null = null;

let navPanel: HTMLElement | null = null;

let navVisible = false;
let readModeActive = false;
let scrollDirectionState: "vertical" | "horizontal" = "vertical";
let rulerVisibleState = false;
let gridVisibleState = false;
let pageBoundariesVisibleState = true;
let pageBreakMarksVisibleState = true;
let paginationModeState: "paged" | "continuous" = "paged";



const ensureNavPanel = (): HTMLElement | null => {

  if (!appRoot) {

    return null;

  }

  if (navPanel) {

    return navPanel;

  }

  navPanel = document.createElement("div");

  navPanel.id = NAV_PANEL_ID;

  navPanel.className = "leditor-navigation-panel";

  navPanel.setAttribute("role", "navigation");

  navPanel.setAttribute("aria-label", "Document map");

  appRoot.appendChild(navPanel);

  return navPanel;

};



const buildNavigationEntries = (editor: Editor): Array<{ label: string; level: number; pos: number }> => {

  const results: Array<{ label: string; level: number; pos: number }> = [];

  editor.state.doc.descendants((node, pos) => {

    if (node.type.name === "heading") {

      const text = node.textContent?.trim() ?? "";

      if (text.length === 0) return true;

      const level = Number(node.attrs?.level ?? 1);

      results.push({ label: text, level: Math.max(1, Math.min(6, level)), pos });

    }

    return true;

  });

  return results;

};



const renderNavigation = (editor: Editor) => {

  const panel = ensureNavPanel();

  if (!panel) return;

  panel.innerHTML = "";

  const entries = buildNavigationEntries(editor);

  if (entries.length === 0) {

    const empty = document.createElement("div");

    empty.className = "leditor-navigation-empty";

    empty.textContent = "No headings defined.";

    panel.appendChild(empty);

    return;

  }

  for (const entry of entries) {

    const button = document.createElement("button");

    button.type = "button";

    button.className = "leditor-navigation-entry";

    button.dataset.level = String(entry.level);

    button.textContent = entry.label;

    button.addEventListener("click", () => {

      const selection = TextSelection.create(editor.state.doc, entry.pos);

      editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());

      editor.commands.focus();

    });

    panel.appendChild(button);

  }

};



export const initViewState = (root: HTMLElement) => {

  appRoot = root;
  appRoot.classList.toggle(APP_CLASS_PAGE_BOUNDARIES, pageBoundariesVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGE_BREAKS, pageBreakMarksVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGINATION_CONTINUOUS, paginationModeState === "continuous");

};



export const setReadMode = (value: boolean) => {

  if (!appRoot) return;
  readModeActive = value;

  appRoot.classList.toggle(APP_CLASS_READ, value);

};



export const setScrollDirection = (mode: "vertical" | "horizontal") => {

  if (!appRoot) return;
  scrollDirectionState = mode;

  appRoot.classList.toggle(APP_CLASS_HORIZONTAL, mode === "horizontal");

};



export const setRulerVisible = (value: boolean) => {

  if (!appRoot) return;
  rulerVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_RULER, value);

};

export const setPageBoundariesVisible = (value: boolean) => {

  if (!appRoot) return;
  pageBoundariesVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_PAGE_BOUNDARIES, value);

};

export const setPageBreakMarksVisible = (value: boolean) => {

  if (!appRoot) return;
  pageBreakMarksVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_PAGE_BREAKS, value);

};

export const setPaginationMode = (mode: "paged" | "continuous") => {

  if (!appRoot) return;
  paginationModeState = mode;

  appRoot.classList.toggle(APP_CLASS_PAGINATION_CONTINUOUS, mode === "continuous");

};



export const setGridlinesVisible = (value: boolean) => {

  if (!appRoot) return;
  gridVisibleState = value;

  appRoot.classList.toggle(APP_CLASS_GRID, value);

};

export const syncViewToggles = () => {
  if (!appRoot) return;
  appRoot.classList.toggle(APP_CLASS_RULER, rulerVisibleState);
  appRoot.classList.toggle(APP_CLASS_GRID, gridVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGE_BOUNDARIES, pageBoundariesVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGE_BREAKS, pageBreakMarksVisibleState);
  appRoot.classList.toggle(APP_CLASS_PAGINATION_CONTINUOUS, paginationModeState === "continuous");
};



export const toggleNavigationPanel = (editorHandle: EditorHandle) => {

  if (!appRoot) return;

  const panel = ensureNavPanel();

  if (!panel) return;

  const tiptapEditor = editorHandle.getEditor();

  if (navVisible) {

    panel.style.display = "none";

    navVisible = false;

    return;

  }

  renderNavigation(tiptapEditor);

  panel.style.display = "block";

  navVisible = true;

};

export const isReadMode = () => readModeActive;
export const getScrollDirection = () => scrollDirectionState;
export const isRulerVisible = () => rulerVisibleState;
export const isGridlinesVisible = () => gridVisibleState;
export const isNavigationVisible = () => navVisible;
export const isPageBoundariesVisible = () => pageBoundariesVisibleState;
export const isPageBreakMarksVisible = () => pageBreakMarksVisibleState;
export const getPaginationMode = () => paginationModeState;



