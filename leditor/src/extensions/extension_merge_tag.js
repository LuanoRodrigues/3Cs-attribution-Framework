"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const MergeTagExtension = core_1.Node.create({
    name: "merge_tag",
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    addAttributes() {
        return {
            key: {
                default: ""
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: "span[data-merge-tag]"
            }
        ];
    },
    renderHTML({ HTMLAttributes }) {
        const key = HTMLAttributes.key ?? "";
        const text = `{{${key || "TAG"}}}`;
        return [
            "span",
            {
                "data-merge-tag": "true",
                "data-key": key,
                class: "leditor-merge-tag",
                contenteditable: "false"
            },
            text
        ];
    }
});
exports.default = MergeTagExtension;
