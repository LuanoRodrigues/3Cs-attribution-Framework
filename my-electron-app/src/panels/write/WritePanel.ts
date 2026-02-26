import { getDefaultCoderScope } from "../../analyse/collectionScope";
import { ANALYSE_ACTIVE_RUN_PATH_KEY } from "../../analyse/constants";
import { discoverRuns, getDefaultBaseDir, loadDirectQuoteLookup } from "../../analyse/data";
import {
  CoderStore,
  buildFolderDocumentHtml,
  findFolderById,
  getFolderEditedHtml,
  loadPersistentCoderState,
  stripFragment,
  wrapFullDocument
} from "../coder/coderState";
import { CoderState, CoderNode, FolderNode } from "../coder/coderTypes";

type LEditorHandle = {
  setContent: (content: string, opts: { format: "html" | "markdown" | "json" }) => void;
  getContent: (opts: { format: "html" | "markdown" | "json" }) => string | unknown;
  on: (eventName: string, fn: () => void) => void;
  off: (eventName: string, fn: () => void) => void;
  execCommand: (command: string, args?: any) => void;
};

type CitationSource = {
  id: string;
  label?: string;
  title?: string;
  author?: string;
  year?: string;
  url?: string;
  note?: string;
};

type RefRecord = {
  item_key: string;
  author: string;
  year: string;
  title: string;
  source: string;
  url: string;
  dqids: string[];
};

type WritePanelOptions = {
  scopeId?: string;
  scriptReady?: Promise<void>;
};

const EDITOR_READY_TIMEOUT_MS = 5000;
const AUTOSAVE_DELAY_MS = 750;
const CITATION_STYLE_STORAGE_KEY = "leditor:citation-style";

export class WritePanel {
  private readonly scopeId: string;
  private readonly scriptReady: Promise<void>;
  private readonly store: CoderStore;
  private currentFolderId: string | null = null;
  private editorHandle: LEditorHandle | null = null;
  private saveTimer: number | null = null;
  private saving = false;
  private destroyed = false;
  private changeListener: (() => void) | null = null;
  private externalListener: ((ev: Event) => void) | null = null;
  private anchorListener: ((ev: MouseEvent) => void) | null = null;
  private anchorWindowListener: ((ev: MouseEvent) => void) | null = null;
  private leditorAnchorListener: ((ev: Event) => void) | null = null;
  private anchorDomListener: ((ev: Event) => void) | null = null;
  private anchorDomTarget: EventTarget | null = null;
  private citationGuardListener: (() => void) | null = null;
  private contextActionListener: ((ev: Event) => void) | null = null;
  private dqLookup: Record<string, unknown> = {};
  private dqLookupPath: string | null = null;
  private dqLookupRunPath: string | null = null;
  private refIndexRunPath: string | null = null;
  private refIndex: Map<string, RefRecord> | null = null;
  private lastSavedHtml = "";
  private lastAnchorOpen: { key: string; ts: number } | null = null;

  constructor(options?: WritePanelOptions) {
    this.scopeId = options?.scopeId ?? getDefaultCoderScope();
    this.scriptReady = options?.scriptReady ?? Promise.resolve();
    this.store = new CoderStore(undefined, this.scopeId);
  }

  async init(): Promise<void> {
    await Promise.all([this.scriptReady, this.store.loadFromDisk()]);
    console.info("[write][init] starting");
    const state = this.store.snapshot();
    this.currentFolderId = this.pickFolderId(state);
    await this.pushContentToEditor(state);
    this.attachAutosave();
    this.attachExternalListener();
    this.attachAnchorListener();
    this.attachAnchorDomLogger();
    this.attachCitationGuard();
    this.attachContextActionListener();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    if (this.changeListener && this.editorHandle) {
      this.editorHandle.off("change", this.changeListener);
    }
    if (this.externalListener) {
      window.removeEventListener("coder:stateSaved", this.externalListener);
    }
    if (this.anchorListener) {
      document.removeEventListener("click", this.anchorListener, true);
    }
    if (this.anchorWindowListener) {
      window.removeEventListener("click", this.anchorWindowListener, true);
    }
    if (this.leditorAnchorListener) {
      window.removeEventListener("leditor-anchor-click", this.leditorAnchorListener as EventListener);
    }
    if (this.anchorDomListener && this.anchorDomTarget) {
      this.anchorDomTarget.removeEventListener("click", this.anchorDomListener, true);
      this.anchorDomListener = null;
      this.anchorDomTarget = null;
    }
    if (this.citationGuardListener) {
      this.citationGuardListener();
    }
    if (this.contextActionListener) {
      window.removeEventListener("leditor-context-action", this.contextActionListener as EventListener);
    }
  }

  private pickFolderId(state: CoderState): string {
    const firstFolder = state.nodes.find((n: CoderNode) => n.type === "folder") as FolderNode | undefined;
    return firstFolder?.id ?? "";
  }

  private async waitForEditor(): Promise<LEditorHandle> {
    if (this.editorHandle) return this.editorHandle;
    await this.scriptReady;
    const start = Date.now();
    while (!this.editorHandle) {
      const candidate = (window as any).leditor as LEditorHandle | undefined;
      if (candidate && typeof candidate.setContent === "function" && typeof candidate.getContent === "function") {
        this.editorHandle = candidate;
        console.info("[write][editor] ready", {
          hasEditor: Boolean((candidate as any).getEditor),
          hasSetContent: typeof candidate.setContent === "function"
        });
        break;
      }
      if (Date.now() - start > EDITOR_READY_TIMEOUT_MS) {
        throw new Error("Write editor not ready (timeout)");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.editorHandle!;
  }

  private async pushContentToEditor(state?: CoderState): Promise<void> {
    const handle = await this.waitForEditor();
    const snap = state ?? this.store.snapshot();
    if (!this.currentFolderId) {
      this.currentFolderId = this.pickFolderId(snap);
    }
    const storedHtml = getFolderEditedHtml(snap, this.currentFolderId || "");
    const hasAnchorTag = (src: string): boolean => /<a\b/i.test(src || "");
    const maybeDecodeEscapedHtml = (src: string): string => {
      const raw = src || "";
      if (!raw) return raw;
      const hasTags = /<\s*[a-z]/i.test(raw);
      const hasEscapedTags = /&lt;\s*[a-z]/i.test(raw);
      if (hasTags || !hasEscapedTags) return raw;
      const ta = document.createElement("textarea");
      ta.innerHTML = raw;
      return ta.value || raw;
    };
    let displayHtml = maybeDecodeEscapedHtml(storedHtml);
    const storedAnchorCount = (storedHtml.match(/<a\b/gi) || []).length;
    const storedEscapedAnchorCount = (storedHtml.match(/&lt;a\b/gi) || []).length;
    console.info("[write][setContent][stored]", {
      storedAnchorCount,
      storedEscapedAnchorCount,
      length: storedHtml.length
    });
    if (!hasAnchorTag(storedHtml)) {
      const folder = this.currentFolderId ? findFolderById(snap, this.currentFolderId) : null;
      if (folder) {
        const rebuiltRaw = buildFolderDocumentHtml(folder, 1);
        const rebuilt = maybeDecodeEscapedHtml(rebuiltRaw);
        const rebuiltAnchorCount = (rebuilt.match(/<a\b/gi) || []).length;
        console.info("[write][setContent][rebuilt]", {
          rebuiltAnchorCount,
          length: rebuilt.length
        });
        if (hasAnchorTag(rebuilt)) {
          displayHtml = rebuilt;
          console.info("[write][setContent] rebuilt from payloads to restore anchors");
        }
      }
    }
    let body = stripFragment(displayHtml);
    let bodyAnchorCount = (body.match(/<a\b/gi) || []).length;
    let bodyHeadingCount = (body.match(/<h[1-6]\b/gi) || []).length;
    if (bodyAnchorCount === 0 && storedAnchorCount > 0) {
      try {
        const parsed = new DOMParser().parseFromString(displayHtml, "text/html");
        const parsedBody = parsed.body?.innerHTML ?? "";
        const parsedAnchorCount = (parsedBody.match(/<a\b/gi) || []).length;
        const parsedHeadingCount = (parsedBody.match(/<h[1-6]\b/gi) || []).length;
        console.info("[write][setContent][body-parse]", {
          parsedAnchorCount,
          parsedHeadingCount,
          length: parsedBody.length
        });
        if (parsedAnchorCount > 0 || parsedHeadingCount > 0) {
          body = parsedBody;
          bodyAnchorCount = parsedAnchorCount;
          bodyHeadingCount = parsedHeadingCount;
        }
      } catch (err) {
        console.warn("[write][setContent][body-parse] failed", err);
      }
    }
    console.info("[write][setContent][body]", {
      bodyAnchorCount,
      bodyHeadingCount,
      length: body.length
    });
    const skipNormalize = bodyAnchorCount > 0;
    let normalized = skipNormalize ? body : this.normalizeHtmlForEditor(body);
    if (skipNormalize) {
      console.info("[write][setContent] normalize skipped (anchors present)");
    }
    const normalizedAnchorCount = (normalized.match(/<a\b/gi) || []).length;
    const normalizedHeadingCount = (normalized.match(/<h[1-6]\b/gi) || []).length;
    if ((bodyAnchorCount > 0 && normalizedAnchorCount === 0) || (bodyHeadingCount > 0 && normalizedHeadingCount === 0)) {
      console.warn("[write][setContent] normalize dropped anchors/headings; using raw body", {
        bodyAnchorCount,
        normalizedAnchorCount,
        bodyHeadingCount,
        normalizedHeadingCount
      });
      normalized = body;
    }
    const content = normalized && normalized.trim() ? normalized : "<p><br></p>";
    this.lastSavedHtml = storedHtml && storedHtml.trim() ? storedHtml : wrapFullDocument(content);
    const rawAnchorCount = (content.match(/<a\b/gi) || []).length;
    const rawDqCount = (content.match(/dq:\/\//gi) || []).length;
    const rawHeadings = (content.match(/<h[1-6]\b/gi) || []).length;
    console.info("[write][setContent][input]", {
      rawAnchorCount,
      rawDqCount,
      rawHeadings,
      length: content.length
    });
    if (bodyAnchorCount > 0 && rawAnchorCount === 0) {
      const bodyAnchorIndex = body.search(/<a\b/i);
      const contentAnchorIndex = content.search(/<a\b/i);
      console.warn("[write][setContent][anchor-mismatch]", {
        bodyAnchorIndex,
        contentAnchorIndex,
        bodyHasAnchor: bodyAnchorIndex !== -1,
        contentHasAnchor: contentAnchorIndex !== -1,
        bodyEqualsContent: body === content
      });
    }
    handle.setContent(content, { format: "html" });
    window.setTimeout(() => {
      try {
        const afterHtml = String(handle.getContent({ format: "html" }) || "");
        const afterAnchorCount = (afterHtml.match(/<a\b/gi) || []).length;
        const afterDqCount = (afterHtml.match(/dq:\/\//gi) || []).length;
        console.info("[write][setContent][after]", { afterAnchorCount, afterDqCount, length: afterHtml.length });
        console.info("[write][setContent][after][excerpt]", afterHtml.slice(0, 1000));
        const editorRoot = document.querySelector("#write-leditor-host .ProseMirror") as HTMLElement | null;
        if (editorRoot) {
          const liveHtml = editorRoot.innerHTML || "";
          console.info("[write][setContent][live][html]", liveHtml.slice(0, 1000));
          console.info("[write][setContent][live][text]", (editorRoot.textContent || "").slice(0, 1000));
        } else {
          console.warn("[write][setContent][live] editor root missing");
        }
      } catch (err) {
        console.warn("[write][setContent][after] failed", err);
      }
    }, 0);
    window.setTimeout(() => this.logAnchorState(), 0);
  }

  private attachAutosave(): void {
    void this.waitForEditor().then((handle) => {
      const listener = () => this.scheduleSave();
      this.changeListener = listener;
      handle.on("change", listener);
    });
  }

  private scheduleSave(): void {
    if (this.destroyed || this.saving) return;
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      void this.persistFromEditor();
    }, AUTOSAVE_DELAY_MS);
  }

  private async persistFromEditor(): Promise<void> {
    if (this.destroyed) return;
    this.saving = true;
    try {
      const handle = await this.waitForEditor();
      const html = String(handle.getContent({ format: "html" }) || "");
      const normalized = wrapFullDocument(html);
      if (normalized.trim() === this.lastSavedHtml.trim()) {
        return;
      }
      if (this.currentFolderId) {
        this.store.updateEditedHtml(this.currentFolderId, normalized, "write");
        this.lastSavedHtml = normalized;
      }
    } catch (error) {
      console.warn("[WritePanel] autosave failed", error);
    } finally {
      this.saving = false;
    }
  }

  private attachExternalListener(): void {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent).detail as { scopeId?: string | null; source?: string | null } | undefined;
      if (!detail) return;
      if (detail.scopeId && detail.scopeId !== this.scopeId) return;
      if (detail.source === "write") return;
      if (detail.source === "reload") return;
      void this.reloadFromDisk();
    };
    this.externalListener = handler;
    window.addEventListener("coder:stateSaved", handler);
  }

  private attachContextActionListener(): void {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent).detail as
        | { action?: string; selectionHtml?: string; selectionText?: string }
        | undefined;
      if (!detail?.action) return;
      void this.handleContextAction(detail.action, detail.selectionHtml || "", detail.selectionText || "");
    };
    this.contextActionListener = handler;
    window.addEventListener("leditor-context-action", handler as EventListener);
  }

  private getActiveRunPath(): string | null {
    try {
      const stored = window.localStorage.getItem(ANALYSE_ACTIVE_RUN_PATH_KEY);
      return stored && stored.trim() ? stored.trim() : null;
    } catch {
      return null;
    }
  }

  private persistActiveRunPath(runPath: string): void {
    const normalized = (runPath || "").trim();
    if (!normalized) return;
    this.dqLookupRunPath = normalized;
    try {
      window.localStorage.setItem(ANALYSE_ACTIVE_RUN_PATH_KEY, normalized);
    } catch {
      // ignore storage failures
    }
  }

  private inferRunPathFromLookupPath(path: string | null): string | null {
    const raw = (path || "").trim();
    if (!raw) return null;
    if (raw.endsWith("/direct_quote_lookup.json") || raw.endsWith("\\direct_quote_lookup.json")) {
      return raw.replace(/[\\\/]direct_quote_lookup\.json$/i, "");
    }
    return null;
  }

  private async resolveRunPath(reason: string): Promise<string | null> {
    const stored = this.getActiveRunPath();
    if (stored) return stored;
    if (this.dqLookupRunPath) return this.dqLookupRunPath;
    const inferred = this.inferRunPathFromLookupPath(this.dqLookupPath);
    if (inferred) {
      this.persistActiveRunPath(inferred);
      return inferred;
    }

    const baseDir = await getDefaultBaseDir();
    const { runs } = await discoverRuns(baseDir);
    if (!runs.length) {
      console.warn("[write][run-path] no runs discovered", { reason, baseDir });
      return null;
    }
    const scored = [...runs].sort((a, b) => {
      const score = (r: { hasL3?: boolean; hasL2: boolean; hasSections: boolean; hasBatches: boolean }) =>
        (r.hasL3 ? 4 : 0) + (r.hasL2 ? 3 : 0) + (r.hasSections ? 2 : 0) + (r.hasBatches ? 1 : 0);
      const scoreDiff = score(b) - score(a);
      if (scoreDiff !== 0) return scoreDiff;
      return String(b.id || "").localeCompare(String(a.id || ""));
    });
    const picked = scored[0]?.path || "";
    if (!picked) {
      console.warn("[write][run-path] run discovery returned empty path", { reason, baseDir });
      return null;
    }
    this.persistActiveRunPath(picked);
    console.info("[write][run-path] inferred", { reason, baseDir, picked });
    return picked;
  }

  private async ensureDqLookup(runPath: string): Promise<Record<string, unknown>> {
    if (this.dqLookupRunPath === runPath && Object.keys(this.dqLookup).length) {
      return this.dqLookup;
    }
    const { data, path } = await loadDirectQuoteLookup(runPath);
    this.dqLookup = data || {};
    this.dqLookupPath = path || null;
    this.dqLookupRunPath = runPath;
    return this.dqLookup;
  }

  private extractDqid(href: string, node?: HTMLElement | null): string | undefined {
    const pick = (val?: string | null) => {
      const t = (val || "").trim().toLowerCase();
      return t || undefined;
    };

    if (node) {
      const attr =
        pick(node.getAttribute("data-dqid")) ||
        pick(node.getAttribute("data-quote_id")) ||
        pick(node.getAttribute("data-quote-id")) ||
        pick((node as HTMLAnchorElement).dataset?.dqid) ||
        pick((node as HTMLAnchorElement).dataset?.quoteId);
      if (attr) return attr;
    }

    const hrefStr = href || "";
    if (hrefStr.startsWith("dq://") || hrefStr.startsWith("dq:")) {
      const cleaned = hrefStr.replace(/^dq:\/*/, "");
      return pick(cleaned.split(/[?#]/)[0]);
    }

    try {
      const u = new URL(hrefStr);
      const searchVal =
        pick(u.searchParams.get("dqid")) ||
        pick(u.searchParams.get("quote_id")) ||
        pick(u.searchParams.get("quote-id"));
      if (searchVal) return searchVal;
      if (u.hash) {
        const hp = new URLSearchParams(u.hash.replace(/^#/, ""));
        const hashVal =
          pick(hp.get("dqid")) ||
          pick(hp.get("quote_id")) ||
          pick(hp.get("quote-id"));
        if (hashVal) return hashVal;
      }
    } catch {
      // ignore malformed href
    }

    const match = hrefStr.match(/[?#&]dqid=([^&#]+)/i);
    if (match && match[1]) return pick(match[1]);
    return undefined;
  }

  private shouldSkipAnchorOpen(key: string): boolean {
    const now = Date.now();
    const last = this.lastAnchorOpen;
    if (last && last.key === key && now - last.ts < 400) {
      return true;
    }
    this.lastAnchorOpen = { key, ts: now };
    return false;
  }

  private handleNonDqidHref(href: string): void {
    if (!href) return;
    const safeHref = href.trim();
    if (!safeHref) return;
    if (safeHref === "#") {
      console.info("[write][anchor-click][non-dqid] ignoring bare hash href");
      return;
    }
    const hashIndex = safeHref.indexOf("#");
    if (hashIndex >= 0) {
      const hash = safeHref.slice(hashIndex + 1);
      if (hash) {
        const safeHash =
          typeof CSS !== "undefined" && typeof CSS.escape === "function"
            ? CSS.escape(hash)
            : hash.replace(/\"/g, "\\\"");
        const target =
          document.getElementById(hash) ||
          document.querySelector(`[name="${safeHash}"]`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    window.open(safeHref, "_blank", "noopener");
  }

  private async openPdfForAnchor(options: {
    href: string;
    anchor?: HTMLAnchorElement | null;
    explicitDqid?: string;
    anchorText?: string;
    dataQuoteText?: string;
  }): Promise<void> {
    console.info("[write][anchor-open][request]", {
      href: options.href,
      explicitDqid: options.explicitDqid || "",
      anchorText: (options.anchorText || "").slice(0, 120)
    });
    const dqid = (options.explicitDqid || "").trim().toLowerCase() || this.extractDqid(options.href, options.anchor);
    if (!dqid) {
      this.handleNonDqidHref(options.href);
      return;
    }

    const dedupeKey = dqid || options.href;
    if (this.shouldSkipAnchorOpen(dedupeKey)) {
      return;
    }

    const runPath = await this.resolveRunPath("anchor-click");
    if (!runPath) {
      console.warn("[write][anchor-click] missing active run path");
      return;
    }

    const lookup = await this.ensureDqLookup(runPath);
    const payload = (lookup[dqid] as Record<string, unknown> | undefined) || undefined;
    const pdfPath =
      (payload as any)?.pdf_path ||
      (payload as any)?.pdf ||
      (payload as any)?.meta?.pdf_path ||
      (payload as any)?.meta?.pdf;
    const detail = {
      href: options.href,
      dqid,
      payload,
      lookupPath: this.dqLookupPath,
      title: (payload as any)?.title || options.dataQuoteText || options.anchorText || "",
      anchorText: options.anchorText || "",
      source: "write",
      preferredPanel: 3,
      meta: {
        ...(payload as any)?.meta,
        pdf_path: pdfPath
      }
    };
    console.info("[write][anchor-text]", options.anchorText || "");
    console.info("[write][anchor-click]", detail);
    document.dispatchEvent(new CustomEvent("analyse-open-pdf", { bubbles: true, detail }));
  }

  private attachAnchorListener(): void {
    const leditorHandler = async (ev: Event): Promise<void> => {
      const detail = (ev as CustomEvent<any>).detail || {};
      if (detail.anchorId) {
        console.info("[write][anchor-id]", detail.anchorId);
      }
      console.info("[write][anchor-open][event]", detail);
      const href: string = (detail.href || "").trim();
      if (!href) return;
      const host = document.getElementById("write-leditor-host");
      if (!host) return;
      const explicitDqid =
        (detail.dqid || detail.dataQuoteId || detail.dataQuoteIdAlt || "").toString();
      await this.openPdfForAnchor({
        href,
        explicitDqid,
        anchorText: detail.text || "",
        dataQuoteText: detail.dataQuoteText || detail.title || ""
      });
    };
    this.leditorAnchorListener = leditorHandler;
    window.addEventListener("leditor-anchor-click", leditorHandler as EventListener);
    console.info("[write][anchor-listener] listening for leditor-anchor-click");
  }

  private attachAnchorDomLogger(): void {
    const handler = (ev: Event): void => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      const host = document.getElementById("write-leditor-host");
      if (!host || !host.contains(anchor)) return;
      const href = (anchor.getAttribute("href") || "").trim();
      if (!href) return;
      const dqid = this.extractDqid(href, anchor);
      const anchorId = this.computeAnchorId(anchor, dqid || undefined);
      console.info("[write][anchor-dom-click]", {
        anchorId,
        href,
        dqid,
        text: (anchor.textContent || "").trim()
      });
    };
    this.anchorDomListener = handler;
    this.anchorDomTarget = document;
    document.addEventListener("click", handler, true);
  }

  private computeAnchorId(anchor: HTMLAnchorElement, fallback?: string): string {
    const pick = (value?: string | null): string | undefined => {
      const trimmed = (value || "").trim();
      return trimmed ? trimmed : undefined;
    };
    return (
      pick(anchor.id) ||
      pick(anchor.getAttribute("data-key")) ||
      pick(anchor.getAttribute("item-key")) ||
      pick(anchor.getAttribute("data-item-key")) ||
      pick(anchor.getAttribute("data-quote-id")) ||
      pick(anchor.getAttribute("data-quote_id")) ||
      fallback ||
      ""
    );
  }

  private logAnchorState(): void {
    const root = document.getElementById("write-leditor-host");
    if (!root) return;
    const anchors = root.querySelectorAll(".ProseMirror a");
    console.info("[write][anchors]", { count: anchors.length });
    if (anchors.length > 0) {
      const sample = anchors[0] as HTMLAnchorElement;
      console.info("[write][anchors][sample]", {
        href: sample.getAttribute("href"),
        dataDqid: sample.getAttribute("data-dqid"),
        dataQuoteId: sample.getAttribute("data-quote-id"),
        dataQuoteIdAlt: sample.getAttribute("data-quote_id"),
        dataQuoteText: sample.getAttribute("data-quote-text"),
        title: sample.getAttribute("title"),
        text: sample.textContent || ""
      });
    }
  }

  private normalizeHtmlForEditor(html: string): string {
    const src = (html || "").trim();
    if (!src) return "";
    const doc = new DOMParser().parseFromString(src, "text/html");
    const selectors = [
      "section[data-coder-type]",
      "section.coder-folder",
      "section.coder-item",
      "div.coder-children",
      "div.coder-note"
    ];
    const nodes = doc.querySelectorAll(selectors.join(","));
    nodes.forEach((node) => {
      const parent = node.parentNode;
      if (!parent) return;
      while (node.firstChild) {
        parent.insertBefore(node.firstChild, node);
      }
      parent.removeChild(node);
    });
    return doc.body?.innerHTML.trim() ?? "";
  }

  private attachCitationGuard(): void {
    void this.waitForEditor().then((handle) => {
      const editor = (handle as any).getEditor?.();
      const dom = editor?.view?.dom as HTMLElement | undefined;
      if (!dom) return;

      const isLockedAnchor = (node: Node | null): HTMLAnchorElement | null => {
        if (!node) return null;
        const el =
          node.nodeType === Node.ELEMENT_NODE
            ? (node as HTMLElement)
            : node.parentElement;
        if (!el) return null;
        const anchor = el.closest("a") as HTMLAnchorElement | null;
        if (!anchor) return null;
        if (!anchor.closest("#write-leditor-host")) return null;
        const href = anchor.getAttribute("href") || "";
        const hasKey =
          anchor.hasAttribute("data-key") ||
          anchor.hasAttribute("item-key") ||
          anchor.hasAttribute("data-item-key") ||
          anchor.hasAttribute("data-dqid") ||
          anchor.hasAttribute("data-quote-id") ||
          anchor.hasAttribute("data-quote_id") ||
          href.startsWith("dq://") ||
          href.startsWith("dq:");
        return hasKey ? anchor : null;
      };

      const rangeHasLockedAnchor = (range: Range): boolean => {
        const container = range.commonAncestorContainer;
        if (isLockedAnchor(container)) return true;
        const fragment = range.cloneContents();
        return Boolean(
          fragment.querySelector?.(
            "a[data-key], a[item-key], a[data-item-key], a[data-dqid], a[data-quote-id], a[data-quote_id], a[href^=\"dq:\"], a[href^=\"dq://\"]"
          )
        );
      };

      const hasAdjacentLockedAnchor = (selection: Selection, key: "Backspace" | "Delete"): boolean => {
        if (!selection.isCollapsed || selection.rangeCount === 0) return false;
        const range = selection.getRangeAt(0);
        const container = range.startContainer;
        const offset = range.startOffset;

        if (container.nodeType === Node.TEXT_NODE) {
          const text = container as Text;
          if (key === "Backspace" && offset === 0) {
            return Boolean(isLockedAnchor(text.previousSibling));
          }
          if (key === "Delete" && offset >= (text.data?.length ?? 0)) {
            return Boolean(isLockedAnchor(text.nextSibling));
          }
          return false;
        }

        if (container.nodeType === Node.ELEMENT_NODE) {
          const el = container as Element;
          if (key === "Backspace" && offset > 0) {
            const node = el.childNodes[offset - 1] ?? null;
            return Boolean(isLockedAnchor(node));
          }
          if (key === "Delete") {
            const node = el.childNodes[offset] ?? null;
            return Boolean(isLockedAnchor(node));
          }
        }
        return false;
      };

      const onBeforeInput = (ev: InputEvent): void => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (rangeHasLockedAnchor(range)) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      };

      const onKeyDown = (ev: KeyboardEvent): void => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const range = selection.getRangeAt(0);
        if (rangeHasLockedAnchor(range)) {
          ev.preventDefault();
          ev.stopPropagation();
          return;
        }
        if ((ev.key === "Backspace" || ev.key === "Delete") && hasAdjacentLockedAnchor(selection, ev.key)) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      };

      dom.addEventListener("beforeinput", onBeforeInput);
      dom.addEventListener("keydown", onKeyDown, true);

      this.citationGuardListener = () => {
        dom.removeEventListener("beforeinput", onBeforeInput);
        dom.removeEventListener("keydown", onKeyDown, true);
      };
    });
  }

  private async handleContextAction(action: string, selectionHtml: string, selectionText: string): Promise<void> {
    switch (action) {
      case "ref_open_picker":
        await this.openRefPicker(selectionHtml);
        return;
      case "ref_insert_biblio":
        await this.updateReferencesFromEditor();
        await this.execEditorCommand("InsertBibliography");
        return;
      case "ref_update_from_editor":
        await this.updateReferencesFromEditor();
        return;
      case "ref_style_apa":
        await this.execEditorCommand("SetCitationStyle", { style: "apa" });
        return;
      case "ref_style_numeric":
        await this.execEditorCommand("SetCitationStyle", { style: "numeric" });
        return;
      case "ref_style_footnote":
        await this.execEditorCommand("SetCitationStyle", { style: "footnote" });
        return;
      case "subst":
      case "refine":
      case "verify":
        await this.openSelectionReview(action, selectionHtml, selectionText);
        return;
      default:
        return;
    }
  }

  private async execEditorCommand(command: string, args?: any): Promise<void> {
    const handle = await this.waitForEditor();
    handle.execCommand(command, args);
  }

  private async openRefPicker(selectionHtml: string): Promise<void> {
    const runPath = await this.resolveRunPath("ref-picker");
    if (!runPath) {
      console.warn("[write][refs] missing active run path");
      return;
    }
    const lookup = await this.ensureDqLookup(runPath);
    const refIndex = await this.ensureRefIndex(runPath, lookup);
    const preselectKeys = this.extractItemKeysFromHtml(selectionHtml || "", lookup);

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "modal";
    dialog.style.maxWidth = "720px";
    dialog.style.width = "90vw";
    dialog.style.maxHeight = "80vh";
    dialog.style.display = "flex";
    dialog.style.flexDirection = "column";

    const title = document.createElement("h3");
    title.textContent = "References";
    title.style.margin = "0 0 8px 0";
    dialog.appendChild(title);

    const search = document.createElement("input");
    search.className = "modal-search";
    search.placeholder = "Search author, title, source…";
    dialog.appendChild(search);

    const listWrap = document.createElement("div");
    listWrap.className = "modal-list";
    listWrap.style.flex = "1 1 auto";
    listWrap.style.overflow = "auto";
    listWrap.style.display = "flex";
    listWrap.style.flexDirection = "column";
    listWrap.style.gap = "6px";
    dialog.appendChild(listWrap);

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const btnSelectAll = document.createElement("button");
    btnSelectAll.textContent = "Select all";
    btnSelectAll.className = "button-ghost";
    btnSelectAll.title = "Select all references";
    btnSelectAll.ariaLabel = "Select all references";
    btnSelectAll.dataset.voiceAliases = "select all,select all references";
    actions.appendChild(btnSelectAll);

    const btnClear = document.createElement("button");
    btnClear.textContent = "Clear";
    btnClear.className = "button-ghost";
    btnClear.title = "Clear reference selection";
    btnClear.ariaLabel = "Clear reference selection";
    btnClear.dataset.voiceAliases = "clear selection";
    actions.appendChild(btnClear);

    const btnCancel = document.createElement("button");
    btnCancel.textContent = "Cancel";
    btnCancel.className = "button-ghost";
    btnCancel.title = "Cancel reference selection";
    btnCancel.ariaLabel = "Cancel reference selection";
    btnCancel.dataset.voiceAliases = "cancel,close";
    actions.appendChild(btnCancel);

    const btnInsert = document.createElement("button");
    btnInsert.textContent = "Insert selected";
    btnInsert.className = "button-ghost";
    btnInsert.style.borderColor = "var(--accent, #60a5fa)";
    btnInsert.style.color = "var(--accent, #60a5fa)";
    btnInsert.title = "Insert selected references";
    btnInsert.ariaLabel = "Insert selected references";
    btnInsert.dataset.voiceAliases = "insert selected,insert references,apply selected references";
    actions.appendChild(btnInsert);

    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const state = new Set(preselectKeys);
    const render = () => {
      const query = search.value.trim().toLowerCase();
      listWrap.innerHTML = "";
      const items = Array.from(refIndex.values()).sort((a, b) =>
        (a.author || a.title || a.item_key).localeCompare(b.author || b.title || b.item_key)
      );
      const filtered = query
        ? items.filter((rec) =>
            [rec.author, rec.title, rec.source].some((val) => val && val.toLowerCase().includes(query))
          )
        : items;

      filtered.forEach((rec) => {
        const row = document.createElement("label");
        row.style.display = "flex";
        row.style.gap = "10px";
        row.style.alignItems = "flex-start";
        row.style.padding = "6px 8px";
        row.style.border = "1px solid var(--border, #1f2937)";
        row.style.borderRadius = "10px";
        row.style.cursor = "pointer";

        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = state.has(rec.item_key);
        box.addEventListener("change", () => {
          if (box.checked) {
            state.add(rec.item_key);
          } else {
            state.delete(rec.item_key);
          }
        });

        const meta = document.createElement("div");
        meta.style.display = "flex";
        meta.style.flexDirection = "column";
        meta.style.gap = "2px";
        const top = document.createElement("div");
        top.textContent = rec.author && rec.year ? `${rec.author} (${rec.year})` : rec.author || rec.item_key;
        top.style.fontWeight = "600";
        const mid = document.createElement("div");
        mid.textContent = rec.title || "Untitled";
        mid.style.fontSize = "12px";
        mid.style.color = "var(--muted, #94a3b8)";
        const bot = document.createElement("div");
        bot.textContent = rec.source || "";
        bot.style.fontSize = "12px";
        bot.style.color = "var(--muted, #94a3b8)";
        meta.appendChild(top);
        meta.appendChild(mid);
        meta.appendChild(bot);

        row.appendChild(box);
        row.appendChild(meta);
        listWrap.appendChild(row);
      });
    };

    const cleanup = () => {
      backdrop.remove();
    };

    btnSelectAll.addEventListener("click", () => {
      refIndex.forEach((_rec, key) => state.add(key));
      render();
    });
    btnClear.addEventListener("click", () => {
      state.clear();
      render();
    });
    btnCancel.addEventListener("click", cleanup);
    btnInsert.addEventListener("click", async () => {
      const keys = Array.from(state);
      await this.insertCitations(keys, refIndex);
      cleanup();
    });
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) cleanup();
    });

    render();
    search.addEventListener("input", render);
    search.focus();
  }

  private async insertCitations(keys: string[], refIndex: Map<string, RefRecord>): Promise<void> {
    if (!keys.length) return;
    const handle = await this.waitForEditor();
    for (const key of keys) {
      const rec = refIndex.get(key);
      if (!rec) continue;
      const label = this.buildCitationLabel(rec);
      handle.execCommand("InsertCitation", {
        source: {
          id: rec.item_key,
          label,
          title: rec.title,
          author: rec.author,
          year: rec.year,
          url: rec.url
        }
      });
    }
    handle.execCommand("UpdateCitations");
    handle.execCommand("UpdateBibliography");
  }

  private buildCitationLabel(rec: RefRecord): string {
    const author = rec.author || rec.item_key;
    const year = rec.year || "";
    return year ? `${author} ${year}` : author;
  }

  private async updateReferencesFromEditor(): Promise<void> {
    const runPath = await this.resolveRunPath("refs-update");
    if (!runPath) {
      console.warn("[write][refs] missing active run path");
      return;
    }
    const lookup = await this.ensureDqLookup(runPath);
    const refIndex = await this.ensureRefIndex(runPath, lookup);
    const handle = await this.waitForEditor();
    const html = String(handle.getContent({ format: "html" }) || "");
    const existingSources = this.extractCitationSourcesFromHtml(html);
    const keys = this.extractItemKeysFromHtml(html, lookup);
    const nextSources = this.mergeCitationSources(existingSources, keys, refIndex);
    if (nextSources.length) {
      handle.execCommand("SetCitationSources", { sources: nextSources });
    }
    handle.execCommand("UpdateCitations");
    handle.execCommand("UpdateBibliography");
  }

  private extractCitationSourcesFromHtml(html: string): CitationSource[] {
    try {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const node = doc.querySelector("div[data-citation-sources]");
      if (!node) return [];
      const raw = node.getAttribute("data-sources");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const id = String((entry as any).id || "").trim();
          if (!id) return null;
          return {
            id,
            label: typeof (entry as any).label === "string" ? (entry as any).label : undefined,
            title: typeof (entry as any).title === "string" ? (entry as any).title : undefined,
            author: typeof (entry as any).author === "string" ? (entry as any).author : undefined,
            year: typeof (entry as any).year === "string" ? (entry as any).year : undefined,
            url: typeof (entry as any).url === "string" ? (entry as any).url : undefined,
            note: typeof (entry as any).note === "string" ? (entry as any).note : undefined
          } as CitationSource;
        })
        .filter((entry): entry is CitationSource => Boolean(entry));
    } catch {
      return [];
    }
  }

  private mergeCitationSources(
    existing: CitationSource[],
    keys: string[],
    refIndex: Map<string, RefRecord>
  ): CitationSource[] {
    const merged = new Map<string, CitationSource>();
    existing.forEach((src) => merged.set(src.id, src));
    keys.forEach((key) => {
      const rec = refIndex.get(key);
      if (!rec) return;
      merged.set(key, {
        id: key,
        label: this.buildCitationLabel(rec),
        title: rec.title,
        author: rec.author,
        year: rec.year,
        url: rec.url
      });
    });
    return Array.from(merged.values());
  }

  private extractItemKeysFromHtml(html: string, dqLookup: Record<string, unknown>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (key: string) => {
      const k = String(key || "").trim();
      if (!k || seen.has(k)) return;
      seen.add(k);
      out.push(k);
    };
    const pushGroup = (group: string) => {
      String(group || "")
        .split(";")
        .forEach((part) => push(part));
    };

    const s = String(html || "");
    const attrMatches = [
      ...s.matchAll(/\bdata-item-keys\s*=\s*['"]([^'"]+)['"]/gi),
      ...s.matchAll(/\bdata-item-key\s*=\s*['"]([^'"]+)['"]/gi),
      ...s.matchAll(/\bdata-key\s*=\s*['"]([^'"]+)['"]/gi),
      ...s.matchAll(/\bdata-citation-id\s*=\s*['"]([^'"]+)['"]/gi)
    ];
    attrMatches.forEach((m) => {
      if (m[0].toLowerCase().includes("data-item-keys")) {
        pushGroup(m[1]);
      } else {
        push(m[1]);
      }
    });

    const hrefMatches = [
      ...s.matchAll(/\bhref\s*=\s*['"]citegrp:\/\/([^'"]+)['"]/gi),
      ...s.matchAll(/\bhref\s*=\s*['"]cite:\/\/([^'"]+)['"]/gi),
      ...s.matchAll(/\bhref\s*=\s*['"]dq:\/\/([^'"]+)['"]/gi)
    ];
    hrefMatches.forEach((m) => {
      if (m[0].toLowerCase().includes("citegrp://")) {
        pushGroup(m[1]);
        return;
      }
      if (m[0].toLowerCase().includes("cite://")) {
        push(m[1]);
        return;
      }
      if (m[0].toLowerCase().includes("dq://")) {
        const dqid = String(m[1] || "").trim();
        const payload = dqLookup[dqid] as any;
        if (payload?.item_key) {
          push(String(payload.item_key));
        }
      }
    });

    return out;
  }

  private async ensureRefIndex(
    runPath: string,
    dqLookup: Record<string, unknown>
  ): Promise<Map<string, RefRecord>> {
    if (this.refIndex && this.refIndexRunPath === runPath) {
      return this.refIndex;
    }
    const map = new Map<string, RefRecord>();
    Object.entries(dqLookup).forEach(([dqid, payload]) => {
      if (!payload || typeof payload !== "object") return;
      const itemKey = String((payload as any).item_key || "").trim();
      if (!itemKey) return;
      const author = String(
        (payload as any).first_author_last || (payload as any).author_summary || ""
      ).trim();
      const year = String((payload as any).year || "").trim();
      const title = String((payload as any).title || "").trim();
      const source = String((payload as any).source || "").trim();
      const url = String((payload as any).url || "").trim();

      const existing = map.get(itemKey);
      if (existing) {
        existing.dqids.push(dqid);
        return;
      }
      map.set(itemKey, {
        item_key: itemKey,
        author,
        year,
        title,
        source,
        url,
        dqids: [dqid]
      });
    });
    this.refIndex = map;
    this.refIndexRunPath = runPath;
    return map;
  }

  private async openSelectionReview(action: string, selectionHtml: string, selectionText: string): Promise<void> {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";

    const dialog = document.createElement("div");
    dialog.className = "modal";
    dialog.style.maxWidth = "720px";
    dialog.style.width = "90vw";
    dialog.style.maxHeight = "80vh";
    dialog.style.display = "flex";
    dialog.style.flexDirection = "column";
    dialog.style.gap = "10px";

    const title = document.createElement("h3");
    const label =
      action === "subst" ? "Substantiate" : action === "refine" ? "Refine" : "Verify sources";
    title.textContent = label;
    title.style.margin = "0";
    dialog.appendChild(title);

    const body = document.createElement("div");
    body.style.flex = "1 1 auto";
    body.style.overflow = "auto";
    body.style.fontSize = "13px";
    body.style.lineHeight = "1.6";
    if (selectionHtml) {
      body.innerHTML = selectionHtml;
    } else {
      body.textContent = selectionText || "No selection.";
    }
    dialog.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "modal-actions";
    const close = document.createElement("button");
    close.className = "button-ghost";
    close.textContent = "Close";
    close.title = "Close selection action dialog";
    close.ariaLabel = "Close selection action dialog";
    close.dataset.voiceAliases = "close dialog,close window";
    footer.appendChild(close);
    dialog.appendChild(footer);

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const cleanup = () => backdrop.remove();
    close.addEventListener("click", cleanup);
    backdrop.addEventListener("click", (ev) => {
      if (ev.target === backdrop) cleanup();
    });

    console.info("[write][selection-action]", { action, selectionText, selectionHtmlLen: selectionHtml.length });
  }

  private async reloadFromDisk(): Promise<void> {
    const loaded = await loadPersistentCoderState(this.scopeId);
    if (!loaded) return;
    this.store.replaceTree(loaded.state.nodes, { source: "reload", skipPersist: true, skipEditedHtml: true });
    this.currentFolderId = this.pickFolderId(this.store.snapshot());
    await this.pushContentToEditor();
  }
}
