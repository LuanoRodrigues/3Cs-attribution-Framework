"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAutosaveController = exports.restoreAutosaveSnapshot = exports.getAutosaveSnapshot = exports.autosaveSnapshot = exports.notifyAutosaveUndoRedo = void 0;
const phaseFlags = {
    saved: false,
    retrieved: false,
    restored: false,
    undoRedo: false,
    logged: false
};
const autosaveStore = new Map();
const cloneSnapshot = (snapshot) => JSON.parse(JSON.stringify(snapshot));
const maybeLogPhase = () => {
    if (phaseFlags.logged)
        return;
    if (!phaseFlags.saved || !phaseFlags.retrieved || !phaseFlags.restored || !phaseFlags.undoRedo) {
        return;
    }
    window.codexLog?.write("[PHASE13_OK]");
    phaseFlags.logged = true;
};
const notifyAutosaveUndoRedo = () => {
    if (!phaseFlags.restored)
        return;
    phaseFlags.undoRedo = true;
    maybeLogPhase();
};
exports.notifyAutosaveUndoRedo = notifyAutosaveUndoRedo;
const autosaveSnapshot = (editor, editorInstanceId) => {
    const snapshot = editor.getJSON();
    autosaveStore.set(editorInstanceId, cloneSnapshot(snapshot));
    phaseFlags.saved = true;
    maybeLogPhase();
};
exports.autosaveSnapshot = autosaveSnapshot;
const getAutosaveSnapshot = (editorInstanceId) => {
    const snapshot = autosaveStore.get(editorInstanceId) ?? null;
    if (snapshot) {
        phaseFlags.retrieved = true;
        maybeLogPhase();
    }
    return snapshot ? cloneSnapshot(snapshot) : null;
};
exports.getAutosaveSnapshot = getAutosaveSnapshot;
const restoreAutosaveSnapshot = (editorHandle, editorInstanceId) => {
    const snapshot = autosaveStore.get(editorInstanceId);
    if (!snapshot)
        return;
    editorHandle.setContent(snapshot, { format: "json" });
    phaseFlags.restored = true;
    maybeLogPhase();
};
exports.restoreAutosaveSnapshot = restoreAutosaveSnapshot;
const createAutosaveController = (editor, editorInstanceId, intervalMs) => {
    let timer = null;
    const schedule = () => {
        if (timer !== null) {
            window.clearTimeout(timer);
        }
        timer = window.setTimeout(() => {
            (0, exports.autosaveSnapshot)(editor, editorInstanceId);
            timer = null;
        }, intervalMs);
    };
    const handleUpdate = () => {
        schedule();
    };
    const handleBlur = () => {
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
        (0, exports.autosaveSnapshot)(editor, editorInstanceId);
    };
    editor.on("update", handleUpdate);
    editor.on("blur", handleBlur);
    return {
        destroy() {
            if (timer !== null) {
                window.clearTimeout(timer);
                timer = null;
            }
            editor.off("update", handleUpdate);
            editor.off("blur", handleBlur);
        }
    };
};
exports.createAutosaveController = createAutosaveController;
