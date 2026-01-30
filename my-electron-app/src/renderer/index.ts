import { ToolRegistry } from "../registry/toolRegistry";
import { PanelGrid } from "../layout/PanelGrid";
import { DEFAULT_PANEL_PARTS, type PanelId } from "../layout/panelRegistry";
import { TabRibbon, TabId } from "../layout/TabRibbon";
import type { LayoutSnapshot } from "../panels/PanelLayoutRoot";
import { PanelToolManager } from "../panels/PanelToolManager";
import { loadPanelLayouts, savePanelLayout } from "../state/layout";
import { createPdfTool } from "../tools/pdf";
import { createEditorTool } from "../tools/editor";
import { createNotesTool } from "../tools/notes";
import { createTimelineTool } from "../tools/timeline";
import { createVizTool } from "../tools/viz";
import { createRetrieveTool } from "../tools/retrieve";
import { createRetrieveDataHubTool } from "../tools/retrieveDataHub";
import { createCodeTool } from "../tools/code";
import { createVisualiserTool } from "../tools/visualiser";
import { createWriteTool } from "../tools/write";
import { createCoderTool } from "../tools/coder";
import { createScreenWidget } from "../tools/screen";
import { dispatchAnalyseCommand } from "../analyse/commandDispatcher";
import { AnalyseWorkspace } from "../analyse/workspace";
import { AnalyseStore } from "../analyse/store";
import type { AnalyseAction, AnalyseRun } from "../analyse/types";
import { discoverRuns, buildDatasetHandles, getDefaultBaseDir } from "../analyse/data";
import { command } from "../ribbon/commandDispatcher";
import type { RibbonAction, RibbonTab } from "../types";
import { GENERAL_KEYS } from "../config/settingsKeys";
import { PdfTestPayload, CoderTestNode } from "../test/testFixtures";
import { CoderPanel } from "../panels/coder/CoderPanel";
import { attachGlobalCoderDragSources } from "../panels/coder/coderDragSource";
import type { CoderNode } from "../panels/coder/coderTypes";
import { getDefaultCoderScope } from "../analyse/collectionScope";
import { initAnalyseAudioController } from "./analyseAudio";
import { initPerfOverlay } from "./perfOverlay";
import { readRetrieveQueryDefaults, writeRetrieveQueryDefaults } from "../state/retrieveQueryDefaults";
import type { RetrieveProviderId, RetrieveSort } from "../shared/types/retrieve";

interface PdfSelectionNotification {
  text: string;
  citation: string;
  page: number;
  dqid?: string;
}
import {
  AnalyseTab,
  CodeTab,
  ExportTab,
  RetrieveTab,
  ScreenTab as RibbonScreenTab,
  SettingsTab,
  ToolsTab,
  VisualiserTab,
  WriteTab
} from "../ribbon";
import { createPanelShellTool } from "../tools/panelShell";
import type { RibbonCommandResponse } from "../ribbon/commandDispatcher";
import { SessionManager } from "../session/sessionManager";
import type { SessionMenuAction } from "../session/sessionTypes";
import { initThemeManager } from "./theme/manager";
import { FEATURE_FLAG_KEYS, applyFeatureClass, readFeatureFlag } from "../config/featureFlags";
import { initRibbonContextMenu, type RibbonMenuActionId } from "./ribbonContextMenu";

const registry = new ToolRegistry();
registry.register(createPdfTool());
registry.register(createEditorTool());
registry.register(createNotesTool());
registry.register(createTimelineTool());
registry.register(createVizTool());
registry.register(createRetrieveTool());
registry.register(createRetrieveDataHubTool());
registry.register(createPanelShellTool());
registry.register(createCodeTool());
registry.register(createWriteTool());
registry.register(createVisualiserTool());
registry.register(createCoderTool());
registry.register(createScreenWidget());
void initThemeManager();
window.addEventListener("settings:updated", () => {
  if (pdfViewerIframe) {
    syncPdfViewerTheme(pdfViewerIframe);
  }
});

const ribbonHeader = document.getElementById("app-tab-header") as HTMLElement;
const ribbonActions = document.getElementById("app-tab-actions") as HTMLElement;
const panelGridContainer = document.getElementById("panel-grid-container") as HTMLElement;
const ribbonElement = document.getElementById("app-ribbon") as HTMLElement | null;
const PANEL_INDEX_BY_ID: Record<PanelId, number> = {
  panel1: 1,
  panel2: 2,
  panel3: 3,
  panel4: 4
};
const htmlElement = document.documentElement;
let teardownRibbonMenu: () => void = () => {};
let retrieveDataHubToolId: string | undefined;
let retrieveQueryToolId: string | undefined;
let lastRibbonHeight = -1;

function syncRibbonHeight(): void {
  if (!ribbonElement) return;
  // In ribbon-panels-v2, --ribbon-height is a fixed token set in CSS.
  // Avoid measuring/writing it to prevent layout feedback loops.
  if (document.documentElement.classList.contains("ribbon-panels-v2")) {
    return;
  }
  // Reading layout is expensive; do it at most once per frame (debounced below)
  // and only write the CSS var when it actually changes.
  const height = ribbonElement.offsetHeight;
  if (!height) return;
  if (height === lastRibbonHeight) return;
  lastRibbonHeight = height;
  document.documentElement.style.setProperty("--ribbon-height", `${height}px`);
}

const syncRibbonHeightDebounced = (() => {
  let raf = 0;
  return (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      syncRibbonHeight();
      raf = 0;
    });
  };
})();

applyFeatureClass(htmlElement, "ribbon-panels-v2", true);
applyFeatureClass(htmlElement, "panels-v2", true);

const featureSettings = typeof window !== "undefined" ? window.settingsBridge : undefined;

function handleRibbonContextAction(actionId: RibbonMenuActionId, target?: HTMLElement | null): void {
  console.info("[ribbon-context-action]", { actionId, target });
  if (actionId === "ribbon.group.hide" && target?.classList.contains("ribbon-group")) {
    target.dataset.ribbonHidden = "true";
    target.style.display = "none";
  }
  if (actionId === "layout.reset") {
    ribbonActions.querySelectorAll<HTMLElement>(".ribbon-group").forEach((group) => {
      if (group.dataset.ribbonHidden !== undefined) {
        group.dataset.ribbonHidden = "";
      }
      group.style.display = "";
    });
  }
}

void readFeatureFlag(FEATURE_FLAG_KEYS.ribbonV2, { settings: featureSettings }).then((enabled) => {
  applyFeatureClass(htmlElement, "ribbon-panels-v2", enabled);
  teardownRibbonMenu();
  if (!enabled) {
    ribbonActions.querySelectorAll<HTMLElement>(".ribbon-group").forEach((group) => {
      group.style.display = "";
      delete group.dataset.ribbonHidden;
    });
  }
  if (enabled && ribbonElement) {
    teardownRibbonMenu = initRibbonContextMenu({
      ribbonEl: ribbonElement,
      actionsRoot: ribbonActions,
      enabled: true,
      onAction: handleRibbonContextAction
    });
  } else {
    teardownRibbonMenu = () => {};
  }
  syncRibbonHeightDebounced();
});

void readFeatureFlag(FEATURE_FLAG_KEYS.panelsV2, { settings: featureSettings }).then((enabled) => {
  applyFeatureClass(htmlElement, "panels-v2", enabled);
  panelGrid.setPanelsV2Enabled(enabled);
});

let lastNonSettingsTab: TabId = "retrieve";
const panelGrid = new PanelGrid(panelGridContainer, { panelsV2Enabled: true });
function debugLogPanelState(index: number, marker: string): void {
  const enabled = (() => {
    try {
      return window.localStorage.getItem("debug.panels") === "true";
    } catch {
      return false;
    }
  })();
  if (!enabled) {
    return;
  }
  const shell = document.querySelector<HTMLElement>(`.panel-shell[data-panel-index="${index}"]`);
  if (!shell) {
    console.warn(`Panel ${index} shell missing for ${marker}`);
    return;
  }
  console.info(`[debug] ${marker} panel ${index}`, {
    collapsed: shell.dataset.collapsed,
    minimized: shell.dataset.minimized,
    display: shell.style.display,
    rect: shell.getBoundingClientRect()
  });
  shell.classList.add("panel-shell--debug-state");
  window.setTimeout(() => shell.classList.remove("panel-shell--debug-state"), 400);
}
let panelRoot: HTMLElement;
const TEST_PDF_VIEWER_URL = new URL("../resources/viewer.html", window.location.href).href;
const TEST_PDF_ASSET_URL = new URL(
  "../resources/pdfs/O'Connell - 2012 - Cyber security without cyber war.pdf",
  window.location.href
).href;
const TEST_PDF_PATH_OVERRIDES: Record<string, string> = {
  "C:\\Users\\luano\\Zotero\\storage\\5MYV4X6F\\Williamson - 2024 - Do Proxies Provide Plausible Deniability Evidence from Experiments on Three Surveys.pdf":
    TEST_PDF_ASSET_URL
};
let pdfViewerIframe: HTMLIFrameElement | null = null;
let lastPdfSelectionKey = "";
const PDF_SELECTION_AUTO_COPY_KEY = GENERAL_KEYS.pdfSelectionAutoCopy;
const SETTINGS_UPDATED_EVENT = "settings:updated";
const PDF_SELECTION_TOAST_ID = "pdf-selection-toast";
const PDF_SELECTION_TOAST_STYLE_ID = "pdf-selection-toast-style";

let pdfSelectionAutoCopy = true;
let pdfSelectionToastTimer: number | null = null;

const toolHost = document.createElement("div");
toolHost.id = "panel2-tool-host";
toolHost.className = "panel-tool-host";
toolHost.style.height = "100%";
toolHost.style.display = "flex";
toolHost.style.flexDirection = "column";

const analyseHost = document.createElement("div");
analyseHost.id = "panel2-analyse-host";
analyseHost.style.height = "100%";
analyseHost.style.display = "none";
analyseHost.className = "panel2-analyse";

function ensurePanel2Hosts(): void {
  const currentRoot = panelGrid.getPanelContent(2);
  if (!currentRoot) {
    throw new Error("Panel 2 host (#panel-root) missing");
  }
  panelRoot = currentRoot;
  if (panelRoot.contains(toolHost) && panelRoot.contains(analyseHost) && panelRoot.children.length >= 2) {
    return;
  }
  panelRoot.innerHTML = "";
  panelRoot.appendChild(toolHost);
  panelRoot.appendChild(analyseHost);
}

panelGrid.registerPanelRenderListener((panelId) => {
  if (panelId === "panel2") {
    ensurePanel2Hosts();
  }
});

ensurePanel2Hosts();

const originalApplyState = panelGrid.applyState.bind(panelGrid);
panelGrid.applyState = (state) => {
  originalApplyState(state);
  ensurePanel2Hosts();
};

const panelTools = new PanelToolManager({
  panelGrid,
  registry,
  panelIds: ["panel1", "panel2", "panel3", "panel4"],
  hosts: { panel2: toolHost },
  onPanelLayoutChange: (panelId, snapshot) => {
    savePanelLayout(panelId, snapshot);
  }
});
const layoutRoot = panelTools.getRoot("panel2");

attachGlobalCoderDragSources();

const scheduleIdle = (task: () => void, timeout = 120): void => {
  const anyWindow = window as any;
  if (typeof anyWindow.requestIdleCallback === "function") {
    anyWindow.requestIdleCallback(task, { timeout });
  } else {
    window.setTimeout(task, 0);
  }
};

const scheduleRaf = (task: () => void): void => {
  window.requestAnimationFrame(() => task());
};

function ensureWriteToolTab(): void {
  const existing = layoutRoot.serialize().tabs.find((t) => t.toolType === "write-leditor");
  if (!existing) {
    console.info("[WRITE][INIT] auto-spawn write-leditor in panel 2");
    panelTools.spawnTool("write-leditor", { panelId: "panel2" });
    panelGrid.ensurePanelVisible(2);
    debugLogPanelState(2, "after auto-spawn write");
  }
}

ensureWriteToolTab();
scheduleIdle(() => {
  initPerfOverlay();
});

const analyseStore = new AnalyseStore();
let analyseWorkspace: AnalyseWorkspace;
let unsubscribeAnalyseRibbon: (() => void) | null = null;
let analyseRibbonMount: HTMLElement | null = null;
let analyseAudioController: ReturnType<typeof initAnalyseAudioController> | null = null;

let lastRoundWideLayout = false;
const setRatiosForRound = (action: AnalyseAction) => {
  const isCorpus = action === "analyse/open_corpus";
  const isR1 = action === "analyse/open_sections_r1";
  const isR2 = action === "analyse/open_sections_r2";
  const isR3 = action === "analyse/open_sections_r3";

  // Keep the current layout while opening the PDF viewer (it temporarily takes over a panel).
  if (action === "analyse/open_pdf_viewer" && lastRoundWideLayout) {
    return;
  }

  if (isCorpus || isR1) {
    // Panel 1: filters (1/6)
    // Panel 2: cards (3/6) centered
    panelGrid.setRoundLayout(false);
    panelGrid.setLayoutHint(null);
    panelGrid.setCollapsed("panel1", false);
    panelGrid.setCollapsed("panel2", false);
    panelGrid.setCollapsed("panel3", true);
    panelGrid.setCollapsed("panel4", true);
    panelGrid.setRatios({ panel1: 1, panel2: 3, panel3: 0, panel4: 0 });
    panelGrid.setLayoutHint({ mode: "centeredSingle", panelId: "panel2", maxWidthPx: 1180 });
    lastRoundWideLayout = false;
    return;
  }

  if (isR2 || isR3) {
    // Round 2/3:
    // Panel 1: filters (1/6)
    // Panel 2: cards (1/6)
    // Panel 3: sections (2/6)
    // Panel 4: coder (2/6)
    panelGrid.setRoundLayout(false);
    panelGrid.setLayoutHint(null);
    panelGrid.setCollapsed("panel1", false);
    panelGrid.setCollapsed("panel2", false);
    panelGrid.setCollapsed("panel3", false);
    panelGrid.setCollapsed("panel4", false);
    panelGrid.setRatios({ panel1: 1, panel2: 1, panel3: 2, panel4: 2 });
    lastRoundWideLayout = true;
    return;
  }

  lastRoundWideLayout = false;
  panelGrid.setRoundLayout(false);
  panelGrid.setLayoutHint(null);
  panelGrid.setRatios({ ...DEFAULT_PANEL_PARTS });
};

const ensureAnalyseCoderPanel = (): void => {
  try {
    panelTools.ensureToolHost("panel4", { replaceContent: true });
    panelTools.spawnTool("coder-panel", { panelId: "panel4" });
  } catch (error) {
    console.warn("[analyse] unable to ensure coder panel", error);
  }
};

const emitAnalyseAction = (action: AnalyseAction, payload?: Record<string, unknown>) => {
  const targetPanel = action === "analyse/open_pdf_viewer" ? 4 : 2;
  panelGrid.ensurePanelVisible(targetPanel);
  setRatiosForRound(action);
  if (action === "analyse/open_sections_r2" || action === "analyse/open_sections_r3") {
    ensureAnalyseCoderPanel();
  }
  analyseAudioController?.handleAction(action, payload);
  analyseWorkspace?.route(action, payload);
  dispatchAnalyseCommand("analyse", action, payload).catch((err) => console.error(err));
};

analyseWorkspace = new AnalyseWorkspace(analyseHost, analyseStore, {
  dispatch: emitAnalyseAction
});

analyseHost.addEventListener("analyse-command", (event) => {
  const detail = (event as CustomEvent<{ action: AnalyseAction; payload?: Record<string, unknown> }>).detail;
  if (detail?.action) {
    emitAnalyseAction(detail.action, detail.payload as Record<string, unknown>);
  }
});

// Global error trap to surface sandbox failures with stack info
window.addEventListener("error", (ev) => {
  try {
    console.error("[renderer][uncaught]", {
      message: ev.message,
      filename: (ev as ErrorEvent).filename,
      lineno: (ev as ErrorEvent).lineno,
      colno: (ev as ErrorEvent).colno,
      stack: ev.error?.stack || String(ev.error),
      errorType: (ev as ErrorEvent).error?.constructor?.name
    });
  } catch {
    // ignore logging errors
  }
});

window.addEventListener("unhandledrejection", (ev) => {
  try {
    console.error("[renderer][unhandledrejection]", {
      reason: ev.reason,
      stack: (ev.reason as Error)?.stack
    });
  } catch {
    // ignore logging errors
  }
});

document.addEventListener("analyse-open-pdf", (event) => {
  const detail = (event as CustomEvent<any>).detail || {};
  const href: string = detail.href || "";
  console.info("[analyse][pdf-viewer][request]", detail);
  const payloadRaw = detail.payload || {};
  const pageFromPayload = payloadRaw.pdf_page ?? payloadRaw.page ?? detail.page;
  const parsePageNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return undefined;
      if (!Number.isNaN(Number(trimmed))) return Number(trimmed);
      const match = trimmed.match(/\d+/);
      if (match) return Number(match[0]);
    }
    return undefined;
  };
  let page: number | undefined = parsePageNumber(pageFromPayload);
  if (!page && href) {
    try {
      const url = new URL(href);
      const m = url.hash.match(/page=(\d+)/);
      if (m) page = parseInt(m[1], 10);
    } catch {
      // ignore malformed href
    }
  }

  const mergedMeta = { ...(payloadRaw || {}), ...(detail.meta || {}) };
  const resolvedPdfPath =
    payloadRaw.pdf_path || payloadRaw.pdf || mergedMeta.pdf_path || mergedMeta.pdf || payloadRaw.source || detail.pdfPath;
  const analysePayload = {
    id: detail.dqid || detail.sectionId || detail.href || "",
    title: detail.title,
    text: payloadRaw.paraphrase || payloadRaw.direct_quote || detail.text,
    html: payloadRaw.section_html || payloadRaw.section_text || detail.html,
    meta: mergedMeta,
    route: detail.route,
    runId: detail.runId,
    page,
    // Keep `source` but also include `pdf_path` so downstream renderers can reliably find it.
    source: resolvedPdfPath,
    pdf_path: resolvedPdfPath,
    raw: payloadRaw,
    preferredPanel: detail.preferredPanel
  };

  // Update workspace current payload so Panel 3 renders correctly
  document.dispatchEvent(
    new CustomEvent("analyse-payload-selected", {
      detail: analysePayload,
      bubbles: true
    })
  );

  emitAnalyseAction("analyse/open_pdf_viewer", {
    href,
    sectionId: detail.sectionId,
    route: detail.route,
    meta: mergedMeta,
    payload: analysePayload,
    page,
    preferredPanel: detail.preferredPanel
  });
});

document.addEventListener("analyse-render-pdf", (event) => {
  const detail = (event as CustomEvent<any>).detail || {};
  const pl = detail.payload || detail;
  const rawPayload = pl?.raw ?? pl;
  console.info("[analyse][raw-tab][payload]", rawPayload);
  const sourcePayload = rawPayload ?? pl;
  const pdfPathRaw: string | undefined =
    detail.pdfPath ||
    sourcePayload.pdf_path ||
    sourcePayload.pdf ||
    sourcePayload.source ||
    (sourcePayload.meta?.pdf_path as string | undefined) ||
    (sourcePayload.meta?.pdf as string | undefined) ||
    detail.source;
  const parsePageNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") return undefined;
      if (!Number.isNaN(Number(trimmed))) return Number(trimmed);
      const match = trimmed.match(/\d+/);
      if (match) return Number(match[0]);
    }
    return undefined;
  };
  const page: number | undefined =
    parsePageNumber(detail.page) ||
    parsePageNumber(rawPayload?.pdf_page) ||
    parsePageNumber(rawPayload?.page);
  if (!pdfPathRaw) {
    console.warn("[analyse][pdf-render] missing pdfPath");
    return;
  }

  const normalizePdfPath = (p: string): string => {
    const win = p.match(/^([A-Za-z]):[\\/](.*)$/);
    if (win) {
      const drive = win[1].toLowerCase();
      const rest = win[2].replace(/\\/g, "/");
      return `file:///mnt/${drive}/${rest}`;
    }
    if (p.startsWith("/")) {
      return p.startsWith("file://") ? p : `file://${p}`;
    }
    return p;
  };

  const pdfPath = normalizePdfPath(pdfPathRaw);

  const payload: PdfTestPayload = {
    item_key: sourcePayload.item_key || detail.item_key || detail.dqid || detail.sectionId || "",
    pdf_path: pdfPath,
    url: sourcePayload.url || detail.url || "",
    author_summary: sourcePayload.author_summary || detail.author_summary || "",
    first_author_last: sourcePayload.first_author_last || detail.first_author_last || "",
    year: sourcePayload.year || detail.year || "",
    title: sourcePayload.title || detail.title || "",
    source: sourcePayload.source || detail.source || "",
    page: page ?? 1,
    section_title: sourcePayload.section_title || detail.section_title || "",
    section_text: sourcePayload.section_text || detail.section_text || "",
    rq_question: sourcePayload.rq_question || detail.rq_question || "",
    overarching_theme: sourcePayload.overarching_theme || detail.overarching_theme || "",
    gold_theme: sourcePayload.gold_theme || detail.gold_theme || "",
    route: sourcePayload.route || detail.route || "",
    theme: sourcePayload.theme || detail.theme || "",
    potential_theme: sourcePayload.potential_theme || detail.potential_theme || "",
    evidence_type: sourcePayload.evidence_type || detail.evidence_type || "",
    evidence_type_norm: sourcePayload.evidence_type_norm || detail.evidence_type_norm || "",
    direct_quote: sourcePayload.direct_quote || detail.direct_quote || "",
    direct_quote_clean: sourcePayload.direct_quote_clean || detail.direct_quote_clean || "",
    paraphrase: sourcePayload.paraphrase || detail.paraphrase || "",
    researcher_comment: sourcePayload.researcher_comment || detail.researcher_comment || ""
  };

  const targetPanel = typeof detail.preferredPanel === "number" ? detail.preferredPanel : 4;
  panelGrid.ensurePanelVisible(targetPanel);
  const panel = panelGrid.getPanelContent(targetPanel);
  if (!panel) return;
  panel.innerHTML = "";
  panel.style.pointerEvents = "auto";
  panel.style.position = "relative";
  panel.style.display = "flex";
  panel.style.flexDirection = "column";
  panel.style.height = "100%";

  renderPdfTabs(panel, payload, rawPayload);
});

// Ensure Dashboard is the first page when Analyse opens
analyseWorkspace.openPageByAction("analyse/open_dashboard");

const ribbonTabs: Record<TabId, RibbonTab> = {
  retrieve: RetrieveTab,
  screen: RibbonScreenTab,
  code: CodeTab,
  visualiser: VisualiserTab,
  analyse: AnalyseTab,
  write: WriteTab,
  export: ExportTab,
  settings: SettingsTab,
  tools: ToolsTab
};

const tabOrder: TabId[] = [
  "retrieve",
  "screen",
  "code",
  "visualiser",
  "analyse",
  "write",
  "export",
  "settings",
  "tools"
];
const sectionToolIds: Partial<Record<TabId, string>> = {};

let activeTab: TabId = "retrieve";

const tabRibbon = new TabRibbon({
  header: ribbonHeader,
  actions: ribbonActions,
  tabs: tabOrder.map((id) => {
    const tab = ribbonTabs[id];
    if (!tab) {
      throw new Error(`Ribbon tab mapping missing for ${id}`);
    }
    return {
      id,
      label: tab.label,
      tooltip: tab.description,
      render: (mount: HTMLElement) => {
        if (id === "analyse") {
          renderAnalyseRibbon(mount);
          return;
        }
        renderRibbonTab(tab, mount);
      }
    };
  }),
  initialTab: "retrieve",
  onTabChange: (tabId) => {
    const t0 = performance.now();
    panelGridContainer.style.display = "";
    const showAnalyse = tabId === "analyse";
    toolHost.style.display = showAnalyse ? "none" : "flex";
    analyseHost.style.display = showAnalyse ? "flex" : "none";
    panelRoot.style.overflow = showAnalyse ? "auto" : "hidden";
    activeTab = tabId;
    if (tabId !== "tools") {
      panelGrid.ensurePanelVisible(2);
    }
    if (!showAnalyse && tabId !== "tools") {
      // Keep tools mounted per tab to avoid expensive teardown/recreate on tab switches.
      ensureSectionTool(tabId);
    }
    if (tabId === "settings") {
      openSettingsWindow();
    } else {
      lastNonSettingsTab = tabId;
    }
    syncRibbonHeightDebounced();
    // Measure perceived tab-switch cost to first paint.
    scheduleRaf(() => {
      scheduleRaf(() => {
        const ms = Math.round(performance.now() - t0);
        if (ms > 60) console.info("[perf][tab-switch]", { tabId, ms });
      });
    });
  }
});
tabRibbon.registerTabChangeListener(() => syncRibbonHeightDebounced());

ribbonHeader.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const button = target?.closest<HTMLElement>(".tab-button");
  if (!button) return;
  if (button.dataset.tabId === "retrieve") {
    panelGrid.ensurePanelVisible(2);
    ensureRetrieveDataHubTool();
  }
});
window.addEventListener("resize", syncRibbonHeightDebounced);
window.addEventListener("load", syncRibbonHeightDebounced);
syncRibbonHeightDebounced();

const overlayElement = document.getElementById("session-overlay");
if (!overlayElement) {
  throw new Error("Session overlay is missing from the renderer markup");
}

const sessionManager = new SessionManager({
  panelTools,
  panelGrid,
  tabRibbon,
  overlay: overlayElement
});

void sessionManager.initialize();

if (window.sessionBridge) {
  window.sessionBridge.onMenuAction((action: SessionMenuAction) => {
    void sessionManager.handleMenuAction(action);
  });
}

const savedLayouts = loadPanelLayouts() as Record<PanelId, LayoutSnapshot> | null;
if (savedLayouts) {
  const sanitizedLayouts: Record<PanelId, LayoutSnapshot> = Object.fromEntries(
    Object.entries(savedLayouts).map(([panelId, snapshot]) => [panelId, sanitizeLayoutSnapshot(snapshot as LayoutSnapshot)])
  ) as Record<PanelId, LayoutSnapshot>;
  panelTools.loadLayouts(sanitizedLayouts);
}
ensureWriteToolTab();
ensureRetrieveDataHubTool({ replace: true });

document.addEventListener("retrieve:ensure-panel2", () => {
  panelGrid.ensurePanelVisible(2);
  // Keep tool instance to avoid expensive remounting.
  ensureRetrieveDataHubTool();
});

document.addEventListener("ribbon:action", (event) => {
  const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
  if (!phase) return;
  const map: Partial<Record<string, TabId>> = {
    retrieve: "retrieve",
    screen: "screen",
    code: "code",
    visualiser: "visualiser",
    analyse: "analyse",
    write: "write",
    export: "export",
    settings: "settings",
    tools: "tools"
  };
  const tabId = map[phase] ?? activeTab;
  ensureSectionTool(tabId);
});

window.addEventListener("keydown", (ev) => {
  if (ev.ctrlKey && ev.key.toLowerCase() === "tab") {
    ev.preventDefault();
    layoutRoot.cycleFocus();
  }
});

window.addEventListener("beforeunload", () => {
  void sessionManager.flushPending();
  const layouts = panelTools.serializeLayouts();
  Object.entries(layouts).forEach(([panelId, snapshot]) => {
    savePanelLayout(panelId, snapshot);
  });
});

function renderAnalyseRibbon(mount: HTMLElement): void {
  analyseRibbonMount = mount;
  mount.innerHTML = "";
  mount.classList.add("ribbon-root");

  const formatRunLabel = (run: AnalyseRun): string => {
    const leaf = (run.path || run.label || run.id || "").split(/[/\\]/).pop() || run.label || run.id || "Run";
    return leaf;
  };

  // Build the Analyse ribbon once and only update the dynamic pieces (runs + selection).
  const dataGroup = document.createElement("div");
  dataGroup.className = "ribbon-group";
  const dataTitle = document.createElement("h3");
  dataTitle.textContent = "Data";
  dataGroup.appendChild(dataTitle);

  const dataBody = document.createElement("div");
  dataBody.style.display = "flex";
  dataBody.style.flexDirection = "column";
  dataBody.style.gap = "10px";

  const dashboardRow = document.createElement("div");
  dashboardRow.style.display = "flex";
  dashboardRow.style.alignItems = "center";
  dashboardRow.style.flexWrap = "wrap";
  dashboardRow.style.gap = "10px";

  const corpusBtn = document.createElement("button");
  corpusBtn.type = "button";
  corpusBtn.className = "ribbon-button ribbon-button--compact";
  corpusBtn.textContent = "Corpus";
  corpusBtn.addEventListener("click", () => {
    console.info("[analyse][ui][corpus-button]", analyseStore.getState());
    emitAnalyseAction("analyse/open_corpus");
  });
  dashboardRow.appendChild(corpusBtn);

  const dashLabel = document.createElement("span");
  dashLabel.textContent = "Dashboard";
  dashLabel.className = "status-bar";
  dashLabel.style.padding = "6px 10px";
  dashLabel.style.borderRadius = "10px";
  dashLabel.style.minWidth = "88px";
  dashboardRow.appendChild(dashLabel);

  const runSelect = document.createElement("select");
  runSelect.style.minWidth = "220px";
  runSelect.style.flex = "1";
  dashboardRow.appendChild(runSelect);

  const rescanBtn = document.createElement("button");
  rescanBtn.type = "button";
  rescanBtn.className = "ribbon-button ghost";
  rescanBtn.textContent = "Rescan";
  rescanBtn.addEventListener("click", () => {
    console.info("[analyse][ui][dashboard-rescan]");
    void refreshAnalyseRuns();
  });
  dashboardRow.appendChild(rescanBtn);

  dataBody.appendChild(dashboardRow);
  dataGroup.appendChild(dataBody);

  const roundsGroup = document.createElement("div");
  roundsGroup.className = "ribbon-group";
  const roundsTitle = document.createElement("h3");
  roundsTitle.textContent = "Rounds";
  roundsGroup.appendChild(roundsTitle);
  const roundsBody = document.createElement("div");
  roundsBody.style.display = "flex";
  roundsBody.style.flexDirection = "row";
  roundsBody.style.flexWrap = "wrap";
  roundsBody.style.alignItems = "center";
  roundsBody.style.gap = "8px 10px";
  (["r1", "r2", "r3"] as const).forEach((roundId, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ribbon-button";
    btn.textContent = `Round ${idx + 1}`;
    btn.addEventListener("click", () => {
      console.info("[analyse][ui][round-button]", { round: roundId, run: analyseStore.getState().activeRunPath });
      emitAnalyseAction(`analyse/open_sections_${roundId}` as AnalyseAction);
    });
    roundsBody.appendChild(btn);
  });
  roundsGroup.appendChild(roundsBody);

  const audioGroup = document.createElement("div");
  audioGroup.className = "ribbon-group";
  const audioTitle = document.createElement("h3");
  audioTitle.textContent = "Audio";
  audioGroup.appendChild(audioTitle);

  const audioWidget = document.createElement("div");
  audioWidget.className = "audio-widget";
  audioGroup.appendChild(audioWidget);

  mount.appendChild(dataGroup);
  mount.appendChild(roundsGroup);
  mount.appendChild(audioGroup);

  let scheduled = false;
  let lastKey = "";
  let lastRuns: AnalyseRun[] = [];

  const updateRuns = (runs: AnalyseRun[], activeRunId?: string) => {
    const key = `${activeRunId || ""}::${runs.length}::${runs.map((r) => r.id).join(",")}`;
    if (key === lastKey) return;
    lastKey = key;
    lastRuns = runs;
    runSelect.innerHTML = "";
    if (!runs.length) {
      const opt = document.createElement("option");
      opt.textContent = "No runs discovered";
      opt.disabled = true;
      opt.selected = true;
      runSelect.appendChild(opt);
      return;
    }
    runs.forEach((run) => {
      const opt = document.createElement("option");
      opt.value = run.id;
      opt.textContent = formatRunLabel(run);
      opt.selected = run.id === activeRunId;
      runSelect.appendChild(opt);
    });
  };

  runSelect.addEventListener("change", async () => {
    const next = lastRuns.find((r) => r.id === runSelect.value) || null;
    console.info("[analyse][ui][dashboard-select]", { runId: next?.id, runPath: next?.path });
    await setActiveAnalyseRun(next);
    emitAnalyseAction("analyse/open_dashboard");
    analyseWorkspace.openPageById(analyseStore.getState().activePageId);
  });

  const syncAudioWidget = () => {
    const active = (document.querySelector("[data-active-tab]") as HTMLElement | null) || ribbonActions;
    const actionsRect = active.getBoundingClientRect();
    const height = Math.max(0, Math.floor(actionsRect.height));
    audioWidget.style.height = `${height}px`;
    audioWidget.style.setProperty("--audio-control-height", `${Math.max(22, Math.floor(height / 4))}px`);
    audioWidget.style.width = "100%";
  };
  window.addEventListener("resize", () => scheduleRaf(syncAudioWidget));
  scheduleRaf(syncAudioWidget);

  // Defer expensive audio controller init so tab switches remain snappy.
  if (!analyseAudioController) {
    scheduleIdle(() => {
      analyseAudioController = initAnalyseAudioController({
        widget: audioWidget,
        getState: () => analyseStore.getState(),
        onCacheUpdate: (detail: { scope: string; cached: number; total: number; cachedKeys: string[] }) => {
          document.dispatchEvent(new CustomEvent("analyse-tts-cache-updated", { detail, bubbles: true }));
        }
      });
    }, 500);
  }

  const scheduleUpdate = () => {
    if (scheduled) return;
    scheduled = true;
    // Only update when Analyse tab is visible; avoid doing DOM work during other tab switches.
    scheduleIdle(() => {
      scheduled = false;
      if (activeTab !== "analyse") return;
      const state = analyseStore.getState();
      updateRuns(state.runs || [], state.activeRunId);
    }, 120);
  };

  if (!unsubscribeAnalyseRibbon) {
    unsubscribeAnalyseRibbon = analyseStore.subscribe((next) => {
      // Coalesce store updates to avoid repeated DOM rebuilds during async loads.
      scheduleUpdate();
    });
  }

  scheduleUpdate();
  if (!analyseStore.getState().runs?.length) {
    scheduleIdle(() => {
      void refreshAnalyseRuns();
    });
  }
}

async function setActiveAnalyseRun(run: AnalyseRun | null): Promise<void> {
  if (!run) {
    analyseStore.setActiveRun(null);
    return;
  }
  const datasets = await buildDatasetHandles(run.path);
  analyseStore.setActiveRun(run, datasets);
}

async function refreshAnalyseRuns(): Promise<void> {
  const current = analyseStore.getState();
  const base = await getDefaultBaseDir();
  const { runs, sectionsRoot } = await discoverRuns(base);
  analyseStore.update({ baseDir: base, runs, sectionsRoot: sectionsRoot || undefined });
  console.info("[analyse][renderer][runs]", { baseDir: base, sectionsRoot, runs: runs.map((r) => ({ id: r.id, path: r.path })) });
  if (!runs.length) {
    return;
  }
  const preferred = runs.find((r) => r.id === current.activeRunId) || runs[0];
  await setActiveAnalyseRun(preferred);
  analyseWorkspace.openPageById(analyseStore.getState().activePageId);
}

function hydratePdfSelectionAutoCopyPreference(): void {
  if (!window.settingsBridge) {
    return;
  }
  void window.settingsBridge
    .getValue(PDF_SELECTION_AUTO_COPY_KEY, pdfSelectionAutoCopy)
    .then((value) => {
      if (value !== undefined) {
        pdfSelectionAutoCopy = Boolean(value);
      }
    })
    .catch(() => {});
}

void hydratePdfSelectionAutoCopyPreference();

window.addEventListener(SETTINGS_UPDATED_EVENT, (event) => {
  const detail = (event as CustomEvent<{ key: string; value: unknown }>).detail;
  if (detail?.key === PDF_SELECTION_AUTO_COPY_KEY) {
    pdfSelectionAutoCopy = Boolean(detail.value);
  }
});

interface PdfSelectionMessage {
  type: "pdf-selection";
  payload?: PdfSelectionNotification | null;
}

interface PdfOcrRequestMessage {
  type: "pdf-ocr-request";
  payload?: { fileUrl?: string } | null;
}

function handlePdfSelectionMessage(event: MessageEvent): void {
  const data = (event.data as PdfSelectionMessage | undefined) || null;
  if (!data || data.type !== "pdf-selection") {
    return;
  }
  if (event.source !== pdfViewerIframe?.contentWindow) {
    return;
  }
  void processPdfSelection(data.payload ?? null);
}

window.addEventListener("message", handlePdfSelectionMessage);

function fileUrlToPath(fileUrl?: string): string {
  if (!fileUrl) return "";
  if (fileUrl.startsWith("file://")) {
    try {
      const u = new URL(fileUrl);
      return decodeURIComponent(u.pathname || fileUrl.replace(/^file:\/\//, ""));
    } catch {
      return fileUrl.replace(/^file:\/\//, "");
    }
  }
  return fileUrl;
}

async function handlePdfOcrRequest(event: MessageEvent): Promise<void> {
  const data = (event.data as PdfOcrRequestMessage | undefined) || null;
  if (!data || data.type !== "pdf-ocr-request") {
    return;
  }
  if (event.source !== pdfViewerIframe?.contentWindow) {
    return;
  }
  const fileUrl = data.payload?.fileUrl || "";
  const pdfPath = fileUrlToPath(fileUrl);
  if (!pdfPath || !window.commandBridge?.dispatch) {
    return;
  }
  const result = (await window.commandBridge.dispatch({
    phase: "pdf",
    action: "ocr",
    payload: { pdfPath }
  })) as any;
  if (!pdfViewerIframe?.contentWindow) return;
  if (!result || result.status !== "ok" || !result.pdfPath) {
    const message = (result && (result.message || result.error)) ? String(result.message || result.error) : "OCR failed";
    pdfViewerIframe.contentWindow.postMessage(
      { type: "pdf-ocr-error", payload: { message } },
      "*"
    );
    return;
  }
  pdfViewerIframe.contentWindow.postMessage(
    { type: "pdf-ocr-ready", payload: { pdfPath: result.pdfPath } },
    "*"
  );
}

window.addEventListener("message", (ev) => {
  void handlePdfOcrRequest(ev);
});

async function processPdfSelection(payload: PdfSelectionNotification | null): Promise<void> {
  if (!payload) {
    lastPdfSelectionKey = "";
    return;
  }
  const key = `${payload.dqid ?? ""}|${payload.text}|${payload.citation}|${payload.page}`;
  if (key === lastPdfSelectionKey) {
    return;
  }
  lastPdfSelectionKey = key;
  const segments = [payload.text, payload.citation].map((segment) => segment?.trim()).filter(Boolean);
  if (!segments.length) {
    return;
  }
  const textToCopy = segments.join("\n\n");
  if (!pdfSelectionAutoCopy) {
    return;
  }
  copyTextToClipboard(textToCopy, () => showPdfSelectionToast("PDF selection copied"));
}

function copyTextToClipboard(text: string, onSuccess?: () => void): void {
  const clipboard = (navigator && "clipboard" in navigator) ? (navigator.clipboard as Clipboard) : null;
  if (clipboard && typeof clipboard.writeText === "function") {
    void clipboard
      .writeText(text)
      .then(() => onSuccess?.())
      .catch((error) => console.warn("Clipboard write failed", error));
    return;
  }
  const placeholder = document.createElement("textarea");
  placeholder.value = text;
  placeholder.setAttribute("readonly", "");
  placeholder.style.position = "absolute";
  placeholder.style.opacity = "0";
  placeholder.style.left = "-9999px";
  document.body.appendChild(placeholder);
  placeholder.select();
  document.execCommand("copy");
  document.body.removeChild(placeholder);
  onSuccess?.();
}

function ensurePdfSelectionToastElement(): HTMLElement {
  const head = document.head || document.getElementsByTagName("head")[0];
  if (!document.getElementById(PDF_SELECTION_TOAST_STYLE_ID) && head) {
    const style = document.createElement("style");
    style.id = PDF_SELECTION_TOAST_STYLE_ID;
    style.textContent = `
#${PDF_SELECTION_TOAST_ID} {
  position: fixed;
  right: 24px;
  bottom: 24px;
  padding: 10px 16px;
  border-radius: 14px;
  background: var(--panel, rgba(8, 14, 23, 0.95));
  color: var(--text, #eff6ff);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow, 0 24px 48px rgba(15, 23, 42, 0.65));
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 200ms ease, transform 200ms ease;
  pointer-events: none;
  z-index: 10000;
}
#${PDF_SELECTION_TOAST_ID}.visible {
  opacity: 1;
  transform: translateY(0);
}
`;
    head.appendChild(style);
  }

  let toast = document.getElementById(PDF_SELECTION_TOAST_ID);
  if (!toast) {
    toast = document.createElement("div");
    toast.id = PDF_SELECTION_TOAST_ID;
    toast.className = "pdf-selection-toast";
    document.body.appendChild(toast);
  }
  return toast as HTMLElement;
}

function showPdfSelectionToast(message: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const toast = ensurePdfSelectionToastElement();
  toast.textContent = message;
  toast.classList.add("visible");
  if (pdfSelectionToastTimer !== null) {
    window.clearTimeout(pdfSelectionToastTimer);
  }
  pdfSelectionToastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
    pdfSelectionToastTimer = null;
  }, 2200);
}

let screenStatusEl: HTMLDivElement | null = null;

function renderRibbonTab(tab: RibbonTab, mount: HTMLElement): void {
  mount.innerHTML = "";
  mount.classList.add("ribbon-root");

  if (tab.description) {
    mount.title = tab.description;
  }

  const grouped = groupBy(tab.actions ?? [], (action) => action.group || "Actions");
  // Defer heavy ribbon DOM construction so tab switches feel instant.
  const placeholder = document.createElement("div");
  placeholder.className = "status-bar";
  placeholder.textContent = "Loading…";
  mount.appendChild(placeholder);

  const token = ((mount as any).__ribbonToken = ((mount as any).__ribbonToken || 0) + 1);
  scheduleIdle(() => {
    if (((mount as any).__ribbonToken || 0) !== token) return;
    mount.innerHTML = "";
    grouped.forEach((actions, group) => {
      const wrapper = document.createElement("div");
      wrapper.className = "ribbon-group";
      const title = document.createElement("h3");
      title.textContent = group;
      wrapper.appendChild(title);
      actions.forEach((action) => wrapper.appendChild(createActionButton(action)));
      mount.appendChild(wrapper);
    });

    if (tab.phase === "screen") {
      // No extra status banner for Screen.
    }
  }, 120);

  // screen status gets rendered after deferred groups
}

function createActionButton(action: RibbonAction): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ribbon-button";
  btn.textContent = action.label;
  btn.title = action.hint;
  btn.dataset.phase = action.command.phase;
  btn.dataset.action = action.command.action;
  const payload = action.command.payload as { toolType?: string; panelId?: string; metadata?: Record<string, unknown> } | undefined;
  const isToolOpenAction = action.command.phase === "tools" && action.command.action === "open_tool" && payload?.toolType;
  if (isToolOpenAction) {
    btn.draggable = true;
    btn.dataset.toolType = String(payload!.toolType);
    btn.addEventListener("dragstart", (event) => {
      if (!event.dataTransfer) return;
      const dragPayload = JSON.stringify({
        toolType: payload!.toolType,
        metadata: payload?.metadata
      });
      event.dataTransfer.setData("application/x-annotarium-tool-tab", dragPayload);
      event.dataTransfer.setData("text/plain", dragPayload);
      event.dataTransfer.effectAllowed = "copy";
    });
  }
  btn.addEventListener("click", () => handleAction(action));
  return btn;
}

function handleAction(action: RibbonAction): void {
  if (
    action.command.phase === "retrieve" &&
    typeof action.command.action === "string" &&
    action.command.action.startsWith("datahub_")
  ) {
    // DataHub actions always target the dedicated DataHub tool in panel 2.
    panelGrid.ensurePanelVisible(2);
    ensureRetrieveDataHubTool({ replace: !retrieveDataHubToolId });
    window.setTimeout(() => {
      document.dispatchEvent(
        new CustomEvent("retrieve-datahub-command", {
          detail: { action: action.command.action, payload: action.command.payload ?? undefined }
        })
      );
    }, 0);
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "retrieve_open_query_builder") {
    panelGrid.ensurePanelVisible(2);
    ensureRetrieveQueryBuilderTool({ replace: true });
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "retrieve_set_provider") {
    const defaults = readRetrieveQueryDefaults();
    const raw = window.prompt(
      `Provider (semantic_scholar, crossref, openalex, elsevier, wos, unpaywall, cos)\n\nCurrent: ${defaults.provider}`,
      String(defaults.provider)
    );
    if (raw === null) return;
    writeRetrieveQueryDefaults({ provider: raw.trim() as RetrieveProviderId });
    panelGrid.ensurePanelVisible(2);
    ensureRetrieveQueryBuilderTool({ replace: true });
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "retrieve_set_sort") {
    const defaults = readRetrieveQueryDefaults();
    const raw = window.prompt(`Sort (relevance, year)\n\nCurrent: ${defaults.sort}`, String(defaults.sort));
    if (raw === null) return;
    writeRetrieveQueryDefaults({ sort: raw.trim() as RetrieveSort });
    panelGrid.ensurePanelVisible(2);
    ensureRetrieveQueryBuilderTool({ replace: true });
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "retrieve_set_year_range") {
    const defaults = readRetrieveQueryDefaults();
    const raw = window.prompt(
      `Year range as "from,to" (example: 2015,2024). Leave blank to clear.\n\nCurrent: ${defaults.year_from ?? ""},${defaults.year_to ?? ""}`,
      `${defaults.year_from ?? ""},${defaults.year_to ?? ""}`
    );
    if (raw === null) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      writeRetrieveQueryDefaults({ year_from: undefined, year_to: undefined });
    } else {
      const parts = trimmed.split(",").map((p) => p.trim());
      const yf = parts[0] ? Number(parts[0]) : undefined;
      const yt = parts[1] ? Number(parts[1]) : undefined;
      writeRetrieveQueryDefaults({
        year_from: Number.isFinite(yf as number) ? (yf as number) : undefined,
        year_to: Number.isFinite(yt as number) ? (yt as number) : undefined
      });
    }
    panelGrid.ensurePanelVisible(2);
    ensureRetrieveQueryBuilderTool({ replace: true });
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "retrieve_set_limit") {
    const defaults = readRetrieveQueryDefaults();
    const raw = window.prompt(`Limit (positive integer)\n\nCurrent: ${defaults.limit}`, String(defaults.limit));
    if (raw === null) return;
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n <= 0) return;
    writeRetrieveQueryDefaults({ limit: Math.floor(n) });
    panelGrid.ensurePanelVisible(2);
    ensureRetrieveQueryBuilderTool({ replace: true });
    return;
  }
  if (action.command.phase === "tools" && action.command.action === "open_tool") {
    const payload = action.command.payload as { toolType?: string; panelId?: string; metadata?: Record<string, unknown> } | undefined;
    if (payload?.toolType) {
      const panelId = (payload.panelId as PanelId | undefined) ?? "panel2";
      panelTools.ensureToolHost(panelId, { replaceContent: true });
      panelTools.clearPanelTools(panelId);
      const id = panelTools.spawnTool(payload.toolType, { panelId, metadata: payload.metadata });
      panelTools.focusTool(id);
      const index = PANEL_INDEX_BY_ID[panelId];
      if (index) {
        panelGrid.ensurePanelVisible(index);
      }
    }
    return;
  }
  if (action.opensPanel) {
    openPanelShell(action);
  }
  if (action.command.phase === "test") {
    prepareTestPanel(action.command.action);
  }
  if (action.command.phase === "analyse") {
    emitAnalyseAction(action.command.action as AnalyseAction, action.command.payload as Record<string, unknown>);
  }
  const result = command(action.command.phase, action.command.action, action.command.payload);
  if (action.command.phase === "test") {
    result
      .then((response) => handleTestResponse(action.command.action, response))
      .catch((err) => {
        console.error("Test command failed", err);
        renderTestPanelMessage(action.command.action, "Test command failed");
      });
  } else {
    result.catch((err) => console.error("Ribbon command failed", err));
  }
  if (action.command.phase === "screen") {
    result.finally(refreshScreenStatus);
  }
}
function handleTestResponse(actionName: string, response?: RibbonCommandResponse): void {
  if (actionName === "open_pdf") {
    renderPdfTestPanel(response?.payload as PdfTestPayload | undefined);
    return;
  }
  if (actionName === "open_coder") {
    renderCoderTestPanel((response?.payload as { tree?: CoderTestNode[] } | undefined)?.tree);
  }
}

function prepareTestPanel(actionName: string): void {
  const host = getTestPanelContent(actionName);
  renderTestPanelMessage(actionName, "Loading test data…", host);
}

function renderTestPanelMessage(actionName: string, text: string, container?: HTMLElement | null): void {
  const host = container ?? getTestPanelContent(actionName);
  if (!host) {
    return;
  }
  host.innerHTML = "";
  host.appendChild(createTestPanelMessage(text));
}

function renderPdfTestPanel(payload?: PdfTestPayload): void {
  const host = getTestPanelContent("open_pdf");
  if (!host) {
    return;
  }
  host.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "12px";
  wrapper.style.height = "100%";
  const heading = document.createElement("h3");
  heading.textContent = "PDF Smoke Test";
  heading.style.margin = "0";
  wrapper.appendChild(heading);
  if (!payload) {
    wrapper.appendChild(createTestPanelMessage("PDF payload unavailable"));
    host.appendChild(wrapper);
    return;
  }
  const metadata: [string, string | number][] = [
    ["Title", payload.title],
    ["Source", payload.source],
    ["Page", payload.page],
    ["Theme", payload.theme],
    ["Evidence type", payload.evidence_type],
    ["Route", payload.route]
  ];
  const metadataList = document.createElement("dl");
  metadataList.style.display = "grid";
  metadataList.style.gridTemplateColumns = "max-content 1fr";
  metadataList.style.gap = "4px 12px";
  metadata.forEach(([term, value]) => {
    const termEl = document.createElement("dt");
    termEl.textContent = term;
    termEl.style.fontSize = "12px";
    termEl.style.color = "var(--muted, #94a3b8)";
    termEl.style.margin = "0";
    const descEl = document.createElement("dd");
    descEl.textContent = String(value);
    descEl.style.margin = "0";
    descEl.style.fontSize = "13px";
    descEl.style.fontWeight = "600";
    metadataList.append(termEl, descEl);
  });
  wrapper.appendChild(metadataList);
  const summary = document.createElement("p");
  summary.textContent = payload.section_text;
  summary.style.margin = "0";
  summary.style.color = "var(--muted, #94a3b8)";
  summary.style.fontSize = "13px";
  wrapper.appendChild(summary);
  const viewerHost = document.createElement("div");
  viewerHost.style.flex = "1";
  viewerHost.style.minHeight = "360px";
  viewerHost.style.borderRadius = "12px";
  viewerHost.style.overflow = "hidden";
  viewerHost.style.background = "var(--panel, #0f172a)";
  const iframe = ensurePdfViewerFrame(viewerHost);
  applyPayloadToViewer(iframe, payload);
  wrapper.appendChild(viewerHost);
  host.appendChild(wrapper);
}

function renderCoderTestPanel(nodes?: CoderTestNode[]): void {
  const host = getTestPanelContent("open_coder");
  if (!host) {
    return;
  }
  host.innerHTML = "";
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.flexDirection = "column";
  wrapper.style.gap = "12px";
  const heading = document.createElement("h3");
  heading.textContent = "Tools · Coder";
  heading.style.margin = "0";
  wrapper.appendChild(heading);
  if (!nodes || nodes.length === 0) {
    wrapper.appendChild(createTestPanelMessage("Coder tree unavailable"));
    host.appendChild(wrapper);
    return;
  }
  const coderPanel = new CoderPanel({
    title: "Coder (Test)",
    initialTree: convertTestNodes(nodes),
    scopeId: getDefaultCoderScope(),
    onStateLoaded: (info) => {
      console.info(`[TestCoder] state file ${info.statePath}`);
    }
  });
  wrapper.appendChild(coderPanel.element);
  host.appendChild(wrapper);
}

function convertTestNodes(nodes: CoderTestNode[]): CoderNode[] {
  const toId = (): string =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `coder_${Math.random().toString(16).slice(2)}`;
  const mapNode = (node: CoderTestNode): CoderNode => {
    const hasChildren = Array.isArray(node.children) && node.children.length > 0;
    if (hasChildren) {
      return {
        id: toId(),
        type: "folder",
        name: node.label,
        children: node.children!.map(mapNode)
      };
    }
    return {
      id: toId(),
      type: "item",
      name: node.label,
      status: node.status,
      payload: {
        title: node.label,
        text: node.detail,
        html: `<p>${node.detail}</p>`
      }
    };
  };
  return nodes.map(mapNode);
}
function openPanelShell(action: RibbonAction): void {
  if (!action.panel) return;
  panelTools.spawnTool("panel-shell", {
    panelId: "panel2",
    metadata: {
      title: action.panel.title,
      description: action.panel.description
    }
  });
}

function renderScreenStatus(mount: HTMLElement): void {
  if (screenStatusEl) {
    screenStatusEl.remove();
  }
  screenStatusEl = null;
}

function refreshScreenStatus(): void {
  if (!screenStatusEl) return;
  // Legacy Python screen host status is not required for the current Screen workflow.
  screenStatusEl.textContent = "Uses cached Data Hub table. Panel 2: abstract + screen codes + comment. Panel 3: PDF viewer.";
}

function updateScreenStatus(response?: RibbonCommandResponse): void {
  if (!screenStatusEl) return;
  if (response?.nav) {
    screenStatusEl.textContent = response.nav;
    return;
  }
  if (response?.message) {
    screenStatusEl.textContent = response.message;
    return;
  }
  screenStatusEl.textContent = "Record status unavailable";
}

const pdfViewerRetry = new WeakMap<HTMLIFrameElement, number>();
const mapAppThemeToPdfTheme = (theme: string): string => {
  const t = (theme || "").toLowerCase();
  if (t === "high-contrast" || t === "highcontrast") return "highcontrast";
  if (t === "light") return "paper";
  if (t === "warm") return "sepia";
  if (t === "colorful") return "paper";
  if (t === "cold" || t === "dark" || t === "system") return "midnight";
  return ["midnight", "dim", "paper", "sepia", "highcontrast"].includes(t) ? t : "midnight";
};

const getAppThemeId = (): string => {
  const docTheme = document.documentElement.dataset.theme;
  if (docTheme) return docTheme;
  try {
    const raw = window.localStorage.getItem("appearance.theme");
    if (raw) return raw;
  } catch {
    // ignore
  }
  return "system";
};

const syncPdfViewerTheme = (iframe: HTMLIFrameElement): void => {
  const win = iframe.contentWindow as Window & { PDF_APP?: { setTheme?: (t: string) => string } };
  if (!win || !win.PDF_APP || typeof win.PDF_APP.setTheme !== "function") return;
  win.PDF_APP.setTheme(mapAppThemeToPdfTheme(getAppThemeId()));
};

function renderPdfTabs(panel: HTMLElement, payload: PdfTestPayload, rawPayload?: any): void {
  const rawData = rawPayload || payload;
  const citations = rawData?.citations || rawData?.meta?.citations;
  const references = rawData?.references || rawData?.meta?.references;
  panel.innerHTML = "";

  const tabsWrap = document.createElement("div");
  tabsWrap.style.display = "flex";
  tabsWrap.style.gap = "6px";
  tabsWrap.style.padding = "6px 8px";
  tabsWrap.style.borderBottom = "1px solid var(--border, #1f2937)";

  const views: Record<string, HTMLElement> = {};
  const tabIds: Array<{ id: string; label: string }> = [
    { id: "pdf", label: "PDF" },
    { id: "raw", label: "Raw data" },
    { id: "cit", label: "Citations" },
    { id: "ref", label: "References" }
  ];

  const contentWrap = document.createElement("div");
  contentWrap.style.flex = "1 1 auto";
  contentWrap.style.minHeight = "0";
  contentWrap.style.display = "flex";
  contentWrap.style.flexDirection = "column";

  tabIds.forEach((t, idx) => {
    const btn = document.createElement("button");
    btn.className = "button-ghost";
    btn.textContent = t.label;
    btn.style.padding = "6px 10px";
    btn.style.borderRadius = "10px";
    btn.style.border = "1px solid var(--border, #1f2937)";
    btn.style.background = idx === 0 ? "color-mix(in srgb, var(--panel-2) 85%, transparent)" : "transparent";
    btn.addEventListener("click", () => {
      tabIds.forEach((x) => {
        const v = views[x.id];
        if (v) v.style.display = x.id === t.id ? "flex" : "none";
      });
      tabsWrap.querySelectorAll("button").forEach((b) => {
        b instanceof HTMLButtonElement &&
          (b.style.background =
            b === btn ? "color-mix(in srgb, var(--panel-2) 85%, transparent)" : "transparent");
      });
    });
    tabsWrap.appendChild(btn);

    const view = document.createElement("div");
    view.style.flex = "1 1 auto";
    view.style.minHeight = "0";
    view.style.display = idx === 0 ? "flex" : "none";
    view.style.flexDirection = "column";
    view.style.padding = "8px";
    view.style.gap = "10px";
    view.style.overflow = "hidden";
    views[t.id] = view;
    contentWrap.appendChild(view);
  });

  // PDF view
  const pdfView = views["pdf"];
  if (pdfView) {
    const header = document.createElement("div");
    header.className = "status-bar";
    header.textContent = `${payload.title || "PDF"} · ${payload.pdf_path}`;
    pdfView.appendChild(header);

    const iframe = ensurePdfViewerFrame(pdfView);
    iframe.style.zIndex = "1";
    iframe.style.flex = "1 1 auto";
    iframe.style.height = "100%";
    iframe.style.minHeight = "0";
    iframe.style.width = "100%";
    applyPayloadToViewer(iframe, payload);
  }

  // Raw data view (preview HTML)
  const rawView = views["raw"];
  if (rawView) {
    rawView.style.overflow = "auto";
    rawView.innerHTML = buildRawHtml(rawData);
  }

  const asBlock = (val: unknown, emptyLabel: string) => {
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    pre.style.margin = "0";
    if (val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0)) {
      pre.textContent = emptyLabel;
    } else {
      pre.textContent = typeof val === "string" ? val : JSON.stringify(val, null, 2);
    }
    return pre;
  };

  // Citations view
  const citView = views["cit"];
  if (citView) {
    citView.style.overflow = "auto";
    citView.appendChild(asBlock(citations, "No citations"));
  }

  // References view
  const refView = views["ref"];
  if (refView) {
    refView.style.overflow = "auto";
    refView.appendChild(asBlock(references, "No references"));
  }

  panel.appendChild(tabsWrap);
  panel.appendChild(contentWrap);
}

function buildRawHtml(pl: any): string {
  const basePayload = pl && pl.raw ? pl.raw : pl;
  let parsedPayload: any = {};
  const payloadJson = basePayload?.payload_json;
  if (typeof payloadJson === "string" && payloadJson.trim().startsWith("{") && payloadJson.trim().endsWith("}")) {
    try {
      parsedPayload = JSON.parse(payloadJson);
    } catch {
      parsedPayload = {};
    }
  }
  const raw = { ...parsedPayload, ...basePayload, ...(pl?.meta || {}) };
  const norm = (v: any) => (v === null || v === undefined ? "" : String(v).trim());
  const esc = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const looksHtml = (s: string) => {
    const t = s.trim().toLowerCase();
    return ["<section", "<p", "<div", "<h1", "<h2", "<h3", "<h4"].some((k) => t.includes(k));
  };

  const extractSection = (src: any): { body: string; isHtml: boolean } => {
    const sh = norm(src.section_html || src.html || "");
    const st = norm(src.section_text || "");
    if (sh) return { body: sh, isHtml: true };
    if (st) return { body: st, isHtml: looksHtml(st) };
    const dq = norm(src.direct_quote_clean || src.direct_quote || src.paraphrase || "");
    if (dq) return { body: dq, isHtml: false };
    return { body: "", isHtml: false };
  };

  const injectDqidIntoHref = (htmlFragment: string): string => {
    if (!htmlFragment) return "";
    try {
      const doc = new DOMParser().parseFromString(htmlFragment, "text/html");
      doc.querySelectorAll("a").forEach((a) => {
        const dqid =
          a.getAttribute("data-dqid") ||
          a.getAttribute("data-quote_id") ||
          a.getAttribute("data-quote-id") ||
          "";
        if (!dqid) return;
        const href = (a.getAttribute("href") || "").trim();
        if (href.startsWith("dq://")) return;
        a.setAttribute("href", `dq://${dqid}`);
      });
      return doc.body.innerHTML;
    } catch {
      return htmlFragment;
    }
  };

  const section = extractSection(raw);

  const author = norm(raw.first_author_last || raw.author_summary || raw.author);
  const year = norm(raw.year);
  const title = norm(raw.title);
  const source = norm(raw.source);
  const page = norm(raw.page);
  const url = norm(raw.url);
  const route = norm(raw.route);

  const biblioBits: string[] = [];
  if (author && year) biblioBits.push(`${author} (${year})`);
  else if (author) biblioBits.push(author);
  else if (year) biblioBits.push(year);
  if (title) biblioBits.push(`“${title}”`);
  if (source) biblioBits.push(source);
  if (page) biblioBits.push(`p. ${page}`);
  const biblio = biblioBits.join(" · ");

  const potTheme = norm(raw.potential_theme || raw.overarching_theme || "");
  const evType = norm(raw.evidence_type || "");
  const evTypeNorm = norm(raw.evidence_type_norm || "");
  const paraphrase = norm(raw.paraphrase || "");
  const researcherComment = norm(raw.researcher_comment || raw.research_comment || "");
  const theme = norm(raw.theme || "");
  const goldTheme = norm(raw.gold_theme || "");
  const itemKey = norm(raw.item_key || "");
  const pdfPath = norm(raw.pdf_path || "");
  const rq = norm(raw.rq_question || "");
  const potentialThemes = Array.isArray(raw.all_potential_themes)
    ? raw.all_potential_themes.join(", ")
    : norm(raw.all_potential_themes || "");

  const headerBits: string[] = [];
  if (biblio) {
    const bHtml = url ? `<a href="${esc(url)}">${esc(biblio)}</a>` : esc(biblio);
    headerBits.push(`<p class="dq-biblio">${bHtml}</p>`);
  }
  if (potTheme) headerBits.push(`<p><span class="dq-label">Theme:</span> ${esc(potTheme)}</p>`);
  if (evType) headerBits.push(`<p><span class="dq-label">Evidence type:</span> ${esc(evType)}</p>`);
  if (evTypeNorm) headerBits.push(`<p><span class="dq-label">Evidence (norm):</span> ${esc(evTypeNorm)}</p>`);
  if (paraphrase) headerBits.push(`<p><span class="dq-label">Paraphrase:</span> ${esc(paraphrase)}</p>`);
  if (researcherComment)
    headerBits.push(`<p><span class="dq-label">Researcher comment:</span> ${esc(researcherComment)}</p>`);

  const metaFields: Array<[string, string]> = [
    ["Route", route],
    ["Research question", rq],
    ["Gold theme", goldTheme],
    ["Theme", theme],
    ["Potential theme", potTheme],
    ["All potential themes", potentialThemes],
    ["Evidence type (norm)", evTypeNorm],
    ["Evidence type", evType],
    ["Item key", itemKey],
    ["Page", page],
    ["Source", source],
    ["URL", url],
    ["PDF path", pdfPath]
  ].filter(([, v]) => v) as Array<[string, string]>;

  const metaHtml =
    metaFields.length > 0
      ? `<div class="meta-grid">${metaFields
          .map(
            ([k, v]) =>
              `<div class="meta-row"><div class="meta-key">${esc(k)}</div><div class="meta-val">${esc(v)}</div></div>`
          )
          .join("")}</div>`
      : "";

  const headerHtml =
    headerBits.length || metaHtml
      ? `<div class="dq-header">${headerBits.join("")}${metaHtml}</div>`
      : "";

  let bodyHtml = "";
  if (section.body) {
    if (section.isHtml) {
      bodyHtml = injectDqidIntoHref(section.body);
    } else {
      const escBody = esc(section.body).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br/>");
      bodyHtml = `<p>${escBody}</p>`;
    }
  }

  const css = `
           html, body {
               background:var(--bg, #0A0E14);
               margin:0;
               padding:0;
               font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
               color:var(--text, #E7ECF3);
               -webkit-font-smoothing:antialiased;
               -moz-osx-font-smoothing:grayscale;
           }

           .preview-wrap {
               background: linear-gradient(to bottom, var(--panel-2, #0F1420) 0%, var(--panel, #0C1220) 100%);
               margin:4px 0 8px 0;
               padding:10px 12px 16px 12px;
               border-radius:14px;
               border:1px solid var(--border, #1B2233);
           }

           h1,h2,h3,h4 {
               margin: 0.6em 0 0.35em;
               color:var(--text, #FFFFFF);
               line-height:1.3;
               font-weight:600;
           }

           p {
               margin: 0.35em 0;
               color:var(--text, #E7ECF3);
               font-size:13px;
               line-height:1.6;
               text-align:justify;
           }

           .pdf-section {
               margin: 0.35em 0;
               color:var(--muted, #D7DEE8);
           }

           a {
               color:var(--link, #9CB8FF);
               text-decoration: underline;
           }
           a:hover {
               text-decoration: none;
           }

           mark {
               background: color-mix(in srgb, var(--accent, #FFD166) 25%, transparent);
               color:var(--text, #FFFBEA);
               padding:0 3px;
               border-radius:3px;
               box-shadow:0 0 10px color-mix(in srgb, var(--accent, #FFD166) 35%, transparent);
           }

           ul,ol {
               padding-left: 1.2rem;
               margin: 0.35rem 0 0.35rem 1.2rem;
               color:var(--muted, #D7DEE8);
           }

           li {
               margin: 0.25em 0;
               line-height:1.5;
               text-align:justify;
           }

           blockquote {
               border-left:3px solid color-mix(in srgb, var(--accent, #7dd3fc) 60%, transparent);
               background:var(--surface-muted, rgba(15,20,32,0.9));
               padding:8px 10px;
               margin:8px 0;
               color:var(--text, #F5F7FA);
               font-size:13px;
               line-height:1.55;
           }

           .dq-header {
               margin-bottom:10px;
               padding:8px 10px;
               border-radius:10px;
               border:1px solid color-mix(in srgb, var(--accent, #7dd3fc) 30%, transparent);
               background:var(--surface-muted, rgba(255,255,255,0.03));
           }

           .dq-header p {
               margin: 0.25em 0;
               font-size:12px;
               line-height:1.5;
               text-align:justify;
               color:var(--text, #E7ECF3);
           }

           .dq-label {
               font-weight:600;
               color:var(--text, #E7ECF3);
           }

           .dq-biblio {
               font-weight:600;
               color:var(--text, #E7ECF3);
           }

           .dq-body-separator {
               border-top:1px solid var(--border, #1B2233);
               margin:10px 0 8px 0;
           }

           pre {
               white-space: pre-wrap;
               word-break: break-word;
               margin: 0.35em 0;
               color:var(--text, #E7ECF3);
               font-size:12px;
               line-height:1.55;
               background: var(--surface-muted, rgba(255,255,255,0.03));
               border: 1px solid var(--border, #1B2233);
               border-radius: 10px;
               padding: 10px;
           }
           .meta-grid { display:grid; grid-template-columns: minmax(140px, 180px) 1fr; gap:6px 12px; align-items:flex-start; }
           .meta-row { display:contents; }
           .meta-key { font-size:12px; color:var(--muted, #9fb1c7); font-weight:600; }
           .meta-val { font-size:12px; color:var(--text, #e7ecf3); }
           `;

  const inner =
    headerHtml && bodyHtml
      ? `${headerHtml}<div class="dq-body-separator"></div>${bodyHtml}`
      : headerHtml + bodyHtml;

  return `<style>${css}</style><div class="preview-wrap">${inner}</div>`;
}

function ensurePdfViewerFrame(host: HTMLElement): HTMLIFrameElement {
  let iframe = host.querySelector<HTMLIFrameElement>("iframe.pdf-test-viewer");
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.className = "pdf-test-viewer";
    const theme = mapAppThemeToPdfTheme(getAppThemeId());
    const url = new URL(TEST_PDF_VIEWER_URL);
    url.searchParams.set("theme", theme);
    url.searchParams.set("sidebar", "0");
    iframe.src = url.toString();
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "0";
    iframe.style.background = "var(--panel, #0f172a)";
    iframe.title = "PDF Viewer";
    host.appendChild(iframe);
  }
  pdfViewerIframe = iframe;
  return iframe;
}

function resolveTestPdfPath(requested?: string): string | undefined {
  if (!requested) {
    return undefined;
  }
  return TEST_PDF_PATH_OVERRIDES[requested] ?? requested;
}

function applyPayloadToViewer(iframe: HTMLIFrameElement, payload: PdfTestPayload): void {
  const viewerPayload: PdfTestPayload = {
    ...payload,
    pdf_path: resolveTestPdfPath(payload.pdf_path) ?? payload.pdf_path
  };
  const tryApply = (): boolean => {
    const win = iframe.contentWindow as Window & { PDF_APP?: { loadFromPayload?: (payload: PdfTestPayload) => string } };
    if (!win) {
      return false;
    }
    const pdfApp = win.PDF_APP;
    if (pdfApp && typeof pdfApp.loadFromPayload === 'function') {
      pdfApp.loadFromPayload(viewerPayload);
      syncPdfViewerTheme(iframe);
      return true;
    }
    return false;
  };

  if (tryApply()) {
    pdfViewerRetry.delete(iframe);
    return;
  }

  const existingInterval = pdfViewerRetry.get(iframe);
  if (existingInterval !== undefined) {
    window.clearInterval(existingInterval);
    pdfViewerRetry.delete(iframe);
  }

  let intervalId: number | undefined;

  function cleanup(): void {
    iframe.removeEventListener('load', onLoad);
    if (intervalId !== undefined) {
      window.clearInterval(intervalId);
      intervalId = undefined;
    }
    pdfViewerRetry.delete(iframe);
  }

  function onLoad(): void {
    if (tryApply()) {
      cleanup();
    }
  }

  iframe.addEventListener('load', onLoad);
  intervalId = window.setInterval(() => {
    if (tryApply()) {
      cleanup();
    }
  }, 250);
  pdfViewerRetry.set(iframe, intervalId);
}
function getTestPanelContent(actionName: string): HTMLElement | null {
  const target = actionName === "open_pdf" ? 3 : actionName === "open_coder" ? 1 : null;
  if (!target) {
    return null;
  }
  panelGrid.ensurePanelVisible(target);
  return panelGrid.getPanelContent(target);
}

function createTestPanelMessage(text: string): HTMLElement {
  const label = document.createElement("div");
  label.textContent = text;
  label.style.fontSize = "13px";
  label.style.color = "var(--muted, #94a3b8)";
  label.style.padding = "4px 0";
  return label;
}

function ensureSectionTool(tabId: TabId, options?: { replace?: boolean }): void {
  const config = sectionToolConfig(tabId);
  if (!config) {
    return;
  }
  // Reset layout hint unless explicitly set per-tab below.
  panelGrid.setLayoutHint(null);
  if (options?.replace) {
    panelTools.clearPanelTools("panel2");
    Object.entries(sectionToolIds).forEach(([key, toolId]) => {
      if (!toolId) return;
      if (!panelTools.getToolPanel(toolId)) {
        delete sectionToolIds[key as TabId];
      }
    });
  }
  if (tabId === "write") {
    console.info("[WRITE][NAV] clicked Write tab; ensuring editor in panel 2");
    // Use the full workspace for writing by collapsing the other panels.
    panelGrid.setRoundLayout(false);
    panelGrid.setLayoutHint(null);
    panelGrid.setCollapsed("panel1", true);
    panelGrid.setCollapsed("panel3", true);
    panelGrid.setCollapsed("panel4", true);
    panelGrid.setCollapsed("panel2", false);
    panelGrid.setRatios({ panel1: 0, panel2: 6, panel3: 0, panel4: 0 });
    panelGrid.ensurePanelVisible(2);
    debugLogPanelState(2, "after Write click");
    ensureWriteToolTab();
  }
  if (tabId === "code") {
    // Center the code panel with empty space around.
    panelGrid.setRoundLayout(false);
    panelGrid.setCollapsed("panel1", true);
    panelGrid.setCollapsed("panel3", true);
    panelGrid.setCollapsed("panel4", true);
    panelGrid.setCollapsed("panel2", false);
    panelGrid.setRatios({ panel1: 0, panel2: 3, panel3: 0, panel4: 0 });
    panelGrid.setLayoutHint({ mode: "centeredSingle", panelId: "panel2", maxWidthPx: 1100 });
    panelGrid.ensurePanelVisible(2);
  }
  if (tabId === "screen") {
    // Focus screening work into Panels 2–3.
    panelGrid.setRoundLayout(false);
    panelGrid.setCollapsed("panel1", true);
    panelGrid.setCollapsed("panel4", true);
    panelGrid.setCollapsed("panel2", false);
    panelGrid.setCollapsed("panel3", false);
    // Use ratios that satisfy PanelGrid.ensurePanelRatio() minimums while remaining 50/50.
    panelGrid.setRatios({ panel1: 0, panel2: 3, panel3: 3, panel4: 0 });
    panelGrid.ensurePanelVisible(2);
    panelGrid.ensurePanelVisible(3);
    // Force Panel 3 to be replaced when Screen is selected (Screen tool will load the current row's pdf_path).
    const panel3 = panelGrid.getPanelContent(3);
    if (panel3) {
      panel3.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.title = "PDF Viewer";
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "0";
      iframe.style.display = "block";
      iframe.src = TEST_PDF_VIEWER_URL;
      panel3.appendChild(iframe);
      (window as any).__screenPdfViewerIframe = iframe;
    }
  }
  const existing = sectionToolIds[tabId];
  if (existing) {
    if (tabId === "retrieve") {
      const currentPanel = panelTools.getToolPanel(existing);
      if (currentPanel && currentPanel !== "panel2") {
        panelTools.moveTool(existing, "panel2");
      }
    }
    scheduleRaf(() => panelTools.focusTool(existing));
    return;
  }
  const id = panelTools.spawnTool(config.toolType, { panelId: "panel2", metadata: config.metadata });
  sectionToolIds[tabId] = id;
  scheduleRaf(() => panelTools.focusTool(id));
  if (tabId === "visualiser") {
    ensureVisualiserPanelsVisible();
  }
}

function ensureRetrieveDataHubTool(options?: { replace?: boolean }): void {
  if (options?.replace) {
    panelTools.clearPanelTools("panel2");
    retrieveDataHubToolId = undefined;
    retrieveQueryToolId = undefined;
    delete sectionToolIds["retrieve"];
  }
  if (retrieveDataHubToolId) {
    scheduleRaf(() => panelTools.focusTool(retrieveDataHubToolId!));
    return;
  }
  const id = panelTools.spawnTool("retrieve-datahub", { panelId: "panel2" });
  retrieveDataHubToolId = id;
  scheduleRaf(() => panelTools.focusTool(id));
}

function ensureRetrieveQueryBuilderTool(options?: { replace?: boolean }): void {
  if (options?.replace) {
    panelTools.clearPanelTools("panel2");
    retrieveDataHubToolId = undefined;
    retrieveQueryToolId = undefined;
    delete sectionToolIds["retrieve"];
  }
  if (retrieveQueryToolId) {
    scheduleRaf(() => panelTools.focusTool(retrieveQueryToolId!));
    return;
  }
  const id = panelTools.spawnTool("retrieve", { panelId: "panel2" });
  retrieveQueryToolId = id;
  scheduleRaf(() => panelTools.focusTool(id));
}

function sectionToolConfig(
  tabId: TabId
): { toolType: string; metadata?: Record<string, unknown> } | null {
  if (tabId === "retrieve") {
    return { toolType: "retrieve-datahub" };
  }
  if (tabId === "write") {
    return { toolType: "write-leditor" };
  }
  if (tabId === "code") {
    return { toolType: "code-panel" };
  }
  if (tabId === "visualiser") {
    return { toolType: "visualiser" };
  }
  if (tabId === "screen") {
    return { toolType: "screen" };
  }
  if (tabId === "export") {
    return { toolType: "panel-shell", metadata: { title: "Export", description: "Export workspace" } };
  }
  if (tabId === "settings") {
    return null;
  }
  if (tabId === "tools") {
    return null;
  }
  return null;
}

function ensureVisualiserPanelsVisible(): void {
  panelGrid.ensurePanelVisible(1);
  panelGrid.ensurePanelVisible(2);
  panelGrid.ensurePanelVisible(3);
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  items.forEach((item) => {
    const key = keyFn(item);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(item);
  });
  return map;
}

function openSettingsWindow(section?: string): void {
  if (window.settingsBridge?.openSettingsWindow) {
    void window.settingsBridge.openSettingsWindow(section);
  } else if (window.commandBridge?.dispatch) {
    void window.commandBridge.dispatch({ phase: "settings", action: "open", payload: { section } });
  } else {
    console.warn("Settings window bridge is unavailable.");
    return;
  }
  if (activeTab === "settings" && lastNonSettingsTab !== "settings") {
    tabRibbon.selectTab(lastNonSettingsTab);
  }
}

function sanitizeLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
  const filteredTabs = snapshot.tabs.filter((tab) => tab.toolType !== "settings-panel");
  const activeToolId = filteredTabs.some((tab) => tab.id === snapshot.activeToolId) ? snapshot.activeToolId : filteredTabs[0]?.id;
  return { tabs: filteredTabs, activeToolId };
}
