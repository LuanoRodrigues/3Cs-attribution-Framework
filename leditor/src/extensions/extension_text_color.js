"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const TextColorMark = core_1.Mark.create({
    name: "textColor",
    addAttributes() {
        return {
            color: {
                default: null,
                parseHTML: (element) => {
                    const value = element.style.color;
                    return value || null;
                },
                renderHTML: (attrs) => {
                    if (!attrs.color)
                        return {};
                    return { style: `color: ${attrs.color}` };
                }
            }
        };
    },
    parseHTML() {
        return [{ style: "color" }];
    },
    renderHTML({ HTMLAttributes }) {
        return ["span", HTMLAttributes, 0];
    }
});
exports.default = TextColorMark;
