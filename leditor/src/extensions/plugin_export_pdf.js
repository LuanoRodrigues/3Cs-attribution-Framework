"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const plugin_registry_js_1 = require("../api/plugin_registry.js");
const triggerExport = (html, options) => {
    const handler = window.leditorHost?.exportPDF;
    if (!handler) {
        return Promise.reject(new Error("ExportPDF handler is unavailable"));
    }
    return handler({ html, options });
};
(0, plugin_registry_js_1.registerPlugin)({
    id: "export_pdf",
    commands: {
        ExportPDF(editorHandle, args) {
            const html = editorHandle.getContent({ format: "html" });
            const htmlString = typeof html === "string" ? html : "";
            void triggerExport(htmlString, args?.options).catch((error) => {
                console.error("ExportPDF failed", error);
            });
        }
    },
    onInit(editorHandle) {
        window.__leditorAutoExportPDF = (options) => {
            const html = editorHandle.getContent({ format: "html" });
            const htmlString = typeof html === "string" ? html : "";
            return triggerExport(htmlString, options);
        };
    }
});
