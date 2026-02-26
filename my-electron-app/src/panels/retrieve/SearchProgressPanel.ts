type ProviderStatus = "queued" | "running" | "done" | "error";

type ProviderRow = {
  status: ProviderStatus;
  hits?: number;
  downloads?: number;
};

export class SearchProgressPanel {
  readonly element: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private barEl: HTMLElement;
  private listEl: HTMLElement;
  private providers: string[] = [];
  private rows = new Map<string, ProviderRow>();
  private startHandler: (event: Event) => void;
  private providerHandler: (event: Event) => void;
  private doneHandler: (event: Event) => void;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "tool-surface";
    this.element.style.display = "flex";
    this.element.style.flexDirection = "column";
    this.element.style.height = "100%";

    const header = document.createElement("div");
    header.className = "tool-header";
    const title = document.createElement("h4");
    title.textContent = "Retrieve Progress";
    header.appendChild(title);

    this.titleEl = document.createElement("div");
    this.titleEl.style.fontWeight = "600";
    this.titleEl.style.padding = "10px 12px 2px";
    this.titleEl.textContent = "Waiting for search";

    this.subtitleEl = document.createElement("div");
    this.subtitleEl.style.fontSize = "12px";
    this.subtitleEl.style.opacity = "0.8";
    this.subtitleEl.style.padding = "0 12px 8px";
    this.subtitleEl.textContent = "";

    const barWrap = document.createElement("div");
    barWrap.style.height = "10px";
    barWrap.style.margin = "0 12px 10px";
    barWrap.style.borderRadius = "999px";
    barWrap.style.background = "rgba(120,120,120,0.25)";
    this.barEl = document.createElement("div");
    this.barEl.style.height = "100%";
    this.barEl.style.width = "0%";
    this.barEl.style.borderRadius = "999px";
    this.barEl.style.background = "linear-gradient(90deg, #2ea043 0%, #56d364 100%)";
    barWrap.appendChild(this.barEl);

    this.listEl = document.createElement("div");
    this.listEl.style.flex = "1";
    this.listEl.style.overflow = "auto";
    this.listEl.style.padding = "0 10px 12px";

    this.element.append(header, this.titleEl, this.subtitleEl, barWrap, this.listEl);

    this.startHandler = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const providers = Array.isArray(detail.providers) ? (detail.providers as string[]).map((p) => String(p || "").trim()).filter(Boolean) : [];
      this.providers = providers;
      this.rows = new Map(providers.map((provider) => [provider, { status: "queued" as ProviderStatus }]));
      this.titleEl.textContent = `Searching: ${String(detail.query || "").trim() || "query"}`;
      this.subtitleEl.textContent = providers.length ? `Providers queued: ${providers.join(", ")}` : "Providers queued";
      this.render();
    };

    this.providerHandler = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const provider = String(detail.provider || "").trim();
      if (!provider) return;
      const current = this.rows.get(provider) || { status: "queued" as ProviderStatus };
      const status = String(detail.status || current.status) as ProviderStatus;
      this.rows.set(provider, {
        status,
        hits: Number.isFinite(Number(detail.hits)) ? Number(detail.hits) : current.hits,
        downloads: Number.isFinite(Number(detail.downloads)) ? Number(detail.downloads) : current.downloads
      });
      this.render();
    };

    this.doneHandler = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const failed = Array.isArray(detail.failedProviders)
        ? (detail.failedProviders as unknown[]).map((p) => String(p || "").trim()).filter(Boolean)
        : [];
      failed.forEach((provider) => {
        const current = this.rows.get(provider) || { status: "queued" as ProviderStatus };
        this.rows.set(provider, { ...current, status: "error" });
      });
      this.titleEl.textContent = failed.length ? "Search finished with issues" : "Search completed";
      this.subtitleEl.textContent = failed.length ? `Failed providers: ${failed.join(", ")}` : "All providers completed";
      this.render();
    };

    document.addEventListener("retrieve:progress:start", this.startHandler);
    document.addEventListener("retrieve:progress:provider", this.providerHandler);
    document.addEventListener("retrieve:progress:done", this.doneHandler);
  }

  destroy(): void {
    document.removeEventListener("retrieve:progress:start", this.startHandler);
    document.removeEventListener("retrieve:progress:provider", this.providerHandler);
    document.removeEventListener("retrieve:progress:done", this.doneHandler);
  }

  private render(): void {
    const providers = this.providers.length ? this.providers : Array.from(this.rows.keys());
    const total = providers.length || 1;
    let done = 0;
    providers.forEach((provider) => {
      const row = this.rows.get(provider);
      if (!row) return;
      if (row.status === "done" || row.status === "error") done += 1;
    });
    const percent = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    this.barEl.style.width = `${percent}%`;

    this.listEl.innerHTML = "";
    providers.forEach((provider) => {
      const row = this.rows.get(provider) || { status: "queued" as ProviderStatus };
      const item = document.createElement("div");
      item.style.display = "flex";
      item.style.justifyContent = "space-between";
      item.style.gap = "8px";
      item.style.padding = "6px 8px";
      item.style.marginBottom = "6px";
      item.style.borderRadius = "8px";
      item.style.background = "rgba(90,90,90,0.16)";
      const left = document.createElement("div");
      left.textContent = provider;
      left.style.fontWeight = "600";
      const right = document.createElement("div");
      const statusLabel =
        row.status === "done"
          ? "done"
          : row.status === "error"
            ? "error"
            : row.status === "running"
              ? "running"
              : "queued";
      right.textContent = `status=${statusLabel}${typeof row.hits === "number" ? ` hits=${row.hits}` : ""}${typeof row.downloads === "number" ? ` dl=${row.downloads}` : ""}`;
      right.style.fontSize = "12px";
      right.style.opacity = "0.85";
      item.append(left, right);
      this.listEl.appendChild(item);
    });
  }
}
