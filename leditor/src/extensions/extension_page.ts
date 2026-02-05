import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Plugin, PluginKey, Selection, TextSelection } from "@tiptap/pm/state";
import { Fragment, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { splitBlock } from "@tiptap/pm/commands";
import { canJoin, canSplit } from "@tiptap/pm/transform";
import { PaginationScheduler } from "../ui/pagination/scheduler.ts";

const PAGE_CLASS = "leditor-page";
const PAGE_SELECTOR = `.${PAGE_CLASS}[data-page]`;
const PAGE_INNER_CLASS = "leditor-page-inner";
const PAGE_HEADER_CLASS = "leditor-page-header";
const PAGE_CONTENT_CLASS = "leditor-page-content";
const PAGE_FOOTER_CLASS = "leditor-page-footer";
const PAGE_FOOTNOTES_CLASS = "leditor-page-footnotes";
const PAGE_FOOTNOTE_CONTINUATION_CLASS = "leditor-footnote-continuation";

const paginationKey = new PluginKey("leditor-page-pagination");
const debugEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  return (window as typeof window & { __leditorPaginationDebug?: boolean }).__leditorPaginationDebug === true;
};

const logDebug = (message: string, detail?: Record<string, unknown>) => {
  if (!debugEnabled()) return;
  if (detail) {
    const useJson =
      typeof window !== "undefined" &&
      (window as typeof window & { __leditorPaginationDebugJson?: boolean })
        .__leditorPaginationDebugJson === true;
    if (useJson) {
      try {
        console.info(`[PaginationDebug] ${message} ${JSON.stringify(detail)}`);
      } catch {
        console.info(`[PaginationDebug] ${message}`, detail);
      }
    } else {
      console.info(`[PaginationDebug] ${message}`, detail);
    }
    return;
  }
  console.info(`[PaginationDebug] ${message}`);
};

const shouldForceSingleColumn = (): boolean =>
  typeof window !== "undefined" && (window as any).__leditorDisableColumns !== false;

const enforceSingleColumnContent = (content: HTMLElement | null) => {
  if (!content || !shouldForceSingleColumn()) return;
  content.style.columnCount = "1";
  content.style.columnGap = "0px";
  content.style.columnFill = "auto";
  content.style.columnWidth = "auto";
};

const shouldLogBlockMetrics = (): boolean => {
  if (!debugEnabled()) return false;
  return (window as any).__leditorPaginationDebugBlocks === true;
};

const getPageIndexForContent = (content: HTMLElement): number | null => {
  const page =
    content.closest<HTMLElement>(PAGE_SELECTOR) ??
    content.closest<HTMLElement>(`.${PAGE_CLASS}`);
  if (!page) return null;
  const raw = page.dataset.pageIndex;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

const markPreserveScroll = () => {
  try {
    (window as any).__leditorPreserveScrollOnNextPagination = true;
  } catch {
    // ignore
  }
};

const dispatchPagination = (view: any, tr: any) => {
  markPreserveScroll();
  view.dispatch(tr);
};

const logPaginationStats = (view: any, label: string) => {
  if (!debugEnabled()) return;
  const domPages = Array.from(view.dom.querySelectorAll(PAGE_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  const overlays = Array.from(view.dom.querySelectorAll(`.${PAGE_INNER_CLASS}`)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  const firstContent = domPages[0]?.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
  const contentStyle = firstContent ? getComputedStyle(firstContent) : null;
  const paddingBottom = contentStyle ? Number.parseFloat(contentStyle.paddingBottom || "0") || 0 : null;
  console.info(`[PaginationDebug] ${label}`, {
    domPageCount: domPages.length,
    docPageCount: view.state.doc.childCount,
    overlayPageCount: overlays.length,
    pageContentHeight: firstContent?.clientHeight ?? null,
    pageContentPaddingBottom: paddingBottom,
    editorScrollHeight: view.dom.scrollHeight
  });
};

const getNumericStyle = (element: HTMLElement, prop: string): number => {
  const raw = getComputedStyle(element).getPropertyValue(prop).trim();
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getRelativeBox = (
  element: HTMLElement,
  content: HTMLElement
): { top: number; bottom: number; left: number; right: number } => {
  if (element.offsetParent === content) {
    const top = element.offsetTop;
    const left = element.offsetLeft;
    return {
      top,
      left,
      bottom: top + element.offsetHeight,
      right: left + element.offsetWidth
    };
  }
  const contentRect = content.getBoundingClientRect();
  const scale = getContentScale(content);
  const rect = element.getBoundingClientRect();
  return {
    top: (rect.top - contentRect.top) / scale,
    bottom: (rect.bottom - contentRect.top) / scale,
    left: (rect.left - contentRect.left) / scale,
    right: (rect.right - contentRect.left) / scale
  };
};

const getContentMetrics = (
  content: HTMLElement
): { usableHeight: number; paddingBottom: number; baseHeight: number } => {
  const style = getComputedStyle(content);
  const paddingBottom = Number.parseFloat(style.paddingBottom || "0") || 0;
  // Prefer clientHeight and rect/scale; avoid computed style heights that inflate under transforms.
  let baseHeight = content.clientHeight || 0;
  if (baseHeight <= 0) {
    const scrollHeight = content.scrollHeight || 0;
    if (scrollHeight > 0) {
      baseHeight = scrollHeight;
    }
  }
  if (baseHeight <= 0) {
    const rect = content.getBoundingClientRect();
    const scale = getContentScale(content);
    if (rect.height > 0 && scale > 0) {
      baseHeight = rect.height / scale;
    }
  }
  if (baseHeight <= 0) {
    const heightRaw = Number.parseFloat(style.height || "");
    const maxHeightRaw = Number.parseFloat(style.maxHeight || "");
    baseHeight =
      (Number.isFinite(heightRaw) && heightRaw > 0
        ? heightRaw
        : Number.isFinite(maxHeightRaw) && maxHeightRaw > 0
          ? maxHeightRaw
          : 0) || 0;
  }
  const usableHeight = Math.max(0, baseHeight - paddingBottom);
  return { usableHeight, paddingBottom, baseHeight };
};

const getContentScale = (content: HTMLElement): number => {
  const rect = content.getBoundingClientRect();
  const style = getComputedStyle(content);
  let base = content.clientHeight || 0;
  if (base <= 0) {
    const scrollHeight = content.scrollHeight || 0;
    if (scrollHeight > 0) {
      base = scrollHeight;
    }
  }
  if (base <= 0) {
    const heightRaw = Number.parseFloat(style.height || "");
    const maxHeightRaw = Number.parseFloat(style.maxHeight || "");
    base =
      (Number.isFinite(heightRaw) && heightRaw > 0
        ? heightRaw
        : Number.isFinite(maxHeightRaw) && maxHeightRaw > 0
          ? maxHeightRaw
          : rect.height) || 0;
  }
  if (!Number.isFinite(rect.height) || rect.height <= 0 || base <= 0) return 1;
  const scale = rect.height / base;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
};

const hasOnlyPages = (doc: any, pageType: any): boolean => {
  if (!doc || doc.childCount === 0) return false;
  for (let i = 0; i < doc.childCount; i += 1) {
    if (doc.child(i).type !== pageType) return false;
  }
  return true;
};

const wrapDocInPage = (state: any): any | null => {
  const pageType = state.schema.nodes.page;
  if (!pageType) return null;
  if (hasOnlyPages(state.doc, pageType)) return null;
  const pageNode = pageType.create(null, state.doc.content);
  const docNode = state.schema.topNodeType.create(state.doc.attrs, pageNode);
  return state.tr.replaceWith(0, state.doc.content.size, docNode.content);
};

const findPageDepth = ($pos: any, pageType: any): number => {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type === pageType) {
      return depth;
    }
  }
  return -1;
};

const findBlockDepth = ($pos: any, minDepth: number): number => {
  for (let depth = $pos.depth; depth > minDepth; depth -= 1) {
    const node = $pos.node(depth);
    if (node?.isBlock) return depth;
  }
  return minDepth + 1;
};

const shouldSplitAfter = (el: HTMLElement): boolean => {
  if (el.classList.contains("leditor-break")) {
    const kind = (el.dataset.breakKind || "").toLowerCase();
    if (kind === "page" || kind === "column") return true;
    if (kind === "section" || kind.startsWith("section_")) return true;
    return false;
  }
  return false;
};

const isHeadingTag = (tag: string): boolean => {
  if (tag.length === 2 && tag.startsWith("H")) {
    const level = Number(tag.slice(1));
    return Number.isFinite(level) && level >= 1 && level <= 6;
  }
  return false;
};

const isHeadingElement = (el: HTMLElement): boolean => isHeadingTag(el.tagName.toUpperCase());

const LINE_SPLIT_SELECTOR = "p, li, blockquote, pre";

const isLineSplitTag = (tag: string): boolean =>
  tag === "P" || tag === "LI" || tag === "BLOCKQUOTE" || tag === "PRE";

const isDivLineSplitCandidate = (el: HTMLElement): boolean => {
  const tag = el.tagName.toUpperCase();
  if (tag !== "DIV") return false;
  const dataType =
    (el.getAttribute("data-node-type") || el.getAttribute("data-type") || "").toLowerCase();
  if (dataType === "paragraph" || dataType === "heading") return true;
  // If the div contains a real block child, defer to that child instead of splitting the div.
  if (el.querySelector(BLOCK_SELECTOR)) return false;
  const text = (el.textContent || "").trim();
  return text.length > 0;
};

const getLineSplitRoot = (el: HTMLElement): HTMLElement | null => {
  if (isLineSplitElement(el)) return el;
  const tag = el.tagName.toUpperCase();
  if (tag === "UL" || tag === "OL") {
    const nested = el.querySelector<HTMLElement>(LINE_SPLIT_SELECTOR);
    return nested ? getLineSplitRoot(nested) : null;
  }
  if (tag === "LI" || tag === "BLOCKQUOTE") {
    const nested = el.querySelector<HTMLElement>(
      ":scope > p, :scope > pre"
    );
    return nested ?? el;
  }
  if (isLineSplitTag(tag)) return el;
  if (isDivLineSplitCandidate(el)) return el;
  const fallback = el.querySelector<HTMLElement>(LINE_SPLIT_SELECTOR);
  return fallback ? getLineSplitRoot(fallback) : null;
};

const hasKeepWithNext = (el: HTMLElement): boolean => {
  if (el.dataset.keepWithNext === "true" || el.classList.contains("leditor-keep-with-next")) {
    return true;
  }
  const style = getComputedStyle(el);
  const breakAfter = (style as any).breakAfter || style.getPropertyValue("break-after");
  const pageBreakAfter = (style as any).pageBreakAfter || style.getPropertyValue("page-break-after");
  const normalized = `${breakAfter || ""} ${pageBreakAfter || ""}`.toLowerCase();
  return normalized.includes("avoid");
};

const hasBreakInsideAvoid = (el: HTMLElement): boolean => {
  if (el.dataset.keepTogether === "true" || el.classList.contains("leditor-keep-together")) {
    return true;
  }
  const style = getComputedStyle(el);
  const breakInside = (style as any).breakInside || style.getPropertyValue("break-inside");
  const pageBreakInside = (style as any).pageBreakInside || style.getPropertyValue("page-break-inside");
  const normalized = `${breakInside || ""} ${pageBreakInside || ""}`.toLowerCase();
  return normalized.includes("avoid");
};

const isSplittableBlock = (el: HTMLElement): boolean => {
  const tag = el.tagName.toUpperCase();
  if (hasBreakInsideAvoid(el)) return false;
  return isLineSplitTag(tag);
};

const isFootnoteContainerElement = (el: HTMLElement): boolean => {
  if (el.classList.contains("leditor-footnotes-container")) return true;
  if (el.classList.contains("leditor-footnote-body")) return true;
  if (el.dataset.footnotesContainer === "true") return true;
  if (el.dataset.footnoteBody === "true") return true;
  return false;
};

const isBlockCandidate = (el: HTMLElement): boolean => {
  const tag = el.tagName.toUpperCase();
  if (isLineSplitTag(tag) || isHeadingTag(tag)) return true;
  if (isDivLineSplitCandidate(el)) return true;
  if (tag === "UL" || tag === "OL" || tag === "TABLE" || tag === "FIGURE" || tag === "HR") return true;
  if (el.classList.contains("leditor-break") || el.dataset.break === "true") return true;
  return false;
};

const BLOCK_SELECTOR = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "table",
  "figure",
  "hr",
  ".leditor-break"
].join(", ");

const collectBlockChildren = (root: HTMLElement, out: HTMLElement[]) => {
  const children = Array.from(root.children);
  for (const child of children) {
    if (!(child instanceof HTMLElement)) continue;
    if (isFootnoteContainerElement(child)) continue;
    if (isBlockCandidate(child)) {
      out.push(child);
      continue;
    }
    if (child.children.length > 0) {
      collectBlockChildren(child, out);
    }
  }
};

const getContentChildren = (content: HTMLElement): HTMLElement[] => {
  let container: HTMLElement = content;
  if (content.children.length === 1) {
    const only = content.children[0];
    if (
      only instanceof HTMLElement &&
      (only.classList.contains("ProseMirror") || only.getAttribute("contenteditable") === "true")
    ) {
      container = only;
    }
  }
  const rawBlocks = Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    .filter((el) => el instanceof HTMLElement)
    .filter((el) => el.closest(`.${PAGE_CONTENT_CLASS}`) === content)
    .filter((el) => !isFootnoteContainerElement(el))
    .filter((el) => !el.closest("[data-footnotes-container], .leditor-footnotes-container, [data-footnote-body], .leditor-footnote-body"));
  const filtered = rawBlocks.filter((el) => {
    let parent = el.parentElement;
    while (parent && parent !== container) {
      if (parent instanceof HTMLElement) {
        if (isFootnoteContainerElement(parent)) return false;
        if (parent.matches?.(BLOCK_SELECTOR)) return false;
      }
      parent = parent.parentElement;
    }
    return true;
  });
  if (filtered.length > 0) {
    return filtered;
  }
  const out: HTMLElement[] = [];
  collectBlockChildren(container, out);
  return out;
};

const ANCHOR_MARKER_SELECTOR = "a[name], a[id]";

const isAnchorOnlyElement = (el: HTMLElement): boolean => {
  const text = (el.textContent ?? "").trim();
  if (text.length > 0) return false;
  return Boolean(el.querySelector(ANCHOR_MARKER_SELECTOR));
};

const isAnchorOnlyContent = (content: HTMLElement): boolean => {
  const children = getContentChildren(content);
  if (children.length === 0) return true;
  return children.every((child) => isAnchorOnlyElement(child));
};

// Require extra slack before joining to avoid split/join oscillation at boundaries.
const DEFAULT_JOIN_BUFFER_PX = 12;
const DELETE_JOIN_BUFFER_PX = 0;
const MIN_SECTION_LINES = 1;
const MIN_UNDERFILL_LINES = 2;
const MIN_UNDERFILL_RATIO = 0.85;
const CRITICAL_UNDERFILL_LINES = 2;
const CRITICAL_UNDERFILL_RATIO = 0.4;
const MIN_LINE_SPLIT_TAIL_LINES = 1;
const MIN_LINE_SPLIT_HEAD_LINES = 1;
const BOTTOM_GUARD_PX = 6;
const PAGINATION_DEBUG_LAYER_CLASS = "leditor-pagination-debug-layer";
const PAGINATION_DEBUG_LINE_CLASS = "leditor-pagination-debug-line";
const PAGINATION_DEBUG_RECT_CLASS = "leditor-pagination-debug-rect";

const isLineSplitElement = (el: HTMLElement): boolean => {
  const tag = el.tagName.toUpperCase();
  if (isLineSplitTag(tag)) return true;
  return isDivLineSplitCandidate(el);
};
const isFootnoteStorageNode = (node: ProseMirrorNode | null | undefined): boolean => {
  const name = node?.type?.name;
  return name === "footnotesContainer" || name === "footnoteBody";
};

const isAnchorOnlyTextblock = (node: ProseMirrorNode): boolean => {
  if (!node?.isTextblock) return false;
  if (node.textContent.trim().length > 0) return false;
  let hasAnchorMarker = false;
  let hasOther = false;
  node.forEach((child) => {
    if (child.type?.name === "anchorMarker") {
      hasAnchorMarker = true;
      return;
    }
    if (child.isText) {
      if (child.text?.trim()) {
        hasOther = true;
      }
      return;
    }
    if (child.type?.name === "hardBreak") {
      hasOther = true;
      return;
    }
    if (child.childCount > 0 || child.isLeaf) {
      hasOther = true;
    }
  });
  return hasAnchorMarker && !hasOther;
};

const stripAnchorOnlyBlocks = (state: any, pageType: any): any | null => {
  const doc = state.doc;
  if (!doc) return null;
  const pages = new Map<number, { hasNonAnchor: boolean; ranges: Array<{ from: number; to: number }> }>();
  doc.nodesBetween(0, doc.content.size, (node: any, pos: number) => {
    if (!node?.isTextblock) return;
    let $pos;
    try {
      $pos = doc.resolve(pos);
    } catch {
      return;
    }
    const pageDepth = findPageDepth($pos, pageType);
    if (pageDepth < 0) return;
    const pageStart = $pos.start(pageDepth);
    let entry = pages.get(pageStart);
    if (!entry) {
      entry = { hasNonAnchor: false, ranges: [] };
      pages.set(pageStart, entry);
    }
    if (isAnchorOnlyTextblock(node)) {
      entry.ranges.push({ from: pos, to: pos + node.nodeSize });
    } else if (node.textContent.trim().length > 0 || node.childCount > 0) {
      entry.hasNonAnchor = true;
    }
  });
  if (!pages.size) return null;
  let tr = state.tr;
  let changed = false;
  const ranges: Array<{ from: number; to: number }> = [];
  for (const entry of pages.values()) {
    if (!entry.hasNonAnchor || entry.ranges.length === 0) continue;
    ranges.push(...entry.ranges);
  }
  if (!ranges.length) return null;
  ranges.sort((a, b) => b.from - a.from);
  for (const range of ranges) {
    try {
      if (range.to > range.from) {
        tr = tr.delete(range.from, range.to);
        changed = true;
      }
    } catch {
      // ignore delete failures
    }
  }
  return changed ? tr : null;
};

const collectParagraphText = (node: ProseMirrorNode): string => {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
};

const countHardBreaks = (node: ProseMirrorNode): number => {
  let count = 0;
  node.forEach((child) => {
    if (child.type?.name === "hardBreak") count += 1;
  });
  return count;
};

const normalizeParagraphInline = (node: ProseMirrorNode, schema: any): Fragment => {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    if (child.type?.name === "hardBreak") {
      const last = children[children.length - 1];
      const lastText = last?.isText ? (last.text ?? "") : "";
      if (!lastText.endsWith(" ")) {
        children.push(schema.text(" "));
      }
      return;
    }
    children.push(child);
  });
  return Fragment.fromArray(children);
};

const paragraphStartsWithPunct = (node: ProseMirrorNode): boolean => {
  for (let i = 0; i < node.childCount; i += 1) {
    const child = node.child(i);
    if (!child.isText) continue;
    const text = (child.text ?? "").trim();
    if (!text) continue;
    return /^[,.;:!?)]/.test(text);
  }
  return false;
};

const paragraphEndsWithSpace = (node: ProseMirrorNode): boolean => {
  for (let i = node.childCount - 1; i >= 0; i -= 1) {
    const child = node.child(i);
    if (!child.isText) continue;
    const text = child.text ?? "";
    if (!text) continue;
    return /\s$/.test(text);
  }
  return false;
};

const normalizeBrokenLines = (
  state: any,
  pageType: any,
  options?: { forceShortRuns?: boolean }
): any | null => {
  return null;
  /*
  const doc = state.doc;
  if (!doc) return null;
  type ParaInfo = {
    pos: number;
    node: ProseMirrorNode;
    pageIndex: number;
    isShort: boolean;
    wordCount: number;
    text: string;
    hardBreaks: number;
  };
  const paras: ParaInfo[] = [];
  let totalParas = 0;
  let shortParas = 0;
  let hardBreakParas = 0;
  let shortRunParas = 0;
  doc.nodesBetween(0, doc.content.size, (node: any, pos: number) => {
    if (!node?.isTextblock || node.type?.name !== "paragraph") return;
    let $pos;
    try {
      $pos = doc.resolve(pos);
    } catch {
      return;
    }
    const pageDepth = findPageDepth($pos, pageType);
    if (pageDepth < 0) return;
    if ($pos.depth !== pageDepth + 1) return;
    const text = collectParagraphText(node);
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const isShort = wordCount > 0 && wordCount <= 3 && text.length <= 24;
    const hardBreaks = countHardBreaks(node);
    totalParas += 1;
    if (isShort) shortParas += 1;
    if (hardBreaks >= 2) hardBreakParas += 1;
    paras.push({
      pos,
      node,
      pageIndex: $pos.index(0),
      isShort,
      wordCount,
      text,
      hardBreaks
    });
  });
  if (totalParas < 4) return null;
  const shortRatio = totalParas > 0 ? shortParas / totalParas : 0;
  const forceShortRuns = options?.forceShortRuns ?? false;
  const shouldNormalize = forceShortRuns || shortRatio >= 0.45 || hardBreakParas >= 4;
  if (!shouldNormalize) return null;
  let tr = state.tr;
  let changed = false;
  const mergedRanges: Array<{ from: number; to: number }> = [];

  const runs: ParaInfo[][] = [];
  let current: ParaInfo[] = [];
  for (let i = 0; i < paras.length; i += 1) {
    const prev = current[current.length - 1];
    const next = paras[i];
    if (
      prev &&
      next.pageIndex === prev.pageIndex &&
      next.pos === prev.pos + prev.node.nodeSize
    ) {
      current.push(next);
    } else {
      if (current.length) runs.push(current);
      current = [next];
    }
  }
  if (current.length) runs.push(current);

  for (let i = runs.length - 1; i >= 0; i -= 1) {
    const run = runs[i];
    if (run.length < (forceShortRuns ? 2 : 5)) continue;
    const shortCount = run.filter((p) => p.isShort).length;
    const avgWords =
      run.reduce((sum, p) => sum + p.wordCount, 0) / Math.max(1, run.length);
    if (!forceShortRuns && shortCount / run.length < 0.7 && avgWords > 2.5) continue;
    const start = run[0].pos;
    const end = run[run.length - 1].pos + run[run.length - 1].node.nodeSize;
    const schema = run[0].node.type.schema;
    const mergedChildren: ProseMirrorNode[] = [];
    for (let r = 0; r < run.length; r += 1) {
      const para = run[r].node;
      const normalized = normalizeParagraphInline(para, schema);
      const fragChildren: ProseMirrorNode[] = [];
      normalized.forEach((child) => fragChildren.push(child));
      if (fragChildren.length) {
        mergedChildren.push(...fragChildren);
      }
      const isLast = r === run.length - 1;
      if (!isLast) {
        const endsWithSpace = paragraphEndsWithSpace(para);
        const nextStartsWithPunct = paragraphStartsWithPunct(run[r + 1].node);
        if (!endsWithSpace && !nextStartsWithPunct) {
          mergedChildren.push(schema.text(" "));
        }
      }
    }
    const merged = run[0].node.type.create(run[0].node.attrs, Fragment.fromArray(mergedChildren), run[0].node.marks);
    try {
      tr = tr.replaceWith(start, end, merged);
      changed = true;
      mergedRanges.push({ from: start, to: end });
    } catch {
      // ignore merge failures
    }
  }

  const mergedContains = (pos: number) =>
    mergedRanges.some((range) => pos >= range.from && pos < range.to);

  for (let i = paras.length - 1; i >= 0; i -= 1) {
    const para = paras[i];
    if (mergedContains(para.pos)) continue;
    if (para.hardBreaks < 2) continue;
    const schema = para.node.type.schema;
    const normalized = normalizeParagraphInline(para.node, schema);
    const fragChildren: ProseMirrorNode[] = [];
    normalized.forEach((child) => fragChildren.push(child));
    const newNode = para.node.type.create(para.node.attrs, Fragment.fromArray(fragChildren), para.node.marks);
    try {
      tr = tr.replaceWith(para.pos, para.pos + para.node.nodeSize, newNode);
      changed = true;
    } catch {
      // ignore replace failures
    }
  }

  return changed ? tr : null;
  */
};

const hasManualBreaks = (doc: any): boolean => {
  let found = false;
  doc.nodesBetween(0, doc.content.size, (node: any) => {
    if (node?.type?.name === "page_break") {
      found = true;
      return false;
    }
    return true;
  });
  return found;
};

const flattenPagesForReflow = (
  state: any,
  pageType: any,
  options?: { normalizeShortParagraphs?: boolean }
): any | null => {
  return null;
  /*
  const doc = state.doc;
  if (!doc || doc.childCount <= 1) return null;
  if (hasManualBreaks(doc)) return null;
  const normalizeShort = options?.normalizeShortParagraphs ?? false;
  const mergedNodes: ProseMirrorNode[] = [];
  let storedFootnotes: ProseMirrorNode[] = [];
  const flushShortRun = (
    run: ProseMirrorNode[],
    schema: any
  ) => {
    if (!run.length) return;
    if (!normalizeShort || run.length === 1) {
      mergedNodes.push(...run);
      return;
    }
    const mergedChildren: ProseMirrorNode[] = [];
    for (let i = 0; i < run.length; i += 1) {
      const para = run[i];
      const normalized = normalizeParagraphInline(para, schema);
      const fragChildren: ProseMirrorNode[] = [];
      normalized.forEach((child) => fragChildren.push(child));
      if (fragChildren.length) mergedChildren.push(...fragChildren);
      const isLast = i === run.length - 1;
      if (!isLast) {
        const endsWithSpace = paragraphEndsWithSpace(para);
        const nextStartsWithPunct = paragraphStartsWithPunct(run[i + 1]);
        if (!endsWithSpace && !nextStartsWithPunct) {
          mergedChildren.push(schema.text(" "));
        }
      }
    }
    const mergedPara = run[0].type.create(run[0].attrs, Fragment.fromArray(mergedChildren), run[0].marks);
    mergedNodes.push(mergedPara);
  };
  let shortRun: ProseMirrorNode[] = [];
  const isShortPara = (node: ProseMirrorNode): boolean => {
    if (!node?.isTextblock || node.type?.name !== "paragraph") return false;
    const text = collectParagraphText(node);
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    return words > 0 && words <= 3 && text.length <= 28;
  };
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (!child || child.type !== pageType) return null;
    const storage = collectFootnoteStorage(child.content);
    if (!storedFootnotes.length && storage.length) {
      storedFootnotes = storage;
    }
    const stripped = stripFootnoteStorage(child.content);
    stripped.forEach((node) => {
      if (normalizeShort && isShortPara(node)) {
        shortRun.push(node);
        return;
      }
      if (shortRun.length) {
        flushShortRun(shortRun, node.type.schema);
        shortRun = [];
      }
      if (normalizeShort && node.type?.name === "paragraph") {
        const normalized = normalizeParagraphInline(node, node.type.schema);
        const fragChildren: ProseMirrorNode[] = [];
        normalized.forEach((childNode) => fragChildren.push(childNode));
        const updated = node.type.create(node.attrs, Fragment.fromArray(fragChildren), node.marks);
        mergedNodes.push(updated);
      } else {
        mergedNodes.push(node);
      }
    });
  }
  if (shortRun.length) {
    flushShortRun(shortRun, shortRun[0].type.schema);
    shortRun = [];
  }
  if (!mergedNodes.length) return null;
  if (storedFootnotes.length) {
    mergedNodes.push(...storedFootnotes);
  }
  const pageAttrs = doc.child(0)?.attrs ?? null;
  const mergedPage = pageType.create(pageAttrs, Fragment.fromArray(mergedNodes));
  const replacement = Fragment.fromArray([mergedPage]);
  let tr = state.tr.replaceWith(0, doc.content.size, replacement);
  try {
    const mapped = tr.mapping.map(state.selection.from);
    const resolved = tr.doc.resolve(Math.max(0, Math.min(tr.doc.content.size, mapped)));
    tr = tr.setSelection(Selection.near(resolved, 1));
  } catch {
    // ignore selection mapping failures
  }
  return tr;
  */
};

const stripFootnoteStorage = (content: Fragment): Fragment => {
  const nodes: ProseMirrorNode[] = [];
  content.forEach((node) => {
    if (isFootnoteStorageNode(node)) return;
    nodes.push(node);
  });
  return Fragment.fromArray(nodes);
};

const collectFootnoteStorage = (content: Fragment): ProseMirrorNode[] => {
  const nodes: ProseMirrorNode[] = [];
  content.forEach((node) => {
    if (isFootnoteStorageNode(node)) {
      nodes.push(node);
    }
  });
  return nodes;
};

const hasFootnoteStorage = (content: Fragment): boolean => {
  let found = false;
  content.forEach((node) => {
    if (isFootnoteStorageNode(node)) found = true;
  });
  return found;
};

const splitPageNode = (
  tr: any,
  pagePos: number,
  pageNode: ProseMirrorNode,
  splitOffset: number,
  pageType: any
): any | null => {
  const adjustForFootnoteStorage = (node: ProseMirrorNode, offset: number): number => {
    let cursor = 0;
    let lastNonFootnoteEnd = 0;
    let storageStart: number | null = null;
    node.content.forEach((child) => {
      const start = cursor;
      const end = cursor + child.nodeSize;
      if (isFootnoteStorageNode(child)) {
        if (storageStart == null) storageStart = start;
        if (offset > start && offset < end) {
          offset = start;
        }
      } else {
        lastNonFootnoteEnd = end;
      }
      cursor = end;
    });
    if (storageStart != null && offset > storageStart && lastNonFootnoteEnd > 0) {
      offset = Math.min(offset, lastNonFootnoteEnd);
    }
    return offset;
  };

  splitOffset = adjustForFootnoteStorage(pageNode, splitOffset);
  if (!pageNode || splitOffset <= 0 || splitOffset >= pageNode.content.size) {
    if (debugEnabled()) {
      logDebug("manual split invalid offset", {
        splitOffset,
        contentSize: pageNode?.content?.size ?? null
      });
    }
    return null;
  }
  const storedFootnotes = collectFootnoteStorage(pageNode.content);
  const applyFootnoteStorage = (left: Fragment, right: Fragment) => {
    let nextLeft = left;
    let nextRight = stripFootnoteStorage(right);
    if (storedFootnotes.length && !hasFootnoteStorage(nextLeft)) {
      nextLeft = nextLeft.append(Fragment.fromArray(storedFootnotes));
    }
    return { left: nextLeft, right: nextRight };
  };
  const sliceAt = (offset: number) => {
    const rawLeft = pageNode.content.cut(0, offset);
    const rawRight = pageNode.content.cut(offset);
    return applyFootnoteStorage(rawLeft, rawRight);
  };
  let { left, right } = sliceAt(splitOffset);
  if (left.childCount === 0 || right.childCount === 0) {
    const boundaries: number[] = [];
    let acc = 0;
    pageNode.content.forEach((child) => {
      acc += child.nodeSize;
      if (acc > 0 && acc < pageNode.content.size) boundaries.push(acc);
    });
    let fallbackOffset: number | null = null;
    let bestDistance = Infinity;
    for (const candidate of boundaries) {
      const attempt = sliceAt(candidate);
      if (attempt.left.childCount === 0 || attempt.right.childCount === 0) continue;
      const distance = Math.abs(candidate - splitOffset);
      if (distance < bestDistance) {
        bestDistance = distance;
        fallbackOffset = candidate;
      }
    }
    if (fallbackOffset != null) {
      ({ left, right } = sliceAt(fallbackOffset));
      splitOffset = fallbackOffset;
    }
  }
  if (left.childCount === 0 || right.childCount === 0) {
    if (debugEnabled()) {
      logDebug("manual split empty side", {
        splitOffset,
        leftCount: left.childCount,
        rightCount: right.childCount
      });
    }
    return null;
  }
  const leftPage = pageType.create(pageNode.attrs, left);
  const rightPage = pageType.create(pageNode.attrs, right);
  const replacement = Fragment.fromArray([leftPage, rightPage]);
  return tr.replaceWith(pagePos, pagePos + pageNode.nodeSize, replacement);
};

const markPaginationSplitId = (
  tr: any,
  splitPos: number,
  splitId: string
): void => {
  try {
    const mapped = tr.mapping.map(splitPos);
    const $mapped = tr.doc.resolve(mapped);
    const before = $mapped.nodeBefore;
    const after = $mapped.nodeAfter;
    if (before?.type?.name === "paragraph" && after?.type?.name === "paragraph") {
      const beforePos = mapped - before.nodeSize;
      const afterPos = mapped;
      const beforeAttrs = { ...(before.attrs as any), paginationSplitId: splitId };
      const afterAttrs = { ...(after.attrs as any), paginationSplitId: splitId };
      tr.setNodeMarkup(beforePos, before.type, beforeAttrs, before.marks);
      tr.setNodeMarkup(afterPos, after.type, afterAttrs, after.marks);
    }
  } catch {
    // ignore split marker failures
  }
};

const setSafeSelection = (tr: any, pos: number, bias = 1): void => {
  try {
    const bounded = Math.max(0, Math.min(tr.doc.content.size, pos));
    const resolved = tr.doc.resolve(bounded);
    if (resolved.parent?.inlineContent) {
      tr.setSelection(TextSelection.create(tr.doc, resolved.pos));
      return;
    }
    tr.setSelection(Selection.near(resolved, bias));
  } catch (error) {
    logDebug("selection map failed", { pos, error: String(error) });
  }
};

const resolvePageBoundaryPos = (
  doc: any,
  pageType: any,
  pageDepth: number,
  mappedPos: number
): { pos: number; resolved: any } | null => {
  const offsets = [0, -1, 1, -2, 2, -3, 3, -4, 4];
  for (const offset of offsets) {
    const candidate = mappedPos + offset;
    if (candidate <= 0 || candidate >= doc.content.size) continue;
    const $cand = doc.resolve(candidate);
    if (findPageDepth($cand, pageType) !== pageDepth) continue;
    if ($cand.depth === pageDepth) {
      return { pos: candidate, resolved: $cand };
    }
    if ($cand.depth > pageDepth) {
      try {
        const before = $cand.before($cand.depth);
        const after = $cand.after($cand.depth);
        const boundaryCandidates = [before, after];
        for (const boundary of boundaryCandidates) {
          if (boundary <= 0 || boundary >= doc.content.size) continue;
          const $boundary = doc.resolve(boundary);
          if ($boundary.depth === pageDepth) {
            return { pos: boundary, resolved: $boundary };
          }
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
};

const resolveBlockBoundaryPos = (
  doc: any,
  pageType: any,
  pageDepth: number,
  mappedPos: number
): { pos: number; resolved: any } | null => {
  try {
    const $pos = doc.resolve(mappedPos);
    if (findPageDepth($pos, pageType) !== pageDepth) return null;
    if ($pos.depth <= pageDepth) {
      return { pos: mappedPos, resolved: $pos };
    }
    const blockDepth = findBlockDepth($pos, pageDepth);
    const candidates: number[] = [];
    if ($pos.depth >= blockDepth) {
      try {
        candidates.push($pos.before(blockDepth));
      } catch {
        // ignore
      }
      try {
        candidates.push($pos.after(blockDepth));
      } catch {
        // ignore
      }
    }
    candidates.push(mappedPos);
    for (const candidate of candidates) {
      if (candidate <= 0 || candidate >= doc.content.size) continue;
      const $cand = doc.resolve(candidate);
      if ($cand.depth === pageDepth) {
        return { pos: candidate, resolved: $cand };
      }
    }
  } catch {
    // ignore
  }
  return null;
};

const attemptManualPageSplit = (
  trBase: any,
  splitPos: number,
  pageDepth: number,
  pageType: any,
  selectionFrom: number | null,
  splitId?: string
): any | null => {
  try {
    const $split = trBase.doc.resolve(splitPos);
    const resolvedPageDepth = findPageDepth($split, pageType);
    if (resolvedPageDepth < 0) return null;
    const effectivePageDepth = resolvedPageDepth !== pageDepth ? resolvedPageDepth : pageDepth;
    const pageNode = $split.node(effectivePageDepth);
    const pagePos = $split.before(effectivePageDepth);
    const pageStart = $split.start(effectivePageDepth);
    const splitOffset = splitPos - pageStart;
    if (debugEnabled()) {
      logDebug("manual page split attempt", {
        splitPos,
        splitOffset,
        pageStart,
        pageDepth: effectivePageDepth,
        contentSize: pageNode?.content?.size ?? null
      });
    }
    const trReplace = splitPageNode(trBase, pagePos, pageNode, splitOffset, pageType);
    if (!trReplace) {
      logDebug("manual page split failed", {
        splitPos,
        splitOffset,
        pageStart,
        pageDepth: effectivePageDepth,
        contentSize: pageNode?.content?.size ?? null
      });
      return null;
    }
    if (debugEnabled()) {
      logDebug("manual page split success", {
        splitPos,
        pageDepth: effectivePageDepth,
        newPageCount: trReplace.doc?.childCount ?? null
      });
    }
    if (splitId) {
      markPaginationSplitId(trReplace, splitPos, splitId);
    }
    if (typeof selectionFrom === "number" && selectionFrom >= splitPos) {
      const mapped = trReplace.mapping.map(selectionFrom);
      setSafeSelection(trReplace, mapped);
    }
    trReplace.setMeta(paginationKey, { source: "pagination", op: "split", pos: splitPos, manual: true });
    return trReplace;
  } catch (error) {
    logDebug("manual page split threw", { splitPos, error: String(error) });
    return null;
  }
};

const attemptManualPageJoin = (
  trBase: any,
  joinPos: number,
  pageType: any,
  selectionFrom: number | null
): any | null => {
  try {
    const doc = trBase.doc;
    const $pos = doc.resolve(joinPos);
    const before = $pos.nodeBefore;
    const after = $pos.nodeAfter;
    if (!before || !after || before.type !== pageType || after.type !== pageType) return null;
    const beforePos = joinPos - before.nodeSize;
    const afterPos = joinPos;
    let left = before.content;
    let right = after.content;
    const leftStored = collectFootnoteStorage(left);
    const rightStored = collectFootnoteStorage(right);
    left = stripFootnoteStorage(left);
    right = stripFootnoteStorage(right);
    let merged = left.append(right);
    const storage = leftStored.length > 0 ? leftStored : rightStored;
    if (storage.length > 0) {
      merged = merged.append(Fragment.fromArray(storage));
    }
    if (merged.childCount === 0) return null;
    const mergedPage = pageType.create(before.attrs, merged);
    const tr = trBase.replaceWith(beforePos, afterPos + after.nodeSize, mergedPage);
    if (typeof selectionFrom === "number") {
      const mapped = tr.mapping.map(selectionFrom);
      setSafeSelection(tr, mapped);
    }
    tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos, manual: true });
    return tr;
  } catch (error) {
    logDebug("manual page join threw", { joinPos, error: String(error) });
    return null;
  }
};

const ensureDebugLayer = (content: HTMLElement): HTMLElement => {
  let layer = content.querySelector<HTMLElement>(`.${PAGINATION_DEBUG_LAYER_CLASS}`);
  if (layer) return layer;
  layer = document.createElement("div");
  layer.className = PAGINATION_DEBUG_LAYER_CLASS;
  layer.style.position = "absolute";
  layer.style.left = "0";
  layer.style.top = "0";
  layer.style.right = "0";
  layer.style.bottom = "0";
  layer.style.pointerEvents = "none";
  layer.style.zIndex = "20";
  if (!content.style.position || content.style.position === "static") {
    content.style.position = "relative";
  }
  content.appendChild(layer);
  return layer;
};

const renderDebugLine = (content: HTMLElement, lineRect: LineRect) => {
  if (!debugEnabled()) return;
  const contentRect = content.getBoundingClientRect();
  const layer = ensureDebugLayer(content);
  const existingLine = layer.querySelectorAll(`.${PAGINATION_DEBUG_LINE_CLASS}`);
  existingLine.forEach((node) => node.remove());
  const existingRect = layer.querySelectorAll(`.${PAGINATION_DEBUG_RECT_CLASS}`);
  existingRect.forEach((node) => node.remove());
  const line = document.createElement("div");
  line.className = PAGINATION_DEBUG_LINE_CLASS;
  line.style.position = "absolute";
  line.style.left = "0";
  line.style.right = "0";
  line.style.top = `${Math.max(0, lineRect.bottom - contentRect.top)}px`;
  line.style.borderTop = "1px dashed rgba(255, 0, 0, 0.75)";
  const rect = document.createElement("div");
  rect.className = PAGINATION_DEBUG_RECT_CLASS;
  rect.style.position = "absolute";
  rect.style.left = `${Math.max(0, lineRect.left - contentRect.left)}px`;
  rect.style.top = `${Math.max(0, lineRect.top - contentRect.top)}px`;
  rect.style.width = `${Math.max(0, lineRect.width)}px`;
  rect.style.height = `${Math.max(0, lineRect.height)}px`;
  rect.style.background = "rgba(255, 0, 0, 0.08)";
  rect.style.border = "1px solid rgba(255, 0, 0, 0.35)";
  layer.appendChild(rect);
  layer.appendChild(line);
};

const renderDebugLimit = (content: HTMLElement, bottomLimit: number) => {
  if (!debugEnabled()) return;
  const layer = ensureDebugLayer(content);
  const existing = layer.querySelectorAll(".leditor-pagination-debug-limit");
  existing.forEach((node) => node.remove());
  const limit = document.createElement("div");
  limit.className = "leditor-pagination-debug-limit";
  limit.style.position = "absolute";
  limit.style.left = "0";
  limit.style.right = "0";
  limit.style.top = `${Math.max(0, bottomLimit)}px`;
  limit.style.borderTop = "1px dotted rgba(0, 120, 255, 0.6)";
  limit.style.pointerEvents = "none";
  layer.appendChild(limit);
};

const describePos = (doc: any, pos: number) => {
  try {
    const $pos = doc.resolve(pos);
    const path = [];
    for (let depth = 0; depth <= $pos.depth; depth += 1) {
      const node = $pos.node(depth);
      if (!node) continue;
      path.push({
        depth,
        type: node.type?.name,
        index: depth === 0 ? $pos.index(depth) : $pos.index(depth),
        start: depth === 0 ? 0 : $pos.start(depth),
        end: depth === 0 ? doc.content.size : $pos.end(depth)
      });
    }
    return { pos, depth: $pos.depth, parent: $pos.parent?.type?.name, parentOffset: $pos.parentOffset, path };
  } catch (error) {
    return { pos, error: String(error) };
  }
};

type LineRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

const collectTextNodes = (root: HTMLElement): Text[] => {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!(node instanceof Text)) return NodeFilter.FILTER_REJECT;
      if (!node.data || !node.data.trim()) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  let current = walker.nextNode();
  while (current) {
    if (current instanceof Text) nodes.push(current);
    current = walker.nextNode();
  }
  return nodes;
};

const collectLineRects = (root: HTMLElement): LineRect[] => {
  const textNodes = collectTextNodes(root);
  const raw: LineRect[] = [];
  for (const node of textNodes) {
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = Array.from(range.getClientRects());
    for (const rect of rects) {
      if (!rect || rect.height <= 0 || rect.width <= 0) continue;
      raw.push({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      });
    }
  }
  if (!raw.length) return [];
  raw.sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: LineRect[] = [];
  const tolerance = 1;
  for (const rect of raw) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(rect.top - last.top) <= tolerance) {
      const left = Math.min(last.left, rect.left);
      const right = Math.max(last.right, rect.right);
      const top = Math.min(last.top, rect.top);
      const bottom = Math.max(last.bottom, rect.bottom);
      last.left = left;
      last.right = right;
      last.top = top;
      last.bottom = bottom;
      last.width = right - left;
      last.height = bottom - top;
    } else {
      lines.push({ ...rect });
    }
  }
  return lines;
};

const parseLineCount = (raw: string | null | undefined, fallback: number) => {
  const trimmed = (raw ?? "").trim();
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
};

const getWidowOrphanLimits = (content: HTMLElement, block: HTMLElement) => {
  const contentStyle = getComputedStyle(content);
  const blockStyle = getComputedStyle(block);
  const widowRaw =
    contentStyle.getPropertyValue("--widow-lines") ||
    blockStyle.getPropertyValue("--widow-lines") ||
    "";
  const orphanRaw =
    contentStyle.getPropertyValue("--orphan-lines") ||
    blockStyle.getPropertyValue("--orphan-lines") ||
    "";
  return {
    widowLines: parseLineCount(widowRaw, 1),
    orphanLines: parseLineCount(orphanRaw, 1)
  };
};

const clampTrailingWordOffset = (text: string, offset: number): number => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  if (!text || safeOffset <= 0) return safeOffset;
  // Prefer splitting after the last fully visible word to avoid
  // leaving early gaps at the end of a page.
  let end = safeOffset;
  while (end > 0 && /\s/.test(text[end - 1] ?? "")) end -= 1;
  if (end <= 0) return safeOffset;
  let forward = end;
  while (forward < text.length && !/\s/.test(text[forward] ?? "")) forward += 1;
  if (forward > safeOffset) return forward;
  return end;
};

const resolveInlinePos = (view: any, pos: number, blockStart: number, blockEnd: number): number | null => {
  const doc = view.state.doc;
  const clamp = (value: number) =>
    Math.max(blockStart + 1, Math.min(blockEnd - 1, value));
  const isInline = (value: number) => {
    const $pos = doc.resolve(value);
    return $pos.parent.inlineContent;
  };
  let candidate = clamp(pos);
  if (isInline(candidate)) return candidate;
  for (let step = 1; step <= 8; step += 1) {
    const left = clamp(candidate - step);
    if (isInline(left)) return left;
    const right = clamp(candidate + step);
    if (isInline(right)) return right;
  }
  try {
    const $pos = doc.resolve(candidate);
    const near = Selection.near($pos, 1);
    const nearPos = clamp((near as any)?.from ?? candidate);
    if (isInline(nearPos)) return nearPos;
  } catch {
    // ignore
  }
  return null;
};

const findNearestSplittablePos = (
  doc: any,
  pos: number,
  blockStart: number,
  blockEnd: number,
  depth: number,
  maxScan = 96
): number | null => {
  const clamp = (value: number) =>
    Math.max(blockStart + 1, Math.min(blockEnd - 1, value));
  const start = clamp(pos);
  const limit = Math.max(0, Math.min(maxScan, blockEnd - blockStart - 2));
  for (let delta = 0; delta <= limit; delta += 1) {
    const left = start - delta;
    if (left > blockStart + 1 && canSplit(doc, left, depth)) {
      return left;
    }
    const right = start + delta;
    if (right < blockEnd - 1 && canSplit(doc, right, depth)) {
      return right;
    }
  }
  return null;
};

const findSplitPosByRange = (
  view: any,
  lineRoot: HTMLElement,
  maxBottom: number
): number | null => {
  const textNodes = collectTextNodes(lineRoot);
  if (!textNodes.length) return null;
  const lengths = textNodes.map((node) => node.nodeValue?.length ?? 0);
  const total = lengths.reduce((acc, len) => acc + len, 0);
  if (total < 2) return null;
  const resolveDomOffset = (offset: number): { node: Text; offset: number } | null => {
    let remaining = Math.max(0, Math.min(total, offset));
    for (let i = 0; i < textNodes.length; i += 1) {
      const len = lengths[i];
      if (remaining <= len) {
        return { node: textNodes[i], offset: remaining };
      }
      remaining -= len;
    }
    const last = textNodes[textNodes.length - 1];
    return last ? { node: last, offset: lengths[lengths.length - 1] } : null;
  };
  const range = document.createRange();
  try {
    range.setStart(lineRoot, 0);
  } catch {
    // ignore
  }
  let low = 1;
  let high = total - 1;
  let best: number | null = null;
  let safety = 0;
  while (low <= high && safety < 48) {
    safety += 1;
    const mid = Math.floor((low + high) / 2);
    const target = resolveDomOffset(mid);
    if (!target) break;
    try {
      range.setEnd(target.node, target.offset);
    } catch {
      high = mid - 1;
      continue;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || rect.height <= 0) {
      high = mid - 1;
      continue;
    }
    if (rect.bottom <= maxBottom) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best == null) return null;
  const resolved = resolveDomOffset(best);
  if (!resolved) return null;
  try {
    const pos = view.posAtDOM(resolved.node, resolved.offset);
    return typeof pos === "number" && pos > 0 ? pos : null;
  } catch {
    return null;
  }
};

const attemptLineSplitPageSplit = (
  view: any,
  splitPos: number,
  pageDepth: number,
  pageType: any,
  splitReason: "keepWithNext" | "overflow" | "manual",
  memo: PaginationMemo,
  markPaginationSplit: boolean
): any | null => {
  try {
    const state = view.state;
    const selectionFrom = state.selection?.from ?? null;
    const $split = state.doc.resolve(splitPos);
    const blockDepth = findBlockDepth($split, pageDepth);
    const paragraphDepth = Math.max(1, $split.depth - blockDepth);
    const blockStart = $split.start(blockDepth);
    const blockEnd = $split.end(blockDepth);
    let splitCandidate = splitPos;
    if (!canSplit(state.doc, splitCandidate, paragraphDepth)) {
      const nearest = findNearestSplittablePos(state.doc, splitCandidate, blockStart, blockEnd, paragraphDepth);
      if (!nearest) return null;
      splitCandidate = nearest;
    }
    let tr = state.tr.split(splitCandidate, paragraphDepth);
    const mappedSplit = tr.mapping.map(splitCandidate, -1);
    const boundaryInfo = resolvePageBoundaryPos(tr.doc, pageType, pageDepth, mappedSplit);
    let boundaryPos = boundaryInfo?.pos ?? mappedSplit;
    const boundaryResolved = boundaryInfo?.resolved ?? tr.doc.resolve(boundaryPos);
    let pageStart = 0;
    let pageEnd = 0;
    try {
      pageStart = boundaryResolved.start(pageDepth);
      pageEnd = boundaryResolved.end(pageDepth);
    } catch {
      // ignore
    }
    if (boundaryPos <= pageStart || boundaryPos >= pageEnd) {
      // Try to nudge to a nearby page-depth boundary.
      const altInfo = resolvePageBoundaryPos(tr.doc, pageType, pageDepth, boundaryPos + 1);
      if (altInfo && altInfo.pos > pageStart && altInfo.pos < pageEnd) {
        boundaryPos = altInfo.pos;
      } else {
        // Fall back to splitting the page directly at the mapped line split position.
        const manual = attemptManualPageSplit(tr, mappedSplit, pageDepth, pageType, selectionFrom);
        if (manual) {
          manual.setMeta(paginationKey, { source: "pagination", op: "split", pos: mappedSplit });
          memo.lastSplitPos = mappedSplit;
          memo.lastSplitAt = performance.now();
          memo.lastSplitReason = splitReason;
          if (splitReason === "keepWithNext") {
            memo.lockedJoinPos.set(mappedSplit, {
              docSize: state.doc.content.size,
              at: memo.lastSplitAt,
              reason: splitReason
            });
          }
          if (typeof selectionFrom === "number" && selectionFrom >= splitCandidate) {
            const mapped = manual.mapping.map(selectionFrom);
            setSafeSelection(manual, mapped);
          }
          return manual;
        }
        return null;
      }
    }
    let didSplit = false;
    if (canSplit(tr.doc, boundaryPos, 1)) {
      try {
        tr = tr.split(boundaryPos, 1);
        didSplit = true;
      } catch (error) {
        logDebug("line split page-only threw", { boundaryPos, error: String(error) });
      }
    }
    if (!didSplit) {
      const boundaryDepth = Math.max(1, boundaryResolved.depth - pageDepth);
      const boundaryTypes: Array<{ type: any; attrs?: any } | null> = new Array(boundaryDepth).fill(null);
      boundaryTypes[0] = { type: pageType };
      for (let i = 1; i < boundaryDepth; i += 1) {
        const depthAt = pageDepth + i;
        if (depthAt > boundaryResolved.depth) break;
        const nodeAt = boundaryResolved.node(depthAt);
        if (!nodeAt) break;
        boundaryTypes[i] = { type: nodeAt.type, attrs: nodeAt.attrs };
      }
      if (canSplit(tr.doc, boundaryPos, boundaryDepth, boundaryTypes as any)) {
        try {
          tr = tr.split(boundaryPos, boundaryDepth, boundaryTypes as any);
          didSplit = true;
        } catch (error) {
          logDebug("line split boundary threw", { boundaryPos, boundaryDepth, error: String(error) });
        }
      }
    }
    if (!didSplit) {
    const manual =
        attemptManualPageSplit(tr, boundaryPos, pageDepth, pageType, selectionFrom) ??
        attemptManualPageSplit(tr, mappedSplit, pageDepth, pageType, selectionFrom);
      if (manual) {
        tr = manual;
        didSplit = true;
      }
    }
    if (!didSplit) return null;
    tr.setMeta(paginationKey, { source: "pagination", op: "split", pos: boundaryPos });
    memo.lastSplitPos = boundaryPos;
    memo.lastSplitAt = performance.now();
    memo.lastSplitReason = splitReason;
    if (splitReason === "keepWithNext") {
      memo.lockedJoinPos.set(boundaryPos, {
        docSize: state.doc.content.size,
        at: memo.lastSplitAt,
        reason: splitReason
      });
    }
    if (typeof selectionFrom === "number" && selectionFrom >= splitCandidate) {
      const mapped = tr.mapping.map(selectionFrom);
      setSafeSelection(tr, mapped);
    }
    if (markPaginationSplit) {
      const splitId = `ps-${memo.splitIdCounter++}`;
      const mapped = tr.mapping.map(boundaryPos);
      const $mapped = tr.doc.resolve(mapped);
      const before = $mapped.nodeBefore;
      const after = $mapped.nodeAfter;
      if (before?.type?.name === "paragraph" && after?.type?.name === "paragraph") {
        const beforePos = mapped - before.nodeSize;
        const afterPos = mapped;
        const beforeAttrs = { ...(before.attrs as any), paginationSplitId: splitId };
        const afterAttrs = { ...(after.attrs as any), paginationSplitId: splitId };
        tr.setNodeMarkup(beforePos, before.type, beforeAttrs, before.marks);
        tr.setNodeMarkup(afterPos, after.type, afterAttrs, after.marks);
      }
    }
    return tr;
  } catch (error) {
    logDebug("line split pagination threw", { splitPos, error: String(error) });
    return null;
  }
};

const hasAnchorMark = (node: any): boolean => {
  if (!node?.isText) return false;
  const marks = node.marks ?? [];
  return marks.some((mark: any) => mark?.type?.name === "anchor");
};

const isAnchorInlineNode = (node: any): boolean => node?.type?.name === "anchorMarker";

const hasAnchorOnlyTail = (parent: any, offset: number): boolean => {
  let hasAnchor = false;
  let hasNonAnchor = false;
  try {
    parent.nodesBetween(offset, parent.content.size, (node: any) => {
      if (!node) return;
      if (node.isText) {
        const text = node.text ?? "";
        if (!text.trim()) return;
        if (hasAnchorMark(node)) {
          hasAnchor = true;
        } else {
          hasNonAnchor = true;
        }
        return;
      }
      if (node.type?.name === "anchorMarker") {
        hasAnchor = true;
        return;
      }
      if (node.isLeaf || node.childCount > 0) {
        hasNonAnchor = true;
      }
    });
  } catch {
    return false;
  }
  return hasAnchor && !hasNonAnchor;
};

const adjustSplitPosForAnchors = (
  doc: any,
  pos: number,
  blockStart: number,
  blockEnd: number
): number => {
  try {
    const $pos = doc.resolve(pos);
    const parent = $pos.parent;
    if (!parent?.inlineContent) return pos;
    const offset = $pos.parentOffset;
    const before = parent.childBefore(offset);
    const after = parent.childAfter(offset);
    const start = $pos.start($pos.depth);
    const hasAnchor = (node: any) => isAnchorInlineNode(node) || hasAnchorMark(node);
    if (after?.node && hasAnchor(after.node)) {
      const nextPos = start + after.offset;
      if (nextPos > blockStart + 1 && nextPos < blockEnd - 1) {
        return nextPos;
      }
    }
    if (before?.node && hasAnchor(before.node)) {
      const prevPos = start + before.offset;
      if (prevPos > blockStart + 1 && prevPos < blockEnd - 1) {
        return prevPos;
      }
    }
  } catch {
    // ignore
  }
  return pos;
};

const findLineSplitPos = (
  view: any,
  pageType: any,
  pageDepth: number,
  content: HTMLElement,
  block: HTMLElement
): number | null => {
  const { usableHeight } = getContentMetrics(content);
  if (usableHeight <= 0) return null;
  const contentRect = content.getBoundingClientRect();
  const scale = getContentScale(content);
  const lineHeightRaw = getComputedStyle(block).lineHeight;
  const lineHeight = Number.parseFloat(lineHeightRaw || "0");
  const guardPx = Math.max(
    BOTTOM_GUARD_PX,
    Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight * 0.25 : 0
  );
  const bottomLimit = Math.max(0, usableHeight - guardPx);
  const lineRoot = (() => {
    const direct = getLineSplitRoot(block);
    if (direct && isLineSplitElement(direct)) return direct;
    const descendant = findOverflowDescendant(block, content, bottomLimit, 1);
    if (descendant && isLineSplitElement(descendant)) return descendant;
    return null;
  })();
  if (!lineRoot) return null;
  const lineHeightRootRaw = getComputedStyle(lineRoot).lineHeight;
  const lineHeightRoot = Number.parseFloat(lineHeightRootRaw || "0");
  const guardPxRoot = Math.max(
    BOTTOM_GUARD_PX,
    Number.isFinite(lineHeightRoot) && lineHeightRoot > 0 ? lineHeightRoot * 0.25 : 0
  );
  const bottomLimitRoot = Math.max(0, usableHeight - guardPxRoot);
  const maxBottomAbs = contentRect.top + bottomLimitRoot * scale;
  const lineRects = collectLineRects(lineRoot);
  const rangePos = findSplitPosByRange(view, lineRoot, maxBottomAbs);
  let lastVisibleIndex = -1;
  if (lineRects.length > 0) {
    for (let i = 0; i < lineRects.length; i += 1) {
      const relBottom = (lineRects[i].bottom - contentRect.top) / scale;
      if (relBottom <= bottomLimitRoot) {
        lastVisibleIndex = i;
      }
    }
  }
  if (lastVisibleIndex < 0 && !rangePos) return null;
  const { widowLines, orphanLines } = getWidowOrphanLimits(content, block);
  const enforcedWidowLines = Math.max(widowLines, MIN_LINE_SPLIT_TAIL_LINES);
  const enforcedOrphanLines = Math.max(orphanLines, MIN_LINE_SPLIT_HEAD_LINES);
  const chooseTargetIndex = (minWidows: number, minOrphans: number): number | null => {
    let target = lastVisibleIndex;
    if (minWidows > 0) {
      const minIndexForWidow = lineRects.length - minWidows - 1;
      if (minIndexForWidow < 0) return null;
      target = Math.min(target, minIndexForWidow);
    }
    if (target < 0) return null;
    if (minOrphans > 0 && target + 1 < minOrphans) return null;
    return target;
  };
  let targetIndex = chooseTargetIndex(enforcedWidowLines, enforcedOrphanLines);
  if (targetIndex == null && (enforcedWidowLines > 1 || enforcedOrphanLines > 1)) {
    targetIndex = chooseTargetIndex(1, 1);
    if (debugEnabled()) {
      logDebug("line split relax widows/orphans", {
        enforcedWidowLines,
        enforcedOrphanLines,
        relaxedTargetIndex: targetIndex
      });
    }
  }
  let lineRect: LineRect | null = null;
  if (targetIndex != null && lineRects.length > 0) {
    lineRect = lineRects[targetIndex];
    renderDebugLine(content, lineRect);
    if (debugEnabled()) {
      logDebug("line split rect", {
        rect: {
          left: lineRect.left,
          top: lineRect.top,
          right: lineRect.right,
          bottom: lineRect.bottom,
          width: lineRect.width,
          height: lineRect.height
        }
      });
    }
  }
  const x = lineRect
    ? Math.max(lineRect.left + 1, Math.min(lineRect.right - 1, lineRect.left + lineRect.width - 1))
    : Math.max(contentRect.left + 2, contentRect.left + 2);
  const y = lineRect ? Math.max(lineRect.top + 1, lineRect.bottom - 1) : contentRect.top + 2;
  const rawBlockPos = view.posAtDOM(lineRoot, 0);
  const blockPos = Math.max(0, Math.min(rawBlockPos + 1, view.state.doc.content.size));
  const blockResolved = view.state.doc.resolve(blockPos);
  const blockDepth = findBlockDepth(blockResolved, pageDepth);
  if (blockResolved.depth < blockDepth) return null;
  const blockStart = blockResolved.start(blockDepth);
  const blockEnd = blockResolved.end(blockDepth);
  const tryCoordsAtPos = (): number | null => {
    if (typeof view.coordsAtPos !== "function") return null;
    let low = blockStart + 1;
    let high = blockEnd - 1;
    let best: number | null = null;
    let safety = 0;
    while (low <= high && safety < 64) {
      safety += 1;
      const mid = Math.floor((low + high) / 2);
      try {
        const rect = view.coordsAtPos(mid);
        if (rect.bottom <= maxBottomAbs) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      } catch {
        high = mid - 1;
      }
    }
    return best;
  };
  let pos = rangePos;
  if (!pos) {
    pos = tryCoordsAtPos();
  }
  if (!pos && lineRect) {
    const coords = view.posAtCoords({ left: x, top: y });
    pos = coords && typeof coords.pos === "number" ? coords.pos : null;
  }
  if (!pos && debugEnabled()) {
    logDebug("line split posAtCoords failed", { x, y });
  }
  if (!pos) return null;
  if (pos <= blockStart + 1) {
    const fallback = tryCoordsAtPos();
    if (fallback) pos = fallback;
    if (pos <= blockStart + 1) {
      const rangeFallback = findSplitPosByRange(view, lineRoot, maxBottomAbs);
      if (rangeFallback) pos = rangeFallback;
    }
  }
  if (pos >= blockEnd) {
    const fallback = tryCoordsAtPos();
    if (fallback) pos = fallback;
    if (pos >= blockEnd) {
      const rangeFallback = findSplitPosByRange(view, lineRoot, maxBottomAbs);
      if (rangeFallback) pos = rangeFallback;
    }
    if (pos >= blockEnd) {
      pos = Math.max(blockStart + 2, blockEnd - 2);
    }
  }
  if (pos <= blockStart + 1) {
    if (debugEnabled()) {
      logDebug("line split pos outside block", {
        pos,
        blockStart,
        blockEnd,
        blockDepth,
        pageDepth
      });
    }
    return null;
  }
  const inlinePos = resolveInlinePos(view, pos, blockStart, blockEnd);
  if (inlinePos == null) return null;
  pos = inlinePos;
  if (pos == null) return null;
  const resolved = view.state.doc.resolve(pos);
  if (findPageDepth(resolved, pageType) !== pageDepth) {
    if (debugEnabled()) {
      logDebug("line split pos wrong page depth", {
        pos,
        resolvedDepth: resolved.depth,
        pageDepth
      });
    }
    return null;
  }
  if (resolved.parent?.isTextblock) {
    const parentText = resolved.parent.textBetween(0, resolved.parent.content.size, "\n", "\n");
    const parentOffset = resolved.parentOffset;
    const adjustedOffset = clampTrailingWordOffset(parentText, parentOffset);
    const parentStart = resolved.start(resolved.depth);
    const adjustedPos = parentStart + adjustedOffset;
    if (adjustedPos > blockStart + 1 && adjustedPos < blockEnd - 1) {
      pos = adjustedPos;
    }
  }
  const anchorAdjusted = adjustSplitPosForAnchors(view.state.doc, pos!, blockStart, blockEnd);
  if (anchorAdjusted != null) {
    pos = anchorAdjusted;
  }
  // Avoid leaving anchor-only tails (e.g., lone citation lines) on the next page.
  try {
    const tailResolved = view.state.doc.resolve(pos);
    if (tailResolved.parent?.isTextblock) {
      const parent = tailResolved.parent;
      const parentText = parent.textBetween(0, parent.content.size, "\n", "\n");
      const tailOffset = tailResolved.parentOffset;
      const tailText = parentText.slice(tailOffset).trim();
      const minTailChars = 12;
      const anchorOnlyTail = hasAnchorOnlyTail(parent, tailOffset);
      if ((anchorOnlyTail || tailText.length < minTailChars) && tailOffset > 0) {
        const desiredOffset = Math.max(0, tailOffset - minTailChars);
        const adjustedOffset = clampTrailingWordOffset(parentText, desiredOffset);
        const parentStart = tailResolved.start(tailResolved.depth);
        const candidatePos = parentStart + adjustedOffset;
        if (candidatePos > blockStart + 1 && candidatePos < blockEnd - 1) {
          pos = candidatePos;
        }
      }
    }
  } catch {
    // ignore tail adjustments
  }
  return pos;
};

const getPageContentElement = (view: any, selection: Selection): HTMLElement | null => {
  try {
    const domAt = view.domAtPos(selection.from);
    const domNode = domAt?.node as unknown as globalThis.Node | null;
    const element = domNode instanceof HTMLElement ? domNode : (domNode as any)?.parentElement ?? null;
    const content = element?.closest?.(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    if (content) return content;
  } catch {
    // ignore
  }
  try {
    const pageIndex = selection.$from?.index?.(0);
    if (Number.isFinite(pageIndex)) {
      return view.dom.querySelector(
        `.${PAGE_CLASS}[data-page-index="${pageIndex}"] .${PAGE_CONTENT_CLASS}`
      ) as HTMLElement | null;
    }
  } catch {
    // ignore
  }
  return null;
};

const SELECTION_BLOCK_SELECTOR = "p, li, blockquote, pre, h1, h2, h3, h4, h5, h6";

const getSelectionBlockElement = (view: any, selection: Selection): HTMLElement | null => {
  try {
    const domAt = view.domAtPos(selection.from);
    const domNode = domAt?.node as unknown as globalThis.Node | null;
    const element = domNode instanceof HTMLElement ? domNode : (domNode as any)?.parentElement ?? null;
    if (!element) return null;
    const block = element.closest(SELECTION_BLOCK_SELECTOR) as HTMLElement | null;
    if (!block) return null;
    const content = block.closest(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    if (!content) return null;
    return block;
  } catch {
    return null;
  }
};

const TABLE_ROW_SELECTOR = "tr";

const getTableElement = (el: HTMLElement | null | undefined): HTMLTableElement | null => {
  if (!el) return null;
  if (el.tagName.toUpperCase() === "TABLE") return el as HTMLTableElement;
  return el.closest("table");
};

const findTableDepth = ($pos: any, minDepth: number): number | null => {
  for (let depth = $pos.depth; depth > minDepth; depth -= 1) {
    const node = $pos.node(depth);
    if (node?.type?.name === "table") return depth;
  }
  return null;
};

const splitTableNode = (
  trBase: any,
  tablePos: number,
  tableNode: ProseMirrorNode,
  splitOffset: number
): any | null => {
  try {
    if (!tableNode || splitOffset <= 0 || splitOffset >= tableNode.content.size) return null;
    const left = tableNode.content.cut(0, splitOffset);
    let right = tableNode.content.cut(splitOffset);
    if (left.size === 0 || right.size === 0) return null;
    const isHeaderRowNode = (row: ProseMirrorNode | null): boolean => {
      if (!row || !row.isBlock) return false;
      let hasHeader = false;
      let allHeader = true;
      row.forEach((cell) => {
        const isHeader = cell.type?.name === "tableHeader";
        if (isHeader) {
          hasHeader = true;
        } else {
          allHeader = false;
        }
      });
      return hasHeader && allHeader;
    };
    const headerRow = (() => {
      if (tableNode.childCount === 0) return null;
      const first = tableNode.child(0);
      return isHeaderRowNode(first) ? first : null;
    })();
    if (headerRow) {
      const rightFirst = right.childCount > 0 ? right.child(0) : null;
      if (!isHeaderRowNode(rightFirst)) {
        const rows: ProseMirrorNode[] = [headerRow.copy(headerRow.content)];
        right.forEach((row) => rows.push(row));
        right = Fragment.fromArray(rows);
      }
    }
    const leftTable = tableNode.type.create(tableNode.attrs, left);
    const rightTable = tableNode.type.create(tableNode.attrs, right);
    const replacement = Fragment.fromArray([leftTable, rightTable]);
    return trBase.replaceWith(tablePos, tablePos + tableNode.nodeSize, replacement);
  } catch (error) {
    logDebug("manual table split threw", { tablePos, splitOffset, error: String(error) });
    return null;
  }
};

const findTableSplitPos = (
  view: any,
  pageType: any,
  pageDepth: number,
  content: HTMLElement,
  tableEl: HTMLTableElement
): number | null => {
  const rows = Array.from(tableEl.querySelectorAll<HTMLElement>(TABLE_ROW_SELECTOR));
  if (rows.length <= 1) return null;
  const { usableHeight } = getContentMetrics(content);
  if (usableHeight <= 0) return null;
  const scale = getContentScale(content);
  const guardPx = Math.max(BOTTOM_GUARD_PX, 1);
  const contentRect = content.getBoundingClientRect();
  const maxBottom = contentRect.top + usableHeight * scale - guardPx * scale;
  let lastVisible = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const rect = rows[i].getBoundingClientRect();
    if (!rect || rect.height <= 0) continue;
    if (rect.bottom <= maxBottom) lastVisible = i;
  }
  if (lastVisible < 0 || lastVisible >= rows.length - 1) return null;
  const row = rows[lastVisible];
  let rowPos = 0;
  try {
    rowPos = view.posAtDOM(row, 0);
  } catch {
    return null;
  }
  if (rowPos <= 0) return null;
  const rowResolved = view.state.doc.resolve(rowPos);
  if (findPageDepth(rowResolved, pageType) !== pageDepth) return null;
  const rowDepth = rowResolved.depth;
  const rowNode = rowResolved.node(rowDepth);
  if (!rowNode) return null;
  let rowStart = 0;
  try {
    rowStart = rowResolved.before(rowDepth);
  } catch {
    return null;
  }
  const rowEnd = rowStart + rowNode.nodeSize;
  return rowEnd > rowStart ? rowEnd : null;
};

const isSelectionAtPageStart = (
  state: any,
  pageType: any,
  pageDepth: number,
  selectionFrom: number
): boolean => {
  try {
    const $from = state.doc.resolve(selectionFrom);
    if ($from.parentOffset !== 0) return false;
    const pageStart = $from.start(pageDepth);
    const startSel = Selection.near(state.doc.resolve(pageStart + 1), 1);
    if (startSel && startSel.from === selectionFrom) return true;
    return $from.index(pageDepth) === 0;
  } catch {
    return false;
  }
};

const isCursorOnLastVisibleLine = (
  view: any,
  selection: Selection,
  content: HTMLElement,
  block: HTMLElement
): boolean => {
  const lineRoot = getLineSplitRoot(block) ?? (isHeadingElement(block) ? block : null);
  if (!lineRoot) return false;
  if (!isLineSplitElement(lineRoot) && !isHeadingElement(lineRoot)) return false;
  const lineRects = collectLineRects(lineRoot);
  if (!lineRects.length) return false;
  const { usableHeight } = getContentMetrics(content);
  if (usableHeight <= 0) return false;
  const scale = getContentScale(content);
  const lineHeightRaw = getComputedStyle(lineRoot).lineHeight;
  const lineHeight = Number.parseFloat(lineHeightRaw || "0");
  const guardPx = Math.max(BOTTOM_GUARD_PX, Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight * 0.25 : 0);
  const contentRect = content.getBoundingClientRect();
  const maxBottom = contentRect.top + usableHeight * scale - guardPx * scale;
  let lastVisibleIndex = -1;
  for (let i = 0; i < lineRects.length; i += 1) {
    if (lineRects[i].bottom <= maxBottom) {
      lastVisibleIndex = i;
    }
  }
  if (lastVisibleIndex < 0) return false;
  const lastLine = lineRects[lastVisibleIndex];
  const remaining = maxBottom - lastLine.bottom;
  const minRemaining = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight * 0.4 : guardPx;
  if (remaining > minRemaining) return false;
  let coords: { top: number; bottom: number } | null = null;
  try {
    coords = view.coordsAtPos(selection.from, -1);
  } catch {
    return false;
  }
  if (!coords) return false;
  const y = coords.bottom;
  const tolerance = 1;
  let currentIndex = -1;
  for (let i = 0; i < lineRects.length; i += 1) {
    if (y >= lineRects[i].top - tolerance && y <= lineRects[i].bottom + tolerance) {
      currentIndex = i;
      break;
    }
  }
  return currentIndex === lastVisibleIndex;
};

const isCursorNearPageBottom = (
  view: any,
  selection: Selection,
  content: HTMLElement,
  block: HTMLElement
): boolean => {
  const { usableHeight } = getContentMetrics(content);
  if (usableHeight <= 0) return false;
  const scale = getContentScale(content);
  const lineHeightRaw = getComputedStyle(block).lineHeight;
  const lineHeight = Number.parseFloat(lineHeightRaw || "0");
  const guardPx = Math.max(BOTTOM_GUARD_PX, Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight * 0.25 : 0);
  const contentRect = content.getBoundingClientRect();
  const maxBottom = contentRect.top + usableHeight * scale - guardPx * scale;
  let coords: { top: number; bottom: number } | null = null;
  try {
    coords = view.coordsAtPos(selection.from, -1);
  } catch {
    return false;
  }
  if (!coords) return false;
  const slack = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight * 0.6 : 12;
  return coords.bottom >= maxBottom - slack;
};

const handlePageBoundaryBackspace = (view: any): boolean => {
  const { state } = view;
  const selection = state.selection;
  if (!selection || !selection.empty) return false;
  const pageType = state.schema.nodes.page;
  if (!pageType) return false;
  const $from = selection.$from;
  const pageDepth = findPageDepth($from, pageType);
  if (pageDepth < 0) return false;
  if (!isSelectionAtPageStart(state, pageType, pageDepth, selection.from)) return false;
  const pageIndex = $from.index(0);
  if (pageIndex <= 0) return false;
  const joinPos = getJoinPosForPageIndex(state.doc, pageType, pageIndex);
  if (joinPos == null || joinPos <= 0) return false;
  let tr = attemptManualPageJoin(state.tr, joinPos, pageType, selection.from);
  if (!tr && canJoin(state.doc, joinPos)) {
    try {
      tr = state.tr.join(joinPos);
      tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos });
    } catch {
      tr = null;
    }
  }
  if (tr) {
    try {
      (window as any).__leditorPreserveScrollOnNextPagination = true;
    } catch {
      // ignore
    }
    view.dispatch(tr);
    return true;
  }
  try {
    const prevSel = Selection.near(state.doc.resolve(Math.max(0, joinPos - 1)), -1);
    if (prevSel) {
      try {
        (window as any).__leditorPreserveScrollOnNextPagination = true;
      } catch {
        // ignore
      }
      const trMove = state.tr.setSelection(prevSel);
      view.dispatch(trMove);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
};

const isSelectionAtPageEnd = (
  state: any,
  pageType: any,
  pageDepth: number,
  selectionFrom: number
): boolean => {
  try {
    const $from = state.doc.resolve(selectionFrom);
    if (findPageDepth($from, pageType) !== pageDepth) return false;
    const pageNode = $from.node(pageDepth);
    let endOffset = pageNode.content.size;
    let cursor = 0;
    pageNode.content.forEach((child: ProseMirrorNode) => {
      const start = cursor;
      const end = cursor + child.nodeSize;
      if (isFootnoteStorageNode(child)) {
        if (start < endOffset) endOffset = start;
      }
      cursor = end;
    });
    const pageStart = $from.start(pageDepth);
    const pageEnd = pageStart + endOffset;
    const endSel = Selection.near(state.doc.resolve(Math.max(0, pageEnd - 1)), -1);
    if (endSel && endSel.from === selectionFrom) return true;
    return selectionFrom >= pageEnd - 1;
  } catch {
    return false;
  }
};

const handlePageBoundaryEnter = (view: any): boolean => {
  const { state } = view;
  const selection = state.selection;
  if (!selection || !selection.empty) return false;
  const pageType = state.schema.nodes.page;
  if (!pageType) return false;
  const $from = selection.$from;
  const pageDepth = findPageDepth($from, pageType);
  if (pageDepth < 0) return false;
  const content = getPageContentElement(view, selection);
  if (!content) return false;
  const block = getSelectionBlockElement(view, selection);
  if (!block) return false;
  const atPageEnd = isSelectionAtPageEnd(state, pageType, pageDepth, selection.from);
  if (!atPageEnd) {
    if (!isCursorOnLastVisibleLine(view, selection, content, block)) {
      if (!isCursorNearPageBottom(view, selection, content, block)) return false;
    }
  }
  let trSplit: any | null = null;
  const didSplit = splitBlock(state, (tr) => {
    trSplit = tr;
  }, view);
  if (!didSplit || !trSplit) return false;
  const nextSelection = trSplit.selection as Selection;
  const $next = nextSelection.$from;
  const nextPageDepth = findPageDepth($next, pageType);
  if (nextPageDepth === pageDepth) {
    try {
      const splitPos = nextSelection.from;
      const splitResolved = trSplit.doc.resolve(splitPos);
      const splitPageDepth = findPageDepth(splitResolved, pageType);
      if (splitPageDepth >= 0) {
        const manualSplit = attemptManualPageSplit(
          trSplit,
          splitPos,
          splitPageDepth,
          pageType,
          selection.from
        );
        if (manualSplit) {
          try {
            (window as any).__leditorPreserveScrollOnNextPagination = true;
          } catch {
            // ignore
          }
          view.dispatch(manualSplit);
          return true;
        }
      }
    } catch {
      // ignore manual split failures
    }
  }
  if (nextPageDepth < 0) {
    try {
      (window as any).__leditorPreserveScrollOnNextPagination = true;
    } catch {
      // ignore
    }
    view.dispatch(trSplit);
    return true;
  }
  let splitPos: number | null = null;
  for (let depth = $next.depth; depth > nextPageDepth; depth -= 1) {
    try {
      if ($next.index(depth - 1) > 0) {
        splitPos = $next.before(depth);
        break;
      }
    } catch {
      // ignore invalid depth
    }
  }
  if (typeof splitPos !== "number" || splitPos <= 0) {
    try {
      (window as any).__leditorPreserveScrollOnNextPagination = true;
    } catch {
      // ignore
    }
    view.dispatch(trSplit);
    return true;
  }
  let pageStart = 0;
  let pageEnd = 0;
  try {
    pageStart = $next.start(nextPageDepth);
    pageEnd = $next.end(nextPageDepth);
  } catch {
    try {
      (window as any).__leditorPreserveScrollOnNextPagination = true;
    } catch {
      // ignore
    }
    view.dispatch(trSplit);
    return true;
  }
  if (splitPos <= pageStart || splitPos >= pageEnd) {
    try {
      (window as any).__leditorPreserveScrollOnNextPagination = true;
    } catch {
      // ignore
    }
    view.dispatch(trSplit);
    return true;
  }
  const manualSplit = attemptManualPageSplit(trSplit, splitPos, nextPageDepth, pageType, nextSelection.from);
  try {
    (window as any).__leditorPreserveScrollOnNextPagination = true;
  } catch {
    // ignore
  }
  view.dispatch(manualSplit ?? trSplit);
  return true;
};

const isDeleteStep = (step: any): boolean => {
  if (!step || typeof step.from !== "number" || typeof step.to !== "number") return false;
  if (step.to <= step.from) return false;
  const sliceSize =
    typeof step.slice?.size === "number"
      ? step.slice.size
      : typeof step.slice?.content?.size === "number"
        ? step.slice.content.size
        : null;
  return sliceSize === 0;
};

const isDeleteTransaction = (tr: any): boolean => {
  if (!tr || !Array.isArray(tr.steps)) return false;
  return tr.steps.some((step: any) => isDeleteStep(step));
};

const findOverflowDescendant = (
  container: HTMLElement,
  content: HTMLElement,
  bottomLimit: number,
  tolerance: number
): HTMLElement | null => {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>(LINE_SPLIT_SELECTOR));
  const divCandidates = Array.from(container.querySelectorAll<HTMLElement>("div")).filter(
    (el) => isDivLineSplitCandidate(el)
  );
  const allCandidates: HTMLElement[] = [];
  const pushUnique = (el: HTMLElement) => {
    if (allCandidates.includes(el)) return;
    allCandidates.push(el);
  };
  if (isLineSplitElement(container)) {
    pushUnique(container);
  }
  candidates.forEach(pushUnique);
  divCandidates.forEach(pushUnique);
  let best: HTMLElement | null = null;
  let bestTop = -Infinity;
  for (const candidate of allCandidates) {
    const box = getRelativeBox(candidate, content);
    if (!box || (box.bottom - box.top) <= 0) continue;
    const top = box.top;
    const bottom = box.bottom;
    if (bottom > bottomLimit + tolerance && top < bottomLimit - tolerance) {
      if (top > bestTop) {
        bestTop = top;
        best = candidate;
      }
    }
  }
  return best;
};

const findSplitTarget = (
  content: HTMLElement,
  tolerance = 1
): { target: HTMLElement; after: boolean; reason: "keepWithNext" | "overflow" | "manual" } | null => {
  enforceSingleColumnContent(content);
  const { usableHeight } = getContentMetrics(content);
  if (usableHeight <= 0) {
    logDebug("page content height is non-positive", { usableHeight });
    return null;
  }
  const contentRect = content.getBoundingClientRect();
  const scale = getContentScale(content);
  const guardPx = Math.max(BOTTOM_GUARD_PX, 1);
  const bottomLimit = Math.max(0, usableHeight - guardPx);
  if (debugEnabled()) {
    renderDebugLimit(content, bottomLimit);
  }
  const children = getContentChildren(content);
  if (shouldLogBlockMetrics()) {
    const contentStyle = getComputedStyle(content);
    const pageIndex = getPageIndexForContent(content);
    const clientWidth = content.clientWidth;
    const clientHeight = content.clientHeight;
    const scrollWidth = content.scrollWidth;
    const scrollHeight = content.scrollHeight;
    const maxRows = typeof (window as any).__leditorPaginationDebugBlocksLimit === "number"
      ? (window as any).__leditorPaginationDebugBlocksLimit
      : 40;
    const rows = children.slice(0, Math.max(0, maxRows)).map((child, index) => {
      const box = getRelativeBox(child, content);
      const marginBottom = parseFloat(getComputedStyle(child).marginBottom || "0") || 0;
      const top = box.top;
      const bottom = box.bottom + marginBottom;
      const left = box.left;
      const right = box.right;
      const preview = (child.textContent || "").trim().slice(0, 60);
      return {
        index,
        tag: child.tagName,
        top,
        bottom,
        left,
        right,
        height: box.bottom - box.top,
        width: box.right - box.left,
        marginBottom,
        overflowBottom: bottom > bottomLimit + tolerance,
        rightShift: left > clientWidth * 0.55,
        preview
      };
    });
    const rightShiftCount = rows.filter((row) => row.rightShift).length;
    logDebug("split diagnostics", {
      pageIndex,
      usableHeight,
      bottomLimit,
      guardPx,
      scale,
      clientWidth,
      clientHeight,
      scrollWidth,
      scrollHeight,
      columnCount: contentStyle.columnCount,
      columnGap: contentStyle.columnGap,
      columnWidth: (contentStyle as any).columnWidth,
      columns: (contentStyle as any).columns,
      inOverlay: Boolean(content.closest(".leditor-page-overlay") || content.closest(".leditor-page-overlays")),
      rightShiftCount,
      sample: rows
    });
    if (rightShiftCount > 0) {
      logDebug("horizontal flow detected", {
        pageIndex,
        rightShiftCount,
        sample: rows.filter((row) => row.rightShift).slice(0, 10)
      });
    }
  }
  let lastBottom = 0;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (shouldSplitAfter(child)) {
      logDebug("manual break forces split", { tag: child.tagName, index: i });
      return { target: child, after: true, reason: "manual" };
    }
    const marginBottom = parseFloat(getComputedStyle(child).marginBottom || "0") || 0;
    const box = getRelativeBox(child, content);
    let bottom = box.bottom + marginBottom;
    if (marginBottom > 0 && box.bottom <= bottomLimit + tolerance) {
      if (bottom > bottomLimit + tolerance) {
        bottom = box.bottom;
      }
    }
    lastBottom = Math.max(lastBottom, bottom);
    if (bottom > bottomLimit + tolerance) {
      if (i === 0) {
        logDebug("overflow on first block; skipping split", {
          tag: child.tagName,
          bottom,
          contentHeight: usableHeight,
          bottomLimit,
          tolerance
        });
        return null;
      }
      const prev = children[i - 1] ?? null;
      const prevKeepWithNext = prev && !shouldSplitAfter(prev) && (isHeadingElement(prev) || hasKeepWithNext(prev));
      const overflowDescendant =
        !isSplittableBlock(child) && child.querySelector(LINE_SPLIT_SELECTOR)
          ? findOverflowDescendant(child, content, bottomLimit, tolerance)
          : null;
      let splitCandidate = overflowDescendant ?? child;
      let lineSplitCandidate: HTMLElement | null = null;
      if (isLineSplitElement(splitCandidate)) {
        lineSplitCandidate = splitCandidate;
      } else {
        const lineRoot = getLineSplitRoot(splitCandidate);
        if (lineRoot && isLineSplitElement(lineRoot)) {
          lineSplitCandidate = lineRoot;
        }
      }
      if (prev && prevKeepWithNext) {
        const prevIndex = i - 1;
        const isFirstBlock = prevIndex <= 0;
        const splitForMetrics = lineSplitCandidate ?? (isSplittableBlock(splitCandidate) ? splitCandidate : null);
        if (splitForMetrics) {
          const prevMarginBottom = parseFloat(getComputedStyle(prev).marginBottom || "0") || 0;
          const prevBox = getRelativeBox(prev, content);
          const prevBottom = prevBox.bottom + prevMarginBottom;
          const remainingAfterHeading = bottomLimit - prevBottom;
          const childLineHeightRaw = getComputedStyle(splitForMetrics).lineHeight;
          const childLineHeight = Number.parseFloat(childLineHeightRaw || "0");
          const minLinesPx =
            (Number.isFinite(childLineHeight) && childLineHeight > 0 ? childLineHeight : 18) *
            MIN_SECTION_LINES;
          if (isFirstBlock) {
            logDebug("keep-with-next: avoid orphan heading at page start", {
              headingTag: prev.tagName,
              headingIndex: prevIndex,
              overflowTag: splitForMetrics.tagName,
              overflowIndex: i,
              remainingAfterHeading,
              minLinesPx
            });
          } else
          if (remainingAfterHeading >= minLinesPx) {
            logDebug("keep-with-next: allowing split inside paragraph", {
              headingTag: prev.tagName,
              headingIndex: prevIndex,
              overflowTag: splitForMetrics.tagName,
              overflowIndex: i,
              remainingAfterHeading,
              minLinesPx
            });
          } else {
            logDebug("keep-with-next: moving heading to next page", {
              headingTag: prev.tagName,
              headingIndex: prevIndex,
              overflowTag: splitForMetrics.tagName,
              overflowIndex: i,
              remainingAfterHeading,
              minLinesPx
            });
            if (!isFirstBlock) {
              return { target: prev, after: false, reason: "keepWithNext" };
            }
          }
        } else {
          logDebug("keep-with-next: moving heading to next page", {
            headingTag: prev.tagName,
            headingIndex: prevIndex,
            overflowTag: splitCandidate.tagName,
            overflowIndex: i
          });
          if (!isFirstBlock) {
            return { target: prev, after: false, reason: "keepWithNext" };
          }
        }
      }
      const finalCandidate = lineSplitCandidate ?? splitCandidate;
      logDebug("overflow split target", {
        tag: finalCandidate.tagName,
        index: i,
        bottom,
        contentHeight: usableHeight,
        bottomLimit
      });
      return { target: finalCandidate, after: false, reason: "overflow" };
    }
  }
  if (debugEnabled()) {
    logDebug("no split target", {
      contentHeight: usableHeight,
      bottomLimit,
      scrollHeight: content.scrollHeight,
      lastBottom
    });
  }
  return null;
};

const findJoinBoundary = (
  view: any,
  pageType: any,
  tolerance = 1,
  joinBufferPx = DEFAULT_JOIN_BUFFER_PX
): number | null => {
  const pages = Array.from(view.dom.querySelectorAll(PAGE_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  if (pages.length < 2) return null;
  for (let i = 0; i < pages.length - 1; i += 1) {
    const page = pages[i];
    const nextPage = pages[i + 1];
    const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    const nextContent = nextPage.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    if (!content || !nextContent) continue;
    const nextChildren = getContentChildren(nextContent);
    const nextFirst = nextChildren[0] ?? null;
    if (!nextFirst) continue;
    const lastChildren = getContentChildren(content);
    const last = lastChildren.length > 0 ? lastChildren[lastChildren.length - 1] : null;
    if (last && shouldSplitAfter(last)) {
      continue;
    }
    const { usableHeight } = getContentMetrics(content);
    const lastMarginBottom = last ? parseFloat(getComputedStyle(last).marginBottom || "0") || 0 : 0;
    const lastBox = last ? getRelativeBox(last, content) : null;
    const used = lastBox ? lastBox.bottom + lastMarginBottom : 0;
    const remaining = usableHeight - used;
    const nextMarginTop = parseFloat(getComputedStyle(nextFirst).marginTop || "0") || 0;
    const nextMarginBottom = parseFloat(getComputedStyle(nextFirst).marginBottom || "0") || 0;
    const nextFirstBox = getRelativeBox(nextFirst, nextContent);
    let nextHeight = (nextFirstBox.bottom - nextFirstBox.top) + nextMarginTop + nextMarginBottom;
    if (isHeadingElement(nextFirst)) {
      const nextSecond = nextFirst.nextElementSibling as HTMLElement | null;
      if (nextSecond) {
        const nextSecondMarginTop = parseFloat(getComputedStyle(nextSecond).marginTop || "0") || 0;
        const nextSecondMarginBottom = parseFloat(getComputedStyle(nextSecond).marginBottom || "0") || 0;
        const nextSecondBox = getRelativeBox(nextSecond, nextContent);
        nextHeight += (nextSecondBox.bottom - nextSecondBox.top) + nextSecondMarginTop + nextSecondMarginBottom;
      }
    }
    if (remaining + tolerance >= nextHeight + joinBufferPx) {
      let pos = 0;
      for (let idx = 0; idx <= i; idx += 1) {
        const child = view.state.doc.child(idx);
        if (!child || child.type !== pageType) return null;
        pos += child.nodeSize;
      }
      return pos;
    }
  }
  return null;
};

const getLineHeightPx = (el: HTMLElement): number => {
  const style = getComputedStyle(el);
  const raw = style.lineHeight;
  const parsed = Number.parseFloat(raw || "");
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const fontSize = Number.parseFloat(style.fontSize || "");
  if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * 1.2;
  return 18;
};

const getLastContentBottom = (content: HTMLElement): number => {
  const children = getContentChildren(content);
  if (!children.length) return 0;
  let lastBottom = 0;
  for (const child of children) {
    const marginBottom = parseFloat(getComputedStyle(child).marginBottom || "0") || 0;
    const box = getRelativeBox(child, content);
    const bottom = box.bottom + marginBottom;
    if (bottom > lastBottom) lastBottom = bottom;
  }
  return lastBottom;
};

const findUnderfilledJoin = (view: any, pageType: any): number | null => {
  const pages = Array.from(view.dom.querySelectorAll(PAGE_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  if (pages.length < 2) return null;
  for (let i = 0; i < pages.length - 1; i += 1) {
    const page = pages[i];
    const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    if (!content) continue;
    const children = getContentChildren(content);
    if (!children.length) continue;
    const headingOnly = children.every((child) => isHeadingElement(child));
    const last = children[children.length - 1] ?? null;
    if (last && shouldSplitAfter(last) && !headingOnly) continue;
    const lastBottom = getLastContentBottom(content);
    const lineHeight = getLineHeightPx(last ?? content);
    const minFill = Math.max(lineHeight * MIN_UNDERFILL_LINES, lineHeight + 4);
    const { usableHeight } = getContentMetrics(content);
    const fillRatio = usableHeight > 0 ? lastBottom / usableHeight : 1;
    const remaining = usableHeight - lastBottom;
    const nextPage = pages[i + 1] ?? null;
    const nextContent = nextPage?.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    const nextChildren = nextContent ? getContentChildren(nextContent) : [];
    const nextFirst = nextChildren[0] ?? null;
    const nextFirstLineHeight = nextFirst ? getLineHeightPx(nextFirst) : 0;
    const orphanHeadingPull =
      Boolean(last && isHeadingElement(last) && nextFirst && isLineSplitElement(nextFirst)) &&
      remaining >= Math.max(nextFirstLineHeight * 0.6, 6);
    if (lastBottom > 0 && (lastBottom < minFill || fillRatio < MIN_UNDERFILL_RATIO)) {
      const joinPos = getJoinPosForPageIndex(view.state.doc, pageType, i + 1);
      if (joinPos != null && joinPos > 0) {
        logDebug("underfilled page join candidate", {
          pageIndex: i,
          joinPos,
          lastBottom,
          minFill,
          fillRatio
        });
        return joinPos;
      }
    }
    if (orphanHeadingPull) {
      const joinPos = getJoinPosForPageIndex(view.state.doc, pageType, i + 1);
      if (joinPos != null && joinPos > 0) {
        logDebug("underfilled join (orphan heading)", {
          pageIndex: i,
          joinPos,
          remaining,
          lineHeight: nextFirstLineHeight
        });
        return joinPos;
      }
    }
  }
  return null;
};

const findCriticalUnderfillJoin = (view: any, pageType: any): number | null => {
  const pages = Array.from(view.dom.querySelectorAll(PAGE_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  if (pages.length < 2) return null;
  for (let i = 0; i < pages.length - 1; i += 1) {
    const page = pages[i];
    const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    if (!content) continue;
    const children = getContentChildren(content);
    if (!children.length) continue;
    const last = children[children.length - 1] ?? null;
    const lastBottom = getLastContentBottom(content);
    const lineHeight = getLineHeightPx(last ?? content);
    const minFill = Math.max(lineHeight * CRITICAL_UNDERFILL_LINES, lineHeight + 2);
    const { usableHeight } = getContentMetrics(content);
    const fillRatio = usableHeight > 0 ? lastBottom / usableHeight : 1;
    if (lastBottom > 0 && (lastBottom < minFill || fillRatio < CRITICAL_UNDERFILL_RATIO)) {
      const joinPos = getJoinPosForPageIndex(view.state.doc, pageType, i + 1);
      if (joinPos != null && joinPos > 0) {
        logDebug("critical underfilled page join", {
          pageIndex: i,
          joinPos,
          lastBottom,
          minFill,
          fillRatio
        });
        return joinPos;
      }
    }
  }
  return null;
};

const isUnderfilledDoc = (view: any): boolean => {
  const pages = Array.from(view.dom.querySelectorAll(PAGE_SELECTOR)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  if (pages.length < 4) return false;
  let total = 0;
  let underfilled = 0;
  for (const page of pages) {
    const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    if (!content) continue;
    const children = getContentChildren(content);
    if (!children.length) continue;
    const lastBottom = getLastContentBottom(content);
    if (lastBottom <= 0) continue;
    const lineHeight = getLineHeightPx(children[children.length - 1] ?? content);
    total += 1;
    if (lastBottom < Math.max(lineHeight * 2.2, lineHeight + 6)) {
      underfilled += 1;
    }
  }
  if (total < 3) return false;
  return underfilled / total >= 0.5;
};

const getJoinPosForPageIndex = (doc: any, pageType: any, pageIndex: number): number | null => {
  if (!doc || pageIndex <= 0) return null;
  let pos = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (!child || child.type !== pageType) return null;
    if (i === pageIndex) return pos;
    pos += child.nodeSize;
  }
  return null;
};

const findEmptyPageRange = (doc: any, pageType: any): { from: number; to: number } | null => {
  let pos = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    const from = pos;
    const to = pos + child.nodeSize;
    pos = to;
    if (child.type !== pageType) continue;
    if (child.content.size === 0) {
      return { from, to };
    }
  }
  return null;
};

type PaginationMemo = {
  lastSplitPos: number | null;
  lastSplitAt: number;
  lastSplitReason: "keepWithNext" | "overflow" | "manual" | null;
  lastExternalChangeAt: number;
  lastDocSize: number;
  lastNormalizeAt: number;
  lastNormalizeDocSize: number;
  lastFlattenAt: number;
  lastFlattenDocSize: number;
  autoNormalizeOnceDone: boolean;
  lockedJoinPos: Map<number, { docSize: number; at: number; reason: string }>;
  splitIdCounter: number;
};

const paginateView = (
  view: any,
  runningRef: { value: boolean },
  memo: PaginationMemo,
  options?: { preferJoin?: boolean }
) => {
  if (runningRef.value) return;
  const pageType = view.state.schema.nodes.page;
  if (!pageType) return;
  const selection = view.state.selection;
  const selectionIndex = selection ? selection.$from.index(0) : -1;
  logDebug("paginate start", {
    pageCount: view.state.doc.childCount,
    selectionIndex
  });
  logPaginationStats(view, "paginate start");
  runningRef.value = true;
  try {
    const docSize = view.state.doc.content.size;
    memo.lastDocSize = docSize;
    const trWrap = wrapDocInPage(view.state);
    if (trWrap) {
      logDebug("wrapped doc in page");
      dispatchPagination(view, trWrap);
      return;
    }
    const anchorCleanup = stripAnchorOnlyBlocks(view.state, pageType);
    if (anchorCleanup) {
      logDebug("stripped anchor-only blocks");
      dispatchPagination(view, anchorCleanup);
      return;
    }
    // Auto-normalization disabled: do not rewrite paragraphs during pagination.
    const pages = Array.from(view.dom.querySelectorAll(PAGE_SELECTOR)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement
    );
    logDebug("page nodes before split", {
      domPageCount: pages.length,
      docPageCount: view.state.doc.childCount,
      overlayPages: view.dom.querySelectorAll(`.${PAGE_INNER_CLASS}`).length
    });
    if (pages.length > 1) {
      let anchorOnlyIndex = -1;
      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
        if (!content) continue;
        if (isAnchorOnlyContent(content)) {
          anchorOnlyIndex = i;
          break;
        }
      }
      if (anchorOnlyIndex >= 0) {
        const joinIndex = anchorOnlyIndex === 0 ? 1 : anchorOnlyIndex;
        const joinPos = getJoinPosForPageIndex(view.state.doc, pageType, joinIndex);
        if (joinPos != null && joinPos > 0) {
          logDebug("joining anchor-only page", { anchorOnlyIndex, joinIndex, joinPos });
          let tr = attemptManualPageJoin(view.state.tr, joinPos, pageType, view.state.selection.from);
          if (!tr && canJoin(view.state.doc, joinPos)) {
            try {
              tr = view.state.tr.join(joinPos);
              tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos });
            } catch {
              tr = null;
            }
          }
          if (tr) {
            memo.lastSplitPos = null;
            memo.lastSplitAt = 0;
            memo.lastSplitReason = null;
            memo.lockedJoinPos.delete(joinPos);
            dispatchPagination(view, tr);
            return;
          }
        }
      }
    }
    for (const page of pages) {
      const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
      if (!content) continue;
      const split = findSplitTarget(content);
      if (!split) continue;
      const pos = view.posAtDOM(split.target, 0);
      const resolved = view.state.doc.resolve(pos);
      const pageDepth = findPageDepth(resolved, pageType);
      if (!Number.isFinite(pageDepth) || pageDepth < 0) continue;
      const childDepth = pageDepth + 1;
      if (resolved.depth < childDepth) continue;
      let splitPos = split.after ? resolved.after(childDepth) : resolved.before(childDepth);
      if (splitPos <= 0) continue;
      if (split.reason === "overflow") {
        const tableEl = getTableElement(split.target);
        const tableSplitPos =
          tableEl && typeof view.posAtDOM === "function"
            ? findTableSplitPos(view, pageType, pageDepth, content, tableEl)
            : null;
        if (typeof tableSplitPos === "number" && tableSplitPos > 0) {
          const tableSplitResolved = view.state.doc.resolve(tableSplitPos);
          const tableDepth = findTableDepth(tableSplitResolved, pageDepth);
          if (tableDepth != null) {
            const tableSplitDepth = Math.max(1, tableSplitResolved.depth - tableDepth + 1);
            let trTable: any | null = null;
            try {
              const tableNode = tableSplitResolved.node(tableDepth);
              const tablePos = tableSplitResolved.before(tableDepth);
              const tableStart = tableSplitResolved.start(tableDepth);
              const splitOffset = tableSplitPos - tableStart;
              trTable = splitTableNode(view.state.tr, tablePos, tableNode, splitOffset);
            } catch (error) {
              logDebug("manual table split failed", { error: String(error) });
            }
            if (!trTable && canSplit(view.state.doc, tableSplitPos, tableSplitDepth)) {
              try {
                trTable = view.state.tr.split(tableSplitPos, tableSplitDepth);
              } catch (error) {
                logDebug("table split failed", {
                  tableSplitPos,
                  tableSplitDepth,
                  error: String(error)
                });
              }
            }
            if (trTable) {
              const from = view.state.selection.from;
              const mappedPos = trTable.mapping.map(tableSplitPos, 1);
              const boundaryInfo = resolvePageBoundaryPos(trTable.doc, pageType, pageDepth, mappedPos);
              const pageBoundaryPos = boundaryInfo?.pos ?? mappedPos;
              const boundaryResolved = boundaryInfo?.resolved ?? trTable.doc.resolve(pageBoundaryPos);
              let didSplit = false;
              if (canSplit(trTable.doc, pageBoundaryPos, 1)) {
                try {
                  trTable = trTable.split(pageBoundaryPos, 1);
                  didSplit = true;
                } catch (error) {
                  logDebug("table page split (page-only) failed", {
                    pageBoundaryPos,
                    error: String(error)
                  });
                }
              }
              if (!didSplit) {
                const boundaryDepth = Math.max(1, boundaryResolved.depth - pageDepth);
                const boundaryTypes: Array<{ type: any; attrs?: any } | null> = new Array(boundaryDepth).fill(null);
                boundaryTypes[0] = { type: pageType };
                for (let i = 1; i < boundaryDepth; i += 1) {
                  const depthAt = pageDepth + i;
                  if (depthAt > boundaryResolved.depth) break;
                  const nodeAt = boundaryResolved.node(depthAt);
                  if (!nodeAt) break;
                  boundaryTypes[i] = { type: nodeAt.type, attrs: nodeAt.attrs };
                }
                if (canSplit(trTable.doc, pageBoundaryPos, boundaryDepth, boundaryTypes as any)) {
                  try {
                    trTable = trTable.split(pageBoundaryPos, boundaryDepth, boundaryTypes as any);
                    didSplit = true;
                  } catch (error) {
                    logDebug("table page split (boundary) failed", {
                      pageBoundaryPos,
                      boundaryDepth,
                      error: String(error)
                    });
                  }
                }
              }
              if (didSplit) {
                trTable.setMeta(paginationKey, { source: "pagination", op: "split", pos: pageBoundaryPos });
                if (from >= tableSplitPos) {
                  const mapped = trTable.mapping.map(from);
                  setSafeSelection(trTable, mapped);
                }
                memo.lastSplitPos = pageBoundaryPos;
                memo.lastSplitAt = performance.now();
                memo.lastSplitReason = split.reason;
                dispatchPagination(view, trTable);
                return;
              }
              const manualPageSplit = attemptManualPageSplit(
                trTable,
                pageBoundaryPos,
                pageDepth,
                pageType,
                view.state.selection.from
              );
              if (manualPageSplit) {
                memo.lastSplitPos = pageBoundaryPos;
                memo.lastSplitAt = performance.now();
                memo.lastSplitReason = split.reason;
                dispatchPagination(view, manualPageSplit);
                return;
              }
              logDebug("table split page boundary failed", { tableSplitPos, pageBoundaryPos });
            }
          }
        }
      }
      let forceLineSplit = false;
      const lineSplitTarget = (() => {
        if (isSplittableBlock(split.target)) return split.target;
        const root = getLineSplitRoot(split.target);
        return root && isLineSplitElement(root) ? root : null;
      })();
      if (
        (split.reason === "overflow" || split.reason === "keepWithNext") &&
        lineSplitTarget &&
        typeof view.posAtCoords === "function"
      ) {
        try {
          const lineSplitPos = findLineSplitPos(view, pageType, pageDepth, content, lineSplitTarget);
          if (typeof lineSplitPos === "number" && lineSplitPos > 0) {
            splitPos = lineSplitPos;
            forceLineSplit = true;
            if (debugEnabled()) {
              logDebug("overflow line split pos", {
                splitPos,
                pageDepth,
                targetTag: lineSplitTarget.tagName,
                targetIndex: lineSplitTarget.dataset?.nodeIndex ?? null
              });
            }
          }
        } catch {
          // ignore coordinate split failures and fall back to block split
        }
      }
      const splitResolved = view.state.doc.resolve(splitPos);
      if (!Number.isFinite(pageDepth) || splitResolved.depth < pageDepth) {
        logDebug("split position not at page boundary", {
          splitPos,
          depth: splitResolved.depth,
          pageDepth
        });
        continue;
      }
      let markPaginationSplit = false;
      let blockNode: any = null;
      let blockStart = 0;
      let blockEnd = 0;
      let blockDepth = findBlockDepth(splitResolved, pageDepth);
      let insideBlock = false;
      if (splitResolved.depth >= blockDepth) {
        try {
          blockNode = splitResolved.node(blockDepth);
          blockStart = splitResolved.start(blockDepth);
          blockEnd = splitResolved.end(blockDepth);
          insideBlock = splitPos > blockStart && splitPos < blockEnd;
          markPaginationSplit = blockNode?.type?.name === "paragraph" && insideBlock;
        } catch {
          // ignore invalid depth calculations; skip pagination split marker
        }
      }
      if (insideBlock && (splitPos <= blockStart + 1 || splitPos >= blockEnd - 1)) {
        const safePos = Math.max(blockStart + 1, Math.min(blockEnd - 1, splitPos));
        if (safePos !== splitPos) {
          splitPos = safePos;
        }
      }
      const safeResolved = splitPos === splitResolved.pos ? splitResolved : view.state.doc.resolve(splitPos);
      if (safeResolved !== splitResolved) {
        blockDepth = findBlockDepth(safeResolved, pageDepth);
        if (safeResolved.depth >= blockDepth) {
          try {
            blockNode = safeResolved.node(blockDepth);
            blockStart = safeResolved.start(blockDepth);
            blockEnd = safeResolved.end(blockDepth);
            insideBlock = splitPos > blockStart && splitPos < blockEnd;
            markPaginationSplit = blockNode?.type?.name === "paragraph" && insideBlock;
          } catch {
            // ignore
          }
        }
      }
      // Guard against splitting at the very start/end of a page. Since page.content is "block+",
      // splitting at pageStart/pageEnd would create an empty page and ProseMirror will throw.
      let pageStart = 0;
      let pageEnd = 0;
      try {
        pageStart = splitResolved.start(pageDepth);
        pageEnd = splitResolved.end(pageDepth);
      } catch {
        logDebug("skipping split due to invalid page depth", { splitPos, pageDepth });
        continue;
      }
      if (splitPos === pageStart || splitPos === pageEnd) {
        // Try the opposite boundary relative to the target block before giving up.
        const altSplitPos = split.after ? resolved.before(childDepth) : resolved.after(childDepth);
        const altResolved = altSplitPos > 0 ? view.state.doc.resolve(altSplitPos) : null;
        const altPageStart = altResolved && altResolved.depth >= pageDepth ? altResolved.start(pageDepth) : null;
        const altPageEnd = altResolved && altResolved.depth >= pageDepth ? altResolved.end(pageDepth) : null;
        const altIsValid =
          altResolved &&
          altResolved.depth === pageDepth &&
          altSplitPos !== altPageStart &&
          altSplitPos !== altPageEnd;
        if (altIsValid) {
          logDebug("adjusting split away from empty page boundary", { splitPos, altSplitPos, pageStart, pageEnd });
          splitPos = altSplitPos;
        } else {
          logDebug("skipping split at empty page boundary", { splitPos, pageStart, pageEnd });
          continue;
        }
      }
      let depth = 1;
      if (insideBlock && blockNode) {
        depth = Math.max(1, blockDepth - pageDepth + 1);
      }
      if (depth <= 0) continue;
      const typesAfter: Array<{ type: any; attrs?: any } | null> = new Array(depth).fill(null);
      typesAfter[0] = { type: pageType };
      if (depth > 1 && insideBlock) {
        for (let i = 1; i < depth; i += 1) {
          const depthAt = pageDepth + i;
          if (depthAt > safeResolved.depth) break;
          const nodeAt = safeResolved.node(depthAt);
          if (!nodeAt) break;
          typesAfter[i] = { type: nodeAt.type, attrs: nodeAt.attrs };
        }
      }
      let canSplitAtPos = canSplit(view.state.doc, splitPos, depth, typesAfter as any);
      let preferDefaultTypes = false;
      if (forceLineSplit) {
        const lineSplit = attemptLineSplitPageSplit(
          view,
          splitPos,
          pageDepth,
          pageType,
          split.reason,
          memo,
          markPaginationSplit
        );
        if (lineSplit) {
          dispatchPagination(view, lineSplit);
          return;
        }
        // LO-style: split paragraph at a measured line position, then split the page.
        const paragraphDepth = Math.max(1, safeResolved.depth - blockDepth);
        const blockStartPos = insideBlock ? blockStart + 1 : splitPos;
        const blockEndPos = insideBlock ? blockEnd - 1 : splitPos;
        const searchLimit = 24;
        let splitCandidate: number | null = null;
        if (splitPos > blockStartPos && splitPos < blockEndPos) {
          if (canSplit(view.state.doc, splitPos, paragraphDepth)) {
            splitCandidate = splitPos;
          }
        }
        for (let delta = 0; delta <= searchLimit && !splitCandidate; delta += 1) {
          const left = splitPos - delta;
          const right = splitPos + delta;
          if (left > blockStartPos && left < blockEndPos && canSplit(view.state.doc, left, paragraphDepth)) {
            splitCandidate = left;
            break;
          }
          if (right > blockStartPos && right < blockEndPos && canSplit(view.state.doc, right, paragraphDepth)) {
            splitCandidate = right;
            break;
          }
        }
        if (splitCandidate) {
          if (debugEnabled()) {
            logDebug("line split candidate", {
              splitCandidate,
              paragraphDepth,
              blockDepth,
              pageDepth,
              blockStartPos,
              blockEndPos
            });
          }
          const manualSplitId = markPaginationSplit ? `ps-${memo.splitIdCounter++}` : null;
          const boundaryAtCandidate = resolvePageBoundaryPos(
            view.state.doc,
            pageType,
            pageDepth,
            splitCandidate
          );
          const manualSplit =
            boundaryAtCandidate && boundaryAtCandidate.pos === splitCandidate
              ? attemptManualPageSplit(
                  view.state.tr,
                  splitCandidate,
                  pageDepth,
                  pageType,
                  view.state.selection.from,
                  manualSplitId ?? undefined
                )
              : null;
          if (manualSplit) {
            manualSplit.setMeta(paginationKey, { source: "pagination", op: "split", pos: splitCandidate });
            memo.lastSplitPos = splitCandidate;
            memo.lastSplitAt = performance.now();
            memo.lastSplitReason = split.reason;
            if (split.reason === "keepWithNext") {
              memo.lockedJoinPos.set(splitCandidate, {
                docSize,
                at: memo.lastSplitAt,
                reason: split.reason
              });
            }
            const from = view.state.selection.from;
            if (from >= splitCandidate) {
              const mapped = manualSplit.mapping.map(from);
              setSafeSelection(manualSplit, mapped);
            }
            dispatchPagination(view, manualSplit);
            return;
          }
          let trLine: any | null = null;
          try {
            trLine = view.state.tr.split(splitCandidate, paragraphDepth);
          } catch (error) {
            logDebug("line split paragraph threw", {
              splitCandidate,
              paragraphDepth,
              error: String(error)
            });
            trLine = null;
          }
          if (!trLine) {
            continue;
          }
          const mappedSplit = trLine.mapping.map(splitCandidate, -1);
          const manualLineSplit = attemptManualPageSplit(
            trLine,
            mappedSplit,
            pageDepth,
            pageType,
            view.state.selection.from,
            manualSplitId ?? undefined
          );
          if (manualLineSplit) {
            manualLineSplit.setMeta(paginationKey, { source: "pagination", op: "split", pos: mappedSplit });
            memo.lastSplitPos = mappedSplit;
            memo.lastSplitAt = performance.now();
            memo.lastSplitReason = split.reason;
            if (split.reason === "keepWithNext") {
              memo.lockedJoinPos.set(mappedSplit, {
                docSize,
                at: memo.lastSplitAt,
                reason: split.reason
              });
            }
            const from = view.state.selection.from;
            if (from >= splitCandidate) {
              const mapped = manualLineSplit.mapping.map(from);
              setSafeSelection(manualLineSplit, mapped);
            }
            dispatchPagination(view, manualLineSplit);
            return;
          }
          const mappedPosLeft = trLine.mapping.map(splitCandidate, -1);
          const mappedPosRight = trLine.mapping.map(splitCandidate, 1);
          const boundaryInfoPrimary = resolveBlockBoundaryPos(
            trLine.doc,
            pageType,
            pageDepth,
            mappedPosRight
          );
          const boundaryInfoSecondary =
            boundaryInfoPrimary ??
            resolveBlockBoundaryPos(trLine.doc, pageType, pageDepth, mappedPosLeft) ??
            resolveBlockBoundaryPos(trLine.doc, pageType, pageDepth, mappedSplit) ??
            resolvePageBoundaryPos(trLine.doc, pageType, pageDepth, mappedSplit);
          if (!boundaryInfoSecondary) {
            logDebug("line split boundary missing", {
              splitCandidate,
              mappedPosLeft,
              mappedPosRight,
              mappedSplit
            });
          }
          const pageBoundaryPos = boundaryInfoSecondary?.pos ?? mappedPosLeft;
          const boundaryResolved =
            boundaryInfoSecondary?.resolved ?? trLine.doc.resolve(pageBoundaryPos);
          if (debugEnabled()) {
            logDebug("line split boundary", {
              splitCandidate,
              mappedPosLeft,
              mappedPosRight,
              pageBoundaryPos,
              mappedDepth: boundaryResolved.depth,
              pageDepth
            });
          }
          let didSplit = false;
          const boundaryCandidates = Array.from(
            new Set(
              [pageBoundaryPos, mappedSplit, mappedPosLeft, mappedPosRight].filter(
                (value) => Number.isFinite(value as number) && (value as number) > 0
              )
            )
          ) as number[];
          for (const candidate of boundaryCandidates) {
            if (didSplit) break;
            // First try splitting only the page node (no explicit types).
            if (canSplit(trLine.doc, candidate, 1)) {
              try {
                trLine = trLine.split(candidate, 1);
                didSplit = true;
              } catch (error) {
                logDebug("line split page-only threw", {
                  pageBoundaryPos: candidate,
                  error: String(error)
                });
              }
            }
          }
          if (!didSplit) {
            const boundaryDepth = Math.max(1, boundaryResolved.depth - pageDepth);
            const boundaryTypes: Array<{ type: any; attrs?: any } | null> = new Array(boundaryDepth).fill(null);
            boundaryTypes[0] = { type: pageType };
            for (let i = 1; i < boundaryDepth; i += 1) {
              const depthAt = pageDepth + i;
              if (depthAt > boundaryResolved.depth) break;
              const nodeAt = boundaryResolved.node(depthAt);
              if (!nodeAt) break;
              boundaryTypes[i] = { type: nodeAt.type, attrs: nodeAt.attrs };
            }
            for (const candidate of boundaryCandidates) {
              if (didSplit) break;
              if (canSplit(trLine.doc, candidate, boundaryDepth, boundaryTypes as any)) {
                try {
                  trLine = trLine.split(candidate, boundaryDepth, boundaryTypes as any);
                  didSplit = true;
                } catch (error) {
                  logDebug("line split boundary threw", {
                    pageBoundaryPos: candidate,
                    boundaryDepth,
                    error: String(error)
                  });
                }
              }
            }
          }
          if (didSplit) {
            trLine.setMeta(paginationKey, { source: "pagination", op: "split", pos: pageBoundaryPos });
            const from = view.state.selection.from;
            if (from >= splitCandidate) {
              const mapped = trLine.mapping.map(from);
              setSafeSelection(trLine, mapped);
            }
            memo.lastSplitPos = pageBoundaryPos;
            memo.lastSplitAt = performance.now();
            memo.lastSplitReason = split.reason;
            if (split.reason === "keepWithNext") {
              memo.lockedJoinPos.set(pageBoundaryPos, {
                docSize,
                at: memo.lastSplitAt,
                reason: split.reason
              });
            }
            dispatchPagination(view, trLine);
            return;
          }
          // Manual page replacement fallback (bypass ProseMirror split constraints).
          try {
            const manualCandidates =
              boundaryCandidates.length > 0
                ? boundaryCandidates
                : [pageBoundaryPos].filter((value) => Number.isFinite(value) && value > 0);
            for (const candidate of manualCandidates) {
              const candidateResolved = trLine.doc.resolve(candidate);
              const candidatePageDepth = findPageDepth(candidateResolved, pageType);
              if (candidatePageDepth < 0) continue;
              const pageNode = candidateResolved.node(candidatePageDepth);
              const pageStart = candidateResolved.start(candidatePageDepth);
              const pagePos = candidateResolved.before(candidatePageDepth);
              const splitOffset = candidate - pageStart;
              let trReplace = splitPageNode(trLine, pagePos, pageNode, splitOffset, pageType);
              if (!trReplace) continue;
              trReplace.setMeta(paginationKey, { source: "pagination", op: "split", pos: candidate });
              const from = view.state.selection.from;
              if (from >= splitCandidate) {
                const mapped = trReplace.mapping.map(from);
                setSafeSelection(trReplace, mapped);
              }
              memo.lastSplitPos = candidate;
              memo.lastSplitAt = performance.now();
              memo.lastSplitReason = split.reason;
              if (split.reason === "keepWithNext") {
                memo.lockedJoinPos.set(candidate, {
                  docSize,
                  at: memo.lastSplitAt,
                  reason: split.reason
                });
              }
              dispatchPagination(view, trReplace);
              return;
            }
          } catch (error) {
            logDebug("manual page split failed", { error: String(error) });
          }
          logDebug("line split candidate rejected", {
            splitCandidate,
            paragraphDepth,
            blockDepth,
            pageDepth,
            mappedDepth: boundaryResolved.depth,
            pageBoundaryPos,
            mappedPosLeftContext: describePos(trLine.doc, mappedPosLeft),
            mappedPosRightContext: describePos(trLine.doc, mappedPosRight),
            boundaryPosContext: describePos(trLine.doc, pageBoundaryPos)
          });
        }
      }
      if (!canSplitAtPos && insideBlock) {
        const fallbackPos = split.after ? resolved.after(childDepth) : resolved.before(childDepth);
        if (fallbackPos > 0 && fallbackPos !== splitPos) {
          const fallbackDepth = 1;
          const fallbackTypes = [{ type: pageType }];
          if (canSplit(view.state.doc, fallbackPos, fallbackDepth, fallbackTypes as any)) {
            logDebug("fallback to block boundary split", { splitPos, fallbackPos });
            splitPos = fallbackPos;
            depth = fallbackDepth;
            typesAfter.length = 0;
            typesAfter.push(...fallbackTypes);
            canSplitAtPos = true;
          }
        }
      }
      if (!canSplitAtPos && insideBlock) {
        // Some schemas allow the split when using implicit types/attrs.
        if (canSplit(view.state.doc, splitPos, depth)) {
          logDebug("fallback to default split types", { splitPos, depth });
          canSplitAtPos = true;
          preferDefaultTypes = true;
        }
      }
      if (!canSplitAtPos && insideBlock) {
        // Two-step fallback: split the paragraph first, then split the page at the new boundary.
        const paragraphDepth = Math.max(1, safeResolved.depth - blockDepth);
        if (canSplit(view.state.doc, splitPos, paragraphDepth)) {
          let trFallback = view.state.tr.split(splitPos, paragraphDepth);
          // Map to the left side of the split to preserve a page-depth boundary.
          const mappedPos = trFallback.mapping.map(splitPos, -1);
          const mappedResolved = trFallback.doc.resolve(mappedPos);
          // After splitting the paragraph, mappedPos is the boundary between the two blocks.
          let pageBoundaryPos = mappedPos;
          let didSplit = false;
          if (canSplit(trFallback.doc, pageBoundaryPos, 1)) {
            try {
              trFallback = trFallback.split(pageBoundaryPos, 1);
              didSplit = true;
              logDebug("fallback to two-step split", { splitPos, paragraphDepth, mappedPos, boundaryDepth: 1 });
            } catch (error) {
              logDebug("fallback split page-only threw", {
                pageBoundaryPos,
                error: String(error)
              });
            }
          }
          if (!didSplit) {
            const boundaryDepth = Math.max(1, mappedResolved.depth - pageDepth);
            const boundaryTypes: Array<{ type: any; attrs?: any } | null> = new Array(boundaryDepth).fill(null);
            boundaryTypes[0] = { type: pageType };
            for (let i = 1; i < boundaryDepth; i += 1) {
              const depthAt = pageDepth + i;
              if (depthAt > mappedResolved.depth) break;
              const nodeAt = mappedResolved.node(depthAt);
              if (!nodeAt) break;
              boundaryTypes[i] = { type: nodeAt.type, attrs: nodeAt.attrs };
            }
            if (canSplit(trFallback.doc, pageBoundaryPos, boundaryDepth, boundaryTypes as any)) {
              logDebug("fallback to two-step split", { splitPos, paragraphDepth, mappedPos, boundaryDepth });
              try {
                trFallback = trFallback.split(pageBoundaryPos, boundaryDepth, boundaryTypes as any);
                didSplit = true;
              } catch (error) {
                logDebug("fallback boundary split threw", {
                  pageBoundaryPos,
                  boundaryDepth,
                  error: String(error)
                });
              }
            }
          }
          if (didSplit) {
            trFallback.setMeta(paginationKey, { source: "pagination", op: "split", pos: pageBoundaryPos });
            const from = view.state.selection.from;
            if (from >= splitPos) {
              const mapped = trFallback.mapping.map(from);
              setSafeSelection(trFallback, mapped);
            }
            dispatchPagination(view, trFallback);
            return;
          }
          // Manual page replacement fallback (bypass ProseMirror split constraints).
          try {
            const pageNode = mappedResolved.node(pageDepth);
            const pageStart = mappedResolved.start(pageDepth);
            const pagePos = mappedResolved.before(pageDepth);
            const splitOffset = pageBoundaryPos - pageStart;
            let trReplace = splitPageNode(trFallback, pagePos, pageNode, splitOffset, pageType);
            if (trReplace) {
              trReplace.setMeta(paginationKey, { source: "pagination", op: "split", pos: pageBoundaryPos });
              const from = view.state.selection.from;
              if (from >= splitPos) {
                const mapped = trReplace.mapping.map(from);
                setSafeSelection(trReplace, mapped);
              }
              dispatchPagination(view, trReplace);
              return;
            }
          } catch (error) {
            logDebug("manual fallback split failed", { error: String(error) });
          }
          logDebug("fallback two-step split rejected", {
            splitPos,
            paragraphDepth,
            blockDepth,
            pageDepth,
            mappedDepth: mappedResolved.depth,
            pageBoundaryPos
          });
        }
      }
      if (!canSplitAtPos) {
        const manualSplitId = markPaginationSplit ? `ps-${memo.splitIdCounter++}` : null;
        const manualSplit = attemptManualPageSplit(
          view.state.tr,
          splitPos,
          pageDepth,
          pageType,
          view.state.selection.from,
          manualSplitId ?? undefined
        );
        if (manualSplit) {
          memo.lastSplitPos = splitPos;
          memo.lastSplitAt = performance.now();
          memo.lastSplitReason = split.reason;
          if (split.reason === "keepWithNext") {
            memo.lockedJoinPos.set(splitPos, {
              docSize,
              at: memo.lastSplitAt,
              reason: split.reason
            });
          }
          dispatchPagination(view, manualSplit);
          return;
        }
        logDebug("skip split (canSplit=false)", { splitPos, depth, pageDepth });
        continue;
      }
      const from = view.state.selection.from;
      logDebug("splitting page", { splitPos, depth, selectionFrom: from, reason: split.reason });
      let tr: any | null = null;
      try {
        tr = preferDefaultTypes ? view.state.tr.split(splitPos, depth) : view.state.tr.split(splitPos, depth, typesAfter as any);
      } catch (error) {
        logDebug("split failed", {
          splitPos,
          depth,
          pageDepth,
          reason: split.reason,
          error: String(error)
        });
        // Fallback: split at the block boundary (before/after) instead of inside the block.
        try {
          const fallbackPos = split.after ? resolved.after(childDepth) : resolved.before(childDepth);
          if (fallbackPos > 0 && fallbackPos !== splitPos) {
            const fallbackDepth = 1;
            const fallbackTypes = [{ type: pageType }];
            if (canSplit(view.state.doc, fallbackPos, fallbackDepth, fallbackTypes as any)) {
              logDebug("split fallback to block boundary", { fallbackPos, fallbackDepth });
              tr = view.state.tr.split(fallbackPos, fallbackDepth, fallbackTypes as any);
              splitPos = fallbackPos;
            }
          }
        } catch (fallbackError) {
          logDebug("split fallback failed", { splitPos, error: String(fallbackError) });
        }
      }
      if (!tr) continue;
      tr.setMeta(paginationKey, { source: "pagination", op: "split", pos: splitPos });
      let splitBoundaryPos: number | null = null;
      try {
        const mapped = tr.mapping.map(splitPos);
        const $mapped = tr.doc.resolve(mapped);
        const mappedPageDepth = findPageDepth($mapped, pageType);
        if (mappedPageDepth >= 0) {
          const beforeBoundary = $mapped.before(mappedPageDepth);
          const afterBoundary = $mapped.after(mappedPageDepth);
          splitBoundaryPos = afterBoundary > 0 ? afterBoundary : beforeBoundary > 0 ? beforeBoundary : null;
        }
      } catch {
        splitBoundaryPos = null;
      }
      memo.lastSplitPos = splitBoundaryPos ?? splitPos;
      memo.lastSplitAt = performance.now();
      memo.lastSplitReason = split.reason;
      if (markPaginationSplit) {
        const splitId = `ps-${memo.splitIdCounter++}`;
        const mapped = tr.mapping.map(splitPos);
        const $mapped = tr.doc.resolve(mapped);
        const before = $mapped.nodeBefore;
        const after = $mapped.nodeAfter;
        if (before?.type?.name === "paragraph" && after?.type?.name === "paragraph") {
          const beforePos = mapped - before.nodeSize;
          const afterPos = mapped;
          const beforeAttrs = { ...(before.attrs as any), paginationSplitId: splitId };
          const afterAttrs = { ...(after.attrs as any), paginationSplitId: splitId };
          tr.setNodeMarkup(beforePos, before.type, beforeAttrs, before.marks);
          tr.setNodeMarkup(afterPos, after.type, afterAttrs, after.marks);
        }
      }
      if (split.reason === "keepWithNext") {
        const lockPos = splitBoundaryPos ?? splitPos;
        memo.lockedJoinPos.set(lockPos, {
          docSize,
          at: memo.lastSplitAt,
          reason: split.reason
        });
      }
      if (from >= splitPos) {
        const mapped = tr.mapping.map(from);
        logDebug("moving selection after split", { from, mapped });
        setSafeSelection(tr, mapped);
      }
      dispatchPagination(view, tr);
      return;
    }
    const skipJoin = document.documentElement.classList.contains("leditor-footnote-editing");
    if (!skipJoin) {
      const criticalJoinPos = findCriticalUnderfillJoin(view, pageType);
      if (criticalJoinPos != null) {
        if (memo.lockedJoinPos.has(criticalJoinPos)) {
          memo.lockedJoinPos.delete(criticalJoinPos);
        }
        let tr = attemptManualPageJoin(view.state.tr, criticalJoinPos, pageType, view.state.selection.from);
        if (!tr && canJoin(view.state.doc, criticalJoinPos)) {
          try {
            tr = view.state.tr.join(criticalJoinPos);
            tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: criticalJoinPos });
          } catch {
            tr = null;
          }
        }
        if (tr) {
          memo.lastSplitPos = null;
          memo.lastSplitAt = 0;
          memo.lastSplitReason = null;
          memo.lockedJoinPos.delete(criticalJoinPos);
          dispatchPagination(view, tr);
          return;
        }
      }
    }
    if (!skipJoin) {
      const underfilledJoinPos = findUnderfilledJoin(view, pageType);
      if (underfilledJoinPos != null) {
        const lock = memo.lockedJoinPos.get(underfilledJoinPos);
        const lockAge = lock ? performance.now() - lock.at : 0;
        const ignoreLock = Boolean(lock && lockAge > 900);
        if (lock && !ignoreLock) {
          logDebug("skip join (locked underfill)", { joinPos: underfilledJoinPos, lockAge });
        }
        if (ignoreLock) {
          memo.lockedJoinPos.delete(underfilledJoinPos);
        }
        if (!lock || ignoreLock) {
          let tr = attemptManualPageJoin(view.state.tr, underfilledJoinPos, pageType, view.state.selection.from);
          if (!tr && canJoin(view.state.doc, underfilledJoinPos)) {
            try {
              tr = view.state.tr.join(underfilledJoinPos);
              tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: underfilledJoinPos });
            } catch {
              tr = null;
            }
          }
          if (tr) {
            memo.lastSplitPos = null;
            memo.lastSplitAt = 0;
            memo.lastSplitReason = null;
            memo.lockedJoinPos.delete(underfilledJoinPos);
            dispatchPagination(view, tr);
            return;
          }
        }
      }
      const now = performance.now();
      // Avoid split/join oscillation right after a split or while footnote layout is still settling.
      const recentSplit = memo.lastSplitAt > 0 && now - memo.lastSplitAt < 450;
      const footnoteChurnAt =
        (window as typeof window & { __leditorFootnoteLayoutChangedAt?: number })
          .__leditorFootnoteLayoutChangedAt ?? 0;
      const recentFootnoteLayout = footnoteChurnAt > 0 && now - footnoteChurnAt < 350;
      const preferJoin = Boolean(options?.preferJoin);
      if (!preferJoin && (recentSplit || recentFootnoteLayout)) {
        logDebug("skip join (layout settling)", { recentSplit, recentFootnoteLayout });
        return;
      }
      const joinBufferPx = options?.preferJoin ? DELETE_JOIN_BUFFER_PX : DEFAULT_JOIN_BUFFER_PX;
      if (options?.preferJoin && selection) {
        try {
          const $from = selection.$from;
          const pageIndex = $from.index(0);
          if ($from.parentOffset === 0 && pageIndex > 0) {
            const joinPos = getJoinPosForPageIndex(view.state.doc, pageType, pageIndex);
            if (joinPos !== null) {
              const manualJoin = attemptManualPageJoin(
                view.state.tr,
                joinPos,
                pageType,
                view.state.selection.from
              );
              if (manualJoin) {
                memo.lastSplitPos = null;
                memo.lastSplitAt = 0;
                memo.lastSplitReason = null;
                memo.lockedJoinPos.delete(joinPos);
                dispatchPagination(view, manualJoin);
                return;
              }
              if (canJoin(view.state.doc, joinPos)) {
                try {
                  const trJoin = view.state.tr.join(joinPos);
                  trJoin.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos });
                  memo.lastSplitPos = null;
                  memo.lastSplitAt = 0;
                  memo.lastSplitReason = null;
                  memo.lockedJoinPos.delete(joinPos);
                  dispatchPagination(view, trJoin);
                  return;
                } catch {
                  // ignore failed join attempt
                }
              }
            }
          }
        } catch {
          // ignore join-from-selection failures
        }
      }
      const joinPos = findJoinBoundary(view, pageType, 1, joinBufferPx);
      if (joinPos !== null) {
        const lockPosCandidates = [joinPos, joinPos - 1, joinPos + 1, joinPos - 2, joinPos + 2];
        let lock: { docSize: number; at: number; reason: string } | null = null;
        let lockPos: number | null = null;
        if (!preferJoin) {
          for (const pos of lockPosCandidates) {
            const candidate = memo.lockedJoinPos.get(pos);
            if (candidate) {
              lock = candidate;
              lockPos = pos;
              break;
            }
          }
          if (lock) {
            const age = now - lock.at;
            if (age < 1200) {
              logDebug("skip join (locked boundary)", { joinPos, lockPos, reason: lock.reason, age });
              return;
            }
            memo.lockedJoinPos.delete(lockPos as number);
          }
        }
        const recentlySplitSamePos =
          memo.lastSplitPos !== null &&
          Math.abs(memo.lastSplitPos - joinPos) <= 2 &&
          memo.lastSplitAt > memo.lastExternalChangeAt;
        if (recentlySplitSamePos && !preferJoin) {
          if (memo.lastSplitReason === "keepWithNext") {
            logDebug("skip join (keep-with-next lock)", { joinPos });
          } else {
            logDebug("skip join (recent split)", { joinPos });
          }
          return;
        }
        const joinResolved = view.state.doc.resolve(joinPos);
        const joinBefore = joinResolved.nodeBefore;
        const joinAfter = joinResolved.nodeAfter;
        if (!joinBefore || !joinAfter || joinBefore.type !== pageType || joinAfter.type !== pageType) {
          logDebug("skip join (non-page boundary)", {
            joinPos,
            before: joinBefore?.type?.name ?? null,
            after: joinAfter?.type?.name ?? null
          });
          return;
        }
        if (!canJoin(view.state.doc, joinPos)) {
          const manualJoin = attemptManualPageJoin(
            view.state.tr,
            joinPos,
            pageType,
            view.state.selection.from
          );
          if (manualJoin) {
            memo.lastSplitPos = null;
            memo.lastSplitAt = 0;
            memo.lastSplitReason = null;
            memo.lockedJoinPos.delete(joinPos);
            dispatchPagination(view, manualJoin);
            return;
          }
          logDebug("skip join (canJoin=false)", { joinPos });
          return;
        }
        logDebug("joining pages", { joinPos });
        let tr: any | null = null;
        try {
          tr = view.state.tr.join(joinPos);
        } catch (error) {
          logDebug("join threw", { joinPos, error: String(error) });
          tr = attemptManualPageJoin(view.state.tr, joinPos, pageType, view.state.selection.from);
        }
        if (!tr) return;
        tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos });
        memo.lastSplitPos = null;
        memo.lastSplitAt = 0;
        memo.lastSplitReason = null;
        memo.lockedJoinPos.delete(joinPos);
        try {
          const mappedJoinPos = tr.mapping.map(joinPos);
          const $mapped = tr.doc.resolve(mappedJoinPos);
          const before = $mapped.nodeBefore;
          const after = $mapped.nodeAfter;
          if (before?.type?.name === "paragraph" && after?.type?.name === "paragraph") {
            const beforeId = (before.attrs as any)?.paginationSplitId ?? null;
            const afterId = (after.attrs as any)?.paginationSplitId ?? null;
            if (beforeId && beforeId === afterId && canJoin(tr.doc, mappedJoinPos)) {
              tr.join(mappedJoinPos);
              const mergedPos = mappedJoinPos - before.nodeSize;
              const merged = tr.doc.nodeAt(mergedPos);
              if (merged?.type?.name === "paragraph") {
                const mergedAttrs = { ...(merged.attrs as any) };
                delete mergedAttrs.paginationSplitId;
                tr.setNodeMarkup(mergedPos, merged.type, mergedAttrs, merged.marks);
              }
              logDebug("merged pagination-split paragraph", { joinPos: mappedJoinPos, splitId: beforeId });
            }
          }
        } catch {
          // ignore merge failures
        }
        dispatchPagination(view, tr);
        return;
      }
    }
    const emptyRange = findEmptyPageRange(view.state.doc, pageType);
    if (emptyRange && view.state.doc.childCount > 1) {
      logDebug("dropping empty page", emptyRange);
      const tr = view.state.tr.delete(emptyRange.from, emptyRange.to);
      dispatchPagination(view, tr);
    }
  } finally {
    runningRef.value = false;
  }
};

export const PageDocument = Document.extend({
  content: "page+",
  addAttributes() {
    return {
      citationStyleId: {
        default: "apa"
      },
      citationLocale: {
        default: "en-US"
      },
      footnoteNumbering: {
        default: "document"
      },
      footnoteNumberFormat: {
        default: "decimal"
      },
      footnoteNumberPrefix: {
        default: ""
      },
      footnoteNumberSuffix: {
        default: ""
      },
      endnoteNumberFormat: {
        default: "decimal"
      },
      endnoteNumberPrefix: {
        default: ""
      },
      endnoteNumberSuffix: {
        default: ""
      }
    };
  }
});

export const PageNode = Node.create({
  name: "page",
  group: "page",
  content: "block+",
  defining: true,
  isolating: false,
  parseHTML() {
    return [
      { tag: "div[data-page]" },
      { tag: `div.${PAGE_CLASS}` }
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page": "true", class: PAGE_CLASS }), 0];
  },
  addNodeView() {
    return (props: any) => {
      const view = props?.view;
      const getPos = props?.getPos;
      let lastPageIndex: number | null = null;
      const page = document.createElement("div");
      const computePageIndex = () => {
        try {
          const pos = typeof getPos === "function" ? getPos() : null;
          if (typeof pos === "number" && view?.state?.doc) {
            const $pos = view.state.doc.resolve(pos);
            const nextIndex = $pos.index(0);
            if (Number.isFinite(nextIndex) && nextIndex !== lastPageIndex) {
              lastPageIndex = nextIndex;
              page.dataset.pageIndex = String(nextIndex);
            }
            return;
          }
        } catch {
          // ignore
        }
      };
      page.className = PAGE_CLASS;
      page.setAttribute("data-page", "true");
      computePageIndex();
      const inner = document.createElement("div");
      inner.className = PAGE_INNER_CLASS;
      const header = document.createElement("div");
      header.className = PAGE_HEADER_CLASS;
      header.setAttribute("aria-hidden", "true");
      header.contentEditable = "false";
      header.style.top = "var(--doc-header-distance, 48px)";
      header.style.bottom = "auto";
      header.style.left = "var(--local-page-margin-left, var(--page-margin-left))";
      header.style.right = "var(--local-page-margin-right, var(--page-margin-right))";
      header.style.height = "var(--header-height)";
      const content = document.createElement("div");
      content.className = PAGE_CONTENT_CLASS;
      enforceSingleColumnContent(content);
      const continuation = document.createElement("div");
      continuation.className = PAGE_FOOTNOTE_CONTINUATION_CLASS;
      continuation.setAttribute("aria-hidden", "true");
      continuation.contentEditable = "false";
      const footnotes = document.createElement("div");
      footnotes.className = PAGE_FOOTNOTES_CLASS;
      footnotes.setAttribute("aria-hidden", "true");
      footnotes.contentEditable = "false";
      footnotes.style.top = "auto";
      footnotes.style.left = "var(--local-page-margin-left, var(--page-margin-left))";
      footnotes.style.right = "var(--local-page-margin-right, var(--page-margin-right))";
      footnotes.style.bottom = "calc(var(--doc-footer-distance, 48px) + var(--footer-height))";
      footnotes.style.minHeight = "var(--footnote-area-height)";
      const footer = document.createElement("div");
      footer.className = PAGE_FOOTER_CLASS;
      footer.setAttribute("aria-hidden", "true");
      footer.contentEditable = "false";
      footer.style.top = "auto";
      footer.style.left = "var(--local-page-margin-left, var(--page-margin-left))";
      footer.style.right = "var(--local-page-margin-right, var(--page-margin-right))";
      footer.style.bottom = "var(--doc-footer-distance, 48px)";
      footer.style.height = "var(--footer-height)";

      inner.appendChild(header);
      inner.appendChild(content);
      inner.appendChild(continuation);
      inner.appendChild(footnotes);
      inner.appendChild(footer);
      page.appendChild(inner);
      return {
        dom: page,
        contentDOM: content,
        update(node: any) {
          if (!node || node.type?.name !== "page") return false;
          computePageIndex();
          return true;
        }
      };
    };
  }
});

export const PagePagination = Extension.create({
  name: "pagePagination",
  addProseMirrorPlugins() {
    let lastMutationWasDelete = false;
    const paginationMemo: PaginationMemo = {
      lastSplitPos: null,
      lastSplitAt: 0,
      lastSplitReason: null,
      lastExternalChangeAt: 0,
      lastDocSize: 0,
      lastNormalizeAt: 0,
      lastNormalizeDocSize: 0,
      lastFlattenAt: 0,
      lastFlattenDocSize: 0,
      autoNormalizeOnceDone: false,
      lockedJoinPos: new Map(),
      splitIdCounter: 1
    };
    return [
      new Plugin({
        key: paginationKey,
        props: {
          handleKeyDown(view, event) {
            if (event.defaultPrevented || event.isComposing) return false;
            if (event.key === "Backspace") {
              if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
              if (handlePageBoundaryBackspace(view)) {
                event.preventDefault();
                return true;
              }
            }
            if (event.key === "Enter") {
              if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
              if (handlePageBoundaryEnter(view)) {
                event.preventDefault();
                return true;
              }
            }
            return false;
          }
        },
        appendTransaction(transactions, _oldState, newState) {
          lastMutationWasDelete = transactions.some((tr) => isDeleteTransaction(tr));
          const hasPaginationOnly = transactions.every((tr) => {
            const meta = tr.getMeta(paginationKey) as { source?: string } | undefined;
            return meta?.source === "pagination";
          });
          if (!hasPaginationOnly && transactions.length > 0) {
            paginationMemo.lastExternalChangeAt = performance.now();
          }
          return wrapDocInPage(newState);
        },
        view(editorView) {
          // pagination debug log removed
          const running = { value: false };
          const scheduler = new PaginationScheduler({
            root: editorView.dom as HTMLElement,
            onRun: () => {
              logPaginationStats(editorView, "scheduler run");
              paginateView(editorView, running, paginationMemo, { preferJoin: lastMutationWasDelete });
              lastMutationWasDelete = false;
            }
          });
          const handleExternalPaginationRequest = () => {
            scheduler.request();
          };
          logPaginationStats(editorView, "scheduler mounted");
          scheduler.request();
          editorView.dom.addEventListener(
            "leditor:pagination-request",
            handleExternalPaginationRequest as EventListener
          );
          return {
            update(view, prevState) {
              if (view.state.doc.eq(prevState.doc)) return;
              logPaginationStats(view, "scheduler queue");
              scheduler.request();
            },
            destroy() {
              editorView.dom.removeEventListener(
                "leditor:pagination-request",
                handleExternalPaginationRequest as EventListener
              );
              scheduler.dispose();
            }
          };
        }
      })
    ];
  }
});
