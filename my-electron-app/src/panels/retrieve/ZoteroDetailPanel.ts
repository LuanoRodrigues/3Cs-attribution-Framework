import { retrieveZoteroContext, type RetrieveZoteroState, type ZoteroItem } from "../../state/retrieveZoteroContext";

type DetailTab = "info" | "tags" | "collection";

type ItemDraft = {
  title?: string;
  authors?: string;
  date?: string;
  year?: string;
  itemType?: string;
  publicationTitle?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  tags?: string[];
  extras?: string;
};

export class ZoteroDetailPanel {
  readonly element: HTMLElement;
  private statusEl: HTMLElement;
  private contentEl: HTMLElement;
  private activeTab: DetailTab = "info";
  private drafts = new Map<string, ItemDraft>();
  private unsubscribe: (() => void) | null = null;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    this.element.classList.add("zotero-tool-surface");

    this.statusEl = document.createElement("div");
    this.statusEl.className = "retrieve-status zotero-status";

    this.contentEl = document.createElement("div");
    this.contentEl.className = "zotero-detail-layout";

    this.element.append(this.statusEl, this.contentEl);
    this.unsubscribe = retrieveZoteroContext.subscribe((state) => this.render(state));
  }

  destroy(): void {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
  }

  private render(state: RetrieveZoteroState): void {
    const item = retrieveZoteroContext.getSelectedItem();
    this.statusEl.textContent = state.error ? `${state.status} ${state.error}` : state.status;
    this.contentEl.innerHTML = "";

    if (!item) {
      const empty = document.createElement("div");
      empty.className = "retrieve-status";
      empty.textContent = "Select an item to inspect metadata, tags/extras, and collection information.";
      this.contentEl.appendChild(empty);
      return;
    }

    const rail = document.createElement("div");
    rail.className = "zotero-vertical-tabs zotero-vertical-tabs--right";
    rail.append(
      this.tabButton("info", this.iconInfo(), "Info"),
      this.tabButton("tags", this.iconTag(), "Tags & Extras"),
      this.tabButton("collection", this.iconCollection(), "Collection")
    );

    const pane = document.createElement("div");
    pane.className = "zotero-detail-pane";
    if (this.activeTab === "info") this.renderInfoPane(pane, item);
    if (this.activeTab === "tags") this.renderTagsPane(pane, item);
    if (this.activeTab === "collection") this.renderCollectionPane(pane, item, state);

    this.contentEl.append(pane, rail);
  }

  private draftFor(item: ZoteroItem): ItemDraft {
    if (!this.drafts.has(item.key)) this.drafts.set(item.key, {});
    return this.drafts.get(item.key)!;
  }

  private merged(item: ZoteroItem): Required<ItemDraft> {
    const draft = this.draftFor(item);
    return {
      title: draft.title ?? item.title ?? "",
      authors: draft.authors ?? item.authors ?? "",
      date: draft.date ?? item.date ?? "",
      year: draft.year ?? item.year ?? "",
      itemType: draft.itemType ?? item.itemType ?? "",
      publicationTitle: draft.publicationTitle ?? item.publicationTitle ?? "",
      doi: draft.doi ?? item.doi ?? "",
      url: draft.url ?? item.url ?? "",
      abstract: draft.abstract ?? item.abstract ?? "",
      tags: draft.tags ?? (item.tags || []),
      extras: draft.extras ?? ""
    };
  }

  private tabButton(tab: DetailTab, iconSvg: string, label: string): HTMLElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "zotero-vtab";
    if (this.activeTab === tab) btn.classList.add("is-active");
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.dataset.voiceAliases = `open ${label},${label},open ${label.toLowerCase().replace(/&/g, "and")}`;
    btn.innerHTML = `<span class=\"zotero-vtab-icon\">${iconSvg}</span>`;
    btn.addEventListener("click", () => {
      this.activeTab = tab;
      this.render(retrieveZoteroContext.getState());
    });
    return btn;
  }

  private iconInfo(): string {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="8" r="1.2" fill="currentColor"/><path d="M12 11v6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  }

  private iconTag(): string {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12V5h7l9 9-7 7-9-9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/></svg>`;
  }

  private iconCollection(): string {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h17v11h-17z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 7.5 7 4.5h13.5v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  }

  private renderInfoPane(host: HTMLElement, item: ZoteroItem): void {
    const data = this.merged(item);

    const title = document.createElement("h5");
    title.className = "zotero-detail-title-v2";
    title.textContent = data.title || "Untitled";
    this.enableDoubleClickEdit(title, data.title, (value) => {
      this.draftFor(item).title = value;
      this.render(retrieveZoteroContext.getState());
    });

    const bibTitle = document.createElement("div");
    bibTitle.className = "zotero-block-title";
    bibTitle.textContent = "Bibliographic Info";

    const grid = document.createElement("div");
    grid.className = "zotero-detail-grid";

    const row = (k: string, v: string, onSave?: (value: string) => void): HTMLElement => {
      const r = document.createElement("div");
      r.className = "zotero-kv-row";
      const key = document.createElement("div");
      key.className = "zotero-kv-key";
      key.textContent = k;
      const val = document.createElement("div");
      val.className = "zotero-kv-val";
      val.textContent = v || "-";
      if (onSave) this.enableDoubleClickEdit(val, v, onSave);
      r.append(key, val);
      return r;
    };

    grid.append(
      row("Title", data.title, (value) => { this.draftFor(item).title = value; }),
      row("Creator", data.authors, (value) => { this.draftFor(item).authors = value; }),
      row("Date", data.date, (value) => { this.draftFor(item).date = value; }),
      row("Year", data.year, (value) => { this.draftFor(item).year = value; }),
      row("Type", data.itemType, (value) => { this.draftFor(item).itemType = value; }),
      row("Source", data.publicationTitle, (value) => { this.draftFor(item).publicationTitle = value; }),
      row("DOI", data.doi, (value) => { this.draftFor(item).doi = value; }),
      row("URL", data.url, (value) => { this.draftFor(item).url = value; }),
      row("Item Key", item.key),
      row("Attachments", String(item.attachments || 0)),
      row("PDFs", String(item.pdfs || 0))
    );

    const abstractTitle = document.createElement("div");
    abstractTitle.className = "zotero-block-title";
    abstractTitle.textContent = "Abstract";

    const abs = document.createElement("p");
    abs.className = "zotero-abstract";
    abs.textContent = data.abstract || "No abstract.";
    this.enableDoubleClickEdit(abs, data.abstract || "", (value) => {
      this.draftFor(item).abstract = value;
      this.render(retrieveZoteroContext.getState());
    }, true);

    host.append(title, bibTitle, grid, abstractTitle, abs);
  }

  private renderTagsPane(host: HTMLElement, item: ZoteroItem): void {
    const data = this.merged(item);

    const tagsTitle = document.createElement("div");
    tagsTitle.className = "zotero-block-title";
    tagsTitle.textContent = "Tags";

    const tagsWrap = document.createElement("div");
    tagsWrap.className = "zotero-tags-pane";
    (data.tags || []).forEach((tag, index) => {
      const chip = document.createElement("span");
      chip.className = "zotero-tag-chip-v2";
      chip.style.setProperty("--tag-hue", String((index * 43) % 360));
      chip.textContent = tag;
      tagsWrap.appendChild(chip);
    });

    const tagsEditHint = document.createElement("div");
    tagsEditHint.className = "retrieve-status";
    tagsEditHint.textContent = "Double-click to edit tags (comma-separated).";

    const tagsEditor = document.createElement("div");
    tagsEditor.className = "zotero-kv-val";
    tagsEditor.textContent = (data.tags || []).join(", ");
    this.enableDoubleClickEdit(tagsEditor, (data.tags || []).join(", "), (value) => {
      this.draftFor(item).tags = value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      this.render(retrieveZoteroContext.getState());
    });

    const extrasTitle = document.createElement("div");
    extrasTitle.className = "zotero-block-title";
    extrasTitle.textContent = "Extras";

    const extras = document.createElement("pre");
    extras.className = "zotero-extra-box";
    extras.textContent = data.extras || "(Double-click to add extras)";
    this.enableDoubleClickEdit(extras, data.extras || "", (value) => {
      this.draftFor(item).extras = value;
      this.render(retrieveZoteroContext.getState());
    }, true);

    host.append(tagsTitle, tagsWrap, tagsEditHint, tagsEditor, extrasTitle, extras);
  }

  private renderCollectionPane(host: HTMLElement, item: ZoteroItem, state: RetrieveZoteroState): void {
    const selectedCollection = retrieveZoteroContext.getSelectedCollection();
    const allCollections = state.collections;

    const currentTitle = document.createElement("div");
    currentTitle.className = "zotero-block-title";
    currentTitle.textContent = "Current Collection";

    const current = document.createElement("div");
    current.className = "zotero-detail-grid";

    const addRow = (k: string, v: string): void => {
      const r = document.createElement("div");
      r.className = "zotero-kv-row";
      const key = document.createElement("div");
      key.className = "zotero-kv-key";
      key.textContent = k;
      const val = document.createElement("div");
      val.className = "zotero-kv-val";
      val.textContent = v || "-";
      r.append(key, val);
      current.appendChild(r);
    };

    const children = selectedCollection ? allCollections.filter((entry) => entry.parentKey === selectedCollection.key) : [];

    addRow("Name", selectedCollection?.name || "-");
    addRow("Key", selectedCollection?.key || "-");
    addRow("Parent Key", selectedCollection?.parentKey || "-");
    addRow("Version", "-");
    addRow("Subcollections Count", String(children.length));
    addRow("Item Panel Count", String(state.items.length));

    const subTitle = document.createElement("div");
    subTitle.className = "zotero-block-title";
    subTitle.textContent = "Subcollections";

    const subList = document.createElement("div");
    subList.className = "zotero-collection-list";
    if (!children.length) {
      const empty = document.createElement("div");
      empty.className = "retrieve-status";
      empty.textContent = "No subcollections found.";
      subList.appendChild(empty);
    } else {
      children.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "zotero-collection-row";
        const itemCount = state.items.filter((paper) => (paper.collections || []).includes(entry.key)).length;
        row.textContent = `${entry.name} | ${entry.key} | Count: ${itemCount}`;
        subList.appendChild(row);
      });
    }

    const linkedTitle = document.createElement("div");
    linkedTitle.className = "zotero-block-title";
    linkedTitle.textContent = "Item Collections";

    const linked = document.createElement("div");
    linked.className = "zotero-collection-list";
    const keys = item.collections || [];
    if (!keys.length) {
      const empty = document.createElement("div");
      empty.className = "retrieve-status";
      empty.textContent = "No collection keys on this item payload.";
      linked.appendChild(empty);
    } else {
      keys.forEach((key) => {
        const match = allCollections.find((entry) => entry.key === key);
        const row = document.createElement("div");
        row.className = "zotero-collection-row";
        row.textContent = `${match?.name || "(unknown)"} | ${key}`;
        linked.appendChild(row);
      });
    }

    host.append(currentTitle, current, subTitle, subList, linkedTitle, linked);
  }

  private enableDoubleClickEdit(
    element: HTMLElement,
    initial: string,
    onSave: (value: string) => void,
    multiline = false
  ): void {
    element.addEventListener("dblclick", () => {
      const editor = multiline ? document.createElement("textarea") : document.createElement("input");
      editor.className = "zotero-inline-editor";
      if (multiline) {
        (editor as HTMLTextAreaElement).rows = 6;
      }
      (editor as HTMLInputElement).value = initial;
      element.replaceWith(editor);
      editor.focus();

      const commit = (): void => {
        const value = (editor as HTMLInputElement).value;
        onSave(value);
        this.render(retrieveZoteroContext.getState());
      };

      editor.addEventListener("keydown", (event) => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          this.render(retrieveZoteroContext.getState());
          return;
        }
        if (!multiline && keyEvent.key === "Enter") {
          keyEvent.preventDefault();
          commit();
          return;
        }
        if (multiline && keyEvent.key === "Enter" && (keyEvent.ctrlKey || keyEvent.metaKey)) {
          keyEvent.preventDefault();
          commit();
        }
      });
      editor.addEventListener("blur", () => commit());
    }, { once: true });
  }
}
