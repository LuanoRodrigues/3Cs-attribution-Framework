export type FootnoteLayoutSnapshot = {
  pageCount: number;
  heightsByIndex: number[];
  gapByIndex: number[];
  guardByIndex: number[];
  signature: string;
};

const readPx = (value: string | null | undefined, fallback = 0): number => {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const readFootnoteLayoutSnapshot = (root?: HTMLElement | null): FootnoteLayoutSnapshot => {
  const host = root ?? document.documentElement;
  const pages = Array.from(host.querySelectorAll<HTMLElement>(".leditor-page"));
  const heightsByIndex: number[] = [];
  const gapByIndex: number[] = [];
  const guardByIndex: number[] = [];
  pages.forEach((page, index) => {
    const rawIndex = (page.dataset.pageIndex ?? "").trim();
    const parsedIndex = rawIndex.length > 0 ? Number(rawIndex) : Number.NaN;
    const pageIndex = Number.isFinite(parsedIndex) ? parsedIndex : index;
    const style = getComputedStyle(page);
    heightsByIndex[pageIndex] = readPx(style.getPropertyValue("--page-footnote-height"), 0);
    gapByIndex[pageIndex] = readPx(style.getPropertyValue("--page-footnote-gap"), 0);
    guardByIndex[pageIndex] = readPx(style.getPropertyValue("--page-footnote-guard"), 0);
  });
  const signature = [
    `pages:${pages.length}`,
    ...heightsByIndex.map((h, idx) => `${idx}:${h}:${gapByIndex[idx] ?? 0}:${guardByIndex[idx] ?? 0}`)
  ].join("|");
  return {
    pageCount: pages.length,
    heightsByIndex,
    gapByIndex,
    guardByIndex,
    signature
  };
};
