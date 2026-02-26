import { commandInternal } from "../../ribbon/commandDispatcher";
import { retrieveContext } from "../../state/retrieveContext";
import type {
  RetrieveProviderId,
  RetrievePaperSnapshot,
  RetrieveQuery,
  RetrieveRecord,
  RetrieveSort
} from "../../shared/types/retrieve";
import { readRetrieveQueryDefaults } from "../../state/retrieveQueryDefaults";

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

export class SearchPanel {
  readonly element: HTMLElement;
  private queryInput: HTMLInputElement;
  private yearFromInput: HTMLInputElement;
  private yearToInput: HTMLInputElement;
  private providerSelect: HTMLSelectElement;
  private sortSelect: HTMLSelectElement;
  private limitInput: HTMLInputElement;
  private statusLine: HTMLElement;
  private pageLine: HTMLElement;
  private resultsList: HTMLElement;
  private loadMoreBtn: HTMLButtonElement;
  private changeHandlers: Array<(query: RetrieveQuery) => void> = [];
  private records: RetrieveRecord[] = [];
  private totalCount = 0;
  private nextCursor?: string | number | null;
  private lastProvider?: RetrieveProviderId;
  private isLoading = false;
  private selectedRecordId?: string;
  private defaultsHandler: (event: Event) => void;

  constructor(initial?: Partial<RetrieveQuery>) {
    const defaults = readRetrieveQueryDefaults();
    this.element = document.createElement("div");
    this.element.className = "tool-surface";

    const header = document.createElement("div");
    header.className = "tool-header";
    const title = document.createElement("h4");
    title.textContent = "Retrieve — Query Builder";
    header.appendChild(title);

    this.queryInput = document.createElement("input");
    this.queryInput.type = "text";
    this.queryInput.placeholder = "Search terms or DOI";
    this.queryInput.dataset.voiceAliases = "search query,query,search terms,academic search text";
    this.queryInput.style.minWidth = "280px";
    this.queryInput.value = initial?.query ?? "";

    this.providerSelect = document.createElement("select");
    this.providerSelect.ariaLabel = "Provider";
    this.providerSelect.dataset.voiceAliases = "provider,provider selector,search provider,database provider";
    this.providerSelect.style.minWidth = "160px";
    this.populateProviders(initial?.provider ?? defaults.provider);

    this.sortSelect = document.createElement("select");
    this.sortSelect.ariaLabel = "Sort";
    this.sortSelect.dataset.voiceAliases = "sort,result sort,order by";
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
    this.yearFromInput.dataset.voiceAliases = "year from,publication year from,from year";
    this.yearFromInput.value = initial?.year_from?.toString() ?? (defaults.year_from?.toString() ?? "");

    this.yearToInput = document.createElement("input");
    this.yearToInput.type = "number";
    this.yearToInput.placeholder = "Year to";
    this.yearToInput.style.width = "110px";
    this.yearToInput.dataset.voiceAliases = "year to,publication year to,to year";
    this.yearToInput.value = initial?.year_to?.toString() ?? (defaults.year_to?.toString() ?? "");

    this.limitInput = document.createElement("input");
    this.limitInput.type = "number";
    this.limitInput.placeholder = "Limit";
    this.limitInput.style.width = "90px";
    this.limitInput.value = initial?.limit?.toString() ?? String(defaults.limit ?? 25);
    this.limitInput.dataset.voiceAliases = "limit,results limit,result count";

    const searchBtn = document.createElement("button");
    searchBtn.className = "ribbon-button";
    searchBtn.ariaLabel = "Search";
    searchBtn.textContent = "Search";
    searchBtn.dataset.voiceAliases = "search papers,find papers,academic search,query";
    searchBtn.addEventListener("click", () => void this.handleSearch());

    const searchBlock = document.createElement("div");
    searchBlock.className = "retrieve-block";
    const searchTitle = document.createElement("h5");
    searchTitle.textContent = "Search";
    const searchRow = document.createElement("div");
    searchRow.className = "control-row";
    searchRow.append(this.queryInput, searchBtn);
    searchBlock.append(searchTitle, searchRow);

    const dbBlock = document.createElement("div");
    dbBlock.className = "retrieve-block";
    const dbTitle = document.createElement("h5");
    dbTitle.textContent = "Database & Filters";
    const dbRow = document.createElement("div");
    dbRow.className = "control-row";
    dbRow.style.flexWrap = "wrap";
    dbRow.append(this.providerSelect, this.sortSelect, this.yearFromInput, this.yearToInput, this.limitInput);
    dbBlock.append(dbTitle, dbRow);

    this.statusLine = document.createElement("div");
    this.statusLine.className = "retrieve-status";
    this.statusLine.textContent = "Results will appear here after running a search.";

    this.pageLine = document.createElement("div");
    this.pageLine.className = "retrieve-status";
    this.pageLine.style.opacity = "0.75";
    this.pageLine.textContent = "";

    this.resultsList = document.createElement("div");
    this.resultsList.className = "retrieve-results-list";

    this.loadMoreBtn = document.createElement("button");
    this.loadMoreBtn.type = "button";
    this.loadMoreBtn.className = "ribbon-button";
    this.loadMoreBtn.textContent = "Load more results";
    this.loadMoreBtn.dataset.voiceAliases = "load more results,next page,more results,continue";
    this.loadMoreBtn.style.display = "none";
    this.loadMoreBtn.addEventListener("click", () => void this.handleSearch(true));

    const loadMoreRow = document.createElement("div");
    loadMoreRow.className = "retrieve-load-more";
    loadMoreRow.appendChild(this.loadMoreBtn);

    const resultsWrapper = document.createElement("div");
    resultsWrapper.className = "retrieve-results";
    resultsWrapper.append(this.statusLine, this.pageLine, this.resultsList, loadMoreRow);

    this.element.append(header, searchBlock, dbBlock, resultsWrapper);

    [
      this.queryInput,
      this.providerSelect,
      this.sortSelect,
      this.yearFromInput,
      this.yearToInput,
      this.limitInput
    ].forEach((el) => {
      el.addEventListener("change", () => this.emitChange());
      el.addEventListener("input", () => this.emitChange());
    });

    this.defaultsHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ defaults?: ReturnType<typeof readRetrieveQueryDefaults> }>).detail;
      if (!detail?.defaults) return;
      const next = detail.defaults;
      this.providerSelect.value = next.provider;
      this.sortSelect.value = next.sort;
      this.yearFromInput.value = next.year_from?.toString() ?? "";
      this.yearToInput.value = next.year_to?.toString() ?? "";
      this.limitInput.value = String(next.limit ?? 25);
      this.emitChange();
    };
    document.addEventListener("retrieve:query-defaults-updated", this.defaultsHandler);
  }

  destroy(): void {
    document.removeEventListener("retrieve:query-defaults-updated", this.defaultsHandler);
  }

  getQuery(): RetrieveQuery {
    return {
      query: this.queryInput.value.trim(),
      provider: this.providerSelect.value as RetrieveProviderId,
      sort: this.sortSelect.value as RetrieveSort,
      limit: this.parseNumber(this.limitInput.value),
      year_from: this.parseNumber(this.yearFromInput.value),
      year_to: this.parseNumber(this.yearToInput.value)
    };
  }

  onChange(handler: (query: RetrieveQuery) => void): void {
    this.changeHandlers.push(handler);
  }

  private emitChange(): void {
    const snapshot = this.getQuery();
    this.changeHandlers.forEach((handler) => handler(snapshot));
  }

  private async handleSearch(loadMore = false): Promise<void> {
    if (this.isLoading) {
      return;
    }
    if (loadMore && (!this.nextCursor || !this.lastProvider)) {
      return;
    }
    const payload = this.getQuery();
    if (!payload.query) {
      this.updateStatus("Enter keywords or DOI to search.");
      return;
    }
    if (!loadMore) {
      this.records = [];
      this.resultsList.innerHTML = "";
      this.nextCursor = undefined;
      this.totalCount = 0;
      this.selectedRecordId = undefined;
      this.lastProvider = payload.provider;
      this.clearSelection();
    } else {
      payload.provider = this.lastProvider ?? payload.provider;
      this.applyPagination(payload);
    }
    payload.provider = payload.provider ?? "semantic_scholar";
    this.isLoading = true;
    this.loadMoreBtn.disabled = true;
    this.updateStatus(loadMore ? "Loading more results…" : "Searching…");
    try {
      const response = await commandInternal("retrieve", "fetch_from_source", payload);
      if (response?.status !== "ok") {
        console.error("[SearchPanel.tsx][handleSearch][debug] retrieve search failed", response);
        this.updateStatus(response?.message ?? "Search failed (unknown error).");
        return;
      }
      const items = (response?.items ?? []) as RetrieveRecord[];
      this.lastProvider = response?.provider ?? this.lastProvider ?? payload.provider;
      this.totalCount = response?.total ?? this.totalCount;
      if (!loadMore) {
        this.records = items;
        this.renderResults(items, true);
      } else {
        this.records = [...this.records, ...items];
        this.renderResults(items, false);
      }
      if (!this.records.length) {
        this.updateStatus("No results found.");
      } else {
        this.updateStatus(`Showing ${this.records.length} of ${this.totalCount} results`);
      }
      this.nextCursor = response?.nextCursor;
    } catch (error) {
      console.error("Retrieve search failed", error);
      this.updateStatus("Search failed. Check the console for details.");
    } finally {
      this.isLoading = false;
      this.loadMoreBtn.disabled = false;
      this.updateLoadMoreVisibility();
    }
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
    }
  }

  private renderResults(items: RetrieveRecord[], reset: boolean): void {
    if (reset) {
      this.resultsList.innerHTML = "";
    }
    const start = this.resultsList.querySelectorAll(".retrieve-result-row").length;
    items.forEach((record, index) => {
      const rowNumber = start + index + 1;
      this.resultsList.appendChild(this.createResultRow(record, rowNumber));
    });
  }

  private createResultRow(record: RetrieveRecord, rowNumber: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "retrieve-result-row";
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.ariaLabel = `Search result ${rowNumber}: ${record.title || "Untitled"}`;
    row.dataset.voiceAliases = [
      `result row ${rowNumber}`,
      `row ${rowNumber}`,
      `select row ${rowNumber}`,
      `open row ${rowNumber}`,
      `open ${record.title}`,
      record.paperId ? `select ${record.paperId}` : "",
      record.paperId || "",
      "search result"
    ]
      .filter(Boolean)
      .join(",");
    row.dataset.recordId = record.paperId;

    const header = document.createElement("div");
    header.className = "retrieve-result-header";
    const title = document.createElement("h4");
    title.className = "retrieve-result-title";
    title.textContent = record.title;
    const meta = document.createElement("div");
    meta.className = "retrieve-result-meta";
    meta.textContent = this.formatMeta(record);
    header.append(title, meta);

    const snippet = document.createElement("p");
    snippet.className = "retrieve-result-snippet";
    snippet.textContent = record.abstract ?? record.url ?? record.doi ?? "No description provided.";

    const tagRow = document.createElement("div");
    tagRow.className = "retrieve-result-tags";
    const tagList = document.createElement("div");
    tagList.className = "retrieve-tag-list";
    const tagInputRow = document.createElement("div");
    tagInputRow.className = "retrieve-tag-input-row";
    tagInputRow.addEventListener("click", (event) => event.stopPropagation());

    const tagInput = document.createElement("input");
    tagInput.type = "text";
    tagInput.placeholder = "Add tag";
    tagInput.className = "retrieve-tag-input";
    const tagButton = document.createElement("button");
    tagButton.type = "button";
    tagButton.className = "retrieve-tag-add";
    tagButton.ariaLabel = "Add tag";
    tagButton.textContent = "Add";
    tagButton.dataset.voiceAliases = "add tag,tag add,add new tag";

    const attemptAddTag = async (): Promise<void> => {
      const value = tagInput.value.trim();
      if (!value) {
        return;
      }
      tagInput.value = "";
      await this.addTag(record, value, tagList);
    };

    tagButton.addEventListener("click", (event) => {
      event.stopPropagation();
      void attemptAddTag();
    });
    tagInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        void attemptAddTag();
      }
    });

    tagInputRow.append(tagInput, tagButton);
    tagRow.append(tagList, tagInputRow);

    const footer = document.createElement("div");
    footer.className = "retrieve-result-footer";
    if (record.doi) {
      const doiLink = document.createElement("a");
      doiLink.href = `https://doi.org/${record.doi}`;
      doiLink.target = "_blank";
      doiLink.rel = "noreferrer";
      doiLink.textContent = record.doi;
      footer.appendChild(doiLink);
    } else if (record.url) {
      const urlLink = document.createElement("a");
      urlLink.href = record.url;
      urlLink.target = "_blank";
      urlLink.rel = "noreferrer";
      urlLink.textContent = "Open link";
      footer.appendChild(urlLink);
    }

    row.append(header, snippet, tagRow, footer);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.selectRecord(record, row);
      }
    });
    row.addEventListener("click", () => this.selectRecord(record, row));
    if (this.selectedRecordId === record.paperId) {
      row.classList.add("active");
    }
    void this.refreshTagList(record.paperId, tagList);
    return row;
  }

  private selectRecord(record: RetrieveRecord, element: HTMLElement): void {
    this.selectedRecordId = record.paperId;
    retrieveContext.setActiveRecord(record);
    this.resultsList.querySelectorAll<HTMLElement>(".retrieve-result-row").forEach((el) => {
      el.classList.toggle("active", el === element);
    });
  }

  private clearSelection(): void {
    retrieveContext.setActiveRecord(undefined);
    this.resultsList.querySelectorAll<HTMLElement>(".retrieve-result-row.active").forEach((el) => {
      el.classList.remove("active");
    });
  }

  private formatMeta(record: RetrieveRecord): string {
    const parts: string[] = [];
    if (record.year) {
      parts.push(String(record.year));
    }
    parts.push(this.prettyProvider(record.source));
    if (typeof record.citationCount === "number") {
      parts.push(`${record.citationCount} citations`);
    }
    if (record.openAccess?.status) {
      parts.push(`OA ${record.openAccess.status}`);
    }
    return parts.join(" • ");
  }

  private prettyProvider(id: RetrieveProviderId): string {
    switch (id) {
      case "semantic_scholar":
        return "Semantic Scholar";
      case "crossref":
        return "Crossref";
      case "openalex":
        return "OpenAlex";
      case "elsevier":
        return "Elsevier";
      case "wos":
        return "Web of Science";
      case "unpaywall":
        return "Unpaywall";
      case "cos":
        return "COS Merge";
      default:
        return id;
    }
  }

  private updateStatus(message: string): void {
    this.statusLine.textContent = message;
  }

  private updateLoadMoreVisibility(): void {
    if (this.nextCursor !== undefined && this.nextCursor !== null) {
      this.loadMoreBtn.style.display = "block";
    } else {
      this.loadMoreBtn.style.display = "none";
    }
    const pageSize = this.parseNumber(this.limitInput.value) ?? 25;
    const currentPage = Math.max(1, Math.ceil(this.records.length / Math.max(1, pageSize)));
    const totalKnown = this.totalCount ? ` • ${this.records.length} / ${this.totalCount}` : ` • ${this.records.length}`;
    this.pageLine.textContent = `Page ${currentPage} (size ${pageSize})${totalKnown}`;
  }

  private async refreshTagList(recordId: string, container: HTMLElement): Promise<void> {
    const tags = await this.fetchTagsForRecord(recordId);
    container.innerHTML = "";
    tags.forEach((tag) => container.appendChild(this.createTagChip(recordId, tag, container)));
  }

  private async fetchTagsForRecord(recordId: string): Promise<string[]> {
    if (!window.retrieveBridge?.tags?.list) {
      return [];
    }
    try {
      const result = await window.retrieveBridge.tags.list(recordId);
      return Array.isArray(result) ? result : [];
    } catch (error) {
      console.error("Unable to load tags", error);
      return [];
    }
  }

  private createTagChip(recordId: string, tag: string, container: HTMLElement): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "retrieve-tag-chip";
    chip.textContent = tag;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "retrieve-tag-remove";
    removeBtn.textContent = "×";
    removeBtn.ariaLabel = "Remove tag";
    removeBtn.dataset.voiceAliases = "remove tag,delete tag,clear tag";
    removeBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      void this.removeTag(recordId, tag, container);
    });
    chip.appendChild(removeBtn);
    return chip;
  }

  private async addTag(record: RetrieveRecord, value: string, container: HTMLElement): Promise<void> {
    if (!window.retrieveBridge?.tags?.add) {
      return;
    }
    try {
      await window.retrieveBridge.tags.add({ paper: this.mapRecordToSnapshot(record), tag: value });
      await this.refreshTagList(record.paperId, container);
    } catch (error) {
      console.error("Unable to add tag", error);
    }
  }

  private async removeTag(recordId: string, tag: string, container: HTMLElement): Promise<void> {
    if (!window.retrieveBridge?.tags?.remove) {
      return;
    }
    try {
      await window.retrieveBridge.tags.remove({ paperId: recordId, tag });
      await this.refreshTagList(recordId, container);
    } catch (error) {
      console.error("Unable to remove tag", error);
    }
  }

  private mapRecordToSnapshot(record: RetrieveRecord): RetrievePaperSnapshot {
    return {
      paperId: record.paperId,
      title: record.title,
      doi: record.doi,
      url: record.url,
      source: record.source,
      year: record.year
    };
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

  private parseNumber(value: string): number | undefined {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
}
