import documentLayoutSpec from "../document_layout.json";

type DocumentLayoutSpec = typeof documentLayoutSpec;

type LayoutState = {
  spec: DocumentLayoutSpec;
  pageSizePresetId: string;
  orientation: "portrait" | "landscape";
  marginsPresetId: string;
  marginsCustomIn: { top: number; right: number; bottom: number; left: number } | null;
  gutterIn: number;
  gutterPositionId: "left" | "top";
  headerDistanceIn: number;
  footerDistanceIn: number;
};

const spec = documentLayoutSpec;
const defaults = spec.margins.presets.find((preset) => preset.id === spec.margins.defaultPresetId);
if (!defaults) {
  throw new Error("DocumentLayoutSpec default margins preset is missing.");
}
if (!spec.page.defaultSizePresetId) {
  throw new Error("DocumentLayoutSpec default page preset is missing.");
}
if (!spec.headerFooter.default) {
  throw new Error("DocumentLayoutSpec header/footer defaults are missing.");
}

const state: LayoutState = {
  spec,
  pageSizePresetId: spec.page.defaultSizePresetId,
  orientation: spec.page.defaultOrientation as "portrait" | "landscape",
  marginsPresetId: spec.margins.defaultPresetId,
  marginsCustomIn: null,
  gutterIn: spec.margins.gutter.defaultIn,
  gutterPositionId: spec.margins.gutter.defaultPositionId as "left" | "top",
  headerDistanceIn: spec.headerFooter.default.headerDistanceIn,
  footerDistanceIn: spec.headerFooter.default.footerDistanceIn
};

export const getDocumentLayoutSpec = (): DocumentLayoutSpec => state.spec;

export const getDocumentLayoutState = (): LayoutState => ({ ...state });

const parseLengthIn = (value: string | number): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") {
    throw new Error("Length value must be a string or number.");
  }
  const normalized = value.trim().toLowerCase();
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num)) {
    throw new Error(`Length value is invalid: ${value}.`);
  }
  if (normalized.endsWith("in")) return num;
  if (normalized.endsWith("cm")) return num / 2.54;
  if (normalized.endsWith("mm")) return num / 25.4;
  if (normalized.endsWith("pt")) return num / 72;
  if (normalized.endsWith("px")) return num / spec.units.pxPerIn;
  return num;
};

const computePx = (valueIn: number): number => {
  if (!Number.isFinite(valueIn)) {
    throw new Error("computePx requires a finite inch value.");
  }
  const raw = valueIn * spec.units.pxPerIn;
  const rounding = spec.units.roundingPolicy?.pxRounding ?? "round";
  if (rounding === "round") return Math.round(raw);
  if (rounding === "floor") return Math.floor(raw);
  if (rounding === "ceil") return Math.ceil(raw);
  throw new Error(`Unsupported px rounding policy: ${rounding}`);
};

const findPreset = <T extends { id: string }>(list: T[], id: string): T => {
  const preset = list.find((entry) => entry.id === id);
  if (!preset) {
    throw new Error(`Preset not found: ${id}.`);
  }
  return preset;
};

export const setPageSizePreset = (presetId: string): void => {
  const preset = findPreset(spec.page.sizePresets, presetId);
  state.pageSizePresetId = preset.id;
};

export const setOrientation = (orientation: "portrait" | "landscape"): void => {
  if (orientation !== "portrait" && orientation !== "landscape") {
    throw new Error("Orientation must be portrait or landscape.");
  }
  state.orientation = orientation;
};

export const setMarginsPreset = (presetId: string): void => {
  const preset = findPreset(spec.margins.presets, presetId);
  state.marginsPresetId = preset.id;
  state.marginsCustomIn = null;
};

export const setMarginsCustom = (values: {
  top: string | number;
  right: string | number;
  bottom: string | number;
  left: string | number;
}): void => {
  state.marginsCustomIn = {
    top: parseLengthIn(values.top),
    right: parseLengthIn(values.right),
    bottom: parseLengthIn(values.bottom),
    left: parseLengthIn(values.left)
  };
  state.marginsPresetId = "custom";
};

export const setGutter = (values: {
  enabled?: boolean;
  valueIn?: number;
  positionId?: "left" | "top";
}): void => {
  if (values.enabled === false) {
    state.gutterIn = 0;
    return;
  }
  if (values.valueIn !== undefined) {
    if (!Number.isFinite(values.valueIn)) {
      throw new Error("Gutter value must be a finite number.");
    }
    state.gutterIn = values.valueIn;
  }
  if (values.positionId) {
    state.gutterPositionId = values.positionId;
  }
};

export const setHeaderDistance = (valueIn: number): void => {
  if (!Number.isFinite(valueIn)) {
    throw new Error("Header distance must be a finite number.");
  }
  state.headerDistanceIn = valueIn;
};

export const setFooterDistance = (valueIn: number): void => {
  if (!Number.isFinite(valueIn)) {
    throw new Error("Footer distance must be a finite number.");
  }
  state.footerDistanceIn = valueIn;
};

export const applyDocumentLayoutTokenDefaults = (root: HTMLElement): void => {
  const defaults = state.spec.cssTokens?.defaults ?? {};
  Object.entries(defaults).forEach(([token, value]) => {
    root.style.setProperty(token, value);
  });
};

export const applyDocumentLayoutTokens = (root: HTMLElement): void => {
  if (!spec.cssTokens?.vars) {
    throw new Error("DocumentLayoutSpec CSS token vars are missing.");
  }
  const preset = findPreset(spec.page.sizePresets, state.pageSizePresetId);
  const widthIn = state.orientation === "portrait" ? preset.widthIn : preset.heightIn;
  const heightIn = state.orientation === "portrait" ? preset.heightIn : preset.widthIn;
  const marginsPreset = findPreset(spec.margins.presets, state.marginsPresetId);
  const margins = state.marginsCustomIn ?? marginsPreset.marginsIn;
  const gutter = state.gutterIn;
  const gutterPosition = state.gutterPositionId;
  const marginTop = margins.top + (gutterPosition === "top" ? gutter : 0);
  const marginLeft = margins.left + (gutterPosition === "left" ? gutter : 0);
  const marginRight = margins.right;
  const marginBottom = margins.bottom;
  const contentWidthIn = widthIn - (marginLeft + marginRight);
  const contentHeightIn = heightIn - (marginTop + marginBottom);
  if (contentWidthIn <= 0 || contentHeightIn <= 0) {
    throw new Error("Content dimensions are non-positive after applying margins.");
  }
  root.style.setProperty(spec.cssTokens.vars.pageWidth, `${computePx(widthIn)}px`);
  root.style.setProperty(spec.cssTokens.vars.pageHeight, `${computePx(heightIn)}px`);
  root.style.setProperty(spec.cssTokens.vars.contentWidth, `${computePx(contentWidthIn)}px`);
  root.style.setProperty(spec.cssTokens.vars.contentHeight, `${computePx(contentHeightIn)}px`);
  root.style.setProperty(spec.cssTokens.vars.marginTop, `${computePx(marginTop)}px`);
  root.style.setProperty(spec.cssTokens.vars.marginRight, `${computePx(marginRight)}px`);
  root.style.setProperty(spec.cssTokens.vars.marginBottom, `${computePx(marginBottom)}px`);
  root.style.setProperty(spec.cssTokens.vars.marginLeft, `${computePx(marginLeft)}px`);
  root.style.setProperty(spec.cssTokens.vars.gutter, `${computePx(gutter)}px`);
  root.style.setProperty(spec.cssTokens.vars.pageGap, `${computePx(spec.page.pageVisuals.pageGapDefaultIn)}px`);
  root.style.setProperty(spec.cssTokens.vars.headerDistance, `${computePx(state.headerDistanceIn)}px`);
  root.style.setProperty(spec.cssTokens.vars.footerDistance, `${computePx(state.footerDistanceIn)}px`);
  root.style.setProperty("--header-height", `${computePx(state.headerDistanceIn)}px`);
  root.style.setProperty("--footer-height", `${computePx(state.footerDistanceIn)}px`);
  root.style.setProperty("--page-width", `${computePx(widthIn)}px`);
  root.style.setProperty("--page-height", `${computePx(heightIn)}px`);
  root.style.setProperty("--page-width-landscape", `${computePx(state.orientation === "portrait" ? heightIn : widthIn)}px`);
  root.style.setProperty("--page-height-landscape", `${computePx(state.orientation === "portrait" ? widthIn : heightIn)}px`);
  root.style.setProperty("--page-margin-top", `${computePx(marginTop)}px`);
  root.style.setProperty("--page-margin-right", `${computePx(marginRight)}px`);
  root.style.setProperty("--page-margin-bottom", `${computePx(marginBottom)}px`);
  root.style.setProperty("--page-margin-left", `${computePx(marginLeft)}px`);
  root.style.setProperty("--page-margin-inside", `${computePx(marginLeft)}px`);
  root.style.setProperty("--page-margin-outside", `${computePx(marginRight)}px`);
};
