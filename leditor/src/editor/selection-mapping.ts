import type { LayoutResult } from "../layout-v2/types.ts";

export type SelectionMap = {
  toDom: (docPos: number) => { node: HTMLElement | null; offset: number };
  toDoc: (node: Node, offset: number) => number;
};

export const createSelectionMapping = (_layout: LayoutResult): SelectionMap => {
  return {
    toDom: () => ({ node: null, offset: 0 }),
    toDoc: () => 0
  };
};
