import { TextMeasureCache } from "./cache.ts";
import { fontKeyFromStyle } from "./font-key.ts";
import type { TextMetricsLite } from "./text-shape.ts";
import type { ComputedStyle } from "../style/computed-style.ts";

const HIDDEN_ROOT_ID = "leditor-measure-root";

const ensureMeasureRoot = (): HTMLElement | null => {
  if (typeof document === "undefined") return null;
  const existing = document.getElementById(HIDDEN_ROOT_ID);
  if (existing) return existing;
  const el = document.createElement("div");
  el.id = HIDDEN_ROOT_ID;
  el.style.position = "absolute";
  el.style.left = "-10000px";
  el.style.top = "-10000px";
  el.style.width = "max-content";
  el.style.height = "auto";
  el.style.visibility = "hidden";
  document.body.appendChild(el);
  return el;
};

export class Measurer {
  private cache = new TextMeasureCache();
  private root: HTMLElement | null;

  constructor() {
    this.root = ensureMeasureRoot();
  }

  measure(text: string, style: ComputedStyle): TextMetricsLite {
    const key = `${fontKeyFromStyle(style)}:${text}` as const;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return { width: cached, height: style.lineHeightPx };
    }
    const width = this.measureTextWidth(text, style);
    this.cache.set(key, width);
    return { width, height: style.lineHeightPx };
  }

  private measureTextWidth(text: string, style: ComputedStyle): number {
    if (typeof document === "undefined") {
      // SSR/CI fallback: rough approximation
      return text.length * (style.fontSizePx * 0.6);
    }
    const element = document.createElement("span");
    element.textContent = text || " ";
    element.style.fontFamily = style.fontFamily;
    element.style.fontSize = `${style.fontSizePx}px`;
    element.style.fontWeight = `${style.fontWeight}`;
    element.style.fontStyle = style.fontStyle;
    element.style.lineHeight = `${style.lineHeightPx}px`;
    this.root = this.root ?? ensureMeasureRoot();
    if (!this.root) return text.length * (style.fontSizePx * 0.6);
    this.root.appendChild(element);
    const width = element.getBoundingClientRect().width;
    this.root.removeChild(element);
    return width;
  }
}
