import { registerPlugin } from "../legacy/api/plugin_registry.js";
import type { EditorHandle } from "../legacy/api/leditor.js";
import { createPreviewModal } from "../legacy/ui/preview.js";

let previewController: ReturnType<typeof createPreviewModal> | null = null;

const ensurePreview = (editorHandle: Parameters<typeof createPreviewModal>[0]) => {
  if (!previewController) {
    previewController = createPreviewModal(editorHandle);
    window.__leditorAutoPreview = () => {
      if (!previewController || previewController.isOpen()) return;
      previewController.open();
      window.setTimeout(() => previewController?.close(), 0);
    };
  }
  return previewController;
};

registerPlugin({
  id: "preview",
  commands: {
    Preview(editorHandle: EditorHandle) {
      const preview = ensurePreview(editorHandle);
      preview.toggle();
    }
  },
  onInit(editorHandle: EditorHandle) {
    ensurePreview(editorHandle);
  }
});
