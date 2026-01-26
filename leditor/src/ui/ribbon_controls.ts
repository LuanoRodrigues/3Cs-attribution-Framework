import type { EditorCommandId } from "../legacy/api/editor_commands.js";
import { createRibbonIcon, type RibbonIconName } from "../legacy/ui/ribbon_icons.js";
import { RibbonControl } from "../legacy/ui/ribbon_primitives.js";
import { Menu } from "../legacy/ui/ribbon_menu.js";

export type RibbonButtonSize = "small" | "medium" | "large";

type IconOrElement = RibbonIconName | HTMLElement;

export type RibbonButtonOptions = {
  icon?: IconOrElement;
  label: string;
  size?: RibbonButtonSize;
  tooltip?: string;
  toggle?: boolean;
  pressed?: boolean | "mixed";
  disabled?: boolean;
  extraClasses?: string[];
  onClick?: () => void;
  commandId?: EditorCommandId;
};

const createIconElement = (icon?: IconOrElement): HTMLElement | null => {
  if (!icon) return null;
  if (typeof icon === "string") {
    const node = createRibbonIcon(icon);
    node.classList.add("ribbon-button-icon");
    return node;
  }
  const clone = icon.cloneNode(true) as HTMLElement;
  clone.classList.add("ribbon-button-icon");
  return clone;
};

export const createRibbonButton = (options: RibbonButtonOptions): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("leditor-ribbon-button");
  button.classList.add(`leditor-ribbon-button--${options.size ?? "medium"}`);
  options.extraClasses?.forEach((clazz) => button.classList.add(clazz));
  button.dataset.tooltip = options.tooltip ?? options.label;
  button.setAttribute("aria-label", options.label);
  const iconEl = createIconElement(options.icon);
  if (iconEl) {
    button.appendChild(iconEl);
  }
  if (options.toggle) {
    button.dataset.ribbonToggle = "true";
    setPressedState(button, options.pressed ?? false);
  }
  if (options.disabled) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.classList.add("is-disabled");
    button.dataset.disabled = "true";
  } else {
    button.dataset.disabled = "false";
  }
  button.addEventListener("click", () => {
    if (options.disabled) return;
    options.onClick?.();
  });
  new RibbonControl(button);
  if (options.commandId) {
    button.dataset.commandId = options.commandId;
  }
  return button;
};

export const setPressedState = (button: HTMLButtonElement, state: boolean | "mixed"): void => {
  button.setAttribute("aria-pressed", state === "mixed" ? "mixed" : String(Boolean(state)));
  button.classList.toggle("is-selected", state === true);
  button.dataset.state = state === "mixed" ? "mixed" : state ? "on" : "off";
  if (state === "mixed") {
    button.classList.add("is-mixed");
  } else {
    button.classList.remove("is-mixed");
  }
};

type RibbonDropdownOptions = {
  icon: IconOrElement;
  label: string;
  menu: Menu;
};

export const createRibbonDropdownButton = (options: RibbonDropdownOptions): HTMLButtonElement => {
  const button = createRibbonButton({
    icon: options.icon,
    label: options.label,
    size: "medium",
    extraClasses: ["ribbon-dropdown-button"],
    tooltip: options.label
  });
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.dataset.dropdown = "true";
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
    (isOpen ? closeMenu : openMenu)();
  });
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpen) {
        openMenu();
      }
    }
  });
  options.menu.onClose(() => {
    closeMenu();
  });
  return button;
};

export const createRibbonCombobox = (placeholder: string): HTMLDivElement => {
  const container = document.createElement("div");
  container.className = "leditor-ribbon-combobox";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  input.className = "leditor-ribbon-combobox-input";
  container.appendChild(input);
  return container;
};

export const createRibbonSpinner = (): HTMLDivElement => {
  const spinner = document.createElement("div");
  spinner.className = "leditor-ribbon-spinner";
  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.textContent = "−";
  decrease.className = "leditor-ribbon-spinner-step";
  const increase = document.createElement("button");
  increase.type = "button";
  increase.textContent = "+";
  increase.className = "leditor-ribbon-spinner-step";
  spinner.append(decrease, increase);
  return spinner;
};

type SegmentedItem = {
  label: string;
  icon?: IconOrElement;
  value: string;
};

type SegmentedControlOptions = {
  items: SegmentedItem[];
  onChange?: (value: string) => void;
};

export const createRibbonSegmentedControl = (options: SegmentedControlOptions): HTMLDivElement => {
  const container = document.createElement("div");
  container.className = "leditor-ribbon-segmented";
  options.items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "leditor-ribbon-segmented-btn";
    button.textContent = item.label;
    if (item.icon) {
      const iconEl = createIconElement(item.icon);
      if (iconEl) {
        button.prepend(iconEl);
      }
    }
    button.addEventListener("click", () => {
      container.querySelectorAll("button").forEach((btn) => btn.classList.remove("is-selected"));
      button.classList.add("is-selected");
      options.onChange?.(item.value);
    });
    container.appendChild(button);
  });
  return container;
};

export const createRibbonColorPicker = (label: string, colors: string[]): HTMLButtonElement => {
  const button = createRibbonButton({
    icon: colors.length ? undefined : undefined,
    label,
    size: "small",
    extraClasses: ["leditor-ribbon-color-picker"]
  });
  const palette = document.createElement("div");
  palette.className = "leditor-color-picker-palette";
  colors.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "leditor-color-picker-swatch";
    swatch.style.background = color;
    swatch.dataset.value = color;
    palette.appendChild(swatch);
  });
  button.appendChild(palette);
  return button;
};

export const createRibbonGallery = (): HTMLDivElement => {
  const gallery = document.createElement("div");
  gallery.className = "leditor-ribbon-gallery";
  return gallery;
};

export const createRibbonTooltip = (text: string): HTMLDivElement => {
  const tooltip = document.createElement("div");
  tooltip.className = "leditor-ribbon-tooltip";
  tooltip.textContent = text;
  return tooltip;
};
