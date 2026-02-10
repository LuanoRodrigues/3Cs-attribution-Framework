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

const getPageContent = (view: EditorView, index: number): HTMLElement | null => {
  const pages = Array.from(view.dom.querySelectorAll<HTMLElement>(".leditor-page"));
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
      const nextPos = start + after.offset;
      if (nextPos > blockStart + 1 && nextPos < blockEnd - 1) return nextPos;
    }
    if (before?.node && hasAnchor(before.node)) {
      const prevPos = start + before.offset;
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
  const maxBottomAbs = contentRect.top + remainingPx * scale;
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
    if (canSplit(doc, candidate, 1, typesAfter as any)) return candidate;
  }
  return null;
};

const attemptDeepPageSplit = (tr: Transaction, pos: number, pageType: any): Transaction | null => {
  try {
    const resolved = tr.doc.resolve(pos);
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
    if (canSplit(tr.doc, pos, depth, typesAfter as any)) {
      return tr.split(pos, depth, typesAfter as any);
    }
    if (canSplit(tr.doc, pos, depth)) {
      return tr.split(pos, depth);
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
  for (let i = 0; i < pages.length - 1; i += 1) {
    const currentContent = getPageContent(view, i);
    const nextContent = getPageContent(view, i + 1);
    if (!currentContent || !nextContent) continue;
    const currentScale = getContentScale(currentContent);
    const nextScale = getContentScale(nextContent);
    const currentBlocks = collectBlocks(currentContent, policy.selectors.pageable);
    const currentStyle = getComputedStyle(currentContent);
    const lineHeightRaw = Number.parseFloat(currentStyle.lineHeight || "0");
    const lineHeightPx =
      Number.isFinite(lineHeightRaw) && lineHeightRaw > 0 ? lineHeightRaw : 16;
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
    const nextLineHeightPx =
      Number.isFinite(nextLineHeightRaw) && nextLineHeightRaw > 0 ? nextLineHeightRaw : lineHeightPx || 16;
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
    if (nextUsedLines <= 0) continue;

    const maxFreeLines =
      maxLines > 0
        ? Math.max(getMaxFreeLines(), Math.ceil(maxLines * getMaxFreeLinesRatio()))
        : getMaxFreeLines();
    if (remainingLines <= maxFreeLines) {
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

    const minTailLinesRatio = 0.4;
    const minTailLines = Math.max(4, Math.ceil(nextMaxLines * minTailLinesRatio));
    const maxPullLinesByRatio = Math.max(0, Math.floor(nextUsedLines * 0.6));
    const maxPullLines = Math.max(
      0,
      Math.min(remainingLines - 1, nextUsedLines - minTailLines, maxPullLinesByRatio)
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
    const desiredPullLines = Math.max(1, remainingLines - maxFreeLines);
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
    let usedPx = 0;
    let lastFit: HTMLElement | null = null;
    let nextBlock: HTMLElement | null = null;
    for (const block of blocks) {
      const heightPx = measureBlockHeightPx(block, nextContent, nextScale);
      if (usedPx + heightPx <= targetPullPx) {
        usedPx += heightPx;
        lastFit = block;
        continue;
      }
      nextBlock = block;
      break;
    }
    const headingKeep = policy.numeric.headingKeepWithNext === true;
    const headingMinLines = Math.max(1, Math.floor(policy.numeric.headingMinNextLines ?? 1));
    let splitPos: number | null = null;
    if (nextBlock && isLineSplitTag(nextBlock.tagName.toUpperCase())) {
      const minNextPx = headingMinLines * lineHeightPx;
      const remainingPx = targetPullPx;
      if (remainingPx >= Math.max(lineHeightPx * 0.6, minNextPx)) {
        splitPos = findLineSplitPosForRemaining(view, nextContent, nextBlock, targetPullPx);
      }
    }
    if (!splitPos && lastFit) {
      const lastTag = lastFit.tagName.toUpperCase();
      const lastIsHeading = /^H[1-6]$/.test(lastTag);
      if (lastIsHeading && headingKeep) {
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
      splitPos = resolveAfterBlock(view, pageType, lastFit);
    } else if (!splitPos) {
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

    const joinPos = pages[i].pos + pages[i].node.nodeSize;
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
      scheduleUnderfillFollowup(view);
      return tr;
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
    scheduleUnderfillFollowup(view);
    return tr;
  }
  return null;
};
