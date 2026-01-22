import { analysePageRegistry, getPageByAction, getPageById } from "./pageRegistry";
import type {
  AnalyseAction,
  AnalysePageAction,
  AnalysePageContext,
  AnalysePageId,
  AnalyseRoundId,
  AnalyseState,
  AnalyseToolAction
} from "./types";
import { AnalyseStore } from "./store";
import { ANALYSE_COLLECTION_KEY, DEFAULT_COLLECTION_NAME } from "./constants";
import { CoderPanel } from "../panels/coder/CoderPanel";
import type { CoderPayload } from "../panels/coder/coderTypes";

interface AnalyseWorkspaceOptions {
  initialState?: AnalyseState;
  dispatch: (action: AnalyseAction, payload?: Record<string, unknown>) => void;
}

interface AnalysePayload {
  id: string;
  title?: string;
  text?: string;
  html?: string;
  meta?: Record<string, unknown>;
  route?: string;
  runId?: string;
  page?: number;
  source?: string;
  type?: string;
}

export class AnalyseWorkspace {
  private root: HTMLElement;
  private headerEl: HTMLHeadingElement;
  private pageMount: HTMLElement;
  private toolDock: HTMLElement;
  public readonly element: HTMLElement;
  private store: AnalyseStore;
  private dispatch: (action: AnalyseAction, payload?: Record<string, unknown>) => void;
  private tools = new Map<string, HTMLElement>();
  private currentPayload?: AnalysePayload;
  private coderPanel?: CoderPanel;
  private coderScopeId?: string;

  constructor(root: HTMLElement, store: AnalyseStore, options: AnalyseWorkspaceOptions) {
    this.root = root;
    this.element = root;
    this.store = store;
    this.dispatch = options.dispatch;
    if (options.initialState) {
      this.store.update(options.initialState);
    }
    this.headerEl = document.createElement("h2");
    this.pageMount = document.createElement("div");
    this.toolDock = document.createElement("div");
    this.setupShell();
    this.openPageById(this.store.getState().activePageId);

    this.root.addEventListener("analyse-payload-selected", (event) => {
      const detail = (event as CustomEvent<AnalysePayload>).detail;
      this.currentPayload = detail;
      this.updateTools();
    });
  }

  public route(action: AnalyseAction, payload?: Record<string, unknown>): boolean {
    if (this.isPageAction(action)) {
      if (action === "analyse/open_phases") {
        const state = this.store.getState();
        console.log("[Analyse][Route] open_phases", {
          baseDir: state.baseDir,
          themesDir: state.themesDir,
          activeRunPath: state.activeRunPath,
          datasets: state.datasets
        });
      }
      this.openPageByAction(action, payload);
      return true;
    }
    if (action === "analyse/open_pdf_viewer") {
      const asAny = (payload || {}) as any;
      const pl = asAny.payload || asAny;
      if (pl && pl.id) {
        this.currentPayload = pl as AnalysePayload;
      }
      const meta = (pl?.meta || {}) as Record<string, unknown>;
      const pdfPath =
        (meta?.pdf_path as string) ||
        (meta?.pdf as string) ||
        (pl as any)?.pdf_path ||
        (pl as any)?.source;
      const page = pl?.page as number | undefined;
      document.dispatchEvent(
        new CustomEvent("analyse-render-pdf", {
          detail: {
            payload: pl,
            pdfPath,
            page,
            title: pl?.title || pl?.id,
            route: pl?.route,
            meta
          }
        })
      );
      return true;
    }
    if (this.isToolAction(action)) {
      if (payload) {
        const asAny = payload as any;
        if (asAny.payload && asAny.payload.id) {
          this.currentPayload = asAny.payload as AnalysePayload;
        } else if (asAny.id) {
          this.currentPayload = asAny as AnalysePayload;
        }
      }
      this.openTool(action);
      return true;
    }
    return false;
  }

  public openPageById(id: AnalysePageId, payload?: Record<string, unknown>): void {
    const def = getPageById(id);
    if (!def) {
      this.renderMissing(`Page id ${id}`);
      return;
    }
    this.openPage(def.action, def.label, payload);
  }

  public openPageByAction(action: AnalysePageAction, payload?: Record<string, unknown>): void {
    const def = getPageByAction(action);
    if (!def) {
      this.renderMissing(`Action ${action}`);
      return;
    }
    if (action.startsWith("analyse/open_sections_") || action === "analyse/open_phases") {
      const state = this.store.getState();
      console.info("[analyse][route]", {
        action,
        baseDir: state.baseDir,
        themesDir: state.themesDir,
        activeRunPath: state.activeRunPath,
        datasets: state.datasets
      });
    }
    this.openPage(def.action, def.label, payload);
  }

  private openPage(action: AnalysePageAction, label: string, payload?: Record<string, unknown>): void {
    const def = getPageByAction(action);
    if (!def) {
      this.renderMissing(`Action ${action}`);
      return;
    }
    const round = this.roundFromAction(def.action);
    const roundPatch =
      round !== null
        ? { activeRound: round }
        : def.id === "corpus" || def.id === "batches"
        ? { activeRound: "r1" as AnalyseRoundId }
        : {};
    this.store.update({ activePageId: def.id, lastAction: action, lastPayload: payload, ...roundPatch });
    this.headerEl.textContent = label;
    this.pageMount.innerHTML = "";
    const ctx: AnalysePageContext = {
      updateState: (patch) => this.store.update(patch),
      dispatch: (nextAction, nextPayload) => this.dispatch(nextAction, nextPayload)
    };
    def.render(this.pageMount, this.store.getState(), ctx);
  }

  private setupShell(): void {
    this.root.innerHTML = "";
    this.root.classList.add("analyse-shell");

    const headerWrap = document.createElement("div");
    headerWrap.className = "analyse-header";
    headerWrap.appendChild(this.headerEl);

    this.pageMount.className = "analyse-page";

    this.toolDock.className = "tool-dock";

    this.root.appendChild(headerWrap);
    this.root.appendChild(this.pageMount);
    this.root.appendChild(this.toolDock);
  }

  private renderMissing(reason: string): void {
    this.pageMount.innerHTML = "";
    const div = document.createElement("div");
    div.className = "empty-state";
    div.textContent = `No page mapped for ${reason}.`;
    this.pageMount.appendChild(div);
  }

  private isPageAction(action: AnalyseAction): action is AnalysePageAction {
    return analysePageRegistry.some((page) => page.action === action);
  }

  private isToolAction(action: AnalyseAction): action is AnalyseToolAction {
    return action === "analyse/open_coder" || action === "analyse/open_pdf_viewer" || action === "analyse/open_preview";
  }

  private roundFromAction(action: AnalysePageAction): AnalyseRoundId | null {
    if (action.endsWith("_r1")) return "r1";
    if (action.endsWith("_r2")) return "r2";
    if (action.endsWith("_r3")) return "r3";
    return null;
  }

  private openTool(action: AnalyseToolAction): void {
    const key = action;
    let panel = this.tools.get(key);
    if (!panel) {
      panel = this.createToolPanel(key);
      this.tools.set(key, panel);
      this.toolDock.appendChild(panel);
    }
    this.renderTool(panel, key);
    panel.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  private createToolPanel(type: AnalyseToolAction): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "tool-panel";
    panel.dataset.toolType = type;

    const heading = document.createElement("div");
    heading.className = "tool-panel__head";
    const title = document.createElement("h4");
    title.textContent = this.labelForTool(type);
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "×";
    close.addEventListener("click", () => {
      this.tools.delete(type);
      panel.remove();
    });
    heading.appendChild(title);
    heading.appendChild(close);
    panel.appendChild(heading);

    const body = document.createElement("div");
    body.className = "tool-panel__body";
    panel.appendChild(body);

    return panel;
  }

  private labelForTool(type: AnalyseToolAction): string {
    switch (type) {
      case "analyse/open_coder":
        return "Coder";
      case "analyse/open_pdf_viewer":
        return "PDF Viewer";
      case "analyse/open_preview":
        return "Preview";
      default:
        return type;
    }
  }

  private stripHtml(html?: string, limit = 400): string {
    if (!html) return "";
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    const text = tmp.textContent || tmp.innerText || "";
    return text.length > limit ? `${text.slice(0, limit)}` : text;
  }

  private renderTool(panel: HTMLElement, type: AnalyseToolAction): void {
    const body = panel.querySelector(".tool-panel__body") as HTMLElement;
    body.innerHTML = "";
    if (!this.currentPayload) {
      body.textContent = "Select a batch payload or section to view.";
      return;
    }
    switch (type) {
      case "analyse/open_preview":
        this.renderPreview(body, this.currentPayload);
        break;
      case "analyse/open_pdf_viewer":
        this.renderPdf(body, this.currentPayload);
        break;
      case "analyse/open_coder":
        this.renderCoder(body, this.currentPayload);
        break;
    }
  }

  private renderPreview(body: HTMLElement, payload: AnalysePayload): void {
    const title = document.createElement("h5");
    title.textContent = payload.title || payload.id;
    const content = document.createElement("div");
    content.className = "preview-content";
    content.textContent = payload.text || this.stripHtml(payload.html) || "(no content)";
    body.appendChild(title);
    body.appendChild(content);
  }

  private renderPdf(body: HTMLElement, payload: AnalysePayload): void {
    const preferredPanel =
      (rawPayload as any)?.preferredPanel ??
      (rawPayload as any)?.meta?.preferredPanel ??
      4;
    // We now render PDFs only in Panel 4 (or a preferred panel); just show a hint here.
    body.innerHTML = "";
    const info = document.createElement("div");
    info.className = "status-bar";
    info.textContent = `Opening PDF in Panel ${preferredPanel}…`;
    body.appendChild(info);
    const rawPayload = (payload as any).raw || payload;
    console.info("[analyse][pdf][raw-payload]", rawPayload);
    document.dispatchEvent(
      new CustomEvent("analyse-render-pdf", {
        detail: {
          payload: rawPayload,
          pdfPath:
            (rawPayload.meta?.pdf_path as string) ||
            (rawPayload.meta?.pdf as string) ||
            (rawPayload as any)?.pdf_path ||
            rawPayload.source,
          page: rawPayload.page,
          title: rawPayload.title || rawPayload.id,
          text: rawPayload.text,
          dqid: (rawPayload.meta as any)?.dqid || rawPayload.id,
          preferredPanel
        }
      })
    );
  }

  private renderCoder(body: HTMLElement, payload: AnalysePayload): void {
    const scopeId = this.computeCoderScope();
    if (!this.coderPanel || this.coderScopeId !== scopeId) {
      this.coderPanel = new CoderPanel({
        scopeId,
        onPayloadSelected: (p) => this.dispatchCoderSelection(p),
        onStateLoaded: (info) => {
          console.info(`[Analyse][Coder] scope=${scopeId} state=${info.statePath}`);
        }
      });
      this.coderScopeId = scopeId;
    }

    body.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "status-bar";
    const summary = document.createElement("div");
    summary.textContent = payload.title || payload.id;
    summary.style.fontWeight = "600";
    summary.style.flex = "1";
    const addBtn = document.createElement("button");
    addBtn.className = "ribbon-button";
    addBtn.textContent = "Capture selection";
    addBtn.addEventListener("click", () => this.coderPanel?.addPayload(this.mapToCoderPayload(payload)));
    bar.append(summary, addBtn);

    body.append(bar, this.coderPanel.element);
  }

  private mapToCoderPayload(payload: AnalysePayload): CoderPayload {
    return {
      title: payload.title || payload.id,
      text: payload.text,
      html: payload.html,
      section_html: payload.html,
      source: payload.source,
      meta: payload.meta,
      runId: payload.runId,
      page: payload.page,
      id: payload.id
    } as CoderPayload;
  }

  private dispatchCoderSelection(payload: CoderPayload): void {
    const evt = new CustomEvent("analyse-payload-selected", { detail: payload });
    this.root.dispatchEvent(evt);
  }

  private computeCoderScope(): string {
    const state = this.store.getState();
    const collection = state.collection || this.readStoredCollection();
    const parts: string[] = [];
    if (collection) {
      parts.push(collection);
    }
    if (state.activeRunId) {
      parts.push(state.activeRunId);
    }
    return parts.length ? parts.join("::") : "global";
  }

  private readStoredCollection(): string {
    try {
      return window.localStorage.getItem(ANALYSE_COLLECTION_KEY) || DEFAULT_COLLECTION_NAME;
    } catch {
      return DEFAULT_COLLECTION_NAME;
    }
  }

  private updateTools(): void {
    this.tools.forEach((panel, key) => {
      this.renderTool(panel, key as AnalyseToolAction);
    });
  }
}
