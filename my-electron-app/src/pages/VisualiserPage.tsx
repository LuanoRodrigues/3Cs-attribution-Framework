import Plotly from "plotly.js-dist-min";
import { APPEARANCE_KEYS } from "../config/settingsKeys";
import { commandInternal } from "../ribbon/commandDispatcher";
import type { DataHubLoadResult, DataHubTable } from "../shared/types/dataHub";
import type { RetrieveDataHubState } from "../session/sessionTypes";

declare global {
  interface Window {
    __CENTRAL_LOG_INSTALLED?: boolean;
  }
}

const SECTIONS_PANEL_HTML = `
  <div class="visualiser-sections-panel">
    <header class="panel-head visualiser-head">
      <div class="title" id="sectionsTitle">Sections</div>
      <div class="status">Ready</div>
    </header>
    <div class="panel-body">
      <div class="section" aria-label="Find sections">
        <header class="section-head">
          <div class="section-title">Find</div>
        </header>
        <div class="section-body">
          <input
            id="sectionSearch"
            type="text"
            placeholder="Search keys, titles, aliases…"
            aria-label="Search sections"
            class="visualiser-input"
          />
        </div>
      </div>
      <div class="section" aria-label="Section keys">
        <header class="section-head section-head--row">
          <div class="section-title">Keys</div>
          <div class="visualiser-sections-actions" role="group" aria-label="Section selection actions">
            <button class="btn visualiser-sections-btn" id="btnSectionsAll" type="button">All</button>
            <button class="btn visualiser-sections-btn" id="btnSectionsNone" type="button">None</button>
          </div>
          <div class="chip">Include</div>
          <div class="chip" id="checkedCount">0 selected</div>
        </header>
        <div class="section-body" id="includeHost" role="list">
          <div class="muted">
            No sections declared. Provide window.__PPTX_SECTIONS from the host.
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const MAIN_PANEL_HTML = `
  <section class="panel center-panel visualiser-tool visualiser-panel">
    <header class="panel-head visualiser-head">
      <div class="title">Visuals Test</div>
      <div class="button-row visualiser-button-row">
        <button class="btn" id="btnCopy" type="button">Copy</button>
        <button class="btn" id="btnClear" type="button">Clear</button>
        <button class="btn" id="btnDiag" type="button">Diag</button>
      </div>
    </header>
    <div class="tabs visualiser-tabs">
      <div class="tabset visualiser-tabset">
        <button class="tab active" id="tabSlide" type="button">Slide</button>
        <button class="tab" id="tabTable" type="button">Table</button>
      </div>
      <div class="nav visualiser-nav">
        <button class="btn" id="btnPrev" type="button">Prev</button>
        <span class="count visualiser-count" id="slideCount">0 / 0</span>
        <button class="btn" id="btnNext" type="button">Next</button>
      </div>
    </div>
    <div class="surface visualiser-surface">
      <aside class="thumbs-pane premium visualiser-thumbs" id="thumbsPane">
        <div id="thumbsList"></div>
      </aside>
      <section class="stage visualiser-stage">
        <div id="paneSlide" class="active visualiser-pane">
          <div id="plotHost" class="visualiser-plot-host">
            <div id="plot" class="visualiser-plot"></div>
          </div>
        </div>
        <div id="paneTable" class="visualiser-pane">
          <div id="tableHost" class="visualiser-table-host">
            Table placeholder.
          </div>
        </div>
      </section>
    </div>
  </section>
`;

const EXPORT_PANEL_HTML = `
  <div class="visualiser-export-panel">
    <header class="panel-head visualiser-head">
      <div class="title">Export Status</div>
      <div class="status" id="statusDetail">Ready</div>
    </header>
    <div class="panel-body">
      <section class="export-summary" aria-label="Export counts">
        <div class="export-summary-row">
          <div class="export-summary-k">Included sections</div>
          <div class="export-summary-v" id="summaryCount">0</div>
        </div>
        <div class="export-summary-row">
          <div class="export-summary-k">Figures</div>
          <div class="export-summary-v" id="summarySlides">0</div>
        </div>
        <div class="export-summary-row export-summary-row--last">
          <div class="export-summary-k">Active section</div>
          <div class="export-summary-v" id="summaryActive">None</div>
        </div>
      </section>
      <div class="section export-section export-section--spaced" aria-label="Export inputs">
        <header class="section-head">
          <div class="section-title">Inputs</div>
        </header>
        <div class="section-body" id="optionsHost">
          <div id="optionsFormHost"></div>
          <div class="row visualiser-button-row visualiser-button-row--inputs">
            <button class="btn" id="btnRunInputs" type="button">Run</button>
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-left:auto;">
              <input type="checkbox" id="chkAutoRun" />
              Auto-run
            </label>
            <button class="btn" id="btnResetInputs" type="button">Reset</button>
          </div>
          <div class="log visualiser-log header-log visualiser-log-panel" id="visualiserLog">
            <div class="visualiser-log-placeholder">No visualiser logs yet.</div>
          </div>
        </div>
      </div>
      <div class="section export-section" aria-label="Export actions">
        <header class="section-head">
          <div class="section-title">Actions</div>
        </header>
        <div class="section-body">
          <div class="button-row visualiser-button-row">
            <button class="btn" id="btnBuild" type="button">Build PPT</button>
            <button class="btn" id="btnCopyStatus" type="button">Copy status</button>
            <button class="btn" id="btnClearStatus" type="button">Clear status</button>
            <button class="btn" id="btnRefresh" type="button">Refresh preview</button>
            <button class="btn" id="btnCancelPreview" type="button" disabled>Cancel loading</button>
            <button class="btn" id="btnDescribe" type="button">Describe</button>
          </div>
          <div id="describeBox" style="margin-top:10px;border:1px solid var(--border);border-radius:10px;background:var(--surface-muted);padding:10px;">
            <div id="describeStatus" style="font-size:12px;color:var(--muted);margin-bottom:6px;">No description yet.</div>
            <textarea id="describeText" class="visualiser-input" rows="9" style="width:100%;resize:vertical;"></textarea>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;">
              <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);">
                <input type="checkbox" id="describeUse" />
                Use in PPT notes for this figure
              </label>
              <button class="btn" id="btnDescribeClear" type="button">Clear</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

export class VisualiserPage {
  private static readonly DECK_CACHE_VERSION = "v3";
  private static readonly PARAMS_STORAGE_KEY = "visualiser.params.v1";
  private static readonly AUTORUN_STORAGE_KEY = "visualiser.autorun.v1";
  private mount: HTMLElement;
  private sectionsHost: HTMLElement | null;
  private exportHost: HTMLElement | null;
  private sectionsPlaceholder: string;
  private exportPlaceholder: string;
  private sidePanelsActive = false;
  private ribbonTabObserver: MutationObserver | null = null;
  private plotHost: HTMLElement | null = null;
  private currentTab: "slide" | "table" = "slide";
  private slideIndex = 0;
  private deckAll: Array<Record<string, unknown>> = [];
  private deck: Array<Record<string, unknown>> = [];
  private currentTableSignature: string | null = null;
  private sectionDecks = new Map<string, Array<Record<string, unknown>>>();
  private previewRunToken = 0;
  private previewBackgroundLoading = false;
  private deckVersion = 0;
  private thumbCache = new Map<string, string>();
  private thumbQueue: Array<() => Promise<void>> = [];
  private thumbInFlight = 0;
  private readonly thumbMaxConcurrency = 2;
  private thumbPumpScheduled = false;
  private thumbRequestedKeys = new Set<string>();
  private thumbObserver: IntersectionObserver | null = null;
  private previewHiddenSections = new Set<string>();
  private pendingFocusSectionId: string | null = null;
  private currentTable?: DataHubTable;
  private sections: Array<{ id: string; label: string; hint?: string }> = [];
  private schema: Array<{
    type: string;
    key: string;
    label: string;
    default?: string | number;
    min?: number;
    max?: number;
    options?: Array<{ label: string; value: string }>;
  }> = [];
  private selectedSections = new Set<string>();
  private selectedSlideKeys = new Set<string>();
  private loadingDeck = false;
  private dataHubListener: ((event: Event) => void) | null = null;
  private dataHubRestoreListener: ((event: Event) => void) | null = null;
  private eventHandlers: Array<{ element: HTMLElement; type: string; listener: EventListener }> = [];
  private globalListeners: Array<{
    target: Document | Window;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  private resizeObserver: ResizeObserver | null = null;
  private plotResizeScheduled = false;
  private lastActiveThumbIdx: number | null = null;
  private slideDescriptions = new Map<string, string>();
  private static activeInstance: VisualiserPage | null = null;
  private autoRunTimer: number | null = null;
  private suppressAutoRun = false;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    // Visualiser side panels (panel1/panel3) are singleton surfaces; avoid multiple instances fighting over them.
    const prev = VisualiserPage.activeInstance;
    if (prev && prev !== this) {
      try {
        prev.destroy();
      } catch {
        // ignore
      }
    }
    VisualiserPage.activeInstance = this;
    this.sectionsHost = VisualiserPage.findPanelContent("panel1");
    this.exportHost = VisualiserPage.findPanelContent("panel3");
    this.sectionsPlaceholder = this.sectionsHost?.innerHTML || "";
    this.exportPlaceholder = this.exportHost?.innerHTML || "";
    this.ensurePlotlyTopojsonConfig();
    this.renderCenterPanel();
    this.installGlobalListeners();
    this.installRibbonTabObserver();
    this.syncSidePanels();
    this.installDataHubListener();
    void this.loadVisualiserSchema();
    this.hydrateTableFromRestore();
  }

  private static findPanelContent(panelId: "panel1" | "panel3"): HTMLElement | null {
    const shell = document.querySelector(`.panel-shell[data-panel-id='${panelId}']`);
    if (!shell) {
      return null;
    }
    // Target the active pane to avoid clobbering panel chrome/tool hosts.
    return shell.querySelector<HTMLElement>(".panel-pane.is-active") ?? shell.querySelector<HTMLElement>(".panel-pane");
  }

  private getActiveRibbonTab(): string {
    const actions = document.getElementById("app-tab-actions");
    return String(actions?.dataset.activeTab ?? "");
  }

  private installRibbonTabObserver(): void {
    const actions = document.getElementById("app-tab-actions");
    if (!actions || this.ribbonTabObserver) {
      return;
    }
    this.ribbonTabObserver = new MutationObserver(() => this.syncSidePanels());
    this.ribbonTabObserver.observe(actions, { attributes: true, attributeFilter: ["data-active-tab"] });
  }

  private syncSidePanels(): void {
    const shouldBeActive = this.getActiveRibbonTab() === "visualiser";
    if (shouldBeActive === this.sidePanelsActive) {
      return;
    }
    this.sidePanelsActive = shouldBeActive;

    if (this.sidePanelsActive) {
      // Refresh references in case panel chrome re-rendered.
      this.sectionsHost = VisualiserPage.findPanelContent("panel1");
      this.exportHost = VisualiserPage.findPanelContent("panel3");
      this.sectionsPlaceholder = this.sectionsHost?.innerHTML || this.sectionsPlaceholder;
      this.exportPlaceholder = this.exportHost?.innerHTML || this.exportPlaceholder;
      this.renderSectionsPanel();
      this.renderExportPanel();
      this.updateCancelButtonState();
      this.resizePlot();
      return;
    }

    // Avoid Plotly resize work when the Visualiser tab is not active.
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.sectionsHost) {
      this.sectionsHost.innerHTML = this.sectionsPlaceholder;
    }
    if (this.exportHost) {
      this.exportHost.innerHTML = this.exportPlaceholder;
    }
  }

  private renderSectionsPanel(): void {
    if (!this.sectionsHost) {
      return;
    }
    this.sectionsHost.innerHTML = SECTIONS_PANEL_HTML;
    this.attachSectionsPanelHooks();
    this.renderSectionsList();
  }

  private attachSectionsPanelHooks(): void {
    const search = this.sectionsHost?.querySelector<HTMLInputElement>("#sectionSearch") ?? null;
    if (search) {
      this.attachListener(search, "input", () => this.applySectionFilter());
    }
    const selectAll = this.sectionsHost?.querySelector<HTMLElement>("#btnSectionsAll") ?? null;
    if (selectAll) {
      this.attachListener(selectAll, "click", () => this.setAllSectionsSelected(true));
    }
    const selectNone = this.sectionsHost?.querySelector<HTMLElement>("#btnSectionsNone") ?? null;
    if (selectNone) {
      this.attachListener(selectNone, "click", () => this.setAllSectionsSelected(false));
    }
    const includeHost = this.sectionsHost?.querySelector<HTMLElement>("#includeHost") ?? null;
    if (!includeHost) {
      return;
    }
    this.attachListener(includeHost, "change", this.handleSectionPanelChange as unknown as EventListener);
    this.attachListener(includeHost, "click", this.handleSectionPanelClick as unknown as EventListener);
  }

  private renderExportPanel(): void {
    if (!this.exportHost) {
      return;
    }
    this.exportHost.innerHTML = EXPORT_PANEL_HTML;
    this.attachExportPanelHooks();
    this.renderOptions();
  }

  private renderCenterPanel(): void {
    this.mount.innerHTML = MAIN_PANEL_HTML;
    this.attachControlHooks();
    this.setTab("slide");
    this.renderThumbs();
    this.clearPlotPlaceholder();
    this.updateSummary();
  }

  private installDataHubListener(): void {
    this.dataHubListener = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: RetrieveDataHubState }>).detail;
      if (detail?.state) {
        this.setCurrentTableFromState(detail.state, "event");
      }
    };
    this.dataHubRestoreListener = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: RetrieveDataHubState }>).detail;
      if (detail?.state) {
        this.setCurrentTableFromState(detail.state, "session");
      }
    };
    document.addEventListener("retrieve:datahub-updated", this.dataHubListener);
    document.addEventListener("retrieve:datahub-restore", this.dataHubRestoreListener);
  }

  private async hydrateTableFromRestore(): Promise<void> {
    if ((this as any).__hydratingVisualiser) {
      return;
    }
    (this as any).__hydratingVisualiser = true;
    try {
      const restore = (window as unknown as { __retrieveDataHubState?: RetrieveDataHubState }).__retrieveDataHubState;
      if (!restore) {
        await this.loadTableFromLastCache();
        return;
      }
      if (restore.table) {
        this.setCurrentTableFromState(restore, "session");
        return;
      }
      await this.loadTableFromRetrieveState(restore);
    } finally {
      (this as any).__hydratingVisualiser = false;
    }
  }

  private async loadTableFromLastCache(): Promise<void> {
    if ((this as any).__loadingLastCache) {
      return;
    }
    (this as any).__loadingLastCache = true;
    this.setStatus("Loading cached data (last)...");
    try {
      // Use commandInternal() to avoid firing "ribbon:action" (which can cause tab/layout churn and loops).
      const response = (await commandInternal("retrieve", "datahub_load_last", {})) as
        | (DataHubLoadResult & Record<string, unknown>)
        | undefined;
      if (!response) {
        this.appendWarnLog("No response when loading last cached data.");
        this.setStatus("No cached data.");
        return;
      }
      if (response.status !== "ok") {
        this.appendWarnLog(`Last cache load failed: ${String((response as any).message ?? response.status)}`);
        this.setStatus("No cached data.");
        return;
      }
      const table = this.extractTableFromResponse(response);
      if (!table) {
        this.appendWarnLog("Last cache response missing table data.");
        this.setStatus("Cached data missing.");
        return;
      }
      const source = (response as any).source as { type?: string; path?: string; collectionName?: string } | undefined;
      const sourceType = source?.type === "zotero" ? "zotero" : "file";
      const isDataFilePath = (p: string): boolean => {
        const lower = String(p || "").toLowerCase();
        return /\.(csv|tsv|xls|xlsx|xlsm)$/.test(lower);
      };
      const nextState: RetrieveDataHubState = {
        sourceType,
        filePath: sourceType === "file" && source?.path && isDataFilePath(source.path) ? source.path : undefined,
        collectionName: sourceType === "zotero" ? source?.collectionName : undefined,
        table,
        loadedAt: new Date().toISOString()
      };
      this.persistRetrieveState(nextState);
      this.appendVisualiserLog("Loaded cached data from Retrieve (last).", "info");
      this.setStatus("Data loaded (cache)");
    } catch (error) {
      this.appendWarnLog(`Last cache load failed: ${error instanceof Error ? error.message : String(error)}`);
      this.setStatus("No cached data.");
    }
  }

  private async loadTableFromRetrieveState(state: RetrieveDataHubState): Promise<void> {
    const sourceType = state.sourceType ?? "file";
    const action = sourceType === "zotero" ? "datahub_load_zotero" : "datahub_load_file";
    const payload: Record<string, unknown> =
      sourceType === "zotero"
        ? { collectionName: String(state.collectionName ?? "") }
        : { filePath: String(state.filePath ?? "") };
    if (sourceType !== "zotero" && !state.filePath) {
      this.appendIssueLog("No file path available for cached retrieve data.");
      return;
    }
    this.setStatus("Loading cached data from Retrieve...");
    try {
      // Use commandInternal() to avoid firing "ribbon:action" (which can cause tab/layout churn and loops).
      const response = (await commandInternal("retrieve", action, payload)) as
        | (DataHubLoadResult & Record<string, unknown>)
        | undefined;
      if (!response) {
        this.appendIssueLog("Retrieve cache load returned no response.");
        this.setStatus("Unable to load cached data.");
        return;
      }
      if (response.status !== "ok") {
        this.appendIssueLog(`Retrieve cache load failed: ${response.message ?? response.status}`);
        this.setStatus("Unable to load cached data.");
        return;
      }
      const table = this.extractTableFromResponse(response);
      if (!table) {
        this.appendIssueLog("Retrieve cache response missing table data.");
        this.setStatus("Cached data missing.");
        return;
      }
      const nextState: RetrieveDataHubState = {
        sourceType,
        filePath: state.filePath,
        collectionName: state.collectionName,
        table,
        loadedAt: new Date().toISOString()
      };
      this.persistRetrieveState(nextState);
    } catch (error) {
      this.appendIssueLog(`Retrieve cache load failed: ${error instanceof Error ? error.message : String(error)}`);
      this.setStatus("Unable to load cached data.");
    }
  }

  private extractTableFromResponse(response: (DataHubLoadResult & Record<string, unknown>) | undefined): DataHubTable | undefined {
    if (!response) {
      return undefined;
    }
    if (response.table) {
      return response.table;
    }
    if (response.payload && typeof response.payload === "object") {
      const payloadTable = (response.payload as Record<string, unknown>).table;
      if (payloadTable && typeof payloadTable === "object") {
        return payloadTable as DataHubTable;
      }
    }
    return undefined;
  }

  private persistRetrieveState(state: RetrieveDataHubState): void {
    const container = window as unknown as { __retrieveDataHubState?: RetrieveDataHubState };
    container.__retrieveDataHubState = state;
    document.dispatchEvent(new CustomEvent("retrieve:datahub-updated", { detail: { state } }));
  }

  private setCurrentTableFromState(state: RetrieveDataHubState, source: "session" | "event"): void {
    const table = state.table;
    if (!table) {
      return;
    }
    this.updateCurrentTableState(table, source);
  }

  private updateCurrentTableState(
    table: DataHubTable,
    source: "session" | "event"
  ): void {
    const signature = this.buildTableSignature(table);
    if (signature && signature === this.currentTableSignature) {
      return;
    }
    this.currentTableSignature = signature;
    this.currentTable = {
      columns: table.columns.slice(),
      rows: table.rows.map((row) => row.slice())
    };
    const logSource: "restore" | "event" = source === "session" ? "restore" : source;
    this.logDfLoaded(logSource, this.currentTable);
    this.setStatus(`Loaded ${this.currentTable.rows.length} rows from Retrieve`);
    if (!this.schema.length) {
      return;
    }
    const params = this.readParams();
    const includeForCache = this.getPreviewIncludeKey();
    const cacheKey = this.buildCacheKey(this.currentTable, includeForCache, params);
    const cached = this.readDeckCache(cacheKey);
    if (cached && cached.length) {
      this.deckAll = this.normalizeDeck(cached, "cache");
      this.deck = this.applyPreviewFilter(this.deckAll);
      this.logDeckHealth(this.deckAll, "cache");
      if (!this.isDeckRenderable(this.deckAll) || !this.deckHasVisuals(this.deckAll) || this.isCachedDeckIncomplete(this.deckAll)) {
        this.appendWarnLog("Cached deck has no figures/tables/images; rerunning preview.");
        this.deleteDeckCache(cacheKey);
        this.deckAll = [];
        this.deck = [];
      } else {
        this.slideIndex = 0;
        this.snapToFirstVisualSlide();
        this.renderSectionsList();
        this.renderThumbs();
        this.renderSlide();
        this.updateSummary();
        this.setStatus("Visualiser ready (cache)");
        return;
      }
    }
    if (!this.deck.length) {
      this.deckAll = [];
      this.deck = [];
      void this.runVisualiser();
    }
  }

  private buildTableSignature(table: DataHubTable | undefined): string {
    if (!table) return "";
    try {
      const head = table.rows.slice(0, 2);
      return JSON.stringify({ columns: table.columns, rows: table.rows.length, head });
    } catch {
      return `${table.columns.length}:${table.rows.length}`;
    }
  }

  private getPreviewIncludeIds(): string[] {
    // Preview should only compute selected sections (plus any explicitly selected slides).
    // This keeps preview fast and makes "Select none" actually mean "preview none".
    return this.getBuildIncludeIds();
  }

  private getPreviewIncludeKey(): string[] {
    const ids = this.getPreviewIncludeIds();
    return ids.length ? ids : ["__visualiser_all_sections__"];
  }

  private isCachedDeckIncomplete(deck: Array<Record<string, unknown>>): boolean {
    const expected = this.getPreviewIncludeIds();
    if (!expected.length) {
      return false;
    }
    const present = new Set(
      deck
        .map((s) => String((s as any)?.section ?? "").trim())
        .filter(Boolean)
    );
    for (const sec of expected) {
      if (!present.has(sec)) {
        return true;
      }
    }
    return false;
  }

  private applyPreviewFilter(deck: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    if (!deck.length) {
      return [];
    }
    const hideSet = this.previewHiddenSections;
    const includeSet = this.selectedSections;
    // When schema is loaded, treat an empty set as "include none" (so All/None controls work).
    const filterByInclude = this.sections.length > 0;
    return deck.filter((s) => {
      const sec = String((s as any)?.section ?? "").trim();
      if (sec && hideSet.has(sec)) {
        return false;
      }
      if (sec && filterByInclude && !includeSet.has(sec)) {
        const key = this.buildSlideKey(s);
        if (!key || !this.selectedSlideKeys.has(key)) {
          return false;
        }
      }
      return true;
    });
  }

  private setAllSectionsSelected(value: boolean): void {
    if (!this.sections.length) {
      return;
    }
    if (value) {
      this.selectedSections = new Set(this.sections.map((s) => s.id));
    } else {
      this.selectedSections.clear();
      this.selectedSlideKeys.clear();
    }
    this.updateDeckFromFilters();
    this.renderSectionsList();
  }

  private isVisualSlide(slide: Record<string, unknown> | undefined): boolean {
    if (!slide) return false;
    const s: any = slide;
    const fig = this.parseFigJsonQuiet(s.fig_json);
    if (fig) {
      const data = Array.isArray((fig as any).data)
        ? (fig as any).data
        : Array.isArray(fig)
          ? fig
          : [];
      if (Array.isArray(data) && data.length > 0) {
        return true;
      }
      // Some slides are "layout-only" visuals (cards, callouts, error messages) using annotations/shapes.
      const layout = (fig as any).layout;
      if (layout && typeof layout === "object") {
        const ann = (layout as any).annotations;
        const shapes = (layout as any).shapes;
        const images = (layout as any).images;
        if (Array.isArray(ann) && ann.length > 0) return true;
        if (Array.isArray(shapes) && shapes.length > 0) return true;
        if (Array.isArray(images) && images.length > 0) return true;
      }
    }
    const img = String(s.img ?? s.thumb_img ?? "").trim();
    return Boolean(img);
  }

  private parseFigJsonQuiet(value: unknown): unknown {
    if (!value) return undefined;
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text) return undefined;
    if (!(text.startsWith("{") || text.startsWith("["))) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private getVisualSlideIndices(deck: Array<Record<string, unknown>>): number[] {
    const out: number[] = [];
    for (let i = 0; i < deck.length; i += 1) {
      if (this.isVisualSlide(deck[i])) {
        out.push(i);
      }
    }
    return out;
  }

  private findFirstSlideIndex(sectionId: string): number {
    for (let i = 0; i < this.deck.length; i += 1) {
      const slide = this.deck[i] as any;
      const sec = String(slide?.section ?? "");
      if (sec === sectionId && this.isVisualSlide(slide)) {
        return i;
      }
    }
    for (let i = 0; i < this.deck.length; i += 1) {
      const sec = String((this.deck[i] as any)?.section ?? "");
      if (sec === sectionId) {
        return i;
      }
    }
    return 0;
  }

  private applyPendingFocus(): void {
    if (!this.pendingFocusSectionId) {
      return;
    }
    const sectionId = this.pendingFocusSectionId;
    this.pendingFocusSectionId = null;
    const idx = this.findFirstSlideIndex(sectionId);
    this.slideIndex = Math.max(0, Math.min(idx, Math.max(0, this.deck.length - 1)));
  }

  private togglePreviewVisibility(sectionId: string): void {
    if (this.previewHiddenSections.has(sectionId)) {
      this.previewHiddenSections.delete(sectionId);
    } else {
      this.previewHiddenSections.add(sectionId);
    }
    this.updateDeckFromFilters();
    this.renderSectionsList();
  }

  private updateDeckFromFilters(focusSectionId?: string): void {
    this.deck = this.applyPreviewFilter(this.deckAll);
    const visual = this.getVisualSlideIndices(this.deck);
    if (focusSectionId) {
      this.slideIndex = Math.max(
        0,
        Math.min(this.findFirstSlideIndex(focusSectionId), Math.max(0, this.deck.length - 1))
      );
    } else {
      this.slideIndex = Math.max(0, Math.min(this.slideIndex, Math.max(0, this.deck.length - 1)));
    }
    if (visual.length) {
      if (!visual.includes(this.slideIndex)) {
        this.slideIndex = visual[0];
      }
    }
    this.renderThumbs();
    this.renderSlide();
    this.updateSummary();
  }

  private snapToFirstVisualSlide(): void {
    const visual = this.getVisualSlideIndices(this.deck);
    if (visual.length) {
      if (!visual.includes(this.slideIndex)) {
        this.slideIndex = visual[0];
      }
      return;
    }
    this.slideIndex = Math.max(0, Math.min(this.slideIndex, Math.max(0, this.deck.length - 1)));
  }

  private async loadVisualiserSchema(): Promise<void> {
    const response = await this.sendVisualiserCommand("get_sections");
    if (!response || response.status !== "ok") {
      this.appendIssueLog("Unable to load Visualiser sections.");
      return;
    }
    const payload = response as unknown as { sections?: any[]; schema?: any[] };
    this.sections = Array.isArray(payload.sections) ? payload.sections : [];
    this.schema = Array.isArray(payload.schema) ? payload.schema : [];
    this.selectedSections = new Set(this.sections.map((s) => s.id));
    this.renderSectionsList();
    this.renderOptions();
    if (this.currentTable) {
      const params = this.readParams();
      const includeForCache = this.getPreviewIncludeKey();
      const cacheKey = this.buildCacheKey(this.currentTable, includeForCache, params);
      const cached = this.readDeckCache(cacheKey);
      if (cached && cached.length) {
        this.deckAll = this.normalizeDeck(cached, "cache");
        this.deck = this.applyPreviewFilter(this.deckAll);
        this.logDeckHealth(this.deckAll, "cache");
        if (!this.isDeckRenderable(this.deckAll) || !this.deckHasVisuals(this.deckAll) || this.isCachedDeckIncomplete(this.deckAll)) {
          this.appendWarnLog("Cached deck has no figures/tables/images; rerunning preview.");
          this.deleteDeckCache(cacheKey);
          this.deckAll = [];
          this.deck = [];
        } else {
          this.slideIndex = 0;
          this.snapToFirstVisualSlide();
          this.renderSectionsList();
          this.renderThumbs();
          this.renderSlide();
        }
      }
      if (!this.deckAll.length) {
        void this.runVisualiser();
      }
    }
    this.updateSummary();
  }

  private renderSectionsList(): void {
    const host = this.sectionsHost?.querySelector<HTMLElement>("#includeHost");
    if (!host) {
      return;
    }
    host.innerHTML = "";
    if (!this.sections.length) {
      host.innerHTML = `<div class="muted" style="font-size:12px;color:var(--muted);">No sections available.</div>`;
      return;
    }

    const slides = Array.isArray(this.deckAll) ? this.deckAll : [];
    const slidesBySection = new Map<string, Array<{ title: string; key: string }>>();
    slides.forEach((slide) => {
      if (!this.isVisualSlide(slide)) return;
      const sec = String((slide as any)?.section ?? "").trim();
      if (!sec) return;
      const title = String((slide as any)?.title ?? "").trim() || "Untitled";
      const key = this.buildSlideKey(slide);
      if (!slidesBySection.has(sec)) {
        slidesBySection.set(sec, []);
      }
      slidesBySection.get(sec)!.push({ title, key });
    });

    const out: string[] = [];
    for (const section of this.sections) {
      const id = String(section.id || "").trim();
      if (!id) continue;
      const label = this.escapeXml(section.label || id);
      const hint = this.escapeXml(section.hint ?? "");
      const checked = this.selectedSections.has(id);
      const visible = !this.previewHiddenSections.has(id);
      const hay = this.escapeXml(`${id} ${section.label ?? ""} ${section.hint ?? ""}`);

      const secSlides = slidesBySection.get(id) ?? [];
      const body =
        secSlides.length > 0
          ? secSlides
              .map((s) => {
                const stitle = this.escapeXml(s.title);
                const skey = this.escapeXml(s.key);
                const slideChecked = checked ? true : this.selectedSlideKeys.has(s.key);
                const disabled = checked ? "disabled" : "";
                return (
                  `<label class="slide-check">` +
                    `<input type="checkbox" data-slide-key="${skey}" ${slideChecked ? "checked" : ""} ${disabled} />` +
                    `<span>${stitle}</span>` +
                  `</label>`
                );
              })
              .join("")
          : `<div class="muted">No slides in this section.</div>`;

      out.push(
        `<div class="keyrow" data-section-row="${this.escapeXml(id)}" data-hay="${hay}">` +
          `<div class="keyrow-head">` +
            `<input class="include" type="checkbox" data-section="${this.escapeXml(id)}" ${checked ? "checked" : ""} />` +
            `<div class="keymeta">` +
              `<div class="keytitle">${label}</div>` +
              (hint ? `<div class="keysub">${hint}</div>` : "") +
            `</div>` +
            `<button class="iconbtn" type="button" data-action="toggle-visibility" data-section-id="${this.escapeXml(id)}" aria-label="Toggle visibility">` +
              this.eyeSvg(visible) +
            `</button>` +
          `</div>` +
          `<div class="keyrow-body" data-section-body="${this.escapeXml(id)}">` +
            body +
          `</div>` +
        `</div>`
      );
    }
    host.innerHTML = out.join("");
    this.applySectionFilter();
    this.updateSummary();
  }

  private eyeSvg(visible: boolean): string {
    return visible
      ? "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M12 5c5.5 0 9.5 4.5 10 6-0.5 1.5-4.5 6-10 6S2.5 12.5 2 11c0.5-1.5 4.5-6 10-6zm0 2.5A3.5 3.5 0 1 0 12 16a3.5 3.5 0 0 0 0-7z'/></svg>"
      : "<svg viewBox='0 0 24 24' aria-hidden='true'><path d='M3 4.5 4.5 3 21 19.5 19.5 21l-3-3c-1.4.6-2.9 1-4.5 1-5.5 0-9.5-4.5-10-6 .3-.9 1.6-2.8 3.7-4.3L3 4.5zm6.2 6.2a3.5 3.5 0 0 0 4.1 4.1l-4.1-4.1zm1.7-3.7a3.5 3.5 0 0 1 4.8 4.8l-4.8-4.8zM12 5c5.5 0 9.5 4.5 10 6-.3.9-1.6 2.8-3.7 4.3l-2-2c1.2-.8 2.2-1.9 2.7-2.3-.5-1.5-4.5-6-10-6-.9 0-1.8.1-2.6.3L5.9 3.9C7.7 3.3 9.8 3 12 3v2z'/></svg>";
  }

  private applySectionFilter(): void {
    const q = String(this.sectionsHost?.querySelector<HTMLInputElement>("#sectionSearch")?.value ?? "")
      .trim()
      .toLowerCase();
    const rows = this.sectionsHost?.querySelectorAll<HTMLElement>("[data-section-row]") ?? [];
    rows.forEach((row) => {
      const hay = String(row.getAttribute("data-hay") || row.textContent || "").toLowerCase();
      row.style.display = !q || hay.includes(q) ? "" : "none";
    });
  }

  private handleSectionPanelChange = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (target.type === "checkbox" && target.matches("input[data-slide-key]")) {
      const key = String(target.getAttribute("data-slide-key") ?? "").trim();
      if (!key) {
        return;
      }
      if (target.checked) this.selectedSlideKeys.add(key);
      else this.selectedSlideKeys.delete(key);
      this.updateDeckFromFilters();
      return;
    }
    if (target.type !== "checkbox" || !target.matches("input.include[data-section]")) {
      return;
    }
    const sectionId = String(target.getAttribute("data-section") ?? "").trim();
    if (!sectionId) {
      return;
    }
    if (target.checked) {
      this.selectedSections.add(sectionId);
      this.updateDeckFromFilters(sectionId);
      // Section checked means export everything in this section.
      const toRemove: string[] = [];
      this.selectedSlideKeys.forEach((k) => {
        if (k.startsWith(`${sectionId}::`)) {
          toRemove.push(k);
        }
      });
      toRemove.forEach((k) => this.selectedSlideKeys.delete(k));
    } else {
      this.selectedSections.delete(sectionId);
      this.updateDeckFromFilters();
    }
    this.renderSectionsList();
  };

  private handleSectionPanelClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    const btn = target.closest<HTMLButtonElement>("button[data-action='toggle-visibility'][data-section-id]");
    if (!btn) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const sectionId = String(btn.getAttribute("data-section-id") ?? "").trim();
    if (!sectionId) {
      return;
    }
    this.togglePreviewVisibility(sectionId);
  };

  private renderOptions(): void {
    const formHost = this.exportHost?.querySelector<HTMLElement>("#optionsFormHost");
    if (!formHost) return;
    formHost.innerHTML = "";
    if (!this.schema.length) {
      return;
    }

    const buildInput = (field: (typeof this.schema)[number]): HTMLElement => {
      if (field.type === "select" && field.options) {
        const sel = document.createElement("select");
        field.options.forEach((opt) => {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          sel.appendChild(option);
        });
        if (field.default !== undefined) sel.value = String(field.default);
        return sel;
      }
      if (field.type === "textarea") {
        const ta = document.createElement("textarea");
        ta.rows = 4;
        const placeholder = String((field as any).placeholder ?? "").trim();
        if (placeholder) {
          ta.placeholder = placeholder;
        }
        if (field.default !== undefined) ta.value = String(field.default);
        if ((field as any).asList) {
          ta.setAttribute("data-param-as-list", "1");
        }
        return ta;
      }
      const inp = document.createElement("input");
      inp.type = field.type === "number" ? "number" : "text";
      if (field.min !== undefined) inp.min = String(field.min);
      if (field.max !== undefined) inp.max = String(field.max);
      if (field.default !== undefined) inp.value = String(field.default);
      return inp;
    };

    const groupForKey = (key: string): string => {
      if (key === "data_source" || key === "words_topics_view") return "Text";
      if (
        key === "word_plot_type" ||
        key === "top_n_words" ||
        key === "max_words" ||
        key === "min_frequency" ||
        key === "min_cooccurrence" ||
        key === "min_keyword_frequency" ||
        key === "max_nodes_for_plot" ||
        key === "num_top_words" ||
        key === "specific_words_to_track" ||
        key === "wordcloud_colormap" ||
        key === "contour_width" ||
        key === "contour_color"
      )
        return "Words";
      if (
        key === "ngram_plot_type" ||
        key === "ngram_n" ||
        key === "top_n_ngrams" ||
        key === "num_top_ngrams_for_evolution" ||
        key === "specific_ngrams_to_track" ||
        key === "min_ngram_cooccurrence" ||
        key === "max_nodes_for_ngram_network" ||
        key === "num_ngrams_for_heatmap_cols" ||
        key === "num_docs_for_heatmap_rows"
      )
        return "N-grams";
      if (key === "top_n_authors" || key === "production_top_n") return "Authors";
      return "Other";
    };

    const groups = new Map<string, Array<(typeof this.schema)[number]>>();
    this.schema.forEach((field) => {
      const group = groupForKey(field.key);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(field);
    });

    const orderedGroups = ["Text", "Words", "N-grams", "Authors", "Other"].filter((g) => groups.has(g));
    orderedGroups.forEach((group) => {
      const details = document.createElement("details");
      details.open = group === "Text" || group === "Words" || group === "N-grams";
      details.style.border = "1px solid var(--border)";
      details.style.borderRadius = "10px";
      details.style.padding = "8px 10px";
      details.style.background = "var(--surface-muted)";
      details.style.marginBottom = "8px";

      const summary = document.createElement("summary");
      summary.textContent = group;
      summary.style.cursor = "pointer";
      summary.style.fontWeight = "700";
      summary.style.fontSize = "12px";
      summary.style.color = "var(--text)";
      summary.style.marginBottom = "6px";
      details.appendChild(summary);

      const grid = document.createElement("div");
      grid.style.display = "grid";
      grid.style.gridTemplateColumns = "repeat(auto-fit, minmax(160px, 1fr))";
      grid.style.gap = "8px";

      groups.get(group)!.forEach((field) => {
        const wrap = document.createElement("label");
        wrap.style.display = "flex";
        wrap.style.flexDirection = "column";
        wrap.style.gap = "4px";
        wrap.setAttribute("data-param-wrap", field.key);
        const title = document.createElement("span");
        title.textContent = field.label;
        title.style.fontSize = "12px";
        title.style.color = "var(--muted)";
        const input = buildInput(field);
        input.setAttribute("data-param-key", field.key);
        (input as HTMLElement).style.padding = "6px 8px";
        (input as HTMLElement).style.borderRadius = "8px";
        (input as HTMLElement).style.border = "1px solid var(--border)";
        (input as HTMLElement).style.background = "var(--panel)";
        (input as HTMLElement).style.color = "var(--text)";
        wrap.append(title, input);
        grid.appendChild(wrap);
      });

      details.appendChild(grid);
      formHost.appendChild(details);
    });

    this.suppressAutoRun = true;
    try {
      this.restoreParamsFromStorage();
      this.syncAutoRunCheckbox();
      this.applyOptionsVisibility();
    } finally {
      this.suppressAutoRun = false;
    }
  }

  private restoreParamsFromStorage(): void {
    try {
      const raw = window.localStorage.getItem(VisualiserPage.PARAMS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") return;
      const host = this.exportHost?.querySelector<HTMLElement>("#optionsHost");
      if (!host) return;
      const allowed = new Set(this.schema.map((s) => s.key));
      const nodes = host.querySelectorAll<HTMLElement>("[data-param-key]");
      nodes.forEach((node) => {
        const key = String(node.getAttribute("data-param-key") || "");
        if (!key || !allowed.has(key) || !(key in parsed)) return;
        const value = (parsed as any)[key];
        if (node instanceof HTMLInputElement) {
          if (node.type === "number") node.value = value === undefined || value === null ? "" : String(value);
          else node.value = value === undefined || value === null ? "" : String(value);
        } else if (node instanceof HTMLSelectElement) {
          node.value = value === undefined || value === null ? "" : String(value);
        } else if (node instanceof HTMLTextAreaElement) {
          if (node.getAttribute("data-param-as-list") === "1" && Array.isArray(value)) {
            node.value = value.join("\n");
          } else {
            node.value = value === undefined || value === null ? "" : String(value);
          }
        }
      });
    } catch {
      // ignore
    }
  }

  private persistParamsToStorage(params: Record<string, unknown>): void {
    try {
      const allowed = new Set(this.schema.map((s) => s.key));
      const next: Record<string, unknown> = {};
      Object.entries(params).forEach(([key, value]) => {
        if (!allowed.has(key)) return;
        if (value === undefined) return;
        next[key] = value;
      });
      window.localStorage.setItem(VisualiserPage.PARAMS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  private syncAutoRunCheckbox(): void {
    const chk = this.exportHost?.querySelector<HTMLInputElement>("#chkAutoRun");
    if (!chk) return;
    try {
      const raw = window.localStorage.getItem(VisualiserPage.AUTORUN_STORAGE_KEY);
      chk.checked = raw === "1";
    } catch {
      chk.checked = false;
    }
  }

  private isAutoRunEnabled(): boolean {
    const chk = this.exportHost?.querySelector<HTMLInputElement>("#chkAutoRun");
    return Boolean(chk?.checked);
  }

  private scheduleAutoRun(): void {
    if (this.autoRunTimer) {
      window.clearTimeout(this.autoRunTimer);
      this.autoRunTimer = null;
    }
    if (!this.isAutoRunEnabled()) return;
    this.autoRunTimer = window.setTimeout(() => {
      this.autoRunTimer = null;
      if (!this.currentTable) {
        return;
      }
      void this.runVisualiser();
    }, 450);
  }

  private applyOptionsVisibility(): void {
    if (!this.exportHost) return;
    const host = this.exportHost.querySelector<HTMLElement>("#optionsHost");
    if (!host) return;

    const getValue = (key: string): string => {
      const node = host.querySelector<HTMLElement>(`[data-param-key='${CSS.escape(key)}']`);
      if (!node) return "";
      if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement || node instanceof HTMLTextAreaElement) {
        return String(node.value ?? "");
      }
      return "";
    };

    const view = getValue("words_topics_view") || "both";
    const wordPlot = getValue("word_plot_type") || "bar_vertical";
    const ngramPlot = getValue("ngram_plot_type") || "bar_chart";

    const showWords = view === "words" || view === "both" || view === "";
    const showNgrams = view === "ngrams" || view === "both";

    const setWrap = (key: string, visible: boolean): void => {
      const wrap = host.querySelector<HTMLElement>(`[data-param-wrap='${CSS.escape(key)}']`);
      if (wrap) wrap.style.display = visible ? "" : "none";
    };

    // Words
    [
      "word_plot_type",
      "top_n_words",
      "max_words",
      "min_frequency",
      "min_cooccurrence",
      "min_keyword_frequency",
      "max_nodes_for_plot",
      "num_top_words",
      "specific_words_to_track",
      "wordcloud_colormap",
      "contour_width",
      "contour_color"
    ].forEach((k) => setWrap(k, showWords));

    const isWordCloud = wordPlot === "word_cloud";
    const isWordBar = wordPlot === "bar_vertical" || wordPlot === "bar_horizontal" || wordPlot === "treemap" || wordPlot === "heatmap";
    const isWordNetwork = wordPlot === "cooccurrence_network";
    const isWordsOverTime = wordPlot === "words_over_time";

    setWrap("top_n_words", showWords && isWordBar);
    setWrap("max_words", showWords && isWordCloud);
    setWrap("wordcloud_colormap", showWords && isWordCloud);
    setWrap("contour_width", showWords && isWordCloud);
    setWrap("contour_color", showWords && isWordCloud);
    setWrap("min_frequency", showWords && (isWordBar || isWordNetwork));
    setWrap("min_cooccurrence", showWords && isWordNetwork);
    setWrap("min_keyword_frequency", showWords && isWordNetwork);
    setWrap("max_nodes_for_plot", showWords && isWordNetwork);
    setWrap("num_top_words", showWords && isWordsOverTime);
    setWrap("specific_words_to_track", showWords && isWordsOverTime);

    // N-grams
    [
      "ngram_plot_type",
      "ngram_n",
      "top_n_ngrams",
      "num_top_ngrams_for_evolution",
      "specific_ngrams_to_track",
      "min_ngram_cooccurrence",
      "max_nodes_for_ngram_network",
      "num_ngrams_for_heatmap_cols",
      "num_docs_for_heatmap_rows"
    ].forEach((k) => setWrap(k, showNgrams));

    const isNgramBar = ngramPlot === "bar_chart";
    const isNgramEvolution = ngramPlot === "ngram_evolution_time_series";
    const isNgramNetwork = ngramPlot === "ngram_cooccurrence_network";
    const isNgramHeatmap = ngramPlot === "ngram_frequency_heatmap";

    setWrap("top_n_ngrams", showNgrams && isNgramBar);
    setWrap("num_top_ngrams_for_evolution", showNgrams && isNgramEvolution);
    setWrap("specific_ngrams_to_track", showNgrams && isNgramEvolution);
    setWrap("min_ngram_cooccurrence", showNgrams && isNgramNetwork);
    setWrap("max_nodes_for_ngram_network", showNgrams && isNgramNetwork);
    setWrap("num_ngrams_for_heatmap_cols", showNgrams && isNgramHeatmap);
    setWrap("num_docs_for_heatmap_rows", showNgrams && isNgramHeatmap);
  }

  private readParams(): Record<string, unknown> {
    const host = this.exportHost?.querySelector<HTMLElement>("#optionsHost");
    if (!host) return {};
    const inputs = host.querySelectorAll<HTMLElement>("[data-param-key]");
    const params: Record<string, unknown> = {};
    inputs.forEach((node) => {
      const key = node.getAttribute("data-param-key") || "";
      if (!key) return;
      if (node instanceof HTMLInputElement) {
        if (node.type === "number") {
          const v = node.value.trim();
          params[key] = v === "" ? undefined : Number(v);
        } else {
          params[key] = node.value;
        }
      } else if (node instanceof HTMLSelectElement) {
        params[key] = node.value;
      } else if (node instanceof HTMLTextAreaElement) {
        const raw = String(node.value || "");
        if (node.getAttribute("data-param-as-list") === "1") {
          const items = raw
            .split(/[;\n,]+/g)
            .map((s) => s.trim())
            .filter(Boolean);
          params[key] = items.length ? items : undefined;
        } else {
          params[key] = raw;
        }
      }
    });
    return params;
  }

  private attachControlHooks(): void {
    this.attachListener(this.mount.querySelector("#btnDiag"), "click", this.handleDiagClick);
    this.attachListener(this.mount.querySelector("#btnClear"), "click", this.handleClearClick);
    this.attachListener(this.mount.querySelector("#btnCopy"), "click", this.handleCopyClick);
    this.attachListener(this.mount.querySelector("#tabSlide"), "click", () => this.setTab("slide"));
    this.attachListener(this.mount.querySelector("#tabTable"), "click", () => this.setTab("table"));
    this.attachListener(this.mount.querySelector("#btnPrev"), "click", () => this.goToSlide(-1));
    this.attachListener(this.mount.querySelector("#btnNext"), "click", () => this.goToSlide(1));
  }

  private attachExportPanelHooks(): void {
    if (!this.exportHost) {
      return;
    }
    this.attachListener(this.exportHost.querySelector("#btnRunInputs"), "click", this.handleRunInputs);
    const inputsHost = this.exportHost.querySelector<HTMLElement>("#optionsHost");
    if (inputsHost) {
      this.attachListener(inputsHost, "input", this.handleOptionsInputChange as unknown as EventListener);
      this.attachListener(inputsHost, "change", this.handleOptionsInputChange as unknown as EventListener);
    }
    this.attachListener(this.exportHost.querySelector("#btnResetInputs"), "click", this.handleResetInputs);
    const auto = this.exportHost.querySelector<HTMLInputElement>("#chkAutoRun");
    if (auto) {
      this.attachListener(auto as unknown as HTMLElement, "change", this.handleAutoRunToggle as unknown as EventListener);
    }
    this.attachListener(this.exportHost.querySelector("#btnBuild"), "click", this.handleBuild);
    this.attachListener(this.exportHost.querySelector("#btnRefresh"), "click", this.handleRefreshClick);
    this.attachListener(this.exportHost.querySelector("#btnCancelPreview"), "click", this.handleCancelPreviewClick);
    this.attachListener(this.exportHost.querySelector("#btnCopyStatus"), "click", this.handleCopyStatus);
    this.attachListener(this.exportHost.querySelector("#btnClearStatus"), "click", this.handleClearStatus);
    this.attachListener(this.exportHost.querySelector("#btnDescribe"), "click", this.handleDescribeClick);
    this.attachListener(this.exportHost.querySelector("#btnDescribeClear"), "click", this.handleDescribeClearClick);
    const use = this.exportHost.querySelector<HTMLInputElement>("#describeUse");
    if (use) {
      this.attachListener(use as unknown as HTMLElement, "change", this.handleDescribeUseChange);
    }
    const text = this.exportHost.querySelector<HTMLTextAreaElement>("#describeText");
    if (text) {
      this.attachListener(text as unknown as HTMLElement, "input", this.handleDescribeTextInput);
    }
    this.refreshDescribeBox();
    this.updateCancelButtonState();
  }

  private handleAutoRunToggle = (): void => {
    const chk = this.exportHost?.querySelector<HTMLInputElement>("#chkAutoRun");
    if (!chk) return;
    try {
      window.localStorage.setItem(VisualiserPage.AUTORUN_STORAGE_KEY, chk.checked ? "1" : "0");
    } catch {
      // ignore
    }
    if (chk.checked) {
      this.scheduleAutoRun();
    } else if (this.autoRunTimer) {
      window.clearTimeout(this.autoRunTimer);
      this.autoRunTimer = null;
    }
  };

  private handleResetInputs = (): void => {
    if (!this.exportHost) return;
    const host = this.exportHost.querySelector<HTMLElement>("#optionsHost");
    if (!host) return;
    this.suppressAutoRun = true;
    try {
      this.schema.forEach((field) => {
        const node = host.querySelector<HTMLElement>(`[data-param-key='${CSS.escape(field.key)}']`);
        if (!node) return;
        const value = field.default ?? "";
        if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) {
          node.value = String(value);
        } else if (node instanceof HTMLTextAreaElement) {
          node.value = String(value ?? "");
        }
      });
      try {
        window.localStorage.removeItem(VisualiserPage.PARAMS_STORAGE_KEY);
      } catch {
        // ignore
      }
      this.applyOptionsVisibility();
    } finally {
      this.suppressAutoRun = false;
    }
  };

  private handleOptionsInputChange = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (!target || !this.exportHost) return;
    if (!target.closest("[data-param-key]") && !(target as any).getAttribute?.("data-param-key")) {
      // For select/input nested in label, closest may miss; check direct attr.
      if (!target.getAttribute?.("data-param-key")) {
        return;
      }
    }
    this.applyOptionsVisibility();
    if (!this.suppressAutoRun) {
      const params = this.readParams();
      this.persistParamsToStorage(params);
      this.scheduleAutoRun();
    }
  };

  private getActiveSlideNoteKey(): string {
    const slide = this.deck[this.slideIndex] as any;
    const explicitId = String(slide?.slide_id ?? "").trim();
    if (explicitId) return explicitId;
    return this.buildSlideKey(slide);
  }

  private setDescribeBoxOpen(open: boolean): void {
    const box = this.exportHost?.querySelector<HTMLElement>("#describeBox");
    if (!box) return;
    box.style.display = open ? "" : "none";
  }

  private refreshDescribeBox(): void {
    if (!this.exportHost) return;
    const text = this.exportHost.querySelector<HTMLTextAreaElement>("#describeText");
    const use = this.exportHost.querySelector<HTMLInputElement>("#describeUse");
    const status = this.exportHost.querySelector<HTMLElement>("#describeStatus");
    if (!text || !use || !status) return;
    const key = this.getActiveSlideNoteKey();
    const existing = this.slideDescriptions.get(key) ?? "";
    if (existing) {
      text.value = existing;
      use.checked = true;
      status.textContent = "Description saved for PPT notes.";
      return;
    }
    // If user is drafting (box open) keep text unless they opt out.
    if (!use.checked) {
      text.value = "";
    }
    use.checked = false;
    status.textContent = "No description yet.";
  }

  private attachListener(element: HTMLElement | null, type: string, listener: EventListener): void {
    if (!element) {
      return;
    }
    element.addEventListener(type, listener);
    this.eventHandlers.push({ element, type, listener });
  }

  private renderThumbs(): void {
    const host = this.mount.querySelector<HTMLElement>("#thumbsList");
    if (!host) {
      return;
    }
    this.cleanupThumbObserver();
    host.innerHTML = "";
    const indices = this.getVisualSlideIndices(this.deck);
    if (!indices.length) {
      host.innerHTML = this.loadingDeck
        ? `<div class="muted" style="padding:10px;font-size:12px;color:var(--muted);">Loading visuals…</div>`
        : `<div class="muted" style="padding:10px;font-size:12px;color:var(--muted);">No figures yet.</div>`;
      this.updateSlideCounter();
      return;
    }
    const pane = this.mount.querySelector<HTMLElement>("#thumbsPane") ?? host;
    const observer = this.ensureThumbObserver(pane);
    this.lastActiveThumbIdx = null;
    for (const index of indices) {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "thumb";
      if (index === this.slideIndex) {
        thumb.classList.add("active");
      }
      const title =
        (this.deck[index] as { title?: string } | undefined)?.title ||
        `Slide ${index + 1}`;
      const preview = document.createElement("div");
      preview.className = "thumb-preview";
      const img = document.createElement("img");
      img.className = "thumb-img";
      img.alt = title;
      img.decoding = "async";
      img.loading = "lazy";
      img.src = this.svgThumbDataUrl({ title, subtitle: "Loading…", kind: "loading" });
      img.dataset.fallbackSrc = img.src;
      img.addEventListener("error", () => {
        const fallback = img.dataset.fallbackSrc;
        if (fallback && img.src !== fallback) {
          img.src = fallback;
        }
      });
      preview.appendChild(img);

      const label = document.createElement("div");
      label.className = "thumb-label";
      label.textContent = title;

      const sub = document.createElement("div");
      sub.className = "thumb-sub";
      sub.textContent = "Preview";

      thumb.appendChild(preview);
      thumb.appendChild(label);
      thumb.appendChild(sub);
      thumb.setAttribute("data-idx", String(index));
      (thumb as any).dataset.idx = String(index);
      thumb.addEventListener("click", () => {
        this.slideIndex = index;
        this.applySlideChange();
      });
      host.appendChild(thumb);

      const slide = this.deck[index] as Record<string, unknown> | undefined;
      observer.observe(thumb);

      // Prime the currently active thumb immediately for perceived performance.
      if (index === this.slideIndex && slide) {
        const key = this.buildThumbKey(slide, index);
        this.enqueueThumbTask(key, () => this.populateThumbImage(img, slide, index));
      }
    }
    this.lastActiveThumbIdx = this.slideIndex;
    this.updateSlideCounter();
  }

  private resetThumbPipeline(): void {
    this.thumbQueue = [];
    this.thumbInFlight = 0;
    this.thumbCache.clear();
    this.thumbRequestedKeys.clear();
    this.thumbPumpScheduled = false;
  }

  private enqueueThumbTask(key: string, task: () => Promise<void>): void {
    if (key && this.thumbRequestedKeys.has(key)) {
      return;
    }
    if (key) {
      this.thumbRequestedKeys.add(key);
    }
    this.thumbQueue.push(task);
    this.scheduleThumbPump();
  }

  private scheduleThumbPump(): void {
    if (this.thumbPumpScheduled) return;
    this.thumbPumpScheduled = true;
    const run = () => {
      this.thumbPumpScheduled = false;
      this.pumpThumbQueue();
    };
    const w = window as any;
    if (typeof w.requestIdleCallback === "function") {
      w.requestIdleCallback(run, { timeout: 500 });
      return;
    }
    window.setTimeout(run, 0);
  }

  private pumpThumbQueue(): void {
    while (this.thumbInFlight < this.thumbMaxConcurrency && this.thumbQueue.length) {
      const next = this.thumbQueue.shift();
      if (!next) return;
      this.thumbInFlight += 1;
      void (async () => {
        await this.yieldToUi();
        await next();
      })()
        .catch(() => {
          // ignore; populateThumbImage handles fallbacks + logging
        })
        .finally(() => {
          this.thumbInFlight -= 1;
          this.scheduleThumbPump();
        });
    }
  }

  private async yieldToUi(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  private ensureThumbObserver(root: HTMLElement): IntersectionObserver {
    if (this.thumbObserver) {
      return this.thumbObserver;
    }
    this.thumbObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target as HTMLElement;
          const img = el.querySelector<HTMLImageElement>("img.thumb-img");
          const idx = Number(el.dataset.idx || "");
          if (!img || !Number.isFinite(idx)) return;
          const slide = this.deck[idx] as Record<string, unknown> | undefined;
          if (!slide) return;
          this.thumbObserver?.unobserve(el);
          const key = this.buildThumbKey(slide, idx);
          this.enqueueThumbTask(key, () => this.populateThumbImage(img, slide, idx));
        });
      },
      { root, rootMargin: "250px 0px", threshold: 0.01 }
    );
    return this.thumbObserver;
  }

  private cleanupThumbObserver(): void {
    if (this.thumbObserver) {
      this.thumbObserver.disconnect();
      this.thumbObserver = null;
    }
  }

  private svgThumbDataUrl(args: { title: string; subtitle?: string; kind: "loading" | "table" | "text" }): string {
    const palette = this.getThemePalette();
    const bg = palette.panel;
    const fg = palette.text;
    const muted = palette.muted;
    const accent = palette.accent2;
    const title = args.title || "Slide";
    const subtitle = args.subtitle || (args.kind === "table" ? "Table" : args.kind === "text" ? "Notes" : "Loading…");
    const badge = args.kind === "table" ? "TABLE" : args.kind === "text" ? "TEXT" : "…";
    const W = 420;
    const H = 315;
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${bg}" stop-opacity="1"/>
      <stop offset="1" stop-color="${bg}" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="url(#g)"/>
  <rect x="16" y="16" width="${W - 32}" height="${H - 80}" rx="14" fill="${palette.panel}" opacity="0.65" stroke="${accent}" stroke-opacity="0.35"/>
  <text x="28" y="44" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" font-size="12" fill="${muted}">${badge}</text>
  <text x="28" y="78" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="14" fill="${fg}" font-weight="700">${this.escapeXml(title).slice(0, 44)}</text>
  <text x="28" y="104" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="12" fill="${muted}">${this.escapeXml(subtitle).slice(0, 54)}</text>
  <rect x="16" y="${H - 42}" width="${W - 32}" height="26" rx="12" fill="${palette.panel}" opacity="0.5" stroke="${accent}" stroke-opacity="0.25"/>
  <circle cx="32" cy="${H - 29}" r="5" fill="${accent}" opacity="0.9"/>
  <text x="44" y="${H - 25}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="12" fill="${muted}">Visualiser preview</text>
</svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  private escapeXml(text: string): string {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  private hashString(input: string): string {
    // djb2
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
      hash = (hash * 33) ^ input.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
  }

  private buildThumbKey(slide: Record<string, unknown> | undefined, index: number): string {
    const title = String((slide as any)?.title ?? "");
    const fig = (slide as any)?.fig_json;
    const img = String((slide as any)?.thumb_img ?? (slide as any)?.img ?? "");
    if (img) {
      return `img:${this.hashString(img)}`;
    }
    if (typeof fig === "string") {
      return `figs:${this.hashString(fig)}`;
    }
    if (fig && typeof fig === "object") {
      try {
        return `figo:${this.hashString(JSON.stringify(fig))}`;
      } catch {
        return `figo:${index}:${title}`;
      }
    }
    const table = String((slide as any)?.table_html ?? "");
    if (table) {
      return `tbl:${this.hashString(table.slice(0, 4000))}`;
    }
    const notes = String((slide as any)?.notes ?? "");
    return `txt:${this.hashString(`${title}\n${notes}`)}`;
  }

  private async populateThumbImage(img: HTMLImageElement, slide: Record<string, unknown> | undefined, index: number): Promise<void> {
    const version = this.deckVersion;
    const key = this.buildThumbKey(slide, index);
    const cached = this.thumbCache.get(key);
    if (cached) {
      img.src = cached;
      return;
    }

    const title = String((slide as any)?.title ?? `Slide ${index + 1}`);
    const directImg = String((slide as any)?.thumb_img ?? (slide as any)?.img ?? "").trim();
    if (directImg) {
      this.thumbCache.set(key, directImg);
      img.src = directImg;
      img.dataset.fallbackSrc = img.dataset.fallbackSrc || directImg;
      return;
    }

    const figJson = this.normalizeFigJson((slide as any)?.fig_json) as any;
    if (figJson) {
      const svgFallback = this.svgFigureThumbDataUrl(figJson, title);
      if (svgFallback && this.deckVersion === version) {
        // Always show a deterministic, fast fallback first (and keep the log area clean).
        this.thumbCache.set(key, svgFallback);
        img.src = svgFallback;
        img.dataset.fallbackSrc = svgFallback;
      }
      if (this.shouldAttemptPngThumb(figJson)) {
        const url = await this.plotlyThumbDataUrl(figJson).catch(() => undefined);
        if (url && this.deckVersion === version) {
          this.thumbCache.set(key, url);
          img.src = url;
          return;
        }
      }
      if (svgFallback && this.deckVersion === version) {
        return;
      }
    }

    const hasTable = Boolean(String((slide as any)?.table_html ?? "").trim());
    const fallback = hasTable
      ? this.svgThumbDataUrl({ title, subtitle: "Table slide", kind: "table" })
      : this.svgThumbDataUrl({ title, subtitle: "No figure", kind: "text" });
    if (this.deckVersion === version) {
      this.thumbCache.set(key, fallback);
      img.src = fallback;
    }
  }

  private svgFigureThumbDataUrl(figJson: any, title: string): string | undefined {
    try {
      const data = Array.isArray(figJson?.data) ? figJson.data : Array.isArray(figJson) ? figJson : [];
      if (!data.length) return undefined;
      const trace = data.find((t: any) => t && typeof t === "object") as any;
      if (!trace) return undefined;

      const type = String(trace.type || "scatter");
      const palette = this.getThemePalette();
      const bg = palette.panel;
      const fg = palette.text;
      const muted = palette.muted;
      const accent = palette.accent;

      const W = 420;
      const H = 315;
      const padL = 18;
      const padR = 10;
      const padT = 12;
      const padB = 26;
      const plotW = W - padL - padR;
      const plotH = H - padT - padB;

      const safeTitle = this.escapeXml(title).slice(0, 44);

      const frame = `
  <rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="${bg}" opacity="0.92"/>
  <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" rx="12" fill="${palette.panel}" opacity="0.55" stroke="${palette.accent2}" stroke-opacity="0.25"/>
  <text x="${padL}" y="${H - 8}" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="12" fill="${muted}">${safeTitle}</text>`;

      const coerceNums = (arr: any[]): number[] =>
        arr
          .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN))
          .filter((v) => Number.isFinite(v));

      if (type === "bar") {
        const ys = coerceNums(Array.isArray(trace.y) ? trace.y : []);
        if (!ys.length) return undefined;
        const maxY = Math.max(...ys, 1);
        const n = Math.min(ys.length, 12);
        const bw = plotW / n;
        const bars = ys.slice(0, n).map((y, i) => {
          const h = Math.max(2, (y / maxY) * (plotH - 10));
          const x = padL + i * bw + bw * 0.18;
          const w = bw * 0.64;
          const yy = padT + (plotH - h);
          return `<rect x="${x.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(
            1
          )}" rx="4" fill="${accent}" opacity="0.9"/>`;
        });
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${frame}
${bars.join("\n")}
</svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
      }

      if (type === "scatter" || type === "scattergeo" || type === "scattergl") {
        const ys = coerceNums(Array.isArray(trace.y) ? trace.y : []);
        if (!ys.length) return undefined;
        const n = Math.min(ys.length, 24);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const span = Math.max(1e-9, maxY - minY);
        const pts = ys.slice(0, n).map((y, i) => {
          const x = padL + (i / Math.max(1, n - 1)) * (plotW - 8) + 4;
          const yy = padT + (1 - (y - minY) / span) * (plotH - 8) + 4;
          return { x, y: yy };
        });
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
        const dots = pts
          .filter((_, i) => i % Math.max(1, Math.floor(n / 8)) === 0)
          .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.4" fill="${accent}" opacity="0.95"/>`)
          .join("\n");
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
${frame}
<path d="${d}" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round" opacity="0.9"/>
${dots}
</svg>`;
        return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
      }

      // Unknown/complex trace types: still provide a consistent image.
      return this.svgThumbDataUrl({ title, subtitle: `Figure (${type})`, kind: "text" });
    } catch {
      return undefined;
    }
  }

  private shouldAttemptPngThumb(figJson: any): boolean {
    try {
      const data = Array.isArray(figJson?.data) ? figJson.data : Array.isArray(figJson) ? figJson : [];
      const types = data
        .map((t: unknown) =>
          t && typeof t === "object" ? String((t as { type?: unknown }).type || "scatter") : ""
        )
        .filter(Boolean);
      if (!types.length) return false;
      // Avoid trace types that commonly fail or are expensive to snapshot.
      const blocked = [
        "scattergeo",
        "choropleth",
        "choroplethmapbox",
        "scattermapbox",
        "densitymapbox",
        "scattergl",
        "heatmapgl",
        "splom",
        "parcoords",
        "sankey",
        "surface",
        "mesh3d",
        "cone",
        "streamtube",
        "volume",
        "isosurface",
        "table"
      ];
      if (types.some((t: string) => blocked.includes(t))) return false;
      // Allow common 2D traces.
      const allowed = ["bar", "scatter", "pie", "histogram", "box", "violin", "heatmap", "indicator"];
      return types.every((t: string) => allowed.includes(t));
    } catch {
      return false;
    }
  }

  private async plotlyThumbDataUrl(figJson: any): Promise<string> {
    // Render offscreen to create a small PNG thumb without requiring python/kaleido.
    const palette = this.getThemePalette();
    const THUMB_W = 420;
    const THUMB_H = 315;
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = `${THUMB_W}px`;
    container.style.height = `${THUMB_H}px`;
    container.style.pointerEvents = "none";
    container.style.opacity = "0";
    document.body.appendChild(container);

    try {
      // Give the UI thread a breath before heavy plotly work.
      await this.yieldToUi();
      const rawData = Array.isArray(figJson?.data) ? figJson.data : Array.isArray(figJson) ? figJson : [];
      const data = this.applyCategoricalPaletteToData(rawData);
      const layout = figJson.layout || {};
      const m = layout.margin || {};
      const toNum = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
      const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
      const safeMargin = {
        l: clamp(toNum(m.l, 34), 26, Math.round(THUMB_W * 0.40)),
        r: clamp(toNum(m.r, 28), 22, Math.round(THUMB_W * 0.36)),
        t: clamp(toNum(m.t, 18), 18, Math.round(THUMB_H * 0.30)),
        b: clamp(toNum(m.b, 34), 26, Math.round(THUMB_H * 0.36)),
        pad: Math.max(0, toNum(m.pad, 2)),
        autoexpand: true
      };
      const finalLayout = {
        ...layout,
        title: undefined,
        paper_bgcolor: palette.panel,
        plot_bgcolor: palette.panel,
        font: { ...(layout.font || {}), color: palette.text },
        margin: safeMargin,
        width: THUMB_W,
        height: THUMB_H,
        autosize: false
      };
      const themedLayout = this.applyThemeToLayoutArt(finalLayout, palette);
      await Plotly.newPlot(container, data, themedLayout, {
        displayModeBar: false,
        staticPlot: true,
        responsive: false
      });
      const url = (await (Plotly as any).toImage(container, {
        format: "png",
        width: THUMB_W,
        height: THUMB_H,
        scale: 2
      })) as string;
      if (typeof url === "string" && url.startsWith("blob:")) {
        // CSP can block blob: in img-src; convert to a data URL.
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.readAsDataURL(blob);
          });
          return dataUrl || url;
        } finally {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }
      }
      return url;
    } catch (error) {
      // Don't write thumb errors into the Visualiser log: thumbs are best-effort UI polish.
      // Keep any diagnostics in DevTools console instead.
      try {
        console.debug("[visualiser][thumb] plotly snapshot failed", error);
      } catch {
        // ignore
      }
      throw error;
    } finally {
      try {
        Plotly.purge(container);
      } catch {
        // ignore
      }
      container.remove();
    }
  }

  private applySlideChange(options?: { rebuildThumbs?: boolean }): void {
    if (options?.rebuildThumbs) {
      this.renderThumbs();
    } else {
      this.updateActiveThumb();
    }
    this.renderSlide();
    this.updateSummary();
    this.refreshDescribeBox();
  }

  private handleDescribeClearClick = (): void => {
    if (!this.exportHost) return;
    this.setDescribeBoxOpen(true);
    const key = this.getActiveSlideNoteKey();
    this.slideDescriptions.delete(key);
    const text = this.exportHost.querySelector<HTMLTextAreaElement>("#describeText");
    const use = this.exportHost.querySelector<HTMLInputElement>("#describeUse");
    const status = this.exportHost.querySelector<HTMLElement>("#describeStatus");
    if (text) text.value = "";
    if (use) use.checked = false;
    if (status) status.textContent = "Cleared.";
  };

  private handleDescribeUseChange = (): void => {
    if (!this.exportHost) return;
    const key = this.getActiveSlideNoteKey();
    const use = this.exportHost.querySelector<HTMLInputElement>("#describeUse");
    const text = this.exportHost.querySelector<HTMLTextAreaElement>("#describeText");
    const status = this.exportHost.querySelector<HTMLElement>("#describeStatus");
    if (!use || !text || !status) return;
    if (use.checked) {
      const v = String(text.value || "").trim();
      if (v) {
        this.slideDescriptions.set(key, v);
        status.textContent = "Description saved for PPT notes.";
      } else {
        use.checked = false;
        status.textContent = "Nothing to save (empty).";
      }
    } else {
      this.slideDescriptions.delete(key);
      status.textContent = "Not included in PPT notes.";
    }
  };

  private handleDescribeTextInput = (): void => {
    if (!this.exportHost) return;
    const key = this.getActiveSlideNoteKey();
    const use = this.exportHost.querySelector<HTMLInputElement>("#describeUse");
    const text = this.exportHost.querySelector<HTMLTextAreaElement>("#describeText");
    const status = this.exportHost.querySelector<HTMLElement>("#describeStatus");
    if (!use || !text || !status) return;
    if (use.checked) {
      const v = String(text.value || "").trim();
      if (v) {
        this.slideDescriptions.set(key, v);
        status.textContent = "Description saved for PPT notes.";
      } else {
        this.slideDescriptions.delete(key);
        status.textContent = "Description empty (not saved).";
      }
    }
  };

  private handleDescribeClick = (): void => {
    void this.describeActiveSlide();
  };

  private async describeActiveSlide(): Promise<void> {
    if (!this.exportHost) return;
    const status = this.exportHost.querySelector<HTMLElement>("#describeStatus");
    const text = this.exportHost.querySelector<HTMLTextAreaElement>("#describeText");
    const use = this.exportHost.querySelector<HTMLInputElement>("#describeUse");
    if (!status || !text || !use) return;

    const slide = this.deck[this.slideIndex] as Record<string, unknown> | undefined;
    if (!slide) {
      status.textContent = "No active slide.";
      return;
    }
    status.textContent = "Generating description…";
    const collectionName = this.getCollectionNameForExport();
    const img = await this.captureActivePlotPngDataUrl().catch(() => "");
    const dfDescribe = this.describeCurrentTableForPrompt();
    const tablePreview = this.tablePreviewForSlide(slide);
    const sec = String((slide as any)?.section ?? "").trim();
    const title = String((slide as any)?.title ?? "").trim();

    const instructions =
      "You are a senior bibliometrics analyst. Write speaker notes for the slide.\n" +
      "Keep it concise, concrete, and useful for presenting.\n" +
      "Output: 6-10 bullet-like sentences (no markdown), then a short 'Caveats:' line.";

    const inputText =
      `Title: ${title || "Figure"}\n` +
      `Section: ${sec || "Visualise"}\n` +
      `Collection: ${collectionName}\n\n` +
      (dfDescribe ? `DataFrame describe (global):\n${dfDescribe}\n\n` : "") +
      (tablePreview ? `Slide table preview:\n${tablePreview}\n\n` : "") +
      "Describe what the chart shows, highlight key patterns, and suggest what to check next.";

    const response = await this.sendVisualiserCommand("describe_slide_llm", {
      model: "gpt-5-mini",
      instructions,
      inputText,
      imageDataUrl: img
    });
    if (!response || response.status !== "ok") {
      status.textContent = "Describe failed.";
      const message = String((response as any)?.message || "No response");
      this.appendIssueLog(`[describe] ${message}`);
      return;
    }
    const desc = String((response as any).description || "").trim();
    if (!desc) {
      status.textContent = "No description returned.";
      return;
    }
    text.value = desc;
    status.textContent = "Description ready. Check “Use in PPT notes” to include.";
    use.checked = this.slideDescriptions.has(this.getActiveSlideNoteKey());
  }

  private tablePreviewForSlide(slide: Record<string, unknown>): string {
    const html = this.findTableHtmlForSlide(slide);
    const tmp = document.createElement("div");
    tmp.innerHTML = html || "";
    const text = (tmp.textContent || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 2000);
  }

  private describeCurrentTableForPrompt(maxCols = 24): string {
    const table = this.currentTable;
    if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      return "";
    }
    const cols = table.columns.map((c) => String(c ?? ""));
    const rows = table.rows;
    const out: string[] = [];
    out.push(`rows=${rows.length} cols=${cols.length}`);
    const nCols = Math.min(cols.length, maxCols);

    const sampleNumeric = (values: number[]): { p25: number; p50: number; p75: number } => {
      if (!values.length) return { p25: 0, p50: 0, p75: 0 };
      const N = values.length;
      const pick = (q: number) => {
        const idx = Math.min(N - 1, Math.max(0, Math.floor(q * (N - 1))));
        return values[idx];
      };
      return { p25: pick(0.25), p50: pick(0.5), p75: pick(0.75) };
    };

    const toNum = (v: unknown): number | null => {
      if (v == null) return null;
      if (typeof v === "number" && Number.isFinite(v)) return v;
      const s = String(v).trim();
      if (!s) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    for (let j = 0; j < nCols; j += 1) {
      const name = cols[j] || `col_${j}`;
      let nonEmpty = 0;
      let numericCount = 0;
      let mean = 0;
      let m2 = 0;
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      const sample: number[] = [];
      const catCounts = new Map<string, number>();

      const pushSample = (x: number) => {
        // capped sample for quantiles
        if (sample.length < 2000) {
          sample.push(x);
          return;
        }
        // stride replacement (cheap deterministic)
        const idx = (numericCount - 1) % sample.length;
        sample[idx] = x;
      };

      for (let i = 0; i < rows.length; i += 1) {
        const v = rows[i]?.[j];
        if (v == null || v === "") continue;
        nonEmpty += 1;
        const n = toNum(v);
        if (n != null) {
          numericCount += 1;
          const delta = n - mean;
          mean += delta / numericCount;
          const delta2 = n - mean;
          m2 += delta * delta2;
          if (n < min) min = n;
          if (n > max) max = n;
          pushSample(n);
        } else {
          const s = String(v).trim();
          if (!s) continue;
          catCounts.set(s, (catCounts.get(s) || 0) + 1);
        }
      }

      if (numericCount >= Math.max(3, Math.floor(nonEmpty * 0.6))) {
        sample.sort((a, b) => a - b);
        const q = sampleNumeric(sample);
        const variance = numericCount > 1 ? m2 / (numericCount - 1) : 0;
        const std = Math.sqrt(Math.max(0, variance));
        out.push(
          `${name}: count=${numericCount} mean=${mean.toFixed(3)} std=${std.toFixed(3)} min=${min.toFixed(
            3
          )} p25=${q.p25.toFixed(3)} p50=${q.p50.toFixed(3)} p75=${q.p75.toFixed(3)} max=${max.toFixed(3)}`
        );
      } else {
        // categorical-ish
        const entries = Array.from(catCounts.entries()).sort((a, b) => b[1] - a[1]);
        const unique = entries.length;
        const top = entries.slice(0, 3).map(([k, n]) => `${k}(${n})`).join(", ");
        out.push(`${name}: count=${nonEmpty} unique=${unique}${top ? ` top=${top}` : ""}`);
      }
    }
    if (cols.length > nCols) {
      out.push(`… +${cols.length - nCols} more columns`);
    }
    return out.join("\n");
  }

  private async captureActivePlotPngDataUrl(): Promise<string> {
    if (!this.plotHost) return "";
    if (!this.plotHost.classList.contains("js-plotly-plot")) return "";
    const rect = this.plotHost.getBoundingClientRect();
    const width = Math.max(900, Math.round(rect.width || 0));
    const height = Math.max(520, Math.round(rect.height || 0));
    const url = (await (Plotly as any).toImage(this.plotHost, {
      format: "png",
      width,
      height,
      scale: 2
    })) as string;
    if (typeof url === "string" && url.startsWith("blob:")) {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.readAsDataURL(blob);
      });
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      return dataUrl || "";
    }
    return typeof url === "string" ? url : "";
  }

  private updateActiveThumb(): void {
    const host = this.mount.querySelector<HTMLElement>("#thumbsList");
    if (!host) return;
    const currentIdx = this.slideIndex;
    if (this.lastActiveThumbIdx === currentIdx) return;
    const prev = this.lastActiveThumbIdx;
    if (prev !== null) {
      const prevEl = host.querySelector<HTMLElement>(`button.thumb[data-idx='${prev}']`);
      if (prevEl) prevEl.classList.remove("active");
    } else {
      const existing = host.querySelector<HTMLElement>("button.thumb.active");
      if (existing) existing.classList.remove("active");
    }
    const nextEl = host.querySelector<HTMLElement>(`button.thumb[data-idx='${currentIdx}']`);
    if (nextEl) nextEl.classList.add("active");
    this.lastActiveThumbIdx = currentIdx;
  }

  private updateSlideCounter(): void {
    const counter = this.mount.querySelector<HTMLElement>("#slideCount");
    if (!counter) {
      return;
    }
    const indices = this.getVisualSlideIndices(this.deck);
    const total = indices.length || 0;
    const pos = indices.indexOf(this.slideIndex);
    const current = total && pos >= 0 ? String(pos + 1) : total ? "1" : "0";
    counter.textContent = `${current} / ${total}`;
  }

  private drawExampleFigure(): void {
    this.plotHost = this.mount.querySelector<HTMLElement>("#plot");
    if (!this.plotHost) {
      return;
    }
    const palette = this.getThemePalette();
    const labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul"];
    const lines = [
      {
        name: "Series A",
        x: labels,
        y: [12, 18, 15, 22, 19, 24, 21],
        mode: "lines+markers",
        type: "scatter",
        line: { shape: "spline", width: 3, color: palette.accent },
        marker: { size: 6 }
      },
      {
        name: "Series B",
        x: labels,
        y: [8, 11, 14, 16, 15, 17, 18],
        mode: "lines+markers",
        type: "scatter",
        line: { shape: "spline", width: 3, color: palette.accent2 },
        marker: { size: 6 }
      },
      {
        name: "Series C",
        x: labels,
        y: [5, 9, 7, 12, 13, 11, 14],
        mode: "lines+markers",
        type: "scatter",
        line: { shape: "spline", width: 3, color: palette.accent3 },
        marker: { size: 6 }
      }
    ];
    const bar = {
      name: "Volume",
      x: labels,
      y: [14, 20, 16, 24, 21, 26, 23],
      type: "bar",
      opacity: 0.6,
      marker: { color: palette.accent4 },
      yaxis: "y2"
    };
    const layout = {
      paper_bgcolor: palette.panel,
      plot_bgcolor: palette.panel,
      font: { color: palette.text },
      legend: { orientation: "h", y: 1.08 },
      margin: { l: 40, r: 40, t: 40, b: 40 },
      hovermode: "x unified",
      xaxis: { tickangle: 0 },
      yaxis: { title: "Metric", zeroline: false, tickfont: { color: palette.muted } },
      yaxis2: {
        overlaying: "y",
        side: "right",
        title: "Volume",
        zeroline: false,
        tickfont: { color: palette.muted }
      }
    };
    const config = { responsive: true, displayModeBar: false, scrollZoom: false };
    Plotly.purge(this.plotHost);
    void Plotly.newPlot(this.plotHost, [...lines, bar], layout, config).then(() => {
      this.setStatus("Rendered");
      this.installPlotResizeObserver();
      this.resizePlot();
      const rect = this.plotHost?.getBoundingClientRect();
      if (rect) {
      }
    });
  }

  private getThemePalette(): {
    accent: string;
    accent2: string;
    accent3: string;
    accent4: string;
    panel: string;
    text: string;
    muted: string;
  } {
    const styles = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => {
      const value = styles.getPropertyValue(name).trim();
      return value || fallback;
    };
    return {
      accent: read("--accent", "#4fd1c5"),
      accent2: read("--accent-2", "#5b9bff"),
      accent3: read("--highlight", "#f6ad55"),
      accent4: read("--link", "#667eea"),
      panel: read("--panel", "#0d111e"),
      text: read("--text", "#d4e2ff"),
      muted: read("--muted", "#94a3b8")
    };
  }

  private getPlotlyColorway(): string[] {
    const p = this.getThemePalette();
    return [
      p.accent,
      p.accent2,
      p.accent3,
      p.accent4,
      "#f56565",
      "#48bb78",
      "#ed8936",
      "#38b2ac",
      "#9f7aea",
      "#ecc94b",
      "#63b3ed",
      "#f687b3"
    ];
  }

  private applyThemeToLayoutArt(layout: any, palette: { panel: string; text: string; muted: string }): any {
    if (!layout || typeof layout !== "object") return layout;

    const hexToRgba = (hex: string, alpha: number): string => {
      const h = String(hex || "").trim().replace(/^#/, "");
      const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
      if (full.length !== 6) return `rgba(148,163,184,${alpha})`;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return `rgba(${r},${g},${b},${alpha})`;
    };

    const parseRgb = (
      value: unknown
    ): { r: number; g: number; b: number; a: number; neutral: boolean } | null => {
      const v = String(value ?? "").trim().toLowerCase();
      if (!v) return null;
      const named: Record<string, string> = {
        white: "rgb(255,255,255)",
        black: "rgb(0,0,0)",
        transparent: "rgba(0,0,0,0)"
      };
      const s = (named[v] || v).replace(/\s+/g, "");
      const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (hex) {
        const h = hex[1];
        const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return { r, g, b, a: 1, neutral: Math.abs(r - g) < 12 && Math.abs(r - b) < 12 && Math.abs(g - b) < 12 };
      }
      const rgb = s.match(/^rgb\((\d+),(\d+),(\d+)\)$/i);
      if (rgb) {
        const r = Number(rgb[1]);
        const g = Number(rgb[2]);
        const b = Number(rgb[3]);
        return { r, g, b, a: 1, neutral: Math.abs(r - g) < 12 && Math.abs(r - b) < 12 && Math.abs(g - b) < 12 };
      }
      const rgba = s.match(/^rgba\((\d+),(\d+),(\d+),([0-9.]+)\)$/i);
      if (rgba) {
        const r = Number(rgba[1]);
        const g = Number(rgba[2]);
        const b = Number(rgba[3]);
        const a = Number(rgba[4]);
        return { r, g, b, a: Number.isFinite(a) ? a : 1, neutral: Math.abs(r - g) < 12 && Math.abs(r - b) < 12 && Math.abs(g - b) < 12 };
      }
      return null;
    };

    const brightness = (c: { r: number; g: number; b: number }): number => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;

    const out: any = { ...layout };
    // Force figure backgrounds to match the app theme (Python defaults often hardcode white).
    out.paper_bgcolor = palette.panel;
    out.plot_bgcolor = palette.panel;

    if (Array.isArray(out.annotations)) {
      out.annotations = out.annotations.map((ann: any) => {
        const font = ann && ann.font && typeof ann.font === "object" ? { ...ann.font } : {};
        const parsed = parseRgb(font.color);
        if (!parsed) {
          font.color = palette.text;
          return { ...ann, font };
        }
        // Many backend figures use neutral dark greys/blacks that become unreadable on dark themes.
        if (parsed.neutral) {
          const b = brightness(parsed);
          font.color = b < 80 ? palette.text : palette.muted;
        }
        return { ...ann, font };
      });
    }

    if (Array.isArray(out.shapes)) {
      out.shapes = out.shapes.map((shape: any) => {
        const fillParsed = parseRgb(shape?.fillcolor);
        const lineColor = shape?.line && typeof shape.line === "object" ? (shape.line as any).color : undefined;
        const lineParsed = parseRgb(lineColor);
        const next: any = { ...shape };
        if (fillParsed && fillParsed.neutral && brightness(fillParsed) > 210) {
          next.fillcolor = hexToRgba(palette.text, 0.06);
        }
        if (lineParsed && lineParsed.neutral && brightness(lineParsed) > 170) {
          next.line = { ...(next.line || {}), color: hexToRgba(palette.muted, 0.35) };
        }
        return next;
      });
    }

    return out;
  }

  private buildCategoricalPalette(n: number): string[] {
    const base = [
      ...this.getPlotlyColorway(),
      "#22c55e",
      "#ef4444",
      "#06b6d4",
      "#a855f7",
      "#f59e0b",
      "#10b981",
      "#3b82f6",
      "#e11d48",
      "#84cc16",
      "#14b8a6"
    ];
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) {
      if (i < base.length) {
        out.push(base[i]);
        continue;
      }
      const h = (i * 137.508) % 360;
      out.push(`hsl(${h} 72% 58%)`);
    }
    return out;
  }

  private applyCategoricalPaletteToData(dataIn: unknown): any[] {
    const traces = Array.isArray(dataIn) ? (dataIn as any[]) : [];
    if (!traces.length) {
      return traces;
    }
    const out = traces.map((t) => (t && typeof t === "object" ? { ...(t as any) } : t));
    const paletteLine = "rgba(148,163,184,0.32)";
    const basePalette = this.buildCategoricalPalette(64);
    const colorForLabel = (raw: unknown): string => {
      const label = String(raw ?? "").trim();
      if (!label) return basePalette[0] || "#5b9bff";
      const h = this.hashString(label.toLowerCase());
      const n = Number.parseInt(h.slice(-8), 16);
      if (!Number.isFinite(n) || n < 0) return basePalette[0] || "#5b9bff";
      return basePalette[n % basePalette.length] || "#5b9bff";
    };

    out.forEach((trace: any) => {
      if (!trace || typeof trace !== "object") return;
      const type = String(trace.type || "scatter");
      const traceLabel = String(trace.name ?? trace.legendgroup ?? "").trim();
      const traceColor = traceLabel ? colorForLabel(traceLabel) : "";
      if (type === "bar") {
        const orient = String(trace.orientation || "v");
        const catsRaw = orient === "h" ? trace.y : trace.x;
        const valsRaw = orient === "h" ? trace.x : trace.y;
        if (!Array.isArray(catsRaw) || !Array.isArray(valsRaw)) return;
        const cats = catsRaw.map((c: unknown) => String(c ?? "").trim()).filter(Boolean);
        if (cats.length < 2 || cats.length !== valsRaw.length) return;
        const marker = trace.marker && typeof trace.marker === "object" ? { ...trace.marker } : {};
        const existing = (marker as any).color;
        const hasArrayColors = Array.isArray(existing) && existing.length === cats.length;
        if (!hasArrayColors) {
          (marker as any).color = cats.map((c: string) => colorForLabel(c));
        }
        if (!(marker as any).line) {
          (marker as any).line = { color: paletteLine, width: 1 };
        }
        trace.marker = marker;
        return;
      }

      if (type === "pie") {
        const labelsRaw = trace.labels;
        const valuesRaw = trace.values;
        if (!Array.isArray(labelsRaw) || !Array.isArray(valuesRaw)) return;
        const labels = labelsRaw.map((c: unknown) => String(c ?? "").trim()).filter(Boolean);
        if (labels.length < 2 || labels.length !== valuesRaw.length) return;
        const marker = trace.marker && typeof trace.marker === "object" ? { ...trace.marker } : {};
        const existing = (marker as any).colors;
        const hasArrayColors = Array.isArray(existing) && existing.length === labels.length;
        if (!hasArrayColors) {
          (marker as any).colors = labels.map((l: string) => colorForLabel(l));
        }
        trace.marker = marker;
        return;
      }

      // For multi-trace charts, Plotly usually encodes categories as separate traces (each with a legend name).
      // If upstream doesn't provide colors, ensure each trace is visually distinct and stable across figures.
      if (type === "scatter" || type === "scattergl") {
        if (!traceColor) return;
        const marker = trace.marker && typeof trace.marker === "object" ? { ...trace.marker } : {};
        const line = trace.line && typeof trace.line === "object" ? { ...trace.line } : {};
        if (!marker.color) marker.color = traceColor;
        if (!marker.line) marker.line = { color: paletteLine, width: 1 };
        if (!line.color) line.color = traceColor;
        trace.marker = marker;
        trace.line = line;
        return;
      }

      if (type === "box" || type === "violin" || type === "histogram") {
        if (!traceColor) return;
        const marker = trace.marker && typeof trace.marker === "object" ? { ...trace.marker } : {};
        const line = trace.line && typeof trace.line === "object" ? { ...trace.line } : {};
        if (!marker.color) marker.color = traceColor;
        if (!(marker as any).line) (marker as any).line = { color: paletteLine, width: 1 };
        if (!line.color) line.color = traceColor;
        if (!trace.fillcolor && (type === "box" || type === "violin")) {
          // Lighten fill by using rgba; Plotly accepts 'rgba(r,g,b,a)' but we only have hex/hsl.
          // Use the traceColor as-is; the theme/layout will handle background contrast.
          trace.fillcolor = traceColor;
          trace.opacity = typeof trace.opacity === "number" ? trace.opacity : 0.35;
        }
        trace.marker = marker;
        trace.line = line;
        return;
      }

      if (type === "heatmap") {
        // Heatmaps usually encode categories along x/y; ensure a readable colorscale on dark themes.
        // If upstream provides a colorscale, keep it.
        if (trace.colorscale) return;
        // A compact, perceptually-uniform sequential scale that reads well on dark backgrounds.
        trace.colorscale = [
          [0.0, "#0b1220"],
          [0.15, "#16325c"],
          [0.35, "#2563eb"],
          [0.55, "#22c55e"],
          [0.75, "#f59e0b"],
          [1.0, "#ef4444"]
        ];
        trace.reversescale = Boolean(trace.reversescale);
        return;
      }
    });
    return out;
  }

  private installPlotResizeObserver(): void {
    const host = this.mount.querySelector<HTMLElement>("#plotHost");
    if (!host || typeof ResizeObserver === "undefined") {
      return;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.resizePlot();
    });
    this.resizeObserver.observe(host);
  }

  private resizePlot(): void {
    if (this.plotResizeScheduled) {
      return;
    }
    this.plotResizeScheduled = true;
    requestAnimationFrame(() => {
      this.plotResizeScheduled = false;
      this.resizePlotNow();
    });
  }

  private resizePlotNow(): void {
    if (!this.plotHost) {
      return;
    }
    if (this.getActiveRibbonTab() !== "visualiser") {
      return;
    }
    if (this.currentTab !== "slide") {
      return;
    }
    if (!this.plotHost.isConnected) {
      return;
    }
    if (!this.plotHost.classList.contains("js-plotly-plot")) {
      return;
    }
    // offset* returns 0 when hidden via a display:none ancestor (which getComputedStyle can miss).
    if (this.plotHost.offsetWidth < 2 || this.plotHost.offsetHeight < 2) {
      return;
    }
    const style = window.getComputedStyle(this.plotHost);
    if (style.display === "none" || style.visibility === "hidden") {
      return;
    }
    const plots = (Plotly as Partial<typeof Plotly> & { Plots?: { resize?: (gd: HTMLElement) => void } }).Plots;
    if (!plots || typeof plots.resize !== "function") {
      return;
    }
    try {
      const maybePromise = (plots.resize as unknown as (gd: HTMLElement) => unknown)(this.plotHost);
      if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
        (maybePromise as Promise<unknown>).catch(() => {
          // Best-effort; Plotly rejects when hidden/detached.
        });
      }
    } catch {
      // Best-effort; Plotly can throw when hidden/detached.
    }
  }

  private updateSummary(): void {
    const checkedCount = this.sectionsHost?.querySelector<HTMLElement>("#checkedCount");
    if (checkedCount) {
      checkedCount.textContent = `${this.selectedSections.size} selected`;
    }
    const summaryCount = this.exportHost?.querySelector<HTMLElement>("#summaryCount");
    const summarySlides = this.exportHost?.querySelector<HTMLElement>("#summarySlides");
    const summaryActive = this.exportHost?.querySelector<HTMLElement>("#summaryActive");
    if (summaryCount) {
      summaryCount.textContent = String(this.selectedSections.size);
    }
    if (summarySlides) {
      summarySlides.textContent = String(this.getVisualSlideIndices(this.deck).length || 0);
    }
    if (summaryActive) {
      const slide = this.deck[this.slideIndex] as any;
      const sec = String(slide?.section ?? "").trim();
      const label = sec ? this.sections.find((s) => s.id === sec)?.label ?? sec : "";
      summaryActive.textContent = label || "None";
    }
    const slideCount = this.mount.querySelector<HTMLElement>("#slideCount");
    if (slideCount) {
      const indices = this.getVisualSlideIndices(this.deck);
      const total = indices.length || 0;
      const pos = indices.indexOf(this.slideIndex);
      slideCount.textContent = `${total && pos >= 0 ? pos + 1 : total ? 1 : 0} / ${total}`;
    }
    if (!this.loadingDeck) {
      const n = this.getVisualSlideIndices(this.deck).length;
      this.setStatus(n ? `Figures: ${n}` : "No figures");
    }
  }

  private updateCancelButtonState(): void {
    const btn = this.exportHost?.querySelector<HTMLButtonElement>("#btnCancelPreview");
    if (!btn) return;
    const active = Boolean(this.previewBackgroundLoading || this.loadingDeck);
    btn.disabled = !active;
  }

  private setStatus(message: string): void {
    const primary = this.mount.querySelector<HTMLElement>("#status");
    if (primary) {
      primary.textContent = message;
    }
    const detail = this.exportHost?.querySelector<HTMLElement>("#statusDetail");
    if (detail) {
      detail.textContent = message;
    }
    this.updateCancelButtonState();
  }

  private logPlotDiag(): void {
    if (!this.plotHost) {
      console.warn("[visualise][diag] plot missing");
      return;
    }
    const rect = this.plotHost.getBoundingClientRect();
    console.info("[visualise][diag] plot_ready=true");
    console.info(`Diag rect w=${Math.round(rect.width)} h=${Math.round(rect.height)}`);
  }

  private goToSlide(direction: -1 | 1): void {
    const indices = this.getVisualSlideIndices(this.deck);
    if (!indices.length) {
      this.slideIndex = 0;
      this.applySlideChange();
      return;
    }
    let pos = indices.indexOf(this.slideIndex);
    if (pos < 0) {
      const snap = indices.find((i) => i >= this.slideIndex) ?? indices[0];
      pos = indices.indexOf(snap);
    }
    const nextPos = Math.max(0, Math.min(pos + direction, indices.length - 1));
    this.slideIndex = indices[nextPos];
    this.applySlideChange();
  }

  private renderTableView(): void {
    const host = this.mount.querySelector<HTMLElement>("#tableHost");
    if (!host) {
      return;
    }
    const slide = this.deck[this.slideIndex] as any;
    const tableHtml = this.findTableHtmlForSlide(slide);
    if (tableHtml) {
      host.innerHTML = tableHtml;
      return;
    }
    host.innerHTML = "<div>No table available.</div>";
  }

  private normalizeTitleForPairing(title: string): string {
    return String(title || "")
      .replace(/\s+/g, " ")
      .replace(/\s*[—–-]\s*(figure|fig|table|data)\b.*$/i, "")
      .replace(/\b(figure|fig|table|data)\b\s*[:：].*$/i, "")
      .trim()
      .toLowerCase();
  }

  private findTableHtmlForSlide(slide: Record<string, unknown> | undefined): string {
    if (!slide) {
      return "";
    }
    const direct = String((slide as any)?.table_html ?? "").trim();
    if (direct) {
      return direct;
    }

    const sectionId = String((slide as any)?.section ?? "").trim();
    const idxAll = this.deckAll.indexOf(slide);
    const readTable = (candidate: any): string => String(candidate?.table_html ?? "").trim();
    const sameSection = (candidate: any): boolean => String(candidate?.section ?? "").trim() === sectionId;

    // Prefer the "verso" table: neighbor slide in the original deck order.
    if (idxAll >= 0 && sectionId) {
      const next = this.deckAll[idxAll + 1] as any;
      if (next && sameSection(next)) {
        const html = readTable(next);
        if (html) return html;
      }
      const prev = this.deckAll[idxAll - 1] as any;
      if (prev && sameSection(prev)) {
        const html = readTable(prev);
        if (html) return html;
      }
    }

    const candidates = this.deckAll.filter((s) => {
      const cand: any = s;
      const html = readTable(cand);
      if (!html) return false;
      if (!sectionId) return true;
      return sameSection(cand);
    }) as any[];
    if (!candidates.length) {
      return "";
    }

    const base = this.normalizeTitleForPairing(String((slide as any)?.title ?? ""));
    if (base) {
      const exact = candidates.find((c) => this.normalizeTitleForPairing(String(c?.title ?? "")) === base);
      if (exact) {
        return readTable(exact);
      }
    }

    return readTable(candidates[0]);
  }

  private setTab(tab: "slide" | "table"): void {
    this.currentTab = tab;
    const slidePane = this.mount.querySelector<HTMLElement>("#paneSlide");
    const tablePane = this.mount.querySelector<HTMLElement>("#paneTable");
    const tabSlide = this.mount.querySelector<HTMLButtonElement>("#tabSlide");
    const tabTable = this.mount.querySelector<HTMLButtonElement>("#tabTable");
    if (tab === "slide") {
      slidePane?.classList.add("active");
      tablePane?.classList.remove("active");
      if (slidePane) slidePane.style.display = "flex";
      if (tablePane) tablePane.style.display = "none";
      tabSlide?.classList.add("active");
      tabTable?.classList.remove("active");
      this.installPlotResizeObserver();
      this.resizePlot();
      return;
    }
    slidePane?.classList.remove("active");
    tablePane?.classList.add("active");
    if (slidePane) slidePane.style.display = "none";
    if (tablePane) tablePane.style.display = "flex";
    tabSlide?.classList.remove("active");
    tabTable?.classList.add("active");
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.renderTableView();
  }

  private getVisualiserLogHost(): HTMLElement | null {
    return (
      this.exportHost?.querySelector<HTMLElement>("#visualiserLog") ??
      this.mount.querySelector<HTMLElement>("#visualiserLog") ??
      null
    );
  }

  private appendVisualiserLog(message: string, level: "info" | "warn" | "error" = "info"): void {
    const host = this.getVisualiserLogHost();
    if (!host) {
      return;
    }
    const placeholder = host.querySelector<HTMLElement>(".visualiser-log-placeholder");
    if (placeholder) {
      placeholder.remove();
    }
    const line = document.createElement("div");
    line.className =
      level === "error"
        ? "visualiser-log-line visualiser-log-line--error"
        : level === "warn"
          ? "visualiser-log-line visualiser-log-line--warn"
          : "visualiser-log-line";
    const stamp = new Date().toLocaleTimeString();
    const clean = String(message).replace(/\u001b\[[0-9;]*m/g, "");
    line.textContent = `[${stamp}] ${clean}`;
    host.prepend(line);
  }

  private appendIssueLog(message: string): void {
    this.appendVisualiserLog(message, "error");
  }

  private appendWarnLog(message: string): void {
    this.appendVisualiserLog(message, "warn");
  }

  private normalizeFigJson(value: unknown): unknown {
    if (typeof value !== "string") {
      return value;
    }
    const text = value.trim();
    if (!text) {
      return undefined;
    }
    if (!(text.startsWith("{") || text.startsWith("["))) {
      return value;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      this.appendIssueLog(
        `Invalid fig_json (not JSON): ${error instanceof Error ? error.message : String(error)}`
      );
      return value;
    }
  }

  private normalizeDeck(deck: Array<Record<string, unknown>>, source: string): Array<Record<string, unknown>> {
    if (!Array.isArray(deck) || !deck.length) {
      return [];
    }
    let changed = false;
    const out = deck.map((slide, idx) => {
      if (!slide || typeof slide !== "object") {
        return slide;
      }
      const figJson = (slide as any).fig_json as unknown;
      if (typeof figJson === "string") {
        const parsed = this.normalizeFigJson(figJson);
        if (parsed !== figJson) {
          changed = true;
          return { ...slide, fig_json: parsed } as Record<string, unknown>;
        }
        if ((figJson.trim().startsWith("{") || figJson.trim().startsWith("[")) && typeof parsed === "string") {
          this.appendIssueLog(`Slide ${idx + 1} fig_json looks like JSON but could not be parsed (${source}).`);
        }
      }
      return slide;
    });
    if (changed) {
      this.appendVisualiserLog(`Normalized cached fig_json payloads (${source}).`, "info");
    }
    return out;
  }

  private logDeckHealth(deck: Array<Record<string, unknown>>, source: string): void {
    if (!deck.length) {
      this.appendIssueLog(`No slides returned (${source}).`);
      return;
    }
    const withFig = deck.filter((s) => Boolean((s as any)?.fig_json)).length;
    const withImg = deck.filter((s) => Boolean((s as any)?.img || (s as any)?.thumb_img)).length;
    const withTable = deck.filter((s) => Boolean((s as any)?.table_html)).length;
    if (withFig === 0 && withImg === 0) {
      const keys = Object.keys(deck[0] || {}).slice(0, 20).join(", ");
      this.appendWarnLog(
        `Slides contain no figures/images (${source}). firstSlideKeys=[${keys || "none"}] tables=${withTable}/${deck.length}`
      );
    }
  }

  private isDeckRenderable(deck: Array<Record<string, unknown>>): boolean {
    return deck.some((slide) => {
      const s: any = slide;
      if (!s) return false;
      if (s.fig_json) return true;
      if (typeof s.table_html === "string" && s.table_html.trim()) return true;
      if (typeof s.img === "string" && s.img.trim()) return true;
      if (typeof s.thumb_img === "string" && s.thumb_img.trim()) return true;
      if (Array.isArray(s.bullets) && s.bullets.length) return true;
      return false;
    });
  }

  private deckHasVisuals(deck: Array<Record<string, unknown>>): boolean {
    return deck.some((slide) => {
      const s: any = slide;
      if (!s) return false;
      if (s.fig_json) return true;
      if (typeof s.table_html === "string" && s.table_html.trim()) return true;
      if (typeof s.img === "string" && s.img.trim()) return true;
      if (typeof s.thumb_img === "string" && s.thumb_img.trim()) return true;
      return false;
    });
  }

  private deleteDeckCache(key: string): void {
    try {
      const storageKeys = [
        `visualiser.deck.cache:${VisualiserPage.DECK_CACHE_VERSION}`,
        // Back-compat cleanup for pre-versioned caches.
        "visualiser.deck.cache"
      ];
      storageKeys.forEach((storageKey) => {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object") return;
        if (!(key in parsed)) return;
        delete (parsed as any)[key];
        window.localStorage.setItem(storageKey, JSON.stringify(parsed));
      });
    } catch {
      // ignore cache errors
    }
  }

  private shouldLogIssueLine(line: string): boolean {
    const normalized = line.toLowerCase();
    return (
      normalized.includes("error") ||
      normalized.includes("fatal") ||
      normalized.includes("exception") ||
      normalized.includes("traceback") ||
      normalized.includes("failed") ||
      normalized.includes("missing")
    );
  }

  private resetLogPlaceholder(): void {
    const host = this.getVisualiserLogHost();
    if (!host) {
      return;
    }
    host.innerHTML = `<div class="visualiser-log-placeholder">No visualiser logs yet.</div>`;
  }

  private copyVisualiserLog(): boolean {
    const host = this.getVisualiserLogHost();
    const text = host ? host.innerText.trim() : "";
    if (text && navigator && "clipboard" in navigator && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(text);
      return true;
    }
    return false;
  }

  private handleRunInputs = (): void => {
    this.persistParamsToStorage(this.readParams());
    void this.runVisualiser();
  };

  private handleBuild = (): void => {
    void this.exportPptx();
  };

  private handleRefreshClick = (): void => {
    this.setStatus("Refresh preview requested (build deck).");
    this.persistParamsToStorage(this.readParams());
    void this.runVisualiser(true);
  };

  private handleCancelPreviewClick = (): void => {
    // Stop any in-flight background section loading, and reset the python worker to abort long-running tasks.
    this.previewRunToken += 1;
    this.previewBackgroundLoading = false;
    this.loadingDeck = false;
    this.updateCancelButtonState();
    void this.sendVisualiserCommand("cancel_preview");
    this.setStatus("Preview loading canceled.");
    this.renderThumbs();
    this.renderSlide();
    this.updateSummary();
  };

  private getCollectionNameForExport(): string {
    const state = (window as unknown as { __retrieveDataHubState?: RetrieveDataHubState }).__retrieveDataHubState;
    const fromState = typeof state?.collectionName === "string" ? state.collectionName.trim() : "";
    if (fromState) {
      return fromState;
    }
    const filePath = typeof state?.filePath === "string" ? state.filePath : "";
    if (filePath) {
      const parts = filePath.split(/[/\\\\]+/g).filter(Boolean);
      const last = parts[parts.length - 1] || "";
      const base = last.replace(/\.[^/.]+$/, "");
      return base.trim() || "Collection";
    }
    return "Collection";
  }

  private async exportPptx(): Promise<void> {
    if (!this.currentTable) {
      this.setStatus("Load data in Retrieve first.");
      return;
    }
    if (!this.deckAll.length) {
      // Build needs a deck; also lets us capture images client-side so Python doesn't need kaleido/Chrome.
      this.appendWarnLog("No preview deck loaded; running Visualiser to prepare export.");
      await this.runVisualiser(false);
    }
    const selectedSlideIds = Array.from(this.selectedSlideKeys).filter(Boolean);
    const hasExplicitSlideSelection = selectedSlideIds.length > 0;
    const include = hasExplicitSlideSelection
      ? this.getIncludeIdsForSlideIds(selectedSlideIds)
      : this.getBuildIncludeIds();
    if (!include.length) {
      this.setStatus(hasExplicitSlideSelection ? "Select at least one slide." : "Select at least one section.");
      return;
    }
    // Ensure selected sections are present in the preview deck so we can render PNGs for export reliably.
    if (!hasExplicitSlideSelection) {
      const missing = include.filter((sec) => !this.sectionDecks.has(sec));
      if (missing.length) {
        this.appendWarnLog(`Preparing ${missing.length} section(s) for export…`);
        await this.runVisualiserLazyPreview({ include, previousSlideKey: "", previousSectionId: "" });
      }
    }
    const params = this.readParams();
    const collectionName = this.getCollectionNameForExport();
    const selection = {
      sections: hasExplicitSlideSelection ? [] : Array.from(this.selectedSections),
      slideIds: selectedSlideIds
    };
    const notesOverrides: Record<string, string> = {};
    this.slideDescriptions.forEach((value, key) => {
      const v = String(value || "").trim();
      if (key && v) {
        notesOverrides[key] = v;
      }
    });

    const renderedImages: Record<string, string> = {};
    try {
      const wantIds = hasExplicitSlideSelection ? new Set(selectedSlideIds) : null;
      const wantSections = new Set(include);
      const candidates = this.deckAll.filter((slide) => {
        if (!this.isVisualSlide(slide)) return false;
        const key = this.buildSlideKey(slide);
        if (!key) return false;
        if (wantIds) return wantIds.has(key);
        const sec = String((slide as any)?.section ?? "").trim();
        return sec ? wantSections.has(sec) : false;
      });

      if (candidates.length) {
        this.appendVisualiserLog(`Rendering ${candidates.length} figure image(s) for PPT…`, "info");
        this.setStatus(`Rendering ${candidates.length} figure image(s)…`);
        for (let i = 0; i < candidates.length; i += 1) {
          const slide = candidates[i] as any;
          const key = this.buildSlideKey(slide);
          if (!key || renderedImages[key]) continue;
          const figJson = this.normalizeFigJson(slide.fig_json);
          if (!figJson) continue;
          try {
            // Best-effort: some plot types (geo/topojson) can fail offline; still export what we can.
            const url = await this.capturePptFigurePngDataUrl(figJson, String(slide.title || "Figure"));
            if (url && typeof url === "string" && url.startsWith("data:image/")) {
              renderedImages[key] = url;
            }
          } catch (error) {
            this.appendWarnLog(
              `PPT image render failed (${String(slide.title || "").slice(0, 80) || key}): ${
                error instanceof Error ? error.message : String(error)
              }`
            );
          }
          await this.yieldToUi();
        }
        this.appendVisualiserLog(
          `Prepared ${Object.keys(renderedImages).length}/${candidates.length} figure image(s) for export.`,
          "info"
        );
      }
    } catch (error) {
      this.appendWarnLog(`PPT image preparation skipped: ${error instanceof Error ? error.message : String(error)}`);
    }

    this.appendVisualiserLog("Build PPT requested.", "info");
    this.setStatus("Building PPTX…");

    const response = await this.sendVisualiserCommand("export_pptx", {
      include,
      params,
      selection,
      notesOverrides,
      renderedImages,
      collectionName
    });

    if (!response) {
      this.setStatus("PPT export failed.");
      this.appendIssueLog("No response from export_pptx.");
      return;
    }
    if (response.status === "canceled") {
      this.setStatus("Export canceled.");
      this.appendVisualiserLog(String((response as any).message || "Export canceled."), "warn");
      return;
    }
    const pythonLogs = (response as any).pythonLogs;
    if (Array.isArray(pythonLogs)) {
      pythonLogs.forEach((line) => {
        if (typeof line === "string" && line.trim()) {
          const l = line.toLowerCase();
          const level =
            l.includes("traceback") || l.includes("exception") || l.includes("error")
              ? "error"
              : l.includes("warn")
                ? "warn"
                : "info";
          this.appendVisualiserLog(line, level);
        }
      });
    }
    const logs = (response as any).logs;
    if (Array.isArray(logs)) {
      logs.forEach((line) => {
        if (typeof line === "string" && line.trim()) {
          const l = line.toLowerCase();
          const level =
            l.includes("[error]") || l.includes("traceback") || l.includes("exception")
              ? "error"
              : l.includes("[warn]") || l.includes("warn")
                ? "warn"
                : "info";
          this.appendVisualiserLog(line, level);
        }
      });
    }
    if (response.status !== "ok") {
      this.setStatus("PPT export failed.");
      this.appendIssueLog(String((response as any).message || "PPT export failed."));
      return;
    }
    const outPath = String((response as any).path || "").trim();
    this.setStatus(outPath ? `Saved PPTX: ${outPath}` : "PPT export done.");
    if (outPath) {
      this.appendVisualiserLog(`Saved: ${outPath}`, "info");
    }
  }

  private getIncludeIdsForSlideIds(slideIds: string[]): string[] {
    const want = new Set(slideIds.map((s) => String(s || "").trim()).filter(Boolean));
    const set = new Set<string>();
    this.deckAll.forEach((slide) => {
      const key = this.buildSlideKey(slide);
      if (!key || !want.has(key)) {
        return;
      }
      const sec = String((slide as any)?.section ?? "").trim();
      if (sec) {
        set.add(sec);
      }
    });
    // Fallback: slide_id is typically "{section}:{n}:{kind}".
    want.forEach((id) => {
      const sec = id.split(":")[0]?.trim();
      if (sec) set.add(sec);
    });
    if (!set.size) {
      return [];
    }
    const ordered = this.sections.map((s) => String((s as any)?.id ?? "").trim()).filter(Boolean);
    const out: string[] = [];
    ordered.forEach((id) => {
      if (set.has(id)) out.push(id);
    });
    // Append any unknown sections (should be rare).
    Array.from(set).forEach((id) => {
      if (!out.includes(id)) out.push(id);
    });
    return out;
  }

  private async capturePptFigurePngDataUrl(figJson: any, title: string): Promise<string> {
    const palette = this.getThemePalette();
    const W = 1600;
    const H = 900;
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = `${W}px`;
    container.style.height = `${H}px`;
    container.style.pointerEvents = "none";
    container.style.opacity = "0";
    document.body.appendChild(container);

    try {
      await this.yieldToUi();
      const rawData = Array.isArray(figJson?.data) ? figJson.data : Array.isArray(figJson) ? figJson : [];
      const data = this.applyCategoricalPaletteToData(rawData);
      const layout = figJson.layout || {};
      const m = layout.margin || {};
      const toNum = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
      const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
      const safeMargin = {
        l: clamp(toNum(m.l, 80), 56, Math.round(W * 0.38)),
        r: clamp(toNum(m.r, 60), 56, Math.round(W * 0.34)),
        t: clamp(toNum(m.t, 80), 44, Math.round(H * 0.28)),
        b: clamp(toNum(m.b, 80), 56, Math.round(H * 0.34)),
        pad: Math.max(0, toNum(m.pad, 4)),
        autoexpand: true
      };
      const finalLayout = {
        ...layout,
        paper_bgcolor: palette.panel,
        plot_bgcolor: palette.panel,
        font: { ...(layout.font || {}), color: palette.text },
        margin: safeMargin,
        width: W,
        height: H,
        autosize: false
      };
      const themedLayout = this.applyThemeToLayoutArt(finalLayout, palette);
      await Plotly.newPlot(container, data, themedLayout, {
        displayModeBar: false,
        staticPlot: true,
        responsive: false
      });
      const url = (await (Plotly as any).toImage(container, {
        format: "png",
        width: W,
        height: H,
        scale: 2
      })) as string;
      if (typeof url === "string" && url.startsWith("blob:")) {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          const dataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.readAsDataURL(blob);
          });
          return dataUrl || url;
        } finally {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // ignore
          }
        }
      }
      return url;
    } catch (error) {
      const base = error instanceof Error ? error.message : String(error);
      throw new Error(`toImage failed (${String(title || "figure").slice(0, 60)}): ${base}`);
    } finally {
      try {
        Plotly.purge(container);
      } catch {
        // ignore
      }
      container.remove();
    }
  }

  private async runVisualiser(isBuild = false): Promise<void> {
    const previousSlide = !isBuild ? (this.deck[this.slideIndex] as any) : null;
    const previousSlideKey = !isBuild && previousSlide ? this.buildSlideKey(previousSlide) : "";
    const previousSectionId = !isBuild ? String(previousSlide?.section ?? "").trim() : "";

    if (!this.currentTable) {
      this.setStatus("Load data in Retrieve first.");
      return;
    }
    const include = isBuild ? this.getBuildIncludeIds() : this.getPreviewIncludeIds();
    if (isBuild && !include.length) {
      this.setStatus("Select at least one section.");
      return;
    }
    if (!isBuild && !include.length) {
      this.deckAll = [];
      this.deck = [];
      this.renderThumbs();
      this.renderSlide();
      this.updateSummary();
      this.setStatus("Select at least one section.");
      return;
    }
    if (!isBuild) {
      await this.runVisualiserLazyPreview({ include, previousSlideKey, previousSectionId });
      return;
    }
    this.loadingDeck = true;
    this.setStatus(isBuild ? "Building deck..." : "Loading visuals…");
    this.renderThumbs();
    this.renderSlide();
    const params = this.readParams();
    const includeForCache = isBuild ? include : this.getPreviewIncludeKey();
    const cacheKey = this.buildCacheKey(this.currentTable, includeForCache, params);
    const cached = isBuild ? null : this.readDeckCache(cacheKey);
    if (!isBuild && cached && cached.length) {
      this.deckAll = this.normalizeDeck(cached, "cache");
      this.deck = this.applyPreviewFilter(this.deckAll);
      this.deckVersion += 1;
      this.resetThumbPipeline();
      this.logDeckHealth(this.deckAll, "cache");
      if (!this.isDeckRenderable(this.deckAll) || !this.deckHasVisuals(this.deckAll) || this.isCachedDeckIncomplete(this.deckAll)) {
        this.appendWarnLog("Cached deck has no figures/tables/images; rerunning preview.");
        this.deleteDeckCache(cacheKey);
      } else {
        this.appendVisualiserLog("Loaded cached slide deck.", "info");
        this.applyPendingFocus();
        this.slideIndex = Math.max(0, Math.min(this.slideIndex, Math.max(0, this.deck.length - 1)));
        this.renderSectionsList();
        this.renderThumbs();
        this.renderSlide();
        this.updateSummary();
        this.loadingDeck = false;
        this.setStatus("Visualiser ready (cache)");
        return;
      }
      this.slideIndex = Math.max(0, Math.min(this.slideIndex, Math.max(0, this.deck.length - 1)));
      this.renderThumbs();
      this.renderSlide();
      this.updateSummary();
    }
    const requestPayload: Record<string, unknown> = {
      table: this.currentTable,
      include,
      params
    };
    if (isBuild) {
      requestPayload.selection = {
        sections: Array.from(this.selectedSections),
        slideIds: Array.from(this.selectedSlideKeys)
      };
    }
    const response = await this.sendVisualiserCommand(isBuild ? "build_deck" : "run_inputs", requestPayload);
    this.loadingDeck = false;
    if (!response || response.status !== "ok") {
      this.setStatus("Visualiser failed.");
      this.appendIssueLog("Visualiser failed to return results.");
      const pythonLogs = (response as any)?.pythonLogs;
      if (Array.isArray(pythonLogs)) {
        pythonLogs.forEach((line) => {
          if (typeof line === "string" && line.trim()) {
            const l = line.toLowerCase();
            const level =
              l.includes("traceback") || l.includes("exception") || l.includes("error")
                ? "error"
                : l.includes("warn")
                  ? "warn"
                  : "info";
            this.appendVisualiserLog(line, level);
          }
        });
      }
      if (response && (response as any).message) {
        const text = String((response as any).message);
        if (this.shouldLogIssueLine(text)) {
          this.appendIssueLog(text);
        }
      }
      this.renderThumbs();
      this.clearPlotPlaceholder();
      this.updateSummary();
      return;
    }
    const pythonLogs = (response as any).pythonLogs;
    if (Array.isArray(pythonLogs)) {
      pythonLogs.forEach((line) => {
        if (typeof line === "string" && line.trim()) {
          const l = line.toLowerCase();
          const level =
            l.includes("traceback") || l.includes("exception") || l.includes("error")
              ? "error"
              : l.includes("warn")
                ? "warn"
                : "info";
          this.appendVisualiserLog(line, level);
        }
      });
    }
    const logs = (response as any).logs;
    if (Array.isArray(logs)) {
      logs.forEach((line) => {
        if (typeof line === "string" && line.trim()) {
          const l = line.toLowerCase();
          const level =
            l.includes("[error]") || l.includes("traceback") || l.includes("exception")
              ? "error"
              : l.includes("[warn]") || l.includes("warn")
                ? "warn"
                : "info";
          this.appendVisualiserLog(line, level);
        }
      });
    }
    const deck = (response as any).deck?.slides || [];
    const nextDeckAll = this.normalizeDeck(Array.isArray(deck) ? deck : [], isBuild ? "build" : "run");
    this.deckAll = isBuild ? this.applyBuildSlideFilter(nextDeckAll) : nextDeckAll;
    this.deck = this.applyPreviewFilter(this.deckAll);
    this.applyPendingFocus();
    this.deckVersion += 1;
    this.resetThumbPipeline();
    this.logDeckHealth(this.deckAll, isBuild ? "build" : "run");
    if (!this.isDeckRenderable(this.deckAll)) {
      this.appendWarnLog("Python returned a deck with no renderable content (no figs/tables/images).");
    }
    this.writeLastDeckCache(this.deckAll);
    if (this.deckHasVisuals(this.deckAll)) {
      this.writeDeckCache(cacheKey, this.deckAll);
    } else {
      this.deleteDeckCache(cacheKey);
    }
    if (!isBuild) {
      const resolved = this.resolveSlideIndexAfterRun({
        previousSlideKey,
        previousSectionId
      });
      this.slideIndex = Math.max(0, Math.min(resolved, Math.max(0, this.deck.length - 1)));
    } else {
      this.slideIndex = 0;
    }
    this.snapToFirstVisualSlide();
    this.renderSectionsList();
    this.renderThumbs();
    this.renderSlide();
    this.updateSummary();
    this.setStatus("Visualiser ready");
  }

  private async runVisualiserLazyPreview(args: {
    include: string[];
    previousSlideKey: string;
    previousSectionId: string;
  }): Promise<void> {
    if (!this.currentTable) {
      this.setStatus("Load data in Retrieve first.");
      return;
    }
    const token = (this.previewRunToken += 1);
    const include = args.include.slice();
    const params = this.readParams();
    const ordered = this.sections.length ? this.sections.map((s) => s.id).filter((id) => include.includes(id)) : include;

    this.previewBackgroundLoading = false;
    this.sectionDecks.clear();
    this.updateCancelButtonState();

    const tryRestoreFromCache = (sectionId: string): boolean => {
      const cacheKey = this.buildCacheKey(this.currentTable!, [sectionId], params);
      const cached = this.readDeckCache(cacheKey);
      if (cached && cached.length) {
        this.sectionDecks.set(sectionId, this.normalizeDeck(cached, "cache"));
        return true;
      }
      return false;
    };

    // Warm-load from per-section cache to show something instantly.
    ordered.forEach((sec) => {
      tryRestoreFromCache(sec);
    });
    this.rebuildDeckFromSections();

    // If we already have visuals, render immediately without blocking on python.
    if (this.deckAll.length) {
      const resolved = this.resolveSlideIndexAfterRun({
        previousSlideKey: args.previousSlideKey,
        previousSectionId: args.previousSectionId
      });
      this.slideIndex = Math.max(0, Math.min(resolved, Math.max(0, this.deck.length - 1)));
      this.snapToFirstVisualSlide();
      this.renderSectionsList();
      this.renderThumbs();
      this.renderSlide();
      this.updateSummary();
      this.setStatus("Visualiser ready (cache)");
    } else {
      this.loadingDeck = true;
      this.setStatus("Loading visuals…");
      this.renderThumbs();
      this.renderSlide();
    }

    // Fetch missing sections sequentially (cheap with the persistent python worker).
    const missing = ordered.filter((sec) => !this.sectionDecks.has(sec));
    if (!missing.length) {
      this.loadingDeck = false;
      this.setStatus("Visualiser ready");
      this.previewBackgroundLoading = false;
      this.updateCancelButtonState();
      return;
    }
    this.previewBackgroundLoading = true;
    this.updateCancelButtonState();
    for (let i = 0; i < missing.length; i += 1) {
      if (token !== this.previewRunToken) {
        return;
      }
      const sec = missing[i];
      this.setStatus(`Loading ${sec} (${i + 1}/${missing.length})…`);
      let response: any;
      try {
        response = await this.sendVisualiserCommand("run_inputs", {
          // Omit table for performance; python loads the last cached DF from disk.
          include: [sec],
          params,
          mode: "run_inputs",
          collectionName: this.getCollectionNameForExport()
        });
      } catch (error) {
        if (token !== this.previewRunToken) {
          return;
        }
        this.appendWarnLog(`Section failed: ${sec} (${error instanceof Error ? error.message : String(error)})`);
        continue;
      }
      if (token !== this.previewRunToken) {
        return;
      }
      if (!response || response.status !== "ok") {
        this.appendWarnLog(`Section failed: ${sec}`);
        const pythonLogs = (response as any)?.pythonLogs;
        if (Array.isArray(pythonLogs)) {
          pythonLogs.forEach((line) => {
            if (typeof line === "string" && line.trim()) this.appendVisualiserLog(line, "warn");
          });
        }
        continue;
      }
      const pythonLogs = (response as any).pythonLogs;
      if (Array.isArray(pythonLogs)) {
        pythonLogs.forEach((line) => {
          if (typeof line === "string" && line.trim()) {
            const l = line.toLowerCase();
            const level = l.includes("traceback") || l.includes("exception") || l.includes("error") ? "error" : l.includes("warn") ? "warn" : "info";
            this.appendVisualiserLog(line, level);
          }
        });
      }
      const logs = (response as any).logs;
      if (Array.isArray(logs)) {
        logs.forEach((line) => {
          if (typeof line === "string" && line.trim()) this.appendVisualiserLog(line, "info");
        });
      }
      const deck = (response as any).deck?.slides || [];
      const slides = this.normalizeDeck(Array.isArray(deck) ? deck : [], "run");
      this.sectionDecks.set(sec, slides);
      // Persist per-section deck cache.
      try {
        const cacheKey = this.buildCacheKey(this.currentTable!, [sec], params);
        this.writeDeckCache(cacheKey, slides);
      } catch {
        // ignore
      }

      const previousKey = args.previousSlideKey;
      const previousSec = args.previousSectionId;
      const hadFocus = Boolean(previousKey || previousSec);
      this.rebuildDeckFromSections();
      if (hadFocus) {
        const resolved = this.resolveSlideIndexAfterRun({
          previousSlideKey: previousKey,
          previousSectionId: previousSec
        });
        this.slideIndex = Math.max(0, Math.min(resolved, Math.max(0, this.deck.length - 1)));
        this.snapToFirstVisualSlide();
      }
      this.deckVersion += 1;
      this.resetThumbPipeline();
      this.renderSectionsList();
      this.renderThumbs();
      this.renderSlide();
      this.updateSummary();
      this.loadingDeck = false;
      await this.yieldToUi();
    }
    if (token === this.previewRunToken) {
      this.previewBackgroundLoading = false;
      this.loadingDeck = false;
      this.updateCancelButtonState();
      this.setStatus("Visualiser ready");
    }
  }

  private rebuildDeckFromSections(): void {
    const ordered = this.sections.length ? this.sections.map((s) => s.id) : [];
    const out: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    const pushSlides = (slides: Array<Record<string, unknown>>) => {
      slides.forEach((s) => {
        const key = this.buildSlideKey(s);
        if (key && seen.has(key)) return;
        if (key) seen.add(key);
        out.push(s);
      });
    };
    if (ordered.length) {
      ordered.forEach((sec) => {
        const slides = this.sectionDecks.get(sec);
        if (slides && slides.length) pushSlides(slides);
      });
      // Append any decks for unknown sections.
      this.sectionDecks.forEach((slides, sec) => {
        if (!ordered.includes(sec) && slides.length) pushSlides(slides);
      });
    } else {
      this.sectionDecks.forEach((slides) => pushSlides(slides));
    }
    this.deckAll = out;
    this.deck = this.applyPreviewFilter(this.deckAll);
  }

  private resolveSlideIndexAfterRun(args: { previousSlideKey: string; previousSectionId: string }): number {
    const prevKey = String(args.previousSlideKey || "").trim();
    if (prevKey) {
      const idx = this.deck.findIndex((s) => this.buildSlideKey(s) === prevKey);
      if (idx >= 0) {
        return idx;
      }
    }
    const prevSec = String(args.previousSectionId || "").trim();
    if (prevSec) {
      const idx = this.deck.findIndex((s) => String((s as any)?.section ?? "").trim() === prevSec && this.isVisualSlide(s));
      if (idx >= 0) {
        return idx;
      }
      const anyIdx = this.deck.findIndex((s) => String((s as any)?.section ?? "").trim() === prevSec);
      if (anyIdx >= 0) {
        return anyIdx;
      }
    }
    return 0;
  }

  private orderedInclude(): string[] {
    if (!this.sections.length) {
      return Array.from(this.selectedSections);
    }
    return this.sections.map((s) => s.id).filter((id) => this.selectedSections.has(id));
  }

  private getBuildIncludeIds(): string[] {
    const ids = new Set<string>();
    this.orderedInclude().forEach((id) => ids.add(id));
    this.deckAll.forEach((slide) => {
      const key = this.buildSlideKey(slide);
      if (!key || !this.selectedSlideKeys.has(key)) {
        return;
      }
      const sec = String((slide as any)?.section ?? "").trim();
      if (sec) ids.add(sec);
    });
    return Array.from(ids);
  }

  private buildSlideKey(slide: Record<string, unknown> | undefined): string {
    if (!slide) return "";
    const explicitId = String((slide as any)?.slide_id ?? "").trim();
    if (explicitId) {
      return explicitId;
    }
    const sec = String((slide as any)?.section ?? "").trim();
    const rawTitle = String((slide as any)?.title ?? "");
    const title = this.normalizeTitleForPairing(rawTitle);
    const kind = (slide as any)?.fig_json
      ? "fig"
      : String((slide as any)?.table_html ?? "").trim()
        ? "table"
        : String((slide as any)?.img ?? "").trim()
          ? "img"
          : "other";
    const disambiguator = this.hashString(rawTitle).slice(0, 8);
    return `${sec}::${kind}::${title}::${disambiguator}`;
  }

  private applyBuildSlideFilter(deck: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    if (!deck.length) return [];
    if (!this.selectedSlideKeys.size) {
      return deck;
    }
    return deck.filter((slide) => {
      const sec = String((slide as any)?.section ?? "").trim();
      if (sec && this.selectedSections.has(sec)) {
        return true;
      }
      const key = this.buildSlideKey(slide);
      return key ? this.selectedSlideKeys.has(key) : false;
    });
  }

  private clearPlotPlaceholder(): void {
    this.plotHost = this.mount.querySelector<HTMLElement>("#plot");
    if (!this.plotHost) return;
    this.plotHost.innerHTML = `<div style="padding:12px;color:var(--muted);">Run Visualiser to generate plots.</div>`;
  }

  private renderSlide(): void {
    if (!this.plotHost) return;
    if (this.loadingDeck) {
      this.plotHost.innerHTML = `<div class="visualiser-loading"><div class="spinner"></div><div>Loading visuals…</div></div>`;
      return;
    }
    const slide = this.deck[this.slideIndex] as any;
    if (!slide) {
      this.setStatus("No slide to render.");
      return;
    }
    const figJson = this.normalizeFigJson(slide.fig_json);
    const title = slide.title;
    const img = String(slide.img ?? "").trim();
    if (figJson && this.plotHost) {
      const rect = this.plotHost.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        this.appendIssueLog(
          `Plot container has near-zero size (${Math.round(rect.width)}x${Math.round(rect.height)}). Try reopening the tab/panel.`
        );
      }
      const rawData = Array.isArray((figJson as any).data)
        ? (figJson as any).data
        : Array.isArray(figJson)
          ? figJson
          : [];
      const data = this.applyCategoricalPaletteToData(rawData);
      const rawLayout = (figJson as any).layout || {};
      // Avoid locking Plotly to a stale width/height from upstream JSON; let it size to the container.
      const { width: _w, height: _h, ...baseLayout } =
        rawLayout && typeof rawLayout === "object" ? (rawLayout as Record<string, unknown>) : ({} as Record<string, unknown>);
      const safeMargin = (() => {
        const m = (baseLayout as any).margin || {};
        const toNum = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
        const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
        const w = Math.max(640, Math.round(rect.width || 0));
        const h = Math.max(420, Math.round(rect.height || 0));
        const maxL = Math.max(140, Math.round(w * 0.38));
        const maxR = Math.max(140, Math.round(w * 0.34));
        const maxT = Math.max(120, Math.round(h * 0.28));
        const maxB = Math.max(140, Math.round(h * 0.34));
        return {
          l: clamp(toNum(m.l, 52), 36, maxL),
          r: clamp(toNum(m.r, 64), 44, maxR),
          t: clamp(toNum(m.t, 36), 26, maxT),
          b: clamp(toNum(m.b, 56), 36, maxB),
          pad: Math.max(0, toNum(m.pad, 4)),
          autoexpand: true
        };
      })();
      const palette = this.getThemePalette();
      const colorway = this.getPlotlyColorway();
      const hexToRgba = (hex: string, alpha: number): string => {
        const h = String(hex || "").trim().replace(/^#/, "");
        const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
        if (full.length !== 6) return `rgba(148,163,184,${alpha})`;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
      };
      const layout: any = {
        ...baseLayout,
        autosize: true,
        paper_bgcolor: palette.panel,
        plot_bgcolor: palette.panel,
        margin: safeMargin,
        font: { ...(baseLayout as any).font, color: (baseLayout as any)?.font?.color ?? palette.text },
        colorway: Array.isArray((baseLayout as any).colorway) && (baseLayout as any).colorway.length ? (baseLayout as any).colorway : colorway,
        hoverlabel: {
          ...((baseLayout as any).hoverlabel || {}),
          bgcolor: ((baseLayout as any).hoverlabel || {}).bgcolor ?? palette.panel,
          bordercolor: ((baseLayout as any).hoverlabel || {}).bordercolor ?? hexToRgba(palette.muted, 0.35),
          font: { ...(((baseLayout as any).hoverlabel || {}).font || {}), color: (((baseLayout as any).hoverlabel || {}).font || {}).color ?? palette.text }
        }
      };
      if ((layout as any).title && typeof (layout as any).title === "object") {
        (layout as any).title = {
          ...(layout as any).title,
          font: { ...((layout as any).title.font || {}), color: (layout as any).title.font?.color ?? palette.text }
        };
      }
      if ((layout as any).legend && typeof (layout as any).legend === "object") {
        (layout as any).legend = {
          ...(layout as any).legend,
          font: { ...((layout as any).legend.font || {}), color: (layout as any).legend.font?.color ?? palette.text }
        };
      }
      Object.keys(layout).forEach((key) => {
        if (!key.startsWith("xaxis") && !key.startsWith("yaxis")) return;
        const ax = (layout as any)[key];
        if (!ax || typeof ax !== "object") return;
        (layout as any)[key] = {
          ...ax,
          color: ax.color ?? palette.text,
          gridcolor: ax.gridcolor ?? hexToRgba(palette.muted, 0.18),
          zerolinecolor: ax.zerolinecolor ?? hexToRgba(palette.muted, 0.25),
          tickfont: { ...(ax.tickfont || {}), color: ax.tickfont?.color ?? palette.text },
          titlefont: { ...(ax.titlefont || {}), color: ax.titlefont?.color ?? palette.text }
        };
      });
      // Reduce clipping issues by letting axes auto-margin when labels are wide.
      if (layout.xaxis && typeof layout.xaxis === "object") {
        (layout as any).xaxis = { ...(layout as any).xaxis, automargin: true };
      }
      if (layout.yaxis && typeof layout.yaxis === "object") {
        (layout as any).yaxis = { ...(layout as any).yaxis, automargin: true };
      }

      // Keep plots fully interactive (modebar, zoom/pan, selection, exports).
      const config = {
        responsive: true,
        displayModeBar: true,
        scrollZoom: true,
        displaylogo: false,
        doubleClick: "reset+autosize",
        showAxisDragHandles: true,
        showAxisRangeEntryBoxes: true,
        modeBarButtonsToAdd: ["drawline", "drawopenpath", "drawclosedpath", "drawcircle", "drawrect", "eraseshape"],
        toImageButtonOptions: {
          format: "png",
          filename: String(title || "visual").replace(/[^\w.-]+/g, "_").slice(0, 80) || "visual",
          width: Math.max(640, Math.round(rect.width || 0)),
          height: Math.max(420, Math.round(rect.height || 0)),
          scale: 2
        }
      };
      const uirevision = String((slide as any)?.slide_id ?? this.buildSlideKey(slide) ?? this.slideIndex);
      const themedLayout = this.applyThemeToLayoutArt(layout, palette);
      const finalLayout = { ...themedLayout, dragmode: (themedLayout as any).dragmode ?? "pan", uirevision };
      const hasPlot = this.plotHost.classList.contains("js-plotly-plot");
      const plotlyAny = Plotly as any;
      const plotFn = hasPlot && typeof plotlyAny.react === "function" ? plotlyAny.react : plotlyAny.newPlot;
      void plotFn(this.plotHost, data, finalLayout, config)
        .then(() => {
          this.setStatus(title || "Rendered");
          this.installPlotResizeObserver();
          this.resizePlot();
        })
        .catch((error: unknown) => {
          this.setStatus("Plot render failed.");
          this.appendIssueLog(
            `Plotly render failed: ${error instanceof Error ? error.message : String(error)}`
          );
        });
    } else {
      if (this.plotHost.classList.contains("js-plotly-plot")) {
        try {
          Plotly.purge(this.plotHost);
        } catch {
          // ignore
        }
      }
      if (img) {
        const safe = img.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
        this.plotHost.innerHTML = `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--panel);"><img src="${safe}" alt="figure" style="max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;"/></div>`;
      } else {
      const bullets = Array.isArray((slide as any)?.bullets) ? ((slide as any).bullets as unknown[]) : [];
      if (bullets.length) {
        const items = bullets
          .map((b) => String(b ?? "").trim())
          .filter(Boolean)
          .slice(0, 30)
          .map((b) => `<li>${b.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</li>`)
          .join("");
        const heading = title ? `<div style="font-weight:700;margin-bottom:8px;">${String(title)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")}</div>` : "";
        this.plotHost.innerHTML = `<div style="padding:12px;color:var(--text);">${heading}<ul style="margin:0 0 0 16px;padding:0;color:var(--muted);line-height:1.35;">${items}</ul></div>`;
      } else {
        const hasTable = Boolean(this.findTableHtmlForSlide(slide));
        this.plotHost.innerHTML = hasTable
          ? `<div style="padding:12px;color:var(--muted);display:flex;flex-direction:column;gap:10px;">
               <div>No figure on this slide, but a table is available.</div>
               <div><button class="btn" id="btnShowTable" type="button">Show table</button></div>
             </div>`
          : `<div style="padding:12px;color:var(--muted);">No figure on this slide.</div>`;
        const btn = this.plotHost.querySelector<HTMLButtonElement>("#btnShowTable");
        if (btn) {
          btn.addEventListener("click", () => this.setTab("table"));
        }
      }
      }
    }
    const tableHost = this.mount.querySelector<HTMLElement>("#tableHost");
    if (tableHost) {
      const html = this.findTableHtmlForSlide(slide);
      tableHost.innerHTML = html || "<div>No table available.</div>";
    }
  }

  private async sendVisualiserCommand(action: string, payload?: Record<string, unknown>): Promise<any> {
    if (window.commandBridge?.dispatch) {
      return window.commandBridge.dispatch({ phase: "visualiser", action, payload });
    }
    return undefined;
  }

  private handleCopyStatus = (): void => {
    const success = this.copyVisualiserLog();
    this.setStatus(success ? "Export log copied" : "Clipboard unavailable");
  };

  private handleClearStatus = (): void => {
    this.resetLogPlaceholder();
    this.setStatus("Ready");
  };

  private handleDiagClick = (): void => {
    this.logPlotDiag();
  };

  private handleClearClick = (): void => {
    this.resetLogPlaceholder();
    this.setStatus("Cleared");
  };

  private handleCopyClick = (): void => {
    const success = this.copyVisualiserLog();
    this.setStatus(success ? "Copied" : "Clipboard unavailable");
  };

  private installGlobalListeners(): void {
    this.addGlobalListener(window, "resize", this.handleWindowResize);
    this.addGlobalListener(window, "settings:updated", this.handleThemeUpdate);
    this.addGlobalListener(window, "unhandledrejection", this.handleUnhandledRejection as unknown as EventListener);
  }

  private addGlobalListener(
    target: Document | Window,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options);
    this.globalListeners.push({ target, type, listener, options });
  }

  private handleWindowResize = (): void => {
    this.resizePlot();
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    try {
      // Only surface errors while Visualiser is the active ribbon tab.
      if (this.getActiveRibbonTab() !== "visualiser") {
        return;
      }
      const reason = event.reason as unknown;
      const message =
        reason instanceof Error
          ? reason.message
          : reason && typeof reason === "object" && "message" in (reason as any)
            ? String((reason as any).message || "")
            : String(reason || "");
      const stack = reason instanceof Error ? reason.stack || "" : "";
      const lowered = `${message}\n${stack}`.toLowerCase();
      if (!lowered.trim()) {
        return;
      }
      const looksRelevant =
        lowered.includes("plotly") ||
        lowered.includes("topojson") ||
        lowered.includes("resize must be passed") ||
        lowered.includes("visualiser");
      if (!looksRelevant) {
        return;
      }
      this.appendIssueLog(`Unhandled rejection: ${message || "unknown error"}`);
    } catch {
      // ignore
    }
  };

  private ensurePlotlyTopojsonConfig(): void {
    const w = window as any;
    if (!w.PlotlyConfig || typeof w.PlotlyConfig !== "object") {
      w.PlotlyConfig = {};
    }
    // Plotly choropleths may fetch topojson; keep it local to avoid CSP/network issues.
    if (!w.PlotlyConfig.topojsonURL) {
      w.PlotlyConfig.topojsonURL = "./plotly-topojson/";
    }
  }

  private handleThemeUpdate = (event: Event): void => {
    const detail = (event as CustomEvent<{ key?: string }>).detail;
    const key = detail?.key;
    if (key && !Object.values(APPEARANCE_KEYS).includes(key as any) && key !== "appearance") {
      return;
    }
    if (!this.plotHost) {
      return;
    }
    if (this.deck.length) {
      this.renderSlide();
      return;
    }
    this.drawExampleFigure();
  };

  private cleanupGlobalListeners(): void {
    this.globalListeners.forEach(({ target, type, listener, options }) => {
      target.removeEventListener(type, listener, options);
    });
    this.globalListeners = [];
  }

  public destroy(): void {
    if (this.plotHost) {
      Plotly.purge(this.plotHost);
      this.plotHost = null;
    }
    this.cleanupThumbObserver();
    this.eventHandlers.forEach(({ element, type, listener }) => {
      element.removeEventListener(type, listener);
    });
    this.eventHandlers = [];
    if (this.dataHubListener) {
      document.removeEventListener("retrieve:datahub-updated", this.dataHubListener);
      this.dataHubListener = null;
    }
    if (this.dataHubRestoreListener) {
      document.removeEventListener("retrieve:datahub-restore", this.dataHubRestoreListener);
      this.dataHubRestoreListener = null;
    }
    this.cleanupGlobalListeners();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.ribbonTabObserver) {
      this.ribbonTabObserver.disconnect();
      this.ribbonTabObserver = null;
    }
    this.mount.innerHTML = "";
    if (this.sectionsHost) {
      this.sectionsHost.innerHTML = this.sectionsPlaceholder;
    }
    if (this.exportHost) {
      this.exportHost.innerHTML = this.exportPlaceholder;
    }
    VisualiserPage.activeInstance = null;
  }

  private buildCacheKey(
    table: DataHubTable,
    include: string[],
    params: Record<string, unknown>
  ): string {
    const head = table.rows.slice(0, 5);
    const payload = {
      v: VisualiserPage.DECK_CACHE_VERSION,
      columns: table.columns,
      rows: table.rows.length,
      head,
      include,
      params
    };
    return JSON.stringify(payload);
  }

  private readDeckCache(key: string): Array<Record<string, unknown>> | null {
    try {
      const raw = window.localStorage.getItem(`visualiser.deck.cache:${VisualiserPage.DECK_CACHE_VERSION}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const entry = (parsed as any)[key];
      if (Array.isArray(entry)) {
        return entry as Array<Record<string, unknown>>;
      }
      if (entry && typeof entry === "object") {
        const deck = (entry as any).deck;
        if (Array.isArray(deck)) {
          return deck as Array<Record<string, unknown>>;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private writeDeckCache(key: string, deck: Array<Record<string, unknown>>): void {
    const MAX_ENTRIES = 40;
    try {
      const raw = window.localStorage.getItem(`visualiser.deck.cache:${VisualiserPage.DECK_CACHE_VERSION}`);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      (parsed as any)[key] = { deck, t: Date.now() };
      const keys = Object.keys(parsed);
      if (keys.length > MAX_ENTRIES) {
        const scored = keys
          .map((k) => {
            const v = (parsed as any)[k];
            const t = v && typeof v === "object" && typeof (v as any).t === "number" ? Number((v as any).t) : 0;
            return { k, t };
          })
          .sort((a, b) => a.t - b.t);
        const dropN = Math.max(0, scored.length - MAX_ENTRIES);
        for (let i = 0; i < dropN; i += 1) {
          delete (parsed as any)[scored[i].k];
        }
      }
      window.localStorage.setItem(`visualiser.deck.cache:${VisualiserPage.DECK_CACHE_VERSION}`, JSON.stringify(parsed));
    } catch {
      // ignore cache errors
    }
  }

  private readLastDeckCache(): Array<Record<string, unknown>> | null {
    try {
      const raw = window.localStorage.getItem("visualiser.deck.last");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeLastDeckCache(deck: Array<Record<string, unknown>>): void {
    try {
      window.localStorage.setItem("visualiser.deck.last", JSON.stringify(deck));
    } catch {
      // ignore cache errors
    }
  }

  private logDfLoaded(source: "restore" | "event" | "cache", table: DataHubTable): void {
    const first = table.rows[0];
    const row: Record<string, unknown> = {};
    if (first) {
      table.columns.forEach((col, idx) => {
        row[col] = first[idx];
      });
    }
    console.info("[visualise][df_loaded]", { source, columns: table.columns, firstRow: row });
  }
}
