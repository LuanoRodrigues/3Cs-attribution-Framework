"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const STRIKE_STYLE = "text-decoration: line-through;";
const StrikethroughMark = core_1.Mark.create({
    name: "strikethrough",
    parseHTML() {
        return [
            { tag: "s" },
            { tag: "del" },
            {
                style: "text-decoration",
                getAttrs: (value) => {
                    if (typeof value !== "string")
                        return false;
                    return value.includes("line-through") ? {} : false;
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const existingStyle = (HTMLAttributes.style ?? "").trim();
        const style = existingStyle
            ? `${existingStyle}; ${STRIKE_STYLE}`
            : STRIKE_STYLE;
        return ["span", (0, core_1.mergeAttributes)(HTMLAttributes, { style }), 0];
    }
});
exports.default = StrikethroughMark;
