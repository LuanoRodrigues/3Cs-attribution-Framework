import { registerPlugin } from "../legacy/api/plugin_registry.js";
import type { EditorHandle } from "../legacy/api/leditor.js";
import type { ExportPdfOptions, ExportPdfResult } from "../legacy/api/export_pdf.js";

const log = (line: string) => window.codexLog?.write(`[EXPORT_PDF] ${line}`);

const runAutoExport = (args?: { options?: ExportPdfOptions }) => {
  const autoExport = window.__leditorAutoExportPDF;
  if (!autoExport) {
    return null;
  }
  return autoExport(args?.options)
    .then((result) => {
      log(result?.success ? "auto ok" : "auto failed");
      return result;
    })
    .catch((error) => {
      log(`auto error ${error}`);
      return null;
    });
};

const runHostExport = (editorHandle: EditorHandle, args?: { options?: ExportPdfOptions }) => {
  const handler = window.leditorHost?.exportPDF;
  if (!handler) {
    log("handler missing");
    return null;
  }
  const html = editorHandle.getContent({ format: "html" });
  const request = {
    html: typeof html === "string" ? html : "",
    options: args?.options
  };
  return handler(request).then((result) => {
    log(result?.success ? "host ok" : "host failed");
    return result;
  });
};

registerPlugin({
  id: "pdf_tools",
  commands: {
    ExportPdf(editorHandle: EditorHandle, args?: { options?: ExportPdfOptions }) {
      const auto = runAutoExport(args);
      if (auto) {
        return;
      }
      runHostExport(editorHandle, args);
    }
  }
});
