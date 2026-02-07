import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import { ensurePdfViewerFrame, syncPdfViewerTheme } from "../../pdfViewer/integration";

export function createScreenPdfViewerTool(): ToolDefinition {
  return {
    type: "screen-pdf-viewer",
    title: "Screen — PDF",
    create: (): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";
      wrap.style.height = "100%";
      wrap.style.minHeight = "0";
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";

      const iframe = ensurePdfViewerFrame(wrap, { sidebar: "0" });
      iframe.dataset.pdfAppViewer = "true";
      iframe.style.flex = "1 1 auto";
      iframe.style.minHeight = "0";

      const setActive = () => {
        (window as any).__screenPdfViewerIframe = iframe;
        syncPdfViewerTheme(iframe);
      };

      // Make this instance the active receiver when the tab is focused.
      setActive();

      return {
        element: wrap,
        focus: setActive,
        destroy: () => {
          const current = (window as any).__screenPdfViewerIframe as HTMLIFrameElement | undefined;
          if (current === iframe) {
            (window as any).__screenPdfViewerIframe = undefined;
          }
        }
      };
    }
  };
}

