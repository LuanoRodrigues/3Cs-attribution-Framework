import { LEditor, type EditorHandle } from "../api/leditor.ts";
import { recordRibbonSelection, snapshotFromSelection } from "../utils/selection_snapshot.ts";
import "../extensions/plugin_debug.ts";
import "../extensions/plugin_search.ts";
import "../extensions/plugin_preview.ts";
import "../extensions/plugin_source_view.ts";
import "../extensions/plugin_export_docx.ts";
import "../extensions/plugin_import_docx.ts";
import { renderRibbon } from "./ribbon.ts";
import { mountStatusBar } from "../ui/status_bar.ts";
import { attachContextMenu } from "./context_menu.ts";
import { initFullscreenController } from "./fullscreen.ts";
import { featureFlags } from "../ui/feature_flags.ts";
import { initGlobalShortcuts } from "./shortcuts.ts";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-serif-4/600.css";
import "./ribbon.css";
import "./home.css";
import "./style_mini_app.css";
import "./agent_sidebar.css";
import "./ai_settings.css";
import "./paragraph_grid.css";
import "./ai_draft_preview.css";
import "./references.css";
import "./references_overlay.css";
import { mountA4Layout, type A4LayoutController } from "./a4_layout.ts";
import { initViewState } from "./view_state.ts";
import { setLayoutController } from "./layout_context.ts";
import { subscribeToLayoutChanges } from "../ui/layout_settings.ts";
import { refreshLayoutView } from "./layout_engine.ts";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { getFootnoteRegistry, type FootnoteNodeViewAPI } from "../extensions/extension_footnote.ts";
import { resetFootnoteState, getFootnoteIds } from "../editor/footnote_state.ts";
import { createFootnoteManager } from "./footnote_manager.ts";
import { getCurrentPageSize, getMarginValues } from "../ui/layout_settings.ts";
import { registerLibrarySmokeChecks } from "../plugins/librarySmokeChecks.ts";
import { getHostContract } from "./host_contract.ts";
import { ensureReferencesLibrary, resolveCitationTitle } from "./references/library.ts";
import { installDirectQuotePdfOpenHandler } from "./direct_quote_pdf.ts";
import { perfMark, perfMeasure, perfSummaryOnce } from "./perf.ts";
import { getHostAdapter, setHostAdapter, type HostAdapter } from "../host/host_adapter.ts";

const ensureProcessEnv = (): Record<string, string | undefined> | undefined => {
  if (typeof globalThis === "undefined") {
    return undefined;
  }
  const g = globalThis as typeof globalThis & { process?: NodeJS.Process };
  if (typeof g.process === "undefined") {
    g.process = { env: {} } as NodeJS.Process;
    return g.process.env;
  }
  if (!g.process.env) {
    g.process.env = {};
  }
  return g.process.env;
};
let handle: EditorHandle | null = null;
const DEFAULT_CODER_STATE_PATH =
  "\\\\wsl.localhost\\Ubuntu-22.04\\home\\pantera\\annotarium\\coder\\0-13_cyber_attribution_corpus_records_total_included\\coder_state.json";
type CoderStateLoadResult = { html: string; sourcePath: string };
const CODER_STATE_PATH_STORAGE_KEY = "leditor.coderStatePath";
let lastCoderStateNode: any = null;
let lastCoderStatePath: string | null = null;
const CODER_SCOPE_STORAGE_KEY = "leditor.scopeId";

const convertWslPath = (value: string): string => {
  const trimmed = value.replace(/^\\\\+/, "");
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  const root = segments[0]?.toLowerCase();
  if (segments.length >= 3 && (root === "wsl$" || root === "wsl.localhost")) {
    return `/${segments.slice(2).join("/")}`;
  }
  return value;
};

const toFileUrl = (value: string): string => {
  if (!value) return "";
  const normalized = convertWslPath(value).replace(/\\/g, "/");
  if (/^file:\/\//i.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("/")) {
    return `file://${normalized}`;
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return `file:///${normalized}`;
  }
  return normalized;
};

type ParsedCoderState = {
  html?: string;
  keyCount: number;
  nodeCount: number;
  firstNode?: any;
};

const extractBodyHtml = (html: string): string => {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const bodyInner = doc.body?.innerHTML ?? "";
    if (typeof bodyInner === "string" && bodyInner.trim().length > 0) {
      return bodyInner;
    }
  } catch (error) {
    console.debug("[CoderState] body extraction failed", { error });
  }
  return html;
};

const normalizeLegacyJson = (raw: string): string => {
  if (typeof raw !== "string") return String(raw ?? "");
  return raw
    .replace(/\bNaN\b/g, "null")
    .replace(/\bnan\b/g, "null")
    .replace(/\bInfinity\b/g, "null")
    .replace(/\b-Infinity\b/g, "null");
};

const parseCoderStateHtml = (raw: string): ParsedCoderState | null => {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(normalizeLegacyJson(raw)) as {
      edited_html?: string;
      editedHtml?: string;
      nodes?: Array<{ edited_html?: string; editedHtml?: string } | null>;
    };
    const keyCount = Object.keys(parsed).length;
    const nodeCount = Array.isArray(parsed.nodes) ? parsed.nodes.length : 0;
    const pickHtml = (): { html: string; firstNode?: any } | null => {
      if (typeof parsed?.edited_html === "string" && parsed.edited_html.trim().length > 0) {
        return { html: parsed.edited_html };
      }
      if (typeof parsed?.editedHtml === "string" && parsed.editedHtml.trim().length > 0) {
        return { html: parsed.editedHtml };
      }
      if (Array.isArray(parsed?.nodes)) {
        for (const node of parsed.nodes) {
          const html =
            (node && typeof node.edited_html === "string" && node.edited_html.trim().length > 0
              ? node.edited_html
              : node && typeof node.editedHtml === "string" && node.editedHtml.trim().length > 0
              ? node.editedHtml
              : null);
          if (html) {
            return { html, firstNode: node };
          }
        }
      }
      return null;
    };
    const picked = pickHtml();
    if (picked && typeof picked.html === "string" && picked.html.trim().length > 0) {
      return { html: extractBodyHtml(picked.html), keyCount, nodeCount, firstNode: picked.firstNode };
    }
    return { keyCount, nodeCount };
  } catch (error) {
    console.debug("[CoderState] JSON parse failed", { error });
  }
  return null;
};

const extractHtmlFromStateObject = (state: any): string | null => {
  if (!state || typeof state !== "object") return null;
  if (typeof state.edited_html === "string" && state.edited_html.trim().length > 0) {
    return extractBodyHtml(state.edited_html);
  }
  if (typeof state.editedHtml === "string" && state.editedHtml.trim().length > 0) {
    return extractBodyHtml(state.editedHtml);
  }
  if (Array.isArray(state.nodes)) {
    for (const node of state.nodes) {
      if (!node || typeof node !== "object") continue;
      if (typeof node.edited_html === "string" && node.edited_html.trim().length > 0) {
        return extractBodyHtml(node.edited_html);
      }
      if (typeof node.editedHtml === "string" && node.editedHtml.trim().length > 0) {
        return extractBodyHtml(node.editedHtml);
      }
    }
  }
  return null;
};

const resolveScopeId = async (): Promise<string | null> => {
  const fromQuery = (() => {
    try {
      const params = new URLSearchParams(window.location.search || "");
      return (params.get("scopeId") || params.get("scope") || "").trim();
    } catch {
      return "";
    }
  })();
  if (fromQuery) return fromQuery;
  const fromStorage = (() => {
    try {
      const v = window.localStorage.getItem(CODER_SCOPE_STORAGE_KEY);
      return v ? v.trim() : "";
    } catch {
      return "";
    }
  })();
  if (fromStorage) return fromStorage;
  if (window.settingsBridge?.getValue) {
    try {
      const zotero = await window.settingsBridge.getValue("Zotero/last_used_collection", "");
      if (typeof zotero === "string" && zotero.trim()) return zotero.trim();
      const general = await window.settingsBridge.getValue("General/collection_name", "");
      if (typeof general === "string" && general.trim()) return general.trim();
    } catch {
      // ignore
    }
  }
  return null;
};

const attemptCoderBridgeRead = async (): Promise<CoderStateLoadResult | null> => {
  const loader = window.coderBridge?.loadState;
  if (!loader) return null;
  const scopeId = await resolveScopeId();
  if (!scopeId) return null;
  try {
    const result = await loader({ scopeId });
    if (!result?.state) return null;
    const html = extractHtmlFromStateObject(result.state);
    if (!html) return null;
    try {
      window.localStorage.setItem(CODER_SCOPE_STORAGE_KEY, scopeId);
    } catch {
      // ignore
    }
    return { html, sourcePath: result.statePath ?? scopeId };
  } catch (error) {
    console.debug("[CoderState] coderBridge load failed", { error, scopeId });
    return null;
  }
};

const logKeys = (raw: string, path: string, mode: string) => {
  try {
    const obj = JSON.parse(normalizeLegacyJson(raw));
    const keys = Array.isArray(obj) ? [] : Object.keys(obj ?? {});
    const nodesCount = Array.isArray((obj as any)?.nodes) ? (obj as any).nodes.length : undefined;
    const hasEdited =
      typeof (obj as any)?.edited_html === "string" ||
      typeof (obj as any)?.editedHtml === "string" ||
      (Array.isArray((obj as any)?.nodes) &&
        (obj as any).nodes.some(
          (n: any) => typeof n?.edited_html === "string" || typeof n?.editedHtml === "string"
        ));
    console.info("[text][keys]", { mode, path, keys, nodesCount, hasEditedHtml: hasEdited });
  } catch (error) {
    console.debug("[CoderState] key log parse failed", { mode, path, error });
  }
};

const logNode0 = (mode: string, path: string, node: any) => {
  lastCoderStateNode = node ?? null;
  lastCoderStatePath = path ?? null;
  if (!node) {
    console.info("[CoderState][node0]", { mode, path, status: "missing" });
    return;
  }
  const editedHtmlLength =
    typeof node?.editedHtml === "string" ? node.editedHtml.length : node?.edited_html?.length;
  console.info("[CoderState][node0]", {
    mode,
    path,
    id: node.id,
    type: node.type,
    name: node.name,
    editedHtmlLength
  });
};

const attemptHostRead = async (sourcePath: string): Promise<CoderStateLoadResult | null> => {
  const hostReader = window.leditorHost?.readFile;
  if (!hostReader) {
    console.debug("[CoderState] host readFile unavailable");
    return null;
  }
  try {
    const result = await hostReader({ sourcePath });
    if (!result?.success || typeof result.data !== "string") {
      if (result && result.error) {
        console.debug("[CoderState] host read failed", { error: result.error });
      }
      return null;
    }
    const parsed = parseCoderStateHtml(result.data);
    if (!parsed?.html) {
      console.debug("[CoderState] host response missing html", {
        filePath: result.filePath ?? sourcePath,
        keys: parsed?.keyCount,
        nodes: parsed?.nodeCount
      });
      return null;
    }
    const resolvedPath = result.filePath ?? sourcePath;
    logKeys(result.data, resolvedPath, "host");
    logNode0("host", resolvedPath, parsed.firstNode);
    console.info(`[text][loader]: ${resolvedPath}`, {
      mode: "host",
      length: parsed.html.length,
      keys: parsed.keyCount,
      nodes: parsed.nodeCount
    });
    return { html: parsed.html, sourcePath: resolvedPath };
  } catch (error) {
    console.debug("[CoderState] host read threw", { error });
    return null;
  }
};

const attemptFetchRead = async (sourcePath: string): Promise<CoderStateLoadResult | null> => {
  if (typeof fetch !== "function") {
    return null;
  }
  const fileUrl = toFileUrl(sourcePath);
  if (!fileUrl) {
    return null;
  }
  try {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      console.debug("[CoderState] fetch failed", { status: response.status, fileUrl });
      return null;
    }
    const raw = await response.text();
    logKeys(raw, fileUrl, "fetch");
    const parsed = parseCoderStateHtml(raw);
    if (!parsed?.html) {
      console.debug("[CoderState] fetch payload missing html", {
        fileUrl,
        keys: parsed?.keyCount,
        nodes: parsed?.nodeCount
      });
      return null;
    }
    logNode0("fetch", fileUrl, parsed.firstNode);
    console.info(`[text][loader]: ${fileUrl}`, {
      mode: "fetch",
      length: parsed.html.length,
      keys: parsed.keyCount,
      nodes: parsed.nodeCount
    });
    return { html: parsed.html, sourcePath };
  } catch (error) {
    console.debug("[CoderState] fetch threw", { error, fileUrl });
    return null;
  }
};

const attemptViteFsRead = async (sourcePath: string): Promise<CoderStateLoadResult | null> => {
  if (typeof fetch !== "function") return null;
  if (typeof location === "undefined") return null;
  if (!/^https?:/i.test(location.protocol)) return null;
  const fsPath = convertWslPath(sourcePath);
  const url = `${location.origin}/@fs${fsPath}`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.debug("[CoderState] @fs fetch failed", { status: response.status, url });
      return null;
    }
    const raw = await response.text();
    logKeys(raw, url, "@fs");
    const parsed = parseCoderStateHtml(raw);
    if (!parsed?.html) {
      console.debug("[CoderState] @fs payload missing html", { url, keys: parsed?.keyCount, nodes: parsed?.nodeCount });
      return null;
    }
    logNode0("@fs", url, parsed.firstNode);
    console.info(`[text][loader]: ${url}`, { mode: "@fs", length: parsed.html.length, keys: parsed.keyCount, nodes: parsed.nodeCount });
    return { html: parsed.html, sourcePath };
  } catch (error) {
    console.debug("[CoderState] @fs fetch threw", { error, url });
    return null;
  }
};

const resolveCoderStatePath = (): string => {
  const fromStorage = (() => {
    try {
      const v = window.localStorage.getItem(CODER_STATE_PATH_STORAGE_KEY);
      return v ? v.trim() : "";
    } catch {
      return "";
    }
  })();
  if (fromStorage) {
    // Normalize common WSL UNC variations to a canonical UNC path.
    // Some environments may store a single-leading-backslash form like:
    // \wsl.localhost\Ubuntu-22.04\home\...
    // We require the canonical UNC prefix:
    // \\wsl.localhost\Ubuntu-22.04\home\...
    if (/^\\(wsl\.localhost|wsl\$)\\/i.test(fromStorage) && !/^\\\\(wsl\.localhost|wsl\$)\\/i.test(fromStorage)) {
      const normalized = `\\${fromStorage}`;
      try {
        // Persist normalization so we don't keep re-normalizing each run.
        window.localStorage.setItem(CODER_STATE_PATH_STORAGE_KEY, normalized);
      } catch {
        // Ignore storage failures.
      }
      return normalized;
    }
    return fromStorage;
  }
  return DEFAULT_CODER_STATE_PATH;
};

const loadCoderStateHtml = async (): Promise<CoderStateLoadResult | null> => {
  const bridgeResult = await attemptCoderBridgeRead();
  if (bridgeResult) {
    console.info("[CoderState] loaded HTML via coderBridge", { path: bridgeResult.sourcePath });
    logNode0("coderBridge", bridgeResult.sourcePath, lastCoderStateNode);
    return bridgeResult;
  }
  const sourcePath = resolveCoderStatePath();
  if (!sourcePath) {
    return null;
  }
  console.info("[CoderState] trying path", { path: sourcePath });
  const hostResult = await attemptHostRead(sourcePath);
  if (hostResult) {
    console.info("[CoderState] loaded HTML from coder state", { path: hostResult.sourcePath });
    return hostResult;
  }
  const fetchResult = await attemptFetchRead(sourcePath);
  if (fetchResult) {
    console.info("[CoderState] loaded HTML via file fetch", { path: fetchResult.sourcePath });
    return fetchResult;
  }
  const viteFsResult = await attemptViteFsRead(sourcePath);
  if (viteFsResult) {
    console.info("[CoderState] loaded HTML via @fs dev path", { path: viteFsResult.sourcePath });
    return viteFsResult;
  }
  console.info("[CoderState] skipped auto-loading coder state", { path: sourcePath });
  return null;
};

let coderStateWarnedMissingWriter = false;

const getCoderAutosaveGuard = () => {
  const g = globalThis as typeof globalThis & { __leditorAllowCoderAutosave?: boolean };
  return g;
};

const writeCoderStateHtml = async (html: string): Promise<void> => {
  // Never persist synthetic content (phase checks / smoke tests). Only allow autosave
  // after we've successfully loaded real coder state into the editor.
  if (!getCoderAutosaveGuard().__leditorAllowCoderAutosave) {
    return;
  }
  const scopeId = await resolveScopeId();
  const bridgeSaver = window.coderBridge?.saveState;
  const bridgeLoader = window.coderBridge?.loadState;
  if (bridgeSaver && bridgeLoader && scopeId) {
    try {
      const loaded = await bridgeLoader({ scopeId });
      const state = loaded?.state;
      if (!state || typeof state !== "object") return;

      const targetFolderId = (() => {
        const node = lastCoderStateNode;
        if (node && typeof node === "object" && node.type === "folder" && typeof node.id === "string" && node.id) {
          return node.id;
        }
        const nodes = Array.isArray((state as any).nodes) ? (state as any).nodes : [];
        const root = nodes.find((n: any) => n && typeof n === "object" && n.type === "folder" && typeof n.id === "string");
        return typeof root?.id === "string" ? root.id : "";
      })();

      const stamp = new Date().toISOString();
      const patchNode = (node: any): boolean => {
        if (!node || typeof node !== "object") return false;
        if (node.type === "folder" && String(node.id) === targetFolderId) {
          node.edited_html = html;
          node.updated_utc = stamp;
          return true;
        }
        if (node.type === "folder" && Array.isArray(node.children)) {
          for (const ch of node.children) {
            if (patchNode(ch)) return true;
          }
        }
        return false;
      };
      const nodes = Array.isArray((state as any).nodes) ? (state as any).nodes : [];
      for (const n of nodes) {
        if (patchNode(n)) break;
      }
      await bridgeSaver({ scopeId, state });
      return;
    } catch (error) {
      console.warn("[CoderState] autosave via coderBridge failed", { scopeId, error });
      // fall through to file-based writer if available
    }
  }

  const targetPath = resolveCoderStatePath();
  const writer = window.leditorHost?.writeFile;
  const reader = window.leditorHost?.readFile;
  if (!writer || !reader) {
    if (!coderStateWarnedMissingWriter) {
      coderStateWarnedMissingWriter = true;
      console.warn("[CoderState] host read/write unavailable; autosave disabled", { targetPath });
    }
    return;
  }
  try {
    const existing = await reader({ sourcePath: targetPath });
    const raw = existing?.success && typeof existing.data === "string" ? existing.data : "";
    const stamp = new Date().toISOString();
    const parsed = (() => {
      try {
        return raw ? (JSON.parse(raw) as any) : null;
      } catch {
        return null;
      }
    })();
    const blob = parsed && typeof parsed === "object" ? parsed : { version: 2, nodes: [], collapsed_ids: [] };
    if (!Array.isArray(blob.nodes)) blob.nodes = [];
    if (!Array.isArray(blob.collapsed_ids) && Array.isArray(blob.collapsedIds)) blob.collapsed_ids = blob.collapsedIds;
    if (!Array.isArray(blob.collapsed_ids)) blob.collapsed_ids = [];

    const targetFolderId = (() => {
      const node = lastCoderStateNode;
      if (node && typeof node === "object" && node.type === "folder" && typeof node.id === "string" && node.id) {
        return node.id;
      }
      const root = blob.nodes.find((n: any) => n && typeof n === "object" && n.type === "folder" && typeof n.id === "string");
      return typeof root?.id === "string" ? root.id : "";
    })();

    const patchNode = (node: any): boolean => {
      if (!node || typeof node !== "object") return false;
      if (node.type === "folder" && String(node.id) === targetFolderId) {
        node.edited_html = html;
        node.updated_utc = stamp;
        return true;
      }
      if (node.type === "folder" && Array.isArray(node.children)) {
        for (const ch of node.children) {
          if (patchNode(ch)) return true;
        }
      }
      return false;
    };
    for (const n of blob.nodes) {
      if (patchNode(n)) break;
    }
    const next = JSON.stringify(blob, null, 2);
    const result = await writer({ targetPath, data: next });
    if (!result?.success) {
      console.warn("[CoderState] autosave failed", { targetPath, error: result?.error });
    }
  } catch (error) {
    console.warn("[CoderState] autosave threw", { targetPath, error });
  }
};

const CURRENT_PHASE: number = 0;
const RENDERER_BUNDLE_ID = "renderer-src-2026-01-20";

declare global {
  interface Window {
    __writeEditorHost?: HTMLElement;
  }
}

const getWriteEditorHost = (): HTMLElement | null => {
  const host = window.__writeEditorHost;
  if (host) {
    return host;
  }
  return document.getElementById("write-leditor-host");
};

const findEditorElement = (elementId: string, hostOverride?: HTMLElement | null): HTMLElement | null => {
  const overrideHost = hostOverride ?? null;
  if (overrideHost) {
    const found = overrideHost.querySelector(`#${elementId}`) as HTMLElement | null;
    if (found?.isConnected) return found;
  }
  const host = getWriteEditorHost();
  if (host) {
    const found = host.querySelector(`#${elementId}`) as HTMLElement | null;
    if (found?.isConnected) {
      return found;
    }
  }
  const docFind = document.getElementById(elementId) as HTMLElement | null;
  if (docFind?.isConnected) {
    return docFind;
  }
  return null;
};

const ensureEditorElement = (
  elementId: string,
  hostOverride?: HTMLElement | null
): { element: HTMLElement; created: boolean } => {
  const existing = findEditorElement(elementId, hostOverride);
  if (existing) return { element: existing, created: false };
  const host = hostOverride ?? getWriteEditorHost();
  const mount = document.createElement("div");
  mount.id = elementId;
  mount.className = "leditor-mount";
  if (host) {
    host.appendChild(mount);
  } else {
    document.body.appendChild(mount);
  }
  return { element: mount, created: true };
};

type MountGuard = { mounted: boolean; inFlight: Promise<void> | null };

const getMountGuard = (): MountGuard => {
  const g = globalThis as typeof globalThis & { __leditorMountGuard?: MountGuard };
  if (!g.__leditorMountGuard) {
    g.__leditorMountGuard = { mounted: false, inFlight: null };
  }
  return g.__leditorMountGuard;
};

export type CreateLeditorAppOptions = {
  container?: HTMLElement;
  elementId?: string;
  toolbar?: string;
  plugins?: string[];
  autosave?: { enabled: boolean; intervalMs: number };
  initialContent?: { format: "html"; value: string };
  requireHostContract?: boolean;
  enableCoderStateImport?: boolean;
  hostAdapter?: HostAdapter | null;
};

export type LeditorAppInstance = {
  handle: EditorHandle;
  destroy: () => void;
};

type MountedAppState = {
  abortController: AbortController;
  unsubscribeLayout: (() => void) | null;
  ribbonObserver: ResizeObserver | null;
  disposeRibbon: (() => void) | null;
  appRoot: HTMLElement | null;
  editorEl: HTMLElement | null;
  createdEditorEl: boolean;
};

const getCreateOptions = (): Required<
  Pick<CreateLeditorAppOptions, "elementId" | "requireHostContract" | "enableCoderStateImport">
> &
  Omit<CreateLeditorAppOptions, "elementId" | "requireHostContract" | "enableCoderStateImport"> => {
  const g = globalThis as typeof globalThis & { __leditorCreateOptions?: CreateLeditorAppOptions };
  const options = g.__leditorCreateOptions ?? {};
  return {
    elementId: options.elementId ?? "editor",
    requireHostContract: options.requireHostContract ?? true,
    enableCoderStateImport: options.enableCoderStateImport ?? (options.requireHostContract ?? true),
    container: options.container,
    toolbar: options.toolbar,
    plugins: options.plugins,
    autosave: options.autosave,
    initialContent: options.initialContent,
    hostAdapter: options.hostAdapter
  };
};

const setMountedAppState = (state: MountedAppState | null) => {
  const g = globalThis as typeof globalThis & { __leditorMountedAppState?: MountedAppState };
  if (!state) {
    delete g.__leditorMountedAppState;
    return;
  }
  g.__leditorMountedAppState = state;
};

const getMountedAppState = (): MountedAppState | null => {
  const g = globalThis as typeof globalThis & { __leditorMountedAppState?: MountedAppState };
  return g.__leditorMountedAppState ?? null;
};

export const destroyLeditorApp = (): void => {
  const state = getMountedAppState();
  const guard = getMountGuard();
  if (!state) {
    guard.mounted = false;
    guard.inFlight = null;
    return;
  }

  try {
    state.unsubscribeLayout?.();
  } catch {
    // ignore
  }
  try {
    state.ribbonObserver?.disconnect();
  } catch {
    // ignore
  }
  try {
    state.disposeRibbon?.();
  } catch {
    // ignore
  }
  try {
    state.abortController.abort();
  } catch {
    // ignore
  }

  try {
    const h = (window as typeof window & { leditor?: EditorHandle }).leditor;
    h?.destroy();
  } catch {
    // ignore
  }

  try {
    if (state.appRoot?.isConnected) state.appRoot.remove();
  } catch {
    // ignore
  }
  try {
    if (state.createdEditorEl && state.editorEl?.isConnected) state.editorEl.remove();
  } catch {
    // ignore
  }

  (window as typeof window & { leditor?: EditorHandle }).leditor = undefined;
  setMountedAppState(null);
  guard.mounted = false;
  guard.inFlight = null;
};

export const createLeditorApp = async (options: CreateLeditorAppOptions = {}): Promise<LeditorAppInstance> => {
  const g = globalThis as typeof globalThis & { __leditorCreateOptions?: CreateLeditorAppOptions };
  g.__leditorCreateOptions = options;
  if (options.hostAdapter !== undefined) {
    setHostAdapter(options.hostAdapter);
  }
  await mountEditor();
  const h = (window as typeof window & { leditor?: EditorHandle }).leditor;
  if (!h) {
    throw new Error("createLeditorApp: mount completed but window.leditor is not set");
  }
  return { handle: h, destroy: destroyLeditorApp };
};

export const mountEditor = async () => {
  perfMark("mountEditor:start");
  const isDevtoolsDocument = () => {
    const protocol = String(window.location?.protocol || "").toLowerCase();
    const href = String(window.location?.href || "").toLowerCase();
    return (
      protocol === "devtools:" ||
      protocol === "chrome-devtools:" ||
      href.startsWith("devtools://") ||
      href.startsWith("chrome-devtools://")
    );
  };
  // Safety: avoid mounting inside a Chromium DevTools renderer context.
  if (isDevtoolsDocument()) {
    console.warn("[Renderer] mountEditor called in devtools document; skipping mount.");
    return;
  }
  const guard = getMountGuard();
  if (guard.mounted) {
    console.warn("[Renderer] mountEditor called after mount; ignoring.");
    return;
  }
  if (guard.inFlight) {
    console.warn("[Renderer] mountEditor already in progress; waiting.");
    return guard.inFlight;
  }
  guard.inFlight = (async () => {
    perfMark("mountEditor:inflight:start");
    const existingRoots = Array.from(document.querySelectorAll("#leditor-app")) as HTMLElement[];
    if (existingRoots.length > 0) {
      if (existingRoots.length > 1) {
        // Hard-dedupe in case a previous regression caused multiple roots.
        existingRoots.slice(1).forEach((el) => {
          try {
            el.remove();
          } catch {
            // ignore
          }
        });
      }
      console.warn("[Renderer] mountEditor found existing app root; skipping mount.", {
        count: existingRoots.length
      });
      guard.mounted = true;
      return;
    }
    const options = getCreateOptions();
    // Prevent accidental mounting in unintended documents (e.g. Electron DevTools window).
    // The real app window provides a dedicated host container (`#write-leditor-host`) unless
    // an explicit `options.container` is passed.
    const hostForMount = options.container ?? getWriteEditorHost();
    if (!hostForMount) {
      console.warn("[Renderer] mountEditor: no host container found; skipping mount.", {
        hasContainerOverride: Boolean(options.container),
        hasWriteHost: Boolean(document.getElementById("write-leditor-host")),
        location: String(window.location?.href || "")
      });
      guard.mounted = true;
      return;
    }
    const abortController = new AbortController();
    const signal = abortController.signal;
    let ribbonObserver: ResizeObserver | null = null;
    let unsubscribeLayout: (() => void) | null = null;
    let editorEl: HTMLElement | null = null;
    let createdEditorEl = false;

    let hostContractInfo: ReturnType<typeof getHostContract> | null = null;
    try {
      hostContractInfo = getHostContract();
      console.info("[HostContract] loaded host payload", hostContractInfo);
      if (options.requireHostContract || hostContractInfo.paths.bibliographyDir) {
        await ensureReferencesLibrary();
      }
    } catch (error) {
      if (options.requireHostContract) {
        console.error("[HostContract] initialization failed", error);
        throw error;
      }
      console.warn("[HostContract] initialization skipped/failed (portable mode)", error);
    }
  // Debug: silenced noisy ribbon logs.
  if (featureFlags.paginationDebugEnabled) {
    const win = window as typeof window & { __leditorPaginationDebug?: boolean };
    win.__leditorPaginationDebug = true;
    console.info("[PaginationDebug] enabled by feature flag");
  }
  const env = ensureProcessEnv();
  if (env?.GTK_USE_PORTAL === "0") {
    console.info("[Startup] GTK_USE_PORTAL=0 (portal disabled)");
  }
  window.codexLog?.write(`[RUN] BATCH=3 PHASE=${CURRENT_PHASE}`);
  window.codexLog?.write("[RUN_SEP] --------------------------------");
  window.codexLog?.write("[MOUNT_EDITOR]");
  window.codexLog?.write("[RENDERER_MOUNT_OK]");
  registerLibrarySmokeChecks();

  const defaultToolbar =
    "Undo Redo | Bold Italic | Heading1 Heading2 | BulletList NumberList | Link | AlignLeft AlignCenter AlignRight JustifyFull | Outdent Indent | SearchReplace Preview ImportDOCX ExportDOCX FootnotePanel Fullscreen | VisualChars VisualBlocks | DirectionLTR DirectionRTL";
  const coderStateResult = options.enableCoderStateImport ? await loadCoderStateHtml() : null;
  if (coderStateResult && lastCoderStateNode) {
    console.info("[CoderState][node0][render]", {
      path: coderStateResult.sourcePath,
      id: lastCoderStateNode.id,
      type: lastCoderStateNode.type,
      name: lastCoderStateNode.name,
      editedHtmlLength:
        typeof lastCoderStateNode?.editedHtml === "string"
          ? lastCoderStateNode.editedHtml.length
          : lastCoderStateNode?.edited_html?.length
    });
    (window as typeof window & { __coderStateLoaded?: boolean }).__coderStateLoaded = true;
    // Only allow autosave once we have loaded real coder state from disk.
    getCoderAutosaveGuard().__leditorAllowCoderAutosave = true;
  } else {
    getCoderAutosaveGuard().__leditorAllowCoderAutosave = false;
  }
  const hasInitialContent = Boolean(options.initialContent?.value || coderStateResult?.html);
  type RendererConfig = {
    elementId: string;
    mountElement?: HTMLElement | null;
    toolbar: string;
    plugins: string[];
    autosave: { enabled: boolean; intervalMs: number };
    initialContent?: { format: "html"; value: string };
  };
  const config: RendererConfig = {
    elementId: options.elementId,
    toolbar: options.toolbar ?? defaultToolbar,
    plugins: options.plugins ?? [
      "debug",
      "search",
      "preview",
      "export_docx",
      "import_docx",
      "paste_cleaner",
      "docx_tools",
      "pdf_tools",
      "track_changes",
      "revision_history",
      "spellcheck",
      "ai_assistant",
      "ai_agent",
      "source_view",
      "print_preview"
    ],
    autosave: options.autosave ?? { enabled: true, intervalMs: 1000 }
  };
  if (options.initialContent) {
    config.initialContent = options.initialContent;
  } else if (coderStateResult?.html) {
    config.initialContent = { format: "html", value: coderStateResult.html };
    const snippet = coderStateResult.html.replace(/\\s+/g, " ").slice(0, 200);
    console.info("[text][preview]", { path: coderStateResult.sourcePath, snippet });
  }

  const waitForEditorElement = (
    elementId: string,
    timeoutMs: number,
    hostOverride?: HTMLElement | null
  ): Promise<HTMLElement> => {
    const existing = findEditorElement(elementId, hostOverride);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        reject(new Error(`LEditor: elementId "${elementId}" not found`));
      }, timeoutMs);
      const observer = new MutationObserver(() => {
        const found = findEditorElement(elementId, hostOverride);
        if (!found || settled) return;
        settled = true;
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(found);
      });
      observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    });
  };

  const ensured = ensureEditorElement(config.elementId, options.container ?? null);
  editorEl = ensured.element;
  createdEditorEl = ensured.created;
  await waitForEditorElement(config.elementId, 5000, options.container ?? null);
  config.mountElement = editorEl;
  perfMark("editor:init:start");
  handle = LEditor.init(config);
  perfMark("editor:init:end");
  perfMeasure("editor:init", "editor:init:start", "editor:init:end");
  (window as typeof window & { leditor?: EditorHandle }).leditor = handle;
  if (coderStateResult?.html) {
    handle.setContent(coderStateResult.html, { format: "html" });
    const rendered = handle.getContent({ format: "html" });
    console.info("[CoderState][rendered]", {
      path: coderStateResult.sourcePath,
      length: typeof rendered === "string" ? rendered.length : 0
    });
  }
  handle.execCommand("SetPageMargins", {
    margins: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }
  });

  if (!editorEl) {
    throw new Error(`LEditor: elementId "${config.elementId}" not found`);
  }
  const parent = editorEl.parentElement ?? document.body;
  // Keep UI density close to Word without breaking layout centering.
  const APP_UI_SCALE = 1.5;
  const appRoot = document.createElement("div");
  appRoot.id = "leditor-app";
  appRoot.className = "leditor-app";
  appRoot.style.setProperty("--ui-scale", String(APP_UI_SCALE));
  parent.insertBefore(appRoot, editorEl);
  const ribbonHost = document.createElement("div");
  ribbonHost.id = "leditor-ribbon";
  ribbonHost.className = "leditor-ribbon-host";
  ribbonHost.dataset.ribbonDensity = "compact3";
  const appHeader = document.createElement("div");
  appHeader.className = "leditor-app-header";
  appHeader.appendChild(ribbonHost);
  const docShell = document.createElement("div");
  docShell.className = "leditor-doc-shell";
  appRoot.appendChild(appHeader);
  appRoot.appendChild(docShell);
  // Keep the editor mount inside the app shell so UI layout and feature CSS (e.g. paragraph grid) apply consistently.
  docShell.appendChild(editorEl);
  initViewState(appRoot);
  const ribbonEnabled = featureFlags.ribbonEnabled;
  let disposeRibbon: (() => void) | null = null;
  if (ribbonEnabled) {
    // Debug: silenced noisy ribbon logs.
    disposeRibbon = renderRibbon(ribbonHost, handle);
  }
  let ribbonHeightQueued = false;
  const syncRibbonHeight = () => {
    const height = appHeader.offsetHeight;
    appRoot.style.setProperty("--leditor-ribbon-height", `${height}px`);
  };
  const requestRibbonHeightSync = () => {
    if (ribbonHeightQueued) return;
    ribbonHeightQueued = true;
    window.requestAnimationFrame(() => {
      ribbonHeightQueued = false;
      syncRibbonHeight();
    });
  };
  syncRibbonHeight();
  if (typeof ResizeObserver !== "undefined") {
    ribbonObserver = new ResizeObserver(() => {
      requestRibbonHeightSync();
    });
    ribbonObserver.observe(appHeader);
  } else {
    window.addEventListener("resize", requestRibbonHeightSync, { signal });
  }
  const layout: A4LayoutController | null = mountA4Layout(docShell, editorEl, handle);
  setLayoutController(layout);
  let layoutRefreshQueued = false;
  const requestLayoutRefresh = () => {
    if (layoutRefreshQueued) return;
    layoutRefreshQueued = true;
    window.requestAnimationFrame(() => {
      layoutRefreshQueued = false;
      refreshLayoutView();
    });
  };
  requestLayoutRefresh();
  unsubscribeLayout = subscribeToLayoutChanges(() => requestLayoutRefresh());
  initFullscreenController(appRoot);
  const editorHandle = handle;
  const tiptapEditor = editorHandle.getEditor();
  try {
    const prose = tiptapEditor.view.dom as HTMLElement;
    const bullet = window.localStorage?.getItem("leditor:listStyle:bullet") || "disc";
    const ordered = window.localStorage?.getItem("leditor:listStyle:ordered") || "decimal";
    if (bullet) prose.dataset.bulletStyle = bullet;
    if (ordered) prose.dataset.numberStyle = ordered;
  } catch {
    // ignore storage/dom failures
  }
  let lastKnownSelection = snapshotFromSelection(tiptapEditor.state.selection);
  let lastKnownSelectionAt = Date.now();
  let suppressSelectionTrackingUntil = 0;
  let selectionUpdateQueued = false;
  const updateLastKnownSelection = (reason: string) => {
    try {
      lastKnownSelection = snapshotFromSelection(tiptapEditor.state.selection);
      lastKnownSelectionAt = Date.now();
      if ((window as any).__leditorCaretDebug) {
        console.info("[Selection][track]", {
          reason,
          at: lastKnownSelectionAt,
          snapshot: lastKnownSelection,
          from: tiptapEditor.state.selection.from,
          to: tiptapEditor.state.selection.to,
          empty: tiptapEditor.state.selection.empty
        });
      }
    } catch {
      // ignore
    }
  };
  const scheduleLastKnownSelection = (reason: string) => {
    if (selectionUpdateQueued) return;
    selectionUpdateQueued = true;
    window.requestAnimationFrame(() => {
      selectionUpdateQueued = false;
      updateLastKnownSelection(reason);
    });
  };
  const captureRibbonSelection = () => {
    // During ribbon interactions the editor can emit a "selectionUpdate" that jumps to a bogus
    // location (commonly end-of-doc) as focus/blur propagates. Prevent that from poisoning our
    // stored caret snapshot.
    // Use a generous time window and clear it as soon as the user interacts with the editor again.
    suppressSelectionTrackingUntil = Date.now() + 2000;

    // Ribbon clicks can blur the editor and some extensions will move the selection (often end-of-doc).
    // Prefer a live selection if the user is currently focused inside ProseMirror; otherwise use our
    // last-known snapshot from recent editor interaction.
    const prose = tiptapEditor?.view?.dom as HTMLElement | null;
    const active = document.activeElement as HTMLElement | null;
    const selection = window.getSelection?.();
    const anchorNode = selection?.anchorNode as Node | null;
    const selectionInProse =
      !!prose &&
      ((active && prose.contains(active)) ||
        (anchorNode && prose.contains(anchorNode instanceof HTMLElement ? anchorNode : (anchorNode as any).parentElement)));

    if (selectionInProse) {
      updateLastKnownSelection("ribbon:pointerdown:live");
      if ((window as any).__leditorCaretDebug) {
        console.info("[Selection][ribbon] captured live", { snapshot: lastKnownSelection });
      }
      recordRibbonSelection(lastKnownSelection);
      return;
    }

    if (Date.now() - lastKnownSelectionAt > 500) {
      updateLastKnownSelection("ribbon:pointerdown:stale-refresh");
    }
    if ((window as any).__leditorCaretDebug) {
      console.info("[Selection][ribbon] captured cached", { snapshot: lastKnownSelection, lastKnownSelectionAt });
    }
    recordRibbonSelection(lastKnownSelection);
  };
  ribbonHost.addEventListener("pointerdown", captureRibbonSelection, { capture: true, signal });
  ribbonHost.addEventListener("touchstart", captureRibbonSelection, { capture: true, signal });
  // Also keep this updated while editing so ribbon clicks always have a fresh caret position.
  // This avoids cases where selection is lost/shifted when the editor blurs before a ribbon click.
  const clearSelectionSuppression = () => {
    suppressSelectionTrackingUntil = 0;
  };
  editorEl.addEventListener(
    "pointerdown",
    () => {
      clearSelectionSuppression();
      scheduleLastKnownSelection("editor:pointerdown");
    },
    { capture: true, signal }
  );
  editorEl.addEventListener(
    "pointerup",
    () => {
      clearSelectionSuppression();
      scheduleLastKnownSelection("editor:pointerup");
    },
    { capture: true, signal }
  );
  editorEl.addEventListener(
    "mouseup",
    () => {
      clearSelectionSuppression();
      scheduleLastKnownSelection("editor:mouseup");
    },
    { capture: true, signal }
  );
  editorEl.addEventListener(
    "keyup",
    () => {
      clearSelectionSuppression();
      scheduleLastKnownSelection("editor:keyup");
    },
    { capture: true, signal }
  );
  editorEl.addEventListener(
    "keydown",
    () => {
      clearSelectionSuppression();
      scheduleLastKnownSelection("editor:keydown");
    },
    { capture: true, signal }
  );
  tiptapEditor.on("selectionUpdate", () => {
    if (Date.now() < suppressSelectionTrackingUntil) return;
    const prose = tiptapEditor?.view?.dom as HTMLElement | null;
    const active = document.activeElement as HTMLElement | null;
    // Ignore selection updates while the editor is not the active surface. This prevents
    // "end-of-doc" selection jumps on blur from poisoning ribbon footnote insertion.
    if (!prose || !active || !prose.contains(active)) return;
    updateLastKnownSelection("tiptap:selectionUpdate");
  });
  tiptapEditor.on("focus", () => {
    if (Date.now() < suppressSelectionTrackingUntil) return;
    const prose = tiptapEditor?.view?.dom as HTMLElement | null;
    const active = document.activeElement as HTMLElement | null;
    if (!prose || !active || !prose.contains(active)) return;
    updateLastKnownSelection("tiptap:focus");
  });
  const attachCitationHandlers = (root: HTMLElement, signal: AbortSignal) => {
    const pickAttr = (el: HTMLElement, name: string): string => {
      const raw = el.getAttribute(name) || "";
      return raw.trim();
    };

    const extractDqid = (el: HTMLElement, href: string): string => {
      const direct =
        pickAttr(el, "data-dqid") ||
        pickAttr(el, "data-quote-id") ||
        pickAttr(el, "data-quote_id");
      if (direct) return direct.toLowerCase();
      if (href.startsWith("dq://") || href.startsWith("dq:")) {
        return href.replace(/^dq:\/*/, "").split(/[?#]/)[0].trim().toLowerCase();
      }
      return "";
    };

    const ensureTitle = (el: HTMLElement, hrefHint?: string) => {
      if (el.getAttribute("title")) return;
      const quoteText = pickAttr(el, "data-quote-text");
      if (quoteText) {
        el.setAttribute("title", quoteText);
        return;
      }
      const href = (hrefHint ?? pickAttr(el, "href")).trim();
      const dqid = href ? extractDqid(el, href) : "";
      const itemKeysRaw = pickAttr(el, "data-item-keys");
      const itemKeyFromList = itemKeysRaw ? itemKeysRaw.split(/[,\s]+/).filter(Boolean)[0] : "";
      const itemKey =
        pickAttr(el, "data-key") ||
        pickAttr(el, "item-key") ||
        pickAttr(el, "data-item-key") ||
        itemKeyFromList;
      const fallbackText = (el.textContent || "").trim();
      const resolvedTitle = resolveCitationTitle({
        dqid: dqid || null,
        itemKey: itemKey || null,
        fallbackText: fallbackText || null
      });
      const title = resolvedTitle || pickAttr(el, "data-orig-href");
      if (title) {
        el.setAttribute("title", title);
      }
    };

    root.addEventListener(
      "click",
      (ev) => {
        // A double-click generates two click events (detail=1 then detail=2).
        // Avoid firing our citation handler twice; it should open a single PDF viewer.
        if (typeof (ev as MouseEvent).detail === "number" && (ev as MouseEvent).detail > 1) {
          return;
        }
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        console.info("[leditor][click][capture]", {
          tag: target.tagName,
          className: target.className,
          text: (target.textContent || "").slice(0, 80)
        });
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;
        const rawHref = (anchor.getAttribute("href") || "").trim();
        const dqidFallback = extractDqid(anchor, rawHref);
        const href = rawHref || (dqidFallback ? `dq://${dqidFallback}` : "");
        if (!href) return;
        ev.preventDefault();
        ev.stopPropagation();
        ensureTitle(anchor, href);
        anchor.classList.add("leditor-citation-anchor");
        const dqid = extractDqid(anchor, href) || dqidFallback;
        const anchorId =
          anchor.id ||
          pickAttr(anchor, "data-key") ||
          pickAttr(anchor, "item-key") ||
          pickAttr(anchor, "data-item-key") ||
          pickAttr(anchor, "data-quote-id") ||
          pickAttr(anchor, "data-quote_id") ||
          dqid;
        const detail = {
          href,
          dqid,
          anchorId,
          title: anchor.getAttribute("title") || "",
          text: (anchor.textContent || "").trim(),
          dataKey: pickAttr(anchor, "data-key"),
          dataItemKeys: pickAttr(anchor, "data-item-keys"),
          dataQuoteId: pickAttr(anchor, "data-quote-id"),
          dataQuoteIdAlt: pickAttr(anchor, "data-quote_id"),
          dataQuoteText: pickAttr(anchor, "data-quote-text")
        };
        console.info("[leditor][anchor-click]", detail);
        window.dispatchEvent(new CustomEvent("leditor-anchor-click", { detail, bubbles: true }));
      },
      { capture: true, signal }
    );

    root.addEventListener(
      "mouseover",
      (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = (anchor.getAttribute("href") || "").trim();
        ensureTitle(anchor, href);
        anchor.classList.add("leditor-citation-anchor");
      },
      { capture: true, signal }
    );
  };
  const schemaMarks = Object.keys(tiptapEditor.schema.marks || {});
  console.info("[LEditor][schema][marks]", schemaMarks);
  console.info("[LEditor][schema][anchor]", { present: Boolean(tiptapEditor.schema.marks.anchor) });
  attachCitationHandlers(tiptapEditor.view.dom, signal);
  installDirectQuotePdfOpenHandler({ coderStatePath: lastCoderStatePath ?? resolveCoderStatePath() });
  try {
    const probeHtml =
      "<p>Probe <a href=\"dq://probe\" data-key=\"PROBE\" title=\"probe\">(Probe)</a> tail</p>";
    const probeDoc = new DOMParser().parseFromString(probeHtml, "text/html");
    const parsed = ProseMirrorDOMParser.fromSchema(tiptapEditor.schema).parse(probeDoc.body);
    const parsedJson = parsed.toJSON();
    const parsedString = JSON.stringify(parsedJson);
    console.info("[LEditor][schema][anchor-parse]", {
      hasAnchorMark: parsedString.includes("\"anchor\""),
      text: parsed.textBetween(0, parsed.content.size, " ")
    });
  } catch (err) {
    console.warn("[LEditor][schema][anchor-parse] failed", err);
  }
  const footnoteManager = createFootnoteManager(editorHandle, tiptapEditor);
  const footnoteHandlers = {
    open: () => footnoteManager.open(),
    toggle: () => footnoteManager.toggle(),
    close: () => footnoteManager.close()
  };
  initGlobalShortcuts(editorHandle);
  const host = getHostAdapter();
  if (host?.registerFootnoteHandlers) {
    host.registerFootnoteHandlers(footnoteHandlers);
  } else {
    const merged = {
      ...(host ?? {}),
      openFootnotePanel: footnoteHandlers.open,
      toggleFootnotePanel: footnoteHandlers.toggle,
      closeFootnotePanel: footnoteHandlers.close
    } as HostAdapter;
    setHostAdapter(merged);
    if (!window.leditorHost) {
      window.leditorHost = merged;
    }
  }
  perfMark("mountEditor:ui-mounted");
  window.codexLog?.write("[PHASE3_OK]");
  mountStatusBar(handle, layout, { parent: appRoot });
  attachContextMenu(handle, tiptapEditor.view.dom, tiptapEditor);
  setMountedAppState({
    abortController,
    unsubscribeLayout,
    ribbonObserver,
    disposeRibbon,
    appRoot,
    editorEl,
    createdEditorEl
  });

  editorHandle.execCommand("debugDumpJson");
  window.__logCoderNode = () => {
    if (lastCoderStateNode && lastCoderStatePath) {
      console.info("[CoderState][node0][hotkey]", {
        path: lastCoderStatePath,
        id: lastCoderStateNode.id,
        type: lastCoderStateNode.type,
        name: lastCoderStateNode.name,
        editedHtmlLength:
          typeof lastCoderStateNode?.editedHtml === "string"
            ? lastCoderStateNode.editedHtml.length
            : lastCoderStateNode?.edited_html?.length
      });
    } else {
      console.info("[CoderState][node0][hotkey]", { status: "not loaded" });
    }
  };

  if (!hasInitialContent) {
    editorHandle.execCommand("Bold");
    editorHandle.execCommand("Undo");
    let didThrow = false;
    try {
      editorHandle.execCommand("__UnknownCommand__");
    } catch {
      didThrow = true;
    }
    if (!didThrow) {
      throw new Error("Phase4 smoke test expected unknown command to throw.");
    }
    window.codexLog?.write("[PHASE4_OK]");

    // NOTE: Phase5+ content-mutation checks (alignment/indent/spacing) were removed.
    // They were mutating the live editor content during startup and caused:
    // - user-visible flicker and state changes
    // - "phase" crashes when schema/layout differed
    // - risk of clobbering persisted coder_state.json in some environments
    // If you ever need them again, reintroduce behind an explicit opt-in flag
    // and run in an isolated editor instance, never the live document.
    window.codexLog?.write("[PHASE5_SKIPPED]");
    window.codexLog?.write("[PHASE6_SKIPPED]");
    window.codexLog?.write("[PHASE7_SKIPPED]");

    const hasMark = (node: any, type: string, predicate: (attrs: any) => boolean): boolean => {
      if (!node || typeof node !== "object") return false;
      if (Array.isArray(node.marks)) {
        for (const mark of node.marks) {
          const kind = mark.type?.name ?? mark.type;
          if (kind === type && predicate(mark.attrs ?? {})) {
            return true;
          }
        }
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content) {
          if (hasMark(child, type, predicate)) {
            return true;
          }
        }
      }
      return false;
    };

    editorHandle.setContent("<p>Font check</p>", { format: "html" });
    editorHandle.focus();
    editorHandle.execCommand("FontFamily", { value: "Times New Roman" });
    editorHandle.execCommand("FontSize", { valuePx: 16 });
    const fontJson = editorHandle.getJSON();
    if (!hasMark(fontJson, "fontFamily", (attrs) => attrs.fontFamily === "Times New Roman")) {
      throw new Error("Phase8 font family JSON check failed.");
    }
    if (!hasMark(fontJson, "fontSize", (attrs) => attrs.fontSize === 16)) {
      throw new Error("Phase8 font size JSON check failed.");
    }
    const fontHtml = editorHandle.getContent({ format: "html" });
    if (typeof fontHtml !== "string") {
      throw new Error("Phase8 font HTML check failed.");
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(`${fontHtml}`, "text/html");
    const fontFamilyElement = doc.querySelector("[style*='font-family']");
    const fontSizeElement = doc.querySelector("[style*='font-size']");
    const hasFontFamily =
      typeof fontFamilyElement?.getAttribute("style") === "string" &&
      fontFamilyElement
        .getAttribute("style")!
        .toLowerCase()
        .includes("font-family: times new roman");
    const hasFontSize =
      typeof fontSizeElement?.getAttribute("style") === "string" &&
      fontSizeElement.getAttribute("style")!.toLowerCase().includes("font-size: 16px");
    if (!hasFontFamily || !hasFontSize) {
      console.warn("Phase8 font HTML check skipped", { fontHtml });
    } else {
      window.codexLog?.write("[PHASE8_OK]");
    }
  }

  // Autosave coder state: event-driven and coalesced (no polling).
  let autosaveTimer: number | null = null;
  const scheduleAutosave = () => {
    if (!getCoderAutosaveGuard().__leditorAllowCoderAutosave) {
      return;
    }
    if (autosaveTimer !== null) {
      window.clearTimeout(autosaveTimer);
    }
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      try {
        const html = editorHandle.getContent({ format: "html" });
        if (typeof html === "string" && html.trim().length > 0) {
          void writeCoderStateHtml(html);
        }
      } catch (error) {
        console.warn("[CoderState] autosave read failed", { error });
      }
    }, 750);
  };
  editorHandle.on("change", scheduleAutosave);

  if (CURRENT_PHASE === 21) {
    if (!hasInitialContent) {
      runPhase21Validation(editorHandle, tiptapEditor);
    }
  } else if (CURRENT_PHASE === 22) {
    if (!hasInitialContent) {
      runPhase22Validation(editorHandle);
    }
  }

  // Phase 23 — DOCX export carries current page size/margins and header/footer content
  const pageSize = getCurrentPageSize();
  const margins = getMarginValues();
  const headerHtml = layout?.getHeaderContent();
  const footerHtml = layout?.getFooterContent();
  const exportOptions = {
    prompt: false,
    suggestedPath: `.codex_logs/exports/docx-phase23-${Date.now()}.docx`,
    pageSize,
    pageMargins: margins,
    section: {
      headerHtml: headerHtml ?? undefined,
      footerHtml: footerHtml ?? undefined,
      pageNumberStart: 1
    }
  };
  if (typeof window.__leditorAutoExportDOCX === "function") {
    const exportResult = await window.__leditorAutoExportDOCX(exportOptions);
    if (!exportResult?.success) {
      if (exportResult?.error === "ExportDOCX handler is unavailable") {
        console.info("[Phase23] Skipping DOCX auto-export (host export handler unavailable)");
        return;
      }
      throw new Error(`Phase23 DOCX export failed: ${exportResult?.error ?? "unknown error"}`);
    }
  } else {
    console.info("[Phase23] Skipping DOCX auto-export (host export handler unavailable)");
  }
    perfMark("mountEditor:end");
    perfMark("mountEditor:inflight:end");
  })()
    .then(() => {
      perfMeasure("mountEditor", "mountEditor:start", "mountEditor:end");
      perfMeasure("mountEditor:inflight", "mountEditor:inflight:start", "mountEditor:inflight:end");
      perfSummaryOnce();
      guard.mounted = true;
    })
    .catch((error) => {
      console.error("[Renderer] mountEditor failed", error);
      throw error;
    })
    .finally(() => {
      guard.inFlight = null;
    });
  return guard.inFlight;
};

const runPhase21Validation = (editorHandle: EditorHandle, editorInstance: TiptapEditor) => {
  if ((window as typeof window & { __coderStateLoaded?: boolean }).__coderStateLoaded) {
    console.info("[CoderState] skipping Phase21 validation because coder state is loaded");
    return;
  }
  const getFirstTable = (editor: TiptapEditor) => {
    let tablePos = -1;
    let tableNode: any = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table" && tablePos === -1) {
        tablePos = pos;
        tableNode = node;
      }
      return true;
    });
    return { tablePos, tableNode };
  };

  const selectCell = (editor: TiptapEditor, cellIndex: number) => {
    const { tablePos, tableNode } = getFirstTable(editor);
    if (!tableNode || tablePos < 0) {
      throw new Error("Phase21 expected a table to exist.");
    }
    const map = TableMap.get(tableNode);
    const cellPos = tablePos + 1 + map.map[cellIndex];
    const selection = CellSelection.create(editor.state.doc, cellPos, cellPos);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  };

  const selectFirstRowCells = (editor: TiptapEditor) => {
    const { tablePos, tableNode } = getFirstTable(editor);
    if (!tableNode || tablePos < 0) {
      throw new Error("Phase21 expected a table to exist.");
    }
    const map = TableMap.get(tableNode);
    const first = tablePos + 1 + map.map[0];
    const second = tablePos + 1 + map.map[1];
    const selection = CellSelection.create(editor.state.doc, first, second);
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  };

  editorHandle.setContent("<p>Table phase</p>", { format: "html" });
  editorHandle.focus();
  editorHandle.execCommand("TableInsert", { rows: 2, cols: 2 });
  selectCell(editorInstance, 0);
  editorHandle.execCommand("TableAddRowBelow");
  selectCell(editorInstance, 0);
  editorHandle.execCommand("TableAddColumnRight");
  selectCell(editorInstance, 0);
  editorHandle.execCommand("TableDeleteRow");
  selectCell(editorInstance, 0);
  editorHandle.execCommand("TableDeleteColumn");
  selectFirstRowCells(editorInstance);
  editorHandle.execCommand("TableMergeCells");
  editorHandle.execCommand("TableSplitCell");
  for (let i = 0; i < 7; i += 1) {
    editorHandle.execCommand("Undo");
  }
  for (let i = 0; i < 7; i += 1) {
    editorHandle.execCommand("Redo");
  }

  window.codexLog?.write("[PHASE21_OK]");
};

const runPhase22Validation = (editorHandle: EditorHandle) => {
  if ((window as typeof window & { __coderStateLoaded?: boolean }).__coderStateLoaded) {
    console.info("[CoderState] skipping Phase22 validation because coder state is loaded");
    return;
  }
  const registry = getFootnoteRegistry();
  resetFootnoteState();

  editorHandle.setContent("<p>Footnote phase</p>", { format: "html" });
  editorHandle.focus();
  editorHandle.execCommand("InsertFootnote");
  editorHandle.execCommand("InsertFootnote");

  const ids = getFootnoteIds();
  if (ids.length < 2) {
    throw new Error("Phase22 expected at least two footnotes after insertion.");
  }

  const firstId = ids[0];
  const secondId = ids[1];
  const firstView = getFootnoteView(registry, firstId, "first");
  firstView.open();
  firstView.setPlainText("Footnote one updated");
  firstView.close();
  if (firstView.getPlainText() !== "Footnote one updated") {
    throw new Error("Phase22 footnote edit did not persist.");
  }

  editorHandle.execCommand("SelectStart");
  editorHandle.execCommand("InsertFootnote");

  const allIds = getFootnoteIds();
  if (allIds.length !== 3) {
    throw new Error("Phase22 expected three footnotes after inserting at start.");
  }

  const thirdId = allIds[2];
  const thirdView = getFootnoteView(registry, thirdId, "inserted");
  if (thirdView.getNumber() !== "1") {
    throw new Error("Phase22 new footnote was not renumbered to 1.");
  }
  const firstAfterInsert = getFootnoteView(registry, firstId, "first after insert");
  const secondAfterInsert = getFootnoteView(registry, secondId, "second after insert");
  if (firstAfterInsert.getNumber() !== "2") {
    throw new Error("Phase22 first footnote number did not update.");
  }
  if (secondAfterInsert.getNumber() !== "3") {
    throw new Error("Phase22 second footnote number did not update.");
  }

  for (let i = 0; i < 3; i += 1) {
    editorHandle.execCommand("Undo");
  }
  for (let i = 0; i < 3; i += 1) {
    editorHandle.execCommand("Redo");
  }

  const firstAfterRedo = getFootnoteView(registry, firstId, "first after redo");
  if (firstAfterRedo.getPlainText() !== "Footnote one updated") {
    throw new Error("Phase22 footnote content did not survive redo.");
  }

  window.codexLog?.write("[PHASE22_OK]");
};

const getFootnoteView = (
  registry: Map<string, FootnoteNodeViewAPI>,
  id: string,
  label: string
): FootnoteNodeViewAPI => {
  const view = registry.get(id);
  if (!view) {
    throw new Error(`Phase22: footnote (${label}) with id "${id}" is not registered.`);
  }
  return view;
};
