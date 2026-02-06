import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";

type MenuItemOptions = {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  shortcut?: string;
  description?: string;
  icon?: HTMLElement;
};

let menuPortal: HTMLElement | null = null;

export const setMenuPortal = (portal: HTMLElement | null): void => {
  menuPortal = portal;
};

const submenuRegistry = new WeakMap<HTMLElement, Menu>();

export class Menu {
  readonly element: HTMLDivElement;
  private isOpen = false;
  private onCloseHandlers: Array<() => void> = [];
  private anchor: HTMLElement | null = null;
  private cleanupAutoUpdate: (() => void) | null = null;

  constructor(items: HTMLElement[]) {
    this.element = document.createElement("div");
    this.element.className = "leditor-menu";
    this.element.setAttribute("role", "menu");
    this.element.tabIndex = -1;
    items.forEach((item) => this.element.appendChild(item));
  }

  open(anchor?: HTMLElement): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.anchor = anchor ?? null;
    if (!this.element.isConnected) {
      const container = menuPortal ?? document.body;
      container.appendChild(this.element);
    }
    this.element.style.display = "block";
    this.position(anchor ?? null);
    if (anchor) {
      this.cleanupAutoUpdate?.();
      this.cleanupAutoUpdate = autoUpdate(
        anchor,
        this.element,
        () => this.position(anchor ?? null)
      );
    }
    this.element.addEventListener("keydown", this.handleKeydown);
    document.addEventListener("click", this.handleDocumentClick, true);
    document.addEventListener("keydown", this.handleDocumentKeydown);
    this.focusFirstItem();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.anchor = null;
    this.element.style.display = "none";
    this.element.removeEventListener("keydown", this.handleKeydown);
    document.removeEventListener("click", this.handleDocumentClick, true);
    document.removeEventListener("keydown", this.handleDocumentKeydown);
    this.cleanupAutoUpdate?.();
    this.cleanupAutoUpdate = null;
    this.onCloseHandlers.forEach((handler) => handler());
  }

  onClose(handler: () => void): void {
    this.onCloseHandlers.push(handler);
  }

  private position(anchor: HTMLElement | null): void {
    if (!anchor) return;
    computePosition(anchor, this.element, {
      placement: "bottom-start",
      strategy: "fixed",
      middleware: [offset(6), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      this.element.style.position = "fixed";
      this.element.style.left = `${Math.round(x)}px`;
      this.element.style.top = `${Math.round(y)}px`;
      this.element.style.zIndex = "2100";
    });
  }

  private focusFirstItem(): void {
    const items = this.getMenuItems();
    if (items.length === 0) return;
    items[0].focus();
  }

  private getMenuItems(): HTMLElement[] {
    return Array.from(this.element.querySelectorAll<HTMLElement>("[data-menu-item]"));
  }

  private handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (!target || !this.element.contains(target)) {
      this.close();
    }
  };

  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.isOpen) {
      event.preventDefault();
      this.close();
      this.anchor?.focus();
    }
  };

  private handleKeydown = (event: KeyboardEvent): void => {
    const items = this.getMenuItems();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % items.length : 0;
      items[nextIndex].focus();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex = currentIndex >= 0 ? (currentIndex - 1 + items.length) % items.length : items.length - 1;
      items[nextIndex].focus();
      return;
    }
    if (event.key === "ArrowRight") {
      const target = document.activeElement as HTMLElement | null;
      const submenu = target ? submenuRegistry.get(target) : null;
      if (submenu && target) {
        event.preventDefault();
        submenu.open(target);
      }
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const target = document.activeElement as HTMLElement | null;
      if (target) {
        event.preventDefault();
        target.click();
      }
      return;
    }
  };
}

export const MenuItem = (options: MenuItemOptions): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "leditor-menu-item";
  button.setAttribute("role", "menuitem");
  button.dataset.menuItem = "true";
  button.textContent = "";
  const row = document.createElement("div");
  row.className = "leditor-menu-item__row";
  const leading = document.createElement("span");
  leading.className = "leditor-menu-item__leading";
  if (options.icon) {
    options.icon.classList.add("leditor-menu-item__icon");
    leading.appendChild(options.icon);
  }
  const title = document.createElement("span");
  title.className = "leditor-menu-item-title";
  title.textContent = options.label;
  leading.appendChild(title);
  row.appendChild(leading);
  if (options.shortcut) {
    const meta = document.createElement("span");
    meta.className = "leditor-menu-item__meta";
    const shortcut = document.createElement("span");
    shortcut.className = "leditor-menu-item__shortcut";
    shortcut.textContent = options.shortcut;
    meta.appendChild(shortcut);
    row.appendChild(meta);
  }
  button.appendChild(row);
  if (options.description) {
    const detail = document.createElement("span");
    detail.className = "leditor-menu-item-description";
    detail.textContent = options.description;
    button.appendChild(detail);
  }
  if (options.shortcut) {
    button.setAttribute("data-shortcut", options.shortcut);
  }
  if (options.disabled) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
  }
  button.addEventListener("click", () => {
    if (options.disabled) return;
    options.onSelect?.();
  });
  return button;
};

export const MenuSeparator = (): HTMLDivElement => {
  const separator = document.createElement("div");
  separator.className = "leditor-menu-separator";
  separator.setAttribute("role", "separator");
  return separator;
};

export const MenuSubmenu = (label: string, submenu: Menu): HTMLButtonElement => {
  const button = MenuItem({ label });
  button.classList.add("leditor-menu-submenu");
  button.setAttribute("aria-haspopup", "menu");
  button.dataset.submenu = "true";
  submenuRegistry.set(button, submenu);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    submenu.open(button);
  });
  button.addEventListener("mouseenter", () => submenu.open(button));
  submenu.onClose(() => button.classList.remove("is-open"));
  return button;
};

export const ColorPalette = (
  colors: string[],
  onPick?: (color: string) => void
): HTMLDivElement => {
  const palette = document.createElement("div");
  palette.className = "leditor-menu-palette";
  colors.forEach((color) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "leditor-menu-swatch";
    swatch.style.background = color;
    swatch.setAttribute("aria-label", color);
    swatch.dataset.menuItem = "true";
    swatch.addEventListener("click", () => onPick?.(color));
    palette.appendChild(swatch);
  });
  return palette;
};

export const GalleryGrid = (
  items: Array<{ id: string; label: string; onSelect?: () => void }>
): HTMLDivElement => {
  const grid = document.createElement("div");
  grid.className = "leditor-menu-gallery";
  items.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "leditor-menu-gallery-item";
    button.textContent = item.label;
    button.dataset.menuItem = "true";
    button.addEventListener("click", () => item.onSelect?.());
    grid.appendChild(button);
  });
  return grid;
};
