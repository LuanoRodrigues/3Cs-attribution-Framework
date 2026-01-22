const CM_PER_INCH = 2.54;
const DPI = 96;

export const cmToPx = (cm: number, dpi: number = DPI): number => (cm / CM_PER_INCH) * dpi;
export const mmToPx = (mm: number, dpi: number = DPI): number => cmToPx(mm / 10, dpi);
export const ptToPx = (pt: number, dpi: number = DPI): number => (pt / 72) * dpi;

export const cmToCss = (cm: number): string => `${cm}cm`;
export const ptToCss = (pt: number): string => `${pt}pt`;
