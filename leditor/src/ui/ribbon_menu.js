"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GalleryGrid = exports.ColorPalette = exports.MenuSubmenu = exports.MenuSeparator = exports.MenuItem = exports.Menu = void 0;
const submenuRegistry = new WeakMap();
class Menu {
    element;
    isOpen = false;
    onCloseHandlers = [];
    anchor = null;
    constructor(items) {
        this.element = document.createElement("div");
        this.element.className = "leditor-menu";
        this.element.setAttribute("role", "menu");
        this.element.tabIndex = -1;
        items.forEach((item) => this.element.appendChild(item));
    }
    open(anchor) {
        if (this.isOpen)
            return;
        this.isOpen = true;
        this.anchor = anchor ?? null;
        if (!this.element.isConnected) {
            document.body.appendChild(this.element);
        }
        this.element.style.display = "block";
        this.position(anchor ?? null);
        this.element.addEventListener("keydown", this.handleKeydown);
        document.addEventListener("click", this.handleDocumentClick, true);
        document.addEventListener("keydown", this.handleDocumentKeydown);
        this.focusFirstItem();
    }
    close() {
        if (!this.isOpen)
            return;
        this.isOpen = false;
        this.anchor = null;
        this.element.style.display = "none";
        this.element.removeEventListener("keydown", this.handleKeydown);
        document.removeEventListener("click", this.handleDocumentClick, true);
        document.removeEventListener("keydown", this.handleDocumentKeydown);
        this.onCloseHandlers.forEach((handler) => handler());
    }
    onClose(handler) {
        this.onCloseHandlers.push(handler);
    }
    position(anchor) {
        if (!anchor)
            return;
        const rect = anchor.getBoundingClientRect();
        this.element.style.position = "absolute";
        this.element.style.left = `${Math.round(rect.left)}px`;
        this.element.style.top = `${Math.round(rect.bottom + 4)}px`;
    }
    focusFirstItem() {
        const items = this.getMenuItems();
        if (items.length === 0)
            return;
        items[0].focus();
    }
    getMenuItems() {
        return Array.from(this.element.querySelectorAll("[data-menu-item]"));
    }
    handleDocumentClick = (event) => {
        const target = event.target;
        if (!target || !this.element.contains(target)) {
            this.close();
        }
    };
    handleDocumentKeydown = (event) => {
        if (event.key === "Escape" && this.isOpen) {
            event.preventDefault();
            this.close();
            this.anchor?.focus();
        }
    };
    handleKeydown = (event) => {
        const items = this.getMenuItems();
        if (items.length === 0)
            return;
        const currentIndex = items.indexOf(document.activeElement);
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
            const target = document.activeElement;
            const submenu = target ? submenuRegistry.get(target) : null;
            if (submenu && target) {
                event.preventDefault();
                submenu.open(target);
            }
        }
    };
}
exports.Menu = Menu;
const MenuItem = (options) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "leditor-menu-item";
    button.setAttribute("role", "menuitem");
    button.dataset.menuItem = "true";
    button.textContent = options.label;
    if (options.shortcut) {
        button.setAttribute("data-shortcut", options.shortcut);
    }
    if (options.disabled) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
    }
    button.addEventListener("click", () => {
        if (options.disabled)
            return;
        options.onSelect?.();
    });
    return button;
};
exports.MenuItem = MenuItem;
const MenuSeparator = () => {
    const separator = document.createElement("div");
    separator.className = "leditor-menu-separator";
    separator.setAttribute("role", "separator");
    return separator;
};
exports.MenuSeparator = MenuSeparator;
const MenuSubmenu = (label, submenu) => {
    const button = (0, exports.MenuItem)({ label });
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
exports.MenuSubmenu = MenuSubmenu;
const ColorPalette = (colors, onPick) => {
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
exports.ColorPalette = ColorPalette;
const GalleryGrid = (items) => {
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
exports.GalleryGrid = GalleryGrid;
