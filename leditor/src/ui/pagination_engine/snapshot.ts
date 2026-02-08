import { derivePageMetrics } from "../pagination/page_metrics.ts";
import { documentLayoutSpec } from "../pagination/layout_spec.ts";
import { getPaginationPolicy } from "./policy.ts";
import { hashSignature, stableStringify } from "./signature.ts";

export type PageChromeMetrics = {
  pageIndex: number;
  pageHeightPx: number;
  pageWidthPx: number;
  contentHeightPx: number;
  paddingBottomPx: number;
  marginTopPx: number;
  marginBottomPx: number;
  headerDistancePx: number;
  headerHeightPx: number;
  footerDistancePx: number;
  footerHeightPx: number;
  footnoteGapPx: number;
  footnoteHeightPx: number;
  footnoteGuardPx: number;
  lineHeightPx: number;
  tolerancePx: number;
  bodyHeightPx: number;
  maxLines: number;
  usedLines: number;
  overflowLines: number;
  freeLines: number;
  horizontalOverflow: boolean;
};

export type PaginationSnapshot = {
  docEpoch: number | null;
  layoutEpoch: number | null;
  fontsLoading: boolean;
  recentOverflow: boolean;
  recentFootnoteChange: boolean;
  recentSplit: boolean;
  pageChromeByIndex: PageChromeMetrics[];
  signature: string;
  hash: string;
};

const readPx = (raw: string | null | undefined, fallback = 0): number => {
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readCssPx = (el: HTMLElement | null, prop: string, fallback = 0): number => {
  if (!el) return fallback;
  return readPx(getComputedStyle(el).getPropertyValue(prop).trim(), fallback);
};

const getPageScale = (page: HTMLElement, content: HTMLElement | null): number => {
  const pageRect = page.getBoundingClientRect();
  const cssHeight = readCssPx(page, "--page-height", 0);
  if (cssHeight > 0 && pageRect.height > 0) {
    const scale = pageRect.height / cssHeight;
    if (Number.isFinite(scale) && scale > 0) return scale;
  }
  if (content) {
    const contentRect = content.getBoundingClientRect();
    const clientHeight = content.clientHeight || 0;
    if (clientHeight > 0 && contentRect.height > 0) {
      const scale = contentRect.height / clientHeight;
      if (Number.isFinite(scale) && scale > 0) return scale;
    }
  }
  return 1;
};

const isRecent = (ts: unknown, windowMs: number): boolean => {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return false;
  return performance.now() - ts < windowMs;
};

export const buildPaginationSnapshot = (params: {
  root?: HTMLElement | null;
  recentSplitAt?: number | null;
} = {}): PaginationSnapshot => {
  const root = params.root ?? document.documentElement;
  const policy = getPaginationPolicy();
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>(`.${documentLayoutSpec.pagination?.pageClass ?? "leditor-page"}`)
  );
  const pageChromeByIndex: PageChromeMetrics[] = [];
  const pageHeightPxToken = readCssPx(root, "--page-height", 0);
  const pageWidthPxToken = readCssPx(root, "--page-width", 0);
  pages.forEach((page, index) => {
    const rawIndex = (page.dataset.pageIndex ?? "").trim();
    const parsedIndex = rawIndex.length > 0 ? Number(rawIndex) : Number.NaN;
    const pageIndex = Number.isFinite(parsedIndex) ? parsedIndex : index;
    const content =
      page.querySelector<HTMLElement>(".leditor-page-content") ??
      page.querySelector<HTMLElement>(`.${documentLayoutSpec.pagination?.pageContentClass ?? "leditor-page-content"}`);
    const header =
      page.querySelector<HTMLElement>(".leditor-page-header") ??
      page.querySelector<HTMLElement>(`.${documentLayoutSpec.pagination?.pageHeaderClass ?? "leditor-page-header"}`);
    const footer =
      page.querySelector<HTMLElement>(".leditor-page-footer") ??
      page.querySelector<HTMLElement>(`.${documentLayoutSpec.pagination?.pageFooterClass ?? "leditor-page-footer"}`);
    const scale = getPageScale(page, content);
    const pageHeightPx = pageHeightPxToken > 0 ? pageHeightPxToken : page.getBoundingClientRect().height / scale;
    const pageWidthPx = pageWidthPxToken > 0 ? pageWidthPxToken : page.getBoundingClientRect().width / scale;

    const marginTopPx = readCssPx(page, "--local-page-margin-top", readCssPx(root, "--page-margin-top", 0));
    const marginBottomPx = readCssPx(page, "--local-page-margin-bottom", readCssPx(root, "--page-margin-bottom", 0));
    const headerDistancePx = readCssPx(page, "--doc-header-distance", 0);
    const footerDistancePx = readCssPx(page, "--doc-footer-distance", 0);
    const headerHeightPx = header ? header.getBoundingClientRect().height / scale : readCssPx(page, "--header-height", 0);
    const footerHeightPx = footer ? footer.getBoundingClientRect().height / scale : readCssPx(page, "--footer-height", 0);
    const footnoteGapPx = readCssPx(page, "--page-footnote-gap", readCssPx(root, "--page-footnote-gap", 0));
    const footnoteHeightPx = readCssPx(page, "--page-footnote-height", 0);
    const footnoteGuardPx = readCssPx(page, "--page-footnote-guard", 0);

    let lineHeightPx = 0;
    let tolerancePx = policy.numeric.tolerancePx;
    try {
      if (content) {
        const metrics = derivePageMetrics({
          page,
          pageContent: content,
          pageStack:
            page.closest<HTMLElement>(".leditor-page-stack") ??
            (root.querySelector<HTMLElement>(".leditor-page-stack") ?? page.parentElement ?? page)
        });
        lineHeightPx = metrics.lineHeightPx;
        tolerancePx = metrics.tolerancePx;
      }
    } catch {
      const raw = content ? getComputedStyle(content).lineHeight : "";
      lineHeightPx = readPx(raw, 16);
    }

    const contentHeightPx = content ? Math.max(0, content.clientHeight) : Math.max(0, pageHeightPx - marginTopPx - marginBottomPx);
    const paddingBottomPx = content ? readPx(getComputedStyle(content).paddingBottom, 0) : 0;
    const bodyHeightPx = Math.max(0, contentHeightPx);
    const maxLines =
      lineHeightPx > 0
        ? Math.max(0, Math.floor((bodyHeightPx - paddingBottomPx + tolerancePx) / lineHeightPx))
        : 0;
    const scrollHeightPx = content ? Math.max(0, content.scrollHeight) : 0;
    const clientWidthPx = content ? Math.max(0, content.clientWidth) : 0;
    const scrollWidthPx = content ? Math.max(0, content.scrollWidth) : 0;
    const horizontalOverflow = clientWidthPx > 0 ? scrollWidthPx - clientWidthPx > 2 : false;
    const usedLines =
      lineHeightPx > 0 ? Math.max(0, Math.ceil((scrollHeightPx - paddingBottomPx) / lineHeightPx)) : 0;
    const overflowLines = Math.max(0, usedLines - maxLines, horizontalOverflow ? 1 : 0);
    const freeLines = Math.max(0, maxLines - usedLines);

    pageChromeByIndex.push({
      pageIndex,
      pageHeightPx,
      pageWidthPx,
      contentHeightPx,
      paddingBottomPx,
      marginTopPx,
      marginBottomPx,
      headerDistancePx,
      headerHeightPx,
      footerDistancePx,
      footerHeightPx,
      footnoteGapPx,
      footnoteHeightPx,
      footnoteGuardPx,
      lineHeightPx,
      tolerancePx,
      bodyHeightPx,
      maxLines,
      usedLines,
      overflowLines,
      freeLines,
      horizontalOverflow
    });
  });

  const signatureBase = stableStringify({
    pageCount: pageChromeByIndex.length,
    pages: pageChromeByIndex.map((page) => ({
      i: page.pageIndex,
      h: page.bodyHeightPx,
      l: page.lineHeightPx,
      u: page.usedLines,
      o: page.overflowLines,
      x: page.horizontalOverflow ? 1 : 0,
      f: page.footnoteHeightPx,
      g: page.footnoteGapPx,
      guard: page.footnoteGuardPx
    }))
  });
  const docEpoch = typeof (window as any).__leditorDocEpoch === "number" ? (window as any).__leditorDocEpoch : null;
  const layoutEpoch =
    typeof (window as any).__leditorFootnoteLayoutEpoch === "number"
      ? (window as any).__leditorFootnoteLayoutEpoch
      : null;
  const fontsLoading = typeof document !== "undefined" && document.fonts?.status === "loading";
  const recentOverflow = isRecent((window as any).__leditorPaginationOverflowAt, 4000);
  const recentFootnoteChange = isRecent((window as any).__leditorFootnoteLayoutChangedAt, 1500);
  const recentSplit =
    typeof params.recentSplitAt === "number" && Number.isFinite(params.recentSplitAt)
      ? isRecent(params.recentSplitAt, 2500)
      : false;

  return {
    docEpoch,
    layoutEpoch,
    fontsLoading,
    recentOverflow,
    recentFootnoteChange,
    recentSplit,
    pageChromeByIndex,
    signature: signatureBase,
    hash: hashSignature(signatureBase)
  };
};
