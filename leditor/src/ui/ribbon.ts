import type { EditorHandle } from "../legacy/api/leditor.js";
import { dispatchCommand, type EditorCommandId } from "../legacy/api/editor_commands.js";
import { readCitationStyle } from "../legacy/api/command_map.js";
import { RibbonControl, RibbonGroup } from "../legacy/ui/ribbon_primitives.js";
import { Menu, MenuItem, MenuSeparator } from "../legacy/ui/ribbon_menu.js";
import { getTemplates } from "../legacy/templates/index.js";
import { getMarginValues, getOrientation, getPageSizeDefinitions, getCurrentPageSize, getLayoutColumns, subscribeToLayoutChanges } from "../legacy/ui/layout_settings.js";
import type { MarginValues } from "../legacy/ui/layout_settings.js";
import { createRibbonIcon, type RibbonIconName } from "../legacy/ui/ribbon_icons.js";
import { createRibbonButton, createRibbonDropdownButton } from "./ribbon_controls.js";
import {
  watchRibbonSelectionState,
  watchRibbonSelectionStateLegacy,
  type RibbonSelectionTargets
} from "./ribbon_selection.ts";
import { setReadMode, setScrollDirection, setRulerVisible, setGridlinesVisible, toggleNavigationPanel, isReadMode, getScrollDirection, isRulerVisible, isGridlinesVisible, isNavigationVisible, syncViewToggles } from "../legacy/ui/view_state.js";
import { SplitButton } from "../legacy/ui/ribbon_split_button.js";
import Pickr from "@simonwep/pickr";
import "@simonwep/pickr/dist/themes/classic.min.css";
import { CITATION_STYLES } from "../legacy/constants.js";
import type { Editor } from "@tiptap/core";
import { getLayoutController } from "../legacy/ui/layout_context.js";
import { THEME_CHANGE_EVENT } from "./theme_events.js";
import { showReviewCard } from "./review_popovers.js";
import { loadRibbonModel } from "./ribbon_config.js";

import { RibbonStateBus } from "./ribbon_state.js";
import type { AlignmentVariant } from "./ribbon_selection_helpers.js";
import { renderRibbonLayout } from "./ribbon_layout.js";


const FONT_FAMILIES = [
  { label: "Times New Roman", value: "Times New Roman" },
  { label: "Arial", value: "Arial" },
  { label: "Aptos", value: "Aptos" },
  { label: "Cambria", value: "Cambria" },
  { label: "Georgia", value: "Georgia" },
  { label: "Calibri", value: "Calibri" },
  { label: "Verdana", value: "Verdana" },
  { label: "Helvetica", value: "Helvetica" },
  { label: "Palatino Linotype", value: "Palatino Linotype" },
  { label: "Book Antiqua", value: "Book Antiqua" }
];

const TOP_ACADEMIC_FONTS = FONT_FAMILIES.slice(0, 5);

const FONT_SIZE_PRESETS = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36, 48, 72];
const LINE_SPACING_OPTIONS = ["1.0", "1.15", "1.5", "2.0"];
const PARAGRAPH_STYLES = [
  { label: "Normal", value: "normal" },
  { label: "Title", value: "title" },
  { label: "Subtitle", value: "subtitle" },
  { label: "Heading 1", value: "h1" },
  { label: "Heading 2", value: "h2" },
  { label: "Heading 3", value: "h3" },
  { label: "Heading 4", value: "h4" },
  { label: "Heading 5", value: "h5" },
  { label: "Heading 6", value: "h6" }
];
const SPACING_PRESETS = [
  { label: "0 pt", valuePx: 0 },
  { label: "6 pt", valuePx: 6 },
  { label: "12 pt", valuePx: 12 },
  { label: "18 pt", valuePx: 18 }
];

type TrackChangeDetail = {
  active: boolean;
  pendingChanges: Array<{ id: string; type: string; text: string; timestamp: number }>;
};

type RevisionDetail = Array<{ id: string; timestamp: string; summary: string }>;
type SpellSuggestionDetail = Array<{ id: string; word: string; suggestions: string[] }>;

let latestTrackChanges: TrackChangeDetail = { active: false, pendingChanges: [] };
let latestRevisions: RevisionDetail = [];
let latestSpellSuggestions: SpellSuggestionDetail = [];
let pendingSpellRequest: { anchor: HTMLElement; handle: EditorHandle } | null = null;
let pendingRevisionRequest: { anchor: HTMLElement; handle: EditorHandle } | null = null;
const aiRequestMap: Record<"summarize" | "rewrite" | "continue", { anchor: HTMLElement; handle: EditorHandle } | null> = {
  summarize: null,
  rewrite: null,
  continue: null
};

const HIGHLIGHT_COLORS = [
  "#fff59d",
  "#ffe082",
  "#ffb74d",
  "#a5d6a7",
  "#90caf9"
];

const TEXT_COLOR_PRESETS = [
  "#111827",
  "#1e3a8a",
  "#d81b60",
  "#4a148c",
  "#004d40"
];

const CASE_MODES = [
  { label: "Sentence case", value: "sentence" },
  { label: "lowercase", value: "lowercase" },
  { label: "UPPERCASE", value: "uppercase" },
  { label: "Capitalize Each Word", value: "title" }
];

type LegacyMenuInstance = InstanceType<typeof Menu>;

type RibbonHooks = {
  registerToggle?: (commandId: EditorCommandId, element: HTMLButtonElement) => void;
  registerAlignment?: (variant: AlignmentVariant, element: HTMLButtonElement) => void;
};

function openTrackChangesPopover(anchor: HTMLElement, editorHandle: EditorHandle, heading: string): void {
  const container = document.createElement("div");
  if (!latestTrackChanges.pendingChanges.length) {
    container.textContent = "No tracked changes pending.";
  } else {
    const entry = latestTrackChanges.pendingChanges[0];
    const summary = document.createElement("p");
    summary.textContent = `${entry.type === "insert" ? "Insertion" : "Deletion"}: ${entry.text.slice(0, 120)}`;
    container.appendChild(summary);
  }
  showReviewCard({
    anchor,
    title: heading,
    content: container,
    actions: [
      { label: "Accept", onSelect: () => dispatchCommand(editorHandle, "AcceptChange") },
      { label: "Reject", onSelect: () => dispatchCommand(editorHandle, "RejectChange") }
    ]
  });
}

function openSpellPopover(anchor: HTMLElement, editorHandle: EditorHandle): void {
  const container = document.createElement("div");
  if (!latestSpellSuggestions.length) {
    container.textContent = "Spellcheck has no suggestions yet.";
  } else {
    const list = document.createElement("div");
    latestSpellSuggestions.slice(0, 6).forEach((suggestion) => {
      const row = document.createElement("div");
      row.className = "leditor-review-suggestion-row";
      const word = document.createElement("span");
      word.textContent = suggestion.word;
      row.appendChild(word);
      const apply = document.createElement("button");
      apply.type = "button";
      apply.className = "leditor-review-card-action";
      apply.textContent = suggestion.suggestions[0] ?? "Apply";
      apply.addEventListener("click", () => {
        const replacement = suggestion.suggestions[0] ?? suggestion.word;
        dispatchCommand(editorHandle, "ReplaceWithSuggestion", { suggestion: replacement });
      });
      row.appendChild(apply);
      list.appendChild(row);
    });
    container.appendChild(list);
  }
  showReviewCard({
    anchor,
    title: "Spell suggestions",
    content: container,
    actions: [
      { label: "Rescan doc", onSelect: () => dispatchCommand(editorHandle, "ToggleSpellcheck") },
      {
        label: "Add word",
        onSelect: () => {
          const candidate = latestSpellSuggestions[0]?.word;
          if (candidate) {
            dispatchCommand(editorHandle, "AddToDictionary", { word: candidate });
          }
        }
      }
    ]
  });
}

function openRevisionPopover(anchor: HTMLElement, editorHandle: EditorHandle): void {
  const container = document.createElement("div");
  if (!latestRevisions.length) {
    container.textContent = "No saved revisions yet.";
  } else {
    latestRevisions.slice(0, 3).forEach((entry) => {
      const row = document.createElement("div");
      row.className = "leditor-review-suggestion-row";
      row.textContent = `${entry.timestamp}: ${entry.summary}`;
      container.appendChild(row);
    });
  }
  showReviewCard({
    anchor,
    title: "Revision history",
    content: container,
    actions: [
      { label: "Restore latest", onSelect: () => dispatchCommand(editorHandle, "RestoreRevision", { index: 0 }) },
      { label: "Save snapshot", onSelect: () => dispatchCommand(editorHandle, "SaveRevision") }
    ]
  });
}

function openAiPopover(
  anchor: HTMLElement,
  editorHandle: EditorHandle,
  detail: { action: string; text: string }
): void {
  const container = document.createElement("div");
  container.textContent = detail.text;
  const heading = detail.action.charAt(0).toUpperCase() + detail.action.slice(1);
  showReviewCard({
    anchor,
    title: `AI assistant — ${heading}`,
    content: container,
    actions: [{ label: "Focus editor", onSelect: () => editorHandle.focus() }]
  });
}

(() => {
  if (typeof window === "undefined") {
    return;
  }
  window.addEventListener("leditor:track-changes", (event) => {
    latestTrackChanges = (event as CustomEvent<TrackChangeDetail>).detail;
  });
  window.addEventListener("leditor:spellcheck:suggestions", (event) => {
    latestSpellSuggestions = (event as CustomEvent<{ suggestions: SpellSuggestionDetail }>).detail.suggestions;
    if (pendingSpellRequest) {
      openSpellPopover(pendingSpellRequest.anchor, pendingSpellRequest.handle);
      pendingSpellRequest = null;
    }
  });
  window.addEventListener("leditor:revision-history", (event) => {
    latestRevisions = (event as CustomEvent<{ revisions: RevisionDetail }>).detail.revisions;
    if (pendingRevisionRequest) {
      openRevisionPopover(pendingRevisionRequest.anchor, pendingRevisionRequest.handle);
      pendingRevisionRequest = null;
    }
  });
  window.addEventListener("leditor:ai-assistant", (event) => {
    const detail = (event as CustomEvent<{ action: string; text: string }>).detail;
    const request = aiRequestMap[detail.action as keyof typeof aiRequestMap];
    if (!request) {
      return;
    }
    openAiPopover(request.anchor, request.handle, detail);
    aiRequestMap[detail.action as keyof typeof aiRequestMap] = null;
  });
})();

const createRibbonGroup = (label: string, elements: HTMLElement[]): HTMLDivElement =>
  new RibbonGroup(label, elements).element as HTMLDivElement;

const createRibbonSeparator = (): HTMLDivElement => {
  const separator = document.createElement("div");
  separator.className = "ribbonSeparator";
  separator.setAttribute("aria-hidden", "true");
  return separator;
};

const appendGroupsWithSeparators = (grid: HTMLElement, groups: HTMLElement[]): void => {
  groups.forEach((group, index) => {
    grid.appendChild(group);
    if (index < groups.length - 1) {
      grid.appendChild(createRibbonSeparator());
    }
  });
};

type RibbonGridRowDefinition = {
  groups: HTMLElement[];
  className?: string;
  dataset?: Record<string, string>;
};

const createRibbonGridRow = (groups: HTMLElement[], extraClass?: string, dataset?: Record<string, string>): HTMLDivElement => {
  const row = document.createElement("div");
  row.className = "leditor-ribbon-grid-row";
  if (extraClass) {
    row.classList.add(extraClass);
  }
  if (dataset) {
    Object.entries(dataset).forEach(([key, value]) => {
      row.dataset[key] = value;
    });
  }
  if (groups.length) {
    appendGroupsWithSeparators(row, groups);
  }
  return row;
};

type ControlRegistry = Record<string, HTMLElement>;

const registerControl = (element: HTMLElement, controlId: string | undefined, registry?: ControlRegistry): void => {
  if (!controlId || !registry) return;
  element.dataset.controlId = controlId;
  registry[controlId] = element;
};

const createRibbonGridFromRows = (rows: RibbonGridRowDefinition[]): HTMLDivElement => {
  const grid = document.createElement("div");
  grid.className = "leditor-ribbon-grid";
  rows.forEach((rowDef) => {
    if (rowDef.groups.length) {
      grid.appendChild(createRibbonGridRow(rowDef.groups, rowDef.className, rowDef.dataset));
    }
  });
  return grid;
};

const createRibbonGrid = (groups: HTMLElement[]): HTMLDivElement => {
  if (groups.length === 0) {
    return createRibbonGridFromRows([]);
  }
  const breakIndex = Math.ceil(groups.length / 2);
  return createRibbonGridFromRows([
    { groups: groups.slice(0, breakIndex) },
    { groups: groups.slice(breakIndex) }
  ]);
};

const createHomeOverflowButton = (grid: HTMLDivElement): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "leditor-ribbon-home-overflow";
  button.setAttribute("aria-expanded", "false");
  button.title = "Show more Home controls";
  button.textContent = "⋯";
  button.addEventListener("click", () => {
    const expanded = grid.dataset.homeRowsExpanded === "true";
    const nextState = (!expanded).toString();
    grid.dataset.homeRowsExpanded = nextState;
    button.setAttribute("aria-expanded", nextState);
  });
  return button;
};

type IconButtonOptions = {
  icon: RibbonIconName;
  label: string;
  handler: () => void;
  commandId?: EditorCommandId;
  toggle?: boolean;
  registerToggle?: RibbonHooks["registerToggle"];
  extraClass?: string;
  disabled?: boolean;
  shortcut?: string;
};

const createIconButton = ({
  icon,
  label,
  handler,
  commandId,
  toggle,
  registerToggle,
  extraClass,
  disabled,
  shortcut
}: IconButtonOptions): HTMLButtonElement => {
  const extraClasses = ["leditor-ribbon-icon-btn"];
  if (extraClass) extraClasses.push(extraClass);
  const button = createRibbonButton({
    icon,
    label,
    size: "medium",
    tooltip: shortcut ? `${label} (${shortcut})` : label,
    toggle,
    disabled,
    onClick: handler,
    commandId,
    extraClasses
  });
  if (shortcut) {
    button.dataset.shortcut = shortcut;
  }
  if (toggle && commandId) {
    registerToggle?.(commandId, button);
    button.dataset.ribbonToggle = "true";
    if (!button.hasAttribute("aria-pressed")) {
      button.setAttribute("aria-pressed", "false");
    }
  }
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
  }
  return button;
};

const themeSyncCallbacks: Array<() => void> = [];
let themeListenerSetup = false;

const registerThemeSync = (sync: () => void): void => {
  themeSyncCallbacks.push(sync);
  if (themeListenerSetup || typeof document === "undefined") return;
  document.addEventListener(THEME_CHANGE_EVENT, () => {
    themeSyncCallbacks.forEach((callback) => callback());
  });
  themeListenerSetup = true;
};

const createChangeCaseDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon: "changeCase",
    label: "Change case",
    menu
  });
  CASE_MODES.forEach((mode) => {
    const item = MenuItem({
      label: mode.label,
      onSelect: () => {
        dispatchCommand(editorHandle, "ChangeCase", { mode: mode.value });
        button.dataset.value = mode.value;
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  button.dataset.value = CASE_MODES[0].value;
  return button;
};


type StatefulToggleOptions = {
  icon: RibbonIconName;
  label: string;
  onStateChange: (state: boolean) => void;
  initialState?: boolean;
};

const createStatefulToggleButton = ({
  icon,
  label,
  onStateChange,
  initialState = false
}: StatefulToggleOptions): HTMLButtonElement => {
  const button = createIconButton({
    icon,
    label,
    handler: () => {
      const current = button.getAttribute("aria-pressed") === "true";
      const next = !current;
      button.setAttribute("aria-pressed", String(next));
      button.classList.toggle("is-selected", next);
      onStateChange(next);
    }
  });
  button.dataset.ribbonToggle = "true";
  button.setAttribute("aria-pressed", initialState ? "true" : "false");
  if (initialState) {
    button.classList.add("is-selected");
  }
  return button;
};


type ModeToggleOptions = {
  icon: RibbonIconName;
  label: string;
  activate: () => void;
  isActive: () => boolean;
};

const createModeToggleButton = ({
  icon,
  label,
  activate,
  isActive
}: ModeToggleOptions): HTMLButtonElement => {
  let button: HTMLButtonElement;
  const sync = () => {
    const active = isActive();
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  };
  button = createIconButton({
    icon,
    label,
    handler: () => {
      activate();
      sync();
    }
  });
  button.dataset.ribbonToggle = "true";
  sync();
  return button;
};
const MARKUP_STORAGE_KEY = "leditor:markup-mode";
const MARKUP_OPTIONS = ["All", "None", "Original"] as const;
type MarkupMode = (typeof MARKUP_OPTIONS)[number];
type MarkupCommandId = "MarkupAll" | "MarkupNone" | "MarkupOriginal";
const MARKUP_COMMANDS: Record<MarkupMode, MarkupCommandId> = {
  All: "MarkupAll",
  None: "MarkupNone",
  Original: "MarkupOriginal"
};

const readMarkupMode = (): MarkupMode => {
  try {
    const stored = window.localStorage?.getItem(MARKUP_STORAGE_KEY);
    if (stored && MARKUP_OPTIONS.includes(stored as MarkupMode)) {
      return stored as MarkupMode;
    }
  } catch {
    // ignore storage failures
  }
  return MARKUP_OPTIONS[0];
};

const createToggleIconButton = (
  icon: RibbonIconName,
  label: string,
  commandId: EditorCommandId,
  editorHandle: EditorHandle,
  registerToggle?: RibbonHooks["registerToggle"]
): HTMLButtonElement =>
  createIconButton({
    icon,
    label,
    handler: () => dispatchCommand(editorHandle, commandId),
    commandId,
    toggle: true,
    registerToggle
  });

type RibbonDropdownButtonOptions = {
  icon: RibbonIconName;
  label: string;
  menu: LegacyMenuInstance;
};

const createDropdownButton = (options: RibbonDropdownButtonOptions): HTMLButtonElement =>
  createRibbonDropdownButton({ icon: options.icon, label: options.label, menu: options.menu });

type StackedDropdownButtonOptions = RibbonDropdownButtonOptions & {
  getValueLabel: () => string;
  size?: "big" | "small";
};

const createStackedDropdownButton = (options: StackedDropdownButtonOptions): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = [
    "leditor-ribbon-icon-btn",
    "ribbon-dropdown-button",
    options.size === "small" ? "ribbon-dropdown--small" : "ribbon-dropdown--big"
  ].join(" ");
  button.setAttribute("aria-label", options.label);
  button.dataset.dropdown = "true";

  const icon = createRibbonIcon(options.icon);
  icon.classList.add("ribbonIcon");

  const textWrap = document.createElement("span");
  textWrap.className = "ribbon-dropdown-text";
  const title = document.createElement("span");
  title.className = "ribbon-dropdown-title";
  title.textContent = options.label;
  const value = document.createElement("span");
  value.className = "ribbon-dropdown-value";
  value.textContent = options.getValueLabel();
  textWrap.append(title, value);

  const chevron = document.createElement("span");
  chevron.className = "ribbon-dropdown-chevron";
  chevron.textContent = "▾";

  button.append(icon, textWrap, chevron);

  let isOpen = false;
  const openMenu = (): void => {
    options.menu.open(button);
    button.setAttribute("aria-expanded", "true");
    button.classList.add("is-selected");
    isOpen = true;
  };
  const closeMenu = (): void => {
    options.menu.close();
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("is-selected");
    isOpen = false;
  };

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isOpen) {
      closeMenu();
      return;
    }
    openMenu();
  });

  options.menu.onClose(() => {
    button.setAttribute("aria-expanded", "false");
    button.classList.remove("is-selected");
    isOpen = false;
  });

  const syncValue = () => {
    value.textContent = options.getValueLabel();
  };
  new RibbonControl(button);
  return Object.assign(button, { syncValue });
};

const createParagraphStyleDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon: "style",
    label: "Paragraph style",
    menu
  });
  PARAGRAPH_STYLES.forEach((style) => {
    const item = MenuItem({
      label: style.label,
      onSelect: () => {
        switch (style.value) {
          case "normal":
            dispatchCommand(editorHandle, "NormalStyle");
            break;
          case "title":
          case "h1":
            dispatchCommand(editorHandle, "Heading1");
            break;
          case "subtitle":
          case "h2":
            dispatchCommand(editorHandle, "Heading2");
            break;
          case "h3":
            dispatchCommand(editorHandle, "Heading3");
            break;
          case "h4":
            dispatchCommand(editorHandle, "Heading4");
            break;
          case "h5":
            dispatchCommand(editorHandle, "Heading5");
            break;
          case "h6":
            dispatchCommand(editorHandle, "Heading6");
            break;
        }
        button.dataset.value = style.value;
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  button.dataset.value = PARAGRAPH_STYLES[0].value;
  return button;
};

const createFontFamilyDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon: "fontFamily",
    label: "Font family",
    menu
  });
  FONT_FAMILIES.forEach((family) => {
    const item = MenuItem({
      label: family.label,
      onSelect: () => {
        dispatchCommand(editorHandle, "FontFamily", { value: family.value });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createQuickFontDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon: "wordFonts",
    label: "Academic fonts",
    menu
  });
  TOP_ACADEMIC_FONTS.forEach((font) => {
    const item = MenuItem({
      label: font.label,
      onSelect: () => {
        dispatchCommand(editorHandle, "FontFamily", { value: font.value });
        menu.close();
      }
    });
    item.classList.add("leditor-word-font-item");
    menu.element.appendChild(item);
  });
  const other = MenuItem({
    label: "More fonts...",
    onSelect: () => {
      const family = window.prompt("Enter font family", FONT_FAMILIES[0].value);
      if (!family) return;
      dispatchCommand(editorHandle, "FontFamily", { value: family });
      menu.close();
    }
  });
  menu.element.appendChild(MenuSeparator());
  menu.element.appendChild(other);
  return button;
};

const createFontSizeDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon: "fontSize",
    label: "Font size",
    menu
  });
  button.classList.add("leditor-ribbon-font-size-dropdown");
  button.dataset.value = `${FONT_SIZE_PRESETS[0]}`;
  FONT_SIZE_PRESETS.forEach((size) => {
    const item = MenuItem({
      label: `${size} pt`,
      onSelect: () => {
        dispatchCommand(editorHandle, "FontSize", { valuePx: size });
        button.dataset.value = `${size}`;
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createLineSpacingDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon: "lineSpacing",
    label: "Line spacing",
    menu
  });
  LINE_SPACING_OPTIONS.forEach((value) => {
    const item = MenuItem({
      label: `${value}x`,
      onSelect: () => {
        dispatchCommand(editorHandle, "LineSpacing", { value });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createSpacingDropdown = (
  editorHandle: EditorHandle,
  command: "SpaceBefore" | "SpaceAfter",
  icon: RibbonIconName,
  label: string
): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon,
    label,
    menu
  });
  SPACING_PRESETS.forEach((preset) => {
    const item = MenuItem({
      label: preset.label,
      onSelect: () => {
        dispatchCommand(editorHandle, command, { valuePx: preset.valuePx });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createIndentSpinner = (
  editorHandle: EditorHandle,
  side: "left" | "right"
): HTMLDivElement => {
  const wrap = document.createElement("div");
  wrap.className = "ribbon-indent-spinner";
  const icon = createRibbonIcon(side === "left" ? "indentDecrease" : "indentIncrease");
  icon.classList.add("ribbon-indent-icon");
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.1";
  input.min = "-10";
  input.max = "20";
  input.value = "0.0";
  input.className = "ribbon-indent-input";
  const applyValue = () => {
    const cm = Number.parseFloat(input.value);
    if (!Number.isFinite(cm)) {
      return;
    }
    dispatchCommand(editorHandle, "SetParagraphIndent", {
      [side === "left" ? "leftCm" : "rightCm"]: cm
    } as any);
  };
  input.addEventListener("change", applyValue);
  const stepperUp = document.createElement("button");
  stepperUp.type = "button";
  stepperUp.className = "ribbon-indent-stepper up";
  stepperUp.textContent = "▲";
  stepperUp.addEventListener("click", () => {
    const next = Number.parseFloat(input.value) + 0.1;
    input.value = next.toFixed(1);
    applyValue();
  });
  const stepperDown = document.createElement("button");
  stepperDown.type = "button";
  stepperDown.className = "ribbon-indent-stepper down";
  stepperDown.textContent = "▼";
  stepperDown.addEventListener("click", () => {
    const next = Number.parseFloat(input.value) - 0.1;
    input.value = next.toFixed(1);
    applyValue();
  });
  const steppers = document.createElement("div");
  steppers.className = "ribbon-indent-steppers";
  steppers.append(stepperUp, stepperDown);
  wrap.append(icon, input, steppers);
  return wrap;
};

const pxToPt = (px: number): number => Math.round(px * 0.75);

const getBlockAttributes = (editor: Editor): { lineHeight: string | null; spaceBefore: number; spaceAfter: number } => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.isTextblock) {
      return {
        lineHeight: typeof node.attrs?.lineHeight === "string" ? node.attrs.lineHeight : null,
        spaceBefore: Number(node.attrs?.spaceBefore ?? 0),
        spaceAfter: Number(node.attrs?.spaceAfter ?? 0)
      };
    }
  }
  return { lineHeight: null, spaceBefore: 0, spaceAfter: 0 };
};

const createHomeStatusRow = (editorHandle: EditorHandle): HTMLDivElement => {
  const statusRow = document.createElement("div");
  statusRow.className = "leditor-home-status-row";
  const fontFamilyLabel = document.createElement("span");
  fontFamilyLabel.className = "leditor-home-status-item";
  const fontSizeLabel = document.createElement("span");
  fontSizeLabel.className = "leditor-home-status-item";
  const spacingLabel = document.createElement("span");
  spacingLabel.className = "leditor-home-status-item";

  const updateStatus = () => {
    const editor = editorHandle.getEditor();
    const familyAttr = editor.getAttributes("fontFamily").fontFamily;
    const fontFamily = typeof familyAttr === "string" && familyAttr.length > 0 ? familyAttr : "Body";
    const fontSizeValue = Number(editor.getAttributes("fontSize").fontSize);
    const fontSizeText = Number.isFinite(fontSizeValue) && fontSizeValue > 0 ? `${Math.round(fontSizeValue)} pt` : "Auto";
    const blockAttrs = getBlockAttributes(editor);
    const lineHeight = blockAttrs.lineHeight ?? "1.15";
    const beforePt = pxToPt(blockAttrs.spaceBefore);
    const afterPt = pxToPt(blockAttrs.spaceAfter);
    fontFamilyLabel.textContent = `Font: ${fontFamily}`;
    fontSizeLabel.textContent = `Size: ${fontSizeText}`;
    spacingLabel.textContent = `Spacing: ${lineHeight}× · Before ${beforePt} pt · After ${afterPt} pt`;
  };

  editorHandle.on("selectionChange", updateStatus);
  updateStatus();
  statusRow.append(fontFamilyLabel, fontSizeLabel, spacingLabel);
  return statusRow;
};

const ALIGN_ICON_MAP: Record<AlignmentVariant, RibbonIconName> = {
  left: "alignLeft",
  center: "alignCenter",
  right: "alignRight",
  justify: "alignJustify"
};

type AlignCommandId = "AlignLeft" | "AlignCenter" | "AlignRight" | "JustifyFull";

const createAlignButton = (
  label: string,
  commandId: AlignCommandId,
  variant: AlignmentVariant,
  editorHandle: EditorHandle,
  registerAlignment?: (variant: AlignmentVariant, element: HTMLButtonElement) => void
): HTMLButtonElement => {
  const button = createIconButton({
    icon: ALIGN_ICON_MAP[variant],
    label,
    handler: () => dispatchCommand(editorHandle, commandId),
    commandId,
    extraClass: "leditor-ribbon-align-btn"
  });
  button.setAttribute("aria-pressed", "false");
  registerAlignment?.(variant, button);
  return button;
};

type PickrColorCommandId = "TextColor" | "HighlightColor";
type PickrClearCommandId = "RemoveTextColor" | "RemoveHighlightColor";

const createPickrColorButton = (
  editorHandle: EditorHandle,
  commandId: PickrColorCommandId,
  clearCommandId: PickrClearCommandId,
  icon: RibbonIconName,
  label: string,
  colors: string[]
): HTMLButtonElement => {
  const button = createIconButton({
    icon,
    label,
    handler: () => pickr.show()
  });
  const applyColor = (color?: string) => {
    if (color) {
      button.dataset.value = color;
      button.style.setProperty("--ribbon-swatch-color", color);
      return;
    }
    button.dataset.value = "";
    button.style.removeProperty("--ribbon-swatch-color");
  };
  applyColor(colors[0]);
  const pickr = Pickr.create({
    el: button,
    theme: "classic",
    default: colors[0],
    swatches: colors,
    position: "bottom-start",
    components: {
      preview: true,
      opacity: true,
      hue: true,
      interaction: {
        input: true,
        save: true,
        clear: true,
        cancel: true
      }
    }
  });
  pickr.on("save", (color: Pickr.HSVaColor) => {
    const str = color.toHEXA().toString();
    dispatchCommand(editorHandle, commandId, { value: str });
    applyColor(str);
    pickr.hide();
  });
  pickr.on("clear", () => {
    dispatchCommand(editorHandle, clearCommandId);
    applyColor();
    pickr.hide();
  });
  pickr.on("show", () => {
    button.classList.add("is-selected");
  });
  pickr.on("hide", () => {
    button.classList.remove("is-selected");
  });
  pickr.on("cancel", () => pickr.hide());
  return button;
};
const createClipboardGroup = (editorHandle: EditorHandle, registry?: ControlRegistry): HTMLDivElement => {
  const row = document.createElement("div");
  row.className = "leditor-ribbon-format-actions clipboard-row";

  const cutButton = createIconButton({
    icon: "cut",
    label: "Cut",
    handler: () => dispatchCommand(editorHandle, "Cut"),
    shortcut: "Ctrl+X"
  });
  const copyButton = createIconButton({
    icon: "copy",
    label: "Copy",
    handler: () => dispatchCommand(editorHandle, "Copy"),
    shortcut: "Ctrl+C"
  });
  const formatPainter = createIconButton({
    icon: "formatPainter",
    label: "Format Painter",
    handler: () => dispatchCommand(editorHandle, "RemoveFontStyle"),
    commandId: "RemoveFontStyle",
    toggle: true
  });

  const pasteMenu = new Menu([]);
  const addPasteMenuItem = (label: string, onSelect: () => void) =>
    MenuItem({
      label,
      onSelect
    });

  pasteMenu.element.append(
    addPasteMenuItem("Keep Source Formatting", () => {
      dispatchCommand(editorHandle, "Paste");
      pasteMenu.close();
    }),
    addPasteMenuItem("Merge Formatting", () => {
      dispatchCommand(editorHandle, "Paste");
      pasteMenu.close();
    }),
    addPasteMenuItem("Keep Text Only", () => {
      dispatchCommand(editorHandle, "PastePlain");
      pasteMenu.close();
    }),
    MenuSeparator(),
    addPasteMenuItem("Paste Special…", () => {
      dispatchCommand(editorHandle, "PasteClean");
      pasteMenu.close();
    }),
    MenuSeparator(),
    addPasteMenuItem("Paste as Plain Text", () => {
      dispatchCommand(editorHandle, "PastePlain");
      pasteMenu.close();
    }),
    addPasteMenuItem("Paste from Word (Cleanup)", () => {
      dispatchCommand(editorHandle, "PasteClean");
      pasteMenu.close();
    }),
    MenuItem({
      label: "Auto-clean on paste",
      onSelect: () => {
        dispatchCommand(editorHandle, "PasteClean");
        pasteMenu.close();
      }
    }),
    addPasteMenuItem("Paste Cleanup Rules…", () => {
      dispatchCommand(editorHandle, "PasteClean");
      pasteMenu.close();
    }),
    MenuSeparator(),
    addPasteMenuItem("Set Default Paste…", () => {
      dispatchCommand(editorHandle, "Paste");
      pasteMenu.close();
    })
  );

  const pasteSplit = new SplitButton({
    label: "Paste",
    onPrimary: () => {
      dispatchCommand(editorHandle, "Paste");
      pasteMenu.close();
    },
    menu: pasteMenu,
    logLabel: "Paste"
  });

  const undoButton = createIconButton({
    icon: "undo",
    label: "Undo",
    handler: () => dispatchCommand(editorHandle, "Undo"),
    commandId: "Undo"
  });
  const redoButton = createIconButton({
    icon: "redo",
    label: "Redo",
    handler: () => dispatchCommand(editorHandle, "Redo"),
    commandId: "Redo"
  });

  const updateClipboardButtons = () => {
    const editor = editorHandle.getEditor();
    const hasSelection = !editor.state.selection.empty;
    cutButton.disabled = !hasSelection;
    copyButton.disabled = !hasSelection;
    cutButton.setAttribute("aria-disabled", hasSelection ? "false" : "true");
    copyButton.setAttribute("aria-disabled", hasSelection ? "false" : "true");
  };
  editorHandle.on("selectionChange", updateClipboardButtons);
  updateClipboardButtons();

  const leftColumn = document.createElement("div");
  leftColumn.className = "clipboard-left";
  leftColumn.appendChild(pasteSplit.element);

  const rightColumn = document.createElement("div");
  rightColumn.className = "clipboard-right";
  rightColumn.append(cutButton, copyButton, formatPainter, undoButton, redoButton);

  registerControl(pasteSplit.element, "clipboard.paste", registry);
  registerControl(cutButton, "clipboard.cut", registry);
  registerControl(copyButton, "clipboard.copy", registry);
  registerControl(formatPainter, "clipboard.formatPainter", registry);
  registerControl(undoButton, "clipboard.undo", registry);
  registerControl(redoButton, "clipboard.redo", registry);

  row.append(leftColumn, rightColumn);
  return createRibbonGroup("Clipboard", [row]);
};
const createFontGroup = (editorHandle: EditorHandle, hooks?: RibbonHooks, registry?: ControlRegistry): HTMLDivElement => {
  const headerRow = document.createElement("div");
  headerRow.className = "leditor-ribbon-format-actions home-header-row";
  headerRow.append(
    createParagraphStyleDropdown(editorHandle),
    createQuickFontDropdown(editorHandle),
    createFontFamilyDropdown(editorHandle),
    createFontSizeDropdown(editorHandle)
  );
  const buttonRow = document.createElement("div");
  buttonRow.className = "leditor-ribbon-format-actions home-button-row";
  const boldButton = createToggleIconButton("bold", "Bold", "Bold", editorHandle, hooks?.registerToggle);
  const italicButton = createToggleIconButton("italic", "Italic", "Italic", editorHandle, hooks?.registerToggle);
  const underlineButton = createToggleIconButton("underline", "Underline", "Underline", editorHandle, hooks?.registerToggle);
  const strikeButton = createToggleIconButton("strikethrough", "Strikethrough", "Strikethrough", editorHandle, hooks?.registerToggle);
  const superButton = createToggleIconButton("superscript", "Superscript", "Superscript", editorHandle, hooks?.registerToggle);
  const subButton = createToggleIconButton("subscript", "Subscript", "Subscript", editorHandle, hooks?.registerToggle);
  const linkButton = createIconButton({ icon: "link", label: "Insert link", handler: () => dispatchCommand(editorHandle, "Link") });
  const clearButton = createIconButton({
      icon: "clear",
      label: "Clear formatting",
      handler: () => dispatchCommand(editorHandle, "ClearFormatting"),
      extraClass: "leditor-ribbon-clear-btn"
    });
  const changeCase = createChangeCaseDropdown(editorHandle);
  const highlightButton = createPickrColorButton(editorHandle, "HighlightColor", "RemoveHighlightColor", "highlight", "Text highlight", HIGHLIGHT_COLORS);
  const textColorButton = createPickrColorButton(editorHandle, "TextColor", "RemoveTextColor", "textColor", "Font color", TEXT_COLOR_PRESETS);
  const clearColorButton = createIconButton({
      icon: "clear",
      label: "Clear color formatting",
      handler: () => {
        dispatchCommand(editorHandle, "RemoveHighlightColor");
        dispatchCommand(editorHandle, "RemoveTextColor");
      }
    });
  buttonRow.append(
    boldButton,
    italicButton,
    underlineButton,
    strikeButton,
    superButton,
    subButton,
    linkButton,
    clearButton,
    changeCase,
    highlightButton,
    textColorButton,
    clearColorButton
  );
  const statusRow = createHomeStatusRow(editorHandle);
  buttonRow.appendChild(statusRow);
  registerControl(boldButton, "font.bold", registry);
  registerControl(italicButton, "font.italic", registry);
  registerControl(underlineButton, "font.underline", registry);
  registerControl(strikeButton, "font.strikethrough", registry);
  registerControl(superButton, "font.superscript", registry);
  registerControl(subButton, "font.subscript", registry);
  registerControl(changeCase, "font.changeCase", registry);
  registerControl(highlightButton, "font.highlight", registry);
  registerControl(textColorButton, "font.color", registry);
  registerControl(clearButton, "font.clearFormatting", registry);
  return createRibbonGroup("Font", [headerRow, buttonRow]);
};

const createParagraphGroup = (editorHandle: EditorHandle, hooks?: RibbonHooks, registry?: ControlRegistry): HTMLDivElement => {
  const primaryRow = document.createElement("div");
  primaryRow.className = "leditor-ribbon-format-actions paragraph-primary-row";
  const bulletButton = createToggleIconButton("bulletList", "Bulleted list", "BulletList", editorHandle, hooks?.registerToggle);
  const numberButton = createToggleIconButton("numberList", "Numbered list", "NumberList", editorHandle, hooks?.registerToggle);
  const multiListMenu = new Menu([]);
  const multiListButton = createDropdownButton({ icon: "multiList", label: "List style", menu: multiListMenu });
  const bulletItem = MenuItem({
    label: "Bulleted list",
    onSelect: () => {
      dispatchCommand(editorHandle, "BulletList");
      multiListMenu.close();
    }
  });
  const numberItem = MenuItem({
    label: "Numbered list",
    onSelect: () => {
      dispatchCommand(editorHandle, "NumberList");
      multiListMenu.close();
    }
  });
  const multilevelItem = MenuItem({
    label: "Multilevel list",
    onSelect: () => {
      dispatchCommand(editorHandle, "BulletList");
      dispatchCommand(editorHandle, "Indent");
      multiListMenu.close();
    }
  });
  multiListMenu.element.append(bulletItem, numberItem, multilevelItem);
  primaryRow.append(
    createAlignButton("Align left", "AlignLeft", "left", editorHandle, hooks?.registerAlignment),
    createAlignButton("Center", "AlignCenter", "center", editorHandle, hooks?.registerAlignment),
    createAlignButton("Align right", "AlignRight", "right", editorHandle, hooks?.registerAlignment),
    createAlignButton("Justify", "JustifyFull", "justify", editorHandle, hooks?.registerAlignment),
    bulletButton,
    numberButton,
    multiListButton,
    createIconButton({ icon: "indentDecrease", label: "Decrease indent", handler: () => dispatchCommand(editorHandle, "Outdent") }),
    createIconButton({ icon: "indentIncrease", label: "Increase indent", handler: () => dispatchCommand(editorHandle, "Indent") }),
    createIconButton({
      icon: "directionLTR",
      label: "Left-to-right",
      handler: () => dispatchCommand(editorHandle, "DirectionLTR")
    }),
    createIconButton({
      icon: "directionRTL",
      label: "Right-to-left",
      handler: () => dispatchCommand(editorHandle, "DirectionRTL")
    })
  );
  const spacingRow = document.createElement("div");
  spacingRow.className = "leditor-ribbon-format-actions paragraph-spacing-row";
  spacingRow.append(
    createLineSpacingDropdown(editorHandle),
    createSpacingDropdown(editorHandle, "SpaceBefore", "spacingBefore", "Spacing before"),
    createSpacingDropdown(editorHandle, "SpaceAfter", "spacingAfter", "Spacing after")
  );
  registerControl(bulletButton, "paragraph.bullets", registry);
  registerControl(numberButton, "paragraph.numbering", registry);
  registerControl(multiListButton, "paragraph.multilevel", registry);
  return createRibbonGroup("Paragraph", [primaryRow, spacingRow]);
};

const createStylesGroup = (editorHandle: EditorHandle, registry?: ControlRegistry): HTMLDivElement => {
  const pinnedStyles = [
    "Normal",
    "No Spacing",
    "Heading 1",
    "Heading 2",
    "Heading 3",
    "Title",
    "Subtitle",
    "Quote",
    "Intense Quote",
    "Code Block"
  ];
  const gallery = document.createElement("div");
  gallery.className = "styles-gallery";
  pinnedStyles.forEach((style, index) => {
    const button = createRibbonButton({
      icon: "style",
      label: style,
      size: "medium",
      tooltip: `Apply ${style}`,
      onClick: () => dispatchCommand(editorHandle, "NormalStyle"),
      extraClasses: ["styles-gallery__item"]
    });
    registerControl(button, index === 0 ? "styles.gallery" : undefined, registry);
    gallery.appendChild(button);
  });

  const footerRow = document.createElement("div");
  footerRow.className = "leditor-ribbon-format-actions styles-footer";
  footerRow.append(
    createIconButton({
      icon: "style",
      label: "Styles Pane",
      handler: () => dispatchCommand(editorHandle, "NormalStyle")
    }),
    createIconButton({
      icon: "style",
      label: "Manage Styles",
      handler: () => dispatchCommand(editorHandle, "NormalStyle")
    })
  );

  registerControl(footerRow.children[0] as HTMLElement, "styles.pane", registry);
  registerControl(footerRow.children[1] as HTMLElement, "styles.manage", registry);

  return createRibbonGroup("Styles", [gallery, footerRow]);
};

const createEditingGroup = (editorHandle: EditorHandle, registry?: ControlRegistry): HTMLDivElement => {
  const row = document.createElement("div");
  row.className = "leditor-ribbon-format-actions editing-row";

  const findMenu = new Menu([]);
  const regexToggle = MenuItem({
    label: "Regex Find",
    onSelect: () => dispatchCommand(editorHandle, "SearchReplace")
  });
  const matchCaseToggle = MenuItem({
    label: "Match Case",
    onSelect: () => dispatchCommand(editorHandle, "SearchReplace")
  });
  const wholeWordsToggle = MenuItem({
    label: "Whole Words Only",
    onSelect: () => dispatchCommand(editorHandle, "SearchReplace")
  });
  findMenu.element.append(
    MenuItem({ label: "Find…", onSelect: () => dispatchCommand(editorHandle, "SearchReplace") }),
    MenuItem({ label: "Advanced Find…", onSelect: () => dispatchCommand(editorHandle, "SearchReplace") }),
    MenuItem({ label: "Go To…", onSelect: () => dispatchCommand(editorHandle, "SearchReplace") }),
    MenuSeparator(),
    regexToggle,
    matchCaseToggle,
    wholeWordsToggle
  );

  const findSplit = new SplitButton({
    label: "Find",
    onPrimary: () => dispatchCommand(editorHandle, "SearchReplace"),
    menu: findMenu,
    logLabel: "Find"
  });

  const replaceButton = createIconButton({
    icon: "replace",
    label: "Replace",
    handler: () => dispatchCommand(editorHandle, "SearchReplace")
  });

  const selectMenu = new Menu([]);
  selectMenu.element.append(
    MenuItem({ label: "Select All", onSelect: () => dispatchCommand(editorHandle, "SearchReplace") }),
    MenuItem({ label: "Select Objects", onSelect: () => dispatchCommand(editorHandle, "SearchReplace") }),
    MenuItem({ label: "Select Similar Formatting", onSelect: () => dispatchCommand(editorHandle, "SearchReplace") })
  );
  const selectDropdown = createDropdownButton({
    icon: "select",
    label: "Select",
    menu: selectMenu
  });

  row.append(findSplit.element, replaceButton, selectDropdown);
  registerControl(findSplit.element, "editing.find", registry);
  registerControl(replaceButton, "editing.replace", registry);
  registerControl(selectDropdown, "editing.select", registry);
  return createRibbonGroup("Editing", [row]);
};

const createReferenceLinksGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({ icon: "bookmark", label: "Insert bookmark", handler: () => dispatchCommand(editorHandle, "InsertBookmark") }),
    createIconButton({ icon: "crossReference", label: "Insert cross-reference", handler: () => dispatchCommand(editorHandle, "InsertCrossReference") })
  );
  return createRibbonGroup("Links", [actions]);
};

const createTocGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({ icon: "toc", label: "Insert Table of Contents", handler: () => dispatchCommand(editorHandle, "InsertTOC") }),
    createIconButton({ icon: "tocAdd", label: "Add heading to TOC", handler: () => dispatchCommand(editorHandle, "InsertTocHeading") }),
    createIconButton({ icon: "refresh", label: "Update Table of Contents", handler: () => dispatchCommand(editorHandle, "UpdateTOC") })
  );
  return createRibbonGroup("Table of Contents", [actions]);
};

const createFootnotesGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({ icon: "footnote", label: "Insert footnote", handler: () => dispatchCommand(editorHandle, "InsertFootnote") }),
    createIconButton({ icon: "footnotePrev", label: "Previous footnote", handler: () => dispatchCommand(editorHandle, "PreviousFootnote") }),
    createIconButton({ icon: "footnoteNext", label: "Next footnote", handler: () => dispatchCommand(editorHandle, "NextFootnote") }),
    createIconButton({ icon: "footnotePanel", label: "Footnote manager", handler: () => dispatchCommand(editorHandle, "FootnotePanel") })
  );
  return createRibbonGroup("Footnotes", [actions]);
};

const createCitationStyleDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({ icon: "citation", label: "Citation style", menu });
  const formatLabel = (styleId: string): string => {
    switch (styleId) {
      case "apa":
        return "APA";
      case "vancouver":
        return "Numeric (Vancouver)";
      case "chicago-note-bibliography":
        return "Footnote (Chicago Notes)";
      case "chicago-footnotes":
        return "Footnote (Chicago Footnotes)";
      case "chicago-note-bibliography-endnote":
        return "Endnote (Chicago Notes)";
      default:
        return styleId;
    }
  };
  const applyStyle = (style: string) => {
    button.dataset.value = style;
  };
  applyStyle(readCitationStyle(editorHandle.getEditor?.()));
  CITATION_STYLES.forEach((style: (typeof CITATION_STYLES)[number]) => {
    const item = MenuItem({
      label: formatLabel(style),
      onSelect: () => {
        dispatchCommand(editorHandle, "SetCitationStyle", { style });
        applyStyle(style);
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createCitationsGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const primaryRow = document.createElement("div");
  primaryRow.className = "leditor-ribbon-format-actions";
  primaryRow.append(
    createIconButton({ icon: "citation", label: "Insert citation", handler: () => dispatchCommand(editorHandle, "InsertCitation") }),
    createIconButton({ icon: "refresh", label: "Update citations", handler: () => dispatchCommand(editorHandle, "UpdateCitations") }),
    createCitationStyleDropdown(editorHandle)
  );
  const bibliographyRow = document.createElement("div");
  bibliographyRow.className = "leditor-ribbon-format-actions";
  bibliographyRow.append(
    createIconButton({ icon: "bibliography", label: "Insert bibliography", handler: () => dispatchCommand(editorHandle, "InsertBibliography") }),
    createIconButton({ icon: "refresh", label: "Refresh bibliography", handler: () => dispatchCommand(editorHandle, "UpdateBibliography") })
  );
  return createRibbonGroup("Citations", [primaryRow, bibliographyRow]);
};

const createReferencesPanel = (editorHandle: EditorHandle): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "References");
  const grid = createRibbonGrid([
    createTocGroup(editorHandle),
    createFootnotesGroup(editorHandle),
    createCitationsGroup(editorHandle),
    createReferenceLinksGroup(editorHandle)
  ]);
  panel.appendChild(grid);
  return panel;
};

const createProofingGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  const proofingButton = createIconButton({
    icon: "proofing",
    label: "Proofing summary",
    handler: () => dispatchCommand(editorHandle, "ProofingPanel")
  });
  let spellButton: HTMLButtonElement;
  spellButton = createIconButton({
    icon: "spell",
    label: "Spelling",
    handler: () => {
      pendingSpellRequest = { anchor: spellButton, handle: editorHandle };
      dispatchCommand(editorHandle, "Spelling");
    }
  });
  actions.append(
    proofingButton,
    spellButton,
    createIconButton({ icon: "thesaurus", label: "Thesaurus", handler: () => dispatchCommand(editorHandle, "Thesaurus") }),
    createIconButton({ icon: "wordCount", label: "Word count", handler: () => dispatchCommand(editorHandle, "WordCount") })
  );
  return createRibbonGroup("Proofing", [actions]);
};

const createReadAloudGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({ icon: "readAloud", label: "Read aloud", handler: () => dispatchCommand(editorHandle, "ReadAloud") })
  );
  return createRibbonGroup("Read aloud", [actions]);
};

const createCommentsGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({ icon: "commentsNew", label: "New comment", handler: () => dispatchCommand(editorHandle, "CommentsNew") }),
    createIconButton({ icon: "commentsDelete", label: "Delete comment", handler: () => dispatchCommand(editorHandle, "CommentsDelete") }),
    createIconButton({ icon: "commentsPrev", label: "Previous comment", handler: () => dispatchCommand(editorHandle, "CommentsPrev") }),
    createIconButton({ icon: "commentsNext", label: "Next comment", handler: () => dispatchCommand(editorHandle, "CommentsNext") })
  );
  return createRibbonGroup("Comments", [actions]);
};

const createMarkupDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createDropdownButton({ icon: "markupAll", label: "Markup view", menu });
  const applyMode = (mode: MarkupMode) => {
    button.dataset.value = mode;
  };
  applyMode(readMarkupMode());
  MARKUP_OPTIONS.forEach((mode) => {
    const item = MenuItem({
      label: mode,
      onSelect: () => {
        dispatchCommand(editorHandle, MARKUP_COMMANDS[mode]);
        applyMode(mode);
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createMarkupGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(createMarkupDropdown(editorHandle));
  return createRibbonGroup("Markup", [actions]);
};

const createTrackChangesGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  let trackButton: HTMLButtonElement;
  trackButton = createStatefulToggleButton({
    icon: "trackChanges",
    label: "Track changes",
    onStateChange: () => {
      dispatchCommand(editorHandle, "ToggleTrackChanges");
      openTrackChangesPopover(trackButton, editorHandle, "Track changes");
    }
  });
  const acceptButton = createIconButton({
    icon: "accept",
    label: "Accept change",
    handler: () => {
      dispatchCommand(editorHandle, "AcceptChange");
      openTrackChangesPopover(acceptButton, editorHandle, "Accept change");
    }
  });
  const rejectButton = createIconButton({
    icon: "reject",
    label: "Reject change",
    handler: () => {
      dispatchCommand(editorHandle, "RejectChange");
      openTrackChangesPopover(rejectButton, editorHandle, "Reject change");
    }
  });
  const prevButton = createIconButton({
    icon: "commentsPrev",
    label: "Previous change",
    handler: () => {
      dispatchCommand(editorHandle, "PrevChange");
      openTrackChangesPopover(prevButton, editorHandle, "Previous change");
    }
  });
  const nextButton = createIconButton({
    icon: "commentsNext",
    label: "Next change",
    handler: () => {
      dispatchCommand(editorHandle, "NextChange");
      openTrackChangesPopover(nextButton, editorHandle, "Next change");
    }
  });
  actions.append(trackButton, acceptButton, rejectButton, prevButton, nextButton);
  return createRibbonGroup("Track changes", [actions]);
};

const createRevisionHistoryGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  const historyButton = createIconButton({
    icon: "revisionHistory",
    label: "Revision history",
    handler: () => {
      pendingRevisionRequest = { anchor: historyButton, handle: editorHandle };
      dispatchCommand(editorHandle, "OpenRevisionHistory");
    }
  });
  const saveButton = createIconButton({
    icon: "refresh",
    label: "Save revision",
    handler: () => dispatchCommand(editorHandle, "SaveRevision")
  });
  actions.append(historyButton, saveButton);
  return createRibbonGroup("History", [actions]);
};

const createAiAssistantGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  const summarizeButton = createIconButton({
    icon: "aiAssistant",
    label: "Summarize selection",
    handler: () => {
      aiRequestMap.summarize = { anchor: summarizeButton, handle: editorHandle };
      dispatchCommand(editorHandle, "AiSummarizeSelection");
    }
  });
  const rewriteButton = createIconButton({
    icon: "aiAssistant",
    label: "Rewrite selection",
    handler: () => {
      aiRequestMap.rewrite = { anchor: rewriteButton, handle: editorHandle };
      dispatchCommand(editorHandle, "AiRewriteSelection");
    }
  });
  const continueButton = createIconButton({
    icon: "aiAssistant",
    label: "Continue writing",
    handler: () => {
      aiRequestMap.continue = { anchor: continueButton, handle: editorHandle };
      dispatchCommand(editorHandle, "AiContinue");
    }
  });
  actions.append(summarizeButton, rewriteButton, continueButton);
  return createRibbonGroup("AI assistant", [actions]);
};

const createReviewPanel = (editorHandle: EditorHandle): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Review tools");
  const grid = createRibbonGrid([
    createProofingGroup(editorHandle),
    createCommentsGroup(editorHandle),
    createTrackChangesGroup(editorHandle),
    createRevisionHistoryGroup(editorHandle),
    createAiAssistantGroup(editorHandle),
    createMarkupGroup(editorHandle),
    createReadAloudGroup(editorHandle)
  ]);
  panel.appendChild(grid);
  return panel;
};

const createViewModeGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  const readButton = createModeToggleButton({
    icon: "readMode",
    label: "Read mode",
    activate: () => setReadMode(true),
    isActive: isReadMode
  });
  const printButton = createModeToggleButton({
    icon: "printLayout",
    label: "Print layout",
    activate: () => setReadMode(false),
    isActive: () => !isReadMode()
  });
  actions.append(readButton, printButton);
  return createRibbonGroup("View modes", [actions]);
};

const createPageMovementGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  const verticalButton = createModeToggleButton({
    icon: "verticalScroll",
    label: "Vertical movement",
    activate: () => setScrollDirection("vertical"),
    isActive: () => getScrollDirection() === "vertical"
  });
  const horizontalButton = createModeToggleButton({
    icon: "horizontalScroll",
    label: "Side-to-side scrolling",
    activate: () => setScrollDirection("horizontal"),
    isActive: () => getScrollDirection() === "horizontal"
  });
  actions.append(verticalButton, horizontalButton);
  return createRibbonGroup("Page movement", [actions]);
};

const createShowTogglesGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  const rulerButton = createModeToggleButton({
    icon: "ruler",
    label: "Show ruler",
    activate: () => {
      setRulerVisible(!isRulerVisible());
      syncViewToggles();
    },
    isActive: isRulerVisible
  });
  const gridButton = createModeToggleButton({
    icon: "gridlines",
    label: "Show gridlines",
    activate: () => {
      setGridlinesVisible(!isGridlinesVisible());
      syncViewToggles();
    },
    isActive: isGridlinesVisible
  });
  const navButton = createModeToggleButton({
    icon: "navigation",
    label: "Navigation pane",
    activate: () => toggleNavigationPanel(editorHandle),
    isActive: isNavigationVisible
  });
  const visualBlocksButton = createStatefulToggleButton({
    icon: "visualBlocks",
    label: "Show blocks",
    onStateChange: () => dispatchCommand(editorHandle, "VisualBlocks")
  });
  const visualCharsButton = createStatefulToggleButton({
    icon: "visualChars",
    label: "Show formatting marks",
    onStateChange: () => dispatchCommand(editorHandle, "VisualChars")
  });
  actions.append(rulerButton, gridButton, navButton, visualBlocksButton, visualCharsButton);
  return createRibbonGroup("Show", [actions]);
};

const createZoomGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({ icon: "zoomOut", label: "Zoom out", handler: () => dispatchCommand(editorHandle, "ZoomOut") }),
    createIconButton({ icon: "zoomIn", label: "Zoom in", handler: () => dispatchCommand(editorHandle, "ZoomIn") }),
    createIconButton({ icon: "zoomReset", label: "100% zoom", handler: () => dispatchCommand(editorHandle, "ZoomReset") }),
    createIconButton({ icon: "onePage", label: "One page", handler: () => dispatchCommand(editorHandle, "ViewSinglePage") }),
    createIconButton({ icon: "twoPage", label: "Multiple pages", handler: () => dispatchCommand(editorHandle, "ViewTwoPage") }),
    createIconButton({ icon: "fitWidth", label: "Page width", handler: () => dispatchCommand(editorHandle, "ViewFitWidth") })
  );
  return createRibbonGroup("Zoom", [actions]);
};

const createThemeModeButton = (
  mode: "light" | "dark",
  icon: RibbonIconName,
  label: string
): HTMLButtonElement => {
  const button = createIconButton({
    icon,
    label,
    handler: () => {
      const layout = getLayoutController();
      if (!layout) return;
      const current = layout.getTheme();
      layout.setTheme(mode, current.surface);
    }
  });
  button.dataset.ribbonToggle = "true";
  const syncState = () => {
    const layout = getLayoutController();
    const currentMode = layout?.getTheme().mode ?? "light";
    const active = currentMode === mode;
    button.classList.toggle("is-selected", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  };
  registerThemeSync(syncState);
  syncState();
  return button;
};

const createThemeGroup = (): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createThemeModeButton("light", "themeLight", "Light theme"),
    createThemeModeButton("dark", "themeDark", "Dark theme")
  );
  return createRibbonGroup("Theme", [actions]);
};

const createDisplayGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({ icon: "shortcode", label: "View source", handler: () => dispatchCommand(editorHandle, "SourceView") }),
    createIconButton({ icon: "preview", label: "Preview", handler: () => dispatchCommand(editorHandle, "Preview") }),
    createIconButton({ icon: "fullscreen", label: "Fullscreen", handler: () => dispatchCommand(editorHandle, "Fullscreen") })
  );
  return createRibbonGroup("Display", [actions]);
};

const createViewPanel = (editorHandle: EditorHandle): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "View settings");
  const grid = createRibbonGrid([
    createViewModeGroup(editorHandle),
    createPageMovementGroup(editorHandle),
    createShowTogglesGroup(editorHandle),
    createThemeGroup(),
    createDisplayGroup(editorHandle),
    createZoomGroup(editorHandle)
  ]);
  panel.appendChild(grid);
  return panel;
};

const TABLE_GRID_ROWS = 8;
const TABLE_GRID_COLS = 10;

type TemplateDefinition = {
  id?: string;
  label?: string;
};

const createCoverTemplateDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const templates = getTemplates() as TemplateDefinition[];
  const menu = new Menu([]);
  const button = createDropdownButton({
    icon: "cover",
    label: "Cover page",
    menu
  });
  if (templates.length === 0) {
    const empty = MenuItem({ label: "No templates available", disabled: true });
    menu.element.appendChild(empty);
    return button;
  }
  templates.forEach((template: TemplateDefinition) => {
    const templateId = template.id;
    if (!templateId) {
      return;
    }
    const item = MenuItem({
      label: template.label ?? "Template",
      onSelect: () => {
        dispatchCommand(editorHandle, "InsertTemplate", { id: templateId });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const setTableGridHighlight = (
  grid: HTMLElement,
  rows: number,
  cols: number,
  status?: HTMLElement
): void => {
  grid.querySelectorAll<HTMLButtonElement>(".leditor-menu-grid-cell").forEach((cell) => {
    const cellRows = Number(cell.dataset.rows);
    const cellCols = Number(cell.dataset.cols);
    const active = rows > 0 && cols > 0 && cellRows <= rows && cellCols <= cols;
    cell.dataset.highlight = active ? "true" : "false";
  });
  if (status) {
    status.textContent = rows > 0 && cols > 0 ? `${rows} × ${cols} table` : "Insert table";
  }
};

const createTableDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const grid = document.createElement("div");
  grid.className = "leditor-menu-grid";
  const status = document.createElement("div");
  status.className = "leditor-menu-grid-status";
  status.textContent = "Insert table";
  for (let row = 1; row <= TABLE_GRID_ROWS; row += 1) {
    for (let col = 1; col <= TABLE_GRID_COLS; col += 1) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "leditor-menu-grid-cell";
      cell.dataset.rows = String(row);
      cell.dataset.cols = String(col);
      cell.dataset.menuItem = "true";
      cell.setAttribute("aria-label", `${row} x ${col} table`);
      cell.addEventListener("mouseenter", () => setTableGridHighlight(grid, row, col, status));
      cell.addEventListener("click", () => {
        dispatchCommand(editorHandle, "TableInsert", { rows: row, cols: col });
        setTableGridHighlight(grid, 0, 0, status);
        menu.close();
      });
      grid.appendChild(cell);
    }
  }
  grid.addEventListener("mouseleave", () => setTableGridHighlight(grid, 0, 0, status));
  menu.element.appendChild(grid);
  menu.element.appendChild(status);
  return createDropdownButton({
    icon: "table",
    label: "Insert table",
    menu
  });
};

const createInsertPagesGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createCoverTemplateDropdown(editorHandle),
    createIconButton({
      icon: "pageBreak",
      label: "Page break",
      handler: () => dispatchCommand(editorHandle, "InsertPageBreak")
    })
  );
  return createRibbonGroup("Pages", [actions]);
};

const createInsertTablesGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(createTableDropdown(editorHandle));
  return createRibbonGroup("Tables", [actions]);
};

const createInsertIllustrationsGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({
      icon: "image",
      label: "Insert picture",
      handler: () => dispatchCommand(editorHandle, "InsertImage")
    })
  );
  return createRibbonGroup("Illustrations", [actions]);
};

const createInsertNotesGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({
      icon: "footnote",
      label: "Insert footnote",
      handler: () => dispatchCommand(editorHandle, "InsertFootnote")
    }),
    createIconButton({
      icon: "endnote",
      label: "Insert endnote",
      handler: () => dispatchCommand(editorHandle, "InsertEndnote")
    })
  );
  return createRibbonGroup("Notes", [actions]);
};

const createInsertLinksGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({
      icon: "link",
      label: "Insert link",
      handler: () => dispatchCommand(editorHandle, "Link")
    }),
    createIconButton({
      icon: "bookmark",
      label: "Insert bookmark",
      handler: () => dispatchCommand(editorHandle, "InsertBookmark")
    }),
    createIconButton({
      icon: "crossReference",
      label: "Insert cross-reference",
      handler: () => dispatchCommand(editorHandle, "InsertCrossReference")
    })
  );
  return createRibbonGroup("Links", [actions]);
};

const createInsertCommentsGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({
      icon: "commentsNew",
      label: "New comment",
      handler: () => dispatchCommand(editorHandle, "InsertComment")
    })
  );
  return createRibbonGroup("Comments", [actions]);
};

const createDocumentConvertersGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({
      icon: "docx",
      label: "Import DOCX",
      handler: () => dispatchCommand(editorHandle, "ImportDocx")
    }),
    createIconButton({
      icon: "docx",
      label: "Export DOCX",
      handler: () => dispatchCommand(editorHandle, "ExportDocx")
    }),
    createIconButton({
      icon: "exportPdf",
      label: "Export PDF",
      handler: () => dispatchCommand(editorHandle, "ExportPdf")
    })
  );
  return createRibbonGroup("Document", [actions]);
};

const createHeaderFooterGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const actions = document.createElement("div");
  actions.className = "leditor-ribbon-format-actions";
  actions.append(
    createIconButton({
      icon: "header",
      label: "Edit header",
      handler: () => dispatchCommand(editorHandle, "EditHeader")
    }),
    createIconButton({
      icon: "footer",
      label: "Edit footer",
      handler: () => dispatchCommand(editorHandle, "EditFooter")
    })
  );
  return createRibbonGroup("Header & footer", [actions]);
};

const createInsertPanel = (editorHandle: EditorHandle): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel";
  const grid = createRibbonGrid([
    createInsertPagesGroup(editorHandle),
    createDocumentConvertersGroup(editorHandle),
    createInsertTablesGroup(editorHandle),
    createInsertIllustrationsGroup(editorHandle),
    createInsertNotesGroup(editorHandle),
    createInsertLinksGroup(editorHandle),
    createInsertCommentsGroup(editorHandle),
    createHeaderFooterGroup(editorHandle)
  ]);
  panel.appendChild(grid);
  return panel;
};
const createHomePanel = (editorHandle: EditorHandle, hooks?: RibbonHooks, registry?: ControlRegistry): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel";
  const grid = createRibbonGridFromRows([
    {
      groups: [
        createClipboardGroup(editorHandle, registry),
        createFontGroup(editorHandle, hooks, registry),
        createStylesGroup(editorHandle, registry)
      ],
      className: "leditor-ribbon-home-row home-row-primary"
    },
    {
      groups: [createParagraphGroup(editorHandle, hooks, registry)],
      className: "leditor-ribbon-home-row home-row-paragraph"
    },
    {
      groups: [createEditingGroup(editorHandle, registry)],
      className: "leditor-ribbon-home-row home-row-editing"
    }
  ]);
  grid.dataset.homeRowsExpanded = "false";
  const primaryRow = grid.querySelector<HTMLElement>(".leditor-ribbon-home-row.home-row-primary");
  if (primaryRow) {
    primaryRow.appendChild(createHomeOverflowButton(grid));
  }
  panel.appendChild(grid);
  return panel;
};
                    
const MARGIN_PRESETS: Record<string, { label: string; margins: MarginValues }> = {
  normal: {
    label: "Normal",
    margins: { top: "1in", right: "1in", bottom: "1in", left: "1in" }
  },
  narrow: {
    label: "Narrow",
    margins: { top: "0.5in", right: "0.5in", bottom: "0.5in", left: "0.5in" }
  },
  moderate: {
    label: "Moderate",
    margins: { top: "1in", right: "0.75in", bottom: "1in", left: "0.75in" }
  }
};

const isMarginEqual = (lhs: MarginValues, rhs: MarginValues): boolean =>
  lhs.top === rhs.top &&
  lhs.right === rhs.right &&
  lhs.bottom === rhs.bottom &&
  lhs.left === rhs.left;

const parseMarginValues = (input: string): MarginValues | null => {
  const parts = input.trim().split(/\s+/);
  if (parts.length !== 4) {
    return null;
  }
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
};

const promptCustomMargins = (current: MarginValues): MarginValues | null => {
  const raw = window.prompt(
    "Enter margins (top right bottom left)",
    `${current.top} ${current.right} ${current.bottom} ${current.left}`
  );
  if (!raw) {
    return null;
  }
  const parsed = parseMarginValues(raw);
  if (!parsed) {
    window.alert("Please provide four margin values separated by spaces.");
  }
  return parsed;
};

const createMarginsDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const getValueLabel = () => {
    const current = getMarginValues();
    const match = Object.entries(MARGIN_PRESETS).find(([, preset]) => isMarginEqual(current, preset.margins));
    return match ? match[1].label : "Custom";
  };
  const button = createStackedDropdownButton({
    icon: "margin",
    label: "Margins",
    menu,
    getValueLabel,
    size: "big"
  });
  const applyMargins = (margins: MarginValues) => {
    dispatchCommand(editorHandle, "SetPageMargins", { margins });
    (button as any).syncValue?.();
  };
  Object.entries(MARGIN_PRESETS).forEach(([key, preset]) => {
    const item = MenuItem({
      label: preset.label,
      onSelect: () => {
        applyMargins(preset.margins);
        button.dataset.value = key;
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  menu.element.appendChild(MenuSeparator());
  const customItem = MenuItem({
    label: "Custom...",
    onSelect: () => {
      const current = getMarginValues();
      const custom = promptCustomMargins(current);
      if (!custom) {
        return;
      }
      applyMargins(custom);
      button.dataset.value = "custom";
      menu.close();
    }
  });
  menu.element.appendChild(customItem);
  subscribeToLayoutChanges(() => (button as any).syncValue?.());
  (button as any).syncValue?.();
  return button;
};

const promptForNumber = (message: string, fallback: string): number | null => {
  const raw = window.prompt(message, fallback);
  if (!raw) {
    return null;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    window.alert("Please enter a valid number.");
    return null;
  }
  return value;
};

const createSizeDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createStackedDropdownButton({
    icon: "pageSize",
    label: "Size",
    menu,
    getValueLabel: () => getCurrentPageSize().label,
    size: "big"
  });
  getPageSizeDefinitions().forEach((definition) => {
    const item = MenuItem({
      label: definition.label,
      onSelect: () => {
        dispatchCommand(editorHandle, "SetPageSize", { id: definition.id });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  menu.element.appendChild(MenuSeparator());
  const customItem = MenuItem({
    label: "Custom...",
    onSelect: () => {
      const current = getCurrentPageSize();
      const width = promptForNumber("Custom width (mm)", `${current.widthMm}`);
      if (width === null) {
        return;
      }
      const height = promptForNumber("Custom height (mm)", `${current.heightMm}`);
      if (height === null) {
        return;
      }
      dispatchCommand(editorHandle, "SetPageSize", { overrides: { widthMm: width, heightMm: height } });
      menu.close();
    }
  });
  menu.element.appendChild(customItem);
  subscribeToLayoutChanges(() => (button as any).syncValue?.());
  (button as any).syncValue?.();
  return button;
};

const createOrientationDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createStackedDropdownButton({
    icon: "orientation",
    label: "Orientation",
    menu,
    getValueLabel: () => (getOrientation() === "portrait" ? "Portrait" : "Landscape"),
    size: "big"
  });
  (["portrait", "landscape"] as const).forEach((option) => {
    const item = MenuItem({
      label: option === "portrait" ? "Portrait" : "Landscape",
      onSelect: () => {
        dispatchCommand(editorHandle, "SetPageOrientation", { orientation: option });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  subscribeToLayoutChanges(() => (button as any).syncValue?.());
  (button as any).syncValue?.();
  return button;
};

const createColumnsDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createStackedDropdownButton({
    icon: "columns",
    label: "Columns",
    menu,
    getValueLabel: () => `${getLayoutColumns()} col`,
    size: "big"
  });
  [1, 2, 3].forEach((count) => {
    const item = MenuItem({
      label: `${count} column${count > 1 ? "s" : ""}`,
      onSelect: () => {
        dispatchCommand(editorHandle, "SetSectionColumns", { count });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  menu.element.appendChild(MenuSeparator());
  const moreItem = MenuItem({
    label: "More...",
    onSelect: () => {
      const raw = window.prompt("Number of columns (1-4)", button.dataset.value ?? "1");
      if (!raw) {
        return;
      }
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) {
        window.alert("Please enter a valid number.");
        return;
      }
      dispatchCommand(editorHandle, "SetSectionColumns", { count: parsed });
      menu.close();
    }
  });
  menu.element.appendChild(moreItem);
  subscribeToLayoutChanges(() => (button as any).syncValue?.());
  (button as any).syncValue?.();
  return button;
};

const BREAK_ITEMS: Array<{ label: string; command: EditorCommandId }> = [
  { label: "Page break", command: "InsertPageBreak" },
  { label: "Column break", command: "InsertColumnBreak" },
  { label: "Section break (next page)", command: "InsertSectionBreakNextPage" }
];

const LINE_NUMBER_ITEMS: Array<{ label: string; mode: string }> = [
  { label: "None", mode: "none" },
  { label: "Continuous", mode: "continuous" },
  { label: "Restart each page", mode: "page" },
  { label: "Restart each section", mode: "section" },
  { label: "Suppress current paragraph", mode: "suppress" }
];

const HYPHENATION_ITEMS: Array<{ label: string; mode: string }> = [
  { label: "None", mode: "none" },
  { label: "Automatic", mode: "auto" },
  { label: "Manual", mode: "manual" }
];

const createBreaksDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createStackedDropdownButton({
    icon: "breaks",
    label: "Breaks",
    menu,
    getValueLabel: () => "Insert",
    size: "small"
  });
  BREAK_ITEMS.forEach((entry) => {
    const item = MenuItem({
      label: entry.label,
      onSelect: () => {
        dispatchCommand(editorHandle, entry.command);
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createLineNumbersDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createStackedDropdownButton({
    icon: "lineSpacing",
    label: "Line numbers",
    menu,
    getValueLabel: () => "Select",
    size: "small"
  });
  LINE_NUMBER_ITEMS.forEach((entry) => {
    const item = MenuItem({
      label: entry.label,
      onSelect: () => {
        dispatchCommand(editorHandle, "SetLineNumbering", { mode: entry.mode });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createHyphenationDropdown = (editorHandle: EditorHandle): HTMLButtonElement => {
  const menu = new Menu([]);
  const button = createStackedDropdownButton({
    icon: "spacingAfter",
    label: "Hyphenation",
    menu,
    getValueLabel: () => "Select",
    size: "small"
  });
  HYPHENATION_ITEMS.forEach((entry) => {
    const item = MenuItem({
      label: entry.label,
      onSelect: () => {
        dispatchCommand(editorHandle, "SetHyphenation", { mode: entry.mode });
        menu.close();
      }
    });
    menu.element.appendChild(item);
  });
  return button;
};

const createPageSetupGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const wrapper = document.createElement("div");
  wrapper.className = "ribbon-page-setup";

  const bigRow = document.createElement("div");
  bigRow.className = "ribbon-page-setup__big-row";
  bigRow.append(
    createMarginsDropdown(editorHandle),
    createOrientationDropdown(editorHandle),
    createSizeDropdown(editorHandle),
    createColumnsDropdown(editorHandle)
  );

  const smallRow = document.createElement("div");
  smallRow.className = "ribbon-page-setup__small-row";
  smallRow.append(
    createBreaksDropdown(editorHandle),
    createLineNumbersDropdown(editorHandle),
    createHyphenationDropdown(editorHandle)
  );

  wrapper.append(bigRow, smallRow);
  return createRibbonGroup("Page setup", [wrapper]);
};

const createParagraphLayoutGroup = (editorHandle: EditorHandle): HTMLDivElement => {
  const wrapper = document.createElement("div");
  wrapper.className = "ribbon-paragraph-group";

  const indentBlock = document.createElement("div");
  indentBlock.className = "ribbon-paragraph-block indent-block";
  const indentLabel = document.createElement("div");
  indentLabel.className = "ribbon-paragraph-label";
  indentLabel.textContent = "Indent";
  const indentControls = document.createElement("div");
  indentControls.className = "ribbon-indent-grid";
  indentControls.append(createIndentSpinner(editorHandle, "left"), createIndentSpinner(editorHandle, "right"));
  indentBlock.append(indentLabel, indentControls);

  const spacingBlock = document.createElement("div");
  spacingBlock.className = "ribbon-paragraph-block spacing-block";
  const spacingLabel = document.createElement("div");
  spacingLabel.className = "ribbon-paragraph-label";
  spacingLabel.textContent = "Space";
  const spacingControls = document.createElement("div");
  spacingControls.className = "ribbon-spacing-grid";
  spacingControls.append(
    createSpacingDropdown(editorHandle, "SpaceBefore", "spacingBefore", "Before"),
    createSpacingDropdown(editorHandle, "SpaceAfter", "spacingAfter", "After")
  );
  spacingBlock.append(spacingLabel, spacingControls);

  wrapper.append(indentBlock, spacingBlock);
  return createRibbonGroup("Paragraph", [wrapper]);
};

const createLayoutPanel = (editorHandle: EditorHandle): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel";
  const grid = createRibbonGrid([createPageSetupGroup(editorHandle), createParagraphLayoutGroup(editorHandle)]);
  panel.appendChild(grid);
  return panel;
};


const RIBBON_BUNDLE_ID = "ribbon-src-2026-01-20";

export const renderRibbon = (host: HTMLElement, editorHandle: EditorHandle): void => {
  const selectionTargets: RibbonSelectionTargets = {
    toggles: [],
    alignmentButtons: {}
  };
  const registerToggle = (commandId: EditorCommandId, element: HTMLButtonElement) => {
    selectionTargets.toggles.push({ commandId, element });
  };
  const registerAlignment = (variant: AlignmentVariant, element: HTMLButtonElement) => {
    selectionTargets.alignmentButtons[variant] = element;
  };
  const hooks: RibbonHooks = {
    registerToggle,
    registerAlignment
  };
  const model = loadRibbonModel();
  // Debug: silenced noisy ribbon logs.
  const stateBus = new RibbonStateBus(editorHandle);

  renderRibbonLayout(host, editorHandle, hooks, stateBus, model);
  watchRibbonSelectionState(stateBus, selectionTargets);
  watchRibbonSelectionStateLegacy(editorHandle as any, selectionTargets);
  const handleFindShortcut = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "f") {
      event.preventDefault();
      dispatchCommand(editorHandle, "SearchReplace");
    }
  };
  document.addEventListener("keydown", handleFindShortcut);
};
