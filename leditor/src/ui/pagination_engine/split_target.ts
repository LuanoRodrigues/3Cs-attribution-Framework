import type { EditorView } from "@tiptap/pm/view";
import type { PaginationPolicy } from "./policy.ts";
import type { PaginationSnapshot } from "./snapshot.ts";

export type SplitTarget = {
  pos: number;
  reason: "overflow";
  target: HTMLElement;
  preferSplitBefore?: boolean;
};

const getRelativeBox = (
  element: HTMLElement,
  content: HTMLElement
): { top: number; bottom: number; left: number } => {
  const contentRect = content.getBoundingClientRect();
  const scrollLeft = content.scrollLeft || 0;
  const scrollTop = content.scrollTop || 0;
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top - contentRect.top + scrollTop,
    bottom: rect.bottom - contentRect.top + scrollTop,
    left: rect.left - contentRect.left + scrollLeft
  };
};

const collectBlocks = (content: HTMLElement, selectors: string[]): HTMLElement[] => {
  const selector = selectors.length ? selectors.join(",") : "*";
  const all = Array.from(content.querySelectorAll<HTMLElement>(selector));
  return all.filter((el) => el.closest(".leditor-page-content") === content);
};

const matchesAny = (el: HTMLElement, selectors: string[]): boolean =>
  selectors.some((sel) => {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  });

export const findSplitTarget = (
  view: EditorView,
  content: HTMLElement,
  snapshot: PaginationSnapshot,
  policy: PaginationPolicy
): SplitTarget | null => {
  const blocks = collectBlocks(content, policy.selectors.pageable);
  if (blocks.length === 0) return null;
  const contentHeight = Math.max(0, content.clientHeight);
  const paddingBottom = Number.parseFloat(getComputedStyle(content).paddingBottom || "0") || 0;
  const bottomLimit = Math.max(0, contentHeight - paddingBottom);
  const contentWidth = Math.max(0, content.clientWidth);
  let candidate: HTMLElement | null = null;
  let preferSplitBefore = false;
  if (contentWidth > 0) {
    for (let i = 0; i < blocks.length; i += 1) {
      const block = blocks[i];
      const box = getRelativeBox(block, content);
      if (box.left > contentWidth * 0.55) {
        candidate = i > 0 ? blocks[i - 1] : block;
        preferSplitBefore = i === 0;
        break;
      }
    }
  }
  if (!candidate) {
    for (const block of blocks) {
      const box = getRelativeBox(block, content);
      if (box.top < bottomLimit && box.bottom > bottomLimit) {
        candidate = block;
      }
    }
  }
  if (!candidate) {
    candidate = blocks[blocks.length - 1] ?? null;
  }
  if (!candidate) return null;
  if (matchesAny(candidate, policy.selectors.headings)) {
    const idx = blocks.indexOf(candidate);
    if (idx > 0) {
      candidate = blocks[idx - 1];
    }
  }
  if (matchesAny(candidate, policy.selectors.atomic)) {
    // Split before atomic block by targeting it directly.
  }
  const pos = view.posAtDOM(candidate, 0);
  if (!Number.isFinite(pos) || pos <= 0) return null;
  return {
    pos,
    reason: "overflow",
    target: candidate,
    preferSplitBefore
  };
};
