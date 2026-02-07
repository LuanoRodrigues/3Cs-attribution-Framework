import type { EditorHandle } from "../api/leditor.ts";
import { snapshotFromSelection, type StoredSelection } from "../utils/selection_snapshot";
import { getHostContract } from "./host_contract.ts";
import { getHostAdapter } from "../host/host_adapter.ts";
import { upsertReferenceItems } from "./references/library.ts";
import "./direct_quote_lookup.css";

type DirectQuoteResult = {
  dqid: string;
  title?: string;
  author?: string;
  year?: string;
  source?: string;
  page?: number;
  directQuote?: string;
  paraphrase?: string;
  score?: number;
};

const PANEL_ID = "leditor-direct-quote-panel";
const STORAGE_KEY = "leditor.directQuote.deepScan";
const SORT_KEY = "leditor.directQuote.sort";

type SortKey = "score" | "title" | "year";

let panel: HTMLElement | null = null;
let currentHandle: EditorHandle | null = null;
let lastResults: DirectQuoteResult[] = [];
let filtersLoaded = false;
let loadFiltersFn: (() => void) | null = null;
let lastSelectionSnapshot: StoredSelection | null = null;
const getHost = (): HTMLElement | null => {
  const appRoot = document.getElementById("leditor-app");
  if (!appRoot) return null;
  return appRoot.querySelector<HTMLElement>(".leditor-main-split") ?? appRoot;
};

const ensurePanel = (): HTMLElement | null => {
  if (panel) return panel;
  const host = getHost();
  if (!host) return null;

  const root = document.createElement("aside");
  root.id = PANEL_ID;
  root.className = "leditor-direct-quote-panel";
  root.setAttribute("role", "complementary");
  root.setAttribute("aria-label", "Direct Quote Lookup");

  const header = document.createElement("div");
  header.className = "leditor-direct-quote-header";
  const title = document.createElement("div");
  title.className = "leditor-direct-quote-title";
  title.textContent = "Direct Quote Lookup";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "leditor-ui-btn leditor-ui-btn--ghost";
  closeBtn.textContent = "Close";
  closeBtn.addEventListener("click", () => root.classList.remove("is-open"));
  header.append(title, closeBtn);

  const controls = document.createElement("div");
  controls.className = "leditor-direct-quote-controls";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "leditor-direct-quote-input";
  input.placeholder = "Search local direct quotes...";
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "leditor-ui-btn";
  searchBtn.textContent = "Search";
  controls.append(input, searchBtn);

  const options = document.createElement("div");
  options.className = "leditor-direct-quote-options";
  const deepScanWrap = document.createElement("label");
  deepScanWrap.className = "leditor-direct-quote-option";
  const deepScanToggle = document.createElement("input");
  deepScanToggle.type = "checkbox";
  deepScanToggle.className = "leditor-direct-quote-toggle";
  const deepScanLabel = document.createElement("span");
  deepScanLabel.textContent = "Deep scan (slower)";
  deepScanWrap.append(deepScanToggle, deepScanLabel);

  const readDeepScan = (): boolean => {
    try {
      const raw = window.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return false;
      return raw === "1" || raw.toLowerCase() === "true";
    } catch {
      return false;
    }
  };
  const writeDeepScan = (value: boolean) => {
    try {
      window.localStorage?.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // ignore
    }
  };
  deepScanToggle.checked = readDeepScan();
  deepScanToggle.addEventListener("change", () => {
    writeDeepScan(deepScanToggle.checked);
    filtersLoaded = false;
    if (root.classList.contains("is-open") && loadFiltersFn) {
      loadFiltersFn();
    }
  });

  const sortWrap = document.createElement("label");
  sortWrap.className = "leditor-direct-quote-sort";
  const sortLabel = document.createElement("span");
  sortLabel.textContent = "Sort";
  const sortSelect = document.createElement("select");
  sortSelect.className = "leditor-ui-select";
  const sortOptions: Array<{ value: SortKey; label: string }> = [
    { value: "score", label: "Score" },
    { value: "year", label: "Year" },
    { value: "title", label: "Title" }
  ];
  sortOptions.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    sortSelect.appendChild(option);
  });
  const readSort = (): SortKey => {
    try {
      const raw = window.localStorage?.getItem(SORT_KEY);
      return raw === "title" || raw === "year" ? raw : "score";
    } catch {
      return "score";
    }
  };
  const writeSort = (value: SortKey) => {
    try {
      window.localStorage?.setItem(SORT_KEY, value);
    } catch {
      // ignore
    }
  };
  sortSelect.value = readSort();
  sortSelect.addEventListener("change", () => {
    writeSort(sortSelect.value as SortKey);
    renderResults(lastResults);
  });
  sortWrap.append(sortLabel, sortSelect);

  const status = document.createElement("div");
  status.className = "leditor-direct-quote-status";
  status.textContent = "Enter a query to search local direct quotes.";

  const filters = document.createElement("div");
  filters.className = "leditor-direct-quote-filters";
  const filtersHeader = document.createElement("div");
  filtersHeader.className = "leditor-direct-quote-filters__header";
  const filtersTitle = document.createElement("div");
  filtersTitle.className = "leditor-direct-quote-filters__title";
  filtersTitle.textContent = "Filters";
  const filtersActions = document.createElement("div");
  filtersActions.className = "leditor-direct-quote-filters__actions";
  const filtersToggle = document.createElement("button");
  filtersToggle.type = "button";
  filtersToggle.className = "leditor-ui-btn leditor-ui-btn--ghost";
  filtersToggle.textContent = "Hide";
  const filtersBtn = document.createElement("button");
  filtersBtn.type = "button";
  filtersBtn.className = "leditor-ui-btn leditor-ui-btn--ghost";
  filtersBtn.textContent = "Load";
  filtersActions.append(filtersToggle, filtersBtn);
  filtersHeader.append(filtersTitle, filtersActions);
  const filtersGrid = document.createElement("div");
  filtersGrid.className = "leditor-direct-quote-filters__grid";
  const normalizeFilterText = (value: string) =>
    String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const createMultiSelect = (args: { label: string; storageKey: string; placeholder: string }) => {
    const details = document.createElement("details");
    details.className = "leditor-direct-quote-filter";
    const summary = document.createElement("summary");
    summary.className = "leditor-direct-quote-filter__summary";
    summary.textContent = `${args.label}: ${args.placeholder}`;
    const panel = document.createElement("div");
    panel.className = "leditor-direct-quote-filter__panel";
    const actionRow = document.createElement("div");
    actionRow.className = "leditor-direct-quote-filter__actions";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "leditor-ui-btn leditor-ui-btn--ghost";
    clearBtn.textContent = "Clear";
    actionRow.appendChild(clearBtn);
    const search = document.createElement("input");
    search.type = "text";
    search.className = "leditor-ui-input";
    search.placeholder = "Search...";
    const list = document.createElement("div");
    list.className = "leditor-direct-quote-filter__list";
    panel.append(actionRow, search, list);
    details.append(summary, panel);

    let options: Array<{ value: string; count?: number }> = [];
    const selected = new Set<string>();

    const readStored = () => {
      try {
        const raw = window.localStorage?.getItem(args.storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((v) => {
            if (typeof v === "string" && v.trim()) selected.add(v);
          });
        }
      } catch {
        // ignore
      }
    };

    const persist = () => {
      try {
        window.localStorage?.setItem(args.storageKey, JSON.stringify(Array.from(selected.values())));
      } catch {
        // ignore
      }
    };

    const updateSummary = () => {
      if (selected.size === 0) {
        summary.textContent = `${args.label}: ${args.placeholder}`;
        return;
      }
      if (selected.size === 1) {
        summary.textContent = `${args.label}: ${Array.from(selected.values())[0]}`;
        return;
      }
      summary.textContent = `${args.label}: ${selected.size} selected`;
    };

    const renderList = () => {
      const term = normalizeFilterText(search.value);
      list.innerHTML = "";
      const filtered = term
        ? options.filter((opt) => normalizeFilterText(opt.value).includes(term))
        : options;
      if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "leditor-direct-quote-filter__empty";
        empty.textContent = "No matches.";
        list.appendChild(empty);
        return;
      }
      filtered.forEach((opt) => {
        const row = document.createElement("label");
        row.className = "leditor-direct-quote-filter__option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selected.has(opt.value);
        checkbox.addEventListener("change", () => {
          if (checkbox.checked) {
            selected.add(opt.value);
          } else {
            selected.delete(opt.value);
          }
          persist();
          updateSummary();
        });
        const text = document.createElement("span");
        text.textContent =
          typeof opt.count === "number" && opt.count > 0 ? `${opt.value} (${opt.count})` : opt.value;
        row.append(checkbox, text);
        list.appendChild(row);
      });
    };

    clearBtn.addEventListener("click", () => {
      selected.clear();
      persist();
      updateSummary();
      renderList();
    });
    search.addEventListener("input", renderList);
    readStored();
    updateSummary();

    return {
      root: details,
      setOptions: (next: Array<{ value: string; count?: number }>) => {
        options = Array.isArray(next) ? next : [];
        renderList();
        updateSummary();
      },
      getSelected: () => Array.from(selected.values())
    };
  };

  const evidenceFilter = createMultiSelect({
    label: "Evidence",
    storageKey: "leditor.directQuote.filter.evidence",
    placeholder: "Any"
  });
  const themeFilter = createMultiSelect({
    label: "Theme",
    storageKey: "leditor.directQuote.filter.theme",
    placeholder: "Any"
  });
  const rqFilter = createMultiSelect({
    label: "Research Q",
    storageKey: "leditor.directQuote.filter.rq",
    placeholder: "Any"
  });
  const authorFilter = createMultiSelect({
    label: "Author",
    storageKey: "leditor.directQuote.filter.author",
    placeholder: "Any"
  });
  const yearFilter = createMultiSelect({
    label: "Year",
    storageKey: "leditor.directQuote.filter.year",
    placeholder: "Any"
  });

  filtersGrid.append(
    evidenceFilter.root,
    themeFilter.root,
    rqFilter.root,
    authorFilter.root,
    yearFilter.root
  );
  filters.append(filtersHeader, filtersGrid);

  const list = document.createElement("div");
  list.className = "leditor-direct-quote-results";

  const sortResults = (results: DirectQuoteResult[]): DirectQuoteResult[] => {
    const key = sortSelect.value as SortKey;
    const sorted = [...results];
    if (key === "title") {
      sorted.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
      return sorted;
    }
    if (key === "year") {
      sorted.sort((a, b) => {
        const ay = Number(a.year) || 0;
        const by = Number(b.year) || 0;
        if (ay === by) return (a.title || "").localeCompare(b.title || "");
        return by - ay;
      });
      return sorted;
    }
    sorted.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    return sorted;
  };

  const renderResults = (results: DirectQuoteResult[]) => {
    lastResults = results;
    list.innerHTML = "";
    const sorted = sortResults(results);
    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "leditor-direct-quote-empty";
      empty.textContent = "No matches.";
      list.appendChild(empty);
      return;
    }
    sorted.forEach((item) => {
      const card = document.createElement("div");
      card.className = "leditor-direct-quote-card";

      const quote = document.createElement("div");
      quote.className = "leditor-direct-quote-card__quote";
      const quoteBody = document.createElement("div");
      quoteBody.className = "leditor-direct-quote-card__quoteBody";
      const quoteText = item.directQuote || item.paraphrase || "";
      quoteBody.textContent = quoteText ? `"${quoteText.slice(0, 520)}"` : "";
      if (!quoteText) {
        quote.style.display = "none";
      }
      quote.append(quoteBody);

      const headerRow = document.createElement("div");
      headerRow.className = "leditor-direct-quote-card__header";
      const titleEl = document.createElement("div");
      titleEl.className = "leditor-direct-quote-card__title";
      titleEl.textContent = item.title || item.directQuote || item.paraphrase || item.dqid;
      const score = Number.isFinite(item.score) ? Math.round(Number(item.score)) : null;
      const scoreBadge = document.createElement("span");
      scoreBadge.className = "leditor-direct-quote-card__score";
      scoreBadge.textContent = score !== null ? String(score) : "";
      if (score === null) {
        scoreBadge.style.display = "none";
      }
      const metaEl = document.createElement("div");
      metaEl.className = "leditor-direct-quote-card__meta";
      const metaParts = [
        item.author,
        item.year,
        item.source,
        item.page ? `p.${item.page}` : ""
      ].filter(Boolean);
      metaEl.textContent = metaParts.join(" - ");
      headerRow.append(titleEl, scoreBadge, metaEl);

      const actions = document.createElement("div");
      actions.className = "leditor-direct-quote-card__actions";
      const insertBtn = document.createElement("button");
      insertBtn.type = "button";
      insertBtn.className = "leditor-ui-btn";
      insertBtn.textContent = "Insert Citation";
      insertBtn.addEventListener("click", () => {
        const handle = currentHandle;
        if (!handle) return;
        try {
          handle.execCommand("citation.insert.direct", {
            itemKey: item.dqid,
            title: item.title,
            author: item.author,
            year: item.year,
            source: item.source,
            dqid: item.dqid,
            page: item.page,
            selectionSnapshot: lastSelectionSnapshot
          });
        } catch {
          // ignore
        }
      });
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "leditor-ui-btn";
      addBtn.textContent = "Add to Library";
      addBtn.addEventListener("click", () => {
        upsertReferenceItems([
          {
            itemKey: item.dqid,
            title: item.title,
            author: item.author,
            year: item.year,
            source: item.source,
            dqid: item.dqid
          }
        ]);
        addBtn.textContent = "Added";
        addBtn.disabled = true;
      });
      actions.append(insertBtn, addBtn);

      card.append(quote, headerRow, actions);
      list.appendChild(card);
    });
  };

  const runSearch = async () => {
    const query = input.value.trim();
    if (!query) return;
    const contract = getHostContract();
    const lookupPath = String(contract?.inputs?.directQuoteJsonPath || "").trim();
    if (!lookupPath) {
      status.textContent = "directQuoteJsonPath not configured in host contract.";
      return;
    }
    const hostAdapter = getHostAdapter();
    if (!hostAdapter?.searchDirectQuotes) {
      status.textContent = "Direct quote search not available.";
      return;
    }
    status.textContent = "Searching local direct quotes...";
    const maxScan = deepScanToggle.checked ? 0 : 5000;
    const evidenceValues = evidenceFilter.getSelected();
    const themeValues = themeFilter.getSelected();
    const rqValues = rqFilter.getSelected();
    const authorValues = authorFilter.getSelected();
    const yearValues = yearFilter
      .getSelected()
      .map((value) => Number.parseInt(value, 10))
      .filter((n) => Number.isFinite(n));
    const result = await hostAdapter.searchDirectQuotes({
      lookupPath,
      query,
      limit: 25,
      maxScan,
      filters: {
        evidenceTypes: evidenceValues.length ? evidenceValues : undefined,
        themes: themeValues.length ? themeValues : undefined,
        researchQuestions: rqValues.length ? rqValues : undefined,
        authors: authorValues.length ? authorValues : undefined,
        years: yearValues.length ? yearValues : undefined
      }
    });
    if (!result?.success) {
      status.textContent = result?.error ? String(result.error) : "Search failed.";
      renderResults([]);
      return;
    }
    const results = Array.isArray(result.results) ? (result.results as DirectQuoteResult[]) : [];
    const scanned = Number.isFinite(result.scanned) ? Number(result.scanned) : results.length;
    const total = Number.isFinite(result.total) ? Number(result.total) : undefined;
    const skipped = Number.isFinite(result.skipped) ? Number(result.skipped) : 0;
    const scanNote = deepScanToggle.checked ? " (deep scan)" : "";
    const skipNote = skipped > 0 ? ` Skipped ${skipped} malformed entries.` : "";
    status.textContent = results.length
      ? `Found ${results.length} match(es). Scanned ${scanned}${total ? ` of ${total}` : ""}${scanNote}.${skipNote}`
      : `No matches. Scanned ${scanned}${total ? ` of ${total}` : ""}${scanNote}.${skipNote}`;
    renderResults(results);
  };

  searchBtn.addEventListener("click", () => void runSearch());
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  });
  const loadFilters = async () => {
    const contract = getHostContract();
    const lookupPath = String(contract?.inputs?.directQuoteJsonPath || "").trim();
    if (!lookupPath) {
      status.textContent = "directQuoteJsonPath not configured in host contract.";
      return;
    }
    const hostAdapter = getHostAdapter();
    if (!hostAdapter?.getDirectQuoteFilters) {
      status.textContent = "Direct quote filters not available.";
      return;
    }
    status.textContent = "Loading filter options...";
    const maxScan = deepScanToggle.checked ? 0 : 5000;
    const res = await hostAdapter.getDirectQuoteFilters({ lookupPath, maxScan });
    if (!res?.success) {
      status.textContent = res?.error ? String(res.error) : "Failed to load filters.";
      return;
    }
    evidenceFilter.setOptions(res.evidenceTypes ?? []);
    themeFilter.setOptions(res.themes ?? []);
    rqFilter.setOptions(res.researchQuestions ?? []);
    authorFilter.setOptions(res.authors ?? []);
    yearFilter.setOptions(res.years ?? []);
    const scanned = Number.isFinite(res.scanned) ? Number(res.scanned) : 0;
    const total = Number.isFinite(res.total) ? Number(res.total) : undefined;
    const skipped = Number.isFinite(res.skipped) ? Number(res.skipped) : 0;
    const scanNote = deepScanToggle.checked ? " (deep scan)" : "";
    const skipNote = skipped > 0 ? ` Skipped ${skipped} malformed entries.` : "";
    status.textContent = `Loaded filters from ${scanned}${total ? ` of ${total}` : ""}${scanNote}.${skipNote}`;
    filtersLoaded = true;
  };
  loadFiltersFn = () => {
    void loadFilters();
  };
  filtersBtn.addEventListener("click", () => {
    void loadFilters();
  });

  let filtersCollapsed = true;
  filters.classList.add("is-collapsed");
  filtersToggle.textContent = "Show";
  filtersToggle.addEventListener("click", () => {
    filtersCollapsed = !filtersCollapsed;
    filters.classList.toggle("is-collapsed", filtersCollapsed);
    filtersToggle.textContent = filtersCollapsed ? "Show" : "Hide";
  });

  options.append(deepScanWrap, sortWrap);
  root.append(header, controls, options, filters, status, list);

  const docShell = host.querySelector<HTMLElement>(".leditor-doc-shell");
  const pdfShell = host.querySelector<HTMLElement>(".leditor-pdf-shell");
  if (pdfShell) {
    host.insertBefore(root, pdfShell);
  } else if (docShell && docShell.nextSibling) {
    host.insertBefore(root, docShell.nextSibling);
  } else {
    host.appendChild(root);
  }

  panel = root;
  return panel;
};

export const openDirectQuoteLookupPanel = (editorHandle?: EditorHandle) => {
  if (editorHandle) currentHandle = editorHandle;
  const root = ensurePanel();
  if (!root) return;
  root.classList.add("is-open");
  const input = root.querySelector<HTMLInputElement>(".leditor-direct-quote-input");
  input?.focus();
  if (editorHandle) {
    try {
      lastSelectionSnapshot = snapshotFromSelection(editorHandle.getEditor().state.selection);
    } catch {
      lastSelectionSnapshot = null;
    }
  }
  if (!filtersLoaded && loadFiltersFn) {
    loadFiltersFn();
  }
};
