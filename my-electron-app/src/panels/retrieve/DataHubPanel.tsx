import { command } from "../../ribbon/commandDispatcher";
import type { DataHubLoadResult, DataHubTable } from "../../shared/types/dataHub";
import { DataGrid } from "./DataGrid";

type DataHubAction =
  | "datahub_load_zotero"
  | "datahub_load_file"
  | "datahub_export_csv"
  | "datahub_export_excel"
  | "datahub_clear_cache"
  | "datahub_resolve_na"
  | "datahub_flag_na"
  | "datahub_codebook"
  | "datahub_codes"
  | "datahub_list_collections";

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
        await this.loadZotero(payload);
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
    }
  }

  private async loadZotero(payload?: Record<string, unknown>): Promise<void> {
    await this.runCommand("datahub_load_zotero", {
      ...(payload ?? {})
    });
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
}
