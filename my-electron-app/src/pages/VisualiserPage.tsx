import Plotly from "plotly.js-dist-min";
import { APPEARANCE_KEYS } from "../config/settingsKeys";
import type { DataHubTable } from "../shared/types/dataHub";

declare global {
  interface Window {
    __hitX?: number;
    __hitY?: number;
    __CENTRAL_LOG_INSTALLED?: boolean;
  }
}

const PANEL_STYLE =
  "display:flex;flex-direction:column;min-width:0;height:100%;background:var(--panel);border:1px solid var(--border);border-radius:14px;box-shadow:var(--shadow);overflow:hidden;";
const PANEL_HEAD_STYLE =
  "display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--panel-2);gap:8px;";
const PANEL_BODY_STYLE = "flex:1 1 auto;padding:10px 12px;overflow:auto;min-height:0;";
const TAB_BAR_STYLE =
  "display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);background:var(--surface-muted);gap:10px;";
const SURFACE_STYLE = "flex:1 1 auto;min-height:0;display:flex;gap:10px;padding:10px;";
const THUMBS_STYLE =
  "flex:0 0 200px;border:1px solid var(--border);border-radius:12px;background:var(--surface-muted);padding:8px;overflow:auto;";
const STAGE_STYLE =
  "flex:1 1 auto;border:1px solid var(--border);border-radius:12px;background:var(--surface);display:flex;flex-direction:column;overflow:hidden;padding:0;";
const LOG_STYLE =
  "margin-top:8px;padding:10px 12px;font-size:12px;color:var(--muted);border-top:1px solid var(--border);background:var(--surface-muted);max-height:140px;overflow:auto;";
const BUTTON_ROW_STYLE = "display:flex;gap:6px;flex-wrap:wrap;";

const SECTIONS_PANEL_HTML = `
  <div class="visualiser-sections-panel" style="display:flex;flex-direction:column;height:100%;">
    <header class="panel-head visualiser-head" style="${PANEL_HEAD_STYLE}">
      <div class="title" id="sectionsTitle" style="font-weight:900;letter-spacing:0.4px;">Sections</div>
      <div class="status" style="color:var(--muted);">Ready</div>
    </header>
    <div class="panel-body" style="${PANEL_BODY_STYLE}">
      <div class="section" aria-label="Find sections">
        <header class="section-head" style="margin-bottom:6px;">
          <div class="section-title" style="font-weight:700;">Find</div>
        </header>
        <div class="section-body">
          <input
            id="sectionSearch"
            type="text"
            placeholder="Search keys, titles, aliases…"
            aria-label="Search sections"
            style="
              width:100%;
              padding:9px 10px;
              border-radius:10px;
              border:1px solid var(--border);
              background:var(--panel);
              color:var(--text);
              font-size:13px;
            "
          />
        </div>
      </div>
      <div class="section" aria-label="Section keys">
        <header class="section-head" style="margin-bottom:6px;display:flex;align-items:center;gap:8px;">
          <div class="section-title" style="font-weight:700;">Keys</div>
          <div class="chip" style="font-size:12px;">Include</div>
          <div class="chip" id="checkedCount" style="font-size:12px;">0 selected</div>
        </header>
        <div class="section-body" id="includeHost" role="list">
          <div class="muted" style="font-size:12px;color:var(--muted);">
            No sections declared. Provide window.__PPTX_SECTIONS from the host.
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const MAIN_PANEL_HTML = `
  <section class="panel center-panel visualiser-tool" style="${PANEL_STYLE}">
    <header class="panel-head visualiser-head" style="${PANEL_HEAD_STYLE}">
      <div class="title" style="font-weight:900;letter-spacing:0.4px;">Visuals Test</div>
      <div class="status" id="status" style="color:var(--muted);">Ready</div>
      <div class="button-row visualiser-button-row" style="${BUTTON_ROW_STYLE}">
        <button class="btn" id="btnCopy" type="button">Copy</button>
        <button class="btn" id="btnClear" type="button">Clear</button>
        <button class="btn" id="btnDiag" type="button">Diag</button>
        <button class="btn" id="btnTest" type="button">Test</button>
      </div>
    </header>
    <div class="tabs" style="${TAB_BAR_STYLE}">
      <div class="tabset" style="display:flex;gap:8px;">
        <button class="tab active" id="tabSlide" type="button">Slide</button>
        <button class="tab" id="tabTable" type="button">Table</button>
      </div>
      <div class="nav" style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted);">
        <button class="btn" id="btnPrev" type="button">Prev</button>
        <span class="count" id="slideCount" style="font-weight:700;color:var(--text);">0 / 0</span>
        <button class="btn" id="btnNext" type="button">Next</button>
      </div>
    </div>
    <div class="surface visualiser-surface" style="${SURFACE_STYLE}">
      <aside class="thumbs-pane premium visualiser-thumbs" id="thumbsPane" style="${THUMBS_STYLE}">
        <div id="thumbsList"></div>
      </aside>
      <section class="stage visualiser-stage" style="${STAGE_STYLE}">
        <div id="paneSlide" class="active" style="display:flex;flex:1;overflow:hidden;">
          <div id="plotHost" style="flex:1;min-height:0;display:flex;align-items:stretch;justify-content:stretch;padding:12px;">
            <div
              id="plot"
              style="flex:1;border:1px solid var(--border);border-radius:12px;background:var(--surface-muted);overflow:hidden;"
            ></div>
          </div>
        </div>
        <div id="paneTable" style="display:none;flex-direction:column;flex:1;">
          <div
            id="tableHost"
            style="flex:1;min-height:0;border:1px solid var(--border);border-radius:12px;margin:12px;color:var(--muted);background:var(--surface-muted);padding:12px;"
          >
            Table placeholder.
          </div>
        </div>
      </section>
    </div>
    <div class="log visualiser-log" id="log" style="${LOG_STYLE}">No activity yet.</div>
    <div
      class="hittest visualiser-hit"
      id="hitTest"
      style="
        margin-top:6px;
        padding:6px 8px;
        font-size:11px;
        color:var(--muted);
        background:var(--surface-muted);
        border-radius:8px;
      "
    >
      HitTest: idle
    </div>
  </section>
`;

const EXPORT_SUMMARY_STYLE = "border:1px solid var(--border);border-radius:12px;padding:10px;margin-bottom:10px;background:var(--surface-muted);";
const EXPORT_SUMMARY_ROW_STYLE =
  "display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-bottom:6px;";

const EXPORT_PANEL_HTML = `
  <div class="visualiser-export-panel" style="display:flex;flex-direction:column;height:100%;">
    <header class="panel-head" style="${PANEL_HEAD_STYLE}">
      <div class="title" style="font-weight:900;letter-spacing:0.4px;">Export Status</div>
      <div class="status" id="statusDetail" style="color:var(--muted);">Ready</div>
    </header>
    <div class="panel-body" style="${PANEL_BODY_STYLE}">
      <section class="export-summary" aria-label="Export counts" style="${EXPORT_SUMMARY_STYLE}">
        <div class="export-summary-row" style="${EXPORT_SUMMARY_ROW_STYLE}">
          <div class="export-summary-k">Included sections</div>
          <div class="export-summary-v" id="summaryCount">0</div>
        </div>
        <div class="export-summary-row" style="${EXPORT_SUMMARY_ROW_STYLE}">
          <div class="export-summary-k">Slides</div>
          <div class="export-summary-v" id="summarySlides">0</div>
        </div>
        <div class="export-summary-row" style="${EXPORT_SUMMARY_ROW_STYLE}margin-bottom:0;">
          <div class="export-summary-k">Active section</div>
          <div class="export-summary-v" id="summaryActive">None</div>
        </div>
      </section>
      <div class="section export-section" aria-label="Export inputs" style="margin-bottom:10px;">
        <header class="section-head" style="margin-bottom:6px;">
          <div class="section-title" style="font-weight:700;">Inputs</div>
        </header>
        <div class="section-body" id="optionsHost">
          <div class="row" style="margin-bottom:10px;${BUTTON_ROW_STYLE}">
            <button class="btn" id="btnRunInputs" type="button">Run</button>
          </div>
        </div>
      </div>
      <div class="section export-section" aria-label="Export status" style="margin-bottom:10px;">
        <header class="section-head" style="margin-bottom:6px;">
          <div class="section-title" style="font-weight:700;">Status</div>
        </header>
        <div class="section-body export-status">
          <div
            id="exportLog"
            class="export-log"
            style="max-height:220px;overflow:auto;padding:8px;background:var(--surface-muted);border-radius:10px;border:1px solid var(--border);font-size:12px;color:var(--muted);"
          >
            <div class="export-logline muted">No activity yet.</div>
          </div>
        </div>
      </div>
      <div class="section export-section" aria-label="Export actions">
        <header class="section-head" style="margin-bottom:6px;">
          <div class="section-title" style="font-weight:700;">Actions</div>
        </header>
        <div class="section-body">
          <div class="button-row" style="${BUTTON_ROW_STYLE}">
            <button class="btn" id="btnBuild" type="button">Build</button>
            <button class="btn" id="btnCopyStatus" type="button">Copy status</button>
            <button class="btn" id="btnClearStatus" type="button">Clear status</button>
          </div>
        </div>
      </div>
    </div>
  </div>
`;

const DEFAULT_SLIDE_COUNT = 8;

type ConsoleMethodName = "log" | "info" | "warn" | "error" | "debug";
type ConsoleHandler = (...data: unknown[]) => void;

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
  private deck: Array<Record<string, unknown>> = [];
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
  private eventHandlers: Array<{ element: HTMLElement; type: string; listener: EventListener }> = [];
  private globalListeners: Array<{
    target: Document | Window;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }> = [];
  private resizeObserver: ResizeObserver | null = null;
  private hitTestFrame: number | null = null;
  private consoleBackup: Partial<Record<ConsoleMethodName, ConsoleHandler>> = {};
  private static consoleHookInstalled = false;
  private static activeInstance: VisualiserPage | null = null;

  constructor(mount: HTMLElement) {
    this.mount = mount;
    VisualiserPage.activeInstance = this;
    this.sectionsHost = VisualiserPage.findPanelContent("panel1");
    this.exportHost = VisualiserPage.findPanelContent("panel3");
    this.sectionsPlaceholder = this.sectionsHost?.innerHTML || "";
    this.exportPlaceholder = this.exportHost?.innerHTML || "";
    this.installConsoleHook();
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
    this.renderSectionsList();
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
      const detail = (event as CustomEvent<{ state?: { table?: DataHubTable } }>).detail;
      const table = detail?.state?.table;
      if (table) {
        this.currentTable = {
          columns: table.columns.slice(),
          rows: table.rows.map((row) => row.slice())
        };
        this.logDfLoaded("event", this.currentTable);
        this.setStatus(`Loaded ${this.currentTable.rows.length} rows from Retrieve`);
        this.appendExportLog("Retrieve data synced to Visualiser.");
        if (this.schema.length) {
          const params = this.readParams();
          const include = this.orderedInclude();
          const cacheKey = this.buildCacheKey(this.currentTable, include, params);
          const cached = this.readDeckCache(cacheKey);
          if (cached && cached.length) {
            this.deck = cached;
            this.slideIndex = 0;
            this.renderThumbs();
            this.renderSlide();
            this.updateSummary();
            this.setStatus("Visualiser ready (cache)");
          } else if (!this.deck.length) {
            void this.runVisualiser();
          }
        }
      }
    };
    document.addEventListener("retrieve:datahub-updated", this.dataHubListener);
  }

  private hydrateTableFromRestore(): void {
    const restore = (window as unknown as { __retrieveDataHubState?: { table?: DataHubTable } }).__retrieveDataHubState;
    if (restore?.table) {
      this.currentTable = {
        columns: restore.table.columns.slice(),
        rows: restore.table.rows.map((row) => row.slice())
      };
      this.logDfLoaded("restore", this.currentTable);
    }
  }

  private async loadVisualiserSchema(): Promise<void> {
    const response = await this.sendVisualiserCommand("get_sections");
    if (!response || response.status !== "ok") {
      this.appendExportLog("Unable to load Visualiser sections.");
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
      const include = this.orderedInclude();
      const cacheKey = this.buildCacheKey(this.currentTable, include, params);
      const cached = this.readDeckCache(cacheKey);
      if (cached && cached.length) {
        this.deck = cached;
        this.slideIndex = 0;
        this.renderThumbs();
        this.renderSlide();
      } else {
        const lastDeck = this.readLastDeckCache();
        if (lastDeck && lastDeck.length) {
          this.deck = lastDeck;
          this.slideIndex = 0;
          this.renderThumbs();
          this.renderSlide();
        } else if (!this.deck.length) {
          void this.runVisualiser();
        }
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
    this.sections.forEach((section) => {
      const row = document.createElement("label");
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "8px";
      row.style.marginBottom = "6px";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = this.selectedSections.has(section.id);
      cb.addEventListener("change", () => {
        if (cb.checked) this.selectedSections.add(section.id);
        else this.selectedSections.delete(section.id);
        this.updateSummary();
      });
      const text = document.createElement("div");
      text.innerHTML = `<strong>${section.label}</strong><div style="font-size:11px;color:var(--muted);">${section.hint ?? ""}</div>`;
      row.append(cb, text);
      host.appendChild(row);
    });
    this.updateSummary();
  }

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
    this.attachListener(this.mount.querySelector("#btnTest"), "click", this.handleTestClick);
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
      thumb.innerHTML = `
        <div class="thumb-label">${title}</div>
        <div class="thumb-sub">Preview</div>
      `;
      thumb.setAttribute("data-idx", String(index));
      thumb.addEventListener("click", () => {
        this.slideIndex = index;
        this.applySlideChange();
      });
      host.appendChild(thumb);
    }
    this.updateSlideCounter();
  }

  private applySlideChange(): void {
    this.renderThumbs();
    this.renderSlide();
    this.updateSummary();
    this.logLine(`Slide selected: ${this.slideIndex + 1}`);
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
      this.logLine("Plotly rendered.");
      this.installPlotResizeObserver();
      this.resizePlot();
      const rect = this.plotHost?.getBoundingClientRect();
      if (rect) {
        this.logLine(`Plot rect w=${Math.round(rect.width)} h=${Math.round(rect.height)}`);
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
    const plots = (Plotly as Partial<typeof Plotly> & { Plots?: { resize?: (gd: HTMLElement) => void } }).Plots;
    if (!plots || typeof plots.resize !== "function") {
      return;
    }
    plots.resize(this.plotHost);
  }

  private updateSummary(): void {
    const checkedCount = this.sectionsHost?.querySelector<HTMLElement>("#checkedCount");
    if (checkedCount) {
      checkedCount.textContent = `1 selected`;
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

  private logLine(message: string): void {
    const host = this.mount.querySelector<HTMLElement>("#log");
    if (!host) {
      return;
    }
    if (host.textContent === "No activity yet.") {
      host.textContent = "";
    }
    const stamp = new Date().toISOString().slice(11, 19);
    host.textContent = `[${stamp}] ${message}\n${host.textContent}`;
  }

  private setStatus(message: string): void {
    const primary = this.mount.querySelector<HTMLElement>("#status");
    const detail = this.exportHost?.querySelector<HTMLElement>("#statusDetail");
    if (primary) {
      primary.textContent = message;
    }
    if (detail) {
      detail.textContent = message;
    }
  }

  private logPlotDiag(): void {
    if (!this.plotHost) {
      this.logLine("Diag: plot missing");
      return;
    }
    const rect = this.plotHost.getBoundingClientRect();
    this.logLine("Diag: plot_ready=true");
    this.logLine(`Diag rect w=${Math.round(rect.width)} h=${Math.round(rect.height)}`);
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
    host.innerHTML = slide?.table_html || "<div>No table available.</div>";
  }

  private setTab(tab: "slide" | "table"): void {
    const slidePane = this.mount.querySelector<HTMLElement>("#paneSlide");
    const tablePane = this.mount.querySelector<HTMLElement>("#paneTable");
    const tabSlide = this.mount.querySelector<HTMLButtonElement>("#tabSlide");
    const tabTable = this.mount.querySelector<HTMLButtonElement>("#tabTable");
    if (tab === "slide") {
      slidePane?.classList.add("active");
      tablePane?.classList.remove("active");
      tabSlide?.classList.add("active");
      tabTable?.classList.remove("active");
      return;
    }
    slidePane?.classList.remove("active");
    tablePane?.classList.add("active");
    tabSlide?.classList.remove("active");
    tabTable?.classList.add("active");
    this.renderTableView();
  }

  private appendExportLog(message: string): void {
    const host = this.exportHost?.querySelector<HTMLElement>("#exportLog");
    if (!host) {
      return;
    }
    const placeholder = host.querySelector<HTMLElement>(".export-logline.muted");
    if (placeholder) {
      placeholder.remove();
    }
    const line = document.createElement("div");
    line.className = "export-logline";
    const stamp = new Date().toLocaleTimeString();
    line.textContent = `[${stamp}] ${message}`;
    host.prepend(line);
  }

  private handleRunInputs = (): void => {
    void this.runVisualiser();
  };

  private handleBuild = (): void => {
    void this.runVisualiser(true);
  };

  private async runVisualiser(isBuild = false): Promise<void> {
    if (!this.currentTable) {
      this.setStatus("Load data in Retrieve first.");
      this.appendExportLog("No data available. Load data in Retrieve.");
      return;
    }
    const include = this.orderedInclude();
    if (!include.length) {
      this.setStatus("Select at least one section.");
      this.appendExportLog("No sections selected.");
      return;
    }
    this.setStatus("Running visualiser...");
    this.appendExportLog(isBuild ? "Build requested." : "Running preview...");
    const params = this.readParams();
    const cacheKey = this.buildCacheKey(this.currentTable, include, params);
    const cached = this.readDeckCache(cacheKey);
    if (cached && cached.length) {
      this.deck = cached;
      this.slideIndex = 0;
      this.renderThumbs();
      this.renderSlide();
      this.updateSummary();
      this.setStatus("Visualiser ready (cache)");
      return;
    }
    const response = await this.sendVisualiserCommand(isBuild ? "build_deck" : "run_inputs", {
      table: this.currentTable,
      include,
      params
    });
    if (!response || response.status !== "ok") {
      this.setStatus("Visualiser failed.");
      this.appendExportLog(`Visualiser failed to return results.`);
      if (response && (response as any).message) {
        this.appendExportLog(String((response as any).message));
      }
      return;
    }
    const logs = (response as any).logs;
    if (Array.isArray(logs)) {
      logs.forEach((line) => {
        if (typeof line === "string" && line.trim()) {
          this.appendExportLog(line);
          this.setStatus(line);
        }
      });
    }
    const deck = (response as any).deck?.slides || [];
    this.deck = Array.isArray(deck) ? deck : [];
    this.writeLastDeckCache(this.deck);
    this.writeDeckCache(cacheKey, this.deck);
    this.slideIndex = 0;
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
    const figJson = slide.fig_json;
    const tableHtml = slide.table_html;
    const title = slide.title;
    if (figJson && this.plotHost) {
      Plotly.purge(this.plotHost);
      void Plotly.newPlot(this.plotHost, figJson.data || figJson, figJson.layout || {}, { responsive: true })
        .then(() => {
          this.setStatus(title || "Rendered");
          this.resizePlot();
        })
        .catch(() => {
          this.setStatus("Plot render failed.");
        });
    } else {
      this.plotHost.innerHTML = `<div style="padding:12px;color:var(--muted);">No figure on this slide.</div>`;
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
    const host = this.exportHost?.querySelector<HTMLElement>("#exportLog");
    const text = host ? host.innerText : "";
    if (text && navigator && "clipboard" in navigator && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(text);
      this.setStatus("Export log copied");
      return;
    }
    this.setStatus("Clipboard unavailable");
  };

  private handleClearStatus = (): void => {
    const host = this.exportHost?.querySelector<HTMLElement>("#exportLog");
    if (!host) {
      return;
    }
    host.innerHTML = `<div class="export-logline muted">No activity yet.</div>`;
    this.setStatus("Ready");
  };

  private handleTestClick = (): void => {
    void this.runVisualiser();
  };

  private handleDiagClick = (): void => {
    this.logPlotDiag();
  };

  private handleClearClick = (): void => {
    const host = this.mount.querySelector<HTMLElement>("#log");
    if (host) {
      host.textContent = "No activity yet.";
    }
    this.setStatus("Cleared");
  };

  private handleCopyClick = (): void => {
    const host = this.mount.querySelector<HTMLElement>("#log");
    const text = host ? host.textContent || "" : "";
    if (text && navigator && "clipboard" in navigator && typeof navigator.clipboard.writeText === "function") {
      void navigator.clipboard.writeText(text);
      this.setStatus("Copied");
      return;
    }
    this.setStatus("Clipboard unavailable");
  };

  private installConsoleHook(): void {
    if (VisualiserPage.consoleHookInstalled) {
      return;
    }
    VisualiserPage.consoleHookInstalled = true;
    window.__CENTRAL_LOG_INSTALLED = true;
    const methods: ConsoleMethodName[] = ["log", "info", "warn", "error", "debug"];
    methods.forEach((method) => {
      const original = console[method];
      const originalFn = typeof original === "function" ? original : (() => undefined);
      this.consoleBackup[method] = originalFn;
      console[method] = (...args: unknown[]) => {
        this.logConsoleMessage(method, args);
        return originalFn.apply(console, args as Parameters<typeof originalFn>);
      };
    });
  }

  private restoreConsoleHook(): void {
    if (!VisualiserPage.consoleHookInstalled) {
      return;
    }
    const methods: ConsoleMethodName[] = ["log", "info", "warn", "error", "debug"];
    methods.forEach((method) => {
      const original = this.consoleBackup[method];
      if (original) {
        console[method] = original;
      }
    });
    this.consoleBackup = {};
    VisualiserPage.consoleHookInstalled = false;
    window.__CENTRAL_LOG_INSTALLED = false;
  }

  private logConsoleMessage(method: ConsoleMethodName, args: unknown[]): void {
    const summary = args
      .map((value) => {
        const seen = new Set<unknown>();
        return this.stringifyArg(value, seen, 0);
      })
      .filter(Boolean)
      .join(" ");
    if (!summary) {
      return;
    }
    this.logLine(`[${method.toUpperCase()}] ${summary}`);
  }

  private stringifyArg(value: unknown, seen: Set<unknown>, depth: number): string {
    if (depth > 3) {
      return "...";
    }
    if (value === null) {
      return "null";
    }
    if (value === undefined) {
      return "undefined";
    }
    if (typeof value === "string") {
      return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    if (typeof value !== "object") {
      return String(value);
    }
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const inner = value.map((item) => this.stringifyArg(item, seen, depth + 1)).join(", ");
      seen.delete(value);
      return `[${inner}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => `${key}:${this.stringifyArg(entryValue, seen, depth + 1)}`)
      .join(", ");
    seen.delete(value);
    return `{${entries}}`;
  }

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
    this.restoreConsoleHook();
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

  private logDfLoaded(source: "restore" | "event", table: DataHubTable): void {
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
