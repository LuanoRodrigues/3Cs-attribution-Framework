"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const CitationExtension = core_1.Node.create({
    name: "citation",
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
        return {
            sourceId: {
                default: ""
            },
            label: {
                default: ""
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: "span[data-citation]",
                getAttrs: (node) => {
                    if (!(node instanceof HTMLElement))
                        return {};
                    const sourceId = node.getAttribute("data-citation-id") ?? "";
                    const label = node.getAttribute("data-citation-label") ?? node.textContent ?? "";
                    return { sourceId, label };
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const sourceId = typeof HTMLAttributes.sourceId === "string" ? HTMLAttributes.sourceId : "";
        const label = typeof HTMLAttributes.label === "string" && HTMLAttributes.label.trim().length > 0
            ? HTMLAttributes.label.trim()
            : sourceId;
        const text = label ? `[${label}]` : "[citation]";
        return [
            "span",
            {
                "data-citation": "true",
                "data-citation-id": sourceId,
                "data-citation-label": label,
                class: "leditor-citation"
            },
            text
        ];
    }
});
exports.default = CitationExtension;
