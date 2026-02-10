import type { LayoutBlock } from "../types.ts";

export type FootnoteRef = { noteId: string; page: number };

export const collectFootnotes = (_blocks: LayoutBlock[]): FootnoteRef[] => {
  return [];
};
