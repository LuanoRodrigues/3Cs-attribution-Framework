import { retrieveZoteroContext, type RetrieveZoteroState, type ZoteroItem } from "../../state/retrieveZoteroContext";

export class ZoteroItemsPanel {
  readonly element: HTMLElement;
  private listEl: HTMLElement;
  private statusEl: HTMLElement;
  private tableHead: HTMLElement;
  private searchInput: HTMLInputElement;
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    this.element.classList.add("zotero-tool-surface");

    const controls = document.createElement("div");
    controls.className = "panel-actions zotero-actions";

    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.placeholder = "Filter title, creator, year, DOI";
    this.searchInput.className = "zotero-search-input";
    this.searchInput.addEventListener("input", () => this.render(retrieveZoteroContext.getState()));

    controls.append(this.searchInput);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "retrieve-status zotero-status";

    this.tableHead = document.createElement("div");
    this.tableHead.className = "zotero-card-head";
    this.tableHead.innerHTML = `
      <span>Title</span>
      <span>Creator</span>
      <span>Year</span>
      <span>Type</span>
      <span>Source</span>
    `;

    this.listEl = document.createElement("div");
    this.listEl.className = "zotero-card-list";

    this.element.append(controls, this.statusEl, this.tableHead, this.listEl);
    this.unsubscribe = retrieveZoteroContext.subscribe((state) => this.render(state));
  }

  destroy(): void {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }

  private render(state: RetrieveZoteroState): void {
    const batchMode = state.workspaceMode === "batches";
    this.searchInput.placeholder = batchMode
      ? "Filter payload, theme, evidence, question"
      : "Filter title, creator, year, DOI";
    this.tableHead.innerHTML = batchMode
      ? "<span>Payload</span><span>Theme</span><span>Page</span><span>Evidence</span><span>Question</span>"
      : "<span>Title</span><span>Creator</span><span>Year</span><span>Type</span><span>Source</span>";
    const selectedCollection = retrieveZoteroContext.getSelectedCollection();
    const base = selectedCollection?.name
      ? `${batchMode ? "Batch" : "Collection"}: ${selectedCollection.name}`
      : `No ${batchMode ? "batch" : "collection"} selected.`;
    const tagPart = state.activeTags.length ? ` | Tags: ${state.activeTags.join(", ")}` : "";
    this.statusEl.textContent = state.loadingItems ? `Loading items... ${base}` : `${base}${tagPart}`;

    this.listEl.innerHTML = "";
    const filtered = this.getFilteredItems(state);
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "retrieve-status";
      empty.textContent = state.loadingItems ? "Loading..." : "No items match current filters.";
      this.listEl.appendChild(empty);
      return;
    }

    filtered.forEach((item) => {
      const card = this.renderCard(item, state.selectedItemKey === item.key);
      this.listEl.appendChild(card);
    });
  }

  private getFilteredItems(state: RetrieveZoteroState): ZoteroItem[] {
    const query = this.searchInput.value.trim().toLowerCase();
    const activeTags = state.activeTags;
    return state.items.filter((item) => {
      if (activeTags.length) {
        const itemTags = item.tags || [];
        const allTagsPresent = activeTags.every((tag) => itemTags.includes(tag));
        if (!allTagsPresent) return false;
      }
      if (!query) return true;
      const haystack = [item.title, item.authors, item.year, item.doi, item.publicationTitle].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(query);
    });
  }

  private renderCard(item: ZoteroItem, selected: boolean): HTMLElement {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "zotero-item-row-v2";
    const title = item.title || "Untitled";
    row.ariaLabel = `Select Zotero item ${title}`;
    row.dataset.voiceAliases = `select item ${title},open item ${title},zotero item ${item.key}`;
    if (selected) row.classList.add("is-selected");
    row.addEventListener("click", () => retrieveZoteroContext.selectItem(item.key));

    const titleCell = document.createElement("div");
    titleCell.className = "zotero-item-row-title";
    const icon = document.createElement("span");
    icon.className = "zotero-book-icon";
    const titleText = document.createElement("span");
    titleText.textContent = item.title || "Untitled";
    titleCell.append(icon, titleText);

    const creatorCell = document.createElement("div");
    creatorCell.className = "zotero-item-row-col";
    creatorCell.textContent = item.authors || "-";

    const yearCell = document.createElement("div");
    yearCell.className = "zotero-item-row-col";
    yearCell.textContent = item.year || "-";

    const typeCell = document.createElement("div");
    typeCell.className = "zotero-item-row-col";
    typeCell.textContent = item.itemType || "-";

    const sourceCell = document.createElement("div");
    sourceCell.className = "zotero-item-row-col";
    sourceCell.textContent = item.publicationTitle || "-";

    row.append(titleCell, creatorCell, yearCell, typeCell, sourceCell);

    const metaLine = document.createElement("div");
    metaLine.className = "zotero-item-row-meta";
    const bits: string[] = [];
    if (item.doi) bits.push(`DOI: ${item.doi}`);
    if (item.url) bits.push("URL");
    if (item.hasPdf) bits.push(item.pdfs && item.pdfs > 1 ? `PDF x${item.pdfs}` : "PDF");
    if (typeof item.attachments === "number" && item.attachments > 0) bits.push(`ATT ${item.attachments}`);
    metaLine.textContent = bits.join(" | ");
    row.appendChild(metaLine);

    return row;
  }
}
