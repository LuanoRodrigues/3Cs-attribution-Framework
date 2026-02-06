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
  private zoteroItemsHost?: HTMLElement;
  private zoteroSearch?: HTMLInputElement;
  private zoteroStatus?: HTMLElement;
  private zoteroSummary?: HTMLElement;
  private zoteroCollections: Array<{ key: string; name: string; parentKey?: string | null }> = [];
  private zoteroSelected = new Set<string>();
  private zoteroExpanded = new Set<string>();
  private zoteroPreviewKey?: string;
  private zoteroCounts = new Map<string, number>();
  private zoteroCountPending = new Set<string>();
  private zoteroCollapsed = false;
  private zoteroIcons: Record<string, string> = {
    chevronRight:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chevronDown:
      '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 6 8 10.5 12.5 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    dot: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
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
    this.updateZoteroStatus("Loading collections…");
    const res = (await command("retrieve", "datahub_zotero_tree", payload)) as any;
    if (!res || res.status === "error") {
      this.updateZoteroStatus(res?.message ?? "Failed to load Zotero collections.");
      return;
    }
    this.zoteroCollections = Array.isArray(res.collections) ? res.collections : [];
    const lastKey =
      (payload?.collectionKey as string) ||
      (payload?.collectionName as string) ||
      (this.lastSource?.collectionName as string) ||
      "";
    if (lastKey) {
      this.zoteroSelected.add(lastKey);
      this.zoteroPreviewKey = lastKey;
      void this.loadZoteroPreview(lastKey);
    }
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
    const title = document.createElement("h4");
    title.textContent = "Zotero Collections";
    title.style.margin = "0";
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
    header.append(title, collapse, close);

    const searchRow = document.createElement("div");
    searchRow.className = "zotero-picker-search";
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search collections…";
    search.addEventListener("input", () => this.renderZoteroTree());
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
    this.zoteroTreeHost = treePane;

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
    loadBtn.addEventListener("click", () => void this.loadSelectedZoteroCollections());
    actions.append(loadBtn);

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

  private updateZoteroStatus(message: string): void {
    if (this.zoteroStatus) {
      this.zoteroStatus.textContent = message;
    }
  }

  private updateZoteroSummary(): void {
    if (this.zoteroSummary) {
      this.zoteroSummary.textContent = `${this.zoteroSelected.size} selected • ${this.zoteroCollections.length} collections`;
    }
  }

  private renderZoteroTree(): void {
    if (!this.zoteroTreeHost) return;
    this.zoteroTreeHost.innerHTML = "";
    const query = (this.zoteroSearch?.value || "").trim().toLowerCase();
    const forceExpand = query.length > 0;
    const byParent = new Map<string | null, Array<{ key: string; name: string; parentKey?: string | null }>>();
    this.zoteroCollections.forEach((c) => {
      const parent = c.parentKey || null;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent)!.push(c);
    });

    const hasMatch = (node: { key: string; name: string; parentKey?: string | null }): boolean => {
      if (!query) return true;
      if (node.name.toLowerCase().includes(query) || node.key.toLowerCase().includes(query)) return true;
      const children = byParent.get(node.key) || [];
      return children.some(hasMatch);
    };

    const renderNode = (node: { key: string; name: string }, depth: number) => {
      if (!hasMatch(node)) return;
      const row = document.createElement("div");
      row.className = "zotero-tree-row";
      row.style.marginLeft = `${depth * 14}px`;
      if (this.zoteroPreviewKey === node.key) {
        row.classList.add("is-active");
      }

      const children = byParent.get(node.key) || [];
      const expanded = forceExpand || this.zoteroExpanded.has(node.key);
      const exp = document.createElement("span");
      exp.className = "zotero-tree-expander";
      exp.setAttribute("role", "button");
      exp.tabIndex = 0;
      const expIcon = document.createElement("span");
      expIcon.className = "zotero-icon";
      expIcon.innerHTML = children.length ? (expanded ? this.zoteroIcons.chevronDown : this.zoteroIcons.chevronRight) : this.zoteroIcons.dot;
      exp.appendChild(expIcon);
      exp.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!children.length) return;
        if (this.zoteroExpanded.has(node.key)) this.zoteroExpanded.delete(node.key);
        else this.zoteroExpanded.add(node.key);
        this.renderZoteroTree();
      });
      exp.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (!children.length) return;
        if (this.zoteroExpanded.has(node.key)) this.zoteroExpanded.delete(node.key);
        else this.zoteroExpanded.add(node.key);
        this.renderZoteroTree();
      });

      const selectBtn = document.createElement("span");
      selectBtn.className = "zotero-tree-select";
      selectBtn.setAttribute("role", "button");
      selectBtn.tabIndex = 0;
      selectBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (this.zoteroSelected.has(node.key)) this.zoteroSelected.delete(node.key);
        else this.zoteroSelected.add(node.key);
        this.renderZoteroTree();
      });
      selectBtn.addEventListener("keydown", (ev) => {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        ev.preventDefault();
        ev.stopPropagation();
        if (this.zoteroSelected.has(node.key)) this.zoteroSelected.delete(node.key);
        else this.zoteroSelected.add(node.key);
        this.renderZoteroTree();
      });
      const icon = document.createElement("span");
      icon.className = "zotero-icon zotero-icon-folder";
      const isSelected = this.zoteroSelected.has(node.key);
      icon.innerHTML = children.length
        ? (expanded ? this.zoteroIcons.folderOpen : this.zoteroIcons.folder)
        : this.zoteroIcons.collection;
      if (isSelected) {
        icon.style.color = "var(--accent)";
      }
      selectBtn.appendChild(icon);

      const label = document.createElement("span");
      label.className = "zotero-tree-label";
      label.textContent = node.name;
      const badge = document.createElement("span");
      badge.className = "zotero-tree-count";
      if (this.zoteroCounts.has(node.key)) {
        badge.textContent = String(this.zoteroCounts.get(node.key));
      } else {
        badge.textContent = "…";
        this.requestZoteroCount(node.key);
      }
      row.append(exp, selectBtn, label, badge);
      row.addEventListener("click", () => {
        this.zoteroPreviewKey = node.key;
        void this.loadZoteroPreview(node.key);
      });
      row.addEventListener("dblclick", () => {
        this.zoteroSelected.clear();
        this.zoteroSelected.add(node.key);
        void this.loadSelectedZoteroCollections();
      });
      this.zoteroTreeHost!.appendChild(row);

      if (children.length && expanded) {
        children.forEach((child) => renderNode(child, depth + 1));
      }
    };

    const roots = byParent.get(null) || [];
    roots.sort((a, b) => a.name.localeCompare(b.name)).forEach((node) => renderNode(node, 0));
    this.updateZoteroSummary();
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
    const list = document.createElement("div");
    items.forEach((item: any) => {
      const row = document.createElement("div");
      row.className = "zotero-item-row";
      const title = document.createElement("div");
      title.textContent = item.title || item.key;
      title.className = "zotero-item-title";
      const fileIcon = document.createElement("span");
      fileIcon.className = "zotero-icon zotero-icon-file";
      fileIcon.innerHTML = this.zoteroIcons.collection;
      title.prepend(fileIcon);
      const meta = document.createElement("div");
      meta.textContent = `${item.authors || ""}${item.year ? ` • ${item.year}` : ""}`;
      meta.className = "zotero-item-meta";
      row.append(title, meta);
      list.appendChild(row);
    });
    this.zoteroItemsHost.innerHTML = "";
    this.zoteroItemsHost.appendChild(list);
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

  private async loadSelectedZoteroCollections(): Promise<void> {
    const keys = Array.from(this.zoteroSelected);
    if (!keys.length) {
      this.updateZoteroStatus("Select at least one collection.");
      return;
    }
    this.updateZoteroStatus("Loading Zotero collections…");
    if (keys.length === 1) {
      await this.runCommand("datahub_load_zotero", { collectionKey: keys[0], cache: false });
    } else {
      await this.runCommand("datahub_load_zotero_multi", { collectionKeys: keys });
    }
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
    this.updateZoteroStatus("Purging Zotero cache…");
    await this.runCommand("datahub_clear_cache", { collectionName: "zotero" });
    this.zoteroCollections = [];
    this.zoteroSelected.clear();
    this.zoteroExpanded.clear();
    this.zoteroCounts.clear();
    this.updateZoteroStatus("Cache cleared. Reloading collections…");
    const res = (await command("retrieve", "datahub_zotero_tree", {})) as any;
    if (!res || res.status === "error") {
      this.updateZoteroStatus(res?.message ?? "Failed to reload collections.");
      return;
    }
    this.zoteroCollections = Array.isArray(res.collections) ? res.collections : [];
    this.renderZoteroTree();
    this.updateZoteroStatus("Reloaded fresh collections.");
  }
}
