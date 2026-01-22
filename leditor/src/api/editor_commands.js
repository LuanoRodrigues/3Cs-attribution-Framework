"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchCommand = exports.MINIMAL_EDITOR_COMMANDS = void 0;
exports.MINIMAL_EDITOR_COMMANDS = [
    "Bold",
    "Italic",
    "Underline",
    "Undo",
    "Redo",
    "AlignLeft",
    "AlignCenter",
    "AlignRight",
    "JustifyFull",
    "BulletList",
    "NumberList"
];
const dispatchCommand = (editorHandle, commandId, payload) => {
    window.codexLog?.write(`[RIBBON_COMMAND] ${commandId}`);
    editorHandle.execCommand(commandId, payload);
    const tiptap = editorHandle?.getEditor?.();
    if (tiptap?.commands?.focus) {
        tiptap.commands.focus();
    }
    else if (editorHandle?.focus) {
        editorHandle.focus();
    }
};
exports.dispatchCommand = dispatchCommand;
