import { dispatchCommand } from "../api/editor_commands.js";
import type { EditorCommandId } from "../api/editor_commands.js";
import type { EditorHandle } from "../api/leditor.js";
import ribbonPlan from "./ribbon.json";
import homeTab from "./home.json";
import insertTab from "./insert.json";
import reviewTab from "./review.json";
import layoutTab from "./layout_tab.json";
import viewTab from "./view.json";
import layoutPlan from "./layout.json";
import { RibbonTabStrip } from "./ribbon_primitives.js";
import { createRibbonButton, createRibbonDropdownButton, createRibbonSpinner } from "./ribbon_controls.js";
import { createRibbonIcon, type RibbonIconName } from "./ribbon_icons.js";
import { Menu, MenuItem, MenuSeparator, setMenuPortal } from "./ribbon_menu.js";
import { SplitButton } from "./ribbon_split_button.js";
import { getTemplates } from "../templates/index.js";
import { getStyleTemplates, openStyleMiniApp } from "./style_mini_app.js";
import { tabLayouts } from "./tab_layouts.js";
import type { RibbonStateBus, RibbonStateKey, RibbonStateSnapshot } from "./ribbon_state.js";
import type {
  ClusterConfig,
  ControlConfig,
  ControlType,
  GroupConfig,
  RibbonModel,
  TabConfig
} from "./ribbon_config.js";
import type { AlignmentVariant } from "./ribbon_selection_helpers.js";

type RibbonHooks = {
  registerToggle?: (commandId: EditorCommandId, element: HTMLButtonElement) => void;
  registerAlignment?: (variant: AlignmentVariant, element: HTMLButtonElement) => void;
};

type InstalledAddin = {
  id: string;
  name: string;
  description?: string;
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

const ROWED_TABS = new Set(["home", "insert"]);
const ROWED_TAB_ROW_COUNT = 2;
const ROWED_TAB_ROW_COUNTS: Record<string, number> = {
  home: 1,
  insert: 2
};
const ROWED_TAB_MIN_PER_ROW = 4;
const ROWED_TAB_MAX_PER_ROW = 20;

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

const resolveCommandId = (
  command: { id: string; args?: Record<string, unknown> },
  args?: Record<string, unknown>
): string => {
  const merged = { ...(command.args ?? {}), ...(args ?? {}) };
  if (command.id === "paragraph.align.set") {
    switch (merged.mode) {
      case "left":
        return "AlignLeft";
      case "center":
        return "AlignCenter";
      case "right":
        return "AlignRight";
      case "justify":
        return "JustifyFull";
      default:
        return "JustifyFull";
    }
  }
  if (command.id === "font.case.set") {
    return "ChangeCase";
  }
  if (command.id === "paragraph.lineSpacing.set") {
    return "LineSpacing";
  }
  const resolved = COMMAND_ALIASES[command.id] ?? command.id;
  if (!resolved) {
    throw new Error(`Unmapped command: ${command.id}`);
  }
  return resolved;
};

const COMMAND_ALIASES: Record<string, string> = {
  // Clipboard / paste
  "paste.default": "Paste",
  "paste.keepSource": "Paste",
  "paste.mergeFormatting": "Paste",
  "paste.keepTextOnly": "PastePlain",
  "paste.textOnly": "PastePlain",
  "paste.special.openDialog": "PasteClean",
  "paste.plainText": "PastePlain",
  "paste.fromWordCleanup": "PasteClean",
  "paste.autoClean.toggle": "PasteClean",
  "paste.cleanupRules.openDialog": "PasteClean",
  "paste.defaults.openDialog": "Paste",
  "clipboard.cut": "Cut",
  "clipboard.copy": "Copy",
  "clipboard.formatPainter.toggle": "RemoveFontStyle",
  "clipboard.options.openDialog": "ClipboardOptionsDialog",
  "history.undo": "Undo",
  "history.redo": "Redo",
  // Font
  "font.bold.toggle": "Bold",
  "font.italic.toggle": "Italic",
  "font.underline.toggle": "Underline",
  "font.underline.set": "Underline",
  "font.strikethrough.toggle": "Strikethrough",
  "font.subscript.toggle": "Subscript",
  "font.superscript.toggle": "Superscript",
  "font.inlineCode.toggle": "ClearFormatting",
  "font.options.openDialog": "FontOptionsDialog",
  "font.effects.openMenu": "FontEffectsMenu",
  "font.effects.openDialog": "FontEffectsDialog",
  "font.effects.outline.toggle": "FontEffectsOutline",
  "font.effects.shadow.toggle": "FontEffectsShadow",
  "font.underlineColor.openPicker": "UnderlineColorPicker",
  "font.family.set": "FontFamily",
  "font.size.set": "FontSize",
  "font.size.increase": "FontSize",
  "font.size.decrease": "FontSize",
  "font.color.applyCurrent": "TextColor",
  "font.color.set": "TextColor",
  "font.highlight.applyCurrent": "HighlightColor",
  "font.highlight.set": "HighlightColor",
  "font.clearFormatting": "ClearFormatting",
  "font.case.set": "ChangeCase",
  // Paragraph
  "list.bullet.toggle": "BulletList",
  "list.bullet.setStyle": "BulletList",
  "list.ordered.toggle": "NumberList",
  "list.ordered.setStyle": "NumberList",
  "list.multilevel.apply": "Indent",
  "list.multilevel.openMenu": "Indent",
  "list.task.toggle": "BulletList",
  "paragraph.outdent": "Outdent",
  "paragraph.indent": "Indent",
  "paragraph.sort.openDialog": "Preview",
  "view.formattingMarks.toggle": "VisualBlocks",
  "paragraph.align.set": "JustifyFull",
  "paragraph.lineSpacing.set": "LineSpacing",
  "paragraph.spaceBefore.add": "SpaceBefore",
  "paragraph.spaceBefore.remove": "SpaceBefore",
  "paragraph.spaceAfter.add": "SpaceAfter",
  "paragraph.spaceAfter.remove": "SpaceAfter",
  "paragraph.options.openDialog": "ParagraphOptionsDialog",
  "paragraph.spacing.openDialog": "ParagraphSpacingDialog",
  "paragraph.spacing.openMenu": "ParagraphSpacingMenu",
  "paragraph.borders.openDialog": "ParagraphBordersDialog",
  "paragraph.borders.openMenu": "ParagraphBordersMenu",
  "paragraph.borders.set": "ParagraphBordersSet",
  "paragraph.shading.set": "HighlightColor",
  "paragraph.blockquote.toggle": "BlockquoteToggle",
  "insert.horizontalRule": "InsertPageBreak",
  // Editing
  "editing.find.open": "SearchReplace",
  "editing.find.advanced.openDialog": "SearchReplace",
  "editing.goto.openDialog": "SearchReplace",
  "editing.find.regex.toggle": "SearchReplace",
  "editing.find.matchCase.toggle": "SearchReplace",
  "editing.find.wholeWords.toggle": "SearchReplace",
  "editing.replace.open": "SearchReplace",
  "selection.selectAll": "SelectAll",
  "selection.selectObjects": "SelectObjects",
  "selection.selectSimilarFormatting": "SelectSimilarFormatting",
  "selection.openMenu": "SelectAll",
  // View
  "view.source.openHtmlRaw": "SourceView",
  "view.source.openHtml": "SourceView",
  "view.source.openMarkdown": "SourceView",
  "view.source.openJson": "SourceView",
  "view.cleanHtml": "PasteClean",
  "view.allowedElements.open": "AllowedElements",
  // Insert — pages / breaks
  "insert.pageBreak": "InsertPageBreak",
  "InsertPageBreak": "InsertPageBreak",
  "insert.blankPage": "InsertPageBreak",
  "insert.columnBreak": "InsertColumnBreak",
  "insert.sectionBreak.nextPage": "InsertSectionBreakNextPage",
  "insert.sectionBreak.continuous": "InsertSectionBreakContinuous",
  "insert.sectionBreak.evenPage": "InsertSectionBreakEven",
  "insert.sectionBreak.oddPage": "InsertSectionBreakOdd",
  // Insert — cover/pages
  "insert.coverPage.default": "InsertTemplate",
  "insert.coverPage.apply": "InsertTemplate",
  "insert.coverPage.remove": "InsertTemplate",
  // Insert — tables
  "insert.table.apply": "TableInsert",
  "insert.table.openDialog": "TableInsert",
  "insert.table.openGridPicker": "TableInsert",
  "insert.table.convertText.openDialog": "TableInsert",
  "insert.table.excelEmbed": "TableInsert",
  "insert.table.quickTables.openGallery": "TableInsert",
  "insert.table.drawMode.toggle": "TableInsert",
  "insert.table.responsiveDefault.toggle": "TableInsert",
  "table.accessibility.openDialog": "TableInsert",
  // Insert — media/illustrations
  "insert.image.upload.openPicker": "InsertImage",
  "insert.image.stock.open": "InsertImage",
  "insert.image.online.open": "InsertImage",
  "insert.image.url.openDialog": "InsertImage",
  "insert.icon.openPicker": "InsertImage",
  "insert.smartArt.openPicker": "InsertImage",
  "insert.chart.openPicker": "InsertImage",
  "insert.chart.apply": "InsertImage",
  "insert.screenshot.open": "InsertImage",
  "insert.video.online.openDialog": "InsertImage",
  "insert.embed.openDialog": "InsertImage",
  "insert.embed.code.openDialog": "InsertImage",
  "insert.embed.oembed.openDialog": "InsertImage",
  "insert.embed.settings.openDialog": "InsertImage",
  "insert.audio.upload.openPicker": "InsertImage",
  "insert.audio.url.openDialog": "InsertImage",
  "insert.file.attach.openPicker": "InsertImage",
  "insert.file.link.openDialog": "InsertImage",
  "insert.file.manage.openDialog": "InsertImage",
  "insert.pdf.embed.openPicker": "InsertImage",
  // Insert — links
  "link.insert.openDialog": "Link",
  "link.edit.openDialog": "Link",
  "link.remove": "Link",
  "link.auto.toggle": "Link",
  "insert.bookmark.openDialog": "InsertBookmark",
  "insert.crossReference.openDialog": "InsertCrossReference",
  // Insert — comments
  "comments.new": "CommentsNew",
  "comments.mention.open": "InsertComment",
  // Insert — header/footer/page number
  "insert.header.openGallery": "EditHeader",
  "insert.header.apply": "EditHeader",
  "insert.header.remove": "EditHeader",
  "insert.footer.openGallery": "EditFooter",
  "insert.footer.apply": "EditFooter",
  "insert.footer.remove": "EditFooter",
  "insert.pageNumber.openGallery": "EditHeader",
  "insert.pageNumber.apply": "EditHeader",
  "insert.pageNumber.format.openDialog": "EditHeader",
  "insert.pageNumber.remove": "EditHeader",
  "insert.headerFooter.open": "EditHeader",
  "edit.header.enter": "EditHeader",
  "edit.footer.enter": "EditFooter",
  // Insert — text/objects
  "insert.textBox.openGallery": "InsertTemplate",
  "insert.textBox.apply": "InsertTemplate",
  "insert.textBox.drawMode.toggle": "InsertTemplate",
  "insert.quickParts.openMenu": "InsertTemplate",
  "insert.quickParts.autoText.open": "InsertTemplate",
  "insert.quickParts.documentProperty.open": "InsertTemplate",
  "insert.quickParts.saveSelection.openDialog": "InsertTemplate",
  "insert.wordArt.openGallery": "InsertTemplate",
  "insert.wordArt.apply": "InsertTemplate",
  "insert.dropCap.openMenu": "InsertTemplate",
  "insert.dropCap.apply": "InsertTemplate",
  "insert.dropCap.openDialog": "InsertTemplate",
  "insert.signatureLine.openDialog": "InsertTemplate",
  "insert.dateTime.openDialog": "InsertTemplate",
  "insert.object.openMenu": "InsertTemplate",
  "insert.object.openDialog": "InsertTemplate",
  "insert.placeholder.openMenu": "InsertTemplate",
  "insert.placeholder.openDialog": "InsertTemplate",
  "placeholders.manage.openDialog": "InsertTemplate",
  "insert.shortcode.openDialog": "InsertTemplate",
  "insert.text.openMenu": "InsertTemplate",
  "insert.textFromFile.openPicker": "InsertTemplate",
  // Insert — symbols
  "insert.equation.openEditor": "InsertTemplate",
  "insert.equation.apply": "InsertTemplate",
  "insert.symbol.openPicker": "InsertTemplate",
  "insert.symbol.apply": "InsertTemplate",
  "insert.emoji.openPicker": "InsertTemplate"
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
  if (!key.startsWith("icon.")) return undefined;
  const simple = key.replace("icon.", "");
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

const ensureControlIcon = (element: HTMLElement, iconName?: RibbonIconName): void => {
  if (!iconName) return;
  const existing = element.querySelector(".leditor-ribbon-icon");
  if (existing && !existing.classList.contains("leditor-ribbon-icon-placeholder")) {
    return;
  }
  if (existing) {
    existing.remove();
  }
  const icon = createRibbonIcon(iconName);
  icon.classList.add("ribbon-button-icon");
  element.prepend(icon);
};

const applyTokens = (): void => {
  const root = document.documentElement;
  const tokens = layoutPlan.tokens;
  root.style.setProperty("--r-font-family", tokens.fontFamily);
  root.style.setProperty("--r-font-size", tokens.fontSize);
  root.style.setProperty("--r-font-size-sm", tokens.fontSizeSmall);
  root.style.setProperty("--r-line-height", `${tokens.lineHeight}`);
  root.style.setProperty("--r-tabstrip-height", tokens.tabstripHeight);
  root.style.setProperty("--r-panel-height", tokens.panelHeight);
  root.style.setProperty("--r-panel-pad-x", tokens.panelPadX);
  root.style.setProperty("--r-panel-pad-y", tokens.panelPadY);
  root.style.setProperty("--r-group-gap", tokens.groupGap);
  root.style.setProperty("--r-group-pad", tokens.groupPad);
  root.style.setProperty("--r-group-min", tokens.groupMinWidth);
  root.style.setProperty("--r-group-max", tokens.groupMaxWidth);
  root.style.setProperty("--r-ctl-h-sm", tokens.controlHeightSmall);
  root.style.setProperty("--r-ctl-h-md", tokens.controlHeightMedium);
  root.style.setProperty("--r-ctl-h-lg", tokens.controlHeightLarge);
  root.style.setProperty("--r-ctl-radius", tokens.controlRadius);
  root.style.setProperty("--r-ctl-gap", tokens.controlGap);
  root.style.setProperty("--r-icon", tokens.iconSize);
  root.style.setProperty("--r-icon-lg", tokens.iconSizeLarge);
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
  button.textContent = "⋯";
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
  ]
};

const fallbackSymbols: DynamicEntry[] = [
  { id: "symbol_check", label: "Check mark", description: "✓", payload: { codepoint: "✓" } },
  { id: "symbol_pi", label: "Pi", description: "π", payload: { codepoint: "π" } },
  { id: "symbol_infty", label: "Infinity", description: "∞", payload: { codepoint: "∞" } },
  { id: "symbol_sigma", label: "Sigma", description: "∑", payload: { codepoint: "∑" } }
];

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
  recentSymbols: async () => fallbackSymbols
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
  const grid = document.createElement("div");
  grid.className = "rgallery__grid";
  const entries = provider ? provider() : [];

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "rgallery__empty";
    empty.textContent = "No gallery entries available";
    container.appendChild(empty);
    return container;
  }

  entries.forEach((entry) => {
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
    grid.appendChild(button);
  });

  container.appendChild(grid);
  return container;
};

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
  void provider(ctx)
    .then((entries) => {
      if (!entries.length) {
        container.appendChild(createMenuSectionHeader(`No ${item.label ?? "items"} available`));
        return;
      }
      entries.forEach((entry) => {
        const button = MenuItem({
          label: entry.label,
          onSelect: () => {
            runMenuCommand(ctx, item.command, entry.payload);
            menu.close();
          }
        });
        applyControlDataAttributes(button, { ...item, type: "menuItem" });
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
      container.appendChild(createMenuSectionHeader("Failed to load items"));
    });
};

const createMenuItemButton = (menu: Menu, ctx: BuildContext, item: ControlConfig, toggle = false): HTMLButtonElement => {
  const button = MenuItem({
    label: item.label ?? item.controlId ?? "",
    onSelect: () => {
      const baseArgs = buildCommandArgs(item.command);
      if (!baseArgs && (item.command?.id === "TextColor" || item.command?.id === "HighlightColor")) {
        const raw = window.prompt("Enter a hex color (e.g. #1f2937)");
        if (!raw) {
          menu.close();
          return;
        }
        runMenuCommand(ctx, item.command, { value: raw.trim() });
      } else {
        runMenuCommand(ctx, item.command, undefined);
      }
      menu.close();
    }
  });
  if (toggle) {
    button.setAttribute("aria-checked", "false");
    button.dataset.toggle = "true";
  }
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
  const gallery = document.createElement("div");
  gallery.className = "home-quick-style-gallery";
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
    const description = document.createElement("p");
    description.className = "home-quick-style-card__description";
    description.textContent = template.description;

    const openMiniApp = () => {
      openStyleMiniApp(card, appState, { templateId: template.templateId });
    };

    card.addEventListener("click", openMiniApp);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openMiniApp();
      }
    });

    card.append(label, description);
    gallery.appendChild(card);
  });
  attachStylesContextMenu(gallery, ctx);
  return gallery;
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
      const button = createRibbonButton({
        icon,
        label: control.label ?? "",
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
      const button = createRibbonButton({
        icon,
        label: control.label ?? "",
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
    const button = createRibbonButton({
      icon,
      label: control.label ?? "",
      size,
      toggle: control.type === "toggleButton",
      onClick: commandHandler,
      commandId: targetId as any
    });
    ensureControlIcon(button, icon);
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
    const button = createRibbonButton({
      icon: icon ?? "underline",
      label: control.label ?? "",
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
    ensureControlIcon(button, icon ?? "underline");
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
    const iconEl = icon ? createRibbonIcon(icon) : null;
    if (iconEl) {
      iconEl.classList.add("ribbon-button-icon");
    }
    const split = new SplitButton({
      label: control.label ?? "",
      iconElement: iconEl,
      onPrimary: control.type === "colorSplitButton" ? runColorSplitPrimary : commandHandler,
      menu,
      logLabel: id
    });
    if (iconEl) {
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
    }
    const primary = split.element.querySelector(".leditor-split-primary");
    if (primary instanceof HTMLElement) {
      ensureControlIcon(primary, icon);
    }
    applyControlDataAttributes(split.element, control, control.size ?? "medium");
    collapseMeta.element = split.element;
    recordParent(meta, split.element);
    return { element: split.element, collapse: collapseMeta };
  }

  if (control.type === "dropdown" || control.type === "colorPicker") {
    const menu = buildMenu(control.menu, ctx);
    ctx.menuRegistry.set(id ?? "", menu);
    const button = createRibbonDropdownButton({
      icon: icon ?? "clear",
      label: control.label ?? "",
      menu
    });
    ensureControlIcon(button, icon ?? "clear");
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
    if (control.controlId === "font.family") {
      input.value = "Times New Roman";
    }
    box.appendChild(input);
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
    if (control.controlId === "font.size") {
      input.value = "12";
    }
    input.placeholder = control.label ?? "";
    spinnerContainer.appendChild(input);
    const spinner = createRibbonSpinner();
    spinner.classList.add("ribbon-spinner-steps");
    spinnerContainer.appendChild(spinner);

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
    if (presets.length) {
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

    const dropdownButton = createRibbonDropdownButton({
      icon: icon ?? "clear",
      label: control.label ?? "",
      menu
    });
    ensureControlIcon(dropdownButton, icon ?? "clear");
    spinnerContainer.appendChild(dropdownButton);

    const parseCurrentValue = (): number => {
      const current = Number.parseFloat(input.value);
      if (Number.isFinite(current)) {
        return current;
      }
      return presets[0] ?? 0;
    };

    const changeValue = (delta: number) => {
      const next = parseCurrentValue() + delta;
      input.value = String(next);
      runSpinnerCommand(next);
    };

    spinner.querySelectorAll<HTMLButtonElement>("button").forEach((btn, index) => {
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        changeValue(index === 0 ? -1 : 1);
      });
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runSpinnerCommand(parseCurrentValue());
      }
    });
    input.addEventListener("blur", () => {
      runSpinnerCommand(parseCurrentValue());
    });

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
    const iconEl = createRibbonIcon(icon ?? "clear");
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
  element.className = "leditor-ribbon-group ribbonGroup";
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
  const maxRows = ROWED_TABS.has(tabId) ? Math.min(baseMaxRows, ROWED_TAB_ROW_COUNT) : baseMaxRows;
  body.style.setProperty("--r-group-max-rows", String(maxRows));
  body.dataset.maxRows = String(maxRows);

  const customRowCount = ROWED_TAB_ROW_COUNTS[tabId];
  if (customRowCount !== undefined) {
    body.dataset.rowCount = String(customRowCount);
    const clusters = group.clusters ?? [];
    const perRow = Math.min(
      ROWED_TAB_MAX_PER_ROW,
      Math.max(ROWED_TAB_MIN_PER_ROW, Math.ceil(clusters.length / customRowCount))
    );
    const rows: HTMLDivElement[] = [];
    for (let i = 0; i < customRowCount; i += 1) {
      const row = document.createElement("div");
      row.className = "leditor-ribbon-group-row";
      row.dataset.rowIndex = String(i + 1);
      rows.push(row);
      body.appendChild(row);
    }
    let rowIndex = 0;
    let rowItemCount = 0;
    clusters.forEach((cluster) => {
      const clusterEl = buildCluster(cluster, meta, ctx);
      const pinFirstRow = tabId === "home" && cluster.clusterId === "styles.quickTemplates";
      const targetRow = pinFirstRow ? 0 : rowIndex;
      rows[targetRow].appendChild(clusterEl);
      if (!pinFirstRow) {
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
        c.element.classList.add("is-icon-only");
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
): void => {
  const sorted = [...groups].sort((a, b) => a.priority - b.priority);
  let total = groups.reduce((sum, g) => sum + g.element.offsetWidth, 0);
  for (const meta of sorted) {
    if (total <= availableWidth) break;
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
      document.addEventListener("mousedown", close, true);
      meta.body.hidden = false;
      meta.footer.hidden = false;
    });
    meta.body.hidden = true;
    meta.footer.hidden = true;
    meta.element.appendChild(button);
    meta.element.classList.add("is-collapsed-group");
    meta.element.dataset.collapseStage = "C";
    total -= meta.element.offsetWidth;
  }
};

const applyCollapseStages = (
  panelEl: HTMLElement,
  groups: GroupMeta[],
  portal: HTMLElement,
  ctx: BuildContext
) => {
  groups.forEach(resetGroup);
  const strip = panelEl.querySelector<HTMLElement>(".leditor-ribbon-groups");
  if (!strip) return;
  const available = strip.clientWidth;
  const total = groups.reduce((sum, g) => sum + g.element.offsetWidth, 0);
  if (total <= available) {
    panelEl.dataset.collapseStage = "A";
    panelEl.dataset.stage = "A";
    return;
  }
  groups.forEach((g) => applyStageB(g, ctx));
  const afterB = groups.reduce((sum, g) => sum + g.element.offsetWidth, 0);
  if (afterB <= available) {
    panelEl.dataset.collapseStage = "B";
    panelEl.dataset.stage = "B";
    return;
  }
  collapseToStageC(groups, portal, available);
  panelEl.dataset.collapseStage = "C";
  panelEl.dataset.stage = "C";
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

  const collapse = () => {
    applyCollapseStages(panel, groupMetas, portal, ctx);
    const stage = panel.dataset.collapseStage ?? ctx.defaultStage ?? "A";
    ctx.onStageUpdate?.(stage);
  };
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
  applyTokens();
  host.classList.add("leditor-ribbon");
  const portal = ensurePortal();
  setMenuPortal(portal);
  ensurePortalStyle(portal);

  host.dataset.ribbonFixedHeight = "true";
  const defaults = model.registry.defaults ?? {};
  const collapseStages = defaults.collapseStages ?? ["A", "B", "C"];
  const defaultStage = collapseStages[0] ?? "A";
  const lastStage = collapseStages[collapseStages.length - 1] ?? defaultStage;
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
    defaultStage
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

  const ro = new ResizeObserver(() => {
    if (activeTab) activeTab.collapse();
  });
  const dispose = () => ro.disconnect();

  let activeTab: TabBuildResult | null = null;
  const activate = (tabId: string) => {
    const next = tabs.find((t) => t.tabId === tabId);
    if (!next) return;
    if (activeTab === next) return;
    tabs.forEach((t) => (t.panel.hidden = t !== next));
    tabStrip.setActiveTab(tabId);
    activeTab = next;
    next.collapse();
  };

  tabs.forEach((t) => ro.observe(t.panel));

  const initial = defaults.initialTabId ?? tabs[0].tabId;
  activate(initial);

  if (stateBus) {
    const syncBindings = (state: RibbonStateSnapshot): void => {
      const bindingTargets = host.querySelectorAll<HTMLElement>("[data-state-binding]");
      bindingTargets.forEach((element) => {
        const binding = element.dataset.stateBinding as RibbonStateKey | undefined;
        if (!binding) return;
        const value = state[binding];
        if (element.dataset.controlType === "dropdown") {
          if (typeof value === "string") {
            element.dataset.value = value;
          }
          const controlId = element.dataset.controlId ?? "";
          if (controlId) {
            const menu = menuRegistry.get(controlId);
            if (menu) {
              const matchValue = typeof value === "string" ? value : null;
              menu.element
                .querySelectorAll<HTMLElement>("[data-state-value]")
                .forEach((item) => item.classList.toggle("is-selected", matchValue === item.dataset.stateValue));
              if (matchValue) {
                menu.element.dataset.selectedValue = matchValue;
              }
            }
          }
        }
      });
    };
    const unsubscribe = stateBus.subscribe(syncBindings);
    syncBindings(stateBus.getState());
    host.addEventListener("ribbon-dispose", () => unsubscribe(), { once: true });
  }

  const disposeEvent = () => dispose();
  host.addEventListener("ribbon-dispose", disposeEvent, { once: true });
  window.addEventListener("beforeunload", disposeEvent, { once: true });
};
