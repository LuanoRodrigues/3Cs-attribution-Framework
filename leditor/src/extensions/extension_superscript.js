"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const SUPERSCRIPT_STYLE = "vertical-align: super; font-size: 0.85em;";
const SuperscriptMark = core_1.Mark.create({
    name: "superscript",
    parseHTML() {
        return [
            { tag: "sup" },
            {
                style: "vertical-align",
                getAttrs: (value) => {
                    if (typeof value !== "string")
                        return false;
                    return value.includes("super") ? {} : false;
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const existingStyle = (HTMLAttributes.style ?? "").trim();
        const style = existingStyle
            ? `${existingStyle}; ${SUPERSCRIPT_STYLE}`
            : SUPERSCRIPT_STYLE;
        return ["span", (0, core_1.mergeAttributes)(HTMLAttributes, { style }), 0];
    }
});
exports.default = SuperscriptMark;
