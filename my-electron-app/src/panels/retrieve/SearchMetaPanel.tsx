import { retrieveContext } from "../../state/retrieveContext";
import type { RetrieveCitationNetwork, RetrievePaperSnapshot, RetrieveRecord } from "../../shared/types/retrieve";

export class SearchMetaPanel {
  readonly element: HTMLElement;
  private titleEl: HTMLElement;
  private metaEl: HTMLElement;
  private sourceEl: HTMLElement;
  private idsEl: HTMLElement;
  private venueEl: HTMLElement;
  private citationsEl: HTMLElement;
  private oaEl: HTMLElement;
  private abstractEl: HTMLElement;
  private authorsEl: HTMLElement;
  private openBtn: HTMLButtonElement;
  private oaBtn: HTMLButtonElement;
  private bibBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private graphBtn: HTMLButtonElement;
  private snowballRefsBtn: HTMLButtonElement;
  private snowballCitesBtn: HTMLButtonElement;
  private tagList: HTMLElement;
  private tagInput: HTMLInputElement;
  private tagAddBtn: HTMLButtonElement;
  private unsubscribe: (() => void) | null = null;
  private active?: RetrieveRecord;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    this.element.style.display = "flex";
    this.element.style.flexDirection = "column";
    this.element.style.height = "100%";

    const header = document.createElement("div");
    header.className = "tool-header";
    const title = document.createElement("h4");
    title.textContent = "Retrieve — Details";
    header.appendChild(title);

    const body = document.createElement("div");
    body.style.display = "flex";
    body.style.flexDirection = "column";
    body.style.gap = "10px";
    body.style.padding = "12px";
    body.style.flex = "1";
    body.style.overflow = "auto";

    this.titleEl = document.createElement("h5");
    this.titleEl.style.margin = "0";
    this.titleEl.textContent = "No selection";

    this.metaEl = document.createElement("div");
    this.metaEl.style.opacity = "0.85";
    this.metaEl.style.fontSize = "12px";
    this.metaEl.textContent = "Select a record in the search table.";

    this.sourceEl = document.createElement("div");
    this.sourceEl.style.opacity = "0.8";
    this.sourceEl.style.fontSize = "12px";

    this.idsEl = document.createElement("div");
    this.idsEl.style.opacity = "0.8";
    this.idsEl.style.fontSize = "12px";

    this.venueEl = document.createElement("div");
    this.venueEl.style.opacity = "0.8";
    this.venueEl.style.fontSize = "12px";

    this.citationsEl = document.createElement("div");
    this.citationsEl.style.opacity = "0.8";
    this.citationsEl.style.fontSize = "12px";

    this.oaEl = document.createElement("div");
    this.oaEl.style.opacity = "0.8";
    this.oaEl.style.fontSize = "12px";

    this.authorsEl = document.createElement("div");
    this.authorsEl.style.opacity = "0.8";
    this.authorsEl.style.fontSize = "12px";

    this.abstractEl = document.createElement("p");
    this.abstractEl.style.margin = "0";
    this.abstractEl.style.whiteSpace = "pre-wrap";
    this.abstractEl.style.opacity = "0.9";

    this.openBtn = document.createElement("button");
    this.openBtn.type = "button";
    this.openBtn.className = "ribbon-button";
    this.openBtn.textContent = "Open";
    this.openBtn.disabled = true;
    this.openBtn.addEventListener("click", () => this.openSelected());

    this.graphBtn = document.createElement("button");
    this.graphBtn.type = "button";
    this.graphBtn.className = "ribbon-button";
    this.graphBtn.textContent = "Network Graph";
    this.graphBtn.disabled = true;
    this.graphBtn.addEventListener("click", () => this.openGraph());

    this.snowballRefsBtn = document.createElement("button");
    this.snowballRefsBtn.type = "button";
    this.snowballRefsBtn.className = "ribbon-button";
    this.snowballRefsBtn.textContent = "Snowball: References";
    this.snowballRefsBtn.disabled = true;
    this.snowballRefsBtn.addEventListener("click", () => void this.snowball("references"));

    this.snowballCitesBtn = document.createElement("button");
    this.snowballCitesBtn.type = "button";
    this.snowballCitesBtn.className = "ribbon-button";
    this.snowballCitesBtn.textContent = "Snowball: Citations";
    this.snowballCitesBtn.disabled = true;
    this.snowballCitesBtn.addEventListener("click", () => void this.snowball("citations"));

    this.saveBtn = document.createElement("button");
    this.saveBtn.type = "button";
    this.saveBtn.className = "ribbon-button";
    this.saveBtn.textContent = "Save";
    this.saveBtn.disabled = true;
    this.saveBtn.addEventListener("click", () => void this.saveSelected());

    this.bibBtn = document.createElement("button");
    this.bibBtn.type = "button";
    this.bibBtn.className = "ribbon-button";
    this.bibBtn.textContent = "BibTeX";
    this.bibBtn.disabled = true;
    this.bibBtn.addEventListener("click", () => void this.copyBibtex());

    this.oaBtn = document.createElement("button");
    this.oaBtn.type = "button";
    this.oaBtn.className = "ribbon-button";
    this.oaBtn.textContent = "OA";
    this.oaBtn.disabled = true;
    this.oaBtn.addEventListener("click", () => this.openOpenAccess());

    const actionRow = document.createElement("div");
    actionRow.className = "control-row";
    actionRow.style.gap = "10px";
    actionRow.append(
      this.openBtn,
      this.saveBtn,
      this.bibBtn,
      this.oaBtn,
      this.graphBtn,
      this.snowballRefsBtn,
      this.snowballCitesBtn
    );

    const tagHeader = document.createElement("h6");
    tagHeader.textContent = "Tags";
    tagHeader.style.margin = "10px 0 0 0";

    this.tagList = document.createElement("div");
    this.tagList.className = "retrieve-tag-list";

    const tagInputRow = document.createElement("div");
    tagInputRow.className = "retrieve-tag-input-row";

    this.tagInput = document.createElement("input");
    this.tagInput.type = "text";
    this.tagInput.placeholder = "Add tag";
    this.tagInput.className = "retrieve-tag-input";
    this.tagInput.disabled = true;

    this.tagAddBtn = document.createElement("button");
    this.tagAddBtn.type = "button";
    this.tagAddBtn.className = "retrieve-tag-add";
    this.tagAddBtn.textContent = "Add";
    this.tagAddBtn.disabled = true;
    this.tagAddBtn.addEventListener("click", () => void this.attemptAddTag());

    this.tagInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.attemptAddTag();
      }
    });

    tagInputRow.append(this.tagInput, this.tagAddBtn);

    body.append(
      this.titleEl,
      this.metaEl,
      this.sourceEl,
      this.idsEl,
      this.venueEl,
      this.authorsEl,
      this.citationsEl,
      this.oaEl,
      actionRow,
      this.abstractEl,
      tagHeader,
      this.tagList,
      tagInputRow
    );
    this.element.append(header, body);

    this.unsubscribe = retrieveContext.subscribe((record) => {
      void this.applyRecord(record);
    });

    void this.applyRecord(retrieveContext.getActiveRecord());
  }

  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private async applyRecord(record?: RetrieveRecord): Promise<void> {
    this.active = record;
    this.openBtn.disabled = !record;
    this.graphBtn.disabled = !record;
    this.saveBtn.disabled = !record;
    this.bibBtn.disabled = !record;
    this.oaBtn.disabled = !record;
    this.snowballRefsBtn.disabled = !record;
    this.snowballCitesBtn.disabled = !record;
    this.tagInput.disabled = !record;
    this.tagAddBtn.disabled = !record;
    this.tagList.innerHTML = "";

    if (!record) {
      this.titleEl.textContent = "No selection";
      this.metaEl.textContent = "Select a record in the search table.";
      this.sourceEl.textContent = "";
      this.idsEl.textContent = "";
      this.venueEl.textContent = "";
      this.authorsEl.textContent = "";
      this.citationsEl.textContent = "";
      this.oaEl.textContent = "";
      this.abstractEl.textContent = "";
      return;
    }

    this.titleEl.textContent = record.title || "Untitled";
    const parts: string[] = [];
    if (record.year) parts.push(String(record.year));
    parts.push(record.source);
    if (record.doi) parts.push(record.doi);
    if (record.url) parts.push(record.url);
    this.metaEl.textContent = parts.join(" • ");
    this.sourceEl.textContent = `Source: ${record.source ?? "n/a"}`;
    const doi = record.doi ?? "";
    const pid = record.paperId ?? "";
    this.idsEl.textContent = `Paper ID: ${pid || "n/a"}${doi ? ` • DOI: ${doi}` : ""}`;
    const venue = (record as any).venue ?? (record as any).journal ?? "";
    this.venueEl.textContent = venue ? `Venue: ${venue}` : "";
    const authors = Array.isArray(record.authors) ? record.authors.join(", ") : "";
    this.authorsEl.textContent = authors ? `Authors: ${authors}` : "";
    const cits = record.citationCount;
    this.citationsEl.textContent = typeof cits === "number" ? `Citations: ${cits}` : "";
    const oaStatus = record.openAccess?.status ?? "unknown";
    const oaUrl = record.openAccess?.url ?? "";
    this.oaEl.textContent = `Open Access: ${oaStatus}${oaUrl ? ` • ${oaUrl}` : ""}`;
    this.abstractEl.textContent = record.abstract ?? "";
    await this.refreshTagList(record.paperId);
  }

  private openSelected(): void {
    const record = this.active;
    if (!record) return;
    if (record.doi) {
      window.open(`https://doi.org/${record.doi}`, "_blank", "noreferrer");
      return;
    }
    if (record.url) {
      window.open(record.url, "_blank", "noreferrer");
    }
  }

  private openGraph(): void {
    const record = this.active;
    if (!record) return;
    document.dispatchEvent(new CustomEvent("retrieve:open-graph", { detail: { record } }));
  }

  private async saveSelected(): Promise<void> {
    const record = this.active;
    if (!record) return;
    if (window.retrieveBridge?.library?.save) {
      try {
        const result = await window.retrieveBridge.library.save({ record });
        this.metaEl.textContent = result?.message ?? "Saved to library.";
      } catch (error) {
        console.error("Save to library failed", error);
      }
      return;
    }
    const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${record.title?.slice(0, 60) || "record"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private async copyBibtex(): Promise<void> {
    const record = this.active;
    if (!record) return;
    const authors = Array.isArray(record.authors) ? record.authors.map((a) => a.replace(/,/g, "")).join(" and ") : "";
    const key =
      (record.authors?.[0]?.split(" ").slice(-1)[0] || "item") + (record.year ? String(record.year) : "0000");
    const journal = (record as any).journal ?? (record as any).venue ?? "";
    const bib = [
      "@article{" + key + ",",
      record.title ? `  title = {${record.title}},` : "",
      authors ? `  author = {${authors}},` : "",
      journal ? `  journal = {${journal}},` : "",
      record.year ? `  year = {${record.year}},` : "",
      record.doi ? `  doi = {${record.doi}},` : "",
      record.url ? `  url = {${record.url}},` : "",
      "}"
    ]
      .filter(Boolean)
      .join("\n");
    try {
      await navigator.clipboard.writeText(bib);
    } catch (error) {
      console.error("Unable to copy BibTeX", error);
    }
  }

  private openOpenAccess(): void {
    const record = this.active;
    if (!record) return;
    const oaUrl = record.openAccess?.url;
    if (oaUrl) {
      window.open(oaUrl, "_blank", "noreferrer");
      return;
    }
    if (record.doi && window.retrieveBridge?.oa?.lookup) {
      void window.retrieveBridge.oa.lookup({ doi: record.doi }).then((result) => {
        if (result?.url) {
          this.oaEl.textContent = `Open Access: ${result.status ?? "unknown"} • ${result.url}`;
          window.open(result.url, "_blank", "noreferrer");
        } else {
          this.oaEl.textContent = `Open Access: ${result?.status ?? "unknown"}`;
        }
      });
      return;
    }
    if (record.doi) {
      window.open(`https://doi.org/${record.doi}`, "_blank", "noreferrer");
    } else if (record.url) {
      window.open(record.url, "_blank", "noreferrer");
    }
  }

  private snowball = async (direction: "references" | "citations"): Promise<void> => {
    const record = this.active;
    if (!record) return;
    if (!window.retrieveBridge?.snowball?.run) {
      console.error("Snowball bridge not available.");
      return;
    }
    const btn = direction === "references" ? this.snowballRefsBtn : this.snowballCitesBtn;
    const label = direction === "references" ? "Snowball: References" : "Snowball: Citations";
    btn.disabled = true;
    btn.textContent = `${label} (running…)`;
    try {
      const network = (await window.retrieveBridge.snowball.run({ record, direction })) as RetrieveCitationNetwork;
      document.dispatchEvent(new CustomEvent("retrieve:open-graph", { detail: { record, network } }));
    } catch (error) {
      console.error(`Snowball ${direction} failed`, error);
      this.metaEl.textContent = `${label} failed: ${error instanceof Error ? error.message : "Unknown error"}`;
      this.metaEl.style.color = "#b91c1c";
    }
    btn.textContent = label;
    btn.disabled = !this.active;
  };

  private async refreshTagList(recordId: string): Promise<void> {
    const tags = await this.fetchTagsForRecord(recordId);
    this.tagList.innerHTML = "";
    tags.forEach((tag) => this.tagList.appendChild(this.createTagChip(recordId, tag)));
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

  private createTagChip(recordId: string, tag: string): HTMLElement {
    const chip = document.createElement("span");
    chip.className = "retrieve-tag-chip";
    chip.textContent = tag;
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "retrieve-tag-remove";
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", () => {
      void this.removeTag(recordId, tag);
    });
    chip.appendChild(removeBtn);
    return chip;
  }

  private async attemptAddTag(): Promise<void> {
    const record = this.active;
    if (!record) return;
    const value = this.tagInput.value.trim();
    if (!value) return;
    this.tagInput.value = "";
    await this.addTag(record, value);
  }

  private async addTag(record: RetrieveRecord, tag: string): Promise<void> {
    if (!window.retrieveBridge?.tags?.add) {
      return;
    }
    try {
      await window.retrieveBridge.tags.add({ paper: this.mapRecordToSnapshot(record), tag });
      await this.refreshTagList(record.paperId);
    } catch (error) {
      console.error("Unable to add tag", error);
    }
  }

  private async removeTag(recordId: string, tag: string): Promise<void> {
    if (!window.retrieveBridge?.tags?.remove) {
      return;
    }
    try {
      await window.retrieveBridge.tags.remove({ paperId: recordId, tag });
      await this.refreshTagList(recordId);
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
}
