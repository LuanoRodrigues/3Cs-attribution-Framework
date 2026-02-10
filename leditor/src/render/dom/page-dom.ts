import type { LayoutPage } from "../../layout-v2/types.ts";
import type { StyleResolver } from "../../layout-v2/style/resolve-style.ts";
import { renderFragmentDom } from "./fragment-dom.ts";
import "./css/paged-view.css";

const toPx = (value: number, unit: string): number => {
  if (unit === "mm") return (value / 25.4) * 96;
  if (unit === "pt") return (value / 72) * 96;
  if (unit === "twip") return (value / 1440) * 96;
  return value;
};

const getPageSizePx = (page: LayoutPage): { width: number; height: number } => {
  const unit = page.setup.size.unit ?? page.setup.unit;
  const width = page.setup.orientation === "landscape" ? page.setup.size.height : page.setup.size.width;
  const height = page.setup.orientation === "landscape" ? page.setup.size.width : page.setup.size.height;
  return { width: toPx(width, unit), height: toPx(height, unit) };
};

const applyRect = (el: HTMLElement, rect: { x: number; y: number; w: number; h: number }) => {
  el.style.position = "absolute";
  el.style.left = `${rect.x}px`;
  el.style.top = `${rect.y}px`;
  el.style.width = `${rect.w}px`;
  el.style.height = `${rect.h}px`;
};

const buildBorderStyle = (
  preset: string | null | undefined,
  color: string | null | undefined,
  width: number | null | undefined
): string | null => {
  if (!preset || preset === "none") return null;
  const resolvedColor = typeof color === "string" && color.trim() ? color.trim() : "#1e1e1e";
  const resolvedWidth = typeof width === "number" && Number.isFinite(width) && width > 0 ? width : 1;
  const size = `${resolvedWidth}px`;
  switch (preset) {
    case "bottom":
      return `border-bottom: ${size} solid ${resolvedColor}`;
    case "top":
      return `border-top: ${size} solid ${resolvedColor}`;
    case "left":
      return `border-left: ${size} solid ${resolvedColor}`;
    case "right":
      return `border-right: ${size} solid ${resolvedColor}`;
    case "all":
    case "outside":
      return `border: ${size} solid ${resolvedColor}`;
    case "inside":
      return `border-left: ${size} solid ${resolvedColor}; border-right: ${size} solid ${resolvedColor}`;
    default:
      return null;
  }
};

export const renderPageDom = (
  page: LayoutPage,
  styleResolver: StyleResolver,
  headerHtml?: string,
  footerHtml?: string
): HTMLElement => {
  const container = document.createElement("section");
  container.className = "leditor-page";
  container.dataset.page = `${page.number}`;
  container.dataset.pageIndex = `${page.number - 1}`;
  const pageSize = getPageSizePx(page);
  container.style.width = `${pageSize.width}px`;
  container.style.height = `${pageSize.height}px`;

  const header = document.createElement("header");
  header.className = "leditor-page-header";
  const body = document.createElement("div");
  body.className = "leditor-page-body";
  const footnotes = document.createElement("aside");
  footnotes.className = "leditor-page-footnotes";
  const footer = document.createElement("footer");
  footer.className = "leditor-page-footer";
  applyRect(header, page.frames.headerRect);
  applyRect(body, page.frames.bodyRect);
  applyRect(footnotes, page.frames.footnotesRect);
  applyRect(footer, page.frames.footerRect);
  body.style.position = "absolute";
  body.style.overflow = "hidden";
  if (typeof headerHtml === "string") {
    header.innerHTML = headerHtml;
  }
  if (typeof footerHtml === "string") {
    footer.innerHTML = footerHtml;
  }

  page.items.forEach((block) => {
    if (block.kind !== "page-break" && block.styleKey) {
      const style = styleResolver.resolve(block.styleKey);
      const hasBorder = Boolean(style.borderPreset);
      const hasBackground = Boolean(style.backgroundColor);
      const isAtom = block.kind === "atom";
      if (hasBorder || hasBackground || isAtom) {
        const spacingBefore = style.paragraphSpacingBeforePx ?? 0;
        const spacingAfter = style.paragraphSpacingAfterPx ?? 0;
        const leftIndent = style.leftIndentPx ?? 0;
        const rightIndent = style.rightIndentPx ?? 0;
        const innerRect = {
          x: block.rect.x + leftIndent,
          y: block.rect.y + spacingBefore,
          w: Math.max(0, block.rect.w - leftIndent - rightIndent),
          h: Math.max(0, block.rect.h - spacingBefore - spacingAfter)
        };
        const blockEl = document.createElement("div");
        blockEl.className = block.nodeType ? `leditor-block leditor-block--${block.nodeType}` : "leditor-block";
        if (block.nodeType) {
          blockEl.dataset.nodeType = block.nodeType;
        }
        blockEl.style.pointerEvents = "none";
        blockEl.style.boxSizing = "border-box";
        if (style.direction) {
          blockEl.style.direction = style.direction;
        }
        if (hasBackground) {
          blockEl.style.backgroundColor = style.backgroundColor ?? "";
        }
        const borderStyle = buildBorderStyle(style.borderPreset, style.borderColor, style.borderWidthPx);
        if (borderStyle) {
          blockEl.style.cssText += `; ${borderStyle}`;
        } else if (isAtom) {
          blockEl.style.backgroundColor = blockEl.style.backgroundColor || "rgba(0, 0, 0, 0.04)";
          blockEl.style.border = "1px solid rgba(0, 0, 0, 0.1)";
        }
        applyRect(blockEl, innerRect);
        body.appendChild(blockEl);
      }
    }
    block.lines.forEach((line) => {
      line.fragments.forEach((fragment) => {
        const fragNode = renderFragmentDom(fragment, styleResolver);
        body.appendChild(fragNode);
      });
    });
    if (block.tableCells && block.tableCells.length) {
      block.tableCells.forEach((cell) => {
        const cellEl = document.createElement("div");
        cellEl.className = cell.header ? "leditor-table-cell leditor-table-cell--header" : "leditor-table-cell";
        cellEl.style.position = "absolute";
        cellEl.style.boxSizing = "border-box";
        cellEl.style.border = "1px solid rgba(0, 0, 0, 0.25)";
        cellEl.style.zIndex = "0";
        cellEl.style.left = `${block.rect.x + cell.x}px`;
        cellEl.style.top = `${block.rect.y + cell.y}px`;
        cellEl.style.width = `${cell.w}px`;
        cellEl.style.height = `${cell.h}px`;
        cellEl.style.pointerEvents = "none";
        body.appendChild(cellEl);
      });
    }
  });

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(footnotes);
  container.appendChild(footer);

  if (page.footnotes && page.footnotes.length) {
    page.footnotes.forEach((block) => {
      block.lines.forEach((line) => {
        line.fragments.forEach((fragment) => {
          const fragNode = renderFragmentDom(fragment, styleResolver);
          footnotes.appendChild(fragNode);
        });
      });
    });
  }
  return container;
};
