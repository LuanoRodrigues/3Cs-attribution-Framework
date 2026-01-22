"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_registry_js_1 = require("../api/plugin_registry.js");
const source_view_js_1 = require("../ui/source_view.js");
let controller = null;
const ensureController = (editorHandle) => {
    if (!controller) {
        controller = (0, source_view_js_1.createSourceViewModal)(editorHandle);
        window.__leditorAutoSourceView = () => {
            if (!controller || controller.isOpen())
                return;
            controller.open();
            window.setTimeout(() => controller?.close(), 0);
        };
    }
    return controller;
};
(0, plugin_registry_js_1.registerPlugin)({
    id: "source_view",
    commands: {
        SourceView(editorHandle) {
            const modal = ensureController(editorHandle);
            modal.toggle();
        }
    },
    onInit(editorHandle) {
        ensureController(editorHandle);
    }
});
