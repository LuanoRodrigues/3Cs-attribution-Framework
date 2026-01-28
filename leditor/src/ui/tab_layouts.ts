export type TabGroupLayout = {
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: string;
  gridAutoColumns?: string;
  columnGap?: string;
  rowGap?: string;
};

export const tabLayouts: Record<string, Record<string, TabGroupLayout>> = {};
