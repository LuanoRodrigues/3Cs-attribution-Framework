import type { PanelGrid } from "../layout/PanelGrid";
import { PANEL_REGISTRY, type PanelId } from "../layout/panelRegistry";
import { PanelLayoutRoot, type LayoutSnapshot } from "./PanelLayoutRoot";
import type { ToolRegistry } from "../registry/toolRegistry";

type PanelHostMap = Partial<Record<PanelId, HTMLElement>>;

export interface PanelToolManagerOptions {
  panelGrid: PanelGrid;
  registry: ToolRegistry;
  panelIds: PanelId[];
  hosts?: PanelHostMap;
  onPanelLayoutChange?: (panelId: PanelId, snapshot: LayoutSnapshot) => void;
  onPanelFocusChange?: (panelId: PanelId, toolId?: string, toolType?: string) => void;
}

const TOOL_TAB_MIME = "application/x-annotarium-tool-tab";

type DragPayload = {
  toolId?: string;
  panelId?: PanelId;
  toolType?: string;
  metadata?: Record<string, unknown>;
};

const parseDragPayload = (dataTransfer: DataTransfer | null): DragPayload | null => {
  if (!dataTransfer) {
    return null;
  }
  const raw = dataTransfer.getData(TOOL_TAB_MIME) || dataTransfer.getData("text/plain");
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as DragPayload;
    if (parsed?.toolId || parsed?.toolType) return parsed;
    return null;
  } catch {
    return null;
  }
};

export class PanelToolManager {
  private roots = new Map<PanelId, PanelLayoutRoot>();
  private hosts = new Map<PanelId, HTMLElement>();
  private toolToPanel = new Map<string, PanelId>();
  private panelIds: PanelId[];

  constructor(private readonly options: PanelToolManagerOptions) {
    this.panelIds = options.panelIds;
    this.panelIds.forEach((panelId) => {
      const host = options.hosts?.[panelId] ?? this.createHost(panelId);
      this.hosts.set(panelId, host);
      const root = new PanelLayoutRoot(host, options.registry, {
        panelId,
        onLayoutChange: (snapshot) => this.handleLayoutChange(panelId, snapshot),
        onFocusChange: (toolId, toolType) => options.onPanelFocusChange?.(panelId, toolId, toolType)
      });
      this.roots.set(panelId, root);
      this.indexLayout(panelId, root.serialize());
    });
    options.panelGrid.registerPanelRenderListener((panelId, content) => {
      if (!this.panelIds.includes(panelId)) return;
      this.attachHost(panelId, content);
      this.attachDropTargets(panelId, content);
    });
    this.panelIds.forEach((panelId) => {
      const content = this.getPanelContent(panelId);
      if (!content) return;
      this.attachHost(panelId, content);
      this.attachDropTargets(panelId, content);
    });
  }

  getRoot(panelId: PanelId): PanelLayoutRoot {
    const root = this.roots.get(panelId);
    if (!root) {
      throw new Error(`Panel tool root missing for ${panelId}`);
    }
    return root;
  }

  loadLayouts(layouts: Partial<Record<PanelId, LayoutSnapshot>>): void {
    this.panelIds.forEach((panelId) => {
      const root = this.roots.get(panelId);
      if (!root) return;
      const snapshot = layouts[panelId];
      if (snapshot) {
        root.load(snapshot);
      }
      this.indexLayout(panelId, root.serialize());
    });
  }

  serializeLayouts(): Record<PanelId, LayoutSnapshot> {
    const result = {} as Record<PanelId, LayoutSnapshot>;
    this.panelIds.forEach((panelId) => {
      const root = this.roots.get(panelId);
      if (root) {
        result[panelId] = root.serialize();
      }
    });
    return result;
  }

  spawnTool(toolType: string, options?: { panelId?: PanelId; metadata?: Record<string, unknown> }): string {
    const panelId = options?.panelId ?? "panel2";
    this.options.panelGrid.ensurePanelVisibleById(panelId);
    const root = this.getRoot(panelId);
    const id = root.spawnTool(toolType, options?.metadata);
    this.toolToPanel.set(id, panelId);
    return id;
  }

  focusTool(toolId: string): void {
    const panelId = this.toolToPanel.get(toolId);
    if (!panelId) return;
    this.roots.get(panelId)?.focusTool(toolId);
  }

  closeTool(toolId: string): void {
    const panelId = this.toolToPanel.get(toolId);
    if (!panelId) return;
    this.roots.get(panelId)?.closeTool(toolId);
    this.toolToPanel.delete(toolId);
  }

  moveTool(toolId: string, targetPanelId: PanelId): void {
    const sourcePanelId = this.toolToPanel.get(toolId);
    if (!sourcePanelId || sourcePanelId === targetPanelId) {
      return;
    }
    const source = this.roots.get(sourcePanelId);
    const target = this.roots.get(targetPanelId);
    if (!source || !target) return;
    const state = source.takeToolState(toolId);
    if (!state) return;
    target.insertToolState(state, { focus: true });
    this.toolToPanel.set(toolId, targetPanelId);
  }

  private createHost(panelId: PanelId): HTMLElement {
    const host = document.createElement("div");
    host.className = "panel-tool-host";
    host.dataset.panelId = panelId;
    host.style.display = "flex";
    host.style.flexDirection = "column";
    host.style.height = "100%";
    host.style.minHeight = "0";
    return host;
  }

  private getPanelContent(panelId: PanelId): HTMLElement | null {
    const def = PANEL_REGISTRY.find((entry) => entry.id === panelId);
    if (!def) return null;
    return this.options.panelGrid.getPanelContent(def.index);
  }

  private attachHost(panelId: PanelId, content: HTMLElement): void {
    const host = this.hosts.get(panelId);
    if (!host) return;
    const placeholder = content.querySelector(".panel-placeholder");
    placeholder?.remove();
    if (!content.contains(host)) {
      content.appendChild(host);
    }
  }

  private attachDropTargets(panelId: PanelId, content: HTMLElement): void {
    const shell = content.closest<HTMLElement>(".panel-shell");
    const targets = [content, shell].filter(Boolean) as HTMLElement[];
    targets.forEach((target) => {
      if (target.dataset.toolDropBound === "true") return;
      target.dataset.toolDropBound = "true";
      target.addEventListener("dragover", (event) => {
        const payload = parseDragPayload(event.dataTransfer);
        if (!payload) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = payload.toolType && !payload.toolId ? "copy" : "move";
      });
      target.addEventListener("drop", (event) => {
        const payload = parseDragPayload(event.dataTransfer);
        if (!payload) return;
        event.preventDefault();
        if (payload.toolId) {
          this.moveTool(payload.toolId, panelId);
          return;
        }
        if (payload.toolType) {
          this.spawnTool(payload.toolType, { panelId, metadata: payload.metadata });
        }
      });
    });
  }

  private handleLayoutChange(panelId: PanelId, snapshot: LayoutSnapshot): void {
    this.indexLayout(panelId, snapshot);
    this.options.onPanelLayoutChange?.(panelId, snapshot);
  }

  private indexLayout(panelId: PanelId, snapshot: LayoutSnapshot): void {
    const activeToolIds = new Set(snapshot.tabs.map((tab) => tab.id));
    Array.from(this.toolToPanel.entries()).forEach(([toolId, mappedPanel]) => {
      if (mappedPanel === panelId && !activeToolIds.has(toolId)) {
        this.toolToPanel.delete(toolId);
      }
    });
    snapshot.tabs.forEach((tab) => {
      this.toolToPanel.set(tab.id, panelId);
    });
  }
}
