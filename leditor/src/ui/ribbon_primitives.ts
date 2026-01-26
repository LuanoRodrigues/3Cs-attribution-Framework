export type RibbonTabDefinition = {
  id: string;
  label: string;
  panel: HTMLElement;
};

export type RibbonCollapseManifest = Record<string, Record<string, string>>;

export interface RibbonRootOptions {
  activeTabId?: string;
  collapseStages?: string[];
  contextualTabsEnabled?: boolean;
  collapseManifest?: RibbonCollapseManifest;
}

const TAB_ID_PREFIX = "ribbon-tab-";
const PANEL_ID_PREFIX = "ribbon-panel-";

const ACTIVE_TAB_STORAGE_KEY = "leditor.ribbon.activeTab";
let lastActiveTabId: string | null = null;

const readStoredTabId = (): string | null => {
  try {
    return window.localStorage?.getItem(ACTIVE_TAB_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
};

const writeStoredTabId = (tabId: string): void => {
  try {
    window.localStorage?.setItem(ACTIVE_TAB_STORAGE_KEY, tabId);
  } catch {
    // Ignore storage failures (e.g. disabled storage).
  }
};

const focusEditor = (): void => {
  const editorHandle = window.leditor;
  if (editorHandle?.focus) {
    editorHandle.focus();
    return;
  }
  const view = document.querySelector(".ProseMirror") as HTMLElement | null;
  view?.focus();
};

export class RibbonControl<T extends HTMLElement = HTMLElement> {
  readonly element: T;

  constructor(element: T) {
    this.element = element;
    this.element.classList.add("leditor-ribbon-control");
    this.element.dataset.ribbonControl = "true";
  }
}

export class RibbonGroup {
  readonly element: HTMLDivElement;

  constructor(label: string | undefined, controls: HTMLElement[]) {
    this.element = document.createElement("div");
    this.element.className = "leditor-ribbon-group";
    this.element.classList.add("ribbonGroup");
    if (label) {
      const labelEl = document.createElement("div");
      labelEl.className = "leditor-ribbon-group-label";
      labelEl.classList.add("ribbonGroup__label");
      labelEl.textContent = label;
      this.element.appendChild(labelEl);
    }
    const body = document.createElement("div");
    body.className = "leditor-ribbon-group-body";
    body.classList.add("ribbonGroup__body");
    body.setAttribute("role", "toolbar");
    body.setAttribute("aria-label", label ? `${label} controls` : "Ribbon group controls");
    const getFocusableControls = (): HTMLElement[] =>
      Array.from(body.querySelectorAll<HTMLElement>("button:not(:disabled)"));
    body.addEventListener("keydown", (event) => {
      const items = getFocusableControls();
      if (items.length === 0) return;
      const activeElement = document.activeElement as HTMLElement | null;
      const currentIndex = items.indexOf(activeElement ?? items[0]);
      let target: HTMLElement | null = null;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        target = items[(currentIndex + 1) % items.length];
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        const nextIndex = currentIndex - 1;
        target = items[nextIndex < 0 ? items.length - 1 : nextIndex];
      } else if (event.key === "Home") {
        target = items[0];
      } else if (event.key === "End") {
        target = items[items.length - 1];
      } else if (event.key === "Escape") {
        event.preventDefault();
        focusEditor();
        return;
      }
      if (target) {
        event.preventDefault();
        target.focus();
      }
    });
    controls.forEach((control) => body.appendChild(control));
    this.element.appendChild(body);
  }
}

export class RibbonTabPanel {
  readonly element: HTMLElement;

  constructor(id: string, content: HTMLElement) {
    this.element = content;
    this.element.classList.add("leditor-ribbon-panel");
    this.element.classList.add("ribbonPanel");
    this.element.id = this.element.id || `${PANEL_ID_PREFIX}${id}`;
    this.element.setAttribute("role", "tabpanel");
    this.element.setAttribute("aria-labelledby", `${TAB_ID_PREFIX}${id}`);
    this.element.hidden = true;
  }
}

export class RibbonTabStrip {
  readonly element: HTMLDivElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private tabOrder: string[] = [];
  private activeTabId: string | null = null;

  constructor(private onActivate: (tabId: string) => void) {
    this.element = document.createElement("div");
    this.element.className = "leditor-ribbon-tabs";
    this.element.classList.add("ribbonTabs");
    this.element.setAttribute("role", "tablist");
    this.element.setAttribute("aria-orientation", "horizontal");
    this.element.setAttribute("aria-label", "Ribbon tabs");
    this.element.addEventListener("keydown", this.handleKeydown);
  }

  addTab(tabId: string, label: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "leditor-ribbon-tab";
    button.id = `${TAB_ID_PREFIX}${tabId}`;
    button.dataset.tabId = tabId;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    button.textContent = label;
    button.addEventListener("click", () => this.onActivate(tabId));
    this.element.appendChild(button);
    this.buttons.set(tabId, button);
    this.tabOrder.push(tabId);
    return button;
  }

  setActiveTab(tabId: string): void {
    this.activeTabId = tabId;
    this.buttons.forEach((button, id) => {
      const isActive = id === tabId;
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
      if (isActive) {
        button.focus();
      }
    });
  }

  private focusTab(tabId: string): void {
    const button = this.buttons.get(tabId);
    if (!button) return;
    button.focus();
  }

  private handleKeydown = (event: KeyboardEvent): void => {
    if (!this.activeTabId) return;
    const currentIndex = this.tabOrder.indexOf(this.activeTabId);
    if (currentIndex === -1) return;
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % this.tabOrder.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + this.tabOrder.length) % this.tabOrder.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = this.tabOrder.length - 1;
    }
    if (nextIndex !== null) {
      event.preventDefault();
      this.focusTab(this.tabOrder[nextIndex]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      const target = event.target as HTMLElement | null;
      const tabId = target?.dataset?.tabId;
      if (tabId && this.buttons.has(tabId)) {
        event.preventDefault();
        this.onActivate(tabId);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      focusEditor();
    }
  };
}

const BREAKPOINT_VAR_PREFIX = "--r-stage-width-";
const DEFAULT_BREAKPOINTS: Record<string, number> = {
  a: 1360,
  b: 1120
};

const stageClassFor = (stage: string): string => `leditor-ribbon-stage-${stage.toLowerCase()}`;

export class RibbonCollapseManager {
  private readonly thresholds: Array<{ stage: string; minWidth: number }>;
  private readonly lastStage: string | null;
  private currentStage: string | null = null;
  private readonly resizeHandler = () => this.updateStage();

  constructor(
    private host: HTMLElement,
    private stages: string[],
    private manifest?: RibbonCollapseManifest
  ) {
    this.thresholds = this.buildThresholds();
    this.lastStage = this.stages[this.stages.length - 1] ?? null;
    const manifestCount = Object.keys(this.manifest ?? {}).length;
    if (manifestCount) {
      this.host.dataset.ribbonCollapseManifest = String(manifestCount);
    }
    this.updateStage();
    window.addEventListener("resize", this.resizeHandler);
  }

  dispose(): void {
    window.removeEventListener("resize", this.resizeHandler);
  }

  private buildThresholds(): Array<{ stage: string; minWidth: number }> {
    const thresholds: Array<{ stage: string; minWidth: number }> = [];
    for (let index = 0; index < this.stages.length - 1; index++) {
      const stage = this.stages[index];
      const fallback = DEFAULT_BREAKPOINTS[stage.toLowerCase()] ?? (index === 0 ? 1360 : 1120);
      thresholds.push({ stage, minWidth: this.readBreakpoint(stage, fallback) });
    }
    return thresholds;
  }

  private readBreakpoint(stage: string, fallback: number): number {
    const varName = `${BREAKPOINT_VAR_PREFIX}${stage.toLowerCase()}`;
    const raw =
      typeof document !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue(varName)
        : "";
    const trimmed = raw.trim();
    const parsed = trimmed ? Number.parseInt(trimmed, 10) : NaN;
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private removeStageClasses(): void {
    const toRemove = Array.from(this.host.classList).filter((clazz) => clazz.startsWith("leditor-ribbon-stage-"));
    toRemove.forEach((clazz) => this.host.classList.remove(clazz));
  }

  private determineStage(width: number): string {
    for (const threshold of this.thresholds) {
      if (width >= threshold.minWidth) {
        return threshold.stage;
      }
    }
    return this.lastStage ?? this.stages[0];
  }

  private updateStage(): void {
    const rect = this.host.getBoundingClientRect();
    const width = rect.width || this.host.offsetWidth;
    const nextStage = this.determineStage(width);
    if (this.currentStage === nextStage) {
      return;
    }
    this.currentStage = nextStage;
    this.host.dataset.ribbonCollapseStage = nextStage;
    this.host.dataset.ribbonTabScroll = this.lastStage && nextStage === this.lastStage ? "enabled" : "disabled";
    this.removeStageClasses();
    this.host.classList.add(stageClassFor(nextStage));
    this.host.dispatchEvent(
      new CustomEvent("ribbon-collapse-stage-change", {
        detail: { stage: nextStage }
      })
    );
    if (typeof window !== "undefined") {
      window.codexLog?.write(`[RIBBON_COLLAPSE_STAGE] ${nextStage}`);
    }
  }
}

export class RibbonRoot {
  private shell: HTMLDivElement;
  private panelsContainer: HTMLDivElement;
  private tabPanels = new Map<string, RibbonTabPanel>();
  private tabStrip: RibbonTabStrip;
  private collapseToggle: HTMLButtonElement;
  private collapsed = false;
  private activeTabId: string | null = null;
  private collapseStages: string[];
  private contextualTabsEnabled: boolean;
  private collapseManager?: RibbonCollapseManager;

  constructor(host: HTMLElement, tabs: RibbonTabDefinition[], options?: RibbonRootOptions) {
    host.classList.add("leditor-ribbon", "leditor-word-ribbon");
    host.innerHTML = "";
    this.shell = document.createElement("div");
    this.shell.className = "leditor-ribbon-shell";
    this.collapseToggle = this.createCollapseToggle(host);
    this.tabStrip = new RibbonTabStrip((tabId) => this.activateTab(tabId));
    this.panelsContainer = document.createElement("div");
    this.panelsContainer.className = "leditor-ribbon-panels";
    this.collapseStages = options?.collapseStages ?? ["A", "B", "C"];
    this.contextualTabsEnabled = Boolean(options?.contextualTabsEnabled);
    if (this.collapseStages.length) {
      host.dataset.ribbonCollapseStages = this.collapseStages.join(",");
    }
    this.collapseManager = new RibbonCollapseManager(host, this.collapseStages, options?.collapseManifest);
    host.dataset.ribbonContextualTabsEnabled = String(this.contextualTabsEnabled);
    host.dispatchEvent(
      new CustomEvent("ribbon-collapse-info", {
        detail: {
          collapseStages: this.collapseStages,
          contextualTabsEnabled: this.contextualTabsEnabled
        }
      })
    );
    window.codexLog?.write(
      `[RIBBON_COLLAPSE_INFO] collapseStages=${this.collapseStages.join(
        ","
      )} contextualTabs=${this.contextualTabsEnabled}`
    );

    tabs.forEach((tab) => {
      const panel = new RibbonTabPanel(tab.id, tab.panel);
      this.tabPanels.set(tab.id, panel);
      this.panelsContainer.appendChild(panel.element);
      const button = this.tabStrip.addTab(tab.id, tab.label);
      button.setAttribute("aria-controls", panel.element.id);
    });

    // Keep structure flat: shell -> tabs (+ toggle) -> panels
    this.tabStrip.element.appendChild(this.collapseToggle);
    this.shell.append(this.tabStrip.element, this.panelsContainer);
    host.appendChild(this.shell);

    const defaultTab = this.resolveActiveTab(tabs, options?.activeTabId);
    if (defaultTab) {
      this.activateTab(defaultTab);
    }
  }

  private createCollapseToggle(host: HTMLElement): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ribbon-collapse-toggle";
    button.setAttribute("aria-pressed", "false");
    button.title = "Hide ribbon";
    button.textContent = "Hide ribbon";
    button.addEventListener("click", () => {
      this.setCollapsed(!this.collapsed, host);
    });
    return button;
  }

  private setCollapsed(value: boolean, host: HTMLElement): void {
    this.collapsed = value;
    host.dataset.ribbonCollapsed = String(value);
    this.collapseToggle.setAttribute("aria-pressed", String(value));
    this.collapseToggle.title = value ? "Show ribbon" : "Hide ribbon";
    this.collapseToggle.textContent = value ? "Show ribbon" : "Hide ribbon";
  }

  private resolveActiveTab(tabs: RibbonTabDefinition[], preferred?: string): string | null {
    const candidate = preferred ?? lastActiveTabId ?? readStoredTabId();
    if (candidate && tabs.some((tab) => tab.id === candidate)) {
      return candidate;
    }
    return tabs.length ? tabs[0].id : null;
  }

  private activateTab(tabId: string): void {
    if (!this.tabPanels.has(tabId)) {
      return;
    }
    if (this.activeTabId === tabId) {
      return;
    }
    if (this.activeTabId) {
      const previousPanel = this.tabPanels.get(this.activeTabId);
      if (previousPanel) {
        previousPanel.element.hidden = true;
      }
    }
    const nextPanel = this.tabPanels.get(tabId)!;
    nextPanel.element.hidden = false;
    this.activeTabId = tabId;
    this.tabStrip.setActiveTab(tabId);
    lastActiveTabId = tabId;
    writeStoredTabId(tabId);
    window.codexLog?.write(`[RIBBON_TAB_ACTIVE] ${tabId}`);
  }
}



