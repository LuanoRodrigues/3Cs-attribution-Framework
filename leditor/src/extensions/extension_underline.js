"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const UnderlineMark = core_1.Mark.create({
    name: "underline",
    parseHTML() {
        return [
            { tag: "u" },
            {
                style: "text-decoration",
                getAttrs: (value) => {
                    if (typeof value !== "string")
                        return false;
                    return value.includes("underline") ? {} : false;
                }
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const existingStyle = (HTMLAttributes.style ?? "").trim();
        const style = existingStyle
            ? `${existingStyle}; text-decoration: underline;`
            : "text-decoration: underline;";
        return ["span", (0, core_1.mergeAttributes)(HTMLAttributes, { style }), 0];
    }
});
exports.default = UnderlineMark;
