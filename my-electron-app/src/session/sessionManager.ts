import type { LayoutSnapshot } from "../panels/PanelLayoutRoot";
import type { PanelGrid } from "../layout/PanelGrid";
import type { TabRibbon, TabId } from "../layout/TabRibbon";
import type { SessionStateProvider } from "../session/sessionStorage";
import { registerSessionStateProvider } from "../session/sessionStorage";
import type { ProjectContext, RecentProjectRecord, SessionData } from "../session/sessionTypes";
import type { PanelGridState } from "../state/panelGrid";
import type { CodeStateSnapshot } from "../state/codeState";
import { StartScreen, type StartScreenHandlers } from "./startScreen";
import type { SessionMenuAction } from "../session/sessionTypes";
import type { PanelId } from "../layout/panelRegistry";
import type { RetrieveDataHubState } from "./sessionTypes";

const SAVE_DEBOUNCE_MS = 550;

interface SessionManagerOptions {
  panelTools: { loadLayouts: (layouts: Record<PanelId, LayoutSnapshot>) => void };
  panelGrid: PanelGrid;
  tabRibbon: TabRibbon;
  overlay: HTMLElement;
}

export class SessionManager {
  private session: SessionData | null = null;
  private projectContext: ProjectContext | null = null;
  private startScreen: StartScreen;
  private saveTimer: number | null = null;

  constructor(private readonly options: SessionManagerOptions) {
    this.startScreen = new StartScreen(this.options.overlay, this.createHandlers());
    window.currentProjectPath = undefined;
    registerSessionStateProvider({
      getLayoutSnapshot: () => this.session?.layout ?? null,
      setLayoutSnapshot: (snapshot) => this.updateLayout(snapshot),
      getPanelLayouts: () => this.session?.panelLayouts ?? null,
      setPanelLayouts: (layouts) => this.updatePanelLayouts(layouts),
      getPanelGridState: () => this.session?.panelGrid ?? null,
      setPanelGridState: (state) => this.updatePanelGrid(state),
      getCodeState: () => this.session?.code ?? null,
      setCodeState: (code) => this.updateCodeState(code)
    });
    this.options.tabRibbon.registerTabChangeListener((tabId) => this.recordActiveTab(tabId));
    document.addEventListener("retrieve:datahub-updated", (event) => {
      const detail = (event as CustomEvent<{ state?: RetrieveDataHubState }>).detail;
      if (!detail?.state || !this.session) {
        return;
      }
      this.session.retrieve = { ...(this.session.retrieve ?? {}), dataHub: detail.state };
      this.schedulePersist();
    });
  }

  async initialize(): Promise<void> {
    this.startScreen.show();
    this.startScreen.setStatus("Restoring projects...");
    await this.ensureDefaultDirectory();
    const bridge = window.projectBridge;
    const init = bridge ? await bridge.initialize() : null;
    if (init) {
      this.startScreen.updateRecentProjects(init.recentProjects);
      if (init.defaultSaveDirectory) {
        this.startScreen.setLocation(init.defaultSaveDirectory, { isDefault: true });
      }
      if (init.project) {
        await this.applyProject(init.project);
        this.startScreen.setStatus("Project restored.");
        return;
      }
    }
    this.startScreen.setStatus("Select or create a project to continue.");
  }

  async flushPending(): Promise<void> {
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.persistSession();
    }
  }

  getLayoutSnapshot(): LayoutSnapshot | null {
    return this.session?.layout ?? null;
  }

  updateLayout(snapshot: LayoutSnapshot): void {
    if (!this.session) return;
    this.session.layout = snapshot;
    if (this.session.panelLayouts) {
      this.session.panelLayouts.panel2 = snapshot;
    }
    this.schedulePersist();
  }

  updatePanelLayouts(layouts: Record<PanelId, LayoutSnapshot>): void {
    if (!this.session) return;
    this.session.panelLayouts = layouts;
    const panel2 = layouts.panel2;
    if (panel2) {
      this.session.layout = panel2;
    }
    this.schedulePersist();
  }

  getPanelGridState(): PanelGridState | null {
    return this.session?.panelGrid ?? null;
  }

  updatePanelGrid(state: PanelGridState): void {
    if (!this.session) return;
    this.session.panelGrid = state;
    this.schedulePersist();
  }

  getCodeState(): CodeStateSnapshot | null {
    return this.session?.code ?? null;
  }

  updateCodeState(state: CodeStateSnapshot): void {
    if (!this.session) return;
    this.session.code = state;
    this.schedulePersist();
  }

  private createHandlers(): StartScreenHandlers {
    return {
      onPickLocation: this.handlePickLocation.bind(this),
      onCreateProject: this.handleCreateProject.bind(this),
      onOpenExisting: this.handleOpenExisting.bind(this),
      onOpenRecent: this.handleOpenRecent.bind(this),
      onExportProject: this.handleExportProject.bind(this),
      onPickArchive: this.handlePickArchive.bind(this),
      onImportArchive: this.handleImportArchive.bind(this)
    };
  }

  async handleMenuAction(action: SessionMenuAction): Promise<void> {
    switch (action.type) {
      case "show-start-screen": {
        this.startScreen.show();
        const message =
          action.focus === "create"
            ? "Choose a location and name to start a project."
            : action.focus === "open"
              ? "Browse to an existing project to continue."
              : "Select or create a project to continue.";
        this.startScreen.setStatus(message);
        if (action.focus === "create") {
          this.startScreen.focusProjectNameInput();
        }
        break;
      }
      case "open-project": {
        this.startScreen.show();
        await this.startScreen.requestOpenExisting();
        break;
      }
      case "open-recent": {
        await this.openProject(action.projectPath);
        break;
      }
    }
  }

  private async handlePickLocation(options?: { defaultPath?: string }): Promise<string | null> {
    return window.projectBridge?.pickDirectory(options) ?? null;
  }

  private async handleCreateProject(payload: { directory: string; name: string; useParent?: boolean }): Promise<void> {
    if (!window.projectBridge) {
      throw new Error("Project bridge unavailable");
    }
    const context = await window.projectBridge.createProject(payload);
    await this.applyProject(context);
    await this.refreshRecentProjects();
  }

  private async handleOpenExisting(): Promise<void> {
    const selected = this.startScreen.getSelectedDirectory();
    const fallback = this.startScreen.getFallbackDirectory();
    const defaultPath = selected ?? fallback ?? undefined;
    const target = await window.projectBridge?.pickDirectory({ defaultPath });
    if (!target) {
      throw new Error("No project selected");
    }
    await this.openProject(target);
  }

  private async handleOpenRecent(projectPath: string): Promise<void> {
    await this.openProject(projectPath);
  }

  private async handleExportProject(): Promise<void> {
    if (!this.projectContext || !window.projectBridge) {
      throw new Error("No active project to export");
    }
    const exported = await window.projectBridge.exportProject({
      projectPath: this.projectContext.metadata.path
    });
    const exportedPath = typeof exported === "object" && exported ? (exported as { path?: string }).path : undefined;
    if (!exportedPath) {
      throw new Error("Export did not return a path");
    }
    this.startScreen.setStatus(`Exported to ${exportedPath}`);
  }

  private async handlePickArchive(): Promise<string | null> {
    return window.projectBridge?.pickArchive ? await window.projectBridge.pickArchive() : null;
  }

  private async handleImportArchive(payload: { archivePath: string }): Promise<void> {
    if (!window.projectBridge) {
      throw new Error("Project bridge unavailable");
    }
    const destination = this.startScreen.getSelectedDirectory() ?? this.startScreen.getFallbackDirectory();
    if (!destination) {
      throw new Error("Choose a destination folder before importing.");
    }
    const context = await window.projectBridge.importProject({
      archivePath: payload.archivePath,
      destination
    });
    if (!context) {
      throw new Error("Import failed");
    }
    await this.applyProject(context);
    await this.refreshRecentProjects();
    this.startScreen.setStatus("Project imported.");
  }

  private async openProject(projectPath: string): Promise<void> {
    if (!window.projectBridge) {
      throw new Error("Project bridge unavailable");
    }
    const context = await window.projectBridge.openProject(projectPath);
    await this.applyProject(context);
    await this.refreshRecentProjects();
  }

  private async applyProject(context: ProjectContext): Promise<void> {
    this.projectContext = context;
    this.session = context.session;
    window.currentProjectPath = context.metadata.path;
    this.options.panelGrid.applyState(this.session.panelGrid);
    this.options.panelTools.loadLayouts(this.ensurePanelLayouts(this.session));
    const targetTab: TabId = this.session.activeRibbonTab ?? "retrieve";
    this.options.tabRibbon.selectTab(targetTab);
    this.startScreen.hide();
    const retrieveState = this.session.retrieve?.dataHub;
    if (retrieveState) {
      (window as unknown as { __retrieveDataHubState?: RetrieveDataHubState }).__retrieveDataHubState = retrieveState;
      document.dispatchEvent(new CustomEvent("retrieve:datahub-restore", { detail: { state: retrieveState } }));
    }
  }

  private ensurePanelLayouts(session: SessionData): Record<PanelId, LayoutSnapshot> {
    const empty: LayoutSnapshot = { tabs: [], activeToolId: undefined };
    const layouts = session.panelLayouts ? { ...session.panelLayouts } : {};
    if (session.layout && !layouts.panel2) {
      layouts.panel2 = session.layout;
    }
    (["panel1", "panel2", "panel3", "panel4"] as PanelId[]).forEach((panelId) => {
      if (!layouts[panelId]) {
        layouts[panelId] = { ...empty };
      }
    });
    (Object.keys(layouts) as PanelId[]).forEach((panelId) => {
      layouts[panelId] = this.sanitizeLayoutSnapshot(layouts[panelId] ?? empty);
    });
    session.panelLayouts = layouts;
    return layouts;
  }

  private sanitizeLayoutSnapshot(snapshot: LayoutSnapshot): LayoutSnapshot {
    const filteredTabs = snapshot.tabs.filter((tab) => tab.toolType !== "settings-panel");
    const activeToolId = filteredTabs.some((tab) => tab.id === snapshot.activeToolId)
      ? snapshot.activeToolId
      : filteredTabs[0]?.id;
    return { tabs: filteredTabs, activeToolId };
  }

  private async refreshRecentProjects(): Promise<void> {
    const bridge = window.projectBridge;
    if (!bridge) return;
    const list = await bridge.listRecentProjects();
    if (list) {
      this.startScreen.updateRecentProjects(list);
    }
  }

  private async ensureDefaultDirectory(): Promise<void> {
    const bridge = window.projectBridge;
    if (!bridge) {
      return;
    }
    try {
      const defaultDir = await bridge.getDefaultDirectory();
      if (defaultDir) {
        this.startScreen.setLocation(defaultDir, { isDefault: true });
      }
    } catch {
      // swallow so initialization can continue without default
    }
  }

  private schedulePersist(): void {
    if (!this.projectContext) {
      return;
    }
    if (this.saveTimer) {
      window.clearTimeout(this.saveTimer);
    }
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null;
      void this.persistSession();
    }, SAVE_DEBOUNCE_MS);
  }

  private recordActiveTab(tabId: TabId): void {
    if (!this.session) {
      return;
    }
    this.session.activeRibbonTab = tabId;
    this.schedulePersist();
  }

  private async persistSession(): Promise<void> {
    if (!this.projectContext || !this.session || !window.projectBridge) {
      return;
    }
    this.session.updatedAt = new Date().toISOString();
    await window.projectBridge.saveSession({
      projectPath: this.projectContext.metadata.path,
      session: this.session
    });
  }
}
