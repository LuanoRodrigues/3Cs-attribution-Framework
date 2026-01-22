"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isNavigationVisible = exports.isGridlinesVisible = exports.isRulerVisible = exports.getScrollDirection = exports.isReadMode = exports.toggleNavigationPanel = exports.setGridlinesVisible = exports.setRulerVisible = exports.setScrollDirection = exports.setReadMode = exports.initViewState = void 0;
const state_1 = require("@tiptap/pm/state");
const APP_CLASS_READ = "leditor-app--read-mode";
const APP_CLASS_HORIZONTAL = "leditor-app--horizontal-scroll";
const APP_CLASS_RULER = "leditor-app--show-ruler";
const APP_CLASS_GRID = "leditor-app--show-gridlines";
const NAV_PANEL_ID = "leditor-navigation-panel";
let appRoot = null;
let navPanel = null;
let navVisible = false;
let readModeActive = false;
let scrollDirectionState = "vertical";
let rulerVisibleState = false;
let gridVisibleState = false;
const ensureNavPanel = () => {
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
const buildNavigationEntries = (editor) => {
    const results = [];
    editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") {
            const text = node.textContent?.trim() ?? "";
            if (text.length === 0)
                return true;
            const level = Number(node.attrs?.level ?? 1);
            results.push({ label: text, level: Math.max(1, Math.min(6, level)), pos });
        }
        return true;
    });
    return results;
};
const renderNavigation = (editor) => {
    const panel = ensureNavPanel();
    if (!panel)
        return;
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
            const selection = state_1.TextSelection.create(editor.state.doc, entry.pos);
            editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
            editor.commands.focus();
        });
        panel.appendChild(button);
    }
};
const initViewState = (root) => {
    appRoot = root;
};
exports.initViewState = initViewState;
const setReadMode = (value) => {
    if (!appRoot)
        return;
    readModeActive = value;
    appRoot.classList.toggle(APP_CLASS_READ, value);
};
exports.setReadMode = setReadMode;
const setScrollDirection = (mode) => {
    if (!appRoot)
        return;
    scrollDirectionState = mode;
    appRoot.classList.toggle(APP_CLASS_HORIZONTAL, mode === "horizontal");
};
exports.setScrollDirection = setScrollDirection;
const setRulerVisible = (value) => {
    if (!appRoot)
        return;
    rulerVisibleState = value;
    appRoot.classList.toggle(APP_CLASS_RULER, value);
};
exports.setRulerVisible = setRulerVisible;
const setGridlinesVisible = (value) => {
    if (!appRoot)
        return;
    gridVisibleState = value;
    appRoot.classList.toggle(APP_CLASS_GRID, value);
};
exports.setGridlinesVisible = setGridlinesVisible;
const toggleNavigationPanel = (editorHandle) => {
    if (!appRoot)
        return;
    const panel = ensureNavPanel();
    if (!panel)
        return;
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
exports.toggleNavigationPanel = toggleNavigationPanel;
const isReadMode = () => readModeActive;
exports.isReadMode = isReadMode;
const getScrollDirection = () => scrollDirectionState;
exports.getScrollDirection = getScrollDirection;
const isRulerVisible = () => rulerVisibleState;
exports.isRulerVisible = isRulerVisible;
const isGridlinesVisible = () => gridVisibleState;
exports.isGridlinesVisible = isGridlinesVisible;
const isNavigationVisible = () => navVisible;
exports.isNavigationVisible = isNavigationVisible;
