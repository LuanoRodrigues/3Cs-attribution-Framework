import type { EditorView } from "@tiptap/pm/view";
import type { PluginKey, Transaction } from "@tiptap/pm/state";
import { canJoin, canSplit } from "@tiptap/pm/transform";
import type { PaginationSnapshot } from "./snapshot.ts";
import type { PaginationPolicy } from "./policy.ts";

type PageInfo = { index: number; pos: number; node: any };

const recordTrace = (event: string, detail?: Record<string, unknown>) => {
  try {
    const g = window as any;
    if (!g.__leditorPaginationTraceEnabled) return;
    if (!Array.isArray(g.__leditorPaginationTrace)) g.__leditorPaginationTrace = [];
    g.__leditorPaginationTrace.push({
      ts: performance.now(),
      event,
      ...(detail || {})
    });
    const maxLen = typeof g.__leditorPaginationTraceLimit === "number" ? g.__leditorPaginationTraceLimit : 200;
    if (g.__leditorPaginationTrace.length > maxLen) {
      g.__leditorPaginationTrace.splice(0, g.__leditorPaginationTrace.length - maxLen);
    }
  } catch {
    // ignore
  }
};

const recordFail = (detail: Record<string, unknown>) => {
  recordTrace("phase2:underfill-fail", detail);
  try {
    const g = window as any;
    if (!Array.isArray(g.__leditorPhase2UnderfillFailures)) {
      g.__leditorPhase2UnderfillFailures = [];
    }
    g.__leditorPhase2UnderfillFailures.push({
      ts: performance.now(),
      ...detail
    });
    if (g.__leditorPhase2UnderfillFailures.length > 12) {
      g.__leditorPhase2UnderfillFailures.splice(0, g.__leditorPhase2UnderfillFailures.length - 12);
    }
  } catch {
    // ignore
  }
};

const isFootnoteStorageNode = (node: any): boolean => {
  const name = node?.type?.name;
  return name === "footnotesContainer" || name === "footnoteBody";
};

const pageEndsWithManualBreak = (pageNode: any): boolean => {
  if (!pageNode?.content) return false;
  for (let i = pageNode.childCount - 1; i >= 0; i -= 1) {
    const child = pageNode.child(i);
    if (isFootnoteStorageNode(child)) continue;
    return child.type?.name === "page_break";
  }
  return false;
};

const pageStartsWithManualBreak = (pageNode: any): boolean => {
  if (!pageNode?.content) return false;
  for (let i = 0; i < pageNode.childCount; i += 1) {
    const child = pageNode.child(i);
    if (isFootnoteStorageNode(child)) continue;
    return child.type?.name === "page_break";
  }
  return false;
};

const hasManualBreakBoundary = (doc: any, pageType: any, joinPos: number): boolean => {
  try {
    const resolved = doc.resolve(joinPos);
    const before = resolved.nodeBefore;
    const after = resolved.nodeAfter;
    if (!before || !after || before.type !== pageType || after.type !== pageType) return false;
    if (pageEndsWithManualBreak(before) || pageStartsWithManualBreak(after)) return true;
  } catch {
    // ignore
  }
  return false;
};

const scheduleUnderfillFollowup = (view: EditorView) => {
  try {
    const g = window as any;
    if (g.__leditorPhase2UnderfillFollowupPending) return;
    g.__leditorPhase2UnderfillFollowupPending = true;
    g.__leditorPhase2UnderfillFollowupAt = performance.now();
    const dispatch = () => {
      try {
        view.dom.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
      } catch {
        // ignore
      }
    };
    window.setTimeout(dispatch, 160);
    window.setTimeout(() => {
      dispatch();
      g.__leditorPhase2UnderfillFollowupAt = performance.now();
      g.__leditorPhase2UnderfillFollowupPending = false;
    }, 720);
  } catch {
    // ignore
  }
};

const MAX_FREE_LINES = 4;
const MAX_FREE_LINES_RATIO = 0.08;
const MIN_LINE_CHARS = 5;
const MAX_PARAGRAPH_SPLIT_FREE_LINES = 7;

const readPaginationNumber = (key: string, fallback: number, options?: { min?: number; max?: number }): number => {
  let value = fallback;
  try {
    const raw = (window as any)[key];
    if (typeof raw === "number" && Number.isFinite(raw)) value = raw;
  } catch {
    // ignore
  }
  if (typeof options?.min === "number") value = Math.max(options.min, value);
  if (typeof options?.max === "number") value = Math.min(options.max, value);
  return value;
};

const getMaxFreeLines = (): number =>
  readPaginationNumber("__leditorPaginationMaxFreeLines", MAX_FREE_LINES, { min: 2, max: 24 });

const getMaxFreeLinesRatio = (): number =>
  readPaginationNumber("__leditorPaginationMaxFreeLinesRatio", MAX_FREE_LINES_RATIO, { min: 0.05, max: 0.3 });

const getMinLineChars = (): number =>
  readPaginationNumber("__leditorPaginationMinLineChars", MIN_LINE_CHARS, { min: 2, max: 24 });

const estimateCharWidth = (el: HTMLElement): number => {
  try {
    const style = getComputedStyle(el);
    const fontSize = Number.parseFloat(style.fontSize || "0") || 0;
    const font = style.font || "";
    if (font) {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.font = font;
        const sample = "abcdefghijklmnopqrstuvwxyz";
        const width = ctx.measureText(sample).width;
        if (width > 0) return width / sample.length;
      }
    }
    if (fontSize > 0) return fontSize * 0.55;
  } catch {
    // ignore
  }
  return 7;
};

const resolveLineHeightPx = (el: HTMLElement | null, fallback: number): number => {
  if (!el) return fallback;
  try {
    const style = getComputedStyle(el);
    const raw = Number.parseFloat(style.lineHeight || "");
    if (Number.isFinite(raw) && raw > 0) return raw;
    const fontSize = Number.parseFloat(style.fontSize || "");
    if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * 1.2;
  } catch {
    // ignore
  }
  return fallback;
};

const getMaxParagraphSplitFreeLines = (): number =>
  readPaginationNumber("__leditorPaginationMaxParagraphSplitFreeLines", MAX_PARAGRAPH_SPLIT_FREE_LINES, {
    min: 0,
    max: 12
  });

const getPageContent = (view: EditorView, index: number): HTMLElement | null => {
  const root =
    (view.dom as HTMLElement)?.closest?.(".leditor-page-stack") ??
    document.documentElement;
  const pages = Array.from(root.querySelectorAll<HTMLElement>(".leditor-page"));
  const byIndex = pages.find((page) => {
    const raw = page.dataset.pageIndex ?? "";
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(parsed) ? parsed === index : false;
  });
  const page = byIndex ?? pages[index];
  return page ? (page.querySelector<HTMLElement>(".leditor-page-content") ?? null) : null;
};

const collectBlocks = (content: HTMLElement, selectors: string[]): HTMLElement[] => {
  const fallbackSelector = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, table, figure, hr, .leditor-break";
  const selector = selectors.length ? selectors.join(",") : fallbackSelector;
  return Array.from(content.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => el.closest(".leditor-page-content") === content
  );
};

const getContentScale = (content: HTMLElement): number => {
  const rect = content.getBoundingClientRect();
  const base = content.clientHeight || 0;
  if (rect.height > 0 && base > 0) {
    const scale = rect.height / base;
    if (Number.isFinite(scale) && scale > 0) return scale;
  }
  return 1;
};

const measureBlockHeightPx = (el: HTMLElement, content: HTMLElement, scale: number): number => {
  const rect = el.getBoundingClientRect();
  const marginTop = Number.parseFloat(getComputedStyle(el).marginTop || "0") || 0;
  const marginBottom = Number.parseFloat(getComputedStyle(el).marginBottom || "0") || 0;
  const height = rect.height / (scale || 1);
  return Math.max(0, height + marginTop + marginBottom);
};

const measureLastBottom = (blocks: HTMLElement[], content: HTMLElement, scale: number): number => {
  if (!blocks.length) return 0;
  const contentRect = content.getBoundingClientRect();
  let maxBottom = 0;
  blocks.forEach((block) => {
    const rect = block.getBoundingClientRect();
    const marginBottom = Number.parseFloat(getComputedStyle(block).marginBottom || "0") || 0;
    const bottom = (rect.bottom - contentRect.top) / (scale || 1) + marginBottom;
    if (bottom > maxBottom) maxBottom = bottom;
  });
  return Math.max(0, maxBottom);
};

const isLineSplitTag = (tag: string): boolean =>
  tag === "P" || tag === "LI" || tag === "BLOCKQUOTE" || tag === "PRE";

const hasAnchorMark = (node: any): boolean => {
  if (!node?.isText) return false;
  const marks = node.marks ?? [];
  return marks.some((mark: any) => mark?.type?.name === "anchor");
};

const isAnchorInlineNode = (node: any): boolean => node?.type?.name === "anchorMarker";

const clampTrailingWordOffset = (text: string, offset: number): number => {
  const safeOffset = Math.max(0, Math.min(offset, text.length));
  if (!text || safeOffset <= 0) return safeOffset;
  let end = safeOffset;
  while (end > 0 && /\s/.test(text[end - 1] ?? "")) end -= 1;
  if (end <= 0) return safeOffset;
  let forward = end;
  while (forward < text.length && !/\s/.test(text[forward] ?? "")) forward += 1;
  if (forward > safeOffset) return forward;
  return end;
};

const isWordChar = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch || "");
const isHyphen = (ch: string): boolean =>
  ch === "-" || ch === "\u2010" || ch === "\u2011" || ch === "\u00ad" || ch === "\u2212";
const isPunctuation = (ch: string): boolean => /[.,;:!?]/.test(ch || "");
const isClosingPunct = (ch: string): boolean => /[\"'”’)\]]/.test(ch || "");

const adjustSplitPosForWords = (doc: any, pos: number): number => {
  try {
    const resolved = doc.resolve(pos);
    if (!resolved.parent?.isTextblock) return pos;
    const parentText = resolved.parent.textBetween(0, resolved.parent.content.size, "\n", "\n");
    const offset = resolved.parentOffset;
    if (offset <= 0 || offset >= parentText.length) return pos;
    const before = parentText[offset - 1] ?? "";
    const after = parentText[offset] ?? "";
    if (isWordChar(before) && isWordChar(after) && !isHyphen(before)) {
      const adjustedOffset = clampTrailingWordOffset(parentText, offset);
      const parentStart = resolved.start(resolved.depth);
      const adjustedPos = parentStart + adjustedOffset;
      if (adjustedPos > 0 && adjustedPos < doc.content.size) return adjustedPos;
    }
    if (isWordChar(before) && isPunctuation(after)) {
      let newOffset = Math.min(parentText.length, offset + 1);
      while (newOffset < parentText.length && (isPunctuation(parentText[newOffset]) || isClosingPunct(parentText[newOffset]))) {
        newOffset += 1;
      }
      const parentStart = resolved.start(resolved.depth);
      const candidate = parentStart + newOffset;
      if (candidate > 0 && candidate < doc.content.size) return candidate;
    }
    if (/[.!?]/.test(before) && /[a-z]/.test(after)) {
      let desired = Math.min(parentText.length, offset + 1);
      while (desired < parentText.length && /\s/.test(parentText[desired])) desired += 1;
      const adjustedOffset = clampTrailingWordOffset(parentText, desired);
      const parentStart = resolved.start(resolved.depth);
      const candidate = parentStart + adjustedOffset;
      if (candidate > 0 && candidate < doc.content.size) return candidate;
    }
  } catch {
    // ignore
  }
  return pos;
};

const adjustSplitPosForAnchors = (doc: any, pos: number, blockStart: number, blockEnd: number): number => {
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
      const nextPos = start + after.offset + after.node.nodeSize;
      if (nextPos > blockStart + 1 && nextPos < blockEnd - 1) return nextPos;
    }
    if (before?.node && hasAnchor(before.node)) {
      const prevPos = start + before.offset + before.node.nodeSize;
      if (prevPos > blockStart + 1 && prevPos < blockEnd - 1) return prevPos;
    }
  } catch {
    // ignore
  }
  return pos;
};

const collectTextNodes = (root: HTMLElement): Text[] => {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(node as Text);
    }
    node = walker.nextNode();
  }
  return out;
};

const findSplitPosByRange = (view: EditorView, lineRoot: HTMLElement, maxBottomAbs: number): number | null => {
  const textNodes = collectTextNodes(lineRoot);
  if (!textNodes.length) return null;
  const lengths = textNodes.map((node) => node.nodeValue?.length ?? 0);
  const total = lengths.reduce((acc, len) => acc + len, 0);
  if (total < 2) return null;
  const resolveDomOffset = (offset: number): { node: Text; offset: number } | null => {
    let remaining = Math.max(0, Math.min(total, offset));
    for (let i = 0; i < textNodes.length; i += 1) {
      const len = lengths[i];
      if (remaining <= len) return { node: textNodes[i], offset: remaining };
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
    if (rect.bottom <= maxBottomAbs) {
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

const findLineSplitPosForRemaining = (
  view: EditorView,
  content: HTMLElement,
  lineRoot: HTMLElement,
  remainingPx: number
): number | null => {
  if (remainingPx <= 0) return null;
  const contentRect = content.getBoundingClientRect();
  const scale = getContentScale(content);
  let maxBottomAbs = contentRect.top + remainingPx * scale;
  const lineRects = collectLineRects(lineRoot);
  if (lineRects.length > 0) {
    const minLineChars = getMinLineChars();
    const minLineWidth = minLineChars > 0 ? estimateCharWidth(lineRoot) * minLineChars : 0;
    if (minLineWidth > 0) {
      let lastVisibleIndex = -1;
      for (let i = 0; i < lineRects.length; i += 1) {
        if (lineRects[i].bottom <= maxBottomAbs) lastVisibleIndex = i;
      }
      if (lastVisibleIndex > 0 && lineRects[lastVisibleIndex].width < minLineWidth) {
        const prevBottom = lineRects[lastVisibleIndex - 1].bottom;
        maxBottomAbs = Math.min(maxBottomAbs, prevBottom - 1);
      }
    }
  }
  let pos = findSplitPosByRange(view, lineRoot, maxBottomAbs);
  if (!pos) return null;
  let blockStart = 0;
  let blockEnd = 0;
  try {
    const rawPos = view.posAtDOM(lineRoot, 0);
    if (Number.isFinite(rawPos) && rawPos > 0) {
      const resolved = view.state.doc.resolve(rawPos);
      for (let depth = resolved.depth; depth >= 0; depth -= 1) {
        const node = resolved.node(depth);
        if (node?.isTextblock) {
          blockStart = resolved.start(depth);
          blockEnd = resolved.end(depth);
          break;
        }
      }
    }
  } catch {
    // ignore
  }
  if (blockEnd > blockStart + 1) {
    if (pos <= blockStart + 1) return null;
    if (pos >= blockEnd - 1) pos = blockEnd - 1;
    try {
      const resolved = view.state.doc.resolve(pos);
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
      const anchorAdjusted = adjustSplitPosForAnchors(view.state.doc, pos, blockStart, blockEnd);
      if (anchorAdjusted != null) pos = anchorAdjusted;
      pos = adjustSplitPosForWords(view.state.doc, pos);
      if (resolved.parent?.isTextblock) {
        const parentText = resolved.parent.textBetween(0, resolved.parent.content.size, "\n", "\n");
        const tailOffset = resolved.parentOffset;
        const tailText = parentText.slice(tailOffset).trim();
        const minTailChars = 12;
        if (tailText.length < minTailChars && tailOffset > 0) {
          const desiredOffset = Math.max(0, tailOffset - minTailChars);
          const adjustedOffset = clampTrailingWordOffset(parentText, desiredOffset);
          const parentStart = resolved.start(resolved.depth);
          const candidatePos = parentStart + adjustedOffset;
          if (candidatePos > blockStart + 1 && candidatePos < blockEnd - 1) {
            pos = candidatePos;
          }
        }
        const headText = parentText.slice(0, tailOffset).trimEnd();
        const headLine = headText.split("\n").pop()?.trim() ?? "";
        const minHeadChars = 8;
        if (headLine && headLine.length < minHeadChars && tailOffset > minHeadChars) {
          const desiredOffset = Math.max(0, tailOffset - minHeadChars);
          const adjustedOffset = clampTrailingWordOffset(parentText, desiredOffset);
          const parentStart = resolved.start(resolved.depth);
          const candidatePos = parentStart + adjustedOffset;
          if (candidatePos > blockStart + 1 && candidatePos < blockEnd - 1) {
            pos = candidatePos;
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return pos;
};

const findPageDepth = (resolved: any, pageType: any): number => {
  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    if (resolved.node(depth).type === pageType) return depth;
  }
  return -1;
};

const resolveAfterBlock = (view: EditorView, pageType: any, el: HTMLElement): number | null => {
  try {
    const rawPos = view.posAtDOM(el, 0);
    if (!Number.isFinite(rawPos) || rawPos <= 0) return null;
    const resolved = view.state.doc.resolve(rawPos);
    const pageDepth = findPageDepth(resolved, pageType);
    if (pageDepth < 0 || resolved.depth < pageDepth + 1) return null;
    return resolved.after(pageDepth + 1);
  } catch {
    return null;
  }
};

const resolvePageSplitPos = (doc: any, pos: number, typesAfter: Array<{ type: any }>): number | null => {
  const offsets = [0, -1, 1, -2, 2, -3, 3, -4, 4];
  for (const offset of offsets) {
    const candidate = pos + offset;
    if (candidate <= 0 || candidate >= doc.content.size) continue;
    const adjusted = adjustSplitPosForWords(doc, candidate);
    if (canSplit(doc, adjusted, 1, typesAfter as any)) return adjusted;
  }
  return null;
};

const attemptDeepPageSplit = (tr: Transaction, pos: number, pageType: any): Transaction | null => {
  try {
    const adjustedPos = adjustSplitPosForWords(tr.doc, pos);
    const resolved = tr.doc.resolve(adjustedPos);
    const pageDepth = findPageDepth(resolved, pageType);
    if (pageDepth < 0) return null;
    const depth = Math.max(1, resolved.depth - pageDepth);
    const typesAfter: Array<{ type: any; attrs?: any } | null> = new Array(depth).fill(null);
    typesAfter[0] = { type: pageType };
    for (let i = 1; i < depth; i += 1) {
      const depthAt = pageDepth + i;
      if (depthAt > resolved.depth) break;
      const nodeAt = resolved.node(depthAt);
      if (!nodeAt) break;
      typesAfter[i] = { type: nodeAt.type, attrs: nodeAt.attrs };
    }
    if (canSplit(tr.doc, adjustedPos, depth, typesAfter as any)) {
      return tr.split(adjustedPos, depth, typesAfter as any);
    }
    if (canSplit(tr.doc, adjustedPos, depth)) {
      return tr.split(adjustedPos, depth);
    }
  } catch {
    // ignore
  }
  return null;
};

const collectPages = (doc: any, pageType: any): PageInfo[] => {
  const out: PageInfo[] = [];
  let pos = 0;
  for (let i = 0; i < doc.childCount; i += 1) {
    const child = doc.child(i);
    if (child.type === pageType) {
      out.push({ index: out.length, pos, node: child });
    }
    pos += child.nodeSize;
  }
  return out;
};

export const phase2Underfill = (
  view: EditorView,
  paginationKey: PluginKey,
  snapshot: PaginationSnapshot,
  policy: PaginationPolicy
): Transaction | null => {
  try {
    if ((window as any).__leditorDisablePhase2Underfill) return null;
  } catch {
    // ignore
  }
  try {
    const g = window as any;
    g.__leditorPhase2UnderfillRan = (g.__leditorPhase2UnderfillRan ?? 0) + 1;
    g.__leditorPhase2UnderfillMeta = {
      pageChromeCount: snapshot.pageChromeByIndex.length,
      domPageCount: document.querySelectorAll(".leditor-page").length
    };
  } catch {
    // ignore
  }
  const pageType = view.state.schema.nodes.page;
  if (!pageType) return null;
  const pages = collectPages(view.state.doc, pageType);
  if (pages.length < 2) return null;
  const expectedPageCount = pages.length;
  const domPageCount = document.querySelectorAll(".leditor-page").length;
  if (domPageCount > 0 && domPageCount < expectedPageCount) {
    try {
      const g = window as any;
      const last = typeof g.__leditorPhase2UnderfillDeferAt === "number" ? g.__leditorPhase2UnderfillDeferAt : 0;
      if (performance.now() - last > 200) {
        g.__leditorPhase2UnderfillDeferAt = performance.now();
        setTimeout(() => {
          try {
            view.dom.dispatchEvent(new CustomEvent("leditor:pagination-request", { bubbles: true }));
          } catch {
            // ignore
          }
        }, 60);
      }
    } catch {
      // ignore
    }
    return null;
  }
  const lastIndex = pages.length - 1;
  if (lastIndex > 0) {
    const prevContent = getPageContent(view, lastIndex - 1);
    const lastContent = getPageContent(view, lastIndex);
    if (prevContent && lastContent) {
      const prevScale = getContentScale(prevContent);
      const lastScale = getContentScale(lastContent);
      const prevStyle = getComputedStyle(prevContent);
      const lastStyle = getComputedStyle(lastContent);
      const prevLineHeightRaw = Number.parseFloat(prevStyle.lineHeight || "0");
      const lastLineHeightRaw = Number.parseFloat(lastStyle.lineHeight || "0");
      const prevLineHeightPx = Number.isFinite(prevLineHeightRaw) && prevLineHeightRaw > 0 ? prevLineHeightRaw : 16;
      const lastLineHeightPx = Number.isFinite(lastLineHeightRaw) && lastLineHeightRaw > 0 ? lastLineHeightRaw : prevLineHeightPx || 16;
      const prevPaddingBottom = Number.parseFloat(prevStyle.paddingBottom || "0") || 0;
      const lastPaddingBottom = Number.parseFloat(lastStyle.paddingBottom || "0") || 0;
      const prevGuardCss = Number.parseFloat(prevStyle.getPropertyValue("--page-footnote-guard") || "0") || 0;
      const lastGuardCss = Number.parseFloat(lastStyle.getPropertyValue("--page-footnote-guard") || "0") || 0;
      const prevGuardPx = Math.max(8, prevLineHeightPx * 0.35, prevGuardCss);
      const lastGuardPx = Math.max(8, lastLineHeightPx * 0.35, lastGuardCss);
      const prevUsableHeight = Math.max(0, prevContent.clientHeight - prevPaddingBottom);
      const lastUsableHeight = Math.max(0, lastContent.clientHeight - lastPaddingBottom);
      const prevBottomLimit = Math.max(0, prevUsableHeight - prevGuardPx);
      const lastBottomLimit = Math.max(0, lastUsableHeight - lastGuardPx);
      const prevBlocks = collectBlocks(prevContent, policy.selectors.pageable);
      const lastBlocks = collectBlocks(lastContent, policy.selectors.pageable);
      const prevLastBottom = measureLastBottom(prevBlocks, prevContent, prevScale);
      const lastLastBottom = measureLastBottom(lastBlocks, lastContent, lastScale);
      const prevRemainingPx = Math.max(0, prevBottomLimit - Math.min(prevLastBottom, prevBottomLimit));
      const prevRemainingLines = prevLineHeightPx > 0 ? Math.max(0, Math.floor(prevRemainingPx / prevLineHeightPx)) : 0;
      const prevMaxLines = prevLineHeightPx > 0 ? Math.max(0, Math.floor(prevBottomLimit / prevLineHeightPx)) : 0;
      const lastMaxLines = lastLineHeightPx > 0 ? Math.max(0, Math.floor(lastBottomLimit / lastLineHeightPx)) : 0;
      const prevUsedLines =
        prevLineHeightPx > 0
          ? Math.max(0, Math.ceil(Math.min(prevLastBottom, prevBottomLimit) / prevLineHeightPx))
          : 0;
      const lastUsedLines =
        lastLineHeightPx > 0
          ? Math.max(0, Math.ceil(Math.min(lastLastBottom, lastBottomLimit) / lastLineHeightPx))
          : 0;
      const joinPos = pages[lastIndex - 1].pos + pages[lastIndex - 1].node.nodeSize;
      if (
        lastUsedLines > 0 &&
        prevRemainingLines >= lastUsedLines + 1 &&
        canJoin(view.state.doc, joinPos) &&
        !hasManualBreakBoundary(view.state.doc, pageType, joinPos)
      ) {
        const tr = view.state.tr.join(joinPos);
        tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos, reason: "tail-merge" });
        scheduleUnderfillFollowup(view);
        return tr;
      }
      const desiredLastLines = Math.max(6, Math.ceil(lastMaxLines * 0.45));
      const minPrevLines = Math.max(6, Math.ceil(prevMaxLines * 0.4));
      const pushLines = Math.min(
        Math.max(0, prevUsedLines - minPrevLines),
        Math.max(0, desiredLastLines - lastUsedLines)
      );
      if (
        pushLines > 0 &&
        canJoin(view.state.doc, joinPos) &&
        !hasManualBreakBoundary(view.state.doc, pageType, joinPos)
      ) {
        const keepLines = Math.max(minPrevLines, prevUsedLines - pushLines);
        const keepPx = keepLines * prevLineHeightPx;
        let acc = 0;
        let splitBlock: HTMLElement | null = null;
        for (const block of prevBlocks) {
          acc += measureBlockHeightPx(block, prevContent, prevScale);
          if (acc >= keepPx) {
            splitBlock = block;
            break;
          }
        }
        let splitPos: number | null = null;
        if (splitBlock) {
          splitPos = findLineSplitPosForRemaining(view, prevContent, splitBlock, keepPx);
        }
        if (!splitPos && prevBlocks.length) {
          splitPos = resolveAfterBlock(view, pageType, prevBlocks[Math.max(0, prevBlocks.length - 1)]);
        }
        if (splitPos && splitPos > 0) {
          let tr = view.state.tr.join(joinPos);
          let mappedSplit = tr.mapping.map(splitPos, -1);
          const typesAfter = [{ type: pageType }];
          const pageSplitPos = resolvePageSplitPos(tr.doc, mappedSplit, typesAfter);
          if (pageSplitPos) {
            tr = tr.split(pageSplitPos, 1, typesAfter as any);
            tr.setMeta(paginationKey, { source: "pagination", op: "pullup", pos: pageSplitPos, reason: "tail-push" });
            scheduleUnderfillFollowup(view);
            return tr;
          }
        }
      }
    }
  }
  let best: { tr: Transaction; score: number; pageIndex: number } | null = null;
  for (let i = 0; i < pages.length - 1; i += 1) {
    const currentContent = getPageContent(view, i);
    const nextContent = getPageContent(view, i + 1);
    if (!currentContent || !nextContent) {
      try {
        const g = window as any;
        if (!g.__leditorPhase2UnderfillDebug) {
          g.__leditorPhase2UnderfillDebug = {
            pageIndex: i,
            reason: "missingContent",
            hasCurrent: Boolean(currentContent),
            hasNext: Boolean(nextContent)
          };
        }
      } catch {
        // ignore
      }
      continue;
    }
    const currentScale = getContentScale(currentContent);
    const nextScale = getContentScale(nextContent);
    const currentBlocks = collectBlocks(currentContent, policy.selectors.pageable);
    const currentStyle = getComputedStyle(currentContent);
    const lineHeightRaw = Number.parseFloat(currentStyle.lineHeight || "0");
    let lineHeightPx =
      Number.isFinite(lineHeightRaw) && lineHeightRaw > 0 ? lineHeightRaw : 0;
    if (!Number.isFinite(lineHeightPx) || lineHeightPx <= 0) {
      lineHeightPx = resolveLineHeightPx(
        currentContent.querySelector<HTMLElement>("p, li, blockquote, pre") ??
          currentContent.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6"),
        16
      );
    }
    const paddingBottom = Number.parseFloat(currentStyle.paddingBottom || "0") || 0;
    const guardCss = Number.parseFloat(currentStyle.getPropertyValue("--page-footnote-guard") || "0") || 0;
    const guardPx = Math.max(8, lineHeightPx * 0.35, guardCss);
    const usableHeight = Math.max(0, currentContent.clientHeight - paddingBottom);
    const bottomLimit = Math.max(0, usableHeight - guardPx);
    const maxLines =
      lineHeightPx > 0 ? Math.max(0, Math.floor(bottomLimit / lineHeightPx)) : 0;
    const lastBottom = measureLastBottom(currentBlocks, currentContent, currentScale);
    const remainingPx = Math.max(0, bottomLimit - Math.min(lastBottom, bottomLimit));
    const remainingLines =
      lineHeightPx > 0 ? Math.max(0, Math.floor(remainingPx / lineHeightPx)) : 0;
    if (remainingLines <= 0) continue;

    const nextStyle = getComputedStyle(nextContent);
    const nextLineHeightRaw = Number.parseFloat(nextStyle.lineHeight || "0");
    let nextLineHeightPx =
      Number.isFinite(nextLineHeightRaw) && nextLineHeightRaw > 0 ? nextLineHeightRaw : 0;
    if (!Number.isFinite(nextLineHeightPx) || nextLineHeightPx <= 0) {
      nextLineHeightPx = resolveLineHeightPx(
        nextContent.querySelector<HTMLElement>("p, li, blockquote, pre") ??
          nextContent.querySelector<HTMLElement>("h1, h2, h3, h4, h5, h6"),
        lineHeightPx || 16
      );
    }
    const nextPaddingBottom = Number.parseFloat(nextStyle.paddingBottom || "0") || 0;
    const nextGuardCss = Number.parseFloat(nextStyle.getPropertyValue("--page-footnote-guard") || "0") || 0;
    const nextGuardPx = Math.max(8, nextLineHeightPx * 0.35, nextGuardCss);
    const nextUsableHeight = Math.max(0, nextContent.clientHeight - nextPaddingBottom);
    const nextBottomLimit = Math.max(0, nextUsableHeight - nextGuardPx);
    const nextBlocks = collectBlocks(nextContent, policy.selectors.pageable);
    const nextLastBottom = measureLastBottom(nextBlocks, nextContent, nextScale);
    const nextMaxLines =
      nextLineHeightPx > 0 ? Math.max(0, Math.floor(nextBottomLimit / nextLineHeightPx)) : 0;
    const nextUsedLines =
      nextLineHeightPx > 0
        ? Math.max(0, Math.ceil(Math.min(nextLastBottom, nextBottomLimit) / nextLineHeightPx))
        : 0;
    let effectiveNextUsedLines = nextUsedLines;
    if (effectiveNextUsedLines <= 0 && nextBlocks.length > 0) {
      const fallbackHeight = measureBlockHeightPx(nextBlocks[0], nextContent, nextScale);
      if (nextLineHeightPx > 0) {
        effectiveNextUsedLines = Math.max(1, Math.ceil(fallbackHeight / nextLineHeightPx));
      } else {
        effectiveNextUsedLines = 1;
      }
    }
    if (effectiveNextUsedLines <= 0) {
      recordFail({
        pageIndex: i,
        reason: "nextUsedLines",
        remainingLines,
        maxFreeLines: 0,
        nextUsedLines
      });
      continue;
    }

    const maxFreeLines =
      maxLines > 0
        ? Math.max(getMaxFreeLines(), Math.ceil(maxLines * getMaxFreeLinesRatio()))
        : getMaxFreeLines();
    try {
      const g = window as any;
      if (!g.__leditorPhase2UnderfillDebug) {
        g.__leditorPhase2UnderfillDebug = {
          pageIndex: i,
          remainingLines,
          maxFreeLines,
          nextUsedLines,
          effectiveNextUsedLines,
          nextBlocks: nextBlocks.length
        };
      }
    } catch {
      // ignore
    }
    const overrideKeep = remainingLines >= maxFreeLines + 1;
    const maxParagraphSplitFreeLines = getMaxParagraphSplitFreeLines();
    const isLastPage = i + 1 === pages.length - 1;
    let allowLineSplit = maxParagraphSplitFreeLines >= 0;
    if (isLastPage) allowLineSplit = false;
    const joinPos = pages[i].pos + pages[i].node.nodeSize;
    const fullJoinPossible =
      remainingLines >= effectiveNextUsedLines + 1 &&
      canJoin(view.state.doc, joinPos) &&
      !hasManualBreakBoundary(view.state.doc, pageType, joinPos);
    if (fullJoinPossible) {
      const tr = view.state.tr.join(joinPos);
      tr.setMeta(paginationKey, { source: "pagination", op: "join", pos: joinPos, reason: "underfill-full" });
      const score = remainingLines + effectiveNextUsedLines + maxFreeLines;
      if (!best || score > best.score) {
        best = { tr, score, pageIndex: i };
      }
      continue;
    }
    if (remainingLines < maxFreeLines) {
      recordTrace("phase2:underfill-skip", {
        pageIndex: i,
        remainingLines,
        maxFreeLines
      });
      try {
        const g = window as any;
        if (!g.__leditorPhase2UnderfillDebug) {
          g.__leditorPhase2UnderfillDebug = {
            pageIndex: i,
            remainingLines,
            maxFreeLines,
            reason: "belowThreshold"
          };
        }
      } catch {
        // ignore
      }
      continue;
    }
    recordTrace("phase2:underfill-candidate", {
      pageIndex: i,
      remainingLines,
      maxFreeLines,
      nextUsedLines
    });

    const blocks = nextBlocks;
    if (blocks.length === 0) {
      recordFail({ pageIndex: i, reason: "noBlocks", remainingLines, maxFreeLines, nextUsedLines });
      try {
        const g = window as any;
        if (!g.__leditorPhase2UnderfillDebug) {
          g.__leditorPhase2UnderfillDebug = {
            pageIndex: i,
            remainingLines,
            maxFreeLines,
            nextUsedLines,
            reason: "noBlocks"
          };
        }
      } catch {
        // ignore
      }
      continue;
    }

    const minTailLinesRatio = isLastPage ? 0.55 : 0.3;
    const minTailLines = Math.max(4, Math.ceil(nextMaxLines * minTailLinesRatio));
    const maxPullLinesByRatio = Math.max(0, Math.floor(effectiveNextUsedLines * (isLastPage ? 0.4 : 0.7)));
    const maxPullLines = Math.max(
      0,
      Math.min(remainingLines - 1, effectiveNextUsedLines - minTailLines, maxPullLinesByRatio)
    );
    if (maxPullLines <= 0) {
      recordFail({
        pageIndex: i,
        reason: "maxPullLines",
        remainingLines,
        maxFreeLines,
        nextUsedLines,
        maxPullLines
      });
      try {
        const g = window as any;
        if (!g.__leditorPhase2UnderfillDebug) {
          g.__leditorPhase2UnderfillDebug = {
            pageIndex: i,
            remainingLines,
            maxFreeLines,
            nextUsedLines,
            maxPullLines,
            reason: "maxPullLines"
          };
        }
      } catch {
        // ignore
      }
      continue;
    }
    const desiredPullLines = Math.max(2, remainingLines - maxFreeLines + 2);
    const targetPullLines = Math.min(maxPullLines, desiredPullLines);
    if (targetPullLines <= 0) {
      recordFail({
        pageIndex: i,
        reason: "targetPullLines",
        remainingLines,
        maxFreeLines,
        nextUsedLines,
        maxPullLines,
        targetPullLines
      });
      continue;
    }
    const targetPullPx = targetPullLines * lineHeightPx;
    const maxPullPx = maxPullLines * lineHeightPx;
    let usedPx = 0;
    let usedMaxPx = 0;
    let lastFit: HTMLElement | null = null;
    let lastFitMax: HTMLElement | null = null;
    let nextBlock: HTMLElement | null = null;
    for (const block of blocks) {
      const heightPx = measureBlockHeightPx(block, nextContent, nextScale);
      if (usedPx + heightPx <= targetPullPx) {
        usedPx += heightPx;
        lastFit = block;
      } else if (!nextBlock) {
        nextBlock = block;
      }
      if (usedMaxPx + heightPx <= maxPullPx) {
        usedMaxPx += heightPx;
        lastFitMax = block;
      } else if (nextBlock) {
        break;
      }
    }
    if (!lastFitMax) {
      allowLineSplit = true;
    }
    const headingKeep = policy.numeric.headingKeepWithNext === true;
    const headingMinLines = Math.max(1, Math.floor(policy.numeric.headingMinNextLines ?? 1));
    let splitPos: number | null = null;
    const firstBlock = blocks[0] ?? null;
    const secondBlock = blocks[1] ?? null;
    const firstIsHeading =
      firstBlock && /^H[1-6]$/.test(firstBlock.tagName.toUpperCase());
    if (!splitPos && firstIsHeading && headingKeep && secondBlock) {
      const headingHeight = measureBlockHeightPx(firstBlock, nextContent, nextScale);
      const remainingForSecond = targetPullPx - headingHeight;
      if (remainingForSecond >= Math.max(lineHeightPx * 0.6, headingMinLines * lineHeightPx)) {
        if (measureBlockHeightPx(secondBlock, nextContent, nextScale) <= remainingForSecond) {
          splitPos = resolveAfterBlock(view, pageType, secondBlock);
        } else if (isLineSplitTag(secondBlock.tagName.toUpperCase())) {
          splitPos = findLineSplitPosForRemaining(view, nextContent, secondBlock, remainingForSecond);
        }
      }
    }
    if (allowLineSplit && nextBlock && isLineSplitTag(nextBlock.tagName.toUpperCase())) {
      const minNextPx = headingMinLines * lineHeightPx;
      const remainingPx = targetPullPx;
      if (remainingPx >= Math.max(lineHeightPx * 0.6, minNextPx)) {
        splitPos = findLineSplitPosForRemaining(view, nextContent, nextBlock, targetPullPx);
      }
    }
    const fallbackFit = lastFit ?? lastFitMax;
    if (!splitPos && fallbackFit) {
      const lastTag = fallbackFit.tagName.toUpperCase();
      const lastIsHeading = /^H[1-6]$/.test(lastTag);
      if (lastIsHeading && headingKeep && !overrideKeep) {
        recordFail({
          pageIndex: i,
          reason: "headingKeep",
          remainingLines,
          maxFreeLines,
          nextUsedLines,
          maxPullLines,
          targetPullLines
        });
        continue;
      }
      splitPos = resolveAfterBlock(view, pageType, fallbackFit);
    } else if (!splitPos && allowLineSplit) {
      const first = blocks[0];
      if (first && isLineSplitTag(first.tagName.toUpperCase())) {
        splitPos = findLineSplitPosForRemaining(view, nextContent, first, targetPullPx);
      }
    }
    if (!splitPos || splitPos <= 0) {
      recordFail({
        pageIndex: i,
        reason: "splitPos",
        remainingLines,
        maxFreeLines,
        nextUsedLines,
        maxPullLines,
        targetPullLines
      });
      try {
        const g = window as any;
        if (!g.__leditorPhase2UnderfillDebug) {
          g.__leditorPhase2UnderfillDebug = {
            pageIndex: i,
            remainingLines,
            maxFreeLines,
            nextUsedLines,
            maxPullLines,
            splitPos: null
          };
        }
      } catch {
        // ignore
      }
      continue;
    }

    if (!canJoin(view.state.doc, joinPos)) {
      recordFail({
        pageIndex: i,
        reason: "canJoin",
        remainingLines,
        maxFreeLines,
        nextUsedLines,
        maxPullLines,
        joinPos
      });
      try {
        const g = window as any;
        if (!g.__leditorPhase2UnderfillDebug) {
          g.__leditorPhase2UnderfillDebug = {
            pageIndex: i,
            remainingLines,
            maxFreeLines,
            nextUsedLines,
            maxPullLines,
            splitPos,
            canJoin: false
          };
        }
      } catch {
        // ignore
      }
      continue;
    }
    let tr = view.state.tr.join(joinPos);
    let mappedSplit = tr.mapping.map(splitPos, -1);
    const mappedResolved = tr.doc.resolve(mappedSplit);
    const pageDepth = findPageDepth(mappedResolved, pageType);
    if (pageDepth < 0) continue;
    const blockDepth = Math.min(mappedResolved.depth, pageDepth + 1);
    const paragraphDepth = Math.max(1, blockDepth - pageDepth);
    if (canSplit(tr.doc, mappedSplit, paragraphDepth)) {
      tr = tr.split(mappedSplit, paragraphDepth);
      mappedSplit = tr.mapping.map(mappedSplit, 1);
    }
    const typesAfter = [{ type: pageType }];
    const pageSplitPos = resolvePageSplitPos(tr.doc, mappedSplit, typesAfter);
    if (!pageSplitPos) {
      const deepSplit = attemptDeepPageSplit(tr, mappedSplit, pageType);
      if (!deepSplit) {
        recordFail({
          pageIndex: i,
          reason: "pageSplitPos",
          remainingLines,
          maxFreeLines,
          nextUsedLines,
          maxPullLines,
          splitPos
        });
        try {
          const g = window as any;
          if (!g.__leditorPhase2UnderfillDebug) {
            g.__leditorPhase2UnderfillDebug = {
              pageIndex: i,
              remainingLines,
              maxFreeLines,
              nextUsedLines,
              maxPullLines,
              splitPos,
              canJoin: true,
              canSplitPage: false
            };
          }
        } catch {
          // ignore
        }
        continue;
      }
      tr = deepSplit;
      tr.setMeta(paginationKey, { source: "pagination", op: "pullup", pos: mappedSplit, reason: "underfill" });
      try {
        const g = window as any;
        if (!g.__leditorPhase2UnderfillDebug) {
          g.__leditorPhase2UnderfillDebug = {
            pageIndex: i,
            remainingLines,
            maxFreeLines,
            nextUsedLines,
            maxPullLines,
            splitPos,
            canJoin: true,
            canSplitPage: true,
            pulled: true
          };
        }
      } catch {
        // ignore
      }
      const score = remainingLines - maxFreeLines;
      if (!best || score > best.score) {
        best = { tr, score, pageIndex: i };
      }
      continue;
    }
    tr = tr.split(pageSplitPos, 1, typesAfter as any);
    tr.setMeta(paginationKey, { source: "pagination", op: "pullup", pos: pageSplitPos, reason: "underfill" });
    try {
      const g = window as any;
      if (!g.__leditorPhase2UnderfillDebug) {
        g.__leditorPhase2UnderfillDebug = {
          pageIndex: i,
          remainingLines,
          maxFreeLines,
          nextUsedLines,
          maxPullLines,
          splitPos,
          canJoin: true,
          canSplitPage: true,
          pulled: true
        };
      }
    } catch {
      // ignore
    }
    const score = remainingLines - maxFreeLines;
    if (!best || score > best.score) {
      best = { tr, score, pageIndex: i };
    }
  }
  if (best) {
    scheduleUnderfillFollowup(view);
    try {
      (window as any).__leditorPhase2UnderfillCursor = best.pageIndex;
    } catch {
      // ignore
    }
    return best.tr;
  }
  return null;
};
