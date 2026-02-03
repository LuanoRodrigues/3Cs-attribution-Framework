import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { canJoin, canSplit } from "@tiptap/pm/transform";
import { PaginationScheduler } from "../ui/pagination/scheduler.ts";

const PAGE_CLASS = "leditor-page";
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
    console.info(`[PaginationDebug] ${message}`, detail);
    return;
  }
  console.info(`[PaginationDebug] ${message}`);
};

const logPaginationStats = (view: any, label: string) => {
  if (!debugEnabled()) return;
  const domPages = Array.from(view.dom.querySelectorAll(`.${PAGE_CLASS}`)).filter(
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

const getContentMetrics = (content: HTMLElement): { usableHeight: number; paddingBottom: number } => {
  const paddingBottom = getNumericStyle(content, "padding-bottom");
  const usableHeight = Math.max(0, content.clientHeight - paddingBottom);
  return { usableHeight, paddingBottom };
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
    const kind = el.dataset.breakKind;
    return kind === "page" || kind === "section";
  }
  return false;
};

const isHeadingElement = (el: HTMLElement): boolean => {
  const tag = el.tagName.toUpperCase();
  if (tag.length === 2 && tag.startsWith("H")) {
    const level = Number(tag.slice(1));
    return Number.isFinite(level) && level >= 1 && level <= 6;
  }
  return false;
};

const isSplittableBlock = (el: HTMLElement): boolean => {
  const tag = el.tagName.toUpperCase();
  return tag === "P" || tag === "LI" || tag === "BLOCKQUOTE";
};

// Require extra slack before joining to avoid split/join oscillation at boundaries.
const DEFAULT_JOIN_BUFFER_PX = 12;
const DELETE_JOIN_BUFFER_PX = 0;
const MIN_SECTION_LINES = 1;

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

const findSplitTarget = (
  content: HTMLElement,
  tolerance = 1
): { target: HTMLElement; after: boolean; reason: "keepWithNext" | "overflow" | "manual" } | null => {
  const { usableHeight } = getContentMetrics(content);
  if (usableHeight <= 0) {
    logDebug("page content height is non-positive", { usableHeight });
    return null;
  }
  const contentRect = content.getBoundingClientRect();
  const children = Array.from(content.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  let lastBottom = 0;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (shouldSplitAfter(child)) {
      logDebug("manual break forces split", { tag: child.tagName, index: i });
      return { target: child, after: true, reason: "manual" };
    }
    const marginBottom = parseFloat(getComputedStyle(child).marginBottom || "0") || 0;
    const rect = child.getBoundingClientRect();
    const bottom = rect.bottom - contentRect.top + marginBottom;
    lastBottom = Math.max(lastBottom, bottom);
    if (bottom > usableHeight + tolerance) {
      if (i === 0) {
        logDebug("overflow on first block; skipping split", {
          tag: child.tagName,
          bottom,
          contentHeight: usableHeight,
          tolerance
        });
        return null;
      }
      const prev = children[i - 1] ?? null;
      if (prev && isHeadingElement(prev) && !shouldSplitAfter(prev)) {
        if (isSplittableBlock(child)) {
          const prevRect = prev.getBoundingClientRect();
          const prevMarginBottom = parseFloat(getComputedStyle(prev).marginBottom || "0") || 0;
          const prevBottom = prevRect.bottom - contentRect.top + prevMarginBottom;
          const remainingAfterHeading = usableHeight - prevBottom;
          const childLineHeightRaw = getComputedStyle(child).lineHeight;
          const childLineHeight = Number.parseFloat(childLineHeightRaw || "0");
          const minLinesPx =
            (Number.isFinite(childLineHeight) && childLineHeight > 0 ? childLineHeight : 18) *
            MIN_SECTION_LINES;
          if (remainingAfterHeading >= minLinesPx) {
            logDebug("keep-with-next: allowing split inside paragraph", {
              headingTag: prev.tagName,
              headingIndex: i - 1,
              overflowTag: child.tagName,
              overflowIndex: i,
              remainingAfterHeading,
              minLinesPx
            });
          } else {
            logDebug("keep-with-next: moving heading to next page", {
              headingTag: prev.tagName,
              headingIndex: i - 1,
              overflowTag: child.tagName,
              overflowIndex: i,
              remainingAfterHeading,
              minLinesPx
            });
            return { target: prev, after: false, reason: "keepWithNext" };
          }
        } else {
          logDebug("keep-with-next: moving heading to next page", {
            headingTag: prev.tagName,
            headingIndex: i - 1,
            overflowTag: child.tagName,
            overflowIndex: i
          });
          return { target: prev, after: false, reason: "keepWithNext" };
        }
      }
      logDebug("overflow split target", {
        tag: child.tagName,
        index: i,
        bottom,
        contentHeight: usableHeight
      });
      return { target: child, after: false, reason: "overflow" };
    }
  }
  if (debugEnabled()) {
    logDebug("no split target", {
      contentHeight: usableHeight,
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
  const pages = Array.from(view.dom.querySelectorAll(`.${PAGE_CLASS}`)).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  if (pages.length < 2) return null;
  for (let i = 0; i < pages.length - 1; i += 1) {
    const page = pages[i];
    const nextPage = pages[i + 1];
    const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    const nextContent = nextPage.querySelector(`.${PAGE_CONTENT_CLASS}`) as HTMLElement | null;
    if (!content || !nextContent) continue;
    const nextFirst = nextContent.firstElementChild as HTMLElement | null;
    if (!nextFirst) continue;
    const last = content.lastElementChild as HTMLElement | null;
    if (last && shouldSplitAfter(last)) {
      continue;
    }
    const { usableHeight } = getContentMetrics(content);
    const lastMarginBottom = last ? parseFloat(getComputedStyle(last).marginBottom || "0") || 0 : 0;
    const contentRect = content.getBoundingClientRect();
    const lastRect = last ? last.getBoundingClientRect() : null;
    const used = lastRect ? lastRect.bottom - contentRect.top + lastMarginBottom : 0;
    const remaining = usableHeight - used;
    const nextMarginTop = parseFloat(getComputedStyle(nextFirst).marginTop || "0") || 0;
    const nextMarginBottom = parseFloat(getComputedStyle(nextFirst).marginBottom || "0") || 0;
    let nextHeight = nextMarginTop + nextFirst.offsetHeight + nextMarginBottom;
    if (isHeadingElement(nextFirst)) {
      const nextSecond = nextFirst.nextElementSibling as HTMLElement | null;
      if (nextSecond) {
        const nextSecondMarginTop = parseFloat(getComputedStyle(nextSecond).marginTop || "0") || 0;
        const nextSecondMarginBottom = parseFloat(getComputedStyle(nextSecond).marginBottom || "0") || 0;
        nextHeight += nextSecondMarginTop + nextSecond.offsetHeight + nextSecondMarginBottom;
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
      view.dispatch(trWrap);
      return;
    }
    const pages = Array.from(view.dom.querySelectorAll(`.${PAGE_CLASS}`)).filter(
      (node): node is HTMLElement => node instanceof HTMLElement
    );
    logDebug("page nodes before split", {
      domPageCount: pages.length,
      docPageCount: view.state.doc.childCount,
      overlayPages: view.dom.querySelectorAll(`.${PAGE_INNER_CLASS}`).length
    });
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
      if (split.reason === "overflow" && isSplittableBlock(split.target) && typeof view.posAtCoords === "function") {
        try {
          const contentRect = content.getBoundingClientRect();
          const { usableHeight } = getContentMetrics(content);
          const targetY = contentRect.top + Math.max(0, usableHeight - 2);
          const targetX = contentRect.left + Math.min(24, Math.max(6, contentRect.width * 0.2));
          const coords = view.posAtCoords({ left: targetX, top: targetY });
          if (coords && typeof coords.pos === "number") {
            const coordResolved = view.state.doc.resolve(coords.pos);
            const coordPageDepth = findPageDepth(coordResolved, pageType);
            if (coordPageDepth === pageDepth) {
              const coordChildDepth = coordPageDepth + 1;
              if (coordResolved.depth >= coordChildDepth) {
                const blockStart = coordResolved.start(coordChildDepth);
                const blockEnd = coordResolved.end(coordChildDepth);
                if (coords.pos > blockStart + 1 && coords.pos < blockEnd - 1) {
                  splitPos = coords.pos;
                }
              }
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
      const blockDepth = findBlockDepth(splitResolved, pageDepth);
      if (splitResolved.depth >= blockDepth) {
        try {
          blockNode = splitResolved.node(blockDepth);
          blockStart = splitResolved.start(blockDepth);
          blockEnd = splitResolved.end(blockDepth);
          markPaginationSplit =
            blockNode?.type?.name === "paragraph" &&
            splitPos > blockStart &&
            splitPos < blockEnd;
        } catch {
          // ignore invalid depth calculations; skip pagination split marker
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
      const depth = Math.max(1, blockDepth - pageDepth + 1);
      if (depth <= 0) continue;
      const typesAfter: Array<{ type: any; attrs?: any } | null> = new Array(depth).fill(null);
      typesAfter[0] = { type: pageType };
      if (!canSplit(view.state.doc, splitPos, depth, typesAfter as any)) {
        logDebug("skip split (canSplit=false)", { splitPos, depth, pageDepth });
        continue;
      }
      const from = view.state.selection.from;
      logDebug("splitting page", { splitPos, depth, selectionFrom: from, reason: split.reason });
      let tr: any | null = null;
      try {
        tr = view.state.tr.split(splitPos, depth, typesAfter as any);
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
      memo.lastSplitPos = splitPos;
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
        memo.lockedJoinPos.set(splitPos, {
          docSize,
          at: memo.lastSplitAt,
          reason: split.reason
        });
      }
      if (from >= splitPos) {
        const mapped = tr.mapping.map(from);
        logDebug("moving selection after split", { from, mapped });
        tr.setSelection(TextSelection.create(tr.doc, mapped));
      }
      view.dispatch(tr);
      return;
    }
    const skipJoin = document.documentElement.classList.contains("leditor-footnote-editing");
    if (!skipJoin) {
      const now = performance.now();
      // Avoid split/join oscillation right after a split or while footnote layout is still settling.
      const recentSplit = memo.lastSplitAt > 0 && now - memo.lastSplitAt < 450;
      const footnoteChurnAt =
        (window as typeof window & { __leditorFootnoteLayoutChangedAt?: number })
          .__leditorFootnoteLayoutChangedAt ?? 0;
      const recentFootnoteLayout = footnoteChurnAt > 0 && now - footnoteChurnAt < 350;
      if (recentSplit || recentFootnoteLayout) {
        logDebug("skip join (layout settling)", { recentSplit, recentFootnoteLayout });
        return;
      }
      const joinBufferPx = options?.preferJoin ? DELETE_JOIN_BUFFER_PX : DEFAULT_JOIN_BUFFER_PX;
      const joinPos = findJoinBoundary(view, pageType, 1, joinBufferPx);
      if (joinPos !== null) {
        const lockPosCandidates = [joinPos, joinPos - 1, joinPos + 1, joinPos - 2, joinPos + 2];
        let lock: { docSize: number; at: number; reason: string } | null = null;
        let lockPos: number | null = null;
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
        const recentlySplitSamePos =
          memo.lastSplitPos !== null &&
          Math.abs(memo.lastSplitPos - joinPos) <= 2 &&
          memo.lastSplitAt > memo.lastExternalChangeAt;
        if (recentlySplitSamePos) {
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
          logDebug("skip join (canJoin=false)", { joinPos });
          return;
        }
        logDebug("joining pages", { joinPos });
        const tr = view.state.tr.join(joinPos);
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
        view.dispatch(tr);
        return;
      }
    }
    const emptyRange = findEmptyPageRange(view.state.doc, pageType);
    if (emptyRange && view.state.doc.childCount > 1) {
      logDebug("dropping empty page", emptyRange);
      const tr = view.state.tr.delete(emptyRange.from, emptyRange.to);
      view.dispatch(tr);
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
  isolating: true,
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
      const _node = props?.node;
      const view = props?.view;
      const getPos = props?.getPos;
      let pageIndex: number | null = null;
      try {
        const pos = typeof getPos === "function" ? getPos() : null;
        if (typeof pos === "number" && view?.state?.doc) {
          const $pos = view.state.doc.resolve(pos);
          pageIndex = $pos.index(0);
        }
      } catch {
        pageIndex = null;
      }
      const page = document.createElement("div");
      page.className = PAGE_CLASS;
      if (pageIndex != null) {
        page.dataset.pageIndex = String(pageIndex);
      }
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
      return { dom: page, contentDOM: content };
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
      lockedJoinPos: new Map(),
      splitIdCounter: 1
    };
    return [
      new Plugin({
        key: paginationKey,
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
