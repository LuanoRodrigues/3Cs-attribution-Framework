import fs from "fs";
import path from "path";
import net from "net";
import { randomUUID } from "crypto";
import os from "os";
import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, shell, dialog, session } from "electron";
import { pathToFileURL } from "url";
import mammoth from "mammoth";
import JSZip from "jszip";
import { spawn } from "child_process";
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
import { resolveIntentForCommand } from "./main/agent/intent";

let mainWindow: BrowserWindow | null = null;
let secretsVault: ReturnType<typeof getSecretsVault> | null = null;
let userDataPath = "";
let handlersRegistered = false;
let projectManagerInstance: ProjectManager | null = null;
const settingsService = new SettingsService();
const SESSION_MENU_CHANNEL = "session:menu-action";
type ConvertResult = Awaited<ReturnType<typeof mammoth.convertToHtml>>;
const SCREEN_HOST_PORT = Number(process.env.SCREEN_HOST_PORT ?? "8222");

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
type WorkflowBatchJob = {
  id: string;
  functionName: string;
  status: "queued" | "running" | "done" | "failed";
  phase: string;
  startedAt: number;
  endedAt?: number;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
};
const workflowBatchJobs: WorkflowBatchJob[] = [];

function bumpIntentTelemetry(
  key: keyof typeof intentTelemetry
): void {
  intentTelemetry[key] += 1;
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

function generateResearchQuestionsFromTopic(topicRaw: string): string[] {
  const topic = String(topicRaw || "").trim() || "the selected topic";
  return [
    `How is ${topic} conceptually defined across the literature?`,
    `What frameworks and models are used to analyze ${topic}?`,
    `What evidence and methods are used to support claims about ${topic}?`,
    `What major limitations or disagreements appear in current approaches to ${topic}?`,
    `What policy or practice implications are identified regarding ${topic}?`
  ];
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
          "You extract coding intents for a Zotero coding workflow. If request is coding, return 3-5 research questions. Screening defaults to true unless user explicitly disables."
      },
      {
        role: "user",
        content: JSON.stringify({
          text: String(text || ""),
          selected_collection_name: String(context?.selectedCollectionName || ""),
          selected_collection_key: String(context?.selectedCollectionKey || "")
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
      intentId: { type: "string", enum: ["workflow.create_subfolder_by_topic", "feature.run", "agent.legacy_command"] },
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
          "You are an intent router for Zotero workflows. Use workflow.create_subfolder_by_topic for topic-filter/subfolder requests; otherwise map to feature.run when possible, else agent.legacy_command."
      },
      {
        role: "user",
        content: JSON.stringify({
          user_text: String(text || ""),
          context: {
            selectedCollectionKey: String(context?.selectedCollectionKey || ""),
            selectedCollectionName: String(context?.selectedCollectionName || "")
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
    ? payload.researchQuestions.map((q) => String(q || "").trim()).filter(Boolean)
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
              userText: String(payload?.userText || ""),
              collectionName: String(payload?.collectionName || ""),
              contextText: String(payload?.contextText || ""),
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

      if (/\b(code|coding|verbatim|evidence)\b/i.test(text)) {
        const codingLlm = await resolveCodingIntentWithLlm(text, context);
        if (codingLlm?.status === "ok" && codingLlm?.data?.is_coding_request === true) {
          const questions = Array.isArray(codingLlm.data.research_questions)
            ? codingLlm.data.research_questions.map((q: unknown) => String(q || "").trim()).filter(Boolean).slice(0, 5)
            : [];
          const topic = text.match(/about\s+(.+?)(?:\.|$)/i)?.[1] || "";
          const fallbackQuestions = questions.length ? questions : generateResearchQuestionsFromTopic(String(topic || "the selected topic"));
          const collectionName = String(context?.selectedCollectionName || "").trim();
          const clarificationQuestions: string[] = [];
          if (!collectionName) clarificationQuestions.push("Select a collection before coding.");
          if (fallbackQuestions.length < 3) clarificationQuestions.push("I need 3 to 5 research questions.");
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
                dir_base: "./running_tests",
                collection_name: collectionName,
                research_questions: fallbackQuestions.slice(0, 5),
                prompt_key: "code_pdf_page",
                screening: codingLlm.data.screening !== false,
                context: String(codingLlm.data.context || "").trim()
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
            String(context.selectedCollectionKey || "").trim() ||
            String(context.selectedCollectionName || "").trim();
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
        if (intentId === "feature.run") bumpIntentTelemetry("featureIntents");
        if (intentId === "agent.legacy_command") bumpIntentTelemetry("legacyIntents");
        return { status: "ok", intent };
      }
      bumpIntentTelemetry("llmFailures");

      const fallback = resolveIntentForCommand(text, context, signatures);
      const fallbackIntentId = String(fallback?.intent?.intentId || "");
      if (fallbackIntentId === "workflow.create_subfolder_by_topic") bumpIntentTelemetry("workflowIntents");
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
    async (_event, payload: { intent?: Record<string, unknown>; context?: Record<string, unknown>; confirm?: boolean }) => {
      try {
        const intent = payload?.intent || {};
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
            String((payload?.context as Record<string, unknown> | undefined)?.selectedCollectionName || "").trim();
          if (!collectionName) return { status: "error", message: "Selected collection is required for workflow execution." };
          if (!topic) return { status: "error", message: "Workflow topic is required." };
          const job: WorkflowBatchJob = {
            id: jobId,
            functionName: "workflow.create_subfolder_by_topic",
            status: "running",
            phase: "Enqueue topic classification",
            startedAt: now,
            args
          };
          workflowBatchJobs.unshift(job);
          if (workflowBatchJobs.length > 200) workflowBatchJobs.length = 200;
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
            job.phase = "Apply topic batch results";
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
              bumpIntentTelemetry("failed");
              return { status: "error", message: job.error, job };
            }
            job.endedAt = Date.now();
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
            bumpIntentTelemetry("failed");
            return { status: "error", message: job.error, job };
          }
        }

        if (intentId === "feature.run") {
          const functionName = String(intent?.targetFunction || "").trim();
          if (!functionName) return { status: "error", message: "target function is required." };
          const signatures = await loadZoteroSignatures();
          const feature = resolveFeatureDescriptor(functionName, signatures);
          if (!feature) return { status: "error", message: `Unknown feature: ${functionName}` };

          const result = await featureWorker.run({
            functionName,
            argsSchema: Array.isArray(feature.args) ? feature.args : [],
            argsValues: (intent?.args as Record<string, unknown>) || {},
            execute: true
          });
          if (result?.status === "ok") bumpIntentTelemetry("executed");
          else bumpIntentTelemetry("failed");
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

  ipcMain.handle("agent:run", async (_event, payload: { text?: string; context?: Record<string, unknown> }) => {
    try {
      const signatures = await loadZoteroSignatures();
      const intentOut = resolveIntentForCommand(
        String(payload?.text || ""),
        payload?.context || {},
        signatures
      );
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
          String((payload?.context as Record<string, unknown> | undefined)?.selectedCollectionName || "").trim();
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
  });

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

  ipcMain.handle("agent:get-intent-stats", async () => {
    return {
      status: "ok",
      stats: {
        ...intentTelemetry,
        workflowJobs: workflowBatchJobs.length
      }
    };
  });

  ipcMain.handle("agent:get-workflow-batch-jobs", async () => {
    return {
      status: "ok",
      jobs: workflowBatchJobs.map((job) => ({ ...job }))
    };
  });

  ipcMain.handle("agent:clear-workflow-batch-jobs", async () => {
    const count = workflowBatchJobs.length;
    workflowBatchJobs.length = 0;
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
