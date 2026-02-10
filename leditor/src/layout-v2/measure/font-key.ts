import type { ComputedStyle } from "../style/computed-style.ts";

export type FontKey = string;

export const fontKeyFromStyle = (style: ComputedStyle): FontKey => {
  const weight = typeof style.fontWeight === "number" ? style.fontWeight : style.fontWeight.toString();
  return `${style.fontFamily}::${weight}::${style.fontStyle}::${style.fontSizePx}`;
};
