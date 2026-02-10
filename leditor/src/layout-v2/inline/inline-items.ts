import type { InlineItem, StyleKey } from "../types.ts";

export type InlineItemizer = {
  itemize: (text: string, styleKey: StyleKey, offset: number) => InlineItem[];
};

export const createInlineItemizer = (): InlineItemizer => {
  return {
    itemize: (text: string, styleKey: StyleKey, offset: number): InlineItem[] => {
      return [
        {
          type: "text",
          text,
          styleKey,
          start: offset,
          end: offset + text.length
        }
      ];
    }
  };
};
