import { app, BrowserWindow, dialog, ipcMain, Menu, type MenuItemConstructorOptions } from "electron";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import readline from "readline";
import OpenAI from "openai";
import { z } from "zod";
import type { AiSettings } from "./shared/ai";
import { applyEditsToText, extractParagraphsFromMarkedText, normalizeEdits, type AgentEdit } from "./agent_utils";
import {
  LEDOC_BUNDLE_VERSION,
  LEDOC_EXTENSION,
  normalizeLedocToBundle,
  readLedocBundle,
  unpackLedocZip,
  writeLedocBundle
} from "./ledoc";
import { convertCoderStateToLedoc } from "./coder_state_converter";
import { createLedocVersion, deleteLedocVersion, listLedocVersions, pinLedocVersion, restoreLedocVersion } from "./ledoc_versions";

const REFERENCES_LIBRARY_FILENAME = "references_library.json";
const DEFAULT_LEDOC_FILENAME = "coder_state.ledoc";
const DEFAULT_EMBEDDING_MODEL = (process.env.LEDITOR_EMBEDDING_MODEL || "text-embedding-3-small").trim();
const EMBEDDING_BATCH_SIZE = Math.max(8, Math.min(256, Number(process.env.LEDITOR_EMBEDDING_BATCH_SIZE) || 64));
const EMBEDDING_TOP_K = Math.max(3, Math.min(12, Number(process.env.LEDITOR_EMBEDDING_TOP_K) || 6));

// Avoid GPU-process crashes in environments without stable GPU/driver support.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-software-rasterizer");
app.commandLine.appendSwitch("disable-gpu-compositing");

// Some Linux environments (containers, restricted user namespaces) cannot initialize the Chromium sandbox.
// Default to disabling it for dev runs to prevent hard crashes on startup.
if (
  process.platform === "linux" &&
  (!app.isPackaged || process.env.LEDITOR_NO_SANDBOX === "1" || process.env.ELECTRON_DISABLE_SANDBOX === "1")
) {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("disable-setuid-sandbox");
}

type LlmProviderId = "openai" | "deepseek" | "mistral" | "gemini";
type LlmCatalogModel = { id: string; label: string; description?: string };
type LlmCatalogProvider = { id: LlmProviderId; label: string; envKey: string; models: LlmCatalogModel[] };

const normalizeError = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const randomToken = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const DEBUG_LOGS = process.env.LEDITOR_DEBUG === "1";

const dbg = (fn: string, msg: string, extra?: Record<string, unknown>) => {
  if (!DEBUG_LOGS) return;
  const line = `[main.ts][${fn}][debug] ${msg}`;
  if (extra) {
    console.debug(line, extra);
  } else {
    console.debug(line);
  }
};

const agentDbg = (msg: string, extra?: Record<string, unknown>) => {
  const line = `[agent][runWorkflow][debug] ${msg}`;
  if (extra) {
    console.debug(line, extra);
  } else {
    console.debug(line);
  }
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resolveUiScale = (): number => {
  const fromArg = (() => {
    const prefix = "--ui-scale=";
    const raw = process.argv.find((v) => typeof v === "string" && v.startsWith(prefix));
    if (!raw) return null;
    const parsed = Number(raw.slice(prefix.length));
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const fromEnv = (() => {
    const raw = String(process.env.LEDITOR_UI_SCALE || "").trim();
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  // Default UI scale; override via `--ui-scale=` or `LEDITOR_UI_SCALE`.
  const chosen = fromArg ?? fromEnv ?? 1.8;
  return clamp(chosen, 0.75, 4.0);
};

const loadDotenv = (envPath: string): void => {
  try {
    if (!fs.existsSync(envPath)) {
      dbg("loadDotenv", "no .env found", { envPathLen: envPath.length });
      return;
    }
    const raw = fs.readFileSync(envPath, "utf-8");
    const keys: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
      const eq = normalized.indexOf("=");
      if (eq <= 0) continue;
      const key = normalized.slice(0, eq).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let value = normalized.slice(eq + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
      keys.push(key);
    }
    if (keys.length > 0) {
      dbg("loadDotenv", "loaded env keys", { keys });
    }
  } catch (error) {
    dbg("loadDotenv", "failed to load .env", { error: normalizeError(error) });
  }
};

const ensureLedocExtension = (filePath: string): string => {
  const trimmed = String(filePath || "").trim();
  if (!trimmed) return trimmed;
  const lower = trimmed.toLowerCase();
  const ext = `.${LEDOC_EXTENSION}`;
  if (lower.endsWith(ext)) return trimmed;
  return `${trimmed}${ext}`;
};

const resolveRepoRelativePath = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("@")) {
    const rest = trimmed.slice(1).trim();
    if (!rest) return "";
    if (path.isAbsolute(rest) || rest.startsWith("\\\\")) return rest;
    try {
      return path.resolve(app.getAppPath(), "..", rest);
    } catch {
      return rest;
    }
  }
  return trimmed;
};

const installAppMenu = (): void => {
  // We ship a Word-like in-app ribbon; disable the native Electron menu bar.
  // On macOS this also removes the top application menu.
  Menu.setApplicationMenu(null);
};

const summarizeIpcRequest = (channel: string, request: unknown): Record<string, unknown> => {
  if (!request || typeof request !== "object") return { channel, requestType: typeof request };
  const obj = request as any;
  switch (channel) {
    case "leditor:read-file":
    case "leditor:file-exists":
      return { channel, sourcePathLen: typeof obj?.sourcePath === "string" ? obj.sourcePath.length : 0 };
    case "leditor:write-file":
      return {
        channel,
        targetPathLen: typeof obj?.targetPath === "string" ? obj.targetPath.length : 0,
        dataLen: typeof obj?.data === "string" ? obj.data.length : 0
      };
    case "leditor:export-ledoc":
      return {
        channel,
        hasPayload: Boolean(obj?.payload && typeof obj.payload === "object"),
        targetPathLen: typeof obj?.options?.targetPath === "string" ? obj.options.targetPath.length : 0,
        suggestedPathLen: typeof obj?.options?.suggestedPath === "string" ? obj.options.suggestedPath.length : 0,
        prompt: Boolean(obj?.options?.prompt)
      };
    case "leditor:import-ledoc":
      return {
        channel,
        sourcePathLen: typeof obj?.options?.sourcePath === "string" ? obj.options.sourcePath.length : 0,
        prompt: Boolean(obj?.options?.prompt)
      };
    case "leditor:agent-request": {
      const payload = obj?.payload as any;
      return {
        channel,
        scope: typeof payload?.scope === "string" ? payload.scope : "unknown",
        instructionLen: typeof payload?.instruction === "string" ? payload.instruction.length : 0,
        selectionTextLen: typeof payload?.selection?.text === "string" ? payload.selection.text.length : 0,
        documentTextLen: typeof payload?.document?.text === "string" ? payload.document.text.length : 0,
        historyLen: Array.isArray(payload?.history) ? payload.history.length : 0,
        targetsLen: Array.isArray(payload?.targets) ? payload.targets.length : 0
      };
    }
    case "leditor:open-pdf-viewer":
      return { channel, payloadKeys: obj?.payload && typeof obj.payload === "object" ? Object.keys(obj.payload).length : 0 };
    case "leditor:resolve-pdf-path":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0,
        itemKeyLen: typeof obj?.itemKey === "string" ? obj.itemKey.length : 0
      };
    case "leditor:get-direct-quote-entry":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0,
        dqidLen: typeof obj?.dqid === "string" ? obj.dqid.length : 0
      };
    case "leditor:prefetch-direct-quotes":
      return {
        channel,
        lookupPathLen: typeof obj?.lookupPath === "string" ? obj.lookupPath.length : 0,
        dqids: Array.isArray(obj?.dqids) ? obj.dqids.length : 0
      };
    case "leditor:pdf-viewer-payload":
      return { channel, tokenLen: typeof obj?.token === "string" ? obj.token.length : 0 };
    default:
      return { channel, keys: Object.keys(obj).length };
  }
};

const summarizeIpcResult = (result: unknown): Record<string, unknown> => {
  if (result == null) return { result: null };
  if (typeof result !== "object") return { resultType: typeof result };
  const obj = result as any;
  return {
    success: typeof obj?.success === "boolean" ? obj.success : undefined,
    hasError: typeof obj?.error === "string" ? obj.error.length > 0 : undefined,
    dataLen: typeof obj?.data === "string" ? obj.data.length : undefined
  };
};

const registerIpc = <Req, Res>(
  channel: string,
  handler: (event: Electron.IpcMainInvokeEvent, request: Req) => Promise<Res> | Res
) => {
  dbg("registerIpc", `ipcMain.handle ${channel}`);
  ipcMain.handle(channel, async (event, request) => {
    const started = Date.now();
    dbg("ipc", `call ${channel}`, summarizeIpcRequest(channel, request));
    try {
      const result = await handler(event, request as Req);
      dbg("ipc", `done ${channel}`, { ms: Date.now() - started, ...summarizeIpcResult(result) });
      return result as Res;
    } catch (error) {
      dbg("ipc", `throw ${channel}`, { ms: Date.now() - started, error: normalizeError(error) });
      throw error;
    }
  });
};

type AgentHistoryMessage = { role: "user" | "assistant" | "system"; content: string };
type AgentRequestPayload = {
  scope: "selection" | "document";
  instruction: string;
  actionId?: string;
  selection?: { from: number; to: number; text: string };
  document?: { text: string };
  documentJson?: object;
  targets?: Array<{ n: number; headingNumber?: string; headingTitle?: string }>;
  history?: AgentHistoryMessage[];
  settings?: AiSettings;
};

type AgentOperation =
  | { op: "replaceSelection"; text: string }
  | { op: "replaceParagraph"; n: number; text: string }
  | { op: "replaceDocument"; text: string };

type AgentStreamUpdate = {
  requestId: string;
  kind: "delta" | "status" | "tool" | "done" | "error";
  message?: string;
  delta?: string;
  tool?: string;
};

const openaiClients = new Map<string, OpenAI>();
const getOpenAiClient = (apiKey?: string): OpenAI | null => {
  const key = String(apiKey || process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  let client = openaiClients.get(key);
  if (client) return client;
  client = new OpenAI({ apiKey: key });
  openaiClients.set(key, client);
  return client;
};

const getCatalog = (): LlmCatalogProvider[] => [
  {
    id: "openai",
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    models: [
      { id: "codex-mini-latest", label: "Codex Mini", description: "Deterministic edits" },
      { id: "gpt-5-mini", label: "GPT-5 Mini", description: "Fast and responsive" },
      { id: "gpt-5", label: "GPT-5", description: "Reliable general model" },
      { id: "gpt-5.1", label: "GPT-5.1", description: "Advanced reasoning" }
    ]
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envKey: "DEEP_SEEK_API_KEY",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat", description: "General chat" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner", description: "Reasoning-focused" }
    ]
  },
  {
    id: "mistral",
    label: "Mistral",
    envKey: "MISTRAL_API_KEY",
    models: [
      { id: "mistral-small-latest", label: "Mistral Small", description: "Fast and cost-effective" },
      { id: "mistral-medium-latest", label: "Mistral Medium", description: "Balanced" },
      { id: "mistral-large-latest", label: "Mistral Large", description: "Highest quality" },
      { id: "codestral-latest", label: "Codestral", description: "Code + structured edits" }
    ]
  },
  {
    id: "gemini",
    label: "Gemini",
    envKey: "LU_GEMINI_API_KEY",
    models: [
      { id: "gemini-2.5-flash", label: "Gemini Flash", description: "Excellent all-rounder" },
      { id: "gemini-2.5-pro", label: "Gemini Pro", description: "Flagship model" },
      { id: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview", description: "Preview" }
    ]
  }
];

const getProviderEnvKeyName = (provider: LlmProviderId): string => {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "deepseek":
      return "DEEP_SEEK_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
    case "gemini":
      return "LU_GEMINI_API_KEY";
  }
};

const getProviderApiKey = (provider: LlmProviderId, settingsApiKey?: string): string => {
  if (provider === "openai") return String(settingsApiKey || process.env.OPENAI_API_KEY || "").trim();
  const keyEnv = getProviderEnvKeyName(provider);
  return String((process.env as any)[keyEnv] || "").trim();
};

const getDefaultModelForProvider = (provider: LlmProviderId): { model: string; modelFromEnv: boolean } => {
  const fromEnv =
    provider === "openai"
      ? String(process.env.LEDITOR_AGENT_MODEL || process.env.OPENAI_MODEL || "").trim()
      : provider === "deepseek"
        ? String(process.env.DEEPSEEK_MODEL || "").trim()
        : provider === "mistral"
          ? String(process.env.MISTRAL_MODEL || "").trim()
          : String(process.env.GEMINI_MODEL || "").trim();
  if (fromEnv) return { model: fromEnv, modelFromEnv: true };
  const catalog = getCatalog();
  const entry = catalog.find((p) => p.id === provider);
  const first = entry?.models?.[0]?.id || (provider === "openai" ? "codex-mini-latest" : "");
  return { model: first, modelFromEnv: false };
};

const extractFirstJsonObject = (text: string): any => {
  const raw = String(text ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Model response was not valid JSON.");
  }
  return JSON.parse(raw.slice(start, end + 1));
};

const fetchJson = async (url: string, init: RequestInit): Promise<any> => {
  const res = await fetch(url, init);
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}: ${raw.slice(0, 800)}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Non-JSON response: ${raw.slice(0, 800)}`);
  }
};

const callOpenAiCompatibleChat = async (args: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<string> => {
  const url = `${args.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body: any = { model: args.model, messages: args.messages };
  if (typeof args.temperature === "number") body.temperature = args.temperature;
  const json = await fetchJson(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${args.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: args.signal
  });
  const content = json?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : String(content ?? "");
};

const callGeminiGenerateContent = async (args: {
  apiKey: string;
  model: string;
  system: string;
  input: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<string> => {
  const base = "https://generativelanguage.googleapis.com/v1beta";
  const modelId = encodeURIComponent(args.model);
  const url = `${base}/models/${modelId}:generateContent`;
  const combined = `SYSTEM:\n${args.system}\n\nUSER:\n${args.input}`;
  const body: any = {
    contents: [{ role: "user", parts: [{ text: combined }] }]
  };
  if (typeof args.temperature === "number") {
    body.generationConfig = { temperature: args.temperature };
  }
  const json = await fetchJson(url, {
    method: "POST",
    headers: { "x-goog-api-key": args.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: args.signal
  });
  const parts = json?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    const text = parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join("");
    return text.trim();
  }
  return String(json?.candidates?.[0]?.content?.text ?? "").trim();
};

const callLlmText = async (args: {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  system: string;
  input: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<string> => {
  const provider = args.provider;
  if (provider === "openai") {
    const client = getOpenAiClient(args.apiKey);
    if (!client) throw new Error("Missing OPENAI_API_KEY.");
    const isCodex = /^codex-/i.test(args.model);
    const createResponse = async (allowTemperature: boolean) => {
      const body: any = { model: args.model, instructions: args.system, input: args.input };
      if (!isCodex && allowTemperature && typeof args.temperature === "number") {
        body.temperature = args.temperature;
      }
      return client.responses.create(body, { signal: args.signal });
    };
    try {
      const response: any = await createResponse(true);
      return String(response?.output_text ?? "").trim();
    } catch (error) {
      const msg = normalizeError(error);
      if (msg.includes("Unsupported parameter") && msg.includes("'temperature'")) {
        const response: any = await createResponse(false);
        return String(response?.output_text ?? "").trim();
      }
      throw error;
    }
  }

  if (provider === "deepseek") {
    const messages = [
      { role: "system" as const, content: args.system },
      { role: "user" as const, content: args.input }
    ];
    const baseA = "https://api.deepseek.com";
    try {
      return await callOpenAiCompatibleChat({
        baseUrl: baseA,
        apiKey: args.apiKey,
        model: args.model,
        messages,
        temperature: args.temperature,
        signal: args.signal
      });
    } catch (error) {
      const msg = normalizeError(error);
      if (msg.startsWith("404")) {
        // Some deployments expect /v1 prefix.
        return await callOpenAiCompatibleChat({
          baseUrl: `${baseA}/v1`,
          apiKey: args.apiKey,
          model: args.model,
          messages,
          temperature: args.temperature,
          signal: args.signal
        });
      }
      throw error;
    }
  }

  if (provider === "mistral") {
    const messages = [
      { role: "system" as const, content: args.system },
      { role: "user" as const, content: args.input }
    ];
    return await callOpenAiCompatibleChat({
      baseUrl: "https://api.mistral.ai/v1",
      apiKey: args.apiKey,
      model: args.model,
      messages,
      temperature: args.temperature,
      signal: args.signal
    });
  }

  // gemini
  return await callGeminiGenerateContent({
    apiKey: args.apiKey,
    model: args.model,
    system: args.system,
    input: args.input,
    temperature: args.temperature,
    signal: args.signal
  });
};

const callOpenAiEmbeddings = async (args: {
  apiKey: string;
  model: string;
  input: string[];
  signal?: AbortSignal;
}): Promise<number[][]> => {
  const client = getOpenAiClient(args.apiKey);
  if (!client) throw new Error("Missing OPENAI_API_KEY.");
  const response: any = await client.embeddings.create(
    { model: args.model, input: args.input },
    { signal: args.signal }
  );
  const data = Array.isArray(response?.data) ? response.data : [];
  return data.map((d: any) => (Array.isArray(d?.embedding) ? d.embedding.map((v: any) => Number(v)) : []));
};


const buildOperationsFromEdits = (payload: AgentRequestPayload, edits: AgentEdit[]): AgentOperation[] => {
  if (!edits.length) return [];
  if (payload.scope === "selection") {
    const sel = payload.selection?.text ?? "";
    const replaced = applyEditsToText(sel, edits);
    return [{ op: "replaceSelection", text: replaced }];
  }
  const docText = payload.document?.text ?? "";
  const replaced = applyEditsToText(docText, edits);
  const targets = Array.isArray(payload.targets) ? payload.targets : [];
  if (targets.length > 0) {
    const byParagraph = extractParagraphsFromMarkedText(replaced);
    const ops: AgentOperation[] = [];
    for (const t of targets) {
      const n = Number(t?.n);
      if (!Number.isFinite(n)) continue;
      const next = byParagraph.get(n);
      if (typeof next === "string" && next.trim()) {
        ops.push({ op: "replaceParagraph", n, text: next });
      }
    }
    return ops;
  }
  return [{ op: "replaceDocument", text: replaced }];
};

type AgentsSdk = {
  Agent: any;
  run: any;
  setDefaultOpenAIKey?: (apiKey: string) => void;
  webSearchTool?: (...args: any[]) => any;
  codeInterpreterTool?: (...args: any[]) => any;
  tool?: (def: any) => any;
  createTool?: (def: any) => any;
};

let agentsSdkPromise: Promise<AgentsSdk> | null = null;
const loadAgentsSdk = async (): Promise<AgentsSdk> => {
  if (!agentsSdkPromise) {
    agentsSdkPromise = Promise.all([import("@openai/agents"), import("@openai/agents-openai")])
      .then(([core, openai]: any[]) => ({
        Agent: core?.Agent,
        run: core?.run,
        setDefaultOpenAIKey: core?.setDefaultOpenAIKey,
        webSearchTool: openai?.webSearchTool ?? core?.webSearchTool,
        codeInterpreterTool: openai?.codeInterpreterTool ?? core?.codeInterpreterTool,
        tool: core?.tool,
        createTool: core?.createTool
      }))
      .catch((error) => {
        agentsSdkPromise = null;
        throw error;
      });
  }
  return agentsSdkPromise;
};

const extractStreamDelta = (event: any): { delta?: string; tool?: string; status?: string } | null => {
  const type = typeof event?.type === "string" ? event.type : "";
  if (!type) return null;
  if (type.endsWith("output_text.delta") && typeof event?.delta === "string") {
    return { delta: event.delta };
  }
  if (type.endsWith("output_text.done") && typeof event?.text === "string") {
    return { delta: event.text };
  }
  if (type.includes("tool") && typeof event?.name === "string") {
    return { tool: event.name };
  }
  if (type.includes("tool") && typeof event?.tool_name === "string") {
    return { tool: event.tool_name };
  }
  if (type.includes("error") && typeof event?.message === "string") {
    return { status: event.message };
  }
  return null;
};

const buildClassifierInput = (payload: AgentRequestPayload): string => {
  const selection = typeof payload.selection?.text === "string" ? payload.selection.text.trim() : "";
  const docText = typeof payload.document?.text === "string" ? payload.document.text.trim() : "";
  const snippet = selection || docText;
  const context = snippet ? snippet.slice(0, 1200) : "";
  return JSON.stringify(
    {
      instruction: payload.instruction,
      actionId: typeof payload.actionId === "string" ? payload.actionId : undefined,
      scope: payload.scope,
      hasSelection: Boolean(selection),
      context
    },
    null,
    2
  );
};

const runCompatAgentWorkflow = async (args: {
  payload: AgentRequestPayload;
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  temperature: number;
  signal?: AbortSignal;
}): Promise<{ assistantText: string; applyText?: string; operations: AgentOperation[] }> => {
  const { system, user } = buildAgentPrompt(args.payload);
  const history = Array.isArray(args.payload?.history) ? args.payload.history : [];
  const normalizeHistory = (value: AgentHistoryMessage[]): AgentHistoryMessage[] =>
    value
      .map((msg) => ({
        role: msg?.role,
        content: typeof msg?.content === "string" ? msg.content : String(msg?.content ?? "")
      }))
      .filter((msg) => (msg.role === "user" || msg.role === "assistant" || msg.role === "system") && msg.content.trim())
      .slice(-20);
  const historyBlock = normalizeHistory(history)
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n");
  const inputText = historyBlock ? `Conversation history:\n${historyBlock}\n\n${user}` : user;
  const raw = await callLlmText({
    provider: args.provider,
    apiKey: args.apiKey,
    model: args.model,
    system,
    input: inputText,
    temperature: args.temperature,
    signal: args.signal
  });
  const parsed = extractFirstJsonObject(raw);
  const assistantText = typeof parsed?.assistantText === "string" ? parsed.assistantText : "";
  const operationsRaw = Array.isArray(parsed?.operations) ? parsed.operations : [];
  const applyText = typeof parsed?.applyText === "string" ? parsed.applyText : "";
  const editsRaw = Array.isArray(parsed?.edits) ? parsed.edits : [];
  const operations = operationsRaw
    .map((op: any) => {
      const kind = String(op?.op || "");
      if (kind === "replaceSelection" && typeof op?.text === "string") {
        return { op: "replaceSelection" as const, text: op.text };
      }
      if (kind === "replaceParagraph" && Number.isFinite(op?.n) && typeof op?.text === "string") {
        return { op: "replaceParagraph" as const, n: Number(op.n), text: op.text };
      }
      if (kind === "replaceDocument" && typeof op?.text === "string") {
        return { op: "replaceDocument" as const, text: op.text };
      }
      return null;
    })
    .filter(Boolean) as AgentOperation[];

  const edits = editsRaw
    .map((e: any) => ({
      action: String(e?.action || ""),
      start: Number(e?.start),
      end: Number(e?.end),
      text: typeof e?.text === "string" ? e.text : String(e?.text ?? "")
    }))
    .filter((e: any) => e.action === "replace" && Number.isFinite(e.start) && Number.isFinite(e.end)) as AgentEdit[];

  if (edits.length > 0) {
    try {
      const fromEdits = buildOperationsFromEdits(args.payload, edits);
      if (fromEdits.length) return { assistantText, applyText, operations: fromEdits };
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  if (operations.length === 0 && applyText) {
    if (args.payload.scope === "selection") {
      operations.push({ op: "replaceSelection", text: applyText });
    } else {
      operations.push({ op: "replaceDocument", text: applyText });
    }
  }

  if (!assistantText && operations.length === 0) {
    throw new Error("Agent response JSON missing assistantText/operations.");
  }

  return { assistantText, applyText, operations };
};

const runOpenAiAgentWorkflow = async (args: {
  requestId?: string;
  payload: AgentRequestPayload;
  apiKey: string;
  model: string;
  temperature: number;
  signal?: AbortSignal;
  onStream?: (update: AgentStreamUpdate) => void;
}): Promise<{ assistantText: string; operations: AgentOperation[]; citations?: any[]; actions?: any[]; route?: string }> => {
  const withRetry = async <T>(fn: () => Promise<T>, retries: number): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      if (retries <= 0 || args.signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return await withRetry(fn, retries - 1);
    }
  };
  const { Agent, run, setDefaultOpenAIKey, webSearchTool, codeInterpreterTool, tool, createTool } = await loadAgentsSdk();
  if (!Agent || !run) {
    throw new Error("OpenAI Agents SDK unavailable. Ensure @openai/agents is installed.");
  }
  if (typeof setDefaultOpenAIKey === "function") {
    setDefaultOpenAIKey(args.apiKey);
  }

  const buildDocFetchTool = (): any | null => {
    const factory = tool ?? createTool;
    if (typeof factory !== "function") return null;
    const parameters = z.object({
      includeJson: z.boolean().optional(),
      includeText: z.boolean().optional()
    });
    return factory({
      name: "fetch_document",
      description:
        "Return the current document snapshot for this request. Use includeJson/includeText to control fields.",
      parameters,
      execute: async (input: any) => {
        const includeJson = input?.includeJson !== false;
        const includeText = input?.includeText !== false;
        return {
          selection: args.payload.selection ?? null,
          documentText: includeText ? args.payload.document?.text ?? null : null,
          documentJson: includeJson ? args.payload.documentJson ?? null : null,
          targets: Array.isArray(args.payload.targets) ? args.payload.targets : null,
          blocks: Array.isArray((args.payload as any).blocks) ? (args.payload as any).blocks : null
        };
      }
    });
  };

  const operationSchema = z.union([
    z.object({ op: z.literal("replaceSelection"), text: z.string() }),
    z.object({ op: z.literal("replaceParagraph"), n: z.number(), text: z.string() }),
    z.object({ op: z.literal("replaceDocument"), text: z.string() })
  ]);
  const editSchema = z.object({
    action: z.literal("replace"),
    start: z.number(),
    end: z.number(),
    text: z.string()
  });
  const outputSchema = z.object({
    assistantText: z.string(),
    operations: z.array(operationSchema),
    edits: z.array(editSchema).optional(),
    citations: z.array(z.object({ url: z.string().optional(), title: z.string().optional(), snippet: z.string().optional() })).optional(),
    actions: z.array(z.object({ type: z.string(), payload: z.any().optional() })).optional()
  });
  const classifySchema = z.object({
    route: z.enum(["edit", "internal_qa", "external_fact", "general"]).default("edit"),
    needsSearch: z.boolean().default(false),
    needsCode: z.boolean().default(false),
    reason: z.string().optional()
  });

  const rewriteSchema = z.object({ instruction: z.string() });
  const rewriteAgent = new Agent({
    name: "queryRewrite",
    instructions: [
      "Rewrite the user's instruction into a clear, single-sentence directive.",
      "Preserve the user's intent, scope, and constraints.",
      "Return JSON: {\"instruction\": string}."
    ].join("\n"),
    model: args.model,
    outputType: rewriteSchema,
    modelSettings: { temperature: 0 }
  });

  const classifyAgent = new Agent({
    name: "classify",
    instructions: [
      "Classify whether the user instruction needs external web search or code execution.",
      "Return JSON with fields: route, needsSearch, needsCode, reason.",
      "route: edit when primarily rewriting the provided text; internal_qa for questions that can be answered with search; external_fact when deep verification or computation is needed; general for other.",
      "needsSearch: true ONLY if the user asks to verify facts or requests citations beyond the provided document.",
      "needsCode: true ONLY if calculation or code execution is required to answer."
    ].join("\n"),
    model: args.model,
    outputType: classifySchema,
    modelSettings: { temperature: 0 }
  });

  let rewrittenInstruction = args.payload.instruction;
  try {
    const rewriteResult = (await withRetry(
      () => run(rewriteAgent, JSON.stringify({ instruction: args.payload.instruction }), { signal: args.signal }),
      1
    )) as any;
    if (typeof rewriteResult?.finalOutput?.instruction === "string" && rewriteResult.finalOutput.instruction.trim()) {
      rewrittenInstruction = rewriteResult.finalOutput.instruction.trim();
    }
  } catch {
    // ignore rewrite failures
  }

  let classification = { route: "edit", needsSearch: false, needsCode: false };
  try {
    const classResult = (await withRetry(
      () =>
        run(
          classifyAgent,
          buildClassifierInput({ ...args.payload, instruction: rewrittenInstruction }),
          { signal: args.signal }
        ),
      1
    )) as any;
    classification = classResult?.finalOutput ?? classification;
  } catch {
    // ignore classifier failures; default to edit/no tools
  }
  const actionIdRaw = typeof args.payload.actionId === "string" ? args.payload.actionId.trim() : "";
  if (actionIdRaw && actionIdRaw !== "check_sources" && actionIdRaw !== "clear_checks") {
    classification = { route: "edit", needsSearch: false, needsCode: false };
  }

  const tools: any[] = [];
  const docTool = buildDocFetchTool();
  if (docTool) tools.push(docTool);
  if (classification.needsSearch && typeof webSearchTool === "function") {
    tools.push(webSearchTool({ userLocation: { type: "approximate" } }));
  }
  if (classification.needsCode && typeof codeInterpreterTool === "function") {
    tools.push(codeInterpreterTool());
  }

  const basePrompt = buildAgentPrompt({ ...args.payload, instruction: rewrittenInstruction });
  const history = Array.isArray(args.payload?.history) ? args.payload.history : [];
  const normalizedHistory = history
    .map((msg) => ({
      role: msg?.role,
      content: typeof msg?.content === "string" ? msg.content : String(msg?.content ?? "")
    }))
    .filter((msg) => (msg.role === "user" || msg.role === "assistant" || msg.role === "system") && msg.content.trim())
    .slice(-20);
  const historyBlock = normalizedHistory.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
  const userInput = historyBlock ? `Conversation history:\n${historyBlock}\n\n${basePrompt.user}` : basePrompt.user;
  const qaPrompt = [
    basePrompt.system,
    "This request is Q&A. Do NOT propose edits. operations must be an empty array."
  ].join("\n");
  const generalPrompt = [
    basePrompt.system,
    "This request is general assistance. Do NOT propose edits. operations must be an empty array."
  ].join("\n");

  const editAgent = new Agent({
    name: "assistant",
    instructions: basePrompt.system,
    model: args.model,
    tools: tools.length ? tools : undefined,
    outputType: outputSchema,
    modelSettings: { temperature: args.temperature }
  });
  const internalQaAgent = new Agent({
    name: "internalQA",
    instructions: qaPrompt,
    model: args.model,
    tools: [
      ...(docTool ? [docTool] : []),
      ...(typeof webSearchTool === "function" ? [webSearchTool({ userLocation: { type: "approximate" } })] : [])
    ],
    outputType: outputSchema,
    modelSettings: { temperature: args.temperature }
  });
  const externalFactAgent = new Agent({
    name: "externalFactFinding",
    instructions: qaPrompt,
    model: args.model,
    tools: [
      ...(docTool ? [docTool] : []),
      ...(typeof webSearchTool === "function" ? [webSearchTool({ userLocation: { type: "approximate" } })] : []),
      ...(typeof codeInterpreterTool === "function" ? [codeInterpreterTool()] : [])
    ],
    outputType: outputSchema,
    modelSettings: { temperature: args.temperature }
  });
  const generalAgent = new Agent({
    name: "generalAssistant",
    instructions: generalPrompt,
    model: args.model,
    tools: tools.length ? tools : undefined,
    outputType: outputSchema,
    modelSettings: { temperature: args.temperature }
  });

  const onStream = typeof args.onStream === "function" ? args.onStream : null;
  const onEvent = onStream
    ? (event: any) => {
        const extracted = extractStreamDelta(event);
        if (!extracted) return;
        if (extracted.delta) {
          onStream({ requestId: args.requestId || "", kind: "delta", delta: extracted.delta });
        } else if (extracted.tool) {
          onStream({ requestId: args.requestId || "", kind: "tool", tool: extracted.tool });
        } else if (extracted.status) {
          onStream({ requestId: args.requestId || "", kind: "status", message: extracted.status });
        }
      }
    : undefined;

  const selectedAgent =
    classification.route === "external_fact"
      ? externalFactAgent
      : classification.route === "internal_qa"
        ? internalQaAgent
        : classification.route === "general"
          ? generalAgent
          : editAgent;
  const result = (await withRetry(
    () => run(selectedAgent, userInput, { signal: args.signal, onEvent }),
    1
  )) as any;
  const output = result?.finalOutput;
  if (!output || typeof output.assistantText !== "string" || !Array.isArray(output.operations)) {
    throw new Error("Agent response missing final output.");
  }
  const outputEdits = Array.isArray((output as any).edits)
    ? ((output as any).edits as AgentEdit[])
    : [];
  let operations = output.operations as AgentOperation[];
  if (outputEdits.length > 0) {
    operations = buildOperationsFromEdits(args.payload, outputEdits);
  }
  return {
    assistantText: output.assistantText,
    operations,
    citations: Array.isArray((output as any).citations) ? (output as any).citations : undefined,
    actions: Array.isArray((output as any).actions) ? (output as any).actions : undefined,
    route: classification.route
  };
};

const buildAgentPrompt = (payload: AgentRequestPayload): { system: string; user: string } => {
  const scope = payload.scope;
  const instruction = String(payload.instruction || "").trim();
  if (!instruction) {
    throw new Error("agent-request: instruction is required");
  }
  if (scope !== "selection" && scope !== "document") {
    throw new Error('agent-request: scope must be "selection" | "document"');
  }

  const audienceRaw = typeof (payload.settings as any)?.audience === "string" ? String((payload.settings as any).audience) : "";
  const audience =
    audienceRaw === "general" || audienceRaw === "knowledgeable" || audienceRaw === "expert" ? audienceRaw : "expert";
  const formalityRaw = typeof (payload.settings as any)?.formality === "string" ? String((payload.settings as any).formality) : "";
  const formality =
    formalityRaw === "casual" || formalityRaw === "neutral" || formalityRaw === "formal" ? formalityRaw : "formal";
  const styleLine = `Style: audience=${audience}; formality=${formality}.`;
  const actionIdRaw = typeof payload.actionId === "string" ? payload.actionId.trim() : "";
  const actionLine = actionIdRaw ? `Action: ${actionIdRaw}. Follow this action unless it conflicts with the instruction.` : "";

  const hasTargets = Array.isArray(payload.targets) && payload.targets.length > 0;
  const operationSchemaLines =
    scope === "selection"
      ? ['- {"op":"replaceSelection","text":string}']
      : hasTargets
        ? ['- {"op":"replaceParagraph","n":number,"text":string}']
        : ['- {"op":"replaceDocument","text":string}'];

  const system = [
    "You are an AI writing assistant embedded in an offline desktop academic editor.",
    styleLine,
    actionLine,
    "Return STRICT JSON only (no markdown, no backticks, no extra keys).",
    'Schema: {"assistantText": string, "operations": Array<Operation>, "edits"?: Array<Edit>}.',
    "Operation is one of:",
    ...operationSchemaLines,
    "Edit is: {\"action\":\"replace\",\"start\":number,\"end\":number,\"text\":string} with offsets relative to the provided text block.",
    "assistantText: brief response to the user (what you did / answer).",
    "If the instruction is NOT a request to modify text (e.g. user asks a question), return operations: [] and answer in assistantText.",
    "You may return edits instead of operations. If edits is present, operations may be [].",
    "Never include surrounding quotes in text fields; return raw text."
  ].join("\n");

  if (scope === "selection") {
    const sel = payload.selection;
    if (!sel || typeof sel.text !== "string") {
      throw new Error("agent-request: selection.text is required for selection scope");
    }
    const selected = sel.text;
    const chunkHint =
      typeof payload.settings?.chunkSize === "number" && payload.settings.chunkSize > 0
        ? `Chunk limit: ${payload.settings.chunkSize} characters.`
        : "";
    const userParts = [
      "Task: Apply the instruction to the TARGET TEXT.",
      "If the instruction is not requesting a text change, answer in assistantText and return operations: [].",
      "If you change the text, return operations: [{\"op\":\"replaceSelection\",\"text\":...}].",
      "Instruction:",
      instruction,
      "",
      "TARGET TEXT (rewrite this):",
      selected
    ];
    if (chunkHint) {
      userParts.push("", chunkHint);
    }
    const user = userParts.join("\n");
    return { system, user };
  }

  const doc = payload.document;
  if (!doc || typeof doc.text !== "string") {
    throw new Error("agent-request: document.text is required for document scope");
  }
  const targets = Array.isArray(payload.targets) ? payload.targets : [];
  const chunkHint =
    typeof payload.settings?.chunkSize === "number" && payload.settings.chunkSize > 0
      ? `Chunk limit: ${payload.settings.chunkSize} characters.`
      : "";
  const targetHint =
    targets.length > 0
      ? [
          "Apply the instruction to the numbered paragraphs in DOCUMENT TEXT.",
          "Only produce operations for paragraphs present in this chunk.",
          "Each paragraph begins with a marker like <<<P:12>>>.",
          "Return operations using op=replaceParagraph with matching n.",
          "If a paragraph needs no change, omit it."
        ].join("\n")
      : "Apply the instruction to the DOCUMENT TEXT.";
  const metaBlock =
    targets.length > 0
      ? [
          "",
          "PARAGRAPH METADATA (for disambiguation only):",
          ...targets
            .slice(0, 180)
            .map((t) => {
              const n = Number(t?.n);
              if (!Number.isFinite(n)) return "";
              const hn = typeof t?.headingNumber === "string" && t.headingNumber.trim() ? t.headingNumber.trim() : "";
              const ht = typeof t?.headingTitle === "string" && t.headingTitle.trim() ? t.headingTitle.trim() : "";
              const extra = [hn ? `heading=${hn}` : "", ht ? `title="${ht.replaceAll("\"", "'")}"` : ""].filter(Boolean).join(" ");
              return extra ? `P${n}: ${extra}` : `P${n}`;
            })
            .filter(Boolean)
        ].join("\n")
      : "";
  const userParts = ["Task:", targetHint, "Instruction:", instruction, metaBlock, "", "DOCUMENT TEXT:", doc.text];
  if (chunkHint) {
    userParts.push("", chunkHint);
  }
  const user = userParts.join("\n");
  return { system, user };
};

const runAgentRequestInternal = async (
  event: Electron.IpcMainInvokeEvent,
  request: { requestId?: string; payload: AgentRequestPayload },
  options?: { stream?: boolean }
): Promise<{
  success: boolean;
  assistantText?: string;
  applyText?: string;
  operations?: AgentOperation[];
  error?: string;
  meta?: { provider: LlmProviderId; model?: string; ms?: number };
}> => {
  const started = Date.now();
  const requestId = typeof (request as any)?.requestId === "string" ? String((request as any).requestId) : "";
  const abortController = new AbortController();
  const inflight = (globalThis as any).__leditorAgentInflight as Map<string, AbortController> | undefined;
  const inflightMap =
    inflight ??
    (() => {
      const m = new Map<string, AbortController>();
      (globalThis as any).__leditorAgentInflight = m;
      return m;
    })();
  if (requestId) inflightMap.set(requestId, abortController);
  try {
    const payload = request?.payload as AgentRequestPayload;
    const settings = payload?.settings;
    const rawProvider = typeof (settings as any)?.provider === "string" ? String((settings as any).provider).trim() : "";
    const provider: LlmProviderId =
      rawProvider === "openai" || rawProvider === "deepseek" || rawProvider === "mistral" || rawProvider === "gemini"
        ? (rawProvider as LlmProviderId)
        : "openai";
    const fallback = getDefaultModelForProvider(provider);
    const model = String(settings?.model || "").trim() || fallback.model || (provider === "openai" ? "codex-mini-latest" : "");
    const temperature = typeof settings?.temperature === "number" ? settings.temperature : 0.2;
    const apiKey = getProviderApiKey(provider, settings?.apiKey);
    if (!apiKey) {
      const envKey = getProviderEnvKeyName(provider);
      return { success: false, error: `Missing ${envKey} in environment.` };
    }

    agentDbg("start", { requestId, provider, model, scope: payload.scope });

    const onStream =
      options?.stream && requestId
        ? (update: AgentStreamUpdate) => {
            if (!update.requestId) update.requestId = requestId;
            try {
              event.sender.send("leditor:agent-stream-update", update);
            } catch {
              // ignore
            }
          }
        : undefined;

    const result: any =
      provider === "openai"
        ? await runOpenAiAgentWorkflow({
            requestId,
            payload,
            apiKey,
            model,
            temperature,
            signal: abortController.signal,
            onStream
          })
        : await runCompatAgentWorkflow({
            payload,
            provider,
            apiKey,
            model,
            temperature,
            signal: abortController.signal
          });

    if (provider === "openai" && payload?.instruction && result?.operations && result?.operations?.length) {
      const route = (result as any).route;
      if (route && route !== "edit") {
        result.operations = [];
      }
    }

    return {
      success: true,
      assistantText: result.assistantText,
      applyText: typeof result.applyText === "string" ? result.applyText : undefined,
      operations: result.operations,
      ...(Array.isArray(result.citations) ? { citations: result.citations } : {}),
      ...(Array.isArray(result.actions) ? { actions: result.actions } : {}),
      meta: { provider, model, ms: Date.now() - started }
    };
  } catch (error) {
    const message = normalizeError(error);
    agentDbg("error", { requestId, error: message });
    if (options?.stream && requestId) {
      try {
        event.sender.send("leditor:agent-stream-update", { requestId, kind: "error", message });
      } catch {
        // ignore
      }
    }
    return {
      success: false,
      error: message,
      meta: { provider: "openai" as const, ms: Date.now() - started }
    };
  } finally {
    if (requestId) inflightMap.delete(requestId);
    if (options?.stream && requestId) {
      try {
        event.sender.send("leditor:agent-stream-update", { requestId, kind: "done" });
      } catch {
        // ignore
      }
    }
    agentDbg("done", { requestId, ms: Date.now() - started });
  }
};

const pdfViewerPayloads = new Map<string, Record<string, unknown>>();
const pdfResolveCache = new Map<string, string | null>();
let pdfViewerWindow: BrowserWindow | null = null;
const PDF_RESOLVE_CACHE_VERSION = 2;

type ItemPdfIndex = { mtimeMs: number; byKey: Map<string, string> };
const itemPdfIndexCache = new Map<string, ItemPdfIndex>();
const itemPdfIndexInflight = new Map<string, Promise<Map<string, string>>>();

type TablePdfIndex = { mtimeKey: string; byKey: Map<string, { pdf?: string; attachment?: string }> };
const tablePdfIndexCache = new Map<string, TablePdfIndex>();
const tablePdfIndexInflight = new Map<string, Promise<Map<string, { pdf?: string; attachment?: string }>>>();

const buildItemPdfIndexFromJsonl = async (filePath: string): Promise<Map<string, string>> => {
  const byKey = new Map<string, string>();
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let scanned = 0;
  for await (const line of rl) {
    scanned += 1;
    const trimmed = String(line || "").trim();
    if (!trimmed) continue;
    let obj: any = null;
    try {
      obj = JSON.parse(normalizeLegacyJson(trimmed));
    } catch {
      continue;
    }
    const key = String(obj?.item_key ?? obj?.itemKey ?? obj?.key ?? "").trim();
    if (!key) continue;
    // Only index true PDF locations (file path or URL). Do NOT treat `source` (journal name) as a PDF path.
    const pdfRaw = String(obj?.pdf_path ?? obj?.pdf ?? obj?.source ?? "").trim();
    const pdf = looksLikePdfPath(pdfRaw) ? normalizePdfCandidate(pdfRaw) : "";
    if (!pdf) continue;
    if (!byKey.has(key)) byKey.set(key, pdf);
    const lower = key.toLowerCase();
    if (!byKey.has(lower)) byKey.set(lower, pdf);
    if (byKey.size >= 5000) {
      // Enough coverage; avoid spending time indexing the entire file.
      break;
    }
  }
  if (byKey.size === 0 && scanned >= 2000) {
    // This dataset likely doesn't include actual PDF paths in batches; stop early to keep UX snappy.
    try {
      rl.close();
      stream.close();
    } catch {
      // ignore
    }
  }
  return byKey;
};

const ensureItemPdfIndex = async (runDir: string): Promise<Map<string, string>> => {
  const dir = String(runDir || "").trim();
  if (!dir) return new Map();
  const jsonlPath = path.join(dir, "pyr_l1_batches.jsonl");
  const jsonPath = path.join(dir, "pyr_l1_batches.json");
  const candidates = [jsonlPath, jsonPath];
  const existing = candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  if (!existing) return new Map();

  let stat: fs.Stats | null = null;
  try {
    stat = fs.statSync(existing);
  } catch {
    stat = null;
  }
  const mtimeMs = stat?.mtimeMs ?? 0;
  const cached = itemPdfIndexCache.get(existing);
  if (cached && cached.mtimeMs === mtimeMs) return cached.byKey;

  const inflight = itemPdfIndexInflight.get(existing);
  if (inflight) return inflight;

  const task = (async () => {
    const start = Date.now();
    let byKey: Map<string, string>;
    if (existing.endsWith(".jsonl")) {
      byKey = await buildItemPdfIndexFromJsonl(existing);
    } else {
      // Fallback: streaming scan for keys in huge JSON array.
      byKey = new Map<string, string>();
      try {
        const resolved = await findPdfInLargeBatchesJson(existing, "__NOOP__");
        void resolved;
      } catch {
        // ignore
      }
    }
    itemPdfIndexCache.set(existing, { mtimeMs, byKey });
    console.info("[leditor][pdf] item pdf index built", { path: existing, count: byKey.size, ms: Date.now() - start });
    return byKey;
  })().finally(() => itemPdfIndexInflight.delete(existing));

  itemPdfIndexInflight.set(existing, task);
  return task;
};

const ensureTablePdfIndex = async (
  bibliographyDir: string
): Promise<Map<string, { pdf?: string; attachment?: string }>> => {
  const dir = String(bibliographyDir || "").trim();
  if (!dir) return new Map();

  let files: string[] = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json") && !name.startsWith("references"))
      .map((name) => path.join(dir, name));
  } catch {
    files = [];
  }
  if (!files.length) return new Map();

  // Cache key uses newest mtime among candidate files.
  let newest = 0;
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      newest = Math.max(newest, st.mtimeMs || 0);
    } catch {
      // ignore
    }
  }
  const mtimeKey = `${dir}::${newest}`;
  const cached = tablePdfIndexCache.get(mtimeKey);
  if (cached) return cached.byKey;
  const inflight = tablePdfIndexInflight.get(mtimeKey);
  if (inflight) return inflight;

  const task = (async () => {
    const byKey = new Map<string, { pdf?: string; attachment?: string }>();
    for (const filePath of files) {
      const parsed = readJsonIfExists(filePath);
      const table = parsed?.table;
      const cols = Array.isArray(table?.columns) ? table.columns.map((c: any) => String(c).toLowerCase()) : [];
      const rows = Array.isArray(table?.rows) ? table.rows : [];
      if (!cols.length || !rows.length) continue;
      const keyIdx = cols.indexOf("key");
      const pdfIdx = cols.indexOf("pdf_path");
      const attachIdx = cols.indexOf("attachment_pdf");
      if (keyIdx === -1 || (pdfIdx === -1 && attachIdx === -1)) continue;

      for (const row of rows) {
        if (!Array.isArray(row)) continue;
        const key = String(row[keyIdx] ?? "").trim();
        if (!key) continue;
        const pdfRaw = pdfIdx >= 0 ? String(row[pdfIdx] ?? "").trim() : "";
        const attachment = attachIdx >= 0 ? String(row[attachIdx] ?? "").trim() : "";
        if (!pdfRaw && !attachment) continue;
        const entry = byKey.get(key) ?? {};
        if (!entry.pdf && pdfRaw) entry.pdf = pdfRaw;
        if (!entry.attachment && attachment) entry.attachment = attachment;
        byKey.set(key, entry);
      }
    }
    tablePdfIndexCache.set(mtimeKey, { mtimeKey, byKey });
    console.info("[leditor][pdf] table pdf index built", { dir, count: byKey.size });
    return byKey;
  })().finally(() => tablePdfIndexInflight.delete(mtimeKey));

  tablePdfIndexInflight.set(mtimeKey, task);
  return task;
};

const convertWslUncPath = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const normalized = trimmed.replace(/^\\\\+/, "");
  const segments = normalized.split(/[\\/]+/).filter(Boolean);
  // Examples:
  //   \\wsl$\Ubuntu-20.04\home\pantera\... -> /home/pantera/...
  //   \\wsl.localhost\Ubuntu-22.04\home\pantera\... -> /home/pantera/...
  const head = String(segments[0] || "").toLowerCase();
  const isWslDollar = head === "wsl$";
  const isWslLocalhost = head === "wsl.localhost";
  if ((isWslDollar || isWslLocalhost) && segments.length >= 3) {
    return `/${segments.slice(2).join("/")}`;
  }
  return trimmed;
};

const normalizeFsPath = (value: string): string => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\\\\")) {
    return convertWslUncPath(trimmed);
  }
  return trimmed;
};

const normalizePdfCandidate = (value: string): string => String(value || "").trim();

const looksLikePdfPath = (value: string): boolean => {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.startsWith("http://") || lower.startsWith("https://")) return lower.includes(".pdf");
  const normalized = normalizePdfCandidate(raw).toLowerCase();
  return normalized.endsWith(".pdf");
};

const dirnameLike = (filePath: string): string => {
  const normalized = String(filePath || "").trim().replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx > 0 ? normalized.slice(0, idx) : "";
};

const findPdfInLargeBatchesJson = async (filePath: string, itemKey: string): Promise<string | null> => {
  const key = String(itemKey || "").trim();
  if (!key) return null;
  const needleVariants = [`"item_key":"${key}"`, `"itemKey":"${key}"`, `"key":"${key}"`];
  const pdfRegexes = [/"pdf_path"\s*:\s*"([^"]+)"/, /"pdf"\s*:\s*"([^"]+)"/, /"source"\s*:\s*"([^"]+)"/];
  return await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    let buf = "";
    const keepMax = 2 * 1024 * 1024;
    const searchWindow = 32 * 1024;
    const flush = () => {
      if (buf.length > keepMax) buf = buf.slice(buf.length - keepMax);
    };
    stream.on("data", (chunk: string | Buffer) => {
      buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      flush();
      for (const needle of needleVariants) {
        const idx = buf.indexOf(needle);
        if (idx === -1) continue;
        const slice = buf.slice(idx, Math.min(buf.length, idx + searchWindow));
        for (const re of pdfRegexes) {
          const m = slice.match(re);
          if (m && m[1]) {
            stream.close();
            resolve(String(m[1]));
            return;
          }
        }
      }
    });
    stream.on("end", () => resolve(null));
    stream.on("error", (err) => reject(err));
  });
};

const normalizeLegacyJson = (raw: string): string => {
  return raw
    .replace(/\bNaN\b/g, "null")
    .replace(/\bnan\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Infinity\b/g, "null");
};

const dqEntryCache = new Map<string, { mtimeMs: number; entries: Map<string, unknown> }>();
let cachedBibliographyDir: string | null = null;

type DqidIndexCacheEntry = { mtimeMs: number; positions: Map<string, number> };
const dqidIndexCache = new Map<string, DqidIndexCacheEntry>();
const dqidIndexInflight = new Map<string, Promise<Map<string, number>>>();

const ensureDqidIndex = async (lookupPath: string): Promise<Map<string, number>> => {
  const target = normalizeFsPath(lookupPath);
  if (!target) return new Map();

  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    stat = null;
  }
  const mtimeMs = stat?.mtimeMs ?? 0;
  const cached = dqidIndexCache.get(target);
  if (cached && cached.mtimeMs === mtimeMs) return cached.positions;
  const inflight = dqidIndexInflight.get(target);
  if (inflight) return inflight;

  const buildPromise = (async () => {
    const positions = new Map<string, number>();
    // Match keys like "bb20a0475f": or "a700678522": (10 base36-ish chars in practice).
    const keyRe = /"([0-9a-z]{10})"\s*:/gi;
    // NOTE: positions are byte offsets (fs read positions are byte-based).
    // Use latin1 decoding so string indices map 1:1 to bytes (keys are ASCII).
    const stream = fs.createReadStream(target);
    let offsetBytes = 0;
    let carryText = "";
    const maxCarry = 128;

    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk: string | Buffer) => {
        const bufChunk = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
        const text = bufChunk.toString("latin1");
        const buf = carryText + text;
        keyRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = keyRe.exec(buf))) {
          const id = String(match[1] || "").trim().toLowerCase();
          if (!id) continue;
          if (positions.has(id)) continue;
          // Absolute position points to the opening quote of the key inside the file.
          // Because latin1 is 1 byte per code unit, match.index is a byte offset in buf.
          const abs = offsetBytes - carryText.length + match.index;
          if (abs >= 0) positions.set(id, abs);
        }
        carryText = buf.slice(Math.max(0, buf.length - maxCarry));
        offsetBytes += bufChunk.length;
      });
      stream.on("end", () => resolve());
      stream.on("error", (err) => reject(err));
    });

    dqidIndexCache.set(target, { mtimeMs, positions });
    console.info("[leditor][directquote] index built", { path: target, count: positions.size });
    return positions;
  })().finally(() => {
    dqidIndexInflight.delete(target);
  });

  dqidIndexInflight.set(target, buildPromise);
  return buildPromise;
};

const computeValueStartPos = async (fd: fs.promises.FileHandle, keyPos: number): Promise<number | null> => {
  // Read a small window starting at keyPos to find the ':' then the value start.
  const windowSize = 4096;
  const buf = Buffer.alloc(windowSize);
  const read = await fd.read(buf, 0, windowSize, keyPos);
  // Use latin1 so indices correspond to bytes; we only look for ':' and whitespace.
  const text = buf.toString("latin1", 0, read.bytesRead);
  const colonIdx = text.indexOf(":");
  if (colonIdx === -1) return null;
  let i = colonIdx + 1;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  if (i >= text.length) return null;
  return keyPos + i;
};

const readJsonValueAt = async (lookupPath: string, startPos: number): Promise<unknown | null> => {
  const target = normalizeFsPath(lookupPath);
  if (!target) return null;
  const fd = await fs.promises.open(target, "r");
  try {
    const chunkSize = 128 * 1024;
    let pos = startPos;
    // Store bytes (not decoded strings) so UTF-8 chunk boundaries never corrupt parsing.
    const parts: Buffer[] = [];
    let totalBytes = 0;

    // State machine over JSON ASCII bytes.
    let started = false;
    let firstByte = 0;
    let inString = false;
    let escape = false;
    let braceDepth = 0;
    let bracketDepth = 0;

    const isWs = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

    for (let iter = 0; iter < 20000; iter += 1) {
      const chunk = Buffer.alloc(chunkSize);
      const read = await fd.read(chunk, 0, chunkSize, pos);
      if (read.bytesRead <= 0) break;
      const buf = chunk.subarray(0, read.bytesRead);
      parts.push(buf);
      totalBytes += buf.length;
      pos += read.bytesRead;

      // Hard cap to avoid runaway memory.
      if (totalBytes > 64 * 1024 * 1024) {
        throw new Error("direct-quote-value-too-large");
      }

      // Scan across the accumulated buffers. We only need to scan newly appended bytes,
      // but a simple scan with a moving index across the tail is OK at this size.
      let globalIndex = 0;
      for (const p of parts) {
        for (let i = 0; i < p.length; i += 1) {
          const b = p[i];
          if (!started) {
            if (isWs(b)) {
              globalIndex += 1;
              continue;
            }
            started = true;
            firstByte = b;
            if (firstByte === 0x22) inString = true; // "
          }

          if (inString) {
            if (escape) {
              escape = false;
              globalIndex += 1;
              continue;
            }
            if (b === 0x5c) {
              escape = true; // \
              globalIndex += 1;
              continue;
            }
            if (b === 0x22) {
              inString = false;
              if (firstByte === 0x22) {
                const end = globalIndex + 1;
                const full = Buffer.concat(parts, totalBytes);
                const slice = full.subarray(0, end).toString("utf8");
                return JSON.parse(normalizeLegacyJson(slice));
              }
            }
            globalIndex += 1;
            continue;
          }

          if (b === 0x22) {
            inString = true;
            globalIndex += 1;
            continue;
          }

          if (firstByte === 0x7b || braceDepth > 0) {
            if (b === 0x7b) braceDepth += 1;
            else if (b === 0x7d) braceDepth -= 1;
            if (firstByte === 0x7b && braceDepth === 0 && b === 0x7d) {
              const end = globalIndex + 1;
              const full = Buffer.concat(parts, totalBytes);
              const slice = full.subarray(0, end).toString("utf8");
              return JSON.parse(normalizeLegacyJson(slice));
            }
            globalIndex += 1;
            continue;
          }

          if (firstByte === 0x5b || bracketDepth > 0) {
            if (b === 0x5b) bracketDepth += 1;
            else if (b === 0x5d) bracketDepth -= 1;
            if (firstByte === 0x5b && bracketDepth === 0 && b === 0x5d) {
              const end = globalIndex + 1;
              const full = Buffer.concat(parts, totalBytes);
              const slice = full.subarray(0, end).toString("utf8");
              return JSON.parse(normalizeLegacyJson(slice));
            }
            globalIndex += 1;
            continue;
          }

          // Primitive ends at ',' or '}' or ']'
          if (b === 0x2c || b === 0x7d || b === 0x5d) {
            const end = globalIndex;
            const full = Buffer.concat(parts, totalBytes);
            const raw = full.subarray(0, end).toString("utf8").trim();
            if (!raw) return null;
            return JSON.parse(normalizeLegacyJson(raw));
          }

          globalIndex += 1;
        }
      }
    }
    return null;
  } finally {
    await fd.close();
  }
};

const readJsonValueAtWithHandle = async (
  fd: fs.promises.FileHandle,
  startPos: number
): Promise<unknown | null> => {
  try {
    const chunkSize = 128 * 1024;
    let pos = startPos;
    const parts: Buffer[] = [];
    let totalBytes = 0;

    let started = false;
    let firstByte = 0;
    let inString = false;
    let escape = false;
    let braceDepth = 0;
    let bracketDepth = 0;

    const isWs = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

    for (let iter = 0; iter < 20000; iter += 1) {
      const chunk = Buffer.alloc(chunkSize);
      const read = await fd.read(chunk, 0, chunkSize, pos);
      if (read.bytesRead <= 0) break;
      const buf = chunk.subarray(0, read.bytesRead);
      parts.push(buf);
      totalBytes += buf.length;
      pos += read.bytesRead;

      if (totalBytes > 64 * 1024 * 1024) {
        throw new Error("direct-quote-value-too-large");
      }

      let globalIndex = 0;
      for (const p of parts) {
        for (let i = 0; i < p.length; i += 1) {
          const b = p[i];
          if (!started) {
            if (isWs(b)) {
              globalIndex += 1;
              continue;
            }
            started = true;
            firstByte = b;
            if (firstByte === 0x22) inString = true;
          }

          if (inString) {
            if (escape) {
              escape = false;
              globalIndex += 1;
              continue;
            }
            if (b === 0x5c) {
              escape = true;
              globalIndex += 1;
              continue;
            }
            if (b === 0x22) {
              inString = false;
              if (firstByte === 0x22) {
                const end = globalIndex + 1;
                const full = Buffer.concat(parts, totalBytes);
                const slice = full.subarray(0, end).toString("utf8");
                return JSON.parse(normalizeLegacyJson(slice));
              }
            }
            globalIndex += 1;
            continue;
          }

          if (b === 0x22) {
            inString = true;
            globalIndex += 1;
            continue;
          }

          if (firstByte === 0x7b || braceDepth > 0) {
            if (b === 0x7b) braceDepth += 1;
            else if (b === 0x7d) braceDepth -= 1;
            if (firstByte === 0x7b && braceDepth === 0 && b === 0x7d) {
              const end = globalIndex + 1;
              const full = Buffer.concat(parts, totalBytes);
              const slice = full.subarray(0, end).toString("utf8");
              return JSON.parse(normalizeLegacyJson(slice));
            }
            globalIndex += 1;
            continue;
          }

          if (firstByte === 0x5b || bracketDepth > 0) {
            if (b === 0x5b) bracketDepth += 1;
            else if (b === 0x5d) bracketDepth -= 1;
            if (firstByte === 0x5b && bracketDepth === 0 && b === 0x5d) {
              const end = globalIndex + 1;
              const full = Buffer.concat(parts, totalBytes);
              const slice = full.subarray(0, end).toString("utf8");
              return JSON.parse(normalizeLegacyJson(slice));
            }
            globalIndex += 1;
            continue;
          }

          if (b === 0x2c || b === 0x7d || b === 0x5d) {
            const end = globalIndex;
            const full = Buffer.concat(parts, totalBytes);
            const raw = full.subarray(0, end).toString("utf8").trim();
            if (!raw) return null;
            return JSON.parse(normalizeLegacyJson(raw));
          }

          globalIndex += 1;
        }
      }
    }
    return null;
  } catch (error) {
    throw error;
  }
};

export const getDirectQuotePayload = async (lookupPath: string, dqid: string): Promise<unknown | null> => {
  const target = normalizeFsPath(lookupPath);
  const id = String(dqid || "").trim().toLowerCase();
  if (!target || !id) return null;

  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.stat(target);
  } catch {
    stat = null;
  }
  const mtimeMs = stat?.mtimeMs ?? 0;
  const cached = dqEntryCache.get(target);
  if (cached && cached.mtimeMs === mtimeMs && cached.entries.has(id)) {
    return cached.entries.get(id) ?? null;
  }
  const entries = cached && cached.mtimeMs === mtimeMs ? cached.entries : new Map<string, unknown>();
  dqEntryCache.set(target, { mtimeMs, entries });

  const positions = await ensureDqidIndex(target);
  const keyPos = positions.get(id);
  if (typeof keyPos !== "number") {
    entries.set(id, null);
    return null;
  }
  const fd = await fs.promises.open(target, "r");
  try {
    const valueStart = await computeValueStartPos(fd, keyPos);
    if (valueStart == null) {
      entries.set(id, null);
      return null;
    }
    const value = await readJsonValueAt(target, valueStart);
    entries.set(id, value);
    return value;
  } finally {
    await fd.close();
  }
};

type EmbeddingIndexItem = {
  id: string;
  title: string;
  author?: string;
  year?: string;
  source?: string;
  page?: number;
  directQuote?: string;
  paraphrase?: string;
};

type EmbeddingIndex = {
  key: string;
  lookupPath: string;
  mtimeMs: number;
  model: string;
  dims: number;
  items: EmbeddingIndexItem[];
  vectors: Float32Array;
  ready: boolean;
  building: boolean;
  total: number;
  processed: number;
  builtAt: number;
  lastError?: string;
};

const embeddingIndexCache = new Map<string, EmbeddingIndex>();
const embeddingIndexInflight = new Map<string, Promise<EmbeddingIndex>>();

const getEmbeddingCacheDir = (): string => path.join(app.getPath("userData"), "embedding-cache");

const makeEmbeddingCacheKey = (lookupPath: string, model: string, mtimeMs: number): string => {
  const hash = crypto.createHash("sha1");
  hash.update(`${lookupPath}|${model}|${mtimeMs}`);
  return hash.digest("hex");
};

const normalizeEmbeddingText = (value: string): string =>
  String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();

const loadEmbeddingIndexFromDisk = async (args: {
  lookupPath: string;
  mtimeMs: number;
  model: string;
  key: string;
}): Promise<EmbeddingIndex | null> => {
  try {
    const dir = getEmbeddingCacheDir();
    const metaPath = path.join(dir, `dq_${args.key}.json`);
    const binPath = path.join(dir, `dq_${args.key}.bin`);
    const metaRaw = await fs.promises.readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as any;
    if (!meta || meta.model !== args.model || meta.mtimeMs !== args.mtimeMs) return null;
    const buf = await fs.promises.readFile(binPath);
    const dims = Math.max(1, Number(meta.dims) || 0);
    const items = Array.isArray(meta.items) ? (meta.items as EmbeddingIndexItem[]) : [];
    const vec = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    if (items.length * dims !== vec.length) return null;
    const index: EmbeddingIndex = {
      key: args.key,
      lookupPath: args.lookupPath,
      mtimeMs: args.mtimeMs,
      model: args.model,
      dims,
      items,
      vectors: vec,
      ready: true,
      building: false,
      total: items.length,
      processed: items.length,
      builtAt: Number(meta.builtAt) || Date.now()
    };
    return index;
  } catch {
    return null;
  }
};

const saveEmbeddingIndexToDisk = async (index: EmbeddingIndex): Promise<void> => {
  try {
    const dir = getEmbeddingCacheDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const metaPath = path.join(dir, `dq_${index.key}.json`);
    const binPath = path.join(dir, `dq_${index.key}.bin`);
    const meta = {
      key: index.key,
      lookupPath: index.lookupPath,
      mtimeMs: index.mtimeMs,
      model: index.model,
      dims: index.dims,
      builtAt: index.builtAt,
      items: index.items
    };
    await fs.promises.writeFile(metaPath, JSON.stringify(meta));
    await fs.promises.writeFile(binPath, Buffer.from(index.vectors.buffer));
  } catch (error) {
    console.warn("[substantiate] failed to persist embedding index", normalizeError(error));
  }
};

const normalizeVectorInPlace = (vec: number[]): number[] => {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const norm = Math.sqrt(sum);
  if (!norm) return vec;
  for (let i = 0; i < vec.length; i += 1) vec[i] = vec[i]! / norm;
  return vec;
};

const dotProduct = (query: number[], vecs: Float32Array, offset: number): number => {
  let sum = 0;
  for (let i = 0; i < query.length; i += 1) {
    sum += query[i]! * vecs[offset + i]!;
  }
  return sum;
};

const ensureEmbeddingIndex = async (args: {
  lookupPath: string;
  model: string;
  apiKey: string;
}): Promise<EmbeddingIndex> => {
  const target = normalizeFsPath(args.lookupPath);
  if (!target) throw new Error("lookupPath is required");
  const stat = await fs.promises.stat(target);
  const mtimeMs = stat?.mtimeMs ?? 0;
  const key = makeEmbeddingCacheKey(target, args.model, mtimeMs);
  const cached = embeddingIndexCache.get(key);
  if (cached && cached.ready) return cached;
  const inflight = embeddingIndexInflight.get(key);
  if (inflight) return inflight;

  const fromDisk = await loadEmbeddingIndexFromDisk({ lookupPath: target, mtimeMs, model: args.model, key });
  if (fromDisk) {
    embeddingIndexCache.set(key, fromDisk);
    return fromDisk;
  }

  const buildPromise = (async () => {
    const index: EmbeddingIndex = {
      key,
      lookupPath: target,
      mtimeMs,
      model: args.model,
      dims: 0,
      items: [],
      vectors: new Float32Array(0),
      ready: false,
      building: true,
      total: 0,
      processed: 0,
      builtAt: Date.now()
    };
    embeddingIndexCache.set(key, index);

    const positions = await ensureDqidIndex(target);
    index.total = positions.size;
    const items: EmbeddingIndexItem[] = [];
    const titles: string[] = [];
    const fd = await fs.promises.open(target, "r");
    try {
      let seen = 0;
      for (const [id, keyPos] of positions.entries()) {
        const valueStart = await computeValueStartPos(fd, keyPos);
        if (valueStart == null) {
          seen += 1;
          continue;
        }
        const raw = (await readJsonValueAtWithHandle(fd, valueStart)) as any;
        const title = normalizeEmbeddingText(raw?.title ?? "");
        if (title) {
          items.push({
            id,
            title,
            author: typeof raw?.author_summary === "string" ? raw.author_summary : undefined,
            year: typeof raw?.year === "string" ? raw.year : undefined,
            source: typeof raw?.source === "string" ? raw.source : undefined,
            page: Number.isFinite(raw?.page) ? Number(raw.page) : undefined,
            directQuote: typeof raw?.direct_quote_clean === "string" ? raw.direct_quote_clean : typeof raw?.direct_quote === "string" ? raw.direct_quote : undefined,
            paraphrase: typeof raw?.paraphrase === "string" ? raw.paraphrase : undefined
          });
          titles.push(title);
        }
        seen += 1;
        if (seen % 500 === 0) {
          index.processed = seen;
        }
      }
      index.processed = seen;
    } finally {
      await fd.close();
    }

    if (items.length === 0) {
      index.ready = true;
      index.building = false;
      index.items = [];
      index.vectors = new Float32Array(0);
      embeddingIndexCache.set(key, index);
      return index;
    }

    const embeddings: number[][] = [];
    for (let i = 0; i < titles.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = titles.slice(i, i + EMBEDDING_BATCH_SIZE);
      const vectors = await callOpenAiEmbeddings({ apiKey: args.apiKey, model: args.model, input: batch });
      embeddings.push(...vectors);
      index.processed = Math.min(index.total, index.processed + batch.length);
    }

    const dims = embeddings[0]?.length ?? 0;
    if (!dims) {
      index.ready = true;
      index.building = false;
      index.items = [];
      index.vectors = new Float32Array(0);
      index.lastError = "Embedding model returned no vectors.";
      embeddingIndexCache.set(key, index);
      return index;
    }
    index.dims = dims;
    index.items = items;
    index.vectors = new Float32Array(items.length * dims);
    for (let i = 0; i < items.length; i += 1) {
      const vec = normalizeVectorInPlace(embeddings[i] ?? []);
      const base = i * dims;
      for (let j = 0; j < dims; j += 1) {
        index.vectors[base + j] = Number(vec[j] ?? 0);
      }
    }

    index.ready = true;
    index.building = false;
    index.builtAt = Date.now();
    embeddingIndexCache.set(key, index);
    await saveEmbeddingIndexToDisk(index);
    return index;
  })()
    .catch((error) => {
      const msg = normalizeError(error);
      const failed: EmbeddingIndex = {
        key,
        lookupPath: target,
        mtimeMs,
        model: args.model,
        dims: 0,
        items: [],
        vectors: new Float32Array(0),
        ready: true,
        building: false,
        total: 0,
        processed: 0,
        builtAt: Date.now(),
        lastError: msg
      };
      embeddingIndexCache.set(key, failed);
      return failed;
    })
    .finally(() => {
      embeddingIndexInflight.delete(key);
    });

  embeddingIndexInflight.set(key, buildPromise);
  return buildPromise;
};

const searchEmbeddingIndex = (
  index: EmbeddingIndex,
  query: number[],
  topK: number
): Array<{ item: EmbeddingIndexItem; score: number }> => {
  if (!index.items.length || index.dims === 0) return [];
  if (query.length !== index.dims) return [];
  const k = Math.max(1, Math.min(topK, index.items.length));
  const results: Array<{ idx: number; score: number }> = [];
  let minScore = Infinity;
  let minIdx = -1;
  for (let i = 0; i < index.items.length; i += 1) {
    const score = dotProduct(query, index.vectors, i * index.dims);
    if (results.length < k) {
      results.push({ idx: i, score });
      if (score < minScore) {
        minScore = score;
        minIdx = results.length - 1;
      }
      continue;
    }
    if (score <= minScore) continue;
    results[minIdx] = { idx: i, score };
    minScore = results[0]!.score;
    minIdx = 0;
    for (let r = 1; r < results.length; r += 1) {
      if (results[r]!.score < minScore) {
        minScore = results[r]!.score;
        minIdx = r;
      }
    }
  }
  return results
    .sort((a, b) => b.score - a.score)
    .map((r) => ({ item: index.items[r.idx]!, score: r.score }));
};

const parseStrictJsonObject = (raw: string): any | null => {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      const slice = trimmed.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch {
        return null;
      }
    }
    return null;
  }
};

const resolveBibliographyDir = (): string => {
  if (cachedBibliographyDir) {
    return cachedBibliographyDir;
  }
  const fromEnv = (process.env.TEIA_DATA_HUB_CACHE_DIR || "").trim();
  const home = (process.env.HOME || "").trim();
  const candidates = [
    fromEnv,
    path.join(app.getPath("userData"), "data-hub-cache"),
    // Useful when testing LEditor standalone alongside the main Annotarium app.
    path.join(app.getPath("appData"), "Annotarium", "data-hub-cache"),
    // Useful when testing against the dev app name (matches Electron userData folder).
    path.join(app.getPath("appData"), "my-electron-app", "data-hub-cache"),
    home ? path.join(home, ".config", "Annotarium", "data-hub-cache") : "",
    home ? path.join(home, ".config", "my-electron-app", "data-hub-cache") : ""
  ].filter(Boolean);

  const refsCount = (dir: string): number => {
    try {
      const pickCount = (obj: any): number => {
        if (!obj || typeof obj !== "object") return 0;
        if (Array.isArray((obj as any).items)) return (obj as any).items.length;
        if ((obj as any).itemsByKey && typeof (obj as any).itemsByKey === "object") {
          return Object.keys((obj as any).itemsByKey).length;
        }
        return 0;
      };
      const library = readJsonIfExists(path.join(dir, REFERENCES_LIBRARY_FILENAME));
      return pickCount(library);
    } catch {
      return 0;
    }
  };

  const tableCount = (dir: string): number => {
    try {
      if (!fs.existsSync(dir)) return 0;
      const files = fs
        .readdirSync(dir)
        .filter(
          (name) =>
            name.endsWith(".json") &&
            name !== REFERENCES_LIBRARY_FILENAME &&
            !name.startsWith("references.")
        )
        .map((name) => path.join(dir, name))
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
      for (const filePath of files) {
        const parsed = readJsonIfExists(filePath) as { table?: { rows?: unknown[] } } | null;
        const rows = parsed?.table?.rows;
        if (Array.isArray(rows) && rows.length) return rows.length;
      }
      return 0;
    } catch {
      return 0;
    }
  };

  const scored = candidates
    .map((dir) => {
      const refs = refsCount(dir);
      const table = refs > 0 ? 0 : tableCount(dir);
      return { dir, refsCount: refs, tableCount: table };
    })
    .sort((a, b) => {
      if (b.refsCount !== a.refsCount) return b.refsCount - a.refsCount;
      return b.tableCount - a.tableCount;
    });
  const best = scored[0]?.dir;
  if (DEBUG_LOGS) {
    console.info("[leditor][refs] bibliographyDir candidates", scored);
    console.info("[leditor][refs] bibliographyDir picked", { best: best ?? "", fallback: candidates[0] ?? "" });
  }
  cachedBibliographyDir = best ?? candidates[0] ?? path.join(app.getPath("userData"), "data-hub-cache");
  return cachedBibliographyDir;
};

const readJsonIfExists = (filePath: string): any | null => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(normalizeLegacyJson(raw));
  } catch {
    return null;
  }
};

const seedReferencesFromDataHubCache = (bibliographyDir: string): void => {
  try {
    const outPath = path.join(bibliographyDir, REFERENCES_LIBRARY_FILENAME);

    const existing = readJsonIfExists(outPath);
    const existingCount =
      existing && typeof existing === "object"
        ? Array.isArray((existing as any).items)
          ? (existing as any).items.length
          : (existing as any).itemsByKey && typeof (existing as any).itemsByKey === "object"
            ? Object.keys((existing as any).itemsByKey).length
            : 0
        : 0;

    if (!fs.existsSync(bibliographyDir)) return;

    const readLatestJsonTable = (): { sourcePath: string; columns: unknown[]; rows: unknown[][] } | null => {
      const candidates = fs
        .readdirSync(bibliographyDir)
        .filter(
          (name) =>
            name.endsWith(".json") &&
            name !== REFERENCES_LIBRARY_FILENAME &&
            !name.startsWith("references.")
        )
        .map((name) => path.join(bibliographyDir, name))
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
      for (const candidate of candidates) {
        const cachePayload = readJsonIfExists(candidate) as { table?: { columns?: unknown[]; rows?: unknown[][] } } | null;
        const table = cachePayload?.table;
        const columns = Array.isArray(table?.columns) ? (table?.columns as unknown[]) : [];
        const rows = Array.isArray(table?.rows) ? (table?.rows as unknown[][]) : [];
        if (columns.length && rows.length) {
          return { sourcePath: candidate, columns, rows };
        }
      }
      return null;
    };

    const parseCsvRow = (line: string): string[] => {
      const out: string[] = [];
      let field = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === "\"") {
            const next = line[i + 1];
            if (next === "\"") {
              field += "\"";
              i += 1;
              continue;
            }
            inQuotes = false;
            continue;
          }
          field += ch;
          continue;
        }
        if (ch === "\"") {
          inQuotes = true;
          continue;
        }
        if (ch === ",") {
          out.push(field);
          field = "";
          continue;
        }
        field += ch;
      }
      out.push(field);
      return out;
    };

    const readLatestCsvTable = (): { sourcePath: string; columns: unknown[]; rows: unknown[][] } | null => {
      const candidates = fs
        .readdirSync(bibliographyDir)
        .filter((name) => name.toLowerCase().endsWith(".csv") && name.toLowerCase() !== "references.csv")
        .map((name) => path.join(bibliographyDir, name))
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
      const pick = candidates[0];
      if (!pick) return null;
      const raw = fs.readFileSync(pick, "utf-8");
      const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
      if (lines.length < 2) return null;
      const columns = parseCsvRow(lines[0]).map((c) => c.trim());
      const rows: unknown[][] = [];
      for (let i = 1; i < lines.length; i += 1) {
        rows.push(parseCsvRow(lines[i]));
      }
      return { sourcePath: pick, columns, rows };
    };

    const tableSource = readLatestJsonTable() ?? readLatestCsvTable();
    if (!tableSource) return;
    const { sourcePath, columns, rows } = tableSource;

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
      const pdfPath =
        pickCell(row, "pdf_path") ||
        pickCell(row, "pdf") ||
        pickCell(row, "file_path") ||
        pickCell(row, "file") ||
        pickCell(row, "attachment_path");
      if (title) item.title = title;
      if (author) item.author = author;
      if (year) item.year = year;
      if (url) item.url = url;
      if (source) item.source = source;
      if (doi) item.doi = doi;
      if (note) item.note = note;
      if (pdfPath) item.pdf_path = pdfPath;
      itemsByKey.set(itemKey, item);
    }

    const next = {
      updatedAt: new Date().toISOString(),
      items: Array.from(itemsByKey.values())
    };

    if (next.items.length <= existingCount) {
      return;
    }

    fs.writeFileSync(outPath, JSON.stringify(next, null, 2), "utf-8");
    console.info("[leditor][refs] seeded references_library.json", {
      bibliographyDir,
      from: sourcePath,
      prevCount: existingCount,
      nextCount: next.items.length
    });
  } catch (error) {
    console.warn("[leditor][refs] failed to seed references_library.json", error);
  }
};

const seedBundledReferences = (bibliographyDir: string): void => {
  try {
    // Never seed into another app's cache directory (e.g. my-electron-app / Annotarium).
    // Seeding is only for standalone smoke testing when using LEditor’s own userData cache.
    const leditorCacheDir = path.join(app.getPath("userData"), "data-hub-cache");
    if (path.resolve(bibliographyDir) !== path.resolve(leditorCacheDir)) {
      return;
    }
    const referencesPath = path.join(bibliographyDir, REFERENCES_LIBRARY_FILENAME);

    const current = readJsonIfExists(referencesPath);
    const hasItems = (obj: any): boolean =>
      Boolean(
        obj &&
          typeof obj === "object" &&
          ((Array.isArray((obj as any).items) && (obj as any).items.length) ||
            ((obj as any).itemsByKey && typeof (obj as any).itemsByKey === "object" && Object.keys((obj as any).itemsByKey).length))
      );

    if (hasItems(current)) {
      return;
    }

    const bundledPath = path.join(app.getAppPath(), "dist", "public", REFERENCES_LIBRARY_FILENAME);
    const bundled = readJsonIfExists(bundledPath);
    if (!hasItems(bundled)) {
      return;
    }
    fs.writeFileSync(referencesPath, JSON.stringify(bundled, null, 2), "utf-8");
  } catch {
    // ignore
  }
};

const createWindow = () => {
  dbg("createWindow", "begin", { argvCount: process.argv.length, isPackaged: app.isPackaged });
  const bibliographyDir = resolveBibliographyDir();
  const contentDir = path.join(app.getPath("userData"), "content");
  const tempDir = path.join(app.getPath("userData"), "temp");
  dbg("createWindow", "resolved dirs", {
    hasBibliographyDir: Boolean(bibliographyDir),
    contentDirLen: contentDir.length,
    tempDirLen: tempDir.length
  });
  [bibliographyDir, contentDir, tempDir].forEach((dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // ignore
    }
  });
  seedReferencesFromDataHubCache(bibliographyDir);
  seedBundledReferences(bibliographyDir);

  const hostContract = {
    version: 1,
    sessionId: "local-session",
    documentId: "local-document",
    documentTitle: "Untitled document",
    uiScale: resolveUiScale(),
    paths: {
      contentDir,
      bibliographyDir,
      tempDir
    },
    inputs: {
      directQuoteJsonPath:
        (process.env.LEDITOR_DIRECT_QUOTE_JSON_PATH || "").trim() ||
        "\\\\wsl.localhost\\Ubuntu-22.04\\home\\pantera\\annotarium\\analyse\\0.13_cyber_attribution_corpus_records_total_included\\1999-2009_2010-2018_2019-2025__rq=0,3,4,2,1\\direct_quote_lookup.json"
    },
    policy: {
      allowDiskWrites: true
    }
  };
  dbg("createWindow", "host contract", {
    version: hostContract.version,
    sessionId: hostContract.sessionId,
    documentId: hostContract.documentId,
    titleLen: hostContract.documentTitle.length,
    directQuoteJsonPathLen: hostContract.inputs.directQuoteJsonPath.length
  });
  const leditorHostArg = `--leditor-host=${encodeURIComponent(JSON.stringify(hostContract))}`;

  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    backgroundColor: "#f6f2e7",
    useContentSize: true,
    autoHideMenuBar: true,
    frame: true,
    webPreferences: {
      preload: path.join(app.getAppPath(), "dist", "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [leditorHostArg],
      // Use CSS `--ui-scale` in the renderer for consistent sizing across hosts/embeds.
      zoomFactor: 1.0
    }
  });
  dbg("createWindow", "ui scale", { scale: hostContract.uiScale });
  installAppMenu();
  try {
    window.setMenuBarVisibility(false);
  } catch {
    // ignore (platform dependent)
  }
  dbg("createWindow", "BrowserWindow created", {
    contextIsolation: true,
    nodeIntegration: false,
    preload: "dist/electron/preload.js",
    additionalArguments: 1
  });

  const indexPath = path.join(app.getAppPath(), "dist", "public", "index.html");
  dbg("createWindow", "loadFile", { indexPathLen: indexPath.length });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    console.error("[leditor][window] did-fail-load", { errorCode, errorDescription, validatedURL });
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (!DEBUG_LOGS) return;
    const levelName = level === 0 ? "debug" : level === 1 ? "info" : level === 2 ? "warn" : "error";
    const raw = typeof message === "string" ? message : String(message);
    const maxLen = 800;
    const preview = raw.length > maxLen ? `${raw.slice(0, maxLen)}…(truncated)` : raw;
    console.info("[leditor][renderer][console]", { level: levelName, message: preview, messageLen: raw.length, line, sourceId });
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[leditor][window] render-process-gone", details);
  });
  window.webContents.on("unresponsive", () => {
    console.error("[leditor][window] unresponsive");
  });
  window.webContents.on("crashed", () => {
    console.error("[leditor][window] crashed");
  });

  const devtoolsEnabled = process.env.LEDITOR_DISABLE_DEVTOOLS !== "1";
	  const wantsDevtools =
	    devtoolsEnabled &&
	    (process.argv.includes("--devtools") ||
	      process.argv.includes("--dev-unbundled") ||
	      process.env.LEDITOR_DEVTOOLS === "1");
  if (wantsDevtools) {
    // In WSL/remote setups, "detach" can fail to show a separate window; use a docked mode.
    const openTools = () => {
      if (window.webContents.isDevToolsOpened()) return;
      try {
        window.webContents.openDevTools({ mode: "right" });
      } catch (error) {
        console.error("[leditor][devtools] openDevTools failed", normalizeError(error));
      }
      if (!window.webContents.isDevToolsOpened()) {
        try {
          window.webContents.openDevTools({ mode: "undocked" as any });
        } catch (error) {
          console.error("[leditor][devtools] openDevTools undocked failed", normalizeError(error));
        }
      }
      if (!window.webContents.isDevToolsOpened()) {
        try {
          window.webContents.openDevTools();
        } catch (error) {
          console.error("[leditor][devtools] openDevTools default failed", normalizeError(error));
        }
      }
      if (DEBUG_LOGS) {
        console.info("[leditor][devtools] isDevToolsOpened", window.webContents.isDevToolsOpened());
      }
    };
    window.webContents.once("did-finish-load", () => {
      openTools();
      setTimeout(openTools, 750);
    });
  }

  window.webContents.on("before-input-event", (event, input) => {
    if (!devtoolsEnabled) return;
    const key = String((input as any).key || "").toLowerCase();
    const isWindowsShortcut = (input as any).control && (input as any).shift && key === "i";
    const isMacShortcut = (input as any).meta && (input as any).alt && key === "i";
    if (isWindowsShortcut || isMacShortcut) {
      event.preventDefault();
      try {
        window.webContents.toggleDevTools();
      } catch (error) {
        console.error("[leditor][devtools] toggleDevTools failed", normalizeError(error));
      }
    }
    if (key === "f12") {
      event.preventDefault();
      try {
        window.webContents.toggleDevTools();
      } catch (error) {
        console.error("[leditor][devtools] toggleDevTools failed", normalizeError(error));
      }
    }
  });

  void window.loadFile(indexPath);
  return window;
};

app.whenReady().then(() => {
  dbg("whenReady", "app ready");
  loadDotenv(path.join(app.getAppPath(), ".env"));
  registerIpc("leditor:ai-status", async () => {
    const hasApiKey = Boolean(String(process.env.OPENAI_API_KEY || "").trim());
    const { model, modelFromEnv } = getDefaultModelForProvider("openai");
    return { success: true, hasApiKey, model, modelFromEnv };
  });
  registerIpc("leditor:llm-catalog", async () => {
    return { success: true, providers: getCatalog() };
  });
  registerIpc("leditor:llm-status", async () => {
    const providers = getCatalog().map((p) => {
      const apiKey = getProviderApiKey(p.id, undefined);
      const { model, modelFromEnv } = getDefaultModelForProvider(p.id);
      return {
        id: p.id,
        label: p.label,
        envKey: p.envKey,
        hasApiKey: Boolean(apiKey),
        defaultModel: model,
        modelFromEnv
      };
    });
    return { success: true, providers };
  });
  registerIpc("leditor:file-exists", async (_event, request: { sourcePath: string }) => {
    try {
      const sourcePath = normalizeFsPath(request.sourcePath);
      if (!sourcePath) return { success: false, exists: false };
      await fs.promises.access(sourcePath, fs.constants.R_OK);
      return { success: true, exists: true };
    } catch {
      return { success: true, exists: false };
    }
  });

  registerIpc("leditor:get-default-ledoc-path", async (): Promise<{ success: boolean; path?: string; error?: string }> => {
    const candidates: string[] = [];

    const push = (value: unknown) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      if (!trimmed) return;
      if (candidates.includes(trimmed)) return;
      candidates.push(trimmed);
    };

    // User override.
    push(process.env.LEDITOR_DEFAULT_LEDOC_PATH);

    // Typical dev layout: `<repo>/leditor` running with appPath inside that folder.
    try {
      // Prefer a bundled document inside the app folder, if present.
      push(path.resolve(app.getAppPath(), DEFAULT_LEDOC_FILENAME));
      push(path.resolve(app.getAppPath(), "..", DEFAULT_LEDOC_FILENAME));
    } catch {
      // ignore
    }

    // Fallbacks (cwd and userData content dir).
    try {
      push(path.resolve(process.cwd(), DEFAULT_LEDOC_FILENAME));
    } catch {
      // ignore
    }
    try {
      push(path.join(app.getPath("userData"), "content", DEFAULT_LEDOC_FILENAME));
    } catch {
      // ignore
    }

    for (const candidate of candidates) {
      try {
        await fs.promises.access(candidate, fs.constants.R_OK);
        return { success: true, path: candidate };
      } catch {
        // try next
      }
    }

    return { success: false, error: "Default LEDOC path not found" };
  });

  registerIpc("leditor:agent-run", async (event, request: { requestId?: string; payload: AgentRequestPayload }) => {
    return runAgentRequestInternal(event, request, { stream: true });
  });

  // Backward compatibility: non-streaming agent bridge.
  registerIpc("leditor:agent-request", async (event, request: { requestId?: string; payload: AgentRequestPayload }) => {
    return runAgentRequestInternal(event, request, { stream: false });
  });

  registerIpc("leditor:agent-cancel", async (_event, request: { requestId: string }) => {
    const requestId = String(request?.requestId || "").trim();
    if (!requestId) return { success: false, error: "requestId required" };
    const inflight = (globalThis as any).__leditorAgentInflight as Map<string, AbortController> | undefined;
    const ctrl = inflight?.get(requestId);
    if (!ctrl) return { success: true, cancelled: false };
    try {
      ctrl.abort();
    } catch {
      // ignore
    } finally {
      inflight?.delete(requestId);
    }
    return { success: true, cancelled: true };
  });

  registerIpc(
    "leditor:check-sources",
    async (
      _event,
      request: {
        requestId?: string;
        payload: { provider?: string; model?: string; paragraphN?: number; paragraphText: string; anchors: any[] };
      }
    ) => {
      const started = Date.now();
      try {
        const payload = request?.payload as any;
        const rawProvider = typeof payload?.provider === "string" ? String(payload.provider).trim() : "";
        const provider: LlmProviderId =
          rawProvider === "openai" || rawProvider === "deepseek" || rawProvider === "mistral" || rawProvider === "gemini"
            ? (rawProvider as LlmProviderId)
            : "openai";
        const paragraphN = Number(payload?.paragraphN);
        const paragraphText = String(payload?.paragraphText ?? "").trim();
        const anchors = Array.isArray(payload?.anchors) ? payload.anchors : [];
        if (!paragraphText) return { success: false, error: "check-sources: payload.paragraphText required" };
        if (anchors.length === 0) return { success: true, assistantText: "No sources to be checked.", checks: [] };

        const fallback = getDefaultModelForProvider(provider);
        const model = String(payload?.model || "").trim() || fallback.model || (provider === "openai" ? "codex-mini-latest" : "");
        const apiKey = getProviderApiKey(provider, undefined);
        if (!apiKey) {
          const envKey = getProviderEnvKeyName(provider);
          return { success: false, error: `Missing ${envKey} in environment.` };
        }

        const system = [
          "You are a citation-consistency checker inside an offline academic editor.",
          "You MUST NOT claim external factual verification (no web access).",
          "You are given: (1) a paragraph, (2) ONE target citation anchor, (3) the citation title metadata (often a direct quote), and (4) a list of other available citation anchors in the SAME paragraph (with their title metadata).",
          "Decide if the claim associated with the target citation is semantically supported/consistent with that title metadata.",
          "Do NOT judge factual truth; only check semantic support/consistency.",
          "",
          'Return STRICT JSON only: {"verdict":"verified"|"needs_review","justification":string,"fixSuggestion":string|null,"suggestedReplacementKey":string|null,"claimRewrite":string|null}.',
          "justification must be ONE short sentence (<= 400 chars).",
          "If verdict is verified: fixSuggestion=null and suggestedReplacementKey=null.",
          "If verdict is needs_review: provide fixSuggestion as ONE sentence describing how to fix (either adjust the claim to match the citation, or use a better-matching citation).",
          "If verdict is needs_review: also provide claimRewrite as ONE sentence rewriting the claim text (WITHOUT citations) so it aligns with the citation title. If you cannot confidently propose a rewrite, claimRewrite=null.",
          "If there is a clearly better-matching citation among availableAnchors, set suggestedReplacementKey to that anchor's key; otherwise null.",
          "NEVER invent keys; suggestedReplacementKey must be an exact key from availableAnchors."
        ].join("\n");

        const checks: Array<{
          key: string;
          verdict: "verified" | "needs_review";
          justification: string;
          fixSuggestion?: string;
          suggestedReplacementKey?: string | null;
          claimRewrite?: string;
        }> = [];
        const availableAnchors = anchors.map((a: any) => ({
          key: String(a?.key ?? ""),
          anchorText: String(a?.text ?? ""),
          title: String(a?.title ?? ""),
          href: String(a?.href ?? ""),
          dataKey: String(a?.dataKey ?? ""),
          dataDqid: String(a?.dataDqid ?? ""),
          dataQuoteId: String(a?.dataQuoteId ?? "")
        }));
        for (const anchor of anchors) {
          const key = String(anchor?.key ?? "");
          if (!key) continue;
          const anchorText = String(anchor?.text ?? "");
          const title = String(anchor?.title ?? "");
          const href = String(anchor?.href ?? "");
          const dataKey = String(anchor?.dataKey ?? "");
          const dataDqid = String(anchor?.dataDqid ?? "");
          const dataQuoteId = String(anchor?.dataQuoteId ?? "");
          const context = anchor?.context && typeof anchor.context === "object" ? anchor.context : null;
          const claimSentence =
            typeof context?.sentence === "string" && context.sentence.trim() ? String(context.sentence).trim() : "";
          const claimBefore =
            typeof context?.before === "string" && context.before.trim() ? String(context.before).trim() : "";
          const claimAfter =
            typeof context?.after === "string" && context.after.trim() ? String(context.after).trim() : "";

          const claimTextWithoutCitations = (() => {
            const sentence = claimSentence || paragraphText;
            let masked = sentence;
            for (const a of availableAnchors) {
              const t = String(a?.anchorText ?? "").trim();
              if (!t) continue;
              // Remove exact anchor text occurrences.
              masked = masked.split(t).join("");
            }
            masked = masked.replace(/\(\s*\)/g, " ");
            masked = masked.replace(/\s+/g, " ").trim();
            // Avoid ending with dangling punctuation from removed citations.
            masked = masked.replace(/\s+\)/g, ")").replace(/\(\s+/g, "(").trim();
            return masked;
          })();

          const input = JSON.stringify(
            {
              paragraphN: Number.isFinite(paragraphN) ? paragraphN : undefined,
              paragraphText,
              claim: { sentence: claimSentence, before: claimBefore, after: claimAfter, textWithoutCitations: claimTextWithoutCitations },
              anchor: { key, anchorText, title, href, dataKey, dataDqid, dataQuoteId },
              availableAnchors
            },
            null,
            2
          );
          console.info("[agent][check_sources]", { paragraphN, key, input });
          const raw = await callLlmText({ provider, apiKey, model, system, input, signal: undefined });
          const start = raw.indexOf("{");
          const end = raw.lastIndexOf("}");
          if (start === -1 || end === -1 || end <= start) {
            checks.push({ key, verdict: "needs_review", justification: "Model response was not JSON." });
            console.info("[agent][check_sources]", { paragraphN, key, output: raw.slice(0, 400), parsed: null });
            continue;
          }
          const parsed = JSON.parse(raw.slice(start, end + 1));
          const verdict = parsed?.verdict === "verified" ? ("verified" as const) : ("needs_review" as const);
          const justification =
            typeof parsed?.justification === "string"
              ? String(parsed.justification).replace(/\s+/g, " ").trim().slice(0, 400)
              : verdict === "verified"
                ? "Citation appears consistent."
                : "Needs review.";
          const fixSuggestion =
            verdict === "needs_review" && typeof parsed?.fixSuggestion === "string"
              ? String(parsed.fixSuggestion).replace(/\s+/g, " ").trim().slice(0, 280)
              : "";
          const claimRewrite =
            verdict === "needs_review" && typeof parsed?.claimRewrite === "string"
              ? String(parsed.claimRewrite).replace(/\s+/g, " ").trim().slice(0, 320)
              : "";
          const suggestedReplacementKey =
            verdict === "needs_review" && (typeof parsed?.suggestedReplacementKey === "string" || parsed?.suggestedReplacementKey === null)
              ? (parsed.suggestedReplacementKey === null ? null : String(parsed.suggestedReplacementKey).trim())
              : null;
          checks.push({
            key,
            verdict,
            justification,
            ...(fixSuggestion ? { fixSuggestion } : {}),
            ...(claimRewrite ? { claimRewrite } : {}),
            suggestedReplacementKey
          });
          console.info("[agent][check_sources]", {
            paragraphN,
            key,
            output: raw.slice(0, 400),
            parsed: { verdict, justification, fixSuggestion: fixSuggestion || null, suggestedReplacementKey }
          });
        }

        return {
          success: true,
          assistantText: `Checked ${checks.length} source(s).`,
          checks,
          meta: { provider, model, ms: Date.now() - started }
        };
      } catch (error) {
        return {
          success: false,
          error: normalizeError(error),
          meta: { provider: "openai" as const, ms: Date.now() - started }
        };
      }
    }
  );

  registerIpc(
    "leditor:substantiate-anchors",
    async (
      _event,
      request: {
        requestId?: string;
        payload: {
          provider?: string;
          model?: string;
          embeddingModel?: string;
          lookupPath?: string;
          anchors?: any[];
        };
      }
    ) => {
      const started = Date.now();
      try {
        const payload = request?.payload as any;
        const rawProvider = typeof payload?.provider === "string" ? String(payload.provider).trim() : "";
        const provider: LlmProviderId =
          rawProvider === "openai" || rawProvider === "deepseek" || rawProvider === "mistral" || rawProvider === "gemini"
            ? (rawProvider as LlmProviderId)
            : "openai";
        const fallback = getDefaultModelForProvider(provider);
        const model = String(payload?.model || "").trim() || fallback.model || (provider === "openai" ? "codex-mini-latest" : "");
        const embeddingModel = String(payload?.embeddingModel || DEFAULT_EMBEDDING_MODEL).trim() || DEFAULT_EMBEDDING_MODEL;
        const lookupPath = String(payload?.lookupPath ?? "").trim();
        const anchors = Array.isArray(payload?.anchors) ? payload.anchors : [];
        if (!lookupPath) return { success: false, error: "substantiate: lookupPath required" };
        if (!anchors.length) return { success: true, results: [] };

        const llmApiKey = getProviderApiKey(provider, undefined);
        if (!llmApiKey) {
          const envKey = getProviderEnvKeyName(provider);
          return { success: false, error: `Missing ${envKey} in environment.` };
        }
        const embeddingApiKey = getProviderApiKey("openai", undefined);
        if (!embeddingApiKey) {
          const envKey = getProviderEnvKeyName("openai");
          return { success: false, error: `Missing ${envKey} in environment.` };
        }

        const index = await ensureEmbeddingIndex({ lookupPath, model: embeddingModel, apiKey: embeddingApiKey });
        if (index.lastError) return { success: false, error: index.lastError };

        const queryTexts = anchors.map((a: any) => {
          const title = normalizeEmbeddingText(a?.title ?? "");
          if (title) return title;
          const sentence = normalizeEmbeddingText(a?.sentence ?? "");
          if (sentence) return sentence;
          const fallbackText = normalizeEmbeddingText(a?.text ?? "");
          return fallbackText || "unknown";
        });
        const queryEmbeddings = await callOpenAiEmbeddings({
          apiKey: embeddingApiKey,
          model: embeddingModel,
          input: queryTexts
        });

        const system = [
          "You are an academic writing assistant inside an offline editor.",
          "Rewrite ONE sentence to make the claim more precise and substantiated using the matched evidence.",
          "Preserve the anchor token EXACTLY as provided (verbatim string).",
          "Do NOT add or remove citations or anchors.",
          "If matches conflict, narrow/qualify the claim or note uncertainty.",
          'Return STRICT JSON only: {"rewrite":string,"stance":"corroborates"|"refutes"|"mixed"|"uncertain","notes":string}.',
          "rewrite must be a single sentence."
        ].join("\n");

        const results: any[] = [];
        for (let i = 0; i < anchors.length; i += 1) {
          const anchor = anchors[i] ?? {};
          const anchorText = String(anchor?.text ?? "");
          const anchorTitle = String(anchor?.title ?? "");
          const sentence = String(anchor?.sentence ?? "");
          const paragraphText = String(anchor?.paragraphText ?? "");
          const qvec = normalizeVectorInPlace(queryEmbeddings[i] ?? []);
          const matchesRaw = qvec.length ? searchEmbeddingIndex(index, qvec, EMBEDDING_TOP_K) : [];
          const matches = matchesRaw.map((m) => ({
            dqid: m.item.id,
            title: m.item.title,
            author: m.item.author,
            year: m.item.year,
            source: m.item.source,
            page: m.item.page,
            directQuote: m.item.directQuote,
            paraphrase: m.item.paraphrase,
            score: m.score
          }));

          let rewrite = sentence;
          let stance = "uncertain";
          let notes = "";
          if (sentence && anchorText) {
            const input = JSON.stringify(
              {
                anchor: { text: anchorText, title: anchorTitle },
                sentence,
                paragraph: paragraphText.slice(0, 1200),
                matches: matches.slice(0, 4)
              },
              null,
              2
            );
            const raw = await callLlmText({ provider, apiKey: llmApiKey, model, system, input, signal: undefined });
            const parsed = parseStrictJsonObject(raw);
            if (parsed && typeof parsed === "object") {
              const candidate = typeof parsed.rewrite === "string" ? String(parsed.rewrite).trim() : "";
              if (candidate) rewrite = candidate;
              const s = typeof parsed.stance === "string" ? String(parsed.stance).trim().toLowerCase() : "";
              if (s === "corroborates" || s === "refutes" || s === "mixed" || s === "uncertain") stance = s;
              notes = typeof parsed.notes === "string" ? String(parsed.notes).trim() : "";
            }
          }
          if (anchorText && rewrite && !rewrite.includes(anchorText)) {
            rewrite = sentence || rewrite;
          }

          results.push({
            key: String(anchor?.key ?? ""),
            paragraphN: Number(anchor?.paragraphN) || undefined,
            anchorText,
            anchorTitle,
            sentence,
            rewrite,
            stance,
            notes,
            matches
          });
        }

        return {
          success: true,
          results,
          meta: { provider, model, embeddingModel, ms: Date.now() - started }
        };
      } catch (error) {
        return {
          success: false,
          error: normalizeError(error),
          meta: { provider: "openai" as const, ms: Date.now() - started }
        };
      }
    }
  );

  registerIpc(
    "leditor:lexicon",
    async (
      _event,
      request: {
        requestId?: string;
        payload: { provider?: string; model?: string; mode: string; text: string; sentence?: string };
      }
    ) => {
      const started = Date.now();
      try {
        const payload = request?.payload as any;
        const rawProvider = typeof payload?.provider === "string" ? String(payload.provider).trim() : "";
        const provider: LlmProviderId =
          rawProvider === "openai" || rawProvider === "deepseek" || rawProvider === "mistral" || rawProvider === "gemini"
            ? (rawProvider as LlmProviderId)
            : "openai";
        const mode = String(payload?.mode ?? "").toLowerCase();
        const text = String(payload?.text ?? "").trim();
        const sentence = typeof payload?.sentence === "string" ? String(payload.sentence).trim() : "";
        if (mode !== "synonyms" && mode !== "antonyms" && mode !== "definition" && mode !== "define" && mode !== "explain") {
          return { success: false, error: 'lexicon: payload.mode must be "synonyms" | "antonyms" | "definition" | "explain"' };
        }
        if (!text) return { success: false, error: "lexicon: payload.text required" };
        const fallback = getDefaultModelForProvider(provider);
        const model = String(payload?.model || "").trim() || fallback.model || (provider === "openai" ? "codex-mini-latest" : "");
        const apiKey = getProviderApiKey(provider, undefined);
        if (!apiKey) {
          const envKey = getProviderEnvKeyName(provider);
          return { success: false, error: `Missing ${envKey} in environment.` };
        }

        const isDefinition = mode === "definition" || mode === "define";
        const isExplain = mode === "explain";
        const system = isDefinition
          ? [
              "You are a deterministic dictionary helper inside an offline academic editor.",
              "You will be given a selected word/phrase and the full sentence it appears in.",
              "Return STRICT JSON only (no markdown): {\"assistantText\":string,\"definition\":string}.",
              "definition must be 1–2 sentences, written for the given sentence context.",
              "Do NOT include bullets, numbering, or quotes unless they are part of the definition itself."
            ].join("\n")
          : isExplain
            ? [
                "You are a deterministic explainer inside an offline academic editor.",
                "You will be given a selected word/phrase and the full paragraph it appears in.",
                "Return STRICT JSON only (no markdown): {\"assistantText\":string,\"explanation\":string}.",
                "explanation must be 2–4 sentences explaining what the selection means in THIS paragraph.",
                "Do NOT quote large parts of the paragraph; focus on meaning and role in context.",
                "Do NOT use bullets or numbering."
              ].join("\n")
            : [
                "You are a deterministic thesaurus helper inside an offline academic editor.",
                "You will be given a selected word/phrase and the full sentence it appears in.",
                "Return STRICT JSON only (no markdown): {\"assistantText\":string,\"suggestions\":string[]}.",
                "suggestions MUST contain exactly 5 short replacement candidates (no numbering, no quotes).",
                "Each suggestion must be a direct replacement for the selected text that still fits the sentence.",
                "Do not repeat the input text."
              ].join("\n");

        const user = JSON.stringify(
          {
            mode: isDefinition ? "definition" : mode,
            selection: text,
            sentence
          },
          null,
          2
        );

        const raw = await callLlmText({ provider, apiKey, model, system, input: user, signal: undefined });
        const start = raw.indexOf("{");
        const end = raw.lastIndexOf("}");
        if (start === -1 || end === -1 || end <= start) {
          throw new Error("lexicon: model response was not JSON.");
        }
        const parsed = JSON.parse(raw.slice(start, end + 1));
        const suggestionsRaw = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
        const suggestions = isDefinition
          ? []
          : suggestionsRaw
              .map((s: any) => (typeof s === "string" ? s : ""))
              .map((s: string) => s.replace(/\s+/g, " ").trim())
              .filter((s: string) => s && s.toLowerCase() !== text.toLowerCase())
              .slice(0, 5);
        const definition = isDefinition
          ? (typeof parsed?.definition === "string" ? parsed.definition.replace(/\s+/g, " ").trim() : "")
          : "";
        const explanation = isExplain
          ? (typeof parsed?.explanation === "string" ? parsed.explanation.replace(/\s+/g, " ").trim() : "")
          : "";
        return {
          success: true,
          assistantText: typeof parsed?.assistantText === "string" ? parsed.assistantText : "",
          suggestions,
          ...(definition ? { definition } : {}),
          ...(explanation ? { explanation } : {}),
          meta: { provider, model, ms: Date.now() - started }
        };
      } catch (error) {
        return {
          success: false,
          error: normalizeError(error),
          meta: { provider: "openai" as const, ms: Date.now() - started }
        };
      }
    }
  );

  registerIpc("leditor:read-file", async (_event, request: { sourcePath: string }) => {
    try {
      const sourcePath = normalizeFsPath(request.sourcePath);
      const data = await fs.promises.readFile(sourcePath, "utf-8");
      return { success: true, data, filePath: sourcePath };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  registerIpc("leditor:write-file", async (_event, request: { targetPath: string; data: string }) => {
    try {
      const targetPath = normalizeFsPath(request.targetPath);
      await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.promises.writeFile(targetPath, request.data, "utf-8");
      return { success: true };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  registerIpc("leditor:export-ledoc", async (_event, request: any): Promise<any> => {
    try {
      const options = request?.options ?? {};
      const payload = request?.payload;
      if (!payload || typeof payload !== "object") {
        return { success: false, error: "ExportLEDOC: payload is required" };
      }

      let targetPath = String(options.targetPath || "").trim();
      const suggestedPath = String(options.suggestedPath || "").trim();
      const prompt = Boolean(options.prompt);

      if (prompt || !targetPath) {
        const defaultPath = ensureLedocExtension(suggestedPath || path.join(app.getPath("documents"), `document.${LEDOC_EXTENSION}`));
        const result = await dialog.showSaveDialog({
          title: "Export LEDOC",
          defaultPath,
          filters: [{ name: "LEditor Document", extensions: [LEDOC_EXTENSION] }]
        });
        if (result.canceled) {
          return { success: false, error: "ExportLEDOC canceled" };
        }
        targetPath = String(result.filePath || "").trim();
      }

      if (!targetPath) {
        return { success: false, error: "ExportLEDOC: targetPath is required" };
      }
      targetPath = normalizeFsPath(ensureLedocExtension(targetPath));

      // LEDOC v2 (directory bundle) is the canonical persistence format.
      const normalized = normalizeLedocToBundle(payload);
      let bundleDir = targetPath;

      // If a legacy `.ledoc` zip exists at the chosen path, don't clobber it; write a sibling bundle dir instead.
      try {
        const st = await fs.promises.stat(bundleDir);
        if (st.isFile()) {
          bundleDir = bundleDir.replace(new RegExp(`\\.${LEDOC_EXTENSION}$`, "i"), `-bundle.${LEDOC_EXTENSION}`);
          normalized.warnings.push(`Target path was a file; wrote bundle to ${path.basename(bundleDir)} instead.`);
        }
      } catch {
        // ignore
      }

      const written = await writeLedocBundle(bundleDir, normalized.payload);
      const warnings = [...(normalized.warnings ?? []), ...(written.warnings ?? [])];
      return { success: true, filePath: bundleDir, payload: normalized.payload, warnings };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  registerIpc("leditor:import-ledoc", async (_event, request: any): Promise<any> => {
    const event = _event;
    try {
      const options = request?.options ?? {};
      let sourcePath = String(options.sourcePath || "").trim();
      const prompt = Boolean(options.prompt);

      if (prompt || !sourcePath) {
        const result = await dialog.showOpenDialog({
          title: "Import LEDOC",
          properties: ["openFile", "openDirectory"],
          filters: [
            { name: "LEditor Document", extensions: [LEDOC_EXTENSION] },
            { name: "Coder state JSON", extensions: ["json"] }
          ]
        });
        const filePath = result.filePaths?.[0] ?? "";
        if (result.canceled || !filePath) {
          return { success: false, error: "ImportLEDOC canceled" };
        }
        sourcePath = String(filePath).trim();
      }

      if (!sourcePath) {
        return { success: false, error: "ImportLEDOC: sourcePath is required" };
      }
      sourcePath = resolveRepoRelativePath(normalizeFsPath(sourcePath));

      const setWindowTitle = (title: string) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const label = title?.trim() || path.basename(sourcePath);
        if (win) {
          try {
            win.setTitle(`LEditor — ${label}`);
          } catch {
            // ignore
          }
        }
      };

      // Directory bundle import (v2).
      try {
        const st = await fs.promises.stat(sourcePath);
        if (st.isDirectory()) {
          const loaded = await readLedocBundle(sourcePath);
          const title =
            (loaded.payload as any)?.meta?.title ||
            path.basename(sourcePath, path.extname(sourcePath)) ||
            "Document";
          setWindowTitle(title);
          return { success: true, filePath: sourcePath, payload: loaded.payload, warnings: loaded.warnings };
        }
      } catch {
        // ignore stat errors; fall through
      }

      const ext = path.extname(sourcePath).toLowerCase();
      if (ext === ".json") {
        const converted = await convertCoderStateToLedoc(sourcePath);
        if (!converted.success || !converted.payload) {
          return { success: false, error: converted.error ?? "Conversion failed" };
        }
        if (converted.title) {
          setWindowTitle(converted.title);
        }
        return {
          success: true,
          filePath: converted.ledocPath ?? sourcePath,
          payload: converted.payload as any,
          warnings: converted.warnings
        };
      }

      const buffer = await fs.promises.readFile(sourcePath);
      const unpacked = await unpackLedocZip(buffer as Buffer);

      // Best-effort: if footnotes.json exists and the document's footnote nodes lack attrs.text,
      // merge text into the document so footnotes persist even if a future schema changes.
      const payload = unpacked.payload as any;
      const footnotes = payload?.footnotes?.footnotes;
      const doc = payload?.document;
      if (!doc || typeof doc !== "object" || typeof (doc as any).type !== "string") {
        return {
          success: false,
          error:
            "Invalid LEDOC zip: document.json is missing a ProseMirror root `type`. If this file was created by a newer build, re-save to a `.ledoc` folder bundle."
        };
      }
      if (doc && Array.isArray(footnotes)) {
        const textById = new Map<string, string>();
        for (const entry of footnotes) {
          const id = typeof entry?.id === "string" ? entry.id.trim() : "";
          if (!id) continue;
          const text = typeof entry?.text === "string" ? entry.text : "";
          textById.set(id, text);
        }
        const buildFootnoteBodyJson = (value: string) => {
          const safeText = typeof value === "string" ? value : "";
          const lines = safeText.replace(/\r/g, "").split("\n");
          const blocks = lines.length ? lines : [""];
          return blocks.map((line) => {
            if (!line) return { type: "paragraph" };
            return { type: "paragraph", content: [{ type: "text", text: line }] };
          });
        };
        const visit = (node: any) => {
          if (!node || typeof node !== "object") return;
          if (node.type === "footnote" && node.attrs && typeof node.attrs === "object") {
            const id = typeof node.attrs.footnoteId === "string" ? node.attrs.footnoteId.trim() : "";
            if (id) {
              const current = typeof node.attrs.text === "string" ? node.attrs.text : "";
              if (!current && textById.has(id)) {
                node.attrs.text = textById.get(id) ?? "";
              }
            }
          }
          if (node.type === "footnoteBody" && node.attrs && typeof node.attrs === "object") {
            const id = typeof node.attrs.footnoteId === "string" ? node.attrs.footnoteId.trim() : "";
            if (id && textById.has(id)) {
              const content = Array.isArray(node.content) ? node.content : [];
              const hasText = content.some(
                (child: any) => child && Array.isArray(child.content) && child.content.length > 0
              );
              if (!hasText) {
                node.content = buildFootnoteBodyJson(textById.get(id) ?? "");
              }
            }
          }
          const content = node.content;
          if (Array.isArray(content)) content.forEach(visit);
        };
        visit(doc);
      }

      const metaTitle =
        (payload as any)?.meta?.title ||
        path.basename(sourcePath, path.extname(sourcePath)) ||
        "Document";
      setWindowTitle(metaTitle);

      return {
        success: true,
        filePath: sourcePath,
        payload: payload as any,
        warnings: unpacked.warnings
      };
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  registerIpc("leditor:versions:list", async (_event, request: { ledocPath: string }): Promise<any> => {
    try {
      const bundleDir = normalizeFsPath(String(request?.ledocPath || ""));
      if (!bundleDir) return { success: false, error: "versions:list ledocPath is required" };
      return await listLedocVersions(bundleDir);
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  registerIpc(
    "leditor:versions:create",
    async (
      _event,
      request: { ledocPath: string; reason?: string; label?: string; note?: string; payload?: any; throttleMs?: number; force?: boolean }
    ): Promise<any> => {
      try {
        const bundleDir = normalizeFsPath(String(request?.ledocPath || ""));
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

  registerIpc(
    "leditor:versions:restore",
    async (_event, request: { ledocPath: string; versionId: string; mode?: "replace" | "copy" }): Promise<any> => {
      try {
        const bundleDir = normalizeFsPath(String(request?.ledocPath || ""));
        const versionId = String(request?.versionId || "").trim();
        const mode = request?.mode === "copy" ? "copy" : "replace";
        if (!bundleDir) return { success: false, error: "versions:restore ledocPath is required" };
        if (!versionId) return { success: false, error: "versions:restore versionId is required" };
        return await restoreLedocVersion({ bundleDir, versionId, mode });
      } catch (error) {
        return { success: false, error: normalizeError(error) };
      }
    }
  );

  registerIpc("leditor:versions:delete", async (_event, request: { ledocPath: string; versionId: string }): Promise<any> => {
    try {
      const bundleDir = normalizeFsPath(String(request?.ledocPath || ""));
      const versionId = String(request?.versionId || "").trim();
      if (!bundleDir) return { success: false, error: "versions:delete ledocPath is required" };
      if (!versionId) return { success: false, error: "versions:delete versionId is required" };
      return await deleteLedocVersion({ bundleDir, versionId });
    } catch (error) {
      return { success: false, error: normalizeError(error) };
    }
  });

  registerIpc(
    "leditor:versions:pin",
    async (_event, request: { ledocPath: string; versionId: string; pinned: boolean }): Promise<any> => {
      try {
        const bundleDir = normalizeFsPath(String(request?.ledocPath || ""));
        const versionId = String(request?.versionId || "").trim();
        if (!bundleDir) return { success: false, error: "versions:pin ledocPath is required" };
        if (!versionId) return { success: false, error: "versions:pin versionId is required" };
        return await pinLedocVersion({ bundleDir, versionId, pinned: Boolean(request?.pinned) });
      } catch (error) {
        return { success: false, error: normalizeError(error) };
      }
    }
  );

  registerIpc("leditor:open-pdf-viewer", async (_event, request: { payload: Record<string, unknown> }) => {
    try {
      const payload = request?.payload || {};
      console.info("[leditor][pdf] open viewer requested", {
        dqid: (payload as any).dqid ?? null,
        item_key: (payload as any).item_key ?? (payload as any).itemKey ?? null,
        pdf_path: (payload as any).pdf_path ?? (payload as any).pdf ?? null,
        page: (payload as any).page ?? null
      });

      const viewerPath = path.join(app.getAppPath(), "dist", "public", "PDF_Viewer", "viewer.html");
      const sendPayload = (win: BrowserWindow) => {
        try {
          win.webContents.send("leditor:pdf-viewer-payload", payload);
        } catch {
          // ignore
        }
      };

      if (pdfViewerWindow && !pdfViewerWindow.isDestroyed()) {
        pdfViewerWindow.show();
        pdfViewerWindow.focus();
        sendPayload(pdfViewerWindow);
        console.info("[leditor][pdf] viewer reused");
        return { success: true };
      }

      const token = randomToken();
      pdfViewerPayloads.set(token, payload);

      pdfViewerWindow = new BrowserWindow({
        width: 1100,
        height: 900,
        backgroundColor: "#f6f2e7",
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(app.getAppPath(), "dist", "electron", "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          additionalArguments: [`--pdf-viewer-token=${token}`]
        }
      });
      try {
        pdfViewerWindow.webContents.setZoomFactor(1.0);
      } catch {
        // ignore
      }
      try {
        pdfViewerWindow.setMenuBarVisibility(false);
      } catch {
        // ignore
      }
      pdfViewerWindow.on("closed", () => {
        pdfViewerWindow = null;
      });
      pdfViewerWindow.webContents.once("did-finish-load", () => sendPayload(pdfViewerWindow!));
      await pdfViewerWindow.loadFile(viewerPath);
      console.info("[leditor][pdf] viewer window opened", { token });
      return { success: true };
    } catch (error) {
      console.warn("[leditor][pdf] open viewer failed", { error: normalizeError(error) });
      return { success: false, error: normalizeError(error) };
    }
  });

  registerIpc("leditor:pdf-viewer-payload", async (_event, request: { token: string }) => {
    const token = String(request?.token || "");
    if (!token) return null;
    const payload = pdfViewerPayloads.get(token) || null;
    pdfViewerPayloads.delete(token);
    return payload;
  });

  registerIpc("leditor:resolve-pdf-path", async (_event, request: { lookupPath: string; itemKey: string }) => {
    try {
      const lookupPath = normalizeFsPath(request.lookupPath);
      const itemKey = String(request.itemKey || "").trim();
      if (!lookupPath || !itemKey) return null;
      const runDir = dirnameLike(lookupPath);
      if (!runDir) return null;
      console.info("[leditor][pdf] resolve requested", { lookupPath, itemKey });
      const cacheKey = `${PDF_RESOLVE_CACHE_VERSION}::${lookupPath}::${itemKey}`;
      if (pdfResolveCache.has(cacheKey)) {
        const cached = pdfResolveCache.get(cacheKey) ?? null;
        if (cached && !looksLikePdfPath(cached)) {
          pdfResolveCache.delete(cacheKey);
        } else {
          return cached;
        }
      }

      // NOTE: Do not scan `pyr_l1_batches.*` here. Those files are huge and in this dataset
      // they don't reliably contain a real PDF path (often only a journal/source string).
      // PDF resolution should come from bibliography tables / references caches instead.

      // Next: resolve from bibliography table caches (e.g. attribution.json) which may include a real pdf_path.
      try {
        const bibliographyDir = resolveBibliographyDir();
        const tableIndex = await ensureTablePdfIndex(bibliographyDir);
        const row = tableIndex.get(itemKey) || tableIndex.get(itemKey.toLowerCase());
        const candidatePdf = row?.pdf ? normalizePdfCandidate(row.pdf) : "";
        if (candidatePdf && looksLikePdfPath(candidatePdf)) {
          pdfResolveCache.set(cacheKey, candidatePdf);
          return candidatePdf;
        }
        const attachment = String(row?.attachment || "").trim();
        if (attachment && looksLikePdfPath(attachment)) {
          pdfResolveCache.set(cacheKey, attachment);
          return attachment;
        }
      } catch {
        // ignore
      }

      // Fast path: check references library in userData bibliographyDir.
      try {
        const bibliographyDir = resolveBibliographyDir();
        const candidate = path.join(bibliographyDir, REFERENCES_LIBRARY_FILENAME);
        const raw = readJsonIfExists(candidate);
        if (raw && typeof raw === "object") {
          const itemsByKey = (raw as any).itemsByKey;
          const items = Array.isArray((raw as any).items) ? (raw as any).items : [];
          const entry =
            (itemsByKey && typeof itemsByKey === "object" && ((itemsByKey as any)[itemKey] || (itemsByKey as any)[itemKey.toLowerCase()])) ||
            items.find((it: any) => it && (it.itemKey === itemKey || it.item_key === itemKey || it.key === itemKey));
          const pdf =
            (entry && typeof entry === "object" && (entry.pdf_path || entry.pdf || entry.file_path || entry.file)) || "";
          const attachment =
            (entry && typeof entry === "object" && (entry.attachment_pdf || entry.attachmentPdf)) || "";
          const pdfNorm = pdf ? normalizePdfCandidate(String(pdf)) : "";
          if (pdfNorm && looksLikePdfPath(pdfNorm)) {
            console.info("[leditor][pdf] resolved from references", { itemKey, path: candidate, kind: "pdf_path" });
            pdfResolveCache.set(cacheKey, pdfNorm);
            return pdfNorm;
          }
          if (attachment && looksLikePdfPath(String(attachment))) {
            console.info("[leditor][pdf] resolved from references", { itemKey, path: candidate, kind: "attachment_pdf" });
            pdfResolveCache.set(cacheKey, String(attachment));
            return String(attachment);
          }
        }
      } catch {
        // ignore
      }

      const candidates = [path.join(runDir, "pyr_l1_batches.json"), path.join(runDir, "batches.json")];
      for (const candidate of candidates) {
        try {
          const stat = await fs.promises.stat(candidate);
          if (!stat.isFile()) continue;
        } catch {
          continue;
        }
        const resolved = await findPdfInLargeBatchesJson(candidate, itemKey);
        if (resolved) {
          console.info("[leditor][pdf] resolved from batches", { itemKey, path: candidate });
          pdfResolveCache.set(cacheKey, resolved);
          return resolved;
        }
      }
      pdfResolveCache.set(cacheKey, null);
      return null;
    } catch (error) {
      console.warn("[leditor][pdf] resolve failed", { error: normalizeError(error) });
      return null;
    }
  });

  registerIpc("leditor:get-direct-quote-entry", async (_event, request: { lookupPath: string; dqid: string }) => {
    try {
      const lookupPath = normalizeFsPath(request.lookupPath);
      const dqid = String(request.dqid || "").trim().toLowerCase();
      if (!lookupPath || !dqid) return null;
      console.info("[leditor][directquote] entry requested", { dqid, lookupPath });
      const entry = await getDirectQuotePayload(lookupPath, dqid);
      if (entry == null) console.info("[leditor][directquote] entry miss", { dqid });
      return entry;
    } catch (error) {
      console.warn("[leditor][directquote] entry fetch failed", { error: normalizeError(error) });
      return null;
    }
  });

  registerIpc("leditor:prefetch-direct-quotes", async (_event, request: { lookupPath: string; dqids: string[] }) => {
    try {
      const lookupPath = normalizeFsPath(request.lookupPath);
      const dqids = Array.isArray(request.dqids) ? request.dqids : [];
      let found = 0;
      if (!lookupPath || dqids.length === 0) return { success: false, found };
      // Avoid hammering huge files; cap prefetch work.
      const capped = dqids.slice(0, 250);
      for (const dqid of capped) {
        const id = String(dqid || "").trim().toLowerCase();
        if (!id) continue;
        const entry = await getDirectQuotePayload(lookupPath, id);
        if (entry != null) found += 1;
      }
      console.info("[leditor][directquote] prefetch", { lookupPath, requested: dqids.length, attempted: capped.length, found });
      return { success: true, found };
    } catch (error) {
      console.warn("[leditor][directquote] prefetch failed", { error: normalizeError(error) });
      return { success: false, found: 0 };
    }
  });

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
