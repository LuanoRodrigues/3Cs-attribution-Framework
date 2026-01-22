"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const AlignExtension = core_1.Extension.create({
    name: "align",
    addGlobalAttributes() {
        return [
            {
                types: ["paragraph", "heading"],
                attributes: {
                    textAlign: {
                        default: null,
                        parseHTML: (element) => {
                            const value = element.style.textAlign;
                            return value || null;
                        },
                        renderHTML: (attrs) => {
                            if (!attrs.textAlign)
                                return {};
                            return { style: `text-align: ${attrs.textAlign}` };
                        }
                    }
                }
            }
        ];
    },
    addCommands() {
        return {
            setTextAlign: (alignment) => ({ chain }) => chain.updateAttributes("paragraph", { textAlign: alignment }).updateAttributes("heading", { textAlign: alignment }).run(),
            unsetTextAlign: () => ({ chain }) => chain.updateAttributes("paragraph", { textAlign: null }).updateAttributes("heading", { textAlign: null }).run()
        };
    }
});
exports.default = AlignExtension;
