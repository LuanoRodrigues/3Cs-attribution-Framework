"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRibbonPlaceholder = void 0;
const toolbar_styles_js_1 = require("./toolbar_styles.js");
const ribbon_primitives_js_1 = require("./ribbon_primitives.js");
const createPlaceholderPanel = (text) => {
    const panel = document.createElement("div");
    panel.className = "leditor-ribbon-panel leditor-ribbon-placeholder";
    panel.textContent = text;
    return panel;
};
const renderRibbonPlaceholder = (host, options) => {
    (0, toolbar_styles_js_1.ensureToolbarStyles)();
    const tabIds = (options.tabs ?? []).map((t) => t.id);
    // Debug: silenced noisy ribbon logs.
    const tabs = options.tabs ?? [];
    if (tabs.length === 0) {
        return;
    }
    const definitions = tabs.map((tab) => {
        const panelContent = options.panelContent?.[tab.id];
        const panel = panelContent ?? createPlaceholderPanel(tab.placeholder ?? `${tab.label} tools coming soon.`);
        if (!panelContent) {
    // Debug: silenced noisy ribbon logs.
        }
        return { id: tab.id, label: tab.label, panel };
    });
    new ribbon_primitives_js_1.RibbonRoot(host, definitions);
};
exports.renderRibbonPlaceholder = renderRibbonPlaceholder;
