import { LEditor, type EditorHandle } from "../api/leditor.ts";
import { recordRibbonSelection, snapshotFromSelection } from "../utils/selection_snapshot.ts";
import "../extensions/plugin_search.ts";
import "../extensions/plugin_preview.ts";
import "../extensions/plugin_source_view.ts";
import "../extensions/plugin_export_docx.ts";
import "../extensions/plugin_import_docx.ts";
import "../extensions/plugin_export_ledoc.ts";
import "../extensions/plugin_import_ledoc.ts";
import { renderRibbon } from "./ribbon.ts";
import { assertRibbonIconKeysExist } from "./ribbon_icons.ts";
import { mountStatusBar } from "../ui/status_bar.ts";
import { attachContextMenu } from "./context_menu.ts";
import { initFullscreenController } from "./fullscreen.ts";
import { featureFlags } from "../ui/feature_flags.ts";
import { initGlobalShortcuts } from "./shortcuts.ts";
import { debugInfo, debugWarn } from "../utils/debug.ts";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-serif-4/600.css";
import "./theme.css";
import "./ribbon.css";
import "./home.css";
import "./style_mini_app.css";
import "./agent_sidebar.css";
import "./agent_fab.css";
import "./ai_settings.css";
import "./paragraph_grid.css";
import "./ai_draft_preview.css";
import "./ai_draft_rail.css";
import "./feedback_hub.css";
import "./source_check_badges.css";
import "./source_check_rail.css";
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

import { getCurrentPageSize, getMarginValues } from "../ui/layout_settings.ts";
import { registerLibrarySmokeChecks } from "../plugins/librarySmokeChecks.ts";
import { getHostContract } from "./host_contract.ts";
import { ensureReferencesLibrary, resolveCitationTitle } from "./references/library.ts";
import { installDirectQuotePdfOpenHandler } from "./direct_quote_pdf.ts";
import { perfMark, perfMeasure, perfSummaryOnce } from "./perf.ts";
import { getHostAdapter, setHostAdapter, type HostAdapter } from "../host/host_adapter.ts";
import { THEME_CHANGE_EVENT } from "./theme_events.ts";
import { ribbonDebugLog } from "./ribbon_debug.ts";
import { subscribeSourceChecksThread } from "./source_checks_thread.ts";

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
const DEFAULT_CODER_STATE_PATH = "";
const DEFAULT_LEDOC_FILENAME = "coder_state.ledoc";
type CoderStateLoadResult = { html: string; sourcePath: string };
const CODER_STATE_PATH_STORAGE_KEY = "leditor.coderStatePath";
const LAST_LEDOC_PATH_STORAGE_KEY = "leditor.lastLedocPath";
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

const mountAgentFab = (editorHandle: EditorHandle, appRoot: HTMLElement, signal?: AbortSignal) => {
  if (document.getElementById("leditor-agent-fab")) return;
  const btn = document.createElement("button");
  btn.id = "leditor-agent-fab";
  btn.type = "button";
  btn.className = "leditor-agent-fab";
  btn.setAttribute("aria-label", "Open Agent");
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h3v-2H4V4h16v11h2V4a2 2 0 0 0-2-2Zm-1 16-4 4v-4h4Zm-6-2a1 1 0 0 1-1-1V8a1 1 0 0 1 2 0v7a1 1 0 0 1-1 1Zm0 4a1.25 1.25 0 1 1 0-2.5A1.25 1.25 0 0 1 13 20Z"/>
    </svg>
  `;
  btn.addEventListener(
    "click",
    () => {
      try {
        editorHandle.execCommand("agent.sidebar.toggle");
        editorHandle.focus();
      } catch (error) {
        console.warn("[agent_fab][click] toggle failed", error);
      }
    },
    { signal }
  );

  // Keep the FAB above the status bar if present.
  const updateBottom = () => {
    const el = document.querySelector<HTMLElement>(".leditor-status-bar");
    const h = el ? el.getBoundingClientRect().height : 0;
    btn.style.bottom = h > 0 ? `${Math.ceil(h) + 18}px` : "";
  };
  updateBottom();
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(updateBottom);
    const el = document.querySelector<HTMLElement>(".leditor-status-bar");
    if (el) ro.observe(el);
    signal?.addEventListener?.("abort", () => ro.disconnect(), { once: true });
  } else {
    window.addEventListener("resize", updateBottom, { signal });
  }

  appRoot.appendChild(btn);
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
    debugInfo("[text][keys]", { mode, path, keys, nodesCount, hasEditedHtml: hasEdited });
  } catch (error) {
    console.debug("[CoderState] key log parse failed", { mode, path, error });
  }
};

const logNode0 = (mode: string, path: string, node: any) => {
  lastCoderStateNode = node ?? null;
  lastCoderStatePath = path ?? null;
  if (!node) {
    debugInfo("[CoderState][node0]", { mode, path, status: "missing" });
    return;
  }
  const editedHtmlLength =
    typeof node?.editedHtml === "string" ? node.editedHtml.length : node?.edited_html?.length;
  debugInfo("[CoderState][node0]", {
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
    debugInfo(`[text][loader]: ${resolvedPath}`, {
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
    debugInfo(`[text][loader]: ${fileUrl}`, {
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
    debugInfo(`[text][loader]: ${url}`, {
      mode: "@fs",
      length: parsed.html.length,
      keys: parsed.keyCount,
      nodes: parsed.nodeCount
    });
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

async function maybeImportDefaultLedoc(): Promise<boolean> {
  const resolveCandidateLedocPaths = async (): Promise<string[]> => {
    const candidates: string[] = [];

    const push = (value: unknown) => {
      const v = typeof value === "string" ? value.trim() : "";
      if (!v) return;
      if (candidates.includes(v)) return;
      candidates.push(v);
    };

    // Prefer the last used path (Word-like: reopen last document), before falling back to host defaults.
    try {
      push(window.localStorage.getItem(LAST_LEDOC_PATH_STORAGE_KEY));
    } catch {
      // ignore
    }

    const adapter = getHostAdapter();
    if (adapter?.getDefaultLEDOCPath) {
      try {
        push(await adapter.getDefaultLEDOCPath());
      } catch (error) {
        debugWarn("[ImportLEDOC][auto] default-path failed", { error });
      }
    }

    try {
      const last = window.localStorage.getItem(LAST_LEDOC_PATH_STORAGE_KEY);
      if (last && last.trim()) push(last.trim());
    } catch {
      // ignore
    }
    try {
      const coderStatePath = window.localStorage.getItem(CODER_STATE_PATH_STORAGE_KEY);
      if (coderStatePath && coderStatePath.trim()) {
        const trimmed = coderStatePath.trim();
        const next = trimmed.replace(/\.json$/i, ".ledoc");
        if (next && next !== trimmed) push(next);
      }
    } catch {
      // ignore
    }
    try {
      const host = getHostAdapter();
      if (host?.fileExists) {
        const probe = await host.fileExists({ sourcePath: DEFAULT_LEDOC_FILENAME });
        const exists = Boolean((probe as any)?.exists);
        if (exists) push(DEFAULT_LEDOC_FILENAME);
      }
    } catch {
      // ignore
    }
    return candidates;
  };
  const importer = (window as typeof window & { __leditorAutoImportLEDOC?: (opts?: any) => Promise<any> })
    .__leditorAutoImportLEDOC;
  if (!importer) return false;
  const candidatePaths = await resolveCandidateLedocPaths();
  if (candidatePaths.length === 0) return false;
  for (const sourcePath of candidatePaths) {
    try {
      const result = await importer({ sourcePath, prompt: false });
      if (result?.success) {
        return true;
      }
    } catch (error) {
      debugWarn("[ImportLEDOC][auto] failed", { error, sourcePath });
    }
  }
  return false;
}

const loadCoderStateHtml = async (): Promise<CoderStateLoadResult | null> => {
  const bridgeResult = await attemptCoderBridgeRead();
  if (bridgeResult) {
    debugInfo("[CoderState] loaded HTML via coderBridge", { path: bridgeResult.sourcePath });
    logNode0("coderBridge", bridgeResult.sourcePath, lastCoderStateNode);
    return bridgeResult;
  }
  const sourcePath = resolveCoderStatePath();
  if (!sourcePath) {
    return null;
  }
  debugInfo("[CoderState] trying path", { path: sourcePath });
  const hostResult = await attemptHostRead(sourcePath);
  if (hostResult) {
    debugInfo("[CoderState] loaded HTML from coder state", { path: hostResult.sourcePath });
    return hostResult;
  }
  const fetchResult = await attemptFetchRead(sourcePath);
  if (fetchResult) {
    debugInfo("[CoderState] loaded HTML via file fetch", { path: fetchResult.sourcePath });
    return fetchResult;
  }
  const viteFsResult = await attemptViteFsRead(sourcePath);
  if (viteFsResult) {
    debugInfo("[CoderState] loaded HTML via @fs dev path", { path: viteFsResult.sourcePath });
    return viteFsResult;
  }
  debugInfo("[CoderState] skipped auto-loading coder state", { path: sourcePath });
  return null;
};

let coderStateWarnedMissingWriter = false;

const getCoderAutosaveGuard = () => {
  const g = globalThis as typeof globalThis & { __leditorAllowCoderAutosave?: boolean };
  return g;
};

const getLedocAutosaveGuard = () => {
  const g = globalThis as typeof globalThis & { __leditorAllowLedocAutosave?: boolean };
  if (typeof g.__leditorAllowLedocAutosave !== "boolean") {
    // Default off until a LEDOC file is imported.
    g.__leditorAllowLedocAutosave = false;
  }
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
      debugWarn("[CoderState] autosave via coderBridge failed", { scopeId, error });
      // fall through to file-based writer if available
    }
  }

  const targetPath = resolveCoderStatePath();
  const writer = window.leditorHost?.writeFile;
  const reader = window.leditorHost?.readFile;
  if (!writer || !reader) {
    if (!coderStateWarnedMissingWriter) {
      coderStateWarnedMissingWriter = true;
      debugWarn("[CoderState] host read/write unavailable; autosave disabled", { targetPath });
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
      debugWarn("[CoderState] autosave failed", { targetPath, error: result?.error });
    }
  } catch (error) {
    debugWarn("[CoderState] autosave threw", { targetPath, error });
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
  // Ensure caret debug flag exists so console access doesn't throw on first load.
  const debugGlobals = window as typeof window & {
    __leditorDebug?: boolean;
    __leditorCaretDebug?: boolean;
    __leditorReferencesDebug?: boolean;
    __leditorPaginationDebug?: boolean;
  };
  debugGlobals.__leditorDebug = debugGlobals.__leditorDebug ?? false;
  debugGlobals.__leditorCaretDebug = debugGlobals.__leditorCaretDebug ?? false;
  debugGlobals.__leditorReferencesDebug = debugGlobals.__leditorReferencesDebug ?? false;
  debugGlobals.__leditorPaginationDebug = debugGlobals.__leditorPaginationDebug ?? false;
  if (
    featureFlags.startupSmokeChecksEnabled ||
    featureFlags.paginationDebugEnabled ||
    featureFlags.ribbonDebugEnabled
  ) {
    debugGlobals.__leditorDebug = true;
  }
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
      debugInfo("[HostContract] loaded host payload", hostContractInfo);
      if (options.requireHostContract || hostContractInfo.paths.bibliographyDir) {
        await ensureReferencesLibrary();
      }
    } catch (error) {
      if (options.requireHostContract) {
        console.error("[HostContract] initialization failed", error);
        throw error;
      }
      debugWarn("[HostContract] initialization skipped/failed (portable mode)", error);
    }
  // Debug: silenced noisy ribbon logs.
  if (featureFlags.paginationDebugEnabled) {
    const win = window as typeof window & { __leditorPaginationDebug?: boolean };
    win.__leditorPaginationDebug = true;
    debugInfo("[PaginationDebug] enabled by feature flag");
  }
  if (featureFlags.ribbonDebugEnabled) {
    const win = window as typeof window & {
      __leditorRibbonDebug?: boolean;
      __leditorRibbonDebugTab?: string;
      __leditorRibbonDebugVerbose?: boolean;
      __leditorNonFluentDebug?: boolean;
    };
    win.__leditorRibbonDebug = true;
    if (featureFlags.ribbonDebugTab) {
      win.__leditorRibbonDebugTab = featureFlags.ribbonDebugTab;
    }
    if (featureFlags.ribbonDebugVerbose) {
      win.__leditorRibbonDebugVerbose = featureFlags.ribbonDebugVerbose;
    }
    if (featureFlags.nonFluentIconDebug) {
      win.__leditorNonFluentDebug = true;
    }
    ribbonDebugLog("enabled by feature flag");
  }
  const env = ensureProcessEnv();
  if (env?.GTK_USE_PORTAL === "0") {
    debugInfo("[Startup] GTK_USE_PORTAL=0 (portal disabled)");
  }
  window.codexLog?.write(`[RUN] BATCH=3 PHASE=${CURRENT_PHASE}`);
  window.codexLog?.write("[RUN_SEP] --------------------------------");
  window.codexLog?.write("[MOUNT_EDITOR]");
  window.codexLog?.write("[RENDERER_MOUNT_OK]");
  registerLibrarySmokeChecks();

  const defaultToolbar =
    "Undo Redo | Bold Italic | Heading1 Heading2 | BulletList NumberList | Link | AlignLeft AlignCenter AlignRight JustifyFull | Outdent Indent | SearchReplace Preview ImportLEDOC ExportLEDOC ImportDOCX ExportDOCX FootnotePanel Fullscreen | VisualChars VisualBlocks | DirectionLTR DirectionRTL";
  const coderStateResult = null;
  getCoderAutosaveGuard().__leditorAllowCoderAutosave = false;
  let hasInitialContent = Boolean(options.initialContent?.value);
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
      "search",
      "preview",
      "export_ledoc",
      "import_ledoc",
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
      "lexicon_quick",
      "source_checks_feedbacks",
      "source_view",
      "print_preview"
    ],
    autosave: options.autosave ?? { enabled: true, intervalMs: 1000 }
  };
  if (!config.plugins.includes("lexicon_quick")) config.plugins.push("lexicon_quick");
  if (options.initialContent) {
    config.initialContent = options.initialContent;
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

  // Defensive cleanup: older builds mounted document-side rails for drafts/source checks.
  // Current UX renders those only in the Agent sidebar.
  try {
    for (const id of ["leditor-source-check-rail", "leditor-ai-draft-rail", "leditor-feedback-hub"]) {
      document.getElementById(id)?.remove();
    }
  } catch {
    // ignore
  }

  handle.execCommand("SetPageMargins", {
    margins: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 }
  });
  const autoImportOk = await maybeImportDefaultLedoc();
  if (autoImportOk) {
    hasInitialContent = true;
  }

  if (!editorEl) {
    throw new Error(`LEditor: elementId "${config.elementId}" not found`);
  }
  const parent = editorEl.parentElement ?? document.body;
  const rawUiScale = (window as any).leditorUiScale;
  const parsedUiScale = typeof rawUiScale === "number" && Number.isFinite(rawUiScale) ? rawUiScale : 1.8;
  const APP_UI_SCALE = Math.max(0.75, Math.min(4.0, parsedUiScale));
  const appRoot = document.createElement("div");
  appRoot.id = "leditor-app";
  appRoot.className = "leditor-app";
  appRoot.style.setProperty("--ui-scale", String(APP_UI_SCALE));

  const ensureSplitStyles = () => {
    if (document.getElementById("leditor-split-styles")) return;
    const style = document.createElement("style");
    style.id = "leditor-split-styles";
    style.textContent = `
.leditor-main-split {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: 0;
  position: relative;
}

.leditor-doc-shell {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
}

	.leditor-pdf-shell {
	  flex: 0 0 clamp(360px, 40vw, 760px);
	  min-width: 0;
	  min-height: 0;
	  display: none;
	  flex-direction: column;
	  border-left: 1px solid rgba(17, 24, 39, 0.12);
	  background: var(--ui-surface);
	  padding: 0;
	  box-sizing: border-box;
	  overflow: hidden;
	}

.leditor-app.theme-dark .leditor-pdf-shell {
  border-left-color: rgba(255, 255, 255, 0.16);
  background: var(--ui-surface-dark);
}

	.leditor-app.leditor-pdf-open .leditor-pdf-shell {
	  display: flex;
	}

	.leditor-pdf-frame {
	  flex: 1 1 auto;
	  min-height: 0;
	  width: 100%;
	  height: 100%;
	  display: flex;
	  flex-direction: column;
	  padding: 12px 10px 14px;
	  border-radius: 14px;
	  overflow: hidden;
	  background: rgba(255, 255, 255, 0.55);
	  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.08);
	  box-sizing: border-box;
	}

	.leditor-pdf-iframe {
	  flex: 1 1 auto;
	  width: 100%;
	  min-height: 0;
	  border: 0;
	  display: block;
	}
	`;
	    document.head.appendChild(style);
	  };
  ensureSplitStyles();
  parent.insertBefore(appRoot, editorEl);
  const ribbonHost = document.createElement("div");
  ribbonHost.id = "leditor-ribbon";
  ribbonHost.className = "leditor-ribbon-host";
  ribbonHost.dataset.ribbonDensity = "compact3";
  const appHeader = document.createElement("div");
  appHeader.className = "leditor-app-header";
  appHeader.appendChild(ribbonHost);
  const mainSplit = document.createElement("div");
  mainSplit.className = "leditor-main-split";
  const docShell = document.createElement("div");
  docShell.className = "leditor-doc-shell";
  appRoot.appendChild(appHeader);
  appRoot.appendChild(mainSplit);
  mainSplit.appendChild(docShell);
	  const pdfShell = document.createElement("div");
	  pdfShell.className = "leditor-pdf-shell";
	  const pdfFrame = document.createElement("div");
	  pdfFrame.className = "leditor-pdf-frame";
	  const pdfIframe = document.createElement("iframe");
	  pdfIframe.className = "leditor-pdf-iframe";
	  pdfIframe.title = "PDF viewer";
	  pdfFrame.appendChild(pdfIframe);
	  pdfShell.appendChild(pdfFrame);
	  mainSplit.appendChild(pdfShell);
  // Keep the editor mount inside the app shell so UI layout and feature CSS (e.g. paragraph grid) apply consistently.
  docShell.appendChild(editorEl);
  initViewState(appRoot);
  const ribbonEnabled = featureFlags.ribbonEnabled;
  let disposeRibbon: (() => void) | null = null;
  if (ribbonEnabled) {
    try {
      // Preflight icon integrity before rendering ribbon to avoid runtime crashes.
      const ribbonConfig = await import("./ribbon_config.ts");
      const model = ribbonConfig.loadRibbonModel?.();
      const allIconKeys: string[] = [];
      if (model?.orderedTabs) {
        model.orderedTabs.forEach((tab: any) =>
          tab.groups.forEach((group: any) =>
            group.clusters.forEach((cluster: any) =>
              (cluster.controls || []).forEach((control: any) => {
                if (control.iconKey) allIconKeys.push(control.iconKey);
                if (control.menu) control.menu.forEach((c: any) => c.iconKey && allIconKeys.push(c.iconKey));
              })
            )
          )
        );
      }
      if (allIconKeys.length) {
        assertRibbonIconKeysExist(allIconKeys);
      }
      disposeRibbon = renderRibbon(ribbonHost, handle);
    } catch (error) {
      console.error("[Renderer][Ribbon] preflight failed", error);
      throw error;
    }
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
  document.addEventListener(
    THEME_CHANGE_EVENT,
    ((event: Event) => {
      if (!layout) return;
      const detail = (event as CustomEvent<{ mode?: unknown; surface?: unknown }>).detail;
      const mode = detail?.mode === "dark" ? "dark" : detail?.mode === "light" ? "light" : null;
      const surface =
        detail?.surface === "dark" ? "dark" : detail?.surface === "light" ? "light" : null;
      if (!mode) return;
      const current = layout.getTheme?.();
      if (current && current.mode === mode && (!surface || current.surface === surface)) {
        return;
      }
      layout.setTheme(mode, surface ?? undefined);
    }) as EventListener,
    { signal }
  );
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

  // Embedded PDF viewer (side-by-side with A4). The iframe loads `pdf_viewer.html` and receives payload via postMessage.
  let pdfFrameLoaded = false;
  let pendingPdfPayload: Record<string, unknown> | null = null;
  const pdfViewerRetry = new WeakMap<HTMLIFrameElement, number>();
  const ensurePdfIframeLoaded = () => {
    if (pdfIframe.src) return;
    // Use the full-featured TEIA PDF viewer (pdf.js-based) shipped into `dist/public/PDF_Viewer/`.
    pdfIframe.src = "PDF_Viewer/viewer.html?embedded=1";
  };
  const applyPayloadToPdfViewer = (iframe: HTMLIFrameElement, payload: Record<string, unknown>) => {
    pendingPdfPayload = payload;
    const tryApply = (): boolean => {
      const win = iframe.contentWindow as (Window & { PDF_APP?: { loadFromPayload?: (payload: any) => unknown } }) | null;
      const pdfApp = win?.PDF_APP;
      if (pdfApp && typeof pdfApp.loadFromPayload === "function") {
        try {
          pdfApp.loadFromPayload(payload);
          return true;
        } catch (error) {
          console.warn("[leditor][pdf] PDF_APP.loadFromPayload failed", error);
          return false;
        }
      }
      return false;
    };

    if (tryApply()) {
      const existing = pdfViewerRetry.get(iframe);
      if (existing !== undefined) {
        window.clearInterval(existing);
        pdfViewerRetry.delete(iframe);
      }
      return;
    }

    const existing = pdfViewerRetry.get(iframe);
    if (existing !== undefined) {
      window.clearInterval(existing);
      pdfViewerRetry.delete(iframe);
    }

    let intervalId: number | null = null;
    const cleanup = () => {
      iframe.removeEventListener("load", onLoad);
      if (intervalId != null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
      pdfViewerRetry.delete(iframe);
    };
    const onLoad = () => {
      pdfFrameLoaded = true;
      if (pendingPdfPayload && tryApply()) {
        cleanup();
      }
    };
    iframe.addEventListener("load", onLoad);
    intervalId = window.setInterval(() => {
      if (pendingPdfPayload && tryApply()) {
        cleanup();
      }
    }, 250);
    pdfViewerRetry.set(iframe, intervalId);
  };
  pdfIframe.addEventListener("load", () => {
    pdfFrameLoaded = true;
    if (pendingPdfPayload) {
      applyPayloadToPdfViewer(pdfIframe, pendingPdfPayload);
    }
  });
  const openEmbeddedPdf = (payload: Record<string, unknown>) => {
    ensurePdfIframeLoaded();
    appRoot.classList.add("leditor-pdf-open");
    applyPayloadToPdfViewer(pdfIframe, payload);
    // Ensure pagination reacts to the reduced width.
    try {
      layout?.updatePagination();
    } catch {
      // ignore
    }
  };
  const closeEmbeddedPdf = () => {
    appRoot.classList.remove("leditor-pdf-open");
    try {
      layout?.updatePagination();
    } catch {
      // ignore
    }
  };
  (window as any).__leditorEmbeddedPdf = {
    open: openEmbeddedPdf,
    close: closeEmbeddedPdf,
    isOpen: () => appRoot.classList.contains("leditor-pdf-open"),
    loaded: () => pdfFrameLoaded
  };

  // Allow the embedded PDF viewer iframe to request closing the side panel.
  window.addEventListener(
    "message",
    (event) => {
      const data = (event as MessageEvent<any>).data;
      if (!data || typeof data !== "object") return;
      if (data.type === "leditor:pdf-close") {
        closeEmbeddedPdf();
      }
    },
    { signal }
  );

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
      // While editing header/footer/footnotes, ProseMirror can emit noisy focus/selection updates
      // that jump to start/end of document due to blur/focus. Do not let those poison our
      // "return point" selection used by ribbon commands.
      if (
        appRoot.classList.contains("leditor-footnote-editing") ||
        appRoot.classList.contains("leditor-header-footer-editing")
      ) {
        return;
      }
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
  const caretProbe = {
    log(reason = "manual") {
      try {
        const active = document.activeElement as HTMLElement | null;
        const prose = tiptapEditor?.view?.dom as HTMLElement | null;
        console.info("[CaretProbe] state", {
          reason,
          snapshot: lastKnownSelection,
          lastKnownSelectionAt,
          selectionFrom: tiptapEditor.state.selection.from,
          selectionTo: tiptapEditor.state.selection.to,
          selectionEmpty: tiptapEditor.state.selection.empty,
          activeTag: active?.tagName ?? null,
          activeClass: (active?.getAttribute("class") || "").slice(0, 120),
          activeInProse: Boolean(prose && active && prose.contains(active))
        });
      } catch (error) {
        console.warn("[CaretProbe] failed", { error });
      }
    }
  };
  (window as typeof window & { leditorCaretProbe?: any }).leditorCaretProbe = caretProbe;
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

    // Always capture directly from the editor state on ribbon pointerdown.
    // Pointerdown fires before blur, so this is the most reliable way to avoid "end-of-doc" selection
    // poisoning when a ribbon click steals focus.
    try {
      lastKnownSelection = snapshotFromSelection(tiptapEditor.state.selection);
      lastKnownSelectionAt = Date.now();
    } catch {
      // Fall back to our last-known snapshot if state selection is unavailable for any reason.
      if (Date.now() - lastKnownSelectionAt > 500) {
        updateLastKnownSelection("ribbon:pointerdown:stale-refresh");
      }
    }
    if ((window as any).__leditorCaretDebug) {
      console.info("[Selection][ribbon] captured", { snapshot: lastKnownSelection, lastKnownSelectionAt });
    }
    recordRibbonSelection(lastKnownSelection);
  };
  ribbonHost.addEventListener("pointerdown", captureRibbonSelection, { capture: true, signal });
  ribbonHost.addEventListener("touchstart", captureRibbonSelection, { capture: true, signal });
  ribbonHost.addEventListener(
    "wheel",
    (event) => {
      // Prevent ribbon scroll from propagating to page/doc scroll.
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true, passive: false, signal }
  );
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
	    // During footnote editing the body ProseMirror can briefly steal focus (transactions/rehydration).
	    // Never let those transient focus/selection events poison our stored caret snapshot.
	    if ((window as any).__leditorFootnoteMode) return;
	    const prose = tiptapEditor?.view?.dom as HTMLElement | null;
	    const active = document.activeElement as HTMLElement | null;
	    // Ignore selection updates while the editor is not the active surface. This prevents
	    // "end-of-doc" selection jumps on blur from poisoning ribbon footnote insertion.
	    if (!prose || !active || !prose.contains(active)) return;
	    updateLastKnownSelection("tiptap:selectionUpdate");
	  });
	  tiptapEditor.on("focus", () => {
	    if (Date.now() < suppressSelectionTrackingUntil) return;
	    if ((window as any).__leditorFootnoteMode) return;
	    const prose = tiptapEditor?.view?.dom as HTMLElement | null;
	    const active = document.activeElement as HTMLElement | null;
	    if (!prose || !active || !prose.contains(active)) return;
	    updateLastKnownSelection("tiptap:focus");
	  });
  const attachCitationHandlers = (
    root: Document | HTMLElement,
    proseRoot: HTMLElement,
    scopeRoot: HTMLElement,
    signal: AbortSignal
  ) => {
    const pickAttr = (el: HTMLElement, name: string): string => {
      const raw = el.getAttribute(name) || "";
      return raw.trim();
    };

    const targetToElement = (value: EventTarget | null): HTMLElement | null => {
      if (!value) return null;
      if (value instanceof HTMLElement) return value;
      if (value instanceof Node) {
        const parent = (value as Node).parentElement;
        return parent instanceof HTMLElement ? parent : null;
      }
      return null;
    };

    const extractDqid = (el: HTMLElement, href: string): string => {
      const direct =
        pickAttr(el, "data-dqid") ||
        pickAttr(el, "data-quote-id") ||
        pickAttr(el, "data-quote_id");
      if (direct) return direct.toLowerCase();
      const hrefRaw = String(href || "").trim();
      if (!hrefRaw) return "";
      if (hrefRaw.startsWith("dq://") || hrefRaw.startsWith("dq:")) {
        return hrefRaw.replace(/^dq:\/*/, "").split(/[?#]/)[0].trim().toLowerCase();
      }
      const pick = (value: string | null | undefined): string => {
        const raw = String(value ?? "").trim();
        if (!raw) return "";
        try {
          return decodeURIComponent(raw).trim().toLowerCase();
        } catch {
          return raw.toLowerCase();
        }
      };
      const tryUrl = (value: string): string => {
        try {
          const url = new URL(value, window.location.href);
          const q =
            pick(url.searchParams.get("dqid")) ||
            pick(url.searchParams.get("quote_id")) ||
            pick(url.searchParams.get("quote-id"));
          if (q) return q;
          const hash = (url.hash || "").replace(/^#/, "");
          if (hash) {
            const hp = new URLSearchParams(hash.replace("?", "&"));
            return pick(hp.get("dqid")) || pick(hp.get("quote_id")) || pick(hp.get("quote-id"));
          }
        } catch {
          // ignore invalid urls
        }
        return "";
      };
      const fromUrl = tryUrl(hrefRaw);
      if (fromUrl) return fromUrl;
      const match = hrefRaw.match(/[?#&](?:dqid|quote_id|quote-id)=([^&#]+)/i);
      if (match && match[1]) return pick(match[1]);
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

    const isHandledAnchor = (anchor: HTMLAnchorElement, hrefHint?: string): { href: string; dqid: string } | null => {
      const rawHref = (hrefHint ?? pickAttr(anchor, "href")).trim();
      const dqidFallback = extractDqid(anchor, rawHref);
      const href = rawHref || (dqidFallback ? `dq://${dqidFallback}` : "");
      if (!href) return null;
      const dqid = extractDqid(anchor, href) || dqidFallback;
      if (!dqid) return null;
      return { href, dqid };
    };

    const recentOpenAt = new WeakMap<HTMLAnchorElement, number>();
    const OPEN_DEDUPE_MS = 450;
    const dispatchAnchorOpen = (anchor: HTMLAnchorElement, handled: { href: string; dqid: string }) => {
      const now = Date.now();
      const last = recentOpenAt.get(anchor) ?? 0;
      if (now - last < OPEN_DEDUPE_MS) return;
      recentOpenAt.set(anchor, now);
      const dqid = handled.dqid;
      const anchorId =
        anchor.id ||
        pickAttr(anchor, "data-key") ||
        pickAttr(anchor, "item-key") ||
        pickAttr(anchor, "data-item-key") ||
        pickAttr(anchor, "data-quote-id") ||
        pickAttr(anchor, "data-quote_id") ||
        dqid;
      const detail = {
        href: handled.href,
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
      if ((window as any).__leditorPdfDebug) {
        console.info("[leditor][anchor-click]", detail);
      }
      window.dispatchEvent(new CustomEvent("leditor-anchor-click", { detail, bubbles: true }));
    };
    const shouldOpenAnchor = (ev: MouseEvent | PointerEvent): boolean =>
      Boolean((ev as MouseEvent).metaKey || (ev as MouseEvent).ctrlKey);

    // Prevent caret/selection from moving into the anchor when clicking direct-quote links.
    root.addEventListener(
      "mousedown",
      (ev) => {
        const mouse = ev as MouseEvent;
        if (typeof mouse.button === "number" && mouse.button !== 0) return;
        if (!shouldOpenAnchor(mouse)) return;
        const target = targetToElement(ev.target);
        if (!target) return;
        if (!scopeRoot.contains(target)) return;
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;
        const handled = isHandledAnchor(anchor);
        if (!handled) return;
        const inProseMirror = proseRoot.contains(anchor);
        if (inProseMirror) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        ensureTitle(anchor, handled.href);
        anchor.classList.add("leditor-citation-anchor");
        anchor.setAttribute("draggable", "false");
      },
      { capture: true, signal }
    );

    // Some ProseMirror/selection interactions can cancel the `click` event; open on pointerdown
    // so a single click reliably opens the PDF viewer.
    root.addEventListener(
      "pointerdown",
      (ev) => {
        const pe = ev as PointerEvent;
        if (typeof (pe as any).button === "number" && (pe as any).button !== 0) return;
        if (!shouldOpenAnchor(pe)) return;
        const target = targetToElement(ev.target);
        if (!target) return;
        if (!scopeRoot.contains(target)) return;
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;
        const handled = isHandledAnchor(anchor);
        if (!handled) return;
        // Prevent selection/caret changes and stop ProseMirror from consuming the interaction.
        ev.preventDefault();
        ev.stopPropagation();
        ensureTitle(anchor, handled.href);
        anchor.classList.add("leditor-citation-anchor");
        anchor.setAttribute("draggable", "false");
        dispatchAnchorOpen(anchor, handled);
      },
      { capture: true, signal }
    );

    root.addEventListener(
      "click",
      (ev) => {
        // A double-click generates two click events (detail=1 then detail=2).
        // Avoid firing our citation handler twice; it should open a single PDF viewer.
        if (typeof (ev as MouseEvent).detail === "number" && (ev as MouseEvent).detail > 1) {
          return;
        }
        const target = targetToElement(ev.target);
        if (!target) return;
        if (!scopeRoot.contains(target)) return;
        if ((window as any).__leditorPdfDebug) {
          console.info("[leditor][click][capture]", {
            tag: target.tagName,
            className: target.className,
            text: (target.textContent || "").slice(0, 80)
          });
        }
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;
        const handled = isHandledAnchor(anchor);
        if (!handled) {
          if ((window as any).__leditorPdfDebug) {
            console.info("[leditor][anchor-click][skip]", {
              href: (anchor.getAttribute("href") || "").trim(),
              dataDqid: pickAttr(anchor, "data-dqid"),
              dataQuoteId: pickAttr(anchor, "data-quote-id") || pickAttr(anchor, "data-quote_id"),
              text: (anchor.textContent || "").trim().slice(0, 80)
            });
          }
          return;
        }
        if (!shouldOpenAnchor(ev as MouseEvent)) {
          return;
        }
        ev.preventDefault();
        if (proseRoot.contains(anchor)) {
          ev.stopPropagation();
        }
        ensureTitle(anchor, handled.href);
        anchor.classList.add("leditor-citation-anchor");
        anchor.setAttribute("draggable", "false");
        dispatchAnchorOpen(anchor, handled);
      },
      { capture: true, signal }
    );

    root.addEventListener(
      "mouseover",
      (ev) => {
        const target = targetToElement(ev.target);
        if (!target) return;
        if (!scopeRoot.contains(target)) return;
        const anchor = target.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = (anchor.getAttribute("href") || "").trim();
        ensureTitle(anchor, href);
        anchor.classList.add("leditor-citation-anchor");
        anchor.setAttribute("draggable", "false");
      },
      { capture: true, signal }
    );
  };
  const schemaMarks = Object.keys(tiptapEditor.schema.marks || {});
  debugInfo("[LEditor][schema][marks]", schemaMarks);
  debugInfo("[LEditor][schema][anchor]", { present: Boolean(tiptapEditor.schema.marks.anchor) });
  attachCitationHandlers(document, tiptapEditor.view.dom, appRoot, signal);
  installDirectQuotePdfOpenHandler();
  try {
    const probeHtml =
      "<p>Probe <a href=\"dq://probe\" data-key=\"PROBE\" title=\"probe\">(Probe)</a> tail</p>";
    const probeDoc = new DOMParser().parseFromString(probeHtml, "text/html");
    const parsed = ProseMirrorDOMParser.fromSchema(tiptapEditor.schema).parse(probeDoc.body);
    const parsedJson = parsed.toJSON();
    const parsedString = JSON.stringify(parsedJson);
    debugInfo("[LEditor][schema][anchor-parse]", {
      hasAnchorMark: parsedString.includes("\"anchor\""),
      text: parsed.textBetween(0, parsed.content.size, " ")
    });
  } catch (err) {
    debugWarn("[LEditor][schema][anchor-parse] failed", err);
  }
  // Footnotes are edited in the per-page footnote area inside the page stack. The legacy "footnote panel"
  // (footnote_manager.ts) caused focus/selection fights and visible UI flicker, so we disable it.
  // Keep host handlers as thin shims so existing commands don't crash.
  const focusFirstFootnote = () => {
    const footnoteType = tiptapEditor.schema.nodes.footnote;
    if (!footnoteType) return;
    let firstId: string | null = null;
    try {
      tiptapEditor.state.doc.descendants((node) => {
        if (node.type !== footnoteType) return true;
        const id =
          typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
        if (id) {
          firstId = id;
          return false;
        }
        return true;
      });
    } catch {
      // ignore
    }
    if (!firstId) return;
    try {
      const snapshot = snapshotFromSelection(tiptapEditor.state.selection);
      window.dispatchEvent(
        new CustomEvent("leditor:footnote-focus", {
          detail: { footnoteId: firstId, selectionSnapshot: snapshot }
        })
      );
    } catch {
      // ignore
    }
  };
  const footnoteHandlers = {
    open: () => focusFirstFootnote(),
    toggle: () => {
      if ((window as any).__leditorFootnoteMode) {
        window.dispatchEvent(new CustomEvent("leditor:footnote-exit"));
      } else {
        focusFirstFootnote();
      }
    },
    close: () => window.dispatchEvent(new CustomEvent("leditor:footnote-exit"))
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
  mountAgentFab(handle, appRoot, signal);
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

  if (featureFlags.startupSmokeChecksEnabled) {
    editorHandle.execCommand("debugDumpJson");
  }
  window.__logCoderNode = () => {
    if (lastCoderStateNode && lastCoderStatePath) {
      debugInfo("[CoderState][node0][hotkey]", {
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
      debugInfo("[CoderState][node0][hotkey]", { status: "not loaded" });
    }
  };

  if (!hasInitialContent && featureFlags.startupSmokeChecksEnabled) {
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

    // Phase 8 font check skipped in live doc to avoid clobbering user state.
    window.codexLog?.write("[PHASE8_SKIPPED]");
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
        debugWarn("[CoderState] autosave read failed", { error });
      }
    }, 750);
  };
  editorHandle.on("change", scheduleAutosave);

	  // Autosave LEDOC to persist session annotations (e.g. source-checks thread) when the current
	  // document was loaded from a LEDOC file (default: coder_state.ledoc auto-import).
	  let ledocAutosaveTimer: number | null = null;
	  let ledocAutosaveTargetPath: string | null = null;
	  let ledocAutosaveTargetPathInFlight: Promise<string | null> | null = null;
	  const resolveLedocAutosaveTargetPath = async (): Promise<string | null> => {
	    if (ledocAutosaveTargetPath) return ledocAutosaveTargetPath;
	    try {
	      const fromStorage = (window.localStorage.getItem(LAST_LEDOC_PATH_STORAGE_KEY) || "").trim();
	      if (fromStorage) {
	        ledocAutosaveTargetPath = fromStorage;
	        return fromStorage;
	      }
	    } catch {
	      // ignore
	    }
	    if (ledocAutosaveTargetPathInFlight) return ledocAutosaveTargetPathInFlight;
	    ledocAutosaveTargetPathInFlight = (async () => {
	      try {
	        const adapter = getHostAdapter();
	        const next = (await adapter?.getDefaultLEDOCPath?.()) ?? null;
	        if (next && String(next).trim()) {
	          const trimmed = String(next).trim();
	          ledocAutosaveTargetPath = trimmed;
	          try {
	            window.localStorage.setItem(LAST_LEDOC_PATH_STORAGE_KEY, trimmed);
	          } catch {
	            // ignore
	          }
	          return trimmed;
	        }
      } catch (error) {
        debugWarn("[renderer.ts][ledocAutosave][debug] default-path failed", { error });
      } finally {
        ledocAutosaveTargetPathInFlight = null;
      }
	      return null;
	    })();
	    return ledocAutosaveTargetPathInFlight;
	  };
	  const scheduleLedocAutosave = (reason: string) => {
	    if (!getLedocAutosaveGuard().__leditorAllowLedocAutosave) return;
	    if (ledocAutosaveTimer !== null) window.clearTimeout(ledocAutosaveTimer);
	    ledocAutosaveTimer = window.setTimeout(() => {
	      ledocAutosaveTimer = null;
	      void resolveLedocAutosaveTargetPath()
	        .then((targetPath) => {
	          if (!targetPath) return;
	          try {
	            const exporter = (window as typeof window & {
	              __leditorAutoExportLEDOC?: (options?: {
	                targetPath?: string;
	                suggestedPath?: string;
	                prompt?: boolean;
	              }) => Promise<any>;
	            }).__leditorAutoExportLEDOC;
	            if (!exporter) return;
	            console.debug(
	              `[renderer.ts][ledocAutosave][debug] export requested: reason=${reason} pathLen=${targetPath.length}`
	            );
	            // IMPORTANT: export-ledoc prompts if the path is missing. For autosave we must set it.
	            void exporter({ targetPath, suggestedPath: targetPath, prompt: false })
	              .then((result) => {
	                const savedPath = typeof result?.filePath === "string" ? String(result.filePath).trim() : "";
	                if (!savedPath) return;
	                try {
	                  const adapter = getHostAdapter();
	                  adapter?.createLedocVersion?.({
	                    ledocPath: savedPath,
	                    reason: "autosave",
	                    throttleMs: 2 * 60 * 1000,
	                    force: false,
	                    payload: result?.payload
	                  });
	                } catch {
	                  // ignore
	                }
	                if (savedPath === targetPath) return;
	                // Migration/support: host may redirect legacy v1 `.ledoc` file saves to a v2 bundle directory.
	                ledocAutosaveTargetPath = savedPath;
	                try {
	                  window.localStorage.setItem(LAST_LEDOC_PATH_STORAGE_KEY, savedPath);
	                } catch {
	                  // ignore
	                }
	              })
              .catch((error) => {
                debugWarn("[renderer.ts][ledocAutosave][debug] export failed", { reason, error });
              });
          } catch (error) {
            debugWarn("[renderer.ts][ledocAutosave][debug] export threw", { reason, error });
          }
        })
        .catch((error) => {
          debugWarn("[renderer.ts][ledocAutosave][debug] resolve target failed", { reason, error });
        });
    }, 1200);
  };
	  editorHandle.on("change", () => scheduleLedocAutosave("editorChange"));
	  const unsubSourceChecks = subscribeSourceChecksThread(() => scheduleLedocAutosave("sourceChecksThread"));
	  // keep subscription for app lifetime
	  void unsubSourceChecks;

  if (CURRENT_PHASE === 21) {
    if (!hasInitialContent) {
      runPhase21Validation(editorHandle, tiptapEditor);
    }
  } else if (CURRENT_PHASE === 22) {
    if (!hasInitialContent) {
      runPhase22Validation(editorHandle, tiptapEditor);
    }
  }

  // Phase 23 — DOCX export carries current page size/margins and header/footer content
  const pageSize = getCurrentPageSize();
  const margins = getMarginValues();
  const headerHtml = layout?.getHeaderContent();
  const footerHtml = layout?.getFooterContent();
  const contract = getHostContract();
  const sanitizeFilenameBase = (raw: string): string => {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return "untitled";
    const safe = trimmed.replace(/[\\/:"*?<>|]+/g, "-").replace(/\s+/g, " ").trim();
    return safe.slice(0, 96) || "untitled";
  };
  const joinLike = (dir: string, name: string): string => {
    const base = String(dir || "").replace(/[\\/]+$/, "");
    if (!base) return name;
    const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
    return `${base}${sep}${name}`;
  };
  const autoExportName = `docx-phase23-${Date.now()}-${sanitizeFilenameBase(contract.documentTitle || "document")}.docx`;
  const exportOptions = {
    prompt: false,
    suggestedPath: joinLike(contract.paths?.tempDir || "", autoExportName),
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
        debugInfo("[Phase23] Skipping DOCX auto-export (host export handler unavailable)");
        return;
      }
      throw new Error(`Phase23 DOCX export failed: ${exportResult?.error ?? "unknown error"}`);
    }
  } else {
    debugInfo("[Phase23] Skipping DOCX auto-export (host export handler unavailable)");
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
    debugInfo("[CoderState] skipping Phase21 validation because coder state is loaded");
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

const runPhase22Validation = (editorHandle: EditorHandle, editorInstance: TiptapEditor) => {
  if ((window as typeof window & { __coderStateLoaded?: boolean }).__coderStateLoaded) {
    debugInfo("[CoderState] skipping Phase22 validation because coder state is loaded");
    return;
  }
  const registry = getFootnoteRegistry();
  const collectIds = (editor: TiptapEditor): string[] => {
    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "footnote") return true;
      const id = typeof (node.attrs as any)?.footnoteId === "string" ? String((node.attrs as any).footnoteId).trim() : "";
      if (id) ids.push(id);
      return true;
    });
    return ids;
  };

  editorHandle.setContent("<p>Footnote phase</p>", { format: "html" });
  editorHandle.focus();
  editorHandle.execCommand("InsertFootnote");
  editorHandle.execCommand("InsertFootnote");

  const ids = collectIds(editorInstance);
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

  const allIds = collectIds(editorInstance);
  if (allIds.length !== 3) {
    throw new Error("Phase22 expected three footnotes after inserting at start.");
  }

  const thirdId = allIds[0];
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
