export type TabId =
  | "retrieve"
  | "screen"
  | "code"
  | "visualiser"
  | "analyse"
  | "write"
  | "export"
  | "settings"
  | "tools";

export interface TabDefinition {
  id: TabId;
  label: string;
  tooltip?: string;
  render: (actionsMount: HTMLElement) => void;
}

export interface TabRibbonOptions {
  header: HTMLElement;
  actions: HTMLElement;
  tabs: TabDefinition[];
  initialTab?: TabId;
  onTabChange?: (tabId: TabId) => void;
}

export class TabRibbon {
  private header: HTMLElement;
  private actions: HTMLElement;
  private tabs: TabDefinition[];
  private buttons: HTMLElement[] = [];
  private activeTab?: TabId;
  private onTabChange?: (tabId: TabId) => void;
  private tabChangeListeners: Array<(tabId: TabId) => void> = [];

  constructor(options: TabRibbonOptions) {
    this.header = options.header;
    this.header.setAttribute("role", "tablist");
    this.actions = options.actions;
    this.actions.dataset.activeTab = options.initialTab || options.tabs[0].id;
    this.tabs = options.tabs;
    this.onTabChange = options.onTabChange;
    this.renderTabs();
    this.activateTab(options.initialTab || this.tabs[0].id);
  }

  private renderTabs(): void {
    this.header.innerHTML = "";
    this.buttons = [];
    this.tabs.forEach((tab) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tab-button";
      const label = tab.label || tab.id;
      btn.textContent = label;
      if (tab.label) {
        btn.dataset.tabLabel = tab.label;
      } else {
        btn.removeAttribute("data-tab-label");
      }
      if (tab.tooltip) {
        btn.title = tab.tooltip;
      }
      btn.dataset.tabId = tab.id;
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => this.activateTab(tab.id, true));
      this.buttons.push(btn);
      this.header.appendChild(btn);
    });
  }

  private activateTab(tabId: TabId, force = false): void {
    const isSameTab = this.activeTab === tabId;
    if (isSameTab && !force) return;
    this.activeTab = tabId;
    this.actions.dataset.activeTab = tabId;
    this.actions.innerHTML = "";
    const definition = this.tabs.find((tab) => tab.id === tabId);
    if (definition) {
      definition.render(this.actions);
    }
    this.buttons.forEach((btn) => {
      const id = btn.dataset.tabId as TabId;
      btn.classList.toggle("active", id === tabId);
      btn.setAttribute("aria-selected", String(id === tabId));
    });
    if ((!isSameTab || force) && this.onTabChange) {
      this.onTabChange(tabId);
    }
    if (!isSameTab) {
      this.tabChangeListeners.forEach((listener) => listener(tabId));
    }
  }

  selectTab(tabId: TabId): void {
    this.activateTab(tabId);
  }

  registerTabChangeListener(listener: (tabId: TabId) => void): void {
    this.tabChangeListeners.push(listener);
  }
}
