import type { Editor } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { StoredSelection } from "../../utils/selection_snapshot";
import { applySnapshotToTransaction, snapshotFromSelection } from "../../utils/selection_snapshot";
import type { FootnoteKind } from "./model.ts";
import { getNextFootnoteId } from "./footnote_id_generator.ts";

export type InsertFootnoteResult = {
  footnoteId: string;
  postInsertSelection: StoredSelection;
};

export const insertFootnoteAtSelection = (
  editor: Editor,
  kind: FootnoteKind,
  text?: string,
  storedSelection?: StoredSelection | null
): InsertFootnoteResult => {
  const footnoteNode = editor.schema.nodes.footnote;
  if (!footnoteNode) {
    throw new Error("Footnote node is not registered in schema");
  }
  const footnoteId = getNextFootnoteId(kind);
  const contentText = typeof text === "string" ? text.trim() : "";
  // Persist footnote text in attrs to keep the marker's nodeSize stable (prevents selection drift).
  // Do not create empty text nodes (ProseMirror disallows them).
  const node = footnoteNode.create({ footnoteId, kind, text: contentText }, []);
  let tr = editor.state.tr;
  if (storedSelection) {
    // Restoring selection can fail if the stored pos no longer points into inline content.
    // Always use Selection.near as a fallback to avoid "jump to end" behavior.
    try {
      tr = applySnapshotToTransaction(tr, storedSelection);
      const sel: any = tr.selection as any;
      const from = Number.isFinite(sel?.from) ? sel.from : storedSelection.from;
      const $from = tr.doc.resolve(Math.max(0, Math.min(tr.doc.content.size, from)));
      if (!$from.parent.inlineContent) {
        tr = tr.setSelection(Selection.near($from, 1));
      }
    } catch {
      const pos = Math.max(0, Math.min(tr.doc.content.size, storedSelection.from));
      tr = tr.setSelection(Selection.near(tr.doc.resolve(pos), 1));
    }
  }
  const beforeFrom = tr.selection.from;
  const beforeTo = tr.selection.to;
  const beforeContext = tr.doc.textBetween(Math.max(0, beforeFrom - 40), Math.min(tr.doc.content.size, beforeTo + 40), " ");
  if ((window as any).__leditorFootnoteDebug) {
    console.info("[Footnote][insert] before", {
      kind,
      footnoteId,
      storedSelection,
      docSize: tr.doc.content.size,
      selection: {
        type: tr.selection.constructor?.name,
        from: tr.selection.from,
        to: tr.selection.to,
        empty: tr.selection.empty
      },
      context: beforeContext
    });
  }
  tr = tr.replaceSelectionWith(node);
  if (tr.docChanged) {
    const postInsertSelection = snapshotFromSelection(tr.selection);
    const afterPos = tr.selection.from;
    const afterContext = tr.doc.textBetween(Math.max(0, afterPos - 40), Math.min(tr.doc.content.size, afterPos + 40), " ");
    if ((window as any).__leditorFootnoteDebug) {
      console.info("[Footnote][insert] after", {
        kind,
        footnoteId,
        docSize: tr.doc.content.size,
        selection: {
          type: tr.selection.constructor?.name,
          from: tr.selection.from,
          to: tr.selection.to,
          empty: tr.selection.empty
        },
        context: afterContext
      });
    }
    editor.view.dispatch(tr.scrollIntoView());
    return { footnoteId, postInsertSelection };
  } else {
    console.warn("[Footnote][insert] no-op (doc not changed)", { kind, footnoteId });
  }
  return { footnoteId, postInsertSelection: storedSelection ?? snapshotFromSelection(editor.state.selection) };
};
