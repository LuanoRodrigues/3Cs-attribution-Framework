"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFootnoteRegistry = void 0;
const core_1 = require("@tiptap/core");
const extension_link_1 = __importDefault(require("@tiptap/extension-link"));
const starter_kit_1 = __importDefault(require("@tiptap/starter-kit"));
const toolbar_styles_js_1 = require("../ui/toolbar_styles.js");
const footnoteRegistry = new Map();
const getFootnoteRegistry = () => footnoteRegistry;
exports.getFootnoteRegistry = getFootnoteRegistry;
class FootnoteNodeView {
    id;
    node;
    view;
    getPos;
    root;
    marker;
    popover;
    toolbar;
    editorHost;
    innerEditor = null;
    isOpen = false;
    syncingFromNode = false;
    lastInnerContent = "";
    documentClickHandler;
    constructor({ node, view, getPos }) {
        (0, toolbar_styles_js_1.ensureToolbarStyles)();
        this.node = node;
        this.view = view;
        this.getPos = getPos;
        this.id = String(node.attrs.id ?? `footnote-${Math.random().toString(36).slice(2)}`);
        this.root = document.createElement("span");
        this.root.className = "leditor-footnote";
        this.root.dataset.footnoteId = this.id;
        this.root.dataset.footnoteKind = String(node.attrs.kind ?? "footnote");
        this.marker = document.createElement("sup");
        this.marker.className = "leditor-footnote-marker";
        this.marker.setAttribute("aria-label", "Footnote");
        this.marker.addEventListener("click", (event) => {
            event.preventDefault();
            this.toggle();
        });
        this.root.appendChild(this.marker);
        this.popover = document.createElement("div");
        this.popover.className = "leditor-footnote-popover";
        this.root.appendChild(this.popover);
        this.toolbar = document.createElement("div");
        this.toolbar.className = "leditor-footnote-toolbar";
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("aria-label", "Footnote toolbar");
        const actions = [
            { label: "B", ariaLabel: "Bold", tooltip: "Bold (Ctrl+B)", action: () => this.toggleMark("bold") },
            { label: "I", ariaLabel: "Italic", tooltip: "Italic (Ctrl+I)", action: () => this.toggleMark("italic") },
            {
                label: "Link",
                ariaLabel: "Link",
                tooltip: "Link (Ctrl+K)",
                action: () => {
                    const currentHref = this.innerEditor?.getAttributes("link").href ?? "";
                    const raw = window.prompt("Enter footnote link URL", currentHref);
                    if (raw === null)
                        return;
                    const href = raw.trim();
                    this.innerEditor?.commands.focus();
                    if (href.length === 0) {
                        this.innerEditor?.commands.unsetLink();
                        return;
                    }
                    this.innerEditor?.commands.setLink({ href });
                }
            }
        ];
        for (const action of actions) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = action.label;
            button.className = "tb-btn tb-btn--quiet";
            button.setAttribute("aria-label", action.ariaLabel);
            button.setAttribute("data-tooltip", action.tooltip);
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                action.action();
            });
            this.toolbar.appendChild(button);
        }
        this.popover.appendChild(this.toolbar);
        this.editorHost = document.createElement("div");
        this.editorHost.className = "leditor-footnote-editor";
        this.popover.appendChild(this.editorHost);
        this.setupInnerEditor();
        this.documentClickHandler = (event) => {
            if (!this.root.contains(event.target)) {
                this.close();
            }
        };
        document.addEventListener("click", this.documentClickHandler);
        footnoteRegistry.set(this.id, this);
    }
    setupInnerEditor() {
        this.innerEditor = new core_1.Editor({
            element: this.editorHost,
            extensions: [starter_kit_1.default.configure({ history: false }), extension_link_1.default],
            content: this.createDocFromNode(this.node),
            editable: true,
            editorProps: {
                attributes: {
                    class: "footnote-inner-editor"
                }
            }
        });
        this.innerEditor.on("update", () => {
            if (this.syncingFromNode) {
                this.syncingFromNode = false;
                return;
            }
            this.syncFromInnerEditor();
        });
        this.lastInnerContent = this.serializeInnerContent();
    }
    serializeInnerContent() {
        if (!this.innerEditor)
            return "";
        return JSON.stringify(this.innerEditor.getJSON().content ?? []);
    }
    createDocFromNode(node) {
        const content = node.content.toJSON();
        const normalized = Array.isArray(content) && content.length > 0 ? content : [{ type: "text", text: "" }];
        return { type: "doc", content: normalized };
    }
    syncFromInnerEditor() {
        if (!this.innerEditor)
            return;
        const content = this.innerEditor.getJSON().content ?? [];
        const serialized = JSON.stringify(content);
        if (serialized === this.lastInnerContent)
            return;
        this.lastInnerContent = serialized;
        this.applyInnerContent(content);
    }
    applyInnerContent(content) {
        const doc = this.view.state.schema.nodeFromJSON({ type: "doc", content });
        const newNode = this.node.type.create(this.node.attrs, doc.content, this.node.marks);
        const pos = this.getPos();
        if (typeof pos !== "number")
            return;
        const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, newNode);
        this.view.dispatch(tr);
    }
    toggleMark(mark) {
        this.innerEditor?.chain().focus().toggleMark(mark).run();
    }
    toggle() {
        if (this.isOpen) {
            this.close();
            return;
        }
        this.open();
    }
    open() {
        if (this.isOpen)
            return;
        this.isOpen = true;
        this.popover.style.display = "block";
        this.innerEditor?.commands.focus();
    }
    close() {
        if (!this.isOpen)
            return;
        this.isOpen = false;
        this.popover.style.display = "none";
        this.view.focus();
    }
    setPlainText(value) {
        if (!this.innerEditor)
            return;
        const doc = { type: "doc", content: [{ type: "text", text: value }] };
        this.syncingFromNode = true;
        this.innerEditor.commands.setContent(doc);
        this.lastInnerContent = JSON.stringify(doc.content);
    }
    getPlainText() {
        return this.innerEditor?.state.doc.textContent ?? "";
    }
    getNumber() {
        return this.marker.textContent ?? "";
    }
    setNumber(value) {
        if (!Number.isFinite(value) || value <= 0) {
            this.marker.textContent = "";
            delete this.root.dataset.footnoteNumber;
            return;
        }
        const normalized = String(Math.floor(value));
        this.marker.textContent = normalized;
        this.root.dataset.footnoteNumber = normalized;
    }
    update(node) {
        if (node.type !== this.node.type)
            return false;
        this.node = node;
        const target = this.createDocFromNode(node);
        const serialized = JSON.stringify(target.content);
        if (serialized === this.lastInnerContent)
            return true;
        this.syncingFromNode = true;
        this.lastInnerContent = serialized;
        this.innerEditor?.commands.setContent(target);
        return true;
    }
    selectNode() {
        this.root.classList.add("is-selected");
    }
    deselectNode() {
        this.root.classList.remove("is-selected");
    }
    stopEvent(event) {
        return this.root.contains(event.target);
    }
    ignoreMutation() {
        return true;
    }
    destroy() {
        footnoteRegistry.delete(this.id);
        document.removeEventListener("click", this.documentClickHandler);
        this.innerEditor?.destroy();
    }
    get dom() {
        return this.root;
    }
}
const footnoteNodeView = (props) => {
    const view = new FootnoteNodeView({ ...props });
    return {
        dom: view.dom,
        update: (node) => view.update(node),
        selectNode: () => view.selectNode(),
        deselectNode: () => view.deselectNode(),
        stopEvent: (event) => view.stopEvent(event),
        ignoreMutation: () => view.ignoreMutation(),
        destroy: () => view.destroy()
    };
};
const FootnoteExtension = core_1.Node.create({
    name: "footnote",
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    content: "inline*",
    addAttributes() {
        return {
            id: {
                default: null
            },
            kind: {
                default: "footnote"
            },
            citationId: {
                default: null
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: "span[data-footnote]",
                getAttrs: (node) => {
                    if (!(node instanceof HTMLElement))
                        return {};
                    return {
                        kind: node.getAttribute("data-footnote-kind") ?? "footnote",
                        citationId: node.getAttribute("data-citation-id") || null
                    };
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const kind = HTMLAttributes.kind ?? "footnote";
        const attrs = {
            "data-footnote": "true",
            "data-footnote-kind": kind,
            ...HTMLAttributes
        };
        if (HTMLAttributes.citationId) {
            attrs["data-citation-id"] = HTMLAttributes.citationId;
        }
        return ["span", attrs, 0];
    },
    addNodeView() {
        return footnoteNodeView;
    }
});
exports.default = FootnoteExtension;
