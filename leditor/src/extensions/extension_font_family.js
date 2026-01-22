"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const FontFamilyMark = core_1.Mark.create({
    name: "fontFamily",
    addAttributes() {
        return {
            fontFamily: {
                default: null,
                parseHTML: (element) => {
                    const value = element.style.fontFamily;
                    if (!value)
                        return null;
                    return value.replace(/["']/g, "");
                },
                renderHTML: (attrs) => {
                    if (!attrs.fontFamily)
                        return {};
                    return { style: `font-family: ${attrs.fontFamily}` };
                }
            }
        };
    },
    parseHTML() {
        return [{ style: "font-family" }];
    },
    renderHTML({ HTMLAttributes }) {
        return ["span", HTMLAttributes, 0];
    }
});
exports.default = FontFamilyMark;
