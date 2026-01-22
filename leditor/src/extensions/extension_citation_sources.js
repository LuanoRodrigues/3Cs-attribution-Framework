"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const normalizeSources = (value) => {
    if (!Array.isArray(value))
        return [];
    const sources = [];
    for (const item of value) {
        if (!item || typeof item !== "object")
            continue;
        const id = typeof item.id === "string" ? item.id : "";
        if (!id)
            continue;
        sources.push({
            id,
            title: typeof item.title === "string" ? item.title : undefined,
            author: typeof item.author === "string" ? item.author : undefined,
            year: typeof item.year === "string" ? item.year : undefined,
            url: typeof item.url === "string" ? item.url : undefined,
            note: typeof item.note === "string" ? item.note : undefined
        });
    }
    return sources;
};
const CitationSourcesExtension = core_1.Node.create({
    name: "citation_sources",
    group: "block",
    atom: true,
    selectable: false,
    draggable: false,
    addAttributes() {
        return {
            sources: {
                default: []
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-citation-sources]",
                getAttrs: (node) => {
                    if (!(node instanceof HTMLElement))
                        return {};
                    const raw = node.getAttribute("data-sources");
                    if (!raw)
                        return {};
                    try {
                        const parsed = JSON.parse(raw);
                        return { sources: normalizeSources(parsed) };
                    }
                    catch {
                        return {};
                    }
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const sources = normalizeSources(HTMLAttributes.sources);
        return [
            "div",
            {
                "data-citation-sources": "true",
                "data-sources": JSON.stringify(sources),
                class: "leditor-citation-sources"
            },
            0
        ];
    }
});
exports.default = CitationSourcesExtension;
