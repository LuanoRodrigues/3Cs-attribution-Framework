"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const normalizeEntries = (value) => {
    if (!Array.isArray(value))
        return [];
    const entries = [];
    for (const item of value) {
        if (!item || typeof item !== "object")
            continue;
        const id = typeof item.id === "string" ? item.id : "";
        const label = typeof item.label === "string" ? item.label : "";
        if (!id)
            continue;
        entries.push({ id, label: label.trim() || id });
    }
    return entries;
};
class BibliographyNodeView {
    node;
    root;
    list;
    constructor(node) {
        this.node = node;
        this.root = document.createElement("section");
        this.root.className = "leditor-bibliography";
        this.root.dataset.bibliography = "true";
        const title = document.createElement("div");
        title.className = "leditor-bibliography-title";
        title.textContent = "Bibliography";
        this.list = document.createElement("ol");
        this.list.className = "leditor-bibliography-list";
        this.root.appendChild(title);
        this.root.appendChild(this.list);
        this.renderEntries(normalizeEntries(node.attrs?.entries));
    }
    renderEntries(entries) {
        this.list.innerHTML = "";
        if (entries.length === 0) {
            const empty = document.createElement("div");
            empty.className = "leditor-bibliography-empty";
            empty.textContent = "No sources cited.";
            this.list.appendChild(empty);
            return;
        }
        for (const entry of entries) {
            const item = document.createElement("li");
            item.className = "leditor-bibliography-entry";
            item.dataset.sourceId = entry.id;
            item.textContent = entry.label;
            this.list.appendChild(item);
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
const bibliographyNodeView = (props) => {
    const view = new BibliographyNodeView(props.node);
    return {
        dom: view.dom,
        update: (node) => view.update(node)
    };
};
const BibliographyExtension = core_1.Node.create({
    name: "bibliography",
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
                tag: "section[data-bibliography]",
                getAttrs: (node) => {
                    if (!(node instanceof HTMLElement))
                        return {};
                    const raw = node.getAttribute("data-bibliography-entries");
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
            "section",
            {
                "data-bibliography": "true",
                "data-bibliography-entries": JSON.stringify(entries),
                class: "leditor-bibliography"
            },
            0
        ];
    },
    addNodeView() {
        return bibliographyNodeView;
    }
});
exports.default = BibliographyExtension;
