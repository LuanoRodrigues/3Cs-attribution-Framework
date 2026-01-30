import type { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";

export type StoredSelection = {
  type: "text" | "node";
  anchor: number;
  head: number;
  from: number;
  to: number;
};

let ribbonSelection: StoredSelection | null = null;

const clampPos = (doc: { content: { size: number } }, pos: number) =>
  Math.max(0, Math.min(pos, doc.content.size));

const buildSelection = (doc: Selection["$anchor"]["doc"], stored: StoredSelection): Selection | null => {
  const anchor = clampPos(doc, stored.anchor);
  const head = clampPos(doc, stored.head);
  if (stored.type === "node") {
    const pos = clampPos(doc, stored.from);
    try {
      return NodeSelection.create(doc, pos);
    } catch {
      // Fall back to text selection when node position is no longer valid.
    }
  }
  try {
    return TextSelection.create(doc, anchor, head);
  } catch {
    return null;
  }
};

export const snapshotFromSelection = (selection: Selection): StoredSelection => ({
  type: selection instanceof NodeSelection ? "node" : "text",
  anchor: selection.anchor,
  head: selection.head,
  from: selection.from,
  to: selection.to
});

export const recordRibbonSelection = (selection: StoredSelection): void => {
  ribbonSelection = selection;
};

export const peekRibbonSelection = (): StoredSelection | null => ribbonSelection;

export const consumeRibbonSelection = (): StoredSelection | null => {
  const cached = ribbonSelection;
  ribbonSelection = null;
  return cached;
};

export const applySnapshotToTransaction = (
  tr: Transaction,
  storedSelection?: StoredSelection | null
): Transaction => {
  if (!storedSelection) return tr;
  const selection = buildSelection(tr.doc, storedSelection);
  if (!selection) return tr;
  try {
    return tr.setSelection(selection);
  } catch {
    return tr;
  }
};

export const restoreSelectionFromSnapshot = (
  editor: Editor,
  storedSelection?: StoredSelection | null
): void => {
  if (!storedSelection) return;
  const selection = buildSelection(editor.state.doc, storedSelection);
  if (!selection) return;
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  editor.commands.focus();
};
