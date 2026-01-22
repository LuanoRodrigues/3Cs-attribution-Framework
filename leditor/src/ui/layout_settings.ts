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
  normal: { label: "Normal", margins: { top: 2.5, bottom: 2.5, left: 3.0, right: 3.0 } },
  moderate: { label: "Moderate", margins: { top: 2.5, bottom: 2.5, left: 1.9, right: 1.9 } },
  narrow: { label: "Narrow", margins: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 } },
  wide: { label: "Wide", margins: { top: 2.5, bottom: 2.5, left: 3.81, right: 3.81 } }
};

const cmToCss = (value: number): string => `${value}cm`;
const mmFromCm = (cm: number): number => cm * 10;

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
  columns: { mode: ColumnMode; count: number };
};

type LayoutChangeListener = (state: {
  orientation: Orientation;
  margins: MarginValues;
  marginsCm: MarginValuesCm;
  pageSize: PageSizeDefinition & { widthMm: number; heightMm: number };
  columns: number;
  columnsMode: ColumnMode;
}) => void;

const layoutState: LayoutState = {
  orientation: "portrait",
  marginsCm: { ...MARGIN_PRESETS.normal.margins },
  pageSize: PAGE_SIZE_DEFINITIONS[0],
  columns: { mode: "one", count: 1 }
};

const layoutListeners = new Set<LayoutChangeListener>();

const applyLayoutStyles = (): void => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const { orientation, pageSize, marginsCm, columns } = layoutState;
  const widthCm = orientation === "portrait" ? pageSize.widthCm : pageSize.heightCm;
  const heightCm = orientation === "portrait" ? pageSize.heightCm : pageSize.widthCm;
  root.style.setProperty("--page-width-mm", `${mmFromCm(widthCm)}`);
  root.style.setProperty("--page-height-mm", `${mmFromCm(heightCm)}`);
  root.style.setProperty("--page-margin-top", cmToCss(marginsCm.top));
  root.style.setProperty("--page-margin-right", cmToCss(marginsCm.right));
  root.style.setProperty("--page-margin-bottom", cmToCss(marginsCm.bottom));
  root.style.setProperty("--page-margin-left", cmToCss(marginsCm.left));
  root.style.setProperty(
    "--page-margin-inside",
    cmToCss(marginsCm.inside ?? marginsCm.left)
  );
  root.style.setProperty(
    "--page-margin-outside",
    cmToCss(marginsCm.outside ?? marginsCm.right)
  );
  root.style.setProperty("--page-columns", `${columns.count}`);
};

const snapshotStateForListeners = (): {
  orientation: Orientation;
  margins: MarginValues;
  marginsCm: MarginValuesCm;
  pageSize: PageSizeDefinition & { widthMm: number; heightMm: number };
  columns: number;
  columnsMode: ColumnMode;
} => {
  const { orientation, pageSize, marginsCm, columns } = layoutState;
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
    columnsMode: columns.mode
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

export const getLayoutColumns = (): number => layoutState.columns.count;

export const getColumnMode = (): ColumnMode => layoutState.columns.mode;

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
  });
};

export const setPageOrientation = (orientation: Orientation): void => {
  withLayoutUpdate(() => {
    layoutState.orientation = orientation;
  });
};

export const setPageMargins = (margins: Partial<MarginValues | MarginValuesCm>): void => {
  withLayoutUpdate(() => {
    const current = layoutState.marginsCm;
    const next: MarginValuesCm = {
      top: parseToCm((margins as any)?.top, current.top),
      right: parseToCm((margins as any)?.right, current.right),
      bottom: parseToCm((margins as any)?.bottom, current.bottom),
      left: parseToCm((margins as any)?.left, current.left),
      inside: margins?.inside !== undefined ? parseToCm((margins as any).inside, current.inside ?? current.left) : current.inside,
      outside: margins?.outside !== undefined ? parseToCm((margins as any).outside, current.outside ?? current.right) : current.outside
    };
    layoutState.marginsCm = next;
  });
};

export const setMarginsPreset = (preset: keyof typeof MARGIN_PRESETS): void => {
  withLayoutUpdate(() => {
    layoutState.marginsCm = { ...MARGIN_PRESETS[preset].margins };
  });
};

export const resetMargins = (): void => {
  setMarginsPreset("normal");
};

export const setSectionColumns = (count: number): void => {
  const normalized = Math.max(1, Math.min(4, Math.floor(count)));
  const mode: ColumnMode =
    normalized === 1 ? "one" : normalized === 2 ? "two" : normalized === 3 ? "three" : "three";
  withLayoutUpdate(() => {
    layoutState.columns = { count: normalized, mode };
  });
};

export const setColumnMode = (mode: ColumnMode): void => {
  const count = mode === "one" ? 1 : mode === "two" ? 2 : mode === "three" ? 3 : 2;
  withLayoutUpdate(() => {
    layoutState.columns = { count, mode };
  });
};

export const subscribeToLayoutChanges = (listener: LayoutChangeListener): (() => void) => {
  layoutListeners.add(listener);
  listener(snapshotStateForListeners());
  return () => {
    layoutListeners.delete(listener);
  };
};

notifyLayoutChange();
