import type { StyleKey } from "../types.ts";

export type ComputedStyle = {
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
};

export const createDefaultComputedStyle = (): ComputedStyle => ({
  fontFamily: "serif",
  fontSizePx: 16,
  fontWeight: 400,
  fontStyle: "normal",
  lineHeightPx: 20,
  textAlign: "left",
  paragraphSpacingBeforePx: 0,
  paragraphSpacingAfterPx: 0,
  firstLineIndentPx: 0,
  leftIndentPx: 0,
  rightIndentPx: 0,
  textDecorationLine: "",
  textDecorationStyle: "",
  textDecorationColor: "",
  textShadow: "",
  textStroke: "",
  verticalAlign: "baseline",
  direction: "ltr",
  borderPreset: "",
  borderColor: "",
  borderWidthPx: 0
});

export type StyleRegistry = {
  getComputedStyle(key: StyleKey): ComputedStyle | undefined;
};
