import type { LayoutBlock } from "../types.ts";

export type FootnoteLayoutResult = {
  blocks: LayoutBlock[];
  height: number;
};

export const layoutFootnotes = (_refs: any[], _availableWidth: number): FootnoteLayoutResult => {
  return { blocks: [], height: 0 };
};
