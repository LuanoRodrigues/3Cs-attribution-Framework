import { registerPlugin } from "../api/plugin_registry.js";
import type { EditorHandle } from "../api/leditor.js";
import type { ImportDocxOptions, ImportDocxResult } from "../api/import_docx.js";

const triggerImport = (options?: ImportDocxOptions) => {
  const handler = window.leditorHost?.importDOCX;
  if (!handler) {
    return Promise.reject(new Error("ImportDOCX handler is unavailable"));
  }
  return handler({ options });
};

registerPlugin({
  id: "import_docx",
  commands: {
    ImportDOCX(editorHandle: EditorHandle) {
      void triggerImport()
        .then((result) => {
          if (!result?.success) {
            console.error("ImportDOCX failed", result?.error);
            return;
          }
          if (result.html) {
            editorHandle.setContent(result.html, { format: "html" });
          }
        })
        .catch((error) => {
          console.error("ImportDOCX failed", error);
        });
    }
  },
  onInit(editorHandle: EditorHandle) {
    window.__leditorAutoImportDOCX = (options?: ImportDocxOptions) => {
      return triggerImport(options).then((result) => {
        if (!result.success) {
          return Promise.reject(new Error(result.error ?? "ImportDOCX failed"));
        }
        if (result.html) {
          editorHandle.setContent(result.html, { format: "html" });
        }
        return result;
      });
    };
  }
});
