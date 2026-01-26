import coderStyles from "./coderStyles.css";

import {
  CoderStore,
  normalizePayloadHtml,
  parseDropPayload,
  getFirstParagraphSnippet,
  treeToLines,
  getFolderEditedHtml
} from "./coderState";
import type { CoderScopeId, CoderState } from "./coderTypes";
import { CoderNode, CoderPayload, CoderStatus, FolderNode, ItemNode } from "./coderTypes";

const NODE_MIME = "application/x-annotarium-coder-node";

export interface CoderPanelOptions {
  title?: string;
  initialTree?: CoderNode[];
  onPayloadSelected?: (payload: CoderPayload) => void;
  scopeId?: CoderScopeId;
  onStateLoaded?: (info: { baseDir: string; statePath: string }) => void;
}

export class CoderPanel {
  readonly element: HTMLElement;

  private store: CoderStore;
  private treeHost: HTMLElement;
  private savedPill!: HTMLElement;
  private syncPill!: HTMLElement;
  private selectionPill!: HTMLElement;
  private filterInput!: HTMLInputElement;
  private filterStatus!: HTMLElement;
  private noteBox: HTMLDivElement;
  private noteInput: HTMLTextAreaElement;
  private selection = new Set<string>();
  private primarySelection: string | null = null;
  private anchorSelection: string | null = null;
  private onPayloadSelected?: (payload: CoderPayload) => void;
  private previewOverlay?: HTMLElement;
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
  private lastDelete?: { node: CoderNode; parentId: string | null; index: number }[];
  private confirmDelete = true;
  private settingsMenu?: HTMLDivElement;
  private showDropHints = true;
  private showRowActions = true;
  private dragGhost?: HTMLElement;

  private fallbackTree?: CoderNode[];

  constructor(options?: CoderPanelOptions) {
    this.onPayloadSelected = options?.onPayloadSelected;
    this.scopeId = options?.scopeId;
    this.stateLoadedCallback = options?.onStateLoaded;
    this.store = new CoderStore(undefined, this.scopeId);
    this.confirmDelete = this.readConfirmDelete();
    this.showDropHints = this.readBoolSetting("coder.showDropHints", true);
    this.showRowActions = this.readBoolSetting("coder.showRowActions", true);
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

    const header = this.buildHeader(options?.title ?? "Coder");
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
        this.store.setNote(node.id, this.noteInput.value);
      }
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

    this.unsubscribeStore = this.store.subscribe((state) => this.render(state));
    void this.hydratePersistentState();
    this.attachExternalStateListener();
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
    this.dropHint?.remove();
    this.toast?.remove();
    this.settingsMenu?.remove();
    this.cleanupDragGhost();
    this.element.remove();
  }

  private buildHeader(title: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "coder-header";
    const heading = document.createElement("div");
    heading.className = "coder-title";
    heading.textContent = title;

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

    heading.append(this.savedPill, this.syncPill, this.selectionPill);
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "coder-gear";
    settings.textContent = "⚙";
    settings.title = "Coder settings";
    settings.addEventListener("click", (ev) => {
      ev.stopPropagation();
      this.toggleSettingsMenu(settings);
    });

    wrap.append(heading, settings);
    return wrap;
  }

  private buildFilterRow(): HTMLElement {
    const row = document.createElement("div");
    row.className = "coder-filter-row";
    this.filterInput = document.createElement("input");
    this.filterInput.className = "coder-filter";
    this.filterInput.type = "search";
    this.filterInput.placeholder = "Filter…";
    this.filterInput.addEventListener("input", () => this.render(this.store.snapshot()));
    this.filterStatus = document.createElement("span");
    this.filterStatus.className = "coder-sync";
    this.filterStatus.textContent = "Type to filter";
    row.append(this.filterInput, this.filterStatus);
    return row;
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

    const expSave = mkBtn("Save HTML", "Export selection to HTML file (Ctrl/Cmd+E)", () => this.saveHtml());
    const expCopy = mkBtn("Copy HTML", "Copy selection HTML", () => this.copyHtml());
    const expPrev = mkBtn("Preview", "Preview exported HTML (Ctrl/Cmd+P)", () => this.previewHtml());

    row.append(newFolder, rename, moveUp, moveDown, del, statusI, statusM, statusX, expSave, expCopy, expPrev);
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
    const filter = (this.filterInput?.value || "").trim().toLowerCase();
    this.treeHost.innerHTML = "";
    const matches = { total: 0, shown: 0 };
    const root = document.createDocumentFragment();
    if (state.nodes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "coder-empty";
      empty.textContent = "No sections yet. Add a folder to begin.";
      root.append(empty);
    } else {
      state.nodes.forEach((node) => root.append(this.renderNode(node, 0, filter, matches)));
    }
    this.treeHost.append(root);
    this.updateFilterStatus(matches, filter);
    this.refreshNotePanel();
    this.refreshSavedPill();
    this.refreshSelectionPill();
  }

  private renderNode(node: CoderNode, depth: number, filter: string, matches: { total: number; shown: number }): HTMLElement {
    const row = document.createElement("div");
    row.className = "coder-node";
    row.dataset.id = node.id;
    row.dataset.type = node.type;
    row.draggable = true;

    const rowInner = document.createElement("div");
    rowInner.className = "coder-row";

    const expander = document.createElement("span");
    expander.className = "coder-expander";
    expander.textContent = node.type === "folder" ? "▿" : "";
    expander.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (node.type === "folder") {
        const childrenEl = row.querySelector(".coder-children") as HTMLElement | null;
        if (childrenEl) {
          const collapsed = childrenEl.getAttribute("data-collapsed") === "true";
          this.toggleFolderExpansion(node, collapsed);
        }
      }
    });

    const label = document.createElement("div");
    label.className = "coder-label";
    const dot = document.createElement("span");
    dot.className = "status-dot";
    if (node.type === "item") {
      dot.style.background =
        node.status === "Included" ? "#22c55e" : node.status === "Maybe" ? "#eab308" : "#ef4444";
    } else {
      dot.style.background = "#94a3b8";
    }
    label.append(dot);

    const title = document.createElement("span");
    title.className = "coder-title-text";
    title.textContent = node.name;
    label.append(title);

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
      const count = document.createElement("span");
      count.className = "coder-sync";
      count.textContent = `${node.children.length} child${node.children.length === 1 ? "" : "ren"}`;
      actions.append(count);
    }
    if (this.anchorSelection === node.id) {
      const anchorBadge = document.createElement("span");
      anchorBadge.className = "coder-anchor-badge";
      anchorBadge.textContent = "anchor";
      actions.append(anchorBadge);
    }
    actions.append(rowActions);

    rowInner.append(expander, label, actions);
    row.append(rowInner);

    const matchHit = this.matchesFilter(node, filter);
    let visible = matchHit;
    if (node.type === "folder") {
      const childrenWrap = document.createElement("div");
      childrenWrap.className = "coder-children";
      let anyChildVisible = false;
      node.children.forEach((child) => {
        const childEl = this.renderNode(child, depth + 1, filter, matches);
        if (!childEl.classList.contains("is-hidden")) anyChildVisible = true;
        childrenWrap.append(childEl);
      });
      if (filter && anyChildVisible) visible = true;
      childrenWrap.setAttribute("data-collapsed", "false");
      childrenWrap.style.display = "";
      row.append(childrenWrap);
    }

    matches.total += matchHit ? 1 : 0;
    if (!visible) {
      row.classList.add("is-hidden");
      row.style.display = "none";
    } else {
      matches.shown += 1;
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
    });

    row.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      this.setSelectionSingle(node.id);
      this.beginRename(undefined, node);
    });

    row.addEventListener("dragstart", (ev) => this.handleDragStart(ev, node.id));
    row.addEventListener("dragover", (ev) => {
      ev.stopPropagation();
      this.handleDragOver(ev, node);
    });
    row.addEventListener("dragleave", () => this.clearDropTarget());
    row.addEventListener("drop", (ev) => {
      ev.stopPropagation();
      this.handleDrop(ev, node);
    });

    if (this.selection.has(node.id)) {
      row.classList.add("selected");
      if (this.primarySelection === node.id) {
        row.classList.add("selected-primary");
      }
      if (this.anchorSelection === node.id) {
        row.classList.add("selected-anchor");
        row.title = "Range anchor";
      }
    }

    return row;
  }

  private matchesFilter(node: CoderNode, needle: string): boolean {
    if (!needle) return true;
    const match = (value: unknown): boolean =>
      typeof value === "string" && value.toLowerCase().includes(needle.toLowerCase());
    if (match(node.name)) return true;
    if (node.type === "item") {
      return match(node.payload.title) || match(node.payload.text) || match(node.payload.direct_quote);
    }
    return false;
  }

  private updateFilterStatus(matches: { total: number; shown: number }, needle: string): void {
    if (!needle) {
      this.filterStatus.textContent = matches.shown ? `${matches.shown} entries` : "No entries";
      return;
    }
    if (matches.shown === 0) {
      this.filterStatus.textContent = "No matches";
      return;
    }
    this.filterStatus.textContent = `${matches.shown} match${matches.shown === 1 ? "" : "es"}`;
  }

  private beginRename(row?: HTMLElement, node?: CoderNode): void {
    const targetNode = node ?? this.selectedNode();
    if (!targetNode) return;
    const host = row ?? this.treeHost.querySelector(`[data-id="${targetNode.id}"]`);
    if (!host) return;
    const titleSpan = host.querySelector(".coder-label span:nth-child(2)") as HTMLElement | null;
    if (!titleSpan) return;
    const input = document.createElement("input");
    input.className = "rename-input";
    input.value = targetNode.name;
    titleSpan.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      this.store.rename(targetNode.id, input.value.trim());
      this.setSelectionSingle(targetNode.id);
      this.render(this.store.snapshot());
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit();
      }
      if (ev.key === "Escape") {
        this.render(this.store.snapshot());
      }
    });
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
    const node = this.nodeById(nodeId);
    if (node) {
      const ghost = document.createElement("div");
      ghost.className = "coder-drag-ghost";
      ghost.textContent = `${node.type === "folder" ? "📁" : "📄"} ${node.name}`;
      document.body.append(ghost);
      this.dragGhost = ghost;
      ev.dataTransfer.setDragImage(ghost, 12, 12);
      window.setTimeout(() => {
        this.cleanupDragGhost();
      }, 0);
    }
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData(NODE_MIME, nodeId);
  }

  private handleDragOver(ev: DragEvent, target: CoderNode): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) {
      const hasNode = ev.dataTransfer.types.includes(NODE_MIME);
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
        const label =
          mode === "into"
            ? `Drop into “${target.name}”`
            : mode === "before"
            ? `Drop before “${target.name}”`
            : `Drop after “${target.name}”`;
        this.showDropHint(ev.clientX, ev.clientY, label, this.buildDropIndexHint(target, mode));
      }
      ev.dataTransfer.dropEffect = hasNode ? "move" : "copy";
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
    this.clearDropTarget();

    const dt = ev.dataTransfer;
    if (!dt) return;
    if (dt.types.includes(NODE_MIME)) {
      const sourceId = dt.getData(NODE_MIME);
      if (sourceId && sourceId !== target.id && !this.isAncestor(sourceId, target.id)) {
        const spec = this.buildMoveSpecForDrop(target, sourceId);
        if (spec) {
          this.store.move(spec);
          this.setSelectionSingle(sourceId);
        }
      }
      return;
    }

    const { payload } = parseDropPayload(dt);
    if (payload) {
      const parentId = this.buildParentForPayloadDrop(target);
      this.addPayloadNode(payload, parentId);
    }
  }

  private handleRootDrop(ev: DragEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    this.clearDropTarget();
    const dt = ev.dataTransfer;
    if (!dt) return;
    const { payload } = parseDropPayload(dt);
    if (payload) {
      this.addPayloadNode(payload, null);
    }
  }

  private addFolderShortcut(parentId?: string | null): void {
    const parent = parentId ?? this.selectedFolderId();
    const folder = this.store.addFolder("New section", parent);
    this.setSelectionSingle(folder.id);
    this.render(this.store.snapshot());
    this.beginRename(undefined, folder);
  }

  private focusFilterInput(): void {
    this.filterInput?.focus();
    this.filterInput?.select();
  }

  private toggleFolderExpansion(node: FolderNode, expand: boolean): void {
    const row = this.treeHost.querySelector(`[data-id="${node.id}"]`) as HTMLElement | null;
    if (!row) return;
    const children = row.querySelector(".coder-children") as HTMLElement | null;
    if (!children) return;
    const expander = row.querySelector(".coder-expander");
    if (expand) {
      children.style.display = "";
      children.removeAttribute("data-collapsed");
      if (expander) expander.textContent = "▿";
    } else {
      children.style.display = "none";
      children.setAttribute("data-collapsed", "true");
      if (expander) expander.textContent = "▸";
    }
  }

  private isFolderCollapsed(nodeId: string): boolean {
    const row = this.treeHost.querySelector(`[data-id="${nodeId}"]`) as HTMLElement | null;
    const children = row?.querySelector(".coder-children") as HTMLElement | null;
    return children?.getAttribute("data-collapsed") === "true";
  }

  private toggleAllFolders(expand: boolean): void {
    const state = this.store.snapshot();
    const walk = (nodes: CoderNode[]) => {
      nodes.forEach((node) => {
        if (node.type === "folder") {
          this.toggleFolderExpansion(node, expand);
          walk(node.children);
        }
      });
    };
    walk(state.nodes);
  }

  private handleGlobalKeyDown(ev: KeyboardEvent): void {
    if (this.isEditingText(ev.target)) return;
    if (this.contextMenu && this.handleContextMenuShortcuts(ev)) {
      return;
    }
    this.hideContextMenu();
    const node = this.selectedNode();
    const meta = ev.metaKey || ev.ctrlKey;
    const shift = ev.shiftKey;
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
      this.toggleFolderExpansion(node, true);
      return;
    }
    if (ev.key === "ArrowLeft" && node?.type === "folder") {
      ev.preventDefault();
      this.toggleFolderExpansion(node, false);
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
    if (ev.key === " " && node?.type === "folder") {
      ev.preventDefault();
      const collapsed = this.isFolderCollapsed(node.id);
      this.toggleFolderExpansion(node, collapsed);
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
    const nodes = Array.from(this.treeHost.querySelectorAll(".coder-node")) as HTMLElement[];
    return nodes
      .filter((node) => !node.classList.contains("is-hidden"))
      .map((node) => node.dataset.id)
      .filter((id): id is string => Boolean(id));
  }

  private getTopLevelSelected(): string[] {
    const ids = Array.from(this.selection);
    return ids.filter((id) => !ids.some((other) => other !== id && this.isAncestor(other, id)));
  }

  private handleGlobalClick(event: MouseEvent): void {
    if (!this.contextMenu) return;
    const target = event.target as HTMLElement | null;
    if (target && this.contextMenu.contains(target)) return;
    this.hideContextMenu();
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
    const node = this.store.addItem(payload, parentId);
    this.setSelectionSingle(node.id);
    this.persistPayloadFile(node);
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
    this.showDropHint(ev.clientX, ev.clientY, "Drop at root", this.buildRootHint());
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

  private showUndoToast(message: string, onUndo: () => void): void {
    if (this.toastTimer) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = undefined;
    }
    if (!this.toast) {
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
      undo.addEventListener("click", () => {
        onUndo();
        this.hideToast();
      });
      actions.append(undo);
      toast.append(msg, actions);
      this.element.append(toast);
      this.toast = toast;
    }
    const msg = this.toast.querySelector(".coder-toast-message") as HTMLElement | null;
    if (msg) msg.textContent = message;
    this.toast.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => this.hideToast(), 6000);
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

  private updateSurfaceClasses(): void {
    this.element.classList.toggle("coder-hide-row-actions", !this.showRowActions);
  }

  private toggleSettingsMenu(anchor: HTMLElement): void {
    if (this.settingsMenu) {
      this.settingsMenu.remove();
      this.settingsMenu = undefined;
      return;
    }
    const menu = document.createElement("div");
    menu.className = "coder-settings";
    const addToggle = (labelText: string, checked: boolean, onChange: (value: boolean) => void) => {
      const row = document.createElement("label");
      row.className = "coder-settings-row";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = checked;
      checkbox.addEventListener("change", () => onChange(checkbox.checked));
      const text = document.createElement("span");
      text.textContent = labelText;
      row.append(checkbox, text);
      menu.append(row);
    };

    addToggle("Confirm deletes", this.confirmDelete, (value) => this.writeConfirmDelete(value));
    addToggle("Show drop hints", this.showDropHints, (value) => {
      this.showDropHints = value;
      this.writeBoolSetting("coder.showDropHints", value);
      if (!value) this.hideDropHint();
    });
    addToggle("Show row actions", this.showRowActions, (value) => {
      this.showRowActions = value;
      this.writeBoolSetting("coder.showRowActions", value);
      this.updateSurfaceClasses();
    });
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
    if (target.type === "folder" && ratio > 0.25 && ratio < 0.75) {
      return "into";
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
    const data = {
      ...node.payload,
      html: normalizePayloadHtml(node.payload),
      text: node.payload.text || node.payload.title || "",
      status: node.status,
      savedAt: new Date().toISOString()
    };
    window.coderBridge
      .savePayload({ scopeId: this.scopeId, nodeId: node.id, data })
      .then((result) => {
        if (result.baseDir) {
          console.info(`[CODER][PAYLOAD] saved ${result.baseDir}/${node.id}`);
        }
      })
      .catch((error) => console.warn("Failed to persist coder payload", error));
  }

  private refreshNotePanel(): void {
    const node = this.selectedNode();
    if (!node || node.type !== "folder" || this.selection.size !== 1) {
      this.noteBox.style.display = "none";
      this.noteInput.value = "";
      return;
    }
    this.noteBox.style.display = "";
    this.noteInput.value = node.note || "";
  }

  private hydratePersistentState(): void {
    void this.store.loadFromDisk().then((result) => {
      if (!result) {
        if (this.fallbackTree && this.fallbackTree.length) {
          this.store.replaceTree(this.fallbackTree);
        }
        return;
      }
      this.loadedStatePath = result.statePath;
      this.loadedBaseDir = result.baseDir;
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
    });
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
    copy.addEventListener("click", () => this.copyHtml());
    const close = document.createElement("button");
    close.className = "coder-btn";
    close.textContent = "Close";
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
