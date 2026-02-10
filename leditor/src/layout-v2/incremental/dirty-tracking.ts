export type DirtyRange = { from: number; to: number };

export const mergeDirtyRanges = (ranges: DirtyRange[]): DirtyRange | null => {
  if (ranges.length === 0) return null;
  const from = Math.min(...ranges.map((r) => r.from));
  const to = Math.max(...ranges.map((r) => r.to));
  return { from, to };
};
