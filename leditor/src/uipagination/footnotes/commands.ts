import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type { StoredSelection } from "../../utils/selection_snapshot";
import { applySnapshotToTransaction } from "../../utils/selection_snapshot";
import type { FootnoteKind } from "./model.ts";

const createFootnoteId = (kind: FootnoteKind) =>
  `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const insertFootnoteAtSelection = (
  editor: Editor,
  kind: FootnoteKind,
  text?: string,
  storedSelection?: StoredSelection | null
): string => {
  const footnoteNode = editor.schema.nodes.footnote;
  if (!footnoteNode) {
    throw new Error("Footnote node is not registered in schema");
  }
  const footnoteId = createFootnoteId(kind);
  const contentText = typeof text === "string" ? text.trim() : "";
  const content = contentText.length > 0 ? editor.schema.text(contentText) : null;
  const node = footnoteNode.create({ footnoteId, kind }, content ? [content] : []);
  let tr = editor.state.tr;
  if (storedSelection) {
    try {
      const from = Math.max(0, Math.min(tr.doc.content.size, storedSelection.from));
      const to = Math.max(0, Math.min(tr.doc.content.size, storedSelection.to));
      tr = tr.setSelection(TextSelection.create(tr.doc, from, to));
    } catch {
      tr = applySnapshotToTransaction(tr, storedSelection);
    }
  }
  const beforeFrom = tr.selection.from;
  const beforeTo = tr.selection.to;
  const beforeContext = tr.doc.textBetween(Math.max(0, beforeFrom - 40), Math.min(tr.doc.content.size, beforeTo + 40), " ");
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
  tr = tr.replaceSelectionWith(node);
  if (tr.docChanged) {
    const afterPos = tr.selection.from;
    const afterContext = tr.doc.textBetween(Math.max(0, afterPos - 40), Math.min(tr.doc.content.size, afterPos + 40), " ");
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
    editor.view.dispatch(tr.scrollIntoView());
  } else {
    console.warn("[Footnote][insert] no-op (doc not changed)", { kind, footnoteId });
  }
  return footnoteId;
};
