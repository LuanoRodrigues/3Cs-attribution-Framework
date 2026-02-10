import type { LayoutBlock } from "../types.ts";

export type BlockLayoutInput = {
  blocks: LayoutBlock[];
  availableWidth: number;
};

export const stackBlocks = (input: BlockLayoutInput): LayoutBlock[] => {
  let y = 0;
  return input.blocks.map((block) => {
    const placed = { ...block, rect: { ...block.rect, y } };
    y += block.rect.h;
    return placed;
  });
};
