import type { Editor } from "@tiptap/core";
import type { EditorHandle } from "../api/leditor.js";

declare global {
  interface Window {
    codexLog?: {
      write: (line: string) => void;
    };
  }
}

type PhaseFlags = {
  saved: boolean;
  retrieved: boolean;
  restored: boolean;
  undoRedo: boolean;
  logged: boolean;
};

const phaseFlags: PhaseFlags = {
  saved: false,
  retrieved: false,
  restored: false,
  undoRedo: false,
  logged: false
};

const autosaveStore = new Map<string, object>();

const cloneSnapshot = (snapshot: object) => JSON.parse(JSON.stringify(snapshot)) as object;

const maybeLogPhase = () => {
  if (phaseFlags.logged) return;
  if (!phaseFlags.saved || !phaseFlags.retrieved || !phaseFlags.restored || !phaseFlags.undoRedo) {
    return;
  }
  window.codexLog?.write("[PHASE13_OK]");
  phaseFlags.logged = true;
};

export const notifyAutosaveUndoRedo = () => {
  if (!phaseFlags.restored) return;
  phaseFlags.undoRedo = true;
  maybeLogPhase();
};

export const autosaveSnapshot = (editor: Editor, editorInstanceId: string) => {
  const snapshot = editor.getJSON();
  autosaveStore.set(editorInstanceId, cloneSnapshot(snapshot));
  phaseFlags.saved = true;
  maybeLogPhase();
};

export const getAutosaveSnapshot = (editorInstanceId: string): object | null => {
  const snapshot = autosaveStore.get(editorInstanceId) ?? null;
  if (snapshot) {
    phaseFlags.retrieved = true;
    maybeLogPhase();
  }
  return snapshot ? cloneSnapshot(snapshot) : null;
};

export const restoreAutosaveSnapshot = (editorHandle: EditorHandle, editorInstanceId: string) => {
  const snapshot = autosaveStore.get(editorInstanceId);
  if (!snapshot) return;
  editorHandle.setContent(snapshot, { format: "json" });
  phaseFlags.restored = true;
  maybeLogPhase();
};

export const createAutosaveController = (
  editor: Editor,
  editorInstanceId: string,
  intervalMs: number
) => {
  let timer: number | null = null;

  const schedule = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      autosaveSnapshot(editor, editorInstanceId);
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
    autosaveSnapshot(editor, editorInstanceId);
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
