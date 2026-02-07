import type { ToolDefinition, ToolHandle } from "../../registry/toolRegistry";
import type { PdfTestPayload } from "../../test/testFixtures";
import { renderPdfTabs } from "../../pdfViewer/integration";

export function createAnalysePdfTabsTool(): ToolDefinition {
  return {
    type: "analyse-pdf-tabs",
    title: "Analyse — PDF",
    create: ({ metadata }): ToolHandle => {
      const wrap = document.createElement("div");
      wrap.className = "tool-surface";
      wrap.style.height = "100%";
      wrap.style.minHeight = "0";
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";

      const payload = (metadata?.payload ?? metadata?.pdfPayload ?? metadata) as PdfTestPayload | undefined;
      const raw = (metadata as any)?.rawPayload;
      if (payload) {
        renderPdfTabs(wrap, payload, raw);
      } else {
        wrap.innerHTML = `<div class="empty-state">No PDF payload provided.</div>`;
      }

      return { element: wrap };
    }
  };
}

