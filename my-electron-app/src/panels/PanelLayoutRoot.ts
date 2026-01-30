import { ToolPanel } from "./ToolPanel";
import { ToolRegistry } from "../registry/toolRegistry";
import type { ToolDefinition } from "../registry/toolRegistry";

export interface ToolState {
  id: string;
  toolType: string;
  title: string;
  metadata?: Record<string, unknown>;
}

export interface LayoutSnapshot {
  tabs: ToolState[];
  activeToolId?: string;
}

export interface PanelLayoutRootOptions {
  panelId?: string;
  onLayoutChange?: (snapshot: LayoutSnapshot) => void;
  onFocusChange?: (toolId?: string, toolType?: string) => void;
}

const TOOL_TYPE_ALIASES: Record<string, string> = {
  "screen-widget": "screen"
};

function normalizeToolType(toolType: string): string {
  return TOOL_TYPE_ALIASES[toolType] ?? toolType;
}

export class PanelLayoutRoot {
  private container: HTMLElement;
  private registry: ToolRegistry;
  private panels = new Map<string, ToolPanel>();
  private states: ToolState[] = [];
  private activeToolId?: string;
  private panelId?: string;
  private onLayoutChange?: (snapshot: LayoutSnapshot) => void;
  private onFocusChange?: (toolId?: string, toolType?: string) => void;

  constructor(container: HTMLElement, registry: ToolRegistry, options: PanelLayoutRootOptions = {}) {
    this.container = container;
    this.registry = registry;
    this.panelId = options.panelId;
    this.onLayoutChange = options.onLayoutChange;
    this.onFocusChange = options.onFocusChange;
    this.render();
  }

  load(snapshot: LayoutSnapshot): void {
    const normalized = snapshot.tabs.map((tab) => this.normalizeState(tab));
    this.states = normalized.filter((state) => Boolean(this.registry.get(state.toolType)));
    const desiredActiveId = snapshot.activeToolId;
    this.activeToolId = desiredActiveId && this.states.some((state) => state.id === desiredActiveId)
      ? desiredActiveId
      : this.states[this.states.length - 1]?.id;
    this.panels.forEach((panel) => panel.destroy());
    this.panels.clear();
    this.render();
    this.emitFocus();
  }

  spawnTool(toolType: string, metadata?: Record<string, unknown>): string {
    const normalizedToolType = normalizeToolType(toolType);
    const definition = this.registry.get(normalizedToolType);
    if (!definition) {
      throw new Error(`Tool type ${normalizedToolType} is not registered.`);
    }
    const existing = this.findExistingState(normalizedToolType, definition.title);
    if (existing) {
      existing.metadata = metadata ?? existing.metadata;
      this.activeToolId = existing.id;
      this.render();
      this.persist();
      this.emitFocus();
      return existing.id;
    }
    const id = `tool_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`;
    const state: ToolState = {
      id,
      toolType: normalizedToolType,
      title: definition.title,
      metadata: metadata || {}
    };
    this.states.push(state);
    this.activeToolId = id;
    this.ensurePanel(state, definition);
    this.render();
    this.persist();
    this.emitFocus();
    return id;
  }

  closeTool(toolId: string): void {
    this.states = this.states.filter((state) => state.id !== toolId);
    if (this.activeToolId === toolId) {
      this.activeToolId = this.states[this.states.length - 1]?.id;
    }
    const panel = this.panels.get(toolId);
    if (panel) {
      panel.destroy();
      this.panels.delete(toolId);
    }
    this.render();
    this.persist();
    this.emitFocus();
  }

  focusTool(toolId: string): void {
    if (!this.states.some((state) => state.id === toolId)) return;
    // Avoid re-rendering the entire panel layout when the active tool receives
    // additional pointer/mouse events (e.g. clicking inside an editor UI).
    // Rebuilding the DOM during a click can cancel events and break embedded apps.
    if (this.activeToolId === toolId) {
      this.panels.get(toolId)?.focus();
      return;
    }
    this.activeToolId = toolId;
    const panel = this.panels.get(toolId);
    panel?.focus();
    this.render();
    this.persist();
    this.emitFocus();
  }

  cycleFocus(): void {
    if (this.states.length === 0) return;
    if (!this.activeToolId) {
      this.focusTool(this.states[0].id);
      return;
    }
    const currentIndex = this.states.findIndex((state) => state.id === this.activeToolId);
    const nextIndex = (currentIndex + 1) % this.states.length;
    this.focusTool(this.states[nextIndex].id);
  }

  serialize(): LayoutSnapshot {
    return { tabs: this.states.map((state) => ({ ...state })), activeToolId: this.activeToolId };
  }

  takeToolState(toolId: string): ToolState | null {
    const index = this.states.findIndex((state) => state.id === toolId);
    if (index === -1) {
      return null;
    }
    const state = { ...this.states[index] };
    const panel = this.panels.get(toolId);
    if (panel) {
      state.metadata = panel.getMetadata() ?? state.metadata;
      panel.destroy();
      this.panels.delete(toolId);
    }
    this.states.splice(index, 1);
    if (this.activeToolId === toolId) {
      this.activeToolId = this.states[this.states.length - 1]?.id;
    }
    this.render();
    this.persist();
    this.emitFocus();
    return state;
  }

  insertToolState(state: ToolState, options?: { focus?: boolean }): void {
    const normalized = this.normalizeState(state);
    const definition = this.registry.get(normalized.toolType);
    if (!definition) {
      throw new Error(`Tool type ${normalized.toolType} is not registered.`);
    }
    const exists = this.states.some((existing) => existing.id === state.id);
    if (exists) {
      return;
    }
    const next: ToolState = { ...normalized };
    this.states.push(next);
    if (options?.focus) {
      this.activeToolId = next.id;
    }
    this.ensurePanel(next, definition);
    this.render();
    this.persist();
    this.emitFocus();
  }

  private persist(): void {
    if (!this.onLayoutChange) return;
    this.onLayoutChange(this.serialize());
  }

  private emitFocus(): void {
    if (!this.onFocusChange) return;
    const tool = this.states.find((state) => state.id === this.activeToolId);
    this.onFocusChange(this.activeToolId, tool?.toolType);
  }

  private findExistingState(toolType: string, title: string): ToolState | undefined {
    return this.states.find((state) => state.toolType === toolType && state.title === title);
  }

  private normalizeState(state: ToolState): ToolState {
    const normalizedToolType = normalizeToolType(state.toolType);
    return normalizedToolType === state.toolType ? { ...state } : { ...state, toolType: normalizedToolType };
  }

  private ensurePanel(state: ToolState, definition?: ToolDefinition): ToolPanel {
    if (this.panels.has(state.id)) {
      return this.panels.get(state.id)!;
    }
    const def = definition || this.registry.get(state.toolType);
    if (!def) {
      throw new Error(`Tool definition missing for ${state.toolType}`);
    }
    const panel = new ToolPanel({
      id: state.id,
      toolType: state.toolType,
      title: state.title,
      metadata: state.metadata,
      definition: def,
      onClose: (id) => this.closeTool(id),
      onFocus: (id) => this.focusTool(id)
    });
    this.panels.set(state.id, panel);
    return panel;
  }

  private render(): void {
    if (!this.container) return;
    this.container.innerHTML = "";
    const tabStrip = document.createElement("div");
    tabStrip.className = "tab-strip";
    const content = document.createElement("div");
    content.className = "tab-content";

    const activeId = this.activeToolId || this.states[0]?.id;
    this.activeToolId = activeId;

    this.states.forEach((state) => {
      const button = document.createElement("div");
      button.className = `tab ${state.id === activeId ? "active" : ""}`;
      button.title = state.title;
      button.dataset.toolType = state.toolType;
      button.dataset.toolId = state.id;
      button.dataset.panelId = this.panelId ?? "";
      button.draggable = true;
      button.addEventListener("dragstart", (event) => {
        if (!event.dataTransfer) return;
        const payload = JSON.stringify({ toolId: state.id, panelId: this.panelId, toolType: state.toolType });
        event.dataTransfer.setData("application/x-annotarium-tool-tab", payload);
        event.dataTransfer.setData("text/plain", payload);
        event.dataTransfer.effectAllowed = "move";
        button.classList.add("is-dragging");
      });
      button.addEventListener("dragend", () => {
        button.classList.remove("is-dragging");
      });
      button.addEventListener("click", () => this.focusTool(state.id));
      const label = document.createElement("span");
      label.className = "tab-label";
      label.textContent = state.title;
      button.appendChild(label);
      const closeBtn = document.createElement("button");
      closeBtn.className = "close";
      closeBtn.textContent = "x";
      closeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.closeTool(state.id);
      });
      button.appendChild(closeBtn);
      tabStrip.appendChild(button);
      const panel = this.ensurePanel(state);
      panel.wrapper.style.display = state.id === activeId ? "block" : "none";
      if (panel.wrapper.parentElement !== content) {
        content.appendChild(panel.wrapper);
      }
    });

    if (this.states.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Use the ribbon or sidebar to open tools.";
      content.appendChild(empty);
    }

    this.container.appendChild(tabStrip);
    this.container.appendChild(content);
  }
}
