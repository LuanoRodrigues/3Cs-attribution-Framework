import type { EditorView } from "@tiptap/pm/view";
import type { PluginKey, Transaction } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import type { PaginationSnapshot } from "./snapshot.ts";
import type { PaginationPolicy } from "./policy.ts";
import { findSplitTarget } from "./split_target.ts";

const findPageDepth = (resolved: any, pageType: any): number => {
  for (let depth = resolved.depth; depth >= 0; depth -= 1) {
    if (resolved.node(depth).type === pageType) return depth;
  }
  return -1;
};

export const phase1Overflow = (
  view: EditorView,
  paginationKey: PluginKey,
  snapshot: PaginationSnapshot,
  policy: PaginationPolicy
): Transaction | null => {
  const pageType = view.state.schema.nodes.page;
  if (!pageType) return null;
  const pageContents = Array.from(view.dom.querySelectorAll<HTMLElement>(".leditor-page-content"));
  const overflowPage = snapshot.pageChromeByIndex.find((page) => page.overflowLines > 0);
  if (!overflowPage) return null;
  const content = pageContents[overflowPage.pageIndex] ?? null;
  if (!content) return null;
  const clientWidth = content.clientWidth || 0;
  const scrollWidth = content.scrollWidth || 0;
  if (clientWidth > 0 && scrollWidth > clientWidth * 1.25) {
    const selector = policy.selectors.pageable.length ? policy.selectors.pageable.join(",") : "*";
    const blocks = Array.from(content.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => el.closest(".leditor-page-content") === content
    );
    const contentRect = content.getBoundingClientRect();
    const scrollLeft = content.scrollLeft || 0;
    let currentColumn = 0;
    const splitIndices: number[] = [];
    blocks.forEach((block, index) => {
      const rect = block.getBoundingClientRect();
      const left = rect.left - contentRect.left + scrollLeft;
      const columnIndex = clientWidth > 0 ? Math.floor(left / clientWidth + 0.1) : 0;
      if (columnIndex > currentColumn) {
        splitIndices.push(index);
        currentColumn = columnIndex;
      }
    });
    const columns = Math.min(16, Math.max(2, Math.ceil(scrollWidth / clientWidth)));
    const plannedSplits = splitIndices.length > 0
      ? splitIndices
      : Array.from({ length: columns - 1 }, (_v, i) =>
          Math.min(blocks.length - 1, (i + 1) * Math.ceil(blocks.length / columns))
        );
    if (blocks.length >= 2 && plannedSplits.length > 0) {
      let tr = view.state.tr;
      const depth = 1;
      const typesAfter = [{ type: pageType }];
      for (const index of plannedSplits) {
        if (index <= 0) continue;
        const pos = view.posAtDOM(blocks[index], 0);
        if (!Number.isFinite(pos) || pos <= 0) continue;
        const mappedPos = tr.mapping.map(pos);
        let resolved = tr.doc.resolve(mappedPos);
        const pageDepth = findPageDepth(resolved, pageType);
        if (pageDepth < 0) continue;
        const blockDepth = Math.min(resolved.depth, pageDepth + 1);
        if (resolved.depth >= blockDepth) {
          try {
            const pageStart = resolved.start(pageDepth);
            const pageEnd = resolved.end(pageDepth);
            const blockStart = resolved.before(blockDepth);
            const blockEnd = resolved.after(blockDepth);
            let adjustedPos = mappedPos;
            if (blockStart > pageStart + 1) {
              adjustedPos = blockStart;
            } else if (blockEnd < pageEnd - 1) {
              adjustedPos = blockEnd;
            }
            resolved = tr.doc.resolve(adjustedPos);
            if (!canSplit(tr.doc, adjustedPos, depth, typesAfter as any)) continue;
            tr = tr.split(adjustedPos, depth, typesAfter as any);
          } catch {
            // ignore bad split positions
          }
        }
      }
      if (tr.steps.length > 0) {
        tr.setMeta(paginationKey, { source: "pagination", op: "split", pos: tr.steps.length });
        try {
          (window as any).__leditorPaginationOverflowAt = performance.now();
        } catch {
          // ignore
        }
        return tr;
      }
    }
  }
  const target = findSplitTarget(view, content, snapshot, policy);
  if (!target) return null;
  // Delegate line-splittable blocks to the legacy splitter (handles inline line splits).
  const tag = target.target?.tagName?.toUpperCase?.() ?? "";
  if (tag === "P" || tag === "LI" || tag === "BLOCKQUOTE" || tag === "PRE") {
    return null;
  }
  let splitPos = target.pos;
  if (!Number.isFinite(splitPos) || splitPos <= 0) return null;
  let resolved = view.state.doc.resolve(splitPos);
  const pageDepth = findPageDepth(resolved, pageType);
  if (pageDepth < 0) return null;
  const blockDepth = Math.min(resolved.depth, pageDepth + 1);
  if (!target.preferSplitBefore && resolved.depth >= blockDepth) {
    try {
      const pageStart = resolved.start(pageDepth);
      const pageEnd = resolved.end(pageDepth);
      const blockStart = resolved.before(blockDepth);
      const blockEnd = resolved.after(blockDepth);
      if (blockStart > pageStart + 1) {
        splitPos = blockStart;
      } else if (blockEnd < pageEnd - 1) {
        splitPos = blockEnd;
      }
      resolved = view.state.doc.resolve(splitPos);
    } catch {
      // ignore and fall back to original splitPos
    }
  }
  const depth = 1;
  const typesAfter = [{ type: pageType }];
  if (!canSplit(view.state.doc, splitPos, depth, typesAfter as any)) {
    return null;
  }
  const tr = view.state.tr.split(splitPos, depth, typesAfter as any);
  tr.setMeta(paginationKey, { source: "pagination", op: "split", pos: splitPos });
  try {
    (window as any).__leditorPaginationOverflowAt = performance.now();
  } catch {
    // ignore
  }
  return tr;
};
