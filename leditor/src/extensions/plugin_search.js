"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_registry_js_1 = require("../api/plugin_registry.js");
const search_js_1 = require("../editor/search.js");
const search_panel_js_1 = require("../ui/search_panel.js");
const search_js_2 = require("../editor/search.js");
let panelController = null;
const ensurePanel = (editorHandle) => {
    if (!panelController) {
        panelController = (0, search_panel_js_1.createSearchPanel)(editorHandle);
    }
    return panelController;
};
(0, plugin_registry_js_1.registerPlugin)({
    id: "search",
    tiptapExtensions: [search_js_1.searchExtension],
    commands: {
        SearchReplace(editorHandle) {
            const panel = ensurePanel(editorHandle);
            panel.toggle();
        },
        SearchNext() {
            (0, search_js_2.nextMatch)();
        },
        SearchPrev() {
            (0, search_js_2.prevMatch)();
        },
        ReplaceCurrent(_editorHandle, args) {
            const replacement = typeof args?.replacement === "string" ? args.replacement : "";
            (0, search_js_2.replaceCurrent)(replacement);
        },
        ReplaceAll(_editorHandle, args) {
            const query = typeof args?.query === "string" ? args.query : "";
            const replacement = typeof args?.replacement === "string" ? args.replacement : "";
            (0, search_js_2.replaceAll)(query, replacement);
        },
        SetSearchQuery(_editorHandle, args) {
            const query = typeof args?.query === "string" ? args.query : "";
            (0, search_js_2.setQuery)(query);
        }
    },
    onInit(editorHandle) {
        ensurePanel(editorHandle);
    }
});
