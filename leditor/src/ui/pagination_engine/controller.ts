import type { EditorView } from "@tiptap/pm/view";
import type { PluginKey, Transaction } from "@tiptap/pm/state";
import { buildPaginationSnapshot } from "./snapshot.ts";
import { getPaginationPolicy } from "./policy.ts";
import { phase1Overflow } from "./phase1_overflow.ts";
import { phase2Underfill } from "./phase2_underfill.ts";

export type PaginationPhase = "phase1" | "phase2";

export type PaginationAction = "split" | "pullup" | "join" | null;

type PaginationMemoLike = {
  lastSplitAt?: number | null;
  lastJoinAt?: number | null;
};

const setDebugState = (payload: {
  snapshotSig: string;
  phase: PaginationPhase;
  action: PaginationAction;
  overflowPages: number[];
  stable: boolean;
}) => {
  try {
    (window as any).__leditorPaginationLastSnapshotSig = payload.snapshotSig;
    (window as any).__leditorPaginationLastPhase = payload.phase;
    (window as any).__leditorPaginationLastAction = payload.action;
    (window as any).__leditorPaginationLastOverflowPages = payload.overflowPages;
    (window as any).__leditorPaginationLastStable = payload.stable;
  } catch {
    // ignore
  }
};

export const runPaginationEngine = (
  view: EditorView,
  memo: PaginationMemoLike,
  _options: { preferJoin?: boolean; preferFill?: boolean } | undefined,
  paginationKey: PluginKey
): Transaction | null => {
  const applyColumnClamp = (target: HTMLElement, widthPx?: number) => {
    target.style.setProperty("columns", "auto", "important");
    target.style.setProperty("column-count", "auto", "important");
    target.style.setProperty("column-gap", "0px", "important");
    target.style.setProperty("column-width", "auto", "important");
    target.style.setProperty("column-fill", "auto", "important");
    target.style.setProperty("-webkit-columns", "auto", "important");
    target.style.setProperty("-webkit-column-count", "auto", "important");
    target.style.setProperty("-webkit-column-gap", "0px", "important");
    target.style.setProperty("-webkit-column-width", "auto", "important");
    target.style.setProperty("-webkit-column-fill", "auto", "important");
    target.style.setProperty("max-width", "100%", "important");
    target.style.setProperty("min-width", "0", "important");
    target.style.setProperty("overflow-x", "hidden", "important");
    if (Number.isFinite(widthPx) && widthPx && widthPx > 0) {
      const width = `${widthPx}px`;
      target.style.setProperty("width", width, "important");
      target.style.setProperty("max-width", width, "important");
    }
  };

  const enforceSingleColumn = () => {
    const root = view.dom as HTMLElement;
    applyColumnClamp(root);
    if (root.parentElement) {
      applyColumnClamp(root.parentElement);
    }
    const contents = Array.from(view.dom.querySelectorAll<HTMLElement>(".leditor-page-content"));
    const handled = new Set<HTMLElement>();
    contents.forEach((content) => {
      const inner =
        (content.children.length === 1 && content.children[0] instanceof HTMLElement
          ? (content.children[0] as HTMLElement)
          : content.querySelector<HTMLElement>(":scope > .ProseMirror")) ?? null;
      const page = content.closest<HTMLElement>(".leditor-page");
      const pageInner = content.closest<HTMLElement>(".leditor-page-inner");
      const clientWidth = content.clientWidth;
      const scrollWidth = content.scrollWidth;
      const overflow = clientWidth > 0 ? scrollWidth - clientWidth > 2 : false;
      if (content.scrollLeft) {
        content.scrollLeft = 0;
      }
      if (page && !handled.has(page)) {
        handled.add(page);
        applyColumnClamp(page);
      }
      if (pageInner && !handled.has(pageInner)) {
        handled.add(pageInner);
        applyColumnClamp(pageInner);
      }
      if (!overflow) return;
      content.style.setProperty("white-space", "normal", "important");
      content.style.setProperty("overflow-wrap", "normal", "important");
      content.style.setProperty("word-break", "normal", "important");
      applyColumnClamp(content, clientWidth);
      if (inner) {
        applyColumnClamp(inner, clientWidth);
        inner.style.setProperty("white-space", "normal", "important");
        inner.style.setProperty("overflow-wrap", "normal", "important");
        inner.style.setProperty("word-break", "normal", "important");
      }
      try {
        const wrapNodes = Array.from(content.querySelectorAll<HTMLElement>("p, li, blockquote"));
        wrapNodes.forEach((node) => {
          node.style.setProperty("white-space", "normal", "important");
          node.style.setProperty("overflow-wrap", "normal", "important");
          node.style.setProperty("word-break", "normal", "important");
          node.style.setProperty("max-width", "100%", "important");
        });
      } catch {
        // ignore
      }
    });
  };
  enforceSingleColumn();
  const snapshotRoot =
    (view.dom as HTMLElement)?.closest?.(".leditor-page-stack") ??
    (document.querySelector<HTMLElement>(".leditor-page-stack") ?? document.documentElement);
  const snapshot = buildPaginationSnapshot({
    root: snapshotRoot,
    recentSplitAt: memo.lastSplitAt ?? null
  });
  const overflowPages = snapshot.pageChromeByIndex
    .filter((page) => page.overflowLines > 0 || page.horizontalOverflow)
    .map((page) => page.pageIndex);
  const stable = !(snapshot.fontsLoading || snapshot.recentOverflow || snapshot.recentFootnoteChange || snapshot.recentSplit);
  if (overflowPages.length > 0) {
    const tr = phase1Overflow(view, paginationKey, snapshot, getPaginationPolicy());
    setDebugState({
      snapshotSig: snapshot.hash,
      phase: "phase1",
      action: tr ? "split" : null,
      overflowPages,
      stable
    });
    return tr;
  }
  const tr = phase2Underfill(view, paginationKey, snapshot, getPaginationPolicy());
  setDebugState({
    snapshotSig: snapshot.hash,
    phase: "phase2",
    action: tr ? (tr.getMeta(paginationKey)?.op ?? null) : null,
    overflowPages,
    stable
  });
  return tr;
};

export const noteFootnoteLayoutChanged = () => {
  try {
    const g = window as any;
    g.__leditorFootnoteLayoutChangedAt = performance.now();
    g.__leditorFootnoteLayoutEpoch = (g.__leditorFootnoteLayoutEpoch ?? 0) + 1;
  } catch {
    // ignore
  }
};
