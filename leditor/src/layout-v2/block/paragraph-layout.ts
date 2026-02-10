import type { InlineItem, LayoutBlock, LayoutLine, StyleKey } from "../types.ts";
import type { StyleResolver } from "../style/resolve-style.ts";
import { layoutLines } from "../inline/line-layout.ts";
import { createInlineItemizer } from "../inline/inline-items.ts";

export type ParagraphLayoutInput = {
  text?: string;
  items?: InlineItem[];
  styleKey: StyleKey;
  availableWidth: number;
  styleResolver: StyleResolver;
  offset: number;
};

export const layoutParagraph = (input: ParagraphLayoutInput): LayoutBlock => {
  const itemizer = createInlineItemizer();
  const items =
    input.items ??
    itemizer.itemize(input.text ?? "", input.styleKey, input.offset);
  const style = input.styleResolver.resolve(input.styleKey);
  const spacingBefore = style.paragraphSpacingBeforePx ?? 0;
  const spacingAfter = style.paragraphSpacingAfterPx ?? 0;
  const firstIndent = style.firstLineIndentPx ?? 0;
  const leftIndent = style.leftIndentPx ?? 0;
  const rightIndent = style.rightIndentPx ?? 0;
  const textAlign = style.textAlign ?? "left";
  const usableWidth = Math.max(0, input.availableWidth - leftIndent - rightIndent);

  const rawLines: LayoutLine[] = layoutLines({
    items,
    availableWidth: usableWidth,
    styles: (key) => input.styleResolver.resolve(key)
  });

  const lines: LayoutLine[] = rawLines.map((line, index) => {
    let offsetX = 0;
    if (textAlign === "center") {
      offsetX = Math.max(0, (usableWidth - line.rect.w) / 2);
    } else if (textAlign === "right") {
      offsetX = Math.max(0, usableWidth - line.rect.w);
    }
    offsetX += leftIndent;
    if (index === 0) {
      offsetX += firstIndent;
    }
    const offsetY = spacingBefore;
    const fragments = line.fragments.map((fragment) => ({
      ...fragment,
      x: fragment.x + offsetX,
      y: fragment.y + offsetY
    }));
    return {
      ...line,
      rect: {
        ...line.rect,
        x: line.rect.x + offsetX,
        y: line.rect.y + offsetY
      },
      fragments
    };
  });

  const height = spacingBefore + rawLines.reduce((sum, line) => sum + line.rect.h, 0) + spacingAfter;
  return {
    id: `para-${input.offset}`,
    rect: { x: 0, y: 0, w: input.availableWidth, h: height },
    lines,
    kind: "paragraph",
    styleKey: input.styleKey
  };
};
