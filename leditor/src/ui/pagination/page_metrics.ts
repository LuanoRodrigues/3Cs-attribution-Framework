import { getDocumentLayoutSpec } from "./document_layout_state.ts";

type DocumentLayoutSpec = ReturnType<typeof getDocumentLayoutSpec>;

type PageMetrics = {
  pageWidthPx: number;
  pageHeightPx: number;
  contentWidthPx: number;
  contentHeightPx: number;
  marginTopPx: number;
  marginRightPx: number;
  marginBottomPx: number;
  marginLeftPx: number;
  headerDistancePx: number;
  footerDistancePx: number;
  pageGapPx: number;
  tolerancePx: number;
};

type PageMetricsInput = {
  page: HTMLElement;
  pageContent: HTMLElement;
  pageStack: HTMLElement;
};

const readPx = (value: string, label: string): number => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid CSS px value for ${label}: "${value}".`);
  }
  return parsed;
};

const resolveCssLength = (value: string, anchor: HTMLElement): number => {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.width = value;
  anchor.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  if (!Number.isFinite(width)) {
    throw new Error(`Unable to resolve CSS length: "${value}".`);
  }
  return width;
};

export const computeSpecPx = (valueIn: number, spec: DocumentLayoutSpec = getDocumentLayoutSpec()): number => {
  if (!Number.isFinite(valueIn)) {
    throw new Error("computeSpecPx requires a finite inch value.");
  }
  const units = spec.units;
  if (!units || !Number.isFinite(units.pxPerIn)) {
    throw new Error("DocumentLayoutSpec units.pxPerIn is missing or invalid.");
  }
  const raw = valueIn * units.pxPerIn;
  const rounding = units.roundingPolicy?.pxRounding ?? "round";
  if (rounding === "round") return Math.round(raw);
  if (rounding === "floor") return Math.floor(raw);
  if (rounding === "ceil") return Math.ceil(raw);
  throw new Error(`Unsupported px rounding policy: ${rounding}`);
};

export const derivePageMetrics = ({ page, pageContent, pageStack }: PageMetricsInput): PageMetrics => {
  const spec = getDocumentLayoutSpec();
  const pageRect = page.getBoundingClientRect();
  const contentRect = pageContent.getBoundingClientRect();
  if (pageRect.width <= 0 || pageRect.height <= 0) {
    throw new Error("Page metrics require a rendered page element.");
  }
  const pageWidthPx = pageRect.width;
  const pageHeightPx = pageRect.height;
  const contentWidthPx = pageContent.clientWidth;
  const contentHeightPx = pageContent.clientHeight;
  if (contentWidthPx <= 0 || contentHeightPx <= 0) {
    throw new Error("Page content has non-positive dimensions.");
  }
  const marginTopPx = Math.max(0, contentRect.top - pageRect.top);
  const marginRightPx = Math.max(0, pageRect.right - contentRect.right);
  const marginBottomPx = Math.max(0, pageRect.bottom - contentRect.bottom);
  const marginLeftPx = Math.max(0, contentRect.left - pageRect.left);
  const rootStyle = getComputedStyle(document.documentElement);
  const headerDistanceValue = rootStyle.getPropertyValue("--header-height").trim();
  const footerDistanceValue = rootStyle.getPropertyValue("--footer-height").trim();
  const headerDistanceIn = spec.headerFooter?.default?.headerDistanceIn;
  const footerDistanceIn = spec.headerFooter?.default?.footerDistanceIn;
  if (!Number.isFinite(headerDistanceIn) || !Number.isFinite(footerDistanceIn)) {
    throw new Error("DocumentLayoutSpec header/footer default distances are missing.");
  }
  const headerDistancePx = headerDistanceValue
    ? resolveCssLength(headerDistanceValue, page)
    : computeSpecPx(headerDistanceIn, spec);
  const footerDistancePx = footerDistanceValue
    ? resolveCssLength(footerDistanceValue, page)
    : computeSpecPx(footerDistanceIn, spec);
  const stackStyle = getComputedStyle(pageStack);
  const pageGapValue = stackStyle.rowGap || stackStyle.gap || "0px";
  const pageGapPx = readPx(pageGapValue, "pageGap");
  const tolerancePx = spec.pagination?.measurement?.tolerancePx;
  if (!Number.isFinite(tolerancePx)) {
    throw new Error("Pagination tolerancePx is invalid.");
  }
  return {
    pageWidthPx,
    pageHeightPx,
    contentWidthPx,
    contentHeightPx,
    marginTopPx,
    marginRightPx,
    marginBottomPx,
    marginLeftPx,
    headerDistancePx,
    footerDistancePx,
    pageGapPx,
    tolerancePx
  };
};

export type { PageMetrics };
