import type { LayoutFragment } from "../../layout-v2/types.ts";
import type { StyleResolver } from "../../layout-v2/style/resolve-style.ts";

export const renderFragmentDom = (fragment: LayoutFragment, styleResolver: StyleResolver): HTMLElement => {
  const el = document.createElement("span");
  el.className = fragment.className ? `leditor-fragment ${fragment.className}` : "leditor-fragment";
  el.dataset.docStart = `${fragment.docRange.start}`;
  el.dataset.docEnd = `${fragment.docRange.end}`;
  el.dataset.styleKey = fragment.styleKey;
  const style = styleResolver.resolve(fragment.styleKey);
  el.style.fontFamily = style.fontFamily;
  el.style.fontSize = `${style.fontSizePx}px`;
  el.style.fontWeight = `${style.fontWeight}`;
  el.style.fontStyle = style.fontStyle;
  el.style.lineHeight = `${style.lineHeightPx}px`;
  if (style.color) {
    el.style.color = style.color;
  }
  if (style.backgroundColor) {
    el.style.backgroundColor = style.backgroundColor;
  }
  if (style.textDecorationLine) {
    el.style.textDecorationLine = style.textDecorationLine;
  }
  if (style.textDecorationStyle) {
    el.style.textDecorationStyle = style.textDecorationStyle;
  }
  if (style.textDecorationColor) {
    el.style.textDecorationColor = style.textDecorationColor;
  }
  if (style.textShadow) {
    el.style.textShadow = style.textShadow;
  }
  if (style.textStroke) {
    el.style.setProperty("-webkit-text-stroke", style.textStroke);
    el.style.setProperty("text-stroke", style.textStroke);
    el.style.setProperty("paint-order", "stroke fill");
  }
  if (style.verticalAlign && style.verticalAlign !== "baseline") {
    el.style.verticalAlign = style.verticalAlign;
  }
  if (style.direction) {
    el.style.direction = style.direction;
  }
  if (fragment.attributes) {
    Object.entries(fragment.attributes).forEach(([key, value]) => {
      if (value != null) {
        el.setAttribute(key, value);
      }
    });
  }
  el.style.position = "absolute";
  el.style.zIndex = "1";
  el.style.left = `${fragment.x}px`;
  el.style.top = `${fragment.y}px`;
  el.style.width = `${fragment.w}px`;
  el.style.height = `${fragment.h}px`;
  if (fragment.text) {
    el.textContent = fragment.text;
  }
  return el;
};
