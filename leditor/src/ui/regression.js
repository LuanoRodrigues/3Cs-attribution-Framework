"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRegressionRoutine = void 0;
const safeExec = (handle, command, args) => {
    try {
        handle.execCommand(command, args);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown");
        throw new Error(`Regression command "${command}" failed: ${message}`);
    }
};
const runRegressionRoutine = (editorHandle) => {
    editorHandle.setContent("<p>Phase 30 regression test</p>", { format: "html" });
    editorHandle.focus();
    safeExec(editorHandle, "Bold");
    safeExec(editorHandle, "InsertPageBreak");
    safeExec(editorHandle, "InsertFootnote");
    safeExec(editorHandle, "InsertMergeTag", { key: "REG" });
    safeExec(editorHandle, "TableInsert", { rows: 2, cols: 2 });
    safeExec(editorHandle, "TableAddRowBelow");
    safeExec(editorHandle, "TableAddColumnRight");
    safeExec(editorHandle, "TableMergeCells");
    safeExec(editorHandle, "TableSplitCell");
    safeExec(editorHandle, "InsertTemplate", { id: "conference_note" });
    safeExec(editorHandle, "Undo");
    safeExec(editorHandle, "Redo");
    safeExec(editorHandle, "ClearFormatting");
    return editorHandle.getJSON();
};
exports.runRegressionRoutine = runRegressionRoutine;
