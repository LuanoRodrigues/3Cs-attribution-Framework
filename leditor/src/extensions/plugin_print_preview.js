"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_registry_js_1 = require("../api/plugin_registry.js");
const print_preview_js_1 = require("../ui/print_preview.js");
let printPreviewController = null;
const ensurePrintPreview = (editorHandle) => {
    if (!printPreviewController) {
        printPreviewController = (0, print_preview_js_1.createPrintPreviewModal)(editorHandle);
    }
    return printPreviewController;
};
(0, plugin_registry_js_1.registerPlugin)({
    id: "print_preview",
    commands: {
        PrintPreview(editorHandle) {
            const controller = ensurePrintPreview(editorHandle);
            controller.toggle();
        }
    },
    onInit(editorHandle) {
        ensurePrintPreview(editorHandle);
    }
});
