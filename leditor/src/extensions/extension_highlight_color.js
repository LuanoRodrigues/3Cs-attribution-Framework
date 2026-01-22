"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const HighlightColorMark = core_1.Mark.create({
    name: "highlightColor",
    addAttributes() {
        return {
            highlight: {
                default: null,
                parseHTML: (element) => {
                    const value = element.style.backgroundColor;
                    return value || null;
                },
                renderHTML: (attrs) => {
                    if (!attrs.highlight)
                        return {};
                    return { style: `background-color: ${attrs.highlight}` };
                }
            }
        };
    },
    parseHTML() {
        return [{ style: "background-color" }];
    },
    renderHTML({ HTMLAttributes }) {
        return ["span", HTMLAttributes, 0];
    }
});
exports.default = HighlightColorMark;
