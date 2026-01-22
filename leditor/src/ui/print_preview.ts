import type { EditorHandle } from "../api/leditor.js";
import type { BreakKind } from "../extensions/extension_page_break.js";
import { BREAK_KIND_LABELS } from "../extensions/extension_page_break.js";

type PrintPreviewController = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  getLastPageCount(): number;
};

const ensureStyles = () => {
  if (document.getElementById("leditor-print-preview-styles")) return;
  const style = document.createElement("style");
  style.id = "leditor-print-preview-styles";
  style.textContent = `
.leditor-print-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 14, 0.7);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 1200;
  padding: 24px;
}
.leditor-print-preview-panel {
  width: min(100%, 960px);
  max-height: 90vh;
  background: #f7f5ef;
  border: 1px solid #cbbf9a;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}
.leditor-print-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #f2e8d3;
  border-bottom: 1px solid #d8cba8;
  font-family: "Georgia", "Times New Roman", serif;
  font-size: 14px;
}
.leditor-print-preview-close {
  border: 1px solid #8c7a53;
  background: #eadbb8;
  padding: 4px 10px;
  cursor: pointer;
  font-size: 12px;
  border-radius: 6px;
}
.leditor-print-preview-content {
  flex: 1;
  overflow: auto;
  padding: 18px;
  background: #e6e1d4;
}
.leditor-print-preview-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 18px;
  padding-bottom: 18px;
}
.leditor-print-page {
  width: calc(var(--page-width-mm, 210) * 1mm);
  min-height: calc(var(--page-height-mm, 297) * 1mm);
  max-width: calc(100% - 40px);
  background: #fffdf7;
  border: 1px solid rgba(0, 0, 0, 0.15);
  border-radius: 10px;
  padding: 24px;
  box-sizing: border-box;
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.35);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.leditor-print-page::after {
  content: attr(data-page-label);
  position: absolute;
  bottom: 10px;
  right: 16px;
  font-size: 10px;
  color: rgba(0, 0, 0, 0.4);
}
.leditor-print-preview-page-count {
  font-size: 12px;
  color: #2c2c2c;
  font-family: "Georgia", "Times New Roman", serif;
}
.leditor-break {
  margin: 10px 0;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px dashed rgba(0, 0, 0, 0.3);
  background: rgba(0, 0, 0, 0.03);
  font-size: 12px;
  color: #424242;
  text-align: center;
}
.leditor-break::after {
  content: attr(data-break-label);
}
.leditor-break-placeholder {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.05);
  border: 1px dashed rgba(0, 0, 0, 0.2);
  font-size: 12px;
  color: #4a4a4a;
  font-family: "Georgia", "Times New Roman", serif;
}
@media print {
  .leditor-print-preview-overlay {
    position: static;
    background: transparent;
    padding: 0;
  }
  .leditor-print-preview-panel {
    border: none;
    box-shadow: none;
    max-height: none;
  }
  .leditor-print-preview-content {
    padding: 0;
    background: transparent;
  }
  .leditor-print-page {
    box-shadow: none;
    border: none;
    page-break-after: always;
  }
}
`;
  document.head.appendChild(style);
};

const cloneNode = (node: Node) => {
  return node.cloneNode(true);
};

const PAGE_BOUNDARY_KINDS: BreakKind[] = [
  "page",
  "section_next",
  "section_even",
  "section_odd"
];
const PAGE_BOUNDARY_SET = new Set<BreakKind>(PAGE_BOUNDARY_KINDS);

const getBreakKindFromNode = (node: Node): BreakKind | null => {
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  if (element.getAttribute("data-break") !== "true") return null;
  const kind = element.getAttribute("data-break-kind");
  if (!kind) return "page";
  return kind as BreakKind;
};

const createBreakPlaceholder = (kind: BreakKind) => {
  const placeholder = document.createElement("div");
  placeholder.className = "leditor-break-placeholder";
  placeholder.dataset.breakKind = kind;
  placeholder.textContent = BREAK_KIND_LABELS[kind] ?? "Break";
  return placeholder;
};

const buildPagesFromHtml = (html: string, host: HTMLElement): number => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const children = Array.from(doc.body.childNodes);

  host.innerHTML = "";
  let currentPage: HTMLElement | null = null;
  let pageCount = 0;

  const createPage = () => {
    const page = document.createElement("div");
    page.className = "leditor-print-page";
    page.dataset.pageLabel = `Page ${pageCount + 1}`;
    host.appendChild(page);
    pageCount += 1;
    return page;
  };

  const ensurePage = () => {
    if (!currentPage) {
      currentPage = createPage();
    }
  };

  ensurePage();

  for (const child of children) {
    const kind = getBreakKindFromNode(child);
    if (kind) {
      if (PAGE_BOUNDARY_SET.has(kind)) {
        currentPage = createPage();
        continue;
      }
      ensurePage();
      currentPage?.appendChild(createBreakPlaceholder(kind));
      continue;
    }
    ensurePage();
    currentPage?.appendChild(cloneNode(child));
  }

  if (pageCount === 0) {
    createPage();
  }

  return Math.max(1, pageCount);
};

export const createPrintPreviewModal = (editorHandle: EditorHandle): PrintPreviewController => {
  ensureStyles();

  const overlay = document.createElement("div");
  overlay.className = "leditor-print-preview-overlay";

  const panel = document.createElement("div");
  panel.className = "leditor-print-preview-panel";

  const header = document.createElement("div");
  header.className = "leditor-print-preview-header";
  header.textContent = "Print Preview";

  const pageCountLabel = document.createElement("span");
  pageCountLabel.className = "leditor-print-preview-page-count";
  pageCountLabel.textContent = "Pages: 0";
  header.appendChild(pageCountLabel);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "leditor-print-preview-close";
  closeButton.textContent = "Close";
  header.appendChild(closeButton);

  const content = document.createElement("div");
  content.className = "leditor-print-preview-content";

  const pageHost = document.createElement("div");
  pageHost.className = "leditor-print-preview-pages";
  pageHost.setAttribute("aria-live", "polite");
  pageHost.setAttribute("role", "document");
  pageHost.dataset.previewType = "print";
  content.appendChild(pageHost);

  panel.appendChild(header);
  panel.appendChild(content);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const render = () => {
    const html = editorHandle.getContent({ format: "html" });
    const htmlString = typeof html === "string" ? html : "";
    const count = buildPagesFromHtml(htmlString, pageHost);
    pageCountLabel.textContent = `Pages: ${count}`;
    return count;
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      controller.close();
    }
  };

  const handleOverlayClick = (event: MouseEvent) => {
    if (event.target === overlay) {
      controller.close();
    }
  };

  let lastCount = 0;

  const controller: PrintPreviewController = {
    open() {
      lastCount = render();
      overlay.style.display = "flex";
      document.addEventListener("keydown", handleKeydown);
      return lastCount;
    },
    close() {
      overlay.style.display = "none";
      document.removeEventListener("keydown", handleKeydown);
    },
    toggle() {
      if (overlay.style.display === "flex") {
        controller.close();
      } else {
        controller.open();
      }
    },
    isOpen() {
      return overlay.style.display === "flex";
    },
    getLastPageCount() {
      return lastCount;
    }
  };

  closeButton.addEventListener("click", () => controller.close());
  overlay.addEventListener("click", handleOverlayClick);

  return controller;
};
