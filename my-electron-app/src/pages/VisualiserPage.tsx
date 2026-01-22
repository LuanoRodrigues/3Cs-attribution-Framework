import Plotly from "plotly.js-dist-min";
import { APPEARANCE_KEYS } from "../config/settingsKeys";

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
  private plotHost: HTMLElement | null = null;
  private slideIndex = 0;
  private readonly totalSlides = DEFAULT_SLIDE_COUNT;
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
    this.renderSectionsPanel();
    this.renderExportPanel();
    this.renderCenterPanel();
    this.installGlobalListeners();
    this.startHitTestLoop();
  }

  private static findPanelContent(panelId: "panel1" | "panel3"): HTMLElement | null {
    const shell = document.querySelector(`.panel-shell[data-panel-id='${panelId}']`);
    if (!shell) {
      return null;
    }
    return shell.querySelector<HTMLElement>(".panel-content");
  }

  private renderSectionsPanel(): void {
    if (!this.sectionsHost) {
      return;
    }
    this.sectionsHost.innerHTML = SECTIONS_PANEL_HTML;
  }

  private renderExportPanel(): void {
    if (!this.exportHost) {
      return;
    }
    this.exportHost.innerHTML = EXPORT_PANEL_HTML;
    this.attachExportPanelHooks();
  }

  private renderCenterPanel(): void {
    this.mount.innerHTML = MAIN_PANEL_HTML;
    this.attachControlHooks();
    this.setTab("slide");
    this.renderThumbs();
    this.drawExampleFigure();
    this.updateSummary();
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
    for (let index = 0; index < this.totalSlides; index += 1) {
      const thumb = document.createElement("button");
      thumb.type = "button";
      thumb.className = "thumb";
      if (index === this.slideIndex) {
        thumb.classList.add("active");
      }
      thumb.innerHTML = `
        <div class="thumb-label">Slide ${index + 1}</div>
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
    this.updateSummary();
    this.logLine(`Slide selected: ${this.slideIndex + 1}`);
  }

  private updateSlideCounter(): void {
    const counter = this.mount.querySelector<HTMLElement>("#slideCount");
    if (!counter) {
      return;
    }
    const total = this.totalSlides || 0;
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
      summaryCount.textContent = "1";
    }
    if (summarySlides) {
      summarySlides.textContent = String(this.totalSlides);
    }
    if (summaryActive) {
      summaryActive.textContent = `Slide ${this.slideIndex + 1}`;
    }
    const slideCount = this.mount.querySelector<HTMLElement>("#slideCount");
    if (slideCount) {
      slideCount.textContent = `${this.slideIndex + 1} / ${this.totalSlides}`;
    }
    this.setStatus(this.totalSlides ? `Slides: ${this.totalSlides}` : "No slides");
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
    if (next < 0) {
      this.slideIndex = 0;
      this.applySlideChange();
      return;
    }
    if (next >= this.totalSlides) {
      this.slideIndex = this.totalSlides - 1;
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
    host.textContent = "Table placeholder (coming soon).";
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
    this.logLine("Run inputs triggered.");
    this.appendExportLog("Run inputs triggered.");
    this.setStatus("Inputs run");
  };

  private handleBuild = (): void => {
    this.logLine("Build requested.");
    this.appendExportLog("Build requested.");
    this.setStatus("Build requested");
  };

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
    this.drawExampleFigure();
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
    this.cleanupGlobalListeners();
    this.stopHitTestLoop();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
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
}
