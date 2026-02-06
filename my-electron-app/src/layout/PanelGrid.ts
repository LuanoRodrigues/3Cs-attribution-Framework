import { DEFAULT_PANEL_PARTS, PANEL_REGISTRY, type PanelDefinition, type PanelId } from "./panelRegistry";
import type { PanelGridState } from "../state/panelGrid";
import { loadPanelGridState, savePanelGridState } from "../state/panelGrid";
import type { PanelNode } from "../panels/panelTree";
import { createDefaultPanelTree } from "../panels/panelTree";

type PanelRecord = { shell: HTMLElement; content: HTMLElement; definition: PanelDefinition };
type FloatingDragSession = { panelId: PanelId; offsetX: number; offsetY: number };
type PanelContextActionType =
  | "minimize"
  | "restore"
  | "undock"
  | "dock"
  | "splitRight"
  | "splitDown"
  | "defaultSize"
  | "closePanel"
  | "moveWidget";
type PanelContextItem =
  | { type: "action"; panelId: PanelId; action: PanelContextActionType; label: string; disabled?: boolean }
  | { type: "label"; label: string }
  | { type: "separator" };

export type PanelGridPresetId = string;
export type PanelGridPreset = {
  id: PanelGridPresetId;
  roundLayout: boolean;
  layoutHint:
    | {
        mode: "centeredSingle";
        panelId: PanelId;
        maxWidthPx: number;
      }
    | {
        mode: "centeredGrid";
        maxWidthFrac?: number;
        maxWidthPx?: number;
      }
    | null;
  collapsed: Partial<Record<PanelId, boolean>>;
  ratios: Partial<Record<PanelId, number>>;
  fixedPanelSizes?: Partial<Record<PanelId, number>>;
};

export class PanelGrid {
  private panels = new Map<PanelId, PanelRecord>();
  private root?: HTMLElement;
  private state: PanelGridState;
  private panelRenderListeners: Array<(panelId: PanelId, content: HTMLElement) => void> = [];
  private registry: PanelDefinition[] = [];
  private dragSession:
    | {
        startX: number;
        leftId: PanelId;
        rightFirstId: PanelId;
        rightIds: PanelId[];
        leftStartPx: number;
        rightStartPx: number;
        rightFirstStartPx: number;
        rightStartParts: number[];
        leftMin: number;
        rightFirstMin: number;
        rightMin: number;
        containerWidth: number;
      }
    | null = null;
  private dragMoveRaf = 0;
  private dragMovePending: PointerEvent | null = null;
  private floatingDragSession: FloatingDragSession | null = null;
  private contextMenu?: HTMLElement;
  private panelTree: PanelNode;
  private panelsV2Enabled: boolean;
  private roundLayout = false;
  private activePresetId: PanelGridPresetId | null = null;
  private layoutHint:
    | {
        mode: "centeredSingle";
        panelId: PanelId;
        maxWidthPx: number;
      }
    | {
        mode: "centeredGrid";
        // Prefer maxWidthFrac to keep layouts proportional across window sizes.
        maxWidthFrac?: number;
        maxWidthPx?: number;
      }
    | null = null;
  private fixedPanelSizes: Partial<Record<PanelId, number>> = {
    panel1: 320,
    panel2: 360
  };

  constructor(private container: HTMLElement, options?: { panelsV2Enabled?: boolean }) {
    this.panelsV2Enabled = options?.panelsV2Enabled ?? true;
    this.state = this.loadState();
    this.registry = [...PANEL_REGISTRY];
    this.panelTree = createDefaultPanelTree(PANEL_REGISTRY);
    this.render();
    this.applyFloatingState();
    this.applySizes();
    this.updateGutterVisibility();
    document.addEventListener("click", this.handleDocumentClick);
    document.addEventListener("keydown", this.handleDocumentKeyDown);
    window.addEventListener("resize", () => this.applySizes());
  }

  private loadState(): PanelGridState {
    const saved = loadPanelGridState();
    if (saved) {
      if (!saved.splitTree) {
        saved.splitTree = createDefaultPanelTree(PANEL_REGISTRY);
      }
      return saved;
    }
    const ids = this.registryIds();
    return {
      ratios: { ...DEFAULT_PANEL_PARTS },
      collapsed: Object.fromEntries(ids.map((id) => [id, false])),
      lastRatios: { ...DEFAULT_PANEL_PARTS },
      undocked: Object.fromEntries(ids.map((id) => [id, false])),
      floatingPositions: Object.fromEntries(ids.map((id) => [id, null])),
      splitTree: createDefaultPanelTree(PANEL_REGISTRY)
    };
  }

  private render(): void {
    this.container.innerHTML = "";
    const grid = document.createElement("div");
    grid.className = "panel-grid";
    grid.dataset.panelLayout = "workspace";
    this.registry.forEach((definition, index) => {
      const { shell, content } = this.createPanel(definition);
      grid.appendChild(shell);
      this.panels.set(definition.id, { shell, content, definition });
      this.panelRenderListeners.forEach((listener) => listener(definition.id, content));
      const hasNext = this.registry[index + 1] !== undefined;
      if (hasNext) {
        const gutter = this.createGutter(definition.id, this.registry[index + 1].id);
        grid.appendChild(gutter);
      }
    });
    this.container.appendChild(grid);
    this.root = grid;
    grid.addEventListener("contextmenu", (event) => this.handleContextMenu(event as MouseEvent));
    this.attachPanelInteractions();
  }

  private registryIds(): PanelId[] {
    return this.registry.map((d) => d.id);
  }

  private createPanel(definition: PanelDefinition): { shell: HTMLElement; content: HTMLElement } {
    const shell = document.createElement("div");
    shell.className = `panel-shell panel-shell--${definition.variant}`;
    if (definition.variant === "half" && definition.position) {
      shell.classList.add(`panel-shell--${definition.position}`);
    }
    shell.dataset.panelIndex = String(definition.index);
    shell.dataset.panelId = definition.id;
    shell.dataset.minimized = "false";
    shell.dataset.collapsed = "false";

    const content = document.createElement("div");
    content.className = "panel-content";
    if (definition.anchorId) {
      content.id = definition.anchorId;
    }
    const pane = document.createElement("div");
    pane.className = "panel-pane is-active";
    pane.dataset.paneId = "pane-1";
    if (!definition.anchorId) {
      const placeholder = document.createElement("div");
      placeholder.className = "panel-placeholder";
      placeholder.textContent = definition.title;
      pane.appendChild(placeholder);
    }
    content.appendChild(pane);

    shell.appendChild(content);

    return { shell, content: pane };
  }

  private createTabButton(tabId: string, label: string, paneId: string): HTMLButtonElement {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "panel-tab";
    tab.textContent = "";
    tab.setAttribute("aria-label", label);
    tab.setAttribute("title", label);
    tab.dataset.tabId = tabId;
    tab.dataset.paneId = paneId;
    tab.addEventListener("click", () => this.activatePane(tab));
    return tab;
  }

  private createGutter(leftId: PanelId, rightId: PanelId): HTMLElement {
    const gutter = document.createElement("div");
    gutter.className = "panel-gutter";
    gutter.dataset.leftPanel = leftId;
    gutter.dataset.rightPanel = rightId;
    gutter.setAttribute("aria-hidden", "true");
    gutter.addEventListener("pointerdown", (event) => this.beginDrag(event as PointerEvent, leftId, rightId));
    return gutter;
  }

  private attachPanelInteractions(): void {
    this.panels.forEach((record, panelId) => {
      const { shell } = record;
      shell.addEventListener("contextmenu", (event) => this.handleContextMenu(event as MouseEvent, panelId));
      // Floating panels (pop-outs) need a drag handle. With a chrome-less layout,
      // use the panel shell as the handle unless interacting with a control inside.
      shell.addEventListener("pointerdown", (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        if (target.closest("button, a, input, textarea, select, [role='button'], [contenteditable='true']")) return;
        this.handleChromePointerDown(event as PointerEvent, panelId);
      });
    });
  }

  private beginDrag(event: PointerEvent, leftId: PanelId, rightId: PanelId): void {
    if (!this.root) {
      return;
    }
    const left = this.panels.get(leftId);
    const rightIndex = this.registry.findIndex((d) => d.id === rightId);
    if (!left || rightIndex === -1) {
      return;
    }
    const containerBounds = this.root.getBoundingClientRect();
    const leftBounds = left.shell.getBoundingClientRect();
    const rightDefs = this.registry.slice(rightIndex);
    const rightIds = rightDefs.map((d) => d.id);
    const rightShells = rightIds
      .map((id) => this.panels.get(id))
      .filter((r): r is PanelRecord => Boolean(r))
      .map((r) => r.shell.getBoundingClientRect().width);
    const rightStartPx = rightShells.reduce((sum, w) => sum + w, 0);
    const rightFirstRecord = this.panels.get(rightId);
    const rightFirstStartPx = rightFirstRecord?.shell.getBoundingClientRect().width ?? 0;
    const rightFirstMin = rightDefs[0]?.minWidthPx ?? 0;
    const rightMin = rightDefs.reduce((sum, def) => sum + def.minWidthPx, 0);
    this.dragSession = {
      startX: event.clientX,
      leftId,
      rightFirstId: rightId,
      rightIds,
      leftStartPx: leftBounds.width,
      rightStartPx,
      rightFirstStartPx,
      rightStartParts: rightShells,
      leftMin: left.definition.minWidthPx,
      rightFirstMin,
      rightMin,
      containerWidth: containerBounds.width
    };
    document.body.classList.add("panel-resizing");
    window.addEventListener("pointermove", this.handleDragMove);
    window.addEventListener("pointerup", this.endDrag);
  }

  private handleDragMove = (event: PointerEvent): void => {
    if (!this.dragSession) {
      return;
    }
    if (this.panelsV2Enabled) {
      this.queueDragMove(event);
      return;
    }
    this.applyDragDelta(event.clientX);
  };

  private queueDragMove(event: PointerEvent): void {
    this.dragMovePending = event;
    if (this.dragMoveRaf) {
      return;
    }
    this.dragMoveRaf = window.requestAnimationFrame(() => {
      this.dragMoveRaf = 0;
      const pending = this.dragMovePending;
      this.dragMovePending = null;
      if (pending && this.dragSession) {
        this.applyDragDelta(pending.clientX);
      }
    });
  }

  private applyDragDelta(clientX: number): void {
    if (!this.dragSession) return;
    const drag = this.dragSession;
    const delta = clientX - drag.startX;

    // In round layouts, panels 1/2 are pixel-fixed by default; resizing should adjust those px widths.
    const leftFixed = this.roundLayout && typeof this.fixedPanelSizes[drag.leftId] === "number";
    const rightFixed = this.roundLayout && typeof this.fixedPanelSizes[drag.rightFirstId] === "number";
    if (leftFixed || rightFixed) {
      if (leftFixed && rightFixed) {
        const totalFixed = drag.leftStartPx + drag.rightFirstStartPx;
        const minLeft = drag.leftMin;
        const minRight = drag.rightFirstMin;
        let nextLeft = drag.leftStartPx + delta;
        if (nextLeft < minLeft) nextLeft = minLeft;
        if (nextLeft > totalFixed - minRight) nextLeft = totalFixed - minRight;
        const nextRight = totalFixed - nextLeft;
        this.fixedPanelSizes[drag.leftId] = Math.round(nextLeft);
        this.fixedPanelSizes[drag.rightFirstId] = Math.round(nextRight);
        this.applySizes();
        return;
      }

      if (leftFixed) {
        const totalSegment = drag.leftStartPx + drag.rightStartPx;
        let nextLeft = drag.leftStartPx + delta;
        if (nextLeft < drag.leftMin) nextLeft = drag.leftMin;
        const maxLeft = totalSegment - drag.rightMin;
        if (nextLeft > maxLeft) nextLeft = maxLeft;
        this.fixedPanelSizes[drag.leftId] = Math.round(nextLeft);
        this.applySizes();
        return;
      }

      if (rightFixed) {
        const totalSegment = drag.leftStartPx + drag.rightStartPx;
        let nextRightFirst = drag.rightFirstStartPx - delta;
        if (nextRightFirst < drag.rightFirstMin) nextRightFirst = drag.rightFirstMin;
        const maxRight = totalSegment - drag.leftMin;
        if (nextRightFirst > maxRight) nextRightFirst = maxRight;
        this.fixedPanelSizes[drag.rightFirstId] = Math.round(nextRightFirst);
        this.applySizes();
        return;
      }
    }

    const totalSegment = drag.leftStartPx + drag.rightStartPx;
    let nextLeft = drag.leftStartPx + delta;
    if (nextLeft < drag.leftMin) {
      nextLeft = drag.leftMin;
    }
    const maxLeft = totalSegment - drag.rightMin;
    if (nextLeft > maxLeft) {
      nextLeft = maxLeft;
    }
    const nextRight = totalSegment - nextLeft;
    const leftShare = nextLeft / drag.containerWidth;
    this.state.ratios[drag.leftId] = leftShare;
    const rightStartTotal = drag.rightStartPx || nextRight;
    drag.rightIds.forEach((id, idx) => {
      const part = drag.rightStartParts[idx] ?? rightStartTotal / drag.rightIds.length;
      const share = rightStartTotal > 0 ? part / rightStartTotal : 1 / drag.rightIds.length;
      this.state.ratios[id] = (nextRight * share) / drag.containerWidth;
    });
    this.applySizes();
  }

  private endDrag = (): void => {
    if (!this.dragSession) {
      return;
    }
    this.dragSession = null;
    document.body.classList.remove("panel-resizing");
    if (this.dragMoveRaf) {
      cancelAnimationFrame(this.dragMoveRaf);
      this.dragMoveRaf = 0;
    }
    this.dragMovePending = null;
    window.removeEventListener("pointermove", this.handleDragMove);
    window.removeEventListener("pointerup", this.endDrag);
    this.persistState();
  };

  private setPanelCollapsed(panelId: PanelId, collapsed: boolean, shell?: HTMLElement, button?: HTMLButtonElement): void {
    const record = this.panels.get(panelId);
    const targetShell = shell ?? record?.shell;
    if (!targetShell) {
      return;
    }
    if (collapsed) {
      // Hide means: fully remove from workspace, including any floating state.
      this.state.undocked[panelId] = false;
      this.state.floatingPositions[panelId] = null;
      this.state.lastRatios[panelId] = this.state.ratios[panelId];
      this.state.ratios[panelId] = 0;
      this.state.collapsed[panelId] = true;
      targetShell.dataset.minimized = "true";
      targetShell.dataset.collapsed = "true";
      targetShell.classList.add("panel-shell--collapsed");
    } else {
      const restored = this.state.lastRatios[panelId] || DEFAULT_PANEL_PARTS[panelId];
      this.state.ratios[panelId] = restored;
      this.state.collapsed[panelId] = false;
      targetShell.dataset.minimized = "false";
      targetShell.dataset.collapsed = "false";
      targetShell.classList.remove("panel-shell--collapsed");
    }
    this.applyFloatingState();
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
  }

  private applySizes(): void {
    const dynamicRegistry = this.roundLayout
      ? PANEL_REGISTRY.filter((definition) => !this.fixedPanelSizes[definition.id])
      : PANEL_REGISTRY;
    const visibleRatios = dynamicRegistry.map((definition) => {
      const id = definition.id;
      const ratio = this.state.collapsed[id] ? 0 : this.state.ratios[id];
      return { id, ratio };
    });
    const total = visibleRatios.reduce((sum, item) => sum + item.ratio, 0);
    this.panels.forEach((record) => {
      const id = record.definition.id;
      const collapsed = this.state.collapsed[id];
      const undocked = this.state.undocked[id];
      const shell = record.shell;
      // Reset any layout-hint styling before applying the normal sizing rules.
      shell.style.marginLeft = "";
      shell.style.marginRight = "";
      if (collapsed) {
        shell.style.flex = "0 0 0";
        shell.classList.add("panel-shell--collapsed");
        shell.dataset.minimized = "true";
        shell.dataset.collapsed = "true";
        return;
      }
      if (undocked) {
        shell.style.flex = "0 0 0";
        shell.dataset.minimized = "false";
        shell.dataset.collapsed = "false";
        shell.classList.remove("panel-shell--collapsed");
        return;
      }
      if (this.roundLayout && this.fixedPanelSizes[id]) {
        const width = this.fixedPanelSizes[id];
        if (typeof width === "number") {
          shell.style.flex = `0 0 ${width}px`;
          shell.style.minWidth = `${width}px`;
          shell.style.maxWidth = `${width}px`;
        }
        shell.classList.remove("panel-shell--collapsed");
        shell.dataset.minimized = "false";
        shell.dataset.collapsed = "false";
        return;
      }
      const ratio = this.state.ratios[id];
      const normalized = total > 0 ? ratio / total : 0;
      const basis = normalized > 0 ? `${normalized * 100}%` : "0%";
      shell.style.minWidth = "";
      shell.style.maxWidth = "";
      shell.style.flex = `${ratio} 1 ${basis}`;
      shell.classList.remove("panel-shell--collapsed");
      shell.dataset.minimized = "false";
      shell.dataset.collapsed = "false";
    });
    // Apply optional layout hints after normal sizing so they win.
    if (this.root) {
      this.root.style.maxWidth = "";
      this.root.style.marginLeft = "";
      this.root.style.marginRight = "";
    }

    if (this.layoutHint && this.layoutHint.mode === "centeredSingle") {
      const record = this.panels.get(this.layoutHint.panelId);
      if (record && !this.state.collapsed[this.layoutHint.panelId] && !this.state.undocked[this.layoutHint.panelId]) {
        const shell = record.shell;
        const maxWidth = Math.max(320, Math.floor(this.layoutHint.maxWidthPx));
        shell.style.flex = "0 1 auto";
        shell.style.minWidth = "";
        shell.style.maxWidth = `${maxWidth}px`;
        shell.style.marginLeft = "auto";
        shell.style.marginRight = "auto";
      }
    }

    if (this.layoutHint && this.layoutHint.mode === "centeredGrid" && this.root) {
      const containerWidth = this.container.getBoundingClientRect().width || window.innerWidth || 0;
      const frac =
        typeof this.layoutHint.maxWidthFrac === "number" && Number.isFinite(this.layoutHint.maxWidthFrac)
          ? Math.min(1, Math.max(0.1, this.layoutHint.maxWidthFrac))
          : null;
      const px =
        typeof this.layoutHint.maxWidthPx === "number" && Number.isFinite(this.layoutHint.maxWidthPx)
          ? Math.floor(this.layoutHint.maxWidthPx)
          : null;
      const computed = frac ? Math.floor(containerWidth * frac) : px;
      const maxWidth = Math.max(480, Math.floor(computed ?? containerWidth));
      this.root.style.maxWidth = `${maxWidth}px`;
      this.root.style.marginLeft = "auto";
      this.root.style.marginRight = "auto";
    }
    this.updateGutterVisibility();
  }

  private resetPanelSize(panelId: PanelId): void {
    const defaultRatio = DEFAULT_PANEL_PARTS[panelId];
    if (typeof defaultRatio !== "number") return;
    this.state.ratios[panelId] = defaultRatio;
    this.applySizes();
    this.persistState();
  }

  private activatePane(tabButton: HTMLButtonElement): void {
    const paneId = tabButton.dataset.paneId;
    const shell = tabButton.closest<HTMLElement>(".panel-shell");
    if (!shell || !paneId) return;
    const tabs = shell.querySelectorAll<HTMLButtonElement>(".panel-tab");
    tabs.forEach((tab) => tab.classList.toggle("is-active", tab === tabButton));
    const panes = shell.querySelectorAll<HTMLElement>(".panel-pane");
    panes.forEach((pane) => {
      const match = pane.dataset.paneId === paneId;
      pane.classList.toggle("is-active", match);
      pane.style.display = match ? "flex" : "none";
    });
  }

  private splitPanel(panelId: PanelId, orientation: "row" | "col"): void {
    const record = this.panels.get(panelId);
    if (!record) return;
    const shell = record.shell;
    const contentContainer = shell.querySelector<HTMLElement>(".panel-content");
    const existingPanes = contentContainer?.querySelectorAll<HTMLElement>(".panel-pane");
    if (!contentContainer || !existingPanes?.length) return;
    if (existingPanes.length >= 2) return;

    const firstPane = existingPanes[0];
    const secondPane = document.createElement("div");
    secondPane.className = "panel-pane";
    secondPane.dataset.paneId = "pane-2";
    const placeholder = document.createElement("div");
    placeholder.className = "panel-placeholder";
    placeholder.textContent = `${record.definition.title} (Split)`;
    secondPane.appendChild(placeholder);

    const gutter = document.createElement("div");
    gutter.className = "panel-inner-gutter";
    gutter.dataset.orient = orientation;
    gutter.addEventListener("pointerdown", (event) => this.beginInnerDrag(event, contentContainer, orientation));

    contentContainer.innerHTML = "";
    contentContainer.classList.add("panel-split");
    contentContainer.classList.toggle("panel-split--row", orientation === "row");
    contentContainer.classList.toggle("panel-split--col", orientation === "col");
    contentContainer.dataset.splitRatio = "0.5";
    contentContainer.appendChild(firstPane);
    contentContainer.appendChild(gutter);
    contentContainer.appendChild(secondPane);
    firstPane.classList.add("is-active");
    this.applyInnerSplitRatio(contentContainer, orientation, 0.5);
  }

  private beginInnerDrag(event: PointerEvent, container: HTMLElement, orientation: "row" | "col"): void {
    event.preventDefault();
    const onMove = (ev: PointerEvent): void => {
      this.handleInnerDragMove(ev, container, orientation);
    };
    const onUp = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  private handleInnerDragMove(event: PointerEvent, container: HTMLElement, orientation: "row" | "col"): void {
    const rect = container.getBoundingClientRect();
    const total = orientation === "row" ? rect.width : rect.height;
    if (total <= 0) return;
    const pos = orientation === "row" ? event.clientX - rect.left : event.clientY - rect.top;
    const ratio = Math.min(0.85, Math.max(0.15, pos / total));
    this.applyInnerSplitRatio(container, orientation, ratio);
  }

  private applyInnerSplitRatio(container: HTMLElement, orientation: "row" | "col", ratio: number): void {
    const panes = container.querySelectorAll<HTMLElement>(".panel-pane");
    if (panes.length < 2) return;
    const first = panes[0];
    const second = panes[1];
    const firstSize = `${ratio * 100}%`;
    const secondSize = `${(1 - ratio) * 100}%`;
    if (orientation === "row") {
      first.style.flexBasis = firstSize;
      second.style.flexBasis = secondSize;
    } else {
      first.style.height = firstSize;
      first.style.flexBasis = firstSize;
      second.style.height = secondSize;
      second.style.flexBasis = secondSize;
    }
    container.dataset.splitRatio = ratio.toString();
  }

  private handleContextMenu(event: MouseEvent, targetId?: PanelId): void {
    event.preventDefault();
    this.showContextMenu(event.clientX, event.clientY, targetId);
  }

  private showContextMenu(x: number, y: number, targetId?: PanelId): void {
    const menu = this.ensureContextMenu();
    const items = this.buildContextMenuItems(targetId);
    if (items.length === 0) {
      this.hideContextMenu();
      return;
    }
    menu.innerHTML = "";
    items.forEach((item) => {
      if (item.type === "separator") {
        const separator = document.createElement("div");
        separator.className = "panel-context-menu__divider";
        menu.appendChild(separator);
        return;
      }
      if (item.type === "label") {
        const label = document.createElement("div");
        label.className = "panel-context-menu__label";
        label.textContent = item.label;
        menu.appendChild(label);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "panel-context-menu__action";
      button.textContent = item.label;
      button.dataset.action = item.action;
      button.dataset.panelId = item.panelId;
      if (item.disabled) {
        button.disabled = true;
        button.classList.add("is-disabled");
      }
      menu.appendChild(button);
    });
    menu.classList.add("visible");
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      const left = Math.min(Math.max(12, x), window.innerWidth - rect.width - 12);
      const top = Math.min(Math.max(12, y), window.innerHeight - rect.height - 12);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    });
  }

  private ensureContextMenu(): HTMLElement {
    if (!this.contextMenu) {
      this.contextMenu = document.createElement("div");
      this.contextMenu.className = "panel-context-menu";
      this.contextMenu.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-action]");
        if (!button) {
          return;
        }
        const action = button.dataset.action as PanelContextActionType | undefined;
        const panelId = button.dataset.panelId as PanelId | undefined;
        if (!action) {
          return;
        }
        this.handleContextMenuSelection(action, panelId);
        this.hideContextMenu();
      });
      document.body.appendChild(this.contextMenu);
    }
    return this.contextMenu;
  }

  private buildContextMenuItems(targetId?: PanelId): PanelContextItem[] {
    const items: PanelContextItem[] = [];
    if (targetId) {
      const definition = this.getDefinitionFor(targetId);
      if (definition) {
        const collapsed = this.state.collapsed[targetId];
        const undocked = this.state.undocked[targetId];
        const title = definition.title;
        if (this.panelsV2Enabled && !undocked) {
          items.push({
            type: "action",
            action: "splitRight",
            panelId: targetId,
            label: "New Panel Right"
          });
          items.push({
            type: "action",
            action: "splitDown",
            panelId: targetId,
            label: "New Panel Down"
          });
          items.push({ type: "separator" });
        }
        items.push({
          type: "action",
          action: collapsed ? "restore" : "minimize",
          panelId: targetId,
          label: collapsed ? `Show ${title}` : `Hide ${title}`
        });
        items.push({
          type: "action",
          action: undocked ? "dock" : "undock",
          panelId: targetId,
          label: undocked ? `Dock ${title}` : `Pop out ${title}`
        });
        if (this.panelsV2Enabled && !undocked) {
          items.push({
            type: "action",
            action: "defaultSize",
            panelId: targetId,
            label: "Default Size"
          });
        }
        if (this.panelsV2Enabled) {
          items.push({
            type: "action",
            action: "closePanel",
            panelId: targetId,
            label: `Close ${title}`
          });
        }
        items.push({ type: "separator" });
      }
    }
    if (!targetId) {
      items.push({ type: "label", label: "Panels" });
      this.registry
        .filter((definition) => /^panel[1-4]$/.test(definition.id))
        .sort((a, b) => a.index - b.index)
        .forEach((definition) => {
          const collapsed = Boolean(this.state.collapsed[definition.id]);
          items.push({
            type: "action",
            action: collapsed ? "restore" : "minimize",
            panelId: definition.id,
            label: collapsed ? `Show ${definition.title}` : `Hide ${definition.title}`
          });
        });
    }
    return items;
  }

  private handleContextMenuSelection(action: PanelContextActionType, panelId?: PanelId): void {
    if (!panelId) {
      return;
    }
    switch (action) {
      case "minimize":
        this.setPanelCollapsed(panelId, true);
        break;
      case "restore":
        this.setPanelCollapsed(panelId, false);
        break;
      case "undock":
        this.undockPanel(panelId);
        break;
      case "dock":
        this.dockPanel(panelId);
        break;
      case "splitRight":
        this.createDynamicPanel(panelId);
        break;
      case "splitDown":
        this.createDynamicPanel(panelId);
        break;
      case "defaultSize":
        this.resetPanelSize(panelId);
        break;
      case "closePanel":
        this.setPanelCollapsed(panelId, true);
        break;
      case "moveWidget":
        console.error("[panel-grid] Move widget action is not implemented", { panelId });
        break;
    }
  }

  private hideContextMenu(): void {
    if (!this.contextMenu) {
      return;
    }
    this.contextMenu.classList.remove("visible");
  }

  private handleDocumentClick = (event: MouseEvent): void => {
    if (!this.contextMenu) {
      return;
    }
    if (this.contextMenu.contains(event.target as Node)) {
      return;
    }
    this.hideContextMenu();
  };

  private handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.hideContextMenu();
    }
  };

  private handleChromePointerDown = (event: PointerEvent, panelId: PanelId): void => {
    if (event.button !== 0) {
      return;
    }
    if (!this.state.undocked[panelId]) {
      return;
    }
    const shell = this.panels.get(panelId)?.shell;
    if (!shell) {
      return;
    }
    event.preventDefault();
    const rect = shell.getBoundingClientRect();
    this.floatingDragSession = {
      panelId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    window.addEventListener("pointermove", this.handleFloatingDrag);
    window.addEventListener("pointerup", this.endFloatingDrag);
  };

  private handleFloatingDrag = (event: PointerEvent): void => {
    if (!this.floatingDragSession) {
      return;
    }
    const { panelId, offsetX, offsetY } = this.floatingDragSession;
    const shell = this.panels.get(panelId)?.shell;
    if (!shell) {
      return;
    }
    const nextLeft = Math.max(12, Math.min(window.innerWidth - 320, event.clientX - offsetX));
    const nextTop = Math.max(12, Math.min(window.innerHeight - 260, event.clientY - offsetY));
    shell.style.left = `${nextLeft}px`;
    shell.style.top = `${nextTop}px`;
    this.state.floatingPositions[panelId] = { left: nextLeft, top: nextTop };
  };

  private endFloatingDrag = (): void => {
    if (!this.floatingDragSession) {
      return;
    }
    this.floatingDragSession = null;
    window.removeEventListener("pointermove", this.handleFloatingDrag);
    window.removeEventListener("pointerup", this.endFloatingDrag);
    this.persistState();
  };

  private undockPanel(panelId: PanelId): void {
    if (this.state.undocked[panelId]) {
      return;
    }
    this.state.undocked[panelId] = true;
    this.applyFloatingPosition(panelId);
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
  }

  private dockPanel(panelId: PanelId): void {
    if (!this.state.undocked[panelId]) {
      return;
    }
    this.state.undocked[panelId] = false;
    this.state.floatingPositions[panelId] = null;
    const shell = this.panels.get(panelId)?.shell;
    if (shell) {
      shell.dataset.undocked = "false";
      shell.classList.remove("panel-shell--floating");
      shell.style.position = "";
      shell.style.left = "";
      shell.style.top = "";
      shell.style.zIndex = "";
    }
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
  }

  private applyFloatingState(): void {
    this.panels.forEach((record, panelId) => {
      if (this.state.undocked[panelId]) {
        this.applyFloatingPosition(panelId);
      } else {
        const shell = record.shell;
        shell.classList.remove("panel-shell--floating");
        shell.dataset.undocked = "false";
        shell.style.position = "";
        shell.style.left = "";
        shell.style.top = "";
        shell.style.zIndex = "";
      }
    });
  }

  private applyFloatingPosition(panelId: PanelId): void {
    const record = this.panels.get(panelId);
    if (!record) {
      return;
    }
    const shell = record.shell;
    const saved = this.state.floatingPositions[panelId];
    const left = saved?.left ?? Math.max(12, window.innerWidth / 2 - 220);
    const top = saved?.top ?? Math.max(12, window.innerHeight / 2 - 200);
    shell.style.position = "fixed";
    shell.style.zIndex = "1100";
    shell.style.left = `${left}px`;
    shell.style.top = `${top}px`;
    shell.classList.add("panel-shell--floating");
    shell.dataset.undocked = "true";
    this.state.floatingPositions[panelId] = { left, top };
  }

  private updateGutterVisibility(): void {
    if (!this.root) {
      return;
    }
    this.root.querySelectorAll<HTMLDivElement>(".panel-gutter").forEach((gutter) => {
      const leftId = gutter.dataset.leftPanel as PanelId | undefined;
      const rightId = gutter.dataset.rightPanel as PanelId | undefined;
      const hideLeft = leftId ? this.state.collapsed[leftId] || this.state.undocked[leftId] : true;
      const hideRight = rightId ? this.state.collapsed[rightId] || this.state.undocked[rightId] : true;
      gutter.classList.toggle("panel-gutter--hidden", hideLeft || hideRight);
    });
  }

  private getDefinitionFor(panelId: PanelId): PanelDefinition | undefined {
    return PANEL_REGISTRY.find((definition) => definition.id === panelId);
  }

  private persistState(): void {
    this.state.splitTree = this.panelTree;
    savePanelGridState(this.state);
  }

  registerPanelRenderListener(listener: (panelId: PanelId, content: HTMLElement) => void): void {
    this.panelRenderListeners.push(listener);
  }

  private createDynamicPanel(afterId: PanelId): PanelDefinition | null {
    const index = this.registry.findIndex((d) => d.id === afterId);
    if (index === -1) return null;
    const newId = `panel-${Date.now()}`;
    const nextIndex = this.registry.length + 1;
    const definition: PanelDefinition = {
      id: newId,
      index: nextIndex,
      title: `Panel ${nextIndex}`,
      variant: "main",
      minWidthPx: 200,
      defaultPart: 1
    };
    this.registry.splice(index + 1, 0, definition);
    // seed state
    const targetRatio = this.state.ratios[afterId] ?? 1;
    const newRatio = targetRatio / 2;
    this.state.ratios[afterId] = targetRatio / 2;
    this.state.ratios[newId] = newRatio;
    this.state.collapsed[newId] = false;
    this.state.lastRatios[newId] = newRatio;
    this.state.undocked[newId] = false;
    this.state.floatingPositions[newId] = null;
    this.render();
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
    return definition;
  }

  public applyState(state: PanelGridState): void {
    this.state = state;
    if (state.splitTree) {
      this.panelTree = state.splitTree as PanelNode;
    }
    this.render();
    this.applyFloatingState();
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
  }

  public setRatios(next: Partial<Record<PanelId, number>>): void {
    let changed = false;
    (Object.keys(next) as PanelId[]).forEach((id) => {
      const val = next[id];
      if (typeof val === "number" && val >= 0) {
        this.state.ratios[id] = val;
        changed = true;
      }
    });
    if (changed) {
      this.applySizes();
      this.persistState();
    }
  }

  public setCollapsed(panelId: PanelId, collapsed: boolean): void {
    this.setPanelCollapsed(panelId, collapsed);
  }

  public setLayoutHint(
    hint:
      | {
          mode: "centeredSingle";
          panelId: PanelId;
          maxWidthPx: number;
        }
      | {
          mode: "centeredGrid";
          maxWidthFrac?: number;
          maxWidthPx?: number;
        }
      | null
  ): void {
    this.layoutHint = hint;
    this.applySizes();
  }

  public setRoundLayout(enabled: boolean): void {
    if (this.roundLayout === enabled) return;
    this.roundLayout = enabled;
    this.applySizes();
  }

  public setPanelsV2Enabled(enabled: boolean): void {
    this.panelsV2Enabled = enabled;
  }

  public applyPreset(preset: PanelGridPreset): void {
    // Single source of truth per page/action (deterministic; no cross-page carryover).
    this.activePresetId = preset.id;
    this.resetPanelPlacement();
    this.roundLayout = Boolean(preset.roundLayout);
    this.layoutHint = preset.layoutHint ?? null;

    if (this.roundLayout) {
      // Reset fixed widths to deterministic defaults each time this preset is applied.
      this.fixedPanelSizes = {
        panel1: 320,
        panel2: 360,
        ...(preset.fixedPanelSizes || {})
      };
    } else {
      // Do not inherit any fixed widths from round layouts.
      this.fixedPanelSizes = {};
    }

    // Apply visibility first so collapsed panels truly disappear.
    this.registryIds().forEach((panelId) => {
      const shouldCollapse = Boolean(preset.collapsed?.[panelId]);
      this.state.collapsed[panelId] = shouldCollapse;
      if (shouldCollapse) {
        this.state.lastRatios[panelId] = this.state.lastRatios[panelId] ?? this.state.ratios[panelId] ?? 0;
        this.state.ratios[panelId] = 0;
      }
      const shell = this.panels.get(panelId)?.shell;
      if (shell) {
        shell.dataset.minimized = shouldCollapse ? "true" : "false";
        shell.dataset.collapsed = shouldCollapse ? "true" : "false";
        shell.classList.toggle("panel-shell--collapsed", shouldCollapse);
      }
    });

    this.setRatios(preset.ratios || {});
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
  }

  // Make page navigation deterministic by clearing any "floating/undocked" carryover
  // from other pages before applying a page-specific layout.
  public resetPanelPlacement(): void {
    (Object.keys(this.state.undocked) as PanelId[]).forEach((panelId) => {
      this.state.undocked[panelId] = false;
      this.state.floatingPositions[panelId] = null;
    });
    this.applyFloatingState();
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
  }

  getPanelContent(index: number): HTMLElement | null {
    let match: HTMLElement | null = null;
    this.panels.forEach((value) => {
      if (value.definition.index === index) {
        match = value.content;
      }
    });
    return match;
  }

  ensurePanelVisible(index: number): void {
    let targetId: PanelId | undefined;
    let targetShell: HTMLElement | undefined;
    this.panels.forEach((record) => {
      if (record.definition.index === index) {
        targetId = record.definition.id;
        targetShell = record.shell;
      }
    });
    if (!targetId || !targetShell) {
      return;
    }
    if (this.state.collapsed[targetId]) {
      this.setPanelCollapsed(targetId, false, targetShell);
    }
    this.ensurePanelRatio(targetId);
    this.focusPanel(index);
    this.ensureFloatingOnscreen(targetId);
  }

  ensurePanelVisibleById(panelId: PanelId): void {
    const record = this.panels.get(panelId);
    if (!record) {
      return;
    }
    if (this.state.collapsed[panelId]) {
      this.setPanelCollapsed(panelId, false, record.shell);
    }
    this.ensurePanelRatio(panelId);
    this.focusPanel(record.definition.index);
    this.ensureFloatingOnscreen(panelId);
  }

  private ensurePanelRatio(panelId: PanelId): void {
    const minRatio = DEFAULT_PANEL_PARTS[panelId] ?? 1;
    if ((this.state.ratios[panelId] ?? 0) >= minRatio * 0.6) {
      return;
    }
    this.state.ratios[panelId] = minRatio;
    if ((this.state.lastRatios[panelId] ?? 0) < minRatio) {
      this.state.lastRatios[panelId] = minRatio;
    }
    this.applySizes();
    this.updateGutterVisibility();
    this.persistState();
  }

  focusPanel(index: number): void {
    this.panels.forEach((value) => {
      value.shell.classList.toggle("active-panel", value.definition.index === index);
    });
  }

  scrollPanelIntoView(index: number): void {
    const record = this.getPanelByIndex(index);
    if (!record) {
      return;
    }
    record.shell.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private ensureFloatingOnscreen(panelId: PanelId): void {
    if (!this.state.undocked[panelId]) {
      return;
    }
    const record = this.panels.get(panelId);
    if (!record) {
      return;
    }
    const shell = record.shell;
    const rect = shell.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    const nextLeft = Math.min(Math.max(margin, rect.left), maxLeft);
    const nextTop = Math.min(Math.max(margin, rect.top), maxTop);
    if (nextLeft === rect.left && nextTop === rect.top) {
      return;
    }
    shell.style.left = `${nextLeft}px`;
    shell.style.top = `${nextTop}px`;
    this.state.floatingPositions[panelId] = { left: nextLeft, top: nextTop };
    this.persistState();
  }

  private getPanelByIndex(index: number): PanelRecord | undefined {
    for (const record of this.panels.values()) {
      if (record.definition.index === index) {
        return record;
      }
    }
    return undefined;
  }
}
