// Internal unit helpers. V2 prefers twips (1/1440 inch) for stability.
export const TWIPS_PER_INCH = 1440;
const MM_PER_INCH = 25.4;

export const ptToTwips = (pt: number): number => Math.round(pt * 20);
export const mmToTwips = (mm: number): number => Math.round((mm / MM_PER_INCH) * TWIPS_PER_INCH);
export const pxToTwips = (px: number, dpi = 96): number => Math.round((px / dpi) * TWIPS_PER_INCH);
export const twipsToPx = (twips: number, dpi = 96): number => (twips / TWIPS_PER_INCH) * dpi;

export const normalizeTwips = (value: number): number => Math.round(value);

export type RectTwips = { x: number; y: number; w: number; h: number };
