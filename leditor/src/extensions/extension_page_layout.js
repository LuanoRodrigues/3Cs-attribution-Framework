"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@tiptap/core");
const defaultLayout = {
    pageSizeId: "a4",
    orientation: "portrait",
    marginsTopCm: 2.5,
    marginsRightCm: 3.0,
    marginsBottomCm: 2.5,
    marginsLeftCm: 3.0,
    columns: 1,
    columnsMode: "one"
};
const parseToCm = (value, fallback) => {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string")
        return fallback;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed)
        return fallback;
    const numeric = Number.parseFloat(trimmed);
    if (!Number.isFinite(numeric))
        return fallback;
    if (trimmed.endsWith("cm"))
        return numeric;
    if (trimmed.endsWith("mm"))
        return numeric / 10;
    if (trimmed.endsWith("in"))
        return numeric * 2.54;
    return numeric;
};
const PageLayoutExtension = core_1.Extension.create({
    name: "pageLayout",
    addGlobalAttributes() {
        return [
            {
                types: ["doc"],
                attributes: {
                    pageSizeId: {
                        default: defaultLayout.pageSizeId
                    },
                    pageWidthMm: {
                        default: defaultLayout.pageWidthMm
                    },
                    pageHeightMm: {
                        default: defaultLayout.pageHeightMm
                    },
                    orientation: {
                        default: defaultLayout.orientation
                    },
                    marginsTopCm: { default: defaultLayout.marginsTopCm },
                    marginsRightCm: { default: defaultLayout.marginsRightCm },
                    marginsBottomCm: { default: defaultLayout.marginsBottomCm },
                    marginsLeftCm: { default: defaultLayout.marginsLeftCm },
                    columns: { default: defaultLayout.columns },
                    columnsMode: { default: defaultLayout.columnsMode },
                    lineNumbering: { default: "none" },
                    hyphenation: { default: "none" }
                }
            }
        ];
    },
    addCommands() {
        const updateDocAttrs = (updater) => ({ editor }) => {
            const { state, view } = editor;
            const current = state.doc.attrs ?? {};
            const next = updater(current);
            const tr = state.tr.setNodeMarkup(0, void 0, next);
            view.dispatch(tr);
            return true;
        };
        return {
            setPageMargins: (margins) => updateDocAttrs((attrs) => ({
                ...attrs,
                marginsTopCm: parseToCm(margins.top, defaultLayout.marginsTopCm),
                marginsRightCm: parseToCm(margins.right, defaultLayout.marginsRightCm),
                marginsBottomCm: parseToCm(margins.bottom, defaultLayout.marginsBottomCm),
                marginsLeftCm: parseToCm(margins.left, defaultLayout.marginsLeftCm)
            })),
            setPageSize: (id, overrides) => updateDocAttrs((attrs) => ({
                ...attrs,
                pageSizeId: id,
                pageWidthMm: overrides?.widthMm,
                pageHeightMm: overrides?.heightMm
            })),
            setPageOrientation: (orientation) => updateDocAttrs((attrs) => ({ ...attrs, orientation })),
            setPageColumns: (input) => updateDocAttrs((attrs) => ({
                ...attrs,
                columns: Math.max(1, Math.min(4, Math.floor(input.count))),
                columnsMode: input.mode ?? defaultLayout.columnsMode
            })),
            setLineNumbering: (mode) => updateDocAttrs((attrs) => ({ ...attrs, lineNumbering: mode })),
            setHyphenation: (mode) => updateDocAttrs((attrs) => ({ ...attrs, hyphenation: mode }))
        };
    }
});
exports.default = PageLayoutExtension;
