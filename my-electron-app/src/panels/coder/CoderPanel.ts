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
  private filterInput!: HTMLInputElement;
  private filterStatus!: HTMLElement;
  private noteBox: HTMLDivElement;
  private noteInput: HTMLTextAreaElement;
  private selection: string | null = null;
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

  private fallbackTree?: CoderNode[];

  constructor(options?: CoderPanelOptions) {
    this.onPayloadSelected = options?.onPayloadSelected;
    this.scopeId = options?.scopeId;
    this.stateLoadedCallback = options?.onStateLoaded;
    this.store = new CoderStore(undefined, this.scopeId);
    if (options?.initialTree && options.initialTree.length) {
      this.fallbackTree = options.initialTree;
    }

    this.element = document.createElement("div");
    this.element.className = "coder-surface";
    this.element.tabIndex = 0;
    this.element.addEventListener("dragover", (ev) => ev.preventDefault());
    this.element.addEventListener("drop", (ev) => this.handleRootDrop(ev));
    this.element.addEventListener("keydown", (ev) => this.handleGlobalKeyDown(ev));
    this.element.addEventListener("contextmenu", (ev) => ev.preventDefault());

    const header = this.buildHeader(options?.title ?? "Coder");
    const filterRow = this.buildFilterRow();
    const actions = this.buildActions();

    this.treeHost = document.createElement("div");
    this.treeHost.className = "coder-tree";

    this.noteBox = document.createElement("div");
    this.noteBox.className = "coder-note-box";
    const noteLabel = document.createElement("div");
    noteLabel.textContent = "Section note";
    noteLabel.style.fontSize = "12px";
    noteLabel.style.color = "#94a3b8";
    this.noteInput = document.createElement("textarea");
    this.noteInput.placeholder = "Write a brief intro for this section…";
    this.noteInput.addEventListener("input", () => {
      if (this.selection) {
        this.store.setNote(this.selection, this.noteInput.value);
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
    this.treeHost?.removeEventListener("contextmenu", this.treeContextHandler);
    if (this.externalStateListener) {
      window.removeEventListener("coder:stateSaved", this.externalStateListener);
    }
    this.unsubscribeStore?.();
    this.contextMenu?.remove();
    this.previewOverlay?.remove();
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

    heading.append(this.savedPill, this.syncPill);
    wrap.append(heading);
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

    const newFolder = mkBtn("+ Folder", "New folder", () => {
      const parent = this.selectedFolderId();
      const f = this.store.addFolder("New section", parent);
      this.selection = f.id;
      this.render(this.store.snapshot());
    });

    const rename = mkBtn("Rename", "Rename selection", () => this.beginRename());

    const moveUp = mkBtn("↑", "Move up", () => this.moveSelected(-1));
    const moveDown = mkBtn("↓", "Move down", () => this.moveSelected(1));

    const del = mkBtn("Delete", "Delete selection", () => this.deleteSelected());

    const statusI = mkBtn("I", "Mark Included (1)", () => this.setStatus("Included"));
    const statusM = mkBtn("?", "Mark Maybe (2)", () => this.setStatus("Maybe"));
    const statusX = mkBtn("×", "Mark Excluded (3)", () => this.setStatus("Excluded"));

    const expSave = mkBtn("Save HTML", "Export selection to HTML file", () => this.saveHtml());
    const expCopy = mkBtn("Copy HTML", "Copy selection HTML", () => this.copyHtml());
    const expPrev = mkBtn("Preview", "Preview exported HTML", () => this.previewHtml());

    row.append(newFolder, rename, moveUp, moveDown, del, statusI, statusM, statusX, expSave, expCopy, expPrev);
    return row;
  }

  private selectedNode(state: CoderState = this.store.snapshot()): CoderNode | null {
    if (!this.selection) return null;
    const find = (nodes: CoderNode[]): CoderNode | null => {
      for (const n of nodes) {
        if (n.id === this.selection) return n;
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
    title.textContent = node.name;
    label.append(title);

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "6px";
    actions.style.alignItems = "center";

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
      this.selection = node.id;
      this.render(this.store.snapshot());
      if (node.type === "item" && this.onPayloadSelected) {
        this.onPayloadSelected(node.payload);
      }
    });

    row.addEventListener("dblclick", (ev) => {
      ev.stopPropagation();
      this.selection = node.id;
      this.beginRename(row, node);
    });

    row.addEventListener("dragstart", (ev) => this.handleDragStart(ev, node.id));
    row.addEventListener("dragover", (ev) => this.handleDragOver(ev, node));
    row.addEventListener("dragleave", () => row.classList.remove("coder-drop-target"));
    row.addEventListener("drop", (ev) => this.handleDrop(ev, node));

    if (this.selection === node.id) {
      row.classList.add("selected");
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
      this.selection = targetNode.id;
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
    this.selection = sel.id;
  }

  private deleteSelected(): void {
    const node = this.selectedNode();
    if (!node) return;
    if (node.type === "folder") {
      if (!window.confirm(`Delete folder "${node.name}" and all nested items?`)) {
        return;
      }
    }
    this.store.delete(node.id);
    this.selection = null;
    this.render(this.store.snapshot());
  }

  private setStatus(status: CoderStatus, nodeId?: string): void {
    const target = nodeId ? this.nodeById(nodeId) : this.selectedNode();
    if (!target || target.type !== "item") return;
    this.store.setStatus(target.id, status);
    this.selection = target.id;
  }

  private handleDragStart(ev: DragEvent, nodeId: string): void {
    if (!ev.dataTransfer) return;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData(NODE_MIME, nodeId);
  }

  private handleDragOver(ev: DragEvent, target: CoderNode): void {
    ev.preventDefault();
    const el = ev.currentTarget as HTMLElement;
    el.classList.add("coder-drop-target");
    if (ev.dataTransfer) {
      const hasNode = ev.dataTransfer.types.includes(NODE_MIME);
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
    const el = ev.currentTarget as HTMLElement;
    el.classList.remove("coder-drop-target");

    const dt = ev.dataTransfer;
    if (!dt) return;
    if (dt.types.includes(NODE_MIME)) {
      const sourceId = dt.getData(NODE_MIME);
      if (sourceId && sourceId !== target.id && !this.isAncestor(sourceId, target.id)) {
        const parent = target.type === "folder" ? target.id : this.findParent(this.store.snapshot().nodes, target.id)?.id ?? null;
        const idx =
          target.type === "folder"
            ? (target.children?.length ?? 0)
            : (this.findSiblingIndex(target.id) ?? 0) + 1;
        this.store.move({ nodeId: sourceId, targetParentId: parent, targetIndex: idx });
        this.selection = sourceId;
      }
      return;
    }

    const { payload } = parseDropPayload(dt);
    if (payload) {
      const parentId = target.type === "folder" ? target.id : this.findParent(this.store.snapshot().nodes, target.id)?.id ?? null;
      this.addPayloadNode(payload, parentId);
    }
  }

  private handleRootDrop(ev: DragEvent): void {
    ev.preventDefault();
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
    this.selection = folder.id;
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

  private handleGlobalKeyDown(ev: KeyboardEvent): void {
    const node = this.selectedNode();
    const meta = ev.metaKey || ev.ctrlKey;
    const shift = ev.shiftKey;
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      this.deleteSelected();
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
    this.selection = node.id;
    this.render(this.store.snapshot());
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
    buildAction("Rename", () => this.beginRename(undefined, node));
    if (node.type === "folder") {
      buildAction("New subfolder", () => this.addFolderShortcut(node.id));
    }
    buildAction("Delete", () => this.deleteSelected());
    buildAction("Mark Included", () => this.setStatus("Included", node.id));
    buildAction("Mark Maybe", () => this.setStatus("Maybe", node.id));
    buildAction("Mark Excluded", () => this.setStatus("Excluded", node.id));
    buildAction("Preview HTML", () => this.previewHtml());
    buildAction("Export HTML", () => this.saveHtml());
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
    this.selection = node.id;
    this.persistPayloadFile(node);
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
    if (!node || node.type !== "folder") {
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
