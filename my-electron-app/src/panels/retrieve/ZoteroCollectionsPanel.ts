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
  private searchInput: HTMLInputElement;
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
    this.searchInput.addEventListener("input", () => this.renderTree(retrieveZoteroContext.getState()));
    searchRow.appendChild(this.searchInput);

    this.statusEl = document.createElement("div");
    this.statusEl.className = "retrieve-status zotero-status";

    const treeBlock = document.createElement("div");
    treeBlock.className = "zotero-tree-block";
    const treeTitle = document.createElement("div");
    treeTitle.className = "zotero-block-title";
    treeTitle.textContent = "Collections";
    this.treeEl = document.createElement("div");
    this.treeEl.className = "zotero-tree-list";
    treeBlock.append(treeTitle, this.treeEl);

    const tagsBlock = document.createElement("div");
    tagsBlock.className = "zotero-tags-block";
    const tagsTitle = document.createElement("div");
    tagsTitle.className = "zotero-block-title";
    tagsTitle.textContent = "Tags";
    this.tagsEl = document.createElement("div");
    this.tagsEl.className = "zotero-tag-facets";
    tagsBlock.append(tagsTitle, this.tagsEl);

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
    this.statusEl.textContent = state.error ? `${state.status} ${state.error}` : state.status;
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
      this.renderHighlightedLabel(label, rowData.collection.name, query);
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
