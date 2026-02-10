export type LayoutRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DocRange = { start: number; end: number };

export type LayoutFragmentKind = "text" | "inline-atom" | "footnote-ref";

export type LayoutFragment = {
  id: string;
  kind: LayoutFragmentKind;
  docRange: DocRange;
  x: number;
  y: number;
  w: number;
  h: number;
  styleKey: string;
  text?: string;
  className?: string;
  attributes?: Record<string, string>;
};

export type LayoutLine = {
  id: string;
  rect: LayoutRect;
  fragments: LayoutFragment[];
};

export type LayoutBlock = {
  id: string;
  rect: LayoutRect;
  lines: LayoutLine[];
  kind: "paragraph" | "header" | "footer" | "footnote" | "atom" | "page-break" | "table-row" | "unknown";
  styleKey?: StyleKey;
  nodeType?: string;
  tableCells?: Array<{ x: number; y: number; w: number; h: number; header?: boolean }>;
  tableHeader?: boolean;
  tableId?: string;
  tableHeaderClone?: boolean;
};

export type LayoutFrameRects = {
  headerRect: LayoutRect;
  bodyRect: LayoutRect;
  footnotesRect: LayoutRect;
  footerRect: LayoutRect;
};

export type LayoutPage = {
  number: number;
  setup: PageSetup;
  frames: LayoutFrameRects;
  items: LayoutBlock[];
  footnotes?: LayoutBlock[];
};

export type LayoutIndex = {
  fragmentsByDocRange: Map<string, LayoutFragment>;
};

export type LayoutResult = {
  pages: LayoutPage[];
  index: LayoutIndex;
  styles?: Record<StyleKey, StyleOverrides>;
  headerHtml?: string;
  footerHtml?: string;
};

export type PageSize = { width: number; height: number; unit: Unit };
export type PageMargins = { top: number; right: number; bottom: number; left: number; unit: Unit };
export type Unit = "twip" | "px" | "pt" | "mm";

export type PageSetup = {
  size: PageSize;
  orientation: "portrait" | "landscape";
  margins: PageMargins;
  headerDistance: number;
  footerDistance: number;
  unit: Unit;
  columns?: number;
  columnGapPx?: number;
  columnWidthPx?: number;
};

export type StyleKey = string;
export type StyleOverrides = Partial<{
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number | string;
  fontStyle: string;
  lineHeightPx: number;
  color?: string;
  backgroundColor?: string;
  textAlign?: "left" | "center" | "right";
  paragraphSpacingBeforePx?: number;
  paragraphSpacingAfterPx?: number;
  firstLineIndentPx?: number;
  leftIndentPx?: number;
  rightIndentPx?: number;
  textDecorationLine?: string;
  textDecorationStyle?: string;
  textDecorationColor?: string;
  textShadow?: string;
  textStroke?: string;
  verticalAlign?: "baseline" | "super" | "sub";
  direction?: "ltr" | "rtl";
  borderPreset?: string;
  borderColor?: string;
  borderWidthPx?: number;
}>;

export type InlineItem =
  | { type: "text"; text: string; styleKey: StyleKey; start: number; end: number; className?: string; attributes?: Record<string, string> }
  | {
      type: "inline-atom";
      id: string;
      width?: number;
      height?: number;
      label?: string;
      styleKey: StyleKey;
      start: number;
      end: number;
      className?: string;
      attributes?: Record<string, string>;
    }
  | { type: "footnote-ref"; noteId: string; styleKey: StyleKey; start: number; end: number; className?: string; attributes?: Record<string, string> };

export type LayoutEngineFeatureFlags = {
  useLayoutV2: boolean;
};
