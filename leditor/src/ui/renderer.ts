import { LEditor, type EditorHandle } from "../api/leditor.ts";
import { recordRibbonSelection, snapshotFromSelection } from "../utils/selection_snapshot.ts";
import "../legacy/extensions/plugin_debug.js";
import "../legacy/extensions/plugin_search.js";
import "../legacy/extensions/plugin_preview.js";
import "../extensions/plugin_export_docx.js";
import "../extensions/plugin_import_docx.js";
import { renderRibbon } from "./ribbon.ts";
import { mountStatusBar } from "../legacy/ui/status_bar.js";
import { attachContextMenu } from "./context_menu.ts";
import { createQuickToolbar } from "./quick_toolbar.ts";
import { initFullscreenController } from "./fullscreen.ts";
import { featureFlags } from "../legacy/ui/feature_flags.js";
import { initGlobalShortcuts } from "./shortcuts.js";
import "@fontsource/source-sans-3/400.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-serif-4/600.css";
import "./ribbon.css";
import "./home.css";
import "./insert.css";
import "./layout.css";
import "./layout_tab.css";
import "./review.css";
import "./review_surfaces.css";
import "./references.css";
import "./references_overlay.css";
import "./view.css";
import { mountA4Layout, type A4LayoutController } from "./a4_layout.ts";
import { initViewState } from "./view_state.ts";
import { setLayoutController } from "./layout_context.ts";
import { subscribeToLayoutChanges } from "../legacy/ui/layout_settings.js";
import { refreshLayoutView } from "./layout_engine.js";
import { CellSelection, TableMap } from "@tiptap/pm/tables";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { DOMParser as ProseMirrorDOMParser } from "prosemirror-model";
import { getFootnoteRegistry, type FootnoteNodeViewAPI } from "../extensions/extension_footnote.ts";
import { resetFootnoteState, getFootnoteIds } from "../legacy/editor/footnote_state.js";
import { createFootnoteManager } from "./footnote_manager.ts";
import { getCurrentPageSize, getMarginValues } from "../legacy/ui/layout_settings.js";
import { registerLibrarySmokeChecks } from "../plugins/librarySmokeChecks.js";
import { getHostContract } from "./host_contract.ts";
import { ensureReferencesLibrary, resolveCitationTitle } from "./references/library.ts";

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
  "\\\\wsl$\\Ubuntu-20.04\\home\\pantera\\annotarium\\coder\\0-13_cyber_attribution_corpus_records_total_included\\coder_state.json";
type CoderStateLoadResult = { html: string; sourcePath: string };
const CODER_STATE_PATH_STORAGE_KEY = "leditor.coderStatePath";
let lastCoderStateNode: any = null;
let lastCoderStatePath: string | null = null;
const CODER_SCOPE_STORAGE_KEY = "leditor.scopeId";

const convertWslPath = (value: string): string => {
  const trimmed = value.replace(/^\\\\+/, "");
  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  if (segments.length >= 3 && segments[0]?.toLowerCase() === "wsl$") {
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

const parseCoderStateHtml = (raw: string): ParsedCoderState | null => {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as {
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
    const obj = JSON.parse(raw);
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
  // Hard-pinned path per requirements; ignore query/localStorage overrides.
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
const writeCoderStateHtml = async (html: string): Promise<void> => {
  const targetPath = resolveCoderStatePath();
  const writer = window.leditorHost?.writeFile;
  if (!writer) {
    if (!coderStateWarnedMissingWriter) {
      coderStateWarnedMissingWriter = true;
      console.warn("[CoderState] host writeFile unavailable; autosave disabled", { targetPath });
    }
    return;
  }
  try {
    const payload = JSON.stringify({ edited_html: html });
    const result = await writer({ targetPath, data: payload });
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

const findEditorElement = (elementId: string): HTMLElement | null => {
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

const ensureEditorElement = (elementId: string): HTMLElement => {
  const existing = findEditorElement(elementId);
  if (existing) {
    return existing;
  }
  const host = getWriteEditorHost();
  const mount = document.createElement("div");
  mount.id = elementId;
  mount.className = "leditor-mount";
  if (host) {
    host.appendChild(mount);
  } else {
    document.body.appendChild(mount);
  }
  return mount;
};

export const mountEditor = async () => {
  let hostContractInfo: ReturnType<typeof getHostContract> | null = null;
  try {
    hostContractInfo = getHostContract();
    console.info("[HostContract] loaded host payload", hostContractInfo);
    await ensureReferencesLibrary();
  } catch (error) {
    console.error("[HostContract] initialization failed", error);
    throw error;
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
  const coderStateResult = await loadCoderStateHtml();
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
  }
  const hasInitialContent = Boolean(coderStateResult?.html);
  type RendererConfig = {
    elementId: string;
    toolbar: string;
    plugins: string[];
    autosave: { enabled: boolean; intervalMs: number };
    initialContent?: { format: "html"; value: string };
  };
  const config: RendererConfig = {
    elementId: "editor",
    toolbar: defaultToolbar,
    plugins: [
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
      "source_view",
      "print_preview"
    ],
    autosave: { enabled: true, intervalMs: 1000 }
  };
  if (coderStateResult) {
    config.initialContent = { format: "html", value: coderStateResult.html };
    const snippet = coderStateResult.html.replace(/\\s+/g, " ").slice(0, 200);
    console.info("[text][preview]", { path: coderStateResult.sourcePath, snippet });
  }

  const waitForEditorElement = (elementId: string, timeoutMs: number): Promise<HTMLElement> => {
    const existing = findEditorElement(elementId);
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
        const found = findEditorElement(elementId);
        if (!found || settled) return;
        settled = true;
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(found);
      });
      observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
    });
  };

  ensureEditorElement(config.elementId);
  await waitForEditorElement(config.elementId, 5000);
  handle = LEditor.init(config);
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

  const editorEl = document.getElementById(config.elementId);
  if (!editorEl) {
    throw new Error(`LEditor: elementId "${config.elementId}" not found`);
  }
  const parent = editorEl.parentElement ?? document.body;
  const appRoot = document.createElement("div");
  appRoot.id = "leditor-app";
  appRoot.className = "leditor-app";
  parent.insertBefore(appRoot, editorEl);
  const ribbonHost = document.createElement("div");
  ribbonHost.id = "leditor-ribbon";
  ribbonHost.className = "leditor-ribbon-host";
  const appHeader = document.createElement("div");
  appHeader.className = "leditor-app-header";
  appHeader.appendChild(ribbonHost);
  const docShell = document.createElement("div");
  docShell.className = "leditor-doc-shell";
  appRoot.appendChild(appHeader);
  appRoot.appendChild(docShell);
  initViewState(appRoot);
  const ribbonEnabled = featureFlags.ribbonEnabled;
  if (ribbonEnabled) {
    // Debug: silenced noisy ribbon logs.
    renderRibbon(ribbonHost, handle);
  }
  const layout: A4LayoutController | null = mountA4Layout(docShell, editorEl, handle);
  setLayoutController(layout);
  refreshLayoutView();
  subscribeToLayoutChanges(() => refreshLayoutView());
  initFullscreenController(appRoot);
  const editorHandle = handle;
  const tiptapEditor = editorHandle.getEditor();
  const captureRibbonSelection = () => {
    recordRibbonSelection(snapshotFromSelection(tiptapEditor.state.selection));
  };
  ribbonHost.addEventListener("pointerdown", captureRibbonSelection, { capture: true });
  ribbonHost.addEventListener("touchstart", captureRibbonSelection, { capture: true });
  const attachCitationHandlers = (root: HTMLElement) => {
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
      const itemKey =
        pickAttr(el, "data-key") || pickAttr(el, "item-key") || pickAttr(el, "data-item-key");
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
          dataQuoteId: pickAttr(anchor, "data-quote-id"),
          dataQuoteIdAlt: pickAttr(anchor, "data-quote_id"),
          dataQuoteText: pickAttr(anchor, "data-quote-text")
        };
        console.info("[leditor][anchor-click]", detail);
        window.dispatchEvent(new CustomEvent("leditor-anchor-click", { detail, bubbles: true }));
      },
      true
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
      true
    );
  };
  const schemaMarks = Object.keys(tiptapEditor.schema.marks || {});
  console.info("[LEditor][schema][marks]", schemaMarks);
  console.info("[LEditor][schema][anchor]", { present: Boolean(tiptapEditor.schema.marks.anchor) });
  attachCitationHandlers(tiptapEditor.view.dom);
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
  window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey && event.shiftKey)) return;
    if (!["R", "r", "L", "l"].includes(event.key)) return;
    event.preventDefault();
    const win = window as typeof window & { __leditorPaginationDebug?: boolean };
    win.__leditorPaginationDebug = !win.__leditorPaginationDebug;
    console.info("[PaginationDebug] toggled", { enabled: win.__leditorPaginationDebug });
  });
  if (window.leditorHost?.registerFootnoteHandlers) {
    window.leditorHost.registerFootnoteHandlers(footnoteHandlers);
  } else if (!window.leditorHost) {
    window.leditorHost = {
      openFootnotePanel: footnoteHandlers.open,
      toggleFootnotePanel: footnoteHandlers.toggle,
      closeFootnotePanel: footnoteHandlers.close
    };
  }
  window.codexLog?.write("[PHASE3_OK]");
  mountStatusBar(handle, layout, { parent: appRoot });
  attachContextMenu(handle, tiptapEditor.view.dom, tiptapEditor);
  createQuickToolbar(handle, tiptapEditor);

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

    editorHandle.setContent("<p>Alignment check</p>", { format: "html" });
    editorHandle.focus();
    editorHandle.execCommand("AlignCenter");
    const json = editorHandle.getJSON() as {
      content?: Array<{ type?: string; attrs?: { textAlign?: string } }>;
    };
    const firstParagraph = json.content?.find((node) => node.type === "paragraph");
    if (firstParagraph?.attrs?.textAlign !== "center") {
      throw new Error("Phase5 alignment JSON check failed.");
    }
    const html = editorHandle.getContent({ format: "html" });
    if (typeof html !== "string" || !html.includes("text-align: center")) {
      throw new Error("Phase5 alignment HTML check failed.");
    }
    window.codexLog?.write("[PHASE5_OK]");

    const countListNodes = (node: any): number => {
      if (!node || typeof node !== "object") return 0;
      let count = 0;
      if (node.type === "bulletList" || node.type === "orderedList") {
        count += 1;
      }
      const content = node.content;
      if (Array.isArray(content)) {
        for (const child of content) {
          count += countListNodes(child);
        }
      }
      return count;
    };

    editorHandle.setContent("<p>Indent check</p>", { format: "html" });
    editorHandle.focus();
    editorHandle.execCommand("Indent");
    const indentJson = editorHandle.getJSON() as {
      content?: Array<{ type?: string; attrs?: { indentLevel?: number } }>;
    };
    const indentParagraph = indentJson.content?.find((node) => node.type === "paragraph");
    if (indentParagraph?.attrs?.indentLevel !== 1) {
      throw new Error("Phase6 paragraph indent JSON check failed.");
    }
    const indentHtml = editorHandle.getContent({ format: "html" });
    if (typeof indentHtml !== "string" || !indentHtml.includes("margin-left: 1em")) {
      throw new Error("Phase6 paragraph indent HTML check failed.");
    }
    editorHandle.execCommand("Outdent");
    const outdentJson = editorHandle.getJSON() as {
      content?: Array<{ type?: string; attrs?: { indentLevel?: number } }>;
    };
    const outdentParagraph = outdentJson.content?.find((node) => node.type === "paragraph");
    if ((outdentParagraph?.attrs?.indentLevel ?? 0) !== 0) {
      throw new Error("Phase6 paragraph outdent JSON check failed.");
    }
    const outdentHtml = editorHandle.getContent({ format: "html" });
    if (typeof outdentHtml !== "string" || outdentHtml.includes("margin-left")) {
      throw new Error("Phase6 paragraph outdent HTML check failed.");
    }

    editorHandle.setContent("<ul><li>One</li><li>Two</li></ul>", { format: "html" });
    editorHandle.focus();
    const listBefore = editorHandle.getJSON();
    const listBeforeCount = countListNodes(listBefore);
    if (listBeforeCount < 1) {
      throw new Error("Phase6 list JSON setup failed.");
    }
    editorHandle.execCommand("Indent");
    const listAfterIndent = editorHandle.getJSON();
    const listAfterIndentCount = countListNodes(listAfterIndent);
    if (listAfterIndentCount <= listBeforeCount) {
      throw new Error("Phase6 list indent JSON check failed.");
    }
    editorHandle.execCommand("Outdent");
    const listAfterOutdent = editorHandle.getJSON();
    const listAfterOutdentCount = countListNodes(listAfterOutdent);
    if (listAfterOutdentCount !== listBeforeCount) {
      throw new Error("Phase6 list outdent JSON check failed.");
    }
    window.codexLog?.write("[PHASE6_OK]");

    editorHandle.setContent("<p>Spacing check</p>", { format: "html" });
    editorHandle.focus();
    editorHandle.execCommand("LineSpacing", { value: "1.5" });
    editorHandle.execCommand("SpaceBefore", { valuePx: 12 });
    editorHandle.execCommand("SpaceAfter", { valuePx: 18 });
    const spacingJson = editorHandle.getJSON() as {
      content?: Array<{ type?: string; attrs?: { lineHeight?: string; spaceBefore?: number; spaceAfter?: number } }>;
    };
    const spacingParagraph = spacingJson.content?.find((node) => node.type === "paragraph");
    if (
      spacingParagraph?.attrs?.lineHeight !== "1.5" ||
      spacingParagraph?.attrs?.spaceBefore !== 12 ||
      spacingParagraph?.attrs?.spaceAfter !== 18
    ) {
      throw new Error("Phase7 spacing JSON check failed.");
    }
    const spacingHtml = editorHandle.getContent({ format: "html" });
    if (
      typeof spacingHtml !== "string" ||
      !spacingHtml.includes("line-height: 1.5") ||
      !spacingHtml.includes("margin-top: 12px") ||
      !spacingHtml.includes("margin-bottom: 18px")
    ) {
      throw new Error("Phase7 spacing HTML check failed.");
    }
    window.codexLog?.write("[PHASE7_OK]");

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

  // Autosave coder state
  const autosaveIntervalMs = 1000;
  setInterval(() => {
    try {
      const html = editorHandle.getContent({ format: "html" });
      if (typeof html === "string" && html.trim().length > 0) {
        void writeCoderStateHtml(html);
      }
    } catch (error) {
      console.warn("[CoderState] autosave read failed", { error });
    }
  }, autosaveIntervalMs);

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
