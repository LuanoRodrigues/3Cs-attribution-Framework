"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const ImageExtension = core_1.Node.create({
    name: "image",
    group: "block",
    atom: true,
    selectable: true,
    draggable: true,
    inline: false,
    addAttributes() {
        const parseNumeric = (element, name) => {
            const value = element.getAttribute(name);
            if (!value)
                return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };
        return {
            src: {
                default: null,
                parseHTML: (element) => element.getAttribute("src") ?? null
            },
            alt: {
                default: null,
                parseHTML: (element) => element.getAttribute("alt") ?? null
            },
            width: {
                default: null,
                parseHTML: (element) => parseNumeric(element, "width")
            },
            height: {
                default: null,
                parseHTML: (element) => parseNumeric(element, "height")
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: "img[src]"
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["img", (0, core_1.mergeAttributes)(HTMLAttributes)];
    }
});
exports.default = ImageExtension;
