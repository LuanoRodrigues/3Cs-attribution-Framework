"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_registry_js_1 = require("../api/plugin_registry.js");
const preview_js_1 = require("../ui/preview.js");
let previewController = null;
const ensurePreview = (editorHandle) => {
    if (!previewController) {
        previewController = (0, preview_js_1.createPreviewModal)(editorHandle);
        window.__leditorAutoPreview = () => {
            if (!previewController || previewController.isOpen())
                return;
            previewController.open();
            window.setTimeout(() => previewController?.close(), 0);
        };
    }
    return previewController;
};
(0, plugin_registry_js_1.registerPlugin)({
    id: "preview",
    commands: {
        Preview(editorHandle) {
            const preview = ensurePreview(editorHandle);
            preview.toggle();
        }
    },
    onInit(editorHandle) {
        ensurePreview(editorHandle);
    }
});
