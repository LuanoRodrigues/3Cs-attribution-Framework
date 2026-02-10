import type { InlineItem, LayoutFragment, LayoutLine } from "../types.ts";
import type { ComputedStyle } from "../style/computed-style.ts";
import { findBreakPoints } from "./linebreak-uax14.ts";
import { Measurer } from "../measure/measurer.ts";
import { shapeText } from "../measure/text-shape.ts";

export type LineLayoutInput = {
  items: InlineItem[];
  availableWidth: number;
  styles: (key: string) => ComputedStyle;
};

let measurerSingleton: Measurer | null = null;
const getMeasurer = (): Measurer => {
  if (!measurerSingleton) measurerSingleton = new Measurer();
  return measurerSingleton;
};

export const layoutLines = (input: LineLayoutInput): LayoutLine[] => {
  const lines: LayoutLine[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let fragments: LayoutFragment[] = [];
  const pushLine = () => {
    const width = fragments.reduce((sum, f) => sum + f.w, 0);
    const height = fragments.reduce((max, f) => Math.max(max, f.h), 0);
    lines.push({ id: `line-${lines.length}`, rect: { x: 0, y: cursorY, w: width, h: height }, fragments });
    cursorY += height;
    cursorX = 0;
    fragments = [];
  };

  const measurer = getMeasurer();

  const pushFragment = (frag: LayoutFragment) => {
    fragments.push(frag);
    cursorX += frag.w;
  };

  const maybePushLineBreak = (nextWidth: number, height: number) => {
    if (cursorX + nextWidth <= input.availableWidth) return false;
    if (fragments.length > 0) {
      pushLine();
    } else {
      // Force placement even if too wide
      cursorY += height;
    }
    return true;
  };

  for (const item of input.items) {
    if (item.type === "text") {
      const style = input.styles(item.styleKey);
      const breaks = findBreakPoints(item.text);
      let start = 0;
      const emitChunk = (textChunk: string, absoluteStart: number) => {
        const metrics = shapeText(textChunk, style, measurer);
        const fragment: LayoutFragment = {
          id: `frag-${lines.length}-${fragments.length}`,
          kind: "text",
          docRange: { start: item.start + absoluteStart, end: item.start + absoluteStart + textChunk.length },
          x: cursorX,
          y: cursorY,
          w: metrics.width,
          h: metrics.height,
          styleKey: item.styleKey,
          text: textChunk,
          className: item.className,
          attributes: item.attributes
        };
        const wrapped = maybePushLineBreak(fragment.w, fragment.h);
        fragment.x = cursorX;
        fragment.y = cursorY;
        pushFragment(fragment);
        return wrapped;
      };

      for (let i = 0; i <= breaks.length; i += 1) {
        const end = i < breaks.length ? breaks[i] : item.text.length;
        const chunk = item.text.slice(start, end);
        const wrapped = emitChunk(chunk, start);
        if (wrapped) {
          cursorX = fragments.reduce((sum, f) => sum + f.w, 0);
        }
        start = end;
      }
    } else if (item.type === "inline-atom") {
      const style = input.styles(item.styleKey);
      const label = item.label ?? "";
      let width = item.width ?? 0;
      let height = item.height ?? 0;
      if (label && (!width || !height)) {
        const metrics = shapeText(label, style, measurer);
        width = width || metrics.width;
        height = height || metrics.height;
      }
      if (!height) height = style.lineHeightPx;
      if (maybePushLineBreak(width, height)) {
        cursorX = 0;
      }
      const fragment: LayoutFragment = {
        id: `frag-${lines.length}-${fragments.length}`,
        kind: "inline-atom",
        docRange: { start: item.start, end: item.end },
        x: cursorX,
        y: cursorY,
        w: width,
        h: height,
        styleKey: item.styleKey,
        text: label || undefined,
        className: item.className,
        attributes: item.attributes
      };
      pushFragment(fragment);
    } else if (item.type === "footnote-ref") {
      const style = input.styles(item.styleKey);
      const metrics = shapeText("1", style, measurer); // placeholder width
      if (maybePushLineBreak(metrics.width, metrics.height)) {
        cursorX = 0;
      }
      const fragment: LayoutFragment = {
        id: `frag-${lines.length}-${fragments.length}`,
        kind: "footnote-ref",
        docRange: { start: item.start, end: item.end },
        x: cursorX,
        y: cursorY,
        w: metrics.width,
        h: metrics.height,
        styleKey: item.styleKey,
        text: "",
        className: item.className,
        attributes: item.attributes
      };
      pushFragment(fragment);
    }
  }

  if (fragments.length > 0) {
    pushLine();
  }

  return lines;
};
