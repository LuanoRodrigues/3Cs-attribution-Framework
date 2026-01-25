"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PagePagination = exports.PageNode = exports.PageDocument = void 0;
const core_1 = require("@tiptap/core");
const extension_document_1 = __importDefault(require("@tiptap/extension-document"));
const state_1 = require("@tiptap/pm/state");
const scheduler_js_1 = require("../ui/pagination/scheduler.js");
const PAGE_CLASS = "leditor-page";
const PAGE_INNER_CLASS = "leditor-page-inner";
const PAGE_HEADER_CLASS = "leditor-page-header";
const PAGE_CONTENT_CLASS = "leditor-page-content";
const PAGE_FOOTER_CLASS = "leditor-page-footer";
const PAGE_FOOTNOTES_CLASS = "leditor-page-footnotes";
const paginationKey = new state_1.PluginKey("leditor-page-pagination");
const debugEnabled = () => {
    if (typeof window === "undefined")
        return false;
    return window.__leditorPaginationDebug === true;
};
const logDebug = (message, detail) => {
    if (!debugEnabled())
        return;
    if (detail) {
        console.info(`[PaginationDebug] ${message}`, detail);
        return;
    }
    console.info(`[PaginationDebug] ${message}`);
};
const hasOnlyPages = (doc, pageType) => {
    if (!doc || doc.childCount === 0)
        return false;
    for (let i = 0; i < doc.childCount; i += 1) {
        if (doc.child(i).type !== pageType)
            return false;
    }
    return true;
};
const wrapDocInPage = (state) => {
    const pageType = state.schema.nodes.page;
    if (!pageType)
        return null;
    if (hasOnlyPages(state.doc, pageType))
        return null;
    const pageNode = pageType.create(null, state.doc.content);
    const docNode = state.schema.topNodeType.create(state.doc.attrs, pageNode);
    return state.tr.replaceWith(0, state.doc.content.size, docNode.content);
};
const findPageDepth = ($pos, pageType) => {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if ($pos.node(depth).type === pageType) {
            return depth;
        }
    }
    return -1;
};
const shouldSplitAfter = (el) => {
    if (el.classList.contains("leditor-break")) {
        const kind = el.dataset.breakKind;
        return kind === "page" || kind === "section";
    }
    return false;
};
// Require extra slack before joining to avoid split/join oscillation at boundaries.
const JOIN_BUFFER_PX = 12;
const findSplitTarget = (content, tolerance = 1) => {
    const contentHeight = content.clientHeight;
    if (contentHeight <= 0) {
        logDebug("page content height is non-positive", { contentHeight });
        return null;
    }
    const children = Array.from(content.children).filter((node) => node instanceof HTMLElement);
    for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        if (shouldSplitAfter(child)) {
            logDebug("manual break forces split", { tag: child.tagName, index: i });
            return { target: child, after: true };
        }
        const bottom = child.offsetTop + child.offsetHeight;
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
            logDebug("overflow split target", { tag: child.tagName, index: i, bottom, contentHeight });
            return { target: child, after: false };
        }
    }
    return null;
};
const findJoinBoundary = (view, pageType, tolerance = 1) => {
    const pages = Array.from(view.dom.querySelectorAll(`.${PAGE_CLASS}`));
    if (pages.length < 2)
        return null;
    for (let i = 0; i < pages.length - 1; i += 1) {
        const page = pages[i];
        const nextPage = pages[i + 1];
        const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`);
        const nextContent = nextPage.querySelector(`.${PAGE_CONTENT_CLASS}`);
        if (!content || !nextContent)
            continue;
        const nextFirst = nextContent.firstElementChild;
        if (!nextFirst)
            continue;
        const last = content.lastElementChild;
        if (last && shouldSplitAfter(last)) {
            continue;
        }
        const lastMarginBottom = last ? parseFloat(getComputedStyle(last).marginBottom || "0") || 0 : 0;
        const used = last ? last.offsetTop + last.offsetHeight + lastMarginBottom : 0;
        const remaining = content.clientHeight - used;
        const nextMarginTop = parseFloat(getComputedStyle(nextFirst).marginTop || "0") || 0;
        const nextHeight = nextMarginTop + nextFirst.offsetHeight;
        if (remaining + tolerance >= nextHeight + JOIN_BUFFER_PX) {
            let pos = 0;
            for (let idx = 0; idx <= i; idx += 1) {
                const child = view.state.doc.child(idx);
                if (!child || child.type !== pageType)
                    return null;
                pos += child.nodeSize;
            }
            return pos;
        }
    }
    return null;
};
const findEmptyPageRange = (doc, pageType) => {
    let pos = 0;
    for (let i = 0; i < doc.childCount; i += 1) {
        const child = doc.child(i);
        const from = pos;
        const to = pos + child.nodeSize;
        pos = to;
        if (child.type !== pageType)
            continue;
        if (child.content.size === 0) {
            return { from, to };
        }
    }
    return null;
};
const paginateView = (view, runningRef) => {
    if (runningRef.value)
        return;
    const pageType = view.state.schema.nodes.page;
    if (!pageType)
        return;
    const selection = view.state.selection;
    const selectionIndex = selection ? selection.$from.index(0) : -1;
    logDebug("paginate start", {
        pageCount: view.state.doc.childCount,
        selectionIndex
    });
    runningRef.value = true;
    try {
        const trWrap = wrapDocInPage(view.state);
        if (trWrap) {
            logDebug("wrapped doc in page");
            view.dispatch(trWrap);
            return;
        }
        const pages = Array.from(view.dom.querySelectorAll(`.${PAGE_CLASS}`));
        logDebug("page nodes before split", {
            domPageCount: pages.length,
            docPageCount: view.state.doc.childCount,
            overlayPages: view.dom.querySelectorAll(`.${PAGE_INNER_CLASS}`).length
        });
        for (const page of pages) {
            const content = page.querySelector(`.${PAGE_CONTENT_CLASS}`);
            if (!content)
                continue;
            const split = findSplitTarget(content);
            if (!split)
                continue;
            const pos = view.posAtDOM(split.target, 0);
            const resolved = view.state.doc.resolve(pos);
            const pageDepth = findPageDepth(resolved, pageType);
            if (pageDepth < 0)
                continue;
            const childDepth = pageDepth + 1;
            if (resolved.depth < childDepth)
                continue;
            let splitPos = split.after ? resolved.after(childDepth) : resolved.before(childDepth);
            if (splitPos <= 0)
                continue;
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
            const from = view.state.selection.from;
            logDebug("splitting page", { splitPos, depth, selectionFrom: from });
            const tr = view.state.tr.split(splitPos, depth, [{ type: pageType }]);
            if (from >= splitPos) {
                const mapped = tr.mapping.map(from);
                logDebug("moving selection after split", { from, mapped });
                tr.setSelection(state_1.TextSelection.create(tr.doc, mapped));
            }
            view.dispatch(tr);
            return;
        }
        const joinPos = findJoinBoundary(view, pageType);
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
    }
    finally {
        runningRef.value = false;
    }
};
exports.PageDocument = extension_document_1.default.extend({
    content: "page+"
});
exports.PageNode = core_1.Node.create({
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
        return ["div", (0, core_1.mergeAttributes)(HTMLAttributes, { "data-page": "true", class: PAGE_CLASS }), 0];
    },
    addNodeView() {
        return () => {
            const page = document.createElement("div");
            page.className = PAGE_CLASS;
            const inner = document.createElement("div");
            inner.className = PAGE_INNER_CLASS;
            const header = document.createElement("div");
            header.className = PAGE_HEADER_CLASS;
            header.setAttribute("aria-hidden", "true");
            header.contentEditable = "false";
            const content = document.createElement("div");
            content.className = PAGE_CONTENT_CLASS;
            const footnotes = document.createElement("div");
            footnotes.className = PAGE_FOOTNOTES_CLASS;
            const footer = document.createElement("div");
            footer.className = PAGE_FOOTER_CLASS;
            footer.setAttribute("aria-hidden", "true");
            footer.contentEditable = "false";
            inner.appendChild(header);
            inner.appendChild(content);
            inner.appendChild(footnotes);
            inner.appendChild(footer);
            page.appendChild(inner);
            return { dom: page, contentDOM: content };
        };
    }
});
exports.PagePagination = core_1.Extension.create({
    name: "pagePagination",
    addProseMirrorPlugins() {
        return [
            new state_1.Plugin({
                key: paginationKey,
                appendTransaction(_transactions, _oldState, newState) {
                    return wrapDocInPage(newState);
                },
                view(editorView) {
                    console.info("[PaginationDebug] PagePagination initialized");
                    const running = { value: false };
                    const scheduler = new scheduler_js_1.PaginationScheduler({
                        root: editorView.dom,
                        onRun: () => paginateView(editorView, running)
                    });
                    scheduler.request();
                    return {
                        update(view, prevState) {
                            if (view.state.doc.eq(prevState.doc))
                                return;
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
