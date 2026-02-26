import { retrieveZoteroContext, type RetrieveZoteroState, type ZoteroCollection } from "../../state/retrieveZoteroContext";

type TreeRow = {
  collection: ZoteroCollection;
  depth: number;
  childrenCount: number;
  expanded: boolean;
};

export class ZoteroCollectionsPanel {
  readonly element: HTMLElement;
  private treeEl: HTMLElement;
  private tagsEl: HTMLElement;
  private statusEl: HTMLElement;
  private treeTitle: HTMLElement;
  private tagsTitle: HTMLElement;
  private searchInput: HTMLInputElement;
  private refreshButton: HTMLButtonElement;
  private loadSelectedButton: HTMLButtonElement;
  private expanded = new Set<string>();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    this.element.classList.add("zotero-tool-surface");

    const searchRow = document.createElement("div");
    searchRow.className = "panel-actions zotero-actions";
    this.searchInput = document.createElement("input");
    this.searchInput.type = "text";
    this.searchInput.className = "zotero-search-input";
    this.searchInput.placeholder = "Search collections by name or key";
    this.searchInput.dataset.voiceAliases = "search collections,find collection,search collection,filter collections";
    this.searchInput.addEventListener("input", () => this.renderTree(retrieveZoteroContext.getState()));
    const zoteroLoaderRibbon = document.createElement("div");
    zoteroLoaderRibbon.className = "zotero-loader-ribbon";

    this.refreshButton = document.createElement("button");
    this.refreshButton.type = "button";
    this.refreshButton.className = "zotero-loader-btn";
    this.refreshButton.ariaLabel = "Refresh";
    this.refreshButton.textContent = "Refresh";
    this.refreshButton.dataset.voiceAliases = "refresh collections,refresh zotero,reload zotero";
    this.refreshButton.addEventListener("click", () => {
      if (retrieveZoteroContext.getState().workspaceMode === "batches") {
        void retrieveZoteroContext.loadBatchesData();
      } else {
        void retrieveZoteroContext.loadTree();
      }
    });

    this.loadSelectedButton = document.createElement("button");
    this.loadSelectedButton.type = "button";
    this.loadSelectedButton.className = "zotero-loader-btn";
    this.loadSelectedButton.ariaLabel = "Load Collection";
    this.loadSelectedButton.textContent = "Load Collection";
    this.loadSelectedButton.dataset.voiceAliases = "load collection,import selected collection,open selected collection";
    this.loadSelectedButton.addEventListener("click", () => {
      void retrieveZoteroContext.loadSelectedCollectionToDataHub();
    });

    zoteroLoaderRibbon.append(this.refreshButton, this.loadSelectedButton);
    searchRow.append(this.searchInput, zoteroLoaderRibbon);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "retrieve-status zotero-status";

    const treeBlock = document.createElement("div");
    treeBlock.className = "zotero-tree-block";
    this.treeTitle = document.createElement("div");
    this.treeTitle.className = "zotero-block-title";
    this.treeTitle.textContent = "Collections";
    this.treeEl = document.createElement("div");
    this.treeEl.className = "zotero-tree-list";
    treeBlock.append(this.treeTitle, this.treeEl);

    const tagsBlock = document.createElement("div");
    tagsBlock.className = "zotero-tags-block";
    this.tagsTitle = document.createElement("div");
    this.tagsTitle.className = "zotero-block-title";
    this.tagsTitle.textContent = "Tags";
    this.tagsEl = document.createElement("div");
    this.tagsEl.className = "zotero-tag-facets";
    tagsBlock.append(this.tagsTitle, this.tagsEl);

    this.element.append(searchRow, this.statusEl, treeBlock, tagsBlock);

    this.unsubscribe = retrieveZoteroContext.subscribe((state) => this.render(state));
    if (!retrieveZoteroContext.getState().collections.length) {
      void retrieveZoteroContext.loadTree();
    }
  }

  destroy(): void {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }

  private render(state: RetrieveZoteroState): void {
    const batchMode = state.workspaceMode === "batches";
    this.treeTitle.textContent = batchMode ? "Batches" : "Collections";
    this.tagsTitle.textContent = batchMode ? "Themes" : "Tags";
    this.searchInput.placeholder = batchMode ? "Search batches by theme or id" : "Search collections by name or key";
    this.loadSelectedButton.style.display = batchMode ? "none" : "";
    this.statusEl.textContent = state.error ? `${state.status} ${state.error}` : state.status;
    this.refreshButton.disabled = Boolean(state.loadingTree || state.runningLoad);
    this.loadSelectedButton.disabled = Boolean(state.loadingTree || !state.selectedCollectionKey || state.runningLoad);
    this.refreshButton.textContent = batchMode ? "Reload Batches" : "Refresh";
    this.renderTree(state);
    this.renderTags(state);
  }

  private renderTree(state: RetrieveZoteroState): void {
    this.treeEl.innerHTML = "";
    if (state.loadingTree) {
      const loading = document.createElement("div");
      loading.className = "retrieve-status";
      loading.textContent = "Loading collections...";
      this.treeEl.appendChild(loading);
      return;
    }

    const query = this.searchInput.value.trim().toLowerCase();
    const byParent = new Map<string | null, ZoteroCollection[]>();
    state.collections.forEach((collection) => {
      const parent = collection.parentKey || null;
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent)!.push(collection);
    });
    byParent.forEach((children) => children.sort((a, b) => a.name.localeCompare(b.name)));

    const matches = (collection: ZoteroCollection): boolean => {
      if (!query) return true;
      const self = `${collection.name} ${collection.key}`.toLowerCase();
      if (self.includes(query)) return true;
      const children = byParent.get(collection.key) || [];
      return children.some(matches);
    };

    const rows: TreeRow[] = [];
    const walk = (parent: string | null, depth: number): void => {
      const children = byParent.get(parent) || [];
      children.forEach((child) => {
        if (!matches(child)) return;
        const grandChildren = (byParent.get(child.key) || []).filter(matches);
        const expanded = query.length > 0 || this.expanded.has(child.key);
        rows.push({ collection: child, depth, childrenCount: grandChildren.length, expanded });
        if (grandChildren.length && expanded) walk(child.key, depth + 1);
      });
    };
    walk(null, 0);

    rows.forEach((rowData) => {
      const row = document.createElement("div");
      row.className = "zotero-tree-row-v2";
      row.style.paddingLeft = `${8 + rowData.depth * 16}px`;
      if (state.selectedCollectionKey === rowData.collection.key) row.classList.add("is-selected");

      const expander = document.createElement("button");
      expander.type = "button";
      expander.className = "zotero-expander";
      expander.ariaLabel = rowData.childrenCount ? "Collapse collection" : "Collection item";
      expander.dataset.voiceAliases = rowData.childrenCount
        ? "expand collection,collapse collection,collection tree,expand folder"
        : "collection item";
      expander.textContent = rowData.childrenCount ? (rowData.expanded ? "-" : "+") : "";
      expander.disabled = rowData.childrenCount === 0;
      expander.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!rowData.childrenCount) return;
        if (this.expanded.has(rowData.collection.key)) this.expanded.delete(rowData.collection.key);
        else this.expanded.add(rowData.collection.key);
        this.renderTree(retrieveZoteroContext.getState());
      });

      const icon = document.createElement("span");
      icon.className = `zotero-node-icon ${rowData.childrenCount ? "is-folder" : "is-collection"}`;

    const label = document.createElement("button");
    label.type = "button";
    label.className = "zotero-node-label";
    label.ariaLabel = `Open collection ${rowData.collection.name}`;
    label.dataset.voiceAliases = `open collection,select collection ${rowData.collection.name},collection ${rowData.collection.key}`;
    const composedLabel = `${rowData.collection.name} (${rowData.collection.key})`;
    this.renderHighlightedLabel(label, composedLabel, query);
    label.addEventListener("click", () => retrieveZoteroContext.selectCollection(rowData.collection.key));

      row.append(expander, icon, label);
      this.treeEl.appendChild(row);
    });
  }

  private renderHighlightedLabel(host: HTMLElement, rawText: string, queryLower: string): void {
    host.innerHTML = "";
    const text = rawText || "";
    if (!queryLower) {
      host.textContent = text;
      return;
    }
    const textLower = text.toLowerCase();
    let cursor = 0;
    while (cursor < text.length) {
      const matchAt = textLower.indexOf(queryLower, cursor);
      if (matchAt < 0) {
        host.appendChild(document.createTextNode(text.slice(cursor)));
        break;
      }
      if (matchAt > cursor) {
        host.appendChild(document.createTextNode(text.slice(cursor, matchAt)));
      }
      const mark = document.createElement("span");
      mark.className = "zotero-match";
      mark.textContent = text.slice(matchAt, matchAt + queryLower.length);
      host.appendChild(mark);
      cursor = matchAt + queryLower.length;
    }
  }

  private renderTags(state: RetrieveZoteroState): void {
    this.tagsEl.innerHTML = "";
    const counts = new Map<string, number>();
    state.items.forEach((item) => {
      (item.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
    });
    const facets = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40);

    if (!facets.length) {
      const empty = document.createElement("div");
      empty.className = "retrieve-status";
      empty.textContent = "No tags for this collection.";
      this.tagsEl.appendChild(empty);
      return;
    }

    facets.forEach(([tag, count], index) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "zotero-tag-chip-v2";
      chip.dataset.voiceAliases = `toggle tag ${tag},filter tag ${tag},tag ${tag}`;
      chip.style.setProperty("--tag-hue", String((index * 37) % 360));
      if (state.activeTags.includes(tag)) chip.classList.add("is-active");
      chip.textContent = `${tag} (${count})`;
      chip.addEventListener("click", () => {
        const set = new Set(state.activeTags);
        if (set.has(tag)) set.delete(tag);
        else set.add(tag);
        retrieveZoteroContext.setActiveTags(Array.from(set));
      });
      this.tagsEl.appendChild(chip);
    });
  }
}
