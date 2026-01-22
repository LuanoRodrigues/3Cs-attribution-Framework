import { registerPlugin } from "../api/plugin_registry.ts";
import { createPrintPreviewModal } from "../ui/print_preview.ts";

let printPreviewController: ReturnType<typeof createPrintPreviewModal> | null = null;

const ensurePrintPreview = (editorHandle: Parameters<typeof createPrintPreviewModal>[0]) => {
  if (!printPreviewController) {
    printPreviewController = createPrintPreviewModal(editorHandle);
  }
  return printPreviewController;
};

registerPlugin({
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
