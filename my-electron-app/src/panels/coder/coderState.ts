import {
  CODER_MIME,
  CODER_SCOPE_DEFAULT,
  CODER_SCOPE_SEPARATOR,
  CODER_STORAGE_KEY,
  CODER_STATUSES,
  CoderNode,
  CoderPayload,
  CoderScopeId,
  CoderState,
  CoderStatus,
  FolderNode,
  ItemNode,
  MoveSpec,
  NodePath,
  PersistentCoderState
} from "./coderTypes";

const STATE_VERSION = 3;

function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `coder_${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
}

function deriveTitle(payload: CoderPayload): string {
  const raw =
    (payload.paraphrase as string | undefined) ||
    (payload.direct_quote as string | undefined) ||
    (payload.title as string | undefined) ||
    (payload.text as string | undefined) ||
    "";
  const trimmed = raw.trim() || "Selection";
  return trimmed.length > 80 ? `${trimmed.slice(0, 80).trimEnd()}…` : trimmed;
}

export function createFolder(name = "Section"): FolderNode {
  return {
    id: generateId(),
    type: "folder",
    name: name || "Section",
    children: [],
    note: "",
    editedHtml: "",
    updatedUtc: nowUtc()
  };
}

export function createItem(payload: CoderPayload): ItemNode {
  return {
    id: generateId(),
    type: "item",
    name: deriveTitle(payload),
    status: "Included",
    payload,
    note: "",
    updatedUtc: nowUtc()
  };
}

function cloneState(state: CoderState): CoderState {
  return JSON.parse(JSON.stringify(state)) as CoderState;
}

function storageKeyForScope(scopeId?: CoderScopeId): string {
  if (!scopeId) {
    return CODER_STORAGE_KEY;
  }
  const safeScope = String(scopeId || CODER_SCOPE_DEFAULT).replace(/[^a-zA-Z0-9_-]+/g, "-");
  return `${CODER_STORAGE_KEY}${CODER_SCOPE_SEPARATOR}${safeScope}`;
}

function readStateFromStorage(key: string): CoderState | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CoderState) : null;
  } catch {
    return null;
  }
}

export function loadState(scopeId?: CoderScopeId): CoderState {
  try {
    const scopedKey = storageKeyForScope(scopeId);
    const parsed = readStateFromStorage(scopedKey);
    if (parsed && Array.isArray(parsed.nodes)) {
      return {
        version: parsed.version ?? STATE_VERSION,
        nodes: parsed.nodes,
        collapsedIds: Array.isArray(parsed.collapsedIds) ? parsed.collapsedIds.map(String) : []
      };
    }

    if (scopeId) {
      const fallback = readStateFromStorage(CODER_STORAGE_KEY);
      if (fallback && Array.isArray(fallback.nodes)) {
        return {
          version: fallback.version ?? STATE_VERSION,
          nodes: fallback.nodes,
          collapsedIds: Array.isArray(fallback.collapsedIds) ? fallback.collapsedIds.map(String) : []
        };
      }
    }
  } catch {
    // ignore parse/storage issues and fall back to default state
  }
  const root = createFolder("My collection");
  return { version: STATE_VERSION, nodes: [root], collapsedIds: [] };
}

export function saveState(state: CoderState, scopeId?: CoderScopeId): void {
  try {
    localStorage.setItem(storageKeyForScope(scopeId), JSON.stringify(state));
  } catch {
    // best-effort persistence; renderer should still function
  }
}

function findPath(nodes: CoderNode[], id: string, parent: FolderNode | null = null): NodePath | null {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.id === id) {
      return { parent, index: i, node };
    }
    if (node.type === "folder") {
      const hit = findPath(node.children, id, node);
      if (hit) {
        return hit;
      }
    }
  }
  return null;
}

function removeNode(nodes: CoderNode[], id: string): { removed: CoderNode | null; parentList: CoderNode[] } {
  const path = findPath(nodes, id);
  if (!path) {
    return { removed: null, parentList: nodes };
  }
  const list = path.parent ? path.parent.children : nodes;
  const [removed] = list.splice(path.index, 1);
  return { removed: removed ?? null, parentList: list };
}

function insertNode(
  nodes: CoderNode[],
  node: CoderNode,
  targetParentId: string | null,
  targetIndex?: number
): void {
  if (targetParentId === null) {
    const idx = targetIndex ?? nodes.length;
    nodes.splice(idx, 0, node);
    return;
  }
  const targetPath = findPath(nodes, targetParentId);
  if (!targetPath || targetPath.node.type !== "folder") {
    throw new Error("Target parent not found or not a folder");
  }
  const children = targetPath.node.children;
  const idx = targetIndex ?? children.length;
  children.splice(idx, 0, node);
}

function ensureRootFolder(state: CoderState): void {
  if (!Array.isArray(state.collapsedIds)) {
    state.collapsedIds = [];
  }
  if (state.nodes.length === 0 || state.nodes[0].type !== "folder") {
    const fallback = createFolder("My collection");
    state.nodes.unshift(fallback);
  }
}

export class CoderStore {
  private state: CoderState;
  private listeners = new Set<(state: CoderState) => void>();
  private readonly scopeId?: CoderScopeId;
  private lastStatePath: string | null = null;
  private lastBaseDir: string | null = null;
  private persistTimer: number | null = null;
  private persistPendingState: CoderState | null = null;
  private persistPendingSource: string | undefined;
  private persistLocalTimer: number | null = null;
  private persistLocalPending: CoderState | null = null;

  constructor(initial?: CoderState, scopeId?: CoderScopeId) {
    this.scopeId = scopeId;
    this.state = initial ? cloneState(initial) : loadState(scopeId);
    ensureRootFolder(this.state);
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", () => {
        // Best-effort flush of pending persistence work.
        if (this.persistLocalTimer !== null) {
          window.clearTimeout(this.persistLocalTimer);
          this.persistLocalTimer = null;
        }
        if (this.persistTimer !== null) {
          window.clearTimeout(this.persistTimer);
          this.persistTimer = null;
        }
        if (this.persistLocalPending) {
          try {
            saveState(this.persistLocalPending, this.scopeId);
          } catch {
            // ignore
          }
        }
        if (this.persistPendingState) {
          try {
            // Fire-and-forget; may not finish before unload.
            this.persistState(this.persistPendingState, this.persistPendingSource);
          } catch {
            // ignore
          }
        }
      });
    }
  }

  subscribe(listener: (state: CoderState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  snapshot(): CoderState {
    return cloneState(this.state);
  }

  addFolder(name: string, parentId: string | null): FolderNode {
    const next = cloneState(this.state);
    ensureRootFolder(next);
    const folder = createFolder(name || "Section");
    const parentTarget = parentId ? parentId : null;
    insertNode(next.nodes, folder, parentTarget);
    this.commit(next);
    return folder;
  }

  addItem(payload: CoderPayload, parentId: string | null): ItemNode {
    const next = cloneState(this.state);
    ensureRootFolder(next);
    const item = createItem(payload);
    const parentTarget = parentId ? parentId : null;
    insertNode(next.nodes, item, parentTarget);
    this.commit(next);
    return item;
  }

  rename(nodeId: string, name: string): void {
    const next = cloneState(this.state);
    const path = findPath(next.nodes, nodeId);
    if (!path) return;
    path.node.name = name || (path.node.type === "folder" ? "Section" : "Selection");
    path.node.updatedUtc = nowUtc();
    this.commit(next);
  }

  setStatus(nodeId: string, status: CoderStatus): void {
    if (!CODER_STATUSES.includes(status)) return;
    const next = cloneState(this.state);
    const path = findPath(next.nodes, nodeId);
    if (!path || path.node.type !== "item") return;
    path.node.status = status;
    path.node.updatedUtc = nowUtc();
    this.commit(next);
  }

  setNote(folderId: string, note: string): void {
    const next = cloneState(this.state);
    const path = findPath(next.nodes, folderId);
    if (!path || path.node.type !== "folder") return;
    path.node.note = note;
    path.node.updatedUtc = nowUtc();
    this.commit(next);
  }

  setFolderCollapsed(folderId: string, collapsed: boolean): void {
    const next = cloneState(this.state);
    const path = findPath(next.nodes, folderId);
    if (!path || path.node.type !== "folder") return;
    const existing = new Set((next.collapsedIds || []).map(String));
    if (collapsed) {
      existing.add(folderId);
    } else {
      existing.delete(folderId);
    }
    next.collapsedIds = Array.from(existing);
    this.commit(next, { skipEditedHtml: true });
  }

  setCollapsedFolders(folderIds: string[], collapsed: boolean): void {
    const next = cloneState(this.state);
    const existing = new Set((next.collapsedIds || []).map(String));
    folderIds.forEach((id) => {
      if (collapsed) {
        existing.add(id);
      } else {
        existing.delete(id);
      }
    });
    next.collapsedIds = Array.from(existing);
    this.commit(next, { skipEditedHtml: true });
  }

  delete(nodeId: string): void {
    const next = cloneState(this.state);
    const { removed } = removeNode(next.nodes, nodeId);
    if (!removed) return;
    ensureRootFolder(next);
    this.commit(next);
  }

  deleteWithSnapshot(nodeId: string): { node: CoderNode; parentId: string | null; index: number } | null {
    const next = cloneState(this.state);
    const path = findPath(next.nodes, nodeId);
    if (!path) return null;
    const parentId = path.parent ? path.parent.id : null;
    const index = path.index;
    const { removed } = removeNode(next.nodes, nodeId);
    if (!removed) return null;
    ensureRootFolder(next);
    this.commit(next);
    return { node: removed, parentId, index };
  }

  move(spec: MoveSpec): void {
    const next = cloneState(this.state);
    const { removed: node } = removeNode(next.nodes, spec.nodeId);
    if (!node) return;
    insertNode(next.nodes, node, spec.targetParentId ?? null, spec.targetIndex);
    this.commit(next);
  }

  restoreNode(node: CoderNode, parentId: string | null, index: number): void {
    const next = cloneState(this.state);
    insertNode(next.nodes, node, parentId ?? null, index);
    this.commit(next);
  }

  replaceTree(
    nodes: CoderNode[],
    options: { source?: string; skipPersist?: boolean; skipEditedHtml?: boolean; collapsedIds?: string[] } = {}
  ): void {
    const next: CoderState = {
      version: STATE_VERSION,
      nodes: cloneState({ version: STATE_VERSION, nodes }).nodes,
      collapsedIds: Array.isArray(options.collapsedIds) ? options.collapsedIds.map(String) : this.state.collapsedIds ?? []
    };
    ensureRootFolder(next);
    this.commit(next, {
      source: options.source,
      skipPersist: options.skipPersist,
      skipEditedHtml: options.skipEditedHtml
    });
  }

  updateEditedHtml(nodeId: string, html: string, source?: string): void {
    const next = cloneState(this.state);
    const path = findPath(next.nodes, nodeId);
    if (!path || path.node.type !== "folder") return;
    path.node.editedHtml = String(html || "");
    path.node.updatedUtc = nowUtc();
    this.commit(next, { skipEditedHtml: true, source });
  }

  async loadFromDisk(): Promise<PersistentCoderState | null> {
    const result = await loadPersistentCoderState(this.scopeId);
    if (!result) return null;
    this.lastBaseDir = result.baseDir;
    this.lastStatePath = result.statePath;
    this.replaceTree(result.state.nodes, {
      source: "loadFromDisk",
      skipPersist: true,
      collapsedIds: result.state.collapsedIds
    });
    return result;
  }

  private commit(
    next: CoderState,
    options: { skipEditedHtml?: boolean; source?: string; skipPersist?: boolean } = {}
  ): void {
    ensureRootFolder(next);
    if (!options.skipEditedHtml) {
      syncEditedHtmlForState(next);
    }
    this.state = next;
    // Keep UI responsive: persistence is best-effort and can be expensive for large trees.
    // - LocalStorage writes are synchronous (main-thread) -> debounce.
    // - Disk persistence is async but still serializes large JSON -> debounce + coalesce.
    this.scheduleLocalPersist(next);
    if (!options.skipPersist) {
      this.scheduleDiskPersist(next, options.source);
    }
    this.listeners.forEach((fn) => fn(this.state));
  }

  private scheduleLocalPersist(state: CoderState): void {
    this.persistLocalPending = state;
    if (this.persistLocalTimer !== null) {
      window.clearTimeout(this.persistLocalTimer);
    }
    this.persistLocalTimer = window.setTimeout(() => {
      this.persistLocalTimer = null;
      const pending = this.persistLocalPending;
      this.persistLocalPending = null;
      if (!pending) return;
      saveState(pending, this.scopeId);
    }, 250);
  }

  private scheduleDiskPersist(state: CoderState, source?: string): void {
    this.persistPendingState = state;
    this.persistPendingSource = source;
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      const pending = this.persistPendingState;
      const pendingSource = this.persistPendingSource;
      this.persistPendingState = null;
      this.persistPendingSource = undefined;
      if (!pending) return;
      this.persistState(pending, pendingSource);
    }, 800);
  }

  private persistState(state: CoderState, source?: string): void {
    savePersistentCoderState(state, this.scopeId)
      .then((result) => {
        if (!result) return;
        if (result.statePath) {
          this.lastStatePath = result.statePath;
        }
        if (result.baseDir) {
          this.lastBaseDir = result.baseDir;
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("coder:stateSaved", {
              detail: {
                scopeId: this.scopeId ?? null,
                statePath: this.lastStatePath,
                baseDir: this.lastBaseDir,
                source: source || null
              }
            })
          );
        }
      })
      .catch((error) => {
        console.warn("[CoderStore] Failed to persist coder state", error);
      });
  }

  getLastStatePath(): string | null {
    return this.lastStatePath;
  }

  getLastBaseDir(): string | null {
    return this.lastBaseDir;
  }
}

export function stripFragment(html: string): string {
  const src = (html || "").trim();
  if (!src) return "";
  const start = src.indexOf("<!--StartFragment-->");
  const end = src.indexOf("<!--EndFragment-->");
  if (start >= 0 && end > start) {
    return src.slice(start + "<!--StartFragment-->".length, end).trim();
  }
  const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    return (bodyMatch[1] || "").trim();
  }
  return src.replace(/<!doctype.*?>/gis, "").replace(/<\/?html[^>]*>/gis, "").replace(/<\/?head[^>]*>.*?<\/head>/gis, "").trim();
}

export function normalizePayloadHtml(payload: CoderPayload): string {
  const html = (payload.html as string | undefined) || (payload.section_html as string | undefined) || "";
  const frag = stripFragment(html);
  return frag || `<p>${escapeHtml((payload.text as string | undefined) || deriveTitle(payload))}</p>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EXPORT_CSS = `
    html, body {
      background:#020617;
      color:#e5e7eb;
      margin:24px auto;
      max-width:980px;
      font-family: Inter, system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    h1,h2,h3,h4,h5,h6 { font-weight:650; margin:1.25em 0 .55em 0; line-height:1.25; }
    p { line-height:1.65; margin:.70em 0; }
    a { color:#93c5fd; text-decoration: underline; }
    a:hover { text-decoration: none; }
    code { background: rgba(255,255,255,0.06); padding: 1px 4px; border-radius: 6px; }
    hr { border:0; border-top:1px solid rgba(148,163,184,0.35); margin:1.35em 0; }
    .meta { color:#9ca3af; font-size:13px; }
`.trim();

export function wrapFullDocument(bodyHtml: string): string {
  const safeBody = bodyHtml || "<p><br></p>";
  return (
    "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
    "<title>Coder export</title><style>" +
    EXPORT_CSS +
    "</style></head><body>" +
    safeBody +
    "</body></html>"
  );
}

function headingTag(depth: number): string {
  const normalized = Math.max(1, Math.min(6, depth));
  return `h${normalized}`;
}

function emitNoteHtml(note?: string): string {
  const text = (note || "").trim();
  if (!text) return "";
  const lines = text.split(/\n+/);
  const parts: string[] = [];
  lines.forEach((para) => {
    const sanitized = para.trim();
    if (sanitized) {
      parts.push(`<p>${escapeHtml(sanitized)}</p>`);
    }
  });
  return parts.join("");
}

function buildItemSection(item: ItemNode): string {
  const frag = normalizePayloadHtml(item.payload);
  if (frag.trim()) {
    return `<section class='coder-item' data-coder-type='item' data-coder-id='${escapeHtml(item.id)}'>${frag}</section>`;
  }
  const fallbackText = (item.name || "Selection").trim();
  return `<section class='coder-item' data-coder-type='item' data-coder-id='${escapeHtml(item.id)}'><p>${escapeHtml(fallbackText)}</p></section>`;
}

function buildFolderSectionHtml(folder: FolderNode, depth: number): string {
  const tag = headingTag(depth);
  const escapedId = escapeHtml(folder.id);
  const title = escapeHtml(folder.name || "Section");
  const note = emitNoteHtml(folder.note);
  const childrenParts: string[] = [];
  for (const child of folder.children) {
    if (child.type === "folder") {
      childrenParts.push(buildFolderSectionHtml(child, depth + 1));
      continue;
    }
    childrenParts.push(buildItemSection(child));
  }
  return (
    `<section class='coder-folder' data-coder-type='folder' data-coder-id='${escapedId}'>` +
    `<${tag} class='coder-title'>${title}</${tag}>` +
    `<div class='coder-note' data-coder-type='note' data-coder-id='note:${escapedId}'>${note}</div>` +
    `<div class='coder-children'>${childrenParts.join("")}</div>` +
    `</section>`
  );
}

export function buildFolderDocumentHtml(folder: FolderNode, depth = 1): string {
  return wrapFullDocument(buildFolderSectionHtml(folder, depth));
}

function syncEditedHtmlForState(state: CoderState): void {
  const shouldRegenerate = (existing: string | undefined): boolean => {
    const html = String(existing || "").trim();
    if (!html) return true;
    return /data-coder-type=|class=['"]coder-(folder|item)|<section[^>]+coder-(folder|item)/i.test(html);
  };
  const walk = (folder: FolderNode, depth: number): void => {
    const html = buildFolderSectionHtml(folder, depth);
    if (shouldRegenerate(folder.editedHtml)) {
      folder.editedHtml = wrapFullDocument(html);
    }
    folder.children.forEach((child) => {
      if (child.type === "folder") {
        walk(child, depth + 1);
      }
    });
  };
  state.nodes.forEach((node) => {
    if (node.type === "folder") {
      walk(node, 1);
    }
  });
}

function createRootState(): CoderState {
  return { version: STATE_VERSION, nodes: [createFolder("My collection")], collapsedIds: [] };
}

function normalizeSavedNodes(rawNodes: unknown[]): CoderNode[] {
  const toNode = (value: any): CoderNode => {
    if (!value || typeof value !== "object") {
      return createFolder("Section");
    }
    const type = value.type === "item" ? "item" : "folder";
    if (type === "folder") {
      const children = Array.isArray(value.children) ? value.children.map(toNode) : [];
      return {
        id: String(value.id || generateId()),
        type: "folder",
        name: String(value.name || "Section"),
        note: String(value.note || "") || "",
        editedHtml: String(value.edited_html || value.editedHtml || ""),
        updatedUtc: String(value.updated_utc || value.updatedUtc || nowUtc()),
        children
      };
    }
    return {
      id: String(value.id || generateId()),
      type: "item",
      name: String(value.name || value.title || "Selection"),
      status: CODER_STATUSES.includes(value.status) ? value.status : "Included",
      payload: (value.payload || value) as CoderPayload,
      note: String(value.note || "") || "",
      editedHtml: String(value.edited_html || value.editedHtml || ""),
      updatedUtc: String(value.updated_utc || value.updatedUtc || nowUtc())
    };
  };
  return rawNodes.map(toNode);
}

export function treeToLines(nodes: CoderNode[], depth = 0): string[] {
  const prefix = "  ".repeat(depth);
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.type === "folder") {
      lines.push(`${prefix}📁 ${node.name} (${node.id})`);
      const children = treeToLines(node.children, depth + 1);
      lines.push(...children);
    } else {
      lines.push(`${prefix}📄 ${node.name} (${node.id}) [${node.status}]`);
    }
  }
  return lines;
}

function ensureStateStructure(candidate: unknown): CoderState {
  if (candidate && typeof candidate === "object") {
    const typed = candidate as { version?: number; nodes?: unknown[]; collapsedIds?: unknown[]; collapsed_ids?: unknown[] };
    if (Array.isArray(typed.nodes) && typed.nodes.length > 0) {
      const version = typeof typed.version === "number" ? typed.version : STATE_VERSION;
      const rawCollapsed = Array.isArray(typed.collapsedIds)
        ? typed.collapsedIds
        : Array.isArray(typed.collapsed_ids)
        ? typed.collapsed_ids
        : [];
      const normalized: CoderState = {
        version,
        nodes: normalizeSavedNodes(typed.nodes),
        collapsedIds: rawCollapsed.map(String)
      };
      ensureRootFolder(normalized);
      return normalized;
    }
  }
  return createRootState();
}

type BridgeLoadResponse = { state: unknown; baseDir: string; statePath: string };
type BridgeSaveResponse = { baseDir: string; statePath: string };

export async function loadPersistentCoderState(scopeId?: CoderScopeId): Promise<PersistentCoderState | null> {
  if (typeof window === "undefined" || !window.coderBridge?.loadState) {
    return null;
  }
  try {
    const result = (await window.coderBridge.loadState({ scopeId })) as BridgeLoadResponse | null;
    if (!result || !result.state) {
      return null;
    }
    const normalized = ensureStateStructure(result.state);
    console.info(`[CODER][STATE] loaded ${result.statePath}`);
    return { state: normalized, baseDir: result.baseDir, statePath: result.statePath };
  } catch (error) {
    console.warn("[CoderState] Unable to load persisted coder state", error);
    return null;
  }
}

export async function savePersistentCoderState(
  state: CoderState,
  scopeId?: CoderScopeId
): Promise<BridgeSaveResponse | null> {
  if (typeof window === "undefined" || !window.coderBridge?.saveState) {
    return null;
  }
  try {
    const result = (await window.coderBridge.saveState({ scopeId, state })) as BridgeSaveResponse | null;
    if (result?.statePath) {
      console.info(`[CODER][STATE] saved ${result.statePath}`);
    }
    return result;
  } catch (error) {
    console.warn("[CoderState] Unable to persist coder state", error);
    return null;
  }
}

export function findFolderById(state: CoderState, folderId: string): FolderNode | null {
  const search = (nodes: CoderNode[]): FolderNode | null => {
    for (const n of nodes) {
      if (n.type === "folder" && n.id === folderId) return n;
      if (n.type === "folder") {
        const hit = search(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return search(state.nodes);
}

export function getFolderEditedHtml(state: CoderState, folderId: string): string {
  const folder = findFolderById(state, folderId);
  if (!folder) return "";
  const existing = String(folder.editedHtml || "").trim();
  if (existing) return existing;
  return buildFolderDocumentHtml(folder, 1);
}

function findFirstItem(nodes: CoderNode[]): ItemNode | null {
  for (const node of nodes) {
    if (node.type === "item") {
      return node;
    }
    if (node.type === "folder") {
      const child = findFirstItem(node.children);
      if (child) return child;
    }
  }
  return null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function getFirstParagraphSnippet(state: CoderState): string | null {
  const item = findFirstItem(state.nodes);
  if (!item) return null;
  const html = (item.payload.section_html as string | undefined) || (item.payload.html as string | undefined) || "";
  if (html.trim()) {
    const frag = stripFragment(html);
    const match = frag.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    if (match && match[1]) {
      return collapseWhitespace(match[1].replace(/<[^>]+>/g, ""));
    }
    const text = frag.replace(/<[^>]+>/g, "");
    if (text.trim()) {
      return collapseWhitespace(text);
    }
  }
  const fallback = (item.payload.text as string | undefined) || (item.payload.title as string | undefined) || item.name || "";
  return fallback ? collapseWhitespace(fallback) : null;
}

export function rehydrateAnchors(html: string, metaMap: Record<string, Record<string, string>> | undefined): string {
  if (!metaMap || Object.keys(metaMap).length === 0) return html;
  return html.replace(/<a\b[^>]*href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi, (tag, h1, h2, h3) => {
    const href = (h1 || h2 || h3 || "").trim();
    const meta = metaMap[href] || metaMap[`dq://${href}`];
    if (!meta) return tag;
    const attrs: string[] = [];
    if (!/data-key=/i.test(tag)) attrs.push(`data-key="${escapeHtml(href)}"`);
    if (meta["data-dqid"] && !/data-dqid=/i.test(tag)) attrs.push(`data-dqid="${escapeHtml(String(meta["data-dqid"]))}"`);
    if (meta["data-quote-id"] && !/data-quote-id=/i.test(tag))
      attrs.push(`data-quote-id="${escapeHtml(String(meta["data-quote-id"]))}"`);
    if (meta["data-quote_id"] && !/data-quote_id=/i.test(tag))
      attrs.push(`data-quote_id="${escapeHtml(String(meta["data-quote_id"]))}"`);
    if (meta["data-orig-href"] && !/data-orig-href=/i.test(tag))
      attrs.push(`data-orig-href="${escapeHtml(String(meta["data-orig-href"]))}"`);
    if (!/title=/i.test(tag)) {
      const t = meta.title || meta["data-orig-href"] || href;
      attrs.push(`title="${escapeHtml(String(t))}"`);
    }
    const withoutEnd = tag.slice(0, -1);
    return `${withoutEnd} ${attrs.join(" ")}>`;
  });
}

export function parseDropPayload(dataTransfer: DataTransfer): { payload?: CoderPayload; plainText?: string } {
  if (!dataTransfer) return {};
  const formats = dataTransfer.types || [];
  if (formats.includes(CODER_MIME)) {
    try {
      const blob = dataTransfer.getData(CODER_MIME);
      const parsed = blob ? (JSON.parse(blob) as CoderPayload) : {};
      if (parsed.html && parsed.anchor_meta) {
        parsed.html = rehydrateAnchors(String(parsed.html), parsed.anchor_meta);
      }
      return { payload: parsed };
    } catch {
      // ignore malformed custom payload
    }
  }
  if (dataTransfer.types.includes("text/html")) {
    const htmlSrc = dataTransfer.getData("text/html");
    const extractText = (html: string): string => {
      const src = String(html || "");
      return src
        .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'")
        .replace(/\s+\n/g, "\n")
        .replace(/\n\s+/g, "\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
    };
    const text = dataTransfer.getData("text/plain") || extractText(htmlSrc) || "";
    return {
      payload: {
        title: text ? text.slice(0, 80) : extractText(htmlSrc).slice(0, 80) || "Selection",
        text,
        html: htmlSrc,
        source: { scope: "dragdrop" }
      }
    };
  }
  if (dataTransfer.types.includes("text/plain")) {
    const text = dataTransfer.getData("text/plain");
    return {
      payload: {
        title: text ? text.slice(0, 80) : "Selection",
        text,
        html: `<p>${escapeHtml(text).replace(/\n/g, "<br/>")}</p>`,
        source: { scope: "dragdrop" }
      },
      plainText: text
    };
  }
  return {};
}
