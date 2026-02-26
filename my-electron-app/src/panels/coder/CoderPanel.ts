import coderStyles from "./coderStyles.css";

import {
  CoderStore,
  normalizePayloadHtml,
  parseDropPayload,
  getFirstParagraphSnippet,
  treeToLines,
  getFolderEditedHtml,
  snippet80,
  DEFAULT_ITEM_TITLE,
  createFolder
} from "./coderState";
import type { CoderScopeId, CoderState } from "./coderTypes";
import { CODER_STATUSES, CoderNode, CoderPayload, CoderStatus, FolderNode, ItemNode } from "./coderTypes";
import { APPEARANCE_KEYS } from "../../config/settingsKeys";

const NODE_MIME = "application/x-annotarium-coder-node";
type RenderStats = { totalNodes: number; matched: number; matchedVisible: number; matchedIds: string[] };
type FlatNode = { node: CoderNode; depth: number; path: string[]; matchHit: boolean; hasActiveFilter: boolean };

export interface CoderPanelOptions {
  title?: string;
  initialTree?: CoderNode[];
  onPayloadSelected?: (payload: CoderPayload) => void;
  scopeId?: CoderScopeId;
  projectPath?: string;
  onStateLoaded?: (info: { baseDir: string; statePath: string }) => void;
}

export class CoderPanel {
  readonly element: HTMLElement;

  private store: CoderStore;
  private treeHost: HTMLElement;
  private savedPill!: HTMLElement;
  private syncPill!: HTMLElement;
  private selectionPill!: HTMLElement;
  private filterPill!: HTMLElement;
  private titleText?: HTMLElement;
  private defaultTitle: string;
  private projectPath: string | null = null;
  private filterInput!: HTMLInputElement;
  private filterStatus!: HTMLElement;
  private noteBox: HTMLDivElement;
  private noteInput: HTMLTextAreaElement;
  private noteInputDirty = false;
  private noteInputTargetId: string | null = null;
  private noteSaveTimer: number | null = null;
  private selection = new Set<string>();
  private primarySelection: string | null = null;
  private anchorSelection: string | null = null;
  private onPayloadSelected?: (payload: CoderPayload) => void;
  private previewOverlay?: HTMLElement;
  private previewTooltip?: HTMLDivElement;
  private previewTitle?: HTMLDivElement;
  private previewSnippet?: HTMLDivElement;
  private previewPinned = false;
  private previewPinnedId: string | null = null;
  private readonly scopeId?: CoderScopeId;
  private contextMenu?: HTMLElement;
  private contextMenuTarget?: CoderNode | null;
  private loadedStatePath: string | null = null;
  private loadedBaseDir: string | null = null;
  private stateLoadedCallback?: (info: { baseDir: string; statePath: string }) => void;
  private readonly globalClickHandler: (ev: MouseEvent) => void;
  private readonly treeContextHandler: (ev: MouseEvent) => void;
  private externalStateListener?: (ev: Event) => void;
  private unsubscribeStore?: () => void;
  private destroyed = false;
  private activeDropTargetId: string | null = null;
  private activeDropMode: "into" | "after" | "before" | null = null;
  private dropHint?: HTMLDivElement;
  private toast?: HTMLDivElement;
  private toastTimer?: number;
  private toastMessage?: HTMLElement;
  private toastActions?: HTMLElement;
  private toastUndoHandler?: () => void;
  private helpOverlay?: HTMLDivElement;
  private helpVisible = false;
  private paletteOverlay?: HTMLDivElement;
  private paletteInput?: HTMLInputElement;
  private paletteList?: HTMLDivElement;
  private paletteVisible = false;
  private paletteIndex = 0;
  private paletteFiltered: Array<{ id: string; label: string; keywords: string; enabled: boolean; run: () => void }> = [];
  private diagnosticsOverlay?: HTMLDivElement;
  private diagnosticsList?: HTMLDivElement;
  private diagnosticsVisible = false;
  private diagnostics: Array<{ ts: string; message: string }> = [];
  private fileOverlay?: HTMLDivElement;
  private fileList?: HTMLDivElement;
  private fileInput?: HTMLInputElement;
  private virtualEnabled = false;
  private virtualNodes: FlatNode[] = [];
  private virtualIndexById = new Map<string, number>();
  private virtualRowHeight = 34;
  private virtualLastStart = -1;
  private virtualLastEnd = -1;
  private virtualScrollRaf: number | null = null;
  private indentPx: number | null = null;
  private lastDelete?: { node: CoderNode; parentId: string | null; index: number }[];
  private confirmDelete = true;
  private settingsMenu?: HTMLDivElement;
  private showDropHints = true;
  private showRowActions = true;
  private showOnlyMatches = true;
  private compactMode = false;
  private pinPreviewOnClick = false;
  private reducedMotion = true;
  private effectsMode: "full" | "performance" = "full";
  private statusFilter = new Set<CoderStatus>();
  private matchedIds: string[] = [];
  private hoveredPathIds: string[] = [];
  private hoveredRowId: string | null = null;
  private filterChips?: HTMLDivElement;
  private onlyMatchesBtn?: HTMLButtonElement;
  private nextMatchBtn?: HTMLButtonElement;
  private dragGhost?: HTMLElement;
  private collapseStateTouched = false;
  private renamingId: string | null = null;

  private fallbackTree?: CoderNode[];

  constructor(options?: CoderPanelOptions) {
    this.onPayloadSelected = options?.onPayloadSelected;
    this.scopeId = options?.scopeId;
    this.stateLoadedCallback = options?.onStateLoaded;
    this.store = new CoderStore(undefined, this.scopeId);
    this.projectPath = (options as any)?.projectPath ?? (window as any)?.currentProjectPath ?? null;
    this.store.setProjectPath(this.projectPath);
    this.confirmDelete = this.readConfirmDelete();
    this.effectsMode = this.readEffectsMode();
    const defaultEffectsOn = this.effectsMode === "full";
    this.showDropHints = this.readBoolSetting("coder.showDropHints", defaultEffectsOn);
    this.showRowActions = this.readBoolSetting("coder.showRowActions", defaultEffectsOn);
    this.showOnlyMatches = this.readBoolSetting("coder.showOnlyMatches", true);
    this.compactMode = this.readBoolSetting("coder.compactMode", false);
    this.pinPreviewOnClick = this.readBoolSetting("coder.pinPreviewOnClick", defaultEffectsOn);
    this.reducedMotion = this.readBoolSetting("coder.reducedMotion", !defaultEffectsOn);
    this.statusFilter = this.readStatusFilter();
    if (options?.initialTree && options.initialTree.length) {
      this.fallbackTree = options.initialTree;
    }

    this.element = document.createElement("div");
    this.element.className = "coder-surface";
    this.element.tabIndex = 0;
    this.element.addEventListener("dragover", (ev) => ev.preventDefault());
    this.element.addEventListener("drop", (ev) => this.handleRootDrop(ev));
    this.element.addEventListener("dragend", () => {
      this.clearDropTarget();
      this.cleanupDragGhost();
    });
    this.element.addEventListener("keydown", (ev) => this.handleGlobalKeyDown(ev));
    this.element.addEventListener("contextmenu", (ev) => ev.preventDefault());
    this.updateSurfaceClasses();

    this.defaultTitle = options?.title ?? "Coder";
    const header = this.buildHeader(this.defaultTitle);
    const filterRow = this.buildFilterRow();
    const actions = this.buildActions();

    this.treeHost = document.createElement("div");
    this.treeHost.className = "coder-tree";
    this.treeHost.addEventListener("dragover", (ev) => this.handleTreeDragOver(ev));
    this.treeHost.addEventListener("dragleave", (ev) => {
      if (ev.target === this.treeHost) {
        this.clearDropTarget();
      }
    });
    this.treeHost.addEventListener("scroll", () => this.handleTreeScroll());

    this.previewTooltip = document.createElement("div");
    this.previewTooltip.className = "coder-preview-tooltip";
    this.previewTitle = document.createElement("div");
    this.previewTitle.className = "coder-preview-title";
    this.previewSnippet = document.createElement("div");
    this.previewSnippet.className = "coder-preview-snippet";
    this.previewTooltip.append(this.previewTitle, this.previewSnippet);
    document.body.append(this.previewTooltip);

    window.addEventListener("settings:updated", (ev) => {
      const detail = (ev as CustomEvent<{ key?: string; value?: unknown }>).detail || {};
      if (detail.key !== APPEARANCE_KEYS.effects) return;
      this.effectsMode = detail.value === "performance" ? "performance" : "full";
      this.applyEffectsMode();
    });
    void this.syncEffectsModeFromSettingsBridge();

    this.noteBox = document.createElement("div");
    this.noteBox.className = "coder-note-box";
    const noteLabel = document.createElement("div");
    noteLabel.textContent = "Section note";
    noteLabel.style.fontSize = "12px";
    noteLabel.style.color = "#94a3b8";
    this.noteInput = document.createElement("textarea");
    this.noteInput.placeholder = "Write a brief intro for this section…";
    this.noteInput.addEventListener("input", () => {
      const node = this.selectedNode();
      if (node && node.type === "folder") {
        this.noteInputDirty = true;
        this.noteInputTargetId = node.id;
        if (this.noteSaveTimer !== null) {
          window.clearTimeout(this.noteSaveTimer);
        }
        const value = this.noteInput.value;
        this.noteSaveTimer = window.setTimeout(() => {
          this.noteSaveTimer = null;
          // Only save if the user is still editing the same folder.
          if (this.noteInputTargetId === node.id) {
            this.store.setNote(node.id, value);
            // Keep dirty flag while focused to avoid overwrite; cleared on blur/selection change.
          }
        }, 250);
      }
    });
    this.noteInput.addEventListener("blur", () => {
      if (this.noteSaveTimer !== null) {
        window.clearTimeout(this.noteSaveTimer);
        this.noteSaveTimer = null;
      }
      const node = this.selectedNode();
      if (node && node.type === "folder") {
        const value = this.noteInput.value;
        this.store.setNote(node.id, value);
      }
      this.noteInputDirty = false;
      this.noteInputTargetId = null;
    });
    this.noteBox.append(noteLabel, this.noteInput);

    const footer = document.createElement("div");
    footer.className = "coder-footer";
    const hint = document.createElement("span");
    hint.textContent = "Drag items to reorder or drop text/html to capture selections.";
    const badge = document.createElement("span");
    badge.className = "coder-badge";
    badge.textContent = "Statuses: 1=I 2=? 3=×";
    footer.append(hint, badge);

    this.element.append(header, filterRow, actions, this.treeHost, this.noteBox, footer);
    this.globalClickHandler = (event) => this.handleGlobalClick(event);
    document.addEventListener("click", this.globalClickHandler);
    document.addEventListener("pointerdown", this.globalClickHandler, true);
    this.treeContextHandler = (ev) => this.handleTreeContextMenu(ev);
    this.treeHost.addEventListener("contextmenu", this.treeContextHandler);

    this.ensureStyleInjected();
    this.ensureHelpOverlay();

    this.applyEffectsMode();
    this.unsubscribeStore = this.store.subscribe((state) => this.render(state));
    void this.hydratePersistentState();
    this.attachExternalStateListener();
  }

  private async pasteAsNewItem(): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      const html = await navigator.clipboard.read().then(async (items) => {
        for (const item of items) {
          const htmlType = item.types.find((t) => t === "text/html");
          if (htmlType) {
            const blob = await item.getType(htmlType);
            return await blob.text();
          }
        }
        return "";
      });
      const contentHtml = normalizePayloadHtml({ html, text } as any);
      const payload: CoderPayload = {
        title: snippet80(text || html) || "Pasted item",
        text,
        html: contentHtml,
        source: { scope: "clipboard" }
      };
      this.addPayloadNode(payload, this.selectedFolderId());
    } catch (error) {
      console.error("[CoderPanel.ts][pasteAsNewItem][error]", error);
    }
  }

  private duplicateSelection(): void {
    const ids = this.getTopLevelSelected();
    if (ids.length === 0) return;
    const state = this.store.snapshot();
    const targetId = ids[ids.length - 1];
    const parent = this.findParent(state.nodes, targetId);
    const siblings = parent ? parent.children : state.nodes;
    const targetIndex = siblings.findIndex((n) => n.id === targetId);
    const newIds = this.store.copyMany({
      nodeIds: ids,
      targetParentId: parent ? parent.id : null,
      targetIndex: targetIndex + 1
    });
    if (newIds.length) {
      this.selection = new Set(newIds);
      this.primarySelection = newIds[newIds.length - 1] ?? null;
      this.anchorSelection = newIds[0] ?? null;
      this.render(this.store.snapshot());
      this.scrollNodeIntoView(newIds[newIds.length - 1]);
    }
  }

  public addPayload(payload: CoderPayload, parentId?: string | null): void {
    this.addPayloadNode(payload, parentId ?? null);
  }

  public getScopeId(): CoderScopeId | undefined {
    return this.scopeId;
  }

  private ensureStyleInjected(): void {
    if (typeof document === "undefined") return;
    if (document.head.querySelector("style[data-coder-css]")) return;
    const style = document.createElement("style");
    style.dataset.coderCss = "true";
    style.textContent = coderStyles;
    document.head.appendChild(style);
  }

  private attachExternalStateListener(): void {
    const handler = (event: Event): void => {
      if (this.destroyed) return;
      const detail = (event as CustomEvent).detail as { scopeId?: string | null; source?: string | null } | undefined;
      if (!detail) return;
      if (detail.scopeId && this.scopeId && detail.scopeId !== this.scopeId) return;
      if (detail.source !== "write") return;
      void this.store.loadFromDisk();
    };
    this.externalStateListener = handler;
    window.addEventListener("coder:stateSaved", handler);
  }

  public destroy(): void {
    this.destroyed = true;
    document.removeEventListener("click", this.globalClickHandler);
    document.removeEventListener("pointerdown", this.globalClickHandler, true);
    this.treeHost?.removeEventListener("contextmenu", this.treeContextHandler);
    if (this.externalStateListener) {
      window.removeEventListener("coder:stateSaved", this.externalStateListener);
    }
    this.unsubscribeStore?.();
    this.contextMenu?.remove();
    this.previewOverlay?.remove();
    this.previewTooltip?.remove();
    this.dropHint?.remove();
    this.toast?.remove();
    this.settingsMenu?.remove();
    this.fileOverlay?.remove();
    this.paletteOverlay?.remove();
    this.diagnosticsOverlay?.remove();
    this.cleanupDragGhost();
    this.element.remove();
  }

  private buildHeader(title: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "coder-header";
    const heading = document.createElement("div");
    heading.className = "coder-title";
    const titleEl = document.createElement("span");
    titleEl.className = "coder-title-text";
    titleEl.textContent = title;
    this.titleText = titleEl;

    this.savedPill = document.createElement("span");
    this.savedPill.className = "coder-pill";
    this.savedPill.textContent = "Saved";

    this.syncPill = document.createElement("span");
    this.syncPill.className = "coder-sync";
    this.syncPill.textContent = "Unsynced";

    this.selectionPill = document.createElement("span");
    this.selectionPill.className = "coder-pill coder-pill-selection";
    this.selectionPill.textContent = "0 selected";
    this.selectionPill.style.display = "none";

    this.filterPill = document.createElement("span");
    this.filterPill.className = "coder-pill coder-pill-filter";
    this.filterPill.textContent = "Status: I ? ×";
    this.filterPill.style.display = "none";

    heading.append(titleEl, this.savedPill, this.syncPill, this.selectionPill, this.filterPill);
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "coder-gear";
    settings.textContent = "⚙";
    settings.title = "Coder settings";
    settings.ariaLabel = "Coder settings";
    settings.dataset.voiceAliases = "coder settings,settings,preferences";
    settings.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.toggleSettingsMenu(settings);
    });

    wrap.append(heading, settings);
    return wrap;
  }

  private updateCoderTitle(metaTitle?: string, statePath?: string): void {
    if (!this.titleText) return;
    const cleanedMeta = String(metaTitle || "").trim();
    if (cleanedMeta) {
      this.titleText.textContent = cleanedMeta;
      return;
    }
    const base = statePath ? statePath.split(/[\\/]/).pop() : "";
    if (base) {
      this.titleText.textContent = base.replace(/\.json$/i, "");
      return;
    }
    this.titleText.textContent = this.defaultTitle;
  }

  private deriveTitleFromPath(statePath: string): string {
    const base = statePath.split(/[\\/]/).pop() || "";
    const trimmed = base.replace(/\.json$/i, "");
    return trimmed || this.defaultTitle;
  }

  private lastStateStorageKey(): string {
    const scope = this.scopeId ? String(this.scopeId) : "global";
    const project = this.projectPath
      ? String(this.projectPath).replace(/[^a-zA-Z0-9_-]+/g, "-")
      : "default";
    return `coder.lastStatePath::${scope}::${project}`;
  }

  private readLastOpenedStatePath(): string | null {
    try {
      const raw = localStorage.getItem(this.lastStateStorageKey());
      return raw ? String(raw) : null;
    } catch {
      return null;
    }
  }

  private writeLastOpenedStatePath(statePath: string): void {
    try {
      localStorage.setItem(this.lastStateStorageKey(), statePath);
    } catch {
      // ignore storage errors
    }
  }

  private buildFilterRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "coder-filter-row";
    this.filterInput = document.createElement("input");
    this.filterInput.className = "coder-filter";
    this.filterInput.type = "search";
    this.filterInput.placeholder = "Filter…";
    this.filterInput.addEventListener("input", () => this.render(this.store.snapshot()));

    this.filterChips = document.createElement("div");
    this.filterChips.className = "coder-filter-chips";
    const mkChip = (label: string, title: string, status?: CoderStatus) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "coder-chip";
      btn.textContent = label;
      btn.title = title;
      if (status) {
        btn.dataset.status = status;
        btn.addEventListener("click", () => {
          if (this.statusFilter.has(status)) {
            this.statusFilter.delete(status);
          } else {
            this.statusFilter.add(status);
          }
          if (this.statusFilter.size === 0) {
            this.statusFilter = new Set([status]);
          }
          this.writeStatusFilter(this.statusFilter);
          this.updateFilterChips();
          this.render(this.store.snapshot());
        });
      } else {
        btn.dataset.role = "all";
        btn.addEventListener("click", () => {
          this.statusFilter = new Set(CODER_STATUSES);
          this.writeStatusFilter(this.statusFilter);
          this.updateFilterChips();
          this.render(this.store.snapshot());
        });
      }
      return btn;
    };

    const allChip = mkChip("All", "Show all statuses");
    const incChip = mkChip("I", "Included status", "Included");
    const maybeChip = mkChip("?", "Maybe status", "Maybe");
    const exclChip = mkChip("×", "Excluded status", "Excluded");
    this.filterChips.append(allChip, incChip, maybeChip, exclChip);

    this.onlyMatchesBtn = document.createElement("button");
    this.onlyMatchesBtn.type = "button";
    this.onlyMatchesBtn.className = "coder-toggle-btn";
    this.onlyMatchesBtn.textContent = "Only matches";
    this.onlyMatchesBtn.addEventListener("click", () => {
      this.showOnlyMatches = !this.showOnlyMatches;
      this.writeBoolSetting("coder.showOnlyMatches", this.showOnlyMatches);
      this.updateFilterChips();
      this.render(this.store.snapshot());
    });

    this.nextMatchBtn = document.createElement("button");
    this.nextMatchBtn.type = "button";
    this.nextMatchBtn.className = "coder-filter-btn";
    this.nextMatchBtn.textContent = "Next match";
    this.nextMatchBtn.addEventListener("click", () => this.jumpToNextMatch());

    this.filterStatus = document.createElement("span");
    this.filterStatus.className = "coder-sync";
    this.filterStatus.textContent = "Type to filter";
    row.append(this.filterInput, this.filterChips, this.onlyMatchesBtn, this.nextMatchBtn, this.filterStatus);
    this.updateFilterChips();
    return row;
  }

  private updateFilterChips(): void {
    if (!this.filterChips) return;
    const statusButtons = Array.from(this.filterChips.querySelectorAll("button[data-status]")) as HTMLButtonElement[];
    statusButtons.forEach((btn) => {
      const status = btn.dataset.status as CoderStatus | undefined;
      const active = status ? this.statusFilter.has(status) : false;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
    const allBtn = this.filterChips.querySelector("button[data-role='all']") as HTMLButtonElement | null;
    if (allBtn) {
      const active = this.statusFilter.size === CODER_STATUSES.length;
      allBtn.classList.toggle("is-active", active);
      allBtn.setAttribute("aria-pressed", active ? "true" : "false");
    }
    if (this.onlyMatchesBtn) {
      this.onlyMatchesBtn.classList.toggle("is-active", this.showOnlyMatches);
      this.onlyMatchesBtn.setAttribute("aria-pressed", this.showOnlyMatches ? "true" : "false");
    }
    this.refreshFilterPill();
  }

  private refreshFilterPill(): void {
    if (!this.filterPill) return;
    if (this.statusFilter.size === CODER_STATUSES.length) {
      this.filterPill.style.display = "none";
      return;
    }
    const order: CoderStatus[] = ["Included", "Maybe", "Excluded"];
    const map: Record<CoderStatus, string> = { Included: "I", Maybe: "?", Excluded: "×" };
    const text = order.filter((status) => this.statusFilter.has(status)).map((status) => map[status]).join(" ");
    this.filterPill.textContent = `Status: ${text || "None"}`;
    this.filterPill.style.display = "";
  }

  private buildActions(): HTMLElement {
    const row = document.createElement("div");
    row.className = "coder-actions";

    const mkBtn = (label: string, title: string, handler: () => void): HTMLButtonElement => {
      const btn = document.createElement("button");
      btn.className = "coder-btn";
      btn.type = "button";
      btn.textContent = label;
      btn.title = title;
      btn.ariaLabel = title;
      btn.dataset.voiceAliases = title;
      btn.addEventListener("click", handler);
      return btn;
    };

    const newFolder = mkBtn("+ Folder", "New folder (Ctrl/Cmd+N, Shift for root)", () => {
      const parent = this.selectedFolderId();
      const f = this.store.addFolder("New section", parent);
      this.setSelectionSingle(f.id);
      this.render(this.store.snapshot());
    });

    const rename = mkBtn("Rename", "Rename selection (F2)", () => this.beginRename());

    const moveUp = mkBtn("↑", "Move up (Ctrl/Cmd+↑)", () => this.moveSelected(-1));
    const moveDown = mkBtn("↓", "Move down (Ctrl/Cmd+↓)", () => this.moveSelected(1));

    const del = mkBtn("Delete", "Delete selection (Del)", () => this.deleteSelected());

    const statusI = mkBtn("I", "Mark Included (1)", () => this.setStatus("Included"));
    const statusM = mkBtn("?", "Mark Maybe (2)", () => this.setStatus("Maybe"));
    const statusX = mkBtn("×", "Mark Excluded (3)", () => this.setStatus("Excluded"));

    const openBtn = mkBtn("Open", "Open another coder file", () => {
      void this.openFileManager();
    });
    const saveAs = mkBtn("Save As", "Save current coder as a new file", () => {
      void this.saveAsPrompt();
    });
    const newFile = mkBtn("New", "Create a new coder file", () => {
      void this.createNewCoderFromPrompt();
    });

    const expSave = mkBtn("Save HTML", "Export selection to HTML file (Ctrl/Cmd+E)", () => this.saveHtml());
    const expCopy = mkBtn("Copy HTML", "Copy selection HTML", () => this.copyHtml());
    const expPrev = mkBtn("Preview", "Preview exported HTML (Ctrl/Cmd+P)", () => this.previewHtml());

    row.append(
      newFolder,
      rename,
      moveUp,
      moveDown,
      del,
      statusI,
      statusM,
      statusX,
      openBtn,
      saveAs,
      newFile,
      expSave,
      expCopy,
      expPrev
    );
    return row;
  }

  private selectedNode(state: CoderState = this.store.snapshot()): CoderNode | null {
    if (!this.primarySelection) return null;
    const find = (nodes: CoderNode[]): CoderNode | null => {
      for (const n of nodes) {
        if (n.id === this.primarySelection) return n;
        if (n.type === "folder") {
          const hit = find(n.children);
          if (hit) return hit;
        }
      }
      return null;
    };
    return find(state.nodes);
  }

  private selectedFolderId(): string | null {
    const node = this.selectedNode();
    if (node?.type === "folder") return node.id;
    if (!node) return null;
    const state = this.store.snapshot();
    const parent = this.findParent(state.nodes, node.id);
    return parent?.id ?? null;
  }

  private findParent(nodes: CoderNode[], childId: string, parent: FolderNode | null = null): FolderNode | null {
    for (const n of nodes) {
      if (n.id === childId) return parent;
      if (n.type === "folder") {
        const hit = this.findParent(n.children, childId, n);
        if (hit) return hit;
      }
    }
    return null;
  }

  private render(state: CoderState): void {
    const renderStart = performance.now();
    const filter = (this.filterInput?.value || "").trim().toLowerCase();
    this.hidePreviewTooltip();
    this.clearHoverClasses();
    this.hoveredPathIds = [];
    this.hoveredRowId = null;
    const stats: RenderStats = { totalNodes: 0, matched: 0, matchedVisible: 0, matchedIds: [] };
    const totalNodes = this.countNodes(state.nodes);
    const useVirtual = this.shouldVirtualize(totalNodes);
    this.virtualEnabled = useVirtual;
    this.treeHost.classList.toggle("coder-virtual", useVirtual);
    this.treeHost.innerHTML = "";
    if (state.nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "coder-empty";
      empty.textContent = "No sections yet. Add a folder to begin.";
      this.treeHost.append(empty);
    } else if (useVirtual) {
      const flat = this.buildFlatNodes(state.nodes, filter, stats);
      this.virtualNodes = flat.nodes;
      this.virtualIndexById = flat.indexById;
      this.renderVirtualWindow(true);
    } else {
      this.virtualNodes = [];
      this.virtualIndexById = new Map<string, number>();
      const root = document.createDocumentFragment();
      state.nodes.forEach((node) => root.append(this.renderNode(node, 0, filter, stats, [])));
      this.treeHost.append(root);
    }
    this.matchedIds = stats.matchedIds;
    if (this.nextMatchBtn) {
      this.nextMatchBtn.disabled = this.matchedIds.length === 0;
    }
    this.updateFilterStatus(stats, filter);
    this.updateFilterChips();
    this.refreshNotePanel();
    this.refreshSavedPill();
    this.refreshSelectionPill();
    this.refreshPinnedPreviewPosition();
    const elapsed = performance.now() - renderStart;
    if (elapsed > 120) {
      this.recordDiagnostic(`Render ${Math.round(elapsed)}ms for ${stats.totalNodes} nodes`);
    }
  }

  private countNodes(nodes: CoderNode[]): number {
    let count = 0;
    const walk = (list: CoderNode[]) => {
      list.forEach((node) => {
        count += 1;
        if (node.type === "folder") {
          walk(node.children);
        }
      });
    };
    walk(nodes);
    return count;
  }

  private shouldVirtualize(totalNodes: number): boolean {
    return this.effectsMode === "performance" && totalNodes >= 300;
  }

  private getIndentPx(): number {
    if (this.indentPx !== null) return this.indentPx;
    const raw = window.getComputedStyle(this.treeHost).getPropertyValue("--coder-indent").trim();
    const parsed = Number.parseFloat(raw);
    this.indentPx = Number.isFinite(parsed) && parsed > 0 ? parsed : 18;
    return this.indentPx;
  }

  private buildFlatNodes(nodes: CoderNode[], filter: string, stats: RenderStats): {
    nodes: FlatNode[];
    indexById: Map<string, number>;
  } {
    const list: FlatNode[] = [];
    const indexById = new Map<string, number>();
    const hasActiveFilter = this.hasActiveFilter(filter);

    const walk = (items: CoderNode[], depth: number, parentPath: string[], includeInOutput: boolean): boolean => {
      let anyVisible = false;
      items.forEach((node) => {
        const matchHit = this.matchesFilter(node, filter);
        let visible = !hasActiveFilter || !this.showOnlyMatches ? true : matchHit;
        let childVisible = false;
        if (node.type === "folder") {
          const collapsed = this.isFolderCollapsed(node.id);
          childVisible = walk(node.children, depth + 1, [...parentPath, node.id], includeInOutput && !collapsed);
          if (hasActiveFilter && childVisible) {
            visible = true;
          }
        }
        stats.totalNodes += 1;
        if (matchHit && hasActiveFilter) {
          stats.matched += 1;
          stats.matchedIds.push(node.id);
        }
        if (visible && matchHit && hasActiveFilter) {
          stats.matchedVisible += 1;
        }
        if (includeInOutput && visible) {
          const entry: FlatNode = { node, depth, path: parentPath, matchHit, hasActiveFilter };
          indexById.set(node.id, list.length);
          list.push(entry);
        }
        if (visible) {
          anyVisible = true;
        }
      });
      return anyVisible;
    };

    walk(nodes, 0, [], true);
    return { nodes: list, indexById };
  }

  private handleTreeScroll(): void {
    this.refreshPinnedPreviewPosition();
    if (!this.virtualEnabled) return;
    if (this.virtualScrollRaf !== null) return;
    this.virtualScrollRaf = window.requestAnimationFrame(() => {
      this.virtualScrollRaf = null;
      this.renderVirtualWindow();
    });
  }

  private renderVirtualWindow(force = false): void {
    if (!this.virtualEnabled) return;
    const total = this.virtualNodes.length;
    const viewportHeight = this.treeHost.clientHeight;
    const scrollTop = this.treeHost.scrollTop;
    const rowHeight = this.virtualRowHeight || 34;
    const buffer = 6;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
    const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + buffer);
    if (!force && start === this.virtualLastStart && end === this.virtualLastEnd) {
      return;
    }
    this.virtualLastStart = start;
    this.virtualLastEnd = end;
    const prevScroll = this.treeHost.scrollTop;
    this.treeHost.innerHTML = "";
    if (total === 0) {
      const empty = document.createElement("div");
      empty.className = "coder-empty";
      empty.textContent = this.hasActiveFilter(this.filterInput?.value || "") ? "No matches found." : "No sections yet.";
      this.treeHost.append(empty);
      return;
    }

    const topSpacer = document.createElement("div");
    topSpacer.className = "coder-virtual-spacer";
    topSpacer.style.height = `${start * rowHeight}px`;

    const bottomSpacer = document.createElement("div");
    bottomSpacer.className = "coder-virtual-spacer";
    bottomSpacer.style.height = `${(total - end) * rowHeight}px`;

    const listWrap = document.createElement("div");
    listWrap.className = "coder-virtual-list";
    for (let i = start; i < end; i += 1) {
      const entry = this.virtualNodes[i];
      const row = this.renderFlatRow(entry);
      listWrap.appendChild(row);
    }
    const fragment = document.createDocumentFragment();
    fragment.append(topSpacer, listWrap, bottomSpacer);
    this.treeHost.append(fragment);
    this.treeHost.scrollTop = prevScroll;

    const firstRow = listWrap.firstElementChild as HTMLElement | null;
    if (firstRow) {
      const measured = firstRow.getBoundingClientRect().height;
      if (measured > 8 && Math.abs(measured - this.virtualRowHeight) > 2) {
        this.virtualRowHeight = measured;
        this.renderVirtualWindow(true);
      }
    }
  }

  private renderNode(
    node: CoderNode,
    depth: number,
    filter: string,
    stats: RenderStats,
    parentPath: string[]
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "coder-node";
    row.dataset.id = node.id;
    row.dataset.type = node.type;
    row.dataset.depth = String(depth);
    row.dataset.path = parentPath.join("/");
    if (depth === 0) row.classList.add("is-root");
    const isRenaming = this.renamingId === node.id;
    row.draggable = !isRenaming;

    const rowInner = document.createElement("div");
    rowInner.className = "coder-row";

    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "coder-expander";
    const collapsed = node.type === "folder" ? this.isFolderCollapsed(node.id) : false;
    expander.innerHTML =
      node.type === "folder"
        ? collapsed
          ? `<svg class="coder-expander-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.22 3.97a.75.75 0 0 0 0 1.06L9.19 8l-2.97 2.97a.75.75 0 1 0 1.06 1.06l3.5-3.5a.75.75 0 0 0 0-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0Z" fill="currentColor"/></svg>`
          : `<svg class="coder-expander-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.97 6.22a.75.75 0 0 1 1.06 0L8 9.19l2.97-2.97a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 0-1.06Z" fill="currentColor"/></svg>`
        : "";
    expander.disabled = node.type !== "folder";
    if (node.type === "folder") {
      expander.setAttribute("aria-label", collapsed ? "Expand folder" : "Collapse folder");
      expander.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    // Prevent folder expander clicks from starting a drag (rows are draggable).
    expander.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    expander.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    expander.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (node.type === "folder") {
        this.collapseStateTouched = true;
        this.store.setFolderCollapsed(node.id, !this.isFolderCollapsed(node.id));
      }
    });

    const label = document.createElement("div");
    label.className = "coder-label";
    if (!this.compactMode) {
      const dot = document.createElement("span");
      dot.className = "status-dot";
      if (node.type === "item") {
        dot.style.background =
          node.status === "Included" ? "#22c55e" : node.status === "Maybe" ? "#eab308" : "#ef4444";
      } else {
        dot.style.background = "#94a3b8";
      }
      label.append(dot);
    }

    if (isRenaming) {
      const input = document.createElement("input");
      input.className = "rename-input";
      input.value = node.name;
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      input.addEventListener("mousedown", (ev) => ev.stopPropagation());
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("dragstart", (ev) => ev.preventDefault());
      const commit = () => {
        this.renamingId = null;
        this.setSelectionSingleSilent(node.id);
        this.store.rename(node.id, input.value.trim());
      };
      const cancel = () => {
        this.renamingId = null;
        this.render(this.store.snapshot());
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          commit();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancel();
        }
      });
      label.append(input);
    } else {
      const title = document.createElement("span");
      title.className = "coder-title-text";
      title.textContent = node.name;
      label.append(title);
    }

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.alignItems = "center";

    const rowActions = document.createElement("div");
    rowActions.className = "coder-row-actions";
    const mkIconBtn = (label: string, title: string, handler: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "coder-icon-btn";
      btn.textContent = label;
      btn.title = title;
      btn.ariaLabel = title;
      btn.dataset.voiceAliases = title;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.setSelectionSingleSilent(node.id);
        handler();
      });
      return btn;
    };
    rowActions.append(
      mkIconBtn("✎", "Rename (F2)", () => this.beginRename(undefined, node)),
      mkIconBtn("🗑", "Delete (Del)", () => this.deleteSelected())
    );

    if (node.type === "item") {
      const pill = document.createElement("span");
      pill.className = "coder-status";
      if (node.status === "Maybe") pill.classList.add("maybe");
      if (node.status === "Excluded") pill.classList.add("excluded");
      pill.textContent = node.status;
      actions.append(pill);
    } else {
      if (!this.compactMode) {
        const rollup = this.buildFolderRollup(node);
        actions.append(rollup);
        const count = document.createElement("span");
        count.className = "coder-sync";
        count.textContent = `${node.children.length} child${node.children.length === 1 ? "" : "ren"}`;
        actions.append(count);
      }
    }
    if (this.anchorSelection === node.id && this.selection.size > 1) {
      const anchorBadge = document.createElement("span");
      anchorBadge.className = "coder-anchor-badge";
      anchorBadge.textContent = "anchor";
      actions.append(anchorBadge);
    }
    actions.append(rowActions);

    rowInner.append(expander, label, actions);
    row.append(rowInner);

    const matchHit = this.matchesFilter(node, filter);
    const hasActiveFilter = this.hasActiveFilter(filter);
    let visible = !hasActiveFilter || !this.showOnlyMatches ? true : matchHit;
    if (node.type === "folder") {
      const childrenWrap = document.createElement("div");
      childrenWrap.className = "coder-children";
      let anyChildVisible = false;
      node.children.forEach((child) => {
        const childEl = this.renderNode(child, depth + 1, filter, stats, [...parentPath, node.id]);
        if (!childEl.classList.contains("is-hidden")) anyChildVisible = true;
        childrenWrap.append(childEl);
      });
      if (hasActiveFilter && anyChildVisible) {
        visible = true;
      }
      const collapsed = this.isFolderCollapsed(node.id);
      childrenWrap.setAttribute("data-collapsed", collapsed ? "true" : "false");
      childrenWrap.style.display = collapsed ? "none" : "";
      row.append(childrenWrap);
    }

    stats.totalNodes += 1;
    if (matchHit && hasActiveFilter) {
      stats.matched += 1;
      stats.matchedIds.push(node.id);
    }
    if (!visible) {
      row.classList.add("is-hidden");
      row.style.display = "none";
    } else if (matchHit && hasActiveFilter) {
      stats.matchedVisible += 1;
    }
    if (hasActiveFilter && matchHit) {
      row.classList.add("is-match");
    }
    if (hasActiveFilter && !matchHit) {
      row.classList.add("is-filtered-out");
    }

    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (ev.detail > 1) return;
      this.hideContextMenu();
      const meta = ev.metaKey || ev.ctrlKey;
      const shift = ev.shiftKey;
      if (shift) {
        this.selectRange(node.id);
      } else if (meta) {
        this.toggleSelection(node.id);
      } else {
        this.setSelectionSingle(node.id);
      }
      if (node.type === "item" && this.onPayloadSelected && this.selection.size === 1) {
        this.onPayloadSelected(node.payload);
      }
      if (node.type === "item" && this.selection.size === 1 && this.pinPreviewOnClick && !meta && !shift) {
        this.setPinnedPreview(node, row);
      } else if (node.type !== "item" && this.previewPinned) {
        this.clearPinnedPreview();
      }
    });

    row.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      this.setSelectionSingle(node.id);
      this.beginRename(undefined, node);
    });

    row.addEventListener("dragstart", (ev) => this.handleDragStart(ev, node.id));
    // Dragover fires at very high frequency; keep it cheap.
    row.addEventListener("dragover", (ev) => {
      ev.stopPropagation();
      if (!this.showDropHints) {
        ev.preventDefault();
        return;
      }
      this.handleDragOver(ev, node, row);
    });
    row.addEventListener("dragleave", () => {
      this.clearDropTarget();
      if (node.type === "item") {
        this.hidePreviewTooltip();
      }
    });
    row.addEventListener("drop", (ev) => {
      ev.stopPropagation();
      this.handleDrop(ev, node);
    });

    row.addEventListener("mouseenter", () => {
      if (!this.reducedMotion) {
        this.applyHoverPath(row, node.id);
      }
      if (node.type === "item") {
        if (this.previewPinned && this.previewPinnedId !== node.id) return;
        this.showPreviewTooltip(node, row);
      }
    });
    row.addEventListener("mouseleave", () => {
      if (!this.reducedMotion) {
        this.clearHoverPath(node.id);
      }
      if (node.type === "item") {
        this.hidePreviewTooltip();
      }
    });

    if (this.selection.has(node.id)) {
      row.classList.add("selected");
      if (this.primarySelection === node.id) {
        row.classList.add("selected-primary");
      }
      if (this.anchorSelection === node.id && this.selection.size > 1) {
        row.classList.add("selected-anchor");
        row.title = "Range anchor";
      }
    }

    return row;
  }

  private renderFlatRow = (entry: FlatNode): HTMLElement => {
    const { node, depth, path, matchHit, hasActiveFilter } = entry;
    const row = document.createElement("div");
    row.className = "coder-node";
    row.dataset.id = node.id;
    row.dataset.type = node.type;
    row.dataset.depth = String(depth);
    row.dataset.path = path.join("/");
    if (depth === 0) row.classList.add("is-root");
    if (depth > 0) {
      row.style.marginLeft = `${depth * this.getIndentPx()}px`;
    }
    const isRenaming = this.renamingId === node.id;
    row.draggable = !isRenaming;

    const rowInner = document.createElement("div");
    rowInner.className = "coder-row";

    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = "coder-expander";
    const collapsed = node.type === "folder" ? this.isFolderCollapsed(node.id) : false;
    expander.innerHTML =
      node.type === "folder"
        ? collapsed
          ? `<svg class="coder-expander-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M6.22 3.97a.75.75 0 0 0 0 1.06L9.19 8l-2.97 2.97a.75.75 0 1 0 1.06 1.06l3.5-3.5a.75.75 0 0 0 0-1.06l-3.5-3.5a.75.75 0 0 0-1.06 0Z" fill="currentColor"/></svg>`
          : `<svg class="coder-expander-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.97 6.22a.75.75 0 0 1 1.06 0L8 9.19l2.97-2.97a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 0-1.06Z" fill="currentColor"/></svg>`
        : "";
    expander.disabled = node.type !== "folder";
    if (node.type === "folder") {
      expander.setAttribute("aria-label", collapsed ? "Expand folder" : "Collapse folder");
      expander.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    expander.addEventListener("pointerdown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    expander.addEventListener("mousedown", (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    });
    expander.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (node.type === "folder") {
        this.collapseStateTouched = true;
        this.store.setFolderCollapsed(node.id, !this.isFolderCollapsed(node.id));
      }
    });

    const label = document.createElement("div");
    label.className = "coder-label";
    if (!this.compactMode) {
      const dot = document.createElement("span");
      dot.className = "status-dot";
      if (node.type === "item") {
        dot.style.background =
          node.status === "Included" ? "#22c55e" : node.status === "Maybe" ? "#eab308" : "#ef4444";
      } else {
        dot.style.background = "#94a3b8";
      }
      label.append(dot);
    }

    if (isRenaming) {
      const input = document.createElement("input");
      input.className = "rename-input";
      input.value = node.name;
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      input.addEventListener("mousedown", (ev) => ev.stopPropagation());
      input.addEventListener("click", (ev) => ev.stopPropagation());
      input.addEventListener("dragstart", (ev) => ev.preventDefault());
      const commit = () => {
        this.renamingId = null;
        this.setSelectionSingleSilent(node.id);
        this.store.rename(node.id, input.value.trim());
      };
      const cancel = () => {
        this.renamingId = null;
        this.render(this.store.snapshot());
      };
      input.addEventListener("blur", commit);
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          commit();
        } else if (ev.key === "Escape") {
          ev.preventDefault();
          cancel();
        }
      });
      label.append(input);
    } else {
      const title = document.createElement("span");
      title.className = "coder-title-text";
      title.textContent = node.name;
      label.append(title);
    }

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.alignItems = "center";

    const rowActions = document.createElement("div");
    rowActions.className = "coder-row-actions";
    const mkIconBtn = (labelText: string, titleText: string, handler: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "coder-icon-btn";
      btn.textContent = labelText;
      btn.title = titleText;
      btn.ariaLabel = titleText;
      btn.dataset.voiceAliases = titleText;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.setSelectionSingleSilent(node.id);
        handler();
      });
      return btn;
    };
    rowActions.append(
      mkIconBtn("✎", "Rename (F2)", () => this.beginRename(undefined, node)),
      mkIconBtn("🗑", "Delete (Del)", () => this.deleteSelected())
    );

    if (node.type === "item") {
      const pill = document.createElement("span");
      pill.className = "coder-status";
      if (node.status === "Maybe") pill.classList.add("maybe");
      if (node.status === "Excluded") pill.classList.add("excluded");
      pill.textContent = node.status;
      actions.append(pill);
    } else {
      if (!this.compactMode) {
        const rollup = this.buildFolderRollup(node);
        actions.append(rollup);
        const count = document.createElement("span");
        count.className = "coder-sync";
        count.textContent = `${node.children.length} child${node.children.length === 1 ? "" : "ren"}`;
        actions.append(count);
      }
    }
    if (this.anchorSelection === node.id && this.selection.size > 1) {
      const anchorBadge = document.createElement("span");
      anchorBadge.className = "coder-anchor-badge";
      anchorBadge.textContent = "anchor";
      actions.append(anchorBadge);
    }
    actions.append(rowActions);

    rowInner.append(expander, label, actions);
    row.append(rowInner);

    if (hasActiveFilter && matchHit) {
      row.classList.add("is-match");
    }
    if (hasActiveFilter && !matchHit) {
      row.classList.add("is-filtered-out");
    }

    row.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (ev.detail > 1) return;
      this.hideContextMenu();
      const meta = ev.metaKey || ev.ctrlKey;
      const shift = ev.shiftKey;
      if (shift) {
        this.selectRange(node.id);
      } else if (meta) {
        this.toggleSelection(node.id);
      } else {
        this.setSelectionSingle(node.id);
      }
      if (node.type === "item" && this.onPayloadSelected && this.selection.size === 1) {
        this.onPayloadSelected(node.payload);
      }
      if (node.type === "item" && this.selection.size === 1 && this.pinPreviewOnClick && !meta && !shift) {
        this.setPinnedPreview(node, row);
      } else if (node.type !== "item" && this.previewPinned) {
        this.clearPinnedPreview();
      }
    });

    row.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      this.setSelectionSingle(node.id);
      this.beginRename(undefined, node);
    });

    row.addEventListener("dragstart", (ev) => this.handleDragStart(ev, node.id));
    row.addEventListener("dragover", (ev) => {
      ev.stopPropagation();
      if (!this.showDropHints) {
        ev.preventDefault();
        return;
      }
      this.handleDragOver(ev, node, row);
    });
    row.addEventListener("dragleave", () => {
      this.clearDropTarget();
      if (node.type === "item") {
        this.hidePreviewTooltip();
      }
    });
    row.addEventListener("drop", (ev) => {
      ev.stopPropagation();
      this.handleDrop(ev, node);
    });

    row.addEventListener("mouseenter", () => {
      if (!this.reducedMotion) {
        this.applyHoverPath(row, node.id);
      }
      if (node.type === "item") {
        if (this.previewPinned && this.previewPinnedId !== node.id) return;
        this.showPreviewTooltip(node, row);
      }
    });
    row.addEventListener("mouseleave", () => {
      if (!this.reducedMotion) {
        this.clearHoverPath(node.id);
      }
      if (node.type === "item") {
        this.hidePreviewTooltip();
      }
    });

    if (this.selection.has(node.id)) {
      row.classList.add("selected");
      if (this.primarySelection === node.id) {
        row.classList.add("selected-primary");
      }
      if (this.anchorSelection === node.id && this.selection.size > 1) {
        row.classList.add("selected-anchor");
        row.title = "Range anchor";
      }
    }

    return row;
  };

  private matchesFilter(node: CoderNode, needle: string): boolean {
    if (!this.hasActiveFilter(needle)) return false;
    const match = (value: unknown): boolean =>
      typeof value === "string" && value.toLowerCase().includes(needle.toLowerCase());
    if (node.type === "item") {
      if (!this.statusFilter.has(node.status)) return false;
      if (!needle) return true;
      return match(node.name) || match(node.payload.title) || match(node.payload.text) || match(node.payload.direct_quote);
    }
    if (!needle) return false;
    return match(node.name);
  }

  private updateFilterStatus(
    stats: { totalNodes: number; matched: number; matchedVisible: number },
    needle: string
  ): void {
    const hasActiveFilter = this.hasActiveFilter(needle);
    if (!hasActiveFilter) {
      this.filterStatus.textContent = stats.totalNodes ? `${stats.totalNodes} entries` : "No entries";
      return;
    }
    if (stats.matched === 0) {
      this.filterStatus.textContent = "No matches";
      return;
    }
    const matchLabel = `${stats.matched} match${stats.matched === 1 ? "" : "es"}`;
    const detail = this.showOnlyMatches ? "" : " highlighted";
    const statusLabel = this.statusFilter.size === CODER_STATUSES.length ? "" : ` • ${this.statusFilter.size} status`;
    this.filterStatus.textContent = `${matchLabel}${detail}${statusLabel}`;
  }

  private countFolderStatuses(folder: FolderNode): Record<CoderStatus, number> {
    const counts: Record<CoderStatus, number> = { Included: 0, Maybe: 0, Excluded: 0 };
    const walk = (nodes: CoderNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "item") {
          counts[node.status] += 1;
        } else {
          walk(node.children);
        }
      });
    };
    walk(folder.children);
    return counts;
  }

  private buildFolderRollup(folder: FolderNode): HTMLElement {
    const counts = this.countFolderStatuses(folder);
    const total = counts.Included + counts.Maybe + counts.Excluded;
    const wrap = document.createElement("span");
    wrap.className = "coder-status-rollup";
    wrap.title = `Included: ${counts.Included} • Maybe: ${counts.Maybe} • Excluded: ${counts.Excluded}`;
    if (total === 0) {
      wrap.textContent = "No items";
      return wrap;
    }
    const build = (status: CoderStatus, label: string) => {
      const item = document.createElement("span");
      item.className = `coder-rollup-item coder-rollup-${status.toLowerCase()}`;
      const dot = document.createElement("span");
      dot.className = "coder-rollup-dot";
      const count = document.createElement("span");
      count.textContent = String(counts[status]);
      item.append(dot, count);
      item.setAttribute("aria-label", `${label}: ${counts[status]}`);
      return item;
    };
    wrap.append(build("Included", "Included"), build("Maybe", "Maybe"), build("Excluded", "Excluded"));
    return wrap;
  }

  private applyHoverPath(row: HTMLElement, nodeId: string): void {
    const rawPath = row.dataset.path ? row.dataset.path.split("/").filter(Boolean) : [];
    const ids = [...rawPath, nodeId];
    this.clearHoverClasses();
    this.hoveredPathIds = ids;
    this.hoveredRowId = nodeId;
    ids.forEach((id, index) => {
      const target = this.treeHost.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (!target) return;
      if (index === ids.length - 1) {
        target.classList.add("is-hovered");
      } else {
        target.classList.add("is-ancestor");
      }
    });
  }

  private clearHoverPath(nodeId: string): void {
    if (this.hoveredRowId !== nodeId) return;
    this.clearHoverClasses();
    this.hoveredPathIds = [];
    this.hoveredRowId = null;
  }

  private clearHoverClasses(): void {
    if (!this.hoveredPathIds.length) return;
    this.hoveredPathIds.forEach((id) => {
      const target = this.treeHost.querySelector(`[data-id="${id}"]`) as HTMLElement | null;
      if (!target) return;
      target.classList.remove("is-hovered", "is-ancestor");
    });
  }

  private isPlaceholderTitle(value: string): boolean {
    const normalized = String(value || "")
      .replace(/\u2026/g, "...")
      .trim()
      .toLowerCase();
    return normalized === "selection" || normalized === "selection..." || normalized === "selected text";
  }

  private deriveTitleFromPayload(payload: CoderPayload): string {
    const collapse = (value: string): string => String(value || "").replace(/\s+/g, " ").trim();
    const firstParagraphFromText = (value: string): string => {
      const normalized = String(value || "").replace(/\r\n?/g, "\n");
      const chunks = normalized.split(/\n\s*\n/);
      for (const chunk of chunks) {
        if (chunk.trim()) return chunk;
      }
      return normalized;
    };

    const paraphrase = String((payload.paraphrase as string | undefined) || "").trim();
    if (paraphrase) return snippet80(paraphrase);

    const directQuote = String((payload.direct_quote as string | undefined) || "").trim();
    if (directQuote) return snippet80(directQuote);

    const title = String((payload.title as string | undefined) || "").trim();
    if (title && !this.isPlaceholderTitle(title)) return snippet80(title);

    const text = String((payload.text as string | undefined) || "").trim();
    if (text) return snippet80(firstParagraphFromText(text));

    const html = String((payload.section_html as string | undefined) || (payload.html as string | undefined) || "");
    if (!html.trim()) return DEFAULT_ITEM_TITLE;
    const stripped = html
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
      .trim();
    return snippet80(stripped) || DEFAULT_ITEM_TITLE;
  }

  private showPreviewTooltip(node: ItemNode, row: HTMLElement): void {
    if (!this.previewTooltip || !this.previewTitle || !this.previewSnippet) return;
    const payloadTitle = String((node.payload.title as string | undefined) || "").trim();
    const derivedTitle = this.deriveTitleFromPayload(node.payload);
    const rawTitle =
      payloadTitle && !this.isPlaceholderTitle(payloadTitle)
        ? payloadTitle
        : node.name || derivedTitle || DEFAULT_ITEM_TITLE;

    const payloadText = String((node.payload.text as string | undefined) || "").trim();
    const directQuote = String((node.payload.direct_quote as string | undefined) || "").trim();
    const html = String(
      (node.payload.section_html as string | undefined) || (node.payload.html as string | undefined) || ""
    ).trim();
    const rawText = payloadText || directQuote || html || normalizePayloadHtml(node.payload) || "";
    const title = this.normalizePreviewText(rawTitle, 64);
    const snippet = this.normalizePreviewText(rawText, 220);
    this.previewTitle.textContent = title;
    this.previewSnippet.textContent = snippet || "No preview text.";
    const rect = row.getBoundingClientRect();
    const maxWidth = 320;
    const left = Math.min(rect.right + 12 + window.scrollX, window.scrollX + window.innerWidth - maxWidth - 12);
    const top = rect.top + window.scrollY;
    this.previewTooltip.style.left = `${Math.max(12 + window.scrollX, left)}px`;
    this.previewTooltip.style.top = `${Math.max(12 + window.scrollY, top)}px`;
    this.previewTooltip.classList.add("is-visible");
    if (this.previewPinned) {
      this.previewTooltip.classList.add("is-pinned");
    } else {
      this.previewTooltip.classList.remove("is-pinned");
    }
  }

  private hidePreviewTooltip(force = false): void {
    if (this.previewPinned && !force) return;
    this.previewTooltip?.classList.remove("is-visible", "is-pinned");
  }

  private setPinnedPreview(node: ItemNode, row: HTMLElement): void {
    this.previewPinned = true;
    this.previewPinnedId = node.id;
    this.showPreviewTooltip(node, row);
  }

  private clearPinnedPreview(): void {
    this.previewPinned = false;
    this.previewPinnedId = null;
    this.hidePreviewTooltip(true);
  }

  private refreshPinnedPreviewPosition(): void {
    if (!this.previewPinned || !this.previewPinnedId) {
      this.hidePreviewTooltip();
      return;
    }
    const row = this.treeHost.querySelector(`[data-id="${this.previewPinnedId}"]`) as HTMLElement | null;
    const node = row ? this.nodeById(this.previewPinnedId) : null;
    if (!row || !node || node.type !== "item") {
      this.clearPinnedPreview();
      return;
    }
    this.showPreviewTooltip(node, row);
  }

  private normalizePreviewText(value: string, maxLength: number): string {
    const text = String(value || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return `${text.slice(0, maxLength).trimEnd()}…`;
  }

  private beginRename(row?: HTMLElement, node?: CoderNode): void {
    const targetNode = node ?? this.selectedNode();
    if (!targetNode) return;
    try {
      this.renamingId = targetNode.id;
      this.render(this.store.snapshot());
      window.setTimeout(() => {
        try {
          if (this.renamingId !== targetNode.id) return;
          const host = row ?? (this.treeHost.querySelector(`[data-id="${targetNode.id}"]`) as HTMLElement | null);
          const input = host?.querySelector("input.rename-input") as HTMLInputElement | null;
          if (!input) {
            console.error("[CoderPanel.ts][beginRename][error] rename input missing", { nodeId: targetNode.id });
            return;
          }
          input.focus();
          input.select();
        } catch (error) {
          console.error("[CoderPanel.ts][beginRename][error]", error);
        }
      }, 0);
    } catch (error) {
      console.error("[CoderPanel.ts][beginRename][error]", error);
    }
  }

  private moveSelected(direction: number): void {
    if (this.selection.size > 1) {
      this.moveSelectionBatch(direction);
      return;
    }
    const state = this.store.snapshot();
    const sel = this.selectedNode(state);
    if (!sel) return;
    const parent = this.findParent(state.nodes, sel.id);
    const siblings = parent ? parent.children : state.nodes;
    const idx = siblings.findIndex((n) => n.id === sel.id);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target > siblings.length) return;
    const spec = { nodeId: sel.id, targetParentId: parent ? parent.id : null, targetIndex: target };
    this.store.move(spec);
    this.setSelectionSingle(sel.id);
    // Keep scroll position stable for keyboard moves
    this.scrollNodeIntoView(sel.id);
  }

  private moveSelectionBatch(direction: number): void {
    const state = this.store.snapshot();
    const selected = new Set(this.getTopLevelSelected());
    if (selected.size === 0) return;
    const walk = (nodes: CoderNode[], parent: FolderNode | null): void => {
      const indices: { id: string; index: number }[] = [];
      nodes.forEach((node, index) => {
        if (selected.has(node.id)) {
          indices.push({ id: node.id, index });
        }
        if (node.type === "folder") {
          walk(node.children, node);
        }
      });
      if (indices.length === 0) return;
      const ordered = direction < 0 ? indices : indices.slice().reverse();
      ordered.forEach(({ id, index }) => {
        const siblings = parent ? parent.children : state.nodes;
        const currentIndex = siblings.findIndex((n) => n.id === id);
        if (currentIndex < 0) return;
        const targetIndex = currentIndex + direction;
        if (targetIndex < 0 || targetIndex >= siblings.length) return;
        const neighbor = siblings[targetIndex];
        if (neighbor && selected.has(neighbor.id)) return;
        this.store.move({ nodeId: id, targetParentId: parent ? parent.id : null, targetIndex });
      });
    };
    walk(state.nodes, null);
    this.render(this.store.snapshot());
    if (this.primarySelection) this.scrollNodeIntoView(this.primarySelection);
  }

  private deleteSelected(): void {
    if (this.selection.size === 0) return;
    const ids = this.getTopLevelSelected();
    if (ids.length === 0) return;
    if (this.confirmDelete) {
      if (ids.length === 1) {
        const node = this.nodeById(ids[0]);
        if (!node) return;
        const prompt =
          node.type === "folder"
            ? `Delete folder "${node.name}" and all nested items?`
            : `Delete "${node.name}"?`;
        if (!window.confirm(prompt)) {
          return;
        }
      } else {
        if (!window.confirm(`Delete ${ids.length} items?`)) {
          return;
        }
      }
    }
    const deleted: { node: CoderNode; parentId: string | null; index: number }[] = [];
    ids.forEach((id) => {
      const snapshot = this.store.deleteWithSnapshot(id);
      if (snapshot) deleted.push(snapshot);
    });
    if (deleted.length === 0) return;
    this.clearSelection();
    this.render(this.store.snapshot());
    this.lastDelete = deleted;
    const label = deleted.length === 1 ? `Deleted "${deleted[0].node.name}"` : `Deleted ${deleted.length} items`;
    this.showUndoToast(label, () => this.undoDelete());
  }

  private setStatus(status: CoderStatus, nodeId?: string): void {
    const target = nodeId ? this.nodeById(nodeId) : this.selectedNode();
    if (!target || target.type !== "item") return;
    this.store.setStatus(target.id, status);
    this.setSelectionSingle(target.id);
  }

  private handleDragStart(ev: DragEvent, nodeId: string): void {
    if (!ev.dataTransfer) return;
    const origin = ev.target as HTMLElement | null;
    if (origin?.closest?.("button, input, textarea, select, a")) {
      ev.preventDefault();
      return;
    }
    const dragIdsRaw = this.selection.has(nodeId) ? Array.from(this.selection) : [nodeId];
    const dragIds = this.orderIdsByTree(dragIdsRaw);
    const node = this.nodeById(nodeId);
    if (node) {
      const ghost = document.createElement("div");
      ghost.className = "coder-drag-ghost";
      ghost.textContent =
        dragIds.length > 1 ? `${dragIds.length} items` : `${node.type === "folder" ? "📁" : "📄"} ${node.name}`;
      document.body.append(ghost);
      this.dragGhost = ghost;
      ev.dataTransfer.setDragImage(ghost, 12, 12);
      window.setTimeout(() => {
        this.cleanupDragGhost();
      }, 0);
    }
    ev.dataTransfer.effectAllowed = "copyMove";
    ev.dataTransfer.setData(NODE_MIME, dragIds.length > 1 ? JSON.stringify(dragIds) : nodeId);
  }

  private parseDraggedNodeIds(dt: DataTransfer): string[] | null {
    if (!dt || !dt.types.includes(NODE_MIME)) return null;
    const raw = dt.getData(NODE_MIME);
    const trimmed = String(raw || "").trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
      if (parsed && typeof parsed === "object" && "ids" in (parsed as any) && Array.isArray((parsed as any).ids)) {
        return (parsed as any).ids.map(String).filter(Boolean);
      }
    } catch {
      // fall back to single-id drag payload
    }
    return [trimmed];
  }

  private isCopyModifierActive(ev: DragEvent): boolean {
    // Windows/Linux: Ctrl-copy. macOS typically uses Alt/Option-copy.
    return Boolean(ev.ctrlKey || ev.altKey);
  }

  private orderIdsByTree(ids: string[]): string[] {
    const wanted = new Set((ids || []).map(String));
    const ordered: string[] = [];
    const walk = (nodes: CoderNode[]) => {
      nodes.forEach((n) => {
        if (wanted.has(n.id)) ordered.push(n.id);
        if (n.type === "folder") walk(n.children);
      });
    };
    walk(this.store.snapshot().nodes);
    // Preserve any ids that weren't found (should be rare) at the end.
    ids.forEach((id) => {
      const str = String(id);
      if (str && !ordered.includes(str)) ordered.push(str);
    });
    return ordered;
  }

  private handleDragOver(ev: DragEvent, target: CoderNode, rowEl?: HTMLElement): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (!this.showDropHints) {
      if (ev.dataTransfer) {
        const hasNode = ev.dataTransfer.types.includes(NODE_MIME);
        const copy = this.isCopyModifierActive(ev);
        ev.dataTransfer.dropEffect = hasNode ? (copy ? "copy" : "move") : "copy";
      }
      return;
    }
    if (ev.dataTransfer) {
      const hasNode = ev.dataTransfer.types.includes(NODE_MIME);
      const copy = this.isCopyModifierActive(ev);
      if (target.type === "item") {
        const row = rowEl ?? ((ev.currentTarget as HTMLElement | null) ?? undefined);
        if (row) {
          if (!this.previewPinned || this.previewPinnedId === target.id) {
            this.showPreviewTooltip(target, row);
          }
        }
      }
      if (!hasNode) {
        if (target.type === "folder") {
          this.setDropTarget(target.id, "into");
          this.showDropHint(ev.clientX, ev.clientY, `Drop into “${target.name}”`, this.buildPathHint(target.id));
        } else {
          const parent = this.findParent(this.store.snapshot().nodes, target.id);
          if (parent) {
            this.setDropTarget(parent.id, "into");
            this.showDropHint(ev.clientX, ev.clientY, `Drop into “${parent.name}”`, this.buildPathHint(parent.id));
          } else {
            this.setRootDropTarget(true);
            this.showDropHint(ev.clientX, ev.clientY, "Drop at root", this.buildRootHint());
          }
        }
      } else {
        const mode = this.resolveNodeDropMode(ev, target);
        this.setDropTarget(target.id, mode);
        const action = copy ? "Copy" : "Move";
        const label =
          mode === "into"
            ? `${action} into “${target.name}”`
            : mode === "before"
            ? `${action} before “${target.name}”`
            : `${action} after “${target.name}”`;
        this.showDropHint(ev.clientX, ev.clientY, label, this.buildDropIndexHint(target, mode));
      }
      ev.dataTransfer.dropEffect = hasNode ? (copy ? "copy" : "move") : "copy";
    }
  }

  private isAncestor(ancestorId: string, childId: string): boolean {
    const state = this.store.snapshot();
    const walk = (nodes: CoderNode[], parentHit: boolean): boolean => {
      for (const n of nodes) {
        const hit = parentHit || n.id === ancestorId;
        if (n.id === childId && hit) return true;
        if (n.type === "folder" && walk(n.children, hit)) return true;
      }
      return false;
    };
    return walk(state.nodes, false);
  }

  private handleDrop(ev: DragEvent, target: CoderNode): void {
    ev.preventDefault();
    ev.stopPropagation();

    const dt = ev.dataTransfer;
    if (!dt) return;
    if (dt.types.includes(NODE_MIME)) {
      const draggedRaw = this.parseDraggedNodeIds(dt) || [];
      if (draggedRaw.length === 0) return;
      if (draggedRaw.includes(target.id)) return;

      const filtered = draggedRaw.filter((id) => id && id !== target.id && !this.isAncestor(id, target.id));
      if (filtered.length === 0) {
        this.showStatusToast("Cannot move a folder into itself.");
        this.clearDropTarget();
        return;
      }
      const dragged = this.orderIdsByTree(filtered);
      if (dragged.length === 0) return;

      const spec0 = this.buildMoveSpecForDrop(target, dragged[0]);
      if (!spec0) return;
      if (spec0.targetParentId) {
        this.expandFolderChain(spec0.targetParentId);
      }

      const copy = this.isCopyModifierActive(ev);
      if (copy) {
        const newIds = this.store.copyMany({
          nodeIds: dragged,
          targetParentId: spec0.targetParentId,
          targetIndex: spec0.targetIndex
        });
        if (newIds.length) {
          this.selection = new Set(newIds);
          this.primarySelection = newIds[newIds.length - 1] ?? null;
          this.anchorSelection = newIds[0] ?? null;
        }
      } else {
        this.selection = new Set(dragged);
        this.primarySelection = dragged[dragged.length - 1] ?? null;
        this.anchorSelection = dragged[0] ?? null;
        this.store.moveMany({ nodeIds: dragged, targetParentId: spec0.targetParentId, targetIndex: spec0.targetIndex });
      }
      this.clearDropTarget();
      return;
    }

    const { payload } = parseDropPayload(dt);
    if (!payload) {
      try {
        console.error("[CoderPanel.ts][handleDrop][error] no payload parsed", { types: Array.from(dt.types || []) });
      } catch {
        // ignore
      }
      this.showStatusToast("Drop ignored: unsupported content.");
    } else {
      const parentId = this.buildParentForPayloadDrop(target);
      this.addPayloadNode(payload, parentId);
    }
    this.clearDropTarget();
  }

  private handleRootDrop(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    const dt = ev.dataTransfer;
    if (!dt) return;
    if (dt.types.includes(NODE_MIME)) {
      const draggedRaw = this.parseDraggedNodeIds(dt) || [];
      const state = this.store.snapshot();
      const rootFolderId = state.nodes[0]?.type === "folder" ? state.nodes[0].id : null;
      const filtered = draggedRaw.filter((id) => id && (!rootFolderId || id !== rootFolderId));
      if (filtered.length === 0 && draggedRaw.length > 0) {
        this.showStatusToast("Cannot move the root folder.");
        this.clearDropTarget();
        return;
      }
      const dragged = this.orderIdsByTree(filtered);
      if (dragged.length === 0) return;

      const copy = this.isCopyModifierActive(ev);
      if (copy) {
        const newIds = this.store.copyMany({ nodeIds: dragged, targetParentId: null, targetIndex: state.nodes.length });
        if (newIds.length) {
          this.selection = new Set(newIds);
          this.primarySelection = newIds[newIds.length - 1] ?? null;
          this.anchorSelection = newIds[0] ?? null;
        }
      } else {
        this.selection = new Set(dragged);
        this.primarySelection = dragged[dragged.length - 1] ?? null;
        this.anchorSelection = dragged[0] ?? null;
        this.store.moveMany({ nodeIds: dragged, targetParentId: null, targetIndex: state.nodes.length });
      }
      this.clearDropTarget();
      return;
    }
    const { payload } = parseDropPayload(dt);
    if (payload) {
      this.addPayloadNode(payload, null);
    } else if (dt.types.length) {
      this.showStatusToast("Drop ignored: unsupported content.");
    }
    this.clearDropTarget();
  }

  private addFolderShortcut(parentId?: string | null): void {
    try {
      const parent = parentId ?? this.selectedFolderId();
      if (parent) {
        this.expandFolderChain(parent);
        this.setFolderExpanded(parent, true);
      }
      const folder = this.store.addFolder("New section", parent);
      this.setSelectionSingle(folder.id);
      this.render(this.store.snapshot());
      this.beginRename(undefined, folder);
    } catch (error) {
      console.error("[CoderPanel.ts][addFolderShortcut][error]", error);
    }
  }

  private focusFilterInput(): void {
    this.filterInput?.focus();
    this.filterInput?.select();
  }

  private setFolderExpanded(folderId: string, expanded: boolean): void {
    this.collapseStateTouched = true;
    this.store.setFolderCollapsed(folderId, !expanded);
  }

  private isFolderCollapsed(nodeId: string, state: CoderState = this.store.snapshot()): boolean {
    const collapsed = new Set((state.collapsedIds || []).map(String));
    return collapsed.has(nodeId);
  }

  private toggleAllFolders(expand: boolean): void {
    this.collapseStateTouched = true;
    const state = this.store.snapshot();
    const ids: string[] = [];
    const walk = (nodes: CoderNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "folder") {
          ids.push(node.id);
          walk(node.children);
        }
      });
    };
    walk(state.nodes);
    this.store.setCollapsedFolders(ids, !expand);
  }

  private handleGlobalKeyDown(ev: KeyboardEvent): void {
    if (this.paletteVisible && this.handlePaletteKeyDown(ev)) {
      return;
    }
    if (this.helpVisible && ev.key === "Escape") {
      ev.preventDefault();
      this.hideHelpOverlay();
      return;
    }
    const meta = ev.metaKey || ev.ctrlKey;
    const shift = ev.shiftKey;
    if (meta && shift && ev.key.toLowerCase() === "p") {
      ev.preventDefault();
      this.toggleCommandPalette();
      return;
    }
    if (meta && shift && ev.key.toLowerCase() === "l") {
      ev.preventDefault();
      this.toggleDiagnosticsOverlay();
      return;
    }
    if (this.isEditingText(ev.target)) return;
    if (ev.key === "?" || (ev.key === "/" && ev.shiftKey)) {
      ev.preventDefault();
      this.toggleHelpOverlay();
      return;
    }
    if (this.contextMenu && this.handleContextMenuShortcuts(ev)) {
      return;
    }
    this.hideContextMenu();
    const node = this.selectedNode();
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      this.deleteSelected();
      return;
    }
    if (meta && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      this.selectAllVisible();
      return;
    }
    if (ev.key === "Escape") {
      ev.preventDefault();
      this.clearSelection();
      this.render(this.store.snapshot());
      return;
    }
    if (meta && ev.key.toLowerCase() === "n") {
      ev.preventDefault();
      const parentId = shift ? null : node?.type === "folder" ? node.id : this.selectedFolderId();
      this.addFolderShortcut(parentId ?? null);
      return;
    }
    if (ev.key === "F2" || (ev.key === "Enter" && node?.type === "folder")) {
      ev.preventDefault();
      if (node) {
        this.beginRename(undefined, node);
      }
      return;
    }
    if (ev.key === "Enter" && node?.type === "item") {
      ev.preventDefault();
      this.beginRename(undefined, node);
      return;
    }
    if (ev.key === "ArrowRight" && node?.type === "folder") {
      ev.preventDefault();
      this.setFolderExpanded(node.id, true);
      return;
    }
    if (ev.key === "ArrowLeft" && node?.type === "folder") {
      ev.preventDefault();
      this.setFolderExpanded(node.id, false);
      return;
    }
    if (ev.altKey && ev.key === "ArrowRight") {
      ev.preventDefault();
      this.toggleAllFolders(true);
      return;
    }
    if (ev.altKey && ev.key === "ArrowLeft") {
      ev.preventDefault();
      this.toggleAllFolders(false);
      return;
    }
    if (ev.key === "PageUp" && meta) {
      ev.preventDefault();
      this.moveSelectionToEdge("up");
      return;
    }
    if (ev.key === "PageDown" && meta) {
      ev.preventDefault();
      this.moveSelectionToEdge("down");
      return;
    }
    if (ev.key === " " && node?.type === "folder") {
      ev.preventDefault();
      this.store.setFolderCollapsed(node.id, !this.isFolderCollapsed(node.id));
      return;
    }
    if (ev.key === "ArrowDown" && !meta) {
      ev.preventDefault();
      this.moveSelectionBy(1, shift);
      return;
    }
    if (ev.key === "ArrowUp" && !meta) {
      ev.preventDefault();
      this.moveSelectionBy(-1, shift);
      return;
    }
    if (meta && shift && ev.key === "Home") {
      ev.preventDefault();
      this.moveSelectionToRoot();
      return;
    }
    if (ev.key === "Home") {
      ev.preventDefault();
      this.jumpToEdge("start", shift);
      return;
    }
    if (ev.key === "End") {
      ev.preventDefault();
      this.jumpToEdge("end", shift);
      return;
    }
    if (meta && ev.key === "ArrowUp") {
      ev.preventDefault();
      this.moveSelected(-1);
      return;
    }
    if (meta && ev.key === "ArrowDown") {
      ev.preventDefault();
      this.moveSelected(1);
      return;
    }
    if (meta && shift && ev.key === "ArrowRight") {
      ev.preventDefault();
      this.indentSelection();
      return;
    }
    if (meta && shift && ev.key === "ArrowLeft") {
      ev.preventDefault();
      this.outdentSelection();
      return;
    }
    if (meta && ev.key.toLowerCase() === "s") {
      ev.preventDefault();
      this.refreshSavedPill();
      return;
    }
    if (meta && ev.key.toLowerCase() === "e") {
      ev.preventDefault();
      this.saveHtml();
      return;
    }
    if (meta && ev.key.toLowerCase() === "p") {
      ev.preventDefault();
      this.previewHtml();
      return;
    }
    if (meta && ev.key.toLowerCase() === "f") {
      ev.preventDefault();
      this.focusFilterInput();
      return;
    }
    if ((meta && ev.key.toLowerCase() === "g") || ev.key === "F3") {
      ev.preventDefault();
      this.jumpToNextMatch();
      return;
    }
    if (ev.shiftKey && ev.key === "F3") {
      ev.preventDefault();
      this.jumpToPrevMatch();
      return;
    }
    if (meta && ev.shiftKey && ev.key.toLowerCase() === "v") {
      ev.preventDefault();
      void this.pasteAsNewItem();
      return;
    }
    if (meta && ev.key.toLowerCase() === "d") {
      ev.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (ev.altKey && ev.key.toLowerCase() === "n") {
      ev.preventDefault();
      this.noteBox.classList.toggle("coder-note-visible");
      return;
    }
    if (!meta && node?.type === "item" && ["1", "2", "3"].includes(ev.key)) {
      ev.preventDefault();
      const mapping: Record<"1" | "2" | "3", CoderStatus> = {
        "1": "Included",
        "2": "Maybe",
        "3": "Excluded"
      };
      this.setStatus(mapping[ev.key as "1" | "2" | "3"]);
    }
  }

  private setSelectionSingle(id: string): void {
    this.selection = new Set([id]);
    this.primarySelection = id;
    this.anchorSelection = id;
    this.render(this.store.snapshot());
  }

  private setSelectionSingleSilent(id: string): void {
    this.selection = new Set([id]);
    this.primarySelection = id;
    this.anchorSelection = id;
  }

  private toggleSelection(id: string): void {
    const next = new Set(this.selection);
    if (next.has(id)) {
      next.delete(id);
      if (this.primarySelection === id) {
        this.primarySelection = next.size ? Array.from(next).pop() ?? null : null;
      }
    } else {
      next.add(id);
      this.primarySelection = id;
      this.anchorSelection = id;
    }
    this.selection = next;
    this.render(this.store.snapshot());
  }

  private selectRange(id: string): void {
    const anchor = this.anchorSelection ?? this.primarySelection;
    if (!anchor) {
      this.setSelectionSingle(id);
      this.render(this.store.snapshot());
      return;
    }
    const visible = this.getVisibleNodeIds();
    const aIdx = visible.indexOf(anchor);
    const bIdx = visible.indexOf(id);
    if (aIdx < 0 || bIdx < 0) {
      this.setSelectionSingle(id);
      this.render(this.store.snapshot());
      return;
    }
    const start = Math.min(aIdx, bIdx);
    const end = Math.max(aIdx, bIdx);
    this.selection = new Set(visible.slice(start, end + 1));
    this.primarySelection = id;
    if (!this.anchorSelection) this.anchorSelection = anchor;
    this.render(this.store.snapshot());
  }

  private clearSelection(): void {
    this.selection.clear();
    this.primarySelection = null;
    this.anchorSelection = null;
  }

  private selectAllVisible(): void {
    const visible = this.getVisibleNodeIds();
    this.selection = new Set(visible);
    this.primarySelection = visible.length ? visible[visible.length - 1] : null;
    this.anchorSelection = visible.length ? visible[0] : null;
    this.render(this.store.snapshot());
  }

  private moveSelectionBy(delta: number, extend: boolean): void {
    const visible = this.getVisibleNodeIds();
    if (visible.length === 0) return;
    const current = this.primarySelection ? visible.indexOf(this.primarySelection) : -1;
    const base = current >= 0 ? current : delta > 0 ? -1 : visible.length;
    const nextIndex = Math.min(visible.length - 1, Math.max(0, base + delta));
    const nextId = visible[nextIndex];
    if (extend) {
      this.selectRange(nextId);
    } else {
      this.setSelectionSingle(nextId);
    }
  }

  private moveSelectionToEdge(direction: "up" | "down"): void {
    const visible = this.getVisibleNodeIds();
    if (visible.length === 0) return;
    const ids = this.getTopLevelSelected();
    if (ids.length === 0) return;
    const state = this.store.snapshot();
    const id = ids[ids.length - 1];
    const parent = this.findParent(state.nodes, id);
    const siblings = parent ? parent.children : state.nodes;
    const targetIndex = direction === "up" ? 0 : siblings.length - 1;
    ids.forEach((nodeId, offset) => {
      this.store.move({
        nodeId,
        targetParentId: parent ? parent.id : null,
        targetIndex: targetIndex + offset
      });
    });
    this.setSelectionSingle(ids[ids.length - 1]);
    this.render(this.store.snapshot());
    this.scrollNodeIntoView(ids[ids.length - 1]);
  }

  private jumpToEdge(edge: "start" | "end", extend: boolean): void {
    const visible = this.getVisibleNodeIds();
    if (visible.length === 0) return;
    const targetId = edge === "start" ? visible[0] : visible[visible.length - 1];
    if (extend) {
      this.selectRange(targetId);
    } else {
      this.setSelectionSingle(targetId);
    }
  }

  private handleContextMenuShortcuts(ev: KeyboardEvent): boolean {
    const node = this.selectedNode();
    if (!node) return false;
    const key = ev.key.toLowerCase();
    if (key === "escape") {
      ev.preventDefault();
      this.hideContextMenu();
      return true;
    }
    if (key === "r" || ev.key === "F2") {
      ev.preventDefault();
      this.beginRename(undefined, node);
      this.hideContextMenu();
      return true;
    }
    if (key === "delete" || key === "backspace") {
      ev.preventDefault();
      this.deleteSelected();
      this.hideContextMenu();
      return true;
    }
    if (["1", "2", "3"].includes(ev.key) && node.type === "item") {
      ev.preventDefault();
      const mapping: Record<"1" | "2" | "3", CoderStatus> = {
        "1": "Included",
        "2": "Maybe",
        "3": "Excluded"
      };
      this.setStatus(mapping[ev.key as "1" | "2" | "3"]);
      this.hideContextMenu();
      return true;
    }
    if (key === "n" && node.type === "folder") {
      ev.preventDefault();
      this.addFolderShortcut(node.id);
      this.hideContextMenu();
      return true;
    }
    return false;
  }

  private getVisibleNodeIds(): string[] {
    if (this.virtualEnabled) {
      return this.virtualNodes.map((entry) => entry.node.id);
    }
    const nodes = Array.from(this.treeHost.querySelectorAll(".coder-node")) as HTMLElement[];
    return nodes
      .filter((node) => !node.classList.contains("is-hidden") && node.offsetParent !== null)
      .map((node) => node.dataset.id)
      .filter((id): id is string => Boolean(id));
  }

  private jumpToNextMatch(): void {
    if (!this.matchedIds.length) return;
    const current = this.primarySelection ? this.matchedIds.indexOf(this.primarySelection) : -1;
    const nextIndex = current >= 0 ? (current + 1) % this.matchedIds.length : 0;
    const nextId = this.matchedIds[nextIndex];
    if (!nextId) return;
    this.setSelectionSingle(nextId);
    this.scrollNodeIntoView(nextId);
  }

  private jumpToPrevMatch(): void {
    if (!this.matchedIds.length) return;
    const current = this.primarySelection ? this.matchedIds.indexOf(this.primarySelection) : -1;
    const prevIndex = current > 0 ? current - 1 : this.matchedIds.length - 1;
    const prevId = this.matchedIds[prevIndex];
    if (!prevId) return;
    this.setSelectionSingle(prevId);
    this.scrollNodeIntoView(prevId);
  }

  private scrollNodeIntoView(nodeId: string): void {
    const target = this.treeHost.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null;
    if (target) {
      target.scrollIntoView({ block: "nearest" });
      return;
    }
    if (this.virtualEnabled) {
      const index = this.virtualIndexById.get(nodeId);
      if (typeof index === "number") {
        this.treeHost.scrollTop = index * this.virtualRowHeight;
        this.renderVirtualWindow(true);
      }
    }
  }

  private getTopLevelSelected(): string[] {
    const ids = Array.from(this.selection);
    return ids.filter((id) => !ids.some((other) => other !== id && this.isAncestor(other, id)));
  }

  private indentSelection(): void {
    const ids = this.getTopLevelSelected();
    if (!ids.length) return;
    const state = this.store.snapshot();
    const primaryId = this.primarySelection ?? ids[ids.length - 1];
    const parent = this.findParent(state.nodes, primaryId);
    const siblings = parent ? parent.children : state.nodes;
    const idx = siblings.findIndex((n) => n.id === primaryId);
    if (idx <= 0) return;
    // find nearest previous folder sibling
    for (let i = idx - 1; i >= 0; i -= 1) {
      const candidate = siblings[i];
      if (candidate.type === "folder") {
        const targetParentId = candidate.id;
        const targetIndex = candidate.children.length;
        this.store.moveMany({ nodeIds: ids, targetParentId, targetIndex });
        this.selection = new Set(ids);
        this.primarySelection = ids[ids.length - 1] ?? null;
        this.anchorSelection = ids[0] ?? null;
        this.render(this.store.snapshot());
        this.scrollNodeIntoView(this.primarySelection ?? ids[0]);
        return;
      }
    }
  }

  private outdentSelection(): void {
    const ids = this.getTopLevelSelected();
    if (!ids.length) return;
    const state = this.store.snapshot();
    const primaryId = this.primarySelection ?? ids[ids.length - 1];
    const parent = this.findParent(state.nodes, primaryId);
    if (!parent) return; // already root
    const grand = this.findParent(state.nodes, parent.id);
    const grandSiblings = grand ? grand.children : state.nodes;
    const parentIdx = grandSiblings.findIndex((n) => n.id === parent.id);
    if (parentIdx < 0) return;
    const targetParentId = grand ? grand.id : null;
    const targetIndex = parentIdx + 1;
    this.store.moveMany({ nodeIds: ids, targetParentId, targetIndex });
    this.selection = new Set(ids);
    this.primarySelection = ids[ids.length - 1] ?? null;
    this.anchorSelection = ids[0] ?? null;
    this.render(this.store.snapshot());
    this.scrollNodeIntoView(this.primarySelection ?? ids[0]);
  }

  private moveSelectionToRoot(): void {
    const ids = this.getTopLevelSelected();
    if (!ids.length) return;
    const state = this.store.snapshot();
    const rootFolderId = state.nodes[0]?.type === "folder" ? state.nodes[0].id : null;
    const filtered = rootFolderId ? ids.filter((id) => id !== rootFolderId) : ids;
    if (!filtered.length) return;
    const targetIndex = state.nodes.length;
    this.store.moveMany({ nodeIds: filtered, targetParentId: null, targetIndex });
    this.selection = new Set(filtered);
    this.primarySelection = filtered[filtered.length - 1] ?? null;
    this.anchorSelection = filtered[0] ?? null;
    this.render(this.store.snapshot());
    this.scrollNodeIntoView(this.primarySelection ?? filtered[0]);
  }

  private handleGlobalClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (this.contextMenu) {
      if (target && this.contextMenu.contains(target)) return;
      this.hideContextMenu();
    }
    if (this.previewPinned) {
      const withinTooltip = target ? this.previewTooltip?.contains(target) : false;
      const withinSurface = target ? this.element.contains(target) : false;
      const withinNode = target ? Boolean(target.closest(".coder-node")) : false;
      if (!withinTooltip && (!withinSurface || !withinNode)) {
        this.clearPinnedPreview();
      }
    }
  }

  private handleTreeContextMenu(ev: MouseEvent): void {
    const target = (ev.target as HTMLElement | null)?.closest(".coder-node") as HTMLElement | null;
    if (!target) return;
    ev.preventDefault();
    const nodeId = target.dataset.id;
    const node = nodeId ? this.nodeById(nodeId) : null;
    if (!node) return;
    this.setSelectionSingle(node.id);
    this.openContextMenu(node, { x: ev.clientX, y: ev.clientY });
  }

  private nodeById(id: string, state: CoderState = this.store.snapshot()): CoderNode | null {
    const finder = (nodes: CoderNode[]): CoderNode | null => {
      for (const node of nodes) {
        if (node.id === id) return node;
        if (node.type === "folder") {
          const child = finder(node.children);
          if (child) return child;
        }
      }
      return null;
    };
    return finder(state.nodes);
  }

  private openContextMenu(node: CoderNode, position: { x: number; y: number }): void {
    this.hideContextMenu();
    const menu = document.createElement("div");
    menu.className = "coder-context-menu";
    const buildAction = (label: string, handler: () => void) => {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "coder-context-action";
      action.textContent = label;
      action.ariaLabel = label;
      action.dataset.voiceAliases = label;
      action.addEventListener("click", () => {
        handler();
        this.hideContextMenu();
      });
      menu.append(action);
    };
    buildAction("Rename (F2)", () => this.beginRename(undefined, node));
    if (node.type === "folder") {
      buildAction("New subfolder", () => this.addFolderShortcut(node.id));
    }
    buildAction("Expand all sections", () => this.toggleAllFolders(true));
    buildAction("Collapse all sections", () => this.toggleAllFolders(false));
    buildAction("Delete (Del)", () => this.deleteSelected());
    buildAction("Move Up (↑)", () => this.moveSelected(-1));
    buildAction("Move Down (↓)", () => this.moveSelected(1));
    buildAction("Mark Included (1)", () => this.setStatus("Included", node.id));
    buildAction("Mark Maybe (2)", () => this.setStatus("Maybe", node.id));
    buildAction("Mark Excluded (3)", () => this.setStatus("Excluded", node.id));
    menu.style.left = `${position.x}px`;
    menu.style.top = `${position.y}px`;
    this.contextMenuTarget = node;
    this.contextMenu = menu;
    document.body.append(menu);
  }

  private hideContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = undefined;
    }
    this.contextMenuTarget = null;
  }

  private findSiblingIndex(nodeId: string): number | null {
    const state = this.store.snapshot();
    const parent = this.findParent(state.nodes, nodeId);
    const siblings = parent ? parent.children : state.nodes;
    const idx = siblings.findIndex((n) => n.id === nodeId);
    return idx >= 0 ? idx : null;
  }

  private addPayloadNode(payload: CoderPayload, parentId: string | null): void {
    const parentName =
      parentId ? (this.nodeById(parentId)?.type === "folder" ? (this.nodeById(parentId) as any).name : "") : "";
    try {
      (payload as any).coder_id = (payload as any).coder_id || undefined;
      (payload as any).coder_parent_id = parentId || "";
      (payload as any)._coder_target = {
        node_id: parentId || "",
        name: parentName || "",
        is_root: !parentId
      };
    } catch {
      // ignore payload mutation failures
    }
    if (parentId) {
      // Ensure the target folder chain is visible so the new node doesn't "disappear".
      this.expandFolderChain(parentId);
    }
    const node = this.store.addItem(payload, parentId);
    try {
      const derived = this.deriveTitleFromPayload(payload);
      if (derived && this.isPlaceholderTitle(node.name)) {
        this.store.rename(node.id, derived);
      }
      if (derived && this.isPlaceholderTitle(String((node.payload as any).title || ""))) {
        (node.payload as any).title = derived;
      }
    } catch (error) {
      console.error("[CoderPanel.ts][addPayloadNode][error]", error);
    }
    try {
      (node.payload as any).coder_id = node.id;
      (node.payload as any).coder_parent_id = parentId || "";
      (node.payload as any)._coder_item_id = node.id;
    } catch {
      // ignore
    }
    this.setSelectionSingle(node.id);
    this.persistPayloadFile(node);
  }

  private expandFolderChain(folderId: string): void {
    const state = this.store.snapshot();
    let current: string | null = folderId;
    while (current) {
      this.store.setFolderCollapsed(current, false);
      const parent = this.findParent(state.nodes, current);
      current = parent?.id ?? null;
    }
  }

  private setDropTarget(nodeId: string, mode: "into" | "after" | "before"): void {
    if (this.activeDropTargetId && this.activeDropTargetId !== nodeId) {
      this.clearDropTarget();
    }
    const el = this.treeHost.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null;
    if (!el) return;
    el.classList.add("coder-drop-target");
    el.classList.toggle("coder-drop-into", mode === "into");
    el.classList.toggle("coder-drop-after", mode === "after");
    el.classList.toggle("coder-drop-before", mode === "before");
    this.activeDropTargetId = nodeId;
    this.activeDropMode = mode;
    this.setRootDropTarget(false);
  }

  private setRootDropTarget(active: boolean): void {
    if (active) {
      this.treeHost.classList.add("coder-drop-root");
    } else {
      this.treeHost.classList.remove("coder-drop-root");
    }
  }

  private clearDropTarget(): void {
    if (this.activeDropTargetId) {
      const el = this.treeHost.querySelector(`[data-id="${this.activeDropTargetId}"]`) as HTMLElement | null;
      if (el) {
        el.classList.remove("coder-drop-target", "coder-drop-into", "coder-drop-after", "coder-drop-before");
      }
    }
    this.setRootDropTarget(false);
    this.activeDropTargetId = null;
    this.activeDropMode = null;
    this.hideDropHint();
  }

  private isEditingText(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select";
  }

  private handleTreeDragOver(ev: DragEvent): void {
    const target = ev.target as HTMLElement | null;
    if (target?.closest?.(".coder-node")) return;
    ev.preventDefault();
    this.setRootDropTarget(true);
    const hasNode = ev.dataTransfer ? ev.dataTransfer.types.includes(NODE_MIME) : false;
    if (hasNode) {
      const action = this.isCopyModifierActive(ev) ? "Copy" : "Move";
      this.showDropHint(ev.clientX, ev.clientY, `${action} to root`, this.buildRootHint());
    } else {
      this.showDropHint(ev.clientX, ev.clientY, "Drop at root", this.buildRootHint());
    }
  }

  private ensureDropHint(): HTMLDivElement {
    if (this.dropHint) return this.dropHint;
    const hint = document.createElement("div");
    hint.className = "coder-drop-hint";
    const title = document.createElement("div");
    title.className = "coder-drop-hint-title";
    const meta = document.createElement("div");
    meta.className = "coder-drop-hint-meta";
    hint.append(title, meta);
    document.body.append(hint);
    this.dropHint = hint;
    return hint;
  }

  private showDropHint(x: number, y: number, text: string, metaText?: string): void {
    if (!this.showDropHints) return;
    const hint = this.ensureDropHint();
    const title = hint.querySelector(".coder-drop-hint-title") as HTMLElement | null;
    const meta = hint.querySelector(".coder-drop-hint-meta") as HTMLElement | null;
    if (title) title.textContent = text;
    if (meta) meta.textContent = metaText || "";
    hint.style.left = `${x + 12}px`;
    hint.style.top = `${y + 12}px`;
    hint.classList.add("is-visible");
  }

  private hideDropHint(): void {
    if (!this.dropHint) return;
    this.dropHint.classList.remove("is-visible");
  }

  private ensureHelpOverlay(): void {
    if (this.helpOverlay) return;
    const overlay = document.createElement("div");
    overlay.className = "coder-help-overlay";
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        this.hideHelpOverlay();
      }
    });

    const card = document.createElement("div");
    card.className = "coder-help-card";
    const header = document.createElement("div");
    header.className = "coder-help-header";
    const title = document.createElement("div");
    title.className = "coder-help-title";
    title.textContent = "Coder shortcuts";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "coder-help-close";
  closeBtn.textContent = "Close";
  closeBtn.ariaLabel = "Close help panel";
  closeBtn.title = "Close help panel";
  closeBtn.dataset.voiceAliases = "close help,close panel,close";
  closeBtn.addEventListener("click", () => this.hideHelpOverlay());
    header.append(title, closeBtn);

    const list = document.createElement("div");
    list.className = "coder-help-list";
    this.getShortcutList().forEach(({ keys, desc }) => {
      const row = document.createElement("div");
      row.className = "coder-help-row";
      const k = document.createElement("span");
      k.className = "coder-help-keys";
      k.textContent = keys;
      const d = document.createElement("span");
      d.className = "coder-help-desc";
      d.textContent = desc;
      row.append(k, d);
      list.appendChild(row);
    });

    card.append(header, list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.helpOverlay = overlay;
  }

  private ensureCommandPalette(): void {
    if (this.paletteOverlay) return;
    const overlay = document.createElement("div");
    overlay.className = "coder-palette-overlay";
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        this.hideCommandPalette();
      }
    });

    const card = document.createElement("div");
    card.className = "coder-palette-card";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type a command…";
    input.className = "coder-palette-input";
    input.addEventListener("input", () => this.updatePaletteList());
    input.addEventListener("keydown", (ev) => this.handlePaletteKeyDown(ev));

    const list = document.createElement("div");
    list.className = "coder-palette-list";

    card.append(input, list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.paletteOverlay = overlay;
    this.paletteInput = input;
    this.paletteList = list;
  }

  private toggleCommandPalette(): void {
    if (!this.paletteOverlay) this.ensureCommandPalette();
    if (!this.paletteOverlay) return;
    this.paletteVisible = !this.paletteVisible;
    this.paletteOverlay.classList.toggle("is-visible", this.paletteVisible);
    if (this.paletteVisible && this.paletteInput) {
      this.paletteInput.value = "";
      this.paletteIndex = 0;
      this.updatePaletteList();
      this.paletteInput.focus();
      this.paletteInput.select();
    }
  }

  private hideCommandPalette(): void {
    if (!this.paletteOverlay) return;
    this.paletteVisible = false;
    this.paletteOverlay.classList.remove("is-visible");
  }

  private handlePaletteKeyDown(ev: KeyboardEvent): boolean {
    if (!this.paletteVisible) return false;
    const list = this.paletteFiltered;
    if (ev.key === "Escape") {
      ev.preventDefault();
      this.hideCommandPalette();
      return true;
    }
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      if (list.length) {
        this.paletteIndex = (this.paletteIndex + 1) % list.length;
        this.updatePaletteList();
      }
      return true;
    }
    if (ev.key === "ArrowUp") {
      ev.preventDefault();
      if (list.length) {
        this.paletteIndex = (this.paletteIndex - 1 + list.length) % list.length;
        this.updatePaletteList();
      }
      return true;
    }
    if (ev.key === "Enter") {
      ev.preventDefault();
      const action = list[this.paletteIndex];
      if (action && action.enabled) {
        this.hideCommandPalette();
        action.run();
      }
      return true;
    }
    return false;
  }

  private updatePaletteList(): void {
    if (!this.paletteList || !this.paletteInput) return;
    const query = this.paletteInput.value.trim().toLowerCase();
    const actions = this.getPaletteActions();
    const filtered = actions.filter((action) => {
      if (!query) return true;
      return action.label.toLowerCase().includes(query) || action.keywords.includes(query);
    });
    this.paletteFiltered = filtered;
    if (this.paletteIndex >= filtered.length) this.paletteIndex = 0;
    this.paletteList.innerHTML = "";
    filtered.forEach((action, index) => {
      const row = document.createElement("div");
      row.className = "coder-palette-row";
      if (!action.enabled) row.classList.add("is-disabled");
      if (index === this.paletteIndex) row.classList.add("is-selected");
      row.textContent = action.label;
      row.addEventListener("click", () => {
        if (!action.enabled) return;
        this.hideCommandPalette();
        action.run();
      });
      this.paletteList?.appendChild(row);
    });
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "coder-palette-empty";
      empty.textContent = "No matching commands";
      this.paletteList.appendChild(empty);
    }
  }

  private getPaletteActions(): Array<{ id: string; label: string; keywords: string; enabled: boolean; run: () => void }> {
    const node = this.selectedNode();
    const hasSelection = Boolean(node);
    const isFolder = node?.type === "folder";
    const isItem = node?.type === "item";
    return [
      {
        id: "new-folder",
        label: "New folder",
        keywords: "folder section add create",
        enabled: true,
        run: () => this.addFolderShortcut(isFolder ? node?.id : this.selectedFolderId())
      },
      {
        id: "new-folder-root",
        label: "New folder at root",
        keywords: "folder section root add create",
        enabled: true,
        run: () => this.addFolderShortcut(null)
      },
      {
        id: "rename",
        label: "Rename selection",
        keywords: "rename edit title",
        enabled: hasSelection,
        run: () => node && this.beginRename(undefined, node)
      },
      {
        id: "delete",
        label: "Delete selection",
        keywords: "delete remove",
        enabled: hasSelection,
        run: () => this.deleteSelected()
      },
      {
        id: "duplicate",
        label: "Duplicate selection",
        keywords: "duplicate copy",
        enabled: hasSelection,
        run: () => this.duplicateSelection()
      },
      {
        id: "move-root",
        label: "Move selection to root",
        keywords: "move root",
        enabled: hasSelection,
        run: () => this.moveSelectionToRoot()
      },
      {
        id: "indent",
        label: "Indent selection",
        keywords: "indent nest",
        enabled: hasSelection,
        run: () => this.indentSelection()
      },
      {
        id: "outdent",
        label: "Outdent selection",
        keywords: "outdent unnest",
        enabled: hasSelection,
        run: () => this.outdentSelection()
      },
      {
        id: "expand-all",
        label: "Expand all folders",
        keywords: "expand open",
        enabled: true,
        run: () => this.toggleAllFolders(true)
      },
      {
        id: "collapse-all",
        label: "Collapse all folders",
        keywords: "collapse close",
        enabled: true,
        run: () => this.toggleAllFolders(false)
      },
      {
        id: "focus-filter",
        label: "Focus filter",
        keywords: "filter search",
        enabled: true,
        run: () => this.focusFilterInput()
      },
      {
        id: "toggle-note",
        label: "Toggle note panel",
        keywords: "note panel",
        enabled: true,
        run: () => this.noteBox.classList.toggle("coder-note-visible")
      },
      {
        id: "show-shortcuts",
        label: "Show shortcuts",
        keywords: "help shortcuts",
        enabled: true,
        run: () => this.toggleHelpOverlay()
      },
      {
        id: "diagnostics",
        label: "Toggle diagnostics",
        keywords: "logs diagnostics",
        enabled: true,
        run: () => this.toggleDiagnosticsOverlay()
      },
      {
        id: "clear-selection",
        label: "Clear selection",
        keywords: "clear selection",
        enabled: hasSelection,
        run: () => {
          this.clearSelection();
          this.render(this.store.snapshot());
        }
      }
    ];
  }

  private toggleHelpOverlay(): void {
    if (!this.helpOverlay) this.ensureHelpOverlay();
    if (!this.helpOverlay) return;
    this.helpVisible = !this.helpVisible;
    this.helpOverlay.classList.toggle("is-visible", this.helpVisible);
  }

  private hideHelpOverlay(): void {
    if (!this.helpOverlay) return;
    this.helpVisible = false;
    this.helpOverlay.classList.remove("is-visible");
  }

  private ensureDiagnosticsOverlay(): void {
    if (this.diagnosticsOverlay) return;
    const overlay = document.createElement("div");
    overlay.className = "coder-diag-overlay";
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        this.hideDiagnosticsOverlay();
      }
    });

    const card = document.createElement("div");
    card.className = "coder-diag-card";
    const header = document.createElement("div");
    header.className = "coder-diag-header";
    const title = document.createElement("div");
    title.className = "coder-diag-title";
    title.textContent = "Coder diagnostics";
    const actions = document.createElement("div");
    actions.className = "coder-diag-actions";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "coder-help-close";
    clearBtn.textContent = "Clear";
    clearBtn.ariaLabel = "Clear diagnostics";
    clearBtn.title = "Clear diagnostics";
    clearBtn.dataset.voiceAliases = "clear diagnostics,empty diagnostics";
    clearBtn.addEventListener("click", () => {
      this.diagnostics = [];
      this.updateDiagnosticsList();
    });
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "coder-help-close";
    closeBtn.textContent = "Close";
    closeBtn.ariaLabel = "Close diagnostics panel";
    closeBtn.title = "Close diagnostics panel";
    closeBtn.dataset.voiceAliases = "close diagnostics,close";
    closeBtn.addEventListener("click", () => this.hideDiagnosticsOverlay());
    actions.append(clearBtn, closeBtn);
    header.append(title, actions);

    const list = document.createElement("div");
    list.className = "coder-diag-list";

    card.append(header, list);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.diagnosticsOverlay = overlay;
    this.diagnosticsList = list;
  }

  private toggleDiagnosticsOverlay(): void {
    if (!this.diagnosticsOverlay) this.ensureDiagnosticsOverlay();
    if (!this.diagnosticsOverlay) return;
    this.diagnosticsVisible = !this.diagnosticsVisible;
    this.diagnosticsOverlay.classList.toggle("is-visible", this.diagnosticsVisible);
    if (this.diagnosticsVisible) {
      this.updateDiagnosticsList();
    }
  }

  private hideDiagnosticsOverlay(): void {
    if (!this.diagnosticsOverlay) return;
    this.diagnosticsVisible = false;
    this.diagnosticsOverlay.classList.remove("is-visible");
  }

  private recordDiagnostic(message: string): void {
    const ts = new Date().toISOString().replace("T", " ").replace("Z", "");
    this.diagnostics.push({ ts, message });
    if (this.diagnostics.length > 50) {
      this.diagnostics = this.diagnostics.slice(this.diagnostics.length - 50);
    }
    if (this.diagnosticsVisible) {
      this.updateDiagnosticsList();
    }
  }

  private updateDiagnosticsList(): void {
    if (!this.diagnosticsList) return;
    this.diagnosticsList.innerHTML = "";
    if (this.diagnostics.length === 0) {
      const empty = document.createElement("div");
      empty.className = "coder-diag-empty";
      empty.textContent = "No diagnostics recorded yet.";
      this.diagnosticsList.appendChild(empty);
      return;
    }
    this.diagnostics.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "coder-diag-row";
      const ts = document.createElement("span");
      ts.className = "coder-diag-ts";
      ts.textContent = entry.ts;
      const msg = document.createElement("span");
      msg.className = "coder-diag-msg";
      msg.textContent = entry.message;
      row.append(ts, msg);
      this.diagnosticsList?.appendChild(row);
    });
  }

  private ensureFileOverlay(): void {
    if (this.fileOverlay) return;
    const overlay = document.createElement("div");
    overlay.className = "coder-file-overlay";
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) {
        this.hideFileOverlay();
      }
    });

    const card = document.createElement("div");
    card.className = "coder-file-card";
    const header = document.createElement("div");
    header.className = "coder-file-header";
    const title = document.createElement("div");
    title.className = "coder-file-title";
    title.textContent = "Coder files";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "coder-help-close";
    closeBtn.textContent = "Close";
    closeBtn.ariaLabel = "Close file picker";
    closeBtn.title = "Close file picker";
    closeBtn.dataset.voiceAliases = "close files,close picker,close file picker";
    closeBtn.addEventListener("click", () => this.hideFileOverlay());
    header.append(title, closeBtn);

    const list = document.createElement("div");
    list.className = "coder-file-list";

    const footer = document.createElement("div");
    footer.className = "coder-file-footer";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "New coder name…";
    input.className = "coder-file-input";
    const createBtn = document.createElement("button");
    createBtn.type = "button";
    createBtn.className = "coder-btn";
    createBtn.textContent = "Create new";
    createBtn.ariaLabel = "Create new coder";
    createBtn.title = "Create new coder";
    createBtn.dataset.voiceAliases = "create new coder,new coder file";
    createBtn.addEventListener("click", () => {
      const name = input.value.trim();
      void this.createNewCoder(name);
    });
    footer.append(input, createBtn);

    card.append(header, list, footer);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    this.fileOverlay = overlay;
    this.fileList = list;
    this.fileInput = input;
  }

  private showFileOverlay(): void {
    if (!this.fileOverlay) this.ensureFileOverlay();
    if (!this.fileOverlay) return;
    this.fileOverlay.classList.add("is-visible");
  }

  private hideFileOverlay(): void {
    if (!this.fileOverlay) return;
    this.fileOverlay.classList.remove("is-visible");
  }

  private async openFileManager(): Promise<void> {
    const bridge = window.coderBridge;
    if (!bridge?.listStates) {
      this.showStatusToast("File manager unavailable.");
      return;
    }
    this.ensureFileOverlay();
    if (!this.fileList) return;
    this.fileList.innerHTML = "";
    this.showFileOverlay();
    if (this.fileInput) {
      this.fileInput.value = "";
    }
    try {
      const result = await bridge.listStates({ scopeId: this.scopeId, projectPath: this.projectPath ?? undefined });
      const files = result?.files || [];
      const activePath = this.loadedStatePath ?? this.store.getStatePathOverride();
      if (!files.length) {
        const empty = document.createElement("div");
        empty.className = "coder-file-empty";
        empty.textContent = "No coder files yet.";
        this.fileList.appendChild(empty);
      } else {
        files.forEach((file) => {
          const row = document.createElement("div");
          row.className = "coder-file-row";
          if (activePath && file.path === activePath) {
            row.classList.add("is-active");
          }
          const name = document.createElement("div");
          name.className = "coder-file-name";
          name.textContent = file.name;
          const meta = document.createElement("div");
          meta.className = "coder-file-meta";
          meta.textContent = new Date(file.updatedUtc).toLocaleString();
          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.className = "coder-btn";
          openBtn.textContent = "Open";
          openBtn.ariaLabel = "Open coder file";
          openBtn.title = "Open coder file";
          openBtn.dataset.voiceAliases = "open file,open coder";
          openBtn.addEventListener("click", () => {
            void this.openCoderState(file.path);
          });
          row.append(name, meta, openBtn);
          this.fileList?.appendChild(row);
        });
      }
    } catch (error) {
      console.warn("[CoderPanel] Unable to load coder files", error);
      const empty = document.createElement("div");
      empty.className = "coder-file-empty";
      empty.textContent = "Unable to load coder files.";
      this.fileList.appendChild(empty);
    }
  }

  private async saveAsPrompt(): Promise<void> {
    const bridge = window.coderBridge;
    if (!bridge?.pickSavePath) {
      this.showStatusToast("Save As unavailable.");
      return;
    }
    const suggestedName = this.titleText?.textContent || "";
    const resolved = await bridge.pickSavePath({
      scopeId: this.scopeId,
      projectPath: this.projectPath ?? undefined,
      statePath: this.loadedStatePath ?? this.store.getStatePathOverride() ?? undefined,
      name: suggestedName || undefined
    });
    if (!resolved?.statePath) {
      return;
    }
    this.store.setStatePathOverride(resolved.statePath);
    const name = this.deriveTitleFromPath(resolved.statePath);
    await this.store.persistNow("saveAs", name);
    this.loadedStatePath = resolved.statePath;
    this.loadedBaseDir = resolved.baseDir;
    this.updateCoderTitle(name, resolved.statePath);
    this.writeLastOpenedStatePath(resolved.statePath);
    if (this.syncPill) {
      this.syncPill.title = `Loaded from ${resolved.statePath}`;
    }
  }

  private async createNewCoderFromPrompt(): Promise<void> {
    const name = window.prompt("New coder name…", "");
    if (!name) return;
    await this.createNewCoder(name.trim());
  }

  private async createNewCoder(name: string): Promise<void> {
    if (!name) {
      this.showStatusToast("Enter a name to create a coder file.");
      return;
    }
    const bridge = window.coderBridge;
    if (!bridge?.resolveStatePath) {
      this.showStatusToast("Create file unavailable.");
      return;
    }
    const resolved = await bridge.resolveStatePath({
      scopeId: this.scopeId,
      projectPath: this.projectPath ?? undefined,
      name
    });
    if (!resolved?.statePath) {
      this.showStatusToast("Unable to create coder file.");
      return;
    }
    this.store.setStatePathOverride(resolved.statePath);
    const root = createFolder("My collection");
    this.store.replaceTree([root], { source: "newFile", skipPersist: true });
    await this.store.persistNow("newFile", name);
    this.loadedStatePath = resolved.statePath;
    this.loadedBaseDir = resolved.baseDir;
    this.updateCoderTitle(name, resolved.statePath);
    this.writeLastOpenedStatePath(resolved.statePath);
    if (this.syncPill) {
      this.syncPill.title = `Loaded from ${resolved.statePath}`;
    }
    this.hideFileOverlay();
  }

  private async openCoderState(statePath: string): Promise<void> {
    const result = await this.store.loadFromDiskAt(statePath);
    if (!result) {
      this.showStatusToast("Unable to open coder file.");
      return;
    }
    this.loadedStatePath = result.statePath;
    this.loadedBaseDir = result.baseDir;
    this.updateCoderTitle(result.metaTitle, result.statePath);
    this.writeLastOpenedStatePath(result.statePath);
    if (this.syncPill) {
      this.syncPill.title = `Loaded from ${result.statePath}`;
    }
    this.ensureInitialCollapsed();
    this.hideFileOverlay();
  }

  private getShortcutList(): Array<{ keys: string; desc: string }> {
    return [
      { keys: "?", desc: "Show/hide this shortcuts panel" },
      { keys: "Ctrl/Cmd + Shift + P", desc: "Open command palette" },
      { keys: "Ctrl/Cmd + Shift + L", desc: "Open diagnostics panel" },
      { keys: "Drag", desc: "Move item/folder within the tree" },
      { keys: "Ctrl/Alt + Drag", desc: "Copy item/folder to target" },
      { keys: "Delete / Backspace", desc: "Delete selection" },
      { keys: "F2 or Enter", desc: "Rename selected node" },
      { keys: "Ctrl/Cmd + N (Shift for root)", desc: "New folder" },
      { keys: "Arrow Up/Down", desc: "Change selection (Shift extends range)" },
      { keys: "Ctrl/Cmd + Arrow Up/Down", desc: "Move node up/down within its folder" },
      { keys: "Ctrl/Cmd + PageUp/PageDown", desc: "Move node to top/bottom of its folder" },
      { keys: "Ctrl/Cmd + Shift + Home", desc: "Move selection to root" },
      { keys: "Ctrl/Cmd + Shift + Arrow Right", desc: "Indent selection into previous folder sibling" },
      { keys: "Ctrl/Cmd + Shift + Arrow Left", desc: "Outdent selection to parent folder" },
      { keys: "Home / End", desc: "Jump to first/last visible row (Shift extends)" },
      { keys: "Ctrl/Cmd + D", desc: "Duplicate selection" },
      { keys: "Ctrl/Cmd + Shift + V", desc: "Paste clipboard as new item" },
      { keys: "1 / 2 / 3", desc: "Set status: Included / Maybe / Excluded" },
      { keys: "Ctrl/Cmd + F", desc: "Focus filter" },
      { keys: "F3 / Shift+F3 (Ctrl/Cmd+G)", desc: "Next / previous match" },
      { keys: "Space", desc: "Toggle folder expand/collapse" },
      { keys: "Alt + Arrow Left/Right", desc: "Collapse / expand all folders" },
      { keys: "Alt + N", desc: "Toggle note panel" }
    ];
  }

  private showUndoToast(message: string, onUndo: () => void): void {
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }
    this.ensureToast();
    this.toastUndoHandler = onUndo;
    if (this.toastMessage) this.toastMessage.textContent = message;
    if (this.toastActions) this.toastActions.style.display = "flex";
    this.toast?.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => this.hideToast(), 6000);
  }

  private showStatusToast(message: string): void {
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }
    this.ensureToast();
    this.toastUndoHandler = undefined;
    if (this.toastMessage) this.toastMessage.textContent = message;
    if (this.toastActions) this.toastActions.style.display = "none";
    this.toast?.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => this.hideToast(), 4000);
    this.recordDiagnostic(message);
  }

  private ensureToast(): void {
    if (this.toast) return;
    const toast = document.createElement("div");
    toast.className = "coder-toast";
    const msg = document.createElement("span");
    msg.className = "coder-toast-message";
    const actions = document.createElement("div");
    actions.className = "coder-toast-actions";
  const undo = document.createElement("button");
  undo.type = "button";
  undo.className = "coder-btn";
  undo.textContent = "Undo";
  undo.ariaLabel = "Undo last action";
  undo.title = "Undo last action";
  undo.dataset.voiceAliases = "undo,undo action";
  undo.addEventListener("click", () => {
    if (this.toastUndoHandler) {
      this.toastUndoHandler();
    }
      this.hideToast();
    });
    actions.append(undo);
    toast.append(msg, actions);
    this.element.append(toast);
    this.toast = toast;
    this.toastMessage = msg;
    this.toastActions = actions;
  }

  private hideToast(): void {
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }
    this.toast?.classList.remove("is-visible");
  }

  private undoDelete(): void {
    const snapshot = this.lastDelete;
    if (!snapshot) return;
    const restored: string[] = [];
    const ordered = [...snapshot].sort((a, b) => a.index - b.index);
    ordered.forEach((entry) => {
      this.store.restoreNode(entry.node, entry.parentId, entry.index);
      restored.push(entry.node.id);
    });
    this.lastDelete = undefined;
    if (restored.length) {
      this.selection = new Set(restored);
      this.primarySelection = restored[restored.length - 1];
      this.anchorSelection = restored[0];
    }
    this.render(this.store.snapshot());
  }

  private cleanupDragGhost(): void {
    if (!this.dragGhost) return;
    this.dragGhost.remove();
    this.dragGhost = undefined;
  }

  private readConfirmDelete(): boolean {
    try {
      const raw = localStorage.getItem("coder.confirmDelete");
      return raw !== "false";
    } catch {
      return true;
    }
  }

  private writeConfirmDelete(value: boolean): void {
    this.confirmDelete = value;
    try {
      localStorage.setItem("coder.confirmDelete", value ? "true" : "false");
    } catch {
      // ignore storage errors
    }
  }

  private readBoolSetting(key: string, fallback: boolean): boolean {
    try {
      const raw = localStorage.getItem(key);
      if (raw === "true") return true;
      if (raw === "false") return false;
      return fallback;
    } catch {
      return fallback;
    }
  }

  private writeBoolSetting(key: string, value: boolean): void {
    try {
      localStorage.setItem(key, value ? "true" : "false");
    } catch {
      // ignore storage errors
    }
  }

  private readStatusFilter(): Set<CoderStatus> {
    try {
      const raw = localStorage.getItem("coder.statusFilter");
      if (!raw) return new Set(CODER_STATUSES);
      const parsed = raw
        .split(",")
        .map((value) => value.trim())
        .filter((value): value is CoderStatus => CODER_STATUSES.includes(value as CoderStatus));
      return parsed.length ? new Set(parsed) : new Set(CODER_STATUSES);
    } catch {
      return new Set(CODER_STATUSES);
    }
  }

  private writeStatusFilter(filter: Set<CoderStatus>): void {
    try {
      const next = Array.from(filter);
      localStorage.setItem("coder.statusFilter", next.join(","));
    } catch {
      // ignore storage errors
    }
  }

  private hasActiveFilter(needle: string): boolean {
    return Boolean(needle) || this.statusFilter.size !== CODER_STATUSES.length;
  }

  private updateSurfaceClasses(): void {
    this.element.classList.toggle("coder-hide-row-actions", !this.showRowActions);
    this.element.classList.toggle("coder-compact", this.compactMode);
    this.element.dataset.reducedMotion = this.reducedMotion ? "true" : "false";
  }

  private readEffectsMode(): "full" | "performance" {
    const val = document.documentElement.dataset.effects;
    return val === "performance" ? "performance" : "full";
  }

  private async syncEffectsModeFromSettingsBridge(): Promise<void> {
    const bridge = (window as unknown as { settingsBridge?: { getValue?: (key: string) => Promise<unknown> } }).settingsBridge;
    if (!bridge?.getValue) {
      const next = this.readEffectsMode();
      if (next !== this.effectsMode) {
        this.effectsMode = next;
        this.applyEffectsMode();
      }
      return;
    }
    try {
      const value = await bridge.getValue(APPEARANCE_KEYS.effects);
      const next = value === "performance" ? "performance" : "full";
      if (next !== this.effectsMode) {
        this.effectsMode = next;
        this.applyEffectsMode();
      }
    } catch {
      // ignore settings read failures
    }
  }

  private applyEffectsMode(): void {
    const full = this.effectsMode === "full";
    if (full) {
      this.reducedMotion = false;
      this.showDropHints = true;
      this.showRowActions = true;
      this.pinPreviewOnClick = true;
    } else {
      this.reducedMotion = true;
      this.showDropHints = false;
      this.showRowActions = false;
      this.pinPreviewOnClick = false;
      this.hidePreviewTooltip();
      this.clearDropTarget();
    }
    this.updateSurfaceClasses();
    // Re-render so row-level hover handlers align with reducedMotion.
    this.render(this.store.snapshot());
  }

  private toggleSettingsMenu(anchor: HTMLElement): void {
    if (this.settingsMenu) {
      this.settingsMenu.remove();
      this.settingsMenu = undefined;
      return;
    }
    const menu = document.createElement("div");
    menu.className = "coder-settings";
    const addToggle = (
      labelText: string,
      checked: boolean,
      onChange: (value: boolean) => void,
      options: { disabled?: boolean; hint?: string } = {}
    ) => {
      const row = document.createElement("label");
      row.className = "coder-settings-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.disabled = Boolean(options.disabled);
      checkbox.addEventListener("change", () => onChange(checkbox.checked));
      const text = document.createElement("span");
      text.textContent = labelText;
      row.append(checkbox, text);
      if (options.hint) {
        const hint = document.createElement("div");
        hint.className = "status-bar";
        hint.style.marginTop = "4px";
        hint.textContent = options.hint;
        row.appendChild(hint);
      }
      menu.append(row);
    };
    const addAction = (labelText: string, onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "coder-settings-action";
      btn.textContent = labelText;
      btn.ariaLabel = labelText;
      btn.title = labelText;
      btn.dataset.voiceAliases = labelText;
      btn.addEventListener("click", () => {
        onClick();
        this.settingsMenu?.remove();
        this.settingsMenu = undefined;
      });
      menu.append(btn);
    };

    addToggle("Confirm deletes", this.confirmDelete, (value) => this.writeConfirmDelete(value));
    const effectsLocked = this.effectsMode !== "full";
    const effectsHint = effectsLocked ? "Controlled by Appearance → Effects mode (Performance)." : "";
    addToggle("Show drop hints", this.showDropHints, (value) => {
      this.showDropHints = value;
      this.writeBoolSetting("coder.showDropHints", value);
      if (!value) this.hideDropHint();
    }, { disabled: effectsLocked, hint: effectsHint });
    addToggle("Show row actions", this.showRowActions, (value) => {
      this.showRowActions = value;
      this.writeBoolSetting("coder.showRowActions", value);
      this.updateSurfaceClasses();
    }, { disabled: effectsLocked, hint: effectsHint });
    addToggle("Pin previews on click", this.pinPreviewOnClick, (value) => {
      this.pinPreviewOnClick = value;
      this.writeBoolSetting("coder.pinPreviewOnClick", value);
      if (!value) this.clearPinnedPreview();
    }, { disabled: effectsLocked, hint: effectsHint });
    addToggle("Compact mode", this.compactMode, (value) => {
      this.compactMode = value;
      this.writeBoolSetting("coder.compactMode", value);
      this.updateSurfaceClasses();
    });
    addAction("Expand all sections", () => this.toggleAllFolders(true));
    addAction("Collapse all sections", () => this.toggleAllFolders(false));
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${rect.right - 220}px`;
    menu.style.top = `${rect.bottom + 6}px`;
    document.body.append(menu);
    this.settingsMenu = menu;
    const onDocClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target || !menu.contains(target)) {
        menu.remove();
        this.settingsMenu = undefined;
        document.removeEventListener("click", onDocClick);
      }
    };
    setTimeout(() => document.addEventListener("click", onDocClick), 0);
  }

  private buildRootHint(): string {
    const count = this.store.snapshot().nodes.length;
    return `Root · index ${count + 1}`;
  }

  private buildPathHint(nodeId: string): string {
    const path = this.getNodePath(nodeId);
    if (path.length === 0) return "Root";
    const index = this.nodeInsertIndex(nodeId);
    return `${path.join(" / ")} · index ${index + 1}`;
  }

  private buildDropIndexHint(target: CoderNode, mode: "into" | "before" | "after"): string {
    if (mode === "into") {
      const folder = target.type === "folder" ? target : this.findParent(this.store.snapshot().nodes, target.id);
      if (!folder) {
        const count = this.store.snapshot().nodes.length;
        return `Root · index ${count + 1}`;
      }
      const path = this.getNodePath(folder.id);
      const idx = folder.children.length + 1;
      return `${path.join(" / ")} · index ${idx}`;
    }
    const parent = this.findParent(this.store.snapshot().nodes, target.id);
    if (!parent) {
      const idx = this.findSiblingIndex(target.id) ?? 0;
      const finalIndex = mode === "before" ? idx + 1 : idx + 2;
      return `Root · index ${finalIndex}`;
    }
    const path = this.getNodePath(parent.id);
    const idx = this.findSiblingIndex(target.id) ?? 0;
    const finalIndex = mode === "before" ? idx + 1 : idx + 2;
    return `${path.join(" / ")} · index ${finalIndex}`;
  }

  private resolveNodeDropMode(ev: DragEvent, target: CoderNode): "into" | "before" | "after" {
    const row = (ev.currentTarget as HTMLElement | null) ?? (this.treeHost.querySelector(`[data-id="${target.id}"]`) as HTMLElement | null);
    if (!row) return target.type === "folder" ? "into" : "after";
    const rect = row.getBoundingClientRect();
    const y = ev.clientY - rect.top;
    const ratio = rect.height ? y / rect.height : 0.5;
    if (target.type === "folder") {
      // Make dropping into folders easier: middle 60% hits “into”.
      if (ratio >= 0.2 && ratio <= 0.8) return "into";
      return ratio < 0.2 ? "before" : "after";
    }
    return ratio <= 0.5 ? "before" : "after";
  }

  private buildMoveSpecForDrop(target: CoderNode, sourceId: string): { nodeId: string; targetParentId: string | null; targetIndex: number } | null {
    const mode = this.activeDropMode ?? (target.type === "folder" ? "into" : "after");
    if (mode === "into") {
      const parentId = target.type === "folder" ? target.id : this.findParent(this.store.snapshot().nodes, target.id)?.id ?? null;
      const targetIndex =
        target.type === "folder" ? (target.children?.length ?? 0) : (this.findSiblingIndex(target.id) ?? 0) + 1;
      return { nodeId: sourceId, targetParentId: parentId, targetIndex };
    }
    const parent = this.findParent(this.store.snapshot().nodes, target.id);
    const siblings = parent ? parent.children : this.store.snapshot().nodes;
    const targetIdx = siblings.findIndex((n) => n.id === target.id);
    if (targetIdx < 0) return null;
    const index = mode === "before" ? targetIdx : targetIdx + 1;
    return { nodeId: sourceId, targetParentId: parent ? parent.id : null, targetIndex: index };
  }

  private buildParentForPayloadDrop(target: CoderNode): string | null {
    if (target.type === "folder") return target.id;
    const parent = this.findParent(this.store.snapshot().nodes, target.id);
    return parent?.id ?? null;
  }

  private getNodePath(nodeId: string): string[] {
    const path: string[] = [];
    const walk = (nodes: CoderNode[], trail: string[]): boolean => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          path.push(...trail, node.name);
          return true;
        }
        if (node.type === "folder") {
          if (walk(node.children, [...trail, node.name])) return true;
        }
      }
      return false;
    };
    walk(this.store.snapshot().nodes, []);
    return path;
  }

  private nodeInsertIndex(nodeId: string): number {
    const state = this.store.snapshot();
    const node = this.nodeById(nodeId, state);
    if (node?.type === "folder") {
      return node.children.length;
    }
    const idx = this.findSiblingIndex(nodeId);
    return typeof idx === "number" ? idx + 1 : state.nodes.length;
  }

  private persistPayloadFile(node: ItemNode): void {
    if (!window.coderBridge) return;
    (this as any).__payloadPersistTimers = (this as any).__payloadPersistTimers || new Map<string, number>();
    const timers: Map<string, number> = (this as any).__payloadPersistTimers;
    const existing = timers.get(node.id);
    if (existing) {
      window.clearTimeout(existing);
    }
    const data = {
      ...node.payload,
      html: normalizePayloadHtml(node.payload),
      text: node.payload.text || node.payload.title || "",
      status: node.status,
      savedAt: new Date().toISOString()
    };
    const timer = window.setTimeout(() => {
      timers.delete(node.id);
      const bridge = window.coderBridge;
      if (!bridge) return;
      bridge
        .savePayload({
          scopeId: this.scopeId,
          nodeId: node.id,
          data,
          projectPath: this.projectPath ?? undefined,
          statePath: this.loadedStatePath ?? this.store.getStatePathOverride() ?? undefined
        })
        .then((result) => {
          if (result.baseDir) {
            console.info(`[CODER][PAYLOAD] saved ${result.baseDir}/${node.id}`);
          }
        })
        .catch((error) => console.warn("Failed to persist coder payload", error));
    }, 600);
    timers.set(node.id, timer);
  }

  private refreshNotePanel(): void {
    const node = this.selectedNode();
    if (!node || node.type !== "folder" || this.selection.size !== 1) {
      this.noteBox.style.display = "none";
      this.noteInput.value = "";
      this.noteInputDirty = false;
      this.noteInputTargetId = null;
      return;
    }
    this.noteBox.style.display = "";
    // Avoid clobbering the user's typing while focused on this note.
    const focused = document.activeElement === this.noteInput;
    if (focused && this.noteInputDirty && this.noteInputTargetId === node.id) {
      return;
    }
    this.noteInput.value = node.note || "";
    this.noteInputDirty = false;
    this.noteInputTargetId = node.id;
  }

  private hydratePersistentState(): void {
    const load = async (): Promise<void> => {
      const lastPath = this.readLastOpenedStatePath();
      let result = null as Awaited<ReturnType<CoderStore["loadFromDisk"]>> | null;
      if (lastPath) {
        result = await this.store.loadFromDiskAt(lastPath);
      }
      if (!result) {
        result = await this.store.loadFromDisk();
      }
      if (!result) {
        if (this.fallbackTree && this.fallbackTree.length) {
          this.store.replaceTree(this.fallbackTree);
        }
        this.ensureInitialCollapsed();
        return;
      }
      this.loadedStatePath = result.statePath;
      this.loadedBaseDir = result.baseDir;
      this.updateCoderTitle(result.metaTitle, result.statePath);
      this.writeLastOpenedStatePath(result.statePath);
      this.ensureInitialCollapsed();
      if (this.syncPill) {
        this.syncPill.title = `Loaded from ${result.statePath}`;
      }
      console.info(`[CODER][STATE] loaded ${result.statePath}`);
      this.stateLoadedCallback?.({ baseDir: result.baseDir, statePath: result.statePath });
      const snippet = getFirstParagraphSnippet(result.state);
      if (snippet) {
        console.info(`[CODER][STATE] first paragraph: ${snippet}`);
      }
      const treeLines = treeToLines(result.state.nodes);
      if (treeLines.length > 0) {
        console.info(`[CODER][TREE]\n${treeLines.join("\n")}`);
      }
    };
    void load();
  }

  private ensureInitialCollapsed(): void {
    if (this.collapseStateTouched) {
      return;
    }
    const state = this.store.snapshot();
    if (state.collapsedIds && state.collapsedIds.length > 0) {
      return;
    }
    const ids: string[] = [];
    const walk = (nodes: CoderNode[]): void => {
      nodes.forEach((node) => {
        if (node.type === "folder") {
          ids.push(node.id);
          walk(node.children);
        }
      });
    };
    walk(state.nodes);
    if (ids.length) {
      this.store.setCollapsedFolders(ids, true);
    }
  }

  private refreshSavedPill(): void {
    if (!this.savedPill) return;
    const ts = new Date();
    this.savedPill.textContent = `Saved ${ts.toLocaleTimeString()}`;
  }

  private refreshSelectionPill(): void {
    if (!this.selectionPill) return;
    const count = this.selection.size;
    if (count <= 1) {
      this.selectionPill.style.display = "none";
      return;
    }
    this.selectionPill.textContent = `${count} selected`;
    this.selectionPill.style.display = "";
  }

  private buildSectionHtml(root: CoderNode, onlyStatus?: Set<CoderStatus>): string {
    const css = `
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
    `;

    const parts: string[] = [];
    parts.push("<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>");
    parts.push(`<style>${css}</style></head><body>`);
    parts.push(`<p class="meta">Exported on ${new Date().toISOString()}</p>`);

    const emitNote = (note?: string) => {
      const text = (note || "").trim();
      if (!text) return;
      text.split(/\n+/).forEach((para) => {
        parts.push(`<p>${this.escapeHtml(para)}</p>`);
      });
    };

    const headingTag = (depth: number) => {
      const d = Math.max(1, Math.min(6, depth));
      return `h${d}`;
    };

    const emitFolder = (folder: FolderNode, depth: number) => {
      const tag = headingTag(depth);
      parts.push(`<${tag}>${this.escapeHtml(folder.name)}</${tag}>`);
      emitNote(folder.note);
      folder.children.forEach((child) => {
        if (child.type === "folder") {
          emitFolder(child, depth + 1);
        } else {
          if (onlyStatus && !onlyStatus.has(child.status)) return;
          const html = normalizePayloadHtml(child.payload);
          parts.push(html);
        }
      });
    };

    if (root.type === "folder") {
      emitFolder(root, 1);
    } else {
      const parent = this.findParent(this.store.snapshot().nodes, root.id);
      if (parent) {
        emitFolder(parent, 1);
      } else {
        if (!onlyStatus || onlyStatus.has(root.status)) {
          parts.push(normalizePayloadHtml((root as ItemNode).payload));
        }
      }
    }

    parts.push("</body></html>");
    return parts.join("");
  }

  private escapeHtml(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
  }

  private htmlSelection(): string {
    const node = this.selectedNode();
    const state = this.store.snapshot();
    const root = node ?? state.nodes[0];
    if (root?.type === "folder") {
      return getFolderEditedHtml(state, root.id);
    }
    return root ? this.buildSectionHtml(root, undefined) : "";
  }

  private async copyHtml(): Promise<void> {
    const html = this.htmlSelection();
    try {
      await navigator.clipboard.writeText(html);
      this.savedPill.textContent = "Copied";
    } catch {
      // ignore copy failures
    }
  }

  private saveHtml(): void {
    const html = this.htmlSelection();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const node = this.selectedNode();
    const name = node ? node.name : "coder-export";
    a.download = `${name.replace(/\\s+/g, "_").slice(0, 60)}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  private previewHtml(): void {
    const html = this.htmlSelection();
    if (this.previewOverlay) {
      this.previewOverlay.remove();
    }
    const overlay = document.createElement("div");
    overlay.className = "coder-preview-dialog";
    overlay.addEventListener("click", (ev) => {
      if (ev.target === overlay) overlay.remove();
    });
    const card = document.createElement("div");
    card.className = "coder-preview-card";
    const actions = document.createElement("div");
    actions.className = "coder-preview-actions";
  const copy = document.createElement("button");
  copy.className = "coder-btn";
  copy.textContent = "Copy HTML";
  copy.ariaLabel = "Copy HTML";
  copy.title = "Copy HTML";
  copy.dataset.voiceAliases = "copy html,copy";
  copy.addEventListener("click", () => this.copyHtml());
  const close = document.createElement("button");
  close.className = "coder-btn";
  close.textContent = "Close";
  close.ariaLabel = "Close preview";
  close.title = "Close preview";
  close.dataset.voiceAliases = "close preview,close";
  close.addEventListener("click", () => overlay.remove());
    actions.append(copy, close);
    const body = document.createElement("div");
    body.className = "coder-preview-body";
    body.innerHTML = html;
    card.append(actions, body);
    overlay.append(card);
    document.body.appendChild(overlay);
    this.previewOverlay = overlay;
  }
}
