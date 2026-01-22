"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BREAK_KIND_LABELS = void 0;
const core_1 = require("@tiptap/core");
exports.BREAK_KIND_LABELS = {
    page: "Page Break",
    column: "Column Break",
    text_wrap: "Text Wrapping Break",
    section_next: "Section Break (Next Page)",
    section_continuous: "Section Break (Continuous)",
    section_even: "Section Break (Even Page)",
    section_odd: "Section Break (Odd Page)"
};
const PageBreakExtension = core_1.Node.create({
    name: "page_break",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
        return {
            kind: {
                default: "page"
            },
            sectionId: {
                default: null
            },
            sectionSettings: {
                default: null
            }
        };
    },
    parseHTML() {
        return [{ tag: "div[data-break]" }];
    },
    renderHTML({ HTMLAttributes }) {
        const kind = HTMLAttributes.kind ?? "page";
        const sectionId = HTMLAttributes.sectionId;
        const sectionSettings = HTMLAttributes.sectionSettings;
        const label = exports.BREAK_KIND_LABELS[kind] ?? "Break";
        const attrs = {
            "data-break": "true",
            "data-break-kind": kind,
            "data-break-label": label,
            class: `leditor-break leditor-break-${kind}`
        };
        if (sectionId) {
            attrs["data-section-id"] = String(sectionId);
        }
        if (sectionSettings) {
            attrs["data-section-settings"] = String(sectionSettings);
        }
        if (kind === "page") {
            attrs["style"] = "break-before: page; page-break-before: always;";
        }
        return ["div", attrs, 0];
    }
});
exports.default = PageBreakExtension;
