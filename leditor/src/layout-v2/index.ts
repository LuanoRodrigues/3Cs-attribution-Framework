import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createStyleResolver } from "./style/resolve-style.ts";
import { createDefaultComputedStyle, type ComputedStyle } from "./style/computed-style.ts";
import { layoutParagraph } from "./block/paragraph-layout.ts";
import { stackBlocks } from "./block/block-layout.ts";
import { paginate } from "./paginate/paginator.ts";
import { computeFramesPx } from "./paginate/page-setup.ts";
import type {
  InlineItem,
  LayoutBlock,
  LayoutFragment,
  LayoutLine,
  LayoutResult,
  PageSetup,
  StyleKey,
  StyleOverrides
} from "./types.ts";
import { cmToPx, ptToPx } from "../utils/pageUnits.ts";

export type LayoutDocumentInput = {
  doc: ProseMirrorNode;
  setup: PageSetup;
  headerHtml?: string;
  footerHtml?: string;
};

const defaultPageSetup: PageSetup = {
  size: { width: 210, height: 297, unit: "mm" },
  orientation: "portrait",
  margins: { top: 20, right: 20, bottom: 20, left: 20, unit: "mm" },
  headerDistance: 12,
  footerDistance: 12,
  unit: "mm"
};

const PAGE_SIZE_PRESETS: Record<string, { widthMm: number; heightMm: number }> = {
  a4: { widthMm: 210, heightMm: 297 },
  a5: { widthMm: 148, heightMm: 210 },
  a3: { widthMm: 297, heightMm: 420 },
  letter: { widthMm: 215.9, heightMm: 279.4 }
};

const pageSetupFromDoc = (doc: ProseMirrorNode): PageSetup | null => {
  const attrs = (doc.attrs ?? {}) as Record<string, unknown>;
  const pageSizeId = typeof attrs.pageSizeId === "string" ? attrs.pageSizeId.toLowerCase() : "a4";
  const preset = PAGE_SIZE_PRESETS[pageSizeId] ?? PAGE_SIZE_PRESETS.a4;
  const widthMm = parseNumeric(attrs.pageWidthMm) ?? preset.widthMm;
  const heightMm = parseNumeric(attrs.pageHeightMm) ?? preset.heightMm;
  const orientation = attrs.orientation === "landscape" ? "landscape" : "portrait";
  const marginsTopCm = parseNumeric(attrs.marginsTopCm) ?? 2.54;
  const marginsRightCm = parseNumeric(attrs.marginsRightCm) ?? 2.54;
  const marginsBottomCm = parseNumeric(attrs.marginsBottomCm) ?? 2.54;
  const marginsLeftCm = parseNumeric(attrs.marginsLeftCm) ?? 2.54;
  const columns = Math.max(1, Math.floor(parseNumeric(attrs.columns) ?? 1));
  const columnGapIn = parseNumeric(attrs.columnGapIn);
  const columnWidthIn = parseNumeric(attrs.columnWidthIn);
  return {
    size: { width: widthMm, height: heightMm, unit: "mm" },
    orientation,
    margins: {
      top: marginsTopCm * 10,
      right: marginsRightCm * 10,
      bottom: marginsBottomCm * 10,
      left: marginsLeftCm * 10,
      unit: "mm"
    },
    headerDistance: defaultPageSetup.headerDistance,
    footerDistance: defaultPageSetup.footerDistance,
    unit: "mm",
    columns,
    columnGapPx: columnGapIn && columnGapIn > 0 ? columnGapIn * 96 : undefined,
    columnWidthPx: columnWidthIn && columnWidthIn > 0 ? columnWidthIn * 96 : undefined
  };
};

const DEFAULT_STYLE_KEY = "default";

const parseNumeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseLineHeightPx = (raw: unknown, fontSizePx: number): number | null => {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const pxMatch = trimmed.match(/^([0-9.]+)px$/);
  if (pxMatch) {
    const parsed = Number.parseFloat(pxMatch[1]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  const pctMatch = trimmed.match(/^([0-9.]+)%$/);
  if (pctMatch) {
    const parsed = Number.parseFloat(pctMatch[1]);
    if (!Number.isFinite(parsed)) return null;
    return (parsed / 100) * fontSizePx;
  }
  const numeric = Number.parseFloat(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric * fontSizePx;
  }
  return null;
};

const normalizeTextAlign = (value: unknown): "left" | "center" | "right" | null => {
  if (value === "center") return "center";
  if (value === "right") return "right";
  if (value === "justify") return "left";
  if (value === "left") return "left";
  return null;
};

const getHeadingFontSize = (level: number): number => {
  if (level <= 1) return 28;
  if (level === 2) return 24;
  if (level === 3) return 20;
  if (level === 4) return 18;
  if (level === 5) return 16;
  return 14;
};

const estimateTextWidth = (text: string, fontSizePx: number): number => {
  if (!text) return 0;
  return text.length * (fontSizePx * 0.6);
};

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, "").trim();

const cloneLines = (lines: LayoutLine[], offsetY: number, idPrefix: string, offsetX = 0): LayoutLine[] =>
  lines.map((line, index) => {
    const lineId = `${idPrefix}-line-${index}`;
    const rect = { ...line.rect, x: line.rect.x + offsetX, y: line.rect.y - offsetY };
    const fragments = line.fragments.map((fragment, fragIndex) => ({
      ...fragment,
      id: `${lineId}-frag-${fragIndex}`,
      x: fragment.x + offsetX,
      y: fragment.y - offsetY
    }));
    return { ...line, id: lineId, rect, fragments };
  });

const computeSpacingAfter = (block: LayoutBlock): number => {
  if (block.lines.length === 0) return 0;
  const last = block.lines[block.lines.length - 1];
  const lastBottom = last.rect.y + last.rect.h;
  return Math.max(0, block.rect.h - lastBottom);
};

const splitBlockByHeight = (block: LayoutBlock, remaining: number): { head: LayoutBlock; tail: LayoutBlock } | null => {
  if (block.lines.length < 2) return null;
  let fitCount = 0;
  for (const line of block.lines) {
    const bottom = line.rect.y + line.rect.h;
    if (bottom <= remaining + 0.01) {
      fitCount += 1;
    } else {
      break;
    }
  }
  if (fitCount <= 0 || fitCount >= block.lines.length) return null;
  const spacingAfter = computeSpacingAfter(block);
  const headLines = block.lines.slice(0, fitCount);
  const tailLines = block.lines.slice(fitCount);
  const headLast = headLines[headLines.length - 1];
  const headBottom = headLast.rect.y + headLast.rect.h;
  const tailOffset = tailLines[0].rect.y;
  const tailLinesRebased = cloneLines(tailLines, tailOffset, `${block.id}:tail`);
  const tailLast = tailLinesRebased[tailLinesRebased.length - 1];
  const tailBottom = tailLast.rect.y + tailLast.rect.h;
  return {
    head: {
      ...block,
      id: `${block.id}:head:${fitCount}`,
      rect: { ...block.rect, y: 0, h: headBottom },
      lines: cloneLines(headLines, 0, `${block.id}:head`)
    },
    tail: {
      ...block,
      id: `${block.id}:tail:${fitCount}`,
      rect: { ...block.rect, y: 0, h: tailBottom + spacingAfter },
      lines: tailLinesRebased
    }
  };
};

const placeBlocksInColumns = (
  blocks: LayoutBlock[],
  rect: { w: number; h: number },
  columnCount: number,
  columnGap: number
): { placed: LayoutBlock[]; overflow: LayoutBlock[] } => {
  const placed: LayoutBlock[] = [];
  const overflow: LayoutBlock[] = [];
  if (blocks.length === 0) return { placed, overflow };
  const count = Math.max(1, Math.floor(columnCount));
  const gap = count > 1 ? columnGap : 0;
  const columnWidth = count > 1 ? Math.max(0, (rect.w - gap * (count - 1)) / count) : rect.w;
  const columnStride = columnWidth + gap;
  let columnIndex = 0;
  let cursorY = 0;
  const stack = [...blocks];

  const offsetBlock = (block: LayoutBlock, offsetX: number, offsetY: number): LayoutBlock => {
    const lines = block.lines.map((line) => ({
      ...line,
      rect: { ...line.rect, x: line.rect.x + offsetX, y: line.rect.y + offsetY },
      fragments: line.fragments.map((fragment) => ({
        ...fragment,
        x: fragment.x + offsetX,
        y: fragment.y + offsetY
      }))
    }));
    return {
      ...block,
      rect: { ...block.rect, x: offsetX, y: offsetY },
      lines
    };
  };

  let index = 0;
  while (index < stack.length) {
    const block = stack[index];
    const remaining = rect.h - cursorY;
    if (block.rect.h <= remaining + 0.01) {
      const offsetX = columnIndex * columnStride;
      placed.push(offsetBlock(block, offsetX, cursorY));
      cursorY += block.rect.h;
      index += 1;
      continue;
    }
    const split = splitBlockByHeight(block, remaining);
    if (split) {
      const offsetX = columnIndex * columnStride;
      placed.push(offsetBlock(split.head, offsetX, cursorY));
      cursorY += split.head.rect.h;
      if (columnIndex + 1 < count) {
        columnIndex += 1;
        cursorY = 0;
        stack[index] = split.tail;
        continue;
      }
      overflow.push(split.tail, ...stack.slice(index + 1));
      return { placed, overflow };
    }
    if (columnIndex + 1 < count) {
      columnIndex += 1;
      cursorY = 0;
      continue;
    }
    overflow.push(...stack.slice(index));
    return { placed, overflow };
  }
  return { placed, overflow };
};

const extractParagraphOverrides = (node: ProseMirrorNode, baseStyle: ComputedStyle): StyleOverrides => {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const overrides: StyleOverrides = {};
  const isHeading = node.type?.name === "heading";
  if (isHeading) {
    const level = Number(attrs.level ?? 1);
    overrides.fontSizePx = getHeadingFontSize(Number.isFinite(level) ? level : 1);
    overrides.fontWeight = 600;
  }
  const fontSizePx = (overrides.fontSizePx ?? baseStyle.fontSizePx) as number;
  const lineHeightPx = parseLineHeightPx(attrs.lineHeight, fontSizePx);
  if (lineHeightPx && Number.isFinite(lineHeightPx)) {
    overrides.lineHeightPx = lineHeightPx;
  } else if (isHeading && baseStyle.fontSizePx > 0) {
    const ratio = baseStyle.lineHeightPx / baseStyle.fontSizePx;
    const derived = Math.max(fontSizePx * ratio, fontSizePx * 1.1);
    overrides.lineHeightPx = derived;
  }
  const textAlign = normalizeTextAlign(attrs.textAlign);
  if (textAlign) {
    overrides.textAlign = textAlign;
  }
  const spaceBeforePt = parseNumeric(attrs.spaceBeforePt);
  const spaceAfterPt = parseNumeric(attrs.spaceAfterPt);
  const spaceBefore = parseNumeric(attrs.spaceBefore);
  const spaceAfter = parseNumeric(attrs.spaceAfter);
  const beforePx =
    spaceBeforePt && spaceBeforePt > 0
      ? ptToPx(spaceBeforePt)
      : spaceBefore && spaceBefore > 0
        ? spaceBefore
        : 0;
  const afterPx =
    spaceAfterPt && spaceAfterPt > 0
      ? ptToPx(spaceAfterPt)
      : spaceAfter && spaceAfter > 0
        ? spaceAfter
        : 0;
  if (beforePx > 0) overrides.paragraphSpacingBeforePx = beforePx;
  if (afterPx > 0) overrides.paragraphSpacingAfterPx = afterPx;
  if (isHeading) {
    if (overrides.paragraphSpacingBeforePx == null) {
      overrides.paragraphSpacingBeforePx = Math.max(8, fontSizePx * 0.4);
    }
    if (overrides.paragraphSpacingAfterPx == null) {
      overrides.paragraphSpacingAfterPx = Math.max(4, fontSizePx * 0.2);
    }
  }

  const indentLeftCm = parseNumeric(attrs.indentLeftCm);
  const indentRightCm = parseNumeric(attrs.indentRightCm);
  const indentLevel = parseNumeric(attrs.indentLevel);
  const indentRight = parseNumeric(attrs.indentRight);
  const leftIndentPx =
    indentLeftCm && indentLeftCm > 0
      ? cmToPx(indentLeftCm)
      : indentLevel && indentLevel > 0
        ? indentLevel * fontSizePx
        : 0;
  const rightIndentPx =
    indentRightCm && indentRightCm > 0
      ? cmToPx(indentRightCm)
      : indentRight && indentRight > 0
        ? indentRight
        : 0;
  if (leftIndentPx > 0) overrides.leftIndentPx = leftIndentPx;
  if (rightIndentPx > 0) overrides.rightIndentPx = rightIndentPx;
  const borderPreset = typeof attrs.borderPreset === "string" ? attrs.borderPreset : null;
  if (borderPreset) overrides.borderPreset = borderPreset;
  const borderColor = typeof attrs.borderColor === "string" ? attrs.borderColor : null;
  if (borderColor) overrides.borderColor = borderColor;
  const borderWidth = parseNumeric(attrs.borderWidth);
  if (borderWidth && borderWidth > 0) overrides.borderWidthPx = borderWidth;
  const dir = attrs.dir === "rtl" || attrs.dir === "ltr" ? (attrs.dir as "rtl" | "ltr") : null;
  if (dir) overrides.direction = dir;
  return overrides;
};

type ListContext = {
  depth: number;
  type: "bullet" | "ordered" | null;
  index: number | null;
  isFirstParagraph: boolean;
};

const getListContext = (doc: ProseMirrorNode, pos: number): ListContext => {
  if (typeof (doc as any).resolve !== "function") {
    return { depth: 0, type: null, index: null, isFirstParagraph: false };
  }
  const resolved = doc.resolve(pos);
  let depth = 0;
  let type: "bullet" | "ordered" | null = null;
  let index: number | null = null;
  let isFirstParagraph = false;

  for (let d = resolved.depth; d > 0; d -= 1) {
    const node = resolved.node(d);
    if (node.type?.name !== "listItem") continue;
    depth += 1;
    const listNode = resolved.node(d - 1);
    if (!type && listNode?.type?.name) {
      if (listNode.type.name === "bulletList") {
        type = "bullet";
      } else if (listNode.type.name === "orderedList") {
        type = "ordered";
      }
      if (type === "ordered") {
        const rawStart = parseNumeric((listNode.attrs as any)?.order);
        const start = rawStart && rawStart > 0 ? rawStart : 1;
        const idx = resolved.index(d - 1);
        index = start + idx;
      }
    }
    if (!isFirstParagraph) {
      const itemChildIndex = resolved.index(d);
      if (itemChildIndex === 0) {
        isFirstParagraph = true;
      }
    }
  }

  return { depth, type, index, isFirstParagraph };
};

type InlineMeta = {
  overrides: StyleOverrides;
  className?: string;
  attributes?: Record<string, string>;
};

const extractInlineMeta = (marks: readonly Mark[], baseStyle: ComputedStyle): InlineMeta => {
  const overrides: StyleOverrides = {};
  const classNames: string[] = [];
  const attributes: Record<string, string> = {};
  const decorationLines = new Set<string>();
  let decorationStyle: string | null = null;
  let decorationColor: string | null = null;
  let backgroundColor: string | null = null;
  let textShadow: string | null = null;
  let textStroke: string | null = null;
  let fontSizeOverride: number | null = null;
  let fontSizeScale: number | null = null;
  let verticalAlign: "super" | "sub" | null = null;
  let linkLike = false;

  for (const mark of marks) {
    const name = mark.type?.name;
    if (name === "fontFamily") {
      const value = typeof (mark.attrs as any)?.fontFamily === "string" ? String((mark.attrs as any).fontFamily) : "";
      if (value) overrides.fontFamily = value;
    } else if (name === "fontSize") {
      const value = parseNumeric((mark.attrs as any)?.fontSize);
      if (value && value > 0) {
        fontSizeOverride = value;
      }
    } else if (name === "textColor") {
      const value = typeof (mark.attrs as any)?.color === "string" ? String((mark.attrs as any).color) : "";
      if (value) overrides.color = value;
    } else if (name === "bold" || name === "strong") {
      overrides.fontWeight = 700;
    } else if (name === "italic" || name === "em") {
      overrides.fontStyle = "italic";
    } else if (name === "code") {
      overrides.fontFamily = "monospace";
    } else if (name === "underline") {
      decorationLines.add("underline");
      const style = typeof (mark.attrs as any)?.underlineStyle === "string" ? String((mark.attrs as any).underlineStyle) : "";
      if (style) decorationStyle = style;
      const color = typeof (mark.attrs as any)?.underlineColor === "string" ? String((mark.attrs as any).underlineColor) : "";
      if (color) decorationColor = color;
    } else if (name === "strikethrough") {
      decorationLines.add("line-through");
    } else if (name === "highlightColor") {
      const value = typeof (mark.attrs as any)?.highlight === "string" ? String((mark.attrs as any).highlight) : "";
      if (value) backgroundColor = value;
    } else if (name === "textShadow") {
      const value = typeof (mark.attrs as any)?.shadow === "string" ? String((mark.attrs as any).shadow) : "";
      if (value) textShadow = value;
    } else if (name === "textOutline") {
      const value = typeof (mark.attrs as any)?.stroke === "string" ? String((mark.attrs as any).stroke) : "";
      if (value) textStroke = value;
    } else if (name === "superscript") {
      verticalAlign = "super";
      fontSizeScale = 0.85;
    } else if (name === "subscript") {
      verticalAlign = "sub";
      fontSizeScale = 0.85;
    } else if (name === "link" || name === "anchor") {
      linkLike = true;
    } else if (name === "comment") {
      classNames.push("leditor-comment");
      const id = typeof (mark.attrs as any)?.id === "string" ? String((mark.attrs as any).id) : "";
      const text = typeof (mark.attrs as any)?.text === "string" ? String((mark.attrs as any).text) : "";
      if (id) attributes["data-comment-id"] = id;
      if (text) attributes["data-comment-text"] = text;
    } else if (name === "trackInsert" || name === "trackDelete") {
      const type = name === "trackInsert" ? "insert" : "delete";
      classNames.push("leditor-change", `leditor-change--${type}`);
      attributes["data-change-type"] = type;
      const id = typeof (mark.attrs as any)?.id === "string" ? String((mark.attrs as any).id) : "";
      const author = typeof (mark.attrs as any)?.author === "string" ? String((mark.attrs as any).author) : "";
      const ts = typeof (mark.attrs as any)?.ts === "number" ? String((mark.attrs as any).ts) : "";
      if (id) attributes["data-change-id"] = id;
      if (author) attributes["data-change-author"] = author;
      if (ts) attributes["data-change-ts"] = ts;
    }
  }

  if (linkLike) {
    decorationLines.add("underline");
    if (!overrides.color) {
      overrides.color = "#0b57d0";
    }
  }
  if (decorationLines.size) {
    overrides.textDecorationLine = Array.from(decorationLines).join(" ");
  }
  if (decorationStyle) overrides.textDecorationStyle = decorationStyle;
  if (decorationColor) overrides.textDecorationColor = decorationColor;
  if (backgroundColor) overrides.backgroundColor = backgroundColor;
  if (textShadow) overrides.textShadow = textShadow;
  if (textStroke) overrides.textStroke = textStroke;
  if (verticalAlign) overrides.verticalAlign = verticalAlign;

  let effectiveFontSize = fontSizeOverride;
  if (fontSizeScale) {
    const base = effectiveFontSize ?? baseStyle.fontSizePx;
    effectiveFontSize = base * fontSizeScale;
  }
  if (effectiveFontSize && effectiveFontSize > 0) {
    overrides.fontSizePx = effectiveFontSize;
    const ratio = baseStyle.fontSizePx > 0 ? baseStyle.lineHeightPx / baseStyle.fontSizePx : 1.2;
    overrides.lineHeightPx = Math.max(effectiveFontSize * ratio, effectiveFontSize * 1.1);
  }

  return {
    overrides,
    className: classNames.length ? classNames.join(" ") : undefined,
    attributes: Object.keys(attributes).length ? attributes : undefined
  };
};

const describeInlineAtom = (
  node: ProseMirrorNode
): { label: string; className?: string; attributes?: Record<string, string> } | null => {
  const attrs = (node.attrs ?? {}) as Record<string, unknown>;
  const name = node.type?.name ?? "atom";
  if (name === "merge_tag") {
    const key = typeof attrs.key === "string" ? attrs.key : "";
    return {
      label: `{{${key || "TAG"}}}`,
      className: "leditor-merge-tag",
      attributes: {
        "data-merge-tag": "true",
        "data-key": key
      }
    };
  }
  if (name === "bookmark") {
    const id = typeof attrs.id === "string" ? attrs.id : "";
    const rawLabel = typeof attrs.label === "string" ? attrs.label : "";
    const label = rawLabel.trim() || id || "bookmark";
    return {
      label,
      className: "leditor-bookmark",
      attributes: {
        "data-bookmark": "true",
        "data-bookmark-id": id,
        "data-bookmark-label": label
      }
    };
  }
  if (name === "cross_reference") {
    const targetId = typeof attrs.targetId === "string" ? attrs.targetId : "";
    const rawLabel = typeof attrs.label === "string" ? attrs.label : "";
    const label = rawLabel.trim() || targetId || "xref";
    return {
      label,
      className: "leditor-cross-reference",
      attributes: {
        "data-cross-reference": "true",
        "data-cross-reference-target": targetId,
        "data-cross-reference-label": label
      }
    };
  }
  if (name === "anchorMarker") {
    const anchorName = typeof attrs.name === "string" ? attrs.name : "";
    const anchorId = typeof attrs.id === "string" ? attrs.id : "";
    return {
      label: "",
      className: "leditor-anchor-marker",
      attributes: {
        ...(anchorName ? { name: anchorName } : {}),
        ...(anchorId ? { id: anchorId } : {})
      }
    };
  }
  if (name === "citation") {
    const renderedHtml = typeof attrs.renderedHtml === "string" ? attrs.renderedHtml : "";
    const label = renderedHtml.trim()
      ? stripHtml(renderedHtml)
      : Array.isArray(attrs.items)
        ? (attrs.items as Array<{ itemKey?: string }>).map((item) => item.itemKey ?? "").filter(Boolean).join(", ") || "(citation)"
        : "(citation)";
    return {
      label,
      className: "leditor-citation-anchor",
      attributes: {
        "data-citation": "true"
      }
    };
  }
  return {
    label: `[${name}]`,
    className: "leditor-inline-atom",
    attributes: { "data-inline-atom": name }
  };
};

const buildBlockAtom = (
  node: ProseMirrorNode,
  pos: number,
  availableWidth: number,
  baseStyle: ComputedStyle
): LayoutBlock | null => {
  const nodeType = node.type?.name ?? "atom";
  if (nodeType === "page_break") {
    return {
      id: `break-${pos}`,
      rect: { x: 0, y: 0, w: availableWidth, h: 0 },
      lines: [],
      kind: "page-break",
      styleKey: DEFAULT_STYLE_KEY,
      nodeType
    };
  }
  let width = availableWidth;
  let height = Math.max(baseStyle.lineHeightPx, 16);
  let label = `[${nodeType}]`;
  if (nodeType === "image") {
    const attrs = (node.attrs ?? {}) as Record<string, unknown>;
    const wAttr = parseNumeric(attrs.width);
    const hAttr = parseNumeric(attrs.height);
    if (wAttr && wAttr > 0) width = Math.min(availableWidth, wAttr);
    if (hAttr && hAttr > 0) {
      height = hAttr;
    } else {
      height = Math.max(80, Math.round(width * 0.6));
    }
    const alt = typeof attrs.alt === "string" ? attrs.alt.trim() : "";
    label = alt || "Image";
  } else if (nodeType === "toc") {
    label = "Table of Contents";
    height = baseStyle.lineHeightPx * 6;
  } else if (nodeType === "citation_sources") {
    label = "Citation Sources";
    height = baseStyle.lineHeightPx * 4;
  } else if (nodeType === "footnotesContainer" || nodeType === "footnoteBody") {
    label = "Footnote";
    height = baseStyle.lineHeightPx * 2;
  }

  const fragment: LayoutFragment = {
    id: `block-frag-${pos}`,
    kind: "inline-atom",
    docRange: { start: pos, end: pos + Math.max(1, node.nodeSize ?? 1) },
    x: 0,
    y: 0,
    w: width,
    h: height,
    styleKey: DEFAULT_STYLE_KEY,
    text: label,
    className: "leditor-block-atom",
    attributes: { "data-block-atom": nodeType }
  };
  const line: LayoutLine = {
    id: `block-line-${pos}`,
    rect: { x: 0, y: 0, w: width, h: height },
    fragments: [fragment]
  };
  return {
    id: `atom-${pos}`,
    rect: { x: 0, y: 0, w: availableWidth, h: height },
    lines: [line],
    kind: "atom",
    styleKey: DEFAULT_STYLE_KEY,
    nodeType
  };
};

type FootnoteBodyInfo = { id: string; node: ProseMirrorNode; pos: number };

const collectFootnoteBodies = (doc: ProseMirrorNode): FootnoteBodyInfo[] => {
  const bodies: FootnoteBodyInfo[] = [];
  if (!doc || typeof doc.descendants !== "function") return bodies;
  doc.descendants((node, pos) => {
    if (node.type?.name !== "footnoteBody") return true;
    const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId) : "";
    bodies.push({ id, node, pos });
    return true;
  });
  return bodies;
};

const collectFootnoteRefPages = (pages: LayoutResult["pages"]): Map<string, number> => {
  const map = new Map<string, number>();
  pages.forEach((page, pageIndex) => {
    page.items.forEach((block) => {
      block.lines.forEach((line) => {
        line.fragments.forEach((fragment) => {
          if (fragment.kind !== "footnote-ref") return;
          const id = fragment.attributes?.["data-footnote-id"];
          if (id && !map.has(id)) {
            map.set(id, pageIndex);
          }
        });
      });
    });
  });
  return map;
};

const layoutFootnoteBlocks = (
  footnote: FootnoteBodyInfo,
  index: number,
  availableWidth: number,
  baseStyle: ComputedStyle,
  footnoteBase: StyleOverrides,
  registerStyle: (overrides: StyleOverrides) => StyleKey,
  resolver: ReturnType<typeof createStyleResolver>
): LayoutBlock[] => {
  const blocks: LayoutBlock[] = [];
  const numberLabel = `${index + 1}. `;
  const baseFontSize = (footnoteBase.fontSizePx ?? baseStyle.fontSizePx) as number;
  const markerWidth = estimateTextWidth(numberLabel, baseFontSize);
  let firstParagraph = true;
  footnote.node.forEach((child, childOffset) => {
    if (!child.isTextblock) return;
    const footnoteComputed = { ...baseStyle, ...footnoteBase } as ComputedStyle;
    const paragraphOverrides = extractParagraphOverrides(child, footnoteComputed);
    paragraphOverrides.leftIndentPx = (paragraphOverrides.leftIndentPx ?? 0) + markerWidth;
    paragraphOverrides.firstLineIndentPx = -markerWidth;
    const paragraphStyleKey = registerStyle({ ...footnoteBase, ...paragraphOverrides });
    const resolvedParagraphStyle = { ...baseStyle, ...footnoteBase, ...paragraphOverrides };
    const prefixItems: InlineItem[] = [];
    if (firstParagraph) {
      prefixItems.push({
        type: "inline-atom",
        id: `fn-marker-${footnote.pos}-${index}`,
        label: numberLabel,
        width: markerWidth,
        height: resolvedParagraphStyle.lineHeightPx,
        styleKey: paragraphStyleKey,
        start: footnote.pos,
        end: footnote.pos
      });
    }
    const paragraphPos = footnote.pos + 1 + childOffset;
    const inlineItems = buildInlineItems(child, paragraphPos, resolvedParagraphStyle, registerStyle, prefixItems);
    if (!child.textContent && inlineItems.length === 0) return;
    blocks.push(
      layoutParagraph({
        text: child.textContent ?? "",
        items: inlineItems,
        styleKey: paragraphStyleKey,
        availableWidth,
        styleResolver: resolver,
        offset: paragraphPos
      })
    );
    firstParagraph = false;
  });
  return blocks;
};

const layoutTableRows = (
  table: ProseMirrorNode,
  tablePos: number,
  availableWidth: number,
  baseStyle: ComputedStyle,
  registerStyle: (overrides: StyleOverrides) => StyleKey,
  resolver: ReturnType<typeof createStyleResolver>
): LayoutBlock[] => {
  const rows: LayoutBlock[] = [];
  const tableId = `table-${tablePos}`;
  const cellPadding = 4;
  let columnCount = 0;
  table.forEach((row) => {
    if (row.type?.name === "tableRow") {
      columnCount = Math.max(columnCount, row.childCount);
    }
  });
  const cols = Math.max(1, columnCount);
  const colWidth = availableWidth / cols;

  let rowIndex = 0;
  table.forEach((rowNode, rowOffset) => {
    if (rowNode.type?.name !== "tableRow") return;
    const rowLines: LayoutLine[] = [];
    const tableCells: Array<{ x: number; y: number; w: number; h: number; header?: boolean }> = [];
    let rowHeight = 0;
    let cellIndex = 0;
    let rowHasHeader = false;

    rowNode.forEach((cellNode, cellOffset) => {
      if (cellNode.type?.name !== "tableCell" && cellNode.type?.name !== "tableHeader") return;
      const isHeader = cellNode.type?.name === "tableHeader";
      if (isHeader) rowHasHeader = true;
      const cellX = cellIndex * colWidth;
      const cellWidth = colWidth;
      const innerWidth = Math.max(0, cellWidth - cellPadding * 2);

      const cellBlocks: LayoutBlock[] = [];
      cellNode.forEach((child, childOffset) => {
        if (!child.isTextblock) return;
        const childPos = tablePos + 1 + rowOffset + 1 + cellOffset + 1 + childOffset;
        const paragraphOverrides = extractParagraphOverrides(child, baseStyle);
        const paragraphStyleKey = registerStyle(paragraphOverrides);
        const resolvedParagraphStyle = { ...baseStyle, ...paragraphOverrides };
        const inlineItems = buildInlineItems(child, childPos, resolvedParagraphStyle, registerStyle);
        if (!child.textContent && inlineItems.length === 0) return;
        cellBlocks.push(
          layoutParagraph({
            text: child.textContent ?? "",
            items: inlineItems,
            styleKey: paragraphStyleKey,
            availableWidth: innerWidth,
            styleResolver: resolver,
            offset: childPos
          })
        );
      });

      const stacked = stackBlocks({ blocks: cellBlocks, availableWidth: innerWidth });
      const cellContentHeight = stacked.reduce((sum, block) => sum + block.rect.h, 0);
      const cellHeight = cellContentHeight + cellPadding * 2;
      rowHeight = Math.max(rowHeight, cellHeight);

      stacked.forEach((block) => {
        block.lines.forEach((line) => {
          const lineId = `table-${tablePos}-r${rowIndex}-c${cellIndex}-line-${rowLines.length}`;
          const rect = {
            ...line.rect,
            x: line.rect.x + cellX + cellPadding,
            y: line.rect.y + cellPadding + block.rect.y
          };
          const fragments = line.fragments.map((fragment, fragIndex) => ({
            ...fragment,
            id: `${lineId}-frag-${fragIndex}`,
            x: fragment.x + cellX + cellPadding,
            y: fragment.y + cellPadding + block.rect.y
          }));
          rowLines.push({ id: lineId, rect, fragments });
        });
      });

      tableCells.push({
        x: cellX,
        y: 0,
        w: cellWidth,
        h: cellHeight,
        header: isHeader
      });

      cellIndex += 1;
    });

    // Normalize cell heights to row height
    tableCells.forEach((cell) => {
      cell.h = rowHeight;
    });
    rowLines.sort((a, b) => a.rect.y - b.rect.y);
    rows.push({
      id: `table-${tablePos}-row-${rowIndex}`,
      rect: { x: 0, y: 0, w: availableWidth, h: rowHeight },
      lines: rowLines,
      kind: "table-row",
      styleKey: DEFAULT_STYLE_KEY,
      nodeType: "tableRow",
      tableCells,
      tableHeader: rowHasHeader,
      tableId
    });
    rowIndex += 1;
  });
  return rows;
};

const buildInlineItems = (
  node: ProseMirrorNode,
  paragraphPos: number,
  baseStyle: ComputedStyle,
  registerStyle: (overrides: StyleOverrides) => StyleKey,
  prefixItems: InlineItem[] = []
): InlineItem[] => {
  const items: InlineItem[] = [...prefixItems];
  const baseInlineOverrides: StyleOverrides = {
    fontFamily: baseStyle.fontFamily,
    fontSizePx: baseStyle.fontSizePx,
    fontWeight: baseStyle.fontWeight,
    fontStyle: baseStyle.fontStyle,
    lineHeightPx: baseStyle.lineHeightPx,
    color: baseStyle.color,
    direction: baseStyle.direction
  };
  const baseInlineKey = registerStyle(baseInlineOverrides);

  node.descendants((child, childPos) => {
    if (child.isText) {
      const text = child.text ?? "";
      if (!text) return false;
      const absoluteStart = paragraphPos + childPos + 1;
      const inlineMeta = extractInlineMeta(child.marks ?? [], baseStyle);
      const overrides = {
        ...baseInlineOverrides,
        ...inlineMeta.overrides
      };
      const styleKey = registerStyle(overrides);
      items.push({
        type: "text",
        text,
        styleKey,
        start: absoluteStart,
        end: absoluteStart + text.length,
        className: inlineMeta.className,
        attributes: inlineMeta.attributes
      });
      return false;
    }
    if (child.type?.name === "hardBreak") {
      const absoluteStart = paragraphPos + childPos + 1;
      items.push({
        type: "text",
        text: "\n",
        styleKey: baseInlineKey,
        start: absoluteStart,
        end: absoluteStart + 1
      });
      return false;
    }
    if (child.type?.name === "footnote") {
      const absoluteStart = paragraphPos + childPos + 1;
      const footnoteId =
        typeof (child.attrs as any)?.footnoteId === "string"
          ? String((child.attrs as any).footnoteId)
          : `fn-${absoluteStart}`;
      items.push({
        type: "footnote-ref",
        noteId: footnoteId,
        styleKey: baseInlineKey,
        start: absoluteStart,
        end: absoluteStart + Math.max(1, child.nodeSize ?? 1),
        className: "leditor-footnote-ref",
        attributes: {
          "data-footnote-id": footnoteId
        }
      });
      return false;
    }
    if (child.isAtom && child.isInline) {
      const absoluteStart = paragraphPos + childPos + 1;
      const inlineMeta = extractInlineMeta(child.marks ?? [], baseStyle);
      const overrides = {
        ...baseInlineOverrides,
        ...inlineMeta.overrides
      };
      const styleKey = registerStyle(overrides);
      const atomInfo = describeInlineAtom(child);
      if (atomInfo) {
        items.push({
          type: "inline-atom",
          id: `${child.type?.name ?? "atom"}-${absoluteStart}`,
          label: atomInfo.label,
          styleKey,
          start: absoluteStart,
          end: absoluteStart + Math.max(1, child.nodeSize ?? 1),
          className: [inlineMeta.className, atomInfo.className].filter(Boolean).join(" ") || undefined,
          attributes: { ...(inlineMeta.attributes ?? {}), ...(atomInfo.attributes ?? {}) }
        });
      }
      return false;
    }
    return true;
  });

  return items;
};

export const layoutDocumentV2 = (input: Partial<LayoutDocumentInput>): LayoutResult => {
  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  const doc = input.doc;
  const setup = input.setup ?? (doc ? pageSetupFromDoc(doc) ?? defaultPageSetup : defaultPageSetup);
  const styleRegistry: Record<StyleKey, StyleOverrides> = { [DEFAULT_STYLE_KEY]: {} };
  const styleKeyCache = new Map<string, StyleKey>();
  styleKeyCache.set(JSON.stringify({}), DEFAULT_STYLE_KEY);
  const registerStyle = (overrides: StyleOverrides): StyleKey => {
    const normalized = JSON.stringify(overrides, Object.keys(overrides).sort());
    const existing = styleKeyCache.get(normalized);
    if (existing) return existing;
    const nextKey = `style-${styleKeyCache.size}`;
    styleKeyCache.set(normalized, nextKey);
    styleRegistry[nextKey] = overrides;
    return nextKey;
  };
  const resolver = createStyleResolver(styleRegistry as Record<string, Partial<ComputedStyle>>);
  const frames = computeFramesPx(setup);
  const columnCount = Math.max(1, Math.floor(setup.columns ?? 1));
  const columnGap = setup.columnGapPx ?? 0;
  const columnWidth =
    columnCount > 1
      ? Math.max(0, (frames.bodyRect.w - columnGap * (columnCount - 1)) / columnCount)
      : frames.bodyRect.w;
  const availableWidth = columnWidth;

  const blocks: LayoutBlock[] = [];
  const baseStyle = createDefaultComputedStyle();
  const footnoteOverrides: StyleOverrides = {
    fontSizePx: Math.max(10, baseStyle.fontSizePx - 2),
    lineHeightPx: Math.max(12, baseStyle.lineHeightPx - 4)
  };
  registerStyle(footnoteOverrides);
  if (doc) {
    doc.descendants((node, pos) => {
      if (node.type?.name === "page") return true;
      if (node.type?.name === "table") {
        const tableBlocks = layoutTableRows(node, pos, availableWidth, baseStyle, registerStyle, resolver);
        tableBlocks.forEach((block) => blocks.push(block));
        return false;
      }
      if (!node.isTextblock) {
        if (node.isAtom && node.isBlock) {
          const blockAtom = buildBlockAtom(node, pos, availableWidth, baseStyle);
          if (blockAtom) blocks.push(blockAtom);
          return false;
        }
        return true;
      }
      const textContent = node.textContent ?? "";
      const paragraphOverrides = extractParagraphOverrides(node, baseStyle);
      const listContext = getListContext(doc, pos);
      const prefixItems: InlineItem[] = [];
      if (listContext.depth > 0) {
        const fontSizePx = (paragraphOverrides.fontSizePx ?? baseStyle.fontSizePx) as number;
        const indentBase = Math.max(12, fontSizePx * 1.5);
        const listIndent = indentBase * listContext.depth;
        paragraphOverrides.leftIndentPx = (paragraphOverrides.leftIndentPx ?? 0) + listIndent;
        if (paragraphOverrides.paragraphSpacingBeforePx == null) {
          paragraphOverrides.paragraphSpacingBeforePx = 0;
        }
        if (paragraphOverrides.paragraphSpacingAfterPx == null) {
          paragraphOverrides.paragraphSpacingAfterPx = 0;
        }
        if (listContext.isFirstParagraph && listContext.type) {
          const markerLabel =
            listContext.type === "ordered" ? `${listContext.index ?? 1}. ` : "• ";
          const markerWidth = estimateTextWidth(markerLabel, fontSizePx);
          if (paragraphOverrides.firstLineIndentPx == null) {
            paragraphOverrides.firstLineIndentPx = -markerWidth;
          }
          prefixItems.push({
            type: "inline-atom",
            id: `list-marker-${pos}`,
            label: markerLabel,
            width: markerWidth,
            height: baseStyle.lineHeightPx,
            styleKey: DEFAULT_STYLE_KEY,
            start: pos,
            end: pos
          });
        }
      }
      const paragraphStyleKey = registerStyle(paragraphOverrides);
      const resolvedParagraphStyle = { ...baseStyle, ...paragraphOverrides };
      if (prefixItems.length) {
        prefixItems.forEach((item) => {
          item.styleKey = paragraphStyleKey;
          if (item.type === "inline-atom" && (item.height == null || item.height <= 0)) {
            item.height = resolvedParagraphStyle.lineHeightPx;
          }
        });
      }
      const inlineItems = buildInlineItems(node, pos, resolvedParagraphStyle, registerStyle, prefixItems);
      if (!textContent && inlineItems.length === 0) return false;
      blocks.push(
        layoutParagraph({
          text: textContent,
          items: inlineItems,
          styleKey: paragraphStyleKey,
          availableWidth,
          styleResolver: resolver,
          offset: pos
        })
      );
      return false;
    });
  }

  const laidOutBlocks = stackBlocks({ blocks, availableWidth });
  const result = paginate({ blocks: laidOutBlocks, setup });
  result.styles = styleRegistry;
  result.headerHtml = typeof input.headerHtml === "string" ? input.headerHtml : undefined;
  result.footerHtml = typeof input.footerHtml === "string" ? input.footerHtml : undefined;
  if (doc) {
    const footnoteBodies = collectFootnoteBodies(doc);
    if (footnoteBodies.length > 0) {
      const refPages = collectFootnoteRefPages(result.pages);
      const footnotesByPage: LayoutBlock[][] = result.pages.map(() => []);
      footnoteBodies.forEach((footnote, index) => {
        const targetPage = refPages.get(footnote.id) ?? result.pages.length - 1;
        const pageIndex = Math.min(Math.max(0, targetPage), result.pages.length - 1);
        const blocks = layoutFootnoteBlocks(
          footnote,
          index,
          frames.footnotesRect.w,
          baseStyle,
          footnoteOverrides,
          registerStyle,
          resolver
        );
        footnotesByPage[pageIndex].push(...blocks);
      });
      let carry: LayoutBlock[] = [];
      const footnoteHeight = frames.footnotesRect.h;
      result.pages.forEach((page, pageIndex) => {
        const pending = [...carry, ...footnotesByPage[pageIndex]];
        const placed: LayoutBlock[] = [];
        let cursorY = 0;
        carry = [];
        for (const block of pending) {
          if (cursorY + block.rect.h <= footnoteHeight) {
            const adjusted = {
              ...block,
              rect: { ...block.rect, x: 0, y: cursorY },
              lines: block.lines.map((line) => ({
                ...line,
                rect: { ...line.rect, y: line.rect.y + cursorY },
                fragments: line.fragments.map((fragment) => ({
                  ...fragment,
                  y: fragment.y + cursorY
                }))
              }))
            };
            placed.push(adjusted);
            cursorY += block.rect.h;
          } else {
            carry.push(block);
          }
        }
        page.footnotes = placed;
      });
    }
  }
  if (typeof window !== "undefined") {
    const endedAt = typeof performance !== "undefined" ? performance.now() : 0;
    (window as any).__leditorLayoutV2Metrics = {
      pages: result.pages.length,
      blocks: blocks.length,
      ms: Math.round(endedAt - startedAt)
    };
    if ((window as any).__leditorLayoutV2Debug) {
      console.info("[LayoutV2] layout run", (window as any).__leditorLayoutV2Metrics);
    }
  }
  return result;
};
