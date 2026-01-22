import { command } from "./commandDispatcher";

type RetrieveProviderId =
  | "semantic_scholar"
  | "crossref"
  | "openalex"
  | "elsevier"
  | "wos"
  | "unpaywall"
  | "cos";

interface RetrieveTabOptions {
  openQueryBuilder?: () => void;
  openCitations?: () => void;
  openCitationGraph?: () => void;
}

export class RetrieveTab {
  private mount: HTMLElement;
  private providerSelect!: HTMLSelectElement;
  private queryInput!: HTMLInputElement;
  private openQueryBuilder?: () => void;
  private openCitations?: () => void;
  private openCitationGraph?: () => void;

  constructor(mount: HTMLElement, options: RetrieveTabOptions = {}) {
    this.mount = mount;
    this.openQueryBuilder = options.openQueryBuilder;
    this.openCitations = options.openCitations;
    this.openCitationGraph = options.openCitationGraph;
    this.render();
  }

  private render(): void {
    this.mount.innerHTML = "";
    this.mount.classList.add("ribbon-root");
    this.mount.appendChild(this.renderDataSources());
    this.mount.appendChild(this.renderEnrichment());
    this.mount.appendChild(this.renderCitationTools());
  }

  private renderDataSources(): HTMLElement {
    const group = this.makeGroup("Data Sources");
    const queryBuilderBtn = this.makeButton("Query Builder", "open_query_builder", "Open the query builder panel");
    group.appendChild(queryBuilderBtn);

    const quickRow = document.createElement("div");
    quickRow.style.display = "flex";
    quickRow.style.alignItems = "center";
    quickRow.style.gap = "8px";

    this.providerSelect = document.createElement("select");
    this.providerSelect.ariaLabel = "Provider";
    this.providerSelect.style.minWidth = "150px";
    this.populateProviders(this.providerSelect, [
      "semantic_scholar",
      "crossref",
      "openalex",
      "elsevier",
      "wos",
      "unpaywall",
      "cos"
    ]);

    this.queryInput = document.createElement("input");
    this.queryInput.type = "text";
    this.queryInput.placeholder = "Keyword or DOI";
    this.queryInput.style.minWidth = "220px";

    const fetchBtn = this.makeButton("Fetch from Source", "fetch_from_source", "Execute provider search", () => ({
      provider: this.providerSelect.value,
      query: this.queryInput.value.trim() || undefined
    }));
    fetchBtn.style.background = "var(--accent-2)";
    fetchBtn.style.borderColor = "var(--accent-2)";

    quickRow.appendChild(this.providerSelect);
    quickRow.appendChild(this.queryInput);
    quickRow.appendChild(fetchBtn);
    group.appendChild(quickRow);

    const importBtn = this.makeButton("Import File", "import_file", "Import RIS/BibTeX/CSV/JSON from disk");
    group.appendChild(importBtn);

    return group;
  }

  private renderEnrichment(): HTMLElement {
    const group = this.makeGroup("Enrichment");
    const oaBtn = this.makeButton("Paywall / OA status", "fetch_from_source", "Check OA via Unpaywall", () => ({
      provider: "unpaywall",
      query: this.queryInput?.value.trim() || undefined
    }));
    const dedupeBtn = this.makeButton("Deduplicate / merge (COS)", "fetch_from_source", "Run merged COS search", () => ({
      provider: "cos",
      query: this.queryInput?.value.trim() || undefined
    }));
    group.appendChild(oaBtn);
    group.appendChild(dedupeBtn);
    return group;
  }

  private renderCitationTools(): HTMLElement {
    const group = this.makeGroup("Citation Tools");
    group.appendChild(this.makeButton("Citation list", "open_citations", "Open citations panel"));
    group.appendChild(this.makeButton("Citation graph", "open_citation_graph", "Open citation graph"));
    return group;
  }

  private populateProviders(select: HTMLSelectElement, ids: RetrieveProviderId[]): void {
    ids.forEach((id) => {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = this.prettyProvider(id);
      select.appendChild(option);
    });
  }

  private makeGroup(titleText: string): HTMLElement {
    const group = document.createElement("div");
    group.className = "ribbon-group";
    const title = document.createElement("h3");
    title.textContent = titleText;
    group.appendChild(title);
    return group;
  }

  private makeButton(
    label: string,
    action: string,
    hint: string,
    payloadFactory?: () => Record<string, unknown> | undefined
  ): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ribbon-button";
    btn.textContent = label;
    btn.title = hint;
    btn.addEventListener("click", () => {
      if (action === "open_query_builder" && this.openQueryBuilder) {
        this.openQueryBuilder();
      }
      if (action === "open_citations" && this.openCitations) {
        this.openCitations();
      }
      if (action === "open_citation_graph" && this.openCitationGraph) {
        this.openCitationGraph();
      }
      const payload = payloadFactory ? payloadFactory() : undefined;
      void this.dispatch(action, payload);
    });
    return btn;
  }

  private async dispatch(action: string, payload?: Record<string, unknown>): Promise<void> {
    try {
      await command("retrieve", action, payload);
    } catch (err) {
      console.error(`retrieve action failed: ${action}`, err);
    }
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
}