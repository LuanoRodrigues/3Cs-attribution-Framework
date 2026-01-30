import { registerPlugin } from "../api/plugin_registry.ts";
import type { EditorHandle } from "../api/leditor.ts";
import type { ImportDocxOptions, ImportDocxResult } from "../api/import_docx.ts";
import type { ExportDocxOptions, ExportDocxResult } from "../api/export_docx.ts";

const writeLog = (line: string) => window.codexLog?.write(`[DOCX] ${line}`);

const runAutoImport = (args?: { options?: ImportDocxOptions }) => {
  const importer = window.__leditorAutoImportDOCX;
  if (!importer) {
    return null;
  }
  return importer(args?.options)
    .then((result) => {
      writeLog(`auto import ${result?.success ? "ok" : "failed"}`);
      return result;
    })
    .catch((error) => {
      writeLog(`auto import error ${error}`);
      return null;
    });
};

const runAutoExport = (args?: { options?: ExportDocxOptions }) => {
  const exporter = window.__leditorAutoExportDOCX;
  if (!exporter) {
    return null;
  }
  return exporter(args?.options)
    .then((result) => {
      writeLog(`auto export ${result?.success ? "ok" : "failed"}`);
      return result;
    })
    .catch((error) => {
      writeLog(`auto export error ${error}`);
      return null;
    });
};

registerPlugin({
  id: "docx_tools",
  commands: {
    ImportDocx(editorHandle: EditorHandle, args?: { options?: ImportDocxOptions }) {
      const promise = runAutoImport(args);
      if (!promise) {
        editorHandle.execCommand("ImportDOCX", args);
        writeLog("import fallback");
        return;
      }
      promise.then((result) => {
        if (result?.html) {
          editorHandle.setContent(result.html, { format: "html" });
          writeLog("auto import content applied");
        }
      });
    },
    ExportDocx(editorHandle: EditorHandle, args?: { options?: ExportDocxOptions }) {
      const promise = runAutoExport(args);
      if (!promise) {
        editorHandle.execCommand("ExportDOCX", args);
        writeLog("export fallback");
        return;
      }
      promise.then((result) => {
        if (!result?.success) {
          writeLog("auto export reported failure");
        }
      });
    }
  }
});
