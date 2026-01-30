import {
  ribbonRegistry,
  homeTab,
  insertTab,
  layoutTab,
  reviewTab,
  referencesTab,
  aiTab,
  viewTab
} from "./ribbon_model.ts";
import { commandMap } from "../api/command_map.ts";
import { getReferencesCommandIds } from "./references_command_contract.ts";

export type ControlType =
  | "button"
  | "toggleButton"
  | "splitButton"
  | "splitToggleButton"
  | "colorSplitButton"
  | "dropdown"
  | "combobox"
  | "spinner-dropdown"
  | "spinnerDropdown"
  | "gallery"
  | "dialogLauncher"
  | "colorPicker"
  | "menuItem"
  | "menuToggle"
  | "separator"
  | "custom"
  | "dynamic"
  | "sectionHeader"
  | "colorPalette";

export interface ControlCommand {
  id: string;
  args?: Record<string, unknown>;
  payloadSchema?: Record<string, unknown>;
}

export interface ControlConfig {
  controlId?: string;
  label?: string;
  type: ControlType;
  size?: "small" | "medium" | "large";
  iconKey?: string;
  command?: ControlCommand;
  menu?: ControlConfig[];
  controls?: ControlConfig[];
  items?: ControlConfig[];
  widget?: string;
  source?: string;
  state?: { binding: string; kind?: string };
  collapse?: Record<string, string>;
  enabledWhen?: string;
  presets?: number[];
  palette?: { kind?: string; rows?: string[][] };
  priority?: number;
  gallery?: { controls?: ControlConfig[] };
  [key: string]: unknown;
}

export interface ClusterConfig {
  clusterId: string;
  layout?: string;
  controls: readonly ControlConfig[];
  [key: string]: unknown;
}

export interface GroupConfig {
  groupId: string;
  label?: string;
  priority?: number;
  dialogLauncher?: ControlConfig | null;
  clusters: readonly ClusterConfig[];
  [key: string]: unknown;
}

export interface TabConfig {
  tabId: string;
  label: string;
  layout?: Record<string, unknown>;
  groups: readonly GroupConfig[];
  [key: string]: unknown;
}

export interface RibbonTabDescriptor {
  tabId: string;
  label: string;
  source: string;
  priority?: number;
}

export interface RibbonRegistryDefaults {
  collapseStages?: readonly string[];
  initialTabId?: string;
  contextualTabsEnabled?: boolean;
  [key: string]: unknown;
}

export interface RibbonRegistry {
  ribbonId: string;
  version: number;
  label: string;
  defaults?: RibbonRegistryDefaults;
  iconLibrary?: Record<string, unknown>;
  stateContract?: Record<string, string>;
  tabs?: readonly RibbonTabDescriptor[];
  removedTabs?: readonly unknown[];
  notes?: readonly string[];
  [key: string]: unknown;
}

export interface RibbonModel {
  registry: RibbonRegistry;
  tabsById: Map<string, TabConfig>;
  orderedTabs: TabConfig[];
}

type TabSourceMap = Record<string, TabConfig>;

const ICON_TYPES = new Set<ControlType>([
  "button",
  "toggleButton",
  "splitButton",
  "splitToggleButton",
  "colorSplitButton",
  "dropdown",
  "dialogLauncher",
  "menuItem",
  "menuToggle",
  "colorPicker"
]);

const resolveIconKeyForControl = (control: ControlConfig, parentIconKey?: string): string | undefined => {
  if (control.iconKey) return control.iconKey;
  if (parentIconKey && (control.type === "menuItem" || control.type === "menuToggle")) {
    return parentIconKey;
  }
  const id = control.controlId ?? "";
  if (!id) return undefined;
  const pick = (name: string) => `icon.${name}`;
  if (id.startsWith("toc.")) return pick("toc");
  if (id.startsWith("cite.")) return pick("citation");
  if (id.startsWith("footnotes.")) return pick("footnote");
  if (id.startsWith("research.")) return pick("smartLookup");
  if (id.startsWith("index.auto")) return pick("autoMark");
  if (id.startsWith("index.mark")) return pick("markEntry");
  if (id.startsWith("index.insert")) return pick("insertIndex");
  if (id.startsWith("index.preview")) return pick("preview");
  if (id.startsWith("toa.")) return pick("tableOfAuthorities");
  if (id.startsWith("view.source")) return pick("preview");
  if (id.startsWith("view.zoom")) return pick("zoom");
  if (id.startsWith("view.pagination")) return pick("pages");
  if (id.startsWith("view.printPreview")) return pick("printLayout");
  if (id.startsWith("view.ruler")) return pick("ruler");
  if (id.startsWith("view.pageBoundaries")) return pick("page");
  if (id.startsWith("view.pageBreakMarks")) return pick("pageBreak");
  if (id.startsWith("view.formattingMarks")) return pick("visualChars");
  if (id.startsWith("proofing.")) return pick("spellCheck");
  if (id.startsWith("accessibility.")) return pick("accessibility");
  if (id.startsWith("language.")) return pick("language");
  if (id.startsWith("comments.")) return pick("commentAdd");
  if (id.startsWith("tracking.")) return pick("trackChanges");
  if (id.startsWith("changes.accept")) return pick("acceptChange");
  if (id.startsWith("changes.reject")) return pick("rejectChange");
  if (id.startsWith("changes.next")) return pick("nextChange");
  if (id.startsWith("changes.previous")) return pick("previousChange");
  if (id.startsWith("protect.")) return pick("protect");
  if (id.startsWith("pages.coverPage")) return pick("coverPage");
  if (id.startsWith("pages.pageBreak")) return pick("pageBreak");
  if (id.startsWith("pages.blankPage")) return pick("blankPage");
  if (id.startsWith("pages.sectionBreak")) return pick("sectionBreak");
  if (id.startsWith("tables.insertTable")) return pick("table");
  if (id.startsWith("tables.quickTables")) return pick("quickTables");
  if (id.startsWith("tables.drawTable")) return pick("drawTable");
  if (id.startsWith("illustrations.pictures")) return pick("pictures");
  if (id.startsWith("illustrations.shapes")) return pick("shapes");
  if (id.startsWith("illustrations.icons")) return pick("icons");
  if (id.startsWith("illustrations.smartArt")) return pick("smartArt");
  if (id.startsWith("illustrations.chart")) return pick("chart");
  if (id.startsWith("illustrations.screenshot")) return pick("screenshot");
  if (id.startsWith("links.link")) return pick("link");
  if (id.startsWith("links.bookmark")) return pick("bookmark");
  if (id.startsWith("links.crossReference")) return pick("crossReference");
  if (id.startsWith("symbols.equation")) return pick("equation");
  if (id.startsWith("symbols.symbol")) return pick("symbol");
  if (id.startsWith("symbols.emoji")) return pick("emoji");
  return undefined;
};

const ensureIconKeys = (tab: TabConfig): void => {
  const visit = (control: ControlConfig, parentIconKey?: string) => {
    if (ICON_TYPES.has(control.type)) {
      const resolved = resolveIconKeyForControl(control, parentIconKey);
      if (resolved) {
        control.iconKey = resolved;
      }
    }
    const nextParent = control.iconKey ?? parentIconKey;
    collectNestedControls(control).forEach((nested) => visit(nested, nextParent));
  };
  tab.groups.forEach((group) => {
    group.clusters.forEach((cluster) => {
      cluster.controls.forEach((control) => visit(control));
    });
  });
};

const TAB_SOURCES: TabSourceMap = {
  home: homeTab as unknown as TabConfig,
  insert: insertTab as unknown as TabConfig,
  layout: layoutTab as unknown as TabConfig,
  review: reviewTab as unknown as TabConfig,
  references: referencesTab as unknown as TabConfig,
  ai: aiTab as unknown as TabConfig,
  view: viewTab as unknown as TabConfig
};

let cachedRegistry: RibbonRegistry | null = null;
let cachedModel: RibbonModel | null = null;

const assertNonEmptyString: (value: unknown, message: string) => asserts value is string = (
  value,
  message
) => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
};

const ensureUniqueId = (set: Set<string>, id: string, context: string, label: string): void => {
  if (set.has(id)) {
    throw new Error(`Duplicate ${label} "${id}" encountered while loading ${context}`);
  }
  set.add(id);
};

export const collectNestedControls = (control: ControlConfig): ControlConfig[] => {
  const nested: ControlConfig[] = [];
  if (Array.isArray(control.controls)) nested.push(...control.controls);
  if (Array.isArray(control.menu)) nested.push(...control.menu);
  if (Array.isArray(control.items)) nested.push(...control.items);
  if (control.gallery && Array.isArray(control.gallery.controls)) {
    nested.push(...control.gallery.controls);
  }
  return nested;
};

const validateReferencesCommands = (tab: TabConfig): void => {
  const ids = getReferencesCommandIds(tab);
  const missing = Array.from(ids).filter((id) => !(id in commandMap));
  if (missing.length > 0) {
    console.warn(
      "[Ribbon] references tab includes commands without implementation (will be added later):",
      missing
    );
  }
};

const traverseControls = (
  control: ControlConfig,
  context: string,
  controlIds: Set<string>
): void => {
  const descriptor = `${context}/${control.controlId ?? control.type}`;
  if (!control.type) {
    throw new Error(`Control at ${descriptor} is missing a type`);
  }
  if (control.controlId) {
    assertNonEmptyString(control.controlId, `Control at ${descriptor} has an invalid controlId`);
    ensureUniqueId(controlIds, control.controlId, descriptor, "controlId");
  }
  collectNestedControls(control).forEach((nested) => traverseControls(nested, descriptor, controlIds));
};

const validateIconOnlyControls = (tab: TabConfig): void => {
  const visit = (control: ControlConfig, path: string) => {
    const collapse = control.collapse as any;
    const isIconOnly =
      collapse === "iconOnly" ||
      collapse?.B === "iconOnly" ||
      collapse?.B?.mode === "iconOnly" ||
      collapse?.A === "iconOnly" ||
      collapse?.A?.mode === "iconOnly";
    if (isIconOnly && !control.iconKey) {
      throw new Error(`Icon-only control missing iconKey at ${path}`);
    }
    collectNestedControls(control).forEach((nested, index) => {
      visit(nested, `${path}/${nested.controlId ?? nested.type ?? index}`);
    });
  };
  tab.groups.forEach((group) => {
    group.clusters.forEach((cluster) => {
      cluster.controls.forEach((control, index) => {
        visit(control, `${tab.tabId}/${group.groupId}/${cluster.clusterId}/${control.controlId ?? index}`);
      });
    });
  });
};

export const loadRibbonRegistry = (): RibbonRegistry => {
  if (cachedRegistry) {
    return cachedRegistry;
  }
  if (!ribbonRegistry || typeof ribbonRegistry !== "object") {
    throw new Error("Ribbon registry JSON is invalid or missing");
  }
  const typed = ribbonRegistry as RibbonRegistry;
  assertNonEmptyString(typed.ribbonId, "Ribbon registry is missing ribbonId");
  cachedRegistry = typed;
  return cachedRegistry;
};

export const loadTabConfig = (source: string): TabConfig => {
  const config = TAB_SOURCES[source];
  if (!config) {
    throw new Error(`Ribbon tab source not registered: ${source}`);
  }
  if (!Array.isArray(config.groups) || config.groups.length === 0) {
    throw new Error(`Tab ${config.tabId ?? source} must expose a non-empty groups array`);
  }
  ensureIconKeys(config);
  validateIconOnlyControls(config);
  return config;
};

export const loadRibbonModel = (): RibbonModel => {
  if (cachedModel) {
    return cachedModel;
  }
  const registry = loadRibbonRegistry();
  const descriptors = registry.tabs ?? [];
  const referencesDescriptor = descriptors.find((descriptor) => descriptor.tabId === "references");
  if (!referencesDescriptor) {
    throw new Error("Ribbon registry is missing the references tab descriptor");
  }
  if (referencesDescriptor.source !== "references") {
    throw new Error(
      `References tab descriptor must point to references; found "${referencesDescriptor.source}"`
    );
  }
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new Error("Ribbon registry must declare at least one tab");
  }
  const seenTabIds = new Set<string>();
  const seenGroupIds = new Set<string>();
  const seenClusterIds = new Set<string>();
  const seenControlIds = new Set<string>();
  const orderedTabs: TabConfig[] = [];
  const tabsById = new Map<string, TabConfig>();

  const sorted = descriptors
    .map((descriptor, index) => ({ descriptor, index }))
    .sort((a, b) => {
      const priorityA = typeof a.descriptor.priority === "number" ? a.descriptor.priority : 0;
      const priorityB = typeof b.descriptor.priority === "number" ? b.descriptor.priority : 0;
      const delta = priorityB - priorityA;
      return delta !== 0 ? delta : a.index - b.index;
    })
    .map((entry) => entry.descriptor);

  for (const descriptor of sorted) {
    assertNonEmptyString(descriptor.tabId, "Ribbon tab descriptor is missing tabId");
    assertNonEmptyString(descriptor.source, `Tab descriptor for ${descriptor.tabId} is missing source`);
    if (seenTabIds.has(descriptor.tabId)) {
      throw new Error(`Duplicate tabId in ribbon registry: ${descriptor.tabId}`);
    }
    seenTabIds.add(descriptor.tabId);
    const config = loadTabConfig(descriptor.source);
    if (config.tabId !== descriptor.tabId) {
      throw new Error(`Tab id mismatch for ${descriptor.source}: expected ${descriptor.tabId}, got ${config.tabId}`);
    }
    assertNonEmptyString(config.label, `Tab ${config.tabId} needs a label`);
    const contextBase = `tab(${config.tabId})`;
    config.groups.forEach((group) => {
      assertNonEmptyString(group.groupId, `${contextBase} group is missing groupId`);
      ensureUniqueId(seenGroupIds, group.groupId, contextBase, "groupId");
      if (!Array.isArray(group.clusters) || group.clusters.length === 0) {
        throw new Error(`Group ${group.groupId} must declare at least one cluster`);
      }
      group.clusters.forEach((cluster) => {
        assertNonEmptyString(cluster.clusterId, `${contextBase}/${group.groupId} cluster missing clusterId`);
        ensureUniqueId(seenClusterIds, cluster.clusterId, `${contextBase}/${group.groupId}`, "clusterId");
        if (!Array.isArray(cluster.controls) || cluster.controls.length === 0) {
          throw new Error(`Cluster ${cluster.clusterId} must declare controls`);
        }
        cluster.controls.forEach((control: ControlConfig) =>
          traverseControls(control, `${contextBase}/${group.groupId}/${cluster.clusterId}`, seenControlIds)
        );
      });
      if (group.dialogLauncher) {
        traverseControls(group.dialogLauncher, `${contextBase}/${group.groupId}/dialogLauncher`, seenControlIds);
      }
    });
    orderedTabs.push(config);
    tabsById.set(config.tabId, config);
  }

  const initialTabId = registry.defaults?.initialTabId;
  if (initialTabId && !tabsById.has(initialTabId)) {
    throw new Error(`Ribbon defaults reference unknown initialTabId: ${initialTabId}`);
  }

  const referencesTab = tabsById.get("references");
  if (!referencesTab) {
    throw new Error("References tab configuration failed to load");
  }
  validateReferencesCommands(referencesTab);

  cachedModel = { registry, tabsById, orderedTabs };
  return cachedModel;
};
