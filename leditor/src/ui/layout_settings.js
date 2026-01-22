"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscribeToLayoutChanges = exports.setColumnMode = exports.setSectionColumns = exports.resetMargins = exports.setMarginsPreset = exports.setPageMargins = exports.setPageOrientation = exports.setPageSize = exports.getColumnMode = exports.getLayoutColumns = exports.getMarginValuesCm = exports.getMarginValues = exports.getOrientation = exports.getCurrentPageSize = exports.getPageSizeDefinitions = void 0;
const PAGE_SIZE_DEFINITIONS = [
    { id: "a4", label: "A4", widthCm: 21.0, heightCm: 29.7 },
    { id: "a5", label: "A5", widthCm: 14.8, heightCm: 21.0 },
    { id: "a3", label: "A3", widthCm: 29.7, heightCm: 42.0 },
    { id: "letter", label: "Letter", widthCm: 21.59, heightCm: 27.94 }
];
const MARGIN_PRESETS = {
    normal: { label: "Normal", margins: { top: 2.54, bottom: 2.54, left: 2.54, right: 2.54 } },
    moderate: { label: "Moderate", margins: { top: 2.54, bottom: 2.54, left: 1.91, right: 1.91 } },
    narrow: { label: "Narrow", margins: { top: 1.27, bottom: 1.27, left: 1.27, right: 1.27 } },
    wide: { label: "Wide", margins: { top: 2.54, bottom: 2.54, left: 5.08, right: 5.08 } },
    mirrored: {
        label: "Mirrored",
        margins: { top: 2.54, bottom: 2.54, inside: 3.18, outside: 2.54, left: 3.18, right: 2.54 }
    }
};
const cmToCss = (value) => `${value}cm`;
const mmFromCm = (cm) => cm * 10;
const parseToCm = (value, fallback) => {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value !== "string")
        return fallback;
    const trimmed = value.trim().toLowerCase();
    if (!trimmed)
        return fallback;
    const numeric = Number.parseFloat(trimmed);
    if (!Number.isFinite(numeric))
        return fallback;
    if (trimmed.endsWith("cm"))
        return numeric;
    if (trimmed.endsWith("mm"))
        return numeric / 10;
    if (trimmed.endsWith("in"))
        return numeric * 2.54;
    return numeric;
};
const layoutState = {
    orientation: "portrait",
    marginsCm: { ...MARGIN_PRESETS.normal.margins },
    pageSize: PAGE_SIZE_DEFINITIONS[0],
    columns: { mode: "one", count: 1 }
};
const layoutListeners = new Set();
const applyLayoutStyles = () => {
    if (typeof document === "undefined")
        return;
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
    root.style.setProperty("--page-margin-inside", cmToCss(marginsCm.inside ?? marginsCm.left));
    root.style.setProperty("--page-margin-outside", cmToCss(marginsCm.outside ?? marginsCm.right));
    root.style.setProperty("--page-columns", `${columns.count}`);
};
const snapshotStateForListeners = () => {
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
const notifyLayoutChange = () => {
    applyLayoutStyles();
    const snapshot = snapshotStateForListeners();
    layoutListeners.forEach((listener) => listener(snapshot));
};
const withLayoutUpdate = (updater) => {
    updater();
    notifyLayoutChange();
};
const getPageSizeDefinitions = () => PAGE_SIZE_DEFINITIONS.map((def) => ({
    ...def,
    widthMm: mmFromCm(def.widthCm),
    heightMm: mmFromCm(def.heightCm)
}));
exports.getPageSizeDefinitions = getPageSizeDefinitions;
const getCurrentPageSize = () => {
    const snapshot = snapshotStateForListeners();
    return { ...snapshot.pageSize, orientation: snapshot.orientation };
};
exports.getCurrentPageSize = getCurrentPageSize;
const getOrientation = () => layoutState.orientation;
exports.getOrientation = getOrientation;
const getMarginValues = () => snapshotStateForListeners().margins;
exports.getMarginValues = getMarginValues;
const getMarginValuesCm = () => ({ ...layoutState.marginsCm });
exports.getMarginValuesCm = getMarginValuesCm;
const getLayoutColumns = () => layoutState.columns.count;
exports.getLayoutColumns = getLayoutColumns;
const getColumnMode = () => layoutState.columns.mode;
exports.getColumnMode = getColumnMode;
const setPageSize = (sizeId, overrides) => {
    withLayoutUpdate(() => {
        const target = sizeId ? PAGE_SIZE_DEFINITIONS.find((entry) => entry.id === sizeId) : undefined;
        const base = target ?? layoutState.pageSize;
        const widthCm = typeof overrides?.widthMm === "number" && Number.isFinite(overrides.widthMm)
            ? overrides.widthMm / 10
            : base.widthCm;
        const heightCm = typeof overrides?.heightMm === "number" && Number.isFinite(overrides.heightMm)
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
exports.setPageSize = setPageSize;
const setPageOrientation = (orientation) => {
    withLayoutUpdate(() => {
        layoutState.orientation = orientation;
    });
};
exports.setPageOrientation = setPageOrientation;
const setPageMargins = (margins) => {
    withLayoutUpdate(() => {
        const current = layoutState.marginsCm;
        const next = {
            top: parseToCm(margins?.top, current.top),
            right: parseToCm(margins?.right, current.right),
            bottom: parseToCm(margins?.bottom, current.bottom),
            left: parseToCm(margins?.left, current.left),
            inside: margins?.inside !== undefined ? parseToCm(margins.inside, current.inside ?? current.left) : current.inside,
            outside: margins?.outside !== undefined ? parseToCm(margins.outside, current.outside ?? current.right) : current.outside
        };
        layoutState.marginsCm = next;
    });
};
exports.setPageMargins = setPageMargins;
const setMarginsPreset = (preset) => {
    withLayoutUpdate(() => {
        layoutState.marginsCm = { ...MARGIN_PRESETS[preset].margins };
    });
};
exports.setMarginsPreset = setMarginsPreset;
const resetMargins = () => {
    setMarginsPreset("normal");
};
exports.resetMargins = resetMargins;
const setSectionColumns = (count) => {
    const normalized = Math.max(1, Math.min(4, Math.floor(count)));
    const mode = normalized === 1 ? "one" : normalized === 2 ? "two" : normalized === 3 ? "three" : "three";
    withLayoutUpdate(() => {
        layoutState.columns = { count: normalized, mode };
    });
};
exports.setSectionColumns = setSectionColumns;
const setColumnMode = (mode) => {
    const count = mode === "one" ? 1 : mode === "two" ? 2 : mode === "three" ? 3 : 2;
    withLayoutUpdate(() => {
        layoutState.columns = { count, mode };
    });
};
exports.setColumnMode = setColumnMode;
const subscribeToLayoutChanges = (listener) => {
    layoutListeners.add(listener);
    listener(snapshotStateForListeners());
    return () => {
        layoutListeners.delete(listener);
    };
};
exports.subscribeToLayoutChanges = subscribeToLayoutChanges;
notifyLayoutChange();
