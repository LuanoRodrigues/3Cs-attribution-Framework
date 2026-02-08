export type PageBudget = {
  lineHeightPx: number;
  paddingBottomPx: number;
  contentHeightPx: number;
  maxLines: number;
  usedLines: number;
  overflowLines: number;
  freeLines: number;
  scrollHeightPx: number;
};

const readPx = (raw: string | null | undefined, fallback = 0): number => {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const getLineHeightPx = (content: HTMLElement): number => {
  const raw = getComputedStyle(content).lineHeight.trim();
  if (raw === "normal") {
    throw new Error('Computed line-height is "normal"; set explicit line-height.');
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid line-height: "${raw}"`);
  }
  return parsed;
};

export const getPaddingBottomPx = (content: HTMLElement): number =>
  readPx(getComputedStyle(content).paddingBottom, 0);

export const measurePageBudget = (
  content: HTMLElement,
  tolerancePx = 1
): PageBudget => {
  const lineHeightPx = getLineHeightPx(content);
  const paddingBottomPx = getPaddingBottomPx(content);
  const contentHeightPx = Math.max(0, content.clientHeight);
  const scrollHeightPx = Math.max(0, content.scrollHeight);
  const maxLines = Math.max(0, Math.floor((contentHeightPx - paddingBottomPx + tolerancePx) / lineHeightPx));
  const usedLines = Math.max(0, Math.ceil((scrollHeightPx - paddingBottomPx) / lineHeightPx));
  const overflowLines = Math.max(0, usedLines - maxLines);
  const freeLines = Math.max(0, maxLines - usedLines);
  return {
    lineHeightPx,
    paddingBottomPx,
    contentHeightPx,
    maxLines,
    usedLines,
    overflowLines,
    freeLines,
    scrollHeightPx
  };
};
