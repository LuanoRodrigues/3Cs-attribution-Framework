import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import type { SectionLevel } from "./analyse/types";
import type { SessionData, SessionMenuAction } from "./session/sessionTypes";
import type { RetrievePaperSnapshot } from "./shared/types/retrieve";
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

contextBridge.exposeInMainWorld("retrieveBridge", {
  tags: {
    list: (paperId: string) => ipcRenderer.invoke("retrieve:tags:list", paperId),
    add: (payload: { paper: RetrievePaperSnapshot; tag: string }) =>
      ipcRenderer.invoke("retrieve:tags:add", payload),
    remove: (payload: { paperId: string; tag: string }) =>
      ipcRenderer.invoke("retrieve:tags:remove", payload)
  }
});

contextBridge.exposeInMainWorld("analyseBridge", {
  dispatch: (payload: unknown) => ipcRenderer.invoke("analyse-command", payload),
  data: {
    discoverRuns: (baseDir?: string) => ipcRenderer.invoke("analyse:discoverRuns", baseDir),
    buildDatasetHandles: (runPath: string) => ipcRenderer.invoke("analyse:buildDatasets", runPath),
    loadBatches: (runPath: string) => ipcRenderer.invoke("analyse:loadBatches", runPath),
    loadSections: (runPath: string, level: SectionLevel) => ipcRenderer.invoke("analyse:loadSections", runPath, level),
    loadDqLookup: (runPath: string) => ipcRenderer.invoke("analyse:loadDqLookup", runPath),
    summariseRun: (runPath: string) => ipcRenderer.invoke("analyse:summariseRun", runPath),
    getDefaultBaseDir: () => ipcRenderer.invoke("analyse:getDefaultBaseDir"),
    getAudioCacheStatus: (runId: string | undefined, keys: string[]) =>
      ipcRenderer.invoke("analyse:audioCacheStatus", runId, keys),
    addAudioCacheEntries: (runId: string | undefined, entries: unknown[]) =>
      ipcRenderer.invoke("analyse:audioCacheAdd", runId, entries)
  }
});

contextBridge.exposeInMainWorld("settingsBridge", {
  getAll: () => ipcRenderer.invoke("settings:getAll"),
  getValue: (key: string, defaultValue?: unknown) => ipcRenderer.invoke("settings:getValue", key, defaultValue),
  setValue: (key: string, value: unknown) => ipcRenderer.invoke("settings:setValue", key, value),
  unlockSecrets: (passphrase: string) => ipcRenderer.invoke("settings:unlockSecrets", passphrase),
  getSecret: (name: string) => ipcRenderer.invoke("settings:getSecret", name),
  setSecret: (name: string, value: string) => ipcRenderer.invoke("settings:setSecret", name, value),
  exportBundle: (zipPath: string, includeSecrets?: boolean) =>
    ipcRenderer.invoke("settings:exportBundle", { zipPath, includeSecrets }),
  importBundle: (zipPath: string) => ipcRenderer.invoke("settings:importBundle", zipPath),
  getPaths: () => ipcRenderer.invoke("settings:getPaths"),
  openSettingsWindow: (section?: string) => ipcRenderer.invoke("settings:open-window", { section })
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
  savePayload: (payload: { scopeId?: string; nodeId: string; data: Record<string, unknown> }) =>
    ipcRenderer.invoke("coder:save-payload", payload),
  loadState: (payload: { scopeId?: string }) => ipcRenderer.invoke("coder:load-state", payload),
  saveState: (payload: { scopeId?: string; state: CoderState }) => ipcRenderer.invoke("coder:save-state", payload)
});

let footnoteHandlers: { open?: () => void; toggle?: () => void; close?: () => void } | null = null;

const readFile = async (request: { sourcePath: string }) => {
  return ipcRenderer.invoke("leditor:read-file", request);
};

const writeFile = async (request: { targetPath: string; data: string }) => {
  return ipcRenderer.invoke("leditor:write-file", request);
};

contextBridge.exposeInMainWorld("leditorHost", {
  exportDOCX: (request: { docJson: object; options?: Record<string, unknown> }) =>
    ipcRenderer.invoke("leditor:export-docx", request),
  exportPDF: (request: { html: string; options?: { suggestedPath?: string; prompt?: boolean } }) =>
    ipcRenderer.invoke("leditor:export-pdf", request),
  registerFootnoteHandlers: (handlers: { open?: () => void; toggle?: () => void; close?: () => void }) => {
    footnoteHandlers = handlers;
  },
  openFootnotePanel: () => footnoteHandlers?.open?.(),
  toggleFootnotePanel: () => footnoteHandlers?.toggle?.(),
  closeFootnotePanel: () => footnoteHandlers?.close?.(),
  importDOCX: (request?: { options?: { sourcePath?: string; prompt?: boolean } }) =>
    ipcRenderer.invoke("leditor:import-docx", request ?? {}),
  insertImage: () => ipcRenderer.invoke("leditor:insert-image"),
  readFile,
  writeFile
});
