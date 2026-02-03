export type SelectionMode = "normal" | "extend" | "add" | "block";
export type InsertMode = "insert" | "overwrite";

let selectionMode: SelectionMode = "normal";
let insertMode: InsertMode = "insert";

const updateBodyClasses = () => {
  if (typeof document === "undefined") return;
  const root = document.getElementById("leditor-app") ?? document.body;
  root.classList.toggle("leditor-selection-extend", selectionMode === "extend");
  root.classList.toggle("leditor-selection-add", selectionMode === "add");
  root.classList.toggle("leditor-selection-block", selectionMode === "block");
  root.classList.toggle("leditor-insert-overwrite", insertMode === "overwrite");
};

const emitModeEvent = (name: string, detail: Record<string, unknown>) => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // ignore
  }
};

export const getSelectionMode = (): SelectionMode => selectionMode;

export const setSelectionMode = (mode: SelectionMode) => {
  selectionMode = mode;
  updateBodyClasses();
  emitModeEvent("leditor:selection-mode", { mode });
};

export const toggleSelectionMode = (mode: SelectionMode) => {
  setSelectionMode(selectionMode === mode ? "normal" : mode);
};

export const getInsertMode = (): InsertMode => insertMode;

export const setInsertMode = (mode: InsertMode) => {
  insertMode = mode;
  updateBodyClasses();
  emitModeEvent("leditor:insert-mode", { mode });
};

export const toggleInsertMode = () => {
  setInsertMode(insertMode === "insert" ? "overwrite" : "insert");
};
