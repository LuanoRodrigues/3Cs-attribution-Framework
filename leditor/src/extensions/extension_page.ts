import { Extension, Node, mergeAttributes } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
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
  console.info(`[PaginationDebug] ${label}`, {
    domPageCount: domPages.length,
    docPageCount: view.state.doc.childCount,
    overlayPageCount: overlays.length,
    pageContentHeight: domPages[0]?.querySelector(`.${PAGE_CONTENT_CLASS}`)?.clientHeight ?? null,
    editorScrollHeight: view.dom.scrollHeight
  });
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

const shouldSplitAfter = (el: HTMLElement): boolean => {
  if (el.classList.contains("leditor-break")) {
    const kind = el.dataset.breakKind;
    return kind === "page" || kind === "section";
  }
  return false;
};

// Require extra slack before joining to avoid split/join oscillation at boundaries.
const DEFAULT_JOIN_BUFFER_PX = 12;
const DELETE_JOIN_BUFFER_PX = 0;

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

const findSplitTarget = (content: HTMLElement, tolerance = 1): { target: HTMLElement; after: boolean } | null => {
  const contentHeight = content.clientHeight;
  if (contentHeight <= 0) {
    logDebug("page content height is non-positive", { contentHeight });
    return null;
  }
  const children = Array.from(content.children).filter(
    (node): node is HTMLElement => node instanceof HTMLElement
  );
  let lastBottom = 0;
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (shouldSplitAfter(child)) {
      logDebug("manual break forces split", { tag: child.tagName, index: i });
      return { target: child, after: true };
    }
    const marginBottom = parseFloat(getComputedStyle(child).marginBottom || "0") || 0;
    const bottom = child.offsetTop + child.offsetHeight + marginBottom;
    lastBottom = Math.max(lastBottom, bottom);
    if (bottom > contentHeight + tolerance) {
      if (i === 0) {
        logDebug("overflow on first block; skipping split", {
          tag: child.tagName,
          bottom,
          contentHeight,
          tolerance
        });
        return null;
      }
      logDebug("overflow split target", {
        tag: child.tagName,
        index: i,
        bottom,
        contentHeight
      });
      return { target: child, after: false };
    }
  }
  if (debugEnabled()) {
    logDebug("no split target", {
      contentHeight,
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
    const lastMarginBottom = last ? parseFloat(getComputedStyle(last).marginBottom || "0") || 0 : 0;
    const used = last ? last.offsetTop + last.offsetHeight + lastMarginBottom : 0;
    const remaining = content.clientHeight - used;
    const nextMarginTop = parseFloat(getComputedStyle(nextFirst).marginTop || "0") || 0;
    const nextHeight = nextMarginTop + nextFirst.offsetHeight;
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

const paginateView = (
  view: any,
  runningRef: { value: boolean },
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
      if (pageDepth < 0) continue;
      const childDepth = pageDepth + 1;
      if (resolved.depth < childDepth) continue;
      let splitPos = split.after ? resolved.after(childDepth) : resolved.before(childDepth);
      if (splitPos <= 0) continue;
      const splitResolved = view.state.doc.resolve(splitPos);
      if (splitResolved.depth !== pageDepth) {
        logDebug("split position not at page boundary", {
          splitPos,
          depth: splitResolved.depth,
          pageDepth
        });
        continue;
      }
      const depth = 1;
      if (depth <= 0) continue;
      const from = view.state.selection.from;
      logDebug("splitting page", { splitPos, depth, selectionFrom: from });
      const tr = view.state.tr.split(splitPos, depth, [{ type: pageType }]);
      if (from >= splitPos) {
        const mapped = tr.mapping.map(from);
        logDebug("moving selection after split", { from, mapped });
        tr.setSelection(TextSelection.create(tr.doc, mapped));
      }
      view.dispatch(tr);
      return;
    }
    const joinBufferPx = options?.preferJoin ? DELETE_JOIN_BUFFER_PX : DEFAULT_JOIN_BUFFER_PX;
    const joinPos = findJoinBoundary(view, pageType, 1, joinBufferPx);
    if (joinPos !== null) {
      logDebug("joining pages", { joinPos });
      const tr = view.state.tr.join(joinPos);
      view.dispatch(tr);
      return;
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
    return [
      new Plugin({
        key: paginationKey,
        appendTransaction(transactions, _oldState, newState) {
          lastMutationWasDelete = transactions.some((tr) => isDeleteTransaction(tr));
          return wrapDocInPage(newState);
        },
        view(editorView) {
          console.info("[PaginationDebug] PagePagination initialized");
          const running = { value: false };
          const scheduler = new PaginationScheduler({
            root: editorView.dom as HTMLElement,
            onRun: () => {
              logPaginationStats(editorView, "scheduler run");
              paginateView(editorView, running, { preferJoin: lastMutationWasDelete });
              lastMutationWasDelete = false;
            }
          });
          logPaginationStats(editorView, "scheduler mounted");
          scheduler.request();
          return {
            update(view, prevState) {
              if (view.state.doc.eq(prevState.doc)) return;
              logPaginationStats(view, "scheduler queue");
              scheduler.request();
            },
            destroy() {
              scheduler.dispose();
            }
          };
        }
      })
    ];
  }
});
