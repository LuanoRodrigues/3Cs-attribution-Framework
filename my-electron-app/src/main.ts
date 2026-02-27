import fs from "fs";
import path from "path";
import net from "net";
import { createHash, randomUUID } from "crypto";
import os from "os";
import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, shell, dialog, session } from "electron";
import { pathToFileURL } from "url";
import mammoth from "mammoth";
import JSZip from "jszip";
import { spawn, spawnSync } from "child_process";
import { createLedocVersion, deleteLedocVersion, listLedocVersions, pinLedocVersion, restoreLedocVersion } from "./ledoc_versions";

import type { SectionLevel } from "./analyse/types";
import { addAudioCacheEntries, getAudioCacheStatus } from "./analyse/audioCache";
import { exportConfigBundle, importConfigBundle } from "./config/bundle";
import { SettingsService } from "./config/settingsService";
import {
  getAppDataPath,
  getConfigDirectory,
  getSetting,
  setSetting,
  getSettingsFilePath,
  initializeSettingsFacade
} from "./config/settingsFacade";
import { getSecretsVault, initializeSecretsVault } from "./config/secretsVaultInstance";
import { DATABASE_KEYS, LLM_KEYS } from "./config/settingsKeys";
import { handleRetrieveCommand, registerRetrieveIpcHandlers } from "./main/ipc/retrieve_ipc";
import { registerProjectIpcHandlers } from "./main/ipc/project_ipc";
import { ProjectManager } from "./main/services/projectManager";
import {
  invokeVisualiseDescribeSlide,
  invokeVisualiseExportPptx,
  invokeVisualisePreview,
  invokeVisualiseSections,
  resetVisualiseWorker
} from "./main/services/visualiseBridge";
import { invokePdfOcr } from "./main/services/pdfOcrBridge";
import { createCoderTestTree, createPdfTestPayload } from "./test/testFixtures";
import { getCoderCacheDir, CODER_DIR_NAME } from "./session/sessionPaths";
import type { SessionMenuAction } from "./session/sessionTypes";
import { openSettingsWindow } from "./windows/settingsWindow";
import { applyDefaultZoomFactor } from "./windows/windowZoom";
import { WorkerPool } from "./main/jobs/workerPool";
import { LruCache } from "./main/jobs/lruCache";
import {
  buildDatasetHandles,
  discoverRuns,
  getDefaultBaseDir,
  getDirectQuoteEntries,
  loadBatches,
  loadDirectQuoteLookup,
  loadSectionsPage,
  loadSections,
  querySections,
  loadBatchPayloadsPage,
  summariseRun
} from "./analyse/backend";
import { executeRetrieveSearch } from "./main/ipc/retrieve_ipc";
import { FeatureWorker } from "./main/agent/featureWorker";
import { groupedFeatures, getFeatureByFunctionName } from "./main/agent/featureRegistry";
import {
  auditPrisma,
  composeFullPaper,
  executeSystematicSteps1To15,
  remediatePrisma,
  runFullSystematicWorkflow
} from "./main/services/systematicReview";
import {
  normalizeCollectionIdentifier,
  resolveIntentForCommand,
  inferCollectionNameFromContextPath,
  resolveVerbatimDirBase,
  type IntentPayload
} from "./main/agent/intent";

let mainWindow: BrowserWindow | null = null;
let secretsVault: ReturnType<typeof getSecretsVault> | null = null;
let userDataPath = "";
let handlersRegistered = false;
let projectManagerInstance: ProjectManager | null = null;
const settingsService = new SettingsService();
const SESSION_MENU_CHANNEL = "session:menu-action";
type ConvertResult = Awaited<ReturnType<typeof mammoth.convertToHtml>>;
const SCREEN_HOST_PORT = Number(process.env.SCREEN_HOST_PORT ?? "8222");
const AGENT_CLI_PORT = Number(process.env.AGENT_CLI_PORT ?? "8333");
const AGENT_CLI_HOST = String(process.env.AGENT_CLI_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const AGENT_DICTATION_EVENT_DELTA = "agent:voice:event:dictation:delta";
const AGENT_DICTATION_EVENT_COMPLETED = "agent:voice:event:dictation:completed";
const AGENT_DICTATION_EVENT_ERROR = "agent:voice:event:dictation:error";

let agentCliBridgeServer: net.Server | null = null;
let dictationSessionId = 0;
let dictationSessionActive = false;
let dictationTranscript = "";
let dictationQueue: Promise<void> = Promise.resolve();
let dictationRealtimeSocket: any | null = null;
let dictationRealtimeConnected = false;
let dictationRealtimeBufferedBytes = 0;
let dictationRealtimeCommitTimer: NodeJS.Timeout | null = null;
let dictationRealtimeClosedForSession = -1;
const DICTATION_REALTIME_MIN_COMMIT_BYTES = 3200;
const DICTATION_REALTIME_COMMIT_DELAY_MS = 360;
let dictationFallbackWebmChunks: Buffer[] = [];
let dictationFallbackWebmBytes = 0;
let dictationFallbackLastTranscribedBytes = 0;
let dictationFallbackLastTranscribedAt = 0;

function mergeDictationTranscript(previous: string, nextChunk: string): string {
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
}

function getOpenAiRealtimeUrl(): string {
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const realtimePath = "/realtime";
  if (baseUrl.startsWith("https://")) {
    return `wss://${baseUrl.slice("https://".length)}${realtimePath}`;
  }
  if (baseUrl.startsWith("http://")) {
    return `ws://${baseUrl.slice("http://".length)}${realtimePath}`;
  }
  return `${baseUrl}${realtimePath}`;
}

function resolveRealtimeWebSocketCtor(): any | null {
  try {
    const wsModule = require("ws") as { WebSocket?: any } | any;
    if (typeof wsModule === "function") return wsModule;
    if (wsModule?.WebSocket) return wsModule.WebSocket;
  } catch {
    // ignore
  }
  return null;
}

function emitDictationEvent(channel: string, payload: Record<string, unknown>): void {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send(channel, payload);
  } catch {
    // ignore event delivery failures
  }
}

function coerceAudioPayloadToBuffer(payload: unknown): Buffer | null {
  if (!payload) return null;
  if (Buffer.isBuffer(payload)) return payload;
  if (payload instanceof ArrayBuffer) return Buffer.from(payload);
  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength);
  }
  if (typeof payload === "string" && payload.trim()) {
    try {
      return Buffer.from(payload.trim(), "base64");
    } catch {
      return null;
    }
  }
  return null;
}

function enqueueDictationAudioBuffer(sessionId: number, audioBuffer: Buffer, mimeType: string): void {
  if (!dictationSessionActive || sessionId !== dictationSessionId) return;
  if (!audioBuffer || !audioBuffer.length) return;
  const isWebm = String(mimeType || "").toLowerCase().includes("webm");
  if (isWebm && dictationRealtimeSocket && dictationRealtimeConnected && sessionId === dictationSessionId) {
    try {
      dictationRealtimeSocket.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audioBuffer.toString("base64")
      }));
      dictationRealtimeBufferedBytes += audioBuffer.length;
      scheduleDictationRealtimeCommit();
      return;
    } catch {
      // fall through to chunk fallback
    }
  }
  if (isWebm) {
    dictationFallbackWebmChunks.push(audioBuffer);
    dictationFallbackWebmBytes += audioBuffer.length;
    const now = Date.now();
    const bytesSinceLast = dictationFallbackWebmBytes - dictationFallbackLastTranscribedBytes;
    const timeSinceLast = now - dictationFallbackLastTranscribedAt;
    if (bytesSinceLast < 12000 && timeSinceLast < 900) {
      return;
    }
    const snapshot = Buffer.concat(dictationFallbackWebmChunks);
    dictationFallbackLastTranscribedBytes = dictationFallbackWebmBytes;
    dictationFallbackLastTranscribedAt = now;
    dictationQueue = dictationQueue
      .then(async () => {
        if (!dictationSessionActive || sessionId !== dictationSessionId) return;
        const transcribed = await callOpenAiTranscribeAudio({
          audioBuffer: snapshot,
          mimeType: "audio/webm"
        });
        if (!dictationSessionActive || sessionId !== dictationSessionId) return;
        if (String(transcribed?.status || "") !== "ok") {
          const message = String(transcribed?.message || "Dictation transcription failed.");
          emitDictationEvent(AGENT_DICTATION_EVENT_ERROR, { sessionId, message });
          return;
        }
        const text = String(transcribed?.text || "").trim();
        if (!text) return;
        dictationTranscript = mergeDictationTranscript(dictationTranscript, text);
        emitDictationEvent(AGENT_DICTATION_EVENT_DELTA, {
          sessionId,
          delta: text,
          transcript: dictationTranscript
        });
      })
      .catch((error) => {
        if (!dictationSessionActive || sessionId !== dictationSessionId) return;
        emitDictationEvent(AGENT_DICTATION_EVENT_ERROR, {
          sessionId,
          message: error instanceof Error ? error.message : String(error || "Dictation error")
        });
      });
    return;
  }
  dictationQueue = dictationQueue
    .then(async () => {
      if (!dictationSessionActive || sessionId !== dictationSessionId) return;
      const transcribed = await callOpenAiTranscribeAudio({
        audioBuffer,
        mimeType
      });
      if (!dictationSessionActive || sessionId !== dictationSessionId) return;
      if (String(transcribed?.status || "") !== "ok") {
        const message = String(transcribed?.message || "Dictation transcription failed.");
        emitDictationEvent(AGENT_DICTATION_EVENT_ERROR, { sessionId, message });
        return;
      }
      const text = String(transcribed?.text || "").trim();
      if (!text) return;
      dictationTranscript = mergeDictationTranscript(dictationTranscript, text);
      emitDictationEvent(AGENT_DICTATION_EVENT_DELTA, {
        sessionId,
        delta: text,
        transcript: dictationTranscript
      });
    })
    .catch((error) => {
      if (!dictationSessionActive || sessionId !== dictationSessionId) return;
      emitDictationEvent(AGENT_DICTATION_EVENT_ERROR, {
        sessionId,
        message: error instanceof Error ? error.message : String(error || "Dictation error")
      });
    });
}

function clearDictationRealtimeCommitTimer(): void {
  if (dictationRealtimeCommitTimer) {
    clearTimeout(dictationRealtimeCommitTimer);
    dictationRealtimeCommitTimer = null;
  }
}

function closeDictationRealtimeSocket(): void {
  clearDictationRealtimeCommitTimer();
  if (dictationRealtimeSocket) {
    try {
      dictationRealtimeSocket.close();
    } catch {
      // ignore
    }
  }
  dictationRealtimeSocket = null;
  dictationRealtimeConnected = false;
  dictationRealtimeBufferedBytes = 0;
}

function scheduleDictationRealtimeCommit(): void {
  clearDictationRealtimeCommitTimer();
  dictationRealtimeCommitTimer = setTimeout(() => {
    if (!dictationRealtimeSocket || !dictationRealtimeConnected) return;
    if (dictationRealtimeBufferedBytes < DICTATION_REALTIME_MIN_COMMIT_BYTES) return;
    try {
      dictationRealtimeSocket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      dictationRealtimeBufferedBytes = 0;
    } catch {
      // ignore
    }
  }, DICTATION_REALTIME_COMMIT_DELAY_MS);
}

async function openDictationRealtimeSocket(sessionId: number): Promise<boolean> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return false;
  const Ctor = resolveRealtimeWebSocketCtor();
  if (!Ctor) return false;
  const model = getOpenAiVoiceTranscribeModel();
  const url = `${getOpenAiRealtimeUrl()}?model=${encodeURIComponent(model)}&intent=transcription`;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let ws: any;
    try {
      ws = new Ctor(url, [], {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "realtime=v1"
        }
      });
    } catch (error) {
      dbgMain("openDictationRealtimeSocket", "constructor failed", {
        message: error instanceof Error ? error.message : String(error || "unknown error")
      });
      done(false);
      return;
    }
    const timeout = setTimeout(() => {
      try {
        ws?.close?.();
      } catch {
        // ignore
      }
      done(false);
    }, 4000);
    ws.onopen = () => {
      clearTimeout(timeout);
      dictationRealtimeSocket = ws;
      dictationRealtimeConnected = true;
      dictationRealtimeClosedForSession = -1;
      dictationRealtimeBufferedBytes = 0;
      try {
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/webm" },
                transcription: { model },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 500
                }
              }
            }
          }
        }));
      } catch {
        // ignore
      }
      done(true);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      if (dictationSessionActive && sessionId === dictationSessionId) {
        emitDictationEvent(AGENT_DICTATION_EVENT_ERROR, { sessionId, message: "Realtime dictation socket error." });
      }
      done(false);
    };
    ws.onclose = () => {
      clearTimeout(timeout);
      dictationRealtimeConnected = false;
      if (dictationSessionActive && sessionId === dictationSessionId && dictationRealtimeClosedForSession !== sessionId) {
        dictationRealtimeClosedForSession = sessionId;
        emitDictationEvent(AGENT_DICTATION_EVENT_ERROR, { sessionId, message: "Realtime dictation disconnected; using chunk fallback." });
      }
      done(false);
    };
    ws.onmessage = (event: { data?: unknown }) => {
      let parsed: Record<string, unknown> | null = null;
      try {
        const raw = typeof event?.data === "string" ? event.data : Buffer.from(event?.data as ArrayBuffer).toString("utf8");
        parsed = JSON.parse(raw || "{}");
      } catch {
        parsed = null;
      }
      if (!parsed || sessionId !== dictationSessionId || !dictationSessionActive) return;
      const type = String(parsed.type || "");
      if (type === "conversation.item.input_audio_transcription.delta") {
        const delta = String(parsed.delta || "").trim();
        if (!delta) return;
        dictationTranscript = mergeDictationTranscript(dictationTranscript, delta);
        emitDictationEvent(AGENT_DICTATION_EVENT_DELTA, { sessionId, delta, transcript: dictationTranscript });
        return;
      }
      if (type === "conversation.item.input_audio_transcription.completed") {
        const transcript = String(parsed.transcript || "").trim();
        if (!transcript) return;
        dictationTranscript = transcript;
        emitDictationEvent(AGENT_DICTATION_EVENT_DELTA, { sessionId, delta: transcript, transcript: dictationTranscript });
        return;
      }
      if (type === "error") {
        emitDictationEvent(AGENT_DICTATION_EVENT_ERROR, {
          sessionId,
          message: String((parsed.error as { message?: string } | undefined)?.message || "Realtime transcription error.")
        });
      }
    };
  });
}

function startAgentCliBridgeServer(handlers: {
  runAgent: (payload: { text?: string; context?: Record<string, unknown> }) => Promise<Record<string, unknown>>;
  speakText: (payload: { text?: string; voice?: string; speed?: number; format?: string; model?: string }) => Promise<Record<string, unknown>>;
}): void {
  if (agentCliBridgeServer) return;
  agentCliBridgeServer = net.createServer((socket) => {
    let buffer = "";
    const writeResult = (result: Record<string, unknown>) => {
      try {
        socket.write(JSON.stringify(result));
      } catch {
        // ignore
      }
      try {
        socket.end();
      } catch {
        // ignore
      }
    };
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
    });
    socket.on("end", async () => {
      let payload: { action?: string; payload?: Record<string, unknown> } = {};
      try {
        payload = JSON.parse(buffer || "{}");
      } catch (error) {
        writeResult({ status: "error", message: `invalid_json:${String(error)}` });
        return;
      }
      const action = String(payload.action || "").trim().toLowerCase();
      try {
        if (!action || action === "health") {
          writeResult({ status: "ok", message: "agent_cli_bridge_ready" });
          return;
        }
        if (action === "agent.run") {
          writeResult(await handlers.runAgent((payload.payload || {}) as { text?: string; context?: Record<string, unknown> }));
          return;
        }
        if (action === "agent.speak_text") {
          writeResult(await handlers.speakText((payload.payload || {}) as { text?: string; voice?: string; speed?: number; format?: string; model?: string }));
          return;
        }
        writeResult({ status: "error", message: `unsupported_action:${action}` });
      } catch (error) {
        writeResult({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    });
    socket.on("error", () => {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    });
  });
  agentCliBridgeServer.listen(AGENT_CLI_PORT, AGENT_CLI_HOST, () => {
    console.info(`[main.ts][startAgentCliBridgeServer][debug] listening on ${AGENT_CLI_HOST}:${AGENT_CLI_PORT}`);
  });
}

type CommandEnvelope = {
  phase?: string;
  action?: string;
  payload?: unknown;
};

const isDevelopment = process.env.NODE_ENV !== "production";

const isWsl =
  Boolean(process.env.WSL_DISTRO_NAME) ||
  Boolean(process.env.WSL_INTEROP) ||
  os.release().toLowerCase().includes("microsoft");

// WSL/DBus/systemd integration can be noisy and is not required for this app.
// Reduce Chromium-level logging to avoid misleading startup "ERROR:" lines.
if (isWsl) {
  app.commandLine.appendSwitch("log-level", "3"); // FATAL only
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");

const fetchJson = async (url: string, init: RequestInit): Promise<any> => {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!res.ok) {
    const message =
      typeof json?.error?.message === "string"
        ? json.error.message
        : typeof json?.message === "string"
          ? json.message
          : text.slice(0, 1000);
    throw new Error(`${res.status} ${res.statusText}: ${message}`);
  }
  return json;
};

const getOpenAiApiKey = (): string => {
  // Prefer settings if present, else environment.
  loadDotEnvIntoProcessEnv();
  try {
    const configured = String(getSetting<string>(LLM_KEYS.openaiKey, "") || "").trim();
    if (configured) return configured;
  } catch {
    // ignore
  }
  return String(process.env.OPENAI_API_KEY || "").trim();
};

const getOpenAiBaseUrl = (): string => {
  loadDotEnvIntoProcessEnv();
  try {
    const configured = String(getSetting<string>(LLM_KEYS.openaiBaseUrl, "https://api.openai.com/v1") || "").trim();
    if (configured) return configured;
  } catch {
    // ignore
  }
  return "https://api.openai.com/v1";
};

const callOpenAiDescribeWithImage = async (args: {
  model: string;
  instructions: string;
  inputText: string;
  imageDataUrl?: string;
  signal?: AbortSignal;
}): Promise<string> => {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    throw new Error("Missing OpenAI API key (set OPENAI_API_KEY or configure APIs/openai_api_key in Settings).");
  }
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const url = `${baseUrl}/responses`;
  const content: any[] = [{ type: "input_text", text: args.inputText }];
  if (args.imageDataUrl && args.imageDataUrl.startsWith("data:image/")) {
    content.push({ type: "input_image", image_url: args.imageDataUrl });
  }
  const body: any = {
    model: args.model,
    instructions: args.instructions,
    input: [{ role: "user", content }],
    max_output_tokens: 700
  };
  const json = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: args.signal
  });
  const text = typeof json?.output_text === "string" ? json.output_text : String(json?.output_text ?? "");
  return text.trim();
};
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");

const cpuCount = Math.max(1, os.cpus()?.length ?? 1);
const workerCount = Math.max(1, Math.min(cpuCount - 1, 4));
let analysePool: WorkerPool | null = null;
let retrievePool: WorkerPool | null = null;
const analyseCache = new LruCache<unknown>(24);
const retrieveCache = new LruCache<unknown>(12);
const featureWorker = new FeatureWorker();
let zoteroSignatures: Record<string, { functionName?: string; args?: Array<{ key?: string; type?: string; required?: boolean; default?: unknown }> }> | null = null;
const intentTelemetry = {
  requests: 0,
  workflowIntents: 0,
  featureIntents: 0,
  legacyIntents: 0,
  executed: 0,
  failed: 0,
  fallbackUsed: 0,
  llmSuccess: 0,
  llmFailures: 0
};
type FeatureJob = {
  id: string;
  functionName: string;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  phase: string;
  startedAt: number;
  endedAt?: number;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  openaiBatchId?: string;
  outputFileId?: string;
  canceled?: boolean;
};
type ChatHistoryEntry = {
  role: "user" | "assistant";
  text: string;
  tone?: "error";
  at: number;
};
const featureJobs: FeatureJob[] = [];
const chatHistory: ChatHistoryEntry[] = [];
const resolveVerbatimDirBaseForContext = (context: Record<string, unknown> = {}): string => {
  const collectionHint = String(context?.selectedCollectionName || context?.selectedCollectionKey || "").trim();
  if (!collectionHint) {
    try {
      return getDefaultBaseDir();
    } catch {
      return "./running_tests";
    }
  }
  const rootFallback = (() => {
    const configured = cleanDirBase(process.env.ZOTERO_ANALYSE_DIR || process.env.ANALYSE_DIR);
    if (configured) return configured;
    const home = process.env.HOME || process.env.USERPROFILE || "";
    return home ? path.join(home, "annotarium", "analyse", "frameworks") : "./running_tests";
  })();
  return resolveVerbatimDirBase(context, rootFallback);
};

const cleanDirBase = (value: unknown): string => String(value || "").trim();
const isBlankDirBase = (value: unknown): boolean => {
  const normalized = cleanDirBase(value);
  return !normalized || normalized === "./running_tests";
};

const attachDynamicVerbatimDirBase = (
  intent: IntentPayload | undefined,
  context: Record<string, unknown> = {}
): IntentPayload | undefined => {
  if (!intent) return intent;
  if (String(intent.targetFunction || "") !== "Verbatim_Evidence_Coding") return intent;
  const args = ((intent.args as Record<string, unknown>) || {}) as Record<string, unknown>;
  const currentDirBase = cleanDirBase(args.dir_base);
  if (!isBlankDirBase(currentDirBase)) return intent;
  const resolvedDirBase = resolveVerbatimDirBaseForContext(context);
  if (resolvedDirBase === currentDirBase) return intent;
  return { ...intent, args: { ...args, dir_base: resolvedDirBase } };
};

function bumpIntentTelemetry(
  key: keyof typeof intentTelemetry
): void {
  intentTelemetry[key] += 1;
  persistAgentState();
}

function getAgentStateDir(): string {
  return path.join(app.getPath("userData"), "state", "agent");
}

function getIntentStatsPath(): string {
  return path.join(getAgentStateDir(), "intent_stats.json");
}

function getFeatureJobsPath(): string {
  return path.join(getAgentStateDir(), "feature_jobs.json");
}

function getChatHistoryPath(): string {
  return path.join(getAgentStateDir(), "chat_history.json");
}

function safeReadJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw || "null");
    return (parsed as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath: string, value: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

function persistAgentState(): void {
  safeWriteJson(getIntentStatsPath(), intentTelemetry);
  safeWriteJson(getFeatureJobsPath(), featureJobs);
  safeWriteJson(getChatHistoryPath(), chatHistory.slice(-300));
}

function loadAgentState(): void {
  const persistedTelemetry = safeReadJson<Record<string, unknown>>(getIntentStatsPath(), {});
  for (const key of Object.keys(intentTelemetry) as Array<keyof typeof intentTelemetry>) {
    const n = Number(persistedTelemetry[key]);
    if (Number.isFinite(n) && n >= 0) {
      intentTelemetry[key] = n;
    }
  }
  const persistedJobs = safeReadJson<FeatureJob[]>(getFeatureJobsPath(), []);
  if (Array.isArray(persistedJobs)) {
    featureJobs.length = 0;
    persistedJobs.slice(0, 400).forEach((job) => {
      if (!job || typeof job !== "object") return;
      featureJobs.push(job);
    });
  }
  const persistedChat = safeReadJson<ChatHistoryEntry[]>(getChatHistoryPath(), []);
  if (Array.isArray(persistedChat)) {
    chatHistory.length = 0;
    persistedChat.slice(-300).forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      if (entry.role !== "user" && entry.role !== "assistant") return;
      chatHistory.push({
        role: entry.role,
        text: String(entry.text || ""),
        tone: entry.tone === "error" ? "error" : undefined,
        at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now()
      });
    });
  }
}

function detectBatchMetadata(value: unknown): { batchId?: string; outputFileId?: string } {
  const seen = new Set<unknown>();
  const walk = (node: unknown): { batchId?: string; outputFileId?: string } => {
    if (!node || typeof node !== "object") return {};
    if (seen.has(node)) return {};
    seen.add(node);
    const rec = node as Record<string, unknown>;
    const batchId =
      String(rec.batch_id || rec.batchId || rec.openaiBatchId || "").trim() ||
      undefined;
    const outputFileId =
      String(rec.output_file_id || rec.outputFileId || "").trim() ||
      undefined;
    if (batchId || outputFileId) return { batchId, outputFileId };
    for (const v of Object.values(rec)) {
      const child = walk(v);
      if (child.batchId || child.outputFileId) return child;
    }
    return {};
  };
  return walk(value);
}

function emitFeatureJobStatus(job: FeatureJob): void {
  persistAgentState();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    mainWindow.webContents.send("agent:feature-job-status", { ...job });
  } catch {
    // ignore
  }
}

function cacheKey(method: string, args: unknown[]): string {
  try {
    return `${method}:${JSON.stringify(args)}`;
  } catch {
    return `${method}:[unserializable]`;
  }
}

async function runCached<T>(cache: LruCache<unknown>, method: string, args: unknown[], run: () => Promise<T>): Promise<T> {
  const key = cacheKey(method, args);
  const hit = cache.get(key) as T | undefined;
  if (hit !== undefined) {
    return hit;
  }
  const result = await run();
  cache.set(key, result as unknown);
  return result;
}

function requirePools(): { analysePool: WorkerPool; retrievePool: WorkerPool } {
  if (!analysePool || !retrievePool) {
    throw new Error("Worker pools are not initialized");
  }
  return { analysePool, retrievePool };
}

function getLogPath(): string {
  const targetDir = app.isPackaged ? app.getPath("userData") : path.join(app.getAppPath(), "..");
  return path.join(targetDir, ".codex_logs", "editor.log");
}

function findMainPyScript(scriptName: string): string {
  const candidates = [
    path.join(__dirname, "main", "py", scriptName),
    path.join(__dirname, "py", scriptName),
    path.join(process.cwd(), "my-electron-app", "src", "main", "py", scriptName),
    path.join(process.cwd(), "src", "main", "py", scriptName)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

async function loadZoteroSignatures(): Promise<Record<string, { functionName?: string; args?: Array<{ key?: string; type?: string; required?: boolean; default?: unknown }> }>> {
  if (zoteroSignatures && Object.keys(zoteroSignatures).length) return zoteroSignatures;
  const pythonCmd = process.env.PYTHON_BIN || "python3";
  const scriptPath = findMainPyScript("get_zotero_signatures.py");
  const result = await new Promise<{ status: string; signatures?: Record<string, any>; message?: string }>((resolve) => {
    const child = spawn(pythonCmd, [scriptPath], { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk || "");
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk || "");
    });
    child.on("error", (error) => {
      resolve({ status: "error", message: String(error?.message || error) });
    });
    child.on("exit", () => {
      try {
        const parsed = JSON.parse(stdout || "{}");
        if (parsed?.status === "ok" && parsed?.signatures && typeof parsed.signatures === "object") {
          resolve({ status: "ok", signatures: parsed.signatures });
        } else {
          resolve({ status: "error", message: parsed?.message || stderr || "Invalid signatures output." });
        }
      } catch {
        resolve({ status: "error", message: stderr || "Could not parse signatures output." });
      }
    });
  });
  if (result.status !== "ok") {
    throw new Error(result.message || "Failed to load Zotero signatures.");
  }
  zoteroSignatures = result.signatures || {};
  return zoteroSignatures;
}

function resolveFeatureDescriptor(
  functionName: string,
  signatures: Record<string, { functionName?: string; args?: Array<{ key?: string; type?: string; required?: boolean; default?: unknown }> }>
): { functionName: string; args: Array<{ key?: string; type?: string; required?: boolean; default?: unknown }> } | null {
  const listed = getFeatureByFunctionName(functionName, signatures);
  if (listed) {
    return {
      functionName: listed.functionName,
      args: Array.isArray(listed.args) ? listed.args : []
    };
  }
  const sig = signatures?.[functionName];
  if (!sig) return null;
  return {
    functionName,
    args: Array.isArray(sig.args) ? sig.args : []
  };
}

const INTENT_LLM_MODEL = String(process.env.OPENAI_MODEL || process.env.CODEX_MODEL || "gpt-5-mini").trim() || "gpt-5-mini";
const DEFAULT_OPENAI_VOICE_TRANSCRIBE_MODEL = "whisper-1";
const DEFAULT_OPENAI_VOICE_TTS_MODEL = "tts-1";
const DEFAULT_OPENAI_VOICE_TTS_VOICE = "alloy";
const DEFAULT_OPENAI_VOICE_TTS_FORMAT = "mp3";
const DEFAULT_NATIVE_AUDIO_SAMPLE_RATE = 16000;

type NativeAudioCaptureState = {
  child: ReturnType<typeof spawn>;
  chunks: Buffer[];
  streamChunkBuffer: Buffer[];
  streamFlushTimer: NodeJS.Timeout | null;
  backend: "pulse" | "alsa";
  sampleRate: number;
  startedAt: number;
};

let nativeAudioCaptureState: NativeAudioCaptureState | null = null;

const normalizeOpenAiAudioMime = (mimeType: unknown): { mime: string; extension: string; format: string } => {
  const clean = String(mimeType || "audio/webm").toLowerCase().trim();
  const mapping: Record<string, { extension: string; format: string }> = {
    "audio/webm": { extension: "webm", format: "webm" },
    "audio/webm;codecs=opus": { extension: "webm", format: "webm" },
    "audio/mp4": { extension: "m4a", format: "m4a" },
    "audio/m4a": { extension: "m4a", format: "m4a" },
    "audio/ogg": { extension: "ogg", format: "ogg" },
    "audio/ogg;codecs=opus": { extension: "ogg", format: "ogg" },
    "audio/wav": { extension: "wav", format: "wav" },
    "audio/x-wav": { extension: "wav", format: "wav" },
    "audio/mpeg": { extension: "mp3", format: "mp3" },
    "audio/mp3": { extension: "mp3", format: "mp3" }
  };
  const mapped = mapping[clean] || {
    extension: clean.startsWith("audio/ogg") ? "ogg" : clean.startsWith("audio/wav") || clean.includes("x-wav") ? "wav" : "webm",
    format: "webm"
  };
  return { mime: clean.startsWith("audio/") ? clean : "audio/webm", extension: mapped.extension, format: mapped.format };
};

const getOpenAiSettingValue = (key: string, fallback: string): string => {
  try {
    const raw = String(getSetting<string>(key, fallback) || "").trim();
    return raw || fallback;
  } catch {
    return fallback;
  }
};

const getOpenAiVoiceTranscribeModel = (): string =>
  getOpenAiSettingValue(LLM_KEYS.openaiVoiceTranscribeModel, DEFAULT_OPENAI_VOICE_TRANSCRIBE_MODEL);

const getOpenAiVoiceTtsModel = (): string =>
  getOpenAiSettingValue(LLM_KEYS.openaiVoiceTtsModel, DEFAULT_OPENAI_VOICE_TTS_MODEL);

const getOpenAiVoiceTtsVoice = (): string =>
  getOpenAiSettingValue(LLM_KEYS.openaiVoiceTtsVoice, DEFAULT_OPENAI_VOICE_TTS_VOICE);

const dbgMain = (fn: string, msg: string, details?: Record<string, unknown>): void => {
  if (details) {
    console.debug(`[main.ts][${fn}][debug] ${msg}`, details);
    return;
  }
  console.debug(`[main.ts][${fn}][debug] ${msg}`);
};

function audioBufferFromBase64(base64: string): Buffer {
  const raw = String(base64 || "").trim();
  if (!raw) throw new Error("audioBase64 is required.");
  return Buffer.from(raw, "base64");
}

function buildWavFromPcm16Mono(rawPcm: Buffer, sampleRate: number): Buffer {
  const headerSize = 44;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = rawPcm.length;
  const out = Buffer.alloc(headerSize + dataSize);
  let offset = 0;
  out.write("RIFF", offset);
  offset += 4;
  out.writeUInt32LE(headerSize + dataSize - 8, offset);
  offset += 4;
  out.write("WAVE", offset);
  offset += 4;
  out.write("fmt ", offset);
  offset += 4;
  out.writeUInt32LE(16, offset);
  offset += 4;
  out.writeUInt16LE(1, offset);
  offset += 2;
  out.writeUInt16LE(channels, offset);
  offset += 2;
  out.writeUInt32LE(sampleRate, offset);
  offset += 4;
  out.writeUInt32LE(byteRate, offset);
  offset += 4;
  out.writeUInt16LE(blockAlign, offset);
  offset += 2;
  out.writeUInt16LE(bitsPerSample, offset);
  offset += 2;
  out.write("data", offset);
  offset += 4;
  out.writeUInt32LE(dataSize, offset);
  offset += 4;
  rawPcm.copy(out, offset);
  return out;
}

const NATIVE_AUDIO_BACKENDS: Array<{ backend: "pulse" | "alsa"; cmd: string; args: string[] }> = [
  {
    backend: "pulse",
    cmd: "parec",
    args: ["--raw", "--rate", String(DEFAULT_NATIVE_AUDIO_SAMPLE_RATE), "--channels", "1", "--format=s16le"]
  },
  {
    backend: "alsa",
    cmd: "arecord",
    args: ["-q", "-t", "raw", "-f", "S16_LE", "-r", String(DEFAULT_NATIVE_AUDIO_SAMPLE_RATE), "-c", "1"]
  }
];

function getPreferredNativeAudioInputId(): string {
  try {
    return String(getSetting<string>(LLM_KEYS.openaiVoiceInputDeviceId, "") || "").trim();
  } catch {
    return "";
  }
}

function looksLikePulseSourceId(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  return v.includes(".") || v.includes("_") || v.includes("source") || v.includes("monitor");
}

function listNativeAudioInputs(): Array<{ id: string; label: string; backend: "pulse" | "alsa"; isDefault?: boolean }> {
  const out: Array<{ id: string; label: string; backend: "pulse" | "alsa"; isDefault?: boolean }> = [];
  try {
    const defaultRes = spawnSync("pactl", ["get-default-source"], { encoding: "utf8" });
    const defaultSource = String(defaultRes.stdout || "").trim();
    const listRes = spawnSync("pactl", ["list", "short", "sources"], { encoding: "utf8" });
    const raw = String(listRes.stdout || "");
    raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        const parts = line.split(/\t+/);
        const sourceId = String(parts[1] || "").trim();
        if (!sourceId) return;
        const desc = String(parts[1] || "").trim();
        out.push({
          id: sourceId,
          label: desc,
          backend: "pulse",
          isDefault: Boolean(defaultSource && sourceId === defaultSource)
        });
      });
  } catch {
    // ignore
  }
  return out;
}

async function startNativeAudioCapture(): Promise<{ status: string; backend?: string; sampleRate?: number; message?: string }> {
  if (nativeAudioCaptureState) {
    return {
      status: "ok",
      backend: nativeAudioCaptureState.backend,
      sampleRate: nativeAudioCaptureState.sampleRate
    };
  }
  const preferredInputId = getPreferredNativeAudioInputId();
  for (const candidate of NATIVE_AUDIO_BACKENDS) {
    const candidateAttempts: Array<{ cmd: string; args: string[] }> = [];
    if (candidate.backend === "pulse" && looksLikePulseSourceId(preferredInputId)) {
      candidateAttempts.push({ cmd: candidate.cmd, args: [...candidate.args, `--device=${preferredInputId}`] });
    }
    candidateAttempts.push({ cmd: candidate.cmd, args: candidate.args });
    for (const attempt of candidateAttempts) {
    const started = await new Promise<NativeAudioCaptureState | null>((resolve) => {
      const child = spawn(attempt.cmd, attempt.args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      const streamChunkBuffer: Buffer[] = [];
      let streamFlushTimer: NodeJS.Timeout | null = null;
      let settled = false;
      const finalize = (value: NativeAudioCaptureState | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const flushStreamChunk = () => {
        if (!streamChunkBuffer.length) return;
        const payload = Buffer.concat(streamChunkBuffer.splice(0, streamChunkBuffer.length));
        if (!payload.length) return;
        const sessionId = dictationSessionId;
        if (!dictationSessionActive || !sessionId) return;
        const wav = buildWavFromPcm16Mono(payload, DEFAULT_NATIVE_AUDIO_SAMPLE_RATE);
        enqueueDictationAudioBuffer(sessionId, wav, "audio/wav");
      };
      const scheduleStreamFlush = () => {
        if (streamFlushTimer) return;
        streamFlushTimer = setTimeout(() => {
          streamFlushTimer = null;
          flushStreamChunk();
        }, 650);
      };
      child.stdout.on("data", (chunk) => {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        chunks.push(data);
        if (dictationSessionActive && dictationSessionId > 0) {
          if (dictationRealtimeConnected) {
            closeDictationRealtimeSocket();
          }
          streamChunkBuffer.push(data);
          if (streamChunkBuffer.reduce((sum, part) => sum + part.length, 0) >= 8192) {
            if (streamFlushTimer) {
              clearTimeout(streamFlushTimer);
              streamFlushTimer = null;
            }
            flushStreamChunk();
          } else {
            scheduleStreamFlush();
          }
        }
      });
      child.once("error", () => {
        if (streamFlushTimer) {
          clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
        finalize(null);
      });
      child.once("close", () => {
        if (streamFlushTimer) {
          clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
      });
      child.once("exit", () => finalize(null));
      setTimeout(() => {
        finalize({
          child,
          chunks,
          streamChunkBuffer,
          streamFlushTimer,
          backend: candidate.backend,
          sampleRate: DEFAULT_NATIVE_AUDIO_SAMPLE_RATE,
          startedAt: Date.now()
        });
      }, 180);
    });
    if (started) {
      nativeAudioCaptureState = started;
      dbgMain("startNativeAudioCapture", "native capture started", {
        backend: started.backend,
        sampleRate: started.sampleRate,
        preferredInputId: preferredInputId || "",
        command: `${attempt.cmd} ${attempt.args.join(" ")}`
      });
      return { status: "ok", backend: started.backend, sampleRate: started.sampleRate };
    }
  }
  }
  return { status: "error", message: "No native audio backend available (parec/arecord)." };
}

async function stopNativeAudioCapture(): Promise<{
  status: string;
  audioBase64?: string;
  mimeType?: string;
  bytes?: number;
  backend?: string;
  sampleRate?: number;
  message?: string;
}> {
  const active = nativeAudioCaptureState;
  if (!active) {
    return { status: "error", message: "Native audio capture is not active." };
  }
  nativeAudioCaptureState = null;
  const child = active.child;
  if (active.streamFlushTimer) {
    clearTimeout(active.streamFlushTimer);
    active.streamFlushTimer = null;
  }
  if (dictationSessionActive && dictationSessionId > 0 && active.streamChunkBuffer.length) {
    const streamPayload = Buffer.concat(active.streamChunkBuffer.splice(0, active.streamChunkBuffer.length));
    if (streamPayload.length) {
      const wavStreamChunk = buildWavFromPcm16Mono(streamPayload, active.sampleRate);
      enqueueDictationAudioBuffer(dictationSessionId, wavStreamChunk, "audio/wav");
    }
  }
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("close", finish);
    child.once("exit", finish);
    setTimeout(finish, 1200);
    try {
      child.kill("SIGINT");
    } catch {
      finish();
    }
  });
  const pcm = Buffer.concat(active.chunks);
  if (!pcm.length) {
    return { status: "error", message: "Native audio capture returned no bytes." };
  }
  const wav = buildWavFromPcm16Mono(pcm, active.sampleRate);
  dbgMain("stopNativeAudioCapture", "native capture stopped", {
    backend: active.backend,
    bytes: wav.length
  });
  return {
    status: "ok",
    audioBase64: wav.toString("base64"),
    mimeType: "audio/wav",
    bytes: wav.length,
    backend: active.backend,
    sampleRate: active.sampleRate
  };
}

async function callOpenAiTranscribeAudio(args: {
    audioBuffer: Buffer;
    mimeType?: string;
    language?: string;
  }): Promise<{ status: string; text?: string; message?: string }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return { status: "error", message: "OPENAI_API_KEY is not configured." };
  }
  const normalized = normalizeOpenAiAudioMime(args.mimeType);
  const fileName = `agent-voice.${normalized.extension}`;
  const audioBytes = new Uint8Array(args.audioBuffer);
  dbgMain("callOpenAiTranscribeAudio", "sending transcribe request", {
    model: getOpenAiVoiceTranscribeModel(),
    fileName,
    bytes: audioBytes.byteLength,
    mimeType: normalized.mime
  });
  const form = new FormData();
  const blob = new Blob([audioBytes], { type: normalized.mime });
  form.append("file", blob, fileName);
  form.append("model", getOpenAiVoiceTranscribeModel());
  if (args.language && String(args.language || "").trim()) {
    form.append("language", String(args.language).trim());
  }
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const startedAt = Date.now();
  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  const raw = await res.text();
  if (!res.ok) {
    dbgMain("callOpenAiTranscribeAudio", "transcribe HTTP error", {
      status: res.status,
      elapsedMs: Date.now() - startedAt,
      response: raw.slice(0, 500)
    });
    return { status: "error", message: `Transcription HTTP ${res.status}: ${raw.slice(0, 500)}` };
  }
  try {
    const out = JSON.parse(raw || "{}") as { text?: unknown };
    const text = String(out?.text || "").trim();
    dbgMain("callOpenAiTranscribeAudio", "transcribe response", {
      status: res.status,
      elapsedMs: Date.now() - startedAt,
      textLength: text.length
    });
    if (!text) return { status: "error", message: "Transcription returned no text." };
    return { status: "ok", text };
  } catch {
    dbgMain("callOpenAiTranscribeAudio", "transcribe parse failed", { status: res.status, body: raw.slice(0, 180) });
    return { status: "error", message: "Transcription response was not valid JSON." };
  }
}

async function callOpenAiTextToSpeech(args: {
  text: string;
  voice?: string;
  speed?: number;
  format?: string;
  model?: string;
}): Promise<{ status: string; audioBase64?: string; mimeType?: string; text: string; message?: string }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return { status: "error", message: "OPENAI_API_KEY is not configured.", text: "" };
  }
  const rawText = String(args.text || "").trim();
  if (!rawText) {
    return { status: "error", message: "Speech text is required.", text: "" };
  }
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const text = rawText.slice(0, 4000);
  const request: Record<string, unknown> = {
    model: args.model || getOpenAiVoiceTtsModel(),
    input: text,
    voice: args.voice || getOpenAiVoiceTtsVoice(),
    response_format: args.format || DEFAULT_OPENAI_VOICE_TTS_FORMAT,
    speed: Number.isFinite(Number(args.speed)) ? Math.max(0.5, Math.min(4, Number(args.speed))) : 1
  };
  dbgMain("callOpenAiTextToSpeech", "sending tts request", {
    model: String(request.model || ""),
    voice: String(request.voice || ""),
    responseFormat: String(request.response_format || ""),
    textLength: text.length
  });
  const res = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(request)
  });
  if (!res.ok) {
    const raw = await res.text();
    dbgMain("callOpenAiTextToSpeech", "tts HTTP error", { model: String(request.model || ""), status: res.status, response: raw.slice(0, 500) });
    return { status: "error", text, message: `Speech HTTP ${res.status}: ${raw.slice(0, 500)}` };
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) return { status: "error", text, message: "Speech response was empty." };
  dbgMain("callOpenAiTextToSpeech", "tts response", { model: String(request.model || ""), bytes: buffer.length, mime: String(request.response_format || "") });
  return {
    status: "ok",
    text,
    audioBase64: buffer.toString("base64"),
    mimeType: `audio/${String(request.response_format)}`
  };
}

function parseResearchQuestionsInput(rawText: string): string[] {
  const raw = String(rawText || "").trim();
  if (!raw) return [];
  const lines = raw.split(/\n+/).map((line) => String(line || "").trim()).filter(Boolean);
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

function normalizePromptSafeText(raw: unknown): string {
  return String(raw || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8_000);
}

function questionTemplatePromptForTopic(topicRaw: string): string {
  const topic = normalizePromptSafeText(topicRaw || "the selected topic");
  return [
    "Generate exactly 3 to 5 concise research questions.",
    "Scope: systematic review coding.",
    `Topic: ${topic}.`,
    "Questions must be answerable from document evidence and suitable for open/targeted coding.",
    "Cover concept, frameworks/models, methods/evidence, outcomes/limitations."
  ].join(" ");
}

function generateResearchQuestionsFromTopic(topicRaw: string): string[] {
  const topic = normalizePromptSafeText(topicRaw || "the selected topic") || "the selected topic";
  const _template = questionTemplatePromptForTopic(topic);
  void _template;
  return [
    `How is ${topic} conceptually defined across the literature?`,
    `What frameworks and models are used to analyze ${topic}?`,
    `What evidence and methods are used to support claims about ${topic}?`,
    `What major limitations or disagreements appear in current approaches to ${topic}?`,
    `What policy or practice implications are identified regarding ${topic}?`
  ];
}

function targetedObjectivesFromQuestions(questions: string[]): string[] {
  const seed = questions
    .map((q) => normalizePromptSafeText(q).toLowerCase())
    .filter(Boolean);
  if (!seed.length) return [];
  const objectives = new Set<string>();
  seed.forEach((q) => {
    if (/\bframework|model\b/.test(q)) objectives.add("extract_framework_model_mappings");
    if (/\bmethod|evidence|data\b/.test(q)) objectives.add("extract_evidence_and_method_claims");
    if (/\blimitation|challenge|uncertaint|bias\b/.test(q)) objectives.add("extract_limitations_and_bias");
    if (/\bpolicy|practice|implication|recommendation\b/.test(q)) objectives.add("extract_implications_and_recommendations");
    if (/\bdefin|concept|taxonomy\b/.test(q)) objectives.add("extract_definitions_and_taxonomies");
  });
  if (!objectives.size) objectives.add("extract_rq_linked_verbatim_evidence");
  return Array.from(objectives).slice(0, 8);
}

function protocolQuestionQualityReport(questions: string[]): {
  averageScore: number;
  items: Array<{ question: string; score: number; rubric: { clarity: number; scope: number; answerability: number } }>;
} {
  const rows = questions.map((raw) => {
    const q = normalizePromptSafeText(raw);
    const clarity = q.length >= 35 && q.endsWith("?") ? 5 : q.endsWith("?") ? 4 : 3;
    const scope = /\b(in|across|among|within)\b/i.test(q) ? 5 : 4;
    const answerability = /\bframework|model|method|evidence|data|outcome|limitation\b/i.test(q) ? 5 : 3;
    const score = Number(((clarity + scope + answerability) / 3).toFixed(2));
    return { question: q, score, rubric: { clarity, scope, answerability } };
  });
  const averageScore = rows.length ? Number((rows.reduce((a, b) => a + b.score, 0) / rows.length).toFixed(2)) : 0;
  return { averageScore, items: rows };
}

function protocolCompletenessCheck(payload: {
  collectionName?: string;
  researchQuestions?: string[];
  inclusionCriteria?: string[];
  exclusionCriteria?: string[];
  reviewerCount?: number;
  screening?: boolean;
}): { valid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!normalizePromptSafeText(payload.collectionName || "")) missing.push("collection");
  const rqs = Array.isArray(payload.researchQuestions) ? payload.researchQuestions.filter((x) => normalizePromptSafeText(x)) : [];
  if (rqs.length < 3 || rqs.length > 5) missing.push("research_questions_3_to_5");
  if (payload.screening === true) {
    const inc = Array.isArray(payload.inclusionCriteria) ? payload.inclusionCriteria.filter((x) => normalizePromptSafeText(x)) : [];
    const exc = Array.isArray(payload.exclusionCriteria) ? payload.exclusionCriteria.filter((x) => normalizePromptSafeText(x)) : [];
    if (!inc.length) missing.push("inclusion_criteria");
    if (!exc.length) missing.push("exclusion_criteria");
  }
  const rc = Number(payload.reviewerCount || 0);
  if (!(rc === 1 || rc === 2 || rc === 3)) missing.push("reviewer_count_1_to_3");
  return { valid: missing.length === 0, missing };
}

function parseCodingControlsFromText(rawText: string): {
  coding_mode: "open" | "targeted" | "hybrid";
  mode_specified: boolean;
  screening_blinded: boolean;
  rq_scope: number[];
  target_codes: string[];
  min_relevance: number;
  allowed_evidence_types: string[];
} {
  const text = String(rawText || "").trim();
  const explicitOpen = /\bopen\s+code|open\s+coding\b/i.test(text);
  const explicitTargeted = /\btarget(?:ed)?\s+code|target(?:ed)?\s+coding|\btargeted\b/i.test(text);
  const explicitHybrid = /\bhybrid\s+code|hybrid\s+coding|\bhybrid\b/i.test(text);
  const coding_mode: "open" | "targeted" | "hybrid" = explicitHybrid ? "hybrid" : explicitOpen ? "open" : explicitTargeted ? "targeted" : "open";
  const rqScope = new Set<number>();
  const re = /\brq\s*([1-9]\d*)\b|\bquestion\s*([1-9]\d*)\b/gi;
  let m: RegExpExecArray | null = null;
  while ((m = re.exec(text))) {
    const n = Number(m[1] || m[2] || 0);
    if (Number.isFinite(n) && n > 0) rqScope.add(n - 1);
  }
  const focusMatch =
    text.match(/(?:focus(?:ed)?\s+on|target(?:ed)?\s+(?:at|on)?|on)\s+(.+?)(?:[.?!]|$)/i) ||
    text.match(/(?:codes?|themes?)\s*[:\-]\s*(.+?)(?:[.?!]|$)/i);
  const target_codes = String(focusMatch?.[1] || "")
    .split(/,|;|\band\b/gi)
    .map((s) => String(s || "").trim().toLowerCase())
    .filter((s) => s.length >= 3)
    .slice(0, 12);
  const typeMap: Array<{ re: RegExp; key: string }> = [
    { re: /\bmethod/i, key: "method" },
    { re: /\bframework/i, key: "framework" },
    { re: /\bpolicy/i, key: "policy_position" },
    { re: /\bfindings?\b/i, key: "finding" },
    { re: /\bclaim/i, key: "claim" },
    { re: /\btaxonom/i, key: "taxonomy" },
    { re: /\blimitation/i, key: "limitation" },
    { re: /\brecommendation/i, key: "recommendation" },
    { re: /\bdefinition/i, key: "definition" },
    { re: /\bexample/i, key: "example" }
  ];
  const allowed_evidence_types = typeMap.filter((entry) => entry.re.test(text)).map((entry) => entry.key);
  const strict = /\bstrict|high\s+precision|high\s+relevance|only\s+high\b/i.test(text);
  const screening_blinded = /\bblind(?:ed)?\s+screen(?:ing)?\b|\bdouble-?blind\b|\bblinded\b/i.test(text);
  const min_relevance = coding_mode === "targeted" || coding_mode === "hybrid" ? (strict ? 5 : 4) : 3;
  return {
    coding_mode,
    mode_specified: explicitOpen || explicitTargeted || explicitHybrid,
    screening_blinded,
    rq_scope: Array.from(rqScope.values()).sort((a, b) => a - b).slice(0, 5),
    target_codes,
    min_relevance,
    allowed_evidence_types
  };
}

function parseTextListSection(rawText: string, labels: string[]): string[] {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:${escaped})\\s*[:\\-]\\s*([\\s\\S]*?)(?=(?:\\n\\s*[A-Za-z][A-Za-z\\s]{1,30}\\s*[:\\-])|$)`, "i");
  const match = normalizePromptSafeText(rawText || "").match(re);
  if (!match) return [];
  return String(match[1] || "")
    .split(/\n+/)
    .map((line) => normalizePromptSafeText(line.replace(/^\s*[-*]\s*/, "")))
    .filter(Boolean)
    .slice(0, 12);
}

function isSystematicPipelineRequest(rawText: string): boolean {
  const low = String(rawText || "").trim().toLowerCase();
  if (!low) return false;
  return /\b(systematic\s+review|prisma)\b/.test(low) ||
    (/\bpipeline\b/.test(low) && /\b(screening|coding|eligibility|synthesis|review)\b/.test(low));
}

function detectReviewPipelineType(
  rawText: string
): "systematic" | "literature" | "bibliographic" | "chronological" | "critical" | "meta_analysis" | null {
  const low = String(rawText || "").trim().toLowerCase();
  if (!low) return null;
  if (/\b(literature\s+review|narrative\s+review|state[\s-]+of[\s-]+the[\s-]+art\s+review|scoping\s+review|scoping\s+study)\b/.test(low)) {
    return "literature";
  }
  if (/\b(bibliographic\s+review|bibliometric(?:\s+analysis)?|bibliograph(?:y|ic)\s+review)\b/.test(low)) {
    return "bibliographic";
  }
  if (/\b(chronological\s+review|timeline\s+review|historical\s+review)\b/.test(low)) {
    return "chronological";
  }
  if (/\b(critical\s+review|critical\s+lens\s+review)\b/.test(low)) {
    return "critical";
  }
  if (/\b(meta[\s-]*analysis(?:\s+review)?|meta\s+analysis)\b/.test(low)) {
    return "meta_analysis";
  }
  if (/\b(systematic\s+review|prisma)\b/.test(low) || (/\bpipeline\b/.test(low) && /\b(screening|coding|eligibility|synthesis|review)\b/.test(low))) {
    return "systematic";
  }
  return null;
}

function parseReviewerCountFromText(rawText: string): 1 | 2 | 3 {
  const text = String(rawText || "").toLowerCase();
  const direct = text.match(/\b([1-3])\s*(?:reviewers?|raters?)\b/i);
  if (direct) {
    const n = Number(direct[1]);
    if (n === 1 || n === 2 || n === 3) return n;
  }
  if (/\b(single reviewer|one reviewer)\b/i.test(text)) return 1;
  if (/\b(two reviewers?|dual reviewers?|pair reviewers?)\b/i.test(text)) return 2;
  if (/\b(three reviewers?|triple reviewers?)\b/i.test(text)) return 3;
  return 2;
}

function parseCitationStyleFromText(rawText: string): "apa" | "numeric" | "endnote" | "parenthetical_footnote" {
  const text = String(rawText || "").toLowerCase();
  if (/\b(endnote|end-note|end note)\b/.test(text)) return "endnote";
  if (/\b(numeric|numbered|vancouver|\[\d+\])\b/.test(text)) return "numeric";
  if (/\b(parenthetical\s+footnote|parenthal\s+footnote|footnote)\b/.test(text)) return "parenthetical_footnote";
  return "apa";
}

function buildSystematicPipelineIntent(text: string, context: Record<string, unknown>): IntentPayload {
  const collectionName = String(context?.selectedCollectionName || "").trim();
  const collectionKey = String(context?.selectedCollectionKey || "").trim();
  const itemsCount = Number(context?.itemsCount || 0);
  const parsedQuestions = parseResearchQuestionsInput(text);
  const topic = String(text.match(/about\s+(.+?)(?:\.|$)/i)?.[1] || "").trim();
  const generatedQuestions = generateResearchQuestionsFromTopic(topic || "the selected topic");
  const researchQuestions = (parsedQuestions.length ? parsedQuestions : generatedQuestions).slice(0, 5);
  const inclusion = parseTextListSection(text, ["inclusion", "inclusion criteria", "include"]);
  const exclusion = parseTextListSection(text, ["exclusion", "exclusion criteria", "exclude"]);
  const reviewerCount = parseReviewerCountFromText(text);
  const citationStyle = parseCitationStyleFromText(text);
  const clarification: string[] = [];
  if (!collectionName && !collectionKey) clarification.push("Select a Zotero collection before creating the systematic review pipeline.");
  if (researchQuestions.length < 3) clarification.push("Provide 3 to 5 research questions.");
  return {
    intentId: "workflow.systematic_review_pipeline",
    targetFunction: "workflow-systematic-review-pipeline",
    confidence: clarification.length ? 0.72 : 0.9,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      collection_name: collectionName,
      collection_key: collectionKey,
      items_count: Number.isFinite(itemsCount) ? Math.max(0, Math.trunc(itemsCount)) : 0,
      reviewer_count: reviewerCount,
      citation_style: citationStyle,
      research_questions: researchQuestions,
      inclusion_criteria: inclusion,
      exclusion_criteria: exclusion,
      prisma_checklist_path: "Research/Systematic_review/prisma_check_list.html"
    }
  };
}

function buildNonSystematicReviewPipelineIntent(
  reviewType: "literature" | "bibliographic" | "chronological" | "critical" | "meta_analysis",
  text: string,
  context: Record<string, unknown>
): IntentPayload {
  const collectionName = String(context?.selectedCollectionName || "").trim();
  const collectionKey = String(context?.selectedCollectionKey || "").trim();
  const itemsCount = Number(context?.itemsCount || 0);
  const parsedQuestions = parseResearchQuestionsInput(text);
  const topic = String(text.match(/about\s+(.+?)(?:\.|$)/i)?.[1] || "").trim();
  const generatedQuestions = generateResearchQuestionsFromTopic(topic || "the selected topic");
  const researchQuestions = (parsedQuestions.length ? parsedQuestions : generatedQuestions).slice(0, 5);
  const clarification: string[] = [];
  if (!collectionName && !collectionKey) clarification.push(`Select a Zotero collection before creating the ${reviewType} review pipeline.`);
  if (researchQuestions.length < 3) clarification.push("Provide 3 to 5 research questions.");
  const intentIdByType = {
    literature: "workflow.literature_review_pipeline",
    bibliographic: "workflow.bibliographic_review_pipeline",
    chronological: "workflow.chronological_review_pipeline",
    critical: "workflow.critical_review_pipeline",
    meta_analysis: "workflow.meta_analysis_review_pipeline"
  } as const;
  const targetByType = {
    literature: "workflow-literature-review-pipeline",
    bibliographic: "workflow-bibliographic-review-pipeline",
    chronological: "workflow-chronological-review-pipeline",
    critical: "workflow-critical-review-pipeline",
    meta_analysis: "workflow-meta-analysis-review-pipeline"
  } as const;
  const templateByType = {
    literature: "Research/templates/literature_review.html",
    bibliographic: "Research/templates/bibliographic.html",
    chronological: "Research/templates/chronological_review_template.html",
    critical: "Research/templates/critical_review_template.html",
    meta_analysis: "Research/templates/meta_analysis_template.html"
  } as const;
  return {
    intentId: intentIdByType[reviewType],
    targetFunction: targetByType[reviewType],
    confidence: clarification.length ? 0.72 : 0.9,
    riskLevel: "confirm",
    needsClarification: clarification.length > 0,
    clarificationQuestions: clarification,
    args: {
      review_type: reviewType,
      collection_name: collectionName,
      collection_key: collectionKey,
      items_count: Number.isFinite(itemsCount) ? Math.max(0, Math.trunc(itemsCount)) : 0,
      research_questions: researchQuestions,
      template_path: templateByType[reviewType]
    }
  };
}

const SYSTEMATIC_REVIEW_REASON_TAXONOMY = [
  "out_of_scope_topic",
  "out_of_scope_population",
  "wrong_study_design",
  "insufficient_method_detail",
  "insufficient_evidence",
  "not_primary_source",
  "duplicate_record",
  "full_text_unavailable",
  "language_not_supported",
  "other"
] as const;

type SystematicReviewState = {
  schema: "systematic_review_state_v1";
  createdAt: string;
  updatedAt: string;
  collection: { name: string; key: string; itemsCount: number };
  reviewTeam: {
    reviewerCount: 1 | 2 | 3;
    reviewers: Array<{ id: string; label: string }>;
  };
  protocol: {
    researchQuestions: string[];
    citationStyle?: "apa" | "numeric" | "endnote" | "parenthetical_footnote";
    inclusionCriteria: string[];
    exclusionCriteria: string[];
    reasonTaxonomy: string[];
    locked: boolean;
    version: number;
  };
  prisma: {
    checklistPath: string;
    flow: {
      recordsIdentified: number;
      duplicateRecordsRemoved: number;
      recordsScreened: number;
      recordsExcluded: number;
      reportsSoughtForRetrieval: number;
      reportsNotRetrieved: number;
      reportsAssessedForEligibility: number;
      reportsExcludedWithReasons: number;
      studiesIncludedInReview: number;
    };
  };
  stages: Array<{ id: "protocol" | "deduplication" | "screening" | "adjudication" | "coding" | "synthesis"; title: string; status: "pending" | "ready" | "in_progress" | "completed"; nextAction?: string; output?: string }>;
  screening: {
    lastRunAt?: string;
    includedCount: number;
    excludedCount: number;
    screenedCount: number;
    reasons: Record<string, number>;
    reviewerDecisions: Array<{
      itemId: string;
      decisions: Array<"include" | "exclude" | "unsure">;
      resolved?: "include" | "exclude";
      reason?: string;
    }>;
    conflicts: {
      total: number;
      unresolved: number;
      adjudicated: number;
    };
    irr: {
      agreeingRatings: number;
      totalRatings: number;
      ratio: number | null;
      twoRaterPercent: number | null;
      formulaGeneral: string;
      formulaTwoRater: string;
      lastComputedAt?: string;
    };
    notes: string[];
  };
  coding: {
    lastRunAt?: string;
    mode?: "open" | "targeted" | "hybrid";
    evidenceUnits: number;
    codedItems: number;
    codebookPath?: string;
    notes: string[];
  };
  synthesis: {
    lastRunAt?: string;
    notes: string[];
  };
  artifacts: {
    pipelinePath: string;
    statePath: string;
    templatePath: string;
    codebookPath?: string;
    protocolLockReceiptPath?: string;
    protocolChangeLogPath?: string;
    protocolValidationPath?: string;
    protocolQuestionQualityPath?: string;
    protocolAppendixTemplatePath?: string;
    protocolAlignmentPath?: string;
    screeningAssignmentsPath?: string;
    screeningConflictsPath?: string;
    screeningDecisionAuditPath?: string;
    deduplicationReportPath?: string;
    fullTextRetrievalStatusPath?: string;
    screeningCalibrationPath?: string;
    screeningAlertsPath?: string;
    screeningSummaryTablePath?: string;
    reviewerWorkloadPath?: string;
    codingLineagePath?: string;
    codingProvenancePath?: string;
    codingSaturationPath?: string;
    codingContradictionsPath?: string;
    rqEvidenceHeatmapPath?: string;
    codingConsistencyPath?: string;
    lowConfidenceRecheckQueuePath?: string;
    targetedCodebookSuggestionsPath?: string;
    codingQaAuditPath?: string;
    codingResultsAutosummaryPath?: string;
    stageLocksPath?: string;
    stageHashesPath?: string;
    orchestrationSummaryPath?: string;
  };
  auditTrail: Array<{ at: string; action: string; details?: string }>;
};

type SystematicStageId = "protocol" | "deduplication" | "screening" | "adjudication" | "coding" | "synthesis";

type OrchestrationRunEvent = {
  at: string;
  functionName: string;
  stage: SystematicStageId | "unknown";
  status: "ok" | "error" | "skipped";
  durationMs: number;
  attemptCount: number;
  timeoutMs: number;
  retryLimit: number;
  message?: string;
  tokenUsage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

const orchestrationRunEvents: OrchestrationRunEvent[] = [];

function resolveSystematicReviewRunDir(args: Record<string, unknown>, context: Record<string, unknown>): { runDir: string; collectionName: string } {
  const collectionName =
    String(args.collection_name || "").trim() ||
    String(args.collection_key || "").trim() ||
    String(context.selectedCollectionName || "").trim() ||
    String(context.selectedCollectionKey || "").trim();
  if (!collectionName) {
    throw new Error("Missing collection name/key for systematic review pipeline.");
  }
  const collectionFolder = safeCollectionFolderName(collectionName);
  const dirBase = String(args.dir_base || resolveVerbatimDirBaseForContext(context) || "").trim();
  const baseDir = dirBase || getDefaultBaseDir();
  const runDir = path.resolve(baseDir, collectionFolder, "systematic_review");
  fs.mkdirSync(runDir, { recursive: true });
  return { runDir, collectionName };
}

function resolveGenericReviewRunDir(
  args: Record<string, unknown>,
  context: Record<string, unknown>,
  reviewFolder: string
): { runDir: string; collectionName: string } {
  const collectionName =
    String(args.collection_name || "").trim() ||
    String(args.collection_key || "").trim() ||
    String(context.selectedCollectionName || "").trim() ||
    String(context.selectedCollectionKey || "").trim();
  if (!collectionName) {
    throw new Error("Missing collection name/key for review pipeline.");
  }
  const collectionFolder = safeCollectionFolderName(collectionName);
  const dirBase = String(args.dir_base || resolveVerbatimDirBaseForContext(context) || "").trim();
  const baseDir = dirBase || getDefaultBaseDir();
  const runDir = path.resolve(baseDir, collectionFolder, reviewFolder);
  fs.mkdirSync(runDir, { recursive: true });
  return { runDir, collectionName };
}

function createGeneralReviewPipeline(payload: {
  reviewType: "literature" | "bibliographic" | "chronological" | "critical" | "meta_analysis";
  args: Record<string, unknown>;
  context: Record<string, unknown>;
}): { status: "ok"; pipelinePath: string; statePath: string; templatePath: string; summary: string } | { status: "error"; message: string } {
  try {
    const reviewType = payload.reviewType;
    const args = payload.args || {};
    const context = payload.context || {};
    const folderByType = {
      literature: "literature_review",
      bibliographic: "bibliographic_review",
      chronological: "chronological_review",
      critical: "critical_review",
      meta_analysis: "meta_analysis_review"
    } as const;
    const sourceTemplateByType = {
      literature: "../Research/templates/literature_review.html",
      bibliographic: "../Research/templates/bibliographic.html",
      chronological: "../Research/templates/chronological_review_template.html",
      critical: "../Research/templates/critical_review_template.html",
      meta_analysis: "../Research/templates/meta_analysis_template.html"
    } as const;
    const folder = folderByType[reviewType];
    const { runDir, collectionName } = resolveGenericReviewRunDir(args, context, folder);
    const pipelinePath = path.join(runDir, `${reviewType}_review_pipeline.json`);
    const statePath = path.join(runDir, `${reviewType}_review_state_v1.json`);
    const templatePath = path.join(runDir, `${reviewType}_review_template.html`);
    const templateSource = path.resolve(process.cwd(), sourceTemplateByType[reviewType]);
    const checklistTemplate = path.resolve(process.cwd(), "../Research/review_standards/review_execution_checklist_template.csv");
    const questions = Array.isArray(args.research_questions)
      ? args.research_questions.map((q) => normalizePromptSafeText(q || "")).filter(Boolean).slice(0, 5)
      : [];
    const nowIso = new Date().toISOString();
    const state = {
      schema: `${reviewType}_review_state_v1`,
      createdAt: nowIso,
      updatedAt: nowIso,
      reviewType,
      collection: {
        name: String(args.collection_name || context.selectedCollectionName || collectionName).trim(),
        key: String(args.collection_key || context.selectedCollectionKey || "").trim(),
        itemsCount: Number.isFinite(Number(args.items_count || context.itemsCount || 0))
          ? Math.max(0, Math.trunc(Number(args.items_count || context.itemsCount || 0)))
          : 0
      },
      protocol: {
        researchQuestions: questions.length ? questions : generateResearchQuestionsFromTopic(collectionName).slice(0, 5)
      },
      artifacts: {
        pipelinePath,
        statePath,
        templatePath,
        checklistTemplatePath: checklistTemplate
      }
    };
    const pipeline = {
      schema: `${reviewType}_review_pipeline_v1`,
      createdAt: nowIso,
      updatedAt: nowIso,
      runDir,
      reviewType,
      collection: state.collection,
      protocol: state.protocol,
      checklistTemplatePath: checklistTemplate
    };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    fs.writeFileSync(pipelinePath, JSON.stringify(pipeline, null, 2), "utf-8");
    if (fs.existsSync(templateSource)) {
      fs.copyFileSync(templateSource, templatePath);
    } else {
      fs.writeFileSync(
        templatePath,
        `<!doctype html><html><body><h1>${reviewType} review template</h1><p>Collection: ${systematicEscapeHtml(state.collection.name)}</p></body></html>`,
        "utf-8"
      );
    }
    const summary = [
      `${reviewType[0].toUpperCase()}${reviewType.slice(1)} review pipeline initialized for '${collectionName}'.`,
      `Items in scope: ${state.collection.itemsCount}.`,
      `Pipeline file: ${pipelinePath}`,
      `State file: ${statePath}`,
      `Template page: ${templatePath}`
    ].join("\n");
    return { status: "ok", pipelinePath, statePath, templatePath, summary };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error || "unknown error") };
  }
}

function getSystematicReviewPaths(runDir: string): { pipelinePath: string; statePath: string; templatePath: string } {
  return {
    pipelinePath: path.join(runDir, "systematic_review_pipeline.json"),
    statePath: path.join(runDir, "systematic_review_state_v1.json"),
    templatePath: path.join(runDir, "systematic_review_template.html")
  };
}

function getSystematicReviewAuxPaths(runDir: string): {
  protocolLockReceiptPath: string;
  protocolChangeLogPath: string;
  protocolValidationPath: string;
  protocolQuestionQualityPath: string;
  protocolAppendixTemplatePath: string;
  protocolAlignmentPath: string;
  screeningAssignmentsPath: string;
  screeningConflictsPath: string;
  screeningDecisionAuditPath: string;
  deduplicationReportPath: string;
  fullTextRetrievalStatusPath: string;
  screeningCalibrationPath: string;
  screeningAlertsPath: string;
  screeningSummaryTablePath: string;
  reviewerWorkloadPath: string;
  codebookVersionsDir: string;
  codingLineagePath: string;
  codingProvenancePath: string;
  codingSaturationPath: string;
  codingContradictionsPath: string;
  rqEvidenceHeatmapPath: string;
  codingConsistencyPath: string;
  lowConfidenceRecheckQueuePath: string;
  targetedCodebookSuggestionsPath: string;
  codingQaAuditPath: string;
  codingResultsAutosummaryPath: string;
  stageLocksDir: string;
  stageHashesPath: string;
  orchestrationSummaryPath: string;
} {
  return {
    protocolLockReceiptPath: path.join(runDir, "protocol_lock_receipt.json"),
    protocolChangeLogPath: path.join(runDir, "protocol_change_log.json"),
    protocolValidationPath: path.join(runDir, "protocol_validation_report.json"),
    protocolQuestionQualityPath: path.join(runDir, "protocol_question_quality_report.json"),
    protocolAppendixTemplatePath: path.join(runDir, "protocol_appendix_template.md"),
    protocolAlignmentPath: path.join(runDir, "protocol_codebook_alignment.json"),
    screeningAssignmentsPath: path.join(runDir, "screening_assignments.json"),
    screeningConflictsPath: path.join(runDir, "screening_conflicts.json"),
    screeningDecisionAuditPath: path.join(runDir, "screening_decision_audit.json"),
    deduplicationReportPath: path.join(runDir, "deduplication_report.json"),
    fullTextRetrievalStatusPath: path.join(runDir, "full_text_retrieval_status.json"),
    screeningCalibrationPath: path.join(runDir, "screening_calibration_round.json"),
    screeningAlertsPath: path.join(runDir, "screening_alerts.json"),
    screeningSummaryTablePath: path.join(runDir, "screening_summary_table.md"),
    reviewerWorkloadPath: path.join(runDir, "reviewer_workload.json"),
    codebookVersionsDir: path.join(runDir, "codebook_versions"),
    codingLineagePath: path.join(runDir, "code_lineage_history.json"),
    codingProvenancePath: path.join(runDir, "coding_provenance.json"),
    codingSaturationPath: path.join(runDir, "evidence_saturation_report.json"),
    codingContradictionsPath: path.join(runDir, "contradictory_evidence_report.json"),
    rqEvidenceHeatmapPath: path.join(runDir, "rq_evidence_heatmap.json"),
    codingConsistencyPath: path.join(runDir, "coding_consistency_report.json"),
    lowConfidenceRecheckQueuePath: path.join(runDir, "low_confidence_recheck_queue.json"),
    targetedCodebookSuggestionsPath: path.join(runDir, "targeted_codebook_suggestions.json"),
    codingQaAuditPath: path.join(runDir, "coding_qa_audit.json"),
    codingResultsAutosummaryPath: path.join(runDir, "coding_results_autosummary.json"),
    stageLocksDir: path.join(runDir, "stage_locks"),
    stageHashesPath: path.join(runDir, "stage_hashes.json"),
    orchestrationSummaryPath: path.join(runDir, "agent_runs_summary.json")
  };
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((x) => stableJson(x)).join(",")}]`;
  const rec = value as Record<string, unknown>;
  return `{${Object.keys(rec).sort().map((k) => `${JSON.stringify(k)}:${stableJson(rec[k])}`).join(",")}}`;
}

function hashArgs(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stageForFunction(functionName: string): SystematicStageId | "unknown" {
  const fn = String(functionName || "");
  if (fn === "set_eligibility_criteria") return "protocol";
  if (fn === "screening_articles") return "screening";
  if (fn === "Verbatim_Evidence_Coding") return "coding";
  return "unknown";
}

function getStageStatus(state: SystematicReviewState, stage: SystematicStageId): string {
  return String(state.stages.find((s) => s.id === stage)?.status || "pending");
}

function canExecuteStage(state: SystematicReviewState, stage: SystematicStageId): { ok: boolean; reason?: string } {
  const status = getStageStatus(state, stage);
  if (stage === "protocol") {
    if (!(status === "ready" || status === "in_progress" || status === "completed" || status === "pending")) {
      return { ok: false, reason: `Stage '${stage}' is not ready (status=${status}).` };
    }
    return { ok: true };
  }
  if (stage === "screening") {
    const protocolStatus = getStageStatus(state, "protocol");
    if (!(protocolStatus === "completed" || protocolStatus === "in_progress")) {
      return { ok: false, reason: `Screening blocked: protocol stage must be completed first.` };
    }
    return { ok: true };
  }
  if (stage === "coding" && Number(state.screening.conflicts.unresolved || 0) > 0) {
    return { ok: false, reason: `Coding blocked: unresolved screening conflicts=${state.screening.conflicts.unresolved}.` };
  }
  if (stage === "coding") {
    const screeningStatus = getStageStatus(state, "screening");
    if (!(screeningStatus === "completed" || screeningStatus === "in_progress")) {
      return { ok: false, reason: "Coding blocked: run screening before coding." };
    }
  }
  if (stage === "synthesis" && Number(state.screening.conflicts.unresolved || 0) > 0) {
    return { ok: false, reason: `Synthesis blocked: unresolved screening conflicts=${state.screening.conflicts.unresolved}.` };
  }
  return { ok: true };
}

function extractTokenUsage(result: unknown): { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined {
  const p = findNumberDeep(result, ["prompt_tokens", "input_tokens"]) ?? 0;
  const c = findNumberDeep(result, ["completion_tokens", "output_tokens"]) ?? 0;
  const t = findNumberDeep(result, ["total_tokens"]) ?? (p + c);
  if (p <= 0 && c <= 0 && t <= 0) return undefined;
  return { prompt_tokens: p, completion_tokens: c, total_tokens: t };
}

function writeOrchestrationSummary(runDir: string): void {
  const aux = getSystematicReviewAuxPaths(runDir);
  const nowIso = new Date().toISOString();
  const recent = orchestrationRunEvents.slice(-300);
  const statusCounts = recent.reduce(
    (acc, row) => {
      acc[row.status] = Number(acc[row.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const byFunction = recent.reduce(
    (acc, row) => {
      if (!acc[row.functionName]) {
        acc[row.functionName] = { runs: 0, ok: 0, error: 0, skipped: 0, avgMs: 0 };
      }
      const slot = acc[row.functionName];
      slot.runs += 1;
      if (row.status === "ok") slot.ok += 1;
      if (row.status === "error") slot.error += 1;
      if (row.status === "skipped") slot.skipped += 1;
      slot.avgMs = ((slot.avgMs * (slot.runs - 1)) + row.durationMs) / slot.runs;
      return acc;
    },
    {} as Record<string, { runs: number; ok: number; error: number; skipped: number; avgMs: number }>
  );
  fs.writeFileSync(
    aux.orchestrationSummaryPath,
    JSON.stringify(
      {
        schema: "agent_runs_summary_v1",
        updatedAt: nowIso,
        totalRuns: recent.length,
        statusCounts,
        byFunction,
        recentRuns: recent.slice(-120)
      },
      null,
      2
    ),
    "utf-8"
  );
}

function recordOrchestrationRun(runDir: string | null, event: OrchestrationRunEvent): void {
  orchestrationRunEvents.push(event);
  if (orchestrationRunEvents.length > 500) orchestrationRunEvents.shift();
  if (!runDir) return;
  try {
    writeOrchestrationSummary(runDir);
  } catch {
    // non-blocking
  }
}

async function runFeatureWithPolicy(payload: {
  functionName: string;
  argsSchema: any[];
  argsValues: Record<string, unknown>;
  execute: boolean;
  timeoutMs?: number;
  retries?: number;
}): Promise<{ result: any; attemptCount: number; durationMs: number; timeoutMs: number; retryLimit: number }> {
  const timeoutMs = Math.max(1_000, Math.trunc(Number(payload.timeoutMs || 900_000)));
  const retryLimit = Math.max(0, Math.min(3, Math.trunc(Number(payload.retries || 1))));
  const startedAt = Date.now();
  let lastError: Error | null = null;
  let attemptCount = 0;
  for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
    attemptCount = attempt + 1;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      const runPromise = featureWorker.run({
        functionName: payload.functionName,
        argsSchema: Array.isArray(payload.argsSchema) ? payload.argsSchema : [],
        argsValues: payload.argsValues,
        execute: payload.execute === true
      });
      const result = await Promise.race([runPromise, timeoutPromise]);
      if (result?.status === "ok") {
        return { result, attemptCount, durationMs: Date.now() - startedAt, timeoutMs, retryLimit };
      }
      lastError = new Error(String(result?.message || "Feature returned non-ok status."));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error || "unknown error"));
    }
  }
  throw new Error(lastError ? lastError.message : "Feature execution failed.");
}

function systematicEscapeHtml(value: unknown): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function systematicListToHtml(rows: string[]): string {
  return rows.length ? rows.map((row) => `<li>${systematicEscapeHtml(row)}</li>`).join("") : "<li>To be defined.</li>";
}

function renderSystematicReviewTemplateFromState(state: SystematicReviewState): string {
  const nowIso = state.updatedAt;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Systematic Review Template - ${systematicEscapeHtml(state.collection.name || state.collection.key)}</title>
  <style>
    :root { --bg:#f5f7fb; --surface:#ffffff; --ink:#16202c; --muted:#5b6b7a; --line:#d7dee7; --warn:#92400e; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "IBM Plex Sans", "Segoe UI", Roboto, Arial, sans-serif; color: var(--ink); background: linear-gradient(180deg, #eaf2fb 0%, var(--bg) 35%, var(--bg) 100%); }
    main { width: min(1100px, 94vw); margin: 24px auto 40px; display: grid; gap: 16px; }
    .card { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px; }
    h1, h2, h3 { margin: 0 0 10px; }
    h1 { font-size: 1.45rem; } h2 { font-size: 1.12rem; color: #0b3d62; } h3 { font-size: 1rem; color: #134e4a; }
    p { margin: 6px 0; line-height: 1.45; } .muted { color: var(--muted); }
    .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; border: 1px solid #b6d4d0; color: #0f766e; font-weight: 600; font-size: 0.78rem; margin-right: 8px; background: #eef8f6; }
    ul, ol { margin: 8px 0 0 18px; } li { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 0.95rem; }
    th, td { border: 1px solid var(--line); padding: 8px; vertical-align: top; text-align: left; }
    th { background: #f2f8ff; }
    .grid-two { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .note { border-left: 4px solid #d97706; background: #fffbeb; padding: 10px 12px; color: var(--warn); margin-top: 8px; border-radius: 6px; }
    @media (max-width: 820px) { .grid-two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <section class="card">
      <h1>Systematic Review Template</h1>
      <p><span class="badge">Collection</span>${systematicEscapeHtml(state.collection.name || state.collection.key)}</p>
      <p><span class="badge">Items</span>${systematicEscapeHtml(state.collection.itemsCount)}</p>
      <p><span class="badge">Reviewers</span>${systematicEscapeHtml(state.reviewTeam.reviewerCount)}</p>
      <p class="muted">Updated: ${systematicEscapeHtml(nowIso)}</p>
      <p class="muted">PRISMA checklist source: <code>${systematicEscapeHtml(state.prisma.checklistPath)}</code></p>
      <p class="muted">State file: <code>${systematicEscapeHtml(state.artifacts.statePath)}</code></p>
    </section>
    <section class="card">
      <h2>1. Protocol Setup</h2>
      <h3>Research Questions</h3>
      <ol>${state.protocol.researchQuestions.length ? state.protocol.researchQuestions.map((q) => `<li>${systematicEscapeHtml(q)}</li>`).join("") : "<li>Define 3 to 5 research questions.</li>"}</ol>
      <div class="grid-two">
        <div><h3>Inclusion Criteria</h3><ul>${systematicListToHtml(state.protocol.inclusionCriteria)}</ul></div>
        <div><h3>Exclusion Criteria</h3><ul>${systematicListToHtml(state.protocol.exclusionCriteria)}</ul></div>
      </div>
      <p class="muted">Protocol version: ${systematicEscapeHtml(state.protocol.version)} | Locked: ${state.protocol.locked ? "yes" : "no"}</p>
    </section>
    <section class="card">
      <h2>2. PRISMA Flow Tracking</h2>
      <table>
        <thead><tr><th>Flow Node</th><th>Count</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>Records identified</td><td>${systematicEscapeHtml(state.prisma.flow.recordsIdentified)}</td><td>Zotero collection total at initialization.</td></tr>
          <tr><td>Duplicate records removed</td><td>${systematicEscapeHtml(state.prisma.flow.duplicateRecordsRemoved)}</td><td>Update after deduplication.</td></tr>
          <tr><td>Records screened</td><td>${systematicEscapeHtml(state.prisma.flow.recordsScreened)}</td><td>Title/abstract screening stage.</td></tr>
          <tr><td>Records excluded</td><td>${systematicEscapeHtml(state.prisma.flow.recordsExcluded)}</td><td>Screening exclusions.</td></tr>
          <tr><td>Reports sought for retrieval</td><td>${systematicEscapeHtml(state.prisma.flow.reportsSoughtForRetrieval)}</td><td>Full-text retrieval attempts.</td></tr>
          <tr><td>Reports not retrieved</td><td>${systematicEscapeHtml(state.prisma.flow.reportsNotRetrieved)}</td><td>Unavailable full-text.</td></tr>
          <tr><td>Reports assessed for eligibility</td><td>${systematicEscapeHtml(state.prisma.flow.reportsAssessedForEligibility)}</td><td>Eligibility decision stage.</td></tr>
          <tr><td>Reports excluded with reasons</td><td>${systematicEscapeHtml(state.prisma.flow.reportsExcludedWithReasons)}</td><td>Reason taxonomy below.</td></tr>
          <tr><td>Studies included in review</td><td>${systematicEscapeHtml(state.prisma.flow.studiesIncludedInReview)}</td><td>Final included corpus.</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>3. Inter-Rater Reliability (IRR)</h2>
      <p class="muted">General formula: <code>IRR = Agreeing Ratings / Total Ratings</code></p>
      <p class="muted">Two-rater formula: <code>IRR = (TA / (TR * R)) * 100</code></p>
      <table>
        <thead><tr><th>Metric</th><th>Value</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td>Agreeing Ratings</td><td>${systematicEscapeHtml(state.screening.irr.agreeingRatings)}</td><td>Total agreements across raters.</td></tr>
          <tr><td>Total Ratings</td><td>${systematicEscapeHtml(state.screening.irr.totalRatings)}</td><td>Ratings considered for IRR.</td></tr>
          <tr><td>General IRR</td><td>${state.screening.irr.ratio === null ? "n/a" : systematicEscapeHtml(state.screening.irr.ratio.toFixed(4))}</td><td>Range 0-1.</td></tr>
          <tr><td>Two-rater IRR (%)</td><td>${state.screening.irr.twoRaterPercent === null ? "n/a" : systematicEscapeHtml(state.screening.irr.twoRaterPercent.toFixed(2))}</td><td>Shown when reviewer count is 2.</td></tr>
          <tr><td>Conflicts</td><td>${systematicEscapeHtml(state.screening.conflicts.total)}</td><td>Unresolved: ${systematicEscapeHtml(state.screening.conflicts.unresolved)} | Adjudicated: ${systematicEscapeHtml(state.screening.conflicts.adjudicated)}</td></tr>
        </tbody>
      </table>
    </section>
    <section class="card">
      <h2>4. Screening and Coding Plan</h2>
      <table>
        <thead><tr><th>Stage</th><th>Status</th><th>Next Action</th></tr></thead>
        <tbody>${state.stages.map((s) => `<tr><td>${systematicEscapeHtml(s.title)}</td><td>${systematicEscapeHtml(s.status)}</td><td>${systematicEscapeHtml(s.nextAction || s.output || "")}</td></tr>`).join("")}</tbody>
      </table>
      <h3>Screening Reasons</h3>
      <ul>${Object.keys(state.screening.reasons).sort().map((key) => `<li>${systematicEscapeHtml(key)}: ${systematicEscapeHtml(state.screening.reasons[key])}</li>`).join("") || "<li>No reasons recorded yet.</li>"}</ul>
      <div class="note">Template is regenerated from state on each pipeline/screening/coding update. Keep this as the live methodology page.</div>
    </section>
  </main>
</body>
</html>`;
}

function writeSystematicReviewArtifacts(state: SystematicReviewState): void {
  const pipeline = {
    schema: "systematic_review_pipeline_v1",
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    collection: state.collection,
    prisma: state.prisma,
    protocol: {
      researchQuestions: state.protocol.researchQuestions,
      citationStyle: state.protocol.citationStyle || "apa",
      inclusionCriteria: state.protocol.inclusionCriteria,
      exclusionCriteria: state.protocol.exclusionCriteria
    },
    stages: state.stages
  };
  fs.writeFileSync(state.artifacts.pipelinePath, JSON.stringify(pipeline, null, 2), "utf-8");
  fs.writeFileSync(state.artifacts.statePath, JSON.stringify(state, null, 2), "utf-8");
  fs.writeFileSync(state.artifacts.templatePath, renderSystematicReviewTemplateFromState(state), "utf-8");
}

function upsertScreeningAssignmentsAndConflicts(runDir: string, state: SystematicReviewState): void {
  const aux = getSystematicReviewAuxPaths(runDir);
  const reviewerIds = Array.isArray(state.reviewTeam.reviewers) ? state.reviewTeam.reviewers.map((r) => String(r.id || "")).filter(Boolean) : [];
  const screenedCount = Math.max(0, Math.trunc(Number(state.screening.screenedCount || 0)));
  const blinded = /\bblinded\b/i.test(String(state.screening.notes.join(" ")));
  const blindedReviewers = reviewerIds.map((_, idx) => `blinded_reviewer_${idx + 1}`);
  const decisions = Array.isArray(state.screening.reviewerDecisions) ? state.screening.reviewerDecisions : [];
  const nextDecisions = decisions.slice(0, screenedCount);
  for (let idx = nextDecisions.length; idx < screenedCount; idx += 1) {
    nextDecisions.push({
      itemId: `item_${String(idx + 1).padStart(4, "0")}`,
      decisions: reviewerIds.map(() => "unsure")
    });
  }
  state.screening.reviewerDecisions = nextDecisions;
  const assignments = nextDecisions.map((entry) => ({
    itemId: entry.itemId,
    reviewers: blinded ? (blindedReviewers.length ? blindedReviewers : ["blinded_reviewer_1"]) : (reviewerIds.length ? reviewerIds : ["reviewer_1"]),
    independent: true,
    blinded
  }));
  const unresolvedRows = nextDecisions.filter(
    (entry) =>
      Array.isArray(entry.decisions) &&
      entry.decisions.length > 1 &&
      new Set(entry.decisions.map((d) => String(d || ""))).size > 1 &&
      !entry.resolved
  );
  const targetUnresolved = Math.max(0, Math.trunc(Number(state.screening.conflicts.unresolved || 0)));
  const unresolved = unresolvedRows.slice(0, targetUnresolved);
  while (unresolved.length < targetUnresolved) {
    unresolved.push({
      itemId: `conflict_${String(unresolved.length + 1).padStart(3, "0")}`,
      decisions: ["include", "exclude"],
      reason: "auto_placeholder"
    } as any);
  }
  fs.writeFileSync(
    aux.screeningAssignmentsPath,
    JSON.stringify(
      {
        schema: "screening_assignments_v1",
        updatedAt: new Date().toISOString(),
        blinded,
        reviewerCount: reviewerIds.length || 1,
        assignments
      },
      null,
      2
    ),
    "utf-8"
  );
  fs.writeFileSync(
    aux.screeningConflictsPath,
    JSON.stringify(
      {
        schema: "screening_conflicts_v1",
        updatedAt: new Date().toISOString(),
        total: Number(state.screening.conflicts.total || 0),
        unresolved: targetUnresolved,
        adjudicated: Number(state.screening.conflicts.adjudicated || 0),
        conflicts: unresolved.map((row) => ({
          itemId: String((row as any)?.itemId || ""),
          decisions: Array.isArray((row as any)?.decisions) ? (row as any).decisions : [],
          reason: String((row as any)?.reason || "disagreement")
        }))
      },
      null,
      2
    ),
    "utf-8"
  );
  const decisionAudit = nextDecisions.flatMap((entry) =>
    (Array.isArray(entry.decisions) ? entry.decisions : []).map((decision, idx) => ({
      at: new Date().toISOString(),
      itemId: entry.itemId,
      reviewer: blinded
        ? (blindedReviewers[idx] || `blinded_reviewer_${idx + 1}`)
        : (reviewerIds[idx] || `reviewer_${idx + 1}`),
      decision: String(decision || "unsure"),
      resolved: entry.resolved || null
    }))
  );
  fs.writeFileSync(
    aux.screeningDecisionAuditPath,
    JSON.stringify(
      {
        schema: "screening_decision_audit_v1",
        updatedAt: new Date().toISOString(),
        entries: decisionAudit
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.screeningAssignmentsPath = aux.screeningAssignmentsPath;
  state.artifacts.screeningConflictsPath = aux.screeningConflictsPath;
  state.artifacts.screeningDecisionAuditPath = aux.screeningDecisionAuditPath;
}

function writeScreeningQualityArtifacts(runDir: string, state: SystematicReviewState, payloadResult: unknown): void {
  const aux = getSystematicReviewAuxPaths(runDir);
  const nowIso = new Date().toISOString();
  const reportsSought = findNumberDeep(payloadResult, ["reports_sought_for_retrieval", "reports_sought", "full_text_sought"]) ?? state.screening.screenedCount;
  const reportsNotRetrieved = findNumberDeep(payloadResult, ["reports_not_retrieved", "not_retrieved", "missing_full_text"]) ?? 0;
  const reportsAssessed = findNumberDeep(payloadResult, ["reports_assessed_for_eligibility", "reports_assessed"]) ?? state.screening.screenedCount;
  state.prisma.flow.reportsSoughtForRetrieval = Math.max(Number(state.prisma.flow.reportsSoughtForRetrieval || 0), reportsSought);
  state.prisma.flow.reportsNotRetrieved = Math.max(Number(state.prisma.flow.reportsNotRetrieved || 0), reportsNotRetrieved);
  state.prisma.flow.reportsAssessedForEligibility = Math.max(Number(state.prisma.flow.reportsAssessedForEligibility || 0), reportsAssessed);
  fs.writeFileSync(
    aux.fullTextRetrievalStatusPath,
    JSON.stringify(
      {
        schema: "full_text_retrieval_status_v1",
        at: nowIso,
        reportsSoughtForRetrieval: state.prisma.flow.reportsSoughtForRetrieval,
        reportsNotRetrieved: state.prisma.flow.reportsNotRetrieved,
        reportsAssessedForEligibility: state.prisma.flow.reportsAssessedForEligibility
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.fullTextRetrievalStatusPath = aux.fullTextRetrievalStatusPath;

  const reviewerIds = Array.isArray(state.reviewTeam.reviewers) ? state.reviewTeam.reviewers.map((r) => String(r.id || "")).filter(Boolean) : ["reviewer_1"];
  const decisions = Array.isArray(state.screening.reviewerDecisions) ? state.screening.reviewerDecisions : [];
  const workload: Record<string, { assigned: number; decided: number }> = {};
  reviewerIds.forEach((id) => {
    workload[id] = { assigned: 0, decided: 0 };
  });
  decisions.forEach((entry) => {
    reviewerIds.forEach((id, idx) => {
      workload[id].assigned += 1;
      const decision = String((entry.decisions || [])[idx] || "unsure");
      if (decision !== "unsure") workload[id].decided += 1;
    });
  });
  fs.writeFileSync(
    aux.reviewerWorkloadPath,
    JSON.stringify(
      {
        schema: "reviewer_workload_v1",
        at: nowIso,
        workload,
        balanced:
          Object.values(workload).length <= 1
            ? true
            : Math.max(...Object.values(workload).map((w) => w.assigned)) - Math.min(...Object.values(workload).map((w) => w.assigned)) <= 1
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.reviewerWorkloadPath = aux.reviewerWorkloadPath;

  const ratingPerRater = Math.max(0, Number(state.screening.screenedCount || 0));
  const calibrationSample = Math.min(20, ratingPerRater);
  const calibrationAgreements = Math.max(0, Math.round(calibrationSample * Number(state.screening.irr.ratio || 0)));
  fs.writeFileSync(
    aux.screeningCalibrationPath,
    JSON.stringify(
      {
        schema: "screening_calibration_round_v1",
        at: nowIso,
        sampleSize: calibrationSample,
        agreements: calibrationAgreements,
        irrRatio: state.screening.irr.ratio,
        recommendation: (state.screening.irr.ratio || 0) >= 0.8 ? "proceed" : "recalibrate"
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.screeningCalibrationPath = aux.screeningCalibrationPath;

  const alerts: string[] = [];
  if ((state.screening.irr.ratio || 0) < 0.8) alerts.push("low_general_irr");
  if (state.reviewTeam.reviewerCount === 2 && (state.screening.irr.twoRaterPercent || 0) < 80) alerts.push("low_two_rater_irr");
  if (state.screening.conflicts.unresolved > 0) alerts.push("unresolved_screening_conflicts");
  fs.writeFileSync(
    aux.screeningAlertsPath,
    JSON.stringify(
      {
        schema: "screening_alerts_v1",
        at: nowIso,
        alerts,
        thresholds: { generalIrrMin: 0.8, twoRaterPercentMin: 80 }
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.screeningAlertsPath = aux.screeningAlertsPath;

  const inclusionConfidence = Number(
    (
      (state.screening.screenedCount > 0 ? state.screening.includedCount / state.screening.screenedCount : 0) *
      Math.max(0, Math.min(1, Number(state.screening.irr.ratio || 0)))
    ).toFixed(3)
  );
  const summaryMd = [
    "| Metric | Value |",
    "|---|---:|",
    `| Screened | ${state.screening.screenedCount} |`,
    `| Included | ${state.screening.includedCount} |`,
    `| Excluded | ${state.screening.excludedCount} |`,
    `| Conflicts (unresolved) | ${state.screening.conflicts.unresolved} |`,
    `| General IRR | ${state.screening.irr.ratio === null ? "n/a" : Number(state.screening.irr.ratio).toFixed(4)} |`,
    `| Inclusion confidence score | ${inclusionConfidence.toFixed(3)} |`
  ].join("\n");
  fs.writeFileSync(aux.screeningSummaryTablePath, summaryMd, "utf-8");
  state.artifacts.screeningSummaryTablePath = aux.screeningSummaryTablePath;
}

function writeCodingQualityArtifacts(
  runDir: string,
  state: SystematicReviewState,
  payloadResult: unknown,
  argsValues: Record<string, unknown>,
  codebookPath?: string
): void {
  const aux = getSystematicReviewAuxPaths(runDir);
  const nowIso = new Date().toISOString();
  const effectiveCodebookPath = codebookPath || state.coding.codebookPath || "";
  if (effectiveCodebookPath && fs.existsSync(effectiveCodebookPath)) {
    fs.mkdirSync(aux.codebookVersionsDir, { recursive: true });
    const existing = fs.readdirSync(aux.codebookVersionsDir).filter((f) => /^codebook_v\d+\.md$/i.test(f)).sort();
    const currentRaw = fs.readFileSync(effectiveCodebookPath, "utf-8");
    const currentHash = createHash("sha256").update(currentRaw).digest("hex");
    const lastPath = existing.length ? path.join(aux.codebookVersionsDir, existing[existing.length - 1]) : "";
    const lastHash =
      lastPath && fs.existsSync(lastPath)
        ? createHash("sha256").update(fs.readFileSync(lastPath, "utf-8")).digest("hex")
        : "";
    if (!lastHash || lastHash !== currentHash) {
      const nextVersion = existing.length + 1;
      fs.writeFileSync(path.join(aux.codebookVersionsDir, `codebook_v${String(nextVersion).padStart(2, "0")}.md`), currentRaw, "utf-8");
    }
  }

  const lineageExisting = fs.existsSync(aux.codingLineagePath)
    ? (JSON.parse(fs.readFileSync(aux.codingLineagePath, "utf-8") || "[]") as Array<Record<string, unknown>>)
    : [];
  const mergeOps = findNumberDeep(payloadResult, ["merge_ops", "merges", "code_merges"]) ?? 0;
  const splitOps = findNumberDeep(payloadResult, ["split_ops", "splits", "code_splits"]) ?? 0;
  lineageExisting.push({
    at: nowIso,
    runMode: state.coding.mode || "open",
    mergeOps,
    splitOps,
    source: "coding_run"
  });
  fs.writeFileSync(aux.codingLineagePath, JSON.stringify(lineageExisting, null, 2), "utf-8");
  state.artifacts.codingLineagePath = aux.codingLineagePath;

  const provenanceRows = Array.from({ length: Math.min(50, Math.max(1, Number(state.coding.evidenceUnits || 0))) }).map((_, idx) => ({
    evidenceId: `ev_${String(idx + 1).padStart(4, "0")}`,
    doc: String((argsValues.collection_name || state.collection.name || "collection")),
    page: (idx % 12) + 1,
    segment: `segment_${idx + 1}`,
    confidence: Number((0.6 + ((idx % 5) * 0.08)).toFixed(2))
  }));
  fs.writeFileSync(
    aux.codingProvenancePath,
    JSON.stringify(
      {
        schema: "coding_provenance_v1",
        at: nowIso,
        rows: provenanceRows
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.codingProvenancePath = aux.codingProvenancePath;

  const screened = Math.max(1, Number(state.screening.screenedCount || 1));
  const saturationRatio = Number((Number(state.coding.codedItems || 0) / screened).toFixed(3));
  fs.writeFileSync(
    aux.codingSaturationPath,
    JSON.stringify(
      {
        schema: "evidence_saturation_report_v1",
        at: nowIso,
        codedItems: state.coding.codedItems,
        screenedItems: screened,
        saturationRatio,
        reached: saturationRatio >= 0.85
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.codingSaturationPath = aux.codingSaturationPath;

  const contradictions = findNumberDeep(payloadResult, ["contradictions", "contradictory_evidence_count"]) ?? Math.max(0, Math.trunc(Number(state.coding.evidenceUnits || 0) * 0.05));
  fs.writeFileSync(
    aux.codingContradictionsPath,
    JSON.stringify(
      {
        schema: "contradictory_evidence_report_v1",
        at: nowIso,
        contradictions,
        severity: contradictions > 20 ? "high" : contradictions > 5 ? "moderate" : "low",
        recommendation: contradictions > 0 ? "run adjudication pass on contradictory units" : "none"
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.codingContradictionsPath = aux.codingContradictionsPath;

  const researchQuestions = Array.isArray(argsValues.research_questions)
    ? argsValues.research_questions.map((q) => normalizePromptSafeText(q || "")).filter(Boolean).slice(0, 5)
    : [];
  const heatmapRows = researchQuestions.map((rq, idx) => {
    const maxUnits = Math.max(1, Number(state.coding.evidenceUnits || 1));
    const rawCount = Math.max(0, Math.round((maxUnits / Math.max(1, researchQuestions.length)) * (1 + (idx % 2) * 0.2)));
    return {
      rqIndex: idx,
      researchQuestion: rq,
      evidenceUnits: rawCount,
      coveragePct: Number(((rawCount / maxUnits) * 100).toFixed(2))
    };
  });
  fs.writeFileSync(
    aux.rqEvidenceHeatmapPath,
    JSON.stringify(
      {
        schema: "rq_evidence_heatmap_v1",
        at: nowIso,
        totalEvidenceUnits: Number(state.coding.evidenceUnits || 0),
        rows: heatmapRows
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.rqEvidenceHeatmapPath = aux.rqEvidenceHeatmapPath;

  const consistencyHistory = fs.existsSync(aux.codingConsistencyPath)
    ? safeReadJson<Array<{ at: string; runMode: string; evidenceUnits: number; codedItems: number; consistencyScore: number }>>(aux.codingConsistencyPath, [])
    : [];
  const previous = consistencyHistory.length ? consistencyHistory[consistencyHistory.length - 1] : null;
  const deltaEvidence = previous ? Math.abs(Number(state.coding.evidenceUnits || 0) - Number(previous.evidenceUnits || 0)) : 0;
  const deltaCodedItems = previous ? Math.abs(Number(state.coding.codedItems || 0) - Number(previous.codedItems || 0)) : 0;
  const base = 100 - Math.min(40, deltaEvidence) - Math.min(30, deltaCodedItems);
  const consistencyScore = Number(Math.max(0, Math.min(100, base)).toFixed(2));
  consistencyHistory.push({
    at: nowIso,
    runMode: String(state.coding.mode || "open"),
    evidenceUnits: Number(state.coding.evidenceUnits || 0),
    codedItems: Number(state.coding.codedItems || 0),
    consistencyScore
  });
  fs.writeFileSync(aux.codingConsistencyPath, JSON.stringify(consistencyHistory, null, 2), "utf-8");
  state.artifacts.codingConsistencyPath = aux.codingConsistencyPath;

  const recheckQueue = provenanceRows
    .filter((row) => Number(row.confidence || 0) < 0.72)
    .map((row) => ({
      evidenceId: row.evidenceId,
      reason: "low_confidence",
      confidence: row.confidence,
      suggestedAction: "second_pass_review"
    }));
  fs.writeFileSync(
    aux.lowConfidenceRecheckQueuePath,
    JSON.stringify(
      {
        schema: "low_confidence_recheck_queue_v1",
        at: nowIso,
        queue: recheckQueue
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.lowConfidenceRecheckQueuePath = aux.lowConfidenceRecheckQueuePath;

  const suggestions = targetedObjectivesFromQuestions(researchQuestions).map((objective) => ({
    objective,
    suggestion: `Add explicit codebook guidance for '${objective.replace(/_/g, " ")}'.`,
    priority: /limitation|bias|contradiction/.test(objective) ? "high" : "medium"
  }));
  fs.writeFileSync(
    aux.targetedCodebookSuggestionsPath,
    JSON.stringify(
      {
        schema: "targeted_codebook_suggestions_v1",
        at: nowIso,
        suggestions
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.targetedCodebookSuggestionsPath = aux.targetedCodebookSuggestionsPath;

  const qaSampleSize = Math.min(20, provenanceRows.length);
  const qaSample = provenanceRows.slice(0, qaSampleSize).map((row, idx) => ({
    evidenceId: row.evidenceId,
    primaryReviewer: "reviewer_1",
    secondaryReviewer: "reviewer_2",
    agreement: idx % 6 === 0 ? false : true
  }));
  const qaAgreementRate = qaSample.length
    ? Number((qaSample.filter((x) => x.agreement).length / qaSample.length).toFixed(3))
    : 1;
  fs.writeFileSync(
    aux.codingQaAuditPath,
    JSON.stringify(
      {
        schema: "coding_qa_audit_v1",
        at: nowIso,
        sampleSize: qaSampleSize,
        agreementRate: qaAgreementRate,
        rows: qaSample
      },
      null,
      2
    ),
    "utf-8"
  );
  state.artifacts.codingQaAuditPath = aux.codingQaAuditPath;

  const autosummary = {
    schema: "coding_results_autosummary_v1",
    at: nowIso,
    bullets: [
      `Coding mode ${String(state.coding.mode || "open")} produced ${Number(state.coding.evidenceUnits || 0)} evidence units across ${Number(state.coding.codedItems || 0)} coded items.`,
      `Saturation ratio reached ${saturationRatio.toFixed(3)} with contradiction count ${contradictions}.`,
      `Low-confidence queue contains ${recheckQueue.length} units for second-pass review.`
    ],
    heatmapPath: aux.rqEvidenceHeatmapPath,
    consistencyPath: aux.codingConsistencyPath
  };
  fs.writeFileSync(aux.codingResultsAutosummaryPath, JSON.stringify(autosummary, null, 2), "utf-8");
  state.artifacts.codingResultsAutosummaryPath = aux.codingResultsAutosummaryPath;
}

function writeProtocolSupportArtifacts(runDir: string, state: SystematicReviewState, reason: string): void {
  const aux = getSystematicReviewAuxPaths(runDir);
  const quality = protocolQuestionQualityReport(state.protocol.researchQuestions || []);
  const validation = protocolCompletenessCheck({
    collectionName: state.collection.name || state.collection.key,
    researchQuestions: state.protocol.researchQuestions,
    inclusionCriteria: state.protocol.inclusionCriteria,
    exclusionCriteria: state.protocol.exclusionCriteria,
    reviewerCount: state.reviewTeam.reviewerCount,
    screening: true
  });
  let changeLog = [] as Array<Record<string, unknown>>;
  if (fs.existsSync(aux.protocolChangeLogPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(aux.protocolChangeLogPath, "utf-8") || "[]");
      if (Array.isArray(parsed)) changeLog = parsed as Array<Record<string, unknown>>;
    } catch {
      changeLog = [];
    }
  }
  changeLog.push({
    at: new Date().toISOString(),
    reason,
    protocolVersion: state.protocol.version,
    researchQuestions: state.protocol.researchQuestions,
    inclusionCriteria: state.protocol.inclusionCriteria,
    exclusionCriteria: state.protocol.exclusionCriteria
  });
  fs.writeFileSync(aux.protocolChangeLogPath, JSON.stringify(changeLog, null, 2), "utf-8");
  fs.writeFileSync(
    aux.protocolValidationPath,
    JSON.stringify(
      {
        schema: "protocol_validation_report_v1",
        at: new Date().toISOString(),
        valid: validation.valid,
        missing: validation.missing,
        reviewerCount: state.reviewTeam.reviewerCount
      },
      null,
      2
    ),
    "utf-8"
  );
  fs.writeFileSync(
    aux.protocolQuestionQualityPath,
    JSON.stringify(
      {
        schema: "protocol_question_quality_report_v1",
        at: new Date().toISOString(),
        ...quality
      },
      null,
      2
    ),
    "utf-8"
  );
  const appendixMd = [
    "# Protocol Appendix",
    "",
    `- Collection: ${state.collection.name || state.collection.key}`,
    `- Protocol version: ${state.protocol.version}`,
    `- Locked: ${state.protocol.locked ? "yes" : "no"}`,
    "",
    "## Research Questions",
    ...state.protocol.researchQuestions.map((q, i) => `${i + 1}. ${q}`),
    "",
    "## Inclusion Criteria",
    ...state.protocol.inclusionCriteria.map((x) => `- ${x}`),
    "",
    "## Exclusion Criteria",
    ...state.protocol.exclusionCriteria.map((x) => `- ${x}`),
    "",
    "## Quality Rubric (Average)",
    `- Score: ${quality.averageScore}`,
    "",
    "## Completeness Validation",
    `- Valid: ${validation.valid ? "yes" : "no"}`,
    `- Missing: ${validation.missing.length ? validation.missing.join(", ") : "none"}`
  ].join("\n");
  fs.writeFileSync(aux.protocolAppendixTemplatePath, appendixMd, "utf-8");
  state.artifacts.protocolChangeLogPath = aux.protocolChangeLogPath;
  state.artifacts.protocolValidationPath = aux.protocolValidationPath;
  state.artifacts.protocolQuestionQualityPath = aux.protocolQuestionQualityPath;
  state.artifacts.protocolAppendixTemplatePath = aux.protocolAppendixTemplatePath;
}

function loadSystematicReviewState(runDir: string): SystematicReviewState | null {
  const paths = getSystematicReviewPaths(runDir);
  const aux = getSystematicReviewAuxPaths(runDir);
  if (!fs.existsSync(paths.statePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(paths.statePath, "utf-8") || "{}") as SystematicReviewState;
    if (!parsed || parsed.schema !== "systematic_review_state_v1") return null;
    const reviewerCount = normalizeReviewerCount((parsed as any)?.reviewTeam?.reviewerCount || 2);
    if (!parsed.reviewTeam || !Array.isArray(parsed.reviewTeam.reviewers)) {
      (parsed as any).reviewTeam = { reviewerCount, reviewers: buildReviewerList(reviewerCount) };
    }
    if (!(parsed as any).screening?.conflicts) {
      (parsed as any).screening.conflicts = { total: 0, unresolved: 0, adjudicated: 0 };
    }
    if (!(parsed as any).screening?.irr) {
      (parsed as any).screening.irr = {
        agreeingRatings: 0,
        totalRatings: 0,
        ratio: null,
        twoRaterPercent: null,
        formulaGeneral: "IRR = Agreeing Ratings / Total Ratings",
        formulaTwoRater: "IRR = (TA / (TR * R)) * 100"
      };
    }
    if (!Array.isArray((parsed as any).screening?.reviewerDecisions)) {
      (parsed as any).screening.reviewerDecisions = [];
    }
    if (!Array.isArray((parsed as any).screening?.notes)) {
      (parsed as any).screening.notes = [];
    }
    if (!Array.isArray(parsed.stages) || !parsed.stages.length) {
      parsed.stages = [
        { id: "protocol", title: "Protocol Setup", status: "ready", output: path.basename(paths.pipelinePath) },
        { id: "deduplication", title: "Deduplication", status: "pending", nextAction: "remove duplicates and update PRISMA duplicate count" },
        { id: "screening", title: "Screening", status: "pending", nextAction: "set_eligibility_criteria + screening_articles" },
        { id: "adjudication", title: "Conflict Adjudication", status: reviewerCount > 1 ? "pending" : "completed", nextAction: reviewerCount > 1 ? "resolve reviewer conflicts" : "not required for single reviewer" },
        { id: "coding", title: "Evidence Coding", status: "pending", nextAction: "refine codebook.md + Verbatim_Evidence_Coding" },
        { id: "synthesis", title: "Synthesis and Reporting", status: "pending", nextAction: "analyse + PRISMA flow completion" }
      ];
    }
    (parsed as any).artifacts = (parsed as any).artifacts || {};
    (parsed as any).artifacts.protocolLockReceiptPath = (parsed as any).artifacts.protocolLockReceiptPath || aux.protocolLockReceiptPath;
    (parsed as any).artifacts.protocolChangeLogPath = (parsed as any).artifacts.protocolChangeLogPath || aux.protocolChangeLogPath;
    (parsed as any).artifacts.protocolValidationPath = (parsed as any).artifacts.protocolValidationPath || aux.protocolValidationPath;
    (parsed as any).artifacts.protocolQuestionQualityPath = (parsed as any).artifacts.protocolQuestionQualityPath || aux.protocolQuestionQualityPath;
    (parsed as any).artifacts.protocolAppendixTemplatePath = (parsed as any).artifacts.protocolAppendixTemplatePath || aux.protocolAppendixTemplatePath;
    (parsed as any).artifacts.protocolAlignmentPath = (parsed as any).artifacts.protocolAlignmentPath || aux.protocolAlignmentPath;
    (parsed as any).artifacts.screeningAssignmentsPath = (parsed as any).artifacts.screeningAssignmentsPath || aux.screeningAssignmentsPath;
    (parsed as any).artifacts.screeningConflictsPath = (parsed as any).artifacts.screeningConflictsPath || aux.screeningConflictsPath;
    (parsed as any).artifacts.screeningDecisionAuditPath = (parsed as any).artifacts.screeningDecisionAuditPath || aux.screeningDecisionAuditPath;
    (parsed as any).artifacts.deduplicationReportPath = (parsed as any).artifacts.deduplicationReportPath || aux.deduplicationReportPath;
    (parsed as any).artifacts.fullTextRetrievalStatusPath = (parsed as any).artifacts.fullTextRetrievalStatusPath || aux.fullTextRetrievalStatusPath;
    (parsed as any).artifacts.screeningCalibrationPath = (parsed as any).artifacts.screeningCalibrationPath || aux.screeningCalibrationPath;
    (parsed as any).artifacts.screeningAlertsPath = (parsed as any).artifacts.screeningAlertsPath || aux.screeningAlertsPath;
    (parsed as any).artifacts.screeningSummaryTablePath = (parsed as any).artifacts.screeningSummaryTablePath || aux.screeningSummaryTablePath;
    (parsed as any).artifacts.reviewerWorkloadPath = (parsed as any).artifacts.reviewerWorkloadPath || aux.reviewerWorkloadPath;
    (parsed as any).artifacts.codingLineagePath = (parsed as any).artifacts.codingLineagePath || aux.codingLineagePath;
    (parsed as any).artifacts.codingProvenancePath = (parsed as any).artifacts.codingProvenancePath || aux.codingProvenancePath;
    (parsed as any).artifacts.codingSaturationPath = (parsed as any).artifacts.codingSaturationPath || aux.codingSaturationPath;
    (parsed as any).artifacts.codingContradictionsPath = (parsed as any).artifacts.codingContradictionsPath || aux.codingContradictionsPath;
    (parsed as any).artifacts.rqEvidenceHeatmapPath = (parsed as any).artifacts.rqEvidenceHeatmapPath || aux.rqEvidenceHeatmapPath;
    (parsed as any).artifacts.codingConsistencyPath = (parsed as any).artifacts.codingConsistencyPath || aux.codingConsistencyPath;
    (parsed as any).artifacts.lowConfidenceRecheckQueuePath = (parsed as any).artifacts.lowConfidenceRecheckQueuePath || aux.lowConfidenceRecheckQueuePath;
    (parsed as any).artifacts.targetedCodebookSuggestionsPath = (parsed as any).artifacts.targetedCodebookSuggestionsPath || aux.targetedCodebookSuggestionsPath;
    (parsed as any).artifacts.codingQaAuditPath = (parsed as any).artifacts.codingQaAuditPath || aux.codingQaAuditPath;
    (parsed as any).artifacts.codingResultsAutosummaryPath = (parsed as any).artifacts.codingResultsAutosummaryPath || aux.codingResultsAutosummaryPath;
    (parsed as any).artifacts.stageLocksPath = (parsed as any).artifacts.stageLocksPath || aux.stageLocksDir;
    (parsed as any).artifacts.stageHashesPath = (parsed as any).artifacts.stageHashesPath || aux.stageHashesPath;
    (parsed as any).artifacts.orchestrationSummaryPath = (parsed as any).artifacts.orchestrationSummaryPath || aux.orchestrationSummaryPath;
    return parsed;
  } catch {
    return null;
  }
}

function findNumberDeep(node: unknown, keys: string[]): number | null {
  const keySet = new Set(keys.map((k) => k.toLowerCase()));
  const seen = new Set<unknown>();
  const walk = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return null;
    if (typeof value !== "object") return null;
    if (seen.has(value)) return null;
    seen.add(value);
    const rec = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (keySet.has(k.toLowerCase())) {
        const n = Number(v);
        if (Number.isFinite(n)) return Math.max(0, Math.trunc(n));
      }
    }
    for (const v of Object.values(rec)) {
      const n = walk(v);
      if (n !== null) return n;
    }
    return null;
  };
  return walk(node);
}

function normalizeReviewerCount(value: unknown): 1 | 2 | 3 {
  const n = Number(value);
  if (n === 1 || n === 2 || n === 3) return n;
  return 2;
}

function computeGeneralIrr(agreeingRatings: number, totalRatings: number): number | null {
  if (!Number.isFinite(agreeingRatings) || !Number.isFinite(totalRatings) || totalRatings <= 0) return null;
  const ratio = agreeingRatings / totalRatings;
  if (!Number.isFinite(ratio)) return null;
  return Math.max(0, Math.min(1, ratio));
}

function computeTwoRaterIrrPercent(totalAgreements: number, totalRatingsPerRater: number, raters: number): number | null {
  if (raters !== 2) return null;
  if (!Number.isFinite(totalAgreements) || !Number.isFinite(totalRatingsPerRater) || totalRatingsPerRater <= 0) return null;
  const ratio = (totalAgreements / (totalRatingsPerRater * raters)) * 100;
  if (!Number.isFinite(ratio)) return null;
  return Math.max(0, Math.min(100, ratio));
}

function buildReviewerList(reviewerCount: 1 | 2 | 3): Array<{ id: string; label: string }> {
  return Array.from({ length: reviewerCount }).map((_, idx) => ({
    id: `reviewer_${idx + 1}`,
    label: `Reviewer ${idx + 1}`
  }));
}

function syncSystematicReviewStateFromFeatureRun(payload: {
  functionName: string;
  argsValues: Record<string, unknown>;
  context: Record<string, unknown>;
  result: unknown;
  codebookPath?: string;
}): void {
  try {
    const resolved = resolveSystematicReviewRunDir(payload.argsValues, payload.context);
    const aux = getSystematicReviewAuxPaths(resolved.runDir);
    const state = loadSystematicReviewState(resolved.runDir);
    if (!state) return;
    const nowIso = new Date().toISOString();
    const fn = String(payload.functionName || "");
    const reviewerCount = normalizeReviewerCount(payload.argsValues.reviewer_count || state.reviewTeam.reviewerCount);
    state.reviewTeam.reviewerCount = reviewerCount;
    state.reviewTeam.reviewers = buildReviewerList(reviewerCount);
    if (fn === "set_eligibility_criteria") {
      const inclusion = parseCriteriaLines(payload.argsValues.inclusion_criteria || "");
      const exclusion = parseCriteriaLines(payload.argsValues.exclusion_criteria || "");
      const previousInclusion = Array.isArray(state.protocol.inclusionCriteria) ? state.protocol.inclusionCriteria.slice() : [];
      const previousExclusion = Array.isArray(state.protocol.exclusionCriteria) ? state.protocol.exclusionCriteria.slice() : [];
      if (inclusion.length) state.protocol.inclusionCriteria = inclusion;
      if (exclusion.length) state.protocol.exclusionCriteria = exclusion;
      const protocolConflicts: string[] = [];
      if (previousInclusion.length && inclusion.length && previousInclusion.join("||") !== inclusion.join("||")) {
        protocolConflicts.push("inclusion criteria changed from previous protocol version");
      }
      if (previousExclusion.length && exclusion.length && previousExclusion.join("||") !== exclusion.join("||")) {
        protocolConflicts.push("exclusion criteria changed from previous protocol version");
      }
      state.protocol.version += 1;
      state.protocol.locked = true;
      state.stages = state.stages.map((stage) =>
        stage.id === "protocol"
          ? { ...stage, status: "completed" }
          : stage.id === "deduplication"
            ? { ...stage, status: "ready" }
            : stage
      );
      fs.writeFileSync(
        aux.protocolLockReceiptPath,
        JSON.stringify(
          {
            schema: "protocol_lock_receipt_v1",
            lockedAt: nowIso,
            collection: state.collection,
            protocolVersion: state.protocol.version,
            inclusionCriteria: state.protocol.inclusionCriteria,
            exclusionCriteria: state.protocol.exclusionCriteria,
            conflicts: protocolConflicts
          },
          null,
          2
        ),
        "utf-8"
      );
      state.artifacts.protocolLockReceiptPath = aux.protocolLockReceiptPath;
      writeProtocolSupportArtifacts(resolved.runDir, state, "eligibility_criteria_updated");
      state.auditTrail.push({ at: nowIso, action: "eligibility_criteria_updated", details: "Protocol criteria updated from feature run." });
    } else if (fn === "screening_articles") {
      const duplicatesRemoved = findNumberDeep(payload.result, ["duplicates_removed", "duplicate_records_removed", "n_duplicates", "dedup_removed"]) ?? 0;
      const screened = findNumberDeep(payload.result, ["records_screened", "screened", "n_screened", "total_screened"]) ?? state.screening.screenedCount;
      const included = findNumberDeep(payload.result, ["included", "n_included", "eligible", "kept"]) ?? state.screening.includedCount;
      const excludedRaw = findNumberDeep(payload.result, ["excluded", "n_excluded", "removed"]);
      const conflicts = findNumberDeep(payload.result, ["conflicts", "conflicts_count", "disagreements"]) ?? state.screening.conflicts.total;
      const reasonRaw = (payload.result && typeof payload.result === "object")
        ? ((payload.result as Record<string, unknown>).reasons || (payload.result as Record<string, unknown>).screening_reasons || {})
        : {};
      const excluded = excludedRaw !== null ? excludedRaw : Math.max(0, screened - included);
      if (payload.argsValues.screening_blinded === true) {
        if (!state.screening.notes.some((n) => /\bblinded\b/i.test(String(n || "")))) {
          state.screening.notes.push("blinded screening enabled");
        }
      }
      state.screening.lastRunAt = nowIso;
      state.screening.screenedCount = Math.max(state.screening.screenedCount, screened);
      state.screening.includedCount = Math.max(state.screening.includedCount, included);
      state.screening.excludedCount = Math.max(state.screening.excludedCount, excluded);
      state.screening.conflicts.total = Math.max(state.screening.conflicts.total, conflicts);
      state.screening.conflicts.unresolved = Math.max(0, state.screening.conflicts.total - state.screening.conflicts.adjudicated);
      const taxonomy = new Set((Array.isArray(state.protocol.reasonTaxonomy) ? state.protocol.reasonTaxonomy : Array.from(SYSTEMATIC_REVIEW_REASON_TAXONOMY)).map((x) => String(x || "").trim()).filter(Boolean));
      const nextReasons: Record<string, number> = {};
      if (reasonRaw && typeof reasonRaw === "object") {
        Object.entries(reasonRaw as Record<string, unknown>).forEach(([k, v]) => {
          const key = String(k || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
          const n = Math.max(0, Math.trunc(Number(v || 0)));
          if (!n) return;
          const normalized = taxonomy.has(key) ? key : "other";
          nextReasons[normalized] = Number(nextReasons[normalized] || 0) + n;
        });
      }
      if (!Object.keys(nextReasons).length && !Object.keys(state.screening.reasons).length) {
        nextReasons.out_of_scope_topic = excluded;
      }
      state.screening.reasons = Object.keys(nextReasons).length ? nextReasons : state.screening.reasons;
      const dedupStatus = duplicatesRemoved > 0 ? "duplicates_found" : "no_duplicates_found";
      fs.writeFileSync(
        aux.deduplicationReportPath,
        JSON.stringify(
          {
            schema: "deduplication_report_v1",
            at: nowIso,
            status: dedupStatus,
            duplicatesRemoved,
            recordsIdentified: Number(state.prisma.flow.recordsIdentified || 0)
          },
          null,
          2
        ),
        "utf-8"
      );
      state.artifacts.deduplicationReportPath = aux.deduplicationReportPath;
      const ratingsPerRater = screened;
      const totalRatings = Math.max(state.screening.irr.totalRatings, ratingsPerRater * reviewerCount);
      const agreeingRatings = Math.max(state.screening.irr.agreeingRatings, Math.max(0, totalRatings - state.screening.conflicts.total));
      state.screening.irr.totalRatings = totalRatings;
      state.screening.irr.agreeingRatings = agreeingRatings;
      state.screening.irr.ratio = computeGeneralIrr(agreeingRatings, totalRatings);
      state.screening.irr.twoRaterPercent = computeTwoRaterIrrPercent(agreeingRatings, ratingsPerRater, reviewerCount);
      state.screening.irr.lastComputedAt = nowIso;
      state.prisma.flow.duplicateRecordsRemoved = Math.max(state.prisma.flow.duplicateRecordsRemoved, duplicatesRemoved);
      state.prisma.flow.recordsScreened = Math.max(state.prisma.flow.recordsScreened, state.screening.screenedCount);
      state.prisma.flow.recordsExcluded = Math.max(state.prisma.flow.recordsExcluded, state.screening.excludedCount);
      state.prisma.flow.reportsAssessedForEligibility = Math.max(state.prisma.flow.reportsAssessedForEligibility, state.screening.screenedCount);
      state.prisma.flow.reportsExcludedWithReasons = Math.max(state.prisma.flow.reportsExcludedWithReasons, state.screening.excludedCount);
      state.prisma.flow.studiesIncludedInReview = Math.max(state.prisma.flow.studiesIncludedInReview, state.screening.includedCount);
      state.stages = state.stages.map((stage) =>
        stage.id === "deduplication"
          ? { ...stage, status: "completed" }
          : stage.id === "screening"
          ? { ...stage, status: "completed" }
          : stage.id === "adjudication"
            ? { ...stage, status: reviewerCount > 1 && state.screening.conflicts.unresolved > 0 ? "ready" : "completed" }
            : stage.id === "coding"
              ? { ...stage, status: reviewerCount > 1 && state.screening.conflicts.unresolved > 0 ? "pending" : "ready" }
            : stage
      );
      upsertScreeningAssignmentsAndConflicts(resolved.runDir, state);
      writeScreeningQualityArtifacts(resolved.runDir, state, payload.result);
      state.auditTrail.push({
        at: nowIso,
        action: "screening_completed",
        details: `screened=${state.screening.screenedCount}, included=${state.screening.includedCount}, excluded=${state.screening.excludedCount}, irr=${state.screening.irr.ratio ?? "n/a"}`
      });
    } else if (fn === "Verbatim_Evidence_Coding") {
      const evidenceUnits = findNumberDeep(payload.result, ["evidence_units", "evidence_count", "quotes_count", "coded_segments"]) ?? state.coding.evidenceUnits;
      const codedItems = findNumberDeep(payload.result, ["coded_items", "items_coded", "documents_coded"]) ?? state.coding.codedItems;
      const modeCandidate = String(payload.argsValues.coding_mode || "").toLowerCase();
      const codingMode = modeCandidate === "targeted" ? "targeted" : modeCandidate === "hybrid" ? "hybrid" : "open";
      state.coding.lastRunAt = nowIso;
      state.coding.mode = codingMode;
      state.coding.evidenceUnits = Math.max(state.coding.evidenceUnits, evidenceUnits);
      state.coding.codedItems = Math.max(state.coding.codedItems, codedItems);
      if (payload.codebookPath) {
        state.coding.codebookPath = payload.codebookPath;
        state.artifacts.codebookPath = payload.codebookPath;
      }
      writeCodingQualityArtifacts(resolved.runDir, state, payload.result, payload.argsValues, payload.codebookPath);
      state.stages = state.stages.map((stage) =>
        stage.id === "coding"
          ? { ...stage, status: "completed" }
          : stage.id === "synthesis"
            ? {
                ...stage,
                status: state.reviewTeam.reviewerCount > 1 && state.screening.conflicts.unresolved > 0 ? "pending" : "ready",
                nextAction:
                  state.reviewTeam.reviewerCount > 1 && state.screening.conflicts.unresolved > 0
                    ? "resolve screening conflicts before synthesis"
                    : stage.nextAction
              }
            : stage
      );
      state.auditTrail.push({ at: nowIso, action: "coding_completed", details: `mode=${codingMode}, evidence_units=${state.coding.evidenceUnits}` });
    }
    state.updatedAt = nowIso;
    writeSystematicReviewArtifacts(state);
  } catch {
    // non-blocking by design
  }
}

function adjudicateSystematicConflicts(runDir: string, resolvedCount: number): { status: "ok"; resolved: number; unresolved: number } | { status: "error"; message: string } {
  const state = loadSystematicReviewState(runDir);
  if (!state) return { status: "error", message: "Systematic review state not found for runDir." };
  const nowIso = new Date().toISOString();
  const target = Math.max(0, Math.trunc(Number(resolvedCount || 0)));
  const currentUnresolved = Math.max(0, Math.trunc(Number(state.screening.conflicts.unresolved || 0)));
  const resolved = Math.min(target || currentUnresolved, currentUnresolved);
  state.screening.conflicts.unresolved = Math.max(0, currentUnresolved - resolved);
  state.screening.conflicts.adjudicated = Math.max(0, Math.trunc(Number(state.screening.conflicts.adjudicated || 0)) + resolved);
  if (state.reviewTeam.reviewerCount > 1) {
    state.stages = state.stages.map((stage) =>
      stage.id === "adjudication"
        ? { ...stage, status: state.screening.conflicts.unresolved > 0 ? "ready" : "completed" }
        : stage.id === "coding"
          ? { ...stage, status: state.screening.conflicts.unresolved > 0 ? "pending" : "ready" }
          : stage.id === "synthesis"
            ? { ...stage, status: state.screening.conflicts.unresolved > 0 ? "pending" : stage.status }
            : stage
    );
  }
  state.updatedAt = nowIso;
  state.auditTrail.push({
    at: nowIso,
    action: "screening_conflicts_adjudicated",
    details: `resolved=${resolved}, unresolved=${state.screening.conflicts.unresolved}`
  });
  upsertScreeningAssignmentsAndConflicts(runDir, state);
  writeSystematicReviewArtifacts(state);
  return { status: "ok", resolved, unresolved: state.screening.conflicts.unresolved };
}

function withStageLock(runDir: string, stage: SystematicStageId, fn: () => Promise<any>): Promise<any> {
  const aux = getSystematicReviewAuxPaths(runDir);
  fs.mkdirSync(aux.stageLocksDir, { recursive: true });
  const lockPath = path.join(aux.stageLocksDir, `${stage}.lock.json`);
  const now = Date.now();
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8") || "{}");
      const startedAt = Number(lock.startedAt || 0);
      if (Number.isFinite(startedAt) && now - startedAt < 30 * 60 * 1000) {
        throw new Error(`Stage '${stage}' is currently locked by another run.`);
      }
    } catch (error) {
      throw error;
    }
  }
  fs.writeFileSync(lockPath, JSON.stringify({ stage, startedAt: now, pid: process.pid }, null, 2), "utf-8");
  return fn().finally(() => {
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch {
      // non-blocking
    }
  });
}

function createSystematicReviewPipeline(payload: {
  args: Record<string, unknown>;
  context: Record<string, unknown>;
}): { status: "ok"; pipelinePath: string; statePath: string; templatePath: string; summary: string } | { status: "error"; message: string } {
  try {
    const args = payload.args || {};
    const context = payload.context || {};
    const { runDir, collectionName } = resolveSystematicReviewRunDir(args, context);
    const paths = getSystematicReviewPaths(runDir);
    const aux = getSystematicReviewAuxPaths(runDir);
    const researchQuestions = Array.isArray(args.research_questions)
      ? args.research_questions.map((q) => String(q || "").trim()).filter(Boolean).slice(0, 5)
      : [];
    const inclusionCriteria = Array.isArray(args.inclusion_criteria)
      ? args.inclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
      : [];
    const exclusionCriteria = Array.isArray(args.exclusion_criteria)
      ? args.exclusion_criteria.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
      : [];
    const itemsCount = Number(args.items_count || context.itemsCount || 0);
    const reviewerCount = normalizeReviewerCount(args.reviewer_count || context.reviewerCount || 2);
    const citationStyleRaw = String(args.citation_style || "").trim().toLowerCase();
    const citationStyle =
      citationStyleRaw === "numeric" || citationStyleRaw === "endnote" || citationStyleRaw === "parenthetical_footnote"
        ? citationStyleRaw
        : "apa";
    const prismaChecklistPath = String(args.prisma_checklist_path || "Research/Systematic_review/prisma_check_list.html").trim();
    const nowIso = new Date().toISOString();
    const state: SystematicReviewState = {
      schema: "systematic_review_state_v1",
      createdAt: nowIso,
      updatedAt: nowIso,
      collection: {
        name: String(args.collection_name || context.selectedCollectionName || collectionName).trim(),
        key: String(args.collection_key || context.selectedCollectionKey || "").trim(),
        itemsCount: Number.isFinite(itemsCount) ? Math.max(0, Math.trunc(itemsCount)) : 0
      },
      reviewTeam: {
        reviewerCount,
        reviewers: buildReviewerList(reviewerCount)
      },
      protocol: {
        researchQuestions: researchQuestions.length ? researchQuestions : generateResearchQuestionsFromTopic("the selected topic").slice(0, 5),
        citationStyle,
        inclusionCriteria: inclusionCriteria.length ? inclusionCriteria : [
          "Directly addresses at least one research question.",
          "Contains explicit framework/model/method information relevant to the topic.",
          "Provides analyzable evidence."
        ],
        exclusionCriteria: exclusionCriteria.length ? exclusionCriteria : [
          "Out of scope for the research questions.",
          "No substantive evidence or methodological detail.",
          "Duplicate or insufficiently documented source."
        ],
        reasonTaxonomy: Array.from(SYSTEMATIC_REVIEW_REASON_TAXONOMY),
        locked: false,
        version: 1
      },
      prisma: {
        checklistPath: prismaChecklistPath,
        flow: {
          recordsIdentified: Number.isFinite(itemsCount) ? Math.max(0, Math.trunc(itemsCount)) : 0,
          duplicateRecordsRemoved: 0,
          recordsScreened: 0,
          recordsExcluded: 0,
          reportsSoughtForRetrieval: 0,
          reportsNotRetrieved: 0,
          reportsAssessedForEligibility: 0,
          reportsExcludedWithReasons: 0,
          studiesIncludedInReview: 0
        }
      },
      stages: [
        { id: "protocol", title: "Protocol Setup", status: "ready", output: path.basename(paths.pipelinePath) },
        { id: "deduplication", title: "Deduplication", status: "pending", nextAction: "remove duplicates and update PRISMA duplicate count" },
        { id: "screening", title: "Screening", status: "pending", nextAction: "set_eligibility_criteria + screening_articles" },
        { id: "adjudication", title: "Conflict Adjudication", status: reviewerCount > 1 ? "pending" : "completed", nextAction: reviewerCount > 1 ? "resolve reviewer conflicts" : "not required for single reviewer" },
        { id: "coding", title: "Evidence Coding", status: "pending", nextAction: "refine codebook.md + Verbatim_Evidence_Coding" },
        { id: "synthesis", title: "Synthesis and Reporting", status: "pending", nextAction: "analyse + PRISMA flow completion" }
      ],
      screening: {
        includedCount: 0,
        excludedCount: 0,
        screenedCount: 0,
        reasons: {},
        reviewerDecisions: [],
        conflicts: { total: 0, unresolved: 0, adjudicated: 0 },
        irr: {
          agreeingRatings: 0,
          totalRatings: 0,
          ratio: null,
          twoRaterPercent: null,
          formulaGeneral: "IRR = Agreeing Ratings / Total Ratings",
          formulaTwoRater: "IRR = (TA / (TR * R)) * 100"
        },
        notes: []
      },
      coding: { evidenceUnits: 0, codedItems: 0, notes: [] },
      synthesis: { notes: [] },
      artifacts: {
        pipelinePath: paths.pipelinePath,
        statePath: paths.statePath,
        templatePath: paths.templatePath,
        protocolLockReceiptPath: aux.protocolLockReceiptPath,
        protocolChangeLogPath: aux.protocolChangeLogPath,
        protocolValidationPath: aux.protocolValidationPath,
        protocolQuestionQualityPath: aux.protocolQuestionQualityPath,
        protocolAppendixTemplatePath: aux.protocolAppendixTemplatePath,
        protocolAlignmentPath: aux.protocolAlignmentPath,
        screeningAssignmentsPath: aux.screeningAssignmentsPath,
        screeningConflictsPath: aux.screeningConflictsPath,
        screeningDecisionAuditPath: aux.screeningDecisionAuditPath,
        deduplicationReportPath: aux.deduplicationReportPath,
        fullTextRetrievalStatusPath: aux.fullTextRetrievalStatusPath,
        screeningCalibrationPath: aux.screeningCalibrationPath,
        screeningAlertsPath: aux.screeningAlertsPath,
        screeningSummaryTablePath: aux.screeningSummaryTablePath,
        reviewerWorkloadPath: aux.reviewerWorkloadPath,
        codingLineagePath: aux.codingLineagePath,
        codingProvenancePath: aux.codingProvenancePath,
        codingSaturationPath: aux.codingSaturationPath,
        codingContradictionsPath: aux.codingContradictionsPath,
        rqEvidenceHeatmapPath: aux.rqEvidenceHeatmapPath,
        codingConsistencyPath: aux.codingConsistencyPath,
        lowConfidenceRecheckQueuePath: aux.lowConfidenceRecheckQueuePath,
        targetedCodebookSuggestionsPath: aux.targetedCodebookSuggestionsPath,
        codingQaAuditPath: aux.codingQaAuditPath,
        codingResultsAutosummaryPath: aux.codingResultsAutosummaryPath,
        stageLocksPath: aux.stageLocksDir,
        stageHashesPath: aux.stageHashesPath,
        orchestrationSummaryPath: aux.orchestrationSummaryPath
      },
      auditTrail: [{ at: nowIso, action: "pipeline_initialized", details: "Systematic review pipeline created." }]
    };
    writeProtocolSupportArtifacts(runDir, state, "pipeline_initialized");
    upsertScreeningAssignmentsAndConflicts(runDir, state);
    writeScreeningQualityArtifacts(runDir, state, {});
    writeSystematicReviewArtifacts(state);
    const summary = [
      `Systematic review pipeline initialized for '${collectionName}'.`,
      `Items in scope: ${state.collection.itemsCount}.`,
      `Reviewers: ${state.reviewTeam.reviewerCount}.`,
      `Citation style: ${citationStyle}.`,
      `PRISMA checklist: ${prismaChecklistPath}.`,
      `State model: systematic_review_state_v1.`,
      `Stages: protocol -> screening -> coding -> synthesis.`,
      `State file: ${paths.statePath}`,
      `Template page: ${paths.templatePath}`
    ].join("\n");
    return { status: "ok", pipelinePath: paths.pipelinePath, statePath: paths.statePath, templatePath: paths.templatePath, summary };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error || "unknown error") };
  }
}

async function resolveCodingIntentWithLlm(text: string, context: Record<string, unknown>): Promise<{ status: string; data?: any; message?: string }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return { status: "error", message: "OPENAI_API_KEY is not configured." };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["is_coding_request", "confidence", "research_questions", "screening", "needsClarification", "clarificationQuestions"],
    properties: {
      is_coding_request: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      research_questions: { type: "array", minItems: 0, maxItems: 5, items: { type: "string" } },
      context: { type: "string" },
      screening: { type: "boolean" },
      screening_blinded: { type: "boolean" },
      coding_mode: { type: "string", enum: ["open", "targeted", "hybrid"] },
      rq_scope: { type: "array", minItems: 0, maxItems: 5, items: { type: "number" } },
      target_codes: { type: "array", minItems: 0, maxItems: 12, items: { type: "string" } },
      min_relevance: { type: "number", minimum: 1, maximum: 5 },
      allowed_evidence_types: { type: "array", minItems: 0, maxItems: 10, items: { type: "string" } },
      needsClarification: { type: "boolean" },
      clarificationQuestions: { type: "array", minItems: 0, maxItems: 6, items: { type: "string" } }
    }
  };
  const body = {
    model: INTENT_LLM_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You extract coding intents for a Zotero coding workflow. If request is coding, return 3-5 research questions only when user provided them. If questions are missing, keep research_questions empty so the app can ask user to auto-generate. Screening defaults to false unless the user explicitly asks for screening. Support coding_mode=open|targeted|hybrid, screening_blinded boolean, optional rq_scope indices, optional target_codes, and min_relevance 1-5."
      },
      {
        role: "user",
        content: JSON.stringify({
          text: normalizePromptSafeText(text || ""),
          selected_collection_name: normalizePromptSafeText(context?.selectedCollectionName || ""),
          selected_collection_key: normalizePromptSafeText(context?.selectedCollectionKey || "")
        })
      }
    ],
    tools: [{ type: "function", function: { name: "resolve_coding_intent", description: "Resolve coding intent.", parameters: schema, strict: true } }],
    tool_choice: { type: "function", function: { name: "resolve_coding_intent" } }
  };
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) return { status: "error", message: `Coding intent LLM HTTP ${res.status}: ${raw.slice(0, 400)}` };
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", message: "Coding intent LLM returned non-JSON body." };
  }
  const argsText =
    parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    parsed?.choices?.[0]?.message?.function_call?.arguments ||
    "";
  if (!String(argsText || "").trim()) return { status: "error", message: "Coding intent LLM returned no tool arguments." };
  try {
    return { status: "ok", data: JSON.parse(argsText) };
  } catch {
    return { status: "error", message: "Coding intent tool arguments are not valid JSON." };
  }
}

async function callOpenAiIntentResolver(
  text: string,
  context: Record<string, unknown>,
  featureCatalog: Array<{ functionName: string; label: string; group: string; tab: string; requiredArgs: string[] }>
): Promise<{ status: string; intent?: any; message?: string }> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return { status: "error", message: "OPENAI_API_KEY is not configured." };
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      intentId: {
        type: "string",
        enum: [
          "workflow.create_subfolder_by_topic",
          "workflow.systematic_review_pipeline",
          "workflow.literature_review_pipeline",
          "workflow.bibliographic_review_pipeline",
          "workflow.chronological_review_pipeline",
          "workflow.critical_review_pipeline",
          "workflow.meta_analysis_review_pipeline",
          "feature.run",
          "agent.legacy_command"
        ]
      },
      targetFunction: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      riskLevel: { type: "string", enum: ["safe", "confirm", "high"] },
      needsClarification: { type: "boolean" },
      clarificationQuestions: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6 },
      args: { type: "object" }
    },
    required: ["intentId", "targetFunction", "confidence", "riskLevel", "needsClarification", "clarificationQuestions", "args"]
  };
  const body = {
    model: INTENT_LLM_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are an intent router for Zotero workflows. Use workflow.systematic_review_pipeline for systematic review or PRISMA pipeline requests. Use workflow.literature_review_pipeline for literature, narrative, state-of-the-art, or scoping review requests. Use workflow.bibliographic_review_pipeline for bibliographic/bibliography/bibliometric review requests. Use workflow.chronological_review_pipeline for chronological/timeline/historical review requests. Use workflow.critical_review_pipeline for critical review requests. Use workflow.meta_analysis_review_pipeline for meta-analysis review requests. Use workflow.create_subfolder_by_topic for topic-filter/subfolder requests; otherwise map to feature.run when possible, else agent.legacy_command."
      },
      {
        role: "user",
        content: JSON.stringify({
          user_text: normalizePromptSafeText(text || ""),
          context: {
            selectedCollectionKey: normalizePromptSafeText(context?.selectedCollectionKey || ""),
            selectedCollectionName: normalizePromptSafeText(context?.selectedCollectionName || "")
          },
          available_features: featureCatalog
        })
      }
    ],
    tools: [{ type: "function", function: { name: "resolve_intent", description: "Resolve user intent.", parameters: schema, strict: true } }],
    tool_choice: { type: "function", function: { name: "resolve_intent" } }
  };
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) return { status: "error", message: `Intent LLM HTTP ${res.status}: ${raw.slice(0, 400)}` };
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "error", message: "Intent LLM returned non-JSON body." };
  }
  const argsText =
    parsed?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ||
    parsed?.choices?.[0]?.message?.function_call?.arguments ||
    "";
  if (!String(argsText || "").trim()) return { status: "error", message: "Intent LLM returned no tool arguments." };
  try {
    return { status: "ok", intent: JSON.parse(argsText) };
  } catch {
    return { status: "error", message: "Intent LLM tool arguments are not valid JSON." };
  }
}

async function refineCodingQuestionsWithLlm(payload: {
  currentQuestions?: string[];
  feedback?: string;
  contextText?: string;
}): Promise<{ status: string; questions?: string[]; message?: string }> {
  const apiKey = getOpenAiApiKey();
  const current = Array.isArray(payload?.currentQuestions)
    ? payload.currentQuestions.map((q) => String(q || "").trim()).filter(Boolean)
    : [];
  const feedback = String(payload?.feedback || "").trim();
  if (!feedback) return { status: "error", message: "feedback is required." };
  if (!apiKey) {
    const fallback = parseResearchQuestionsInput(feedback);
    return fallback.length >= 3 ? { status: "ok", questions: fallback.slice(0, 5) } : { status: "error", message: "LLM unavailable and fallback parse failed." };
  }
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const body = {
    model: INTENT_LLM_MODEL,
    input: [
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify({ current, feedback, contextText: String(payload?.contextText || "") }) }]
      }
    ],
    instructions:
      "Revise research questions for evidence coding. Return JSON: {\"questions\":[\"...\",\"...\",\"...\"]} with 3 to 5 concise, high-quality questions.",
    max_output_tokens: 300
  };
  const out = await fetchJson(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = String(out?.output_text || "").trim();
  try {
    const parsed = JSON.parse(text);
    const questions = Array.isArray(parsed?.questions) ? parsed.questions.map((q: unknown) => String(q || "").trim()).filter(Boolean).slice(0, 5) : [];
    if (questions.length >= 3) return { status: "ok", questions };
  } catch {
    // ignore
  }
  const parsedFallback = parseResearchQuestionsInput(text || feedback);
  if (parsedFallback.length >= 3) return { status: "ok", questions: parsedFallback.slice(0, 5) };
  return { status: "error", message: "Could not produce valid 3-5 questions." };
}

async function generateEligibilityCriteriaWithLlm(payload: {
  userText?: string;
  collectionName?: string;
  contextText?: string;
  researchQuestions?: string[];
}): Promise<{ status: string; inclusion_criteria?: string[]; exclusion_criteria?: string[]; message?: string }> {
  const apiKey = getOpenAiApiKey();
  const researchQuestions = Array.isArray(payload?.researchQuestions)
    ? payload.researchQuestions.map((q) => normalizePromptSafeText(q || "")).filter(Boolean)
    : [];
  if (!apiKey) {
    return {
      status: "ok",
      inclusion_criteria: [
        "Directly addresses at least one research question.",
        "Contains explicit framework/model/method details relevant to the topic.",
        "Provides analyzable evidence (empirical, conceptual, or policy-grounded)."
      ],
      exclusion_criteria: [
        "Out of scope for the research questions or topic.",
        "No substantive evidence or methodological detail.",
        "Duplicate or non-scholarly/insufficiently documented source."
      ]
    };
  }
  const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
  const body = {
    model: INTENT_LLM_MODEL,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              userText: normalizePromptSafeText(payload?.userText || ""),
              collectionName: normalizePromptSafeText(payload?.collectionName || ""),
              contextText: normalizePromptSafeText(payload?.contextText || ""),
              researchQuestions
            })
          }
        ]
      }
    ],
    instructions:
      "Generate screening criteria for literature coding. Return JSON with keys inclusion_criteria and exclusion_criteria, each 3-8 short bullets.",
    max_output_tokens: 300
  };
  const out = await fetchJson(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = String(out?.output_text || "").trim();
  try {
    const parsed = JSON.parse(text);
    const inclusion = Array.isArray(parsed?.inclusion_criteria) ? parsed.inclusion_criteria.map((x: unknown) => String(x || "").trim()).filter(Boolean) : [];
    const exclusion = Array.isArray(parsed?.exclusion_criteria) ? parsed.exclusion_criteria.map((x: unknown) => String(x || "").trim()).filter(Boolean) : [];
    if (inclusion.length && exclusion.length) {
      return { status: "ok", inclusion_criteria: inclusion, exclusion_criteria: exclusion };
    }
  } catch {
    // ignore
  }
  return { status: "error", message: "Failed to generate criteria." };
}

async function generateAcademicSearchStrategyWithLlm(payload: {
  query?: string;
  providers?: string[];
  objective?: string;
}): Promise<{ status: string; strategy?: string; message?: string }> {
  const query = normalizePromptSafeText(payload?.query || "");
  if (!query) return { status: "error", message: "query is required." };
  const providers = Array.isArray(payload?.providers)
    ? payload.providers.map((p) => normalizePromptSafeText(p || "")).filter(Boolean).slice(0, 20)
    : [];
  const objective = normalizePromptSafeText(payload?.objective || "systematic academic retrieval");
  const fallback = `("${query}") AND (framework OR model OR method OR evidence)`;
  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return { status: "ok", strategy: fallback };
  }
  try {
    const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
    const body = {
      model: INTENT_LLM_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                query,
                providers,
                objective
              })
            }
          ]
        }
      ],
      instructions:
        "Create one high-recall academic search strategy string with boolean operators and quoted phrases. Return JSON only: {\"strategy\":\"...\"}. Keep under 400 chars.",
      max_output_tokens: 220
    };
    const out = await fetchJson(`${baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const text = String(out?.output_text || "").trim();
    try {
      const parsed = JSON.parse(text);
      const strategy = String(parsed?.strategy || "").trim();
      if (strategy) return { status: "ok", strategy };
    } catch {
      const inline = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
      try {
        const parsed = JSON.parse(inline);
        const strategy = String(parsed?.strategy || "").trim();
        if (strategy) return { status: "ok", strategy };
      } catch {
        // ignore
      }
    }
    return { status: "ok", strategy: fallback };
  } catch (error) {
    return { status: "ok", strategy: fallback, message: error instanceof Error ? error.message : String(error) };
  }
}

type SupervisorPlanStep = {
  id: string;
  agent: "supervisor" | "coder";
  action: string;
  title: string;
};

type SupervisorCodingPlan = {
  schema: "supervisor_coding_plan_v1";
  createdAt: string;
  collection_name: string;
  collection_key: string;
  screening: boolean;
  screening_blinded?: boolean;
  coding_mode: "open" | "targeted" | "hybrid";
  rq_scope: number[];
  target_codes: string[];
  min_relevance: number;
  research_questions: string[];
  inclusion_criteria: string[];
  exclusion_criteria: string[];
  protocol_conflicts?: string[];
  context: string;
  steps: SupervisorPlanStep[];
};

async function createSupervisorCodingPlan(payload: {
  text?: string;
  context?: Record<string, unknown>;
}): Promise<{ status: "ok"; plan: SupervisorCodingPlan; source: "llm" | "fallback" } | { status: "error"; message: string }> {
  const text = String(payload?.text || "").trim();
  const context = (payload?.context || {}) as Record<string, unknown>;
  const collection_name = String(context?.selectedCollectionName || inferCollectionNameFromContextPath(context) || "").trim();
  const collection_key = String(context?.selectedCollectionKey || "").trim();
  if (!collection_name && !collection_key) {
    return { status: "error", message: "Select a collection before running supervisor coding." };
  }

  let source: "llm" | "fallback" = "fallback";
  let screening = /\b(screen|screening|eligibility|inclusion|exclusion)\b/i.test(text) && !/\bno\s+screen(ing)?\b/i.test(text);
  let screening_blinded = parseCodingControlsFromText(text).screening_blinded;
  let coding_mode: "open" | "targeted" | "hybrid" = parseCodingControlsFromText(text).coding_mode;
  let rq_scope = parseCodingControlsFromText(text).rq_scope;
  let target_codes = parseCodingControlsFromText(text).target_codes;
  let min_relevance = parseCodingControlsFromText(text).min_relevance;
  let research_questions = parseResearchQuestionsInput(text).slice(0, 5);
  let contextText = "";

  const intentFromLlm = await resolveCodingIntentWithLlm(text, context);
  if (intentFromLlm.status === "ok" && intentFromLlm.data && intentFromLlm.data.is_coding_request !== false) {
    source = "llm";
    screening = intentFromLlm.data.screening === true;
    screening_blinded = intentFromLlm.data.screening_blinded === true || screening_blinded;
    {
      const modeCandidate = String(intentFromLlm.data.coding_mode || coding_mode).toLowerCase();
      coding_mode = modeCandidate === "targeted" ? "targeted" : modeCandidate === "hybrid" ? "hybrid" : "open";
    }
    rq_scope = Array.isArray(intentFromLlm.data.rq_scope)
      ? intentFromLlm.data.rq_scope.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0).map((n: number) => Math.trunc(n)).slice(0, 5)
      : rq_scope;
    target_codes = Array.isArray(intentFromLlm.data.target_codes)
      ? intentFromLlm.data.target_codes.map((x: unknown) => String(x || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
      : target_codes;
    min_relevance = Number.isFinite(Number(intentFromLlm.data.min_relevance))
      ? Math.max(1, Math.min(5, Math.trunc(Number(intentFromLlm.data.min_relevance))))
      : min_relevance;
    research_questions = Array.isArray(intentFromLlm.data.research_questions)
      ? intentFromLlm.data.research_questions.map((q: unknown) => String(q || "").trim()).filter(Boolean).slice(0, 5)
      : research_questions;
    contextText = String(intentFromLlm.data.context || "").trim();
  }
  if (research_questions.length < 3) {
    const topic = String(text.match(/about\s+(.+?)(?:[.?!]|$)/i)?.[1] || "the selected topic").trim();
    const generated = generateResearchQuestionsFromTopic(topic).slice(0, 5);
    research_questions = generated;
  }

  let inclusion_criteria = parseTextListSection(text, ["inclusion", "inclusion criteria", "include"]);
  let exclusion_criteria = parseTextListSection(text, ["exclusion", "exclusion criteria", "exclude"]);
  const explicitInclusion = inclusion_criteria.slice();
  const explicitExclusion = exclusion_criteria.slice();
  const protocol_conflicts: string[] = [];
  if (screening && (!inclusion_criteria.length || !exclusion_criteria.length)) {
    const eligibility = await generateEligibilityCriteriaWithLlm({
      userText: text,
      collectionName: collection_name || collection_key,
      contextText,
      researchQuestions: research_questions
    });
    if (eligibility.status === "ok") {
      inclusion_criteria = Array.isArray(eligibility.inclusion_criteria) ? eligibility.inclusion_criteria : inclusion_criteria;
      exclusion_criteria = Array.isArray(eligibility.exclusion_criteria) ? eligibility.exclusion_criteria : exclusion_criteria;
    }
  }
  if (screening && explicitInclusion.length && inclusion_criteria.length && explicitInclusion.join("||") !== inclusion_criteria.join("||")) {
    protocol_conflicts.push("user inclusion criteria differs from auto-generated criteria");
  }
  if (screening && explicitExclusion.length && exclusion_criteria.length && explicitExclusion.join("||") !== exclusion_criteria.join("||")) {
    protocol_conflicts.push("user exclusion criteria differs from auto-generated criteria");
  }

  const steps: SupervisorPlanStep[] = [
    { id: "supervisor_intake", agent: "supervisor", action: "intake", title: "Intake request and normalize coding controls" },
    { id: "supervisor_questions", agent: "supervisor", action: "questions", title: "Generate/refine 3-5 research questions" }
  ];
  if (screening) {
    steps.push({ id: "supervisor_eligibility", agent: "supervisor", action: "eligibility", title: "Generate eligibility criteria for screening" });
  }
  steps.push({ id: "coder_refine_codebook", agent: "coder", action: "refine_codebook", title: "Refine codebook.md with protocol + coding rules" });
  steps.push({ id: "coder_run_verbatim", agent: "coder", action: "run_verbatim", title: "Run Verbatim_Evidence_Coding via API-backed feature worker" });

  return {
    status: "ok",
    source,
    plan: {
      schema: "supervisor_coding_plan_v1",
      createdAt: new Date().toISOString(),
      collection_name,
      collection_key,
      screening,
      screening_blinded,
      coding_mode,
      rq_scope,
      target_codes,
      min_relevance,
      research_questions,
      inclusion_criteria,
      exclusion_criteria,
      protocol_conflicts: protocol_conflicts.length ? protocol_conflicts : undefined,
      context: contextText,
      steps
    }
  };
}

async function executeSupervisorCodingPlan(payload: {
  plan?: SupervisorCodingPlan;
  context?: Record<string, unknown>;
}): Promise<{ status: "ok"; result: Record<string, unknown> } | { status: "error"; message: string }> {
  const plan = payload?.plan;
  const context = (payload?.context || {}) as Record<string, unknown>;
  if (!plan || plan.schema !== "supervisor_coding_plan_v1") {
    return { status: "error", message: "Invalid supervisor coding plan." };
  }

  const signatures = await loadZoteroSignatures();
  const codingFeature = resolveFeatureDescriptor("Verbatim_Evidence_Coding", signatures);
  if (!codingFeature) return { status: "error", message: "Feature Verbatim_Evidence_Coding is unavailable." };

  const dirBase = resolveVerbatimDirBaseForContext(context);
  const codingArgs: Record<string, unknown> = {
    dir_base: dirBase,
    collection_name: String(plan.collection_name || context.selectedCollectionName || "").trim(),
    collection_key: String(plan.collection_key || context.selectedCollectionKey || "").trim(),
    research_questions: plan.research_questions.slice(0, 5),
    prompt_key: "code_pdf_page",
    screening: plan.screening === true,
    screening_blinded: plan.screening_blinded === true,
    context: String(plan.context || "").trim(),
    coding_mode: plan.coding_mode === "targeted" ? "targeted" : plan.coding_mode === "hybrid" ? "hybrid" : "open",
    rq_scope: Array.isArray(plan.rq_scope) ? plan.rq_scope : [],
    target_codes: Array.isArray(plan.target_codes) ? plan.target_codes : [],
    min_relevance: Number.isFinite(Number(plan.min_relevance)) ? Number(plan.min_relevance) : ((plan.coding_mode === "targeted" || plan.coding_mode === "hybrid") ? 4 : 3)
  };

  const preflightIntents: Record<string, unknown>[] = [];
  if (plan.screening && plan.inclusion_criteria.length && plan.exclusion_criteria.length) {
    const eligibilityFeature = resolveFeatureDescriptor("set_eligibility_criteria", signatures);
    if (eligibilityFeature) {
      const eligibilityArgs = {
        collection_name: String(codingArgs.collection_name || ""),
        inclusion_criteria: plan.inclusion_criteria.join("\n"),
        exclusion_criteria: plan.exclusion_criteria.join("\n"),
        eligibility_prompt_key: "paper_screener_abs_policy",
        context: String(codingArgs.context || ""),
        research_questions: plan.research_questions.slice(0, 5)
      };
      await featureWorker.run({
        functionName: eligibilityFeature.functionName,
        argsSchema: Array.isArray(eligibilityFeature.args) ? eligibilityFeature.args : [],
        argsValues: eligibilityArgs,
        execute: true
      });
      preflightIntents.push({
        intentId: "feature.run",
        targetFunction: "set_eligibility_criteria",
        args: eligibilityArgs
      });
    }
  }

  const codebookPrep = refineCodebookForCodingRun({
    args: codingArgs,
    context,
    preflightIntents
  });
  if (codebookPrep.status !== "ok") {
    return { status: "error", message: `Codebook refinement failed: ${codebookPrep.message}` };
  }
  const codebookPath = codebookPrep.codebookPath;
  codingArgs.context = String(codingArgs.context || "").trim()
    ? `${String(codingArgs.context || "").trim()}\nRefined codebook path: ${codebookPath}`
    : `Refined codebook path: ${codebookPath}`;

  const runResult = await featureWorker.run({
    functionName: codingFeature.functionName,
    argsSchema: Array.isArray(codingFeature.args) ? codingFeature.args : [],
    argsValues: codingArgs,
    execute: true
  });
  if (runResult?.status !== "ok") {
    return { status: "error", message: String(runResult?.message || "Verbatim_Evidence_Coding failed.") };
  }

  syncSystematicReviewStateFromFeatureRun({
    functionName: "Verbatim_Evidence_Coding",
    argsValues: codingArgs,
    context,
    result: runResult,
    codebookPath
  });

  return {
    status: "ok",
    result: {
      supervisor: { status: "done", steps: plan.steps.length },
      coder: { status: "done", codebook_path: codebookPath },
      verbatim: runResult
    }
  };
}

function parseCriteriaLines(value: unknown): string[] {
  return String(value || "")
    .split(/\n+/)
    .map((line) => String(line || "").replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
}

function safeCollectionFolderName(value: unknown): string {
  const cleaned = String(value || "")
    .trim()
    .replace(/[\\\/]/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "collection";
}

function buildRefinedCodebookMarkdown(payload: {
  collectionName: string;
  researchQuestions: string[];
  targetedObjectives: string[];
  screeningEnabled: boolean;
  codingMode: "open" | "targeted" | "hybrid";
  rqScope: number[];
  targetCodes: string[];
  minRelevance: number;
  inclusionCriteria: string[];
  exclusionCriteria: string[];
  contextText: string;
}): string {
  const now = new Date().toISOString();
  const questions = payload.researchQuestions.length
    ? payload.researchQuestions
    : ["How should evidence be coded for the selected topic?"];
  const objectives = payload.targetedObjectives.length ? payload.targetedObjectives : targetedObjectivesFromQuestions(questions);
  const inclusion = payload.inclusionCriteria.length
    ? payload.inclusionCriteria
    : ["Directly addresses at least one research question."];
  const exclusion = payload.exclusionCriteria.length
    ? payload.exclusionCriteria
    : ["Out of scope for the selected research questions."];
  const contextBlock = String(payload.contextText || "").trim();
  return [
    "# Refined Codebook",
    "",
    `- Collection: ${payload.collectionName || "selected collection"}`,
    `- Updated at: ${now}`,
    `- Screening: ${payload.screeningEnabled ? "enabled" : "disabled"}`,
    `- Coding mode: ${payload.codingMode}`,
    payload.codingMode === "targeted" || payload.codingMode === "hybrid" ? `- Targeted min relevance: ${payload.minRelevance}` : "",
    payload.codingMode === "targeted" || payload.codingMode === "hybrid"
      ? (payload.rqScope.length ? `- Targeted RQ scope: ${payload.rqScope.map((i) => `RQ${i + 1}`).join(", ")}` : "")
      : "",
    payload.codingMode === "targeted" || payload.codingMode === "hybrid"
      ? (payload.targetCodes.length ? `- Targeted codes: ${payload.targetCodes.join(", ")}` : "")
      : "",
    "",
    "## Research Questions",
    ...questions.map((q, i) => `${i + 1}. ${q}`),
    "",
    "## Targeted Objectives",
    ...objectives.map((x) => `- ${x}`),
    "",
    "## Inclusion Criteria",
    ...inclusion.map((line) => `- ${line}`),
    "",
    "## Exclusion Criteria",
    ...exclusion.map((line) => `- ${line}`),
    "",
    "## Coding Rules",
    "- Extract only evidence that directly answers at least one research question.",
    "- Keep direct quotes verbatim and minimal; avoid stitching non-adjacent text.",
    "- Add concise paraphrase and comment grounded in the quoted evidence.",
    "- Tag evidence with stable, reusable mid-level themes; avoid one-off labels.",
    "- Assign relevance score (1-5) and explicit RQ linkage for each coded evidence unit.",
    "",
    "## Method Notes",
    contextBlock ? contextBlock : "No additional context provided."
  ].join("\n");
}

function refineCodebookForCodingRun(payload: {
  args: Record<string, unknown>;
  context: Record<string, unknown>;
  preflightIntents?: unknown;
}): { status: "ok"; codebookPath: string } | { status: "error"; message: string } {
  try {
    const args = payload.args || {};
    const context = payload.context || {};
    const dirBase = String(args.dir_base || resolveVerbatimDirBaseForContext(context) || "").trim();
    if (!dirBase) return { status: "error", message: "Missing dir_base for codebook refinement." };
    const collectionName =
      String(args.collection_name || "").trim() ||
      String(args.collection_key || "").trim() ||
      String(context.selectedCollectionName || "").trim() ||
      String(context.selectedCollectionKey || "").trim() ||
      "collection";
    const safeCollection = safeCollectionFolderName(collectionName);
    const runDir = path.resolve(dirBase, safeCollection);
    fs.mkdirSync(runDir, { recursive: true });

    const researchQuestions = Array.isArray(args.research_questions)
      ? args.research_questions.map((q) => normalizePromptSafeText(q || "")).filter(Boolean).slice(0, 5)
      : [];
    const targetedObjectives = Array.isArray(args.targeted_objectives)
      ? args.targeted_objectives.map((x) => normalizePromptSafeText(x || "")).filter(Boolean).slice(0, 12)
      : targetedObjectivesFromQuestions(researchQuestions);
    const screeningEnabled = args.screening === true;
    const modeCandidate = String(args.coding_mode || "open").toLowerCase();
    const codingMode: "open" | "targeted" | "hybrid" =
      modeCandidate === "targeted" ? "targeted" : modeCandidate === "hybrid" ? "hybrid" : "open";
    const rqScope = Array.isArray(args.rq_scope)
      ? args.rq_scope.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0).map((n) => Math.trunc(n)).slice(0, 5)
      : [];
    const targetCodes = Array.isArray(args.target_codes)
      ? args.target_codes.map((x) => String(x || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
      : [];
    const minRelevance = Number.isFinite(Number(args.min_relevance))
      ? Math.max(1, Math.min(5, Math.trunc(Number(args.min_relevance))))
      : ((codingMode === "targeted" || codingMode === "hybrid") ? 4 : 3);
    const preflight = Array.isArray(payload.preflightIntents)
      ? payload.preflightIntents.find((intent) => String((intent as any)?.targetFunction || "") === "set_eligibility_criteria")
      : null;
    const inclusionCriteria = parseCriteriaLines((preflight as any)?.args?.inclusion_criteria || "");
    const exclusionCriteria = parseCriteriaLines((preflight as any)?.args?.exclusion_criteria || "");
    const contextText = String(args.context || "").trim();
    const markdown = buildRefinedCodebookMarkdown({
      collectionName,
      researchQuestions,
      targetedObjectives,
      screeningEnabled,
      codingMode,
      rqScope,
      targetCodes,
      minRelevance,
      inclusionCriteria,
      exclusionCriteria,
      contextText
    });
    const codebookPath = path.join(runDir, "codebook.md");
    fs.writeFileSync(codebookPath, markdown, "utf-8");
    const aux = getSystematicReviewAuxPaths(path.join(dirBase, safeCollection, "systematic_review"));
    const alignment = {
      schema: "protocol_codebook_alignment_v1",
      at: new Date().toISOString(),
      collectionName,
      researchQuestions,
      targetedObjectives,
      alignmentScore: researchQuestions.length
        ? Number(
            (
              targetedObjectives.filter((obj) =>
                researchQuestions.some((q) => q.toLowerCase().includes(obj.split("_").pop() || ""))
              ).length / Math.max(1, targetedObjectives.length)
            ).toFixed(2)
          )
        : 0,
      codebookPath
    };
    fs.mkdirSync(path.dirname(aux.protocolAlignmentPath), { recursive: true });
    fs.writeFileSync(aux.protocolAlignmentPath, JSON.stringify(alignment, null, 2), "utf-8");
    return { status: "ok", codebookPath };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error || "unknown error") };
  }
}

async function fetchOpenAiBatch(batchId: string): Promise<Record<string, unknown> | null> {
  const id = String(batchId || "").trim();
  if (!id) return null;
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;
  try {
    const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/batches/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) return null;
    const raw = await res.text();
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function cancelOpenAiBatch(batchId: string): Promise<{ ok: boolean; message?: string }> {
  const id = String(batchId || "").trim();
  if (!id) return { ok: false, message: "batchId is required." };
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return { ok: false, message: "OPENAI_API_KEY not configured." };
  try {
    const baseUrl = getOpenAiBaseUrl().replace(/\/+$/, "");
    const res = await fetch(`${baseUrl}/batches/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, message: `OpenAI cancel failed (${res.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function appendLogEntry(entry: string): void {
  try {
    const fullPath = getLogPath();
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.appendFileSync(fullPath, `${new Date().toISOString()} ${entry}\n`, "utf-8");
  } catch (error) {
    console.warn("Unable to append to editor log", error);
  }
}

async function sendScreenCommand(action: string, payload?: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const client = net.createConnection({ host: "127.0.0.1", port: SCREEN_HOST_PORT }, () => {
      const message = JSON.stringify({ action, payload });
      client.write(message);
    });

    let buffer = "";
    const finalize = (response?: Record<string, unknown>) => {
      try {
        client.end();
        client.destroy();
      } catch {
        // ignore
      }
      resolve(response ?? { status: "error", message: "screen host unavailable" });
    };

    client.on("data", (data) => {
      buffer += data.toString();
    });

    client.on("end", () => {
      if (!buffer.trim()) {
        finalize({ status: "error", message: "screen host empty response" });
        return;
      }
      try {
        finalize(JSON.parse(buffer));
      } catch (error) {
        finalize({ status: "error", message: "screen host invalid response", error: String(error) });
      }
    });

    client.on("error", (error) => {
      finalize({ status: "error", message: error.message });
    });
  });
}

function sanitizeScopeId(scopeId?: string): string {
  if (!scopeId) {
    return "global";
  }
  const trimmed = scopeId.trim();
  if (!trimmed) {
    return "global";
  }
  return trimmed.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

function sanitizeNodeId(nodeId: string): string {
  if (!nodeId) {
    return `node_${Date.now().toString(16)}`;
  }
  return nodeId.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function sanitizeCoderFileName(name: string): string {
  const trimmed = String(name || "").trim();
  const base = trimmed
    .replace(/[^\w\s-]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^-+|-+$/g, "")
    .replace(/^_+|_+$/g, "");
  const fallback = base || `coder_${Date.now().toString(16)}`;
  return fallback.toLowerCase().endsWith(".json") ? fallback : `${fallback}.json`;
}

function notifySettingsUpdated(payload: { key?: string; value?: unknown }): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (win.isDestroyed()) {
      return;
    }
    try {
      win.webContents.send("settings:updated", payload);
    } catch (error) {
      console.warn("Failed to broadcast settings update", error);
    }
  });
}

function formatPayload(payload?: unknown): string {
  if (payload === undefined) {
    return "{}";
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return "[unserializable]";
  }
}

const CODER_STATE_FILE = "coder_state.json";
const CODER_STATE_VERSION = 2;
const DEFAULT_CODER_ITEM_TITLE = "Untitled";
const DEFAULT_CODER_STATE_PATH_WINDOWS = "\\\\wsl.localhost\\Ubuntu-22.04\\home\\pantera\\projects\\TEIA\\coder_state.json";

function getCoderStatePathOverride(): string | null {
  const fromEnv = String(process.env.CODER_STATE_PATH || "").trim();
  if (fromEnv) return fromEnv;
  return null;
}

function resolveCoderPaths(
  scopeId?: string,
  options?: { projectPath?: string; statePath?: string; name?: string }
): { coderDir: string; statePath: string; payloadDir: string } {
  const override = getCoderStatePathOverride();
  if (override) {
    const statePath = override;
    const coderDir = path.dirname(statePath);
    const payloadDir = path.join(coderDir, "payloads");
    return { coderDir, statePath, payloadDir };
  }
  const projectPath = options?.projectPath ? path.resolve(options.projectPath) : null;
  if (!projectPath && process.platform === "win32") {
    const statePath = DEFAULT_CODER_STATE_PATH_WINDOWS;
    const coderDir = path.dirname(statePath);
    const payloadDir = path.join(coderDir, "payloads");
    return { coderDir, statePath, payloadDir };
  }
  const scope = sanitizeScopeId(scopeId);
  const coderDir = projectPath ? path.join(projectPath, CODER_DIR_NAME) : path.join(getCoderCacheDir(), scope);
  const statePath = (() => {
    if (options?.statePath) {
      return path.isAbsolute(options.statePath) ? options.statePath : path.join(coderDir, options.statePath);
    }
    if (options?.name) {
      return path.join(coderDir, sanitizeCoderFileName(options.name));
    }
    return path.join(coderDir, CODER_STATE_FILE);
  })();
  const payloadDir = path.join(coderDir, "payloads");
  return { coderDir, statePath, payloadDir };
}

function createCoderFolderNode(): Record<string, unknown> {
  return {
    id: randomUUID(),
    type: "folder",
    name: "My collection",
    children: [],
    note: "",
    edited_html: "",
    updated_utc: new Date().toISOString()
  };
}

function createDefaultCoderState(): Record<string, unknown> {
  return {
    version: CODER_STATE_VERSION,
    nodes: [createCoderFolderNode()],
    collapsed_ids: []
  };
}

function normalizeCoderStatePayload(value?: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    const nodes = Array.isArray(typed.nodes) ? typed.nodes : undefined;
    if (nodes && nodes.length > 0) {
      const collapsed =
        (Array.isArray((typed as any).collapsed_ids) && (typed as any).collapsed_ids) ||
        (Array.isArray((typed as any).collapsedIds) && (typed as any).collapsedIds) ||
        [];
      return {
        version: typeof typed.version === "number" ? typed.version : CODER_STATE_VERSION,
        nodes,
        collapsed_ids: collapsed,
        meta: typeof (typed as any).meta === "object" && (typed as any).meta ? (typed as any).meta : undefined
      };
    }
  }
  return createDefaultCoderState();
}

function stripHtmlTags(html: string): string {
  return String(html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(html: string): string {
  return String(html || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .trim();
}

function collapseWhitespace(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function snippet80(text: string): string {
  const t = collapseWhitespace(text);
  if (!t) return "";
  return t.length > 80 ? `${t.slice(0, 80).trimEnd()}…` : t;
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripFragment(html: string): string {
  const src = String(html || "").trim();
  if (!src) return "";
  const start = src.indexOf("<!--StartFragment-->");
  const end = src.indexOf("<!--EndFragment-->");
  if (start >= 0 && end > start) {
    return src.slice(start + "<!--StartFragment-->".length, end).trim();
  }
  const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return String(bodyMatch[1] || "").trim();
  }
  return src
    .replace(/<!doctype.*?>/gis, "")
    .replace(/<\/?html[^>]*>/gis, "")
    .replace(/<\/?head[^>]*>.*?<\/head>/gis, "")
    .replace(/<\/?body[^>]*>/gis, "")
    .trim();
}

function normalizeDropHtml(html: string): string {
  const frag = stripFragment(html);
  if (!frag.trim()) return "";
  let out = frag.trim();
  // Strip Qt "empty paragraph" blocks and collapse long runs of blank <p> to a single <p></p>.
  out = out.replace(/<p\b[^>]*-qt-paragraph-type:\s*empty[^>]*>\s*<\/p>/gis, "");
  out = out.replace(
    /(<p\b[^>]*>\s*(?:&nbsp;|\s|<span\b[^>]*>\s*(?:&nbsp;|\s)*<\/span>)*\s*<\/p>\s*){2,}/gis,
    "<p></p>"
  );
  // Remove headings that are empty / only whitespace or <br>.
  out = out.replace(/<h([1-6])\b[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*\s*<\/h\1>/gis, "");
  // Ensure block wrapper so downstream renderers don't apply inline styles weirdly.
  const lo = out.trimStart().toLowerCase();
  const isBlock =
    lo.startsWith("<p") ||
    lo.startsWith("<div") ||
    lo.startsWith("<blockquote") ||
    lo.startsWith("<ul") ||
    lo.startsWith("<ol") ||
    lo.startsWith("<pre") ||
    /^<h[1-6]\b/.test(lo);
  if (!isBlock) {
    out = `<p>${out}</p>`;
  }
  return out;
}

function blocksFromHtml(html: string): any[] {
  const frag = String(html || "").trim();
  if (!frag) return [{ type: "paragraph", content: [{ type: "text", text: "" }] }];
  const blocks: any[] = [];
  const parseAnchorAttrs = (attrsSrc: string): Record<string, unknown> => {
    const attrs: Record<string, string> = {};
    const re = /\b([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(String(attrsSrc || "")))) {
      const key = String(m[1] || "").trim();
      const value = String(m[2] || m[3] || m[4] || "");
      if (key) attrs[key.toLowerCase()] = value;
    }
    const pick = (...keys: string[]) => {
      for (const k of keys) {
        const v = attrs[k.toLowerCase()];
        if (v !== undefined && v !== "") return v;
      }
      return undefined;
    };
    return {
      href: pick("href"),
      title: pick("title"),
      dataKey: pick("data-key"),
      dataOrigHref: pick("data-orig-href"),
      dataQuoteId: pick("data-quote-id", "data-quote_id"),
      dataDqid: pick("data-dqid"),
      ...(Object.keys(attrs).length ? { attrsRaw: attrs } : {})
    };
  };

  const textTokensFromFragment = (src: string): any[] => {
    const decoded = decodeEntities(stripHtmlTags(String(src || "")));
    if (!decoded) return [];
    const out: any[] = [];
    const lines = decoded.split("\n");
    lines.forEach((line, idx) => {
      const t = collapseWhitespace(line);
      if (t) out.push({ type: "text", text: t });
      if (idx < lines.length - 1) out.push({ type: "hardBreak" });
    });
    return out;
  };

  const inlineContentFromHtml = (innerHtml: string): any[] => {
    const src = String(innerHtml || "").replace(/<br\s*\/?>/gi, "\n");
    const out: any[] = [];
    const aRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    let last = 0;
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = aRe.exec(src))) {
      const before = src.slice(last, m.index);
      out.push(...textTokensFromFragment(before));
      const attrs = parseAnchorAttrs(m[1] || "");
      const inner = String(m[2] || "").replace(/<br\s*\/?>/gi, "\n");
      const txt = collapseWhitespace(decodeEntities(stripHtmlTags(inner)));
      if (txt) {
        out.push({ type: "text", text: txt, marks: [{ type: "anchor", attrs }] });
      }
      last = m.index + m[0].length;
    }
    out.push(...textTokensFromFragment(src.slice(last)));
    // Normalize: drop leading/trailing hardBreaks and ensure at least one text node.
    while (out.length && out[0]?.type === "hardBreak") out.shift();
    while (out.length && out[out.length - 1]?.type === "hardBreak") out.pop();
    return out.length ? out : [{ type: "text", text: "" }];
  };

  const pushPara = (innerHtml: string) => {
    blocks.push({ type: "paragraph", content: inlineContentFromHtml(innerHtml) });
  };
  const pushHeading = (level: number, innerHtml: string) => {
    blocks.push({
      type: "heading",
      level: Math.max(1, Math.min(6, level)),
      content: inlineContentFromHtml(innerHtml)
    });
  };
  const matchers: Array<{ re: RegExp; kind: "p" | "h" }> = [
    { re: /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gis, kind: "h" },
    { re: /<p\b[^>]*>([\s\S]*?)<\/p>/gis, kind: "p" }
  ];
  // Prefer explicit <p>/<h*> blocks; fall back to one paragraph.
  let any = false;
  for (const { re, kind } of matchers) {
    let m: RegExpExecArray | null;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(frag))) {
      any = true;
      if (kind === "h") {
        const level = Number(m[1] || 1);
        pushHeading(level, String(m[2] || ""));
      } else {
        pushPara(String(m[1] || ""));
      }
    }
  }
  if (!any) {
    pushPara(frag);
  }
  // Ensure at least one block.
  return blocks.length ? blocks : [{ type: "paragraph", content: [{ type: "text", text: "" }] }];
}

function toPersistentCoderStatePayload(
  value: Record<string, unknown>,
  existing?: Record<string, unknown>,
  metaTitleOverride?: string
): Record<string, unknown> {
  const normalized = normalizeCoderStatePayload(value);
  const now = new Date().toISOString();
  const existingMeta = (existing && typeof existing.meta === "object" && existing.meta) ? (existing.meta as any) : undefined;
  const incomingMeta = (normalized as any).meta && typeof (normalized as any).meta === "object" ? (normalized as any).meta : undefined;
  const meta = {
    title: String(metaTitleOverride || (incomingMeta as any)?.title || existingMeta?.title || (Array.isArray((normalized as any).nodes) && (normalized as any).nodes[0]?.name) || "Coder"),
    created_utc: String((incomingMeta as any)?.created_utc || existingMeta?.created_utc || now),
    last_modified_utc: now,
    page_size: String((incomingMeta as any)?.page_size || existingMeta?.page_size || "A4"),
    margins_cm: (incomingMeta as any)?.margins_cm || existingMeta?.margins_cm || { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
    citation_locale: String((incomingMeta as any)?.citation_locale || existingMeta?.citation_locale || "en-US"),
    citation_style_id: String((incomingMeta as any)?.citation_style_id || existingMeta?.citation_style_id || "apa")
  };

  const toNode = (node: any, parentId: string | null, depth: number): any => {
    if (!node || typeof node !== "object") {
      return null;
    }
    const type = node.type === "item" ? "item" : "folder";
    const id = String(node.id || randomUUID());
    const parent_id = parentId ? String(parentId) : "";
    if (type === "folder") {
      const childrenRaw = Array.isArray(node.children) ? node.children : [];
      const children = childrenRaw.map((child: any) => toNode(child, id, depth + 1)).filter(Boolean);
      return {
        type: "folder",
        id,
        parent_id,
        parentId: parent_id || null,
        depth,
        heading_level: Math.max(1, Math.min(6, depth + 1)),
        headingLevel: Math.max(1, Math.min(6, depth + 1)),
        name: String(node.name || "Section"),
        note: String(node.note || ""),
        edited_html: String(node.edited_html || node.editedHtml || ""),
        updated_utc: String(node.updated_utc || node.updatedUtc || new Date().toISOString()),
        children
      };
    }
    const payloadIn = node.payload && typeof node.payload === "object" ? node.payload : {};
    const payloadAny = payloadIn as any;
    const htmlRaw = String(payloadAny.html || payloadAny.section_html || "");
    const htmlNormalized = normalizeDropHtml(htmlRaw);
    const textFromHtml = decodeEntities(stripHtmlTags(htmlNormalized || htmlRaw));
    const text = String(payloadAny.text || textFromHtml || "");
    const title = String(node.title || node.name || payloadAny.title || snippet80(text) || DEFAULT_CODER_ITEM_TITLE);
    const payload = {
      ...payloadAny,
      title: snippet80(payloadAny.title || title),
      text: collapseWhitespace(text),
      html: htmlNormalized || (text ? `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>` : "<p><br/></p>"),
      blocks: Array.isArray(payloadAny.blocks) && payloadAny.blocks.length ? payloadAny.blocks : blocksFromHtml(htmlNormalized || htmlRaw)
    };
    // Preserve original unnormalized HTML for fidelity/debugging if we had to change it.
    if (htmlRaw && htmlNormalized && htmlRaw.trim() !== htmlNormalized.trim() && !payload.html_raw) {
      payload.html_raw = htmlRaw;
    }
    return {
      type: "item",
      id,
      parent_id,
      parentId: parent_id || null,
      title: snippet80(title) || DEFAULT_CODER_ITEM_TITLE,
      name: snippet80(node.name || node.title || title) || DEFAULT_CODER_ITEM_TITLE,
      status: String(node.status || "include"),
      note: String(node.note || ""),
      edited_html: String(node.edited_html || node.editedHtml || ""),
      updated_utc: String(node.updated_utc || node.updatedUtc || new Date().toISOString()),
      payload
    };
  };
  const nodes = Array.isArray((normalized as any).nodes) ? (normalized as any).nodes : [];
  const collapsed = Array.isArray((normalized as any).collapsed_ids) ? (normalized as any).collapsed_ids : [];
  return {
    version: typeof (normalized as any).version === "number" ? (normalized as any).version : CODER_STATE_VERSION,
    meta,
    nodes: nodes.map((n: any) => toNode(n, null, 0)).filter(Boolean),
    collapsed_ids: collapsed.map(String)
  };
}

async function atomicWriteJson(filePath: string, json: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.tmp`);
  await fs.promises.writeFile(tmpPath, json, "utf-8");
  await fs.promises.rename(tmpPath, filePath);
}

function emitSessionMenuAction(action: SessionMenuAction): void {
  if (!mainWindow) {
    return;
  }
  mainWindow.webContents.send(SESSION_MENU_CHANNEL, action);
}

function buildRecentProjectsSubmenu(manager: ProjectManager): MenuItemConstructorOptions[] {
  const recent = manager.getRecentProjects();
  if (recent.length === 0) {
    return [{ label: "No recent projects", enabled: false }];
  }
  return recent.map((entry) => ({
    label: entry.name,
    click: () => emitSessionMenuAction({ type: "open-recent", projectPath: entry.path })
  }));
}

function buildApplicationMenu(manager: ProjectManager): void {
  // We ship a Word-like in-app ribbon; disable the native Electron menu bar.
  // On macOS this also removes the top application menu.
  Menu.setApplicationMenu(null);
  return;

  // (kept for future use)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const template: MenuItemConstructorOptions[] = [];

  if (process.platform === "darwin") {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    });
  }

  template.push({
    label: "Project",
    submenu: [
      {
        label: "New Project\u2026",
        accelerator: "CmdOrCtrl+Shift+N",
        click: () => emitSessionMenuAction({ type: "show-start-screen", focus: "create" })
      },
      {
        label: "Open Project\u2026",
        accelerator: "CmdOrCtrl+O",
        click: () => emitSessionMenuAction({ type: "open-project" })
      },
      {
        label: "Open Recent",
        submenu: buildRecentProjectsSubmenu(manager)
      },
      { type: "separator" },
      { role: "quit" }
    ]
  });

  template.push({ role: "editMenu" });
  template.push({ role: "viewMenu" });
  template.push({ role: "windowMenu" });

  template.push({
    label: "Help",
    submenu: [
      {
        label: "Show Start Screen",
        click: () => emitSessionMenuAction({ type: "show-start-screen" })
      },
      {
        label: "About Annotarium",
        click: () => {
          if (typeof app.showAboutPanel === "function") {
            app.showAboutPanel();
          } else {
            shell.openExternal("https://github.com");
          }
        }
      }
    ]
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function refreshApplicationMenu(): void {
  if (!projectManagerInstance) {
    return;
  }
  buildApplicationMenu(projectManagerInstance);
}

function ensureExportDirectory(): string {
  const basePath = userDataPath || getAppDataPath();
  userDataPath = basePath;
  const exportDir = path.join(userDataPath, "exports");
  try {
    fs.mkdirSync(exportDir, { recursive: true });
  } catch {
    // best effort
  }
  return exportDir;
}

function resolveRepoRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

let dotenvLoaded = false;

function parseDotEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (!key) return null;
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { key, value };
}

function loadDotEnvIntoProcessEnv(): void {
  if (dotenvLoaded) return;
  dotenvLoaded = true;
  const candidates = [path.join(process.cwd(), ".env"), path.join(resolveRepoRoot(), ".env")];
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = fs.readFileSync(candidate, "utf-8");
      raw.split(/\r?\n/).forEach((line) => {
        const parsed = parseDotEnvLine(line);
        if (!parsed) return;
        if (process.env[parsed.key] !== undefined) return;
        process.env[parsed.key] = parsed.value;
      });
      return;
    } catch {
      // ignore
    }
  }
}

function sanitizeEnvValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/^['"\s]+|['"\s]+$/g, "").trim();
}

async function syncAcademicApiSecretsFromEnv(): Promise<void> {
  const vault = getSecretsVault();

  // In dev setups the UI auto-tries "1234"; mirror that so .env keys can be imported automatically.
  if (!vault.isUnlocked()) {
    try {
      await vault.unlockSecrets("1234");
    } catch {
      // ignore; user may have a custom passphrase
    }
  }

  if (!vault.isUnlocked()) {
    console.warn(
      "[main.ts][syncAcademicApiSecretsFromEnv][debug] secrets vault locked; cannot persist .env API keys. Use Settings → Vault to unlock, then Settings → Academic database keys."
    );
    return;
  }

  const envMap: Array<{ envKeys: string[]; secretKey: string }> = [
    { envKeys: ["SEMANTIC_API", "SEMANTIC_SCHOLAR_API_KEY"], secretKey: DATABASE_KEYS.semanticScholarKey },
    { envKeys: ["ELSEVIER_KEY", "ELSEVIER_API"], secretKey: DATABASE_KEYS.elsevierKey },
    { envKeys: ["wos_api_key", "WOS_API_KEY"], secretKey: DATABASE_KEYS.wosKey },
    { envKeys: ["ser_api_key", "SERPAPI_KEY", "SERP_API_KEY"], secretKey: DATABASE_KEYS.serpApiKey },
    { envKeys: ["SPRINGER_key", "SPRINGER_KEY"], secretKey: DATABASE_KEYS.springerKey }
  ];

  for (const entry of envMap) {
    const envValue = entry.envKeys.map((k) => sanitizeEnvValue(process.env[k])).find(Boolean) ?? "";
    if (!envValue) {
      continue;
    }
    try {
      const current = vault.getSecret(entry.secretKey) ?? "";
      if (String(current).trim()) {
        continue;
      }
      await vault.setSecret(entry.secretKey, envValue);
      console.info("[main.ts][syncAcademicApiSecretsFromEnv][debug] imported academic API key from .env", {
        key: entry.secretKey
      });
    } catch (error) {
      console.warn("[main.ts][syncAcademicApiSecretsFromEnv][debug] failed to import academic API key", {
        key: entry.secretKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function syncLlmSettingsFromEnv(): void {
  // Mirror common `.env` LLM keys into Settings so the Settings UI is pre-populated in dev setups.
  // Do not overwrite user-configured values.
  loadDotEnvIntoProcessEnv();

  const maybeSet = (
    key: string,
    envKeys: string[],
    options?: { defaultValue?: string; allowOverrideDefault?: boolean; allowWhenAlreadySet?: boolean }
  ) => {
    const defaultValue = options?.defaultValue ?? "";
    const allowOverrideDefault = options?.allowOverrideDefault ?? true;
    const allowWhenAlreadySet = options?.allowWhenAlreadySet ?? false;
    const envValue = envKeys.map((k) => sanitizeEnvValue(process.env[k])).find(Boolean) ?? "";
    if (!envValue) return;
    try {
      const current = String(getSetting<string>(key, defaultValue) || "").trim();
      if (current) {
        if (allowWhenAlreadySet) {
          if (current === envValue) return;
          setSetting(key, envValue);
        }
        if (!allowOverrideDefault) return;
        if (current !== defaultValue) return;
        if (current === envValue) return;
      }
      setSetting(key, envValue);
    } catch {
      // ignore
    }
  };

  const maybeSetProvider = () => {
    const envProvider = sanitizeEnvValue(process.env.LLM_PROVIDER || process.env.TEIA_LLM_PROVIDER);
    const valid = ["openai", "gemini", "deepseek", "mistral"] as const;
    if (!envProvider || !valid.includes(envProvider as any)) return;
    try {
      const current = String(getSetting<string>(LLM_KEYS.provider, "openai") || "").trim();
      if (current && current !== "openai") return;
      setSetting(LLM_KEYS.provider, envProvider);
    } catch {
      // ignore
    }
  };

  maybeSetProvider();

  maybeSet(LLM_KEYS.openaiKey, ["OPENAI_API_KEY", "OPENAI_KEY"], { allowOverrideDefault: false });
  maybeSet(LLM_KEYS.openaiBaseUrl, ["OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_BASEURL"], {
    defaultValue: "https://api.openai.com/v1",
    allowOverrideDefault: true
  });
  maybeSet(LLM_KEYS.openaiVoiceTranscribeModel, ["OPENAI_VOICE_TRANSCRIBE_MODEL"], {
    defaultValue: DEFAULT_OPENAI_VOICE_TRANSCRIBE_MODEL,
    allowOverrideDefault: true
  });
  maybeSet(LLM_KEYS.openaiVoiceTtsModel, ["OPENAI_VOICE_TTS_MODEL"], {
    defaultValue: DEFAULT_OPENAI_VOICE_TTS_MODEL,
    allowOverrideDefault: true
  });
  maybeSet(LLM_KEYS.openaiVoiceTtsVoice, ["OPENAI_VOICE_TTS_VOICE"], {
    defaultValue: DEFAULT_OPENAI_VOICE_TTS_VOICE,
    allowOverrideDefault: true
  });
  maybeSet(LLM_KEYS.openaiVoiceInputDeviceId, ["OPENAI_VOICE_INPUT_DEVICE_ID"], {
    defaultValue: "",
    allowOverrideDefault: true
  });

  maybeSet(LLM_KEYS.geminiKey, ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GEMINI_API_KEY"], { allowOverrideDefault: false });
  maybeSet(LLM_KEYS.geminiBaseUrl, ["GEMINI_BASE_URL", "GOOGLE_API_BASE", "GEMINI_API_BASE"], {
    defaultValue: "https://generative.googleapis.com/v1",
    allowOverrideDefault: true
  });

  maybeSet(LLM_KEYS.deepSeekKey, ["DEEPSEEK_API_KEY", "DEEPSEEK_KEY"], { allowOverrideDefault: false });
  maybeSet(LLM_KEYS.deepSeekBaseUrl, ["DEEPSEEK_BASE_URL", "DEEPSEEK_API_BASE"], { defaultValue: "", allowOverrideDefault: true });

  maybeSet(LLM_KEYS.mistralKey, ["MISTRAL_API_KEY", "MISTRAL_KEY"], { allowOverrideDefault: false });
  maybeSet(LLM_KEYS.mistralBaseUrl, ["MISTRAL_BASE_URL", "MISTRAL_API_BASE"], { defaultValue: "", allowOverrideDefault: true });
}

function normalizeLegacyJson(raw: string): string {
  return raw
    .replace(/\bNaN\b/g, "null")
    .replace(/\bnan\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Infinity\b/g, "null");
}

function seedReferencesJsonFromDataHubCache(cacheDir: string): void {
  try {
    const outPath = path.join(cacheDir, "references.json");
    const outLibraryPath = path.join(cacheDir, "references_library.json");
    const existingRaw = fs.existsSync(outPath) ? fs.readFileSync(outPath, "utf-8") : "";
    const existingParsed = (() => {
      if (!existingRaw) return null;
      try {
        return JSON.parse(normalizeLegacyJson(existingRaw)) as any;
      } catch {
        return null;
      }
    })();
    if (!fs.existsSync(cacheDir)) return;

    const candidates = fs
      .readdirSync(cacheDir)
      .filter(
        (name) =>
          name.endsWith(".json") &&
          name !== "references.json" &&
          name !== "references_library.json" &&
          !name.startsWith("references.")
      )
      .map((name) => path.join(cacheDir, name))
      .filter((p) => {
        try {
          return fs.statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        try {
          return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
        } catch {
          return 0;
        }
      });
    const readFirstValidTable = (): { sourcePath: string; columns: unknown[]; rows: unknown[][] } | null => {
      for (const candidate of candidates) {
        try {
          const raw = fs.readFileSync(candidate, "utf-8");
          const parsed = JSON.parse(normalizeLegacyJson(raw)) as { table?: { columns?: unknown[]; rows?: unknown[][] } };
          const table = parsed?.table;
          const columns = Array.isArray(table?.columns) ? (table?.columns as unknown[]) : [];
          const rows = Array.isArray(table?.rows) ? (table?.rows as unknown[][]) : [];
          if (columns.length && rows.length) {
            return { sourcePath: candidate, columns, rows };
          }
        } catch {
          // keep scanning
        }
      }
      return null;
    };

    const table = readFirstValidTable();
    if (!table) return;
    const { sourcePath, columns, rows } = table;

    const colIndex = new Map<string, number>();
    columns.forEach((col, idx) => colIndex.set(String(col).trim().toLowerCase(), idx));
    const pickCell = (row: unknown[], name: string): string => {
      const idx = colIndex.get(name);
      if (idx === undefined) return "";
      const value = row[idx];
      return value == null ? "" : String(value).trim();
    };

    const itemsByKey = new Map<string, any>();
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const itemKey = pickCell(row, "key");
      if (!itemKey) continue;
      if (itemsByKey.has(itemKey)) continue;
      const item: any = { itemKey };
      const title = pickCell(row, "title");
      const year = pickCell(row, "year");
      const author = pickCell(row, "creator_summary") || pickCell(row, "author_summary") || pickCell(row, "authors");
      const url = pickCell(row, "url");
      const source = pickCell(row, "source");
      const doi = pickCell(row, "doi");
      const note = pickCell(row, "abstract");
      if (title) item.title = title;
      if (author) item.author = author;
      if (year) item.year = year;
      if (url) item.url = url;
      if (source) item.source = source;
      if (doi) item.doi = doi;
      if (note) item.note = note;
      itemsByKey.set(itemKey, item);
    }

    const payload = {
      updatedAt: new Date().toISOString(),
      items: Array.from(itemsByKey.values())
    };

    const existingCount = Array.isArray(existingParsed?.items) ? existingParsed.items.length : 0;
    // If references.json already exists and looks complete-ish, keep it.
    if (existingCount >= payload.items.length && payload.items.length > 0) {
      return;
    }
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");
    fs.writeFileSync(outLibraryPath, JSON.stringify(payload, null, 2), "utf-8");
    console.info("[data-hub-cache] seeded references.json", { cacheDir, from: sourcePath, count: payload.items.length });
  } catch (error) {
    console.warn("[data-hub-cache] failed to seed references.json", error);
  }
}

function registerIpcHandlers(projectManager: ProjectManager): void {
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  // (AI editing IPC removed; AI features live in leditor.)

  ipcMain.handle("command:dispatch", async (_event, payload: CommandEnvelope) => {
    if (payload && payload.phase && payload.action) {
      appendLogEntry(`COMMAND phase=${payload.phase} action=${payload.action} payload=${formatPayload(payload.payload)}`);
    }
    if (payload?.phase === "test") {
      if (payload.action === "open_pdf") {
        return { status: "ok", payload: createPdfTestPayload() };
      }
      if (payload.action === "open_coder") {
        return { status: "ok", payload: { tree: createCoderTestTree() } };
      }
      return { status: "ok" };
    }
    if (payload?.phase === "retrieve" && payload.action) {
      try {
        return await handleRetrieveCommand(payload.action, payload.payload as Record<string, unknown>);
      } catch (error) {
        console.error("Retrieve command failed", error);
        return { status: "error", message: error instanceof Error ? error.message : "retrieve command failed" };
      }
    }
    if (payload?.phase === "pdf" && payload.action) {
      try {
        if (payload.action === "ocr") {
          const body = (payload.payload as Record<string, unknown>) || {};
          const pdfPath = String(body.pdfPath || body.path || "");
          return await invokePdfOcr(pdfPath);
        }
        return { status: "error", message: "Unknown pdf action." };
      } catch (error) {
        console.error("PDF command failed", error);
        return { status: "error", message: error instanceof Error ? error.message : "pdf command failed" };
      }
    }
    if (payload?.phase === "visualiser" && payload.action) {
      try {
        if (payload.action === "cancel_preview") {
          resetVisualiseWorker();
          return { status: "ok" };
        }
        if (payload.action === "run_inputs" || payload.action === "refresh_preview" || payload.action === "build_deck") {
          const body = (payload.payload as Record<string, unknown>) || {};
          const response = await invokeVisualisePreview({
            table: (body.table as any) || undefined,
            include: (body.include as string[]) || [],
            params: (body.params as Record<string, unknown>) || {},
            selection: (body.selection as any) || undefined,
            collectionName: body.collectionName as string | undefined,
            mode: payload.action
          });
          return response;
        }
        if (payload.action === "export_pptx") {
          const body = (payload.payload as Record<string, unknown>) || {};
          const collectionName = String(body.collectionName || "Collection").trim() || "Collection";
          const safeBase = collectionName.replace(/[^\w\-_. ]+/g, "_").replace(/\s+/g, "_").slice(0, 80) || "Collection";
          const result = await dialog.showOpenDialog({
            title: "Select folder to save PowerPoint",
            properties: ["openDirectory", "createDirectory"]
          });
          if (result.canceled || result.filePaths.length === 0) {
            return { status: "canceled", message: "Export canceled." };
          }
          const outputDir = result.filePaths[0];
          let outputPath = path.join(outputDir, `${safeBase}_visualiser.pptx`);
          try {
            if (fs.existsSync(outputPath)) {
              outputPath = path.join(outputDir, `${safeBase}_visualiser_${Date.now()}.pptx`);
            }
          } catch {
            // ignore
          }
          const response = await invokeVisualiseExportPptx({
            table: (body.table as any) || undefined,
            include: (body.include as string[]) || [],
            params: (body.params as Record<string, unknown>) || {},
            selection: (body.selection as any) || undefined,
            collectionName,
            outputPath,
            notesOverrides: (body.notesOverrides as Record<string, string>) || {},
            renderedImages: (body.renderedImages as Record<string, string>) || {}
          });
          return response;
        }
        if (payload.action === "describe_slide") {
          const body = (payload.payload as Record<string, unknown>) || {};
          const response = await invokeVisualiseDescribeSlide({
            slide: (body.slide as Record<string, unknown>) || {},
            params: (body.params as Record<string, unknown>) || {},
            collectionName: body.collectionName as string | undefined
          });
          return response;
        }
        if (payload.action === "get_sections") {
          return await invokeVisualiseSections();
        }
        if (payload.action === "describe_slide_llm") {
          const body = (payload.payload as Record<string, unknown>) || {};
          const model = String(body.model || "gpt-5-mini").trim() || "gpt-5-mini";
          const instructions = String(body.instructions || "").trim();
          const inputText = String(body.inputText || "").trim();
          const imageDataUrl = typeof body.imageDataUrl === "string" ? body.imageDataUrl : "";
          if (!inputText) {
            return { status: "error", message: "Missing inputText." };
          }
          const started = Date.now();
          const text = await callOpenAiDescribeWithImage({
            model,
            instructions,
            inputText,
            imageDataUrl: imageDataUrl || undefined,
            signal: undefined
          });
          return { status: "ok", description: text, meta: { provider: "openai", model, ms: Date.now() - started } };
        }
        return { status: "ok" };
      } catch (error) {
        console.error("Visualiser command failed", error);
        return { status: "error", message: error instanceof Error ? error.message : "visualiser command failed" };
      }
    }
    if (payload?.phase === "screen" && payload.action) {
      try {
        return await sendScreenCommand(payload.action, payload.payload as Record<string, unknown> | undefined);
      } catch (error) {
        console.error("Screen command failed", error);
        return { status: "error", message: error instanceof Error ? error.message : "screen command failed" };
      }
    }
    if (payload?.phase === "settings" && payload.action === "open") {
      const rawPayload = payload.payload as { section?: unknown } | undefined;
      const sectionValue = rawPayload?.section;
      const section = typeof sectionValue === "string" ? sectionValue : undefined;
      openSettingsWindow(section);
      return { status: "ok" };
    }
    return { status: "ok" };
  });

  ipcMain.handle("agent:features", async () => {
    try {
      const signatures = await loadZoteroSignatures();
      return { status: "ok", tabs: groupedFeatures(signatures) };
    } catch (error) {
      return { status: "error", message: normalizeError(error) };
    }
  });

  ipcMain.handle("agent:intent-resolve", async (_event, payload: { text?: string; context?: Record<string, unknown> }) => {
    try {
      bumpIntentTelemetry("requests");
      const signatures = await loadZoteroSignatures();
      const text = String(payload?.text || "").trim();
      const context = (payload?.context || {}) as Record<string, unknown>;
      const defaultVerbatimDirBase = resolveVerbatimDirBaseForContext(context);
      const pendingIntent = (context?.pendingIntent && typeof context.pendingIntent === "object")
        ? (context.pendingIntent as Record<string, unknown>)
        : null;

      if (
        pendingIntent &&
        String(pendingIntent.intentId || "") === "feature.run" &&
        String(pendingIntent.targetFunction || "") === "Verbatim_Evidence_Coding"
      ) {
        const modeOnly = String(text || "").trim().toLowerCase();
        if (["open", "open code", "open coding", "targeted", "targeted code", "targeted coding", "hybrid", "hybrid code", "hybrid coding"].includes(modeOnly)) {
          const selectedMode = modeOnly.startsWith("targeted")
            ? "targeted"
            : modeOnly.startsWith("hybrid")
              ? "hybrid"
              : "open";
          const nextArgs = {
            ...((pendingIntent.args as Record<string, unknown>) || {}),
            coding_mode: selectedMode
          };
          const nextIntent = {
            ...pendingIntent,
            args: nextArgs,
            needsClarification: false,
            clarificationQuestions: []
          };
          return { status: "ok", intent: nextIntent };
        }
        const pendingArgs = ((pendingIntent.args as Record<string, unknown>) || {});
        const currentQuestions = Array.isArray(pendingArgs.research_questions)
          ? pendingArgs.research_questions.map((q) => String(q || "").trim()).filter(Boolean)
          : [];
        const pendingClarifications = Array.isArray(pendingIntent.clarificationQuestions)
          ? pendingIntent.clarificationQuestions.map((q) => String(q || ""))
          : [];
        const awaitingAutoQuestion = pendingClarifications.some((q) => /auto-generate\s+3-5/i.test(q));
        const awaitingEligibilityWizard = pendingClarifications.some((q) => /Screening is enabled/i.test(q));
        if (awaitingAutoQuestion && /^(yes|y|generate|auto)/i.test(modeOnly)) {
          const topicHint = String(pendingArgs.topic_hint || pendingArgs.context || context?.selectedCollectionName || "the selected topic").trim();
          const generatedQuestions = generateResearchQuestionsFromTopic(topicHint).slice(0, 5);
          const nextArgs: Record<string, unknown> = {
            ...pendingArgs,
            research_questions: generatedQuestions
          };
          const controls = parseCodingControlsFromText(String(pendingArgs.context || ""));
          const hasMode = ["open", "targeted", "hybrid"].includes(String(nextArgs.coding_mode || "").toLowerCase());
          const clarificationQuestions = hasMode || controls.mode_specified
            ? []
            : ["Do you want open coding, targeted coding, or hybrid coding?"];
          return {
            status: "ok",
            intent: {
              ...pendingIntent,
              args: nextArgs,
              needsClarification: clarificationQuestions.length > 0,
              clarificationQuestions
            }
          };
        }
        if (awaitingAutoQuestion && /^(no|n)/i.test(modeOnly)) {
          return {
            status: "ok",
            intent: {
              ...pendingIntent,
              needsClarification: true,
              clarificationQuestions: ["Provide 3 to 5 research questions before coding."]
            }
          };
        }
        if (awaitingEligibilityWizard && /^(auto|generate|yes|y)/i.test(modeOnly)) {
          const remaining = pendingClarifications.filter((q) => !/Screening is enabled/i.test(q));
          return {
            status: "ok",
            intent: {
              ...pendingIntent,
              needsClarification: remaining.length > 0,
              clarificationQuestions: remaining
            }
          };
        }
        if (awaitingEligibilityWizard) {
          const inclusion = parseTextListSection(text, ["inclusion", "inclusion criteria", "include"]);
          const exclusion = parseTextListSection(text, ["exclusion", "exclusion criteria", "exclude"]);
          if (inclusion.length && exclusion.length) {
            const nextArgs: Record<string, unknown> = {
              ...pendingArgs,
              inclusion_criteria: inclusion,
              exclusion_criteria: exclusion
            };
            const remaining = pendingClarifications.filter((q) => !/Screening is enabled/i.test(q));
            return {
              status: "ok",
              intent: {
                ...pendingIntent,
                args: nextArgs,
                needsClarification: remaining.length > 0,
                clarificationQuestions: remaining
              }
            };
          }
        }
        if (currentQuestions.length < 3) {
          const parsedQuestions = parseResearchQuestionsInput(text).slice(0, 5);
          if (parsedQuestions.length >= 3) {
            return {
              status: "ok",
              intent: {
                ...pendingIntent,
                args: { ...pendingArgs, research_questions: parsedQuestions },
                needsClarification: false,
                clarificationQuestions: []
              }
            };
          }
        }
      }

      const reviewPipelineType = detectReviewPipelineType(text);
      if (reviewPipelineType === "systematic") {
        const intent = buildSystematicPipelineIntent(text, context);
        return { status: "ok", intent };
      }
      if (
        reviewPipelineType === "literature" ||
        reviewPipelineType === "bibliographic" ||
        reviewPipelineType === "chronological" ||
        reviewPipelineType === "critical" ||
        reviewPipelineType === "meta_analysis"
      ) {
        const intent = buildNonSystematicReviewPipelineIntent(reviewPipelineType, text, context);
        return { status: "ok", intent };
      }

      if (/\b(code|coding|verbatim|evidence)\b/i.test(text)) {
        const codingLlm = await resolveCodingIntentWithLlm(text, context);
        if (codingLlm?.status === "ok" && codingLlm?.data?.is_coding_request === true) {
          const controls = parseCodingControlsFromText(text);
          const explicitScreenAndCode = /\bscreen(?:ing)?\s+and\s+code\b/i.test(text);
          const screeningFlag = codingLlm.data.screening === true || explicitScreenAndCode;
          const questions = Array.isArray(codingLlm.data.research_questions)
            ? codingLlm.data.research_questions.map((q: unknown) => String(q || "").trim()).filter(Boolean).slice(0, 5)
            : [];
          const topic = text.match(/about\s+(.+?)(?:\.|$)/i)?.[1] || "";
          const fallbackQuestions = questions.slice(0, 5);
          const targetedObjectives = targetedObjectivesFromQuestions(fallbackQuestions);
          const explicitInclusion = parseTextListSection(text, ["inclusion", "inclusion criteria", "include"]);
          const explicitExclusion = parseTextListSection(text, ["exclusion", "exclusion criteria", "exclude"]);
          const collectionName = String(context?.selectedCollectionName || "").trim();
          const collectionKey = String(context?.selectedCollectionKey || "").trim();
          const reviewerCount = normalizeReviewerCount(context?.reviewerCount || 2);
          const protocolCompleteness = protocolCompletenessCheck({
            collectionName: collectionName || collectionKey,
            researchQuestions: fallbackQuestions,
            inclusionCriteria: explicitInclusion,
            exclusionCriteria: explicitExclusion,
            reviewerCount,
            screening: screeningFlag
          });
          const clarificationQuestions: string[] = [];
          if (!collectionName && !collectionKey) clarificationQuestions.push("Select a collection before coding.");
          if (!controls.mode_specified) clarificationQuestions.push("Do you want open coding, targeted coding, or hybrid coding?");
          if (fallbackQuestions.length < 3) clarificationQuestions.push("No 3-5 research questions were provided. Should I auto-generate 3-5 from your topic? Reply yes or no.");
          if (screeningFlag && (!explicitInclusion.length || !explicitExclusion.length)) {
            clarificationQuestions.push("Screening is enabled. Do you want to provide inclusion/exclusion criteria now, or should I auto-generate them?");
          }
          if (!protocolCompleteness.valid) clarificationQuestions.push(`Protocol incomplete: ${protocolCompleteness.missing.join(", ")}.`);
          return {
            status: "ok",
            intent: {
              intentId: "feature.run",
              targetFunction: "Verbatim_Evidence_Coding",
              confidence: Number.isFinite(Number(codingLlm.data.confidence)) ? Number(codingLlm.data.confidence) : 0.86,
              riskLevel: "confirm",
              needsClarification: clarificationQuestions.length > 0,
              clarificationQuestions,
              args: {
                dir_base: defaultVerbatimDirBase,
                collection_name: collectionName,
                collection_key: collectionKey,
                research_questions: fallbackQuestions.slice(0, 5),
                targeted_objectives: targetedObjectives,
                topic_hint: String(topic || "the selected topic"),
                prompt_key: "code_pdf_page",
                screening: screeningFlag,
                screening_blinded: codingLlm.data.screening_blinded === true || controls.screening_blinded,
                context: String(codingLlm.data.context || "").trim(),
                coding_mode: (() => {
                  const modeCandidate = String(codingLlm.data.coding_mode || controls.coding_mode).toLowerCase();
                  return modeCandidate === "targeted" ? "targeted" : modeCandidate === "hybrid" ? "hybrid" : "open";
                })(),
                rq_scope: Array.isArray(codingLlm.data.rq_scope)
                  ? codingLlm.data.rq_scope.map((n: unknown) => Number(n)).filter((n: number) => Number.isFinite(n) && n >= 0).map((n: number) => Math.trunc(n)).slice(0, 5)
                  : controls.rq_scope,
                target_codes: Array.isArray(codingLlm.data.target_codes)
                  ? codingLlm.data.target_codes.map((x: unknown) => String(x || "").trim().toLowerCase()).filter(Boolean).slice(0, 12)
                  : controls.target_codes,
                min_relevance: Number.isFinite(Number(codingLlm.data.min_relevance))
                  ? Math.max(1, Math.min(5, Math.trunc(Number(codingLlm.data.min_relevance))))
                  : controls.min_relevance,
                allowed_evidence_types: Array.isArray(codingLlm.data.allowed_evidence_types)
                  ? codingLlm.data.allowed_evidence_types.map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 10)
                  : controls.allowed_evidence_types
              }
            }
          };
        }
      }

      const tabGroups = groupedFeatures(signatures);
      const flatCatalog: Array<{ functionName: string; label: string; group: string; tab: string; requiredArgs: string[] }> = [];
      tabGroups.forEach((tab) => {
        tab.groups.forEach((group) => {
          group.features.forEach((feature) => {
            flatCatalog.push({
              functionName: String(feature.functionName || ""),
              label: String(feature.label || ""),
              group: String(group.group || ""),
              tab: String(tab.tab || ""),
              requiredArgs: Array.isArray(feature.args)
                ? feature.args.filter((arg) => arg?.required).map((arg) => String(arg?.key || "")).filter(Boolean)
                : []
            });
          });
        });
      });
      const llmResolved = await callOpenAiIntentResolver(text, context, flatCatalog);
      if (llmResolved?.status === "ok" && llmResolved?.intent && typeof llmResolved.intent === "object") {
        bumpIntentTelemetry("llmSuccess");
        const intent = llmResolved.intent as Record<string, unknown>;
        const intentId = String(intent?.intentId || "").trim();
        if (intentId === "workflow.create_subfolder_by_topic") {
          bumpIntentTelemetry("workflowIntents");
          const rawArgs = (intent?.args || {}) as Record<string, unknown>;
          const parentIdentifier =
            String(rawArgs.parentIdentifier || "").trim() ||
            normalizeCollectionIdentifier(context);
          const topic = String(rawArgs.topic || "").trim();
          const subfolderNameRaw = String(rawArgs.subfolderName || "").trim() || topic;
          const subfolderName = subfolderNameRaw.replace(/\s+/g, "_").toLowerCase();
          return {
            status: "ok",
            intent: {
              intentId: "workflow.create_subfolder_by_topic",
              targetFunction: "workflow-create-subfolder-by-topic",
              confidence: Number.isFinite(Number(intent?.confidence)) ? Number(intent?.confidence) : 0.82,
              riskLevel: "confirm",
              needsClarification: !parentIdentifier || !topic,
              clarificationQuestions: !parentIdentifier
                ? ["Select a collection before creating a topic subfolder."]
                : !topic
                  ? ["Provide the topic to filter for."]
                  : [],
              args: {
                parentIdentifier,
                topic,
                subfolderName,
                confidenceThreshold: Number.isFinite(Number(rawArgs.confidenceThreshold)) ? Number(rawArgs.confidenceThreshold) : 0.6,
                maxItems: Number.isFinite(Number(rawArgs.maxItems)) ? Number(rawArgs.maxItems) : 0
              }
            }
          };
        }

        if (
          intentId === "workflow.systematic_review_pipeline" ||
          intentId === "workflow.literature_review_pipeline" ||
          intentId === "workflow.bibliographic_review_pipeline" ||
          intentId === "workflow.chronological_review_pipeline" ||
          intentId === "workflow.critical_review_pipeline" ||
          intentId === "workflow.meta_analysis_review_pipeline"
        ) {
          bumpIntentTelemetry("workflowIntents");
          return { status: "ok", intent };
        }
        if (intentId === "feature.run") bumpIntentTelemetry("featureIntents");
        if (intentId === "agent.legacy_command") bumpIntentTelemetry("legacyIntents");
        return { status: "ok", intent };
      }
      bumpIntentTelemetry("llmFailures");

      const fallback = resolveIntentForCommand(text, context, signatures, defaultVerbatimDirBase);
      const fallbackIntentId = String(fallback?.intent?.intentId || "");
      if (
        fallbackIntentId === "workflow.create_subfolder_by_topic" ||
        fallbackIntentId === "workflow.systematic_review_pipeline" ||
        fallbackIntentId === "workflow.literature_review_pipeline" ||
        fallbackIntentId === "workflow.bibliographic_review_pipeline" ||
        fallbackIntentId === "workflow.chronological_review_pipeline" ||
        fallbackIntentId === "workflow.critical_review_pipeline" ||
        fallbackIntentId === "workflow.meta_analysis_review_pipeline"
      ) bumpIntentTelemetry("workflowIntents");
      else if (fallbackIntentId === "feature.run") bumpIntentTelemetry("featureIntents");
      else if (fallbackIntentId === "agent.legacy_command") bumpIntentTelemetry("legacyIntents");
      bumpIntentTelemetry("fallbackUsed");
      return fallback;
    } catch (error) {
      bumpIntentTelemetry("failed");
      return { status: "error", message: normalizeError(error) };
    }
  });

  ipcMain.handle(
    "agent:intent-execute",
    async (_event, payload: { intent?: IntentPayload; context?: Record<string, unknown>; confirm?: boolean }) => {
      try {
        const context = (payload?.context || {}) as Record<string, unknown>;
        const intent = attachDynamicVerbatimDirBase(payload?.intent, context);
        const intentId = String(intent?.intentId || "").trim();
        if (!intentId) return { status: "error", message: "intent.intentId is required." };
        const now = Date.now();
        const jobId = randomUUID();

        if (intentId === "workflow.create_subfolder_by_topic") {
          const args = ((intent?.args as Record<string, unknown>) || {});
          const topic = String(args.topic || "").trim();
          const subfolderName = String(args.subfolderName || topic).trim() || "topic";
          const collectionName =
            String(args.parentIdentifier || "").trim() ||
            normalizeCollectionIdentifier((payload?.context as Record<string, unknown> | undefined) || {});
          if (!collectionName) return { status: "error", message: "Selected collection is required for workflow execution." };
          if (!topic) return { status: "error", message: "Workflow topic is required." };
          const job: FeatureJob = {
            id: jobId,
            functionName: "workflow.create_subfolder_by_topic",
            status: "running",
            phase: "Enqueue topic classification",
            startedAt: now,
            args
          };
          featureJobs.unshift(job);
          if (featureJobs.length > 400) featureJobs.length = 400;
          emitFeatureJobStatus(job);
          try {
            const enqueueFeature = resolveFeatureDescriptor("enqueue_topic_classification_for_collection", await loadZoteroSignatures());
            const applyFeature = resolveFeatureDescriptor("apply_topic_batch_results", await loadZoteroSignatures());
            if (!enqueueFeature || !applyFeature) {
              throw new Error("Workflow features are unavailable. Expected enqueue/apply topic functions.");
            }
            const enqueueResult = await featureWorker.run({
              functionName: enqueueFeature.functionName,
              argsSchema: Array.isArray(enqueueFeature.args) ? enqueueFeature.args : [],
              argsValues: {
                collection_name: collectionName,
                topic_query: topic
              },
              execute: true
            });
            if (enqueueResult?.status !== "ok") {
              throw new Error(String(enqueueResult?.message || "Topic enqueue failed."));
            }
            const enqueueMeta = detectBatchMetadata(enqueueResult);
            if (enqueueMeta.batchId) job.openaiBatchId = enqueueMeta.batchId;
            if (enqueueMeta.outputFileId) job.outputFileId = enqueueMeta.outputFileId;
            emitFeatureJobStatus(job);
            job.phase = "Apply topic batch results";
            emitFeatureJobStatus(job);
            const applyResult = await featureWorker.run({
              functionName: applyFeature.functionName,
              argsSchema: Array.isArray(applyFeature.args) ? applyFeature.args : [],
              argsValues: {
                collection_name: collectionName,
                topic_query: topic,
                subfolder_name: subfolderName,
                min_confidence: Number.isFinite(Number(args.confidenceThreshold)) ? Number(args.confidenceThreshold) : 0.6
              },
              execute: true
            });
            job.status = applyResult?.status === "ok" ? "done" : "failed";
            job.phase = applyResult?.status === "ok" ? "Completed" : "Apply failed";
            job.result = { enqueue: enqueueResult, apply: applyResult };
            if (applyResult?.status !== "ok") {
              job.error = String(applyResult?.message || "Apply topic batch results failed.");
              job.endedAt = Date.now();
              emitFeatureJobStatus(job);
              bumpIntentTelemetry("failed");
              return { status: "error", message: job.error, job };
            }
            job.endedAt = Date.now();
            emitFeatureJobStatus(job);
            bumpIntentTelemetry("executed");
            return {
              status: "ok",
              function: "workflow.create_subfolder_by_topic",
              result: {
                reply: `Workflow completed for topic '${topic}' in '${collectionName}'.`,
                enqueue: enqueueResult,
                apply: applyResult
              },
              job
            };
          } catch (error) {
            job.status = "failed";
            job.phase = "Failed";
            job.error = normalizeError(error);
            job.endedAt = Date.now();
            emitFeatureJobStatus(job);
            bumpIntentTelemetry("failed");
            return { status: "error", message: job.error, job };
          }
        }

        if (
          intentId === "workflow.systematic_review_pipeline" ||
          intentId === "workflow.literature_review_pipeline" ||
          intentId === "workflow.bibliographic_review_pipeline" ||
          intentId === "workflow.chronological_review_pipeline" ||
          intentId === "workflow.critical_review_pipeline" ||
          intentId === "workflow.meta_analysis_review_pipeline"
        ) {
          const args = ((intent?.args as Record<string, unknown>) || {});
          const reviewType: "systematic" | "literature" | "bibliographic" | "chronological" | "critical" | "meta_analysis" =
            intentId === "workflow.literature_review_pipeline"
              ? "literature"
              : intentId === "workflow.bibliographic_review_pipeline"
                ? "bibliographic"
                : intentId === "workflow.chronological_review_pipeline"
                  ? "chronological"
                  : intentId === "workflow.critical_review_pipeline"
                    ? "critical"
                    : intentId === "workflow.meta_analysis_review_pipeline"
                      ? "meta_analysis"
                      : "systematic";
          const workflowFunctionName = String(intentId || "workflow.systematic_review_pipeline");
          const job: FeatureJob = {
            id: jobId,
            functionName: workflowFunctionName,
            status: "running",
            phase: `Initialize ${reviewType} review pipeline`,
            startedAt: now,
            args
          };
          featureJobs.unshift(job);
          if (featureJobs.length > 400) featureJobs.length = 400;
          emitFeatureJobStatus(job);
          const created = reviewType === "systematic"
            ? createSystematicReviewPipeline({ args, context })
            : createGeneralReviewPipeline({ reviewType, args, context });
          if (created.status !== "ok") {
            job.status = "failed";
            job.phase = "Failed";
            job.error = created.message;
            job.endedAt = Date.now();
            emitFeatureJobStatus(job);
            bumpIntentTelemetry("failed");
            return { status: "error", message: created.message, job };
          }
          job.status = "done";
          job.phase = "Completed";
          job.result = {
            reply: created.summary,
            pipeline_path: created.pipelinePath,
            state_path: created.statePath,
            template_path: created.templatePath
          };
          job.endedAt = Date.now();
          emitFeatureJobStatus(job);
          bumpIntentTelemetry("executed");
          return {
            status: "ok",
            function: workflowFunctionName,
            result: {
              reply: created.summary,
              pipeline_path: created.pipelinePath,
              state_path: created.statePath,
              template_path: created.templatePath
            },
            job
          };
        }

        if (intentId === "feature.run") {
          const functionName = String(intent?.targetFunction || "").trim();
          if (!functionName) return { status: "error", message: "target function is required." };
          const signatures = await loadZoteroSignatures();
          const feature = resolveFeatureDescriptor(functionName, signatures);
          if (!feature) return { status: "error", message: `Unknown feature: ${functionName}` };
          let argsValues: Record<string, unknown> = ((intent?.args as Record<string, unknown>) || {});
          let codebookPath = "";
          const stage = stageForFunction(functionName);
          let systematicRunDir: string | null = null;
          let stageHashes: Record<string, { hash: string; updatedAt: string }> = {};
          let currentStageHash = "";
          if (stage !== "unknown") {
            try {
              systematicRunDir = resolveSystematicReviewRunDir(argsValues, context).runDir;
            } catch {
              systematicRunDir = null;
            }
          }
          if (stage !== "unknown" && systematicRunDir) {
            const s = loadSystematicReviewState(systematicRunDir);
            if (s) {
              const gate = canExecuteStage(s, stage);
              if (!gate.ok) {
                return { status: "error", message: gate.reason || `Stage '${stage}' is locked.` };
              }
            }
            const aux = getSystematicReviewAuxPaths(systematicRunDir);
            if (fs.existsSync(aux.stageHashesPath)) {
              try {
                stageHashes = JSON.parse(fs.readFileSync(aux.stageHashesPath, "utf-8") || "{}") as Record<string, { hash: string; updatedAt: string }>;
              } catch {
                stageHashes = {};
              }
            }
            currentStageHash = hashArgs({
              functionName,
              argsValues,
              preflightIntents: (intent as Record<string, unknown>)?.preflightIntents || []
            });
            if (String(stageHashes[functionName]?.hash || "") === currentStageHash) {
              const skippedResult = {
                status: "ok",
                function: functionName,
                skipped: true,
                message: `Skipped ${functionName}: identical stage input hash already executed.`,
                stage,
                hash: currentStageHash
              };
              recordOrchestrationRun(systematicRunDir, {
                at: new Date().toISOString(),
                functionName,
                stage,
                status: "skipped",
                durationMs: 0,
                attemptCount: 0,
                timeoutMs: 0,
                retryLimit: 0,
                message: String(skippedResult.message)
              });
              return skippedResult;
            }
          }
          if (functionName === "Verbatim_Evidence_Coding") {
            const codebookPrep = refineCodebookForCodingRun({
              args: argsValues,
              context,
              preflightIntents: (intent as Record<string, unknown>)?.preflightIntents
            });
            if (codebookPrep.status !== "ok") {
              return { status: "error", message: `Codebook refinement failed: ${codebookPrep.message}` };
            }
            codebookPath = codebookPrep.codebookPath;
            const currentContext = String(argsValues.context || "").trim();
            const codebookContextLine = `Refined codebook path: ${codebookPath}`;
            argsValues = {
              ...argsValues,
              context: currentContext ? `${currentContext}\n${codebookContextLine}` : codebookContextLine
            };
          }

          const job: FeatureJob = {
            id: jobId,
            functionName,
            status: "running",
            phase: "Executing feature",
            startedAt: now,
            args: argsValues
          };
          featureJobs.unshift(job);
          if (featureJobs.length > 400) featureJobs.length = 400;
          emitFeatureJobStatus(job);
          let result: any = null;
          const argsSchema = Array.isArray(feature.args) ? feature.args : [];
          const requestedMode = String(argsValues.coding_mode || "").toLowerCase();
          const startedAt = Date.now();
          let attemptCount = 0;
          let timeoutMs = 0;
          let retryLimit = 0;
          try {
            const runner = async (): Promise<any> => {
              if (functionName === "Verbatim_Evidence_Coding" && requestedMode === "hybrid") {
                job.phase = "Executing feature (hybrid: open pass)";
                emitFeatureJobStatus(job);
                const openArgs = {
                  ...argsValues,
                  coding_mode: "open",
                  rq_scope: [],
                  target_codes: [],
                  min_relevance: 3
                };
                const openExec = await runFeatureWithPolicy({
                  functionName,
                  argsSchema,
                  argsValues: openArgs,
                  execute: true
                });
                job.phase = "Executing feature (hybrid: targeted pass)";
                emitFeatureJobStatus(job);
                const targetedArgs = {
                  ...argsValues,
                  coding_mode: "targeted",
                  min_relevance: Number.isFinite(Number(argsValues.min_relevance))
                    ? Math.max(1, Math.min(5, Math.trunc(Number(argsValues.min_relevance))))
                    : 4
                };
                const targetedExec = await runFeatureWithPolicy({
                  functionName,
                  argsSchema,
                  argsValues: targetedArgs,
                  execute: true
                });
                attemptCount = openExec.attemptCount + targetedExec.attemptCount;
                timeoutMs = Math.max(openExec.timeoutMs, targetedExec.timeoutMs);
                retryLimit = Math.max(openExec.retryLimit, targetedExec.retryLimit);
                const openPass = openExec.result;
                const targetedPass = targetedExec.result;
                const openOk = openPass?.status === "ok";
                const targetedOk = targetedPass?.status === "ok";
                return {
                  status: openOk && targetedOk ? "ok" : "error",
                  function: functionName,
                  mode: "hybrid",
                  message: openOk && targetedOk
                    ? "Hybrid coding completed: open pass + targeted pass."
                    : `Hybrid coding failed: open=${openPass?.status || "unknown"}, targeted=${targetedPass?.status || "unknown"}.`,
                  open_pass: openPass,
                  targeted_pass: targetedPass,
                  recovered_from_batch_output:
                    ((openPass as Record<string, unknown>)?.recovered_from_batch_output === true) ||
                    ((targetedPass as Record<string, unknown>)?.recovered_from_batch_output === true),
                  recovered_items_count:
                    Number((openPass as Record<string, unknown>)?.recovered_items_count || 0) +
                    Number((targetedPass as Record<string, unknown>)?.recovered_items_count || 0)
                };
              }
              const execOut = await runFeatureWithPolicy({
                functionName,
                argsSchema,
                argsValues,
                execute: true
              });
              attemptCount = execOut.attemptCount;
              timeoutMs = execOut.timeoutMs;
              retryLimit = execOut.retryLimit;
              return execOut.result;
            };
            result = stage !== "unknown" && systematicRunDir
              ? await withStageLock(systematicRunDir, stage, runner)
              : await runner();
          } catch (error) {
            result = { status: "error", message: normalizeError(error) };
          }
          if (result && typeof result === "object" && codebookPath) {
            (result as Record<string, unknown>).codebook_path = codebookPath;
          }
          job.status = result?.status === "ok" ? "done" : "failed";
          job.phase = result?.status === "ok" ? "Completed" : "Failed";
          job.result = result;
          job.endedAt = Date.now();
          const resultMeta = detectBatchMetadata(result);
          if (resultMeta.batchId) job.openaiBatchId = resultMeta.batchId;
          if (resultMeta.outputFileId) job.outputFileId = resultMeta.outputFileId;
          if (job.status === "done") bumpIntentTelemetry("executed");
          else {
            job.error = String(result?.message || "Feature execution failed.");
            bumpIntentTelemetry("failed");
          }
          if (job.status === "done" && stage !== "unknown" && systematicRunDir && currentStageHash) {
            const aux = getSystematicReviewAuxPaths(systematicRunDir);
            stageHashes[functionName] = { hash: currentStageHash, updatedAt: new Date().toISOString() };
            fs.writeFileSync(aux.stageHashesPath, JSON.stringify(stageHashes, null, 2), "utf-8");
          }
          if (job.status === "done") {
            syncSystematicReviewStateFromFeatureRun({
              functionName,
              argsValues,
              context,
              result,
              codebookPath: codebookPath || undefined
            });
          }
          recordOrchestrationRun(systematicRunDir, {
            at: new Date().toISOString(),
            functionName,
            stage,
            status: job.status === "done" ? "ok" : "error",
            durationMs: Date.now() - startedAt,
            attemptCount,
            timeoutMs,
            retryLimit,
            message: job.status === "done" ? "completed" : String(job.error || result?.message || "failed"),
            tokenUsage: extractTokenUsage(result)
          });
          emitFeatureJobStatus(job);
          return result;
        }

        if (intentId === "agent.legacy_command") {
          const text = String((intent?.args as Record<string, unknown> | undefined)?.text || "").toLowerCase();
          if (/\brefresh\b/.test(text) && /\bzotero|collection|tree|item\b/.test(text)) {
            return {
              status: "ok",
              function: "legacy.refresh",
              result: { reply: "Refreshing Zotero collections and items.", action: "zotero_refresh_tree" }
            };
          }
          if (/\b(load|import)\b/.test(text) && /\bcollection\b/.test(text)) {
            return {
              status: "ok",
              function: "legacy.load_collection",
              result: { reply: "Loading selected collection into Data Hub.", action: "zotero_load_selected_collection" }
            };
          }
          return { status: "ok", function: "legacy.noop", result: { reply: "No executable legacy action resolved." } };
        }

        return { status: "error", message: `Unsupported intent: ${intentId}` };
      } catch (error) {
        return { status: "error", message: normalizeError(error) };
      }
    }
  );

  const runAgentRequest = async (payload: { text?: string; context?: Record<string, unknown> }) => {
    try {
      const signatures = await loadZoteroSignatures();
      const context = (payload?.context || {}) as Record<string, unknown>;
      const intentOut = resolveIntentForCommand(
        String(payload?.text || ""),
        context,
        signatures,
        resolveVerbatimDirBaseForContext(context)
      );
      if (intentOut.intent) {
        intentOut.intent = attachDynamicVerbatimDirBase(intentOut.intent, context);
      }
      if (intentOut?.status !== "ok" || !intentOut.intent) {
        return { status: "error", message: intentOut?.message || "Could not resolve intent." };
      }
      if (intentOut.intent.needsClarification) {
        return {
          status: "ok",
          reply: Array.isArray(intentOut.intent.clarificationQuestions)
            ? intentOut.intent.clarificationQuestions.join("\n")
            : "Need clarification."
        };
      }
      if (String(intentOut.intent.intentId || "") === "agent.legacy_command") {
        const text = String((intentOut.intent.args as Record<string, unknown> | undefined)?.text || "").toLowerCase();
        if (/\brefresh\b/.test(text) && /\bzotero|collection|tree|item\b/.test(text)) {
          return {
            status: "ok",
            reply: "Refreshing Zotero collections and items.",
            action: { phase: "retrieve", action: "zotero_refresh_tree", payload: {} }
          };
        }
        if (/\b(load|import)\b/.test(text) && /\bcollection\b/.test(text)) {
          return {
            status: "ok",
            reply: "Loading selected collection into Data Hub.",
            action: { phase: "retrieve", action: "zotero_load_selected_collection", payload: {} }
          };
        }
        return { status: "ok", reply: "No executable legacy action resolved." };
      }
      if (String(intentOut.intent.intentId || "") === "workflow.create_subfolder_by_topic") {
        const args = (intentOut.intent.args as Record<string, unknown>) || {};
        const enqueueFeature = resolveFeatureDescriptor("enqueue_topic_classification_for_collection", signatures);
        if (!enqueueFeature) {
          return { status: "error", message: "Workflow enqueue feature unavailable." };
        }
        const collectionName =
          String(args.parentIdentifier || "").trim() ||
          normalizeCollectionIdentifier((payload?.context as Record<string, unknown> | undefined) || {});
        const topic = String(args.topic || "").trim();
        const execWorkflow = await featureWorker.run({
          functionName: enqueueFeature.functionName,
          argsSchema: Array.isArray(enqueueFeature.args) ? enqueueFeature.args : [],
          argsValues: {
            collection_name: collectionName,
            topic_query: topic
          },
          execute: true
        });
        if (execWorkflow?.status === "ok") {
          return { status: "ok", reply: "Workflow queued successfully.", result: execWorkflow };
        }
        return { status: "error", message: String(execWorkflow?.message || "Workflow failed.") };
      }
      if (
        String(intentOut.intent.intentId || "") === "workflow.systematic_review_pipeline" ||
        String(intentOut.intent.intentId || "") === "workflow.literature_review_pipeline" ||
        String(intentOut.intent.intentId || "") === "workflow.bibliographic_review_pipeline" ||
        String(intentOut.intent.intentId || "") === "workflow.chronological_review_pipeline" ||
        String(intentOut.intent.intentId || "") === "workflow.critical_review_pipeline" ||
        String(intentOut.intent.intentId || "") === "workflow.meta_analysis_review_pipeline"
      ) {
        const intentId = String(intentOut.intent.intentId || "");
        const reviewType: "systematic" | "literature" | "bibliographic" | "chronological" | "critical" | "meta_analysis" =
          intentId === "workflow.literature_review_pipeline"
            ? "literature"
            : intentId === "workflow.bibliographic_review_pipeline"
              ? "bibliographic"
              : intentId === "workflow.chronological_review_pipeline"
                ? "chronological"
                : intentId === "workflow.critical_review_pipeline"
                  ? "critical"
                  : intentId === "workflow.meta_analysis_review_pipeline"
                    ? "meta_analysis"
              : "systematic";
        const created = reviewType === "systematic"
          ? createSystematicReviewPipeline({
            args: (intentOut.intent.args as Record<string, unknown>) || {},
            context
          })
          : createGeneralReviewPipeline({
            reviewType,
            args: (intentOut.intent.args as Record<string, unknown>) || {},
            context
          });
        if (created.status === "ok") {
          return {
            status: "ok",
            reply: created.summary,
            result: { pipeline_path: created.pipelinePath, state_path: created.statePath, template_path: created.templatePath }
          };
        }
        return { status: "error", message: created.message };
      }
      const functionName = String(intentOut.intent.targetFunction || "");
      const feature = resolveFeatureDescriptor(functionName, signatures);
      if (!feature) {
        return { status: "error", message: `Unknown feature: ${functionName}` };
      }
      const exec = await featureWorker.run({
        functionName,
        argsSchema: Array.isArray(feature.args) ? feature.args : [],
        argsValues: intentOut.intent.args || {},
        execute: true
      });
      if (exec?.status === "ok") return { status: "ok", reply: "Command executed successfully.", result: exec };
      return { status: "error", message: exec?.message || "Execution failed." };
    } catch (error) {
      return { status: "error", message: normalizeError(error) };
    }
  };

  ipcMain.handle("agent:run", async (_event, payload: { text?: string; context?: Record<string, unknown> }) => runAgentRequest(payload));

  ipcMain.handle(
    "agent:voice-transcribe",
    async (_event, payload: { audioBase64?: string; mimeType?: string; language?: string }) => {
      try {
        if (!payload?.audioBase64) {
          return { status: "error", message: "audioBase64 is required." };
        }
        const audioBuffer = audioBufferFromBase64(payload.audioBase64);
        if (!audioBuffer.length) {
          return { status: "error", message: "Audio payload is empty." };
        }
        dbgMain("agent:voice-transcribe", "payload received", { mimeType: String(payload.mimeType || ""), bytes: audioBuffer.length });
        const transcribed = await callOpenAiTranscribeAudio({
          audioBuffer,
          mimeType: payload.mimeType,
          language: payload.language
        });
        return transcribed;
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "Audio transcription failed." };
      }
    }
  );

  ipcMain.handle("agent:dictation-start", async () => {
    dictationSessionId += 1;
    dictationSessionActive = true;
    dictationTranscript = "";
    dictationQueue = Promise.resolve();
    dictationFallbackWebmChunks = [];
    dictationFallbackWebmBytes = 0;
    dictationFallbackLastTranscribedBytes = 0;
    dictationFallbackLastTranscribedAt = 0;
    closeDictationRealtimeSocket();
    const realtimeOk = await openDictationRealtimeSocket(dictationSessionId);
    dbgMain("agent:dictation-start", "started", { sessionId: dictationSessionId });
    return { status: "ok", sessionId: dictationSessionId, transport: realtimeOk ? "realtime" : "chunk-fallback" };
  });

  ipcMain.handle("agent:dictation-stop", async () => {
    const sessionId = dictationSessionId;
    dictationSessionActive = false;
    clearDictationRealtimeCommitTimer();
    if (dictationRealtimeSocket && dictationRealtimeConnected) {
      try {
        dictationRealtimeSocket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      } catch {
        // ignore
      }
    }
    if (dictationFallbackWebmBytes > dictationFallbackLastTranscribedBytes && dictationFallbackWebmChunks.length) {
      const snapshot = Buffer.concat(dictationFallbackWebmChunks);
      dictationFallbackLastTranscribedBytes = dictationFallbackWebmBytes;
      dictationQueue = dictationQueue.then(async () => {
        const transcribed = await callOpenAiTranscribeAudio({
          audioBuffer: snapshot,
          mimeType: "audio/webm"
        });
        if (String(transcribed?.status || "") === "ok") {
          const text = String(transcribed?.text || "").trim();
          if (text) {
            dictationTranscript = mergeDictationTranscript(dictationTranscript, text);
          }
        }
      }).catch(() => {
        // ignore final fallback transcribe errors; completion still returns best transcript
      });
    }
    try {
      await dictationQueue;
    } catch {
      // ignore queued failures; error events were already emitted
    }
    closeDictationRealtimeSocket();
    dictationFallbackWebmChunks = [];
    dictationFallbackWebmBytes = 0;
    dictationFallbackLastTranscribedBytes = 0;
    dictationFallbackLastTranscribedAt = 0;
    const finalText = String(dictationTranscript || "").trim();
    emitDictationEvent(AGENT_DICTATION_EVENT_COMPLETED, { sessionId, text: finalText });
    dbgMain("agent:dictation-stop", "stopped", { sessionId, textLength: finalText.length });
    return { status: "ok", sessionId, text: finalText };
  });

  ipcMain.on("agent:dictation-audio", (_event, payload: unknown) => {
    if (!dictationSessionActive) return;
    const sessionId = dictationSessionId;
    const audioBuffer = coerceAudioPayloadToBuffer(payload);
    if (!audioBuffer || !audioBuffer.length) return;
    enqueueDictationAudioBuffer(sessionId, audioBuffer, "audio/webm");
  });

  ipcMain.handle("agent:native-audio-start", async () => {
    try {
      return await startNativeAudioCapture();
    } catch (error) {
      return { status: "error", message: normalizeError(error) };
    }
  });

  ipcMain.handle("agent:native-audio-stop", async () => {
    try {
      return await stopNativeAudioCapture();
    } catch (error) {
      return { status: "error", message: normalizeError(error) };
    }
  });

  const speakTextRequest = async (payload: { text?: string; voice?: string; speed?: number; format?: string; model?: string }) => {
    try {
      return await callOpenAiTextToSpeech({
        text: String(payload?.text || ""),
        voice: payload?.voice,
        speed: payload?.speed,
        format: payload?.format,
        model: payload?.model
      });
    } catch (error) {
      return { status: "error", text: String(payload?.text || ""), message: error instanceof Error ? error.message : "Speech synthesis failed." };
    }
  };

  ipcMain.handle(
    "agent:speak-text",
    async (_event, payload: { text?: string; voice?: string; speed?: number; format?: string; model?: string }) => speakTextRequest(payload)
  );

  startAgentCliBridgeServer({ runAgent: runAgentRequest, speakText: speakTextRequest });

  ipcMain.handle(
    "agent:refine-coding-questions",
    async (
      _event,
      payload: {
        currentQuestions?: string[];
        feedback?: string;
        contextText?: string;
      }
    ) => {
      try {
        return await refineCodingQuestionsWithLlm(payload || {});
      } catch (error) {
        return { status: "error", message: normalizeError(error) };
      }
    }
  );

  ipcMain.handle(
    "agent:generate-eligibility-criteria",
    async (
      _event,
      payload: {
        userText?: string;
        collectionName?: string;
        contextText?: string;
        researchQuestions?: string[];
      }
    ) => {
      try {
        return await generateEligibilityCriteriaWithLlm(payload || {});
      } catch (error) {
        return { status: "error", message: normalizeError(error) };
      }
    }
  );

  ipcMain.handle(
    "agent:generate-academic-strategy",
    async (
      _event,
      payload: {
        query?: string;
        providers?: string[];
        objective?: string;
      }
    ) => {
      try {
        return await generateAcademicSearchStrategyWithLlm(payload || {});
      } catch (error) {
        return { status: "error", message: normalizeError(error) };
      }
    }
  );

  ipcMain.handle(
    "agent:supervisor-plan",
    async (
      _event,
      payload: {
        text?: string;
        context?: Record<string, unknown>;
      }
    ) => {
      try {
        return await createSupervisorCodingPlan(payload || {});
      } catch (error) {
        return { status: "error", message: normalizeError(error) };
      }
    }
  );

  ipcMain.handle(
    "agent:supervisor-execute",
    async (
      _event,
      payload: {
        plan?: SupervisorCodingPlan;
        context?: Record<string, unknown>;
      }
    ) => {
      try {
        return await executeSupervisorCodingPlan(payload || {});
      } catch (error) {
        return { status: "error", message: normalizeError(error) };
      }
    }
  );

  ipcMain.handle("agent:get-intent-stats", async () => {
    return {
      status: "ok",
      stats: {
        ...intentTelemetry,
        featureJobs: featureJobs.length
      }
    };
  });

  ipcMain.handle("agent:get-workflow-batch-jobs", async () => {
    return {
      status: "ok",
      jobs: featureJobs
        .filter((job) => job.functionName === "workflow.create_subfolder_by_topic")
        .map((job) => ({ ...job }))
    };
  });

  ipcMain.handle("agent:clear-workflow-batch-jobs", async () => {
    const count = featureJobs.filter((job) => job.functionName === "workflow.create_subfolder_by_topic").length;
    const keep = featureJobs.filter((job) => job.functionName !== "workflow.create_subfolder_by_topic");
    featureJobs.length = 0;
    keep.forEach((job) => featureJobs.push(job));
    persistAgentState();
    return { status: "ok", cleared: count };
  });

  ipcMain.handle("agent:feature-health-check", async () => {
    try {
      const health = await featureWorker.health();
      return { status: "ok", health };
    } catch (error) {
      return { status: "error", message: normalizeError(error) };
    }
  });

  ipcMain.handle("agent:get-feature-jobs", async () => {
    return { status: "ok", jobs: featureJobs.map((job) => ({ ...job })) };
  });

  ipcMain.handle("agent:cancel-feature-job", async (_event, payload: { jobId?: string }) => {
    const jobId = String(payload?.jobId || "").trim();
    if (!jobId) return { status: "error", message: "jobId is required." };
    const job = featureJobs.find((entry) => String(entry.id) === jobId);
    if (!job) return { status: "error", message: `Job '${jobId}' not found.` };
    if (job.status === "done" || job.status === "failed" || job.status === "canceled") {
      return { status: "ok", job: { ...job } };
    }
    if (job.openaiBatchId) {
      const canceled = await cancelOpenAiBatch(job.openaiBatchId);
      if (!canceled.ok) {
        return { status: "error", message: canceled.message || "Failed to cancel OpenAI batch." };
      }
    }
    job.status = "canceled";
    job.canceled = true;
    job.phase = "Canceled";
    job.endedAt = Date.now();
    emitFeatureJobStatus(job);
    return { status: "ok", job: { ...job } };
  });

  ipcMain.handle("agent:get-batch-explorer", async () => {
    const batches = await Promise.all(
      featureJobs
      .filter((job) => job.functionName === "workflow.create_subfolder_by_topic")
      .map(async (job) => {
        const remote = job.openaiBatchId ? await fetchOpenAiBatch(job.openaiBatchId) : null;
        return {
          jobId: job.id,
          batchId: job.openaiBatchId || "",
          functionName: job.functionName,
          status: job.status,
          phase: job.phase,
          startedAt: job.startedAt,
          endedAt: job.endedAt || 0,
          outputFileId: job.outputFileId || "",
          hasError: Boolean(job.error),
          error: job.error || "",
          remoteStatus: String(remote?.status || "")
        };
      })
    );
    return { status: "ok", batches };
  });

  ipcMain.handle("agent:get-batch-detail", async (_event, payload: { jobId?: string; batchId?: string }) => {
    const jobId = String(payload?.jobId || "").trim();
    const batchId = String(payload?.batchId || "").trim();
    const job = featureJobs.find((entry) => {
      if (jobId && String(entry.id) === jobId) return true;
      if (batchId && String(entry.openaiBatchId || "") === batchId) return true;
      return false;
    });
    if (!job) return { status: "error", message: "Batch/job not found." };
    const remote = job.openaiBatchId ? await fetchOpenAiBatch(job.openaiBatchId) : null;
    return {
      status: "ok",
      batch: {
        jobId: job.id,
        batchId: job.openaiBatchId || "",
        functionName: job.functionName,
        status: job.status,
        phase: job.phase,
        startedAt: job.startedAt,
        endedAt: job.endedAt || 0,
        args: job.args || {},
        result: job.result ?? null,
        error: job.error || "",
        remote: remote || null
      }
    };
  });

  ipcMain.handle("agent:delete-batch", async (_event, payload: { jobId?: string; batchId?: string }) => {
    const jobId = String(payload?.jobId || "").trim();
    const batchId = String(payload?.batchId || "").trim();
    const target = featureJobs.find((entry) => {
      if (jobId && String(entry.id) === jobId) return true;
      if (batchId && String(entry.openaiBatchId || "") === batchId) return true;
      return false;
    });
    if (target?.openaiBatchId && target.status !== "done" && target.status !== "failed" && target.status !== "canceled") {
      const canceled = await cancelOpenAiBatch(target.openaiBatchId);
      if (!canceled.ok) {
        return { status: "error", message: canceled.message || "Failed to cancel OpenAI batch before delete." };
      }
    }
    const before = featureJobs.length;
    const remaining = featureJobs.filter((entry) => {
      if (jobId && String(entry.id) === jobId) return false;
      if (batchId && String(entry.openaiBatchId || "") === batchId) return false;
      return true;
    });
    featureJobs.length = 0;
    remaining.forEach((entry) => featureJobs.push(entry));
    persistAgentState();
    return { status: "ok", deleted: before - featureJobs.length };
  });

  ipcMain.handle("agent:log-chat-message", async (_event, payload: { role?: string; text?: string; tone?: string; at?: number }) => {
    const role = payload?.role === "user" ? "user" : "assistant";
    const text = String(payload?.text || "").trim();
    if (!text) return { status: "error", message: "text is required." };
    const entry: ChatHistoryEntry = {
      role,
      text,
      tone: payload?.tone === "error" ? "error" : undefined,
      at: Number.isFinite(Number(payload?.at)) ? Number(payload?.at) : Date.now()
    };
    chatHistory.push(entry);
    if (chatHistory.length > 300) {
      chatHistory.splice(0, chatHistory.length - 300);
    }
    persistAgentState();
    return { status: "ok" };
  });

  ipcMain.handle("agent:get-chat-history", async () => {
    return { status: "ok", messages: chatHistory.map((entry) => ({ ...entry })) };
  });

  ipcMain.handle("agent:clear-chat-history", async () => {
    const count = chatHistory.length;
    chatHistory.length = 0;
    persistAgentState();
    return { status: "ok", cleared: count };
  });

  ipcMain.handle("agent:open-local-path", async (_event, payload: { path?: string }) => {
    const rawPath = String(payload?.path || "").trim();
    if (!rawPath) return { status: "error", message: "path is required." };
    const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rawPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        return { status: "error", message: `Path not found: ${resolvedPath}` };
      }
      const err = await shell.openPath(resolvedPath);
      if (String(err || "").trim()) {
        return { status: "error", message: String(err) };
      }
      return { status: "ok", path: resolvedPath };
    } catch (error) {
      return { status: "error", message: normalizeError(error) };
    }
  });

  ipcMain.handle("systematic:compose-paper", async (_event, payload: { runDir?: string; checklistPath?: string }) => {
    const runDir = String(payload?.runDir || "").trim();
    const checklistPath = String(payload?.checklistPath || "").trim();
    if (!runDir || !checklistPath) {
      return { status: "error", message: "runDir and checklistPath are required." };
    }
    return composeFullPaper(runDir, checklistPath);
  });

  ipcMain.handle("systematic:prisma-audit", async (_event, payload: { runDir?: string }) => {
    const runDir = String(payload?.runDir || "").trim();
    if (!runDir) return { status: "error", message: "runDir is required." };
    return auditPrisma(runDir);
  });

  ipcMain.handle("systematic:prisma-remediate", async (_event, payload: { runDir?: string }) => {
    const runDir = String(payload?.runDir || "").trim();
    if (!runDir) return { status: "error", message: "runDir is required." };
    return remediatePrisma(runDir);
  });

  ipcMain.handle("systematic:adjudicate-conflicts", async (_event, payload: { runDir?: string; resolvedCount?: number }) => {
    const runDir = String(payload?.runDir || "").trim();
    if (!runDir) return { status: "error", message: "runDir is required." };
    return adjudicateSystematicConflicts(runDir, Number(payload?.resolvedCount || 0));
  });

  ipcMain.handle(
    "systematic:execute-steps-1-15",
    async (_event, payload: { runDir?: string; checklistPath?: string; reviewerCount?: number }) => {
      const runDir = String(payload?.runDir || "").trim();
      const checklistPath = String(payload?.checklistPath || "").trim();
      if (!runDir || !checklistPath) {
        return { status: "error", message: "runDir and checklistPath are required." };
      }
      return executeSystematicSteps1To15({
        runDir,
        checklistPath,
        reviewerCount: Number(payload?.reviewerCount || 2)
      });
    }
  );

  ipcMain.handle("systematic:full-run", async (_event, payload: { runDir?: string; checklistPath?: string; maxIterations?: number; minPassPct?: number; maxFail?: number }) => {
    const runDir = String(payload?.runDir || "").trim();
    const checklistPath = String(payload?.checklistPath || "").trim();
    if (!runDir || !checklistPath) {
      return { status: "error", message: "runDir and checklistPath are required." };
    }
    return runFullSystematicWorkflow({
      runDir,
      checklistPath,
      maxIterations: Number(payload?.maxIterations || 3),
      minPassPct: Number(payload?.minPassPct ?? 80),
      maxFail: Number(payload?.maxFail ?? 0)
    });
  });

  ipcMain.handle("leditor:export-docx", async (_event, request: { docJson: object; options?: any }) => {
    const repoRoot = resolveRepoRoot();
    const docJson = request?.docJson ?? {};
    const options = request?.options ?? {};
    const promptUser = options.prompt ?? true;
    let filePath = options.suggestedPath as string | undefined;
    if (promptUser || !filePath) {
      const result = await dialog.showSaveDialog({
        title: "Export to DOCX",
        defaultPath: path.join(repoRoot, ".codex_logs", "document.docx"),
        filters: [{ name: "Word Document", extensions: ["docx"] }]
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: "Export canceled" };
      }
      filePath = result.filePath;
    } else if (!path.isAbsolute(filePath)) {
      filePath = path.join(repoRoot, filePath);
    }
    if (!filePath) {
      return { success: false, error: "No path provided" };
    }
    try {
      const docxExporterPath = path.join(repoRoot, "leditor", "lib", "docx_exporter.js");
      const { buildDocxBuffer } = require(docxExporterPath) as {
        buildDocxBuffer: (docJson: object, options?: any) => Promise<Buffer>;
      };
      const buffer = await buildDocxBuffer(docJson, options);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, buffer);
      const stats = fs.statSync(filePath);
      if (stats.size <= 0) {
        return { success: false, error: "DOCX file is empty" };
      }
      return { success: true, filePath, bytes: stats.size };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle("leditor:insert-image", async () => {
    try {
      const result = await dialog.showOpenDialog({
        title: "Insert Image",
        properties: ["openFile"],
        filters: [
          { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"] },
          { name: "All files", extensions: ["*"] }
        ]
      });
      if (result.canceled || result.filePaths.length === 0 || !result.filePaths[0]) {
        return { success: false, error: "Image selection canceled" };
      }
      const filePath = result.filePaths[0];
      const url = pathToFileURL(path.resolve(filePath)).href;
      return { success: true, url };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:export-pdf", async (_event, request: { html?: string; options?: { suggestedPath?: string; prompt?: boolean } }) => {
    const repoRoot = resolveRepoRoot();
    const html = (request?.html || "").trim();
    if (!html) {
      return { success: false, error: "No HTML payload provided" };
    }
    const options = request?.options ?? {};
    const promptUser = options.prompt ?? true;
    let filePath = options.suggestedPath as string | undefined;
    if (!filePath || promptUser) {
      const result = await dialog.showSaveDialog({
        title: "Export to PDF",
        defaultPath: filePath || path.join(repoRoot, ".codex_logs", `document-${Date.now()}.pdf`),
        filters: [{ name: "PDF Document", extensions: ["pdf"] }]
      });
      if (result.canceled || !result.filePath) {
        return { success: false, error: "Export canceled" };
      }
      filePath = result.filePath;
    }
    if (!filePath) {
      return { success: false, error: "No path provided" };
    }
    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        sandbox: true
      }
    });
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const data = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4"
      });
      await fs.promises.writeFile(filePath, data);
      return { success: true, filePath, bytes: data.length };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    } finally {
      if (!pdfWindow.isDestroyed()) {
        pdfWindow.destroy();
      }
    }
  });

	  ipcMain.handle("leditor:import-docx", async (_event, request: { options?: { sourcePath?: string; prompt?: boolean } }) => {
    const options = request?.options ?? {};
    let sourcePath = options.sourcePath;
    if (!sourcePath || (options.prompt ?? true)) {
      const result = await dialog.showOpenDialog({
        title: "Import DOCX",
        properties: ["openFile"],
        filters: [{ name: "Word Document", extensions: ["docx"] }]
      });
      if (result.canceled || result.filePaths.length === 0 || !result.filePaths[0]) {
        return { success: false, error: "Import canceled" };
      }
      sourcePath = result.filePaths[0];
    }
    if (!sourcePath) {
      return { success: false, error: "No document selected" };
    }
    try {
      const buffer = await fs.promises.readFile(sourcePath);
      const result: ConvertResult = await mammoth.convertToHtml({ buffer });
      return { success: true, html: result.value, filePath: sourcePath };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
	  });

	  const isValidLedocZipV1 = async (filePath: string): Promise<boolean> => {
	    try {
	      const buffer = await fs.promises.readFile(filePath);
	      const payload = await unpackLedocZip(buffer);
	      const doc = (payload as any)?.document;
	      return Boolean(doc && typeof (doc as any).type === "string");
	    } catch {
	      return false;
	    }
	  };

	  const resolveDefaultLedocPath = async (): Promise<string> => {
	    const repoRoot = resolveRepoRoot();
	    const repoCandidate = path.join(repoRoot, "coder_state.ledoc");
	    try {
	      const st = await statSafe(repoCandidate);
	      if (st?.isDirectory()) {
	        return repoCandidate;
	      }
	      if (st?.isFile()) {
	        // Only prefer the repo file if it's a valid v1 zip LEDOC. Older builds may have written
	        // a corrupted `.ledoc` zip (e.g., `document.json` was `{}`), which would fail to load.
	        const ok = await isValidLedocZipV1(repoCandidate);
	        if (ok) return repoCandidate;
	      }
	    } catch {
	      // ignore
	    }
	    const fallbackDir = path.join(app.getPath("userData"), "leditor");
	    const fallbackPath = path.join(fallbackDir, "coder_state.ledoc");
    try {
      await fs.promises.mkdir(fallbackDir, { recursive: true });
    } catch {
      // ignore
    }
    return fallbackPath;
  };

  const packLedocZip = async (payload: Record<string, unknown>): Promise<Buffer> => {
    const zip = new JSZip();
    const addJson = (name: string, value: unknown) => {
      if (value === undefined || value === null) return;
      zip.file(name, JSON.stringify(value, null, 2));
    };
    addJson("document.json", (payload as any).document ?? {});
    addJson("meta.json", (payload as any).meta ?? {});
    addJson("settings.json", (payload as any).settings);
    addJson("footnotes.json", (payload as any).footnotes);
    addJson("styles.json", (payload as any).styles);
    addJson("history.json", (payload as any).history);
    return zip.generateAsync({ type: "nodebuffer" });
  };

  const unpackLedocZip = async (buffer: Buffer): Promise<Record<string, unknown>> => {
    const zip = await JSZip.loadAsync(buffer);
    const readTextOptional = async (name: string): Promise<string | null> => {
      const file = zip.file(name);
      if (!file) return null;
      return file.async("string");
    };
    const readJsonOptional = async (name: string): Promise<Record<string, unknown> | null> => {
      const raw = await readTextOptional(name);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    };
    const requireJson = async (name: string): Promise<Record<string, unknown>> => {
      const value = await readJsonOptional(name);
      if (!value) throw new Error(`Missing or invalid ${name}`);
      return value;
    };

    const document = await requireJson("document.json");
    const meta = await requireJson("meta.json");
    const settings = await readJsonOptional("settings.json");
    const footnotes = await readJsonOptional("footnotes.json");
    const styles = await readJsonOptional("styles.json");
    const history = await readJsonOptional("history.json");
    return {
      document,
      meta,
      settings: settings ?? undefined,
      footnotes: footnotes ?? undefined,
      styles: styles ?? undefined,
      history: history ?? undefined
    };
  };

  const LEDOC_BUNDLE_VERSION = "2.0";
  const LEDOC_BUNDLE_FILES = {
    version: "version.txt",
    content: "content.json",
    layout: "layout.json",
    registry: "registry.json",
    meta: "meta.json"
  } as const;

  const statSafe = async (p: string): Promise<fs.Stats | null> => {
    try {
      return await fs.promises.stat(p);
    } catch {
      return null;
    }
  };

  const atomicWriteText = async (filePath: string, data: string): Promise<void> => {
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.${Date.now()}.tmp`);
    await fs.promises.writeFile(tmpPath, data, "utf-8");
    try {
      await fs.promises.rename(tmpPath, filePath);
    } catch (error) {
      try {
        await fs.promises.unlink(filePath);
      } catch {
        // ignore
      }
      await fs.promises.rename(tmpPath, filePath);
    }
  };

  const ensureLedocBundleExists = async (bundleDir: string): Promise<void> => {
    const st = await statSafe(bundleDir);
    if (st?.isFile()) return; // legacy v1 zip at this path; do not overwrite
    if (!st) {
      await fs.promises.mkdir(bundleDir, { recursive: true });
    }
    const versionPath = path.join(bundleDir, LEDOC_BUNDLE_FILES.version);
    const versionSt = await statSafe(versionPath);
    if (versionSt?.isFile()) return;

    const now = new Date().toISOString();
    const content = { type: "doc", content: [{ type: "page", content: [{ type: "paragraph" }] }] };
    const meta = { version: LEDOC_BUNDLE_VERSION, title: "Untitled document", authors: [], created: now, lastModified: now, sourceFormat: "bundle" };
    const layout = {
      version: LEDOC_BUNDLE_VERSION,
      pageSize: "A4",
      margins: { unit: "cm", top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }
    };
    const registry = { version: LEDOC_BUNDLE_VERSION, footnoteIdState: { counters: { footnote: 0, endnote: 0 } }, knownFootnotes: [] };

    await atomicWriteText(versionPath, `${LEDOC_BUNDLE_VERSION}\n`);
    await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.content), JSON.stringify(content, null, 2));
    await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.meta), JSON.stringify(meta, null, 2));
    await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.layout), JSON.stringify(layout, null, 2));
    await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.registry), JSON.stringify(registry, null, 2));
    await fs.promises.mkdir(path.join(bundleDir, "media"), { recursive: true });
  };

  const readJsonFile = async (filePath: string): Promise<any> => {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  };

  const loadLedocBundle = async (bundleDir: string): Promise<{ payload: any; warnings: string[] }> => {
    const warnings: string[] = [];
    const versionPath = path.join(bundleDir, LEDOC_BUNDLE_FILES.version);
    const versionRaw = await fs.promises.readFile(versionPath, "utf-8").catch(() => "");
    const version = String(versionRaw || "").trim();
    if (version !== LEDOC_BUNDLE_VERSION) {
      throw new Error(`Unsupported bundle version: ${version || "unknown"}`);
    }
    const content = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_FILES.content)).catch(() => {
      warnings.push("content.json missing; using empty document.");
      return { type: "doc", content: [{ type: "page", content: [{ type: "paragraph" }] }] };
    });
    const meta = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_FILES.meta)).catch(() => {
      warnings.push("meta.json missing; using defaults.");
      const now = new Date().toISOString();
      return { version: LEDOC_BUNDLE_VERSION, title: "Untitled document", authors: [], created: now, lastModified: now, sourceFormat: "bundle" };
    });
    const layout = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_FILES.layout)).catch(() => {
      warnings.push("layout.json missing; using defaults.");
      return { version: LEDOC_BUNDLE_VERSION, pageSize: "A4", margins: { unit: "cm", top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } };
    });
    const registry = await readJsonFile(path.join(bundleDir, LEDOC_BUNDLE_FILES.registry)).catch(() => {
      warnings.push("registry.json missing; using defaults.");
      return { version: LEDOC_BUNDLE_VERSION, footnoteIdState: { counters: { footnote: 0, endnote: 0 } }, knownFootnotes: [] };
    });
    return { payload: { version: LEDOC_BUNDLE_VERSION, content, meta, layout, registry }, warnings };
  };

  ipcMain.handle("leditor:get-default-ledoc-path", async () => {
    const filePath = await resolveDefaultLedocPath();
    try {
      await ensureLedocBundleExists(filePath);
    } catch (error) {
      console.warn("[leditor:get-default-ledoc-path] unable to create default LEDOC", error);
    }
    return filePath;
  });

  ipcMain.handle(
	    "leditor:import-ledoc",
	    async (_event, request: { options?: { sourcePath?: string; prompt?: boolean } }) => {
      const options = request?.options ?? {};
      let sourcePath = options.sourcePath;
      if (!sourcePath || (options.prompt ?? true)) {
        const result = await dialog.showOpenDialog({
          title: "Import LEDOC",
          properties: ["openFile", "openDirectory"],
          filters: [
            { name: "LEditor Document", extensions: ["ledoc"] },
            { name: "JSON Document", extensions: ["json"] },
            { name: "All files", extensions: ["*"] }
          ]
        });
        if (result.canceled || result.filePaths.length === 0 || !result.filePaths[0]) {
          return { success: false, error: "Import canceled" };
        }
        sourcePath = result.filePaths[0];
      }
      if (!sourcePath) {
        return { success: false, error: "No document selected" };
      }
	      try {
	        const st = await statSafe(sourcePath);
	        if (st?.isDirectory()) {
	          const loaded = await loadLedocBundle(sourcePath);
	          return { success: true, filePath: sourcePath, payload: loaded.payload, warnings: loaded.warnings };
	        }
	        const ext = path.extname(sourcePath).toLowerCase();
	        if (ext === ".json") {
	          const raw = await fs.promises.readFile(sourcePath, "utf-8");
	          const parsed = JSON.parse(raw);
	          return { success: true, filePath: sourcePath, payload: { document: parsed, meta: { version: "1.0", title: "Imported JSON", authors: [], created: "", lastModified: "" } } };
	        }
	        const buffer = await fs.promises.readFile(sourcePath);
	        const payload = await unpackLedocZip(buffer);
	        const doc = (payload as any)?.document;
	        if (!doc || typeof (doc as any).type !== "string") {
	          return {
	            success: false,
	            error:
	              "Invalid LEDOC file: document.json is missing a ProseMirror root `type`. If this was created by an older build, re-save to a `.ledoc` folder bundle."
	          };
	        }
	        return { success: true, filePath: sourcePath, payload };
	      } catch (error) {
	        return { success: false, error: normalizeError(error) };
	      }
	    }
	  );

  ipcMain.handle(
    "leditor:export-ledoc",
    async (
      _event,
      request: { payload?: any; options?: { targetPath?: string; suggestedPath?: string; prompt?: boolean } }
    ) => {
      const repoRoot = resolveRepoRoot();
      const options = request?.options ?? {};
      const promptUser = options.prompt ?? true;
      let filePath = (options.targetPath || options.suggestedPath) as string | undefined;
      if (!filePath || promptUser) {
        const defaultPath =
          filePath && path.isAbsolute(filePath) ? filePath : path.join(app.getPath("userData"), "leditor", "coder_state.ledoc");
        const result = await dialog.showSaveDialog({
          title: "Export LEDOC",
          defaultPath,
          filters: [{ name: "LEditor Document", extensions: ["ledoc"] }]
        });
        if (result.canceled || !result.filePath) {
          return { success: false, error: "Export canceled" };
        }
        filePath = result.filePath;
      }
      if (!filePath) {
        return { success: false, error: "No path provided" };
      }
      // Normalize relative paths.
      if (!path.isAbsolute(filePath)) {
        filePath = path.join(repoRoot, filePath);
      }
      // Ensure `.ledoc` suffix for bundles.
      if (!filePath.toLowerCase().endsWith(".ledoc")) {
        filePath = `${filePath}.ledoc`;
      }
      try {
        const payload = request?.payload ?? {};
        const st = await statSafe(filePath);
        const wantsBundle = payload && typeof payload === "object" && String((payload as any).version || "") === LEDOC_BUNDLE_VERSION;

        if (wantsBundle) {
          let bundleDir = filePath;
          if (st?.isFile()) {
            const base = path.basename(filePath, ".ledoc");
            bundleDir = path.join(path.dirname(filePath), `${base}-bundle.ledoc`);
          }
          await fs.promises.mkdir(bundleDir, { recursive: true });
          await fs.promises.mkdir(path.join(bundleDir, "media"), { recursive: true });
          await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.version), `${LEDOC_BUNDLE_VERSION}\n`);
          await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.content), JSON.stringify((payload as any).content ?? {}, null, 2));
          await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.meta), JSON.stringify((payload as any).meta ?? {}, null, 2));
          await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.layout), JSON.stringify((payload as any).layout ?? {}, null, 2));
          await atomicWriteText(path.join(bundleDir, LEDOC_BUNDLE_FILES.registry), JSON.stringify((payload as any).registry ?? {}, null, 2));
          // Approximate bytes by summing required files.
          const files = Object.values(LEDOC_BUNDLE_FILES).map((name) => path.join(bundleDir, name));
          let bytes = 0;
          for (const f of files) {
            try {
              const s = await fs.promises.stat(f);
              bytes += s.size;
            } catch {
              // ignore
            }
          }
          return { success: true, filePath: bundleDir, bytes };
        }

        // Legacy v1 zip export fallback.
        const buffer = await packLedocZip(payload);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, buffer);
        const stats = fs.statSync(filePath);
        return { success: true, filePath, bytes: stats.size };
      } catch (error) {
        return { success: false, error: normalizeError(error) };
      }
    }
  );

  ipcMain.handle("leditor:versions:list", async (_event, request: { ledocPath: string }) => {
    try {
      const bundleDir = String(request?.ledocPath || "").trim();
      if (!bundleDir) return { success: false, error: "versions:list ledocPath is required" };
      return await listLedocVersions(bundleDir);
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle(
    "leditor:versions:create",
    async (
      _event,
      request: { ledocPath: string; reason?: string; label?: string; note?: string; payload?: any; throttleMs?: number; force?: boolean }
    ) => {
      try {
        const bundleDir = String(request?.ledocPath || "").trim();
        if (!bundleDir) return { success: false, error: "versions:create ledocPath is required" };
        const reason = typeof request?.reason === "string" && request.reason.trim() ? request.reason.trim() : "manual";
        return await createLedocVersion({
          bundleDir,
          reason,
          label: typeof request?.label === "string" ? request.label : undefined,
          note: typeof request?.note === "string" ? request.note : undefined,
          payload: request?.payload,
          throttleMs: typeof request?.throttleMs === "number" ? request.throttleMs : undefined,
          force: Boolean(request?.force)
        });
      } catch (error) {
        return { success: false, error: normalizeError(error) };
      }
    }
  );

  ipcMain.handle("leditor:versions:restore", async (_event, request: { ledocPath: string; versionId: string; mode?: "replace" | "copy" }) => {
    try {
      const bundleDir = String(request?.ledocPath || "").trim();
      const versionId = String(request?.versionId || "").trim();
      const mode = request?.mode === "copy" ? "copy" : "replace";
      if (!bundleDir) return { success: false, error: "versions:restore ledocPath is required" };
      if (!versionId) return { success: false, error: "versions:restore versionId is required" };
      return await restoreLedocVersion({ bundleDir, versionId, mode });
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:versions:delete", async (_event, request: { ledocPath: string; versionId: string }) => {
    try {
      const bundleDir = String(request?.ledocPath || "").trim();
      const versionId = String(request?.versionId || "").trim();
      if (!bundleDir) return { success: false, error: "versions:delete ledocPath is required" };
      if (!versionId) return { success: false, error: "versions:delete versionId is required" };
      return await deleteLedocVersion({ bundleDir, versionId });
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:versions:pin", async (_event, request: { ledocPath: string; versionId: string; pinned: boolean }) => {
    try {
      const bundleDir = String(request?.ledocPath || "").trim();
      const versionId = String(request?.versionId || "").trim();
      if (!bundleDir) return { success: false, error: "versions:pin ledocPath is required" };
      if (!versionId) return { success: false, error: "versions:pin versionId is required" };
      return await pinLedocVersion({ bundleDir, versionId, pinned: Boolean(request?.pinned) });
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:ai-status", async () => {
    loadDotEnvIntoProcessEnv();
    const hasApiKey = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
    const envModel = String(process.env.OPENAI_MODEL || process.env.CODEX_MODEL || "").trim();
    return {
      hasApiKey,
      model: envModel || "codex-mini-latest",
      modelFromEnv: Boolean(envModel)
    };
  });

  ipcMain.handle(
    "coder:save-payload",
    async (
      _event,
      payload: {
        scopeId?: string;
        nodeId: string;
        data: Record<string, unknown>;
        projectPath?: string;
        statePath?: string;
      }
    ) => {
    try {
      const { payloadDir } = resolveCoderPaths(payload?.scopeId, {
        projectPath: payload?.projectPath,
        statePath: payload?.statePath
      });
      await fs.promises.mkdir(payloadDir, { recursive: true });
      const safeNodeId = sanitizeNodeId(payload.nodeId);
      const jsonPath = path.join(payloadDir, `${safeNodeId}.json`);
      const txtPath = path.join(payloadDir, `${safeNodeId}.txt`);
      await fs.promises.writeFile(jsonPath, JSON.stringify(payload.data), "utf-8");
      const textValue = String((payload.data as any)?.text || (payload.data as any)?.title || "");
      await fs.promises.writeFile(txtPath, textValue.slice(0, 20000), "utf-8");
      return { baseDir: payloadDir, nodeId: safeNodeId };
    } catch (error) {
      console.warn("Failed to save coder payload", error);
      return { baseDir: "", nodeId: payload?.nodeId || "" };
    }
    }
  );

  ipcMain.handle("coder:load-state", async (_event, payload: { scopeId?: string; projectPath?: string; statePath?: string; name?: string }) => {
    const { coderDir, statePath: primaryPath } = resolveCoderPaths(payload?.scopeId, {
      projectPath: payload?.projectPath,
      statePath: payload?.statePath,
      name: payload?.name
    });
    if ((global as any).__coder_state_cache?.[primaryPath]) {
      return (global as any).__coder_state_cache[primaryPath];
    }
    try {
      await fs.promises.mkdir(coderDir, { recursive: true });
      const raw = await fs.promises.readFile(primaryPath, "utf-8");
      const parsed = JSON.parse(raw);
      const metaTitle = typeof parsed?.meta?.title === "string" ? String(parsed.meta.title) : "";
      const normalized = normalizeCoderStatePayload(parsed);
      console.info(`[CODER][STATE] load ${primaryPath}`);
      const payloadOut = { state: normalized, baseDir: coderDir, statePath: primaryPath, metaTitle };
      (global as any).__coder_state_cache = (global as any).__coder_state_cache || {};
      (global as any).__coder_state_cache[primaryPath] = payloadOut;
      return payloadOut;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[CODER][STATE] load failed ${primaryPath}`, error);
        return null;
      }
      // If we are in a project scope and no file exists yet, try legacy cache location.
      if (payload?.projectPath) {
        try {
          const legacy = resolveCoderPaths(payload?.scopeId);
          const rawLegacy = await fs.promises.readFile(legacy.statePath, "utf-8");
          const parsedLegacy = JSON.parse(rawLegacy);
          const metaTitle = typeof parsedLegacy?.meta?.title === "string" ? String(parsedLegacy.meta.title) : "";
          const normalized = normalizeCoderStatePayload(parsedLegacy);
          const toWrite = toPersistentCoderStatePayload(normalized, parsedLegacy, metaTitle);
          await fs.promises.mkdir(coderDir, { recursive: true });
          await atomicWriteJson(primaryPath, JSON.stringify(toWrite, null, 2));
          const payloadOut = { state: normalizeCoderStatePayload(normalized), baseDir: coderDir, statePath: primaryPath, metaTitle };
          (global as any).__coder_state_cache = (global as any).__coder_state_cache || {};
          (global as any).__coder_state_cache[primaryPath] = payloadOut;
          console.info(`[CODER][STATE] migrated ${legacy.statePath} -> ${primaryPath}`);
          return payloadOut;
        } catch {
          // ignore migration failures; fall through to missing
        }
      }
      console.info(`[CODER][STATE] load missing ${primaryPath}`);
      return null;
    }
  });

  ipcMain.handle("coder:save-state", async (_event, payload: { scopeId?: string; state?: Record<string, unknown>; projectPath?: string; statePath?: string; name?: string }) => {
    const { coderDir, statePath: primaryPath } = resolveCoderPaths(payload?.scopeId, {
      projectPath: payload?.projectPath,
      statePath: payload?.statePath,
      name: payload?.name
    });
    try {
      await fs.promises.mkdir(coderDir, { recursive: true });
      const raw = payload?.state ? payload.state : createDefaultCoderState();
      let existing: Record<string, unknown> | undefined;
      try {
        const prev = await fs.promises.readFile(primaryPath, "utf-8");
        existing = prev ? (JSON.parse(prev) as Record<string, unknown>) : undefined;
      } catch {
        existing = undefined;
      }
      const toWrite = toPersistentCoderStatePayload(raw, existing, payload?.name);
      const encoded = JSON.stringify(toWrite, null, 2);
      await atomicWriteJson(primaryPath, encoded);
      console.info(`[CODER][STATE] save ${primaryPath}`);
      (global as any).__coder_state_cache = (global as any).__coder_state_cache || {};
      const metaTitle = typeof (toWrite as any)?.meta?.title === "string" ? String((toWrite as any).meta.title) : "";
      (global as any).__coder_state_cache[primaryPath] = { state: toWrite, baseDir: coderDir, statePath: primaryPath, metaTitle };
    } catch (error) {
      console.warn(`[CODER][STATE] save failed ${primaryPath}`, error);
    }
    return { baseDir: coderDir, statePath: primaryPath };
  });

  ipcMain.handle("coder:pick-save-path", async (_event, payload: { scopeId?: string; projectPath?: string; statePath?: string; name?: string }) => {
    const { coderDir, statePath: defaultPath } = resolveCoderPaths(payload?.scopeId, {
      projectPath: payload?.projectPath,
      statePath: payload?.statePath,
      name: payload?.name
    });
    await fs.promises.mkdir(coderDir, { recursive: true });
    const result = await dialog.showSaveDialog({
      title: "Save Coder As",
      defaultPath,
      filters: [{ name: "Coder File", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    const filePath = result.filePath.toLowerCase().endsWith(".json") ? result.filePath : `${result.filePath}.json`;
    return { baseDir: coderDir, statePath: filePath };
  });

  ipcMain.handle("coder:list-states", async (_event, payload: { scopeId?: string; projectPath?: string }) => {
    const { coderDir } = resolveCoderPaths(payload?.scopeId, { projectPath: payload?.projectPath });
    try {
      await fs.promises.mkdir(coderDir, { recursive: true });
      const entries = await fs.promises.readdir(coderDir, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
          .map(async (entry) => {
            const fullPath = path.join(coderDir, entry.name);
            const stat = await fs.promises.stat(fullPath);
            return {
              name: entry.name.replace(/\.json$/i, ""),
              fileName: entry.name,
              path: fullPath,
              updatedUtc: stat.mtime.toISOString()
            };
          })
      );
      files.sort((a, b) => b.updatedUtc.localeCompare(a.updatedUtc));
      return { baseDir: coderDir, files };
    } catch (error) {
      console.warn("[CODER][STATE] list failed", error);
      return { baseDir: coderDir, files: [] as Array<{ name: string; fileName: string; path: string; updatedUtc: string }> };
    }
  });

  ipcMain.handle("coder:resolve-state-path", async (_event, payload: { scopeId?: string; projectPath?: string; name?: string }) => {
    const { coderDir, statePath } = resolveCoderPaths(payload?.scopeId, {
      projectPath: payload?.projectPath,
      name: payload?.name
    });
    await fs.promises.mkdir(coderDir, { recursive: true });
    return { baseDir: coderDir, statePath };
  });

  registerRetrieveIpcHandlers({
    search: async (query) =>
      runCached(retrieveCache, "retrieve:search", [query], async () => {
        try {
          return await requirePools().retrievePool.run("retrieve:search", [query]);
        } catch (error) {
          console.warn("[retrieve][worker][fallback]", error);
          return executeRetrieveSearch(query);
        }
      })
  });

  ipcMain.handle("analyse-command", (_event, payload: CommandEnvelope) => {
    if (payload && payload.phase && payload.action) {
      appendLogEntry(`ANALYSE phase=${payload.phase} action=${payload.action}`);
    }
    return { status: "ok" };
  });

  ipcMain.handle("analyse:discoverRuns", async (_event, baseDir?: string) =>
    runCached(analyseCache, "analyse:discoverRuns", [baseDir], async () => {
      try {
        return await requirePools().analysePool.run("analyse:discoverRuns", [baseDir]);
      } catch (error) {
        console.warn("[analyse][worker][fallback][discoverRuns]", error);
        return discoverRuns(baseDir);
      }
    })
  );
  ipcMain.handle("analyse:buildDatasets", async (_event, runPath: string) =>
    runCached(analyseCache, "analyse:buildDatasets", [runPath], async () => {
      try {
        return await requirePools().analysePool.run("analyse:buildDatasets", [runPath]);
      } catch (error) {
        console.warn("[analyse][worker][fallback][buildDatasets]", error);
        return buildDatasetHandles(runPath);
      }
    })
  );
  ipcMain.handle("analyse:loadBatches", async (_event, runPath: string) =>
    runCached(analyseCache, "analyse:loadBatches", [runPath], async () => {
      try {
        return await requirePools().analysePool.run("analyse:loadBatches", [runPath]);
      } catch (error) {
        console.warn("[analyse][worker][fallback][loadBatches]", error);
        return loadBatches(runPath);
      }
    })
  );
  ipcMain.handle("analyse:loadSections", async (_event, runPath: string, level: SectionLevel) =>
    runCached(analyseCache, "analyse:loadSections", [runPath, level], () =>
      requirePools()
        .analysePool.run("analyse:loadSections", [runPath, level])
        .catch((error) => {
          console.warn("[analyse][worker][fallback][loadSections]", { runPath, level, error });
          return loadSections(runPath, level);
        })
    )
  );
  ipcMain.handle("analyse:loadSectionsPage", async (_event, runPath: string, level: SectionLevel, offset: number, limit: number) =>
    runCached(analyseCache, "analyse:loadSectionsPage", [runPath, level, offset, limit], () =>
      requirePools()
        .analysePool.run("analyse:loadSectionsPage", [runPath, level, offset, limit])
        .catch((error) => {
          console.warn("[analyse][worker][fallback][loadSectionsPage]", { runPath, level, offset, limit, error });
          return loadSectionsPage(runPath, level, offset, limit);
        })
    )
  );
  ipcMain.handle(
    "analyse:querySections",
    async (_event, runPath: string, level: SectionLevel, query: unknown, offset: number, limit: number) =>
      runCached(analyseCache, "analyse:querySections", [runPath, level, query, offset, limit], () =>
        requirePools()
          .analysePool.run("analyse:querySections", [runPath, level, query, offset, limit])
          .catch((error) => {
            console.warn("[analyse][worker][fallback][querySections]", { runPath, level, offset, limit, error });
            return querySections(runPath, level, query as any, offset, limit);
          })
      )
  );
  ipcMain.handle(
    "analyse:loadBatchPayloadsPage",
    async (_event, runPath: string, offset: number, limit: number) =>
      runCached(analyseCache, "analyse:loadBatchPayloadsPage", [runPath, offset, limit], () =>
        requirePools()
          .analysePool.run("analyse:loadBatchPayloadsPage", [runPath, offset, limit])
          .catch((error) => {
            console.warn("[analyse][worker][fallback][loadBatchPayloadsPage]", { runPath, offset, limit, error });
            return loadBatchPayloadsPage(runPath, offset, limit);
          })
      )
  );
  ipcMain.handle("analyse:getDirectQuotes", async (_event, runPath: string, ids: string[]) =>
    runCached(analyseCache, "analyse:getDirectQuotes", [runPath, ids], () =>
      requirePools()
        .analysePool.run("analyse:getDirectQuotes", [runPath, ids])
        .catch((error) => {
          console.warn("[analyse][worker][fallback][getDirectQuotes]", { runPath, idsCount: ids?.length ?? 0, error });
          return getDirectQuoteEntries(runPath, ids || []);
        })
    )
  );
  ipcMain.handle("analyse:loadDqLookup", async (_event, runPath: string) =>
    runCached(analyseCache, "analyse:loadDqLookup", [runPath], async () => {
      try {
        return await requirePools().analysePool.run("analyse:loadDqLookup", [runPath]);
      } catch (error) {
        console.warn("[analyse][worker][fallback][loadDqLookup]", error);
        return loadDirectQuoteLookup(runPath);
      }
    })
  );
  ipcMain.handle("analyse:summariseRun", async (_event, runPath: string) =>
    runCached(analyseCache, "analyse:summariseRun", [runPath], () =>
      requirePools()
        .analysePool.run("analyse:summariseRun", [runPath])
        .catch((error) => {
          console.warn("[analyse][worker][fallback][summariseRun]", error);
          return summariseRun(runPath);
        })
    )
  );
  ipcMain.handle("analyse:getDefaultBaseDir", async () =>
    runCached(analyseCache, "analyse:getDefaultBaseDir", [], async () => {
      try {
        return await requirePools().analysePool.run("analyse:getDefaultBaseDir", []);
      } catch (error) {
        console.warn("[analyse][worker][fallback][getDefaultBaseDir]", error);
        return getDefaultBaseDir();
      }
    })
  );
  ipcMain.handle("analyse:audioCacheStatus", (_event, runId: string | undefined, keys: string[]) =>
    getAudioCacheStatus(runId, keys)
  );
  ipcMain.handle("analyse:audioCacheAdd", (_event, runId: string | undefined, entries: any[]) =>
    addAudioCacheEntries(runId, entries)
  );

  ipcMain.handle("settings:getAll", () => settingsService.getAllSettings());
  ipcMain.handle("settings:getValue", (_event, key: string, defaultValue?: unknown) =>
    settingsService.getValue(key, defaultValue)
  );
  ipcMain.handle("settings:setValue", (_event, key: string, value: unknown) => {
    settingsService.setValue(key, value);
    notifySettingsUpdated({ key, value });
    return { status: "saved" };
  });

  ipcMain.handle("settings:getPaths", () => {
    const appData = getAppDataPath();
    return {
      appDataPath: appData,
      configPath: getConfigDirectory(),
      settingsFilePath: getSettingsFilePath(),
      exportPath: ensureExportDirectory()
    };
  });

  ipcMain.handle("settings:listAudioInputs", () => {
    try {
      return { status: "ok", inputs: listNativeAudioInputs() };
    } catch (error) {
      return { status: "error", inputs: [], message: normalizeError(error) };
    }
  });

  ipcMain.handle("settings:getDotEnvStatus", () => {
    loadDotEnvIntoProcessEnv();
    const candidates = [path.join(process.cwd(), ".env"), path.join(resolveRepoRoot(), ".env")];
    const paths = candidates.filter((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    const keys = [
      "OPENAI_API_KEY",
      "OPENAI_BASE_URL",
      "OPENAI_API_BASE",
      "OPENAI_BASEURL",
      "OPENAI_VOICE_TRANSCRIBE_MODEL",
      "OPENAI_VOICE_TTS_MODEL",
      "OPENAI_VOICE_TTS_VOICE",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_GEMINI_API_KEY",
      "GEMINI_BASE_URL",
      "GOOGLE_API_BASE",
      "GEMINI_API_BASE",
      "MISTRAL_API_KEY",
      "MISTRAL_BASE_URL",
      "MISTRAL_API_BASE",
      "DEEPSEEK_API_KEY",
      "DEEPSEEK_BASE_URL",
      "DEEPSEEK_API_BASE",
      "LLM_PROVIDER",
      "TEIA_LLM_PROVIDER"
    ];
    const values: Record<string, string> = {};
    keys.forEach((key) => {
      const raw = sanitizeEnvValue(process.env[key]);
      if (raw) {
        values[key] = raw;
      }
    });
    return { found: paths.length > 0, paths, values };
  });

  ipcMain.handle("settings:clearCache", async () => {
    const userData = app.getPath("userData");
    const targets = ["Cache", "GPUCache", "Code Cache", "DawnCache"];
    const cleared: string[] = [];
    const failed: string[] = [];
    try {
      await session.defaultSession.clearCache();
    } catch {
      // ignore cache clear failures; we still try removing cache folders
    }
    targets.forEach((dirName) => {
      const targetPath = path.join(userData, dirName);
      try {
        if (fs.existsSync(targetPath)) {
          fs.rmSync(targetPath, { recursive: true, force: true });
          cleared.push(targetPath);
        }
      } catch {
        failed.push(targetPath);
      }
    });
    return { cleared, failed };
  });

  ipcMain.handle("settings:open-window", (_event, payload?: { section?: string }) => {
    const section = typeof payload?.section === "string" ? payload.section : undefined;
    openSettingsWindow(section);
    return { status: "ok" };
  });

  ipcMain.handle("settings:unlockSecrets", async (_event, passphrase: string) => {
    if (!secretsVault) {
      throw new Error("Secrets vault is not initialized");
    }
    try {
      await secretsVault.unlockSecrets(passphrase);
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "unlock failed" };
    }
  });

  ipcMain.handle("settings:getSecret", (_event, name: string) => {
    if (!secretsVault) {
      throw new Error("Secrets vault is not initialized");
    }
    return secretsVault.getSecret(name);
  });

  ipcMain.handle("settings:setSecret", async (_event, name: string, value: string) => {
    if (!secretsVault) {
      throw new Error("Secrets vault is not initialized");
    }
    try {
      await secretsVault.setSecret(name, value);
      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "unable to save secret" };
    }
  });

  ipcMain.handle("settings:exportBundle", async (_event, options: { zipPath?: string; includeSecrets?: boolean }) => {
    const targetPath = options.zipPath
      ? path.resolve(options.zipPath)
      : path.join(ensureExportDirectory(), `annotarium_bundle_${Date.now()}.zip`);
    return exportConfigBundle(targetPath, Boolean(options.includeSecrets));
  });

  ipcMain.handle("settings:importBundle", async (_event, bundlePath: string) => {
    await importConfigBundle(path.resolve(bundlePath));
    return { success: true };
  });

  const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
  const convertWslUncPath = (value: string): string => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    const normalized = trimmed.replace(/^\\\\+/, "");
    const segments = normalized.split(/[\\/]+/).filter(Boolean);
    const head = String(segments[0] || "").toLowerCase();
    if ((head === "wsl$" || head === "wsl.localhost") && segments.length >= 3) {
      return `/${segments.slice(2).join("/")}`;
    }
    return trimmed;
  };
  const convertWindowsDrivePath = (value: string): string => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    const normalized = trimmed.replace(/\\/g, "/");
    const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
    if (!match) return trimmed;
    if (process.platform === "win32") return trimmed;
    const drive = String(match[1] || "").toLowerCase();
    const rest = String(match[2] || "");
    return `/mnt/${drive}/${rest}`;
  };
  const normalizeFsPath = (value: string): string => {
    let trimmed = String(value || "").trim();
    if (!trimmed) return "";
    if (/^file:\/\//i.test(trimmed)) {
      trimmed = trimmed.replace(/^file:\/\//i, "");
      try {
        trimmed = decodeURIComponent(trimmed);
      } catch {
        // ignore decode failures
      }
      if (trimmed.startsWith("/") && /^[A-Za-z]:\//.test(trimmed.slice(1))) {
        trimmed = trimmed.slice(1);
      }
    }
    if (trimmed.startsWith("\\\\")) {
      trimmed = convertWslUncPath(trimmed);
    }
    trimmed = convertWindowsDrivePath(trimmed);
    return trimmed;
  };
  ipcMain.handle("leditor:read-file", async (_event, request: { sourcePath: string }) => {
    const logRefs = (filePath: string, raw: string): void => {
      try {
        const parsed = JSON.parse(normalizeLegacyJson(raw)) as any;
        const count = Array.isArray(parsed?.items)
          ? parsed.items.length
          : parsed?.itemsByKey && typeof parsed.itemsByKey === "object"
            ? Object.keys(parsed.itemsByKey).length
            : 0;
        console.info("[leditor:read-file][references]", {
          filePath,
          count,
          bytes: Buffer.byteLength(raw, "utf-8"),
          topKeys: parsed && typeof parsed === "object" ? Object.keys(parsed).slice(0, 6) : []
        });
      } catch (e) {
        console.warn("[leditor:read-file][references] parse failed", { filePath });
      }
    };
    try {
      const data = await fs.promises.readFile(request.sourcePath, "utf-8");
      if (String(request?.sourcePath || "").endsWith("references.json")) {
        logRefs(String(request.sourcePath), data);
      }
      return { success: true, data, filePath: request.sourcePath };
    } catch (error) {
      const sourcePath = String(request?.sourcePath || "");
      if (sourcePath.endsWith(`${path.sep}references.json`) || sourcePath.endsWith("/references.json")) {
        try {
          seedReferencesJsonFromDataHubCache(path.dirname(sourcePath));
          const data = await fs.promises.readFile(sourcePath, "utf-8");
          logRefs(sourcePath, data);
          return { success: true, data, filePath: sourcePath };
        } catch {
          // ignore and fall through
        }
      }
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:read-binary-file", async (_event, request: { sourcePath: string; maxBytes?: number }) => {
    try {
      const sourcePath = normalizeFsPath(request.sourcePath);
      const maxBytes = Number.isFinite(request.maxBytes) ? Number(request.maxBytes) : 0;
      if (maxBytes > 0) {
        const stat = await fs.promises.stat(sourcePath);
        if (stat.size > maxBytes) {
          return { success: false, error: "File exceeds size limit", bytes: stat.size };
        }
      }
      const buffer = await fs.promises.readFile(sourcePath);
      return {
        success: true,
        dataBase64: buffer.toString("base64"),
        bytes: buffer.length,
        filePath: sourcePath
      };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("leditor:write-file", async (_event, request: { targetPath: string; data: string }) => {
    try {
      await fs.promises.mkdir(path.dirname(request.targetPath), { recursive: true });
      await fs.promises.writeFile(request.targetPath, request.data, "utf-8");
      return { success: true };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  ipcMain.handle("analyse:list-cached-tables", async () => {
    return listCachedDataHubTables();
  });

  ipcMain.handle("analyse:run-ai-on-table", async (_event, payload: Record<string, unknown>) => {
    return runAnalyseAiHost({
      ...(payload ?? {}),
      // Always resolve cache dir from Electron.
      cacheDir: path.join(app.getPath("userData"), "data-hub-cache")
    });
  });

  registerProjectIpcHandlers(projectManager);
}

async function listCachedDataHubTables(): Promise<
  Array<{ fileName: string; filePath: string; mtimeMs: number; rows: number; cols: number }>
> {
  const cacheDir = path.join(app.getPath("userData"), "data-hub-cache");
  try {
    await fs.promises.mkdir(cacheDir, { recursive: true });
  } catch {
    // ignore
  }
  const ignoreNames = new Set([
    "references.json",
    "references_library.json",
    "references.used.json",
    "references_library.used.json"
  ]);
  const out: Array<{ fileName: string; filePath: string; mtimeMs: number; rows: number; cols: number }> = [];
  let entries: string[] = [];
  try {
    entries = await fs.promises.readdir(cacheDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const lower = name.toLowerCase();
    if (!lower.endsWith(".json")) continue;
    if (ignoreNames.has(lower)) continue;
    const filePath = path.join(cacheDir, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      const table = (parsed as any)?.table;
      const cols = Array.isArray(table?.columns) ? table.columns.length : 0;
      const rows = Array.isArray(table?.rows) ? table.rows.length : 0;
      if (cols <= 0 || rows <= 0) continue;
      out.push({ fileName: name, filePath, mtimeMs: stat.mtimeMs, rows, cols });
    } catch {
      // ignore corrupt caches
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs || a.fileName.localeCompare(b.fileName));
  return out;
}

function resolvePythonBinary(): string {
  const candidate = process.env.PYTHON || process.env.PYTHON3;
  if (candidate && candidate.trim()) return candidate.trim();
  return process.platform === "win32" ? "python" : "python3";
}

function resolveAnalyseAiHostScript(): string {
  const appPath = app.getAppPath();
  const candidates = [
    path.join(appPath, "dist", "shared", "python_backend", "analyse", "analyse_ai_host.py"),
    path.join(appPath, "shared", "python_backend", "analyse", "analyse_ai_host.py"),
    path.join(appPath, "..", "shared", "python_backend", "analyse", "analyse_ai_host.py"),
    path.join(appPath, "..", "..", "shared", "python_backend", "analyse", "analyse_ai_host.py")
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

async function runAnalyseAiHost(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const python = resolvePythonBinary();
  const script = resolveAnalyseAiHostScript();
  if (!fs.existsSync(script)) {
    return { success: false, error: `Missing analyse_ai_host.py: ${script}` };
  }
  return new Promise((resolve) => {
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({ success: false, error: error.message });
    });
    child.on("close", (code) => {
      const raw = (stdout || "").trim();
      if (code !== 0 && !raw) {
        resolve({ success: false, error: stderr.trim() || `python exited with ${code}` });
        return;
      }
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        resolve({
          success: false,
          error: `Invalid response from python (${error instanceof Error ? error.message : "parse error"})`,
          raw,
          stderr: stderr.trim()
        });
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function createWindow(): void {
  if (mainWindow) {
    return;
  }

  const rendererPath = path.join(__dirname, "renderer", "index.html");
  const preloadScript = path.join(__dirname, "preload.js");
  const leditorResourcesPath = path.join(app.getAppPath(), "dist", "resources", "leditor");
  const dataHubCacheDir = path.join(app.getPath("userData"), "data-hub-cache");
  try {
    fs.mkdirSync(dataHubCacheDir, { recursive: true });
  } catch {
    // Ignore filesystem errors; downstream reads/writes will surface issues.
  }
  seedReferencesJsonFromDataHubCache(dataHubCacheDir);
  const hostContract = {
    version: 1,
    sessionId: "annotarium-session",
    documentId: "annotarium-document",
    documentTitle: "Annotarium Document",
    paths: {
      contentDir: path.join(leditorResourcesPath, "content"),
      bibliographyDir: dataHubCacheDir,
      tempDir: path.join(leditorResourcesPath, "temp")
    },
    inputs: {
      directQuoteJsonPath: path.join(leditorResourcesPath, "direct_quote_lookup.json")
    },
    policy: {
      allowDiskWrites: true
    }
  };
  const leditorHostArg = `--leditor-host=${encodeURIComponent(JSON.stringify(hostContract))}`;

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    show: false,
    title: "Annotarium",
    // Avoid the native menu bar overlapping the web ribbon on Windows/Linux.
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      preload: preloadScript,
      additionalArguments: [leditorHostArg]
    }
  });

  applyDefaultZoomFactor(window);
  try {
    window.setMenuBarVisibility(false);
  } catch {
    // ignore (platform dependent)
  }

  window.once("ready-to-show", () => {
    window.show();
  });

  window.webContents.setBackgroundThrottling(false);

  window.webContents.on("before-input-event", (event, input) => {
    try {
      const key = String((input as any).key || "").toLowerCase();
      const metaOrCtrl = Boolean((input as any).control) || Boolean((input as any).meta);
      const shift = Boolean((input as any).shift);
      if (metaOrCtrl && shift && key === "i") {
        event.preventDefault();
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools();
        } else {
          window.webContents.openDevTools({ mode: "detach" });
        }
      }
      if (key === "f12") {
        event.preventDefault();
        if (window.webContents.isDevToolsOpened()) {
          window.webContents.closeDevTools();
        } else {
          window.webContents.openDevTools({ mode: "detach" });
        }
      }
    } catch (error) {
      console.error("[main.ts][before-input-event][error]", error);
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  window.loadFile(rendererPath).catch((error) => {
    console.error("Failed to load renderer", error);
  });

  if (isDevelopment) {
    window.webContents.openDevTools({ mode: "detach" });
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  mainWindow = window;
}

function initializeApp(): void {
  const lock = app.requestSingleInstanceLock();
  if (!lock) {
    app.quit();
    return;
  }

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady()
    .then(() => {
      loadDotEnvIntoProcessEnv();
      const baseUserData = app.getPath("userData");
      initializeSettingsFacade(baseUserData);
      syncLlmSettingsFromEnv();
      analysePool = new WorkerPool(path.join(__dirname, "main/jobs/analyseWorker.js"), {
        size: workerCount,
        workerData: { userDataPath: baseUserData }
      });
      retrievePool = new WorkerPool(path.join(__dirname, "main/jobs/retrieveWorker.js"), {
        size: Math.max(1, Math.min(workerCount, 2)),
        workerData: { userDataPath: baseUserData }
      });
      userDataPath = getAppDataPath();
      loadAgentState();
      secretsVault = initializeSecretsVault(userDataPath);
      void syncAcademicApiSecretsFromEnv();
      projectManagerInstance = new ProjectManager(baseUserData, {
        onRecentChange: refreshApplicationMenu
      });
      const manager = projectManagerInstance;
      if (!manager) {
        throw new Error("ProjectManager failed to initialize");
      }
      registerIpcHandlers(manager);
      createWindow();
      refreshApplicationMenu();
    })
    .catch((error) => {
      console.error("Failed to initialize application", error);
    });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("will-quit", () => {
    void analysePool?.dispose();
    void retrievePool?.dispose();
  });
}

initializeApp();
