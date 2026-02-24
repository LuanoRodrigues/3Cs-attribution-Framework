import type { AnalysePageContext, AnalyseRoundId, AnalyseState, BatchPayload, BatchRecord, SectionRecord } from "../../analyse/types";
import { getDefaultBaseDir, loadBatches, loadSections } from "../../analyse/data";

interface FilterState {
  search: string;
  themes: Set<string>;
  evidence: Set<string>;
  dedupe: boolean;
  page: number;
  pageSize: number;
}

function uniq(values: (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

function dedupePayloads(records: BatchRecord[]): BatchRecord[] {
  return records.map((record) => {
    const seen = new Set<string>();
    const payloads = record.payloads.filter((p) => {
      const key = (p.text || "").trim().toLowerCase();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { ...record, payloads };
  });
}

function dispatch(container: HTMLElement, action: string, payload?: Record<string, unknown>): void {
  container.dispatchEvent(new CustomEvent("analyse-command", { detail: { action, payload }, bubbles: true }));
}

function emitPayload(container: HTMLElement, payload: Record<string, unknown>): void {
  container.dispatchEvent(new CustomEvent("analyse-payload-selected", { detail: payload, bubbles: true }));
}

export function renderBatchesPage(container: HTMLElement, state: AnalyseState, ctx?: AnalysePageContext): void {
  container.innerHTML = "";

  const title = document.createElement("h2");
  title.textContent = "Batch manager";
  container.appendChild(title);

  let batches: BatchRecord[] = [];
  let activeRunPath = String(state.activeRunPath || "").trim();
  const filters: FilterState = {
    search: "",
    themes: new Set<string>(),
    evidence: new Set<string>(),
    dedupe: false,
    page: 0,
    pageSize: 6
  };

  const selectedPayloads = new Set<string>();
  let sectionsData: SectionRecord[] = [];
  const sectionFilters = { search: "", routes: new Set<string>() };
  let selectedBatchId: string | null = null;
  const cardElements = new Map<string, HTMLDivElement>();
  let currentRound: AnalyseRoundId = state.activeRound || "r1";

  const layout = document.createElement("div");
  layout.style.display = "grid";
  layout.style.gridTemplateColumns = "260px 1fr 1fr";
  layout.style.gap = "12px";
  container.appendChild(layout);

  const sidebar = document.createElement("div");
  sidebar.className = "panel";
  sidebar.style.padding = "12px";
  sidebar.style.border = "1px solid var(--border)";
  sidebar.style.borderRadius = "12px";
  layout.appendChild(sidebar);

  const content = document.createElement("div");
  layout.appendChild(content);

  const sectionsPanel = document.createElement("div");
  sectionsPanel.className = "panel";
  sectionsPanel.style.padding = "12px";
  sectionsPanel.style.border = "1px solid var(--border)";
  sectionsPanel.style.borderRadius = "12px";
  sectionsPanel.style.display = "flex";
  sectionsPanel.style.flexDirection = "column";
  sectionsPanel.style.gap = "10px";
  layout.appendChild(sectionsPanel);

  const sectionsTitle = document.createElement("h3");
  sectionsTitle.textContent = "Sections preview";
  sectionsPanel.appendChild(sectionsTitle);

  const sectionsRoundRow = document.createElement("div");
  sectionsRoundRow.className = "control-row";
  sectionsRoundRow.style.gap = "6px";
  sectionsPanel.appendChild(sectionsRoundRow);

  const sectionSearch = document.createElement("input");
  sectionSearch.type = "search";
  sectionSearch.placeholder = "Search sections";
  sectionSearch.style.width = "100%";
  sectionsPanel.appendChild(sectionSearch);
  sectionSearch.addEventListener("input", () => {
    sectionFilters.search = sectionSearch.value;
    renderSectionsList();
  });

  const sectionsRouteWrap = document.createElement("div");
  sectionsRouteWrap.className = "control-row";
  sectionsRouteWrap.style.flexWrap = "wrap";
  sectionsPanel.appendChild(sectionsRouteWrap);

  const sectionsList = document.createElement("div");
  sectionsList.style.display = "flex";
  sectionsList.style.flexDirection = "column";
  sectionsList.style.gap = "10px";
  sectionsPanel.appendChild(sectionsList);

  const sectionsStatus = document.createElement("div");
  sectionsStatus.className = "status-bar";
  sectionsPanel.appendChild(sectionsStatus);

  const roundOptions: AnalyseRoundId[] = ["r1", "r2", "r3"];
  const roundButtons = new Map<AnalyseRoundId, HTMLButtonElement>();
  roundOptions.forEach((round) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ribbon-button";
    btn.textContent = round.toUpperCase();
    btn.dataset.round = round;
    btn.addEventListener("click", () => setCurrentRound(round));
    roundButtons.set(round, btn);
    sectionsRoundRow.appendChild(btn);
  });

  function updateRoundButtons() {
    roundButtons.forEach((btn, round) => {
      btn.classList.toggle("active", currentRound === round);
    });
  }

  updateRoundButtons();

  const setCurrentRound = (round: AnalyseRoundId) => {
    if (currentRound === round) return;
    currentRound = round;
    updateRoundButtons();
    if (selectedBatchId) {
      const batch = batches.find((b) => b.id === selectedBatchId);
      if (batch) {
        void loadSectionsForBatch(batch);
      }
    }
  };

  const resetSectionsPanel = () => {
    sectionsData = [];
    sectionFilters.routes.clear();
    sectionSearch.value = "";
    sectionFilters.search = "";
    sectionsRouteWrap.innerHTML = "";
    sectionsList.innerHTML = "";
    sectionsStatus.textContent = "Select a batch to preview sections";
    selectedBatchId = null;
    highlightSelectedCard();
  };

  const renderRouteFilters = () => {
    sectionsRouteWrap.innerHTML = "";
    const routes = Array.from(new Set(sectionsData.map((section) => section.route || "").filter(Boolean)));
    routes.forEach((route) => {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.gap = "6px";
      label.style.alignItems = "center";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = sectionFilters.routes.has(route);
      cb.addEventListener("change", () => {
        if (cb.checked) sectionFilters.routes.add(route);
        else sectionFilters.routes.delete(route);
        renderSectionsList();
      });
      const span = document.createElement("span");
      span.textContent = route;
      label.appendChild(cb);
      label.appendChild(span);
      sectionsRouteWrap.appendChild(label);
    });
  };

  const applySectionFilters = (items: SectionRecord[]): SectionRecord[] => {
    const term = sectionSearch.value.trim().toLowerCase();
    return items.filter((section) => {
      const matchesRoute = sectionFilters.routes.size === 0 || (section.route && sectionFilters.routes.has(section.route));
      const matchesSearch =
        !term ||
        section.title.toLowerCase().includes(term) ||
        (section.route || "").toLowerCase().includes(term) ||
        stripHtml(section.html, Number.MAX_SAFE_INTEGER).toLowerCase().includes(term);
      return matchesRoute && matchesSearch;
    });
  };

  const renderSectionsList = () => {
    sectionsList.innerHTML = "";
    if (!sectionsData.length) {
      const hint = document.createElement("div");
      hint.className = "empty-state";
      hint.textContent = "Sections will appear once you pick a batch and round.";
      sectionsList.appendChild(hint);
      sectionsStatus.textContent = "No sections loaded";
      return;
    }
    const filtered = applySectionFilters(sectionsData);
    sectionsStatus.textContent = `${filtered.length} sections (${currentRound.toUpperCase()})`;
    if (!filtered.length) {
      const hint = document.createElement("div");
      hint.className = "empty-state";
      hint.textContent = "No sections matched the current filters.";
      sectionsList.appendChild(hint);
      return;
    }
    filtered.forEach((section) => {
      const card = document.createElement("div");
      card.className = "viz-card";
      card.style.cursor = "pointer";
      const title = document.createElement("h4");
      title.textContent = section.title || "Untitled section";
      card.appendChild(title);
      const routeEl = document.createElement("div");
      routeEl.className = "status-bar";
      routeEl.textContent = section.route || "";
      card.appendChild(routeEl);
      const excerpt = document.createElement("p");
      excerpt.textContent = stripHtml(section.html);
      card.appendChild(excerpt);
      card.addEventListener("click", () => {
        emitSectionPreview(container, currentRound, section, state.activeRunId);
      });
      sectionsList.appendChild(card);
    });
  };

  const highlightSelectedCard = () => {
    cardElements.forEach((card, id) => {
      card.classList.toggle("selected-batch-card", id === selectedBatchId);
    });
  };

  const setSelectedBatch = (batch: BatchRecord) => {
    selectedBatchId = batch.id;
    highlightSelectedCard();
    void loadSectionsForBatch(batch);
  };

  const matchesBatchSection = (section: SectionRecord, batch: BatchRecord): boolean => {
    const meta = section.meta || {};
    const sectionTheme = String(meta.gold_theme || meta.potential_theme || meta.theme || "").trim();
    const batchTheme = String(batch.theme || batch.potentialTheme || "").trim();
    if (sectionTheme && batchTheme && sectionTheme.toLowerCase() === batchTheme.toLowerCase()) {
      return true;
    }
    const sectionEvidence = String(meta.evidence_type || "").trim();
    const batchEvidence = String(batch.evidenceType || "").trim();
    if (sectionEvidence && batchEvidence && sectionEvidence.toLowerCase() === batchEvidence.toLowerCase()) {
      return true;
    }
    return false;
  };

  const loadSectionsForBatch = async (batch: BatchRecord) => {
    if (!activeRunPath) {
      sectionsStatus.textContent = "No active run loaded.";
      return;
    }
    sectionsStatus.textContent = "Loading sections...";
    try {
      const allSections = await loadSections(activeRunPath, currentRound);
      sectionsData = allSections.filter((section) => matchesBatchSection(section, batch));
      sectionFilters.routes.clear();
      renderRouteFilters();
      renderSectionsList();
      sectionsStatus.textContent = `${sectionsData.length} sections loaded for ${batch.theme || batch.id}`;
    } catch (err) {
      console.error(err);
      sectionsStatus.textContent = "Failed to load sections.";
    }
  };

  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search theme or text";
  search.addEventListener("input", () => {
    filters.search = search.value;
    filters.page = 0;
    renderList();
  });
  sidebar.appendChild(search);

  const filterOptions = document.createElement("div");
  sidebar.appendChild(filterOptions);

  const makeChecklist = (items: string[], titleText: string, target: Set<string>) => {
    if (!items.length) return;
    const wrapper = document.createElement("div");
    const titleEl = document.createElement("h4");
    titleEl.textContent = titleText;
    wrapper.appendChild(titleEl);
    items.forEach((item) => {
      const label = document.createElement("label");
      label.style.display = "flex";
      label.style.gap = "6px";
      label.style.alignItems = "center";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = target.has(item);
      cb.addEventListener("change", () => {
        if (cb.checked) target.add(item);
        else target.delete(item);
        filters.page = 0;
        renderList();
      });
      const span = document.createElement("span");
      span.textContent = item;
      label.appendChild(cb);
      label.appendChild(span);
      wrapper.appendChild(label);
    });
    filterOptions.appendChild(wrapper);
  };

  const renderFilterOptions = () => {
    filterOptions.innerHTML = "";
    const evidenceTypes = uniq(batches.map((b) => b.evidenceType));
    const themes = uniq(batches.map((b) => b.theme));
    makeChecklist(themes, "Themes", filters.themes);
    makeChecklist(evidenceTypes, "Evidence", filters.evidence);
  };

  const dedupeLabel = document.createElement("label");
  dedupeLabel.style.display = "flex";
  dedupeLabel.style.gap = "6px";
  dedupeLabel.style.alignItems = "center";
  const dedupeCb = document.createElement("input");
  dedupeCb.type = "checkbox";
  dedupeCb.checked = filters.dedupe;
  dedupeCb.addEventListener("change", () => {
    filters.dedupe = dedupeCb.checked;
    filters.page = 0;
    renderList();
  });
  dedupeLabel.appendChild(dedupeCb);
  const dedupeText = document.createElement("span");
  dedupeText.textContent = "Deduplicate payload text";
  dedupeLabel.appendChild(dedupeText);
  sidebar.appendChild(dedupeLabel);

  const toolbar = document.createElement("div");
  toolbar.className = "control-row";
  content.appendChild(toolbar);

  const listWrapper = document.createElement("div");
  listWrapper.style.display = "flex";
  listWrapper.style.flexDirection = "column";
  listWrapper.style.gap = "10px";
  content.appendChild(listWrapper);

  const pager = document.createElement("div");
  pager.className = "control-row";
  content.appendChild(pager);

  const selectionBar = document.createElement("div");
  selectionBar.className = "status-bar";
  content.appendChild(selectionBar);

  const filteredRecords = (): BatchRecord[] => {
    const base = filters.dedupe ? dedupePayloads(batches) : batches;
    const term = filters.search.trim().toLowerCase();
    return base.filter((batch) => {
      const matchesTheme = filters.themes.size === 0 || (batch.theme && filters.themes.has(batch.theme));
      const matchesEvidence = filters.evidence.size === 0 || (batch.evidenceType && filters.evidence.has(batch.evidenceType));
      const matchesSearch = !term
        ? true
        : [batch.theme, batch.potentialTheme, batch.rqQuestion]
            .filter(Boolean)
            .some((t) => String(t).toLowerCase().includes(term)) ||
          batch.payloads.some((p) => (p.text || "").toLowerCase().includes(term));
      return matchesTheme && matchesEvidence && matchesSearch;
    });
  };

  const currentPageSlice = (rows: BatchRecord[]): BatchRecord[] => {
    const start = filters.page * filters.pageSize;
    return rows.slice(start, start + filters.pageSize);
  };

  const renderToolbar = (pagePayloads: BatchPayload[], allPayloads: BatchPayload[]) => {
    toolbar.innerHTML = "";
    const exportPage = document.createElement("button");
    exportPage.className = "ribbon-button";
    exportPage.textContent = "Export page";
    exportPage.addEventListener("click", () =>
      dispatch(listWrapper, "analyse/export_html_page", { scope: "page", payloadIds: pagePayloads.map((p) => p.id) })
    );

    const copyPage = document.createElement("button");
    copyPage.className = "ribbon-button";
    copyPage.textContent = "Copy page";
    copyPage.addEventListener("click", () =>
      dispatch(listWrapper, "analyse/copy_html_page", { scope: "page", payloadIds: pagePayloads.map((p) => p.id) })
    );

    const exportSelected = document.createElement("button");
    exportSelected.className = "ribbon-button";
    exportSelected.textContent = "Export selected";
    exportSelected.disabled = selectedPayloads.size === 0;
    exportSelected.addEventListener("click", () =>
      dispatch(listWrapper, "analyse/export_html_selection", { payloadIds: Array.from(selectedPayloads) })
    );

    const copySelected = document.createElement("button");
    copySelected.className = "ribbon-button";
    copySelected.textContent = "Copy selected";
    copySelected.disabled = selectedPayloads.size === 0;
    copySelected.addEventListener("click", () =>
      dispatch(listWrapper, "analyse/copy_html_selection", { payloadIds: Array.from(selectedPayloads) })
    );

    const exportAll = document.createElement("button");
    exportAll.className = "ribbon-button";
    exportAll.textContent = "Export all";
    exportAll.addEventListener("click", () =>
      dispatch(listWrapper, "analyse/export_html_page", { scope: "all", payloadIds: allPayloads.map((p) => p.id) })
    );

    toolbar.appendChild(exportPage);
    toolbar.appendChild(copyPage);
    toolbar.appendChild(exportSelected);
    toolbar.appendChild(copySelected);
    toolbar.appendChild(exportAll);
  };

  const renderList = () => {
    cardElements.clear();
    const records = filteredRecords();
    const pageRecords = currentPageSlice(records);
    const allPayloads = records.flatMap((b) => b.payloads);
    const pagePayloads = pageRecords.flatMap((b) => b.payloads);
    renderToolbar(pagePayloads, allPayloads);
    selectionBar.textContent = `${pagePayloads.length} payloads on page · ${selectedPayloads.size} selected`;

    listWrapper.innerHTML = "";
    if (records.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No batches matched the current filters.";
      listWrapper.appendChild(empty);
    }

    pageRecords.forEach((batch) => {
      const card = document.createElement("div");
      card.dataset.batchId = batch.id;
      cardElements.set(batch.id, card);
      card.className = "viz-card";
      const heading = document.createElement("div");
      heading.style.display = "flex";
      heading.style.justifyContent = "space-between";
      heading.style.alignItems = "center";
      const titleEl = document.createElement("h4");
      titleEl.textContent = batch.theme || batch.id;
      const badge = document.createElement("span");
      badge.className = "status-bar";
      badge.textContent = `${batch.payloads.length} payloads`;
      heading.appendChild(titleEl);
      heading.appendChild(badge);
      card.appendChild(heading);

      const meta = document.createElement("div");
      meta.className = "status-bar";
      meta.textContent = [batch.evidenceType, batch.rqQuestion].filter(Boolean).join(" · ");
      card.appendChild(meta);

      batch.payloads.forEach((payload) => {
        const row = document.createElement("div");
        row.className = "control-row";
        row.style.alignItems = "flex-start";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selectedPayloads.has(payload.id);
        cb.addEventListener("change", () => {
          if (cb.checked) selectedPayloads.add(payload.id);
          else selectedPayloads.delete(payload.id);
          selectionBar.textContent = `${pagePayloads.length} payloads on page · ${selectedPayloads.size} selected`;
          renderToolbar(pagePayloads, allPayloads);
        });
        const text = document.createElement("div");
        text.textContent = payload.text || "(empty)";
        text.style.cursor = "pointer";
        text.addEventListener("click", () => {
          emitPayload(listWrapper, {
            type: "batch_payload",
            id: payload.id,
            text: payload.text,
            page: payload.page,
            batchId: batch.id,
            runId: state.activeRunId
          });
        });
        row.appendChild(cb);
        row.appendChild(text);
        card.appendChild(row);
      });

      const inspectRow = document.createElement("div");
      inspectRow.className = "control-row";
      const inspectBtn = document.createElement("button");
      inspectBtn.type = "button";
      inspectBtn.className = "ribbon-button";
      inspectBtn.textContent = "Inspect sections";
      inspectBtn.addEventListener("click", () => setSelectedBatch(batch));
      inspectRow.appendChild(inspectBtn);
      card.appendChild(inspectRow);

      listWrapper.appendChild(card);
    });

    renderPager(records.length);
  };

  const renderPager = (totalRows: number) => {
    pager.innerHTML = "";
    const totalPages = Math.max(1, Math.ceil(totalRows / filters.pageSize));
    filters.page = Math.min(filters.page, totalPages - 1);

    const prev = document.createElement("button");
    prev.className = "ribbon-button";
    prev.textContent = "Prev";
    prev.disabled = filters.page === 0;
    prev.addEventListener("click", () => {
      filters.page = Math.max(0, filters.page - 1);
      renderList();
    });

    const next = document.createElement("button");
    next.className = "ribbon-button";
    next.textContent = "Next";
    next.disabled = filters.page >= totalPages - 1;
    next.addEventListener("click", () => {
      filters.page = Math.min(totalPages - 1, filters.page + 1);
      renderList();
    });

    const label = document.createElement("span");
    label.textContent = `Page ${filters.page + 1} of ${totalPages}`;

    const pageSizeSelect = document.createElement("select");
    [5, 10, 15, 20].forEach((size) => {
      const opt = document.createElement("option");
      opt.value = String(size);
      opt.textContent = `${size} / page`;
      opt.selected = filters.pageSize === size;
      pageSizeSelect.appendChild(opt);
    });
    pageSizeSelect.addEventListener("change", () => {
      filters.pageSize = Number(pageSizeSelect.value);
      filters.page = 0;
      renderList();
    });

    pager.appendChild(prev);
    pager.appendChild(label);
    pager.appendChild(next);
    pager.appendChild(pageSizeSelect);
  };

  const status = document.createElement("div");
  status.className = "status-bar";
  content.appendChild(status);

  const loadData = async () => {
    resetSectionsPanel();
    status.textContent = "Loading batches...";
    let runPath = activeRunPath;
    if (!runPath) {
      runPath = String(state.baseDir || "").trim();
    }
    if (!runPath) {
      runPath = String((await getDefaultBaseDir()) || "").trim();
    }
    if (!runPath) {
      status.textContent = "No batch source path available.";
      return;
    }
    if (!state.activeRunPath || state.activeRunPath !== runPath) {
      ctx?.updateState({
        activeRunPath: runPath,
        baseDir: String(state.baseDir || "").trim() || runPath
      });
    }
    activeRunPath = runPath;
    try {
      batches = await loadBatches(runPath);
      selectedPayloads.clear();
      renderFilterOptions();
      renderList();
      status.textContent = `${batches.length} batch(es) loaded from ${runPath}`;
    } catch (error) {
      console.error(error);
      status.textContent = "Failed to load batches.";
    }
  };

  void loadData();
}

function stripHtml(html: string, limit = 400): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const text = tmp.textContent || tmp.innerText || "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function emitSectionPreview(container: HTMLElement, round: AnalyseRoundId, section: SectionRecord, runId?: string): void {
  container.dispatchEvent(
    new CustomEvent("analyse-payload-selected", {
      detail: {
        type: "section",
        round,
        runId,
        id: section.id,
        route: section.route,
        meta: section.meta,
        html: section.html,
        title: section.title,
        text: stripHtml(section.html, 800)
      },
      bubbles: true
    })
  );
}
