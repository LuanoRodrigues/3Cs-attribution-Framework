import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

export type FootnoteKind = "footnote" | "endnote";

export type FootnoteRenderEntry = {
  footnoteId: string;
  number: string;
  text: string;
  kind: FootnoteKind;
  source: "manual" | "citation";
  pageIndex: number;
  body: ProseMirrorNode | null;
};
