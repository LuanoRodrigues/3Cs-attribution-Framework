import { registerPlugin } from "../api/plugin_registry.js";
import { createPreviewModal } from "../ui/preview.js";

declare global {
  interface Window {
    __leditorAutoPreview?: () => void;
  }
}

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
    Preview(editorHandle) {
      const preview = ensurePreview(editorHandle);
      preview.toggle();
    }
  },
  onInit(editorHandle) {
    ensurePreview(editorHandle);
  }
});
