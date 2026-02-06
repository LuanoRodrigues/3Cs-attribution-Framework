export type Orientation = "portrait" | "landscape";
export type MarginValues = {
    top: string;
    right: string;
    bottom: string;
    left: string;
    inside?: string;
    outside?: string;
};
export type MarginValuesCm = {
    top: number;
    right: number;
    bottom: number;
    left: number;
    inside?: number;
    outside?: number;
};
export type ColumnMode = "one" | "two" | "three" | "left" | "right";
export type PageSizeDefinition = {
    id: string;
    label: string;
    widthCm: number;
    heightCm: number;
};
export declare const getPageSizeDefinitions: () => Array<PageSizeDefinition & {
    widthMm: number;
    heightMm: number;
}>;
export declare const getCurrentPageSize: () => PageSizeDefinition & {
    orientation: Orientation;
    widthMm: number;
    heightMm: number;
};
export declare const getOrientation: () => Orientation;
export declare const getMarginValues: () => MarginValues;
export declare const getMarginValuesCm: () => MarginValuesCm;
export declare const getLayoutColumns: () => number;
export declare const getColumnMode: () => ColumnMode;
export declare const getColumnGapIn: () => number;
export declare const getColumnWidthIn: () => number | null;
export declare const setPageSize: (sizeId?: string, overrides?: {
    widthMm?: number;
    heightMm?: number;
} | undefined) => void;
export declare const setPageOrientation: (orientation: Orientation) => void;
export declare const setPageMargins: (margins: Partial<MarginValues | MarginValuesCm>) => void;
export declare const setMarginsPreset: (preset: "normal" | "moderate" | "narrow" | "wide") => void;
export declare const resetMargins: () => void;
export declare const setSectionColumns: (count: number, options?: {
    gapIn?: number;
    widthIn?: number | null;
} | undefined) => void;
export declare const setColumnGap: (gapIn: number) => void;
export declare const setColumnWidth: (widthIn: number | null) => void;
export declare const setColumnMode: (mode: ColumnMode) => void;
export declare const subscribeToLayoutChanges: (listener: (state: {
    orientation: Orientation;
    margins: MarginValues;
    marginsCm: MarginValuesCm;
    pageSize: PageSizeDefinition & {
        widthMm: number;
        heightMm: number;
    };
    columns: number;
    columnsMode: ColumnMode;
    columnGapIn: number;
    columnWidthIn: number | null;
}) => void) => () => void;
