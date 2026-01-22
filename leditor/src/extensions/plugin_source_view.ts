import { registerPlugin } from "../api/plugin_registry.ts";
import { createSourceViewModal, type SourceViewTab } from "../ui/source_view.ts";

declare global {
  interface Window {
    __leditorAutoSourceView?: () => void;
  }
}

let controller: ReturnType<typeof createSourceViewModal> | null = null;

const ensureController = (editorHandle: Parameters<typeof createSourceViewModal>[0]) => {
  if (!controller) {
    controller = createSourceViewModal(editorHandle);
    window.__leditorAutoSourceView = () => {
      if (!controller || controller.isOpen()) return;
      controller.open();
      window.setTimeout(() => controller?.close(), 0);
    };
  }
  return controller;
};

registerPlugin({
  id: "source_view",
  commands: {
    SourceView(editorHandle, args?: { tab?: SourceViewTab }) {
      const modal = ensureController(editorHandle);
      if (args?.tab) {
        modal.open(args.tab);
        return;
      }
      modal.toggle();
    }
  },
  onInit(editorHandle) {
    ensureController(editorHandle);
  }
});
