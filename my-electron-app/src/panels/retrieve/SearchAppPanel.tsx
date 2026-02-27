import { commandInternal } from "../../ribbon/commandDispatcher";
import { retrieveContext } from "../../state/retrieveContext";
import type {
  RetrieveProviderId,
  RetrieveQuery,
  RetrieveRecord,
  RetrieveSort
} from "../../shared/types/retrieve";
import { readRetrieveQueryDefaults } from "../../state/retrieveQueryDefaults";
import type { RetrieveQueryDefaults } from "../../state/retrieveQueryDefaults";
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

const BROWSER_PROVIDER_OPTIONS: Array<{ id: string; label: string }> = [
  { id: "google", label: "Google Scholar" },
  { id: "cambridge", label: "Cambridge" },
  { id: "jstor", label: "JSTOR" },
  { id: "brill", label: "Brill" },
  { id: "digital_commons", label: "Digital Commons" },
  { id: "rand", label: "RAND" },
  { id: "academia", label: "Academia" },
  { id: "elgaronline", label: "ElgarOnline" },
  { id: "springerlink", label: "SpringerLink" }
];

type EmbeddedBrowserElement = HTMLElement & {
  src?: string;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  goBack?: () => void;
  goForward?: () => void;
  reload?: () => void;
  stop?: () => void;
};

export class SearchAppPanel {
  readonly element: HTMLElement;

  private queryInput: HTMLInputElement;
  private yearFromInput: HTMLInputElement;
  private yearToInput: HTMLInputElement;
  private providerSelect: HTMLSelectElement;
  private sortSelect: HTMLSelectElement;
  private limitInput: HTMLInputElement;
  private strategyInput: HTMLTextAreaElement;
  private maxPagesInput: HTMLInputElement;
  private headedInput: HTMLInputElement;
  private includeSemanticInput: HTMLInputElement;
  private includeCrossrefInput: HTMLInputElement;
  private vmModeInput: HTMLInputElement;
  private profileDirInput: HTMLInputElement;
  private profileNameInput: HTMLInputElement;
  private browserProviderChecks = new Map<string, HTMLInputElement>();
  private liveUrlInput: HTMLInputElement;
  private vmImageUrlInput: HTMLInputElement;
  private vmIsoPathInput: HTMLInputElement;
  private vmCpuInput: HTMLInputElement;
  private vmMemoryInput: HTMLInputElement;
  private vmHostProfileDirInput: HTMLInputElement;
  private vmHostProfileTargetInput: HTMLInputElement;
  private vmProfilesSelect: HTMLSelectElement;
  private vmUseViewInput: HTMLInputElement;
  private vmTakeoverInput: HTMLInputElement;
  private vmStatusLine: HTMLDivElement;
  private liveFrame: EmbeddedBrowserElement;
  private runLog: HTMLPreElement;
  private authorInput: HTMLInputElement;
  private venueInput: HTMLInputElement;
  private doiOnly: HTMLInputElement;
  private abstractOnly: HTMLInputElement;
  private statusLine: HTMLElement;
  private pageLine: HTMLElement;
  private errorBanner: HTMLElement;
  private grid: DataGrid;
  private loadMoreBtn: HTMLButtonElement;
  private prevBtn: HTMLButtonElement;
  private exportSelect: HTMLSelectElement;
  private defaultsHandler: (event: Event) => void;
  private agentSearchHandler: (event: Event) => void;

  private records: RetrieveRecord[] = [];
  private totalCount = 0;
  private nextCursor?: string | number | null;
  private lastProvider?: RetrieveProviderId;
  private isLoading = false;
  private selectedIndex: number | null = null;
  private paginationStack: Array<string | number | null> = [null];
  private vmStatusPollTimer: number | null = null;
  private vmAutoRepairInFlight = false;
  private vmLastAutoRepairAt = 0;

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
    this.queryInput.dataset.voiceAliases = "search query,query,search terms,academic search text";
    this.queryInput.style.minWidth = "280px";
    this.queryInput.value = initial?.query ?? "";

    this.providerSelect = document.createElement("select");
    this.providerSelect.ariaLabel = "Provider";
    this.providerSelect.style.minWidth = "160px";
    this.providerSelect.dataset.voiceAliases = "provider,provider selector,search provider,database provider";
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

    this.yearFromInput = document.createElement("input");
    this.yearFromInput.type = "number";
    this.yearFromInput.placeholder = "Year from";
    this.yearFromInput.style.width = "110px";
    this.yearFromInput.dataset.voiceAliases = "year from,publication year from,from year";

    this.yearToInput = document.createElement("input");
    this.yearToInput.type = "number";
    this.yearToInput.placeholder = "Year to";
    this.yearToInput.style.width = "110px";
    this.yearToInput.dataset.voiceAliases = "year to,publication year to,to year";

    this.limitInput = document.createElement("input");
    this.limitInput.type = "number";
    this.limitInput.placeholder = "Limit";
    this.limitInput.style.width = "90px";
    this.limitInput.min = "0";
    this.limitInput.max = "1000";
    this.limitInput.dataset.voiceAliases = "limit,results limit,result count";
    this.applyRetrieveDefaults({
      provider: initial?.provider ?? defaults.provider,
      sort: initial?.sort ?? defaults.sort,
      year_from: initial?.year_from ?? defaults.year_from,
      year_to: initial?.year_to ?? defaults.year_to,
      limit: initial?.limit ?? defaults.limit
    });

    this.authorInput = document.createElement("input");
    this.authorInput.type = "text";
    this.authorInput.placeholder = "Author contains";
    this.authorInput.dataset.voiceAliases = "author contains,author filter,filter by author";
    this.authorInput.style.minWidth = "180px";

    this.venueInput = document.createElement("input");
    this.venueInput.type = "text";
    this.venueInput.placeholder = "Venue contains";
    this.venueInput.dataset.voiceAliases = "venue contains,venue filter,publication contains";
    this.venueInput.style.minWidth = "180px";

    this.doiOnly = document.createElement("input");
    this.doiOnly.type = "checkbox";
    this.doiOnly.id = "doi-only";
    this.doiOnly.ariaLabel = "DOI only";
    this.doiOnly.dataset.voiceAliases = "doi only,include only doi,only doi";
    const doiLabel = document.createElement("label");
    doiLabel.htmlFor = "doi-only";
    doiLabel.textContent = "DOI only";

    this.abstractOnly = document.createElement("input");
    this.abstractOnly.type = "checkbox";
    this.abstractOnly.id = "abstract-only";
    this.abstractOnly.ariaLabel = "Abstract only";
    this.abstractOnly.dataset.voiceAliases = "abstract only,include only abstract,only abstract";
    const absLabel = document.createElement("label");
    absLabel.htmlFor = "abstract-only";
    absLabel.textContent = "Abstract only";

    this.strategyInput = document.createElement("textarea");
    this.strategyInput.rows = 2;
    this.strategyInput.placeholder = "Search strategy (free text).";
    this.strategyInput.style.minWidth = "320px";
    this.strategyInput.style.flex = "1";

    this.maxPagesInput = document.createElement("input");
    this.maxPagesInput.type = "number";
    this.maxPagesInput.min = "1";
    this.maxPagesInput.max = "20";
    this.maxPagesInput.value = "3";
    this.maxPagesInput.style.width = "90px";
    this.maxPagesInput.title = "Max pages per browser provider";

    this.headedInput = document.createElement("input");
    this.headedInput.type = "checkbox";
    this.headedInput.checked = true;
    const headedLabel = document.createElement("label");
    headedLabel.textContent = "Show browser";
    headedLabel.appendChild(this.headedInput);
    headedLabel.style.display = "inline-flex";
    headedLabel.style.alignItems = "center";
    headedLabel.style.gap = "6px";

    this.includeSemanticInput = document.createElement("input");
    this.includeSemanticInput.type = "checkbox";
    this.includeSemanticInput.checked = true;
    const semanticLabel = document.createElement("label");
    semanticLabel.textContent = "Semantic API";
    semanticLabel.appendChild(this.includeSemanticInput);
    semanticLabel.style.display = "inline-flex";
    semanticLabel.style.alignItems = "center";
    semanticLabel.style.gap = "6px";

    this.includeCrossrefInput = document.createElement("input");
    this.includeCrossrefInput.type = "checkbox";
    this.includeCrossrefInput.checked = true;
    const crossrefLabel = document.createElement("label");
    crossrefLabel.textContent = "Crossref API";
    crossrefLabel.appendChild(this.includeCrossrefInput);
    crossrefLabel.style.display = "inline-flex";
    crossrefLabel.style.alignItems = "center";
    crossrefLabel.style.gap = "6px";

    this.vmModeInput = document.createElement("input");
    this.vmModeInput.type = "checkbox";
    this.vmModeInput.checked = false;
    const vmModeLabel = document.createElement("label");
    vmModeLabel.textContent = "VM mode";
    vmModeLabel.appendChild(this.vmModeInput);
    vmModeLabel.style.display = "inline-flex";
    vmModeLabel.style.alignItems = "center";
    vmModeLabel.style.gap = "6px";

    this.profileDirInput = document.createElement("input");
    this.profileDirInput.type = "text";
    this.profileDirInput.value = "scrapping/browser/searches/profiles/default";
    this.profileDirInput.placeholder = "Profile dir";
    this.profileDirInput.style.minWidth = "260px";

    this.profileNameInput = document.createElement("input");
    this.profileNameInput.type = "text";
    this.profileNameInput.value = "Default";
    this.profileNameInput.placeholder = "Profile";
    this.profileNameInput.style.width = "120px";

    const providerCheckHost = document.createElement("div");
    providerCheckHost.className = "control-row";
    providerCheckHost.style.flexWrap = "wrap";
    providerCheckHost.style.gap = "10px";
    BROWSER_PROVIDER_OPTIONS.forEach((provider) => {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = provider.id !== "jstor";
      this.browserProviderChecks.set(provider.id, checkbox);
      const label = document.createElement("label");
      label.style.display = "inline-flex";
      label.style.alignItems = "center";
      label.style.gap = "6px";
      label.append(checkbox, document.createTextNode(provider.label));
      providerCheckHost.appendChild(label);
    });

    const unifiedSearchBtn = document.createElement("button");
    unifiedSearchBtn.className = "ribbon-button";
    unifiedSearchBtn.ariaLabel = "Run unified strategy";
    unifiedSearchBtn.textContent = "Search (Browser + API)";
    unifiedSearchBtn.dataset.voiceAliases = "run unified search,search strategy,browser strategy";
    unifiedSearchBtn.addEventListener("click", () => this.requestUnifiedSearchFromChat());

    this.prevBtn = document.createElement("button");
    this.prevBtn.type = "button";
    this.prevBtn.className = "ribbon-button";
    this.prevBtn.ariaLabel = "Previous page";
    this.prevBtn.textContent = "Prev";
    this.prevBtn.dataset.voiceAliases = "previous page,go back,page back,prev results,previous results";
    this.prevBtn.disabled = true;

    this.loadMoreBtn = document.createElement("button");
    this.loadMoreBtn.type = "button";
    this.loadMoreBtn.className = "ribbon-button";
    this.loadMoreBtn.ariaLabel = "Next page";
    this.loadMoreBtn.textContent = "Next";
    this.loadMoreBtn.dataset.voiceAliases = "next page,load more,more results,continue";
    this.loadMoreBtn.style.display = "none";
    this.loadMoreBtn.addEventListener("click", () => void this.handleSearch(true));
    this.prevBtn.addEventListener("click", () => void this.handleSearch(false, true));

    const controls = document.createElement("div");
    controls.className = "control-row";
    controls.style.display = "flex";
    controls.style.flexDirection = "column";
    controls.style.flexWrap = "wrap";
    controls.style.gap = "10px";
    const strategyRow = document.createElement("div");
    strategyRow.className = "control-row";
    strategyRow.style.flexWrap = "wrap";
    strategyRow.style.gap = "10px";
    strategyRow.append(this.queryInput, this.strategyInput, unifiedSearchBtn);

    const strategyOptionsRow = document.createElement("div");
    strategyOptionsRow.className = "control-row";
    strategyOptionsRow.style.flexWrap = "wrap";
    strategyOptionsRow.style.gap = "10px";
    strategyOptionsRow.append(
      this.maxPagesInput,
      headedLabel,
      semanticLabel,
      crossrefLabel,
      vmModeLabel,
      this.profileDirInput,
      this.profileNameInput
    );

    const zoteroCollectionInput = document.createElement("input");
    zoteroCollectionInput.type = "text";
    zoteroCollectionInput.placeholder = "Zotero collection name or key";
    zoteroCollectionInput.style.minWidth = "260px";
    const loadZoteroBtn = document.createElement("button");
    loadZoteroBtn.className = "ribbon-button";
    loadZoteroBtn.textContent = "Load Zotero";
    loadZoteroBtn.addEventListener("click", () => {
      const target = zoteroCollectionInput.value.trim();
      if (!target) {
        this.updateStatus("Enter a Zotero collection name/key.");
        return;
      }
      void commandInternal("retrieve", "datahub_load_zotero", { collectionName: target }).then((res: any) => {
        if (res?.status === "ok") {
          this.updateStatus(`Zotero loaded: ${String(res?.source?.collectionName || target)}`);
        } else {
          this.showError(res?.message || "Failed to load Zotero collection.");
        }
      });
    });
    const zoteroRow = document.createElement("div");
    zoteroRow.className = "control-row";
    zoteroRow.style.gap = "10px";
    zoteroRow.style.flexWrap = "wrap";
    zoteroRow.append(zoteroCollectionInput, loadZoteroBtn);

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
      this.prevBtn
    );
    controls.append(strategyRow, strategyOptionsRow, providerCheckHost, zoteroRow, filterRow);

    this.errorBanner = document.createElement("div");
    this.errorBanner.className = "retrieve-status";
    this.errorBanner.style.color = "#b91c1c";
    this.errorBanner.style.display = "none";
    this.errorBanner.textContent = "";

    this.statusLine = document.createElement("div");
    this.statusLine.className = "retrieve-status";
    this.statusLine.textContent = "Run a search to load results. Select a row to view details on the right.";

    this.pageLine = document.createElement("div");
    this.pageLine.className = "retrieve-status";
    this.pageLine.style.opacity = "0.75";
    this.pageLine.textContent = "";

    const exportRow = document.createElement("div");
    exportRow.className = "control-row";
    exportRow.style.gap = "8px";
    this.exportSelect = document.createElement("select");
    ["csv", "xlsx", "ris"].forEach((fmt) => {
      const opt = document.createElement("option");
      opt.value = fmt;
      opt.textContent = fmt.toUpperCase();
      this.exportSelect.appendChild(opt);
    });
    const exportBtn = document.createElement("button");
    exportBtn.className = "ribbon-button";
    exportBtn.ariaLabel = "Export current";
    exportBtn.textContent = "Export current";
    exportBtn.dataset.voiceAliases = "export current table,download current results,save data";
    exportBtn.addEventListener("click", () => this.exportCurrent());
    exportRow.append(this.exportSelect, exportBtn);

    this.grid = new DataGrid({
      onRowActivate: (rowIndex) => {
        this.selectRow(rowIndex);
      },
      onRowRender: ({ rowEl, rowIndex, rowData }) => {
        const record = this.records[rowIndex];
        const rowNo = rowIndex + 1;
        const title = String(rowData?.[0] || "Untitled").trim();
        const year = String(rowData?.[2] || "").trim();
        const source = String(rowData?.[4] || "").trim();
        const doi = String(rowData?.[5] || "").trim();
        const labels = [
          `result row ${rowNo}`,
          `row ${rowNo}`,
          `select row ${rowNo}`,
          `record ${rowNo}`,
          `open row ${rowNo}`,
          title ? title : "result",
          source ? source : "",
          year ? `year ${year}` : ""
        ].filter(Boolean);
        if (doi) {
          labels.push(`doi ${doi}`);
          labels.push(doi);
        }
        const normalizedRecord = record ? ` ${record.paperId}` : "";
        rowEl.ariaLabel = `Search result ${rowNo}${record?.title ? `: ${record.title}` : title ? `: ${title}` : ""}`;
        rowEl.dataset.voiceAliases = labels
          .concat(record?.title ? [record.title, `open ${record.title}`, `select ${record.title}`] : [])
          .concat(normalizedRecord ? [`paper ${record?.paperId}`] : [])
          .filter(Boolean)
          .join(",");
      }
    });
    this.grid.element.style.flex = "1";
    this.grid.element.style.height = "100%";

    const gridHost = document.createElement("div");
    gridHost.style.flex = "1 1 100%";
    gridHost.style.minWidth = "720px";
    gridHost.style.minHeight = "420px";
    gridHost.style.display = "flex";
    gridHost.style.flexDirection = "column";
    gridHost.appendChild(this.grid.element);

    this.liveUrlInput = document.createElement("input");
    this.liveUrlInput.type = "text";
    this.liveUrlInput.value = "https://scholar.google.com/";
    this.liveUrlInput.placeholder = "Live assist URL";
    this.liveUrlInput.style.minWidth = "340px";
    this.liveUrlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.setLiveFrameUrl(this.liveUrlInput.value);
      }
    });

    const liveGoBtn = document.createElement("button");
    liveGoBtn.className = "ribbon-button";
    liveGoBtn.textContent = "Open Assist URL";
    liveGoBtn.addEventListener("click", () => this.setLiveFrameUrl(this.liveUrlInput.value));

    const liveBackBtn = document.createElement("button");
    liveBackBtn.className = "ribbon-button";
    liveBackBtn.textContent = "Back";
    liveBackBtn.addEventListener("click", () => {
      if (this.liveFrame.canGoBack?.()) this.liveFrame.goBack?.();
    });

    const liveForwardBtn = document.createElement("button");
    liveForwardBtn.className = "ribbon-button";
    liveForwardBtn.textContent = "Forward";
    liveForwardBtn.addEventListener("click", () => {
      if (this.liveFrame.canGoForward?.()) this.liveFrame.goForward?.();
    });

    const liveReloadBtn = document.createElement("button");
    liveReloadBtn.className = "ribbon-button";
    liveReloadBtn.textContent = "Reload";
    liveReloadBtn.addEventListener("click", () => this.liveFrame.reload?.());

    this.vmImageUrlInput = document.createElement("input");
    this.vmImageUrlInput.type = "text";
    this.vmImageUrlInput.placeholder = "VM cloud image URL (optional)";
    this.vmImageUrlInput.style.minWidth = "320px";

    this.vmIsoPathInput = document.createElement("input");
    this.vmIsoPathInput.type = "text";
    this.vmIsoPathInput.placeholder = "VM ISO path (optional)";
    this.vmIsoPathInput.style.minWidth = "260px";

    this.vmCpuInput = document.createElement("input");
    this.vmCpuInput.type = "number";
    this.vmCpuInput.min = "1";
    this.vmCpuInput.max = "16";
    this.vmCpuInput.value = "7";
    this.vmCpuInput.placeholder = "VM CPUs";
    this.vmCpuInput.style.width = "96px";

    this.vmMemoryInput = document.createElement("input");
    this.vmMemoryInput.type = "number";
    this.vmMemoryInput.min = "1024";
    this.vmMemoryInput.max = "32768";
    this.vmMemoryInput.step = "512";
    this.vmMemoryInput.value = "12288";
    this.vmMemoryInput.placeholder = "VM RAM MB";
    this.vmMemoryInput.style.width = "120px";

    this.vmHostProfileDirInput = document.createElement("input");
    this.vmHostProfileDirInput.type = "text";
    this.vmHostProfileDirInput.value = "scrapping/browser/searches/profiles/default/Default";
    this.vmHostProfileDirInput.placeholder = "Host profile source dir";
    this.vmHostProfileDirInput.style.minWidth = "280px";

    this.vmHostProfileTargetInput = document.createElement("input");
    this.vmHostProfileTargetInput.type = "text";
    this.vmHostProfileTargetInput.value = "scrapping/browser/searches/profiles/default/Default_vm_export";
    this.vmHostProfileTargetInput.placeholder = "Host export target dir";
    this.vmHostProfileTargetInput.style.minWidth = "280px";

    this.vmProfilesSelect = document.createElement("select");
    this.vmProfilesSelect.style.minWidth = "160px";
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "Default";
    defaultOpt.textContent = "Default";
    this.vmProfilesSelect.appendChild(defaultOpt);
    this.vmProfilesSelect.value = this.profileNameInput.value;
    this.vmProfilesSelect.addEventListener("change", () => {
      const selected = this.vmProfilesSelect.value.trim();
      if (selected) this.profileNameInput.value = selected;
    });

    this.vmUseViewInput = document.createElement("input");
    this.vmUseViewInput.type = "checkbox";
    this.vmUseViewInput.checked = true;
    const vmUseViewLabel = document.createElement("label");
    vmUseViewLabel.style.display = "inline-flex";
    vmUseViewLabel.style.alignItems = "center";
    vmUseViewLabel.style.gap = "6px";
    vmUseViewLabel.append(this.vmUseViewInput, document.createTextNode("Use VM browser view"));

    this.vmTakeoverInput = document.createElement("input");
    this.vmTakeoverInput.type = "checkbox";
    this.vmTakeoverInput.checked = false;
    const vmTakeoverLabel = document.createElement("label");
    vmTakeoverLabel.style.display = "inline-flex";
    vmTakeoverLabel.style.alignItems = "center";
    vmTakeoverLabel.style.gap = "6px";
    vmTakeoverLabel.append(this.vmTakeoverInput, document.createTextNode("Take over VM control"));
    this.vmTakeoverInput.addEventListener("change", () => {
      const action = this.vmTakeoverInput.checked ? "vm_acquire_control" : "vm_release_control";
      void this.runVmCommand(action, { owner: "panel" });
    });

    const vmStatusBtn = document.createElement("button");
    vmStatusBtn.className = "ribbon-button";
    vmStatusBtn.textContent = "VM Status";
    vmStatusBtn.addEventListener("click", () => void this.runVmCommand("vm_status"));

    const vmInstallDepsBtn = document.createElement("button");
    vmInstallDepsBtn.className = "ribbon-button";
    vmInstallDepsBtn.textContent = "Install VM Deps";
    vmInstallDepsBtn.addEventListener("click", () => void this.runVmCommand("vm_install_deps"));

    const vmPreflightBtn = document.createElement("button");
    vmPreflightBtn.className = "ribbon-button";
    vmPreflightBtn.textContent = "VM Preflight";
    vmPreflightBtn.addEventListener("click", () => void this.runVmCommand("vm_preflight"));

    const vmPrepareBtn = document.createElement("button");
    vmPrepareBtn.className = "ribbon-button";
    vmPrepareBtn.textContent = "VM Prepare Image";
    vmPrepareBtn.addEventListener("click", () =>
      void this.runVmCommand("vm_prepare_image", { imageUrl: this.vmImageUrlInput.value.trim() })
    );

    const vmInitBtn = document.createElement("button");
    vmInitBtn.className = "ribbon-button";
    vmInitBtn.textContent = "VM Init Disk";
    vmInitBtn.addEventListener("click", () => void this.runVmCommand("vm_init_image", { sizeGb: 40 }));

    const vmSeedBtn = document.createElement("button");
    vmSeedBtn.className = "ribbon-button";
    vmSeedBtn.textContent = "VM Seed";
    vmSeedBtn.addEventListener("click", () => void this.runVmCommand("vm_seed"));

    const vmStartBtn = document.createElement("button");
    vmStartBtn.className = "ribbon-button";
    vmStartBtn.textContent = "VM Start";
    vmStartBtn.addEventListener("click", () =>
      void this.runVmCommand("vm_start", {
        isoPath: this.vmIsoPathInput.value.trim(),
        cpus: this.parseVmCpu(),
        memoryMb: this.parseVmMemoryMb(),
        browserProfileName: this.profileNameInput.value.trim() || "Default"
      })
    );

    const vmStopBtn = document.createElement("button");
    vmStopBtn.className = "ribbon-button";
    vmStopBtn.textContent = "VM Stop";
    vmStopBtn.addEventListener("click", () => void this.runVmCommand("vm_stop"));

    const vmRepairBtn = document.createElement("button");
    vmRepairBtn.className = "ribbon-button";
    vmRepairBtn.textContent = "VM Repair";
    vmRepairBtn.addEventListener("click", () =>
      void this.runVmCommand("vm_repair", { browserProfileName: this.profileNameInput.value.trim() || "Default" })
    );

    const vmDiskBtn = document.createElement("button");
    vmDiskBtn.className = "ribbon-button";
    vmDiskBtn.textContent = "VM Disk Guard";
    vmDiskBtn.addEventListener("click", () => void this.runVmCommand("vm_disk_guard"));

    const vmProfilesBtn = document.createElement("button");
    vmProfilesBtn.className = "ribbon-button";
    vmProfilesBtn.textContent = "VM Profiles";
    vmProfilesBtn.addEventListener("click", () => void this.runVmCommand("vm_list_profiles"));

    const vmSyncProfileBtn = document.createElement("button");
    vmSyncProfileBtn.className = "ribbon-button";
    vmSyncProfileBtn.textContent = "Sync Host Profile";
    vmSyncProfileBtn.addEventListener("click", () =>
      void this.runVmCommand("vm_sync_profile", {
        sourceDir: this.vmHostProfileDirInput.value.trim(),
        profileName: this.profileNameInput.value.trim() || "Default"
      })
    );

    const vmExportProfileBtn = document.createElement("button");
    vmExportProfileBtn.className = "ribbon-button";
    vmExportProfileBtn.textContent = "Export VM Profile";
    vmExportProfileBtn.addEventListener("click", () =>
      void this.runVmCommand("vm_export_profile", {
        targetDir: this.vmHostProfileTargetInput.value.trim(),
        profileName: this.profileNameInput.value.trim() || "Default"
      })
    );

    const smokeBtn = document.createElement("button");
    smokeBtn.className = "ribbon-button";
    smokeBtn.textContent = "Run Smoke";
      smokeBtn.addEventListener("click", () =>
      void this.runVmCommand("run_provider_smoke", {
        providers: this.selectedBrowserProviders(),
        query: (this.strategyInput.value.trim() || this.queryInput.value.trim() || "cyber attribution").trim(),
        maxPages: 1,
        vmMode: this.vmModeInput.checked,
        concurrency: 2,
        profileDir: this.profileDirInput.value.trim() || "scrapping/browser/searches/profiles/default",
        profileName: this.profileNameInput.value.trim() || "Default"
      })
    );

    this.runLog = document.createElement("pre");
    this.runLog.style.margin = "0";
    this.runLog.style.padding = "8px";
    this.runLog.style.border = "1px solid rgba(100,100,100,0.35)";
    this.runLog.style.borderRadius = "8px";
    this.runLog.style.minHeight = "100px";
    this.runLog.style.maxHeight = "180px";
    this.runLog.style.overflow = "auto";
    this.runLog.style.whiteSpace = "pre-wrap";
    this.runLog.style.fontSize = "12px";
    this.runLog.textContent = "Unified run log appears here.\nIf a provider blocks automation, use the assist browser and rerun.";

    this.liveFrame = document.createElement("webview") as EmbeddedBrowserElement;
    this.liveFrame.style.width = "100%";
    this.liveFrame.style.height = "420px";
    this.liveFrame.style.minHeight = "420px";
    this.liveFrame.style.border = "1px solid rgba(100,100,100,0.35)";
    this.liveFrame.style.borderRadius = "8px";
    this.liveFrame.setAttribute("allowpopups", "true");
    this.liveFrame.setAttribute("partition", "persist:retrieve-assist");
    this.liveFrame.src = this.liveUrlInput.value;

    this.vmStatusLine = document.createElement("div");
    this.vmStatusLine.style.fontSize = "12px";
    this.vmStatusLine.style.opacity = "0.9";
    this.vmStatusLine.textContent = "VM: not checked";

    const assistBar = document.createElement("div");
    assistBar.className = "control-row";
    assistBar.style.gap = "8px";
    assistBar.style.flexWrap = "wrap";
    assistBar.append(this.liveUrlInput, liveGoBtn, liveBackBtn, liveForwardBtn, liveReloadBtn, vmUseViewLabel, vmTakeoverLabel);

    const vmBar = document.createElement("div");
    vmBar.className = "control-row";
    vmBar.style.gap = "8px";
    vmBar.style.flexWrap = "wrap";
    vmBar.append(
      this.vmImageUrlInput,
      this.vmIsoPathInput,
      this.vmCpuInput,
      this.vmMemoryInput,
      this.vmProfilesSelect,
      this.vmHostProfileDirInput,
      this.vmHostProfileTargetInput,
      vmPrepareBtn,
      vmInitBtn,
      vmSeedBtn,
      vmStartBtn,
      vmStopBtn,
      vmRepairBtn,
      vmDiskBtn,
      vmProfilesBtn,
      vmSyncProfileBtn,
      vmExportProfileBtn,
      smokeBtn,
      vmPreflightBtn,
      vmInstallDepsBtn,
      vmStatusBtn
    );

    const assistHost = document.createElement("div");
    assistHost.style.display = "flex";
    assistHost.style.flexDirection = "column";
    assistHost.style.gap = "8px";
    assistHost.append(assistBar, vmBar, this.vmStatusLine, this.runLog, this.liveFrame);

    const content = document.createElement("div");
    content.style.flex = "1";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "10px";
    content.append(assistHost, gridHost);

    this.element.append(header, controls, exportRow, this.errorBanner, this.statusLine, this.pageLine, content);

    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.requestUnifiedSearchFromChat();
      }
    });

    this.defaultsHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ defaults?: RetrieveQueryDefaults }>).detail;
      if (!detail?.defaults) return;
      this.applyRetrieveDefaults(detail.defaults);
    };
    document.addEventListener("retrieve:query-defaults-updated", this.defaultsHandler);
    this.agentSearchHandler = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const query = String(detail.query || "").trim();
      const strategy = String(detail.strategy || "").trim();
      const maxPages = Number(detail.maxPages || 3);
      const headed = detail.headed !== false;
      const providers = Array.isArray(detail.browserProviders) ? (detail.browserProviders as string[]) : [];
      if (query) this.queryInput.value = query;
      if (strategy) this.strategyInput.value = strategy;
      if (Number.isFinite(maxPages) && maxPages > 0) this.maxPagesInput.value = String(Math.floor(maxPages));
      this.headedInput.checked = headed;
      if (providers.length) {
        this.browserProviderChecks.forEach((checkbox, provider) => {
          checkbox.checked = providers.includes(provider);
        });
      }
      if (detail.runNow === true) {
        void this.runUnifiedStrategy({
          query: strategy || query,
          browserProviders: providers,
          maxPages,
          headed
        });
      }
    };
    document.addEventListener("retrieve:agent-unified-search", this.agentSearchHandler);
    void this.checkVmCapabilities();
    void this.runVmCommand("vm_status");
    this.vmStatusPollTimer = window.setInterval(() => {
      void this.runVmCommand("vm_status", undefined, false);
    }, 15000);
  }

  destroy(): void {
    document.removeEventListener("retrieve:query-defaults-updated", this.defaultsHandler);
    document.removeEventListener("retrieve:agent-unified-search", this.agentSearchHandler);
    if (this.vmStatusPollTimer !== null) {
      window.clearInterval(this.vmStatusPollTimer);
      this.vmStatusPollTimer = null;
    }
  }

  private applyRetrieveDefaults(defaults: RetrieveQueryDefaults): void {
    this.providerSelect.value = defaults.provider;
    this.sortSelect.value = defaults.sort;
    this.yearFromInput.value = defaults.year_from?.toString() ?? "";
    this.yearToInput.value = defaults.year_to?.toString() ?? "";
    this.limitInput.value = String(defaults.limit);
  }

  private selectedBrowserProviders(): string[] {
    return Array.from(this.browserProviderChecks.entries())
      .filter(([, checkbox]) => checkbox.checked)
      .map(([provider]) => provider);
  }

  private appendRunLog(line: string): void {
    if (!line.trim()) return;
    this.runLog.textContent = `${this.runLog.textContent || ""}\n${line}`.trim();
    this.runLog.scrollTop = this.runLog.scrollHeight;
  }

  private setLiveFrameUrl(raw: string): void {
    const value = raw.trim();
    if (!value) return;
    const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    this.liveFrame.src = withScheme;
  }

  private async runVmCommand(action: string, payload?: Record<string, unknown>, verbose = true): Promise<void> {
    if (verbose) this.vmStatusLine.textContent = `VM: running ${action}...`;
    try {
      const response = (await commandInternal("retrieve", action, payload || {})) as unknown as Record<string, unknown>;
      if (String(response?.status || "") !== "ok") {
        const msg = String(response?.message || "VM command failed");
        this.vmStatusLine.textContent = `VM: ${msg}`;
        if (verbose) this.appendRunLog(`[vm] ${action} failed: ${msg}`);
        if (action === "vm_acquire_control") this.vmTakeoverInput.checked = false;
        if (action === "vm_release_control") this.vmTakeoverInput.checked = true;
        return;
      }
      const vm = (response?.vm || {}) as Record<string, unknown>;
      const profiles = Array.isArray((response as any)?.profiles) ? ((response as any).profiles as string[]) : [];
      if (profiles.length) {
        this.vmProfilesSelect.textContent = "";
        profiles.forEach((name) => {
          const opt = document.createElement("option");
          opt.value = String(name);
          opt.textContent = String(name);
          this.vmProfilesSelect.appendChild(opt);
        });
        const current = this.profileNameInput.value.trim() || "Default";
        this.vmProfilesSelect.value = profiles.includes(current) ? current : profiles[0];
      }
      const disk = (response as any)?.report as Record<string, unknown> | undefined;
      if (disk) {
        const pct = Number(disk.usagePercent || 0);
        const free = Number(disk.freeMb || 0);
        const applied = Boolean(disk.cleanupApplied);
        const diskMsg = `disk usage=${pct}% free=${free}MB cleanup=${applied}`;
        if (verbose) this.appendRunLog(`[vm] ${diskMsg}`);
      }
      const smokeReport = String((response as any)?.reportPath || "");
      if (smokeReport) {
        this.appendRunLog(`[vm] smoke_report=${smokeReport}`);
      }
      const sync = (response as any)?.sync as Record<string, unknown> | undefined;
      if (sync) {
        const src = String(sync.source || "");
        const tgt = String(sync.target || "");
        if (src || tgt) this.appendRunLog(`[vm] profile_sync source=${src} target=${tgt}`);
      }
      const capabilities = Array.isArray((response as any)?.actions) ? ((response as any).actions as string[]) : [];
      if (action === "vm_capabilities" && capabilities.length) {
        this.appendRunLog(`[vm] capabilities=${capabilities.join(",")}`);
      }
      if (!Object.keys(vm).length) {
        const lease = (response?.lease || null) as Record<string, unknown> | null;
        if (action === "vm_acquire_control") {
          this.vmStatusLine.textContent = "VM: control acquired by panel";
          if (verbose) this.appendRunLog(`[vm] control acquired owner=${String(lease?.owner || "panel")}`);
        } else if (action === "vm_release_control") {
          this.vmStatusLine.textContent = "VM: control released";
          if (verbose) this.appendRunLog("[vm] control released");
        } else {
          this.vmStatusLine.textContent = `VM: ${action} completed`;
        }
        return;
      }
      const state = String(vm.state || "unknown");
      const message = String(vm.message || "");
      const guestWeb = String(vm.guest_web_url || "");
      const guestVnc = String(vm.guest_vnc_url || "");
      const sshTarget = String(vm.ssh_target || "");
      this.vmStatusLine.textContent = `VM: ${state}${message ? ` - ${message}` : ""}`;
      if (verbose) {
        this.appendRunLog(`[vm] ${action} -> state=${state} ${message}`);
        if (sshTarget) this.appendRunLog(`[vm] ssh=${sshTarget}`);
        if (guestVnc) this.appendRunLog(`[vm] guest_vnc=${guestVnc}`);
        if (guestWeb) this.appendRunLog(`[vm] guest_web=${guestWeb}`);
      }
      if (this.vmUseViewInput.checked && guestWeb && state === "running") {
        this.liveUrlInput.value = guestWeb;
        if (this.liveFrame.src !== guestWeb) this.setLiveFrameUrl(guestWeb);
      }
      const guestWebReady = vm.guest_web_ready === true;
      const sshReady = vm.ssh_ready === true;
      if (
        action === "vm_status" &&
        !verbose &&
        !this.vmTakeoverInput.checked &&
        !this.vmAutoRepairInFlight &&
        (!guestWebReady || !sshReady)
      ) {
        const now = Date.now();
        if (now - this.vmLastAutoRepairAt > 45000) {
          this.vmAutoRepairInFlight = true;
          this.vmLastAutoRepairAt = now;
          this.appendRunLog("[vm] auto-repair triggered from watchdog");
          void this.runVmCommand("vm_repair", undefined, true).finally(() => {
            this.vmAutoRepairInFlight = false;
          });
        }
      }
    } catch (error) {
      const msg = String((error as Error)?.message || error || "VM command failed");
      this.vmStatusLine.textContent = `VM: ${msg}`;
      if (verbose) this.appendRunLog(`[vm] ${action} exception: ${msg}`);
    }
  }

  private async checkVmCapabilities(): Promise<void> {
    try {
      const response = (await commandInternal("retrieve", "vm_capabilities", {})) as unknown as Record<string, unknown>;
      if (String(response?.status || "") !== "ok") {
        this.appendRunLog("[vm] capability check failed; restart app to load new VM actions.");
        return;
      }
      const actions = Array.isArray((response as any)?.actions) ? ((response as any).actions as string[]) : [];
      const required = ["vm_repair", "vm_disk_guard", "vm_list_profiles", "vm_sync_profile", "vm_export_profile", "run_provider_smoke"];
      const missing = required.filter((name) => !actions.includes(name));
      if (missing.length) {
        this.appendRunLog(`[vm] missing actions: ${missing.join(",")} (restart app required)`);
      }
    } catch {
      this.appendRunLog("[vm] capability handshake unavailable (restart app may be required).");
    }
  }

  private requestUnifiedSearchFromChat(): void {
    const query = (this.strategyInput.value.trim() || this.queryInput.value.trim()).trim();
    if (!query) {
      this.updateStatus("Enter search terms first.");
      return;
    }
    const detail = {
      query: this.queryInput.value.trim(),
      strategy: this.strategyInput.value.trim(),
      maxPages: this.parseNumber(this.maxPagesInput.value) || 3,
      headed: this.headedInput.checked,
      browserProviders: this.selectedBrowserProviders()
    };
    document.dispatchEvent(new CustomEvent("retrieve:request-search-intake", { detail }));
    this.updateStatus("Sent to chat intake. Please answer the follow-up questions in console.");
  }

  private applyLocalUnifiedFilters(records: RetrieveRecord[]): RetrieveRecord[] {
    let next = records.slice();
    if (this.doiOnly.checked) {
      next = next.filter((record) => Boolean(String(record.doi || "").trim()));
    }
    if (this.abstractOnly.checked) {
      next = next.filter((record) => Boolean(String(record.abstract || "").trim()));
    }
    const authorNeedle = this.authorInput.value.trim().toLowerCase();
    if (authorNeedle) {
      next = next.filter((record) => (record.authors || []).some((author) => String(author || "").toLowerCase().includes(authorNeedle)));
    }
    const venueNeedle = this.venueInput.value.trim().toLowerCase();
    if (venueNeedle) {
      next = next.filter((record) => {
        const venue = String((record as any).venue || (record as any).journal || "").toLowerCase();
        return venue.includes(venueNeedle);
      });
    }
    return next;
  }

  private async runUnifiedStrategy(overrides?: {
    query?: string;
    browserProviders?: string[];
    maxPages?: number;
    headed?: boolean;
  }): Promise<void> {
    if (this.isLoading) return;
    const query = (overrides?.query || this.strategyInput.value.trim() || this.queryInput.value.trim()).trim();
    if (!query) {
      this.updateStatus("Enter search terms first.");
      return;
    }
    this.hideError();
    this.isLoading = true;
    this.updateStatus("Running unified browser+API strategy…");
    const browserProviders = (overrides?.browserProviders && overrides.browserProviders.length)
      ? overrides.browserProviders
      : this.selectedBrowserProviders();
    const maxPages = overrides?.maxPages || this.parseNumber(this.maxPagesInput.value) || 3;
    const payload = {
      query,
      browserProviders,
      maxPages,
      headed: overrides?.headed ?? this.headedInput.checked,
      vmMode: this.vmModeInput.checked,
      vmCpus: this.parseVmCpu(),
      vmMemoryMb: this.parseVmMemoryMb(),
      profileDir: this.profileDirInput.value.trim() || "scrapping/browser/searches/profiles/default",
      profileName: this.profileNameInput.value.trim() || "Default",
      includeSemanticApi: this.includeSemanticInput.checked,
      includeCrossrefApi: this.includeCrossrefInput.checked
    };
    document.dispatchEvent(
      new CustomEvent("retrieve:progress:start", {
        detail: {
          query,
          providers: browserProviders
        }
      })
    );
    this.runLog.textContent = `[retrieve][unified][debug] query="${query}" providers=${browserProviders.join(",") || "default"} max_pages=${maxPages}`;
    try {
      const response = await commandInternal("retrieve", "run_unified_strategy", payload);
      if (response?.status !== "ok") {
        const msg = response?.message ?? "Unified strategy failed.";
        this.showError(msg);
        this.updateStatus(msg);
        return;
      }
      const items = (response?.items ?? []) as RetrieveRecord[];
      const filteredItems = this.applyLocalUnifiedFilters(items);
      this.records = filteredItems;
      this.totalCount = filteredItems.length;
      this.nextCursor = undefined;
      this.selectedIndex = null;
      this.renderTable();
      this.updateLoadMoreVisibility();
      const runDir = String((response as any)?.runDir || "");
      const unifiedPath = String((response as any)?.unifiedPath || "");
      const vmMode = Boolean((response as any)?.vmMode);
      const vm = ((response as any)?.vm || {}) as Record<string, unknown>;
      this.updateStatus(`Unified run done: ${filteredItems.length} records.`);
      if (vmMode) {
        const vmState = String(vm.state || "unknown");
        const vmMsg = String(vm.message || "");
        this.appendRunLog(`[retrieve][unified][debug] vm_mode=true vm_state=${vmState}${vmMsg ? ` vm_message=${vmMsg}` : ""}`);
        const guestWeb = String(vm.guest_web_url || "");
        if (guestWeb) this.appendRunLog(`[retrieve][unified][debug] vm_guest_web=${guestWeb}`);
      }
      if (runDir) {
        this.appendRunLog(`[retrieve][unified][debug] run_dir=${runDir}`);
      }
      if (unifiedPath) {
        this.appendRunLog(`[retrieve][unified][debug] unified_json=${unifiedPath}`);
      }
      const logs = Array.isArray((response as any)?.logs) ? ((response as any).logs as string[]) : [];
      logs.slice(-80).forEach((line) => this.appendRunLog(line));
      logs.forEach((line) => {
        const m = line.match(/^\[bundle\]\s+([a-z0-9_]+)\s+status=(ok|error)\s+hits=(\d+)\s+downloads=(\d+)/i);
        if (!m) return;
        document.dispatchEvent(
          new CustomEvent("retrieve:progress:provider", {
            detail: {
              provider: m[1],
              status: m[2] === "ok" ? "done" : "error",
              hits: Number(m[3]),
              downloads: Number(m[4])
            }
          })
        );
      });
      const failedProviders = Array.isArray((response as any)?.failedProviders)
        ? ((response as any).failedProviders as unknown[]).map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      if (failedProviders.length) {
        this.appendRunLog(`[retrieve][unified][debug] failed_providers=${failedProviders.join(",")}`);
        this.showError(`Some providers require manual intervention: ${failedProviders.join(", ")}`);
      }
      const helperPrompt =
        "If any source was blocked, use Open Assist URL, complete login/captcha in the embedded page, then rerun unified strategy.";
      this.appendRunLog(`[retrieve][unified][debug] ${helperPrompt}`);
      document.dispatchEvent(
        new CustomEvent("retrieve:progress:done", {
          detail: {
            failedProviders
          }
        })
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.showError(msg);
      this.updateStatus("Unified strategy failed.");
      this.appendRunLog(`[retrieve][unified][debug] error=${msg}`);
      document.dispatchEvent(
        new CustomEvent("retrieve:progress:done", {
          detail: {
            failedProviders: browserProviders
          }
        })
      );
    } finally {
      this.isLoading = false;
    }
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
        this.showError(response?.message ?? "Search failed (unknown error). Check API keys or rate limits.");
        this.updateStatus(response?.message ?? "Search failed.");
        return;
      }
      this.hideError();
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

  private parseVmCpu(): number | undefined {
    const value = this.parseNumber(this.vmCpuInput.value);
    if (!value) return undefined;
    return Math.max(1, Math.min(16, Math.trunc(value)));
  }

  private parseVmMemoryMb(): number | undefined {
    const value = this.parseNumber(this.vmMemoryInput.value);
    if (!value) return undefined;
    return Math.max(1024, Math.min(32768, Math.trunc(value)));
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

  private showError(message: string): void {
    this.errorBanner.textContent = message;
    this.errorBanner.style.display = "block";
  }

  private hideError(): void {
    this.errorBanner.textContent = "";
    this.errorBanner.style.display = "none";
  }

  private updateLoadMoreVisibility(): void {
    if (this.nextCursor !== undefined && this.nextCursor !== null) {
      this.loadMoreBtn.style.display = "inline-flex";
    } else {
      this.loadMoreBtn.style.display = "none";
    }
    this.prevBtn.disabled = this.paginationStack.length <= 1;
    const currentPage = this.paginationStack.length;
    const totalKnown = this.totalCount ? ` • ${this.records.length} / ${this.totalCount}` : ` • ${this.records.length}`;
    this.pageLine.textContent = `Page ${currentPage}${totalKnown}`;
  }

  private renderTable(): void {
    const columns = ["Title", "Authors", "Year", "Venue", "Source", "DOI", "URL", "Citations", "OA"];
    const rows = this.records.map((record) => [
      record.title,
      record.authors?.join("; ") ?? "",
      record.year ?? "",
      (record as any).venue ?? (record as any).journal ?? "",
      record.source,
      record.doi ?? "",
      record.url ?? "",
      typeof record.citationCount === "number" ? record.citationCount : "",
      record.openAccess?.status ?? ""
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

  private exportCurrent(): void {
    if (!this.records.length) {
      this.updateStatus("No rows to export.");
      return;
    }
    const format = this.exportSelect.value as "csv" | "xlsx" | "ris";
    if (window.retrieveBridge?.library?.export) {
      void window.retrieveBridge.library.export({ rows: this.records, format, targetPath: "" }).then((res) => {
        this.updateStatus(res?.message ?? `Exported (${format.toUpperCase()}).`);
      });
    }
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
