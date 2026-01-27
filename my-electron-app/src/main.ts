import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { app, BrowserWindow, ipcMain, Menu, MenuItemConstructorOptions, shell, dialog } from "electron";
import { pathToFileURL } from "url";
import type { ConvertResult } from "mammoth";
import mammoth from "mammoth";

import type { SectionLevel } from "./analyse/types";
import {
  ANALYSE_DIR,
  buildDatasetHandles,
  discoverRuns,
  loadBatches,
  loadSections,
  summariseRun,
  loadDirectQuoteLookup,
  getDefaultBaseDir
} from "./analyse/backend";
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
import { handleRetrieveCommand, registerRetrieveIpcHandlers } from "./main/ipc/retrieve_ipc";
import { registerProjectIpcHandlers } from "./main/ipc/project_ipc";
import { ProjectManager } from "./main/services/projectManager";
import { createCoderTestTree, createPdfTestPayload } from "./test/testFixtures";
import { getCoderCacheDir } from "./session/sessionPaths";
import type { SessionMenuAction } from "./session/sessionTypes";
import { openSettingsWindow } from "./windows/settingsWindow";

let mainWindow: BrowserWindow | null = null;
let secretsVault: ReturnType<typeof getSecretsVault> | null = null;
let userDataPath = "";
let handlersRegistered = false;
let projectManagerInstance: ProjectManager | null = null;
const settingsService = new SettingsService();
const SESSION_MENU_CHANNEL = "session:menu-action";

type CommandEnvelope = {
  phase?: string;
  action?: string;
  payload?: unknown;
};

const isDevelopment = process.env.NODE_ENV !== "production";

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

const CODE_STATE_FILE = "code_state.json";
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
    nodes: [createCoderFolderNode()]
  };
}

function normalizeCoderStatePayload(value?: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    const typed = value as Record<string, unknown>;
    const nodes = Array.isArray(typed.nodes) ? typed.nodes : undefined;
    if (nodes && nodes.length > 0) {
      return {
        version: typeof typed.version === "number" ? typed.version : CODER_STATE_VERSION,
        nodes
      };
    }
  }
  return createDefaultCoderState();
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

function registerIpcHandlers(projectManager: ProjectManager): void {
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

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

  ipcMain.handle("coder:save-payload", async (_event, payload: { scopeId?: string; nodeId: string; data: Record<string, unknown> }) => {
    try {
      const scope = sanitizeScopeId(payload?.scopeId);
      const coderDir = path.join(getCoderCacheDir(), scope);
      const payloadDir = path.join(coderDir, "payloads");
      await fs.promises.mkdir(payloadDir, { recursive: true });
      const safeNodeId = sanitizeNodeId(payload.nodeId);
      const jsonPath = path.join(payloadDir, `${safeNodeId}.json`);
      const txtPath = path.join(payloadDir, `${safeNodeId}.txt`);
      await fs.promises.writeFile(jsonPath, JSON.stringify(payload.data, null, 2), "utf-8");
      const textValue = String(payload.data?.text || payload.data?.title || "");
      await fs.promises.writeFile(txtPath, textValue, "utf-8");
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
    const legacyPath = path.join(coderDir, CODE_STATE_FILE);
    if ((global as any).__coder_state_cache?.[primaryPath]) {
      return (global as any).__coder_state_cache[primaryPath];
    }
    if ((global as any).__coder_state_cache?.[legacyPath]) {
      return (global as any).__coder_state_cache[legacyPath];
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
      try {
        const rawLegacy = await fs.promises.readFile(legacyPath, "utf-8");
        const parsedLegacy = JSON.parse(rawLegacy);
        const normalizedLegacy = normalizeCoderStatePayload(parsedLegacy);
        console.info(`[CODER][STATE] load legacy ${legacyPath}`);
        const payloadOut = { state: normalizedLegacy, baseDir: coderDir, statePath: legacyPath };
        (global as any).__coder_state_cache = (global as any).__coder_state_cache || {};
        (global as any).__coder_state_cache[legacyPath] = payloadOut;
        return payloadOut;
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") {
          console.warn(`[CODER][STATE] load failed ${legacyPath}`, legacyError);
        } else {
          console.info(`[CODER][STATE] load missing ${legacyPath}`);
        }
        return null;
      }
    }
  });

  ipcMain.handle("coder:save-state", async (_event, payload: { scopeId?: string; state?: Record<string, unknown> }) => {
    const scope = sanitizeScopeId(payload?.scopeId);
    const coderDir = path.join(getCoderCacheDir(), scope);
    const primaryPath = path.join(coderDir, CODER_STATE_FILE);
    const legacyPath = path.join(coderDir, CODE_STATE_FILE);
    try {
      await fs.promises.mkdir(coderDir, { recursive: true });
      const toWrite = payload?.state ? payload.state : createDefaultCoderState();
      await fs.promises.writeFile(primaryPath, JSON.stringify(toWrite, null, 2), "utf-8");
      await fs.promises.writeFile(legacyPath, JSON.stringify(toWrite, null, 2), "utf-8");
      console.info(`[CODER][STATE] save ${primaryPath}`);
    } catch (error) {
      console.warn(`[CODER][STATE] save failed ${primaryPath}`, error);
    }
    return { baseDir: coderDir, statePath: primaryPath };
  });

  registerRetrieveIpcHandlers();

  ipcMain.handle("analyse-command", (_event, payload: CommandEnvelope) => {
    if (payload && payload.phase && payload.action) {
      appendLogEntry(`ANALYSE phase=${payload.phase} action=${payload.action}`);
    }
    return { status: "ok" };
  });

  ipcMain.handle("analyse:discoverRuns", (_event, baseDir?: string) => discoverRuns(baseDir));
  ipcMain.handle("analyse:buildDatasets", (_event, runPath: string) => buildDatasetHandles(runPath));
  ipcMain.handle("analyse:loadBatches", async (_event, runPath: string) => loadBatches(runPath));
  ipcMain.handle("analyse:loadSections", async (_event, runPath: string, level: SectionLevel) => loadSections(runPath, level));
  ipcMain.handle("analyse:loadDqLookup", async (_event, runPath: string) => loadDirectQuoteLookup(runPath));
  ipcMain.handle("analyse:summariseRun", async (_event, runPath: string) => summariseRun(runPath));
  ipcMain.handle("analyse:getDefaultBaseDir", () => getDefaultBaseDir());
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
    try {
      const data = await fs.promises.readFile(request.sourcePath, "utf-8");
      return { success: true, data, filePath: request.sourcePath };
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

  registerProjectIpcHandlers(projectManager);
}

function createWindow(): void {
  if (mainWindow) {
    return;
  }

  const rendererPath = path.join(__dirname, "renderer", "index.html");
  const preloadScript = path.join(__dirname, "preload.js");
  const leditorResourcesPath = path.join(app.getAppPath(), "dist", "resources", "leditor");
  const hostContract = {
    version: 1,
    sessionId: "annotarium-session",
    documentId: "annotarium-document",
    documentTitle: "Annotarium Document",
    paths: {
      contentDir: path.join(leditorResourcesPath, "content"),
      bibliographyDir: path.join(leditorResourcesPath, "bibliography"),
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
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadScript,
      additionalArguments: [leditorHostArg]
    }
  });

  window.once("ready-to-show", () => {
    window.show();
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
      const baseUserData = app.getPath("userData");
      initializeSettingsFacade(baseUserData);
      userDataPath = getAppDataPath();
      secretsVault = initializeSecretsVault(userDataPath);
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
}

initializeApp();
