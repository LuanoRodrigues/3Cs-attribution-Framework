"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RibbonRoot = exports.RibbonTabStrip = exports.RibbonTabPanel = exports.RibbonGroup = exports.RibbonControl = void 0;
const TAB_ID_PREFIX = "ribbon-tab-";
const PANEL_ID_PREFIX = "ribbon-panel-";
const ACTIVE_TAB_STORAGE_KEY = "leditor.ribbon.activeTab";
let lastActiveTabId = null;
const readStoredTabId = () => {
    try {
        return window.localStorage?.getItem(ACTIVE_TAB_STORAGE_KEY) ?? null;
    }
    catch {
        return null;
    }
};
const writeStoredTabId = (tabId) => {
    try {
        window.localStorage?.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
    }
    catch {
        // Ignore storage failures (e.g. disabled storage).
    }
};
const focusEditor = () => {
    const editorHandle = window.leditor;
    if (editorHandle?.focus) {
        editorHandle.focus();
        return;
    }
    const view = document.querySelector(".ProseMirror");
    view?.focus();
};
class RibbonControl {
    element;
    constructor(element) {
        this.element = element;
        this.element.classList.add("leditor-ribbon-control");
    }
}
exports.RibbonControl = RibbonControl;
class RibbonGroup {
    element;
    constructor(label, controls) {
        this.element = document.createElement("div");
        this.element.className = "leditor-ribbon-group";
        this.element.classList.add("ribbonGroup");
        if (label) {
            const labelEl = document.createElement("div");
            labelEl.className = "leditor-ribbon-group-label";
            labelEl.classList.add("ribbonGroup__label");
            labelEl.textContent = label;
            this.element.appendChild(labelEl);
        }
        const body = document.createElement("div");
        body.className = "leditor-ribbon-group-body";
        body.classList.add("ribbonGroup__body");
        body.setAttribute("role", "toolbar");
        body.setAttribute("aria-label", label ? `${label} controls` : "Ribbon group controls");
        const getFocusableControls = () => Array.from(body.querySelectorAll("button:not(:disabled)"));
        body.addEventListener("keydown", (event) => {
            const items = getFocusableControls();
            if (items.length === 0)
                return;
            const activeElement = document.activeElement;
            const currentIndex = items.indexOf(activeElement ?? items[0]);
            let target = null;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                target = items[(currentIndex + 1) % items.length];
            }
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                const nextIndex = currentIndex - 1;
                target = items[nextIndex < 0 ? items.length - 1 : nextIndex];
            }
            else if (event.key === "Home") {
                target = items[0];
            }
            else if (event.key === "End") {
                target = items[items.length - 1];
            }
            else if (event.key === "Escape") {
                event.preventDefault();
                focusEditor();
                return;
            }
            if (target) {
                event.preventDefault();
                target.focus();
            }
        });
        controls.forEach((control) => body.appendChild(control));
        this.element.appendChild(body);
    }
}
exports.RibbonGroup = RibbonGroup;
class RibbonTabPanel {
    element;
    constructor(id, content) {
        this.element = content;
        this.element.classList.add("leditor-ribbon-panel");
        this.element.classList.add("ribbonPanel");
        this.element.id = this.element.id || `${PANEL_ID_PREFIX}${id}`;
        this.element.setAttribute("role", "tabpanel");
        this.element.setAttribute("aria-labelledby", `${TAB_ID_PREFIX}${id}`);
        this.element.hidden = true;
    }
}
exports.RibbonTabPanel = RibbonTabPanel;
class RibbonTabStrip {
    onActivate;
    element;
    buttons = new Map();
    tabOrder = [];
    activeTabId = null;
    constructor(onActivate) {
        this.onActivate = onActivate;
        this.element = document.createElement("div");
        this.element.className = "leditor-ribbon-tabs";
        this.element.classList.add("ribbonTabs");
        this.element.setAttribute("role", "tablist");
        this.element.setAttribute("aria-label", "Ribbon tabs");
        this.element.addEventListener("keydown", this.handleKeydown);
    }
    addTab(tabId, label) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "leditor-ribbon-tab";
        button.id = `${TAB_ID_PREFIX}${tabId}`;
        button.dataset.tabId = tabId;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", "false");
        button.tabIndex = -1;
        button.textContent = label;
        button.addEventListener("click", () => this.onActivate(tabId));
        this.element.appendChild(button);
        this.buttons.set(tabId, button);
        this.tabOrder.push(tabId);
        return button;
    }
    setActiveTab(tabId) {
        this.activeTabId = tabId;
        this.buttons.forEach((button, id) => {
            const isActive = id === tabId;
            button.setAttribute("aria-selected", isActive ? "true" : "false");
            button.tabIndex = isActive ? 0 : -1;
            if (isActive) {
                button.focus();
            }
        });
    }
    focusTab(tabId) {
        const button = this.buttons.get(tabId);
        if (!button)
            return;
        button.focus();
    }
    handleKeydown = (event) => {
        if (!this.activeTabId)
            return;
        const currentIndex = this.tabOrder.indexOf(this.activeTabId);
        if (currentIndex === -1)
            return;
        let nextIndex = null;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            nextIndex = (currentIndex + 1) % this.tabOrder.length;
        }
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            nextIndex = (currentIndex - 1 + this.tabOrder.length) % this.tabOrder.length;
        }
        else if (event.key === "Home") {
            nextIndex = 0;
        }
        else if (event.key === "End") {
            nextIndex = this.tabOrder.length - 1;
        }
        if (nextIndex !== null) {
            event.preventDefault();
            this.focusTab(this.tabOrder[nextIndex]);
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            const target = event.target;
            const tabId = target?.dataset?.tabId;
            if (tabId && this.buttons.has(tabId)) {
                event.preventDefault();
                this.onActivate(tabId);
            }
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            focusEditor();
        }
    };
}
exports.RibbonTabStrip = RibbonTabStrip;
class RibbonRoot {
    shell;
    panelsContainer;
    tabPanels = new Map();
    tabStrip;
    activeTabId = null;
    constructor(host, tabs, options) {
        host.classList.add("leditor-ribbon");
        host.innerHTML = "";
        this.shell = document.createElement("div");
        this.shell.className = "leditor-ribbon-shell";
        this.tabStrip = new RibbonTabStrip((tabId) => this.activateTab(tabId));
        this.panelsContainer = document.createElement("div");
        this.panelsContainer.className = "leditor-ribbon-panels";
        tabs.forEach((tab) => {
            const panel = new RibbonTabPanel(tab.id, tab.panel);
            this.tabPanels.set(tab.id, panel);
            this.panelsContainer.appendChild(panel.element);
            const button = this.tabStrip.addTab(tab.id, tab.label);
            button.setAttribute("aria-controls", panel.element.id);
        });
        this.shell.append(this.tabStrip.element, this.panelsContainer);
        host.appendChild(this.shell);
        const defaultTab = this.resolveActiveTab(tabs, options?.activeTabId);
        if (defaultTab) {
            this.activateTab(defaultTab);
        }
    }
    resolveActiveTab(tabs, preferred) {
        const candidate = preferred ?? lastActiveTabId ?? readStoredTabId();
        if (candidate && tabs.some((tab) => tab.id === candidate)) {
            return candidate;
        }
        return tabs.length ? tabs[0].id : null;
    }
    activateTab(tabId) {
        if (!this.tabPanels.has(tabId)) {
            return;
        }
        if (this.activeTabId === tabId) {
            return;
        }
        if (this.activeTabId) {
            const previousPanel = this.tabPanels.get(this.activeTabId);
            if (previousPanel) {
                previousPanel.element.hidden = true;
            }
        }
        const nextPanel = this.tabPanels.get(tabId);
        nextPanel.element.hidden = false;
        this.activeTabId = tabId;
        this.tabStrip.setActiveTab(tabId);
        lastActiveTabId = tabId;
        writeStoredTabId(tabId);
        window.codexLog?.write(`[RIBBON_TAB_ACTIVE] ${tabId}`);
    }
}
exports.RibbonRoot = RibbonRoot;
