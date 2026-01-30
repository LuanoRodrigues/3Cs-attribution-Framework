import { dispatchCommand } from "../api/editor_commands.ts";
import type { EditorCommandId } from "../api/editor_commands.ts";
import type { EditorHandle } from "../api/leditor.ts";
import layoutPlan from "./layout_plan.ts";
import { commandMap } from "../api/command_map.ts";
import { RibbonTabStrip } from "./ribbon_primitives.ts";
import { createRibbonButton, createRibbonDropdownButton } from "./ribbon_controls.ts";
import { createRibbonIcon, type RibbonIconName } from "./ribbon_icons.ts";
import { Menu, MenuItem, MenuSeparator, setMenuPortal } from "./ribbon_menu.ts";
import { SplitButton } from "./ribbon_split_button.ts";
import { getTemplates } from "../templates/index.ts";
import { getStyleTemplates, openStyleMiniApp } from "./style_mini_app.ts";
import { tabLayouts } from "./tab_layouts.ts";
import { INSERT_ICON_OVERRIDES } from "./ribbon_icon_overrides.ts";
import { resolveRibbonCommandId } from "./ribbon_command_aliases.ts";
import { refreshLayoutView } from "./layout_engine.ts";
import type { RibbonStateBus, RibbonStateKey, RibbonStateSnapshot } from "./ribbon_state.ts";
import { perfMark, perfMeasure } from "./perf.ts";
import type {
  ClusterConfig,
  ControlConfig,
  ControlType,
  GroupConfig,
  RibbonModel,
  TabConfig
} from "./ribbon_config.ts";
import type { AlignmentVariant } from "./ribbon_selection_helpers.ts";

type RibbonHooks = {
  registerToggle?: (commandId: EditorCommandId, element: HTMLButtonElement) => void;
  registerAlignment?: (variant: AlignmentVariant, element: HTMLButtonElement) => void;
};

type InstalledAddin = {
  id: string;
  name: string;
  description?: string;
};

const collectNestedControls = (control: ControlConfig): ControlConfig[] => {
  const nested: ControlConfig[] = [];
  if (Array.isArray(control.controls)) nested.push(...control.controls);
  if (Array.isArray(control.menu)) nested.push(...control.menu);
  if (Array.isArray(control.items)) nested.push(...control.items);
  if (control.gallery && Array.isArray(control.gallery.controls)) {
    nested.push(...control.gallery.controls);
  }
  return nested;
};

interface CollapseMeta {
  controlId: string | undefined;
  directives: Record<string, string>;
  element: HTMLElement;
  config: ControlConfig;
  priority: number;
}

interface GroupMeta {
  tabId: string;
  groupId: string;
  priority: number;
  element: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  collapse: CollapseMeta[];
  overflowMenu: Menu | null;
  overflowButton: HTMLButtonElement | null;
  originalParents: Map<HTMLElement, { parent: Node; next: Node | null }>;
}

const MAX_ROWS_BY_GROUP: Record<string, number> = {
  clipboard: 2,
  font: 2,
  paragraph: 2,
  styles: 2,
  editing: 2
};

const ROWED_TABS = new Set(["home", "insert", "layout", "references", "review", "view"]);
const ROWED_TAB_ROW_COUNTS: Record<string, number> = {
  home: 2,
  insert: 2,
  layout: 2,
  references: 2,
  review: 2,
  view: 2
};
const ROWED_TAB_ROW_COUNT_BY_GROUP: Record<string, number> = {
  paragraph: 2
};
const ROWED_TAB_MIN_PER_ROW = 1;
const ROWED_TAB_MAX_PER_ROW = 20;
const PINNED_CLUSTER_ROWS: Record<string, Record<string, number>> = {
  font: {
    "font.styles": 0
  },
  styles: {
    "styles.quickTemplates": 0,
    "styles.gallery": 1
  }
};

const GROUP_DEFAULT_ROW_INDEX: Record<string, number> = {
  font: 1
};

const resolvePinnedRow = (_tabId: string, groupId: string, clusterId: string): number | undefined => {
  return PINNED_CLUSTER_ROWS[groupId]?.[clusterId];
};

const applyGroupLayoutConfig = (body: HTMLDivElement, tabId: string, groupId: string): void => {
  const layout = tabLayouts[tabId]?.[groupId];
  if (!layout) return;
  const { gridTemplateColumns, gridTemplateRows, gridAutoFlow, gridAutoColumns, columnGap, rowGap } = layout;
  if (gridTemplateColumns) body.style.gridTemplateColumns = gridTemplateColumns;
  if (gridTemplateRows) body.style.gridTemplateRows = gridTemplateRows;
  if (gridAutoFlow) body.style.gridAutoFlow = gridAutoFlow;
  if (gridAutoColumns) body.style.gridAutoColumns = gridAutoColumns;
  if (columnGap) body.style.columnGap = columnGap;
  if (rowGap) body.style.rowGap = rowGap;
};

const stripNonFluentNodes = (button: HTMLElement): void => {
  const allowedSpanClasses = [
    "ribbon-button-label",
    "ribbon-dropdown-text",
    "ribbon-dropdown-title",
    "ribbon-dropdown-value"
  ];
  Array.from(button.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if (node.textContent?.trim()) {
        node.textContent = "";
      }
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "SVG") return;
    if (
      node.tagName === "SPAN" &&
      allowedSpanClasses.some((cls) => node.classList.contains(cls))
    ) {
      return;
    }
    node.remove();
  });
};

const resolveIconForElement = (
  element: HTMLElement,
  controlIconMap: Map<string, RibbonIconName>
): RibbonIconName | undefined => {
  const controlId = element.dataset.controlId ?? element.closest<HTMLElement>("[data-control-id]")?.dataset.controlId;
  if (!controlId) return undefined;
  return controlIconMap.get(controlId);
};

const resolveCommandId = (
  command: { id: string; args?: Record<string, unknown> },
  args?: Record<string, unknown>
): string => resolveRibbonCommandId(command, args);



const isMissingCommand = (commandId: string): boolean =>
  Boolean((commandMap[commandId] as { __missing?: boolean } | undefined)?.__missing);

const resolveControlTooltip = (
  control: ControlConfig,
  resolvedCommandId?: string
): string => {
  const label = control.label ?? "";
  if (!label) return label;
  if (resolvedCommandId && isMissingCommand(resolvedCommandId)) {
    return `${label} (missing)`;
  }
  return label;
};

const applyMenuItemTooltip = (
  element: HTMLElement,
  control: ControlConfig,
  resolvedCommandId?: string
): void => {
  const tooltip = resolveControlTooltip(control, resolvedCommandId);
  if (tooltip) {
    element.title = tooltip;
    element.dataset.tooltip = tooltip;
  }
};

const SCHEMA_VALUE_PATTERN =
  /^(string|number|boolean|null|enum|color|list|object|mixed)(\\|(string|number|boolean|null|enum|color|list|object|mixed))*$/;

const resolvePayloadSchema = (
  payloadSchema: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  if (!payloadSchema || typeof payloadSchema !== "object") return undefined;
  const values = Object.values(payloadSchema);
  if (values.length === 0) return undefined;
  const isSchema = values.every(
    (value) => typeof value === "string" && SCHEMA_VALUE_PATTERN.test(value)
  );
  return isSchema ? undefined : payloadSchema;
};

const buildCommandArgs = (
  command: ControlConfig["command"] | undefined,
  extra?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!command) return extra;
  const args: Record<string, unknown> = {};
  if (command.args && typeof command.args === "object") {
    Object.assign(args, command.args);
  }
  const payload = resolvePayloadSchema(command.payloadSchema);
  if (payload) {
    Object.assign(args, payload);
  }
  if (extra) {
    Object.assign(args, extra);
  }
  return Object.keys(args).length ? args : undefined;
};

const getStateValue = (
  ctx: BuildContext,
  binding: string | undefined
): RibbonStateSnapshot[RibbonStateKey] | undefined => {
  if (!binding || !ctx.stateBus) return undefined;
  const state = ctx.stateBus.getState();
  return state[binding as RibbonStateKey];
};

const getFontSizePresets = (tabs: TabConfig[]): number[] => {
  const presets: number[] = [];
  const visitControl = (control: ControlConfig) => {
    if (control.controlId === "font.size" && Array.isArray(control.presets)) {
      control.presets.forEach((value) => {
        if (Number.isFinite(value)) presets.push(Number(value));
      });
    }
    (control.menu ?? []).forEach(visitControl);
  };
  tabs.forEach((tab) => {
    tab.groups.forEach((group) => {
      group.clusters.forEach((cluster) => {
        cluster.controls.forEach(visitControl);
      });
    });
  });
  return Array.from(new Set(presets)).sort((a, b) => a - b);
};

const stepFontSize = (presets: number[], current: number | null, direction: 1 | -1): number => {
  if (!presets.length) {
    throw new Error("Font size presets are missing for grow/shrink commands.");
  }
  const sorted = [...presets].sort((a, b) => a - b);
  if (typeof current !== "number" || Number.isNaN(current)) {
    return direction === 1 ? sorted[0] : sorted[sorted.length - 1];
  }
  if (direction === 1) {
    const next = sorted.find((value) => value > current);
    return next ?? sorted[sorted.length - 1];
  }
  const reversed = [...sorted].reverse();
  const prev = reversed.find((value) => value < current);
  return prev ?? sorted[0];
};

const iconFromKey = (key?: string): RibbonIconName | undefined => {
  if (!key) return undefined;
  const simple = key.startsWith("icon.") ? key.slice(5) : key;
  // Map common cases; fallback to direct cast.
  const map: Record<string, RibbonIconName> = {
    paste: "paste",
    cut: "cut",
    copy: "copy",
    formatPainter: "formatPainter",
    cleanPaste: "pasteClean",
    undo: "undo",
    redo: "redo",
    growFont: "growFont",
    shrinkFont: "shrinkFont",
    bold: "bold",
    italic: "italic",
    underline: "underline",
    strikethrough: "strikethrough",
    subscript: "subscript",
    superscript: "superscript",
    inlineCode: "code",
    fontColor: "textColor",
    highlight: "highlight",
    changeCase: "changeCase",
    textEffects: "textEffects",
    bulletList: "bulletList",
    numberList: "numberList",
    multiList: "multiList",
    alignLeft: "alignLeft",
    alignCenter: "alignCenter",
    alignRight: "alignRight",
    alignJustify: "alignJustify",
    lineSpacing: "lineSpacing",
    spacingBefore: "spacingBefore",
    spacingAfter: "spacingAfter",
    clearFormatting: "clear",
    borders: "borders",
    shading: "shading",
    styles: "styles",
    stylesPane: "stylesPane",
    manageStyles: "manageStyles",
    styleSet: "styleSet",
    find: "find",
    replace: "replace",
    select: "select",
    regex: "regex",
    taskList: "taskList",
    paragraphStyle: "style",
    dialogLauncher: "dialogLauncher",
    print: "printLayout"
  } as const;
  return (map[simple] ?? (simple as RibbonIconName)) as RibbonIconName;
};

const resolveIconForControl = (control: ControlConfig): RibbonIconName | undefined => {
  if (control.controlId && INSERT_ICON_OVERRIDES[control.controlId]) {
    return INSERT_ICON_OVERRIDES[control.controlId];
  }
  const direct = iconFromKey(control.iconKey);
  if (direct) return direct;
  const map: Record<string, RibbonIconName> = {
    "font.underline": "underline",
    "font.color": "textColor",
    "font.highlight": "highlight",
    "paragraph.bullets": "bulletList",
    "paragraph.numbering": "numberList",
    "paragraph.multilevel": "multiList",
    "paragraph.taskList": "taskList",
    "paragraph.outdent": "indentDecrease",
    "paragraph.indent": "indentIncrease",
    "paragraph.showMarks": "visualChars",
    "paragraph.sort": "sort",
    "paragraph.spacing": "lineSpacing",
    "paragraph.borders": "borders",
    "paragraph.shading": "shading",
    "paragraph.blockquote": "blockquote",
    "paragraph.horizontalRule": "horizontalRule"
  };
  if (control.controlId && map[control.controlId]) return map[control.controlId];
  return undefined;
};

const resolveRequiredIcon = (control: ControlConfig): RibbonIconName => {
  const resolved = resolveIconForControl(control);
  return requireIcon(control, resolved);
};

const requireIcon = (control: ControlConfig, icon?: RibbonIconName): RibbonIconName => {
  if (icon) return icon;
  const id = control.controlId || control.command?.id || control.label || control.type;
  throw new Error(`Ribbon control "${id}" is missing an icon.`);
};

const ensureControlIcon = (element: HTMLElement, iconName?: RibbonIconName): void => {
  if (!iconName) return;
  const existing = element.querySelector(".leditor-ribbon-icon");
  if (existing) {
    const existingKey = (existing as HTMLElement).dataset.iconKey;
    if (!existingKey) {
      throw new Error(`Ribbon control icon missing data-icon-key for "${iconName}".`);
    }
    if (existingKey !== iconName) {
      throw new Error(`Ribbon control icon mismatch: expected "${iconName}", found "${existingKey}".`);
    }
    element.classList.add("has-icon");
    return;
  }
  const icon = createRibbonIcon(iconName);
  icon.classList.add("ribbon-button-icon");
  element.prepend(icon);
  element.classList.add("has-icon");
};

const applyTokens = (): void => {
  const root = document.documentElement;
  const tokens = layoutPlan.tokens;
  root.style.setProperty("--r-font-family", tokens.fontFamily);
  root.style.setProperty("--r-font-size-base", tokens.fontSize);
  root.style.setProperty("--r-font-size-sm-base", tokens.fontSizeSmall);
  root.style.setProperty("--r-line-height", `${tokens.lineHeight}`);
  root.style.setProperty("--r-tabstrip-height", tokens.tabstripHeight);
  root.style.setProperty("--r-panel-height", tokens.panelHeight);
  root.style.setProperty("--r-panel-pad-x-base", tokens.panelPadX);
  root.style.setProperty("--r-panel-pad-y-base", tokens.panelPadY);
  root.style.setProperty("--r-group-gap-base", tokens.groupGap);
  root.style.setProperty("--r-group-pad-base", tokens.groupPad);
  root.style.setProperty("--r-group-min-base", tokens.groupMinWidth);
  root.style.setProperty("--r-group-max", tokens.groupMaxWidth);
  root.style.setProperty("--r-ctl-h-sm", tokens.controlHeightSmall);
  root.style.setProperty("--r-ctl-h-md", tokens.controlHeightMedium);
  root.style.setProperty("--r-ctl-h-lg", tokens.controlHeightLarge);
  root.style.setProperty("--r-ctl-radius", tokens.controlRadius);
  root.style.setProperty("--r-ctl-gap-base", tokens.controlGap);
  root.style.setProperty("--r-icon-base", tokens.iconSize);
  root.style.setProperty("--r-icon-lg-base", tokens.iconSizeLarge);
  root.style.setProperty("--r-radius", tokens.radius);
  root.style.setProperty("--r-border", tokens.border);
  root.style.setProperty("--r-divider", tokens.divider);
  root.style.setProperty("--r-shadow", tokens.shadow);
  const colors = tokens.colors;
  root.style.setProperty("--r-bg", colors.bg);
  root.style.setProperty("--r-surface", colors.surface);
  root.style.setProperty("--r-surface-2", colors.surface2);
  root.style.setProperty("--r-text", colors.text);
  root.style.setProperty("--r-muted", colors.muted);
  root.style.setProperty("--r-disabled", colors.disabled);
  root.style.setProperty("--r-hover", colors.hover);
  root.style.setProperty("--r-pressed", colors.pressed);
  root.style.setProperty("--r-accent", colors.accent);
  root.style.setProperty("--r-selected", colors.selected);
  root.style.setProperty("--r-focus", colors.focus);
  root.style.setProperty("--r-ease", tokens.motion.ease);
  root.style.setProperty("--r-d1", tokens.motion.d1);
  root.style.setProperty("--r-d2", tokens.motion.d2);
};

const resolveControlId = (control: ControlConfig): string => {
  if (control.controlId) return control.controlId;
  if (control.command?.id) return control.command.id;
  if (control.label) return control.label;
  return control.type;
};

const applyControlDataAttributes = (
  element: HTMLElement,
  control: ControlConfig,
  sizeOverride?: string
): void => {
  element.dataset.controlId = resolveControlId(control);
  element.dataset.controlType = control.type;
  element.dataset.size = sizeOverride ?? control.size ?? "auto";
  const baseLabel = control.label ?? element.getAttribute("aria-label") ?? "";
  let tooltip = baseLabel;
  if (control.command?.id) {
    const resolved = resolveRibbonCommandId(control.command as { id: string; args?: Record<string, unknown> });
    const handler = commandMap[resolved] as { __missing?: boolean } | undefined;
    if (handler?.__missing) {
      tooltip = baseLabel ? `${baseLabel} (missing)` : `${resolved} (missing)`;
      element.dataset.missingCommand = "true";
    }
  }
  if (tooltip) {
    element.dataset.tooltip = tooltip;
    element.setAttribute("title", tooltip);
  }
  if (control.state?.binding) {
    element.dataset.stateBinding = control.state.binding;
  }
  if (control.command?.args && typeof control.command.args === "object") {
    const args = control.command.args as Record<string, unknown>;
    const value = args.id ?? args.style ?? args.value;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      element.dataset.stateValue = String(value);
    }
  }
};

const ensurePortal = (): HTMLElement => {
  const id = layoutPlan.zIndexPlan.portalElementId ?? "ribbon-portal";
  let portal = document.getElementById(id);
  if (!portal) {
    portal = document.createElement("div");
    portal.id = id;
    portal.className = "ribbon-portal leditor-ribbon";
    portal.style.zIndex = String(layoutPlan.zIndexPlan.menusAndPickers ?? 1000);
    document.body.appendChild(portal);
  } else {
    portal.classList.add("ribbon-portal", "leditor-ribbon");
  }
  return portal;
};

const ensurePortalStyle = (portal: HTMLElement): void => {
  const expectedId = layoutPlan.zIndexPlan.portalElementId ?? "ribbon-portal";
  const expectedZIndex = String(layoutPlan.zIndexPlan.menusAndPickers ?? 2100);
  if (portal.id !== expectedId) {
    console.warn(`[Ribbon] Expected portal id "${expectedId}", found "${portal.id}"`);
  }
  if (portal.style.zIndex !== expectedZIndex) {
    console.warn(`[Ribbon] Portal z-index ${portal.style.zIndex} differs from expected ${expectedZIndex}; enforcing value.`);
    portal.style.zIndex = expectedZIndex;
  }
};
 
const createOverflowButton = (label: string, menu: Menu): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ribbon-overflow-button";
  button.setAttribute("aria-label", `${label} overflow`);
  button.appendChild(createRibbonIcon("more"));
  button.dataset.controlId = `${label}.overflow`;
  button.dataset.controlType = "overflow";
  button.dataset.groupId = label;
  button.dataset.size = "small";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.open(button);
  });
  return button;
};

type BuildContext = {
  editorHandle: EditorHandle;
  hooks: RibbonHooks;
  menuRegistry: Map<string, Menu>;
  stateBus?: RibbonStateBus;
  fontSizePresets: number[];
  onStageUpdate?: (stage: string) => void;
  defaultStage?: string;
  disableCollapse?: boolean;
};

type GalleryEntry = {
  id: string;
  label: string;
  description?: string;
  payload?: Record<string, unknown>;
};

type DynamicEntry = {
  id: string;
  label: string;
  description?: string;
  payload?: Record<string, unknown>;
};

const TABLE_PICKER_ROWS = 8;
const TABLE_PICKER_COLS = 10;

const galleryProviders: Record<string, () => GalleryEntry[]> = {
  "pages.coverPage.gallery": () =>
    getTemplates().map((template) => ({
      id: template.id,
      label: template.label,
      description: template.description,
      payload: { templateId: template.id }
    })),
  "illustrations.shapes.gallery": () => [
    { id: "rectangle", label: "Rectangle", description: "Framing block for callouts", payload: { shapeId: "rectangle" } },
    { id: "roundedRectangle", label: "Rounded rectangle", description: "Friendly container", payload: { shapeId: "roundedRectangle" } },
    { id: "arrow", label: "Arrow", description: "Directional indicator", payload: { shapeId: "arrow" } },
    { id: "star", label: "Starburst", description: "Highlight key insight", payload: { shapeId: "star" } },
    { id: "cloud", label: "Cloud", description: "Thought bubble", payload: { shapeId: "cloud" } }
  ],
  "headerFooter.header.gallery": () => [
    { id: "header_academic", label: "Title + Date", description: "Center-aligned title with date band", payload: { templateId: "header_academic" } },
    { id: "header_catalog", label: "Catalog", description: "Two-column title with separator", payload: { templateId: "header_catalog" } },
    { id: "header_modern", label: "Modern", description: "Bold left accent stroke", payload: { templateId: "header_modern" } }
  ],
  "headerFooter.footer.gallery": () => [
    { id: "footer_center", label: "Center pagination", description: "Page number at center", payload: { templateId: "footer_center" } },
    { id: "footer_contacts", label: "Contacts", description: "Footer with contact info", payload: { templateId: "footer_contacts" } },
    { id: "footer_accent", label: "Accented rule", description: "Thin rule with page number", payload: { templateId: "footer_accent" } }
  ],
  "text.textBox.gallery": () => [
    { id: "text_callout", label: "Callout box", description: "Tailored pointer for annotations", payload: { templateId: "text_callout" } },
    { id: "text_highlight", label: "Highlight", description: "Rounded highlight with headline", payload: { templateId: "text_highlight" } },
    { id: "text_quote", label: "Quote", description: "Indented block quote", payload: { templateId: "text_quote" } },
    { id: "text_sidebars", label: "Side panel", description: "Narrow info sidebar", payload: { templateId: "text_sidebars" } }
  ],
  "text.wordArt.gallery": () => [
    { id: "wordart_ribbon", label: "Ribbon", description: "Angled ribbon style", payload: { styleId: "wordart_ribbon" } },
    { id: "wordart_shadow", label: "Shadow", description: "Drop shadow emphasis", payload: { styleId: "wordart_shadow" } },
    { id: "wordart_outline", label: "Outline", description: "Outlined typography", payload: { styleId: "wordart_outline" } }
  ],
  "symbols.equation.gallery": () => [
    { id: "equation_quadratic", label: "Quadratic formula", description: "ax² + bx + c = 0", payload: { templateId: "equation_quadratic" } },
    { id: "equation_matrix", label: "Matrix", description: "3×3 matrix layout", payload: { templateId: "equation_matrix" } },
    { id: "equation_integral", label: "Integral", description: "Integral with bounds", payload: { templateId: "equation_integral" } }
  ],
  "paragraph.bullets.gallery": () => [
    { id: "disc", label: "• Bullets", description: "Filled circle bullets", payload: { styleId: "disc" } },
    { id: "circle", label: "◦ Hollow bullets", description: "Hollow circle bullets", payload: { styleId: "circle" } },
    { id: "square", label: "▪ Square bullets", description: "Square bullets", payload: { styleId: "square" } }
  ],
  "paragraph.numbering.gallery": () => [
    { id: "decimal", label: "1. 2. 3.", description: "Decimal numbering", payload: { styleId: "decimal" } },
    { id: "lower-alpha", label: "a. b. c.", description: "Lowercase letters", payload: { styleId: "lower-alpha" } },
    { id: "upper-alpha", label: "A. B. C.", description: "Uppercase letters", payload: { styleId: "upper-alpha" } },
    { id: "lower-roman", label: "i. ii. iii.", description: "Lowercase roman numerals", payload: { styleId: "lower-roman" } },
    { id: "upper-roman", label: "I. II. III.", description: "Uppercase roman numerals", payload: { styleId: "upper-roman" } }
  ]
};

const fallbackSymbols: DynamicEntry[] = [
  { id: "symbol_check", label: "Check mark", description: "✓", payload: { codepoint: "✓" } },
  { id: "symbol_pi", label: "Pi", description: "π", payload: { codepoint: "π" } },
  { id: "symbol_infty", label: "Infinity", description: "∞", payload: { codepoint: "∞" } },
  { id: "symbol_sigma", label: "Sigma", description: "∑", payload: { codepoint: "∑" } }
];

const BUILTIN_CITATION_STYLE_LABELS: Record<string, string> = {
  apa: "APA",
  "harvard-cite-them-right": "Harvard (Cite Them Right)",
  "chicago-author-date": "Chicago (Author-Date)",
  "chicago-note-bibliography": "Chicago (Notes & Bibliography)",
  vancouver: "Vancouver (Numeric)",
  ieee: "IEEE (Numeric)",
  nature: "Nature (Numeric)",
  "modern-language-association": "MLA",
  oscola: "OSCOLA",
  "turabian-fullnote-bibliography": "Turabian (Fullnote Bibliography)"
};

const formatCitationStyleValue = (value: unknown): string => {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!id) return "";
  return BUILTIN_CITATION_STYLE_LABELS[id] ?? id;
};

const BUILTIN_PARAGRAPH_STYLE_LABELS: Record<string, string> = {
  "font.style.normal": "Normal",
  "font.style.title": "Title",
  "font.style.subtitle": "Subtitle",
  "font.style.blockquote": "Blockquote",
  "font.style.heading1": "Heading 1",
  "font.style.heading2": "Heading 2",
  "font.style.heading3": "Heading 3",
  "font.style.heading4": "Heading 4",
  "font.style.heading5": "Heading 5",
  "font.style.heading6": "Heading 6"
};

const DEFAULT_FONT_FAMILY = "Times New Roman";
const DEFAULT_FONT_SIZE = 12;

const formatParagraphStyleValue = (value: unknown): string => {
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) return "";
  return BUILTIN_PARAGRAPH_STYLE_LABELS[key] ?? key;
};

const listCitationStyles = (): DynamicEntry[] => {
  const builtins: Array<{ id: string; label: string }> = [
    { id: "apa", label: "APA" },
    { id: "harvard-cite-them-right", label: "Harvard (Cite Them Right)" },
    { id: "chicago-author-date", label: "Chicago (Author-Date)" },
    { id: "chicago-note-bibliography", label: "Chicago (Notes & Bibliography)" },
    { id: "vancouver", label: "Vancouver (Numeric)" },
    { id: "ieee", label: "IEEE (Numeric)" },
    { id: "nature", label: "Nature (Numeric)" },
    { id: "modern-language-association", label: "MLA" },
    { id: "oscola", label: "OSCOLA" },
    { id: "turabian-fullnote-bibliography", label: "Turabian (Fullnote Bibliography)" }
  ];
  const entries: DynamicEntry[] = builtins.map((s) => ({
    id: s.id,
    label: s.label,
    payload: { id: s.id }
  }));

  try {
    const imported = Object.keys(window.localStorage || {})
      .filter((k) => k.startsWith("leditor.csl.style:"))
      .map((k) => k.replace("leditor.csl.style:", ""))
      .filter(Boolean)
      .sort();
    imported.forEach((name) => {
      const id = name.replace(/\.csl$/i, "").trim().toLowerCase().replace(/\s+/g, "-");
      if (!id) return;
      entries.push({
        id: `imported:${name}`,
        label: `Imported: ${name}`,
        description: `Switch document styleId to "${id}"`,
        payload: { id }
      });
    });
  } catch {
    // ignore storage errors
  }
  return entries;
};

const mapInstalledAddins = (items?: InstalledAddin[]): DynamicEntry[] =>
  (items ?? []).map((addin) => ({
    id: addin.id,
    label: addin.name,
    description: addin.description,
    payload: { id: addin.id }
  }));

const dynamicSources: Record<string, (ctx: BuildContext) => Promise<DynamicEntry[]>> = {
  installedAddins: async () => {
    if (typeof window === "undefined") return [];
    const host = window.leditorHost;
    if (!host) return [];
    const fallback = mapInstalledAddins(host.installedAddins);
    if (host.getInstalledAddins) {
      try {
        return mapInstalledAddins(await host.getInstalledAddins());
      } catch {
        return fallback;
      }
    }
    return fallback;
  },
  recentSymbols: async () => fallbackSymbols,
  citationStyles: async () => listCitationStyles()
};

const createMenuSectionHeader = (label: string): HTMLDivElement => {
  const header = document.createElement("div");
  header.className = "leditor-menu-section-header";
  header.textContent = label;
  return header;
};

const runMenuCommand = (
  ctx: BuildContext,
  command: ControlConfig["command"] | undefined,
  extra?: Record<string, unknown>
): void => {
  if (!command) throw new Error("Menu command is not configured");
  const args = buildCommandArgs(command, extra);
  const targetId = resolveCommandId(command as any, args);
  if ((targetId === "HighlightColor" || targetId === "TextColor") && args?.value === null) {
    const fallback = targetId === "HighlightColor" ? "RemoveHighlightColor" : "RemoveTextColor";
    dispatchCommand(ctx.editorHandle, fallback as any);
    return;
  }
  dispatchCommand(ctx.editorHandle, targetId as any, args);
};

const createTableGridPicker = (
  menu: Menu,
  ctx: BuildContext,
  item: ControlConfig
): HTMLDivElement => {
  if (!item.command) throw new Error("Custom table picker missing command");
  const container = document.createElement("div");
  container.className = "rtablePicker";
  const grid = document.createElement("div");
  grid.className = "rtablePicker__grid";
  const status = document.createElement("div");
  status.className = "rtablePicker__status";
  status.textContent = "1 × 1";

  const updateHighlight = (rows: number, cols: number) => {
    status.textContent = `${rows} × ${cols}`;
    grid.querySelectorAll<HTMLElement>(".rtablePicker__cell").forEach((cell) => {
      const cellRow = Number(cell.dataset.row ?? "0");
      const cellCol = Number(cell.dataset.col ?? "0");
      cell.dataset.active = cellRow <= rows && cellCol <= cols ? "true" : "false";
    });
  };

  for (let row = 1; row <= TABLE_PICKER_ROWS; row += 1) {
    for (let col = 1; col <= TABLE_PICKER_COLS; col += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rtablePicker__cell";
      button.dataset.row = String(row);
      button.dataset.col = String(col);
      button.addEventListener("mouseenter", () => updateHighlight(row, col));
      button.addEventListener("focus", () => updateHighlight(row, col));
      button.addEventListener("click", () => {
        runMenuCommand(ctx, item.command, { rows: row, cols: col });
        menu.close();
      });
      grid.appendChild(button);
    }
  }

  updateHighlight(1, 1);
  container.appendChild(grid);
  container.appendChild(status);
  return container;
};

const createGalleryMenu = (menu: Menu, ctx: BuildContext, item: ControlConfig): HTMLDivElement => {
  const galleryId = item.controlId ?? "";
  const provider = galleryProviders[galleryId];
  const container = document.createElement("div");
  container.className = "rgallery";
  const entries = provider ? provider() : [];

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "rgallery__empty";
    empty.textContent = "No gallery entries available";
    container.appendChild(empty);
    return container;
  }

  const nav = document.createElement("div");
  nav.className = "rgallery__nav";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "rgallery__nav-btn";
  prevBtn.setAttribute("aria-label", "Previous templates");
  prevBtn.appendChild(createRibbonIcon("previous"));
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "rgallery__nav-btn";
  nextBtn.setAttribute("aria-label", "Next templates");
  nextBtn.appendChild(createRibbonIcon("next"));
  nav.append(prevBtn, nextBtn);

  const viewport = document.createElement("div");
  viewport.className = "rgallery__viewport";
  const buildEntryButton = (entry: GalleryEntry): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "rgallery__item";
    button.dataset.galleryItem = entry.id;
    const title = document.createElement("span");
    title.className = "rgallery__title";
    title.textContent = entry.label;
    button.appendChild(title);
    if (entry.description) {
      const description = document.createElement("span");
      description.className = "rgallery__description";
      description.textContent = entry.description;
      button.appendChild(description);
    }
    button.addEventListener("click", () => {
      runMenuCommand(ctx, item.command, entry.payload);
      menu.close();
    });
    return button;
  };

  entries.forEach((entry) => viewport.appendChild(buildEntryButton(entry)));

  const getStep = (): number => {
    const first = viewport.querySelector<HTMLElement>(".rgallery__item");
    if (!first) return 160;
    const style = getComputedStyle(viewport);
    const gap = Number.parseFloat(style.columnGap || style.gap || "10") || 10;
    return first.getBoundingClientRect().width + gap;
  };

  const syncButtons = (): void => {
    const maxScrollLeft = viewport.scrollWidth - viewport.clientWidth;
    prevBtn.disabled = viewport.scrollLeft <= 1;
    nextBtn.disabled = viewport.scrollLeft >= maxScrollLeft - 1;
  };

  prevBtn.addEventListener("click", () => {
    viewport.scrollBy({ left: -getStep(), behavior: "smooth" });
  });
  nextBtn.addEventListener("click", () => {
    viewport.scrollBy({ left: getStep(), behavior: "smooth" });
  });
  viewport.addEventListener("scroll", () => {
    syncButtons();
  });
  syncButtons();

  container.append(nav, viewport);
  return container;
};

const menuRefreshers = new WeakMap<Menu, Array<() => void>>();
const menuOpenPatched = new WeakSet<Menu>();

const renderDynamicMenu = (menu: Menu, ctx: BuildContext, item: ControlConfig): void => {
  const container = document.createElement("div");
  container.className = "leditor-menu-dynamic";
  applyControlDataAttributes(container, item);
  menu.element.appendChild(container);
  const source = item.source ?? "";
  const provider = dynamicSources[source];
  if (!provider) {
    container.appendChild(createMenuSectionHeader("Source not supported"));
    return;
  }

  const refresh = () => {
    container.textContent = "";
    container.appendChild(createMenuSectionHeader("Loading…"));
    void provider(ctx)
      .then((entries) => {
        container.textContent = "";
        if (!entries.length) {
          container.appendChild(createMenuSectionHeader(`No ${item.label ?? "items"} available`));
          return;
        }
        entries.forEach((entry) => {
          const currentStyle = source === "citationStyles" ? getStateValue(ctx, "citationStyle") : undefined;
          const nextStyle = typeof entry.payload?.id === "string" ? entry.payload.id : "";
          const button = MenuItem({
            label: entry.label,
            onSelect: () => {
              runMenuCommand(ctx, item.command, entry.payload);
              menu.close();
            }
          });
          applyControlDataAttributes(button, { ...item, type: "menuItem" });
          if (nextStyle) {
            button.dataset.stateValue = nextStyle;
          }
          if (typeof currentStyle === "string" && nextStyle && currentStyle === nextStyle) {
            button.classList.add("is-selected");
          }
          button.textContent = "";
          const title = document.createElement("span");
          title.className = "leditor-menu-item-title";
          title.textContent = entry.label;
          button.appendChild(title);
          if (entry.description) {
            const detail = document.createElement("span");
            detail.className = "leditor-menu-item-description";
            detail.textContent = entry.description;
            button.appendChild(detail);
          }
          container.appendChild(button);
        });
      })
      .catch(() => {
        container.textContent = "";
        container.appendChild(createMenuSectionHeader("Failed to load items"));
      });
  };

  const list = menuRefreshers.get(menu) ?? [];
  list.push(refresh);
  menuRefreshers.set(menu, list);

  if (!menuOpenPatched.has(menu)) {
    menuOpenPatched.add(menu);
    const originalOpen = menu.open.bind(menu);
    menu.open = ((anchor?: HTMLElement) => {
      (menuRefreshers.get(menu) ?? []).forEach((fn) => fn());
      originalOpen(anchor);
    }) as any;
  }

  refresh();
};

const createMenuItemButton = (menu: Menu, ctx: BuildContext, item: ControlConfig, toggle = false): HTMLButtonElement => {
  const rawLabel = item.label ?? item.controlId ?? "";
  const button = MenuItem({
    label: rawLabel,
    onSelect: () => {
      const baseArgs = buildCommandArgs(item.command);
      menu.close();
      if (!baseArgs && (item.command?.id === "TextColor" || item.command?.id === "HighlightColor")) {
        const raw = window.prompt("Enter a hex color (e.g. #1f2937)");
        if (!raw) {
          return;
        }
        runMenuCommand(ctx, item.command, { value: raw.trim() });
      } else {
        runMenuCommand(ctx, item.command, undefined);
      }
    }
  });
  if (item.controlId?.startsWith("font.style.")) {
    button.classList.add("leditor-menu-item--style-preview");
    button.dataset.previewKind = "paragraphStyle";
    button.dataset.previewValue = item.controlId.slice("font.style.".length);
    button.dataset.stateValue = item.controlId;

    button.textContent = "";
    const label = document.createElement("span");
    label.className = "leditor-menu-item__label";
    label.textContent = rawLabel;
    const sample = document.createElement("span");
    sample.className = "leditor-menu-item__sample";
    sample.textContent = "AaBbCc";
    button.append(label, sample);
  }
  if (toggle) {
    button.setAttribute("aria-checked", "false");
    button.dataset.toggle = "true";
  }
  const resolvedId = item.command ? resolveCommandId(item.command as any) : undefined;
  applyMenuItemTooltip(button, item, resolvedId);
  applyControlDataAttributes(button, { ...item, type: toggle ? "menuToggle" : "menuItem" });
  menu.element.appendChild(button);
  return button;
};

const createCustomWidget = (menu: Menu, ctx: BuildContext, item: ControlConfig): HTMLElement | null => {
  if (item.widget === "tableGridPicker") {
    return createTableGridPicker(menu, ctx, item);
  }
  if (item.widget === "styleTemplateGallery") {
    return createStyleTemplateGallery(ctx);
  }
  return null;
};

const createColorPalette = (menu: Menu, ctx: BuildContext, item: ControlConfig): HTMLElement => {
  const palette = document.createElement("div");
  palette.className = "leditor-color-picker-palette";
  applyControlDataAttributes(palette, item);
  const colors =
    (item as any).colors ??
    (Array.isArray(item.palette?.rows)
      ? item.palette?.rows.flat().filter((entry) => typeof entry === "string")
      : []);
  const command = item.command;
  if (colors.length && !menu.element.dataset.defaultColor) {
    menu.element.dataset.defaultColor = colors[0];
  }
  colors.forEach((color: string) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "leditor-color-picker-swatch";
    swatch.style.setProperty("--swatch-color", color);
    swatch.title = color;
    swatch.addEventListener("click", () => {
      const payload: Record<string, unknown> = {};
      if (command?.args && typeof command.args === "object") {
        Object.assign(payload, command.args);
      }
      payload.value = color;
      menu.element.dataset.lastColor = color;
      runMenuCommand(ctx, command, payload);
      menu.close?.();
    });
    palette.appendChild(swatch);
  });
  return palette;
};

const openStylesContextMenu = (anchor: HTMLElement, ctx: BuildContext): void => {
  const menu = new Menu([]);
  const appState = { editorHandle: ctx.editorHandle };
  menu.element.append(
    MenuItem({
      label: "New Style…",
      onSelect: () => {
        openStyleMiniApp(anchor, appState, { mode: "create" });
        menu.close();
      }
    }),
    MenuItem({
      label: "Modify Style…",
      onSelect: () => {
        openStyleMiniApp(anchor, appState, { mode: "modify" });
        menu.close();
      }
    }),
    MenuSeparator(),
    MenuItem({
      label: "Clear Style",
      onSelect: () => {
        dispatchCommand(ctx.editorHandle, "ClearFormatting");
        menu.close();
      }
    })
  );
  menu.open(anchor);
};

const attachStylesContextMenu = (
  element: HTMLElement,
  ctx: BuildContext,
  options: { openOnClick?: boolean; suppressDefault?: boolean } = {}
): void => {
  const handleOpen = (event: MouseEvent) => {
    if (options.suppressDefault) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    openStylesContextMenu(element, ctx);
  };
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    handleOpen(event);
  });
  if (options.openOnClick) {
    element.addEventListener(
      "click",
      (event) => {
        if (event.button !== 0) return;
        handleOpen(event);
      },
      { capture: !!options.suppressDefault }
    );
  }
};

const createStyleTemplateGallery = (ctx: BuildContext): HTMLElement => {
  const templates = getStyleTemplates();
  const shell = document.createElement("div");
  shell.className = "home-quick-style-shell";

  const gallery = document.createElement("div");
  gallery.className = "home-quick-style-gallery";

  const nav = document.createElement("div");
  nav.className = "home-quick-style-nav";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "home-quick-style-nav-btn";
  prevBtn.setAttribute("aria-label", "Previous templates");
  prevBtn.appendChild(createRibbonIcon("previous"));
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "home-quick-style-nav-btn";
  nextBtn.setAttribute("aria-label", "Next templates");
  nextBtn.appendChild(createRibbonIcon("next"));
  nav.append(prevBtn, nextBtn);

  const appState = { editorHandle: ctx.editorHandle };
  templates.forEach((template) => {
    const card = document.createElement("div");
    card.className = "home-quick-style-card";
    card.setAttribute("data-template-id", template.templateId);
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    const label = document.createElement("div");
    label.className = "home-quick-style-card__label";
    label.textContent = template.label;
    card.title = template.label;

    const applyTemplate = () => {
      // Apply the selected template to the whole document.
      try {
        ctx.editorHandle.execCommand("ApplyTemplate", { id: template.templateId });
        refreshLayoutView();
      } catch (error) {
        console.error("[QuickTemplates] Failed to apply template", template.templateId, error);
        const message = error instanceof Error ? error.message : String(error);
        window.alert(`Failed to apply template "${template.label}": ${message}`);
      }
    };

    card.addEventListener("click", applyTemplate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        applyTemplate();
      }
    });

    card.append(label);
    if (template.description && template.description.trim().length > 0) {
      const description = document.createElement("p");
      description.className = "home-quick-style-card__description";
      description.textContent = template.description;
      card.appendChild(description);
    }
    gallery.appendChild(card);
  });
  const getStep = (): number => {
    const first = gallery.querySelector<HTMLElement>(".home-quick-style-card");
    if (!first) return 160;
    const style = getComputedStyle(gallery);
    const gap = Number.parseFloat(style.columnGap || style.gap || "6") || 6;
    return first.getBoundingClientRect().width + gap;
  };
  const syncButtons = (): void => {
    const maxScrollLeft = gallery.scrollWidth - gallery.clientWidth;
    prevBtn.disabled = gallery.scrollLeft <= 1;
    nextBtn.disabled = gallery.scrollLeft >= maxScrollLeft - 1;
  };
  const scheduleSyncButtons = (): void => {
    // This component is built before being attached to the DOM, so measure after layout.
    requestAnimationFrame(() => requestAnimationFrame(syncButtons));
  };
  prevBtn.addEventListener("click", () => {
    gallery.scrollBy({ left: -getStep(), behavior: "smooth" });
  });
  nextBtn.addEventListener("click", () => {
    gallery.scrollBy({ left: getStep(), behavior: "smooth" });
  });
  gallery.addEventListener("scroll", () => syncButtons());
  scheduleSyncButtons();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => scheduleSyncButtons());
    ro.observe(gallery);
  } else {
    window.addEventListener("resize", scheduleSyncButtons);
  }

  attachStylesContextMenu(gallery, ctx);
  shell.append(gallery, nav);
  return shell;
};

const buildMenu = (items: ControlConfig[] | undefined, ctx: BuildContext): Menu => {
  const menu = new Menu([]);
  if (!items) return menu;
  items.forEach((item) => {
    switch (item.type) {
      case "separator":
        menu.element.appendChild(MenuSeparator());
        break;
      case "menuItem":
        createMenuItemButton(menu, ctx, item);
        break;
      case "menuToggle":
        createMenuItemButton(menu, ctx, item, true);
        break;
      case "gallery": {
        const gallery = createGalleryMenu(menu, ctx, item);
        menu.element.appendChild(gallery);
        break;
      }
      case "custom": {
        const widget = createCustomWidget(menu, ctx, item);
        if (widget) {
          menu.element.appendChild(widget);
        }
        break;
      }
      case "colorPalette": {
        const palette = createColorPalette(menu, ctx, item);
        menu.element.appendChild(palette);
        break;
      }
      case "dynamic":
        renderDynamicMenu(menu, ctx, item);
        break;
      case "sectionHeader":
        menu.element.appendChild(createMenuSectionHeader(item.label ?? ""));
        break;
      default:
        throw new Error(`Unsupported menu control type: ${item.type}`);
    }
  });
  return menu;
};

const recordParent = (meta: GroupMeta, el: HTMLElement) => {
  meta.originalParents.set(el, { parent: el.parentNode as Node, next: el.nextSibling });
};

const restoreElement = (meta: GroupMeta, el: HTMLElement) => {
  const loc = meta.originalParents.get(el);
  if (!loc) return;
  const { parent, next } = loc;
  if (!parent || !(parent as any).appendChild) return;
  if (next && next.parentNode === parent) {
    parent.insertBefore(el, next);
  } else {
    parent.appendChild(el);
  }
};

const buildControl = (
  control: ControlConfig,
  meta: GroupMeta,
  ctx: BuildContext
): { element: HTMLElement; collapse: CollapseMeta | null } => {
  const id = control.controlId;
  const size = control.size ?? "small";
  const icon = resolveIconForControl(control);
  const collapseDirectives = control.collapse ?? {};
  const collapseMeta: CollapseMeta = {
    controlId: id,
    directives: collapseDirectives,
    element: undefined as unknown as HTMLElement,
    config: control,
    priority: control.priority ?? 50
  };

  const commandHandler = () => {
    if (!control.command) throw new Error(`Control ${id ?? "?"} missing command`);
    const args = buildCommandArgs(control.command);
    const targetId = resolveCommandId(control.command as any, args);
    dispatchCommand(ctx.editorHandle, targetId as any, args);
  };

  const runFontSizeStep = (direction: 1 | -1) => {
    const current = getStateValue(ctx, "fontSize");
    const numeric = typeof current === "number" ? current : null;
    const next = stepFontSize(ctx.fontSizePresets, numeric, direction);
    dispatchCommand(ctx.editorHandle, "FontSize" as any, { valuePx: next });
  };

  const runColorSplitPrimary = () => {
    if (!control.command) throw new Error(`Control ${id ?? "?"} missing command`);
    const menu = ctx.menuRegistry.get(id ?? "");
    const stateValue = getStateValue(ctx, control.state?.binding);
    const fromState = typeof stateValue === "string" ? stateValue : undefined;
    const fromMenu = menu?.element.dataset.lastColor || menu?.element.dataset.defaultColor;
    const color = fromState ?? fromMenu;
    if (!color) {
      throw new Error(`Color split button ${id ?? "?"} has no current color value`);
    }
    runMenuCommand(ctx, control.command, { value: color });
  };

  if (control.type === "button" || control.type === "toggleButton") {
    if (control.command?.id === "font.size.grow") {
      const tooltip = resolveControlTooltip(control);
      const button = createRibbonButton({
        icon,
        label: control.label ?? "",
        tooltip,
        size,
        toggle: false,
        onClick: () => runFontSizeStep(1)
      });
      ensureControlIcon(button, icon);
      applyControlDataAttributes(button, control, size);
      if (control.label) {
        const labelSpan = document.createElement("span");
        labelSpan.className = "ribbon-button-label";
        labelSpan.textContent = control.label;
        button.appendChild(labelSpan);
      }
      collapseMeta.element = button;
      recordParent(meta, button);
      return { element: button, collapse: collapseMeta };
    }
    if (control.command?.id === "font.size.shrink") {
      const tooltip = resolveControlTooltip(control);
      const button = createRibbonButton({
        icon,
        label: control.label ?? "",
        tooltip,
        size,
        toggle: false,
        onClick: () => runFontSizeStep(-1)
      });
      ensureControlIcon(button, icon);
      applyControlDataAttributes(button, control, size);
      if (control.label) {
        const labelSpan = document.createElement("span");
        labelSpan.className = "ribbon-button-label";
        labelSpan.textContent = control.label;
        button.appendChild(labelSpan);
      }
      collapseMeta.element = button;
      recordParent(meta, button);
      return { element: button, collapse: collapseMeta };
    }
    const args = control.command ? buildCommandArgs(control.command) : undefined;
    const targetId = control.command ? resolveCommandId(control.command as any, args) : undefined;
    const requiredIcon = requireIcon(control, icon);
    const tooltip = resolveControlTooltip(control, targetId);
    const button = createRibbonButton({
      icon: requiredIcon,
      label: control.label ?? "",
      tooltip,
      size,
      toggle: control.type === "toggleButton",
      onClick: commandHandler,
      commandId: targetId as any
    });
    ensureControlIcon(button, requiredIcon);
    applyControlDataAttributes(button, control, size);
    if (control.label) {
      const labelSpan = document.createElement("span");
      labelSpan.className = "ribbon-button-label";
      labelSpan.textContent = control.label;
      button.appendChild(labelSpan);
    }
    if (control.type === "toggleButton") {
      ctx.hooks.registerToggle?.(targetId as any, button);
    }
    if (id === "styles.manage" || id === "styles.pane") {
      attachStylesContextMenu(button, ctx, { openOnClick: true, suppressDefault: true });
    }
    collapseMeta.element = button;
    recordParent(meta, button);
    return { element: button, collapse: collapseMeta };
  }

  if (
    control.controlId === "font.underline" &&
    (control.type === "splitButton" || control.type === "splitToggleButton" || control.type === "colorSplitButton")
  ) {
    const menu = buildMenu(control.menu, ctx);
    ctx.menuRegistry.set(id ?? "", menu);
    const targetArgs = control.command ? buildCommandArgs(control.command) : undefined;
    const targetId = control.command ? resolveCommandId(control.command as any, targetArgs) : undefined;
    const requiredIcon = requireIcon(control, icon);
    const tooltip = resolveControlTooltip(control, targetId);
    const button = createRibbonButton({
      icon: requiredIcon,
      label: control.label ?? "",
      tooltip,
      size,
      toggle: true,
      onClick: () => {
        menu.open(button);
        button.setAttribute("aria-expanded", "true");
      },
      commandId: targetId as any
    });
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    menu.onClose(() => {
      button.setAttribute("aria-expanded", "false");
    });
    ensureControlIcon(button, requiredIcon);
    applyControlDataAttributes(button, control, size);
    if (targetId) {
      ctx.hooks.registerToggle?.(targetId as any, button);
    }
    collapseMeta.element = button;
    recordParent(meta, button);
    return { element: button, collapse: collapseMeta };
  }

  if (control.type === "splitButton" || control.type === "splitToggleButton" || control.type === "colorSplitButton") {
    const menu = buildMenu(control.menu, ctx);
    ctx.menuRegistry.set(id ?? "", menu);
    const requiredIcon = requireIcon(control, icon);
    const iconEl = createRibbonIcon(requiredIcon);
    iconEl.classList.add("ribbon-button-icon");
    const tooltip = resolveControlTooltip(control, id ?? "");
    const split = new SplitButton({
      label: control.label ?? "",
      tooltip,
      iconElement: iconEl,
      onPrimary: control.type === "colorSplitButton" ? runColorSplitPrimary : commandHandler,
      menu,
      logLabel: id
    });
    const primary = split.element.querySelector(".leditor-split-primary");
    if (primary) {
      if (!primary.querySelector(".leditor-ribbon-icon")) {
        const iconClone = iconEl.cloneNode(true) as HTMLElement;
        primary.prepend(iconClone);
      }
      Array.from(primary.childNodes).forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          node.textContent = "";
        }
      });
      primary.querySelectorAll(".ribbon-button-label").forEach((label) => label.remove());
    }
    if (primary instanceof HTMLElement) {
      ensureControlIcon(primary, requiredIcon);
    }
    applyControlDataAttributes(split.element, control, control.size ?? "medium");
    collapseMeta.element = split.element;
    recordParent(meta, split.element);
    return { element: split.element, collapse: collapseMeta };
  }

  if (control.type === "dropdown" || control.type === "colorPicker") {
    const menu = buildMenu(control.menu, ctx);
    ctx.menuRegistry.set(id ?? "", menu);
    const requiredIcon = requireIcon(control, icon);
    const tooltip = resolveControlTooltip(control, id ?? "");
    const button = createRibbonDropdownButton({
      icon: requiredIcon,
      label: control.label ?? "",
      tooltip,
      menu
    });
    if (control.size === "large") {
      button.classList.remove("leditor-ribbon-button--medium");
      button.classList.add("leditor-ribbon-button--large");
    } else if (control.size === "small") {
      button.classList.remove("leditor-ribbon-button--medium");
      button.classList.add("leditor-ribbon-button--small");
    }
    if (control.controlId === "cite.style") {
      button.classList.add("ribbon-dropdown--big");
      const textWrap = document.createElement("span");
      textWrap.className = "ribbon-dropdown-text";
      const title = document.createElement("span");
      title.className = "ribbon-dropdown-title";
      title.textContent = control.label ?? "";
      const value = document.createElement("span");
      value.className = "ribbon-dropdown-value";
      value.textContent = formatCitationStyleValue(getStateValue(ctx, control.state?.binding));
      textWrap.append(title, value);
      button.appendChild(textWrap);
      const chevron = createRibbonIcon("chevronDown");
      chevron.classList.add("ribbon-dropdown-chevron");
      button.appendChild(chevron);
    }
    if (control.controlId === "font.style") {
      button.classList.add("ribbon-dropdown--big");
      const textWrap = document.createElement("span");
      textWrap.className = "ribbon-dropdown-text";
      const title = document.createElement("span");
      title.className = "ribbon-dropdown-title";
      title.textContent = control.label ?? "Style";
      const value = document.createElement("span");
      value.className = "ribbon-dropdown-value";
      value.textContent =
        formatParagraphStyleValue(getStateValue(ctx, control.state?.binding)) || "Normal";
      textWrap.append(title, value);
      button.appendChild(textWrap);
      const chevron = createRibbonIcon("chevronDown");
      chevron.classList.add("ribbon-dropdown-chevron");
      button.appendChild(chevron);
    }
    ensureControlIcon(button, requiredIcon);
    applyControlDataAttributes(button, control, control.size ?? "medium");
    collapseMeta.element = button;
    recordParent(meta, button);
    return { element: button, collapse: collapseMeta };
  }

  if (control.type === "combobox") {
    const box = document.createElement("div");
    box.className = "leditor-ribbon-combobox";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "leditor-ribbon-combobox-input";
    input.placeholder = control.label ?? "";
    box.appendChild(input);

    const suggestions = (control as any)?.suggestions?.items;
    const hasSuggestions = Array.isArray(suggestions) && suggestions.length > 0;
    const menu = hasSuggestions ? new Menu([]) : null;
    if (menu && id) {
      ctx.menuRegistry.set(id, menu);
    }

    const openMenu = (): void => {
      if (!menu) return;
      menu.open(box);
    };

    let suppressBlur = false;

    const applyValue = (value: string): void => {
      if (!control.command) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      runMenuCommand(ctx, control.command, { value: trimmed });
    };

    if (menu && hasSuggestions) {
      suggestions.forEach((fontName: unknown) => {
        if (typeof fontName !== "string") return;
        const name = fontName.trim();
        if (!name) return;
        const item = MenuItem({
          label: name,
          onSelect: () => {
            suppressBlur = true;
            input.value = name;
            applyValue(name);
            menu.close();
            queueMicrotask(() => {
              suppressBlur = false;
            });
          }
        });
        item.classList.add("leditor-menu-item--font-preview");
        item.style.fontFamily = name;
        item.textContent = "";
        const label = document.createElement("span");
        label.className = "leditor-menu-item__label";
        label.textContent = name;
        const sample = document.createElement("span");
        sample.className = "leditor-menu-item__sample";
        sample.textContent = "AaBbCc";
        item.append(label, sample);
        menu.element.appendChild(item);
      });
    }

    if (control.controlId === "font.family") {
      input.value = DEFAULT_FONT_FAMILY;
    }

    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "leditor-ribbon-combobox-caret";
    caret.setAttribute("aria-label", `${control.label ?? "Combobox"} options`);
    caret.appendChild(createRibbonIcon("chevronDown"));
    caret.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openMenu();
    });

    input.addEventListener("click", () => openMenu());
    input.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        openMenu();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        applyValue(input.value);
      }
    });
    input.addEventListener("blur", () => {
      if (suppressBlur) return;
      applyValue(input.value);
    });

    box.appendChild(caret);
    applyControlDataAttributes(box, control, control.size ?? "medium");
    collapseMeta.element = box;
    recordParent(meta, box);
    return { element: box, collapse: collapseMeta };
  }

  if (control.type === "spinnerDropdown" || control.type === "spinner-dropdown") {
    if (!control.command) throw new Error(`Spinner ${id ?? "?"} missing command`);
    const spinnerContainer = document.createElement("div");
    spinnerContainer.className = "ribbon-spinner-dropdown";
    const input = document.createElement("input");
    input.type = "number";
    input.className = "ribbon-spinner-input";
    input.placeholder = control.label ?? "";
    spinnerContainer.appendChild(input);

    const menu = new Menu([]);
    ctx.menuRegistry.set(id ?? "", menu);
    const runSpinnerCommand = (value: number) => {
      const payloadSchema = control.command?.payloadSchema;
      const payload: Record<string, unknown> = {};
      if (payloadSchema && Object.keys(payloadSchema).length > 0) {
        const key = Object.keys(payloadSchema)[0];
        payload[key] = value;
      } else {
        payload.value = value;
      }
      runMenuCommand(ctx, control.command, payload);
    };

    const presets = control.presets ?? [];
    if (control.controlId === "font.size") {
      input.value = String(DEFAULT_FONT_SIZE);
    } else if (presets.length) {
      input.value = String(presets[0]);
    }
    if (presets.length) {
      presets.forEach((preset) => {
        const item = MenuItem({
          label: `${preset}`,
          onSelect: () => runSpinnerCommand(preset)
        });
        applyControlDataAttributes(item, { ...control, type: "menuItem" });
        menu.element.appendChild(item);
      });
    } else {
      const item = MenuItem({
        label: "Custom",
        onSelect: () => {
          const current = Number.parseFloat(input.value);
          if (Number.isFinite(current)) {
            runSpinnerCommand(current);
          }
        }
      });
      applyControlDataAttributes(item, { ...control, type: "menuItem" });
      menu.element.appendChild(item);
    }

    // Use a lightweight caret button (not a full ribbon dropdown button) to avoid nested chrome.
    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "ribbon-spinner-caret";
    caret.setAttribute("aria-label", `${control.label ?? "Spinner"} options`);
    caret.setAttribute("aria-haspopup", "menu");
    caret.appendChild(createRibbonIcon("chevronDown"));
    caret.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      menu.open(spinnerContainer);
    });
    spinnerContainer.appendChild(caret);

    const parseCurrentValue = (): number => {
      const current = Number.parseFloat(input.value);
      if (Number.isFinite(current)) {
        return current;
      }
      if (control.controlId === "font.size") {
        return DEFAULT_FONT_SIZE;
      }
      return presets[0] ?? 0;
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runSpinnerCommand(parseCurrentValue());
      }
    });
    input.addEventListener("blur", () => {
      runSpinnerCommand(parseCurrentValue());
    });

    const tooltip = resolveControlTooltip(control, id ?? "");
    if (tooltip) {
      spinnerContainer.dataset.tooltip = tooltip;
      spinnerContainer.title = tooltip;
    }
    applyControlDataAttributes(spinnerContainer, control, control.size ?? "medium");
    collapseMeta.element = spinnerContainer;
    recordParent(meta, spinnerContainer);
    return { element: spinnerContainer, collapse: collapseMeta };
  }

  if (control.type === "gallery") {
    const gal = document.createElement("div");
    gal.className = "ribbon-gallery";
    gal.textContent = control.label ?? "Gallery";
    applyControlDataAttributes(gal, control, control.size ?? "medium");
    if (id === "styles.gallery") {
      attachStylesContextMenu(gal, ctx);
    }
    collapseMeta.element = gal;
    recordParent(meta, gal);
    return { element: gal, collapse: collapseMeta };
  }

  if (control.type === "custom") {
    if (control.widget === "styleTemplateGallery") {
      const gallery = createStyleTemplateGallery(ctx);
      applyControlDataAttributes(gallery, control, control.size ?? "medium");
      collapseMeta.element = gallery;
      recordParent(meta, gallery);
      return { element: gallery, collapse: collapseMeta };
    }
    throw new Error(`Unsupported custom control widget: ${control.widget}`);
  }

  if (control.type === "dialogLauncher") {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ribbon-dialog-launcher";
    btn.setAttribute("aria-label", control.label ?? "Open dialog");
    const tooltip = resolveControlTooltip(control, id ?? "");
    if (tooltip) {
      btn.dataset.tooltip = tooltip;
      btn.title = tooltip;
    }
    const iconEl = createRibbonIcon(requireIcon(control, icon));
    btn.appendChild(iconEl);
    btn.addEventListener("click", commandHandler);
    applyControlDataAttributes(btn, control, control.size ?? "small");
    collapseMeta.element = btn;
    recordParent(meta, btn);
    return { element: btn, collapse: collapseMeta };
  }

  throw new Error(`Unsupported control type: ${control.type}`);
};

const buildCluster = (
  cluster: ClusterConfig,
  meta: GroupMeta,
  ctx: BuildContext
): HTMLElement => {
  const container = document.createElement("div");
  container.className = `ribbon-cluster ribbon-cluster--${cluster.layout}`;
  container.classList.add(`ribbon-cluster-${cluster.clusterId.replace(/\./g, "-")}`);
  container.dataset.clusterId = cluster.clusterId;
  cluster.controls.forEach((control: ControlConfig) => {
    const { element, collapse } = buildControl(control, meta, ctx);
    container.appendChild(element);
    if (collapse) {
      meta.collapse.push(collapse);
    }
  });
  return container;
};

const buildGroup = (group: GroupConfig, ctx: BuildContext, tabId: string): GroupMeta => {
  const element = document.createElement("div");
  element.className = "leditor-ribbon-group";
  element.classList.add(`ribbon-group-${group.groupId.replace(/\./g, "-")}`);
  element.dataset.groupId = group.groupId;
  const body = document.createElement("div");
  body.className = "leditor-ribbon-group-body";
  body.dataset.groupId = group.groupId;
  if (tabId !== "home") {
    applyGroupLayoutConfig(body, tabId, group.groupId);
  }
  const footer = document.createElement("div");
  footer.className = "leditor-ribbon-group-footer";
  const title = document.createElement("span");
  title.className = "leditor-ribbon-group-title";
  title.textContent = group.label ?? "";
  footer.appendChild(title);

  const meta: GroupMeta = {
    tabId,
    groupId: group.groupId,
    priority: group.priority ?? 50,
    element,
    body,
    footer,
    collapse: [],
    overflowMenu: null,
    overflowButton: null,
    originalParents: new Map()
  };

  const baseMaxRows = MAX_ROWS_BY_GROUP[group.groupId] ?? 5;
  const rowCountCap = ROWED_TABS.has(tabId) ? (ROWED_TAB_ROW_COUNTS[tabId] ?? 1) : baseMaxRows;
  const maxRows = ROWED_TABS.has(tabId) ? Math.min(baseMaxRows, rowCountCap) : baseMaxRows;
  body.style.setProperty("--r-group-max-rows", String(maxRows));
  body.dataset.maxRows = String(maxRows);

  const customRowCount = ROWED_TAB_ROW_COUNTS[tabId];
  if (customRowCount !== undefined) {
    const effectiveRowCount = ROWED_TAB_ROW_COUNT_BY_GROUP[group.groupId] ?? customRowCount;
    body.dataset.rowCount = String(effectiveRowCount);
    const rawClusters = group.clusters ?? [];
    const clusters =
      tabId !== "home" &&
      effectiveRowCount === 2 &&
      rawClusters.length === 1 &&
      Array.isArray(rawClusters[0]?.controls) &&
      rawClusters[0].controls.length >= 4
        ? (() => {
            const base = rawClusters[0];
            const controls = base.controls;
            const splitAt = Math.ceil(controls.length / 2);
            const first = controls.slice(0, splitAt);
            const second = controls.slice(splitAt);
            return [
              { ...base, clusterId: `${base.clusterId}.row1`, controls: first },
              { ...base, clusterId: `${base.clusterId}.row2`, controls: second }
            ] as ClusterConfig[];
          })()
        : rawClusters;
    const minPerRow = ROWED_TAB_MIN_PER_ROW;
    const perRow = Math.min(
      ROWED_TAB_MAX_PER_ROW,
      Math.max(minPerRow, Math.ceil(clusters.length / effectiveRowCount))
    );
    const rows: HTMLDivElement[] = [];
    for (let i = 0; i < effectiveRowCount; i += 1) {
      const row = document.createElement("div");
      row.className = "leditor-ribbon-group-row";
      row.dataset.rowIndex = String(i + 1);
      rows.push(row);
      body.appendChild(row);
    }
    let rowIndex = tabId === "home" ? (GROUP_DEFAULT_ROW_INDEX[group.groupId] ?? 0) : 0;
    let rowItemCount = 0;
    clusters.forEach((cluster) => {
      const clusterEl = buildCluster(cluster, meta, ctx);
      const pinnedRow = resolvePinnedRow(tabId, group.groupId, cluster.clusterId);
      const isPinned = pinnedRow !== undefined;
      const targetRow = pinnedRow ?? rowIndex;
      rows[targetRow].appendChild(clusterEl);
      if (!isPinned) {
        rowItemCount += 1;
        if (rowItemCount >= perRow && rowIndex < rows.length - 1) {
          rowIndex += 1;
          rowItemCount = 0;
        }
      }
    });
  } else {
    (group.clusters ?? []).forEach((cluster) => {
      const clusterEl = buildCluster(cluster, meta, ctx);
      body.appendChild(clusterEl);
    });
  }

  if (group.dialogLauncher) {
    const { element: dl } = buildControl(group.dialogLauncher, meta, ctx);
    dl.classList.add("ribbon-dialog-launcher-btn");
    footer.appendChild(dl);
  }

  element.append(body, footer);
  return meta;
};

const resetGroup = (meta: GroupMeta) => {
  meta.element.dataset.collapseStage = "A";
  meta.element.classList.remove("is-collapsed-group");
  const existingButton = meta.element.querySelector(".ribbon-group-button");
  existingButton?.remove();
  if (meta.body.parentNode !== meta.element) {
    meta.element.insertBefore(meta.body, meta.footer);
  }
  if (meta.footer.parentNode !== meta.element) {
    meta.element.appendChild(meta.footer);
  }
  meta.body.hidden = false;
  meta.footer.hidden = false;
  if (meta.overflowButton) {
    meta.overflowButton.remove();
    meta.overflowButton = null;
  }
  if (meta.overflowMenu) {
    meta.overflowMenu.element.innerHTML = "";
  }
  meta.collapse.forEach((c) => {
    c.element.classList.remove("is-icon-only", "is-hidden", "is-dropdown-only");
    if (c.element instanceof HTMLButtonElement) {
      c.element.disabled = false;
    }
    restoreElement(meta, c.element);
    c.element.style.display = "";
  });
};

const applyStageB = (meta: GroupMeta, ctx: BuildContext) => {
  let overflowMenu = meta.overflowMenu;
  const ensureOverflow = () => {
    if (overflowMenu) return overflowMenu;
    overflowMenu = new Menu([]);
    meta.overflowMenu = overflowMenu;
    const btn = createOverflowButton(meta.groupId, overflowMenu);
    meta.overflowButton = btn;
    meta.footer.appendChild(btn);
    return overflowMenu;
  };

  const sortedCollapse = [...meta.collapse].sort((a, b) => a.priority - b.priority);
  sortedCollapse.forEach((c) => {
    const directive = c.directives["B"] ?? "visible";
    switch (directive) {
      case "visible":
        return;
      case "hidden":
        c.element.style.display = "none";
        return;
      case "iconOnly":
      case "compact":
      case "narrow":
      case "medium":
      case "optional":
        {
          const iconName = resolveIconForControl(c.config);
          if (!iconName) {
            console.warn("[Ribbon] Skipping iconOnly for control without iconKey", {
              controlId: c.config.controlId ?? c.config.command?.id ?? c.config.label ?? c.config.type
            });
            return;
          }
          c.element.classList.add("is-icon-only");
          ensureControlIcon(c.element, iconName);
        }
        return;
      case "dropdownOnly":
        c.element.classList.add("is-dropdown-only");
        return;
      default:
        if (directive.startsWith("inOverflowOf:")) {
          const targetId = directive.split(":")[1];
          const targetMenu = targetId ? ctx.menuRegistry.get(targetId) : null;
          const menu = targetMenu ?? ensureOverflow();
          const mi = MenuItem({
            label: c.config.label ?? c.controlId ?? "",
            onSelect: () => {
              if (!c.config.command) throw new Error(`Overflow item missing command: ${c.controlId}`);
              dispatchCommand(ctx.editorHandle, c.config.command.id as any, c.config.command.args);
            }
          });
          const resolvedId = c.config.command ? resolveCommandId(c.config.command as any) : undefined;
          applyMenuItemTooltip(mi, c.config, resolvedId);
          applyControlDataAttributes(mi, { ...c.config, type: "menuItem" });
          menu.element.appendChild(mi);
          c.element.style.display = "none";
          return;
        }
        if (directive.startsWith("inOverflow")) {
          const menu = ensureOverflow();
          const mi = MenuItem({
            label: c.config.label ?? c.controlId ?? "",
            onSelect: () => {
              if (!c.config.command) throw new Error(`Overflow item missing command: ${c.controlId}`);
              dispatchCommand(ctx.editorHandle, c.config.command.id as any, c.config.command.args);
            }
          });
          const resolvedId = c.config.command ? resolveCommandId(c.config.command as any) : undefined;
          applyMenuItemTooltip(mi, c.config, resolvedId);
          applyControlDataAttributes(mi, { ...c.config, type: "menuItem" });
          menu.element.appendChild(mi);
          c.element.style.display = "none";
          return;
        }
        if (directive.startsWith("inMenuOf:")) {
          const targetId = directive.split(":")[1];
          const targetMenu = targetId ? ctx.menuRegistry.get(targetId) : null;
          if (!targetMenu) throw new Error(`inMenuOf target not found: ${directive}`);
          const mi = MenuItem({
            label: c.config.label ?? c.controlId ?? "",
            onSelect: () => {
              if (!c.config.command) throw new Error(`Menu-of item missing command: ${c.controlId}`);
              dispatchCommand(ctx.editorHandle, c.config.command.id as any, c.config.command.args);
            }
          });
          const resolvedId = c.config.command ? resolveCommandId(c.config.command as any) : undefined;
          applyMenuItemTooltip(mi, c.config, resolvedId);
          applyControlDataAttributes(mi, { ...c.config, type: "menuItem" });
          targetMenu.element.appendChild(mi);
          c.element.style.display = "none";
          return;
        }
        throw new Error(`Unknown collapse directive for Stage B: ${directive}`);
    }
  });
};

const createGroupFlyout = (meta: GroupMeta, portal: HTMLElement) => {
  const flyout = document.createElement("div");
  flyout.className = "ribbon-group-flyout";
  flyout.dataset.tabId = meta.tabId;
  flyout.dataset.groupId = meta.groupId;
  flyout.appendChild(meta.body);
  portal.appendChild(flyout);
  return flyout;
};

const collapseToStageC = (
  groups: GroupMeta[],
  portal: HTMLElement,
  availableWidth: number
): { stillOverflows: boolean } => {
  const sorted = [...groups].sort((a, b) => a.priority - b.priority);
  // Use DOM-measured widths so we collapse the minimum number of groups needed.
  let total = groups.reduce((sum, g) => sum + g.element.getBoundingClientRect().width, 0);
  for (const meta of sorted) {
    if (total <= availableWidth) break;
    const before = meta.element.getBoundingClientRect().width;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ribbon-group-button";
    button.textContent = meta.groupId;
    button.dataset.controlId = `${meta.groupId}.collapse`;
    button.dataset.controlType = "groupCollapse";
    button.dataset.groupId = meta.groupId;
    button.dataset.tabId = meta.tabId;
    button.dataset.size = "medium";
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const panel = meta.element.closest<HTMLElement>(".leditor-ribbon-panel");
      const registerFlyout = (panel as any)?.__registerRibbonFlyout as
        | ((flyout: HTMLElement, close: (ev: MouseEvent) => void) => void)
        | undefined;
      const placeholder = document.createComment("group-body-placeholder");
      if (meta.body.parentNode === meta.element) {
        meta.element.replaceChild(placeholder, meta.body);
      }
      const flyout = createGroupFlyout(meta, portal);
      const rect = button.getBoundingClientRect();
      flyout.style.left = `${rect.left}px`;
      flyout.style.top = `${rect.bottom + 4}px`;
      const close = (ev: MouseEvent) => {
        const target = ev.target as Node;
        if (!flyout.contains(target)) {
          flyout.remove();
          if (placeholder.parentNode) {
            placeholder.parentNode.replaceChild(meta.body, placeholder);
          }
          meta.body.hidden = true;
          meta.footer.hidden = true;
          document.removeEventListener("mousedown", close, true);
        }
      };
      if (registerFlyout) {
        registerFlyout(flyout, close);
      }
      document.addEventListener("mousedown", close, true);
      meta.body.hidden = false;
      meta.footer.hidden = false;
    });
    meta.body.hidden = true;
    meta.footer.hidden = true;
    meta.element.appendChild(button);
    meta.element.classList.add("is-collapsed-group");
    meta.element.dataset.collapseStage = "C";
    const after = meta.element.getBoundingClientRect().width;
    total -= Math.max(0, before - after);
  }
  return { stillOverflows: total > availableWidth + 1 };
};

const auditIconOnlyControls = (panelEl: HTMLElement): void => {
  const iconOnly = Array.from(panelEl.querySelectorAll<HTMLElement>(".is-icon-only"));
  const missing = iconOnly.filter((el) => {
    const icon = el.querySelector<HTMLElement>(".leditor-ribbon-icon, .ribbon-button-icon, svg");
    return !(icon instanceof SVGElement) || !icon.querySelector("path");
  });
  if (missing.length) {
    console.warn("[Ribbon][CollapseAudit] icon-only controls missing SVG icons", {
      count: missing.length,
      controls: missing.map((el) => el.dataset.controlId ?? el.className)
    });
  }
};

const applyCollapseStages = (
  panelEl: HTMLElement,
  groups: GroupMeta[],
  portal: HTMLElement,
  ctx: BuildContext,
  cleanup: { closeFlyouts: () => void }
) => {
  if (ctx.disableCollapse) {
    panelEl.dataset.collapseStage = "A";
    panelEl.dataset.stage = "A";
    return;
  }
  const strip = panelEl.querySelector<HTMLElement>(".leditor-ribbon-groups");
  if (!strip) return;

  const available = Math.floor(strip.getBoundingClientRect().width);
  const currentStage = (panelEl.dataset.collapseStage as "A" | "B" | "C" | undefined) ?? "A";
  panelEl.dataset.groupScroll = "disabled";

  // Use the current DOM widths as a hysteresis band to avoid oscillation.
  const totalCurrent = groups.reduce((sum, g) => sum + g.element.getBoundingClientRect().width, 0);
  const needsMoreSpace = totalCurrent > available + 8;
  const hasSlack = totalCurrent < available - 24;

  // If current stage is stable within the band, do nothing.
  if (!needsMoreSpace && !hasSlack) {
    panelEl.dataset.stage = currentStage;
    auditIconOnlyControls(panelEl);
    return;
  }

  // Any stage change should close active flyouts (stage C menu listeners).
  cleanup.closeFlyouts();

  // Reset back to a known baseline before applying a new stage.
  groups.forEach(resetGroup);
  const totalA = groups.reduce((sum, g) => sum + g.element.offsetWidth, 0);
  if (totalA <= available) {
    panelEl.dataset.collapseStage = "A";
    panelEl.dataset.stage = "A";
    auditIconOnlyControls(panelEl);
    return;
  }
  // If we're already at stage A and only barely overflow, keep A to avoid flicker.
  if (currentStage === "A" && totalA <= available + 12) {
    panelEl.dataset.collapseStage = "A";
    panelEl.dataset.stage = "A";
    auditIconOnlyControls(panelEl);
    return;
  }

  groups.forEach((g) => applyStageB(g, ctx));
  const totalB = groups.reduce((sum, g) => sum + g.element.offsetWidth, 0);
  if (totalB <= available) {
    panelEl.dataset.collapseStage = "B";
    panelEl.dataset.stage = "B";
    auditIconOnlyControls(panelEl);
    return;
  }
  // Similarly, avoid dropping to stage C unless it's clearly necessary.
  if (currentStage === "B" && totalB <= available + 12) {
    panelEl.dataset.collapseStage = "B";
    panelEl.dataset.stage = "B";
    auditIconOnlyControls(panelEl);
    return;
  }
  const { stillOverflows } = collapseToStageC(groups, portal, available);
  panelEl.dataset.collapseStage = "C";
  panelEl.dataset.stage = "C";
  if (stillOverflows) {
    // Extremely narrow windows: allow horizontal scroll as last resort.
    panelEl.dataset.groupScroll = "enabled";
  }
  auditIconOnlyControls(panelEl);
};

type TabBuildResult = {
  tabId: string;
  label: string;
  panel: HTMLElement;
  collapse: () => void;
};

const buildTab = (
  tab: TabConfig,
  ctx: BuildContext,
  portal: HTMLElement
): TabBuildResult => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel";
  panel.setAttribute("role", "tabpanel");
  panel.dataset.tabId = tab.tabId;
  panel.hidden = true;

  const groupsStrip = document.createElement("div");
  groupsStrip.className = "leditor-ribbon-groups";
  panel.appendChild(groupsStrip);

  const groupMetas = tab.groups.map((g) => buildGroup(g, ctx, tab.tabId));
  groupMetas.forEach((gm) => groupsStrip.appendChild(gm.element));

  const openFlyouts = new Set<{ flyout: HTMLElement; close: (ev: MouseEvent) => void }>();
  const closeFlyouts = () => {
    openFlyouts.forEach(({ flyout, close }) => {
      document.removeEventListener("mousedown", close, true);
      try {
        flyout.remove();
      } catch {
        // ignore
      }
    });
    openFlyouts.clear();
  };

  // Patch stage-C flyout creation to register cleanup.
  const registerFlyout = (flyout: HTMLElement, close: (ev: MouseEvent) => void) => {
    openFlyouts.add({ flyout, close });
  };

  const collapse = () => {
    applyCollapseStages(panel, groupMetas, portal, ctx, { closeFlyouts });
    const stage = panel.dataset.collapseStage ?? ctx.defaultStage ?? "A";
    ctx.onStageUpdate?.(stage);
  };
  // Expose a cleanup hook via the panel for tab switch / dispose.
  (panel as any).__closeRibbonFlyouts = closeFlyouts;
  (panel as any).__registerRibbonFlyout = registerFlyout;
  return { tabId: tab.tabId, label: tab.label, panel, collapse };
};

export const renderRibbonLayout = (
  host: HTMLElement,
  editorHandle: EditorHandle,
  hooks: RibbonHooks,
  stateBus: RibbonStateBus | undefined,
  model: RibbonModel
): void => {
  if (typeof document === "undefined") return;
  perfMark("ribbon:render:start");
  const g = globalThis as typeof globalThis & { __leditorRibbonRenderCount?: number };
  g.__leditorRibbonRenderCount = (g.__leditorRibbonRenderCount ?? 0) + 1;
  if (g.__leditorRibbonRenderCount > 1) {
    console.warn("[Ribbon] renderRibbonLayout called multiple times", {
      count: g.__leditorRibbonRenderCount
    });
    console.trace("[Ribbon] renderRibbonLayout trace");
  } else {
    console.info("[Ribbon] renderRibbonLayout start");
  }
  applyTokens();
  host.classList.add("leditor-ribbon");
  if (!host.dataset.ribbonDensity) {
    host.dataset.ribbonDensity = "compact3";
  }
  const portal = ensurePortal();
  setMenuPortal(portal);
  ensurePortalStyle(portal);

  host.dataset.ribbonFixedHeight = "true";
  const defaults = model.registry.defaults ?? {};
  const collapseStages = defaults.collapseStages ?? ["A", "B", "C"];
  const defaultStage = collapseStages[0] ?? "A";
  const lastStage = collapseStages[collapseStages.length - 1] ?? defaultStage;
  const disableCollapse = collapseStages.length <= 1;
  host.dataset.ribbonCollapseStages = collapseStages.join(",");
  const updateStage = (stage?: string) => {
    const normalized = stage ?? defaultStage;
    host.dataset.ribbonCollapseStage = normalized;
    host.dataset.stage = normalized;
    host.dataset.ribbonTabScroll = normalized === lastStage ? "enabled" : "disabled";
  };
  updateStage(defaultStage);

  const tabConfigs = model.orderedTabs;

  const menuRegistry = new Map<string, Menu>();
  const fontSizePresets = getFontSizePresets(tabConfigs);
  const buildCtx: BuildContext = {
    editorHandle,
    hooks,
    menuRegistry,
    stateBus,
    fontSizePresets,
    onStageUpdate: updateStage,
    defaultStage,
    disableCollapse
  };
  const tabs = tabConfigs.map((tab) => buildTab(tab, buildCtx, portal));

  if (tabs.length === 0) {
    throw new Error("No ribbon tabs available");
  }

  const tabStrip = new RibbonTabStrip((tabId) => activate(tabId));
  const panelsContainer = document.createElement("div");
  panelsContainer.className = "leditor-ribbon-panels";

  tabs.forEach((t) => {
    const btn = tabStrip.addTab(t.tabId, t.label);
    btn.setAttribute("aria-controls", `${t.tabId}-panel`);
    t.panel.id = `${t.tabId}-panel`;
    panelsContainer.appendChild(t.panel);
  });

  const shell = document.createElement("div");
  shell.className = "leditor-ribbon-shell";
  host.dataset.ribbonCollapsed = "false";
  const collapseToggle = document.createElement("button");
  collapseToggle.type = "button";
  collapseToggle.className = "ribbon-collapse-toggle";
  collapseToggle.setAttribute("aria-pressed", "false");
  collapseToggle.title = "Hide ribbon";
  collapseToggle.textContent = "Hide ribbon";
  collapseToggle.dataset.controlId = "ribbon.collapse.toggle";
  collapseToggle.dataset.controlType = "collapseToggle";
  collapseToggle.dataset.size = "small";
  collapseToggle.addEventListener("click", () => {
    const next = host.dataset.ribbonCollapsed !== "true";
    host.dataset.ribbonCollapsed = String(next);
    collapseToggle.setAttribute("aria-pressed", String(next));
    collapseToggle.title = next ? "Show ribbon" : "Hide ribbon";
    collapseToggle.textContent = next ? "Show ribbon" : "Hide ribbon";
  });
  tabStrip.element.appendChild(collapseToggle);
  shell.append(tabStrip.element, panelsContainer);
  host.innerHTML = "";
  host.appendChild(shell);

  const buildControlIconMap = (): Map<string, RibbonIconName> => {
    const map = new Map<string, RibbonIconName>();
    const visitControls = (controls: readonly ControlConfig[] | undefined): void => {
      if (!controls) return;
      controls.forEach((control) => {
        if (control.controlId) {
          const iconName = resolveIconForControl(control);
          if (iconName) {
            map.set(control.controlId, iconName);
          }
        }
        if (control.menu) {
          visitControls(control.menu);
        }
        const nested = collectNestedControls(control);
        if (nested.length) {
          visitControls(nested);
        }
      });
    };
    tabConfigs.forEach((tab) => {
      tab.groups.forEach((group) => {
        group.clusters.forEach((cluster) => {
          visitControls(cluster.controls);
        });
      });
    });
    return map;
  };

  const controlIconMap = buildControlIconMap();

  const CONTROL_SELECTOR =
    ".leditor-ribbon-button, .ribbon-dropdown-button, .leditor-split-primary, .leditor-split-caret, " +
    ".leditor-ribbon-icon-btn, .leditor-ribbon-spinner-step, .ribbon-dialog-launcher-btn";

  const isDebugRibbonDomTraceEnabled = (): boolean => {
    try {
      const raw = window.location?.search || "";
      if (raw) {
        const params = new URLSearchParams(raw);
        const qp = params.get("ribbonDomTrace");
        if (qp === "1" || qp === "true") return true;
      }
    } catch {
      // ignore
    }
    try {
      if ((globalThis as any).__leditorDebugRibbonDomTrace === true) return true;
    } catch {
      // ignore
    }
    try {
      return window.localStorage?.getItem("leditor.debug.ribbon.dom") === "1";
    } catch {
      return false;
    }
  };

  const installRibbonDomTracer = (root: HTMLElement): (() => void) => {
    const originals = {
      appendChild: Node.prototype.appendChild,
      insertBefore: Node.prototype.insertBefore,
      removeChild: Node.prototype.removeChild,
      replaceChild: Node.prototype.replaceChild
    };
    const isInRibbon = (node: Node): boolean => {
      try {
        return node instanceof Node && root.contains(node as any);
      } catch {
        return false;
      }
    };
    const isRibbonIconNode = (node: Node): boolean => {
      return (
        node instanceof Element &&
        (node.matches("svg.leditor-ribbon-icon") ||
          node.classList.contains("leditor-ribbon-icon") ||
          node.querySelector?.("svg.leditor-ribbon-icon") != null)
      );
    };
    const isSuspiciousIconFontNode = (node: Node): boolean => {
      if (!(node instanceof Element)) return false;
      const tag = node.tagName.toLowerCase();
      if (tag === "i") return true;
      if (tag === "span") {
        const cls = node.className || "";
        return /\b(ms-Icon|codicon|fabric|icon|iconfont)\b/i.test(String(cls));
      }
      return false;
    };
    const maybeLog = (op: string, parent: Node, args: any[]) => {
      const parentInRibbon = isInRibbon(parent);
      const childNodes = args.filter((a) => a instanceof Node) as Node[];
      const hasSuspicious =
        childNodes.some(isRibbonIconNode) ||
        childNodes.some(isSuspiciousIconFontNode) ||
        childNodes.some((n) => n instanceof Element && n.matches?.(CONTROL_SELECTOR));
      if (!parentInRibbon || !hasSuspicious) return;
      try {
        const parentEl = parent as any as Element;
        const control = parentEl.closest?.(CONTROL_SELECTOR) as HTMLElement | null;
        const controlId = control?.dataset?.controlId ?? parentEl.getAttribute?.("data-control-id") ?? "";
        console.groupCollapsed(`[RibbonDOMTrace] ${op}`, { controlId });
        console.log("parent:", parent);
        console.log(
          "nodes:",
          childNodes.map((n) => {
            if (!(n instanceof Element)) return { kind: "node", nodeType: n.nodeType };
            return {
              tag: n.tagName.toLowerCase(),
              class: n.className,
              dataIconKey: (n as any).dataset?.iconKey,
              text: (n.textContent || "").trim().slice(0, 60)
            };
          })
        );
        console.trace("stack");
        console.groupEnd();
      } catch {
        // ignore
      }
    };

    (Node.prototype as any).appendChild = function (...args: any[]) {
      maybeLog("appendChild", this, args);
      return originals.appendChild.apply(this, args as any);
    };
    (Node.prototype as any).insertBefore = function (...args: any[]) {
      maybeLog("insertBefore", this, args);
      return originals.insertBefore.apply(this, args as any);
    };
    (Node.prototype as any).removeChild = function (...args: any[]) {
      maybeLog("removeChild", this, args);
      return originals.removeChild.apply(this, args as any);
    };
    (Node.prototype as any).replaceChild = function (...args: any[]) {
      maybeLog("replaceChild", this, args);
      return originals.replaceChild.apply(this, args as any);
    };

    return () => {
      (Node.prototype as any).appendChild = originals.appendChild;
      (Node.prototype as any).insertBefore = originals.insertBefore;
      (Node.prototype as any).removeChild = originals.removeChild;
      (Node.prototype as any).replaceChild = originals.replaceChild;
    };
  };

  const normalizeRibbonControl = (control: HTMLElement): void => {
    stripNonFluentNodes(control);
    const hasSvg = Boolean(control.querySelector("svg"));
    if (!hasSvg) {
      const iconName = resolveIconForElement(control, controlIconMap);
      if (iconName) {
        const icon = createRibbonIcon(iconName);
        icon.classList.add("ribbon-button-icon");
        control.prepend(icon);
        control.classList.add("has-icon");
      }
    }
    control.classList.toggle("has-icon", Boolean(control.querySelector("svg")));
  };

  const normalizeRibbonControls = (root: HTMLElement): void => {
    root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR).forEach((control) => normalizeRibbonControl(control));
  };

  // Run once after mount.
  normalizeRibbonControls(shell);

  // Guard against external DOM/CSS systems injecting icon-font nodes.
  // If that happens, icons can appear as black "tofu" squares on some platforms.
  const iconStabilityObserver = new MutationObserver((mutations) => {
    const touched = new Set<HTMLElement>();
    for (const m of mutations) {
      const candidates: HTMLElement[] = [];
      if (m.target instanceof HTMLElement) candidates.push(m.target);
      m.addedNodes.forEach((node) => {
        if (node instanceof HTMLElement) candidates.push(node);
      });
      candidates.forEach((node) => {
        const control = node.matches?.(CONTROL_SELECTOR)
          ? (node as HTMLElement)
          : node.closest?.(CONTROL_SELECTOR);
        if (control) touched.add(control as HTMLElement);
      });
    }
    touched.forEach((control) => normalizeRibbonControl(control));
  });
  iconStabilityObserver.observe(shell, { subtree: true, childList: true });
  host.addEventListener("ribbon-dispose", () => iconStabilityObserver.disconnect(), { once: true });

  // Optional deep tracing to locate the code that mutates ribbon icon DOM.
  // Enable with one of:
  // - localStorage.setItem("leditor.debug.ribbon.dom", "1") then reload
  // - add ?ribbonDomTrace=1 to the URL then reload
  // - set window.__leditorDebugRibbonDomTrace = true then reload
  let uninstallRibbonDomTrace: (() => void) | null = null;
  if (isDebugRibbonDomTraceEnabled()) {
    console.warn("[RibbonDOMTrace] enabled");
    uninstallRibbonDomTrace = installRibbonDomTracer(shell);
    host.addEventListener("ribbon-dispose", () => uninstallRibbonDomTrace?.(), { once: true });
  }

  let activeTab: TabBuildResult | null = null;
  let collapseQueued = false;
  let collapsing = false;
  let lastShellWidth = 0;
  const requestCollapse = () => {
    if (collapseQueued) return;
    collapseQueued = true;
    window.requestAnimationFrame(() => {
      collapseQueued = false;
      if (!activeTab || collapsing) return;
      collapsing = true;
      try {
        activeTab.collapse();
      } finally {
        collapsing = false;
      }
    });
  };
  const activate = (tabId: string) => {
    const next = tabs.find((t) => t.tabId === tabId);
    if (!next) return;
    if (activeTab === next) return;
    if (activeTab) {
      const closeFlyouts = (activeTab.panel as any)?.__closeRibbonFlyouts as (() => void) | undefined;
      closeFlyouts?.();
    }
    tabs.forEach((t) => (t.panel.hidden = t !== next));
    tabStrip.setActiveTab(tabId);
    activeTab = next;
    next.collapse();
  };

  const initial = defaults.initialTabId ?? tabs[0].tabId;
  activate(initial);
  perfMark("ribbon:render:end");
  perfMeasure("ribbon:render", "ribbon:render:start", "ribbon:render:end");

    if (stateBus) {
      const syncBindings = (state: RibbonStateSnapshot): void => {
        const cacheKey = "__ribbonBindingCache";
        const cached = (host as any)[cacheKey] as
          | { targets: HTMLElement[]; last: WeakMap<HTMLElement, string> }
          | undefined;
        const bindingTargets = cached?.targets ?? Array.from(host.querySelectorAll<HTMLElement>("[data-state-binding]"));
        const lastMap = cached?.last ?? new WeakMap<HTMLElement, string>();
        if (!cached) {
          (host as any)[cacheKey] = { targets: bindingTargets, last: lastMap };
        }
        bindingTargets.forEach((element) => {
          const binding = element.dataset.stateBinding as RibbonStateKey | undefined;
          if (!binding) return;
          const value = state[binding];
          const serialized = typeof value === "string" || typeof value === "number" ? String(value) : value == null ? "" : JSON.stringify(value);
          const prev = lastMap.get(element);
          if (prev === serialized) {
            return;
          }
          lastMap.set(element, serialized);
          if (element.dataset.controlType === "dropdown") {
            if (typeof value === "string") {
              if (element.dataset.value !== value) {
                element.dataset.value = value;
              }
            }
            if (element.dataset.controlId === "cite.style") {
              const valueEl = element.querySelector<HTMLElement>(".ribbon-dropdown-value");
              if (valueEl) {
                const nextText = formatCitationStyleValue(value);
                if (valueEl.textContent !== nextText) {
                  valueEl.textContent = nextText;
                }
              }
            }
            if (element.dataset.controlId === "font.style") {
              const valueEl = element.querySelector<HTMLElement>(".ribbon-dropdown-value");
              if (valueEl) {
                const nextText = formatParagraphStyleValue(value) || "Normal";
                if (valueEl.textContent !== nextText) {
                  valueEl.textContent = nextText;
                }
              }
            }
            const controlId = element.dataset.controlId ?? "";
            if (controlId) {
              const menu = menuRegistry.get(controlId);
              if (menu) {
              const matchValue = typeof value === "string" ? value : null;
              if (menu.element.dataset.selectedValue !== (matchValue ?? "")) {
                menu.element
                  .querySelectorAll<HTMLElement>("[data-state-value]")
                  .forEach((item) => item.classList.toggle("is-selected", matchValue === item.dataset.stateValue));
                if (matchValue) {
                  menu.element.dataset.selectedValue = matchValue;
                } else {
                  delete (menu.element as any).dataset.selectedValue;
                }
              }
              }
            }
          }
          if (element.dataset.controlType === "combobox") {
            const input = element.querySelector<HTMLInputElement>("input");
            if (!input) return;
            if (document.activeElement === input) return;
            if (typeof value === "string") {
              if (input.value !== value) input.value = value;
            } else {
              if (input.value !== DEFAULT_FONT_FAMILY) input.value = DEFAULT_FONT_FAMILY;
            }
          }
          if (element.dataset.controlType === "spinnerDropdown" || element.dataset.controlType === "spinner-dropdown") {
            const input = element.querySelector<HTMLInputElement>("input");
            if (!input) return;
            if (document.activeElement === input) return;
            if (typeof value === "number" && Number.isFinite(value)) {
              const nextValue = String(value);
              if (input.value !== nextValue) input.value = nextValue;
            } else {
              const fallback = String(DEFAULT_FONT_SIZE);
              if (input.value !== fallback) input.value = fallback;
            }
          }
        });
      };
    const unsubscribe = stateBus.subscribe(syncBindings);
    syncBindings(stateBus.getState());
    host.addEventListener("ribbon-dispose", () => unsubscribe(), { once: true });
  }

  host.addEventListener(
    "ribbon-dispose",
    () => {
      tabs.forEach((t) => {
        const closeFlyouts = (t.panel as any)?.__closeRibbonFlyouts as (() => void) | undefined;
        closeFlyouts?.();
      });
    },
    { once: true }
  );

  // Stabilize collapse: debounce and ignore 1px jitter (GPU/transform rounding can cause oscillation).
  let collapseDebounce: number | null = null;
  let pendingWidth = 0;
  const shellObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    const width = Math.floor(entry?.contentRect?.width ?? shell.getBoundingClientRect().width);
    if (!width) return;
    if (Math.abs(width - lastShellWidth) < 2) return;
    pendingWidth = width;
    if (collapseDebounce) window.clearTimeout(collapseDebounce);
    collapseDebounce = window.setTimeout(() => {
      collapseDebounce = null;
      if (pendingWidth && Math.abs(pendingWidth - lastShellWidth) >= 2) {
        lastShellWidth = pendingWidth;
        requestCollapse();
      }
    }, 120);
  });
  shellObserver.observe(shell);
  host.addEventListener("ribbon-dispose", () => shellObserver.disconnect(), { once: true });
  window.addEventListener("beforeunload", () => shellObserver.disconnect(), { once: true });
};
