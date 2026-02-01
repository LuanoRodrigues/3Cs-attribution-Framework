import type { EditorHandle } from "../api/leditor.ts";
import type { BreakKind } from "../extensions/extension_page_break.ts";
import { BREAK_KIND_LABELS } from "../extensions/extension_page_break.ts";

type PrintPreviewController = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  getLastPageCount(): number;
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
      overlay.classList.add("is-open");
      document.addEventListener("keydown", handleKeydown);
      return lastCount;
    },
    close() {
      overlay.classList.remove("is-open");
      document.removeEventListener("keydown", handleKeydown);
    },
    toggle() {
      if (overlay.classList.contains("is-open")) {
        controller.close();
      } else {
        controller.open();
      }
    },
    isOpen() {
      return overlay.classList.contains("is-open");
    },
    getLastPageCount() {
      return lastCount;
    }
  };

  closeButton.addEventListener("click", () => controller.close());
  overlay.addEventListener("click", handleOverlayClick);

  return controller;
};
