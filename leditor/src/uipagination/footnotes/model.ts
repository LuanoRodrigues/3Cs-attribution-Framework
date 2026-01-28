export type FootnoteKind = "footnote" | "endnote";

export type FootnoteRenderEntry = {
  footnoteId: string;
  number: string;
  text: string;
  kind: FootnoteKind;
  pageIndex: number;
};
