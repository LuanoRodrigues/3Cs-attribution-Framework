import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { FootnoteKind } from "./model.ts";

export type FootnoteNumbering = {
  numbering: Map<string, number>;
};

export const reconcileFootnotes = (doc: ProseMirrorNode): FootnoteNumbering => {
  const numbering = new Map<string, number>();
  let footnoteCounter = 0;
  let endnoteCounter = 0;
  doc.descendants((node) => {
    if (node.type.name !== "footnote") return true;
    const id = typeof node.attrs?.footnoteId === "string" ? node.attrs.footnoteId : "";
    if (!id) return true;
    const kind = (typeof node.attrs?.kind === "string" ? node.attrs.kind : "footnote") as FootnoteKind;
    if (kind === "endnote") {
      endnoteCounter += 1;
      numbering.set(id, endnoteCounter);
    } else {
      footnoteCounter += 1;
      numbering.set(id, footnoteCounter);
    }
    return true;
  });
  return { numbering };
};
