type RibbonMenuContext = "ribbon.root" | "ribbon.group" | "ribbon.control";

export type RibbonMenuActionId = "ribbon.customize" | "ribbon.group.hide" | "layout.reset";

type RibbonContextMenuOptions = {
  ribbonEl: HTMLElement;
  actionsRoot: HTMLElement;
  enabled: boolean;
  onAction?: (action: RibbonMenuActionId, target?: HTMLElement | null) => void;
};

type MenuItem =
  | { type: "command"; id: RibbonMenuActionId; label: string }
  | { type: "separator" };

export function initRibbonContextMenu(options: RibbonContextMenuOptions): () => void {
  if (!options.enabled) return () => {};
  const menu = document.createElement("div");
  menu.className = "ribbon-context-menu";
  document.body.appendChild(menu);

  const listeners: Array<() => void> = [];
  const hideMenu = (): void => menu.classList.remove("visible");

  const handleDocumentClick = (event: MouseEvent): void => {
    if (menu.contains(event.target as Node)) return;
    hideMenu();
  };
  const handleEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape") hideMenu();
  };
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", handleEscape);
  listeners.push(() => {
    document.removeEventListener("click", handleDocumentClick);
    document.removeEventListener("keydown", handleEscape);
  });

  const showMenu = (x: number, y: number, context: RibbonMenuContext, target: HTMLElement | null): void => {
    const items = buildMenuItems(context);
    if (!items.length) {
      hideMenu();
      return;
    }
    menu.innerHTML = "";
    items.forEach((item) => {
      if (item.type === "separator") {
        const divider = document.createElement("div");
        divider.className = "ribbon-context-menu__divider";
        menu.appendChild(divider);
        return;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ribbon-context-menu__item";
      btn.textContent = item.label;
      btn.dataset.action = item.id;
      btn.addEventListener("click", () => {
        options.onAction?.(item.id, target);
        hideMenu();
      });
      menu.appendChild(btn);
    });
    menu.classList.add("visible");
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8);
      const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    });
  };

  const handleRibbonContext = (event: MouseEvent): void => {
    event.preventDefault();
    showMenu(event.clientX, event.clientY, "ribbon.root", event.target as HTMLElement | null);
  };
  options.ribbonEl.addEventListener("contextmenu", handleRibbonContext);
  listeners.push(() => options.ribbonEl.removeEventListener("contextmenu", handleRibbonContext));

  const handleActionsContext = (event: MouseEvent): void => {
    event.preventDefault();
    const target = event.target as HTMLElement | null;
    const control = target?.closest<HTMLElement>(".ribbon-button");
    if (control) {
      showMenu(event.clientX, event.clientY, "ribbon.control", control);
      return;
    }
    const group = target?.closest<HTMLElement>(".ribbon-group");
    if (group) {
      showMenu(event.clientX, event.clientY, "ribbon.group", group);
      return;
    }
    showMenu(event.clientX, event.clientY, "ribbon.root", target);
  };
  options.actionsRoot.addEventListener("contextmenu", handleActionsContext);
  listeners.push(() => options.actionsRoot.removeEventListener("contextmenu", handleActionsContext));

  return () => {
    listeners.forEach((fn) => fn());
    if (menu.parentElement) {
      menu.parentElement.removeChild(menu);
    }
  };
}

function buildMenuItems(context: RibbonMenuContext): MenuItem[] {
  switch (context) {
    case "ribbon.root":
      return [
        { type: "command", id: "ribbon.customize", label: "Customize ribbon…" },
        { type: "separator" },
        { type: "command", id: "layout.reset", label: "Reset layout" }
      ];
    case "ribbon.group":
      return [
        { type: "command", id: "ribbon.group.hide", label: "Hide group" },
        { type: "separator" },
        { type: "command", id: "ribbon.customize", label: "Customize ribbon…" }
      ];
    case "ribbon.control":
      return [{ type: "command", id: "ribbon.customize", label: "Customize ribbon…" }];
    default:
      return [];
  }
}
