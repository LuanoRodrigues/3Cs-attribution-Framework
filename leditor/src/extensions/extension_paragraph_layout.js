"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const pageUnits_1 = require("../utils/pageUnits.js");
const toPx = (cm) => (typeof cm === "number" ? (0, pageUnits_1.cmToPx)(cm) : 0);
const ParagraphLayoutExtension = core_1.Extension.create({
    name: "paragraphLayout",
    addGlobalAttributes() {
        return [
            {
                types: ["paragraph", "heading"],
                attributes: {
                    indentLeftCm: {
                        default: 0,
                        renderHTML: (attrs) => {
                            const left = toPx(attrs.indentLeftCm);
                            if (!left)
                                return {};
                            return { style: `margin-left: ${left}px` };
                        }
                    },
                    indentRightCm: {
                        default: 0,
                        renderHTML: (attrs) => {
                            const right = toPx(attrs.indentRightCm);
                            if (!right)
                                return {};
                            return { style: `margin-right: ${right}px` };
                        }
                    },
                    spaceBeforePt: {
                        default: 0,
                        renderHTML: (attrs) => {
                            const beforePx = (0, pageUnits_1.ptToPx)(Number(attrs.spaceBeforePt ?? 0));
                            if (!beforePx)
                                return {};
                            return { style: `margin-top: ${beforePx}px` };
                        }
                    },
                    spaceAfterPt: {
                        default: 0,
                        renderHTML: (attrs) => {
                            const afterPx = (0, pageUnits_1.ptToPx)(Number(attrs.spaceAfterPt ?? 0));
                            if (!afterPx)
                                return {};
                            return { style: `margin-bottom: ${afterPx}px` };
                        }
                    }
                }
            }
        ];
    },
    addCommands() {
        return {
            setParagraphIndent: (attrs) => ({ chain }) => chain
                .updateAttributes("paragraph", {
                indentLeftCm: attrs.indentLeftCm,
                indentRightCm: attrs.indentRightCm
            })
                .updateAttributes("heading", {
                indentLeftCm: attrs.indentLeftCm,
                indentRightCm: attrs.indentRightCm
            })
                .run(),
            setParagraphSpacing: (attrs) => ({ chain }) => chain
                .updateAttributes("paragraph", {
                spaceBeforePt: attrs.spaceBeforePt,
                spaceAfterPt: attrs.spaceAfterPt
            })
                .updateAttributes("heading", {
                spaceBeforePt: attrs.spaceBeforePt,
                spaceAfterPt: attrs.spaceAfterPt
            })
                .run()
        };
    }
});
exports.default = ParagraphLayoutExtension;
