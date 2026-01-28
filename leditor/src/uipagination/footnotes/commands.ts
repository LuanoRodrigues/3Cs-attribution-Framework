import type { Editor } from "@tiptap/core";
import type { FootnoteKind } from "./model.ts";

const createFootnoteId = (kind: FootnoteKind) =>
  `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const insertFootnoteAtSelection = (editor: Editor, kind: FootnoteKind, text?: string): string => {
  const footnoteNode = editor.schema.nodes.footnote;
  if (!footnoteNode) {
    throw new Error("Footnote node is not registered in schema");
  }
  const footnoteId = createFootnoteId(kind);
  const contentText = typeof text === "string" && text.trim().length > 0 ? text.trim() : "Footnote";
  editor
    .chain()
    .focus()
    .insertContent({
      type: "footnote",
      attrs: { footnoteId, kind },
      content: [{ type: "text", text: contentText }]
    })
    .run();
  return footnoteId;
};
