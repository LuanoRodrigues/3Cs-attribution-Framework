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
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  OpenAIRealtimeWebRTC,
  RealtimeAgent,
  RealtimeSession,
  tool
} from "@openai/agents/realtime";
import { z } from "zod";
import { GENERAL_KEYS, LLM_KEYS } from "../config/settingsKeys";
import { PdfTestPayload, CoderTestNode } from "../test/testFixtures";
import { CoderPanel } from "../panels/coder/CoderPanel";
import { attachGlobalCoderDragSources } from "../panels/coder/coderDragSource";
import type { CoderNode } from "../panels/coder/coderTypes";
import { getDefaultCoderScope } from "../analyse/collectionScope";
import { initAnalyseAudioController } from "./analyseAudio";
import { initPerfOverlay } from "./perfOverlay";
import { readRetrieveQueryDefaults, writeRetrieveQueryDefaults } from "../state/retrieveQueryDefaults";
import type { RetrieveQueryDefaults } from "../state/retrieveQueryDefaults";
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
import { createRetrieveSearchProgressTool } from "../tools/retrieveSearchProgress";
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
registry.register(createRetrieveSearchProgressTool());
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
const AGENT_VOICE_API_KEY_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedAgentVoiceApiKey: { value: string; at: number } | null = null;
const clearAgentVoiceConfigCache = (): void => {
  cachedAgentVoiceApiKey = null;
};
window.addEventListener("settings:updated", () => {
  syncAllPdfViewersTheme();
  clearAgentVoiceConfigCache();
});

type VoiceCommandExecutionOptions = {
  fromVoice?: boolean;
  fromRealtime?: boolean;
};

type AgentCommandSource = "chat" | "voice" | "realtime";

type AgentCommandGuardrailResult = {
  status: "ok" | "warn" | "reject";
  normalized: string;
  message?: string;
};

type AgentRunContext = {
  source: AgentCommandSource;
  routeId: RouteId | "";
  routeLabel: string;
  selectedCollectionKey: string;
  selectedCollectionName: string;
  selectedItemKey: string;
  status: string;
  itemsCount: number;
  activeTags?: unknown;
  selectedAnalyseRunPath: string;
  analyseRunPath: string;
  analyseBaseDir: string;
  activeRunPath: string;
  selectedAnalyseBaseDir: string;
  selectedRunPath: string;
  selectedAnalysePath: string;
  runPath: string;
  activeRunId: string;
  dir_base: string;
  analysisBaseDir?: string;
  run_id?: string;
  commandText: string;
  fromVoice: boolean;
  fromRealtime: boolean;
  commandLength: number;
  commandWordCount: number;
  hasZoteroState: boolean;
  hasAnalyseState: boolean;
};

type AgentRuntimeTelemetry = {
  sessionStarts: number;
  sessionEnds: number;
  handoffs: number;
  toolStarts: number;
  toolEnds: number;
  mcpToolCompletes: number;
  guardrailRejects: number;
  totalCommands: number;
  acceptedCommands: number;
  rejectedCommands: number;
  toolFailures: number;
};

const VOICE_COMMAND_MAX_LENGTH = 1200;
const agentRuntimeTelemetry: AgentRuntimeTelemetry = {
  sessionStarts: 0,
  sessionEnds: 0,
  handoffs: 0,
  toolStarts: 0,
  toolEnds: 0,
  mcpToolCompletes: 0,
  guardrailRejects: 0,
  totalCommands: 0,
  acceptedCommands: 0,
  rejectedCommands: 0,
  toolFailures: 0
};
const agentCommandGuards = [
  /<\s*script\b/i,
  /javascript:/i,
  /data:\s*text\/html/i,
  /\beval\s*\(/i,
  /\bdelete\s+all\b/i
];

const dbgAgent = (fn: string, msg: string, details?: Record<string, unknown>): void => {
  if (details) {
    console.debug(`[index.ts][${fn}][debug] ${msg}`, details);
    return;
  }
  console.debug(`[index.ts][${fn}][debug] ${msg}`);
};

const recordAgentTelemetry = (fn: string, update: Partial<AgentRuntimeTelemetry>): void => {
  Object.entries(update).forEach(([key, value]) => {
    if (typeof value === "number") {
      const current = (agentRuntimeTelemetry as Record<string, number>)[key];
      if (typeof current === "number") {
        (agentRuntimeTelemetry as Record<string, number>)[key] = current + value;
      }
    }
  });
  dbgAgent(fn, "agent telemetry update", { ...agentRuntimeTelemetry });
};

const shouldSpeakVoiceReply = (options?: VoiceCommandExecutionOptions): boolean =>
  Boolean((options?.fromVoice && !options?.fromRealtime) || (agentVoiceState.speechOutputMode && !options?.fromRealtime));

const buildAgentContextPayloadForText = (text: string, options?: VoiceCommandExecutionOptions): AgentRunContext => {
  const commandText = String(text || "").trim();
  const context = buildAgentContextPayload({
    fromVoice: Boolean(options?.fromVoice),
    fromRealtime: Boolean(options?.fromRealtime),
    commandText,
    source: options?.fromRealtime ? "realtime" : options?.fromVoice ? "voice" : "chat"
  });
  return {
    ...context,
    source: options?.fromRealtime ? "realtime" : options?.fromVoice ? "voice" : "chat",
    commandText,
    fromVoice: Boolean(options?.fromVoice),
    fromRealtime: Boolean(options?.fromRealtime),
    commandLength: commandText.length,
    commandWordCount: commandText.split(/\s+/).filter(Boolean).length
  };
};

const validateVoiceCommandText = (rawText: string, options?: VoiceCommandExecutionOptions): AgentCommandGuardrailResult => {
  const commandText = String(rawText || "").trim();
  if (!commandText) {
    return { status: "reject", normalized: "", message: "I did not hear a command." };
  }
  if (commandText.length > VOICE_COMMAND_MAX_LENGTH) {
    return {
      status: "reject",
      normalized: commandText.slice(0, VOICE_COMMAND_MAX_LENGTH),
      message: "That command is too long. Try a shorter phrase."
    };
  }
  const normalized = normalizeVoiceText(commandText);
  if (agentCommandGuards.some((guard) => guard.test(commandText))) {
    agentRuntimeTelemetry.guardrailRejects++;
    recordAgentTelemetry("validateVoiceCommandText", { guardrailRejects: 1 });
    return { status: "reject", normalized, message: "This command is blocked by safety validation." };
  }
  if (!/[a-z0-9]/i.test(commandText)) {
    return { status: "warn", normalized, message: "I did not detect a clear action. Please restate the command." };
  }
  return { status: "ok", normalized };
};

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
const btnAgentChatDictation = document.getElementById("btnAgentChatDictation") as HTMLButtonElement | null;
const btnAgentChatMic = document.getElementById("btnAgentChatMic") as HTMLButtonElement | null;
const agentChatVoiceStatus = document.getElementById("agentChatVoiceStatus") as HTMLDivElement | null;
const agentChatVoiceLegend = document.getElementById("agentChatVoiceLegend") as HTMLDivElement | null;
const agentChatPhaseBadge = document.getElementById("agentChatPhaseBadge") as HTMLSpanElement | null;
const btnAgentChatClose = document.getElementById("btnAgentChatClose") as HTMLButtonElement | null;
const btnAgentChatClear = document.getElementById("btnAgentChatClear") as HTMLButtonElement | null;
const agentChatAudio = document.getElementById("agentChatAudio") as HTMLAudioElement | null;
const agentChatFabIcon = agentChatFab
  ? (agentChatFab.querySelector(".agent-chat-fab-icon .agent-voice-icon") as HTMLSpanElement | null)
  : null;
const btnAgentChatMicIcon = btnAgentChatMic
  ? (btnAgentChatMic.querySelector(".agent-chat-mic-icon .agent-voice-icon") as HTMLSpanElement | null)
  : null;
const btnAgentChatDictationIcon = btnAgentChatDictation
  ? (btnAgentChatDictation.querySelector(".agent-chat-mic-icon .agent-voice-icon") as HTMLSpanElement | null)
  : null;
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
let pendingAcademicSearchIntake:
  | {
      step: "awaiting_details" | "awaiting_approval";
      query: string;
      strategySeed: string;
      generatedStrategy: string;
      detailsText: string;
      maxPages: number;
      headed: boolean;
      browserProviders: string[];
    }
  | null = null;
let pendingUnifiedSearchRetry:
  | {
      query: string;
      strategy: string;
      maxPages: number;
      headed: boolean;
      providers: string[];
      failedProviders: string[];
      attempts: number;
    }
  | null = null;
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
  pendingConfirmation: { type: "coding_questions" | "coding_mode"; intent: Record<string, unknown> } | null;
} = {
  open: false,
  pending: false,
  messages: [],
  pendingIntent: null,
  pendingConfirmation: null
};
let teardownDictationDelta: (() => void) | null = null;
let teardownDictationCompleted: (() => void) | null = null;
let teardownDictationError: (() => void) | null = null;

const agentVoiceState: {
  mediaRecorder: MediaRecorder | null;
  stream: MediaStream | null;
  chunks: Blob[];
  mimeType: string;
  speechRequestId: number;
  isProcessing: boolean;
  ttsModel: string;
  ttsVoice: string;
  transcribeModel: string;
  speechOutputMode: boolean;
  nativeCaptureActive: boolean;
  captureMode: "dictation" | "voice" | null;
  dictationSessionId: number;
  dictationBaseInput: string;
  dictationDraftTranscript: string;
  dictationProcessing: boolean;
} = {
  mediaRecorder: null,
  stream: null,
  chunks: [],
  mimeType: "audio/webm",
  speechRequestId: 0,
  isProcessing: false,
  ttsModel: "tts-1",
  ttsVoice: "alloy",
  transcribeModel: "whisper-1",
  speechOutputMode: false,
  nativeCaptureActive: false,
  captureMode: null,
  dictationSessionId: 0,
  dictationBaseInput: "",
  dictationDraftTranscript: "",
  dictationProcessing: false
};

let activeSpeechObjectUrl: string | null = null;
let activeRealtimeSession: RealtimeSession | null = null;
let realtimeSessionConnecting = false;
let activeRealtimeInputStream: MediaStream | null = null;
let activeRealtimeAudioContext: AudioContext | null = null;
let activeRealtimeAudioCursor = 0;
let realtimeSilentAudioChunkCount = 0;
const seenRealtimeTranscriptIds = new Set<string>();
const AGENT_REALTIME_CONNECT_TIMEOUT_MS = 12000;
const AGENT_REALTIME_OUTPUT_SAMPLE_RATE = 24000;
const activeRealtimeAudioSources = new Set<AudioBufferSourceNode>();
const AGENT_REALTIME_SILENT_CHUNK_THRESHOLD = 12;
const AGENT_DICTATION_STREAM_TIMESLICE_MS = 1100;
let activeDictationBridgeSessionId = 0;

const isMissingMicrophoneError = (error: unknown): boolean => {
  const message = String((error as Error)?.message || error || "").toLowerCase();
  if (!message) return false;
  return (
    message.includes("requested device not found") ||
    message.includes("notfounderror") ||
    message.includes("no input device") ||
    message.includes("device not found") ||
    message.includes("overconstrainederror")
  );
};

const resolvePreferredMicId = async (): Promise<string> => {
  if (!window.settingsBridge?.getValue) return "";
  try {
    const raw = await window.settingsBridge.getValue(LLM_KEYS.openaiVoiceInputDeviceId, "");
    return String(raw || "").trim();
  } catch {
    return "";
  }
};

type DictationMode = "insert_only" | "auto_send_after_transcription";

const resolveDictationMode = async (): Promise<DictationMode> => {
  if (!window.settingsBridge?.getValue) return "insert_only";
  try {
    const raw = await window.settingsBridge.getValue(LLM_KEYS.openaiVoiceDictationMode, "insert_only");
    const normalized = String(raw || "").trim();
    if (normalized === "auto_send_after_transcription") {
      return "auto_send_after_transcription";
    }
  } catch {
    // ignore and use default
  }
  return "insert_only";
};

const getVoiceInputStream = async (): Promise<MediaStream> => {
  if (!window.navigator?.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable in this environment.");
  }
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  };
  const preferredMicId = await resolvePreferredMicId();
  const attempts: MediaTrackConstraints[] = [];
  if (preferredMicId) {
    attempts.push({ ...base, deviceId: { exact: preferredMicId } });
  }
  attempts.push({ ...base, deviceId: { ideal: "default" } });
  attempts.push(base);
  let lastError: unknown = null;
  for (const audio of attempts) {
    try {
      const stream = await window.navigator.mediaDevices.getUserMedia({ audio });
      const hasTrack = stream.getAudioTracks().some((track) => track.readyState === "live");
      if (hasTrack) {
        return stream;
      }
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Could not open a microphone input stream.");
};

const resolveOpenAiApiKeyForRealtime = async (): Promise<string | null> => {
  if (cachedAgentVoiceApiKey && Date.now() - cachedAgentVoiceApiKey.at < AGENT_VOICE_API_KEY_CACHE_TTL_MS) {
    return cachedAgentVoiceApiKey.value;
  }
  if (!window.settingsBridge) return null;
  let apiKey: string | undefined;
  try {
    const secretValue = await window.settingsBridge.getSecret(LLM_KEYS.openaiKey);
    if (secretValue) {
      apiKey = String(secretValue).trim();
    }
  } catch {
    apiKey = undefined;
  }
  if (!apiKey && window.settingsBridge.getValue) {
    const fallbackValue = await window.settingsBridge.getValue(LLM_KEYS.openaiKey, "");
    if (fallbackValue) {
      apiKey = String(fallbackValue).trim();
    }
  }
  const trimmed = String(apiKey || "").trim();
  cachedAgentVoiceApiKey = { value: trimmed, at: Date.now() };
  return trimmed || null;
};

const buildVoiceActionTool = () =>
  tool({
    name: "execute_voice_command",
    description:
      "Run a direct command in the app from speech. Use the `command` text from the user and execute it as if typed in the chat box.",
    parameters: z.object({
      command: z.string().trim().min(1)
    }),
    execute: async ({ command }) => {
      const text = String(command || "").trim();
      if (!text) {
        return "No command was provided.";
      }
      await runAgentChatCommand(text, { fromVoice: true, fromRealtime: true });
      return `Executed "${text}".`;
    }
  });

const buildVoiceAgents = async () => {
  const models = await resolveAgentVoiceSettingsLabel();
  const voiceActionTool = buildVoiceActionTool();
  const retrieveSpecialist = new RealtimeAgent({
    name: "Retrieve Specialist",
    instructions:
      "You are the retrieve and academic database specialist. Use controls in the Annotarium app for search, providers, sort, year filtering, limits, export, Zotero data operations, and screen/coding entry points.",
    tools: [voiceActionTool],
    voice: models.ttsVoice
  });
  const codingSpecialist = new RealtimeAgent({
    name: "Coding Specialist",
    instructions:
      "You are the coding specialist. Handle requests about coding mode, question generation, and evidence-coding pipelines by using available app actions.",
    tools: [voiceActionTool],
    voice: models.ttsVoice
  });
  const triageAgent = new RealtimeAgent({
    name: "App Voice Triage",
    instructions:
      "You are a triage voice agent for the Annotarium desktop app. " +
      "For UI controls, call `execute_voice_command` with clear concise action text. " +
      "If user intent is primarily retrieval or Zotero, hand off to Retrieve Specialist. " +
      "If user intent is coding workflow, hand off to Coding Specialist. " +
      "Keep responses short and conversational.",
    handoffs: [retrieveSpecialist, codingSpecialist],
    tools: [voiceActionTool],
    voice: models.ttsVoice
  });
  return { triageAgent, retrieveSpecialist, codingSpecialist };
};

const buildRealtimeSession = async (inputStream?: MediaStream): Promise<RealtimeSession> => {
  const { triageAgent } = await buildVoiceAgents();
  const models = await resolveAgentVoiceSettingsLabel();
  dbgAgent("buildRealtimeSession", "voice model settings", {
    realtimeModel: DEFAULT_OPENAI_REALTIME_MODEL,
    transcribeModel: String(models.transcribeModel || ""),
    ttsVoice: String(models.ttsVoice || ""),
    ttsModel: String(models.ttsModel || "")
  });
  const webrtcTransport = new OpenAIRealtimeWebRTC({
    audioElement: agentChatAudio || undefined,
    mediaStream: inputStream,
    useInsecureApiKey: true
  });
  return new RealtimeSession(triageAgent, {
    transport: webrtcTransport,
    model: DEFAULT_OPENAI_REALTIME_MODEL,
    config: {
      outputModalities: ["audio", "text"],
      audio: {
        input: {
          turnDetection: { type: "server_vad" },
          transcription: {
            model: models.transcribeModel || "whisper-1"
          }
        },
        output: {
          format: {
            type: "audio/pcm",
            rate: AGENT_REALTIME_OUTPUT_SAMPLE_RATE
          },
          voice: models.ttsVoice
        }
      }
    },
    context: buildAgentContextPayload({ source: "realtime" }),
    traceMetadata: { source: "app-voice", surface: "renderer-console" }
  });
};

const attachRealtimeSessionListeners = (session: RealtimeSession): void => {
  session.on("agent_start", () => {
    recordAgentTelemetry("attachRealtimeSessionListeners:agent_start", { sessionStarts: 1 });
    setAgentChatVoiceStatus("Thinking...");
    dbgAgent("attachRealtimeSessionListeners", "agent_start event");
  });
  session.on("agent_end", () => {
    recordAgentTelemetry("attachRealtimeSessionListeners:agent_end", { sessionEnds: 1 });
    setAgentChatVoiceStatus("");
    clearAgentChatVoiceLegend();
    setAgentChatMicUI(false);
    clearAgentChatLegend();
    dbgAgent("attachRealtimeSessionListeners", "agent_end event");
    if (activeRealtimeSession) {
      setAgentVoicePulseState(false, true, false);
      setAgentChatVoiceStatus("Connected. Listening...");
    }
  });
  session.on("agent_handoff", (_context, fromAgent, toAgent) => {
    recordAgentTelemetry("attachRealtimeSessionListeners:agent_handoff", { handoffs: 1 });
    dbgAgent("attachRealtimeSessionListeners", "agent_handoff", {
      from: String((fromAgent as { name?: string } | undefined)?.name || ""),
      to: String((toAgent as { name?: string } | undefined)?.name || "")
    });
  });
  session.on("agent_tool_start", (_context, _agent, tool) => {
    recordAgentTelemetry("attachRealtimeSessionListeners:agent_tool_start", { toolStarts: 1 });
    dbgAgent("attachRealtimeSessionListeners", "agent_tool_start", { tool: String((tool as { name?: string } | undefined)?.name || "") });
  });
  session.on("agent_tool_end", (_context, _agent, tool) => {
    recordAgentTelemetry("attachRealtimeSessionListeners:agent_tool_end", { toolEnds: 1 });
    dbgAgent("attachRealtimeSessionListeners", "agent_tool_end", { tool: String((tool as { name?: string } | undefined)?.name || "") });
  });
  session.on("mcp_tool_call_completed", () => {
    recordAgentTelemetry("attachRealtimeSessionListeners:mcp_tool_call_completed", { mcpToolCompletes: 1 });
  });
  session.on("guardrail_tripped", (_context, _agent, _error, details) => {
    recordAgentTelemetry("attachRealtimeSessionListeners:guardrail_tripped", { rejectedCommands: 1 });
    agentRuntimeTelemetry.toolFailures += 1;
    dbgAgent("attachRealtimeSessionListeners", "guardrail_tripped", { itemId: String((details as { itemId?: string } | undefined)?.itemId || "") });
  });
  session.on("error", (error) => {
    dbgAgent("attachRealtimeSessionListeners", "session_error", { error });
    setAgentChatVoiceStatus("Realtime session error.");
    setAgentChatPhase("error", "Error");
  });
  session.on("audio_start", () => {
    dbgAgent("attachRealtimeSessionListeners", "audio_start");
    realtimeSilentAudioChunkCount = 0;
    setAgentVoicePulseState(false, false, true);
    setAgentChatVoiceStatus("Speaking...");
    setAgentChatPhase("speaking", "Speaking");
    clearRealtimeVoicePulseQueue();
    void ensureAgentChatAudioOutput();
  });
  session.on("audio", (event) => {
    const data = event?.data as ArrayBuffer | SharedArrayBuffer | ArrayBufferView | string | undefined;
    if (typeof data === "undefined") return;
    const byteLength = getAudioPayloadByteLength(data);
    const sampleRate = getAudioPayloadSampleRate(event);
    dbgAgent("attachRealtimeSessionListeners", "audio chunk", {
      byteLength,
      sampleRate: Number.isFinite(sampleRate || 0) ? sampleRate : AGENT_REALTIME_OUTPUT_SAMPLE_RATE,
      payloadType: typeof data
    });
    void queueRealtimeVoiceChunk(data, sampleRate);
    setAgentVoicePulseState(false, false, true);
    setAgentChatVoiceStatus("Speaking...");
    setAgentChatPhase("speaking", "Speaking");
    void ensureAgentChatAudioOutput();
  });
  session.on("audio_stopped", () => {
    realtimeSilentAudioChunkCount = 0;
    setAgentVoicePulseState(false, true, false);
    setAgentChatVoiceStatus("Connected. Listening...");
    setAgentChatPhase("listening", "Listening");
    clearAgentChatVoiceLegend();
    clearAgentChatLegend();
    dbgAgent("attachRealtimeSessionListeners", "audio_stopped");
  });
  session.on("turn_done", () => {
    if (activeRealtimeSession) {
      setAgentVoicePulseState(false, true, false);
      setAgentChatVoiceStatus("Connected. Listening...");
      setAgentChatPhase("listening", "Listening");
      clearAgentChatLegend();
    }
  });
  session.on("audio_interrupted", () => {
    clearRealtimeVoicePulseQueue();
    realtimeSilentAudioChunkCount = 0;
    setAgentVoicePulseState(false, true, false);
    setAgentChatVoiceStatus("Interrupted.");
    setAgentChatPhase("listening", "Listening");
    dbgAgent("attachRealtimeSessionListeners", "audio_interrupted");
  });
  session.on("transport_event", (event) => {
    dbgAgent("attachRealtimeSessionListeners", "transport_event", {
      type: String(event?.type || ""),
      item: String((event as { item_id?: string } | undefined)?.item_id || "")
    });
    if (event.type === "input_audio_buffer.speech_started") {
      setAgentChatVoiceStatus("Listening...");
      setAgentVoicePulseState(false, true, false);
      setAgentChatPhase("listening", "Listening");
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" ||
      event.type === "response.audio_transcript.done"
    ) {
      const payload = event as {
        item_id?: string;
        response_id?: string;
        transcript?: string;
        text?: string;
      };
      const transcript = String(payload.transcript || payload.text || "").trim();
      if (!transcript) return;
      const key = String(payload.item_id || payload.response_id || `${event.type}:${transcript.slice(0, 64)}`).trim();
      if (seenRealtimeTranscriptIds.has(key)) return;
      seenRealtimeTranscriptIds.add(key);
      if (seenRealtimeTranscriptIds.size > 120) {
        const iterator = seenRealtimeTranscriptIds.values().next();
        if (!iterator.done) seenRealtimeTranscriptIds.delete(iterator.value);
      }
      if (event.type === "conversation.item.input_audio_transcription.completed") {
        pushAgentChatMessage("user", transcript);
      } else {
        pushAgentChatMessage("assistant", transcript);
      }
    }
  });
};

const clearAgentChatLegend = (): void => {
  if (agentChatVoiceLegend) {
    agentChatVoiceLegend.textContent = "";
  }
};

const clearActiveRealtimeSession = (): void => {
  if (!activeRealtimeSession) {
    return;
  }
  try {
    activeRealtimeSession.interrupt();
  } catch {
    // best effort
  }
  try {
    activeRealtimeSession.close();
  } catch {
    // best effort
  }
  if (agentChatAudio) {
    try {
      agentChatAudio.pause();
    } catch {
      // best effort
    }
    try {
      agentChatAudio.src = "";
    } catch {
      // best effort
    }
  }
  if (activeRealtimeInputStream) {
    try {
      activeRealtimeInputStream.getTracks().forEach((track) => track.stop());
    } catch {
      // best effort
    }
  }
  activeRealtimeInputStream = null;
  activeRealtimeSession = null;
  realtimeSessionConnecting = false;
  clearRealtimeVoicePulseQueue();
  setAgentVoicePulseState(false, false, false);
  setAgentChatVoiceStatus("");
  clearAgentChatLegend();
};

const ensureAgentChatAudioOutput = async (): Promise<void> => {
  if (!agentChatAudio) return;
  if (!agentChatAudio.paused) {
    dbgAgent("ensureAgentChatAudioOutput", "audio already playing");
    return;
  }
  agentChatAudio.volume = 1;
  agentChatAudio.muted = false;
  try {
    dbgAgent("ensureAgentChatAudioOutput", "audio play request");
    await agentChatAudio.play();
  } catch (error) {
    dbgAgent("ensureAgentChatAudioOutput", "audio play blocked", { message: String((error as Error)?.message || error || "unknown") });
  }
};

const getRealtimeAudioContext = (): AudioContext | null => {
  if (activeRealtimeAudioContext?.state === "closed") {
    activeRealtimeAudioContext = null;
  }
  if (activeRealtimeAudioContext) {
    if (activeRealtimeAudioContext.state === "suspended") {
      void activeRealtimeAudioContext.resume();
    }
    return activeRealtimeAudioContext;
  }
  const ctor =
    (typeof AudioContext !== "undefined" ? AudioContext : (typeof (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)) as
    | typeof AudioContext
    | undefined;
  if (!ctor) {
    return null;
  }
  activeRealtimeAudioContext = new ctor();
  void activeRealtimeAudioContext.resume();
  return activeRealtimeAudioContext;
};

const clearRealtimeVoicePulseQueue = (): void => {
  activeRealtimeAudioSources.forEach((source) => {
    try {
      source.stop();
    } catch {
      // best effort
    }
    try {
      source.disconnect();
    } catch {
      // best effort
    }
  });
  activeRealtimeAudioSources.clear();
  activeRealtimeAudioCursor = 0;
  realtimeSilentAudioChunkCount = 0;
};

const queueRealtimeVoiceChunk = async (
  audioBytes: ArrayBuffer | SharedArrayBuffer | ArrayBufferView | string,
  sampleRate = AGENT_REALTIME_OUTPUT_SAMPLE_RATE
): Promise<void> => {
  const context = getRealtimeAudioContext();
  if (!context) return;
  const int16 = getRealtimeAudioInt16(audioBytes);
  if (!int16 || !int16.length) return;
  const contextStateBefore = String(context.state);
  if (contextStateBefore !== "running") {
    try {
      dbgAgent("queueRealtimeVoiceChunk", "audio context not running, attempting resume before playback");
      await context.resume();
    } catch (error) {
      dbgAgent("queueRealtimeVoiceChunk", "audio context resume failed", { message: String((error as Error)?.message || error || "unknown") });
      return;
    }
    if (String(context.state) !== "running") {
      dbgAgent("queueRealtimeVoiceChunk", "audio context not running", { state: context.state });
      return;
    }
  }
  if (!int16.length) return;
  const resolvedSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.max(3000, sampleRate) : AGENT_REALTIME_OUTPUT_SAMPLE_RATE;
  const buffer = context.createBuffer(1, int16.length, resolvedSampleRate);
  const channel = buffer.getChannelData(0);
  let maxAbsSample = 0;
  for (let i = 0; i < int16.length; i++) {
    const sample = int16[i] / 0x8000;
    if (sample === Infinity || Number.isNaN(sample)) continue;
    const clamped = Math.max(-1, Math.min(1, sample));
    maxAbsSample = Math.max(maxAbsSample, Math.abs(clamped));
    channel[i] = clamped;
  }
  if (maxAbsSample < 0.0004) {
    realtimeSilentAudioChunkCount += 1;
    if (realtimeSilentAudioChunkCount >= AGENT_REALTIME_SILENT_CHUNK_THRESHOLD && activeRealtimeSession) {
      setAgentChatVoiceStatus("Model is speaking softly or receiving muted audio frames.");
      setAgentVoicePulseState(false, true, false);
    }
    dbgAgent("queueRealtimeVoiceChunk", "low_audio_level_detected", { sampleCount: int16.length });
  } else if (Number.isFinite(maxAbsSample)) {
    realtimeSilentAudioChunkCount = 0;
    dbgAgent("queueRealtimeVoiceChunk", "audio_level", { maxAbsSample: Math.round(maxAbsSample * 1000) / 1000 });
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  const now = context.currentTime;
  const nextStart = Math.max(now + 0.02, activeRealtimeAudioCursor || now + 0.02);
  try {
    source.start(nextStart);
  } catch {
    return;
  }
  source.onended = () => {
    activeRealtimeAudioSources.delete(source);
    if (activeRealtimeAudioSources.size === 0 && activeRealtimeSession) {
      setAgentVoicePulseState(false, true, false);
    }
  };
  activeRealtimeAudioCursor = nextStart + buffer.duration;
  activeRealtimeAudioSources.add(source);
};

const resolveAgentVoiceSettingsLabel = async (): Promise<{ ttsModel: string; ttsVoice: string; transcribeModel: string }> => {
  const fallback = {
    ttsModel: agentVoiceState.ttsModel,
    ttsVoice: agentVoiceState.ttsVoice,
    transcribeModel: agentVoiceState.transcribeModel
  };
  if (!window.settingsBridge?.getValue) return fallback;
  try {
    const [ttsModelRaw, ttsVoiceRaw, transcribeModelRaw] = await Promise.all([
      window.settingsBridge.getValue("APIs/openai_voice_tts_model", fallback.ttsModel),
      window.settingsBridge.getValue("APIs/openai_voice_tts_voice", fallback.ttsVoice),
      window.settingsBridge.getValue("APIs/openai_voice_transcribe_model", fallback.transcribeModel)
    ]);
    const next = {
      ttsModel: String(ttsModelRaw || fallback.ttsModel).trim() || fallback.ttsModel,
      ttsVoice: String(ttsVoiceRaw || fallback.ttsVoice).trim() || fallback.ttsVoice,
      transcribeModel: String(transcribeModelRaw || fallback.transcribeModel).trim() || fallback.transcribeModel
    };
    agentVoiceState.ttsModel = next.ttsModel;
    agentVoiceState.ttsVoice = next.ttsVoice;
    agentVoiceState.transcribeModel = next.transcribeModel;
    return next;
  } catch {
    return fallback;
  }
};

function shouldShowAgentChat(): boolean {
  return true;
}

function renderAgentChatMessages(): void {
  if (!agentChatMessages) return;
  agentChatMessages.innerHTML = "";
  const fragment = document.createDocumentFragment();
  const extractTemplatePathFromMessage = (text: string): string => {
    const match = String(text || "").match(/^\s*Template page:\s*(.+)\s*$/im);
    return match ? String(match[1] || "").trim() : "";
  };
  agentChatState.messages.forEach((entry) => {
    const row = document.createElement("div");
    row.className = `agent-chat-msg ${entry.role}${entry.tone ? ` ${entry.tone}` : ""}`;
    row.textContent = entry.text || "(empty)";
    const templatePath = entry.role === "assistant" ? extractTemplatePathFromMessage(entry.text) : "";
    if (templatePath && window.agentBridge?.openLocalPath) {
      const actionWrap = document.createElement("div");
      actionWrap.className = "agent-chat-actions";
      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "agent-chat-action-btn";
      openButton.textContent = "Open Template Page";
      openButton.addEventListener("click", async () => {
        const opened = await window.agentBridge!.openLocalPath({ path: templatePath });
        if (opened?.status !== "ok") {
          pushAgentChatMessage("assistant", String(opened?.message || "Could not open template page."), "error");
        }
      });
      actionWrap.appendChild(openButton);
      row.appendChild(actionWrap);
    }
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

function setAgentChatControlsEnabled(enabled: boolean): void {
  if (agentChatInput) agentChatInput.disabled = !enabled;
  if (btnAgentChatSend) btnAgentChatSend.disabled = !enabled;
  if (btnAgentChatDictation) btnAgentChatDictation.disabled = !enabled;
  if (btnAgentChatMic) btnAgentChatMic.disabled = !enabled;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

type AgentVoiceIconState = "idle" | "listening" | "recording" | "speaking";
type AgentChatPhase = "idle" | "connecting" | "listening" | "dictating" | "transcribing" | "processing" | "speaking" | "error";

const buildAgentVoiceIcon = (state: AgentVoiceIconState): string => {
  if (state === "recording") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3.5a5 5 0 0 0-5 5v4a5 5 0 1 0 10 0v-4a5 5 0 0 0-5-5Z"></path>
  <path d="M12 19c-1.7 0-3 1.3-3 3H15c0-1.7-1.3-3-3-3Z"></path>
  <path d="M11 2h2"></path>
  <path d="M9.5 21h5"></path>
</svg>`;
  }
  if (state === "listening") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 4.5a3.6 3.6 0 0 0-3.6 3.6v4a3.6 3.6 0 1 0 7.2 0v-4A3.6 3.6 0 0 0 12 4.5Z"></path>
  <path d="M5.5 11.3a6.5 6.5 0 0 1 13 0"></path>
  <path d="M7.5 11.3a4.5 4.5 0 0 1 9 0"></path>
  <circle cx="8.3" cy="11.4" r="1.1"></circle>
  <circle cx="15.7" cy="11.4" r="1.1"></circle>
</svg>`;
  }
  if (state === "speaking") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M6.6 9.5v5H5a1 1 0 0 0 0 2h1.6l6.2 3.6V6L6.6 9.5z"></path>
  <path d="M16 8.5a1 1 0 0 0-.7 0 4 4 0 0 0 0 7 .9.9 0 0 0 .7 0"></path>
  <path d="M18.4 6.9a.7.7 0 0 0-1 .2 6.5 6.5 0 0 1 0 9.8.7.7 0 0 0 1 .2"></path>
  <path d="M20.7 5.4a.7.7 0 0 0-1 .2 8.4 8.4 0 0 1 0 12.8.7.7 0 0 0 1 .2"></path>
</svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M10.8 4.4c0 .6-.4 1-1 1h-1.7a1 1 0 0 0-1 1V10c0 2.6 1.6 4.9 4 5.8v4.6c0 .8.6 1.5 1.5 1.5h.4c.8 0 1.5-.7 1.5-1.5V15.8c2.4-.9 4-3.2 4-5.8V6.4c0-.6-.4-1-1-1h-1.7c-.6 0-1-.4-1-1 0-1.3-1-2.4-2.2-2.4h-1.2c-1.2.1-2.2 1.1-2.2 2.4Z"></path>
  <path d="M11.6 10.1v3"></path>
  <path d="M12.4 10.1v3"></path>
  <path d="M12 16h6"></path>
</svg>`;
};

const setAgentVoiceButtonIcons = (state: AgentVoiceIconState): void => {
  const icon = buildAgentVoiceIcon(state);
  if (agentChatFabIcon) {
    agentChatFabIcon.innerHTML = icon;
  } else if (agentChatFab) {
    const fallbackIconContainer = agentChatFab.querySelector(".agent-chat-fab-icon");
    if (fallbackIconContainer) {
      fallbackIconContainer.innerHTML = `<span class=\"agent-voice-icon\">${icon}</span>`;
    }
  }
  if (btnAgentChatMicIcon) {
    btnAgentChatMicIcon.innerHTML = icon;
  } else if (btnAgentChatMic) {
    const fallbackIconContainer = btnAgentChatMic.querySelector(".agent-chat-mic-icon");
    if (fallbackIconContainer) {
      fallbackIconContainer.innerHTML = `<span class=\"agent-voice-icon\">${icon}</span>`;
    }
  }
};

const setAgentDictationButtonIcon = (recording: boolean): void => {
  const icon = recording
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"></rect></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M12 3.5a4 4 0 0 0-4 4v5a4 4 0 0 0 8 0v-5a4 4 0 0 0-4-4z"></path>
  <path d="M8 12a4 4 0 0 0-4 4v1h16v-1a4 4 0 0 0-4-4h-8Z"></path>
  <path d="M9 18h6v1H9z"></path>
  <rect x="11.2" y="18.8" width="1.6" height="2.2" rx="0.8"></rect>
</svg>`;
  if (btnAgentChatDictationIcon) {
    btnAgentChatDictationIcon.innerHTML = icon;
  } else if (btnAgentChatDictation) {
    const fallbackIconContainer = btnAgentChatDictation.querySelector(".agent-chat-mic-icon");
    if (fallbackIconContainer) {
      fallbackIconContainer.innerHTML = `<span class=\"agent-voice-icon\">${icon}</span>`;
    }
  }
};

type AgentVoicePulseTheme = {
  text: string;
  border: string;
  background: string;
  shadow: string;
};

const VOICE_PULSE_THEME_BY_VOICE: Record<string, AgentVoicePulseTheme> = {
  alloy: {
    text: "#d9ebff",
    border: "rgba(96, 165, 250, 0.7)",
    background: "rgba(17, 51, 89, 0.6)",
    shadow: "rgba(96, 165, 250, 0.45)"
  },
  echo: {
    text: "#dfbcff",
    border: "rgba(168, 111, 255, 0.7)",
    background: "rgba(55, 22, 94, 0.58)",
    shadow: "rgba(168, 111, 255, 0.45)"
  },
  fable: {
    text: "#ffdfba",
    border: "rgba(251, 191, 36, 0.7)",
    background: "rgba(90, 60, 20, 0.58)",
    shadow: "rgba(251, 191, 36, 0.45)"
  },
  onyx: {
    text: "#ffd2d9",
    border: "rgba(248, 113, 113, 0.7)",
    background: "rgba(88, 26, 37, 0.58)",
    shadow: "rgba(248, 113, 113, 0.45)"
  },
  nova: {
    text: "#c9fbc5",
    border: "rgba(74, 222, 128, 0.7)",
    background: "rgba(17, 72, 36, 0.58)",
    shadow: "rgba(74, 222, 128, 0.45)"
  },
  sage: {
    text: "#caefd0",
    border: "rgba(74, 222, 128, 0.7)",
    background: "rgba(19, 59, 34, 0.6)",
    shadow: "rgba(110, 231, 183, 0.45)"
  },
  shimmer: {
    text: "#ccfbf1",
    border: "rgba(34, 211, 238, 0.7)",
    background: "rgba(12, 55, 65, 0.58)",
    shadow: "rgba(34, 211, 238, 0.45)"
  }
};

const resolveAgentVoicePulseTheme = (ttsVoice: string, ttsModel: string): AgentVoicePulseTheme => {
  const voice = String(ttsVoice || "").trim().toLowerCase();
  if (voice && VOICE_PULSE_THEME_BY_VOICE[voice]) {
    return VOICE_PULSE_THEME_BY_VOICE[voice];
  }
  const model = String(ttsModel || "").trim().toLowerCase();
  if (model.includes("gpt-4o")) {
    return {
      text: "#fef9c3",
      border: "rgba(250, 204, 21, 0.7)",
      background: "rgba(76, 60, 16, 0.58)",
      shadow: "rgba(250, 204, 21, 0.45)"
    };
  }
  return VOICE_PULSE_THEME_BY_VOICE.alloy;
};

const clearAgentChatMicVoiceTheme = (): void => {
  if (!btnAgentChatMic) return;
  btnAgentChatMic.style.removeProperty("--agent-voice-text");
  btnAgentChatMic.style.removeProperty("--agent-voice-border");
  btnAgentChatMic.style.removeProperty("--agent-voice-background");
  btnAgentChatMic.style.removeProperty("--agent-voice-shadow");
  if (agentChatFab) {
    agentChatFab.style.removeProperty("--agent-voice-text");
    agentChatFab.style.removeProperty("--agent-voice-border");
    agentChatFab.style.removeProperty("--agent-voice-background");
    agentChatFab.style.removeProperty("--agent-voice-shadow");
  }
};

const applyAgentChatMicVoiceTheme = (ttsVoice: string, ttsModel: string): void => {
  if (!btnAgentChatMic) return;
  const theme = resolveAgentVoicePulseTheme(ttsVoice, ttsModel);
  btnAgentChatMic.style.setProperty("--agent-voice-text", theme.text);
  btnAgentChatMic.style.setProperty("--agent-voice-border", theme.border);
  btnAgentChatMic.style.setProperty("--agent-voice-background", theme.background);
  btnAgentChatMic.style.setProperty("--agent-voice-shadow", theme.shadow);
  if (agentChatFab) {
    agentChatFab.style.setProperty("--agent-voice-text", theme.text);
    agentChatFab.style.setProperty("--agent-voice-border", theme.border);
    agentChatFab.style.setProperty("--agent-voice-background", theme.background);
    agentChatFab.style.setProperty("--agent-voice-shadow", theme.shadow);
  }
};

const decodeBase64ToBytes = (value: string): Uint8Array => {
  const raw = String(value || "").trim();
  if (!raw) return new Uint8Array(0);
  try {
    const cleaned = raw.includes(",") ? raw.split(",").pop() || "" : raw;
    const binary = atob(cleaned);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return new Uint8Array(0);
  }
};

const normalizeBase64AudioPayload = (audioBytes: string): Uint8Array => {
  return decodeBase64ToBytes(audioBytes);
};

const bytesToInt16Samples = (bytes: Uint8Array): Int16Array => {
  const compact = bytes.byteOffset % 2 === 0 ? bytes : new Uint8Array(bytes);
  const byteLength = compact.byteLength - (compact.byteLength % 2);
  if (byteLength < 2) {
    return new Int16Array(0);
  }
  const start = compact.byteOffset;
  const sliceEnd = start + byteLength;
  return new Int16Array(compact.buffer.slice(start, sliceEnd) as ArrayBufferLike);
};

const floatToInt16Samples = (samples: Float32Array | Float64Array): Int16Array => {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = Number(samples[i]);
    if (!Number.isFinite(sample)) {
      output[i] = 0;
      continue;
    }
    const clamped = Math.max(-1, Math.min(1, sample));
    output[i] = Math.round(clamped * 0x7fff);
  }
  return output;
};

const getRealtimeAudioInt16 = (
  audioBytes: ArrayBuffer | SharedArrayBuffer | ArrayBufferView | string
): Int16Array | null => {
  if (typeof audioBytes === "string") {
    const decoded = normalizeBase64AudioPayload(audioBytes);
    return decoded.byteLength ? bytesToInt16Samples(decoded) : null;
  }
  if (typeof SharedArrayBuffer !== "undefined" && audioBytes instanceof SharedArrayBuffer) {
    const sharedBytes = new Uint8Array(audioBytes);
    return sharedBytes.byteLength ? bytesToInt16Samples(sharedBytes) : null;
  }
  if (ArrayBuffer.isView(audioBytes)) {
    if (audioBytes instanceof Int16Array) {
      return new Int16Array(audioBytes);
    }
    if (audioBytes instanceof Float32Array || audioBytes instanceof Float64Array) {
      return floatToInt16Samples(audioBytes);
    }
    const raw = new Uint8Array(audioBytes.buffer, audioBytes.byteOffset, audioBytes.byteLength);
    return raw.byteLength ? bytesToInt16Samples(raw) : null;
  }
  if (audioBytes instanceof ArrayBuffer) {
    return audioBytes.byteLength ? bytesToInt16Samples(new Uint8Array(audioBytes)) : null;
  }
  return null;
};

const getAudioPayloadByteLength = (audioBytes: unknown): number => {
  if (!audioBytes) return 0;
  if (typeof audioBytes === "string") return normalizeBase64AudioPayload(audioBytes).byteLength;
  if (ArrayBuffer.isView(audioBytes)) return audioBytes.byteLength;
  if (audioBytes instanceof ArrayBuffer) return audioBytes.byteLength;
  if (typeof SharedArrayBuffer !== "undefined" && audioBytes instanceof SharedArrayBuffer) {
    return audioBytes.byteLength;
  }
  return 0;
};

const getAudioPayloadSampleRate = (payload: unknown): number | undefined => {
  if (!payload || typeof payload !== "object") return undefined;
  const maybeRate =
    (payload as { sampleRate?: unknown }).sampleRate ??
    (payload as { sample_rate?: unknown }).sample_rate ??
    (payload as { rate?: unknown }).rate;
  const numericRate = Number(maybeRate);
  return Number.isFinite(numericRate) && numericRate > 0 ? Math.round(numericRate) : undefined;
};

const speakChatMessage = async (text: string): Promise<void> => {
  if (!window.agentBridge?.speakText || !agentChatAudio) return;
  const message = String(text || "").trim();
  if (!message) return;
  const requestId = ++agentVoiceState.speechRequestId;
  const models = await resolveAgentVoiceSettingsLabel();
  const spoken = await window.agentBridge.speakText({ text: message });
  dbgAgent("speakChatMessage", "tts response", {
    status: String(spoken?.status || ""),
    audioBytes: Number(spoken?.audioBase64?.length || 0)
  });
  if (requestId !== agentVoiceState.speechRequestId) return;
  if (spoken?.status !== "ok" || !spoken?.audioBase64) {
    clearAgentChatVoiceLegend();
    return;
  }
  const bytes = decodeBase64ToBytes(spoken.audioBase64);
  const safeBytes = new Uint8Array(bytes);
  const blob = new Blob([safeBytes], { type: String(spoken.mimeType || "audio/mpeg") });
  const finishVoice = (): void => {
    if (requestId !== agentVoiceState.speechRequestId) return;
    setAgentVoicePulseState(false, false, false);
    clearAgentChatMicVoiceTheme();
    clearAgentChatVoiceLegend();
    if (agentChatVoiceStatus?.textContent?.startsWith("Speaking")) {
      setAgentChatVoiceStatus("");
    }
    if (activeSpeechObjectUrl) {
      URL.revokeObjectURL(activeSpeechObjectUrl);
      activeSpeechObjectUrl = null;
    }
  };
  const objectUrl = URL.createObjectURL(blob);
  if (activeSpeechObjectUrl) {
    URL.revokeObjectURL(activeSpeechObjectUrl);
  }
  activeSpeechObjectUrl = objectUrl;
  if (agentChatAudio) {
    dbgAgent("speakChatMessage", "tts audio play", {
      blobSize: blob.size,
      mimeType: String(spoken.mimeType || "")
    });
    agentChatAudio.src = objectUrl;
    const voiceLabel = String(models.ttsVoice || models.ttsModel || "").trim();
    const modelLabel = models.ttsModel && models.ttsModel !== voiceLabel ? ` • ${models.ttsModel}` : "";
    setAgentChatVoiceStatus(`Speaking (${voiceLabel}${modelLabel})`);
    setAgentChatVoiceLegend(models, "Speaking");
    applyAgentChatMicVoiceTheme(models.ttsVoice, models.ttsModel);
    setAgentVoicePulseState(false, false, true);
    agentChatAudio.onended = finishVoice;
    agentChatAudio.onpause = finishVoice;
    agentChatAudio.onerror = finishVoice;
    dbgAgent("speakChatMessage", "tts audio play request");
    void agentChatAudio.play().then(() => {
      dbgAgent("speakChatMessage", "tts audio play started");
    }).catch((error) => {
      dbgAgent("speakChatMessage", "tts audio play blocked", { message: String((error as Error)?.message || error || "unknown") });
      setAgentChatVoiceStatus("Speech blocked by browser audio policy. Click the mic again.");
      finishVoice();
    });
  }
};

function pushAgentChatMessage(
  role: "user" | "assistant",
  text: string,
  tone?: "error",
  options?: { speak?: boolean }
): void {
  const value = String(text || "").trim();
  const entry = { role, text: value, tone, at: Date.now() as number };
  agentChatState.messages.push(entry);
  if (agentChatState.messages.length > 60) {
    agentChatState.messages = agentChatState.messages.slice(-60);
  }
  if (window.agentBridge?.logChatMessage) {
    void window.agentBridge.logChatMessage(entry);
  }
  renderAgentChatMessages();
  if (role === "assistant" && options?.speak) {
    void speakChatMessage(value);
  }
}

function setAgentChatPending(pending: boolean): void {
  agentChatState.pending = pending;
  setAgentChatControlsEnabled(!pending);
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

const resolveAgentVoiceMimeType = (): string => {
  if (typeof MediaRecorder === "undefined") {
    return "audio/webm";
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg", "audio/mp4"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "audio/webm";
};

const setAgentChatMicUI = (recording: boolean): void => {
  setAgentVoicePulseState(recording, false, false);
};

const setAgentVoicePulseState = (recording: boolean, listening: boolean, speaking: boolean): void => {
  const isActive = recording || listening || speaking;
  const isListening = Boolean(listening && !recording && !speaking);
  const isPlaying = Boolean(recording || isListening || speaking);
  const state: AgentVoiceIconState = recording
    ? "recording"
    : speaking
      ? "speaking"
      : isListening
        ? "listening"
        : "idle";
  setAgentVoiceButtonIcons(state);
  const dictationRecording = Boolean(recording && agentVoiceState.captureMode === "dictation");
  if (btnAgentChatMic) {
    btnAgentChatMic.classList.toggle("recording", recording);
    btnAgentChatMic.classList.toggle("listening", isListening);
    btnAgentChatMic.classList.toggle("speaking", speaking && !recording);
    btnAgentChatMic.classList.toggle("playing", isPlaying);
    btnAgentChatMic.classList.toggle("has-voice", isActive);
    btnAgentChatMic.setAttribute("data-voice-state", listening ? "listening" : speaking ? "speaking" : recording ? "recording" : "idle");
    const voicePressed = listening || speaking || agentVoiceState.captureMode === "voice";
    btnAgentChatMic.setAttribute("aria-pressed", voicePressed ? "true" : "false");
    btnAgentChatMic.title = voicePressed ? "Stop voice mode" : "Start voice mode";
    btnAgentChatMic.setAttribute("aria-label", voicePressed ? "Stop voice mode" : "Start voice mode");
  }
  if (btnAgentChatDictation) {
    btnAgentChatDictation.classList.toggle("active", dictationRecording || agentVoiceState.nativeCaptureActive);
    btnAgentChatDictation.setAttribute(
      "aria-pressed",
      dictationRecording || agentVoiceState.nativeCaptureActive ? "true" : "false"
    );
    const dictationPressed = dictationRecording || agentVoiceState.nativeCaptureActive;
    btnAgentChatDictation.title = dictationPressed ? "Stop dictation capture" : "Start dictation capture";
    btnAgentChatDictation.setAttribute("aria-label", dictationPressed ? "Stop dictation capture" : "Start dictation capture");
  }
  setAgentDictationButtonIcon(dictationRecording || agentVoiceState.nativeCaptureActive);
  if (agentChatFab) {
    agentChatFab.classList.toggle("recording", recording);
    agentChatFab.classList.toggle("listening", isListening);
    agentChatFab.classList.toggle("speaking", speaking && !recording);
    agentChatFab.classList.toggle("playing", isPlaying);
    agentChatFab.classList.toggle("has-voice", isActive);
    agentChatFab.setAttribute("data-voice-state", listening ? "listening" : speaking ? "speaking" : recording ? "recording" : "idle");
  }
};

const setAgentChatVoiceStatus = (text: string): void => {
  if (!agentChatVoiceStatus) return;
  const normalized = String(text || "").trim();
  agentChatVoiceStatus.textContent = normalized;
};

const setAgentChatPhase = (phase: AgentChatPhase, label?: string): void => {
  if (!agentChatPhaseBadge) return;
  const resolvedLabel = String(label || phase).trim() || "idle";
  const normalizedLabel = resolvedLabel
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
  agentChatPhaseBadge.className = `agent-chat-phase-badge is-${phase}`;
  agentChatPhaseBadge.textContent = normalizedLabel;
};

const speakVoiceActivationGreeting = (): void => {
  pushAgentChatMessage("assistant", "How can I help you?", undefined, { speak: true });
};

const setAgentChatVoiceLegend = (models: {
  ttsModel: string;
  ttsVoice: string;
  transcribeModel: string;
}, phase: string): void => {
  const ttsModel = String(models?.ttsModel || "").trim();
  const ttsVoice = String(models?.ttsVoice || "").trim();
  const transcribeModel = String(models?.transcribeModel || "").trim();
  const label = `Voice: ${ttsVoice || "default"} • TTS: ${ttsModel || "default"} • STT: ${transcribeModel || "default"}`;
  if (agentChatVoiceLegend) {
    agentChatVoiceLegend.textContent = label;
  }
  if (btnAgentChatMic) {
    btnAgentChatMic.title = `${phase} — ${label}`;
  }
};

const clearAgentChatVoiceLegend = (): void => {
  if (agentChatVoiceLegend) {
    agentChatVoiceLegend.textContent = "";
  }
  if (btnAgentChatMic) {
    btnAgentChatMic.title = "Voice command";
  }
};

const clearAgentVoiceBuffers = (): void => {
  if (agentVoiceState.mediaRecorder) {
    agentVoiceState.mediaRecorder.ondataavailable = null;
    agentVoiceState.mediaRecorder.onstop = null;
    agentVoiceState.mediaRecorder = null;
  }
  if (agentVoiceState.stream) {
    agentVoiceState.stream.getTracks().forEach((track) => track.stop());
    agentVoiceState.stream = null;
  }
  agentVoiceState.chunks = [];
  agentVoiceState.dictationBaseInput = "";
  agentVoiceState.dictationDraftTranscript = "";
  agentVoiceState.dictationProcessing = false;
  activeDictationBridgeSessionId = 0;
  if (!agentVoiceState.nativeCaptureActive) {
    agentVoiceState.captureMode = null;
  }
  setAgentChatPhase("idle", "Idle");
};

const runAgentChatFromVoice = async (transcript: string): Promise<void> => {
  if (!transcript || !transcript.trim()) return;
  if (agentChatState.pending) return;
  setAgentChatPending(true);
  setAgentChatMicUI(false);
  try {
    await runAgentChatCommand(transcript, { fromVoice: true });
  } finally {
    setAgentChatPending(false);
    setAgentVoicePulseState(false, false, false);
    setAgentChatVoiceStatus("");
    clearAgentChatVoiceLegend();
  }
};

const stopAgentVoiceRecording = async (): Promise<void> => {
  agentVoiceState.speechOutputMode = false;
  if (activeRealtimeSession) {
    clearActiveRealtimeSession();
    setAgentChatVoiceStatus("Voice mode stopped.");
    setAgentChatPhase("idle", "Idle");
    clearAgentChatVoiceLegend();
    setAgentChatMicUI(false);
    clearAgentChatMicVoiceTheme();
    agentVoiceState.captureMode = null;
    return;
  }
  if (agentVoiceState.nativeCaptureActive && window.agentBridge?.nativeAudioStop) {
    agentVoiceState.nativeCaptureActive = false;
    agentVoiceState.isProcessing = true;
    setAgentChatPending(true);
    setAgentVoicePulseState(false, false, false);
    setAgentChatVoiceStatus("Transcribing...");
    try {
      const captured = await window.agentBridge.nativeAudioStop();
      if (captured?.status !== "ok" || !captured.audioBase64) {
        pushAgentChatMessage("assistant", String(captured?.message || "Native audio capture failed."), "error");
      } else {
        const bytes = decodeBase64ToBytes(captured.audioBase64);
        const mimeType = String(captured.mimeType || "audio/wav");
        const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
        await submitAgentVoiceChunk(blob, mimeType);
      }
    } finally {
      agentVoiceState.isProcessing = false;
      setAgentChatPending(false);
      setAgentVoicePulseState(false, false, false);
      clearAgentChatVoiceLegend();
      agentVoiceState.captureMode = null;
      setAgentChatPhase("idle", "Idle");
    }
    return;
  }
  if (agentVoiceState.mediaRecorder && agentVoiceState.mediaRecorder.state === "recording") {
    agentVoiceState.mediaRecorder.stop();
  } else {
    clearAgentVoiceBuffers();
  }
  setAgentChatVoiceStatus("");
  clearAgentChatVoiceLegend();
  setAgentVoicePulseState(false, false, false);
  setAgentChatMicUI(false);
  agentVoiceState.captureMode = null;
  setAgentChatPhase("idle", "Idle");
};

const submitAgentVoiceChunk = async (blob: Blob, mimeType: string): Promise<void> => {
  const pushAssistant = (message: string, tone?: "error"): void =>
    pushAgentChatMessage("assistant", message, tone, { speak: true });
  const applyDictationTranscript = async (transcript: string): Promise<void> => {
    const value = String(transcript || "").trim();
    if (!value) return;
    const mode = await resolveDictationMode();
    if (mode === "auto_send_after_transcription") {
      if (agentChatState.pending) {
        if (agentChatInput) {
          const existing = String(agentChatInput.value || "").trim();
          agentChatInput.value = existing ? `${existing} ${value}` : value;
          setAgentChatVoiceStatus("Dictation captured (busy). Press Send.");
          clearAgentChatVoiceLegend();
          return;
        }
      }
      setAgentChatVoiceStatus("Processing dictation...");
      setAgentChatPhase("processing", "Processing");
      await runAgentChatFromVoice(value);
      return;
    }
    if (agentChatInput) {
      const existing = String(agentChatInput.value || "").trim();
      agentChatInput.value = existing ? `${existing} ${value}` : value;
      agentChatInput.focus();
      try {
        agentChatInput.setSelectionRange(agentChatInput.value.length, agentChatInput.value.length);
      } catch {
        // ignore
      }
      setAgentChatVoiceStatus("Dictation ready. Press Send.");
      setAgentChatPhase("idle", "Idle");
      clearAgentChatVoiceLegend();
      return;
    }
    pushAgentChatMessage("user", value);
    setAgentChatVoiceStatus("Dictation captured.");
    setAgentChatPhase("idle", "Idle");
    clearAgentChatVoiceLegend();
  };
  if (!blob.size || !window.agentBridge?.transcribeVoice) {
    pushAssistant("Voice capture empty or unavailable in this session.", "error");
    setAgentChatVoiceStatus("");
    clearAgentChatVoiceLegend();
    return;
  }
  dbgAgent("submitAgentVoiceChunk", "transcribe start", { byteSize: blob.size, mimeType });
  const base64 = toBase64(await blob.arrayBuffer());
  let transcriptResponse: { status: string; text?: string; message?: string };
  try {
    const transcribeStartedAt = performance.now();
    transcriptResponse = await window.agentBridge.transcribeVoice({
      audioBase64: base64,
      mimeType
    });
    dbgAgent("submitAgentVoiceChunk", "transcribe response", {
      status: String(transcriptResponse?.status || ""),
      hasText: Boolean(String(transcriptResponse?.text || "").trim()),
      elapsedMs: Math.round(performance.now() - transcribeStartedAt)
    });
  } catch (error) {
    pushAssistant(String((error as Error)?.message || error || "Could not transcribe your audio."), "error");
    setAgentChatVoiceStatus("Transcription failed.");
    setAgentChatPhase("error", "Error");
    clearAgentChatVoiceLegend();
    return;
  }
  if (transcriptResponse?.status !== "ok" || !transcriptResponse?.text) {
    pushAssistant(String(transcriptResponse?.message || "Could not transcribe your audio."), "error");
    setAgentChatVoiceStatus("");
    setAgentChatPhase("error", "Error");
    clearAgentChatVoiceLegend();
    return;
  }
  const transcript = String(transcriptResponse.text || "").trim();
  if (!transcript) {
    pushAssistant("Could not transcribe any clear speech. Please try again.", "error");
    setAgentChatVoiceStatus("");
    setAgentChatPhase("error", "Error");
    clearAgentChatVoiceLegend();
    return;
  }
  dbgAgent("submitAgentVoiceChunk", "dictation transcript ready", { length: transcript.length });
  await applyDictationTranscript(transcript);
};

const combineDictationTranscript = (previous: string, nextChunk: string): string => {
  const prev = String(previous || "").trim();
  const next = String(nextChunk || "").trim();
  if (!next) return prev;
  if (!prev) return next;
  if (next.toLowerCase() === prev.toLowerCase()) return prev;
  if (next.toLowerCase().startsWith(prev.toLowerCase())) return next;
  const max = Math.min(prev.length, next.length);
  let overlap = 0;
  for (let i = max; i >= 1; i -= 1) {
    if (prev.slice(prev.length - i).toLowerCase() === next.slice(0, i).toLowerCase()) {
      overlap = i;
      break;
    }
  }
  const suffix = next.slice(overlap).trim();
  if (!suffix) return prev;
  return `${prev}${/[,\s]$/.test(prev) ? "" : " "}${suffix}`.trim();
};

const applyDictationComposerDraft = (): void => {
  if (!agentChatInput) return;
  const base = String(agentVoiceState.dictationBaseInput || "").trim();
  const draft = String(agentVoiceState.dictationDraftTranscript || "").trim();
  agentChatInput.value = draft ? (base ? `${base} ${draft}` : draft) : base;
  agentChatInput.focus();
  try {
    agentChatInput.setSelectionRange(agentChatInput.value.length, agentChatInput.value.length);
  } catch {
    // ignore
  }
};

const startAgentVoiceRecording = async (mode: "voice" | "dictation" = "voice"): Promise<void> => {
  if (agentVoiceState.speechOutputMode && !activeRealtimeSession && !realtimeSessionConnecting) {
    agentVoiceState.speechOutputMode = false;
    setAgentVoicePulseState(false, false, false);
    setAgentChatVoiceStatus("Speech-output mode disabled.");
    setAgentChatPhase("idle", "Idle");
    clearAgentChatVoiceLegend();
    clearAgentChatMicVoiceTheme();
    return;
  }
  if (!window.navigator?.mediaDevices?.getUserMedia) {
    pushAgentChatMessage("assistant", "Microphone access is unavailable in this environment.", "error");
    setAgentChatVoiceStatus("Microphone access unavailable.");
    setAgentChatPhase("error", "Error");
    clearAgentChatVoiceLegend();
    return;
  }
  if (agentChatState.pending || agentVoiceState.isProcessing) {
    setAgentChatVoiceStatus("Busy...");
    setAgentChatPhase("processing", "Busy");
    setAgentChatVoiceLegend({
      ttsModel: agentVoiceState.ttsModel,
      ttsVoice: agentVoiceState.ttsVoice,
      transcribeModel: agentVoiceState.transcribeModel
    }, "Busy");
    return;
  }
  if (
    activeRealtimeSession ||
    agentVoiceState.mediaRecorder?.state === "recording" ||
    realtimeSessionConnecting ||
    agentVoiceState.nativeCaptureActive
  ) {
    await stopAgentVoiceRecording();
    return;
  }

  const models = await resolveAgentVoiceSettingsLabel();
  const apiKey = mode === "voice" ? await resolveOpenAiApiKeyForRealtime() : null;
  let shouldFallbackToDictation = false;
  if (mode === "voice" && apiKey) {
    realtimeSessionConnecting = true;
    setAgentChatVoiceStatus("Connecting voice agent...");
    setAgentChatPhase("connecting", "Connecting");
    setAgentChatVoiceLegend({
      ttsModel: models.ttsModel,
      ttsVoice: models.ttsVoice,
      transcribeModel: models.transcribeModel
    }, "Connecting");
    try {
      const voiceInputStream = await getVoiceInputStream();
      activeRealtimeInputStream = voiceInputStream;
      const session = await buildRealtimeSession(voiceInputStream);
      attachRealtimeSessionListeners(session);
      activeRealtimeSession = session;
      agentVoiceState.captureMode = "voice";
      await Promise.race([
        session.connect({
          apiKey: () => Promise.resolve(apiKey)
        }),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error(`Realtime connect timeout after ${AGENT_REALTIME_CONNECT_TIMEOUT_MS}ms`)), AGENT_REALTIME_CONNECT_TIMEOUT_MS);
        })
      ]);
      void ensureAgentChatAudioOutput();
      applyAgentChatMicVoiceTheme(models.ttsVoice, models.ttsModel);
      setAgentChatVoiceStatus("Connected. Listening...");
      setAgentChatPhase("listening", "Listening");
      setAgentChatVoiceLegend({
        ttsModel: models.ttsModel,
        ttsVoice: models.ttsVoice,
        transcribeModel: models.transcribeModel
      }, "Listening");
      agentVoiceState.speechOutputMode = false;
      setAgentVoicePulseState(false, true, false);
      speakVoiceActivationGreeting();
      return;
    } catch (error) {
      const connectMessage = String((error as Error)?.message || error || "error");
      const missingDevice = isMissingMicrophoneError(error);
      if (missingDevice) {
        clearActiveRealtimeSession();
        setAgentVoicePulseState(false, false, false);
        setAgentChatVoiceStatus("Realtime microphone unavailable. Switching to dictation...");
        setAgentChatPhase("connecting", "Fallback");
        pushAgentChatMessage(
          "assistant",
          "Realtime voice microphone is unavailable. Switching to dictation capture mode.",
          "error"
        );
        shouldFallbackToDictation = true;
      } else {
      setAgentChatVoiceStatus(`Voice agent unavailable (${connectMessage}).`);
      setAgentChatPhase("error", "Error");
      pushAgentChatMessage(
        "assistant",
        "Realtime voice did not connect. Use Dictation for transcription or retry voice mode.",
        "error"
      );
      clearActiveRealtimeSession();
      setAgentChatVoiceLegend({
        ttsModel: models.ttsModel,
        ttsVoice: models.ttsVoice,
        transcribeModel: models.transcribeModel
      }, "Fallback");
      }
    } finally {
      realtimeSessionConnecting = false;
    }
  }

  if (mode === "voice") {
    if (shouldFallbackToDictation) {
      await startAgentVoiceRecording("dictation");
    }
    return;
  }

  try {
    dbgAgent("startAgentVoiceRecording", "attempting fallback recorder mode");
    setAgentChatVoiceStatus(`Dictating... [${models.transcribeModel}]`);
    setAgentChatPhase("dictating", "Dictating");
    setAgentChatVoiceLegend({
      ttsModel: models.ttsModel,
      ttsVoice: models.ttsVoice,
      transcribeModel: models.transcribeModel
    }, "Listening");
    const startDictationRes = await window.agentBridge?.dictationStart?.();
    if (!startDictationRes || String(startDictationRes.status || "") !== "ok") {
      throw new Error(String(startDictationRes?.message || "Failed to start dictation session."));
    }
    activeDictationBridgeSessionId = Number(startDictationRes.sessionId || 0);
    const stream = await getVoiceInputStream();
    const audioTrack = stream.getAudioTracks()[0] ?? null;
    dbgAgent("startAgentVoiceRecording", "getUserMedia success", {
      tracks: stream.getAudioTracks().length,
      sampleRate: Number(audioTrack?.getSettings?.().sampleRate || 0),
      channelCount: Number(audioTrack?.getSettings?.().channelCount || 0)
    });
    const mimeType = resolveAgentVoiceMimeType();
    const recorder = new MediaRecorder(stream, { mimeType });
    agentVoiceState.captureMode = "dictation";
    agentVoiceState.dictationSessionId += 1;
    agentVoiceState.dictationBaseInput = String(agentChatInput?.value || "").trim();
    agentVoiceState.dictationDraftTranscript = "";
    agentVoiceState.dictationProcessing = false;
    agentVoiceState.mediaRecorder = recorder;
    agentVoiceState.stream = stream;
    agentVoiceState.mimeType = mimeType;
    agentVoiceState.chunks = [];
    const activeSessionId = agentVoiceState.dictationSessionId;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        agentVoiceState.chunks.push(event.data);
        void event.data.arrayBuffer().then((ab) => {
          if (agentVoiceState.dictationSessionId !== activeSessionId) return;
          window.agentBridge?.dictationAudio?.(ab);
        });
        dbgAgent("startAgentVoiceRecording", "fallback chunk", {
          chunkBytes: event.data.size,
          chunkCount: agentVoiceState.chunks.length
        });
      }
    };
    recorder.onstop = async () => {
      agentVoiceState.isProcessing = true;
      setAgentChatPending(true);
      setAgentVoicePulseState(false, false, false);
      setAgentChatVoiceStatus("Transcribing...");
      setAgentChatPhase("transcribing", "Transcribing");
      setAgentChatVoiceLegend({
        ttsModel: agentVoiceState.ttsModel,
        ttsVoice: agentVoiceState.ttsVoice,
        transcribeModel: models.transcribeModel
      }, "Transcribing");
      try {
        const totalBytes = agentVoiceState.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
        dbgAgent("startAgentVoiceRecording", "recorder stopped", {
          chunkCount: agentVoiceState.chunks.length,
          totalBytes
        });
        if (agentVoiceState.dictationSessionId === activeSessionId) {
          const stopRes = await window.agentBridge?.dictationStop?.();
          const completedText = String(stopRes?.text || "").trim();
          if (completedText) {
            agentVoiceState.dictationDraftTranscript = completedText;
          }
          const modeSetting = await resolveDictationMode();
          const transcript = String(agentVoiceState.dictationDraftTranscript || "").trim();
          if (transcript) {
            if (modeSetting === "auto_send_after_transcription" && !agentChatState.pending) {
              setAgentChatVoiceStatus("Processing dictation...");
              setAgentChatPhase("processing", "Processing");
              await runAgentChatFromVoice(transcript);
              if (agentChatInput) {
                agentChatInput.value = String(agentVoiceState.dictationBaseInput || "").trim();
              }
            } else {
              applyDictationComposerDraft();
              setAgentChatVoiceStatus("Dictation ready. Press Send.");
              setAgentChatPhase("idle", "Idle");
              clearAgentChatVoiceLegend();
            }
          }
        }
        clearAgentVoiceBuffers();
      } finally {
        agentVoiceState.isProcessing = false;
        setAgentChatPending(false);
      }
    };
    recorder.onerror = () => {
      dbgAgent("startAgentVoiceRecording", "recorder error");
      setAgentChatVoiceStatus("Recorder error.");
      setAgentChatPhase("error", "Error");
      pushAgentChatMessage("assistant", "Voice recorder encountered an error.", "error");
      void window.agentBridge?.dictationStop?.();
      clearAgentVoiceBuffers();
      setAgentVoicePulseState(false, false, false);
      setAgentChatPending(false);
      clearAgentChatVoiceLegend();
    };
    recorder.start(AGENT_DICTATION_STREAM_TIMESLICE_MS);
    setAgentChatMicUI(true);
  } catch (error) {
    if (mode === "dictation") {
      void window.agentBridge?.dictationStop?.();
      activeDictationBridgeSessionId = 0;
    }
    const fallbackMessage = String((error as Error)?.message || error || "Could not start microphone.");
    const missingDevice = isMissingMicrophoneError(error);
    if (missingDevice) {
      if (window.agentBridge?.nativeAudioStart) {
        const nativeStart = await window.agentBridge.nativeAudioStart();
        if (nativeStart?.status === "ok") {
          agentVoiceState.captureMode = "dictation";
          agentVoiceState.nativeCaptureActive = true;
          setAgentChatVoiceStatus(`Dictating... [host ${String(nativeStart.backend || "audio")}]`);
          setAgentChatPhase("dictating", "Dictating");
          setAgentChatVoiceLegend(
            {
              ttsModel: models.ttsModel,
              ttsVoice: models.ttsVoice,
              transcribeModel: models.transcribeModel
            },
            "Listening"
          );
          setAgentChatMicUI(true);
          speakVoiceActivationGreeting();
          return;
        }
      }
      agentVoiceState.speechOutputMode = true;
      pushAgentChatMessage(
        "assistant",
        "Microphone device not found. Voice input is unavailable in this runtime. I enabled speech-output mode for chat replies.",
        "error"
      );
      setAgentVoicePulseState(false, false, true);
      setAgentChatVoiceStatus("Speech-output mode active (no mic).");
      setAgentChatPhase("idle", "Speech");
      clearAgentVoiceBuffers();
      setAgentChatMicUI(false);
      clearAgentChatVoiceLegend();
      return;
    }
    pushAgentChatMessage("assistant", fallbackMessage, "error");
    clearAgentVoiceBuffers();
    setAgentChatMicUI(false);
    setAgentChatVoiceStatus("");
    setAgentChatPhase("error", "Error");
    clearAgentChatVoiceLegend();
  }
};

type AgentContextBuildOptions = {
  fromVoice?: boolean;
  fromRealtime?: boolean;
  source?: AgentCommandSource;
  commandText?: string;
};

function buildAgentContextPayload(options: AgentContextBuildOptions = {}): AgentRunContext {
  const source = options.source || (options.fromRealtime ? "realtime" : options.fromVoice ? "voice" : "chat");
  const commandText = String(options.commandText || "").trim();
  const state = retrieveZoteroContext.getState();
  const selectedCollection = retrieveZoteroContext.getSelectedCollection();
  const selectedItem = retrieveZoteroContext.getSelectedItem();
  const analyseState = analyseStore?.getState?.();
  const analyseRunPath = String(analyseState?.activeRunPath || "").trim();
  const analyseBaseDir = String(analyseState?.baseDir || "").trim();
  const analyseRunId = String(analyseState?.activeRunId || "").trim();
  return {
    routeId: activeRouteId || "",
    routeLabel: describeRoute(activeRouteId || ""),
    selectedCollectionKey: state.selectedCollectionKey || "",
    selectedCollectionName: selectedCollection?.name || "",
    selectedItemKey: selectedItem?.key || "",
    status: state.status || "",
    itemsCount: state.items.length,
    activeTags: state.activeTags,
    selectedAnalyseRunPath: analyseRunPath,
    analyseRunPath,
    runPath: analyseRunPath,
    activeRunPath: analyseRunPath,
    selectedRunPath: analyseRunPath,
    selectedAnalysePath: analyseRunPath,
    selectedAnalyseBaseDir: analyseBaseDir,
    analyseBaseDir,
    analysisBaseDir: analyseBaseDir,
    activeRunId: analyseRunId,
    dir_base: analyseRunPath || analyseBaseDir,
    commandText: commandText,
    source,
    fromVoice: Boolean(options.fromVoice),
    fromRealtime: Boolean(options.fromRealtime),
    commandLength: commandText.length,
    commandWordCount: commandText.split(/\s+/).filter(Boolean).length,
    hasZoteroState: Boolean(state.status || state.items.length || state.selectedCollectionKey),
    hasAnalyseState: Boolean(analyseRunPath || analyseBaseDir)
  };
}

function resolveSystematicRunDirFromContext(): string {
  const context = buildAgentContextPayload();
  const selectedCollectionName = String(context.selectedCollectionName || context.selectedCollectionKey || "").trim();
  const base = String(context.selectedAnalyseBaseDir || context.analyseBaseDir || "").trim();
  if (base && selectedCollectionName) return `${base}/${selectedCollectionName}/systematic_review`;
  if (String(context.runPath || "").trim()) return `${String(context.runPath).trim()}/systematic_review`;
  return "";
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
  const hasQuestionCue = /\b(research\s+questions?|questions?|rq\d*)\b/i.test(raw);
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
  const fallback = hasQuestionCue
    ? raw
      .split(/[;\n]+/)
      .map((s) => String(s || "").replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean)
    : [];
  return (numbered.length ? numbered : fallback).slice(0, 5);
}

function parseEligibilityCriteriaInput(text: string): { inclusion: string[]; exclusion: string[] } {
  const raw = String(text || "").trim();
  if (!raw) return { inclusion: [], exclusion: [] };

  const inclusionMatch =
    raw.match(/(?:inclusion(?:\s+criteria)?|include)\s*[:\-]\s*([\s\S]*?)(?=(?:\n\s*(?:exclusion(?:\s+criteria)?|exclude)\s*[:\-])|$)/i);
  const exclusionMatch =
    raw.match(/(?:exclusion(?:\s+criteria)?|exclude)\s*[:\-]\s*([\s\S]*?)$/i);

  const normalizeBlock = (value: string): string[] =>
    String(value || "")
      .split(/\n+/)
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean);

  return {
    inclusion: normalizeBlock(String(inclusionMatch?.[1] || "")),
    exclusion: normalizeBlock(String(exclusionMatch?.[1] || ""))
  };
}

function buildEligibilityPreflightIntent(
  collectionName: string,
  contextText: string,
  researchQuestions: string[],
  inclusion: string[],
  exclusion: string[]
): Record<string, unknown> | null {
  if (!inclusion.length || !exclusion.length) return null;
  return {
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
      context: contextText,
      research_questions: researchQuestions
    }
  };
}

function parseCodingControlsFromText(text: string): {
  coding_mode: "open" | "targeted" | "hybrid";
  mode_specified: boolean;
  rq_scope: number[];
  target_codes: string[];
  min_relevance: number;
} {
  const raw = String(text || "").trim();
  const explicitOpen = /\bopen\s+code|open\s+coding\b/i.test(raw);
  const explicitTargeted = /\btarget(?:ed)?\s+code|target(?:ed)?\s+coding|\btargeted\b/i.test(raw);
  const explicitHybrid = /\bhybrid\s+code|hybrid\s+coding|\bhybrid\b/i.test(raw);
  const coding_mode: "open" | "targeted" | "hybrid" = explicitHybrid ? "hybrid" : explicitOpen ? "open" : explicitTargeted ? "targeted" : "open";
  const scope = new Set<number>();
  const re = /\brq\s*([1-9]\d*)\b|\bquestion\s*([1-9]\d*)\b/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(raw))) {
    const n = Number(m[1] || m[2] || 0);
    if (Number.isFinite(n) && n > 0) scope.add(n - 1);
  }
  const focusMatch =
    raw.match(/(?:focus(?:ed)?\s+on|target(?:ed)?\s+(?:at|on)?|on)\s+(.+?)(?:[.?!]|$)/i) ||
    raw.match(/(?:codes?|themes?)\s*[:\-]\s*(.+?)(?:[.?!]|$)/i);
  const target_codes = String(focusMatch?.[1] || "")
    .split(/,|;|\band\b/gi)
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s) => s.length >= 3)
    .slice(0, 12);
  const strict = /\bstrict|high\s+precision|high\s+relevance|only\s+high\b/i.test(raw);
  const min_relevance = coding_mode === "targeted" || coding_mode === "hybrid" ? (strict ? 5 : 4) : 3;
  return {
    coding_mode,
    mode_specified: explicitOpen || explicitTargeted || explicitHybrid,
    rq_scope: Array.from(scope.values()).sort((a, b) => a - b).slice(0, 5),
    target_codes,
    min_relevance
  };
}

type VoiceActionCommand = {
  command: {
    phase: string;
    action: string;
    payload?: Record<string, unknown>;
  };
  feedback: string;
};

type VoiceActionCandidate = {
  action: RibbonAction;
  aliases: string[];
  tokens: Set<string>;
};

type VoiceButtonInventoryEntry = {
  label: string;
  aliases: string[];
  routeId: string;
  phase?: string;
  action?: string;
  tabId?: string;
  tabLabel?: string;
  groupLabel?: string;
  visible: boolean;
};

type VoiceInventoryRequest = {
  scope: "visible" | "all";
  routeId?: string;
  phrase?: string;
  limit?: number;
  format?: "summary" | "json";
};

type VoiceButtonInventory = {
  entries: VoiceButtonInventoryEntry[];
  phraseTokens: string[];
  scope: "visible" | "all";
};

type VoiceInventoryRouteAlias = {
  id: RouteId;
  aliases: string[];
};

const VOICE_INVENTORY_PREVIEW_LIMIT = 12;
const VOICE_INVENTORY_MAX_LIMIT = 200;

const VOICE_ROUTE_ALIAS_MAP: Array<VoiceInventoryRouteAlias> = [
  { id: "retrieve:search", aliases: ["retrieve search", "search page", "search tab", "retrieve search page"] },
  { id: "retrieve:datahub", aliases: ["retrieve datahub", "datahub"] },
  { id: "retrieve:zotero", aliases: ["retrieve zotero", "zotero"] },
  { id: "retrieve:search-selected", aliases: ["search selected", "selected result", "selected result page"] },
  { id: "retrieve:graph", aliases: ["retrieve graph", "citation graph", "graph page"] },
  { id: "screen:main", aliases: ["screening", "screen page", "pdf screen"] },
  { id: "analyse:dashboard", aliases: ["analyse dashboard", "analysis dashboard", "dashboard"] },
  { id: "analyse:corpus", aliases: ["analyse corpus", "analysis corpus", "corpus"] },
  { id: "analyse:r1", aliases: ["round 1", "round one", "analyse round one"] },
  { id: "analyse:r2", aliases: ["round 2", "round two", "analyse round two"] },
  { id: "analyse:r3", aliases: ["round 3", "round three", "analyse round three"] },
  { id: "analyse:phases", aliases: ["analysis phases", "phases"] },
  { id: "code:main", aliases: ["code", "coding"] },
  { id: "write:main", aliases: ["write", "writer"] },
  { id: "visualiser:main", aliases: ["visualiser", "visualiser page", "preview"] }
];
const normalizeVoiceInventoryRoute = (routeId: string): string => normalizeVoiceText(String(routeId || ""));

const normalizeVoiceInventoryAlias = (value: string): string => normalizeVoiceText(String(value || ""));

const resolveVoiceInventoryRouteId = (normalized: string): RouteId | null => {
  const normalizedTokens = voiceTokens(normalizeVoiceText(normalized));
  for (const row of VOICE_ROUTE_ALIAS_MAP) {
    for (const rawAlias of row.aliases) {
      const alias = normalizeVoiceInventoryAlias(rawAlias);
      if (!alias) continue;
      if (normalized === alias || normalized.includes(` ${alias} `) || normalized.includes(`${alias} `) || normalized.includes(` ${alias}`)) {
        return row.id;
      }
      const aliasTokens = voiceTokens(alias);
      const matchedTokens = aliasTokens.filter((token) => normalizedTokens.includes(token));
      if (aliasTokens.length >= 2 && matchedTokens.length === aliasTokens.length) {
        return row.id;
      }
    }
  }
  return null;
};

const describeRoute = (routeId?: string): string => {
  if (!routeId) return "current route";
  return String(routeId).replace(":", " ");
};

const inferCandidateRouteId = (button: HTMLElement): string | null => {
  if (activeRouteId) {
    return String(activeRouteId);
  }
  if (button.closest("[data-route-id]")) {
    const value = button.closest("[data-route-id]")?.getAttribute("data-route-id");
    if (value?.trim()) return value.trim();
  }
  return null;
};

const normalizeVoiceInventoryPayload = (payload: Record<string, unknown> | undefined): VoiceInventoryRequest => {
  const rawScope = String(payload?.scope || "visible").toLowerCase();
  const scope = rawScope === "all" ? "all" : "visible";
  const format = String(payload?.format || "").toLowerCase() === "json" ? "json" : "summary";
  const parsedLimit = typeof payload?.limit === "number" && Number.isFinite(payload.limit) ? Number(payload.limit) : undefined;
  const clampedLimit = parsedLimit && parsedLimit > 0 ? Math.max(1, Math.min(Math.floor(parsedLimit), VOICE_INVENTORY_MAX_LIMIT)) : undefined;
  const phrase = String(payload?.phrase || "").trim();
  const routeId = String(payload?.routeId || "").trim() || undefined;
  return { scope, routeId, phrase, limit: clampedLimit, format };
};

const parseVoiceInventoryIntent = (normalized: string): VoiceInventoryRequest | null => {
  if (!/\b(inventory|coverage|map|list)\b/.test(normalized) || !/\b(voice|agent|mic|audio|button|control|controls?|action|actions|available)\b/.test(normalized)) {
    return null;
  }

  const routeId = resolveVoiceInventoryRouteId(normalized);
  const requestedAll = /\ball|global|entire|whole|every/.test(normalized);
  const requestedJson = /\bjson\b/.test(normalized);
  const phrase = normalizeVoiceText(
    normalized
      .replace(/\b(voice|agent|mic|audio|mode)\b/g, " ")
      .replace(/\b(inventory|coverage|button|buttons?|controls?|command|commands|action|actions|map|list|list all|show|of|the|for|in)\b/g, " ")
      .trim()
  );
  const match = normalized.match(/\b(?:show|list|give|give me|map|show me)\s+(?:only|just)?\s*(?:about|for|matching)?\s+(.+?)\b(?:\b(in|on)\s+(?:the|a)\s+)?(?:button|buttons|controls?)?\b/);
  const extractedPhrase = String(match?.[1] || phrase).trim();
  const limitMatch = normalized.match(/\b(?:first|show|only|up to|max|top)\s+(\d{1,3})\b/);
  const limit = limitMatch ? Math.max(1, Math.min(Number(limitMatch[1]), VOICE_INVENTORY_MAX_LIMIT)) : undefined;
  return normalizeVoiceInventoryPayload({
    scope: requestedAll ? "all" : "visible",
    routeId,
    phrase: extractedPhrase || undefined,
    limit,
    format: requestedJson ? "json" : "summary"
  });
};

const buildVoiceButtonInventory = (request?: VoiceInventoryRequest): VoiceButtonInventory => {
  const payload = normalizeVoiceInventoryPayload(request ?? {});
  const phraseTokens = voiceTokens(normalizeVoiceText(payload.phrase || ""));
  const desiredRoute = payload.routeId ? normalizeVoiceInventoryRoute(payload.routeId) : "";

  const candidates = collectVoiceButtonCandidates({ visibleOnly: payload.scope === "visible" });
  const filtered: VoiceButtonInventoryEntry[] = [];
  for (const candidate of candidates) {
    const candidateRoute = normalizeVoiceInventoryRoute(candidate.routeId || "");
    if (payload.routeId && candidateRoute && candidateRoute !== desiredRoute && !candidateRoute.includes(desiredRoute) && !desiredRoute.includes(candidateRoute)) {
      continue;
    }
    if (phraseTokens.length) {
      const haystack = candidate.aliases.join(" ");
      const normalizedHaystack = normalizeVoiceText(haystack);
      const allTokensPresent = phraseTokens.every((token) => candidate.tokens.has(token) || normalizedHaystack.includes(token));
      if (!allTokensPresent) continue;
    }
    filtered.push({
      label: candidate.label,
      aliases: candidate.aliases,
      routeId: candidate.routeId || "",
      phase: candidate.phase,
      action: candidate.action,
      tabId: candidate.tabId,
      tabLabel: candidate.tabLabel,
      groupLabel: candidate.groupLabel,
      visible: payload.scope === "visible"
    });
  }

  filtered.sort((a, b) => {
    const routeA = String(a.routeId || "");
    const routeB = String(b.routeId || "");
    if (routeA !== routeB) return routeA.localeCompare(routeB);
    const phaseA = String(a.phase || "");
    const phaseB = String(b.phase || "");
    if (phaseA !== phaseB) return phaseA.localeCompare(phaseB);
    const groupA = String(a.groupLabel || "");
    const groupB = String(b.groupLabel || "");
    if (groupA !== groupB) return groupA.localeCompare(groupB);
    return String(a.label || "").localeCompare(String(b.label || ""));
  });

  const output = payload.limit && payload.limit > 0 ? filtered.slice(0, payload.limit) : filtered;
  return { entries: output, phraseTokens, scope: payload.scope };
};

type VoiceButtonCandidate = {
  element: HTMLElement;
  label: string;
  aliases: string[];
  tokens: Set<string>;
  phase?: string;
  action?: string;
  tabId?: string;
  tabLabel?: string;
  groupLabel?: string;
  toolType?: string;
  routeId?: string;
};

const VOICE_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "button",
  "buttons",
  "go",
  "in",
  "into",
  "it",
  "is",
  "me",
  "my",
  "of",
  "on",
  "open",
  "or",
  "please",
  "press",
  "show",
  "the",
  "this",
  "to",
  "using",
  "visit",
  "with",
  "your"
]);

const VOICE_ACTION_MANUAL_ALIASES: Record<string, string[]> = {
  "retrieve-search": [
    "search",
    "search papers",
    "find papers",
    "academic search",
    "query builder",
    "open query builder",
    "open retrieve search",
    "go to retrieve",
    "retrieve search",
    "search page",
    "academic database search",
    "academic databases",
    "search tab"
  ],
  "retrieve-set-provider": [
    "provider",
    "database provider",
    "search provider",
    "set provider",
    "choose provider",
    "set academic database",
    "academic database",
    "academic databases",
    "search source",
    "data source",
  "provider selector",
  "change provider",
  "database",
  "source",
  "search prover"
  ],
  "retrieve-set-sort": [
    "sort",
    "result order",
    "order by",
    "set sort",
    "sort results",
    "sort by results",
    "result ranking",
    "order by relevance",
    "order by year"
  ],
  "retrieve-set-years": [
    "years",
    "year range",
    "publication year",
    "year filter",
    "year from",
    "year to",
    "publication date",
    "date range",
    "set year range",
    "between years",
    "year span"
  ],
  "retrieve-set-limit": [
    "limit",
    "result limit",
    "max results",
    "number of results",
    "results limit",
    "limit results",
    "paper limit",
    "max papers",
    "set result limit",
    "set limit"
  ],
  "retrieve-load-zotero": [
    "zotero",
    "zotero loader",
    "zotero workspace",
    "open zotero workspace",
    "open zotero",
    "load zotero",
    "zotero workspace",
    "zotero collections"
  ],
  "retrieve-open-batches": [
    "open batches",
    "batches",
    "batch list",
    "batch view",
    "zotero batches",
    "open batch list",
    "show batches"
  ],
  "retrieve-open-code": [
    "open code",
    "code workspace",
    "open coding workspace",
    "code tab",
    "open coding panel"
  ],
  "retrieve-open-screen": [
    "open screen",
    "screen workspace",
    "screening view",
    "screening tab",
    "open screening workspace",
    "screen tab"
  ],
  "retrieve-load-local": [
    "load local",
    "import local",
    "local file",
    "import file",
    "load local file",
    "import local file",
    "upload local file",
    "open csv",
    "open excel",
    "load dataset"
  ],
  "retrieve-export-csv": [
    "export csv",
    "download csv",
    "save csv",
    "export to csv",
    "save csv file",
    "download csv table"
  ],
  "retrieve-export-excel": [
    "export excel",
    "download excel",
    "save excel",
    "export xls",
    "export to excel",
    "save xls",
    "export xlsx",
    "download xlsx"
  ],
  "retrieve-resolve-na": [
    "resolve na",
    "resolve missing values",
    "fill missing values",
    "replace missing",
    "impute missing",
    "resolve blanks"
  ],
  "retrieve-flag-na": [
    "flag na",
    "flag missing",
    "highlight missing",
    "mark missing",
    "mark blanks",
    "missing values"
  ],
  "retrieve-apply-codebook": [
    "apply codebook",
    "codebook",
    "filter codebook",
    "apply codebook columns",
    "use codebook"
  ],
  "retrieve-apply-coding-columns": [
    "apply coding columns",
    "coding columns",
    "filter coding columns",
    "show coding columns",
    "apply coding columns only"
  ],
  "analyse-dashboard": [
    "dashboard",
    "open dashboard",
    "review dashboard"
  ],
  "analyse-corpus": [
    "corpus",
    "open corpus",
    "load corpus"
  ],
  "analyse-round-1": [
    "round 1",
    "round one",
    "open round 1"
  ],
  "analyse-round-2": [
    "round 2",
    "round two",
    "open round 2"
  ],
  "analyse-round-3": [
    "round 3",
    "round three",
    "open round 3"
  ],
  "screen-exclude-item": [
    "exclude item",
    "mark exclude",
    "exclude study",
    "mark as exclude"
  ],
  "screen-tag-include": [
    "include",
    "include study",
    "tag for inclusion",
    "mark include"
  ],
  "screen-note": [
    "write note",
    "screening note",
    "add note",
    "write screening note"
  ],
  "screen-settings": [
    "screen settings",
    "screening settings"
  ],
  "test-pdf": [
    "pdf",
    "open pdf viewer",
    "launch pdf"
  ],
  "test-coder": [
    "coder",
    "open coder",
    "launch coder"
  ],
  "visualiser-run-inputs": [
    "run inputs",
    "build preview",
    "refresh inputs"
  ],
  "visualiser-refresh-thumbs": [
    "refresh preview",
    "refresh thumbnails",
    "refresh thumbs",
    "build thumbnails"
  ],
  "visualiser-build": [
    "build slides",
    "build deck",
    "export deck",
    "create slides"
  ],
  "visualiser-diag": [
    "diag",
    "diagnostics",
    "plotly status"
  ],
  "visualiser-copy-status": [
    "copy status",
    "copy status log",
    "copy export status"
  ],
  "visualiser-clear-status": [
    "clear status",
    "clear status log",
    "clear export log"
  ],
  "export-word": [
    "export word",
    "word export",
    "save as word"
  ],
  "export-json": [
    "export json",
    "json export",
    "serialize json",
    "save as json"
  ],
  "export-snapshot": [
    "save snapshot",
    "snapshot",
    "save project snapshot"
  ],
  "project-export": [
    "export project",
    "zip project",
    "download project zip"
  ]
};

const VOICE_ACTION_SEEDS: Array<{ action: RibbonAction }> = [
  ...RetrieveTab.actions.map((action) => ({ action })),
  ...RibbonScreenTab.actions.map((action) => ({ action })),
  ...CodeTab.actions.map((action) => ({ action })),
  ...VisualiserTab.actions.map((action) => ({ action })),
  ...AnalyseTab.actions.map((action) => ({ action })),
  ...WriteTab.actions.map((action) => ({ action })),
  ...ExportTab.actions.map((action) => ({ action })),
  ...SettingsTab.actions.map((action) => ({ action })),
  ...ToolsTab.actions.map((action) => ({ action }))
];

const VOICE_ACTION_INVENTORY = VOICE_ACTION_SEEDS.map(({ action }) => ({
  id: action.id,
  phase: action.command.phase,
  action: action.command.action,
  label: action.label,
  group: action.group || "Actions",
  hint: action.hint
}));
const VOICE_ACTION_MIN_SCORE = 40;
const VOICE_ACTION_MIN_GAP = 12;
const VOICE_BUTTON_MIN_SCORE = 40;
const VOICE_BUTTON_MIN_GAP = 12;
const VOICE_BUTTON_SELECTOR =
  "button, a[href], [role='button'], [role='link'], [role='switch'], [role='tab'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='checkbox'], input[type='button'], input[type='submit'], input[type='reset'], input[type='checkbox'], input[type='number'], input[type='text'], input[type='search'], input[type='email'], input[type='url'], textarea, select";
const VOICE_ALIAS_SEPARATOR = /[;,|]/;

let cachedVoiceActionCandidates: VoiceActionCandidate[] | null = null;

const addAlias = (bucket: Set<string>, value: string | undefined | null): void => {
  const normalized = normalizeVoiceText(String(value || ""));
  if (normalized) {
    bucket.add(normalized);
  }
};

const addAliasTokens = (bucket: Set<string>, value: string | undefined | null): void => {
  for (const token of voiceTokens(String(value || ""))) {
    if (token.length >= 3 && !VOICE_STOPWORDS.has(token)) {
      bucket.add(token);
    }
  }
};

const scoreVoiceAliases = (
  normalized: string,
  aliases: string[]
): { aliasScore: number; tokenMatchCount: number; score: number } => {
  const tokens = voiceTokens(normalized);
  let aliasScore = 0;
  const tokenMatchSet = new Set<string>();
  for (const rawAlias of aliases) {
    const alias = normalizeVoiceText(String(rawAlias || ""));
    if (!alias) continue;
    if (normalized === alias) {
      aliasScore += 260;
    } else if (normalized.includes(alias)) {
      aliasScore += 150;
    } else if (alias.includes(normalized)) {
      aliasScore += 110;
    }
    const aliasTokens = voiceTokens(alias);
    for (const token of tokens) {
      if (aliasTokens.includes(token)) {
        aliasScore += 20;
        tokenMatchSet.add(token);
      }
    }
  }
  const tokenMatchCount = tokenMatchSet.size;
  return { aliasScore, tokenMatchCount, score: aliasScore + tokenMatchCount * 20 };
};

const addAriaDescribedAlias = (button: HTMLElement, aliases: Set<string>): void => {
  const describedBy = button.getAttribute("aria-describedby");
  if (!describedBy) return;
  const described = document.getElementById(describedBy);
  if (!described) return;
  addAlias(aliases, described.textContent);
  addAliasTokens(aliases, described.textContent);
};

const collectButtonContextAliases = (button: HTMLElement, aliases: Set<string>): void => {
  addAlias(aliases, activeRouteId ? activeRouteId.replace(/:/g, " ") : "");
  const activeTab = document.querySelector<HTMLElement>(".tab-button.active");
  if (activeTab) {
    addAlias(aliases, activeTab.textContent);
    addAlias(aliases, `tab ${activeTab.textContent}`);
  }
  const contextRoots = [
    button.closest(".ribbon-group"),
    button.closest(".panel-shell"),
    button.closest(".tool-surface"),
    button.closest(".retrieve-block"),
    button.closest(".zotero-detail"),
    button.closest("aside"),
    button.closest("section"),
    button.closest(".sidebar")
  ];
  for (const root of contextRoots) {
    if (!root) continue;
    addAlias(aliases, root.querySelector("h1,h2,h3,h4,h5,h6")?.textContent);
  }
  collectAssociatedLabelAlias(aliases, button);
  const tooltip = button.getAttribute("title");
  addAlias(aliases, tooltip);
  addAliasTokens(aliases, tooltip);
  addAlias(aliases, button.getAttribute("data-tooltip"));
  addAliasTokens(aliases, button.getAttribute("data-tooltip"));
  addAriaDescribedAlias(button, aliases);
  if (button instanceof HTMLInputElement && button.type === "button") {
    addAlias(aliases, button.value);
  }
  if (button.id) {
    addAlias(aliases, button.id);
    addAlias(aliases, button.id.replace(/-/g, " "));
    const id = String(button.id).trim().toLowerCase();
    if (id.includes("zotero")) {
      addAlias(aliases, "zotero");
      addAlias(aliases, "zotero loader");
    }
    if (id.includes("retrieve") || id.includes("search")) {
      addAlias(aliases, "retrieve search");
      addAlias(aliases, "search");
    }
    if (id.includes("provider")) {
      addAlias(aliases, "provider");
      addAlias(aliases, "academic database");
      addAlias(aliases, "search prover");
    }
    if (id.includes("sort")) {
      addAlias(aliases, "sort");
      addAlias(aliases, "sort results");
    }
    if (id.includes("year")) {
      addAlias(aliases, "year");
      addAlias(aliases, "year range");
    }
    if (id.includes("limit")) {
      addAlias(aliases, "limit");
    }
  }
  addAlias(aliases, "button");
};

const collectAssociatedLabelAlias = (aliases: Set<string>, button: HTMLElement): void => {
  const controlId = button.getAttribute("id");
  if (controlId) {
    const explicit = document.querySelector<HTMLLabelElement>(`label[for="${controlId}"]`);
    addAlias(aliases, explicit?.textContent);
    addAliasTokens(aliases, explicit?.textContent);
  }
  const previous = button.previousElementSibling;
  if (previous && previous.tagName.toLowerCase() === "label") {
    addAlias(aliases, previous.textContent);
    addAliasTokens(aliases, previous.textContent);
  }
  const next = button.nextElementSibling;
  if (next && next.tagName.toLowerCase() === "label") {
    addAlias(aliases, next.textContent);
    addAliasTokens(aliases, next.textContent);
  }
};

const addButtonClassAlias = (aliases: Set<string>, button: HTMLElement): void => {
  const classTokens = Array.from(button.classList).map((value) => value.toLowerCase());
  if (classTokens.some((value) => value.includes("close"))) {
    addAlias(aliases, "close");
    addAlias(aliases, "close tab");
    addAlias(aliases, "close panel");
    addAlias(aliases, "remove");
  }
  if (classTokens.some((value) => value.includes("next"))) {
    addAlias(aliases, "next");
    addAlias(aliases, "next page");
    addAlias(aliases, "forward");
  }
  if (classTokens.some((value) => value.includes("prev"))) {
    addAlias(aliases, "previous");
    addAlias(aliases, "previous page");
    addAlias(aliases, "go back");
    addAlias(aliases, "back");
  }
  if (classTokens.some((value) => value.includes("refresh") || value.includes("reload") || value.includes("redo"))) {
    addAlias(aliases, "refresh");
    addAlias(aliases, "reload");
  }
  if (classTokens.some((value) => value.includes("search"))) {
    addAlias(aliases, "search");
    addAlias(aliases, "find");
  }
  if (classTokens.some((value) => value.includes("save") || value.includes("download"))) {
    addAlias(aliases, "save");
    addAlias(aliases, "download");
  }
  if (classTokens.some((value) => value.includes("export"))) {
    addAlias(aliases, "export");
    addAlias(aliases, "save as");
  }
  if (classTokens.some((value) => value.includes("add") || value.includes("plus"))) {
    addAlias(aliases, "add");
    addAlias(aliases, "create");
  }
  if (classTokens.some((value) => value.includes("remove") || value.includes("delete") || value.includes("clear") || value.includes("trash"))) {
    addAlias(aliases, "remove");
    addAlias(aliases, "delete");
    addAlias(aliases, "clear");
    addAlias(aliases, "remove item");
  }
  if (classTokens.some((value) => value.includes("expand") || value.includes("toggle"))) {
    addAlias(aliases, "expand");
    addAlias(aliases, "collapse");
    addAlias(aliases, "toggle");
  }
  if (classTokens.some((value) => value.includes("play"))) {
    addAlias(aliases, "play");
    addAlias(aliases, "start");
  }
  if (classTokens.some((value) => value.includes("pause") || value.includes("stop"))) {
    addAlias(aliases, "pause");
    addAlias(aliases, "stop");
  }
  if (classTokens.some((value) => value.includes("tag") && value.includes("chip")) || classTokens.some((value) => value.includes("tag"))) {
    addAlias(aliases, "tag");
    addAlias(aliases, "tags");
  }
  if (classTokens.some((value) => value.includes("collection"))) {
    addAlias(aliases, "collection");
    addAlias(aliases, "collections");
  }
  if (classTokens.some((value) => value.includes("zotero"))) {
    addAlias(aliases, "zotero");
    addAlias(aliases, "zotero loader");
  }
  if (classTokens.some((value) => value.includes("retrieve"))) {
    addAlias(aliases, "retrieve");
    addAlias(aliases, "retrieve search");
  }
  if (classTokens.some((value) => value.includes("graph"))) {
    addAlias(aliases, "graph");
    addAlias(aliases, "citation graph");
  }
  if (classTokens.some((value) => value.includes("detail"))) {
    addAlias(aliases, "detail");
    addAlias(aliases, "details");
  }
};

const addButtonGlyphAlias = (aliases: Set<string>, label: string): void => {
  const normalized = String(label || "").trim();
  if (!normalized) return;
  const glyphAliases = new Map<string, string[]>([
    ["×", ["close", "close button", "remove"]],
    ["x", ["close", "close button", "remove"]],
    ["✎", ["rename", "edit"]],
    ["🗑", ["delete", "remove", "trash"]],
    ["⚙", ["settings", "options", "preferences"]],
    ["i", ["included", "include"]],
    ["?", ["maybe"]],
    ["−", ["collapse", "minus"]],
    ["-", ["minus", "decrease", "collapse"]],
    ["+", ["expand", "add"]],
    ["add", ["add"]],
    ["≡", ["menu"]],
    ["▸", ["expand", "open", "next"]],
    ["◂", ["collapse", "previous", "back"]],
    ["▶", ["play", "start"]],
    ["⏹", ["stop", "pause"]],
    ["⏺", ["record"]],
    ["...", ["more"]]
  ]);
  const entries = glyphAliases.get(normalized);
  if (entries?.length) {
    entries.forEach((entry) => addAlias(aliases, entry));
  }
  if (normalized.length <= 2 && /^\d+$/.test(normalized)) {
    addAlias(aliases, `tab ${normalized}`);
  }
};

const addButtonIconAlias = (aliases: Set<string>, button: HTMLElement): void => {
  const icon = button.querySelector("svg, use, i, .icon");
  const labelledBy = button.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ids = labelledBy
      .split(" ")
      .map((id) => id.trim())
      .filter(Boolean);
    ids.forEach((id) => {
      const labelled = document.getElementById(id);
      addAlias(aliases, labelled?.textContent);
      addAliasTokens(aliases, labelled?.textContent);
    });
  }
  const label = normalizeVoiceText(button.getAttribute("aria-label") || button.title || button.textContent || "");
  if (label.includes("close") || label.includes("remove") || label.includes("delete")) {
    addAlias(aliases, "close");
    addAlias(aliases, "remove");
    addAlias(aliases, "delete");
  }
  if (label.includes("back") || label.includes("return") || label.includes("previous")) {
    addAlias(aliases, "back");
    addAlias(aliases, "previous");
  }
  if (label.includes("next") || label.includes("more")) {
    addAlias(aliases, "next");
    addAlias(aliases, "more");
  }
  if (label.includes("search") || label.includes("find")) {
    addAlias(aliases, "search");
    addAlias(aliases, "find");
  }
  if (label.includes("open") || label.includes("view") || label.includes("show")) {
    addAlias(aliases, "open");
    addAlias(aliases, "show");
    addAlias(aliases, "view");
  }
  if (icon) {
    const classes = Array.from(icon.classList).map((value) => value.toLowerCase());
    const symbol = normalizeVoiceText(icon.getAttribute("data-icon") || icon.id || icon.getAttribute("class") || "");
    if (classes.some((value) => value.includes("close")) || symbol.includes("close")) {
      addAlias(aliases, "close");
    }
    if (classes.some((value) => value.includes("search")) || symbol.includes("search")) {
      addAlias(aliases, "search");
    }
    if (classes.some((value) => value.includes("menu")) || classes.some((value) => value.includes("expand")) || symbol.includes("expand")) {
      addAlias(aliases, "expand");
      addAlias(aliases, "menu");
    }
    if (classes.some((value) => value.includes("minus")) || classes.some((value) => value.includes("plus"))) {
      addAlias(aliases, "collapse");
      addAlias(aliases, "expand");
    }
  }
};

const buttonLabelForVoice = (button: HTMLElement): string => {
  const ariaLabel = button.getAttribute("aria-label");
  if (ariaLabel?.trim()) return ariaLabel.trim();
  const title = button.getAttribute("title");
  if (title?.trim()) return title.trim();
  if (button instanceof HTMLInputElement && (button.value || "").trim()) {
    return button.value.trim();
  }
  if (button instanceof HTMLTextAreaElement && (button.value || "").trim()) {
    return button.value.trim();
  }
  if ((button instanceof HTMLInputElement || button instanceof HTMLSelectElement || button instanceof HTMLTextAreaElement) && button.id) {
    const linked = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(button.id)}"]`);
    if (linked?.textContent?.trim()) {
      return linked.textContent.trim();
    }
  }
  return (button.textContent || "").trim();
};

const isVoiceButtonCandidateVisible = (button: HTMLElement): boolean => {
  if (button.closest(".agent-chat-dock") || button.closest("#agentChatFab")) {
    return true;
  }
  const buttonType = String(button.getAttribute("type") || "").toLowerCase();
  if (buttonType === "hidden") return false;
  if (button.hasAttribute("disabled")) return false;
  if ((button as HTMLButtonElement).disabled) return false;
  const style = getComputedStyle(button);
  if (style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none") return false;
  if (style.opacity === "0" && !button.classList.contains("agent-chat-fab") && !button.classList.contains("agent-chat-mic")) return false;
  const rect = button.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (button.closest(".hidden")) return false;
  return true;
};

const collectVoiceButtonCandidates = (options?: { visibleOnly?: boolean }): VoiceButtonCandidate[] => {
  const visibleOnly = options?.visibleOnly !== false;
  const candidates: VoiceButtonCandidate[] = [];
  const nodes = Array.from(document.querySelectorAll<HTMLElement>(VOICE_BUTTON_SELECTOR));
  for (const button of nodes) {
    if (visibleOnly && !isVoiceButtonCandidateVisible(button)) {
      continue;
    }
    const aliasSet = new Set<string>();
    const phase = button.getAttribute("data-phase")?.trim() || undefined;
    const action = button.getAttribute("data-action")?.trim() || undefined;
    const tabId = button.getAttribute("data-tab-id")?.trim() || undefined;
    const tabLabel = button.getAttribute("data-tab-label")?.trim() || undefined;
    const groupLabel = button.closest(".ribbon-group")?.querySelector("h3")?.textContent?.trim();
    const toolType = button.getAttribute("data-tool-type")?.trim() || undefined;
    const routeId = inferCandidateRouteId(button);
    const label = buttonLabelForVoice(button);
    const voiceAliases = button.getAttribute("data-voice-aliases");

    addAlias(aliasSet, label);
    addAlias(aliasSet, button.title);
    addAlias(aliasSet, button.getAttribute("aria-label"));
    addAlias(aliasSet, button.id);
    addAlias(aliasSet, button.id.replace(/-/g, " "));
    addAlias(aliasSet, phase);
    addAlias(aliasSet, action);
    addAlias(aliasSet, tabId);
    addAlias(aliasSet, tabLabel);
    addAlias(aliasSet, toolType);
    addAlias(aliasSet, groupLabel);
    addAlias(aliasSet, `open ${label}`);
    addAlias(aliasSet, `press ${label}`);
    addAlias(aliasSet, `click ${label}`);
    addAlias(aliasSet, `select ${label}`);
    addAlias(aliasSet, `${phase} ${action}`);
    collectButtonContextAliases(button, aliasSet);
    addButtonClassAlias(aliasSet, button);
    addButtonGlyphAlias(aliasSet, button.textContent || "");
    addButtonIconAlias(aliasSet, button);
    if (tabId) {
      addAlias(aliasSet, `${tabId} tab`);
      addAlias(aliasSet, `tab ${tabId}`);
      addAlias(aliasSet, `open ${tabId} tab`);
      addAlias(aliasSet, `${tabLabel || ""} tab`);
    }
    addAliasTokens(aliasSet, label);
    addAliasTokens(aliasSet, groupLabel);
    addAliasTokens(aliasSet, phase);
    addAliasTokens(aliasSet, tabLabel);
    if (voiceAliases) {
      voiceAliases
        .split(VOICE_ALIAS_SEPARATOR)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
        .forEach((alias) => {
          addAlias(aliasSet, alias);
          addAliasTokens(aliasSet, alias);
        });
    }

    const aliases = Array.from(aliasSet).map((value) => normalizeVoiceText(value)).filter(Boolean);
    if (!aliases.length) {
      continue;
    }
    const tokens = new Set<string>();
    aliases.forEach((alias) => {
      voiceTokens(alias).forEach((token) => tokens.add(token));
    });
    candidates.push({
      element: button,
      label: label || phase || action || tabId || "Button",
      aliases,
      tokens,
      phase,
      action,
      tabId,
      tabLabel,
      groupLabel,
      toolType,
      routeId: routeId || undefined
    });
  }
  return candidates;
};

const getVoiceButtonCandidates = (): VoiceButtonCandidate[] => collectVoiceButtonCandidates({ visibleOnly: true });

const normalizeVoiceText = (value: string): string => {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/_+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const voiceTokens = (value: string): string[] => normalizeVoiceText(value)
  .split(" ")
  .map((token) => token.trim())
  .filter((token) => token.length > 1 && !VOICE_STOPWORDS.has(token));

const getVoiceActionCandidates = (): VoiceActionCandidate[] => {
  if (cachedVoiceActionCandidates) {
    return cachedVoiceActionCandidates;
  }
  const candidates: VoiceActionCandidate[] = [];
  for (const { action } of VOICE_ACTION_SEEDS) {
    const aliases = new Set<string>();
    addAlias(aliases, action.label);
    addAlias(aliases, action.id);
    addAlias(aliases, action.id.replace(/-/g, " "));
    addAlias(aliases, action.command.action);
    addAlias(aliases, action.command.action.replace(/_/g, " ").replace(/-/g, " "));
    addAlias(aliases, action.command.phase);
    addAlias(aliases, action.hint);
    addAlias(aliases, `open ${action.label}`);
    addAlias(aliases, `show ${action.label}`);
    addAlias(aliases, `press ${action.label}`);
    addAlias(aliases, `${action.command.phase} ${action.label}`);
    if (action.group) {
      addAlias(aliases, action.group);
      addAliasTokens(aliases, action.group);
    }
    const manual = VOICE_ACTION_MANUAL_ALIASES[action.id];
    if (manual) {
      manual.forEach((alias) => aliases.add(alias));
    }
    addAliasTokens(aliases, action.label);
    addAliasTokens(aliases, action.hint);
    addAliasTokens(aliases, action.command.action);
    addAliasTokens(aliases, action.command.phase);
    const aliasList = Array.from(aliases).map(normalizeVoiceText).filter(Boolean);
    const tokenSet = new Set<string>();
    aliasList.forEach((alias) => {
      voiceTokens(alias).forEach((token) => tokenSet.add(token));
    });
    candidates.push({
      action,
      aliases: aliasList,
      tokens: tokenSet
    });
  }
  cachedVoiceActionCandidates = candidates;
  return candidates;
};

const getActionAliasList = (): string[] =>
  getVoiceActionCandidates().map(({ action }) => `${action.label} (${action.id})`);

function parseRetrieveProviderFromText(text: string): RetrieveProviderId | null {
  const normalized = String(text || "").toLowerCase();
  if (/\bsemantic[\s_-]?scholar|s2|semanticscholar|sematic|prover/.test(normalized)) return "semantic_scholar";
  if (/\bcrossref/.test(normalized)) return "crossref";
  if (/\bopen[\s_-]?alex/.test(normalized)) return "openalex";
  if (/\belsevier/.test(normalized)) return "elsevier";
  if (/\bwos\b|\bweb\s+of\s+science/.test(normalized)) return "wos";
  if (/\bunpaywall/.test(normalized)) return "unpaywall";
  if (/\bcos\b/.test(normalized)) return "cos";
  return null;
}

function parseRetrieveSortFromText(text: string): RetrieveSort | null {
  const normalized = String(text || "").toLowerCase();
  if (/\brelevance\b/.test(normalized) || /\brelevant\b/.test(normalized)) return "relevance";
  if (/\byear\b/.test(normalized) || /\byears\b/.test(normalized)) return "year";
  return null;
}

function parseRetrieveYearRangeFromText(text: string): { year_from: number | null; year_to: number | null } | null {
  const normalized = String(text || "").toLowerCase();
  if (/\bclear\b/.test(normalized)) {
    return { year_from: null, year_to: null };
  }

  const explicitRangeWithLabel = normalized.match(/\byear(?:s)?\s+range\s*(?:of|:)?\s+(\d{4})\s+(?:to|through|thru|-)\s+(\d{4})\b/);
  if (explicitRangeWithLabel) {
    return {
      year_from: Number(explicitRangeWithLabel[1]),
      year_to: Number(explicitRangeWithLabel[2])
    };
  }

  const explicitYears = normalized.match(/\byears?\s+(\d{4})\s+(?:to|through|thru|-)\s+(\d{4})\b/);
  if (explicitYears) {
    return {
      year_from: Number(explicitYears[1]),
      year_to: Number(explicitYears[2])
    };
  }

  const between = normalized.match(/\b(?:between|from)\s+(\d{4})\s+(?:and|to|-|through|thru)\s+(\d{4})\b/);
  if (between) {
    return {
      year_from: Number(between[1]),
      year_to: Number(between[2])
    };
  }

  const singleRange = normalized.match(/\b(\d{4})\s+(?:to|-)\s+(\d{4})\b/);
  if (singleRange) {
    return {
      year_from: Number(singleRange[1]),
      year_to: Number(singleRange[2])
    };
  }

  const afterMatch = normalized.match(/\b(?:after|from)\s+(\d{4})\b/);
  if (afterMatch) {
    return { year_from: Number(afterMatch[1]), year_to: null };
  }

  const beforeMatch = normalized.match(/\b(?:before|by|until)\s+(\d{4})\b/);
  if (beforeMatch) {
    return { year_from: null, year_to: Number(beforeMatch[1]) };
  }

  return null;
}

function parsePositiveInt(text: string): number | null {
  const normalized = String(text || "").toLowerCase();
  const match = normalized.match(/\b(\d{1,4})\b/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

type VoiceRetrieveDefaultsPayload = {
  provider?: RetrieveProviderId;
  sort?: RetrieveSort;
  year_from?: number | null;
  year_to?: number | null;
  limit?: number;
  openQueryBuilder?: boolean;
};

function parseVoiceRetrieveDefaults(text: string): VoiceRetrieveDefaultsPayload {
  const normalized = String(text || "").toLowerCase();
  const provider = parseRetrieveProviderFromText(normalized);
  const sort = parseRetrieveSortFromText(normalized);
  const yearRange = parseRetrieveYearRangeFromText(normalized);
  const parsedLimit = parsePositiveInt(normalized);
  const defaults: VoiceRetrieveDefaultsPayload = {};
  if (provider) {
    defaults.provider = provider;
  }
  if (sort) {
    defaults.sort = sort;
  }
  if (yearRange) {
    defaults.year_from = yearRange.year_from;
    defaults.year_to = yearRange.year_to;
  }
  if (/\blimit\b/.test(normalized) && parsedLimit !== null) {
    defaults.limit = parsedLimit;
  }
  return defaults;
}

function hasRetrieveDefaultsSignal(normalized: string): boolean {
  return (
    /\bprovider\b/.test(normalized) ||
    /\bsort\b/.test(normalized) ||
    /\byear\b/.test(normalized) ||
    /\byears\b/.test(normalized) ||
    /\blimit\b/.test(normalized) ||
    /\b(?:between|from|to|before|after|clear)\b/.test(normalized) ||
    /semantic|crossref|openalex|elsevier|wos|unpaywall|cos/.test(normalized) ||
    Boolean(parseRetrieveProviderFromText(normalized))
  );
}

function parseVoiceAction(text: string): VoiceActionCommand | null {
  const normalized = normalizeVoiceText(text);
  if (!normalized || normalized.length < 2) {
    return null;
  }

  const inventoryRequest = parseVoiceInventoryIntent(normalized);
  if (inventoryRequest) {
    return {
      command: {
        phase: "agent",
        action: "agent_voice_inventory",
        payload: inventoryRequest
      },
      feedback: "Building voice control inventory."
    };
  }

  const requestedSearch = /\bsearch\b/.test(normalized) || /\bquery\b/.test(normalized);
  const defaults = parseVoiceRetrieveDefaults(normalized);

  if (requestedSearch && hasRetrieveDefaultsSignal(normalized) && Object.keys(defaults).length > 0) {
    return {
      command: {
        phase: "agent",
        action: "agent_voice_apply_retrieve_defaults",
        payload: {
          ...defaults,
          openQueryBuilder: true
        }
      },
      feedback: "Applying retrieve defaults and opening search."
    };
  }

  const provider = parseRetrieveProviderFromText(normalized);
  if (provider && /\bprovider\b/.test(normalized)) {
    return {
      command: {
        phase: "retrieve",
        action: "retrieve_set_provider",
        payload: { provider }
      },
      feedback: `Setting provider to ${provider}.`
    };
  }

  const sort = parseRetrieveSortFromText(normalized);
  if (sort && /\bsort\b/.test(normalized)) {
    return {
      command: {
        phase: "retrieve",
        action: "retrieve_set_sort",
        payload: { sort }
      },
      feedback: `Setting sort to ${sort}.`
    };
  }

  const yearRange = parseRetrieveYearRangeFromText(normalized);
  if (yearRange && /\b(year|years|from|between|before|after)\b/.test(normalized)) {
    return {
      command: {
        phase: "retrieve",
        action: "retrieve_set_year_range",
        payload: {
          year_from: yearRange.year_from,
          year_to: yearRange.year_to
        }
      },
      feedback: "Updating retrieve year range."
    };
  }

  const limit = parsePositiveInt(normalized);
  if (limit && /\blimit\b/.test(normalized)) {
    return {
      command: {
        phase: "retrieve",
        action: "retrieve_set_limit",
        payload: { limit }
      },
      feedback: `Setting result limit to ${limit}.`
    };
  }

  if (requestedSearch) {
    return {
      command: {
        phase: "retrieve",
        action: "retrieve_open_query_builder"
      },
      feedback: "Opening Retrieve Search."
    };
  }

  if (hasRetrieveDefaultsSignal(normalized) && Object.keys(defaults).length > 0) {
    return {
      command: {
        phase: "agent",
        action: "agent_voice_apply_retrieve_defaults",
        payload: defaults
      },
      feedback: `Updating retrieve defaults.`
    };
  }

  const tokens = voiceTokens(normalized);
  const scored = getVoiceActionCandidates()
    .map((candidate) => {
      const { aliasScore, tokenMatchCount, score } = scoreVoiceAliases(normalized, candidate.aliases);
      return { candidate, aliasScore, tokenMatchCount, score };
    })
    .filter((entry) => entry.score >= VOICE_ACTION_MIN_SCORE || entry.aliasScore >= 260)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) {
    return null;
  }
  const next = scored[1];
  if (next && top.score >= VOICE_ACTION_MIN_SCORE && top.score < 90 && top.score - next.score < VOICE_ACTION_MIN_GAP) {
    return {
      command: {
        phase: "agent",
        action: "agent_voice_ambiguous"
      },
      feedback: `I heard: ${text}. Can you be specific? For example: ${getActionAliasList()
        .filter((item) => {
          const lower = item.toLowerCase();
          return tokens.some((token) => lower.includes(token));
        })
        .slice(0, 3)
        .join(", ")}`
    };
  }
  const winner = scored[0];
  const action = winner.candidate.action;
  return {
    command: {
      phase: action.command.phase,
      action: action.command.action,
      payload: action.command.payload ? { ...(action.command.payload as Record<string, unknown>) } : undefined
    },
    feedback: `Pressed ${action.label}.`
  };
}

function runMappedVoiceAction(mapped: VoiceActionCommand, options?: VoiceCommandExecutionOptions): void {
  const shouldSpeak = shouldSpeakVoiceReply(options);
  if (mapped.command.phase === "agent" && mapped.command.action === "agent_voice_ambiguous") {
    pushAgentChatMessage("assistant", mapped.feedback, "error", shouldSpeak ? { speak: true } : undefined);
    return;
  }
  if (mapped.command.action === "agent_voice_inventory") {
    const request = normalizeVoiceInventoryPayload(mapped.command.payload as Record<string, unknown> | undefined);
    const report = buildVoiceButtonInventory(request);
    const count = report.entries.length;
    const scopeLabel = request.scope === "all" ? "all discovered controls" : "visible controls";
    const routeLabel = request.routeId ? describeRoute(request.routeId) : describeRoute(activeRouteId || "");
    const limitLabel = request.limit ? ` (limited to ${request.limit})` : "";
    const summary = `Found ${count} ${scopeLabel} on ${routeLabel}${limitLabel}.`;
    if (request.format === "json") {
      if (shouldSpeak) {
        pushAgentChatMessage("assistant", `${summary} JSON output is disabled in speech mode.`, "error", shouldSpeak ? { speak: true } : undefined);
      } else {
        pushAgentChatMessage("assistant", `${summary}\n${JSON.stringify(report.entries, null, 2)}`);
      }
      return;
    }
    const byRoute: Record<string, number> = {};
    report.entries.forEach((entry) => {
      const key = entry.routeId || "unknown";
      byRoute[key] = (byRoute[key] || 0) + 1;
    });
    const routeSummary = Object.entries(byRoute)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([route, total]) => `${route}: ${total}`)
      .join(", ");
    const topEntries = report.entries.slice(0, VOICE_INVENTORY_PREVIEW_LIMIT);
    const lineItems = topEntries.map((entry, index) => {
      const aliasHint = entry.aliases.slice(0, 4).join(", ");
      const label = entry.label || "Button";
      return `${index + 1}. [${entry.routeId || "route"}] ${label} — ${aliasHint}`;
    });
    const remaining = Math.max(0, report.entries.length - topEntries.length);
    const preview = lineItems.length ? `\nTop controls:\n${lineItems.join("\n")}${remaining > 0 ? `\n...and ${remaining} more.` : ""}` : "";
    const inventoryFeedback = `${summary}${routeSummary ? `\nRoute coverage: ${routeSummary}.` : ""}${preview}`;
    pushAgentChatMessage("assistant", inventoryFeedback, count ? undefined : "error", shouldSpeak ? { speak: true } : undefined);
    if (shouldSpeak) {
      pushAgentChatMessage(
        "assistant",
        `There are ${count} controls detected. Use \"voice inventory json\" if you want the raw JSON map text dump.`
      );
    }
    return;
  }
  if (mapped.command.action === "retrieve_set_provider") {
    const provider = String(mapped.command.payload?.provider || "").trim();
    if (!provider) {
      pushAgentChatMessage(
        "assistant",
        "I couldn't detect a provider name for the voice command.",
        "error",
        shouldSpeak ? { speak: true } : undefined
      );
      return;
    }
    writeRetrieveQueryDefaults({ provider: provider as RetrieveProviderId });
    applyRoute("retrieve:search");
    pushAgentChatMessage(
      "assistant",
      mapped.feedback,
      undefined,
      shouldSpeak ? { speak: true } : undefined
    );
    return;
  }
  if (mapped.command.action === "retrieve_set_sort") {
    const sort = String(mapped.command.payload?.sort || "").trim();
    if (sort !== "relevance" && sort !== "year") {
      pushAgentChatMessage(
        "assistant",
        "I couldn't detect a valid sort option for the voice command.",
        "error",
        shouldSpeak ? { speak: true } : undefined
      );
      return;
    }
    writeRetrieveQueryDefaults({ sort: sort as RetrieveSort });
    applyRoute("retrieve:search");
    pushAgentChatMessage(
      "assistant",
      mapped.feedback,
      undefined,
      shouldSpeak ? { speak: true } : undefined
    );
    return;
  }
  if (mapped.command.action === "retrieve_set_year_range") {
    const defaults: { year_from?: number; year_to?: number } = {};
    const rawYearFrom = mapped.command.payload?.year_from;
    const rawYearTo = mapped.command.payload?.year_to;
    const yearFrom = rawYearFrom === null || rawYearFrom === undefined ? null : Number(rawYearFrom);
    const yearTo = rawYearTo === null || rawYearTo === undefined ? null : Number(rawYearTo);
    if (rawYearFrom === null && rawYearTo === null) {
      writeRetrieveQueryDefaults({ year_from: undefined, year_to: undefined });
    } else {
      if (yearFrom !== null && Number.isFinite(yearFrom)) defaults.year_from = yearFrom;
      if (yearTo !== null && Number.isFinite(yearTo)) defaults.year_to = yearTo;
      writeRetrieveQueryDefaults(defaults);
    }
    panelGrid.ensurePanelVisible(2);
    applyRoute("retrieve:search");
    pushAgentChatMessage(
      "assistant",
      mapped.feedback,
      undefined,
      shouldSpeak ? { speak: true } : undefined
      );
    return;
  }
  if (mapped.command.action === "retrieve_set_limit") {
    const limit = Number(mapped.command.payload?.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
    pushAgentChatMessage(
      "assistant",
      "I couldn't detect a valid positive integer limit for the voice command.",
      "error",
      shouldSpeak ? { speak: true } : undefined
    );
    return;
  }
    writeRetrieveQueryDefaults({ limit: Math.floor(limit) });
    panelGrid.ensurePanelVisible(2);
    applyRoute("retrieve:search");
    pushAgentChatMessage(
      "assistant",
      mapped.feedback,
      undefined,
      shouldSpeak ? { speak: true } : undefined
    );
    return;
  }
  if (mapped.command.action === "agent_voice_apply_retrieve_defaults") {
    const payload = mapped.command.payload as (VoiceRetrieveDefaultsPayload & {
      provider?: string;
      sort?: string;
    }) | undefined;
    const updates: Array<string> = [];
    const merged = {
      provider: payload?.provider,
      sort: payload?.sort,
      year_from: payload?.year_from,
      year_to: payload?.year_to,
      limit: payload?.limit
    };
    if (typeof merged.provider === "string" && merged.provider) {
      updates.push(`provider ${merged.provider}`);
    }
    if (merged.sort === "relevance" || merged.sort === "year") {
      updates.push(`sort ${merged.sort}`);
    }
    if (typeof merged.limit === "number" && Number.isFinite(merged.limit) && merged.limit > 0) {
      updates.push(`limit ${Math.floor(merged.limit)}`);
    }
    if (merged.year_from === null && merged.year_to === null) {
      updates.push("cleared year range");
    } else if (typeof merged.year_from === "number" || typeof merged.year_to === "number") {
      if (typeof merged.year_from === "number" && Number.isFinite(merged.year_from)) {
        updates.push(`year from ${merged.year_from}`);
      }
      if (typeof merged.year_to === "number" && Number.isFinite(merged.year_to)) {
        updates.push(`year to ${merged.year_to}`);
      }
    }

    const openQueryBuilder = payload?.openQueryBuilder === true;
    if (openQueryBuilder && !updates.length) {
      applyRoute("retrieve:search");
      pushAgentChatMessage(
        "assistant",
        "Opening Retrieve Search.",
        undefined,
        shouldSpeak ? { speak: true } : undefined
      );
      return;
    }

    if (!updates.length) {
    pushAgentChatMessage(
      "assistant",
      "I didn't detect any valid retrieve defaults to apply.",
      "error",
      shouldSpeak ? { speak: true } : undefined
    );
    return;
    }
    const nextDefaults: Partial<RetrieveQueryDefaults> = {};
    if (typeof merged.provider === "string" && merged.provider) {
      nextDefaults.provider = merged.provider as RetrieveProviderId;
    }
    if (merged.sort === "relevance" || merged.sort === "year") {
      nextDefaults.sort = merged.sort as RetrieveSort;
    }
    if (typeof merged.limit === "number" && Number.isFinite(merged.limit) && merged.limit > 0) {
      nextDefaults.limit = Math.floor(merged.limit);
    }
    if (merged.year_from === null) {
      nextDefaults.year_from = undefined;
    } else if (typeof merged.year_from === "number" && Number.isFinite(merged.year_from)) {
      nextDefaults.year_from = merged.year_from;
    }
    if (merged.year_to === null) {
      nextDefaults.year_to = undefined;
    } else if (typeof merged.year_to === "number" && Number.isFinite(merged.year_to)) {
      nextDefaults.year_to = merged.year_to;
    }
    writeRetrieveQueryDefaults(nextDefaults);
    panelGrid.ensurePanelVisible(2);
    applyRoute("retrieve:search");
    pushAgentChatMessage(
      "assistant",
      openQueryBuilder
        ? `Updated retrieve defaults and opening search: ${updates.join(", ")}.`
        : `Updated retrieve defaults: ${updates.join(", ")}.`,
      undefined,
      shouldSpeak ? { speak: true } : undefined
    );
    return;
}

  const action: RibbonAction = {
    id: "agent-voice-action",
    label: "Voice action",
    hint: "Mapped from voice command",
    iconId: "agent",
    command: {
      phase: mapped.command.phase,
      action: mapped.command.action,
      payload: mapped.command.payload
    }
  };
  handleAction(action);
  pushAgentChatMessage(
    "assistant",
    mapped.feedback,
    undefined,
    shouldSpeak ? { speak: true } : undefined
  );
}

function resolveVoiceButtonAction(text: string): VoiceButtonCandidate | null {
  const normalized = normalizeVoiceText(text);
  if (!normalized || normalized.length < 2) {
    return null;
  }

  const resolveFrom = (candidates: VoiceButtonCandidate[]): VoiceButtonCandidate | null => {
    const scored = candidates
      .map((candidate) => {
        const { aliasScore, tokenMatchCount, score } = scoreVoiceAliases(normalized, candidate.aliases);
        return {
          candidate,
          aliasScore,
          tokenMatchCount,
          score
        };
      })
      .filter((entry) => entry.score >= VOICE_BUTTON_MIN_SCORE || entry.aliasScore >= 260)
      .sort((a, b) => b.score - a.score);

    const top = scored[0];
    if (!top) {
      return null;
    }

    const next = scored[1];
    if (next && top.score >= VOICE_BUTTON_MIN_SCORE && top.score < 90 && top.score - next.score < VOICE_BUTTON_MIN_GAP) {
      return null;
    }
    return top.candidate;
  };

  const visibleMatch = resolveFrom(getVoiceButtonCandidates());
  if (visibleMatch) {
    return visibleMatch;
  }

  return resolveFrom(collectVoiceButtonCandidates({ visibleOnly: false }));
}

const setSelectValueByVoice = (element: HTMLSelectElement, value: string): boolean => {
  const target = value.trim().toLowerCase();
  if (!target) return false;
  for (const option of Array.from(element.options)) {
    const normalizedValue = option.value.trim().toLowerCase();
    const normalizedLabel = (option.textContent || "").trim().toLowerCase();
    if (normalizedValue === target || normalizedLabel === target || normalizedLabel.includes(target) || target.includes(normalizedLabel)) {
      if (element.value !== option.value) {
        element.value = option.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    }
  }
  return false;
};

const setNumericInputByVoice = (element: HTMLInputElement, raw: string): boolean => {
  const normalized = normalizeVoiceText(raw);
  const yearRange = parseRetrieveYearRangeFromText(normalized);
  const rawNumbers = normalized.match(/\b\d{1,4}\b/g);
  const firstNumber = rawNumbers ? Number(rawNumbers[0]) : null;
  const secondNumber = rawNumbers && rawNumbers.length > 1 ? Number(rawNumbers[1]) : null;
  const label = normalizeVoiceText(buttonLabelForVoice(element));

  let next: number | null = null;
  if (label.includes("from") && yearRange?.year_from) {
    next = yearRange.year_from;
  } else if (label.includes("to") && yearRange?.year_to) {
    next = yearRange.year_to;
  } else if ((label.includes("limit") || label.includes("year")) && (firstNumber !== null)) {
    next = firstNumber;
  } else if (firstNumber !== null && secondNumber !== null) {
    next = firstNumber;
  }
  if (next === null || !Number.isFinite(next)) return false;
  if (element.min && Number(element.min) > next) return false;
  if (element.max && Number(element.max) < next) return false;
  const nextValue = String(Math.floor(next));
  if (nextValue !== element.value) {
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
};

const focusVoiceInput = (element: HTMLInputElement | HTMLTextAreaElement): boolean => {
  if (element.disabled) return false;
  element.focus();
  element.dispatchEvent(new Event("focus", { bubbles: true }));
  return true;
};

const activateVoiceButtonCandidate = (candidate: VoiceButtonCandidate, raw: string): boolean => {
  const normalized = normalizeVoiceText(raw);
  const element = candidate.element;
  const normalizedLabel = normalizeVoiceText(buttonLabelForVoice(element));

  if (element instanceof HTMLSelectElement) {
    const provider = parseRetrieveProviderFromText(normalized);
    if (provider && (normalizedLabel.includes("provider") || candidate.aliases.some((alias) => alias.includes("provider")))) {
      if (setSelectValueByVoice(element, provider)) return true;
    }
    const sort = parseRetrieveSortFromText(normalized);
    if (sort && (normalizedLabel.includes("sort") || candidate.aliases.some((alias) => alias.includes("sort")))) {
      if (setSelectValueByVoice(element, sort)) return true;
    }
    return false;
  }

  if (element instanceof HTMLInputElement && element.type === "number") {
    return setNumericInputByVoice(element, raw);
  }
  if (element instanceof HTMLTextAreaElement) {
    return focusVoiceInput(element);
  }
  if (
    element instanceof HTMLInputElement &&
    (element.type === "text" ||
      element.type === "search" ||
      element.type === "email" ||
      element.type === "url")
  ) {
    return focusVoiceInput(element);
  }

  element.click();
  return true;
};

type ChatUnifiedSearchIntent = {
  query: string;
  maxPages: number;
  headed: boolean;
  browserProviders: string[];
};

const summarizeProviderHelp = (providers: string[]): string => {
  const tips: string[] = [];
  providers.forEach((provider) => {
    const p = provider.toLowerCase();
    if (p.includes("jstor")) tips.push("JSTOR: likely CAPTCHA/anti-bot, use assist browser then retry.");
    if (p.includes("cambridge")) tips.push("Cambridge: verify institutional access/login.");
    if (p.includes("google")) tips.push("Google Scholar: solve bot challenge in assist browser.");
    if (p.includes("semantic")) tips.push("Semantic Scholar API: check key/rate limit.");
    if (p.includes("crossref")) tips.push("Crossref API: verify network availability.");
  });
  return tips.length ? tips.join("\n") : "Use assist browser, complete login/CAPTCHA, then say 'retry search'.";
};

const CHAT_PROVIDER_HINTS: Array<{ id: string; aliases: string[] }> = [
  { id: "google", aliases: ["google scholar", "scholar", "google"] },
  { id: "cambridge", aliases: ["cambridge"] },
  { id: "jstor", aliases: ["jstor"] },
  { id: "brill", aliases: ["brill"] },
  { id: "digital_commons", aliases: ["digital commons", "commons"] },
  { id: "rand", aliases: ["rand"] },
  { id: "academia", aliases: ["academia", "academia.edu"] },
  { id: "elgaronline", aliases: ["elgar", "elgaronline"] },
  { id: "springerlink", aliases: ["springer", "springerlink"] }
];

const extractChatUnifiedSearchIntent = (text: string): ChatUnifiedSearchIntent | null => {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const searchSignal = /\b(search|find|look\s+for|look\s+up|retrieve|collect)\b/.test(lower);
  if (!searchSignal) return null;
  if (/\b(zotero|codebook|verbatim|pipeline|screen)\b/.test(lower)) return null;

  const providerFirstMatch =
    raw.match(
      /\b(?:search|find|look\s+for|look\s+up|retrieve|collect)\b\s+(?:on|in)\s+(google scholar|google|cambridge|jstor|brill|digital commons|rand|academia|academia\.edu|elgar|elgaronline|springer|springerlink)\s+(?:for|about|on)\s+(.+)$/i
    ) ||
    raw.match(
      /\b(?:search|find|look\s+for|look\s+up|retrieve|collect)\b\s+(?:for|about|on)\s+(.+)\s+(?:on|in)\s+(google scholar|google|cambridge|jstor|brill|digital commons|rand|academia|academia\.edu|elgar|elgaronline|springer|springerlink)\b/i
    );
  const providerAlias = /^(google scholar|google|cambridge|jstor|brill|digital commons|rand|academia|academia\.edu|elgar|elgaronline|springer|springerlink)$/i;
  const providerFirstQuery =
    providerFirstMatch
      ? (providerAlias.test(String(providerFirstMatch[1] || "").trim())
        ? String(providerFirstMatch[2] || "").trim()
        : String(providerFirstMatch[1] || "").trim())
      : "";
  const queryMatch =
    (providerFirstMatch && providerFirstQuery
      ? [providerFirstMatch[0], providerFirstQuery]
      : null) ||
    raw.match(/^\s*(?:search|find|retrieve|collect)\s+(.+)$/i) ||
    raw.match(/^\s*look\s+(?:for|up)\s+(.+)$/i) ||
    raw.match(/\b(?:search|find|look\s+for|retrieve|collect)\b(?:\s+(?:about|for|on))?\s+(.+)$/i) ||
    raw.match(/\b(?:papers?|articles?|studies?)\b\s+(?:about|on|for)\s+(.+)$/i);
  let query = String(queryMatch?.[1] || "").trim();
  if (!query) return null;
  query = query
    .replace(/^(?:on|in)\s+(google scholar|google|cambridge|jstor|brill|digital commons|rand|academia|academia\.edu|elgar|elgaronline|springer|springerlink)\s+(?:for|about|on)\s+/i, "")
    .replace(/\b(in|on)\s+(google scholar|google|cambridge|jstor|brill|digital commons|rand|academia|academia\.edu|elgar|elgaronline|springer|springerlink)\b.*$/i, "")
    .replace(/\b(max(?:imum)?\s+)?\d+\s+pages?\b.*$/i, "")
    .replace(/\bheadless\b.*$/i, "")
    .trim()
    .replace(/^["']+|["']+$/g, "");
  if (!query) return null;

  const pagesMatch = lower.match(/\b(?:max(?:imum)?\s+)?(\d{1,2})\s+pages?\b/) || lower.match(/\bpages?\s*(?:=|:)?\s*(\d{1,2})\b/);
  const maxPages = pagesMatch ? Math.max(1, Math.min(20, Number(pagesMatch[1]) || 3)) : 3;
  const headed = !/\b(headless|background|hidden)\b/.test(lower);

  const browserProviders = CHAT_PROVIDER_HINTS
    .filter((entry) => entry.aliases.some((alias) => lower.includes(alias)))
    .map((entry) => entry.id);

  return { query, maxPages, headed, browserProviders };
};

const buildAcademicSearchStrategy = (query: string): string => {
  const clean = String(query || "").trim().replace(/\s+/g, " ");
  const tokens = clean
    .split(/\s+/)
    .map((t) => t.replace(/[^\w-]/g, ""))
    .filter((t) => t.length > 2);
  const tokenBlock = tokens.length ? tokens.map((t) => `"${t}"`).join(" AND ") : `"${clean}"`;

  const lower = clean.toLowerCase();
  const groups: string[] = [`("${clean}")`, `(${tokenBlock})`];
  if (lower.includes("cyber") && lower.includes("attribution")) {
    groups.push(`("cyber attribution" OR "cyber-attack attribution" OR "attribution framework")`);
  }
  groups.push(`(framework OR model OR method OR methodology)`);
  return groups.join(" AND ");
};

const initRetrieveSearchIntakeBridge = (): void => {
  document.addEventListener("retrieve:request-search-intake", (event: Event) => {
    const detail = ((event as CustomEvent<Record<string, unknown>>).detail || {}) as Record<string, unknown>;
    const query = String(detail.query || "").trim();
    const strategySeed = String(detail.strategy || "").trim() || query;
    const maxPages = Math.max(1, Math.min(20, Number(detail.maxPages || 3) || 3));
    const headed = detail.headed !== false;
    const browserProviders = Array.isArray(detail.browserProviders)
      ? (detail.browserProviders as unknown[]).map((p) => String(p || "").trim()).filter(Boolean)
      : [];
    if (!query && !strategySeed) {
      pushAgentChatMessage("assistant", "Enter a topic in Retrieve before starting search intake.", "error");
      return;
    }
    pendingAcademicSearchIntake = {
      step: "awaiting_details",
      query: query || strategySeed,
      strategySeed,
      generatedStrategy: "",
      detailsText: "",
      maxPages,
      headed,
      browserProviders
    };
    setAgentChatOpen(true);
    pushAgentChatMessage(
      "assistant",
      `Before searching, add brief scope details for: ${(query || strategySeed)}.\nReply with:\n1) focus/objective\n2) timeframe (if any)\n3) inclusion/exclusion hints\nThen I will generate strategy and run browser + APIs.`
    );
  });
};

const generateStrategyFromIntake = async (args: {
  query: string;
  browserProviders: string[];
  detailsText: string;
  strategySeed: string;
}): Promise<string> => {
  const objective = args.detailsText.trim() || "broad academic retrieval";
  if (window.agentBridge?.generateAcademicStrategy) {
    const out = await window.agentBridge.generateAcademicStrategy({
      query: args.query,
      providers: args.browserProviders,
      objective
    });
    const strategy = String(out?.strategy || "").trim();
    if (out?.status === "ok" && strategy) return strategy;
  }
  return buildAcademicSearchStrategy(`${args.strategySeed} ${objective}`.trim());
};

const executeUnifiedSearchPlan = async (args: {
  query: string;
  strategy: string;
  maxPages: number;
  headed: boolean;
  browserProviders: string[];
  pushAssistant: (message: string, tone?: "error") => void;
}): Promise<void> => {
  const providersLabel = args.browserProviders.length ? args.browserProviders.join(", ") : "default providers";
  applyRoute("retrieve:search");
  ensureRetrieveSearchAppTool();
  document.dispatchEvent(
    new CustomEvent("retrieve:agent-unified-search", {
      detail: {
        query: args.query,
        strategy: args.strategy,
        maxPages: args.maxPages,
        headed: args.headed,
        browserProviders: args.browserProviders,
        runNow: false
      }
    })
  );
  args.pushAssistant(`Running browser + API collection (${providersLabel}, ${args.maxPages} pages/provider).`);
  const response = ((await command("retrieve", "run_unified_strategy", {
    query: args.strategy,
    browserProviders: args.browserProviders,
    maxPages: args.maxPages,
    headed: args.headed,
    includeSemanticApi: true,
    includeCrossrefApi: true
  })) as unknown) as Record<string, unknown>;
  if (String(response?.status || "") !== "ok") {
    args.pushAssistant(String(response?.message || "Unified search failed."), "error");
    return;
  }
  const total = Number(response?.total || 0);
  const runDir = String(response?.runDir || "");
  const unifiedPath = String(response?.unifiedPath || "");
  const stats = (response?.stats || {}) as Record<string, unknown>;
  const merged = Number(stats?.merged_count || 0);
  const deduped = Number(stats?.deduplicated_count || total);
  const duplicatesRemoved = Number(stats?.duplicates_removed || 0);
  const failedProviders = Array.isArray(response?.failedProviders)
    ? (response.failedProviders as unknown[]).map((p) => String(p || "").trim()).filter(Boolean)
    : [];
  if (failedProviders.length) {
    pendingUnifiedSearchRetry = {
      query: args.query,
      strategy: args.strategy,
      maxPages: args.maxPages,
      headed: args.headed,
      providers: args.browserProviders,
      failedProviders,
      attempts: 1
    };
  } else {
    pendingUnifiedSearchRetry = null;
  }
  args.pushAssistant(
    `Unified search completed.\nQuery: ${args.query}\nMerged: ${merged}\nDeduplicated: ${deduped}\nDuplicates removed: ${duplicatesRemoved}${runDir ? `\nRun folder: ${runDir}` : ""}${unifiedPath ? `\nUnified JSON: ${unifiedPath}` : ""}`
  );
  if (failedProviders.length) {
    args.pushAssistant(
      `Some providers need intervention: ${failedProviders.join(", ")}.\n${summarizeProviderHelp(failedProviders)}\nThen say "retry search".`,
      "error"
    );
  }
};

async function executeResolvedIntent(
  intent: Record<string, unknown>,
  options?: VoiceCommandExecutionOptions,
  commandText?: string
): Promise<void> {
  const shouldSpeak = shouldSpeakVoiceReply(options);
  const pushAssistant = (message: string, tone?: "error"): void =>
    pushAgentChatMessage("assistant", message, tone, shouldSpeak ? { speak: true } : undefined);
  if (!window.agentBridge?.executeIntent) {
    pushAssistant("Agent execute bridge unavailable.", "error");
    setAgentChatPending(false);
    return;
  }
  const preflight = Array.isArray(intent?.preflightIntents) ? (intent.preflightIntents as Record<string, unknown>[]) : [];
  for (const pre of preflight) {
    const preRes = await window.agentBridge.executeIntent({
      intent: pre,
      confirm: true,
      context: buildAgentContextPayloadForText(String(commandText || ""), options)
    });
    if (preRes?.status !== "ok") {
      setAgentChatPending(false);
      pushAssistant(String(preRes?.message || "Preflight execution failed."), "error");
      return;
    }
  }
  const res = await window.agentBridge.executeIntent({
    intent,
    confirm: true,
    context: buildAgentContextPayloadForText(String(commandText || ""), options)
  });
  setAgentChatPending(false);

  if (res?.status !== "ok") {
    pushAssistant(String(res?.message || "Intent execution failed."), "error");
    return;
  }

  agentChatState.pendingIntent = null;
  const result = (res?.result || {}) as Record<string, unknown>;
  const functionName = String(res?.function || "");
  if (functionName === "legacy.refresh" || String(result?.action || "") === "zotero_refresh_tree") {
    applyRoute("retrieve:zotero");
    void retrieveZoteroContext.loadTree();
    pushAssistant(String(result?.reply || "Refreshing Zotero collections and items."));
    return;
  }
  if (functionName === "legacy.load_collection" || String(result?.action || "") === "zotero_load_selected_collection") {
    applyRoute("retrieve:zotero");
    void retrieveZoteroContext.loadSelectedCollectionToDataHub();
    pushAssistant(String(result?.reply || "Loading selected collection into Data Hub."));
    return;
  }
  if (functionName === "workflow.create_subfolder_by_topic") {
    applyRoute("retrieve:zotero");
    void retrieveZoteroContext.loadTree();
    pushAssistant(String(result?.reply || "Topic workflow completed."));
    return;
  }
  if (
    functionName === "workflow.systematic_review_pipeline" ||
    functionName === "workflow.literature_review_pipeline" ||
    functionName === "workflow.bibliographic_review_pipeline"
  ) {
    const pipelinePath = String(result?.pipeline_path || "").trim();
    const statePath = String(result?.state_path || "").trim();
    const templatePath = String(result?.template_path || "").trim();
    const summary = String(result?.reply || "Review pipeline created.");
    const pathLines = [
      pipelinePath ? `Pipeline file: ${pipelinePath}` : "",
      statePath ? `State file: ${statePath}` : "",
      templatePath ? `Template page: ${templatePath}` : ""
    ].filter(Boolean);
    pushAssistant(pathLines.length ? `${summary}\n${pathLines.join("\n")}` : summary);
    return;
  }

  if (String(result?.function || res?.function || "") === "Verbatim_Evidence_Coding" || String(intent?.targetFunction || "") === "Verbatim_Evidence_Coding") {
    const recovered = (result as Record<string, unknown>)?.recovered_from_batch_output === true;
    const recoveredCount = Number((result as Record<string, unknown>)?.recovered_items_count || 0);
    if (recovered) {
      pushAssistant(
        `Verbatim_Evidence_Coding executed (recovered from existing batch output${recoveredCount > 0 ? `, items: ${recoveredCount}` : ""}).`
      );
    } else {
      pushAssistant("Verbatim_Evidence_Coding executed.");
    }
    return;
  }
  pushAssistant("Command executed successfully.");
}

async function runAgentChatCommand(text: string, options?: VoiceCommandExecutionOptions): Promise<void> {
  let commandText = String(text || "").trim();
  const shouldSpeak = shouldSpeakVoiceReply(options);
  const pushAssistant = (message: string, tone?: "error"): void =>
    pushAgentChatMessage("assistant", message, tone, shouldSpeak ? { speak: true } : undefined);
  const isVocal = Boolean(options?.fromVoice || options?.fromRealtime);
  if (isVocal) {
    recordAgentTelemetry("runAgentChatCommand", { totalCommands: 1 });
    const guardrail = validateVoiceCommandText(commandText, options);
    if (guardrail.status === "reject") {
      recordAgentTelemetry("runAgentChatCommand", { rejectedCommands: 1 });
      pushAssistant(guardrail.message || "I could not process that command.", "error");
      return;
    }
    if (guardrail.status === "warn") {
      recordAgentTelemetry("runAgentChatCommand", { rejectedCommands: 1 });
      pushAssistant(guardrail.message || "I could not infer a clear action.", "error");
      return;
    }
    commandText = guardrail.normalized;
    recordAgentTelemetry("runAgentChatCommand", { acceptedCommands: 1 });
  }
  pushAgentChatMessage("user", commandText);
  const low = String(commandText || "").toLowerCase();
  if (pendingAcademicSearchIntake) {
    if (isChatNegative(commandText) || /\bcancel\b/.test(low)) {
      pendingAcademicSearchIntake = null;
      pushAssistant("Search intake canceled.");
      return;
    }
    const intake = pendingAcademicSearchIntake;
    if (intake.step === "awaiting_details") {
      setAgentChatPending(true);
      try {
        const detailsText = commandText.trim();
        const strategy = await generateStrategyFromIntake({
          query: intake.query,
          browserProviders: intake.browserProviders,
          detailsText,
          strategySeed: intake.strategySeed
        });
        pendingAcademicSearchIntake = {
          ...intake,
          step: "awaiting_approval",
          detailsText,
          generatedStrategy: strategy
        };
        const providersLabel = intake.browserProviders.length ? intake.browserProviders.join(", ") : "default providers";
        pushAssistant(
          `Strategy draft ready:\n${strategy}\n\nProviders: ${providersLabel}\nMax pages: ${intake.maxPages}\nMode: ${intake.headed ? "headed" : "headless"}\n\nReply "yes" to run, "no" to cancel, or send extra details to regenerate.`
        );
      } catch (error) {
        pushAssistant(String((error as Error)?.message || error || "Could not generate strategy."), "error");
      } finally {
        setAgentChatPending(false);
      }
      return;
    }
    if (intake.step === "awaiting_approval") {
      if (isChatAffirmative(commandText) || /\brun\b/.test(low)) {
        pendingAcademicSearchIntake = null;
        setAgentChatPending(true);
        try {
          await executeUnifiedSearchPlan({
            query: intake.query,
            strategy: intake.generatedStrategy || intake.strategySeed || intake.query,
            maxPages: intake.maxPages,
            headed: intake.headed,
            browserProviders: intake.browserProviders,
            pushAssistant
          });
        } finally {
          setAgentChatPending(false);
        }
        return;
      }
      setAgentChatPending(true);
      try {
        const detailsText = commandText.trim();
        const strategy = await generateStrategyFromIntake({
          query: intake.query,
          browserProviders: intake.browserProviders,
          detailsText,
          strategySeed: intake.strategySeed
        });
        pendingAcademicSearchIntake = {
          ...intake,
          detailsText,
          generatedStrategy: strategy
        };
        pushAssistant(
          `Updated strategy draft:\n${strategy}\n\nReply "yes" to run, "no" to cancel, or add more detail.`
        );
      } catch (error) {
        pushAssistant(String((error as Error)?.message || error || "Could not regenerate strategy."), "error");
      } finally {
        setAgentChatPending(false);
      }
      return;
    }
    return;
  }
  if (!window.agentBridge?.resolveIntent || !window.agentBridge?.executeIntent) {
    pushAssistant( "Agent bridge is unavailable.", "error");
    return;
  }
  if (window.agentBridge?.supervisorPlan && window.agentBridge?.supervisorExecute && /\bsupervisor\b/.test(low) && /\b(coding|code|verbatim)\b/.test(low)) {
    setAgentChatPending(true);
    const context = buildAgentContextPayloadForText(commandText, options);
    const planned = await window.agentBridge.supervisorPlan({ text: commandText, context });
    if (planned?.status !== "ok" || !planned?.plan) {
      setAgentChatPending(false);
      pushAssistant( String(planned?.message || "Supervisor could not build a coding plan."), "error");
      return;
    }
    const questions = Array.isArray((planned.plan as Record<string, unknown>)?.research_questions)
      ? (((planned.plan as Record<string, unknown>).research_questions as unknown[]).map((q) => String(q || "").trim()).filter(Boolean))
      : [];
      pushAssistant(
        `Supervisor plan ready (${String(planned?.source || "fallback")}):\n- Collection: ${String((planned.plan as Record<string, unknown>)?.collection_name || "(selected)")}\n- Mode: ${String((planned.plan as Record<string, unknown>)?.coding_mode || "open")}\n- Screening: ${((planned.plan as Record<string, unknown>)?.screening === true) ? "enabled" : "disabled"}\n- Questions: ${questions.length}`
      );
    const executed = await window.agentBridge.supervisorExecute({ plan: planned.plan, context });
    setAgentChatPending(false);
    if (executed?.status === "ok") {
      const recovered = (((executed?.result as Record<string, unknown>)?.verbatim as Record<string, unknown>)?.result as Record<string, unknown>)?.recovered_from_batch_output === true;
      const recoveredCount = Number((((executed?.result as Record<string, unknown>)?.verbatim as Record<string, unknown>)?.result as Record<string, unknown>)?.recovered_items_count || 0);
      if (recovered) {
        pushAssistant(
          `Supervisor + coder run completed (Verbatim_Evidence_Coding executed via batch recovery${recoveredCount > 0 ? `, items: ${recoveredCount}` : ""}).`
        );
      } else {
        pushAssistant( "Supervisor + coder run completed (Verbatim_Evidence_Coding executed).");
      }
    } else {
      pushAssistant( String(executed?.message || "Supervisor execution failed."), "error");
    }
    return;
  }
  if (window.systematicBridge) {
    const runDir = resolveSystematicRunDirFromContext();
    const checklistPath = "Research/Systematic_review/prisma_check_list.html";
    if ((/systematic/.test(low) && /\b(implement|run|execute)\b/.test(low) && /\b1\s*(?:-|to)\s*15\b/.test(low)) || /\bsteps?\s*1\s*(?:-|to)\s*15\b/.test(low)) {
      if (!runDir) {
        pushAssistant( "No systematic run directory resolved from current context.", "error");
        return;
      }
      setAgentChatPending(true);
      const out = await window.systematicBridge.executeSteps1to15({ runDir, checklistPath, reviewerCount: 2 });
      setAgentChatPending(false);
      if (out?.status === "ok") {
        pushAssistant( `Systematic steps 1-15 completed.\nRun dir: ${runDir}`);
      } else {
        pushAssistant( String(out?.message || "Systematic steps 1-15 failed."), "error");
      }
      return;
    }
    if ((/systematic/.test(low) && /full[- ]?run|run all/.test(low)) || /prisma full run/.test(low)) {
      if (!runDir) {
        pushAssistant( "No systematic run directory resolved from current context.", "error");
        return;
      }
      setAgentChatPending(true);
      const out = await window.systematicBridge.fullRun({ runDir, checklistPath, maxIterations: 3, minPassPct: 80, maxFail: 0 });
      setAgentChatPending(false);
      if (out?.status === "ok") {
        pushAssistant( `Systematic full-run completed.\nRun dir: ${runDir}`);
      } else {
        pushAssistant( String(out?.message || "Systematic full-run failed."), "error");
      }
      return;
    }
    if (/adjudicat(e|ion)\s+conflict|resolve\s+conflict/.test(low)) {
      if (!runDir) {
        pushAssistant( "No systematic run directory resolved from current context.", "error");
        return;
      }
      const countMatch = low.match(/\b(\d+)\b/);
      const resolvedCount = countMatch ? Math.max(1, Number(countMatch[1])) : 0;
      setAgentChatPending(true);
      const out = await window.systematicBridge.adjudicateConflicts({ runDir, resolvedCount });
      setAgentChatPending(false);
      if (out?.status === "ok") {
        pushAssistant(
          `Conflict adjudication completed. Resolved: ${Number(out?.resolved || 0)}. Remaining unresolved: ${Number(out?.unresolved || 0)}.`
        );
      } else {
        pushAssistant( String(out?.message || "Conflict adjudication failed."), "error");
      }
      return;
    }
    if (/prisma audit/.test(low)) {
      if (!runDir) {
        pushAssistant( "No systematic run directory resolved from current context.", "error");
        return;
      }
      setAgentChatPending(true);
      const out = await window.systematicBridge.prismaAudit({ runDir });
      setAgentChatPending(false);
      if (out?.status === "ok") {
        pushAssistant( `PRISMA audit completed.\nRun dir: ${runDir}`);
      } else {
        pushAssistant( String(out?.message || "PRISMA audit failed."), "error");
      }
      return;
    }
    if (/prisma remediate/.test(low)) {
      if (!runDir) {
        pushAssistant( "No systematic run directory resolved from current context.", "error");
        return;
      }
      setAgentChatPending(true);
      const out = await window.systematicBridge.prismaRemediate({ runDir });
      setAgentChatPending(false);
      if (out?.status === "ok") {
        pushAssistant( `PRISMA remediation completed. Updated sections: ${Number(out?.updated || 0)}.`);
      } else {
        pushAssistant( String(out?.message || "PRISMA remediation failed."), "error");
      }
      return;
    }
    if (/compose paper|generate full paper/.test(low)) {
      if (!runDir) {
        pushAssistant( "No systematic run directory resolved from current context.", "error");
        return;
      }
      setAgentChatPending(true);
      const out = await window.systematicBridge.composePaper({ runDir, checklistPath });
      setAgentChatPending(false);
      if (out?.status === "ok") {
        pushAssistant( `Systematic full paper generated.\nRun dir: ${runDir}`);
      } else {
        pushAssistant( String(out?.message || "Paper composition failed."), "error");
      }
      return;
    }
  }

  const retryUnifiedSearchSignal = /\b(retry|rerun|resume|try again)\b/.test(low) && /\b(search|collection|unified|providers?)\b/.test(low);
  if (retryUnifiedSearchSignal) {
    if (!pendingUnifiedSearchRetry) {
      pushAssistant("No pending failed provider run to retry.");
      return;
    }
    const retryProviders = pendingUnifiedSearchRetry.failedProviders.length
      ? pendingUnifiedSearchRetry.failedProviders
      : pendingUnifiedSearchRetry.providers;
    const providersLabel = retryProviders.length ? retryProviders.join(", ") : "default providers";
    setAgentChatPending(true);
    try {
      applyRoute("retrieve:search");
      ensureRetrieveSearchAppTool();
      document.dispatchEvent(
        new CustomEvent("retrieve:agent-unified-search", {
          detail: {
            query: pendingUnifiedSearchRetry.query,
            strategy: pendingUnifiedSearchRetry.strategy,
            maxPages: pendingUnifiedSearchRetry.maxPages,
            headed: pendingUnifiedSearchRetry.headed,
            browserProviders: retryProviders,
            runNow: false
          }
        })
      );
      pushAssistant(`Retrying failed providers: ${providersLabel}.`);
      const retryResponse = ((await command("retrieve", "run_unified_strategy", {
        query: pendingUnifiedSearchRetry.strategy,
        browserProviders: retryProviders,
        maxPages: pendingUnifiedSearchRetry.maxPages,
        headed: pendingUnifiedSearchRetry.headed,
        includeSemanticApi: true,
        includeCrossrefApi: true
      })) as unknown) as Record<string, unknown>;
      if (String(retryResponse?.status || "") !== "ok") {
        pushAssistant(String(retryResponse?.message || "Retry failed."), "error");
        return;
      }
      const failed = Array.isArray(retryResponse?.failedProviders)
        ? (retryResponse.failedProviders as unknown[]).map((p) => String(p || "").trim()).filter(Boolean)
        : [];
      const total = Number(retryResponse?.total || 0);
      if (!failed.length) {
        pendingUnifiedSearchRetry = null;
        pushAssistant(`Retry completed successfully. Records: ${total}.`);
      } else {
        pendingUnifiedSearchRetry = {
          ...pendingUnifiedSearchRetry,
          failedProviders: failed,
          attempts: pendingUnifiedSearchRetry.attempts + 1
        };
        pushAssistant(
          `Retry finished with remaining blocked providers: ${failed.join(", ")}.\nComplete login/captcha in assist browser, then say "retry search".`,
          "error"
        );
      }
    } catch (error) {
      pushAssistant(String((error as Error)?.message || error || "Retry failed."), "error");
    } finally {
      setAgentChatPending(false);
    }
    return;
  }

  const unifiedSearchIntent = extractChatUnifiedSearchIntent(commandText);
  if (unifiedSearchIntent) {
    pendingAcademicSearchIntake = {
      step: "awaiting_details",
      query: unifiedSearchIntent.query,
      strategySeed: unifiedSearchIntent.query,
      generatedStrategy: "",
      detailsText: "",
      maxPages: unifiedSearchIntent.maxPages,
      headed: unifiedSearchIntent.headed,
      browserProviders: unifiedSearchIntent.browserProviders
    };
    applyRoute("retrieve:search");
    ensureRetrieveSearchAppTool();
    document.dispatchEvent(
      new CustomEvent("retrieve:agent-unified-search", {
        detail: {
          query: unifiedSearchIntent.query,
          strategy: unifiedSearchIntent.query,
          maxPages: unifiedSearchIntent.maxPages,
          headed: unifiedSearchIntent.headed,
          browserProviders: unifiedSearchIntent.browserProviders,
          runNow: false
        }
      })
    );
    const providersLabel = unifiedSearchIntent.browserProviders.length
      ? unifiedSearchIntent.browserProviders.join(", ")
      : "default providers";
    pushAssistant(
      `I can run this search for "${unifiedSearchIntent.query}" on ${providersLabel}. Before running, share:\n1) objective/focus\n2) timeframe\n3) inclusion/exclusion hints`
    );
    return;
  }

  const mappedVoiceAction = parseVoiceAction(commandText);
  if (mappedVoiceAction) {
    runMappedVoiceAction(mappedVoiceAction, options);
    return;
  }

  const mappedVoiceButton = resolveVoiceButtonAction(commandText);
  if (mappedVoiceButton) {
      const activated = activateVoiceButtonCandidate(mappedVoiceButton, commandText);
    if (activated) {
      pushAssistant(`Pressed ${mappedVoiceButton.label}.`);
    } else {
      pushAssistant(
        "I found a matching control, but it could not be changed from that utterance. Try one more specific value.",
        "error"
      );
    }
    return;
  }

  if (agentChatState.pendingConfirmation) {
    if (agentChatState.pendingConfirmation.type === "coding_mode") {
      const modeText = String(commandText || "").trim().toLowerCase();
      const selectedMode =
        /\bhybrid\b/.test(modeText) ? "hybrid" : /\btarget/.test(modeText) ? "targeted" : /\bopen\b/.test(modeText) ? "open" : "";
      if (!selectedMode) {
        pushAssistant( "Reply with one mode: open, targeted, or hybrid.");
        return;
      }
      const pending = agentChatState.pendingConfirmation;
      const nextIntent = { ...(pending.intent || {}) } as Record<string, unknown>;
      const nextArgs = { ...((nextIntent.args as Record<string, unknown>) || {}), coding_mode: selectedMode };
      nextIntent.args = nextArgs;
      agentChatState.pendingConfirmation = null;
      agentChatState.pendingIntent = nextIntent;
      setAgentChatPending(true);
      const resolved = await window.agentBridge.resolveIntent({
        text: selectedMode,
        context: {
          ...buildAgentContextPayloadForText(selectedMode, options),
          pendingIntent: nextIntent
        }
      });
      setAgentChatPending(false);
      if (resolved?.status !== "ok" || !resolved?.intent) {
        pushAssistant( String(resolved?.message || "Could not set coding mode."), "error");
        return;
      }
      if ((resolved.intent?.needsClarification as boolean) === true) {
        agentChatState.pendingIntent = resolved.intent;
        const qList = Array.isArray(resolved.intent?.clarificationQuestions) ? resolved.intent.clarificationQuestions : [];
        pushAssistant( qList.length ? `I need more detail:\n- ${qList.join("\n- ")}` : "I need more details.");
        return;
      }
      await executeResolvedIntent(resolved.intent, options);
      return;
    }
    if (isChatAffirmative(commandText)) {
      const pending = agentChatState.pendingConfirmation;
      agentChatState.pendingConfirmation = null;
      setAgentChatPending(true);
      await executeResolvedIntent(pending.intent, options);
      return;
    }
    if (isChatNegative(commandText)) {
      agentChatState.pendingConfirmation = null;
      setAgentChatPending(false);
      pushAssistant( "Coding run canceled.");
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
        feedback: commandText,
        contextText: String((pendingIntent?.args as Record<string, unknown>)?.context || "")
      });
      if (ref?.status === "ok" && Array.isArray(ref?.questions) && ref.questions.length >= 3) {
        revised = ref.questions.slice(0, 5).map((q) => String(q || "").trim()).filter(Boolean);
      }
    }
    if (!revised.length) {
      const fallback = parseResearchQuestionsInput(commandText);
      if (fallback.length >= 3 && fallback.length <= 5) revised = fallback.slice(0, 5);
    }
    if (revised.length >= 3 && revised.length <= 5) {
      const args = ((pendingIntent?.args as Record<string, unknown>) || {});
      const controls = parseCodingControlsFromText(commandText);
      const currentMode = String(args.coding_mode || "open").toLowerCase();
      pendingIntent.args = {
        ...args,
        research_questions: revised,
        coding_mode: controls.mode_specified ? controls.coding_mode : (currentMode === "targeted" ? "targeted" : currentMode === "hybrid" ? "hybrid" : "open"),
        rq_scope: controls.rq_scope,
        target_codes: controls.target_codes,
        min_relevance: controls.min_relevance
      };
      const screeningEnabled = (pendingIntent?.args as Record<string, unknown>)?.screening !== false;
      if (screeningEnabled) {
        const collectionName = String((pendingIntent?.args as Record<string, unknown>)?.collection_name || "");
        const contextText = String((pendingIntent?.args as Record<string, unknown>)?.context || "");
        const explicitCriteria = parseEligibilityCriteriaInput(commandText);
        const explicitPreflight = buildEligibilityPreflightIntent(
          collectionName,
          contextText,
          revised,
          explicitCriteria.inclusion,
          explicitCriteria.exclusion
        );
        if (explicitPreflight) {
          pendingIntent.preflightIntents = [explicitPreflight];
        } else if (window.agentBridge?.generateEligibilityCriteria) {
          const regen = await window.agentBridge.generateEligibilityCriteria({
            userText: commandText,
            collectionName,
            contextText,
            researchQuestions: revised
          });
          if (regen?.status === "ok") {
            const inclusion = Array.isArray(regen?.inclusion_criteria)
              ? regen.inclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
              : [];
            const exclusion = Array.isArray(regen?.exclusion_criteria)
              ? regen.exclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
              : [];
            const preflight = buildEligibilityPreflightIntent(collectionName, contextText, revised, inclusion, exclusion);
            if (preflight) pendingIntent.preflightIntents = [preflight];
          }
        }
      }
      pushAssistant(
        `Updated research questions:\n${revised.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nReply with 'yes' to run or 'no' to cancel.`
      );
      return;
    }
    pushAssistant( "I could not infer a valid 3-5 question set. Reply with clearer question edits.");
    return;
  }

  setAgentChatPending(true);
  try {
  const resolved = await window.agentBridge.resolveIntent({
      text: commandText,
      context: {
        ...buildAgentContextPayloadForText(commandText, options),
        pendingIntent: agentChatState.pendingIntent || null
      }
    });
    if (resolved?.status !== "ok" || !resolved?.intent) {
      pushAssistant( String(resolved?.message || "Could not resolve command intent."), "error");
      return;
    }
    const intent = resolved.intent;
    if ((intent?.needsClarification as boolean) === true) {
      agentChatState.pendingIntent = intent;
      const qList = Array.isArray(intent?.clarificationQuestions) ? intent.clarificationQuestions : [];
      pushAssistant( qList.length ? `I need more detail:\n- ${qList.join("\n- ")}` : "I need more details.");
      if (
        qList.some((q) => /open coding|targeted coding|hybrid coding/i.test(String(q || ""))) &&
        !qList.some((q) => /auto-generate\s+3-5/i.test(String(q || "")))
      ) {
        agentChatState.pendingConfirmation = { type: "coding_mode", intent };
      }
      return;
    }

    if (String(intent?.intentId || "") === "feature.run" && String(intent?.targetFunction || "") === "Verbatim_Evidence_Coding") {
      const args = (intent?.args as Record<string, unknown>) || {};
      const questions = Array.isArray(args.research_questions)
        ? (args.research_questions as unknown[]).map((q) => String(q || "").trim()).filter(Boolean)
        : [];
      const collectionName = String(args.collection_name || "").trim() || "(selected collection)";
      const screeningEnabled = args.screening !== false;
      const codingMode = (() => {
        const rawMode = String(args.coding_mode || "open").toLowerCase();
        return rawMode === "targeted" ? "targeted" : rawMode === "hybrid" ? "hybrid" : "open";
      })();
      const rqScope = Array.isArray(args.rq_scope)
        ? (args.rq_scope as unknown[]).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.trunc(n))
        : [];
      const targetCodes = Array.isArray(args.target_codes)
        ? (args.target_codes as unknown[]).map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const minRelevance = Number.isFinite(Number(args.min_relevance)) ? Math.max(1, Math.min(5, Math.trunc(Number(args.min_relevance)))) : 3;
      if (questions.length >= 3 && questions.length <= 5) {
        const contextText = String(args.context || "");
        if (screeningEnabled) {
          const explicitCriteria = parseEligibilityCriteriaInput(commandText);
          const explicitPreflight = buildEligibilityPreflightIntent(
            collectionName,
            contextText,
            questions,
            explicitCriteria.inclusion,
            explicitCriteria.exclusion
          );
          if (explicitPreflight) {
            intent.preflightIntents = [explicitPreflight];
          } else if (window.agentBridge?.generateEligibilityCriteria) {
            const eligibilityDraft = await window.agentBridge.generateEligibilityCriteria({
              userText: commandText,
              collectionName,
              contextText,
              researchQuestions: questions
            });
            if (eligibilityDraft?.status === "ok") {
              const inclusion = Array.isArray(eligibilityDraft?.inclusion_criteria)
                ? eligibilityDraft.inclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
                : [];
              const exclusion = Array.isArray(eligibilityDraft?.exclusion_criteria)
                ? eligibilityDraft.exclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean)
                : [];
              const preflight = buildEligibilityPreflightIntent(collectionName, contextText, questions, inclusion, exclusion);
              if (preflight) intent.preflightIntents = [preflight];
            }
          }
        }
      pushAssistant(
        `I will refine codebook.md first, then run Verbatim_Evidence_Coding for '${collectionName}'.\nMode: ${codingMode}${codingMode === "targeted" || codingMode === "hybrid" ? ` (min relevance ${minRelevance}${rqScope.length ? `, RQ scope: ${rqScope.map((i) => `RQ${i + 1}`).join(", ")}` : ""}${targetCodes.length ? `, targets: ${targetCodes.join(", ")}` : ""})` : ""}.\nScreening: ${screeningEnabled ? "enabled" : "disabled"}.\n\nResearch questions:\n${questions
          .map((q, i) => `${i + 1}. ${q}`)
          .join("\n")}\n\nReply with 'yes' to run, 'no' to cancel, or send revised questions (3-5).`
      );
        agentChatState.pendingConfirmation = { type: "coding_questions", intent };
        return;
      }
    }

    await executeResolvedIntent(intent, options);
  } catch (error) {
    pushAssistant( String((error as Error)?.message || error || "Agent command failed."), "error");
  } finally {
    setAgentChatPending(false);
  }
}

function initAgentChatUi(): void {
  if (!agentChatFab || !agentChatDock || !agentChatForm || !agentChatInput || !btnAgentChatClose || !btnAgentChatClear) {
    return;
  }
  setAgentVoicePulseState(false, false, false);
  setAgentVoiceButtonIcons("idle");
  clearAgentChatMicVoiceTheme();
  setAgentChatPhase("idle", "Idle");
  if (window.agentBridge?.getChatHistory) {
    void window.agentBridge.getChatHistory().then((res) => {
      const rows = Array.isArray(res?.messages) ? res.messages : [];
      if (rows.length) {
        agentChatState.messages = rows
          .map((entry) => ({
            role: (entry.role === "user" ? "user" : "assistant") as "user" | "assistant",
            text: String(entry.text || ""),
            tone: (entry.tone === "error" ? "error" : undefined) as "error" | undefined,
            at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now()
          }))
          .slice(-60);
        renderAgentChatMessages();
      } else if (!agentChatState.messages.length) {
        pushAgentChatMessage("assistant", "Agent ready. Send a command to organize collections by tag.");
      }
    }).catch(() => {
      if (!agentChatState.messages.length) {
        pushAgentChatMessage("assistant", "Agent ready. Send a command to organize collections by tag.");
      }
    });
  } else if (!agentChatState.messages.length) {
    pushAgentChatMessage("assistant", "Agent ready. Send a command to organize collections by tag.");
  }
  agentChatFab.addEventListener("click", () => setAgentChatOpen(!agentChatState.open));
  btnAgentChatClose.addEventListener("click", () => setAgentChatOpen(false));
  btnAgentChatClear.addEventListener("click", () => {
    agentChatState.messages = [];
    agentChatState.pendingIntent = null;
    agentChatState.pendingConfirmation = null;
    if (window.agentBridge?.clearChatHistory) {
      void window.agentBridge.clearChatHistory();
    }
    renderAgentChatMessages();
  });
  agentChatForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = String(agentChatInput.value || "").trim();
    if (!text || agentChatState.pending) return;
    agentChatInput.value = "";
    void runAgentChatCommand(text);
  });
  if (teardownDictationDelta) {
    teardownDictationDelta();
    teardownDictationDelta = null;
  }
  if (teardownDictationCompleted) {
    teardownDictationCompleted();
    teardownDictationCompleted = null;
  }
  if (teardownDictationError) {
    teardownDictationError();
    teardownDictationError = null;
  }
  if (window.agentBridge?.onDictationDelta) {
    teardownDictationDelta = window.agentBridge.onDictationDelta((payload) => {
      const sessionId = Number(payload?.sessionId || 0);
      if (!sessionId || sessionId !== activeDictationBridgeSessionId) return;
      const transcript = String(payload?.transcript || "").trim();
      const delta = String(payload?.delta || "").trim();
      if (transcript) {
        agentVoiceState.dictationDraftTranscript = transcript;
      } else if (delta) {
        agentVoiceState.dictationDraftTranscript = combineDictationTranscript(agentVoiceState.dictationDraftTranscript, delta);
      }
      applyDictationComposerDraft();
      setAgentChatVoiceStatus("Dictating...");
    });
  }
  if (window.agentBridge?.onDictationCompleted) {
    teardownDictationCompleted = window.agentBridge.onDictationCompleted((payload) => {
      const sessionId = Number(payload?.sessionId || 0);
      if (!sessionId || sessionId !== activeDictationBridgeSessionId) return;
      const text = String(payload?.text || "").trim();
      if (!text) return;
      agentVoiceState.dictationDraftTranscript = text;
      applyDictationComposerDraft();
      setAgentChatVoiceStatus("Dictation ready. Press Send.");
    });
  }
  if (window.agentBridge?.onDictationError) {
    teardownDictationError = window.agentBridge.onDictationError((payload) => {
      const sessionId = Number(payload?.sessionId || 0);
      if (!sessionId || sessionId !== activeDictationBridgeSessionId) return;
      const message = String(payload?.message || "Dictation stream failed.");
      pushAgentChatMessage("assistant", message, "error");
      setAgentChatVoiceStatus("Dictation error.");
    });
  }
  if (btnAgentChatMic) {
    btnAgentChatMic.addEventListener("click", () => {
      if (agentChatState.pending) return;
      void startAgentVoiceRecording("voice");
    });
  }
  if (btnAgentChatDictation) {
    btnAgentChatDictation.addEventListener("click", () => {
      if (agentChatState.pending) return;
      void startAgentVoiceRecording("dictation");
    });
  }
  if (window.agentBridge?.onFeatureJobStatus) {
    window.agentBridge.onFeatureJobStatus((payload) => {
      const functionName = String(payload?.functionName || "");
      const status = String(payload?.status || "");
      if (functionName === "workflow.create_subfolder_by_topic" && (status === "done" || status === "failed" || status === "canceled")) {
        const phase = String(payload?.phase || "");
        const text = status === "done"
          ? `Workflow job completed${phase ? ` (${phase})` : ""}.`
          : status === "canceled"
            ? "Workflow job canceled."
            : `Workflow job failed${phase ? ` (${phase})` : ""}.`;
        pushAgentChatMessage("assistant", text, status === "failed" ? "error" : undefined);
      }
      if (
        (functionName === "workflow.systematic_review_pipeline" ||
          functionName === "workflow.literature_review_pipeline" ||
          functionName === "workflow.bibliographic_review_pipeline") &&
        (status === "done" || status === "failed")
      ) {
        const label =
          functionName === "workflow.literature_review_pipeline"
            ? "Literature review"
            : functionName === "workflow.bibliographic_review_pipeline"
              ? "Bibliographic review"
              : "Systematic review";
        const text = status === "done"
          ? `${label} pipeline initialized.`
          : `${label} pipeline initialization failed.`;
        pushAgentChatMessage("assistant", text, status === "failed" ? "error" : undefined);
      }
    });
  }
  syncAgentChatVisibility();
}

function applyRoute(routeId: RouteId, options?: { skipEnsureTools?: boolean; forceClearPanels?: boolean }): void {
  const route = ROUTES[routeId];
  if (!route) {
    console.warn("[route] unknown routeId", routeId);
    return;
  }
  activeRouteId = routeId;
  document.documentElement.classList.toggle("zotero-parity-mode", routeId === "retrieve:zotero");
  document.body.classList.toggle("zotero-parity-mode", routeId === "retrieve:zotero");
  if (routeId === "retrieve:zotero") {
    document.querySelectorAll(".zotero-picker").forEach((node) => node.remove());
  }
  syncAgentChatVisibility();

  const preset = PANEL_PRESETS[route.presetId];
  if (preset) {
    panelGrid.applyPreset(preset);
  }

  const forceClearPanels = options?.forceClearPanels || routeId === "retrieve:zotero";
  if (forceClearPanels) {
    (["panel1", "panel2", "panel3", "panel4"] as PanelId[]).forEach((panelId) => {
      panelTools.clearPanelTools(panelId);
    });
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
initRetrieveSearchIntakeBridge();

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
    ["sections", "paragraphs"].forEach((value) => {
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

    const executeRun = async () => {
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
    };

    run.addEventListener("click", async () => {
      await executeRun();
    });

    status.textContent = "Found cached tables. Auto-running with defaults (All rows)…";
    void executeRun();
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
  const rawAliases: string[] = [
    action.label,
    action.hint,
    action.id,
    action.id.replace(/-/g, " "),
    action.command.action,
    action.command.action.replace(/_/g, " ").replace(/-/g, " "),
    action.command.phase,
    `${action.command.phase} ${action.label}`,
    `${action.command.phase} ${action.command.action}`,
    action.group || ""
  ];
  const aliases = new Set<string>(rawAliases.filter((alias): alias is string => Boolean(alias && alias.trim().length > 0)));
  const manualAliases = VOICE_ACTION_MANUAL_ALIASES[action.id];
  if (manualAliases?.length) {
    manualAliases.forEach((alias) => aliases.add(alias));
  }
  const aliasValue = Array.from(aliases).filter((value) => value && value.trim().length > 0).join(";");
  if (aliasValue) {
    btn.dataset.voiceAliases = aliasValue;
  }
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
    (action.command.action === "datahub_open_batches" || action.command.action === "batches_data")
  ) {
    tabRibbon.selectTab("retrieve");
    applyRoute("retrieve:zotero", { forceClearPanels: true });
    retrieveSearchSelectedRecord = undefined;
    const analyseState = analyseStore.getState();
    void retrieveZoteroContext.loadBatchesData({
      runPath: String(analyseState?.activeRunPath || ""),
      baseDir: String(analyseState?.baseDir || "")
    });
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "datahub_open_code") {
    tabRibbon.selectTab("code");
    return;
  }
  if (action.command.phase === "retrieve" && action.command.action === "datahub_open_screen") {
    tabRibbon.selectTab("screen");
    return;
  }
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
    panelGrid.ensurePanelVisible(1);
    panelGrid.ensurePanelVisible(2);
    panelGrid.ensurePanelVisible(3);
    return;
  }

  if (mode === "search-selected") {
    panelGrid.applyPreset(PANEL_PRESETS["retrieve:search-selected"]);
    panelGrid.ensurePanelVisible(1);
    panelGrid.ensurePanelVisible(2);
    panelGrid.ensurePanelVisible(3);
    return;
  }

  panelGrid.applyPreset(PANEL_PRESETS["retrieve:search-graph"]);
  panelGrid.ensurePanelVisible(1);
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
