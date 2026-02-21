import { ToolRegistry } from "../registry/toolRegistry";
import { PanelGrid } from "../layout/PanelGrid";
import { DEFAULT_PANEL_PARTS, type PanelId } from "../layout/panelRegistry";
import { PANEL_PRESETS } from "../layout/presets";
import { ROUTES, type RouteId } from "../layout/routes";
import { TabRibbon, TabId } from "../layout/TabRibbon";
import type { LayoutSnapshot } from "../panels/PanelLayoutRoot";
import { PanelToolManager } from "../panels/PanelToolManager";
import { loadPanelLayouts, savePanelLayout } from "../state/layout";
import { createPdfTool } from "../tools/pdf";
import { createEditorTool } from "../tools/editor";
import { createNotesTool } from "../tools/notes";
import { createTimelineTool } from "../tools/timeline";
import { createVizTool } from "../tools/viz";
import { createRetrieveDataHubTool } from "../tools/retrieveDataHub";
import { createCodeTool } from "../tools/code";
import { createVisualiserTool } from "../tools/visualiser";
import { createWriteTool } from "../tools/write";
import { createCoderTool } from "../tools/coder";
import { createScreenWidget } from "../tools/screen";
import { createAnalysePdfTabsTool } from "../tools/analysePdfTabs";
import { createScreenPdfViewerTool } from "../tools/screenPdfs";
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
import { applyPayloadToViewer, ensurePdfViewerFrame, syncAllPdfViewersTheme } from "../pdfViewer/integration";

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
import type { RetrieveRecord } from "../shared/types/retrieve";
import { createRetrieveCitationGraphTool, createRetrieveCitationsTool, createRetrieveTool } from "../tools/retrieve";
import { createRetrieveSearchAppTool } from "../tools/retrieveSearchApp";
import { createRetrieveSearchMetaTool } from "../tools/retrieveSearchMeta";
import { createRetrieveZoteroCollectionsTool, createRetrieveZoteroItemsTool, createRetrieveZoteroDetailTool } from "../tools/retrieveZotero";
import { retrieveZoteroContext } from "../state/retrieveZoteroContext";

const registry = new ToolRegistry();
registry.register(createPdfTool());
registry.register(createEditorTool());
registry.register(createNotesTool());
registry.register(createTimelineTool());
registry.register(createVizTool());
registry.register(createRetrieveTool());
registry.register(createRetrieveSearchAppTool());
registry.register(createRetrieveSearchMetaTool());
registry.register(createRetrieveZoteroCollectionsTool());
registry.register(createRetrieveZoteroItemsTool());
registry.register(createRetrieveZoteroDetailTool());
registry.register(createRetrieveCitationsTool());
registry.register(createRetrieveCitationGraphTool());
registry.register(createRetrieveDataHubTool());
registry.register(createPanelShellTool());
registry.register(createCodeTool());
registry.register(createWriteTool());
registry.register(createVisualiserTool());
registry.register(createCoderTool());
registry.register(createScreenWidget());
registry.register(createAnalysePdfTabsTool());
registry.register(createScreenPdfViewerTool());
void initThemeManager();
window.addEventListener("settings:updated", () => {
  syncAllPdfViewersTheme();
});

const ribbonHeader = document.getElementById("app-tab-header") as HTMLElement;
const ribbonActions = document.getElementById("app-tab-actions") as HTMLElement;
const panelGridContainer = document.getElementById("panel-grid-container") as HTMLElement;
const ribbonElement = document.getElementById("app-ribbon") as HTMLElement | null;
const agentChatFab = document.getElementById("agentChatFab") as HTMLButtonElement | null;
const agentChatDock = document.getElementById("agentChatDock") as HTMLElement | null;
const agentChatMessages = document.getElementById("agentChatMessages") as HTMLElement | null;
const agentChatForm = document.getElementById("agentChatForm") as HTMLFormElement | null;
const agentChatInput = document.getElementById("agentChatInput") as HTMLInputElement | null;
const btnAgentChatSend = document.getElementById("btnAgentChatSend") as HTMLButtonElement | null;
const btnAgentChatClose = document.getElementById("btnAgentChatClose") as HTMLButtonElement | null;
const btnAgentChatClear = document.getElementById("btnAgentChatClear") as HTMLButtonElement | null;
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
let retrieveSearchAppToolId: string | undefined;
let retrieveGraphToolId: string | undefined;
let retrieveMetaToolId: string | undefined;
let retrieveSearchSelectedRecord: RetrieveRecord | undefined;
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

let lastNonSettingsTab: TabId = "export";
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
// Prefer the bundled external PDF viewer (copied to dist/resources/pdf_viewer).
const TEST_PDF_VIEWER_URL = new URL("../resources/pdf_viewer/viewer.html", window.location.href).href;
const TEST_PDF_ASSET_URL = new URL(
  "../resources/pdfs/O'Connell - 2012 - Cyber security without cyber war.pdf",
  window.location.href
).href;
const TEST_PDF_PATH_OVERRIDES: Record<string, string> = {
  "C:\\Users\\luano\\Zotero\\storage\\5MYV4X6F\\Williamson - 2024 - Do Proxies Provide Plausible Deniability Evidence from Experiments on Three Surveys.pdf":
    TEST_PDF_ASSET_URL
};
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
  },
  onPanelFocusChange: (_panelId, _toolId, toolType, metadata) => {
    if (!toolType) return;
    // Clicking a tool tab should restore the same panel layout that the original
    // "open" action would have applied (IDE-like deterministic workspace).
    try {
      const presetId = String((metadata as any)?.layoutPresetId || "");
      const applyPresetId = (id: string) => {
        const preset = PANEL_PRESETS[id];
        if (preset) panelGrid.applyPreset(preset);
      };

      switch (toolType) {
        case "write-leditor":
          applyPresetId("write:main");
          break;
        case "code-panel":
          applyPresetId("code:main");
          break;
        case "visualiser":
          applyPresetId("visualiser:main");
          break;
        case "screen":
          applyPresetId("screen:main");
          // Ensure the Screen PDF viewer tab exists in panel 3.
          if (!screenPdfViewerToolId || !panelTools.getToolPanel(screenPdfViewerToolId)) {
            panelTools.ensureToolHost("panel3", { replaceContent: true });
            screenPdfViewerToolId = panelTools.spawnTool("screen-pdf-viewer", { panelId: "panel3" });
          }
          break;
        case "retrieve-datahub":
          applyPresetId(presetId || "retrieve:datahub");
          break;
        case "retrieve":
        case "retrieve-search-app":
          applyPresetId(presetId || "retrieve:search-empty");
          break;
        case "retrieve-search-meta":
          applyPresetId("retrieve:search-selected");
          break;
        case "retrieve-zotero-collections":
        case "retrieve-zotero-items":
        case "retrieve-zotero-detail":
          applyPresetId("retrieve:zotero");
          break;
        case "retrieve-citation-graph":
          applyPresetId("retrieve:search-graph");
          break;
        case "analyse-pdf-tabs":
          // If the pdf tab was spawned from Analyse, restore the last-known round layout if present.
          if (presetId) applyPresetId(presetId);
          break;
        default:
          // no-op: other tools can opt in by passing metadata.layoutPresetId
          if (presetId) applyPresetId(presetId);
          break;
      }
    } catch (err) {
      console.warn("[panel-focus] unable to apply preset for tool tab", { toolType, err });
    }
  }
});
const layoutRoot = panelTools.getRoot("panel2");

let activeRouteId: RouteId | null = null;

type AgentChatMessage = {
  role: "user" | "assistant";
  text: string;
  tone?: "error";
  at: number;
};

const agentChatState: {
  open: boolean;
  pending: boolean;
  messages: AgentChatMessage[];
  pendingIntent: Record<string, unknown> | null;
  pendingConfirmation: { type: "coding_questions"; intent: Record<string, unknown> } | null;
} = {
  open: false,
  pending: false,
  messages: [],
  pendingIntent: null,
  pendingConfirmation: null
};

function shouldShowAgentChat(): boolean {
  return activeRouteId === "retrieve:zotero";
}

function renderAgentChatMessages(): void {
  if (!agentChatMessages) return;
  agentChatMessages.innerHTML = "";
  const fragment = document.createDocumentFragment();
  agentChatState.messages.forEach((entry) => {
    const row = document.createElement("div");
    row.className = `agent-chat-msg ${entry.role}${entry.tone ? ` ${entry.tone}` : ""}`;
    row.textContent = entry.text || "(empty)";
    const meta = document.createElement("div");
    meta.className = "agent-chat-meta";
    const stamp = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.textContent = `${entry.role === "user" ? "You" : "Agent"} • ${stamp}`;
    row.appendChild(meta);
    fragment.appendChild(row);
  });
  agentChatMessages.appendChild(fragment);
  agentChatMessages.scrollTop = agentChatMessages.scrollHeight;
}

function pushAgentChatMessage(role: "user" | "assistant", text: string, tone?: "error"): void {
  agentChatState.messages.push({ role, text: String(text || "").trim(), tone, at: Date.now() });
  if (agentChatState.messages.length > 60) {
    agentChatState.messages = agentChatState.messages.slice(-60);
  }
  renderAgentChatMessages();
}

function setAgentChatPending(pending: boolean): void {
  agentChatState.pending = pending;
  if (agentChatInput) agentChatInput.disabled = pending;
  if (btnAgentChatSend) btnAgentChatSend.disabled = pending;
}

function setAgentChatOpen(open: boolean): void {
  if (!agentChatDock || !agentChatFab) return;
  agentChatState.open = open === true;
  agentChatDock.classList.toggle("open", agentChatState.open);
  agentChatDock.setAttribute("aria-hidden", agentChatState.open ? "false" : "true");
  agentChatFab.setAttribute("aria-label", agentChatState.open ? "Hide agent chat" : "Open agent chat");
  if (agentChatState.open && agentChatInput) {
    window.setTimeout(() => {
      agentChatInput.focus();
      agentChatInput.select();
    }, 0);
  }
}

function syncAgentChatVisibility(): void {
  if (!agentChatFab || !agentChatDock) return;
  const visible = shouldShowAgentChat();
  agentChatFab.style.display = visible ? "" : "none";
  agentChatDock.style.display = visible ? "" : "none";
  if (!visible) {
    setAgentChatOpen(false);
  }
}

function buildAgentContextPayload(): Record<string, unknown> {
  const state = retrieveZoteroContext.getState();
  const selectedCollection = retrieveZoteroContext.getSelectedCollection();
  const selectedItem = retrieveZoteroContext.getSelectedItem();
  return {
    routeId: activeRouteId || "",
    selectedCollectionKey: state.selectedCollectionKey || "",
    selectedCollectionName: selectedCollection?.name || "",
    selectedItemKey: selectedItem?.key || "",
    status: state.status || "",
    itemsCount: state.items.length,
    activeTags: state.activeTags
  };
}

function isChatAffirmative(text: string): boolean {
  const v = String(text || "").trim().toLowerCase();
  return ["yes", "y", "ok", "confirm", "approved", "approve", "go", "run"].includes(v);
}

function isChatNegative(text: string): boolean {
  const v = String(text || "").trim().toLowerCase();
  return ["no", "n", "cancel", "stop", "reject"].includes(v);
}

function parseResearchQuestionsInput(text: string): string[] {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\n+/)
    .map((line) => String(line || "").trim())
    .filter(Boolean);
  const numbered = lines
    .map((line) => {
      const m = line.match(/^\s*(\d+)[\)\].:\-]\s*(.+)$/);
      return m ? String(m[2] || "").trim() : "";
    })
    .filter(Boolean);
  const fallback = raw
    .split(/[;\n]+/)
    .map((s) => String(s || "").replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  return (numbered.length ? numbered : fallback).slice(0, 5);
}

async function executeResolvedIntent(intent: Record<string, unknown>): Promise<void> {
  if (!window.agentBridge?.executeIntent) {
    pushAgentChatMessage("assistant", "Agent execute bridge unavailable.", "error");
    setAgentChatPending(false);
    return;
  }
  const preflight = Array.isArray(intent?.preflightIntents) ? (intent.preflightIntents as Record<string, unknown>[]) : [];
  for (const pre of preflight) {
    const preRes = await window.agentBridge.executeIntent({
      intent: pre,
      confirm: true,
      context: buildAgentContextPayload()
    });
    if (preRes?.status !== "ok") {
      setAgentChatPending(false);
      pushAgentChatMessage("assistant", String(preRes?.message || "Preflight execution failed."), "error");
      return;
    }
  }
  const res = await window.agentBridge.executeIntent({
    intent,
    confirm: true,
    context: buildAgentContextPayload()
  });
  setAgentChatPending(false);

  if (res?.status !== "ok") {
    pushAgentChatMessage("assistant", String(res?.message || "Intent execution failed."), "error");
    return;
  }

  agentChatState.pendingIntent = null;
  const result = (res?.result || {}) as Record<string, unknown>;
  const functionName = String(res?.function || "");
  if (functionName === "legacy.refresh" || String(result?.action || "") === "zotero_refresh_tree") {
    applyRoute("retrieve:zotero");
    void retrieveZoteroContext.loadTree();
    pushAgentChatMessage("assistant", String(result?.reply || "Refreshing Zotero collections and items."));
    return;
  }
  if (functionName === "legacy.load_collection" || String(result?.action || "") === "zotero_load_selected_collection") {
    applyRoute("retrieve:zotero");
    void retrieveZoteroContext.loadSelectedCollectionToDataHub();
    pushAgentChatMessage("assistant", String(result?.reply || "Loading selected collection into Data Hub."));
    return;
  }
  if (functionName === "workflow.create_subfolder_by_topic") {
    applyRoute("retrieve:zotero");
    void retrieveZoteroContext.loadTree();
    pushAgentChatMessage("assistant", String(result?.reply || "Topic workflow completed."));
    return;
  }

  if (String(result?.function || res?.function || "") === "Verbatim_Evidence_Coding" || String(intent?.targetFunction || "") === "Verbatim_Evidence_Coding") {
    pushAgentChatMessage("assistant", "Verbatim_Evidence_Coding executed.");
    return;
  }
  pushAgentChatMessage("assistant", "Command executed successfully.");
}

async function runAgentChatCommand(text: string): Promise<void> {
  pushAgentChatMessage("user", text);
  if (!window.agentBridge?.resolveIntent || !window.agentBridge?.executeIntent) {
    pushAgentChatMessage("assistant", "Agent bridge is unavailable.", "error");
    return;
  }

  if (agentChatState.pendingConfirmation) {
    if (isChatAffirmative(text)) {
      const pending = agentChatState.pendingConfirmation;
      agentChatState.pendingConfirmation = null;
      setAgentChatPending(true);
      await executeResolvedIntent(pending.intent);
      return;
    }
    if (isChatNegative(text)) {
      agentChatState.pendingConfirmation = null;
      setAgentChatPending(false);
      pushAgentChatMessage("assistant", "Coding run canceled.");
      return;
    }
    const pendingIntent = agentChatState.pendingConfirmation.intent;
    const currentQuestions = Array.isArray((pendingIntent?.args as Record<string, unknown>)?.research_questions)
      ? (((pendingIntent?.args as Record<string, unknown>).research_questions as unknown[]).map((q) => String(q || "").trim()).filter(Boolean))
      : [];
    let revised: string[] = [];
    if (window.agentBridge?.refineCodingQuestions) {
      const ref = await window.agentBridge.refineCodingQuestions({
        currentQuestions,
        feedback: text,
        contextText: String((pendingIntent?.args as Record<string, unknown>)?.context || "")
      });
      if (ref?.status === "ok" && Array.isArray(ref?.questions) && ref.questions.length >= 3) {
        revised = ref.questions.slice(0, 5).map((q) => String(q || "").trim()).filter(Boolean);
      }
    }
    if (!revised.length) {
      const fallback = parseResearchQuestionsInput(text);
      if (fallback.length >= 3 && fallback.length <= 5) revised = fallback.slice(0, 5);
    }
    if (revised.length >= 3 && revised.length <= 5) {
      const args = ((pendingIntent?.args as Record<string, unknown>) || {});
      pendingIntent.args = { ...args, research_questions: revised };
      const screeningEnabled = (pendingIntent?.args as Record<string, unknown>)?.screening !== false;
      if (screeningEnabled && window.agentBridge?.generateEligibilityCriteria) {
        const regen = await window.agentBridge.generateEligibilityCriteria({
          userText: text,
          collectionName: String((pendingIntent?.args as Record<string, unknown>)?.collection_name || ""),
          contextText: String((pendingIntent?.args as Record<string, unknown>)?.context || ""),
          researchQuestions: revised
        });
        if (regen?.status === "ok") {
          const inclusion = Array.isArray(regen?.inclusion_criteria)
            ? regen.inclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
            : [];
          const exclusion = Array.isArray(regen?.exclusion_criteria)
            ? regen.exclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
            : [];
          if (inclusion.length && exclusion.length) {
            pendingIntent.preflightIntents = [
              {
                intentId: "feature.run",
                targetFunction: "set_eligibility_criteria",
                confidence: 0.9,
                riskLevel: "confirm",
                needsClarification: false,
                clarificationQuestions: [],
                args: {
                  collection_name: String((pendingIntent?.args as Record<string, unknown>)?.collection_name || ""),
                  inclusion_criteria: inclusion.join("\n"),
                  exclusion_criteria: exclusion.join("\n"),
                  eligibility_prompt_key: "paper_screener_abs_policy",
                  context: String((pendingIntent?.args as Record<string, unknown>)?.context || ""),
                  research_questions: revised
                }
              }
            ];
          }
        }
      }
      pushAgentChatMessage(
        "assistant",
        `Updated research questions:\n${revised.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReply with 'yes' to run or 'no' to cancel.`
      );
      return;
    }
    pushAgentChatMessage("assistant", "I could not infer a valid 3-5 question set. Reply with clearer question edits.");
    return;
  }

  setAgentChatPending(true);
  try {
    const resolved = await window.agentBridge.resolveIntent({
      text,
      context: {
        ...buildAgentContextPayload(),
        pendingIntent: agentChatState.pendingIntent || null
      }
    });
    if (resolved?.status !== "ok" || !resolved?.intent) {
      pushAgentChatMessage("assistant", String(resolved?.message || "Could not resolve command intent."), "error");
      return;
    }
    const intent = resolved.intent;
    if ((intent?.needsClarification as boolean) === true) {
      agentChatState.pendingIntent = intent;
      const qList = Array.isArray(intent?.clarificationQuestions) ? intent.clarificationQuestions : [];
      pushAgentChatMessage("assistant", qList.length ? `I need more detail:\n- ${qList.join("\n- ")}` : "I need more details.");
      return;
    }

    if (String(intent?.intentId || "") === "feature.run" && String(intent?.targetFunction || "") === "Verbatim_Evidence_Coding") {
      const args = (intent?.args as Record<string, unknown>) || {};
      const questions = Array.isArray(args.research_questions)
        ? (args.research_questions as unknown[]).map((q) => String(q || "").trim()).filter(Boolean)
        : [];
      const collectionName = String(args.collection_name || "").trim() || "(selected collection)";
      const screeningEnabled = args.screening !== false;
      if (questions.length >= 3 && questions.length <= 5) {
        if (screeningEnabled && window.agentBridge?.generateEligibilityCriteria) {
          const eligibilityDraft = await window.agentBridge.generateEligibilityCriteria({
            userText: text,
            collectionName,
            contextText: String(args.context || ""),
            researchQuestions: questions
          });
          if (eligibilityDraft?.status === "ok") {
            const inclusion = Array.isArray(eligibilityDraft?.inclusion_criteria)
              ? eligibilityDraft.inclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
              : [];
            const exclusion = Array.isArray(eligibilityDraft?.exclusion_criteria)
              ? eligibilityDraft.exclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
              : [];
            if (inclusion.length && exclusion.length) {
              intent.preflightIntents = [
                {
                  intentId: "feature.run",
                  targetFunction: "set_eligibility_criteria",
                  confidence: 0.9,
                  riskLevel: "confirm",
                  needsClarification: false,
                  clarificationQuestions: [],
                  args: {
                    collection_name: collectionName,
                    inclusion_criteria: inclusion.join("\n"),
                    exclusion_criteria: exclusion.join("\n"),
                    eligibility_prompt_key: "paper_screener_abs_policy",
                    context: String(args.context || ""),
                    research_questions: questions
                  }
                }
              ];
            }
          }
        }
        pushAgentChatMessage(
          "assistant",
          `I will run Verbatim_Evidence_Coding for '${collectionName}'.\nScreening: ${screeningEnabled ? "enabled" : "disabled"}.\n\nResearch questions:\n${questions
            .map((q, i) => `${i + 1}. ${q}`)
            .join("\n")}\n\nReply with 'yes' to run, 'no' to cancel, or send revised questions (3-5).`
        );
        agentChatState.pendingConfirmation = { type: "coding_questions", intent };
        return;
      }
    }

    await executeResolvedIntent(intent);
  } catch (error) {
    pushAgentChatMessage("assistant", String((error as Error)?.message || error || "Agent command failed."), "error");
  } finally {
    setAgentChatPending(false);
  }
}

function initAgentChatUi(): void {
  if (!agentChatFab || !agentChatDock || !agentChatForm || !agentChatInput || !btnAgentChatClose || !btnAgentChatClear) {
    return;
  }
  if (!agentChatState.messages.length) {
    pushAgentChatMessage("assistant", "Agent ready. Send a command to organize collections by tag.");
  }
  agentChatFab.addEventListener("click", () => setAgentChatOpen(!agentChatState.open));
  btnAgentChatClose.addEventListener("click", () => setAgentChatOpen(false));
  btnAgentChatClear.addEventListener("click", () => {
    agentChatState.messages = [];
    agentChatState.pendingIntent = null;
    agentChatState.pendingConfirmation = null;
    renderAgentChatMessages();
  });
  agentChatForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = String(agentChatInput.value || "").trim();
    if (!text || agentChatState.pending) return;
    agentChatInput.value = "";
    void runAgentChatCommand(text);
  });
  syncAgentChatVisibility();
}

function applyRoute(routeId: RouteId, options?: { skipEnsureTools?: boolean }): void {
  const route = ROUTES[routeId];
  if (!route) {
    console.warn("[route] unknown routeId", routeId);
    return;
  }
  activeRouteId = routeId;
  document.documentElement.classList.toggle("zotero-parity-mode", routeId === "retrieve:zotero");
  document.body.classList.toggle("zotero-parity-mode", routeId === "retrieve:zotero");
  syncAgentChatVisibility();

  const preset = PANEL_PRESETS[route.presetId];
  if (preset) {
    panelGrid.applyPreset(preset);
  }

  // Enforce: only widgets/tools for the last-clicked route remain.
  (["panel1", "panel2", "panel3", "panel4"] as PanelId[]).forEach((panelId) => {
    const allowed = route.allowedToolTypesByPanel[panelId] ?? [];
    panelTools.closePanelToolsExceptTypes(panelId, allowed);
  });

  if (options?.skipEnsureTools) {
    return;
  }

  // Ensure required tools exist for the route.
  (route.ensureTools || []).forEach((spec) => {
    try {
      panelTools.ensureToolHost(spec.panelId, { replaceContent: true });
      const id = panelTools.spawnTool(spec.toolType, {
        panelId: spec.panelId,
        metadata: { ...(spec.metadata || {}), layoutPresetId: route.presetId }
      });
      if (spec.focus) {
        panelTools.focusTool(id);
      }
    } catch (err) {
      console.warn("[route] unable to ensure tool", { routeId, spec, err });
    }
  });
}

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
    panelTools.spawnTool("write-leditor", { panelId: "panel2", metadata: { layoutPresetId: "write:main" } });
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
  // Keep the current layout while opening the PDF viewer (it temporarily takes over a panel).
  if (action === "analyse/open_pdf_viewer" && lastRoundWideLayout) return;

  if (action === "analyse/open_dashboard") {
    applyRoute("analyse:dashboard");
    lastRoundWideLayout = false;
    return;
  }
  if (action === "analyse/open_corpus") {
    applyRoute("analyse:corpus");
    lastRoundWideLayout = false;
    return;
  }
  if (action === "analyse/open_sections_r1") {
    applyRoute("analyse:r1");
    lastRoundWideLayout = false;
    return;
  }
  if (action === "analyse/open_phases") {
    applyRoute("analyse:phases");
    lastRoundWideLayout = false;
    return;
  }
  if (action === "analyse/open_sections_r2") {
    applyRoute("analyse:r2");
    lastRoundWideLayout = true;
    return;
  }
  if (action === "analyse/open_sections_r3") {
    applyRoute("analyse:r3");
    lastRoundWideLayout = true;
    return;
  }

  // Fallback: restore the default workspace parts.
  lastRoundWideLayout = false;
  panelGrid.applyPreset({
    id: "default",
    roundLayout: false,
    layoutHint: null,
    collapsed: { panel1: false, panel2: false, panel3: false, panel4: false },
    ratios: { ...DEFAULT_PANEL_PARTS }
  });
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
  const panelId = targetPanel === 1 ? "panel1" : targetPanel === 2 ? "panel2" : targetPanel === 3 ? "panel3" : "panel4";
  panelGrid.ensurePanelVisible(targetPanel);
  panelTools.ensureToolHost(panelId, { replaceContent: true });
  // Each click opens a new tab; previous viewers remain accessible.
  const analyseState = analyseStore.getState();
  const layoutPresetId =
    analyseState.activeRound === "r3" ? "analyse:r3" : analyseState.activeRound === "r2" ? "analyse:r2" : "analyse:r1";
  const toolId = panelTools.spawnTool("analyse-pdf-tabs", {
    panelId,
    metadata: { payload, rawPayload, layoutPresetId }
  });
  panelTools.focusTool(toolId);
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
  "export",
  "retrieve",
  "screen",
  "code",
  "visualiser",
  "analyse",
  "write",
  "settings",
  "tools"
];
const sectionToolIds: Partial<Record<TabId, string>> = {};
let screenPdfViewerToolId: string | null = null;

let activeTab: TabId = "export";

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
  initialTab: "export",
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
    if (showAnalyse) {
      // Entering Analyse should always start from a clean, single-panel dashboard layout
      // (no carryover like retrieve citation graph splitting the workspace).
      applyRoute("analyse:dashboard");
      analyseWorkspace.openPageByAction("analyse/open_dashboard");
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
initAgentChatUi();

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
  applyRoute("retrieve:datahub");
});

document.addEventListener("retrieve:open-graph", (event) => {
  const detail = (event as CustomEvent<{ record?: RetrieveRecord; network?: unknown }>).detail;
  applyRoute("retrieve:graph", { skipEnsureTools: true });
  openRetrieveGraph(detail?.record, detail?.network);
});

document.addEventListener("retrieve:close-graph", () => {
  closeRetrieveGraph();
  const record = retrieveSearchSelectedRecord;
  if (record) {
    applyRoute("retrieve:search-selected");
  } else {
    applyRoute("retrieve:search");
  }
});

document.addEventListener("retrieve:search-selection", (event) => {
  const detail = (event as CustomEvent<{ record?: RetrieveRecord }>).detail;
  retrieveSearchSelectedRecord = detail?.record;
  if (!retrieveSearchSelectedRecord) {
    applyRoute("retrieve:search");
    return;
  }
  if (retrieveGraphToolId) {
    if (retrieveSearchSelectedRecord?.paperId) {
      document.dispatchEvent(
        new CustomEvent("retrieve:graph-highlight", { detail: { paperId: retrieveSearchSelectedRecord.paperId } })
      );
    }
    return;
  }
  applyRoute("retrieve:search-selected");
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

  const analyseDataBtn = document.createElement("button");
  analyseDataBtn.type = "button";
  analyseDataBtn.className = "ribbon-button ribbon-button--compact";
  analyseDataBtn.textContent = "Analyse data";
  analyseDataBtn.addEventListener("click", () => {
    void openAnalyseDataModal();
  });
  dashboardRow.appendChild(analyseDataBtn);

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

  async function openAnalyseDataModal(): Promise<void> {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "modal";
    dialog.style.maxWidth = "820px";
    const title = document.createElement("h3");
    title.textContent = "Analyse data (cached tables)";
    dialog.appendChild(title);

    const status = document.createElement("div");
    status.className = "status-bar";
    status.textContent = "Loading cached tables…";
    dialog.appendChild(status);

    const form = document.createElement("div");
    form.style.display = "grid";
    form.style.gridTemplateColumns = "1fr 1fr";
    form.style.gap = "10px 14px";
    form.style.marginTop = "10px";
    dialog.appendChild(form);

    const makeRow = (labelText: string, field: HTMLElement) => {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.flexDirection = "column";
      label.style.gap = "6px";
      const l = document.createElement("span");
      l.textContent = labelText;
      l.style.fontSize = "12px";
      l.style.color = "var(--muted)";
      label.append(l, field);
      return label;
    };

    const tableSelect = document.createElement("select");
    tableSelect.style.width = "100%";
    form.appendChild(makeRow("Cached table", tableSelect));

    const scopeSelect = document.createElement("select");
    ["All rows", "Selected rows", "Row indices"].forEach((label) => {
      const opt = document.createElement("option");
      opt.value = label;
      opt.textContent = label;
      scopeSelect.appendChild(opt);
    });
    form.appendChild(makeRow("Scope", scopeSelect));

    const indicesInput = document.createElement("input");
    indicesInput.type = "text";
    indicesInput.placeholder = "e.g. 0,1,2 (only for Row indices)";
    form.appendChild(makeRow("Row indices", indicesInput));

    const datesInput = document.createElement("input");
    datesInput.type = "text";
    datesInput.placeholder = "e.g. 2010-2018; 2019-2024";
    form.appendChild(makeRow("Dates", datesInput));

    const batchSize = document.createElement("input");
    batchSize.type = "number";
    batchSize.value = "50";
    batchSize.min = "5";
    batchSize.max = "500";
    form.appendChild(makeRow("Batch size", batchSize));

    const overlap = document.createElement("input");
    overlap.type = "number";
    overlap.value = "10";
    overlap.min = "0";
    overlap.max = "100";
    form.appendChild(makeRow("Overlap", overlap));

    const round2 = document.createElement("select");
    ["paragraphs", "sentences"].forEach((value) => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value;
      round2.appendChild(opt);
    });
    form.appendChild(makeRow("Round 2 mode", round2));

    const framework = document.createElement("label");
    framework.style.display = "flex";
    framework.style.alignItems = "center";
    framework.style.gap = "8px";
    const frameworkCb = document.createElement("input");
    frameworkCb.type = "checkbox";
    frameworkCb.checked = true;
    const frameworkTxt = document.createElement("span");
    frameworkTxt.textContent = "Framework analysis";
    framework.append(frameworkCb, frameworkTxt);
    const frameworkWrap = document.createElement("div");
    frameworkWrap.style.gridColumn = "1 / -1";
    frameworkWrap.appendChild(framework);
    form.appendChild(frameworkWrap);

    const prompt = document.createElement("textarea");
    prompt.rows = 4;
    prompt.placeholder = "Extra prompt…";
    const promptWrap = makeRow("Prompt", prompt);
    promptWrap.style.gridColumn = "1 / -1";
    form.appendChild(promptWrap);

    const logs = document.createElement("pre");
    logs.style.marginTop = "10px";
    logs.style.maxHeight = "220px";
    logs.style.overflow = "auto";
    logs.style.background = "color-mix(in srgb, var(--panel-2) 70%, transparent)";
    logs.style.border = "1px solid var(--border-soft)";
    logs.style.borderRadius = "10px";
    logs.style.padding = "10px";
    logs.style.fontSize = "12px";
    logs.textContent = "";
    dialog.appendChild(logs);

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancel = document.createElement("button");
    cancel.className = "ribbon-button ghost";
    cancel.textContent = "Close";
    cancel.addEventListener("click", () => backdrop.remove());
    const run = document.createElement("button");
    run.className = "ribbon-button";
    run.textContent = "Run";
    actions.append(cancel, run);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const appendLog = (line: string) => {
      logs.textContent = `${logs.textContent || ""}${line}\n`;
      logs.scrollTop = logs.scrollHeight;
    };

    const tables = (await window.analyseBridge?.data.listCachedTables?.().catch(() => [])) as Array<{
      fileName: string;
      filePath: string;
      mtimeMs: number;
      rows: number;
      cols: number;
    }>;
    tableSelect.innerHTML = "";
    if (!tables.length) {
      status.textContent = "No cached tables found.";
      const opt = document.createElement("option");
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = "No cached tables";
      tableSelect.appendChild(opt);
      run.disabled = true;
      return;
    }
    status.textContent = `Found ${tables.length} cached table(s).`;
    tables.forEach((t, idx) => {
      const opt = document.createElement("option");
      opt.value = t.filePath;
      opt.textContent = `${t.fileName} (${t.rows}×${t.cols})`;
      if (idx === 0) opt.selected = true;
      tableSelect.appendChild(opt);
    });

    run.addEventListener("click", async () => {
      run.disabled = true;
      status.textContent = "Running…";
      logs.textContent = "";
      const tablePath = tableSelect.value;
      const scopeLabel = scopeSelect.value;
      const rowIndices =
        scopeLabel === "Row indices"
          ? indicesInput.value
              .split(/[\\s,;]+/g)
              .map((x) => Number(x))
              .filter((n) => Number.isFinite(n) && n >= 0)
          : null;

      const aiPayload = {
        tablePath,
        ai: {
          data_scope: scopeLabel,
          dates: datesInput.value,
          batch_size: Number(batchSize.value) || 50,
          batch_overlapping: Number(overlap.value) || 10,
          framework_analysis: Boolean(frameworkCb.checked),
          round2: round2.value,
          prompt: prompt.value
        },
        scope: rowIndices ? { rowIndices } : {}
      };

      appendLog(`[AI] table=${tablePath}`);
      try {
        const resp = await window.analyseBridge?.data.runAiOnTable?.(aiPayload);
        const asAny = resp as any;
        const ok = Boolean(asAny?.success);
        if (Array.isArray(asAny?.logs)) {
          asAny.logs.forEach((l: any) => appendLog(String(l)));
        }
        if (ok) {
          status.textContent = "Done.";
          appendLog(JSON.stringify(asAny?.result ?? {}, null, 2));
        } else {
          status.textContent = "Failed.";
          appendLog(`[ERROR] ${String(asAny?.error || "unknown")}`);
        }
      } catch (err: any) {
        status.textContent = "Failed.";
        appendLog(`[ERROR] ${String(err?.message || err)}`);
      } finally {
        run.disabled = false;
      }
    });
  }

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

function findPdfViewerIframeBySource(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source) return null;
  const iframes = document.querySelectorAll<HTMLIFrameElement>("iframe[data-pdf-app-viewer='true']");
  for (let i = 0; i < iframes.length; i += 1) {
    const iframe = iframes[i];
    if (iframe && iframe.contentWindow === source) return iframe;
  }
  return null;
}

function handlePdfSelectionMessage(event: MessageEvent): void {
  const data = (event.data as PdfSelectionMessage | undefined) || null;
  if (!data || data.type !== "pdf-selection") {
    return;
  }
  if (!findPdfViewerIframeBySource(event.source)) return;
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
  const iframe = findPdfViewerIframeBySource(event.source);
  if (!iframe) return;
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
  const targetWin = iframe.contentWindow;
  if (!targetWin) return;
  if (!result || result.status !== "ok" || !result.pdfPath) {
    const message = (result && (result.message || result.error)) ? String(result.message || result.error) : "OCR failed";
    targetWin.postMessage(
      { type: "pdf-ocr-error", payload: { message } },
      "*"
    );
    return;
  }
  targetWin.postMessage(
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
  box-shadow: var(--shadow, 0 24px 48px rgba(0, 0, 0, 0.65));
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
    const commandAction = action.command.action;
    const zoteroAction = commandAction === "datahub_load_zotero" || commandAction === "datahub_load_zotero_multi";
    if (zoteroAction) {
      // Zotero now uses its own dedicated 3-panel workspace (collections, items, detail).
      applyRoute("retrieve:zotero");
      retrieveSearchSelectedRecord = undefined;
      void retrieveZoteroContext.loadTree();
      return;
    }
    // Non-Zotero DataHub actions still target the DataHub tool in panel 2.
    applyRoute("retrieve:datahub");
    ensureRetrieveDataHubTool({ replace: !retrieveDataHubToolId });
    retrieveSearchSelectedRecord = undefined;
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
    retrieveSearchSelectedRecord = undefined;
    applyRoute("retrieve:search");
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "zotero_refresh_tree") {
    applyRoute("retrieve:zotero");
    retrieveSearchSelectedRecord = undefined;
    void retrieveZoteroContext.loadTree();
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "zotero_load_selected_collection") {
    applyRoute("retrieve:zotero");
    retrieveSearchSelectedRecord = undefined;
    void retrieveZoteroContext.loadSelectedCollectionToDataHub();
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
    applyRoute("retrieve:search");
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "retrieve_set_sort") {
    const defaults = readRetrieveQueryDefaults();
    const raw = window.prompt(`Sort (relevance, year)\n\nCurrent: ${defaults.sort}`, String(defaults.sort));
    if (raw === null) return;
    writeRetrieveQueryDefaults({ sort: raw.trim() as RetrieveSort });
    applyRoute("retrieve:search");
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
    applyRoute("retrieve:search");
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
    applyRoute("retrieve:search");
    return;
  }
  if (action.command.phase === "tools" && action.command.action === "open_tool") {
    const payload = action.command.payload as { toolType?: string; panelId?: string; metadata?: Record<string, unknown> } | undefined;
    if (payload?.toolType) {
      const panelId = (payload.panelId as PanelId | undefined) ?? "panel2";
      panelTools.ensureToolHost(panelId, { replaceContent: true });
      // Open tools as tabs (do not wipe out previous widgets/tools).
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
  viewerHost.style.background = "var(--panel, #252526)";
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

function resolveTestPdfPath(requested?: string): string | undefined {
  if (!requested) {
    return undefined;
  }
  return TEST_PDF_PATH_OVERRIDES[requested] ?? requested;
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
  if (options?.replace) {
    panelTools.clearPanelTools("panel2");
    Object.entries(sectionToolIds).forEach(([key, toolId]) => {
      if (!toolId) return;
      if (!panelTools.getToolPanel(toolId)) {
        delete sectionToolIds[key as TabId];
      }
    });
  }
  if (tabId === "retrieve") {
    // Default retrieve entry: DataHub.
    applyRoute("retrieve:datahub");
  }
  if (tabId === "write") {
    console.info("[WRITE][NAV] clicked Write tab; ensuring editor in panel 2");
    applyRoute("write:main");
    debugLogPanelState(2, "after Write click");
    ensureWriteToolTab();
  }
  if (tabId === "code") {
    applyRoute("code:main");
  }
  if (tabId === "screen") {
    applyRoute("screen:main");
    // Panel 3: PDF viewer as a tool tab (so previous widgets remain as tabs).
    try {
      panelTools.ensureToolHost("panel3", { replaceContent: true });
      if (screenPdfViewerToolId && !panelTools.getToolPanel(screenPdfViewerToolId)) {
        screenPdfViewerToolId = null;
      }
      if (!screenPdfViewerToolId) {
        screenPdfViewerToolId = panelTools.spawnTool("screen-pdf-viewer", { panelId: "panel3" });
      }
      panelTools.focusTool(screenPdfViewerToolId);
    } catch (err) {
      console.warn("[screen] unable to ensure screen pdf viewer tool", err);
    }
  }
  const existing = sectionToolIds[tabId];
  if (existing) {
    // If the tool was closed/destroyed, clear the stale id and recreate.
    const existingPanel = panelTools.getToolPanel(existing);
    if (!existingPanel) {
      delete sectionToolIds[tabId];
    } else {
      if (tabId === "retrieve") {
        const currentPanel = existingPanel;
        if (currentPanel && currentPanel !== "panel2") {
          panelTools.moveTool(existing, "panel2");
        }
      }
      if (tabId === "visualiser") {
        ensureVisualiserPanelsVisible();
      }
      scheduleRaf(() => panelTools.focusTool(existing));
      return;
    }
  }
  const id = panelTools.spawnTool(config.toolType, { panelId: "panel2", metadata: config.metadata });
  sectionToolIds[tabId] = id;
  scheduleRaf(() => panelTools.focusTool(id));
  if (tabId === "visualiser") {
    applyRoute("visualiser:main");
  }
}

function ensureRetrieveDataHubTool(options?: { replace?: boolean }): void {
  if (options?.replace) {
    panelTools.clearPanelTools("panel2");
    retrieveDataHubToolId = undefined;
    retrieveQueryToolId = undefined;
    retrieveSearchAppToolId = undefined;
    delete sectionToolIds["retrieve"];
  }
  if (retrieveDataHubToolId && !panelTools.getToolPanel(retrieveDataHubToolId)) {
    retrieveDataHubToolId = undefined;
  }
  if (retrieveDataHubToolId) {
    scheduleRaf(() => panelTools.focusTool(retrieveDataHubToolId!));
    return;
  }
  const id = panelTools.spawnTool("retrieve-datahub", { panelId: "panel2", metadata: { layoutPresetId: "retrieve:datahub" } });
  retrieveDataHubToolId = id;
  scheduleRaf(() => panelTools.focusTool(id));
}

function ensureRetrieveQueryBuilderTool(options?: { replace?: boolean }): void {
  if (options?.replace) {
    panelTools.clearPanelTools("panel2");
    retrieveDataHubToolId = undefined;
    retrieveQueryToolId = undefined;
    retrieveSearchAppToolId = undefined;
    delete sectionToolIds["retrieve"];
  }
  if (retrieveQueryToolId) {
    scheduleRaf(() => panelTools.focusTool(retrieveQueryToolId!));
    return;
  }
  const id = panelTools.spawnTool("retrieve", { panelId: "panel2", metadata: { layoutPresetId: "retrieve:search-empty" } });
  retrieveQueryToolId = id;
  scheduleRaf(() => panelTools.focusTool(id));
}

function ensureRetrieveSearchAppTool(): void {
  if (retrieveSearchAppToolId && !panelTools.getToolPanel(retrieveSearchAppToolId)) {
    retrieveSearchAppToolId = undefined;
  }
  if (retrieveSearchAppToolId) {
    scheduleRaf(() => panelTools.focusTool(retrieveSearchAppToolId!));
    return;
  }
  const id = panelTools.spawnTool("retrieve-search-app", { panelId: "panel2", metadata: { layoutPresetId: "retrieve:search-empty" } });
  retrieveSearchAppToolId = id;
  scheduleRaf(() => panelTools.focusTool(id));
}

function ensureRetrieveSearchMetaTool(options?: { replace?: boolean }): void {
  if (options?.replace) {
    if (retrieveMetaToolId) {
      panelTools.closeTool(retrieveMetaToolId);
      retrieveMetaToolId = undefined;
    }
  }
  if (retrieveMetaToolId) {
    scheduleRaf(() => panelTools.focusTool(retrieveMetaToolId!));
    return;
  }
  const id = panelTools.spawnTool("retrieve-search-meta", { panelId: "panel4", metadata: { layoutPresetId: "retrieve:search-selected" } });
  retrieveMetaToolId = id;
  scheduleRaf(() => panelTools.focusTool(id));
}

function closeRetrieveMetaTool(): void {
  if (!retrieveMetaToolId) return;
  panelTools.closeTool(retrieveMetaToolId);
  retrieveMetaToolId = undefined;
}

function setRetrieveLayout(mode: "datahub" | "search-empty" | "search-selected" | "search-graph"): void {
  if (mode === "datahub") {
    panelGrid.applyPreset(PANEL_PRESETS["retrieve:datahub"]);
    panelGrid.ensurePanelVisible(2);
    return;
  }

  if (mode === "search-empty") {
    panelGrid.applyPreset(PANEL_PRESETS["retrieve:search-empty"]);
    panelGrid.ensurePanelVisible(2);
    return;
  }

  if (mode === "search-selected") {
    panelGrid.applyPreset(PANEL_PRESETS["retrieve:search-selected"]);
    panelGrid.ensurePanelVisible(2);
    panelGrid.ensurePanelVisible(4);
    return;
  }

  panelGrid.applyPreset(PANEL_PRESETS["retrieve:search-graph"]);
  panelGrid.ensurePanelVisible(2);
  panelGrid.ensurePanelVisible(3);
}

function openRetrieveGraph(record?: RetrieveRecord, network?: unknown): void {
  if (!record) {
    return;
  }
  setRetrieveLayout("search-graph");
  panelTools.ensureToolHost("panel3", { replaceContent: true });
  // Open graph as a new tab (do not wipe out previous tools).
  retrieveGraphToolId = panelTools.spawnTool("retrieve-citation-graph", {
    panelId: "panel3",
    metadata: { record, network }
  });
  panelTools.focusTool(retrieveGraphToolId);
}

function closeRetrieveGraph(): void {
  if (retrieveGraphToolId) {
    panelTools.closeTool(retrieveGraphToolId);
  }
  retrieveGraphToolId = undefined;
  panelGrid.setCollapsed("panel3", true);
  panelGrid.setRatios({ panel3: 0 });
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
  panelGrid.applyPreset(PANEL_PRESETS["visualiser:main"]);
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
