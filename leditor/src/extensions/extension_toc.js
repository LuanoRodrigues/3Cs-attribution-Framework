"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const state_1 = require("@tiptap/pm/state");
const normalizeEntries = (value) => {
    if (!Array.isArray(value))
        return [];
    const entries = [];
    for (const item of value) {
        if (!item || typeof item !== "object")
            continue;
        const text = typeof item.text === "string" ? item.text : "";
        const level = Number(item.level);
        const pos = Number(item.pos);
        entries.push({
            text: text.trim() || "Untitled",
            level: Number.isFinite(level) ? Math.max(1, Math.min(6, Math.floor(level))) : 1,
            pos: Number.isFinite(pos) ? Math.max(0, Math.floor(pos)) : 0
        });
    }
    return entries;
};
class TocNodeView {
    node;
    view;
    root;
    list;
    constructor(node, view) {
        this.node = node;
        this.view = view;
        this.root = document.createElement("nav");
        this.root.className = "leditor-toc";
        this.root.dataset.toc = "true";
        const title = document.createElement("div");
        title.className = "leditor-toc-title";
        title.textContent = "Table of Contents";
        this.list = document.createElement("div");
        this.list.className = "leditor-toc-list";
        this.root.appendChild(title);
        this.root.appendChild(this.list);
        this.renderEntries(normalizeEntries(node.attrs?.entries));
    }
    renderEntries(entries) {
        this.list.innerHTML = "";
        if (entries.length === 0) {
            const empty = document.createElement("div");
            empty.className = "leditor-toc-empty";
            empty.textContent = "No headings found.";
            this.list.appendChild(empty);
            return;
        }
        for (const entry of entries) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "leditor-toc-entry";
            button.dataset.level = String(entry.level);
            button.textContent = entry.text;
            button.addEventListener("click", (event) => {
                event.preventDefault();
                const pos = entry.pos;
                if (!Number.isFinite(pos))
                    return;
                const maxPos = this.view.state.doc.content.size;
                if (pos <= 0 || pos > maxPos)
                    return;
                const selection = state_1.TextSelection.create(this.view.state.doc, pos);
                this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView());
                this.view.focus();
            });
            this.list.appendChild(button);
        }
    }
    update(node) {
        if (node.type !== this.node.type)
            return false;
        this.node = node;
        this.renderEntries(normalizeEntries(node.attrs?.entries));
        return true;
    }
    get dom() {
        return this.root;
    }
}
const tocNodeView = (props) => {
    const view = new TocNodeView(props.node, props.view);
    return {
        dom: view.dom,
        update: (node) => view.update(node)
    };
};
const TocExtension = core_1.Node.create({
    name: "toc",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
        return {
            entries: {
                default: []
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: "nav[data-toc]",
                getAttrs: (node) => {
                    if (!(node instanceof HTMLElement))
                        return {};
                    const raw = node.getAttribute("data-toc-entries");
                    if (!raw)
                        return {};
                    try {
                        const parsed = JSON.parse(raw);
                        return { entries: normalizeEntries(parsed) };
                    }
                    catch {
                        return {};
                    }
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const entries = normalizeEntries(HTMLAttributes.entries);
        return [
            "nav",
            {
                "data-toc": "true",
                "data-toc-entries": JSON.stringify(entries),
                class: "leditor-toc"
            },
            0
        ];
    },
    addNodeView() {
        return tocNodeView;
    }
});
exports.default = TocExtension;
