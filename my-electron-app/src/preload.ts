import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { SectionLevel } from "./analyse/types";
import type { SessionData, SessionMenuAction } from "./session/sessionTypes";
import type {
  RetrieveCitationNetwork,
  RetrieveCitationNetworkRequest,
  RetrievePaperSnapshot,
  RetrieveSnowballRequest,
  RetrieveRecord
} from "./shared/types/retrieve";
import type { CoderState } from "./panels/coder/coderTypes";

const LEDITOR_HOST_FLAG = "--leditor-host=";
const encodedHostArg = process.argv.find((value) => value?.startsWith?.(LEDITOR_HOST_FLAG));
const decodeHostContract = (): { [key: string]: unknown } | null => {
  if (!encodedHostArg) {
    return null;
  }
  try {
    const payload = encodedHostArg.slice(LEDITOR_HOST_FLAG.length);
    return JSON.parse(decodeURIComponent(payload));
  } catch {
    return null;
  }
};
const hostContract = decodeHostContract();
if (hostContract) {
  contextBridge.exposeInMainWorld("__leditorHost", hostContract);
}

contextBridge.exposeInMainWorld("appBridge", {
  ping: () => "pong"
});

contextBridge.exposeInMainWorld("commandBridge", {
  dispatch: (payload: { phase: string; action: string; payload?: unknown }) => ipcRenderer.invoke("command:dispatch", payload)
});

contextBridge.exposeInMainWorld("agentBridge", {
  run: (payload: { text: string; context?: Record<string, unknown> }) => ipcRenderer.invoke("agent:run", payload),
  resolveIntent: (payload: { text: string; context?: Record<string, unknown> }) =>
    ipcRenderer.invoke("agent:intent-resolve", payload),
  executeIntent: (payload: { intent: Record<string, unknown>; context?: Record<string, unknown>; confirm?: boolean }) =>
    ipcRenderer.invoke("agent:intent-execute", payload),
  dictationStart: () => ipcRenderer.invoke("agent:dictation-start"),
  dictationStop: () => ipcRenderer.invoke("agent:dictation-stop"),
  dictationAudio: (audio: ArrayBuffer) => ipcRenderer.send("agent:dictation-audio", audio),
  transcribeVoice: (payload: { audioBase64: string; mimeType?: string; language?: string }) =>
    ipcRenderer.invoke("agent:voice-transcribe", payload),
  nativeAudioStart: () => ipcRenderer.invoke("agent:native-audio-start"),
  nativeAudioStop: () => ipcRenderer.invoke("agent:native-audio-stop"),
  speakText: (payload: { text: string; voice?: string; speed?: number; format?: string; model?: string }) =>
    ipcRenderer.invoke("agent:speak-text", payload),
  getFeatures: () => ipcRenderer.invoke("agent:features"),
  refineCodingQuestions: (payload: {
    currentQuestions?: string[];
    feedback?: string;
    contextText?: string;
  }) => ipcRenderer.invoke("agent:refine-coding-questions", payload),
  generateEligibilityCriteria: (payload: {
    userText?: string;
    collectionName?: string;
    contextText?: string;
    researchQuestions?: string[];
  }) => ipcRenderer.invoke("agent:generate-eligibility-criteria", payload),
  generateAcademicStrategy: (payload: {
    query?: string;
    providers?: string[];
    objective?: string;
  }) => ipcRenderer.invoke("agent:generate-academic-strategy", payload),
  supervisorPlan: (payload: { text?: string; context?: Record<string, unknown> }) =>
    ipcRenderer.invoke("agent:supervisor-plan", payload),
  supervisorExecute: (payload: { plan?: Record<string, unknown>; context?: Record<string, unknown> }) =>
    ipcRenderer.invoke("agent:supervisor-execute", payload),
  getIntentStats: () => ipcRenderer.invoke("agent:get-intent-stats"),
  getWorkflowBatchJobs: () => ipcRenderer.invoke("agent:get-workflow-batch-jobs"),
  clearWorkflowBatchJobs: () => ipcRenderer.invoke("agent:clear-workflow-batch-jobs"),
  getFeatureHealthCheck: () => ipcRenderer.invoke("agent:feature-health-check"),
  getFeatureJobs: () => ipcRenderer.invoke("agent:get-feature-jobs"),
  cancelFeatureJob: (payload: { jobId: string }) => ipcRenderer.invoke("agent:cancel-feature-job", payload),
  getBatchExplorer: () => ipcRenderer.invoke("agent:get-batch-explorer"),
  getBatchDetail: (payload: { jobId?: string; batchId?: string }) => ipcRenderer.invoke("agent:get-batch-detail", payload),
  deleteBatch: (payload: { jobId?: string; batchId?: string }) => ipcRenderer.invoke("agent:delete-batch", payload),
  logChatMessage: (payload: { role: "user" | "assistant"; text: string; tone?: "error"; at?: number }) =>
    ipcRenderer.invoke("agent:log-chat-message", payload),
  getChatHistory: () => ipcRenderer.invoke("agent:get-chat-history"),
  clearChatHistory: () => ipcRenderer.invoke("agent:clear-chat-history"),
  openLocalPath: (payload: { path: string }) => ipcRenderer.invoke("agent:open-local-path", payload),
  onFeatureJobStatus: (callback: (payload: Record<string, unknown>) => void) => {
    const handler = (_event: IpcRendererEvent, payload?: Record<string, unknown>) => {
      callback(payload || {});
    };
    ipcRenderer.on("agent:feature-job-status", handler);
    return () => ipcRenderer.removeListener("agent:feature-job-status", handler);
  },
  onDictationDelta: (callback: (payload: { sessionId?: number; delta?: string; transcript?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, payload?: { sessionId?: number; delta?: string; transcript?: string }) => {
      callback(payload || {});
    };
    ipcRenderer.on("agent:voice:event:dictation:delta", handler);
    return () => ipcRenderer.removeListener("agent:voice:event:dictation:delta", handler);
  },
  onDictationCompleted: (callback: (payload: { sessionId?: number; text?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, payload?: { sessionId?: number; text?: string }) => {
      callback(payload || {});
    };
    ipcRenderer.on("agent:voice:event:dictation:completed", handler);
    return () => ipcRenderer.removeListener("agent:voice:event:dictation:completed", handler);
  },
  onDictationError: (callback: (payload: { sessionId?: number; message?: string }) => void) => {
    const handler = (_event: IpcRendererEvent, payload?: { sessionId?: number; message?: string }) => {
      callback(payload || {});
    };
    ipcRenderer.on("agent:voice:event:dictation:error", handler);
    return () => ipcRenderer.removeListener("agent:voice:event:dictation:error", handler);
  }
});

contextBridge.exposeInMainWorld("retrieveBridge", {
  tags: {
    list: (paperId: string) => ipcRenderer.invoke("retrieve:tags:list", paperId),
    add: (payload: { paper: RetrievePaperSnapshot; tag: string }) =>
      ipcRenderer.invoke("retrieve:tags:add", payload),
    remove: (payload: { paperId: string; tag: string }) =>
      ipcRenderer.invoke("retrieve:tags:remove", payload)
  },
  citationNetwork: {
    fetch: (payload: RetrieveCitationNetworkRequest): Promise<RetrieveCitationNetwork> =>
      ipcRenderer.invoke("retrieve:citation-network", payload)
  },
  snowball: {
    run: (payload: RetrieveSnowballRequest): Promise<RetrieveCitationNetwork> =>
      ipcRenderer.invoke("retrieve:snowball", payload)
  },
  oa: {
    lookup: (payload: { doi: string }) => ipcRenderer.invoke("retrieve:oa", payload)
  },
  library: {
    save: (payload: { record: RetrieveRecord }) => ipcRenderer.invoke("retrieve:library:save", payload),
    export: (payload: { rows: RetrieveRecord[]; format: "csv" | "xlsx" | "ris"; targetPath: string }) =>
      ipcRenderer.invoke("retrieve:export", payload)
  }
});

contextBridge.exposeInMainWorld("analyseBridge", {
  dispatch: (payload: unknown) => ipcRenderer.invoke("analyse-command", payload),
  data: {
    discoverRuns: (baseDir?: string) => ipcRenderer.invoke("analyse:discoverRuns", baseDir),
    buildDatasetHandles: (runPath: string) => ipcRenderer.invoke("analyse:buildDatasets", runPath),
    loadBatches: (runPath: string) => ipcRenderer.invoke("analyse:loadBatches", runPath),
    loadSections: (runPath: string, level: SectionLevel) => ipcRenderer.invoke("analyse:loadSections", runPath, level),
    loadSectionsPage: (runPath: string, level: SectionLevel, offset: number, limit: number) =>
      ipcRenderer.invoke("analyse:loadSectionsPage", runPath, level, offset, limit),
    querySections: (runPath: string, level: SectionLevel, query: unknown, offset: number, limit: number) =>
      ipcRenderer.invoke("analyse:querySections", runPath, level, query, offset, limit),
    loadBatchPayloadsPage: (runPath: string, offset: number, limit: number) =>
      ipcRenderer.invoke("analyse:loadBatchPayloadsPage", runPath, offset, limit),
    getDirectQuotes: (runPath: string, ids: string[]) =>
      ipcRenderer.invoke("analyse:getDirectQuotes", runPath, ids),
    loadDqLookup: (runPath: string) => ipcRenderer.invoke("analyse:loadDqLookup", runPath),
    summariseRun: (runPath: string) => ipcRenderer.invoke("analyse:summariseRun", runPath),
    getDefaultBaseDir: () => ipcRenderer.invoke("analyse:getDefaultBaseDir"),
    getAudioCacheStatus: (runId: string | undefined, keys: string[]) =>
      ipcRenderer.invoke("analyse:audioCacheStatus", runId, keys),
    addAudioCacheEntries: (runId: string | undefined, entries: unknown[]) =>
      ipcRenderer.invoke("analyse:audioCacheAdd", runId, entries),
    listCachedTables: () => ipcRenderer.invoke("analyse:list-cached-tables"),
    runAiOnTable: (payload: unknown) => ipcRenderer.invoke("analyse:run-ai-on-table", payload)
  }
});

contextBridge.exposeInMainWorld("systematicBridge", {
  composePaper: (payload: { runDir: string; checklistPath: string }) =>
    ipcRenderer.invoke("systematic:compose-paper", payload),
  prismaAudit: (payload: { runDir: string }) =>
    ipcRenderer.invoke("systematic:prisma-audit", payload),
  prismaRemediate: (payload: { runDir: string }) =>
    ipcRenderer.invoke("systematic:prisma-remediate", payload),
  adjudicateConflicts: (payload: { runDir: string; resolvedCount?: number }) =>
    ipcRenderer.invoke("systematic:adjudicate-conflicts", payload),
  executeSteps1to15: (payload: { runDir: string; checklistPath: string; reviewerCount?: number }) =>
    ipcRenderer.invoke("systematic:execute-steps-1-15", payload),
  fullRun: (payload: { runDir: string; checklistPath: string; maxIterations?: number; minPassPct?: number; maxFail?: number }) =>
    ipcRenderer.invoke("systematic:full-run", payload)
});

contextBridge.exposeInMainWorld("settingsBridge", {
  getAll: () => ipcRenderer.invoke("settings:getAll"),
  getValue: (key: string, defaultValue?: unknown) => ipcRenderer.invoke("settings:getValue", key, defaultValue),
  setValue: (key: string, value: unknown) => ipcRenderer.invoke("settings:setValue", key, value),
  unlockSecrets: (passphrase: string) => ipcRenderer.invoke("settings:unlockSecrets", passphrase),
  getSecret: (name: string) => ipcRenderer.invoke("settings:getSecret", name),
  setSecret: (name: string, value: string) => ipcRenderer.invoke("settings:setSecret", name, value),
  getDotEnvStatus: () => ipcRenderer.invoke("settings:getDotEnvStatus"),
  listAudioInputs: () => ipcRenderer.invoke("settings:listAudioInputs"),
  exportBundle: (zipPath: string, includeSecrets?: boolean) =>
    ipcRenderer.invoke("settings:exportBundle", { zipPath, includeSecrets }),
  importBundle: (zipPath: string) => ipcRenderer.invoke("settings:importBundle", zipPath),
  getPaths: () => ipcRenderer.invoke("settings:getPaths"),
  openSettingsWindow: (section?: string) => ipcRenderer.invoke("settings:open-window", { section }),
  clearCache: () => ipcRenderer.invoke("settings:clearCache")
});

ipcRenderer.on("settings:updated", (_event, payload: { key?: string; value?: unknown }) => {
  window.dispatchEvent(new CustomEvent("settings:updated", { detail: payload }));
});

contextBridge.exposeInMainWorld("projectBridge", {
  initialize: () => ipcRenderer.invoke("project:initialize"),
  createProject: (payload: { directory: string; name: string; useParent?: boolean }) =>
    ipcRenderer.invoke("project:create", payload),
  openProject: (projectPath: string) => ipcRenderer.invoke("project:open", projectPath),
  saveSession: (payload: { projectPath: string; session: SessionData }) =>
    ipcRenderer.invoke("project:save", payload),
  exportProject: (payload: { projectPath: string; destination?: string }) =>
    ipcRenderer.invoke("project:export", payload),
  importProject: (payload: { archivePath: string; destination: string }) =>
    ipcRenderer.invoke("project:import", payload),
  pickArchive: () => ipcRenderer.invoke("project:pick-archive"),
  pickDirectory: (options?: { defaultPath?: string }) =>
    ipcRenderer.invoke("project:pick-directory", options),
  getDefaultDirectory: () => ipcRenderer.invoke("project:get-default-directory"),
  listRecentProjects: () => ipcRenderer.invoke("project:list-recent")
});

contextBridge.exposeInMainWorld("sessionBridge", {
  onMenuAction: (callback: (action: SessionMenuAction) => void) => {
    const handler = (_event: IpcRendererEvent, action?: SessionMenuAction) => {
      if (action) {
        callback(action);
      }
    };
    ipcRenderer.on("session:menu-action", handler);
    return () => {
      ipcRenderer.removeListener("session:menu-action", handler);
    };
  }
});

contextBridge.exposeInMainWorld("coderBridge", {
  savePayload: (payload: {
    scopeId?: string;
    nodeId: string;
    data: Record<string, unknown>;
    projectPath?: string;
    statePath?: string;
  }) => ipcRenderer.invoke("coder:save-payload", payload),
  loadState: (payload: { scopeId?: string; projectPath?: string; statePath?: string; name?: string }) =>
    ipcRenderer.invoke("coder:load-state", payload),
  saveState: (payload: { scopeId?: string; state: CoderState; projectPath?: string; statePath?: string; name?: string }) =>
    ipcRenderer.invoke("coder:save-state", payload),
  pickSavePath: (payload: { scopeId?: string; projectPath?: string; statePath?: string; name?: string }) =>
    ipcRenderer.invoke("coder:pick-save-path", payload),
  listStates: (payload: { scopeId?: string; projectPath?: string }) => ipcRenderer.invoke("coder:list-states", payload),
  resolveStatePath: (payload: { scopeId?: string; projectPath?: string; name?: string }) =>
    ipcRenderer.invoke("coder:resolve-state-path", payload)
});

let footnoteHandlers: { open?: () => void; toggle?: () => void; close?: () => void } | null = null;

const readFile = async (request: { sourcePath: string }) => {
  return ipcRenderer.invoke("leditor:read-file", request);
};

const readBinaryFile = async (request: { sourcePath: string; maxBytes?: number }) => {
  return ipcRenderer.invoke("leditor:read-binary-file", request);
};

const writeFile = async (request: { targetPath: string; data: string }) => {
  return ipcRenderer.invoke("leditor:write-file", request);
};

 contextBridge.exposeInMainWorld("leditorHost", {
  exportDOCX: (request: { docJson: object; options?: Record<string, unknown> }) =>
    ipcRenderer.invoke("leditor:export-docx", request),
  exportPDF: (request: { html: string; options?: { suggestedPath?: string; prompt?: boolean } }) =>
    ipcRenderer.invoke("leditor:export-pdf", request),
  exportLEDOC: (request: { payload: unknown; options?: { targetPath?: string; suggestedPath?: string; prompt?: boolean } }) =>
    ipcRenderer.invoke("leditor:export-ledoc", request),
  getAiStatus: () => ipcRenderer.invoke("leditor:ai-status"),
  registerFootnoteHandlers: (handlers: { open?: () => void; toggle?: () => void; close?: () => void }) => {
    footnoteHandlers = handlers;
  },
  openFootnotePanel: () => footnoteHandlers?.open?.(),
  toggleFootnotePanel: () => footnoteHandlers?.toggle?.(),
  closeFootnotePanel: () => footnoteHandlers?.close?.(),
  importDOCX: (request?: { options?: { sourcePath?: string; prompt?: boolean } }) =>
    ipcRenderer.invoke("leditor:import-docx", request ?? {}),
 importLEDOC: (request?: { options?: { sourcePath?: string; prompt?: boolean } }) =>
    ipcRenderer.invoke("leditor:import-ledoc", request ?? {}),
  listLedocVersions: (request: { ledocPath: string }) => ipcRenderer.invoke("leditor:versions:list", request),
  createLedocVersion: (request: {
    ledocPath: string;
    reason?: string;
    label?: string;
    note?: string;
    payload?: any;
    throttleMs?: number;
    force?: boolean;
  }) => ipcRenderer.invoke("leditor:versions:create", request),
  restoreLedocVersion: (request: { ledocPath: string; versionId: string; mode?: "replace" | "copy" }) =>
    ipcRenderer.invoke("leditor:versions:restore", request),
  deleteLedocVersion: (request: { ledocPath: string; versionId: string }) => ipcRenderer.invoke("leditor:versions:delete", request),
  pinLedocVersion: (request: { ledocPath: string; versionId: string; pinned: boolean }) => ipcRenderer.invoke("leditor:versions:pin", request),
  insertImage: () => ipcRenderer.invoke("leditor:insert-image"),
  getDefaultLEDOCPath: () => ipcRenderer.invoke("leditor:get-default-ledoc-path"),
  readFile,
  readBinaryFile,
  writeFile
});
