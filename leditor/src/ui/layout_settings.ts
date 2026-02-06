import {
  applyDocumentLayoutTokens,
  setPageSizePreset as docSetPageSizePreset,
  setOrientation as docSetOrientation,
  setMarginsPreset as docSetMarginsPreset,
  setMarginsCustom as docSetMarginsCustom,
  setColumns as docSetColumns,
  setColumnGap as docSetColumnGap,
  setColumnWidth as docSetColumnWidth,
  setFootnoteGap as docSetFootnoteGap,
  setFootnoteMaxHeightRatio as docSetFootnoteMaxHeightRatio,
  setFootnoteSeparator as docSetFootnoteSeparator
} from "./pagination/document_layout_state.ts";

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

const PAGE_SIZE_DEFINITIONS: PageSizeDefinition[] = [
  { id: "a4", label: "A4", widthCm: 21.0, heightCm: 29.7 },
  { id: "a5", label: "A5", widthCm: 14.8, heightCm: 21.0 },
  { id: "a3", label: "A3", widthCm: 29.7, heightCm: 42.0 },
  { id: "letter", label: "Letter", widthCm: 21.59, heightCm: 27.94 }
];

const MARGIN_PRESETS: Record<
  "normal" | "moderate" | "narrow" | "wide",
  { label: string; margins: MarginValuesCm }
> = {
  // Keep layout_settings presets aligned with the document layout spec defaults.
  // 2.5cm = 0.9843in.
  normal: { label: "Normal", margins: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 } },
  moderate: { label: "Moderate", margins: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 } },
  narrow: { label: "Narrow", margins: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 } },
  wide: { label: "Wide", margins: { top: 2.5, bottom: 2.5, left: 2.5, right: 2.5 } }
};

const cmToCss = (value: number): string => `${value}cm`;
const mmFromCm = (cm: number): number => cm * 10;
const cmToInches = (cm: number): number => cm / 2.54;

const shouldForceSingleColumn = (): boolean =>
  typeof window !== "undefined" && (window as any).__leditorDisableColumns !== false;

const parseToCm = (value: number | string | undefined, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return fallback;
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return fallback;
  if (trimmed.endsWith("cm")) return numeric;
  if (trimmed.endsWith("mm")) return numeric / 10;
  if (trimmed.endsWith("in")) return numeric * 2.54;
  return numeric;
};

type LayoutState = {
  orientation: Orientation;
  marginsCm: MarginValuesCm;
  pageSize: PageSizeDefinition;
  columns: { mode: ColumnMode; count: number; gapIn: number; widthIn: number | null };
};

type LayoutChangeListener = (state: {
  orientation: Orientation;
  margins: MarginValues;
  marginsCm: MarginValuesCm;
  pageSize: PageSizeDefinition & { widthMm: number; heightMm: number };
  columns: number;
  columnsMode: ColumnMode;
  columnGapIn: number;
  columnWidthIn: number | null;
}) => void;

const layoutState: LayoutState = {
  orientation: "portrait",
  marginsCm: { ...MARGIN_PRESETS.normal.margins },
  pageSize: PAGE_SIZE_DEFINITIONS[0],
  columns: { mode: "one", count: 1, gapIn: 0.25, widthIn: null }
};

const layoutListeners = new Set<LayoutChangeListener>();

const applyLayoutStyles = (): void => {
  if (typeof document === "undefined") return;
  applyDocumentLayoutTokens(document.documentElement);
};

const snapshotStateForListeners = (): {
  orientation: Orientation;
  margins: MarginValues;
  marginsCm: MarginValuesCm;
  pageSize: PageSizeDefinition & { widthMm: number; heightMm: number };
  columns: number;
  columnsMode: ColumnMode;
  columnGapIn: number;
  columnWidthIn: number | null;
} => {
  const { orientation, pageSize, marginsCm } = layoutState;
  const columns = shouldForceSingleColumn() ? { count: 1, mode: "one" as ColumnMode } : layoutState.columns;
  const widthCm = orientation === "portrait" ? pageSize.widthCm : pageSize.heightCm;
  const heightCm = orientation === "portrait" ? pageSize.heightCm : pageSize.widthCm;
  return {
    orientation,
    margins: {
      top: cmToCss(marginsCm.top),
      right: cmToCss(marginsCm.right),
      bottom: cmToCss(marginsCm.bottom),
      left: cmToCss(marginsCm.left),
      inside: marginsCm.inside !== undefined ? cmToCss(marginsCm.inside) : undefined,
      outside: marginsCm.outside !== undefined ? cmToCss(marginsCm.outside) : undefined
    },
    marginsCm: { ...marginsCm },
    pageSize: {
      ...pageSize,
      widthMm: mmFromCm(widthCm),
      heightMm: mmFromCm(heightCm)
    },
    columns: columns.count,
    columnsMode: columns.mode,
    columnGapIn: layoutState.columns.gapIn,
    columnWidthIn: layoutState.columns.widthIn
  };
};

const notifyLayoutChange = (): void => {
  applyLayoutStyles();
  const snapshot = snapshotStateForListeners();
  layoutListeners.forEach((listener) => listener(snapshot));
};

const withLayoutUpdate = (updater: () => void): void => {
  updater();
  notifyLayoutChange();
};

export const getPageSizeDefinitions = (): Array<
  PageSizeDefinition & { widthMm: number; heightMm: number }
> =>
  PAGE_SIZE_DEFINITIONS.map((def) => ({
    ...def,
    widthMm: mmFromCm(def.widthCm),
    heightMm: mmFromCm(def.heightCm)
  }));

export const getCurrentPageSize = (): PageSizeDefinition & {
  orientation: Orientation;
  widthMm: number;
  heightMm: number;
} => {
  const snapshot = snapshotStateForListeners();
  return { ...snapshot.pageSize, orientation: snapshot.orientation };
};

export const getOrientation = (): Orientation => layoutState.orientation;

export const getMarginValues = (): MarginValues => snapshotStateForListeners().margins;

export const getMarginValuesCm = (): MarginValuesCm => ({ ...layoutState.marginsCm });

export const getLayoutColumns = (): number => (shouldForceSingleColumn() ? 1 : layoutState.columns.count);

export const getColumnMode = (): ColumnMode => layoutState.columns.mode;

export const getColumnGapIn = (): number => layoutState.columns.gapIn;

export const getColumnWidthIn = (): number | null => layoutState.columns.widthIn;

export const setPageSize = (sizeId?: string, overrides?: { widthMm?: number; heightMm?: number }): void => {
  withLayoutUpdate(() => {
    const target = sizeId ? PAGE_SIZE_DEFINITIONS.find((entry) => entry.id === sizeId) : undefined;
    const base = target ?? layoutState.pageSize;
    const widthCm =
      typeof overrides?.widthMm === "number" && Number.isFinite(overrides.widthMm)
        ? overrides.widthMm / 10
        : base.widthCm;
    const heightCm =
      typeof overrides?.heightMm === "number" && Number.isFinite(overrides.heightMm)
        ? overrides.heightMm / 10
        : base.heightCm;
    layoutState.pageSize = {
      id: target?.id ?? base.id,
      label: target?.label ?? base.label,
      widthCm,
      heightCm
    };
    docSetPageSizePreset(target?.id ?? base.id);
  });
};

export const setPageOrientation = (orientation: Orientation): void => {
  withLayoutUpdate(() => {
    layoutState.orientation = orientation;
    docSetOrientation(orientation);
  });
};

export const setPageMargins = (margins: Partial<MarginValues | MarginValuesCm>): void => {
  const current = layoutState.marginsCm;
  const next: MarginValuesCm = {
    top: parseToCm((margins as any)?.top, current.top),
    right: parseToCm((margins as any)?.right, current.right),
    bottom: parseToCm((margins as any)?.bottom, current.bottom),
    left: parseToCm((margins as any)?.left, current.left),
    inside:
      margins?.inside !== undefined ? parseToCm((margins as any).inside, current.inside ?? current.left) : current.inside,
    outside:
      margins?.outside !== undefined ? parseToCm((margins as any).outside, current.outside ?? current.right) : current.outside
  };
  withLayoutUpdate(() => {
    layoutState.marginsCm = next;
    docSetMarginsCustom({
      top: cmToInches(next.top),
      right: cmToInches(next.right),
      bottom: cmToInches(next.bottom),
      left: cmToInches(next.left)
    });
  });
};

export const setFootnoteGap = (value: number | string): void => {
  const cm = parseToCm(value as any, 0.125 * 2.54);
  const inches = cm / 2.54;
  withLayoutUpdate(() => {
    docSetFootnoteGap(inches);
  });
};

export const setFootnoteMaxHeightRatio = (value: number): void => {
  withLayoutUpdate(() => {
    docSetFootnoteMaxHeightRatio(value);
  });
};

export const setFootnoteSeparator = (values: { height?: number | string; color?: string }): void => {
  const heightIn =
    values.height !== undefined ? parseToCm(values.height as any, 0.01 * 2.54) / 2.54 : undefined;
  withLayoutUpdate(() => {
    docSetFootnoteSeparator({ heightIn, color: values.color });
  });
};

export const setMarginsPreset = (preset: keyof typeof MARGIN_PRESETS): void => {
  withLayoutUpdate(() => {
    layoutState.marginsCm = { ...MARGIN_PRESETS[preset].margins };
    docSetMarginsPreset(preset);
  });
};

export const resetMargins = (): void => {
  setMarginsPreset("normal");
};

export const setSectionColumns = (
  count: number,
  options?: { gapIn?: number; widthIn?: number | null }
): void => {
  const forceSingle = shouldForceSingleColumn();
  const normalized = forceSingle ? 1 : Math.max(1, Math.min(4, Math.floor(count)));
  const mode: ColumnMode = forceSingle
    ? "one"
    : normalized === 1
      ? "one"
      : normalized === 2
        ? "two"
        : normalized === 3
          ? "three"
          : "three";
  withLayoutUpdate(() => {
    const nextGapIn =
      typeof options?.gapIn === "number" && Number.isFinite(options.gapIn) && options.gapIn >= 0
        ? options.gapIn
        : layoutState.columns.gapIn;
    const nextWidthIn =
      options?.widthIn !== undefined
        ? typeof options.widthIn === "number" && Number.isFinite(options.widthIn) && options.widthIn > 0
          ? options.widthIn
          : null
        : layoutState.columns.widthIn;
    layoutState.columns = { ...layoutState.columns, count: normalized, mode, gapIn: nextGapIn, widthIn: nextWidthIn };
    docSetColumns(normalized);
    docSetColumnGap(nextGapIn);
    docSetColumnWidth(nextWidthIn);
  });
};

export const setColumnGap = (gapIn: number): void => {
  withLayoutUpdate(() => {
    layoutState.columns = { ...layoutState.columns, gapIn };
    docSetColumnGap(gapIn);
  });
};

export const setColumnWidth = (widthIn: number | null): void => {
  withLayoutUpdate(() => {
    layoutState.columns = { ...layoutState.columns, widthIn };
    docSetColumnWidth(widthIn);
  });
};

export const setColumnMode = (mode: ColumnMode): void => {
  const forceSingle = shouldForceSingleColumn();
  const count = forceSingle ? 1 : mode === "one" ? 1 : mode === "two" ? 2 : mode === "three" ? 3 : 2;
  const normalizedMode: ColumnMode = forceSingle ? "one" : mode;
  withLayoutUpdate(() => {
    layoutState.columns = { ...layoutState.columns, count, mode: normalizedMode };
    docSetColumns(count);
  });
};

export const subscribeToLayoutChanges = (listener: LayoutChangeListener): (() => void) => {
  layoutListeners.add(listener);
  listener(snapshotStateForListeners());
  return () => {
    layoutListeners.delete(listener);
  };
};

const initializeDocumentLayoutState = (): void => {
  if (shouldForceSingleColumn()) {
    layoutState.columns = { ...layoutState.columns, count: 1, mode: "one" };
  }
  docSetPageSizePreset(layoutState.pageSize.id);
  docSetOrientation(layoutState.orientation);
  docSetMarginsCustom({
    top: cmToInches(layoutState.marginsCm.top),
    right: cmToInches(layoutState.marginsCm.right),
    bottom: cmToInches(layoutState.marginsCm.bottom),
    left: cmToInches(layoutState.marginsCm.left)
  });
  docSetColumns(layoutState.columns.count);
  docSetColumnGap(layoutState.columns.gapIn);
  docSetColumnWidth(layoutState.columns.widthIn);
};

initializeDocumentLayoutState();
notifyLayoutChange();
