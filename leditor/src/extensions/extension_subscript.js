"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const SUBSCRIPT_STYLE = "vertical-align: sub; font-size: 0.85em;";
const SubscriptMark = core_1.Mark.create({
    name: "subscript",
    parseHTML() {
        return [
            { tag: "sub" },
            {
                style: "vertical-align",
                getAttrs: (value) => {
                    if (typeof value !== "string")
                        return false;
                    return value.includes("sub") ? {} : false;
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const existingStyle = (HTMLAttributes.style ?? "").trim();
        const style = existingStyle
            ? `${existingStyle}; ${SUBSCRIPT_STYLE}`
            : SUBSCRIPT_STYLE;
        return ["span", (0, core_1.mergeAttributes)(HTMLAttributes, { style }), 0];
    }
});
exports.default = SubscriptMark;
