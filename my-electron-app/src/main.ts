import fs from "fs";
import path from "path";
import net from "net";
import { randomUUID } from "crypto";
import os from "os";
import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, shell, dialog } from "electron";
import { pathToFileURL } from "url";
import mammoth from "mammoth";
import JSZip from "jszip";
import { spawn } from "child_process";

import type { SectionLevel } from "./analyse/types";
import { addAudioCacheEntries, getAudioCacheStatus } from "./analyse/audioCache";
import { exportConfigBundle, importConfigBundle } from "./config/bundle";
import { SettingsService } from "./config/settingsService";
import {
  getAppDataPath,
  getConfigDirectory,
  getSettingsFilePath,
  initializeSettingsFacade
} from "./config/settingsFacade";
import { getSecretsVault, initializeSecretsVault } from "./config/secretsVaultInstance";
import { DATABASE_KEYS } from "./config/settingsKeys";
import { handleRetrieveCommand, registerRetrieveIpcHandlers } from "./main/ipc/retrieve_ipc";
import { registerProjectIpcHandlers } from "./main/ipc/project_ipc";
import { ProjectManager } from "./main/services/projectManager";
import { invokeVisualiseExportPptx, invokeVisualisePreview, invokeVisualiseSections } from "./main/services/visualiseBridge";
import { invokePdfOcr } from "./main/services/pdfOcrBridge";
import { createCoderTestTree, createPdfTestPayload } from "./test/testFixtures";
import { getCoderCacheDir } from "./session/sessionPaths";
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

type AgentReplaceParagraphOp = {
  op: "replaceParagraph";
  n: number;
  text: string;
};

type AgentRequestPayload = {
  instruction: string;
  targets?: Array<{ n: number }>;
  blocks?: Array<{ n: number; type?: string; attrs?: unknown; text?: string; nodeJson?: unknown }>;
  document?: { text?: string };
  settings?: { model?: string; temperature?: number; chunkSize?: number };
};

type AgentRequestEnvelope = {
  requestId?: string;
  payload: AgentRequestPayload;
};

type AgentMeta = {
  provider: "openai";
  model: string;
  ms: number;
};

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
        collapsed_ids: collapsed
      };
    }
  }
  return createDefaultCoderState();
}

function toPersistentCoderStatePayload(value: Record<string, unknown>): Record<string, unknown> {
  const normalized = normalizeCoderStatePayload(value);
  const toNode = (node: any): any => {
    if (!node || typeof node !== "object") {
      return null;
    }
    const type = node.type === "item" ? "item" : "folder";
    if (type === "folder") {
      return {
        type: "folder",
        id: String(node.id || randomUUID()),
        name: String(node.name || "Section"),
        note: String(node.note || ""),
        edited_html: String(node.edited_html || node.editedHtml || ""),
        updated_utc: String(node.updated_utc || node.updatedUtc || new Date().toISOString()),
        children: Array.isArray(node.children) ? node.children.map(toNode).filter(Boolean) : []
      };
    }
    return {
      type: "item",
      id: String(node.id || randomUUID()),
      title: String(node.title || node.name || "Selection"),
      status: String(node.status || "include"),
      note: String(node.note || ""),
      edited_html: String(node.edited_html || node.editedHtml || ""),
      updated_utc: String(node.updated_utc || node.updatedUtc || new Date().toISOString()),
      payload: node.payload && typeof node.payload === "object" ? node.payload : {}
    };
  };
  const nodes = Array.isArray((normalized as any).nodes) ? (normalized as any).nodes : [];
  const collapsed = Array.isArray((normalized as any).collapsed_ids) ? (normalized as any).collapsed_ids : [];
  return {
    version: typeof (normalized as any).version === "number" ? (normalized as any).version : CODER_STATE_VERSION,
    nodes: nodes.map(toNode).filter(Boolean),
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

function normalizeAgentError(error: unknown): string {
  if (!error) return "Unknown error";
  if (error instanceof Error) return error.message || "Error";
  return String(error);
}

function extractFirstJsonValue(text: string): unknown {
  const trimmed = (text || "").trim();
  if (!trimmed) throw new Error("Empty model response");
  try {
    return JSON.parse(trimmed);
  } catch {
    // try to extract a JSON object/array substring
  }
  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const start =
    firstBrace === -1 ? firstBracket : firstBracket === -1 ? firstBrace : Math.min(firstBrace, firstBracket);
  if (start === -1) {
    throw new Error("Model did not return JSON");
  }
  const candidate = trimmed.slice(start);
  // brute-force: find a suffix that parses
  for (let end = candidate.length; end > 0; end -= 1) {
    const slice = candidate.slice(0, end).trim();
    if (!slice.endsWith("}") && !slice.endsWith("]")) continue;
    try {
      return JSON.parse(slice);
    } catch {
      // continue
    }
  }
  throw new Error("Unable to parse JSON from model response");
}

async function callOpenAiResponses(params: {
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<{ outputText: string; meta: AgentMeta }> {
  const started = Date.now();
  const bodyBase: Record<string, unknown> = {
    model: params.model,
    instructions: params.instructions,
    input: params.input
  };
  const makeBody = (includeTemperature: boolean) => {
    const body: Record<string, unknown> = { ...bodyBase };
    if (includeTemperature && typeof params.temperature === "number" && Number.isFinite(params.temperature)) {
      body.temperature = params.temperature;
    }
    return body;
  };

  const doFetch = async (includeTemperature: boolean): Promise<{ outputText: string; meta: AgentMeta }> => {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify(makeBody(includeTemperature)),
      signal: params.signal
    });

    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!response.ok) {
      const message =
        (json && (json.error?.message || json.error?.code || json.message)) || text || `HTTP ${response.status}`;
      const err = new Error(String(message));
      (err as any).status = response.status;
      throw err;
    }

    const outputText =
      (json && typeof json.output_text === "string" && json.output_text) ||
      (json && Array.isArray(json.output)
        ? json.output
            .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
            .filter((c: any) => c && (c.type === "output_text" || c.type === "text") && typeof c.text === "string")
            .map((c: any) => c.text)
            .join("")
        : "") ||
      "";

    return {
      outputText: String(outputText || ""),
      meta: { provider: "openai", model: params.model, ms: Date.now() - started }
    };
  };

  try {
    return await doFetch(true);
  } catch (error) {
    const msg = normalizeAgentError(error);
    if (msg.includes("Unsupported parameter: 'temperature'") || msg.includes("temperature is not supported")) {
      return await doFetch(false);
    }
    throw error;
  }
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

  const agentControllers = new Map<string, AbortController>();

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
        if (payload.action === "run_inputs" || payload.action === "refresh_preview" || payload.action === "build_deck") {
          const body = (payload.payload as Record<string, unknown>) || {};
          const response = await invokeVisualisePreview({
            table: body.table as any,
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
            table: body.table as any,
            include: (body.include as string[]) || [],
            params: (body.params as Record<string, unknown>) || {},
            selection: (body.selection as any) || undefined,
            collectionName,
            outputPath
          });
          return response;
        }
        if (payload.action === "get_sections") {
          return await invokeVisualiseSections();
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

  const resolveDefaultLedocPath = async (): Promise<string> => {
    const repoRoot = resolveRepoRoot();
    const repoCandidate = path.join(repoRoot, "coder_state.ledoc");
    try {
      if (fs.existsSync(repoCandidate)) {
        return repoCandidate;
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

  const ensureLedocExists = async (filePath: string): Promise<void> => {
    try {
      if (fs.existsSync(filePath)) return;
    } catch {
      // ignore
    }
    const now = new Date().toISOString();
    const payload = {
      document: { type: "doc", content: [{ type: "paragraph" }] },
      meta: { version: "1.0", title: "Untitled document", authors: [], created: now, lastModified: now },
      settings: {
        pageSize: "A4",
        // px @ 96dpi
        margins: { top: 96, right: 96, bottom: 96, left: 96 }
      }
    };
    const buffer = await packLedocZip(payload as any);
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, buffer);
  };

  ipcMain.handle("leditor:get-default-ledoc-path", async () => {
    const filePath = await resolveDefaultLedocPath();
    try {
      await ensureLedocExists(filePath);
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
          properties: ["openFile"],
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
        const ext = path.extname(sourcePath).toLowerCase();
        if (ext === ".json") {
          const raw = await fs.promises.readFile(sourcePath, "utf-8");
          const parsed = JSON.parse(raw);
          return { success: true, filePath: sourcePath, payload: { document: parsed, meta: { version: "1.0", title: "Imported JSON", authors: [], created: "", lastModified: "" } } };
        }
        const buffer = await fs.promises.readFile(sourcePath);
        const payload = await unpackLedocZip(buffer);
        return { success: true, filePath: sourcePath, payload };
      } catch (error) {
        return { success: false, error: normalizeError(error) };
      }
    }
  );

  ipcMain.handle(
    "leditor:export-ledoc",
    async (_event, request: { payload?: any; options?: { suggestedPath?: string; prompt?: boolean } }) => {
      const repoRoot = resolveRepoRoot();
      const options = request?.options ?? {};
      const promptUser = options.prompt ?? true;
      let filePath = options.suggestedPath as string | undefined;
      if (!filePath || promptUser) {
        const defaultPath = filePath && path.isAbsolute(filePath) ? filePath : path.join(repoRoot, "coder_state.ledoc");
        const result = await dialog.showSaveDialog({
          title: "Export LEDOC",
          defaultPath,
          filters: [{ name: "LEditor Document", extensions: ["ledoc"] }]
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
        const payload = request?.payload ?? {};
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

  ipcMain.handle("leditor:agent-cancel", async (_event, request: { requestId?: string }) => {
    const requestId = typeof request?.requestId === "string" ? request.requestId : "";
    if (!requestId) return { success: false, error: "Missing requestId" };
    const controller = agentControllers.get(requestId);
    if (controller) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
      agentControllers.delete(requestId);
    }
    return { success: true };
  });

  ipcMain.handle("leditor:agent-request", async (_event, request: AgentRequestEnvelope) => {
    loadDotEnvIntoProcessEnv();
    const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return { success: false, error: "Missing OPENAI_API_KEY in environment.", meta: { provider: "openai", model: "unknown", ms: 0 } };
    }
    const requestId = typeof request?.requestId === "string" ? request.requestId : `agent-${Date.now()}`;
    const payload = request?.payload;
    const controller = new AbortController();
    agentControllers.set(requestId, controller);
    try {
      const instruction = typeof payload?.instruction === "string" ? payload.instruction.trim() : "";
      if (!instruction) {
        return { success: false, error: "Agent instruction is required." };
      }

      const envModel = String(process.env.OPENAI_MODEL || process.env.CODEX_MODEL || "").trim();
      const settingsModel = typeof payload?.settings?.model === "string" ? payload.settings.model.trim() : "";
      const model = settingsModel || envModel || "codex-mini-latest";
      const temperature =
        typeof payload?.settings?.temperature === "number" && Number.isFinite(payload.settings.temperature)
          ? payload.settings.temperature
          : undefined;

      const targetNs = Array.isArray(payload?.targets) ? payload.targets.map((t) => Number((t as any)?.n)).filter(Number.isFinite) : [];
      const uniqueTargets = Array.from(new Set(targetNs)).sort((a, b) => a - b);

      const blocksRaw = Array.isArray(payload?.blocks) ? payload.blocks : [];
      const blocks = blocksRaw
        .map((b) => ({
          n: Number((b as any)?.n),
          type: typeof (b as any)?.type === "string" ? String((b as any).type) : undefined,
          attrs: (b as any)?.attrs ?? undefined,
          text: typeof (b as any)?.text === "string" ? String((b as any).text) : "",
          nodeJson: (b as any)?.nodeJson ?? undefined
        }))
        .filter((b) => Number.isFinite(b.n) && b.n >= 1);

      const filteredBlocks = uniqueTargets.length
        ? blocks.filter((b) => uniqueTargets.includes(b.n))
        : blocks;

      const system = [
        "You are a deterministic academic document editing agent.",
        "You receive a JSON payload describing numbered BLOCKS from a ProseMirror document.",
        "Return STRICT JSON only (no markdown, no commentary).",
        "",
        "Output schema (JSON object):",
        '{ "assistantText": string, "operations": Array<{ "op": "replaceParagraph", "n": number, "text": string }> }',
        "",
        "Rules:",
        "- Only propose operations for the provided blocks, and only for the listed target indices.",
        "- Do not invent new indices.",
        "- If no change is needed, return operations: [].",
        "- The 'text' must be plain text (no HTML).",
        "",
        uniqueTargets.length ? `Target indices: ${uniqueTargets.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join("\n");

      const input = JSON.stringify(
        {
          instruction,
          targets: uniqueTargets,
          blocks: filteredBlocks.map((b) => ({
            n: b.n,
            type: b.type,
            attrs: b.attrs,
            text: b.text,
            node: b.nodeJson
          }))
        },
        null,
        2
      );

      const { outputText, meta } = await callOpenAiResponses({
        apiKey,
        model,
        instructions: system,
        input,
        temperature,
        signal: controller.signal
      });

      const parsed = extractFirstJsonValue(outputText);
      const assistantText = typeof (parsed as any)?.assistantText === "string" ? String((parsed as any).assistantText) : "";
      const operationsRaw = (parsed as any)?.operations;
      const operations = Array.isArray(operationsRaw) ? operationsRaw : [];
      const sanitizedOps: AgentReplaceParagraphOp[] = [];

      for (const op of operations) {
        if (!op || typeof op !== "object") continue;
        if ((op as any).op !== "replaceParagraph") continue;
        const n = Number((op as any).n);
        const text = typeof (op as any).text === "string" ? String((op as any).text) : "";
        if (!Number.isFinite(n) || n < 1) continue;
        if (uniqueTargets.length && !uniqueTargets.includes(n)) continue;
        sanitizedOps.push({ op: "replaceParagraph", n, text });
      }

      return {
        success: true,
        assistantText: assistantText || (sanitizedOps.length ? "Draft ready." : "No changes proposed."),
        operations: sanitizedOps,
        meta
      };
    } catch (error) {
      return { success: false, error: normalizeAgentError(error) };
    } finally {
      agentControllers.delete(requestId);
    }
  });

  ipcMain.handle("coder:save-payload", async (_event, payload: { scopeId?: string; nodeId: string; data: Record<string, unknown> }) => {
    try {
      const scope = sanitizeScopeId(payload?.scopeId);
      const coderDir = path.join(getCoderCacheDir(), scope);
      const payloadDir = path.join(coderDir, "payloads");
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
  });

  ipcMain.handle("coder:load-state", async (_event, payload: { scopeId?: string }) => {
    const scope = sanitizeScopeId(payload?.scopeId);
    const coderDir = path.join(getCoderCacheDir(), scope);
    const primaryPath = path.join(coderDir, CODER_STATE_FILE);
    if ((global as any).__coder_state_cache?.[primaryPath]) {
      return (global as any).__coder_state_cache[primaryPath];
    }
    try {
      await fs.promises.mkdir(coderDir, { recursive: true });
      const raw = await fs.promises.readFile(primaryPath, "utf-8");
      const parsed = JSON.parse(raw);
      const normalized = normalizeCoderStatePayload(parsed);
      console.info(`[CODER][STATE] load ${primaryPath}`);
      const payloadOut = { state: normalized, baseDir: coderDir, statePath: primaryPath };
      (global as any).__coder_state_cache = (global as any).__coder_state_cache || {};
      (global as any).__coder_state_cache[primaryPath] = payloadOut;
      return payloadOut;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`[CODER][STATE] load failed ${primaryPath}`, error);
        return null;
      }
      console.info(`[CODER][STATE] load missing ${primaryPath}`);
      return null;
    }
  });

  ipcMain.handle("coder:save-state", async (_event, payload: { scopeId?: string; state?: Record<string, unknown> }) => {
    const scope = sanitizeScopeId(payload?.scopeId);
    const coderDir = path.join(getCoderCacheDir(), scope);
    const primaryPath = path.join(coderDir, CODER_STATE_FILE);
    try {
      await fs.promises.mkdir(coderDir, { recursive: true });
      const raw = payload?.state ? payload.state : createDefaultCoderState();
      const toWrite = toPersistentCoderStatePayload(raw);
      const encoded = JSON.stringify(toWrite, null, 2);
      await atomicWriteJson(primaryPath, encoded);
      console.info(`[CODER][STATE] save ${primaryPath}`);
      (global as any).__coder_state_cache = (global as any).__coder_state_cache || {};
      (global as any).__coder_state_cache[primaryPath] = { state: toWrite, baseDir: coderDir, statePath: primaryPath };
    } catch (error) {
      console.warn(`[CODER][STATE] save failed ${primaryPath}`, error);
    }
    return { baseDir: coderDir, statePath: primaryPath };
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
