import { registerPlugin } from "../api/plugin_registry.js";
import type { EditorHandle } from "../api/leditor.js";
import type { ExportPdfOptions, ExportPdfRequest, ExportPdfResult } from "../api/export_pdf.js";

const triggerExport = (html: string, options?: ExportPdfOptions) => {
  const handler = window.leditorHost?.exportPDF;
  if (!handler) {
    return Promise.reject(new Error("ExportPDF handler is unavailable"));
  }
  return handler({ html, options });
};

registerPlugin({
  id: "export_pdf",
  commands: {
    ExportPDF(editorHandle: EditorHandle, args?: { options?: ExportPdfOptions }) {
      const html = editorHandle.getContent({ format: "html" });
      const htmlString = typeof html === "string" ? html : "";
      void triggerExport(htmlString, args?.options).catch((error: unknown) => {
        console.error("ExportPDF failed", error);
      });
    }
  },
  onInit(editorHandle: EditorHandle) {
    window.__leditorAutoExportPDF = (options?: ExportPdfOptions) => {
      const html = editorHandle.getContent({ format: "html" });
      const htmlString = typeof html === "string" ? html : "";
      return triggerExport(htmlString, options);
    };
  }
});
