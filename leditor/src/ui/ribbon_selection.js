"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.watchRibbonSelectionState = void 0;
const TOGGLE_ACTIVE_MAP = {
    Bold: "bold",
    Italic: "italic",
    Underline: "underline",
    Strikethrough: "strikethrough",
    Superscript: "superscript",
    Subscript: "subscript",
    BulletList: "bulletList",
    NumberList: "orderedList"
};
const getSelectionAlignment = (editor) => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
        const node = $from.node(depth);
        const align = node.attrs?.textAlign;
        if (typeof align === "string" && align.length > 0) {
            if (align === "center" || align === "right" || align === "justify") {
                return align;
            }
            return "left";
        }
    }
    return "left";
};
const setButtonState = (element, isActive) => {
    element.classList.toggle("is-selected", isActive);
    element.setAttribute("aria-pressed", isActive ? "true" : "false");
};
const isCommandActive = (editor, commandId) => {
    const nodeName = TOGGLE_ACTIVE_MAP[commandId];
    if (!nodeName)
        return false;
    return editor.isActive(nodeName);
};
const watchRibbonSelectionState = (editorHandle, targets) => {
    const editor = editorHandle.getEditor();
    const update = () => {
        const alignment = getSelectionAlignment(editor);
        for (const [variantKey, button] of Object.entries(targets.alignmentButtons)) {
            if (!button)
                continue;
            const variant = variantKey;
            const isActive = variant === alignment;
            setButtonState(button, isActive);
        }
        targets.toggles.forEach(({ commandId, element }) => {
            setButtonState(element, isCommandActive(editor, commandId));
        });
    };
    editorHandle.on("selectionChange", update);
    update();
};
exports.watchRibbonSelectionState = watchRibbonSelectionState;
