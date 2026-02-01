import { commandInternal } from "../../ribbon/commandDispatcher";
import { retrieveContext } from "../../state/retrieveContext";
import type {
  RetrieveProviderId,
  RetrieveQuery,
  RetrieveRecord,
  RetrieveSort
} from "../../shared/types/retrieve";
import { readRetrieveQueryDefaults } from "../../state/retrieveQueryDefaults";
import { DataGrid } from "./DataGrid";

const PROVIDERS: Array<{ id: RetrieveProviderId; label: string }> = [
  { id: "semantic_scholar", label: "Semantic Scholar" },
  { id: "crossref", label: "Crossref" },
  { id: "openalex", label: "OpenAlex" },
  { id: "elsevier", label: "Elsevier" },
  { id: "wos", label: "Web of Science" },
  { id: "unpaywall", label: "Unpaywall" },
  { id: "cos", label: "COS (Merged)" }
];

const SORT_OPTIONS: Array<{ label: string; value: RetrieveSort }> = [
  { label: "Relevance", value: "relevance" },
  { label: "Year", value: "year" }
];

export class SearchAppPanel {
  readonly element: HTMLElement;

  private queryInput: HTMLInputElement;
  private yearFromInput: HTMLInputElement;
  private yearToInput: HTMLInputElement;
  private providerSelect: HTMLSelectElement;
  private sortSelect: HTMLSelectElement;
  private limitInput: HTMLInputElement;
  private authorInput: HTMLInputElement;
  private venueInput: HTMLInputElement;
  private doiOnly: HTMLInputElement;
  private abstractOnly: HTMLInputElement;
  private statusLine: HTMLElement;
  private grid: DataGrid;
  private loadMoreBtn: HTMLButtonElement;
  private prevBtn: HTMLButtonElement;

  private records: RetrieveRecord[] = [];
  private totalCount = 0;
  private nextCursor?: string | number | null;
  private lastProvider?: RetrieveProviderId;
  private isLoading = false;
  private selectedIndex: number | null = null;
  private paginationStack: Array<string | number | null> = [null];

  private onGridClick: (event: MouseEvent) => void;

  constructor(initial?: Partial<RetrieveQuery>) {
    const defaults = readRetrieveQueryDefaults();

    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    this.element.style.display = "flex";
    this.element.style.flexDirection = "column";
    this.element.style.height = "100%";

    const header = document.createElement("div");
    header.className = "tool-header";
    const title = document.createElement("h4");
    title.textContent = "Retrieve — Search";
    header.appendChild(title);

    this.queryInput = document.createElement("input");
    this.queryInput.type = "text";
    this.queryInput.placeholder = "Search terms or DOI";
    this.queryInput.style.minWidth = "280px";
    this.queryInput.value = initial?.query ?? "";

    this.providerSelect = document.createElement("select");
    this.providerSelect.ariaLabel = "Provider";
    this.providerSelect.style.minWidth = "160px";
    this.populateProviders(initial?.provider ?? defaults.provider);

    this.sortSelect = document.createElement("select");
    this.sortSelect.ariaLabel = "Sort";
    SORT_OPTIONS.forEach((option) => {
      const opt = document.createElement("option");
      opt.value = option.value;
      opt.textContent = option.label;
      this.sortSelect.appendChild(opt);
    });
    this.sortSelect.value = initial?.sort ?? defaults.sort;

    this.yearFromInput = document.createElement("input");
    this.yearFromInput.type = "number";
    this.yearFromInput.placeholder = "Year from";
    this.yearFromInput.style.width = "110px";
    this.yearFromInput.value = initial?.year_from?.toString() ?? (defaults.year_from?.toString() ?? "");

    this.yearToInput = document.createElement("input");
    this.yearToInput.type = "number";
    this.yearToInput.placeholder = "Year to";
    this.yearToInput.style.width = "110px";
    this.yearToInput.value = initial?.year_to?.toString() ?? (defaults.year_to?.toString() ?? "");

    this.limitInput = document.createElement("input");
    this.limitInput.type = "number";
    this.limitInput.placeholder = "Limit";
    this.limitInput.style.width = "90px";
    this.limitInput.min = "0";
    this.limitInput.max = "1000";
    this.limitInput.value = initial?.limit?.toString() ?? String(defaults.limit ?? 50);

    this.authorInput = document.createElement("input");
    this.authorInput.type = "text";
    this.authorInput.placeholder = "Author contains";
    this.authorInput.style.minWidth = "180px";

    this.venueInput = document.createElement("input");
    this.venueInput.type = "text";
    this.venueInput.placeholder = "Venue contains";
    this.venueInput.style.minWidth = "180px";

    this.doiOnly = document.createElement("input");
    this.doiOnly.type = "checkbox";
    this.doiOnly.id = "doi-only";
    const doiLabel = document.createElement("label");
    doiLabel.htmlFor = "doi-only";
    doiLabel.textContent = "DOI only";

    this.abstractOnly = document.createElement("input");
    this.abstractOnly.type = "checkbox";
    this.abstractOnly.id = "abstract-only";
    const absLabel = document.createElement("label");
    absLabel.htmlFor = "abstract-only";
    absLabel.textContent = "Abstract only";

    const searchBtn = document.createElement("button");
    searchBtn.className = "ribbon-button";
    searchBtn.textContent = "Search";
    searchBtn.addEventListener("click", () => void this.handleSearch(false));

    this.prevBtn = document.createElement("button");
    this.prevBtn.type = "button";
    this.prevBtn.className = "ribbon-button";
    this.prevBtn.textContent = "Prev";
    this.prevBtn.disabled = true;

    this.loadMoreBtn = document.createElement("button");
    this.loadMoreBtn.type = "button";
    this.loadMoreBtn.className = "ribbon-button";
    this.loadMoreBtn.textContent = "Next";
    this.loadMoreBtn.style.display = "none";
    this.loadMoreBtn.addEventListener("click", () => void this.handleSearch(true));
    this.prevBtn.addEventListener("click", () => void this.handleSearch(false, true));

    const controls = document.createElement("div");
    controls.className = "control-row";
    controls.style.flexWrap = "wrap";
    controls.style.gap = "10px";
    controls.append(
      this.queryInput,
      searchBtn,
      this.loadMoreBtn,
      this.providerSelect,
      this.sortSelect,
      this.yearFromInput,
      this.yearToInput,
      this.limitInput
    );

    const filterRow = document.createElement("div");
    filterRow.className = "control-row";
    filterRow.style.flexWrap = "wrap";
    filterRow.style.gap = "10px";
    filterRow.append(
      this.authorInput,
      this.venueInput,
      this.doiOnly,
      doiLabel,
      this.abstractOnly,
      absLabel,
      this.prevBtn,
      this.loadMoreBtn
    );
    controls.append(filterRow);

    this.statusLine = document.createElement("div");
    this.statusLine.className = "retrieve-status";
    this.statusLine.textContent = "Run a search to load results. Select a row to view details on the right.";

    this.grid = new DataGrid();
    this.grid.element.style.flex = "1";
    this.grid.element.style.height = "100%";

    const gridHost = document.createElement("div");
    gridHost.style.flex = "1 1 100%";
    gridHost.style.minWidth = "720px";
    gridHost.style.minHeight = "420px";
    gridHost.style.display = "flex";
    gridHost.style.flexDirection = "column";
    gridHost.appendChild(this.grid.element);

    const content = document.createElement("div");
    content.style.flex = "1";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.append(gridHost);

    this.element.append(header, controls, this.statusLine, content);

    this.onGridClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const cell = target?.closest<HTMLElement>(".retrieve-grid-cell");
      const rowEl = target?.closest<HTMLElement>(".retrieve-grid-row");
      const rowHeader = target?.closest<HTMLElement>(".retrieve-grid-row-header");

      const rowRaw = cell?.dataset.row ?? rowEl?.dataset.row ?? rowHeader?.parentElement?.dataset.row ?? "";
      const row = Number(rowRaw);
      if (!Number.isFinite(row)) return;
      this.selectRow(row);
    };
    this.grid.element.addEventListener("click", this.onGridClick);

    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.handleSearch(false);
      }
    });
  }

  destroy(): void {
    this.grid.element.removeEventListener("click", this.onGridClick);
  }

  private async handleSearch(loadMore: boolean, goPrev = false): Promise<void> {
    if (this.isLoading) return;
    if (loadMore && (!this.nextCursor || !this.lastProvider)) return;
    if (goPrev && this.paginationStack.length <= 1) return;

    const payload = this.getQuery();
    if (!payload.query) {
      this.updateStatus("Enter keywords or DOI to search.");
      return;
    }

    if (!loadMore && !goPrev) {
      this.records = [];
      this.selectedIndex = null;
      this.nextCursor = undefined;
      this.totalCount = 0;
      this.lastProvider = payload.provider;
      this.applySelection(undefined);
      this.paginationStack = [null];
    } else {
      payload.provider = this.lastProvider ?? payload.provider;
      if (goPrev) {
        this.applyPrevPagination(payload);
      } else {
        this.applyPagination(payload);
      }
    }

    payload.provider = payload.provider ?? "semantic_scholar";

    this.isLoading = true;
    this.loadMoreBtn.disabled = true;
    this.updateStatus(loadMore ? "Loading more results…" : "Searching…");
    try {
      const response = await commandInternal("retrieve", "fetch_from_source", payload);
      if (response?.status !== "ok") {
        console.error("[SearchAppPanel.tsx][handleSearch][debug] retrieve search failed", response);
        this.updateStatus(response?.message ?? "Search failed (unknown error).");
        return;
      }
      const items = (response?.items ?? []) as RetrieveRecord[];
      this.lastProvider = response?.provider ?? this.lastProvider ?? payload.provider;
      this.totalCount = response?.total ?? this.totalCount;
      this.nextCursor = response?.nextCursor;

      // Update pagination stack
      if (!goPrev) {
        if (this.nextCursor !== undefined) {
          this.paginationStack.push(this.nextCursor);
        }
      } else {
        if (this.paginationStack.length > 1) {
          this.paginationStack.pop();
        }
      }

      this.records = loadMore ? [...this.records, ...items] : items;
      this.renderTable();

      if (!this.records.length) {
        this.updateStatus("No results found.");
      } else {
        this.updateStatus(`Showing ${this.records.length} of ${this.totalCount} results`);
      }
    } catch (error) {
      console.error("Retrieve search failed", error);
      this.updateStatus("Search failed. Check the console for details.");
    } finally {
      this.isLoading = false;
      this.loadMoreBtn.disabled = false;
      this.updateLoadMoreVisibility();
    }
  }

  private getQuery(): RetrieveQuery {
    return {
      query: this.queryInput.value.trim(),
      provider: this.providerSelect.value as RetrieveProviderId,
      sort: this.sortSelect.value as RetrieveSort,
      limit: this.parseNumber(this.limitInput.value),
      year_from: this.parseNumber(this.yearFromInput.value),
      year_to: this.parseNumber(this.yearToInput.value),
      author_contains: this.authorInput.value.trim() || undefined,
      venue_contains: this.venueInput.value.trim() || undefined,
      only_doi: this.doiOnly.checked,
      only_abstract: this.abstractOnly.checked
    };
  }

  private parseNumber(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }

  private applyPagination(payload: RetrieveQuery): void {
    if (!this.lastProvider || this.nextCursor === undefined || this.nextCursor === null) {
      return;
    }
    payload.cursor = undefined;
    payload.offset = undefined;
    payload.page = undefined;
    switch (this.lastProvider) {
      case "semantic_scholar":
      case "crossref":
      case "elsevier":
        if (typeof this.nextCursor === "number") {
          payload.offset = this.nextCursor;
        }
        break;
      case "openalex":
        if (typeof this.nextCursor === "string") {
          payload.cursor = this.nextCursor;
        } else if (typeof this.nextCursor === "number") {
          payload.offset = this.nextCursor;
        }
        break;
      case "wos":
        if (typeof this.nextCursor === "number") {
          payload.page = this.nextCursor;
        }
        break;
      default:
        break;
    }
  }

  private applyPrevPagination(payload: RetrieveQuery): void {
    if (!this.lastProvider) return;
    if (this.paginationStack.length <= 1) return;
    // Use the previous cursor/offset stored in the stack (second last entry)
    const prevCursor = this.paginationStack[this.paginationStack.length - 2];
    payload.cursor = undefined;
    payload.offset = undefined;
    payload.page = undefined;
    switch (this.lastProvider) {
      case "semantic_scholar":
      case "crossref":
      case "elsevier":
        if (typeof prevCursor === "number") {
          payload.offset = prevCursor;
        }
        break;
      case "openalex":
        if (typeof prevCursor === "string") {
          payload.cursor = prevCursor;
        } else if (typeof prevCursor === "number") {
          payload.offset = prevCursor;
        }
        break;
      case "wos":
        if (typeof prevCursor === "number") {
          payload.page = prevCursor;
        }
        break;
      default:
        break;
    }
  }

  private updateStatus(message: string): void {
    this.statusLine.textContent = message;
  }

  private updateLoadMoreVisibility(): void {
    if (this.nextCursor !== undefined && this.nextCursor !== null) {
      this.loadMoreBtn.style.display = "inline-flex";
    } else {
      this.loadMoreBtn.style.display = "none";
    }
    this.prevBtn.disabled = this.paginationStack.length <= 1;
  }

  private renderTable(): void {
    const columns = ["Title", "Authors", "Year", "Source", "DOI", "URL", "Citations"];
    const rows = this.records.map((record) => [
      record.title,
      record.authors?.join("; ") ?? "",
      record.year ?? "",
      record.source,
      record.doi ?? "",
      record.url ?? "",
      typeof record.citationCount === "number" ? record.citationCount : ""
    ]);
    this.grid.setData(columns, rows);
    this.grid.autoFitColumns(60);
  }

  private selectRow(rowIndex: number): void {
    const record = this.records[rowIndex];
    if (!record) return;
    this.selectedIndex = rowIndex;
    this.applySelection(record);
  }

  private applySelection(record?: RetrieveRecord): void {
    retrieveContext.setActiveRecord(record);
    document.dispatchEvent(new CustomEvent("retrieve:search-selection", { detail: { record } }));
  }

  private populateProviders(selected: RetrieveProviderId): void {
    this.providerSelect.innerHTML = "";
    PROVIDERS.forEach((provider) => {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      this.providerSelect.appendChild(option);
    });
    this.providerSelect.value = selected;
  }
}
