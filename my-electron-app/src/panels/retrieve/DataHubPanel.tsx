import { command } from "../../ribbon/commandDispatcher";
import type { DataHubLoadResult, DataHubTable } from "../../shared/types/dataHub";
import { DataGrid } from "./DataGrid";

type DataHubAction =
  | "datahub_load_zotero"
  | "datahub_load_zotero_multi"
  | "datahub_load_file"
  | "datahub_export_csv"
  | "datahub_export_excel"
  | "datahub_clear_cache"
  | "datahub_resolve_na"
  | "datahub_flag_na"
  | "datahub_codebook"
  | "datahub_codes"
  | "datahub_list_collections"
  | "datahub_zotero_tree"
  | "datahub_zotero_items"
  | "datahub_zotero_count";

type DataHubRestoreState = {
  sourceType: "file" | "zotero";
  filePath?: string;
  collectionName?: string;
  table?: DataHubTable;
  loadedAt?: string;
};

export class DataHubPanel {
  readonly element: HTMLElement;
  private statusLine: HTMLElement;
  private grid: DataGrid;
  private currentTable?: DataHubTable;
  private commandHandler: (event: Event) => void;
  private restoreHandler: (event: Event) => void;
  private persistTimer: number | null = null;
  private lastSource?: DataHubLoadResult["source"];
  private columnKinds: Array<"number" | "boolean" | "string"> = [];
  private zoteroModal?: HTMLElement;
  private zoteroPanel?: HTMLElement;
  private zoteroTreeHost?: HTMLElement;
  private zoteroTreeViewport?: HTMLElement;
  private zoteroItemsHost?: HTMLElement;
  private zoteroItemsViewport?: HTMLElement;
  private zoteroItemsList?: HTMLElement;
  private zoteroItemsDetail?: HTMLElement;
  private zoteroSearch?: HTMLInputElement;
  private zoteroStatus?: HTMLElement;
  private zoteroSummary?: HTMLElement;
  private zoteroProfile?: HTMLElement;
  private zoteroCollections: Array<{ key: string; name: string; parentKey?: string | null }> = [];
  private zoteroSelected = new Set<string>();
  private zoteroExpanded = new Set<string>();
  private zoteroPreviewKey?: string;
  private zoteroPreviewItemKey?: string;
  private zoteroCounts = new Map<string, number>();
  private zoteroCountPending = new Set<string>();
  private zoteroCollapsed = false;
  private zoteroPersistTimer: number | null = null;
  private readonly zoteroStateKey = "teia.zotero.state";
  private zoteroTreeRows: Array<{
    node: { key: string; name: string };
    depth: number;
    childrenCount: number;
    expanded: boolean;
    state: "all" | "partial" | "none";
  }> = [];
  private zoteroItemsData: Array<Record<string, any>> = [];
  private readonly zoteroTreeRowHeight = 28;
  private readonly zoteroItemsRowHeight = 64;
  private zoteroTreeByParent = new Map<string | null, Array<{ key: string; name: string; parentKey?: string | null }>>();
  private zoteroSelectionMemo = new Map<string, "all" | "partial" | "none">();
  private zoteroQuery = "";
  private zoteroIcons: Record<string, string> = {
    chevronRight:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronDown:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dot: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
    refresh:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13 3.8V7h-3.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 7a5.4 5.4 0 1 1-1.6-3.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    check:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8.5l2.6 2.5L12 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    minus:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
    folder:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6.5h6l1.5 2h7.5v6.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1z" fill="currentColor" opacity="0.2"/><path d="M3 5.5a1 1 0 0 1 1-1h4l1.4 1.6H16a1 1 0 0 1 1 1v1H2V5.5z" fill="currentColor"/></svg>',
    folderOpen:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 7.5h15.3l-1.2 7.1a1 1 0 0 1-1 .9H4.3a1 1 0 0 1-1-.8z" fill="currentColor" opacity="0.2"/><path d="M3 5.5a1 1 0 0 1 1-1h4l1.4 1.6H16a1 1 0 0 1 1 1v1H2V5.5z" fill="currentColor"/></svg>',
    collection:
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 5.5h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" fill="currentColor" opacity="0.2"/><path d="M5 7h10v2H5z" fill="currentColor"/><path d="M5 11h6v2H5z" fill="currentColor"/></svg>'
  };

  constructor() {
    this.element = document.createElement("section");
    this.element.className = "retrieve-datahub";

    const header = document.createElement("div");
    header.className = "retrieve-datahub-header";
    const title = document.createElement("h5");
    title.textContent = "Data Hub";
    this.statusLine = document.createElement("div");
    this.statusLine.className = "retrieve-datahub-status";
    this.statusLine.textContent = "Use the Retrieve ribbon to load, tidy, and export data.";
    header.append(title, this.statusLine);

    this.grid = new DataGrid({
      onCellEdit: (rowIndex, colIndex, value) => this.handleCellEdit(rowIndex, colIndex, value),
      onSortChange: () => this.handleGridSortChange()
    });

    this.element.append(header, this.grid.element);

    this.commandHandler = (event: Event) => {
      const detail = (event as CustomEvent).detail as { action?: DataHubAction; payload?: Record<string, unknown> };
      if (!detail?.action) {
        return;
      }
      void this.handleRibbonAction(detail.action, detail.payload);
    };
    document.addEventListener("retrieve-datahub-command", this.commandHandler);

    this.restoreHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: DataHubRestoreState }>).detail;
      if (!detail?.state) {
        return;
      }
      void this.restoreState(detail.state);
    };
    document.addEventListener("retrieve:datahub-restore", this.restoreHandler);

    const initialState = (window as unknown as { __retrieveDataHubState?: DataHubRestoreState })
      .__retrieveDataHubState;
    if (initialState) {
      void this.restoreState(initialState);
    }
  }

  destroy(): void {
    document.removeEventListener("retrieve-datahub-command", this.commandHandler);
    document.removeEventListener("retrieve:datahub-restore", this.restoreHandler);
    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    if (this.zoteroPersistTimer) {
      window.clearTimeout(this.zoteroPersistTimer);
      this.zoteroPersistTimer = null;
    }
    this.grid.destroy();
  }

  private async handleRibbonAction(action: DataHubAction, payload?: Record<string, unknown>): Promise<void> {
    switch (action) {
      case "datahub_load_zotero":
        await this.openZoteroPicker(payload);
        return;
      case "datahub_load_zotero_multi":
        await this.runCommand("datahub_load_zotero_multi", payload);
        return;
      case "datahub_load_file":
        await this.loadFile(payload);
        return;
      case "datahub_export_csv":
        await this.exportCsv(payload);
        return;
      case "datahub_export_excel":
        await this.exportExcel(payload);
        return;
      case "datahub_clear_cache":
        await this.clearCache(payload);
        return;
      case "datahub_resolve_na":
        await this.resolveNa(payload);
        return;
      case "datahub_flag_na":
        this.toggleFlagNa();
        return;
      case "datahub_codebook":
        await this.applyCodebook(payload);
        return;
      case "datahub_codes":
        await this.applyCodes(payload);
        return;
      case "datahub_list_collections":
        await this.listCollections();
        return;
      case "datahub_zotero_tree":
      case "datahub_zotero_items":
        return;
    }
  }

  private async openZoteroPicker(payload?: Record<string, unknown>): Promise<void> {
    await this.ensureZoteroModal();
    this.updateZoteroStatus("Loading collections…", "loading");
    const res = (await command("retrieve", "datahub_zotero_tree", payload)) as any;
    if (!res || res.status === "error") {
      this.updateZoteroStatus(res?.message ?? "Failed to load Zotero collections.", "error");
      return;
    }
    this.zoteroCollections = Array.isArray(res.collections) ? res.collections : [];
    this.applyZoteroProfile(res?.profile);
    this.restoreZoteroState();
    this.pruneZoteroSelections();
    const lastKey =
      (payload?.collectionKey as string) ||
      (payload?.collectionName as string) ||
      (this.lastSource?.collectionName as string) ||
      "";
    if (!this.zoteroSelected.size && lastKey) {
      const resolved = this.resolveZoteroKey(lastKey) ?? lastKey;
      this.zoteroSelected.add(resolved);
      this.zoteroPreviewKey = resolved;
      void this.loadZoteroPreview(resolved);
    }
    this.updateZoteroStatus(`Loaded ${this.zoteroCollections.length} collections.`, "info");
    this.renderZoteroTree();
    this.showZoteroModal(true);
  }

  private async loadFile(payload?: Record<string, unknown>): Promise<void> {
    await this.runCommand("datahub_load_file", payload);
  }

  private async exportCsv(payload?: Record<string, unknown>): Promise<void> {
    if (!this.currentTable) {
      this.updateStatus("No data available to export.");
      return;
    }
    await this.runCommand("datahub_export_csv", {
      ...(payload ?? {}),
      table: this.currentTable
    });
  }

  private async exportExcel(payload?: Record<string, unknown>): Promise<void> {
    if (!this.currentTable) {
      this.updateStatus("No data available to export.");
      return;
    }
    await this.runCommand("datahub_export_excel", {
      ...(payload ?? {}),
      table: this.currentTable
    });
  }

  private async clearCache(payload?: Record<string, unknown>): Promise<void> {
    await this.runCommand("datahub_clear_cache", {
      ...(payload ?? {})
    });
  }

  private async resolveNa(payload?: Record<string, unknown>): Promise<void> {
    if (!this.currentTable) {
      this.updateStatus("Load data before resolving NA values.");
      return;
    }
    const replacement = window.prompt("Replacement for empty values", "Unknown") ?? "Unknown";
    const columns = this.promptColumns("Resolve NA in columns (comma separated). Leave blank for all.");
    await this.runCommand("datahub_resolve_na", {
      ...(payload ?? {}),
      table: this.currentTable,
      ...(columns ? { columns } : {}),
      replacement
    });
  }

  private async applyCodebook(payload?: Record<string, unknown>): Promise<void> {
    if (!this.currentTable) {
      this.updateStatus("Load data before applying a codebook.");
      return;
    }
    const columns = this.promptColumns("Codebook columns (comma separated)");
    if (!columns || columns.length === 0) {
      this.updateStatus("Codebook unchanged (no columns provided).");
      return;
    }
    await this.runCommand("datahub_codebook", {
      ...(payload ?? {}),
      table: this.currentTable,
      columns
    });
  }

  private async applyCodes(payload?: Record<string, unknown>): Promise<void> {
    if (!this.currentTable) {
      this.updateStatus("Load data before applying coding columns.");
      return;
    }
    const columns = this.promptColumns("Coding columns (comma separated)");
    if (!columns || columns.length === 0) {
      this.updateStatus("Coding columns unchanged (no columns provided).");
      return;
    }
    await this.runCommand("datahub_codes", {
      ...(payload ?? {}),
      table: this.currentTable,
      columns
    });
  }

  private async listCollections(): Promise<void> {
    await this.runCommand("datahub_list_collections");
  }

  private promptColumns(message: string): string[] | undefined {
    if (!this.currentTable) {
      return undefined;
    }
    const existing = this.currentTable.columns.join(", ");
    const raw = window.prompt(`${message}\n\nAvailable: ${existing}`);
    if (raw === null) {
      return undefined;
    }
    const columns = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    return columns.length > 0 ? columns : undefined;
  }

  private async runCommand(action: DataHubAction, payload?: Record<string, unknown>): Promise<void> {
    console.info("[retrieve][datahub] sending action", action, payload);
    this.updateStatus("Working...");
    try {
      const response = (await command("retrieve", action, payload)) as unknown as
        | (DataHubLoadResult & Record<string, unknown>)
        | undefined;
      if (!response) {
        console.warn("[retrieve][datahub] no response");
        this.updateStatus("No response from backend.");
        return;
      }
      if (response.status === "error") {
        console.error("[retrieve][datahub] backend error", response);
        this.updateStatus(String(response.message ?? "Request failed."));
        return;
      }
      if (response.status === "canceled") {
        console.warn("[retrieve][datahub] backend canceled", response);
        this.updateStatus(String(response.message ?? "Operation canceled."));
        return;
      }
      console.info("[retrieve][datahub] raw response", response);
      const appliedTable = this.applyResponseTable(response);
      const message = typeof response.message === "string" ? response.message : undefined;
      if (message) {
        this.updateStatus(message);
      } else if (appliedTable && this.currentTable) {
        this.updateStatus(`Loaded ${this.currentTable.rows.length} rows.`);
      } else if (!response.table) {
        this.updateStatus("Done.");
      }
    } catch (error) {
      console.error("Data hub command failed", error);
      this.updateStatus("Data hub request failed. See console for details.");
    }
  }

  private applyResponseTable(response: DataHubLoadResult & Record<string, unknown>): boolean {
    const directTable = response.table;
    const payloadTable =
      response.payload && typeof response.payload === "object"
        ? ((response.payload as Record<string, unknown>).table as DataHubTable | undefined)
        : undefined;
    const table = directTable ?? payloadTable;
    if (!table) {
      return false;
    }
    this.applyTable(table);
    this.persistState({ ...response, table });
    return true;
  }

  private applyTable(table: DataHubTable): void {
    this.currentTable = {
      columns: table.columns.slice(),
      rows: table.rows.map((row) => row.slice())
    };
    this.columnKinds = this.inferColumnKinds(this.currentTable);
    try {
      const preview = this.currentTable.rows.slice(0, 5).map((row) => {
        const rowPreview: Record<string, unknown> = {};
        this.currentTable?.columns.forEach((col, idx) => {
          rowPreview[col] = row[idx];
        });
        return rowPreview;
      });
      console.info("[retrieve][datahub] table loaded", {
        columns: this.currentTable.columns,
        rowCount: this.currentTable.rows.length,
        head: preview
      });
    } catch (error) {
      console.warn("[retrieve][datahub] failed to log table head", error);
    }
    this.grid.setData(this.currentTable.columns, this.currentTable.rows);
    // Bring the table into view when triggered from the ribbon.
    try {
      this.grid.element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      this.grid.focus();
    } catch {
      // ignore
    }
  }

  private persistState(response: DataHubLoadResult): void {
    const source = response.source;
    if (!source || !response.table) {
      return;
    }
    this.lastSource = source;
    const state: DataHubRestoreState = {
      sourceType: source.type,
      filePath: source.path,
      collectionName: source.collectionName,
      table: response.table,
      loadedAt: new Date().toISOString()
    };
    document.dispatchEvent(new CustomEvent("retrieve:datahub-updated", { detail: { state } }));
  }

  private async restoreState(state: DataHubRestoreState): Promise<void> {
    if (state.table) {
      this.lastSource = {
        type: state.sourceType,
        path: state.filePath,
        collectionName: state.collectionName
      };
      this.applyTable(state.table);
      this.updateStatus("Restored cached data.");
      return;
    }
    if (state.sourceType === "file" && state.filePath) {
      await this.runCommand("datahub_load_file", { filePath: state.filePath });
      return;
    }
    if (state.sourceType === "zotero") {
      await this.runCommand("datahub_load_zotero", { collectionName: state.collectionName ?? "" });
    }
  }

  private handleCellEdit(rowIndex: number, colIndex: number, value: string): void {
    if (!this.currentTable) {
      return;
    }
    if (!this.currentTable.rows[rowIndex]) {
      return;
    }
    const kind = this.columnKinds[colIndex] ?? "string";
    const trimmed = value.trim();
    if (!trimmed) {
      this.currentTable.rows[rowIndex][colIndex] = null;
    } else if (kind === "number") {
      const n = Number(trimmed);
      this.currentTable.rows[rowIndex][colIndex] = Number.isFinite(n) ? n : trimmed;
    } else if (kind === "boolean") {
      const lower = trimmed.toLowerCase();
      if (["true", "t", "yes", "y", "1"].includes(lower)) this.currentTable.rows[rowIndex][colIndex] = true;
      else if (["false", "f", "no", "n", "0"].includes(lower)) this.currentTable.rows[rowIndex][colIndex] = false;
      else this.currentTable.rows[rowIndex][colIndex] = trimmed;
    } else {
      this.currentTable.rows[rowIndex][colIndex] = trimmed;
    }
    this.schedulePersist();
  }

  private handleGridSortChange(): void {
    if (!this.currentTable) return;
    const next = this.grid.getData();
    this.currentTable = { columns: next.columns, rows: next.rows };
    this.schedulePersist();
  }

  private updateStatus(message: string): void {
    this.statusLine.textContent = message;
  }

  private toggleFlagNa(): void {
    if (!this.currentTable) {
      this.updateStatus("Load data before flagging NA values.");
      return;
    }
    const next = !this.grid.getFlagNa();
    this.grid.setFlagNa(next);
    const naCount = this.countNaCells(this.currentTable);
    const msg = next ? `Flagged NA cells (${naCount}).` : "NA flags cleared.";
    this.updateStatus(msg);
    console.info("[retrieve][datahub] flag NA", { enabled: next, naCount });
  }

  private countNaCells(table: DataHubTable): number {
    let count = 0;
    for (const row of table.rows) {
      for (const cell of row) {
        if (cell === null || cell === undefined) {
          count++;
          continue;
        }
        if (typeof cell === "string") {
          const s = cell.trim();
          if (!s || s.toLowerCase() === "nan" || s.toLowerCase() === "<na>") {
            count++;
          }
        }
      }
    }
    return count;
  }

  private schedulePersist(): void {
    if (!this.currentTable) return;
    if (this.persistTimer) {
      window.clearTimeout(this.persistTimer);
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = null;
      const source = this.lastSource;
      const state: DataHubRestoreState = {
        sourceType: source?.type ?? "file",
        filePath: source?.path,
        collectionName: source?.collectionName,
        table: this.currentTable!,
        loadedAt: new Date().toISOString()
      };
      document.dispatchEvent(new CustomEvent("retrieve:datahub-updated", { detail: { state } }));
    }, 400);
  }

  private inferColumnKinds(table: DataHubTable): Array<"number" | "boolean" | "string"> {
    const kinds: Array<"number" | "boolean" | "string"> = table.columns.map(() => "string");
    const limit = Math.min(table.rows.length, 200);
    for (let c = 0; c < table.columns.length; c++) {
      let seen = 0;
      let numbers = 0;
      let bools = 0;
      for (let r = 0; r < limit; r++) {
        const v = table.rows[r]?.[c];
        if (v === null || v === undefined || v === "") continue;
        seen++;
        if (typeof v === "number" && Number.isFinite(v)) numbers++;
        else if (typeof v === "boolean") bools++;
        else if (typeof v === "string") {
          const s = v.trim();
          if (!s) continue;
          const n = Number(s);
          if (!Number.isNaN(n) && Number.isFinite(n)) numbers++;
          if (["true", "false", "t", "f", "yes", "no", "y", "n", "0", "1"].includes(s.toLowerCase())) bools++;
        }
      }
      if (seen === 0) {
        kinds[c] = "string";
      } else if (bools / seen >= 0.8) {
        kinds[c] = "boolean";
      } else if (numbers / seen >= 0.8) {
        kinds[c] = "number";
      } else {
        kinds[c] = "string";
      }
    }
    return kinds;
  }

  private async ensureZoteroModal(): Promise<void> {
    if (this.zoteroModal) {
      return;
    }
    const panel = document.createElement("div");
    panel.className = "zotero-picker";
    panel.style.display = "none";
    this.zoteroPanel = panel;

    const header = document.createElement("div");
    header.className = "zotero-picker-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "zotero-picker-title";
    const title = document.createElement("h4");
    title.textContent = "Zotero Collections";
    title.style.margin = "0";
    const subtitle = document.createElement("div");
    subtitle.className = "zotero-picker-subtitle";
    subtitle.textContent = "Library not connected.";
    this.zoteroProfile = subtitle;
    titleWrap.append(title, subtitle);
    const collapse = document.createElement("button");
    collapse.className = "ribbon-button";
    collapse.textContent = "Collapse";
    collapse.addEventListener("click", () => {
      this.zoteroCollapsed = !this.zoteroCollapsed;
      collapse.textContent = this.zoteroCollapsed ? "Expand" : "Collapse";
      body.style.display = this.zoteroCollapsed ? "none" : "grid";
      searchRow.style.display = this.zoteroCollapsed ? "none" : "flex";
      footer.style.display = this.zoteroCollapsed ? "none" : "flex";
    });
    const close = document.createElement("button");
    close.className = "ribbon-button";
    close.textContent = "Close";
    close.addEventListener("click", () => this.showZoteroModal(false));
    header.append(titleWrap, collapse, close);

    const searchRow = document.createElement("div");
    searchRow.className = "zotero-picker-search";
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search collections…";
    search.addEventListener("input", () => {
      this.renderZoteroTree();
      this.scheduleZoteroPersist();
    });
    this.zoteroSearch = search;
    const selectAll = document.createElement("button");
    selectAll.className = "ribbon-button";
    selectAll.textContent = "Select All";
    selectAll.addEventListener("click", () => this.selectAllZotero(true));
    const clearAll = document.createElement("button");
    clearAll.className = "ribbon-button";
    clearAll.textContent = "Clear";
    clearAll.addEventListener("click", () => this.selectAllZotero(false));
    const expandAll = document.createElement("button");
    expandAll.className = "ribbon-button";
    expandAll.textContent = "Expand";
    expandAll.addEventListener("click", () => this.expandAllZotero(true));
    const collapseAll = document.createElement("button");
    collapseAll.className = "ribbon-button";
    collapseAll.textContent = "Collapse";
    collapseAll.addEventListener("click", () => this.expandAllZotero(false));
    const purge = document.createElement("button");
    purge.className = "ribbon-button";
    purge.textContent = "Purge Cache";
    purge.addEventListener("click", () => void this.purgeZoteroCache());
    searchRow.append(search, selectAll, clearAll, expandAll, collapseAll);
    searchRow.append(purge);

    const body = document.createElement("div");
    body.className = "zotero-picker-body";

    const treePane = document.createElement("div");
    treePane.className = "zotero-tree";
    const treeInner = document.createElement("div");
    treeInner.className = "zotero-tree-inner";
    treePane.appendChild(treeInner);
    this.zoteroTreeViewport = treePane;
    this.zoteroTreeHost = treeInner;
    treePane.addEventListener("scroll", () => this.renderZoteroTreeSlice());

    const itemsPane = document.createElement("div");
    itemsPane.className = "zotero-items";
    this.zoteroItemsHost = itemsPane;

    body.append(treePane, itemsPane);

    const footer = document.createElement("div");
    footer.className = "zotero-picker-footer";
    const status = document.createElement("div");
    status.className = "zotero-picker-status";
    this.zoteroStatus = status;
    const summary = document.createElement("div");
    summary.className = "zotero-picker-summary";
    this.zoteroSummary = summary;

    const actions = document.createElement("div");
    actions.className = "zotero-picker-actions";
    const loadBtn = document.createElement("button");
    loadBtn.className = "ribbon-button";
    loadBtn.textContent = "Load Selected";
    loadBtn.addEventListener("click", () => void this.loadSelectedZoteroCollections({ cache: true }));
    const loadFresh = document.createElement("button");
    loadFresh.className = "ribbon-button";
    loadFresh.textContent = "Load Fresh";
    loadFresh.addEventListener("click", () => void this.loadSelectedZoteroCollections({ cache: false }));
    actions.append(loadBtn, loadFresh);

    footer.append(status, summary, actions);

    panel.append(header, searchRow, body, footer);
    this.element.insertBefore(panel, this.grid.element);
    this.zoteroModal = panel;
  }

  private showZoteroModal(show: boolean): void {
    if (!this.zoteroModal) return;
    this.zoteroModal.style.display = show ? "block" : "none";
    if (show) {
      try {
        this.zoteroModal.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        // ignore
      }
    }
  }

  private updateZoteroStatus(message: string, tone: "info" | "error" | "success" | "loading" = "info"): void {
    if (this.zoteroStatus) {
      this.zoteroStatus.textContent = message;
      this.zoteroStatus.setAttribute("data-tone", tone);
    }
    if (this.zoteroPanel) {
      this.zoteroPanel.classList.toggle("is-loading", tone === "loading");
    }
  }

  private updateZoteroSummary(): void {
    if (this.zoteroSummary) {
      this.zoteroSummary.textContent = `${this.zoteroSelected.size} selected • ${this.zoteroCollections.length} collections`;
    }
  }

  private applyZoteroProfile(profile?: { libraryId?: string; libraryType?: string }): void {
    if (!this.zoteroProfile) return;
    if (!profile?.libraryId) {
      this.zoteroProfile.textContent = "Library not connected.";
      return;
    }
    const libType = profile.libraryType ?? "user";
    this.zoteroProfile.textContent = `Library: ${libType} • ${profile.libraryId}`;
  }

  private resolveZoteroKey(target: string): string | undefined {
    if (!target) return undefined;
    const normalized = target.replace(/\s+/g, "").toLowerCase();
    const match =
      this.zoteroCollections.find((c) => c.key === target) ||
      this.zoteroCollections.find((c) => c.name === target) ||
      this.zoteroCollections.find((c) => c.name.replace(/\s+/g, "").toLowerCase() === normalized);
    return match?.key;
  }

  private pruneZoteroSelections(): void {
    if (!this.zoteroCollections.length) return;
    const keys = new Set(this.zoteroCollections.map((c) => c.key));
    for (const key of Array.from(this.zoteroSelected)) {
      if (!keys.has(key)) this.zoteroSelected.delete(key);
    }
    for (const key of Array.from(this.zoteroExpanded)) {
      if (!keys.has(key)) this.zoteroExpanded.delete(key);
    }
    if (this.zoteroPreviewKey && !keys.has(this.zoteroPreviewKey)) {
      this.zoteroPreviewKey = undefined;
    }
  }

  private restoreZoteroState(): void {
    try {
      const raw = window.localStorage.getItem(this.zoteroStateKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        selected?: string[];
        expanded?: string[];
        previewKey?: string;
        previewItemKey?: string;
        search?: string;
      };
      if (Array.isArray(parsed.selected)) {
        this.zoteroSelected = new Set(parsed.selected);
      }
      if (Array.isArray(parsed.expanded)) {
        this.zoteroExpanded = new Set(parsed.expanded);
      }
      if (parsed.previewKey) {
        this.zoteroPreviewKey = parsed.previewKey;
      }
      if (parsed.previewItemKey) {
        this.zoteroPreviewItemKey = parsed.previewItemKey;
      }
      if (this.zoteroSearch && typeof parsed.search === "string") {
        this.zoteroSearch.value = parsed.search;
      }
    } catch {
      /* ignore restore errors */
    }
  }

  private scheduleZoteroPersist(): void {
    if (this.zoteroPersistTimer) {
      window.clearTimeout(this.zoteroPersistTimer);
    }
    this.zoteroPersistTimer = window.setTimeout(() => this.persistZoteroState(), 200);
  }

  private persistZoteroState(): void {
    try {
      const payload = {
        selected: Array.from(this.zoteroSelected),
        expanded: Array.from(this.zoteroExpanded),
        previewKey: this.zoteroPreviewKey,
        previewItemKey: this.zoteroPreviewItemKey,
        search: this.zoteroSearch?.value ?? ""
      };
      window.localStorage.setItem(this.zoteroStateKey, JSON.stringify(payload));
    } catch {
      /* ignore persist errors */
    }
  }

  private renderHighlightedLabel(label: HTMLElement, text: string, query: string): void {
    label.innerHTML = "";
    if (!query) {
      label.textContent = text;
      return;
    }
    const lower = text.toLowerCase();
    const idx = lower.indexOf(query);
    if (idx === -1) {
      label.textContent = text;
      return;
    }
    label.append(document.createTextNode(text.slice(0, idx)));
    const mark = document.createElement("mark");
    mark.className = "zotero-highlight";
    mark.textContent = text.slice(idx, idx + query.length);
    label.append(mark, document.createTextNode(text.slice(idx + query.length)));
  }

  private getZoteroSelectionState(key: string): "all" | "partial" | "none" {
    if (this.zoteroSelectionMemo.has(key)) {
      return this.zoteroSelectionMemo.get(key)!;
    }
    const children = this.zoteroTreeByParent.get(key) || [];
    const selfSelected = this.zoteroSelected.has(key);
    if (!children.length) {
      const state = selfSelected ? "all" : "none";
      this.zoteroSelectionMemo.set(key, state);
      return state;
    }
    let allChildren = true;
    let any = selfSelected;
    children.forEach((child) => {
      const state = this.getZoteroSelectionState(child.key);
      if (state !== "all") allChildren = false;
      if (state !== "none") any = true;
    });
    const state = allChildren ? "all" : any ? "partial" : "none";
    this.zoteroSelectionMemo.set(key, state);
    return state;
  }

  private applyZoteroSelection(key: string, select: boolean): void {
    const stack = [key];
    const keys: string[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      keys.push(current);
      const children = this.zoteroTreeByParent.get(current) || [];
      children.forEach((child) => stack.push(child.key));
    }
    keys.forEach((k) => {
      if (select) this.zoteroSelected.add(k);
      else this.zoteroSelected.delete(k);
    });
  }

  private renderZoteroTree(): void {
    if (!this.zoteroTreeHost) return;
    this.zoteroTreeHost.innerHTML = "";
    const query = (this.zoteroSearch?.value || "").trim().toLowerCase();
    this.zoteroQuery = query;
    const forceExpand = query.length > 0;
    const byParent = new Map<string | null, Array<{ key: string; name: string; parentKey?: string | null }>>();
    this.zoteroCollections.forEach((c) => {
      const parent = c.parentKey || null;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent)!.push(c);
    });
    this.zoteroTreeByParent = byParent;
    this.zoteroSelectionMemo.clear();

    const hasMatch = (node: { key: string; name: string; parentKey?: string | null }): boolean => {
      if (!query) return true;
      if (node.name.toLowerCase().includes(query) || node.key.toLowerCase().includes(query)) return true;
      const children = byParent.get(node.key) || [];
      return children.some(hasMatch);
    };

    const rows: typeof this.zoteroTreeRows = [];
    const renderNode = (node: { key: string; name: string }, depth: number) => {
      if (!hasMatch(node)) return;
      const children = byParent.get(node.key) || [];
      const expanded = forceExpand || this.zoteroExpanded.has(node.key);
      const state = this.getZoteroSelectionState(node.key);
      rows.push({ node, depth, childrenCount: children.length, expanded, state });
      if (children.length && expanded) {
        children.forEach((child) => renderNode(child, depth + 1));
      }
    };

    const roots = byParent.get(null) || [];
    roots.sort((a, b) => a.name.localeCompare(b.name)).forEach((node) => renderNode(node, 0));
    this.zoteroTreeRows = rows;
    this.renderZoteroTreeSlice(query);
    this.updateZoteroSummary();
    this.scheduleZoteroPersist();
  }

  private renderZoteroTreeSlice(query = this.zoteroQuery): void {
    if (!this.zoteroTreeHost || !this.zoteroTreeViewport) return;
    const rows = this.zoteroTreeRows;
    const total = rows.length;
    const rowHeight = this.zoteroTreeRowHeight;
    const scrollTop = this.zoteroTreeViewport.scrollTop;
    const viewportHeight = this.zoteroTreeViewport.clientHeight || 0;
    if (!total) {
      this.zoteroTreeHost.style.height = `${rowHeight}px`;
      this.zoteroTreeHost.innerHTML = "<div class=\"zotero-tree-empty\">No collections found.</div>";
      return;
    }
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 6);
    const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 6);
    this.zoteroTreeHost.style.height = `${Math.max(total * rowHeight, rowHeight)}px`;
    this.zoteroTreeHost.innerHTML = "";
    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i += 1) {
      const rowData = rows[i];
      const row = document.createElement("div");
      row.className = "zotero-tree-row";
      row.style.position = "absolute";
      row.style.top = `${i * rowHeight}px`;
      row.style.left = "0";
      row.style.right = "0";
      row.style.paddingLeft = `${rowData.depth * 14 + 6}px`;
      if (this.zoteroPreviewKey === rowData.node.key) {
        row.classList.add("is-active");
      }

      const exp = document.createElement("span");
      exp.className = "zotero-tree-expander";
      exp.setAttribute("role", "button");
      exp.tabIndex = 0;
      const expIcon = document.createElement("span");
      expIcon.className = "zotero-icon";
      expIcon.innerHTML = rowData.childrenCount
        ? (rowData.expanded ? this.zoteroIcons.chevronDown : this.zoteroIcons.chevronRight)
        : this.zoteroIcons.dot;
      exp.appendChild(expIcon);
      exp.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!rowData.childrenCount) return;
        if (this.zoteroExpanded.has(rowData.node.key)) this.zoteroExpanded.delete(rowData.node.key);
        else this.zoteroExpanded.add(rowData.node.key);
        this.renderZoteroTree();
      });
      exp.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!rowData.childrenCount) return;
        if (this.zoteroExpanded.has(rowData.node.key)) this.zoteroExpanded.delete(rowData.node.key);
        else this.zoteroExpanded.add(rowData.node.key);
        this.renderZoteroTree();
      });

      const selectBtn = document.createElement("span");
      selectBtn.className = "zotero-tree-select";
      selectBtn.setAttribute("role", "button");
      selectBtn.tabIndex = 0;
      selectBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.applyZoteroSelection(rowData.node.key, rowData.state !== "all");
        this.renderZoteroTree();
      });
      selectBtn.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        this.applyZoteroSelection(rowData.node.key, rowData.state !== "all");
        this.renderZoteroTree();
      });
      const icon = document.createElement("span");
      icon.className = "zotero-icon zotero-icon-folder";
      icon.innerHTML = rowData.childrenCount
        ? (rowData.expanded ? this.zoteroIcons.folderOpen : this.zoteroIcons.folder)
        : this.zoteroIcons.collection;
      if (rowData.state !== "none") {
        icon.style.color = "var(--accent)";
      }
      selectBtn.appendChild(icon);

      const label = document.createElement("span");
      label.className = "zotero-tree-label";
      this.renderHighlightedLabel(label, rowData.node.name, query);
      if (rowData.state === "all") {
        const check = document.createElement("span");
        check.className = "zotero-icon zotero-icon-check";
        check.innerHTML = this.zoteroIcons.check;
        label.appendChild(check);
      } else if (rowData.state === "partial") {
        const partial = document.createElement("span");
        partial.className = "zotero-icon zotero-icon-check";
        partial.innerHTML = this.zoteroIcons.minus;
        label.appendChild(partial);
      }

      const badge = document.createElement("span");
      badge.className = "zotero-tree-count";
      if (this.zoteroCounts.has(rowData.node.key)) {
        badge.textContent = String(this.zoteroCounts.get(rowData.node.key));
      } else {
        badge.textContent = "…";
        this.requestZoteroCount(rowData.node.key);
      }

      const refresh = document.createElement("span");
      refresh.className = "zotero-tree-refresh zotero-icon";
      refresh.setAttribute("role", "button");
      refresh.tabIndex = 0;
      refresh.innerHTML = this.zoteroIcons.refresh;
      refresh.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.zoteroSelected.clear();
        this.zoteroSelected.add(rowData.node.key);
        void this.loadSelectedZoteroCollections({ cache: false, collectionKey: rowData.node.key });
      });
      refresh.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        this.zoteroSelected.clear();
        this.zoteroSelected.add(rowData.node.key);
        void this.loadSelectedZoteroCollections({ cache: false, collectionKey: rowData.node.key });
      });

      row.append(exp, selectBtn, label, badge, refresh);
      row.addEventListener("click", () => {
        this.zoteroPreviewKey = rowData.node.key;
        this.zoteroPreviewItemKey = undefined;
        void this.loadZoteroPreview(rowData.node.key);
        this.scheduleZoteroPersist();
      });
      row.addEventListener("dblclick", () => {
        this.zoteroSelected.clear();
        this.zoteroSelected.add(rowData.node.key);
        void this.loadSelectedZoteroCollections({ cache: true, collectionKey: rowData.node.key });
      });

      fragment.appendChild(row);
    }

    this.zoteroTreeHost.appendChild(fragment);
  }

  private async loadZoteroPreview(collectionKey: string): Promise<void> {
    if (!this.zoteroItemsHost) return;
    this.zoteroItemsHost.innerHTML = "<div class=\"zotero-items-empty\">Loading items…</div>";
    const res = (await command("retrieve", "datahub_zotero_items", { collectionKey })) as any;
    if (!res || res.status === "error") {
      this.zoteroItemsHost.innerHTML = `<div class="zotero-items-empty">${res?.message ?? "Failed to load items."}</div>`;
      return;
    }
    const items = Array.isArray(res.items) ? res.items : [];
    this.zoteroItemsData = items;
    const wrapper = document.createElement("div");
    wrapper.className = "zotero-items-pane";
    const header = document.createElement("div");
    header.className = "zotero-items-header";
    const collection = this.zoteroCollections.find((c) => c.key === collectionKey);
    header.textContent = collection ? `Items in ${collection.name}` : "Items";

    const listViewport = document.createElement("div");
    listViewport.className = "zotero-items-list";
    const listInner = document.createElement("div");
    listInner.className = "zotero-items-inner";
    listViewport.appendChild(listInner);
    listViewport.addEventListener("scroll", () => this.renderZoteroItemsList());
    this.zoteroItemsViewport = listViewport;
    this.zoteroItemsList = listInner;

    const detail = document.createElement("div");
    detail.className = "zotero-items-detail";
    detail.textContent = "Select an item to see details.";
    this.zoteroItemsDetail = detail;

    wrapper.append(header, listViewport, detail);
    this.zoteroItemsHost.innerHTML = "";
    this.zoteroItemsHost.appendChild(wrapper);
    this.renderZoteroItemsList();
  }

  private renderZoteroItemDetail(host: HTMLElement, item: Record<string, any>): void {
    host.innerHTML = "";
    const title = document.createElement("div");
    title.className = "zotero-detail-title";
    title.textContent = item.title || item.key || "Item";
    host.appendChild(title);

    const rows: Array<[string, string]> = [];
    if (item.authors) rows.push(["Authors", item.authors]);
    if (item.year) rows.push(["Date", item.year]);
    if (item.itemType) rows.push(["Type", item.itemType]);
    if (item.publicationTitle) rows.push(["Publication", item.publicationTitle]);
    if (item.doi) rows.push(["DOI", item.doi]);
    if (item.url) rows.push(["URL", item.url]);
    if (typeof item.attachments === "number" && item.attachments > 0)
      rows.push(["Attachments", String(item.attachments)]);
    if (typeof item.pdfs === "number" && item.pdfs > 0) rows.push(["PDFs", String(item.pdfs)]);

    rows.forEach(([labelText, value]) => {
      const row = document.createElement("div");
      row.className = "zotero-detail-row";
      const label = document.createElement("div");
      label.className = "zotero-detail-label";
      label.textContent = labelText;
      const val = document.createElement("div");
      val.className = "zotero-detail-value";
      val.textContent = value;
      row.append(label, val);
      host.appendChild(row);
    });

    if (item.abstract) {
      const abstract = document.createElement("div");
      abstract.className = "zotero-detail-abstract";
      abstract.textContent = item.abstract;
      host.appendChild(abstract);
    }

    if (item.url) {
      const actions = document.createElement("div");
      actions.className = "zotero-detail-actions";
      const openBtn = document.createElement("button");
      openBtn.className = "ribbon-button";
      openBtn.textContent = "Open URL";
      openBtn.addEventListener("click", () => {
        try {
          window.open(item.url, "_blank");
        } catch {
          // ignore
        }
      });
      actions.appendChild(openBtn);
      host.appendChild(actions);
    }
  }

  private renderZoteroItemsList(): void {
    if (!this.zoteroItemsViewport || !this.zoteroItemsList) return;
    const items = this.zoteroItemsData || [];
    const rowHeight = this.zoteroItemsRowHeight;
    const total = items.length;
    const scrollTop = this.zoteroItemsViewport.scrollTop;
    const viewportHeight = this.zoteroItemsViewport.clientHeight || 0;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 6);
    const end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 6);

    this.zoteroItemsList.style.height = `${Math.max(total * rowHeight, rowHeight)}px`;
    this.zoteroItemsList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    let preselected: any | undefined;

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "zotero-items-empty";
      empty.textContent = "No items found in this collection.";
      fragment.appendChild(empty);
      if (this.zoteroItemsDetail) {
        this.zoteroItemsDetail.textContent = "No items available.";
      }
    }

    for (let i = start; i < end; i += 1) {
      const item = items[i];
      if (!item) continue;
      const row = document.createElement("div");
      row.className = "zotero-item-row";
      row.style.position = "absolute";
      row.style.top = `${i * rowHeight}px`;
      row.style.left = "0";
      row.style.right = "0";
      if (this.zoteroPreviewItemKey === item.key) {
        row.classList.add("is-active");
        preselected = item;
      }

      const title = document.createElement("div");
      title.textContent = item.title || item.key;
      title.className = "zotero-item-title";
      const fileIcon = document.createElement("span");
      fileIcon.className = "zotero-icon zotero-icon-file";
      fileIcon.innerHTML = this.zoteroIcons.collection;
      title.prepend(fileIcon);
      row.appendChild(title);

      const badges = document.createElement("div");
      badges.className = "zotero-item-badges";
      if (item.pdfs || item.hasPdf) {
        const badge = document.createElement("span");
        badge.className = "zotero-badge zotero-badge-pdf";
        badge.textContent = item.pdfs && item.pdfs > 1 ? `PDFs ${item.pdfs}` : "PDF";
        badges.appendChild(badge);
      }
      if (typeof item.attachments === "number" && item.attachments > 0) {
        const badge = document.createElement("span");
        badge.className = "zotero-badge";
        badge.textContent = `Attachments ${item.attachments}`;
        badges.appendChild(badge);
      }
      if (badges.childElementCount > 0) {
        row.appendChild(badges);
      }

      const meta = document.createElement("div");
      const metaBits = [];
      if (item.authors) metaBits.push(item.authors);
      if (item.year) metaBits.push(item.year);
      if (item.itemType) metaBits.push(item.itemType);
      if (item.doi) metaBits.push(`DOI: ${item.doi}`);
      meta.textContent = metaBits.join(" • ");
      meta.className = "zotero-item-meta";
      row.appendChild(meta);

      row.addEventListener("click", () => {
        this.zoteroPreviewItemKey = item.key;
        this.zoteroItemsList?.querySelectorAll(".zotero-item-row").forEach((el) => el.classList.remove("is-active"));
        row.classList.add("is-active");
        if (this.zoteroItemsDetail) {
          this.renderZoteroItemDetail(this.zoteroItemsDetail, item);
        }
        this.scheduleZoteroPersist();
      });

      fragment.appendChild(row);
    }

    this.zoteroItemsList.appendChild(fragment);

    if (preselected && this.zoteroItemsDetail) {
      this.renderZoteroItemDetail(this.zoteroItemsDetail, preselected);
    }
  }

  private selectAllZotero(select: boolean): void {
    this.zoteroSelected.clear();
    if (select) {
      this.zoteroCollections.forEach((c) => this.zoteroSelected.add(c.key));
    }
    this.renderZoteroTree();
  }

  private expandAllZotero(expand: boolean): void {
    this.zoteroExpanded.clear();
    if (expand) {
      this.zoteroCollections.forEach((c) => this.zoteroExpanded.add(c.key));
    }
    this.renderZoteroTree();
  }

  private async loadSelectedZoteroCollections(options?: { cache?: boolean; collectionKey?: string }): Promise<void> {
    const keys = options?.collectionKey ? [options.collectionKey] : Array.from(this.zoteroSelected);
    if (!keys.length) {
      this.updateZoteroStatus("Select at least one collection.", "error");
      return;
    }
    const cache = options?.cache !== false;
    this.updateZoteroStatus(cache ? "Loading from cache…" : "Refreshing from Zotero…", "loading");
    if (keys.length === 1) {
      await this.runCommand("datahub_load_zotero", { collectionKey: keys[0], cache });
    } else {
      await this.runCommand("datahub_load_zotero_multi", { collectionKeys: keys, cache });
    }
    this.updateZoteroStatus(cache ? "Loaded from cache." : "Loaded from Zotero.", "success");
    this.scheduleZoteroPersist();
    this.showZoteroModal(false);
  }

  private async requestZoteroCount(key: string): Promise<void> {
    if (this.zoteroCountPending.has(key)) return;
    this.zoteroCountPending.add(key);
    const res = (await command("retrieve", "datahub_zotero_count", { collectionKey: key })) as any;
    if (res && res.status === "ok" && typeof res.count === "number") {
      this.zoteroCounts.set(key, res.count);
      this.renderZoteroTree();
    }
    this.zoteroCountPending.delete(key);
  }

  private async purgeZoteroCache(): Promise<void> {
    const ok = window.confirm("Purge Zotero cache and reload fresh collections?");
    if (!ok) {
      return;
    }
    this.updateZoteroStatus("Purging Zotero cache…", "loading");
    await this.runCommand("datahub_clear_cache", { collectionName: "zotero" });
    this.zoteroCollections = [];
    this.zoteroSelected.clear();
    this.zoteroExpanded.clear();
    this.zoteroCounts.clear();
    this.updateZoteroStatus("Cache cleared. Reloading collections…", "loading");
    const res = (await command("retrieve", "datahub_zotero_tree", {})) as any;
    if (!res || res.status === "error") {
      this.updateZoteroStatus(res?.message ?? "Failed to reload collections.", "error");
      return;
    }
    this.zoteroCollections = Array.isArray(res.collections) ? res.collections : [];
    this.renderZoteroTree();
    this.applyZoteroProfile(res?.profile);
    this.updateZoteroStatus("Reloaded fresh collections.", "success");
  }
}
