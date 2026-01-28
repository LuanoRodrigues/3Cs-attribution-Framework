import {
  RibbonRoot,
  type RibbonTabDefinition,
  type RibbonRootOptions,
  type RibbonCollapseManifest
} from "../ui/ribbon_primitives.ts";

export type RibbonPlaceholderTab = {
  id: string;
  label: string;
  placeholder?: string;
  source?: string;
};

type RibbonDefaults = {
  initialTabId?: string;
  collapseStages?: string[];
  contextualTabsEnabled?: boolean;
};

type RibbonPlaceholderOptions = {
  tabs: RibbonPlaceholderTab[];
  panelContent?: { [key: string]: HTMLElement };
  defaults?: RibbonDefaults;
  collapseManifest?: RibbonCollapseManifest;
};

const createPlaceholderPanel = (text: string, source?: string): HTMLElement => {
  const panel = document.createElement("div");
  panel.className = "leditor-ribbon-panel leditor-ribbon-placeholder";
  panel.textContent = text;
  if (source) {
    panel.dataset.ribbonSource = source;
  }
  return panel;
};

export const renderRibbonPlaceholder = (
  host: HTMLElement,
  options: RibbonPlaceholderOptions
): void => {
  const tabIds = (options.tabs ?? []).map((t) => t.id);
  // Debug: silenced noisy ribbon logs.
  const tabs = options.tabs ?? [];
  if (tabs.length === 0) {
    return;
  }

  const defaults = options.defaults;
  if (defaults?.collapseStages) {
    host.dataset.ribbonCollapseStages = defaults.collapseStages.join(",");
  }
  if (defaults?.initialTabId) {
    host.dataset.ribbonInitialTabId = defaults.initialTabId;
  }
  host.dataset.ribbonContextualTabsEnabled = String(Boolean(defaults?.contextualTabsEnabled));

  const definitions: RibbonTabDefinition[] = tabs.map((tab) => {
    const panelContent = options.panelContent?.[tab.id];
    const placeholderText = tab.placeholder ?? `${tab.label} tools coming soon.`;
    const panel =
      panelContent ?? createPlaceholderPanel(placeholderText, tab.source);
    if (!panelContent) {
      // Debug: silenced noisy ribbon logs.
    }
    if (tab.source) {
      panel.dataset.ribbonSource = tab.source;
    }
    return { id: tab.id, label: tab.label, panel };
  });

  const rootOptions: RibbonRootOptions = {
    activeTabId: defaults?.initialTabId,
    collapseStages: defaults?.collapseStages,
    contextualTabsEnabled: defaults?.contextualTabsEnabled,
    collapseManifest: options.collapseManifest
  };
  new RibbonRoot(host, definitions, rootOptions);
};
