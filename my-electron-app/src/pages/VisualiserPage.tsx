import Plotly from "plotly.js-dist-min";
import { APPEARANCE_KEYS } from "../config/settingsKeys";
import { commandInternal } from "../ribbon/commandDispatcher";
import type { DataHubLoadResult, DataHubTable } from "../shared/types/dataHub";
import type { RetrieveDataHubState } from "../session/sessionTypes";

declare global {
  interface Window {
    __hitX?: number;
    __hitY?: number;
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
    <div class="hittest visualiser-hit" id="hitTest">
      HitTest: idle
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
          <div class="export-summary-k">Slides</div>
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
          <div class="row visualiser-button-row visualiser-button-row--inputs">
            <button class="btn" id="btnRunInputs" type="button">Run</button>
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
            <button class="btn" id="btnBuild" type="button">Build</button>
            <button class="btn" id="btnCopyStatus" type="button">Copy status</button>
            <button class="btn" id="btnClearStatus" type="button">Clear status</button>
            <button class="btn" id="btnRefresh" type="button">Refresh preview</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const DEFAULT_SLIDE_COUNT = 8;
export class VisualiserPage {
  private mount: HTMLElement;
  private sectionsHost: HTMLElement | null;
  private exportHost: HTMLElement | null;
  private sectionsPlaceholder: string;
  private exportPlaceholder: string;
  private sidePanelsActive = false;
  private ribbonTabObserver: MutationObserver | null = null;
  private plotHost: HTMLElement | null = null;
  private slideIndex = 0;
  private readonly totalSlides = DEFAULT_SLIDE_COUNT;
  private deckAll: Array<Record<string, unknown>> = [];
  private deck: Array<Record<string, unknown>> = [];
  private deckVersion = 0;
  private thumbCache = new Map<string, string>();
  private thumbQueue: Array<() => Promise<void>> = [];
  private thumbInFlight = 0;
  private readonly thumbMaxConcurrency = 2;
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
  private hitTestFrame: number | null = null;
  private static activeInstance: VisualiserPage | null = null;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    VisualiserPage.activeInstance = this;
    this.sectionsHost = VisualiserPage.findPanelContent("panel1");
    this.exportHost = VisualiserPage.findPanelContent("panel3");
    this.sectionsPlaceholder = this.sectionsHost?.innerHTML || "";
    this.exportPlaceholder = this.exportHost?.innerHTML || "";
    this.renderCenterPanel();
    this.installGlobalListeners();
    this.installRibbonTabObserver();
    this.syncSidePanels();
    this.startHitTestLoop();
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
      return;
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
      const nextState: RetrieveDataHubState = {
        sourceType,
        filePath: sourceType === "file" ? source?.path : undefined,
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

  private getPreviewIncludeIds(): string[] {
    if (!this.sections.length) {
      return [];
    }
    return this.sections.map((s) => s.id).filter(Boolean);
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
    const filterByInclude = includeSet.size > 0;
    return deck.filter((s) => {
      const sec = String((s as any)?.section ?? "").trim();
      if (sec && hideSet.has(sec)) {
        return false;
      }
      if (sec && filterByInclude && !includeSet.has(sec)) {
        return false;
      }
      return true;
    });
  }

  private findFirstSlideIndex(sectionId: string): number {
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
    if (focusSectionId) {
      this.slideIndex = Math.max(
        0,
        Math.min(this.findFirstSlideIndex(focusSectionId), Math.max(0, this.deck.length - 1))
      );
    } else {
      this.slideIndex = Math.max(0, Math.min(this.slideIndex, Math.max(0, this.deck.length - 1)));
    }
    this.renderThumbs();
    this.renderSlide();
    this.updateSummary();
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
    const slidesBySection = new Map<string, string[]>();
    slides.forEach((slide) => {
      const sec = String((slide as any)?.section ?? "").trim();
      if (!sec) return;
      const title = String((slide as any)?.title ?? "").trim() || "Untitled";
      if (!slidesBySection.has(sec)) {
        slidesBySection.set(sec, []);
      }
      slidesBySection.get(sec)!.push(title);
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
              .slice(0, 10)
              .map((t) => `<div class="slide-line">${this.escapeXml(t)}</div>`)
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
    const host = this.exportHost?.querySelector<HTMLElement>("#optionsHost");
    if (!host) return;
    const row = host.querySelector<HTMLElement>(".row");
    if (row) row.remove();
    if (!this.schema.length) {
      return;
    }
    const form = document.createElement("div");
    form.style.display = "grid";
    form.style.gridTemplateColumns = "repeat(auto-fit, minmax(160px, 1fr))";
    form.style.gap = "8px";
    this.schema.forEach((field) => {
      const wrap = document.createElement("label");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.gap = "4px";
      const title = document.createElement("span");
      title.textContent = field.label;
      title.style.fontSize = "12px";
      title.style.color = "var(--muted)";
      let input: HTMLElement;
      if (field.type === "select" && field.options) {
        const sel = document.createElement("select");
        field.options.forEach((opt) => {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          sel.appendChild(option);
        });
        if (field.default !== undefined) sel.value = String(field.default);
        input = sel;
      } else {
        const inp = document.createElement("input");
        inp.type = field.type === "number" ? "number" : "text";
        if (field.min !== undefined) inp.min = String(field.min);
        if (field.max !== undefined) inp.max = String(field.max);
        if (field.default !== undefined) inp.value = String(field.default);
        input = inp;
      }
      input.setAttribute("data-param-key", field.key);
      input.style.padding = "6px 8px";
      input.style.borderRadius = "8px";
      input.style.border = "1px solid var(--border)";
      input.style.background = "var(--panel)";
      input.style.color = "var(--text)";
      wrap.append(title, input);
      form.appendChild(wrap);
    });
    host.appendChild(form);
    const rowWrap = document.createElement("div");
    rowWrap.className = "row";
    rowWrap.style.marginTop = "10px";
    rowWrap.style.display = "flex";
    rowWrap.style.gap = "6px";
    const run = document.createElement("button");
    run.className = "btn";
    run.type = "button";
    run.textContent = "Run";
    run.addEventListener("click", this.handleRunInputs);
    rowWrap.appendChild(run);
    host.appendChild(rowWrap);
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
    this.attachListener(this.exportHost.querySelector("#btnBuild"), "click", this.handleBuild);
    this.attachListener(this.exportHost.querySelector("#btnRefresh"), "click", this.handleRefreshClick);
    this.attachListener(this.exportHost.querySelector("#btnCopyStatus"), "click", this.handleCopyStatus);
    this.attachListener(this.exportHost.querySelector("#btnClearStatus"), "click", this.handleClearStatus);
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
    host.innerHTML = "";
    const count = this.deck.length || this.totalSlides;
    for (let index = 0; index < count; index += 1) {
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
      thumb.addEventListener("click", () => {
        this.slideIndex = index;
        this.applySlideChange();
      });
      host.appendChild(thumb);

      const slide = this.deck[index] as Record<string, unknown> | undefined;
      this.enqueueThumbTask(() => this.populateThumbImage(img, slide, index));
    }
    this.updateSlideCounter();
  }

  private resetThumbPipeline(): void {
    this.thumbQueue = [];
    this.thumbInFlight = 0;
    this.thumbCache.clear();
  }

  private enqueueThumbTask(task: () => Promise<void>): void {
    this.thumbQueue.push(task);
    this.pumpThumbQueue();
  }

  private pumpThumbQueue(): void {
    while (this.thumbInFlight < this.thumbMaxConcurrency && this.thumbQueue.length) {
      const next = this.thumbQueue.shift();
      if (!next) return;
      this.thumbInFlight += 1;
      void next()
        .catch(() => {
          // ignore; populateThumbImage handles fallbacks + logging
        })
        .finally(() => {
          this.thumbInFlight -= 1;
          this.pumpThumbQueue();
        });
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
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="220" viewBox="0 0 320 220">
  <defs>
    <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="${bg}" stop-opacity="1"/>
      <stop offset="1" stop-color="${bg}" stop-opacity="0.85"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="320" height="220" rx="18" fill="url(#g)"/>
  <rect x="16" y="16" width="288" height="148" rx="14" fill="${palette.panel}" opacity="0.65" stroke="${accent}" stroke-opacity="0.35"/>
  <text x="28" y="44" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" font-size="12" fill="${muted}">${badge}</text>
  <text x="28" y="78" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="14" fill="${fg}" font-weight="700">${this.escapeXml(title).slice(0, 44)}</text>
  <text x="28" y="104" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="12" fill="${muted}">${this.escapeXml(subtitle).slice(0, 54)}</text>
  <rect x="16" y="178" width="288" height="26" rx="12" fill="${palette.panel}" opacity="0.5" stroke="${accent}" stroke-opacity="0.25"/>
  <circle cx="32" cy="191" r="5" fill="${accent}" opacity="0.9"/>
  <text x="44" y="195" font-family="system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif" font-size="12" fill="${muted}">Visualiser preview</text>
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
      return;
    }

    const figJson = this.normalizeFigJson((slide as any)?.fig_json) as any;
    if (figJson) {
      const svgFallback = this.svgFigureThumbDataUrl(figJson, title);
      if (svgFallback && this.deckVersion === version) {
        // Always show a deterministic, fast fallback first (and keep the log area clean).
        this.thumbCache.set(key, svgFallback);
        img.src = svgFallback;
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

      const W = 320;
      const H = 220;
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
        "indicator",
        "table"
      ];
      if (types.some((t: string) => blocked.includes(t))) return false;
      // Allow common 2D traces.
      const allowed = ["bar", "scatter", "pie", "histogram", "box", "violin", "heatmap"];
      return types.every((t: string) => allowed.includes(t));
    } catch {
      return false;
    }
  }

  private async plotlyThumbDataUrl(figJson: any): Promise<string> {
    // Render offscreen to create a small PNG thumb without requiring python/kaleido.
    const palette = this.getThemePalette();
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.top = "0";
    container.style.width = "320px";
    container.style.height = "220px";
    container.style.pointerEvents = "none";
    container.style.opacity = "0";
    document.body.appendChild(container);

    try {
      const data = figJson.data || figJson;
      const layout = figJson.layout || {};
      const finalLayout = {
        ...layout,
        title: undefined,
        paper_bgcolor: palette.panel,
        plot_bgcolor: palette.panel,
        font: { ...(layout.font || {}), color: palette.text },
        margin: layout.margin ?? { l: 24, r: 16, t: 12, b: 24 },
        width: 320,
        height: 220,
        autosize: false
      };
      await Plotly.newPlot(container, data, finalLayout, {
        displayModeBar: false,
        responsive: false
      });
      const url = (await (Plotly as any).toImage(container, {
        format: "png",
        width: 320,
        height: 220,
        scale: 1
      })) as string;
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

  private applySlideChange(): void {
    this.renderThumbs();
    this.renderSlide();
    this.updateSummary();
  }

  private updateSlideCounter(): void {
    const counter = this.mount.querySelector<HTMLElement>("#slideCount");
    if (!counter) {
      return;
    }
    const total = this.deck.length || this.totalSlides || 0;
    const current = total ? String(this.slideIndex + 1) : "0";
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
    if (!this.plotHost) {
      return;
    }
    if (!this.plotHost.isConnected) {
      return;
    }
    if (!this.plotHost.classList.contains("js-plotly-plot")) {
      return;
    }
    const rect = this.plotHost.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) {
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
      summarySlides.textContent = String(this.deck.length || this.totalSlides);
    }
    if (summaryActive) {
      summaryActive.textContent = `Slide ${this.slideIndex + 1}`;
    }
    const slideCount = this.mount.querySelector<HTMLElement>("#slideCount");
    if (slideCount) {
      slideCount.textContent = `${this.slideIndex + 1} / ${this.deck.length || this.totalSlides}`;
    }
    this.setStatus(this.deck.length ? `Slides: ${this.deck.length}` : "No slides");
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
    const next = this.slideIndex + direction;
    const total = this.deck.length || this.totalSlides;
    if (next < 0) {
      this.slideIndex = 0;
      this.applySlideChange();
      return;
    }
    if (next >= total) {
      this.slideIndex = total - 1;
      this.applySlideChange();
      return;
    }
    this.slideIndex = next;
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
      const raw = window.localStorage.getItem("visualiser.deck.cache");
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>;
      if (!parsed || typeof parsed !== "object") return;
      if (!(key in parsed)) return;
      delete parsed[key];
      window.localStorage.setItem("visualiser.deck.cache", JSON.stringify(parsed));
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
    void this.runVisualiser();
  };

  private handleBuild = (): void => {
    void this.runVisualiser(true);
  };

  private handleRefreshClick = (): void => {
    this.setStatus("Refresh preview requested (build deck).");
    void this.runVisualiser(true);
  };

  private async runVisualiser(isBuild = false): Promise<void> {
    if (!this.currentTable) {
      this.setStatus("Load data in Retrieve first.");
      return;
    }
    const include = isBuild ? this.orderedInclude() : this.getPreviewIncludeIds();
    if (isBuild && !include.length) {
      this.setStatus("Select at least one section.");
      return;
    }
    this.setStatus("Running visualiser...");
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
        this.setStatus("Visualiser ready (cache)");
        return;
      }
      this.slideIndex = Math.max(0, Math.min(this.slideIndex, Math.max(0, this.deck.length - 1)));
      this.renderThumbs();
      this.renderSlide();
      this.updateSummary();
    }
    const response = await this.sendVisualiserCommand(isBuild ? "build_deck" : "run_inputs", {
      table: this.currentTable,
      include,
      params
    });
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
    this.deckAll = this.normalizeDeck(Array.isArray(deck) ? deck : [], isBuild ? "build" : "run");
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
    this.slideIndex = 0;
    this.renderSectionsList();
    this.renderThumbs();
    this.renderSlide();
    this.updateSummary();
    this.setStatus("Visualiser ready");
  }

  private orderedInclude(): string[] {
    if (!this.sections.length) {
      return Array.from(this.selectedSections);
    }
    return this.sections.map((s) => s.id).filter((id) => this.selectedSections.has(id));
  }

  private clearPlotPlaceholder(): void {
    this.plotHost = this.mount.querySelector<HTMLElement>("#plot");
    if (!this.plotHost) return;
    this.plotHost.innerHTML = `<div style="padding:12px;color:var(--muted);">Run Visualiser to generate plots.</div>`;
  }

  private renderSlide(): void {
    if (!this.plotHost) return;
    const slide = this.deck[this.slideIndex] as any;
    if (!slide) {
      this.setStatus("No slide to render.");
      return;
    }
    const figJson = this.normalizeFigJson(slide.fig_json);
    const tableHtml = slide.table_html;
    const title = slide.title;
    if (figJson && this.plotHost) {
      Plotly.purge(this.plotHost);
      const rect = this.plotHost.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        this.appendIssueLog(
          `Plot container has near-zero size (${Math.round(rect.width)}x${Math.round(rect.height)}). Try reopening the tab/panel.`
        );
      }
      const data = (figJson as any).data || figJson;
      const baseLayout = (figJson as any).layout || {};
      const safeMargin = (() => {
        const m = (baseLayout as any).margin || {};
        const toNum = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
        return {
          l: Math.max(30, toNum(m.l, 46)),
          r: Math.max(30, toNum(m.r, 56)),
          t: Math.max(20, toNum(m.t, 30)),
          b: Math.max(30, toNum(m.b, 46)),
          pad: Math.max(0, toNum(m.pad, 4)),
          autoexpand: true
        };
      })();
      const palette = this.getThemePalette();
      const layout = {
        ...baseLayout,
        autosize: true,
        // Let Plotly size to container; we still provide dimensions to reduce initial jitter.
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
        paper_bgcolor: (baseLayout as any).paper_bgcolor ?? palette.panel,
        plot_bgcolor: (baseLayout as any).plot_bgcolor ?? palette.panel,
        margin: safeMargin
      };
      // Reduce clipping issues by letting axes auto-margin when labels are wide.
      if (layout.xaxis && typeof layout.xaxis === "object") {
        (layout as any).xaxis = { ...(layout as any).xaxis, automargin: true };
      }
      if (layout.yaxis && typeof layout.yaxis === "object") {
        (layout as any).yaxis = { ...(layout as any).yaxis, automargin: true };
      }

      // Keep interactive plots, but avoid the default crosshair by preferring pan + scroll zoom.
      const config = {
        responsive: true,
        displayModeBar: false,
        scrollZoom: true,
        displaylogo: false
      };
      void Plotly.newPlot(this.plotHost, data, { ...layout, dragmode: (layout as any).dragmode ?? "pan" }, config)
        .then(() => {
          this.setStatus(title || "Rendered");
          this.installPlotResizeObserver();
          this.resizePlot();
        })
        .catch((error) => {
          this.setStatus("Plot render failed.");
          this.appendIssueLog(
            `Plotly render failed: ${error instanceof Error ? error.message : String(error)}`
          );
        });
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
        this.plotHost.innerHTML = `<div style="padding:12px;color:var(--muted);">No figure on this slide.</div>`;
      }
    }
    const tableHost = this.mount.querySelector<HTMLElement>("#tableHost");
    if (tableHost) {
      tableHost.innerHTML = tableHtml || "<div>No table available.</div>";
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
    this.addGlobalListener(document, "pointermove", this.handlePointerMove, true);
    this.addGlobalListener(window, "resize", this.handleWindowResize);
    this.addGlobalListener(window, "settings:updated", this.handleThemeUpdate);
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

  private handlePointerMove = (event: Event): void => {
    const pointer = event as PointerEvent;
    window.__hitX = pointer.clientX;
    window.__hitY = pointer.clientY;
  };

  private handleWindowResize = (): void => {
    this.resizePlot();
  };

  private handleThemeUpdate = (event: Event): void => {
    const detail = (event as CustomEvent<{ key?: string }>).detail;
    const key = detail?.key;
    if (key && !Object.values(APPEARANCE_KEYS).includes(key as any) && key !== "appearance") {
      return;
    }
    if (!this.plotHost) {
      return;
    }
    this.drawExampleFigure();
  };

  private startHitTestLoop(): void {
    if (this.hitTestFrame !== null) {
      return;
    }
    this.hitTestTick();
  }

  private stopHitTestLoop(): void {
    if (this.hitTestFrame !== null) {
      cancelAnimationFrame(this.hitTestFrame);
      this.hitTestFrame = null;
    }
  }

  private hitTestTick = (): void => {
    const trace = document.elementFromPoint(window.__hitX || 0, window.__hitY || 0);
    this.updateHitTestText(trace);
    this.hitTestFrame = requestAnimationFrame(this.hitTestTick);
  };

  private updateHitTestText(element: Element | null): void {
    const host = this.mount.querySelector<HTMLElement>("#hitTest");
    if (!host) {
      return;
    }
    if (!element) {
      host.textContent = "HitTest: none";
      return;
    }
    const idPart = element.id ? `#${element.id}` : "";
    const classList = element.className
      ? `.${String(element.className)
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .join(".")}`
      : "";
    host.textContent = `HitTest: ${element.tagName.toLowerCase()}${idPart}${classList}`;
  }

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
    this.stopHitTestLoop();
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
      const raw = window.localStorage.getItem("visualiser.deck.cache");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>;
      return parsed[key] || null;
    } catch {
      return null;
    }
  }

  private writeDeckCache(key: string, deck: Array<Record<string, unknown>>): void {
    try {
      const raw = window.localStorage.getItem("visualiser.deck.cache");
      const parsed = raw ? (JSON.parse(raw) as Record<string, Array<Record<string, unknown>>>) : {};
      parsed[key] = deck;
      window.localStorage.setItem("visualiser.deck.cache", JSON.stringify(parsed));
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
