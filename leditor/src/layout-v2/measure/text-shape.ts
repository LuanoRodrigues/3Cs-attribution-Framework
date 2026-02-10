import type { ComputedStyle } from "../style/computed-style.ts";

export type TextMetricsLite = {
  width: number;
  height: number;
  ascent?: number;
  descent?: number;
};

export const shapeText = (text: string, style: ComputedStyle, measurer: TextMeasurer): TextMetricsLite => {
  return measurer.measure(text, style);
};

export type TextMeasurer = {
  measure: (text: string, style: ComputedStyle) => TextMetricsLite;
};
