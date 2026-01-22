import type { AnalysePageContext, AnalyseState, BatchRecord } from "../../analyse/types";
import { buildDatasetHandles, discoverRuns, getDefaultBaseDir, loadBatches } from "../../analyse/data";

type FacetCounts = Record<string, number>;

interface FilterState {
  search: string;
  rq: Set<string>;
  evidence: Set<string>;
  theme: Set<string>;
  tags: Set<string>;
  authors: Set<string>;
  years: Set<string>;
  score: Set<string>;
  rqExclude: Set<string>;
  evidenceExclude: Set<string>;
  themeExclude: Set<string>;
}

const clean = (value: unknown): string => {
  if (value === undefined || value === null) return "";
  return String(value).trim();
};

const facetCount = (items: string[]): FacetCounts =>
  items.reduce<FacetCounts>((acc, v) => {
    const key = v.toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const buildFacets = (batches: BatchRecord[]) => {
  const rq: string[] = [];
  const ev: string[] = [];
  const th: string[] = [];
  const tags: string[] = [];
  const authors: string[] = [];
  const years: string[] = [];
  const score: string[] = [];

  batches.forEach((b) => {
    b.payloads.forEach((p) => {
      rq.push(clean(p.rq_question || p.rq));
      ev.push(clean(p.evidence_type || p.evidenceType));
      th.push(clean(p.potential_theme || p.theme));
      const tagSrc = clean(p.potential_theme || p.theme);
      if (tagSrc) {
        tagSrc.split(/[|,;/]/).forEach((t) => {
          const tt = clean(t);
          if (tt) tags.push(tt);
        });
      }
      const author = clean(p.first_author_last || p.author_summary || p.author);
      if (author) authors.push(author);
      const year = clean(p.year);
      if (year && /^\d{4}$/.test(year)) years.push(year);
      const sb = clean((p as any).score_bucket || (p as any).relevance_score);
      if (sb) score.push(sb);
    });
  });

  return {
    rq: facetCount(rq),
    evidence: facetCount(ev),
    theme: facetCount(th),
    tags: facetCount(tags),
    authors: facetCount(authors),
    years: facetCount(years),
    score: facetCount(score)
  };
};

const renderChecklist = (
  title: string,
  counts: FacetCounts,
  target: Set<string>,
  excludeTarget: Set<string> | null,
  onChange: () => void,
  container: HTMLElement,
  topN = 10
): void => {
  const wrapper = document.createElement("div");
  wrapper.className = "panel premium-card";
  const heading = document.createElement("div");
  heading.className = "filter-heading";
  const hText = document.createElement("h4");
  hText.textContent = title;
  heading.appendChild(hText);
  // All / None / Expand buttons
  const btnAll = document.createElement("button");
  btnAll.type = "button";
  btnAll.textContent = "All";
  btnAll.className = "chip";
  btnAll.addEventListener("click", () => {
    Object.keys(counts).forEach((k) => target.add(k.toLowerCase()));
    onChange();
    renderList(renderedEntries);
  });
  const btnNone = document.createElement("button");
  btnNone.type = "button";
  btnNone.textContent = "None";
  btnNone.className = "chip ghost";
  btnNone.addEventListener("click", () => {
    target.clear();
    if (excludeTarget) excludeTarget.clear();
    onChange();
    renderList(renderedEntries);
  });
  const btnExpand = document.createElement("button");
  btnExpand.type = "button";
  btnExpand.textContent = "Expand…";
  btnExpand.className = "chip ghost";
  btnExpand.addEventListener("click", () => openExpandModal());
  const controls = document.createElement("div");
  controls.className = "filter-controls";
  controls.append(btnAll, btnNone, btnExpand);
  heading.appendChild(controls);
  wrapper.appendChild(heading);
  const list = document.createElement("div");
  list.style.display = "flex";
  list.style.flexDirection = "column";
  list.style.gap = "4px";
  const renderedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const renderList = (entries: [string, number][]) => {
    list.innerHTML = "";
    entries.forEach(([key, count]) => {
      const normKey = key.toLowerCase();
      const label = document.createElement("label");
      label.className = "filter-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = target.has(normKey);
      cb.addEventListener("change", () => {
        if (cb.checked) target.add(normKey);
        else target.delete(normKey);
        onChange();
      });
      const span = document.createElement("span");
      span.textContent = `${key} (${count})`;
      label.appendChild(cb);
      label.appendChild(span);
      if (excludeTarget) {
        const ex = document.createElement("input");
        ex.type = "checkbox";
        ex.className = "exclude-box";
        ex.title = "Exclude";
        ex.checked = excludeTarget.has(normKey);
        ex.addEventListener("change", () => {
          if (ex.checked) {
            excludeTarget.add(normKey);
            target.delete(normKey);
            cb.checked = false;
          } else {
            excludeTarget.delete(normKey);
          }
          onChange();
        });
        label.appendChild(ex);
      }
      list.appendChild(label);
    });
  };
  renderList(renderedEntries.slice(0, topN));
  wrapper.appendChild(list);
  container.appendChild(wrapper);

  function openExpandModal() {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const dialog = document.createElement("div");
    dialog.className = "modal";
    const titleEl = document.createElement("h3");
    titleEl.textContent = `Select ${title}`;
    dialog.appendChild(titleEl);
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search…";
    search.className = "modal-search";
    dialog.appendChild(search);
    const grid = document.createElement("div");
    grid.className = "modal-grid";
    const incWrap = document.createElement("div");
    incWrap.className = "modal-list";
    const excWrap = document.createElement("div");
    excWrap.className = "modal-list";
    const incTitle = document.createElement("div");
    incTitle.className = "modal-col-title";
    incTitle.textContent = "Include";
    const excTitle = document.createElement("div");
    excTitle.className = "modal-col-title";
    excTitle.textContent = "Exclude";
    grid.appendChild(incTitle);
    grid.appendChild(excTitle);
    grid.appendChild(incWrap);
    grid.appendChild(excWrap);
    dialog.appendChild(grid);
    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const ok = document.createElement("button");
    ok.textContent = "Apply";
    ok.className = "ribbon-button";
    const cancel = document.createElement("button");
    cancel.textContent = "Cancel";
    cancel.className = "ribbon-button ghost";
    actions.append(cancel, ok);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const incBoxes = new Map<string, HTMLInputElement>();
    const excBoxes = new Map<string, HTMLInputElement>();

    const renderModalList = () => {
      incWrap.innerHTML = "";
      excWrap.innerHTML = "";
      incBoxes.clear();
      excBoxes.clear();
      const needle = search.value.trim().toLowerCase();
      renderedEntries.forEach(([k, c]) => {
        if (needle && !k.toLowerCase().includes(needle)) return;
        const norm = k.toLowerCase();
        const incRow = document.createElement("label");
        incRow.className = "filter-row";
        const inc = document.createElement("input");
        inc.type = "checkbox";
        inc.checked = target.has(norm);
        inc.addEventListener("change", () => {
          if (inc.checked) {
            target.add(norm);
            if (excludeTarget) {
              excludeTarget.delete(norm);
              const exRef = excBoxes.get(norm);
              if (exRef) exRef.checked = false;
            }
          } else {
            target.delete(norm);
          }
        });
        const incTxt = document.createElement("span");
        incTxt.textContent = `${k} (${c})`;
        incRow.append(inc, incTxt);
        incWrap.appendChild(incRow);
        incBoxes.set(norm, inc);

        if (excludeTarget) {
          const excRow = document.createElement("label");
          excRow.className = "filter-row";
          const exc = document.createElement("input");
          exc.type = "checkbox";
          exc.className = "exclude-box";
          exc.checked = excludeTarget.has(norm);
          exc.addEventListener("change", () => {
            if (!excludeTarget) return;
            if (exc.checked) {
              excludeTarget.add(norm);
              target.delete(norm);
              const incRef = incBoxes.get(norm);
              if (incRef) incRef.checked = false;
            } else {
              excludeTarget.delete(norm);
            }
          });
          const excTxt = document.createElement("span");
          excTxt.textContent = `${k} (${c})`;
          excRow.append(exc, excTxt);
          excWrap.appendChild(excRow);
          excBoxes.set(norm, exc);
        }
      });
    };

    renderModalList();
    search.addEventListener("input", renderModalList);
    cancel.addEventListener("click", () => backdrop.remove());
    ok.addEventListener("click", () => {
      backdrop.remove();
      onChange();
      renderList(renderedEntries.slice(0, topN));
    });
  }
};

const createPayloadBlock = (payload: Record<string, any>): HTMLElement => {
  const block = document.createElement("div");
  block.className = "viz-card";
  block.style.padding = "10px";
  block.style.border = "1px solid var(--border)";
  block.style.borderRadius = "10px";
  block.style.background = "var(--panel)";
  block.style.display = "flex";
  block.style.flexDirection = "column";
  block.style.gap = "6px";

  const top = document.createElement("div");
  top.style.display = "flex";
  top.style.alignItems = "center";
  top.style.gap = "8px";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  top.appendChild(checkbox);

  const pill = document.createElement("span");
  pill.textContent = clean(payload.payload_theme || payload.theme || payload.potential_theme || "—");
  pill.style.padding = "2px 8px";
  pill.style.borderRadius = "999px";
  pill.style.background = "rgba(125,211,252,0.15)";
  pill.style.color = "#7DD3FC";
  top.appendChild(pill);

  const notes = clean(payload.researcher_comment);
  const btnNotes = document.createElement("button");
  btnNotes.type = "button";
  btnNotes.textContent = "Notes ▸";
  btnNotes.className = "note-button ribbon-button";
  btnNotes.disabled = !notes;
  if (notes) {
    btnNotes.addEventListener("click", () => {
      alert(notes);
    });
  }
  top.appendChild(btnNotes);
  top.appendChild(document.createElement("div")).style.flex = "1";
  block.appendChild(top);

  const para = clean(payload.paraphrase);
  if (para) {
    const p = document.createElement("div");
    p.textContent = para;
    p.style.fontSize = "13px";
    p.style.lineHeight = "1.5";
    block.appendChild(p);
  }
  const dq = clean(payload.direct_quote);
  if (dq) {
    const q = document.createElement("div");
    q.textContent = `“${dq}”`;
    q.style.borderLeft = "3px solid rgba(125,211,252,0.75)";
    q.style.paddingLeft = "8px";
    q.style.color = "var(--muted)";
    block.appendChild(q);
  }

  const meta = document.createElement("div");
  meta.className = "status-bar";
  const author = clean(payload.first_author_last || payload.author_summary || payload.author);
  const year = clean(payload.year);
  const page = clean(payload.page);
  const source = clean(payload.source);
  const title = clean(payload.title);
  const bits: string[] = [];
  if (author) bits.push(author);
  if (year) bits.push(year + (page ? `, p. ${page}` : ""));
  if (source) bits.push(source);
  if (title) bits.push(title);
  meta.textContent = bits.join(" · ");
  block.appendChild(meta);

  return block;
};

const createBatchCard = (batch: BatchRecord): HTMLElement => {
  const card = document.createElement("div");
  card.className = "viz-card";
  card.style.display = "flex";
  card.style.flexDirection = "column";
  card.style.gap = "10px";
  card.style.padding = "12px";

  const header = document.createElement("div");
  header.style.display = "flex";
  header.style.alignItems = "center";
  header.style.gap = "8px";
  const title = document.createElement("h4");
  title.textContent = clean((batch as any).rq_question || batch.rqQuestion || "Batch");
  header.appendChild(title);
  const sub = document.createElement("span");
  sub.className = "status-bar";
  sub.textContent = clean(batch.potentialTheme || batch.theme || (batch as any).overarching_theme || "");
  header.appendChild(sub);
  header.appendChild(document.createElement("div")).style.flex = "1";
  const size = document.createElement("span");
  size.className = "status-bar";
  size.textContent = `${batch.payloads.length} items`;
  header.appendChild(size);
  card.appendChild(header);

  batch.payloads.forEach((payload) => {
    card.appendChild(createPayloadBlock(payload as Record<string, any>));
  });

  return card;
};

export async function renderPhasesPage(container: HTMLElement, state: AnalyseState, ctx: AnalysePageContext): Promise<void> {
  container.innerHTML = "";
  let viewState: AnalyseState = { ...state };

  const setState = (patch: Partial<AnalyseState>) => {
    viewState = { ...viewState, ...patch };
    ctx.updateState(patch);
  };

  const init = document.createElement("div");
  init.className = "status-bar";
  init.textContent = "Loading runs…";
  container.appendChild(init);

  const ensureRun = async () => {
    if ((viewState.runs?.length || 0) > 0 && viewState.activeRunId && viewState.activeRunPath) {
      return true;
    }
    const base = viewState.baseDir?.trim() || (await getDefaultBaseDir());
    if (base && base !== viewState.baseDir) {
      setState({ baseDir: base });
    }
    const { runs, sectionsRoot } = await discoverRuns(base);
    if (runs.length === 0) return false;
    const chosen = runs.find((r) => r.id === viewState.activeRunId) || runs[0];
    const datasets = await buildDatasetHandles(chosen.path);
    setState({
      runs,
      sectionsRoot: sectionsRoot || undefined,
      activeRunId: chosen.id,
      activeRunPath: chosen.path,
      themesDir: chosen.path,
      datasets
    });
    return true;
  };

  const ok = await ensureRun();
  init.remove();
  if (!ok || !viewState.activeRunPath) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No runs discovered for the current collection.";
    container.appendChild(empty);
    return;
  }

  const batches = await loadBatches(viewState.activeRunPath);
  const facets = buildFacets(batches);
  const filters: FilterState = {
    search: "",
    rq: new Set(),
    evidence: new Set(),
    theme: new Set(),
    tags: new Set(),
    authors: new Set(),
    years: new Set(),
    score: new Set(),
    rqExclude: new Set(),
    evidenceExclude: new Set(),
    themeExclude: new Set()
  };

  // Mount filters into Panel 1, cards into Panel 2 (current container)
  const filtersPanel = document.createElement("div");
  filtersPanel.className = "panel";
  filtersPanel.style.padding = "10px";
  filtersPanel.style.border = "1px solid var(--border)";
  filtersPanel.style.borderRadius = "12px";
  filtersPanel.style.overflow = "auto";
  const panel1Host = document.querySelector<HTMLElement>('[data-panel-id=\"panel1\"] .panel-content');
  const panel3Host = document.querySelector<HTMLElement>('[data-panel-id=\"panel3\"] .panel-content');
  let mirrorPanel: HTMLElement | null = null;
  if (panel1Host) {
    panel1Host.innerHTML = "";
    panel1Host.appendChild(filtersPanel);
  } else {
    // fallback: render side-by-side if panel1 unavailable
    const layout = document.createElement("div");
    layout.style.display = "grid";
    layout.style.gridTemplateColumns = "320px 1fr";
    layout.style.gap = "12px";
    layout.style.height = "100%";
    container.appendChild(layout);
    layout.appendChild(filtersPanel);
  }

  const contentPanel = document.createElement("div");
  contentPanel.style.display = "flex";
  contentPanel.style.flexDirection = "column";
  contentPanel.style.gap = "12px";
  contentPanel.style.overflow = "auto";
  container.appendChild(contentPanel);

  if (panel3Host) {
    panel3Host.innerHTML = "";
    // Keep Panel 3 empty for corpus/phases by default to avoid extra load
  }

  const status = document.createElement("div");
  status.className = "status-bar";
  container.appendChild(status);

  const applyFilters = () => {
    const matches: BatchRecord[] = [];
    batches.forEach((batch) => {
      const keepPayloads = batch.payloads.filter((p) => {
        const rqVal = clean((p as any).rq_question || (p as any).rq).toLowerCase();
        const evVal = clean((p as any).evidence_type || (p as any).evidenceType).toLowerCase();
        const thVal = clean((p as any).potential_theme || (p as any).theme).toLowerCase();
        const tagVals = new Set<string>();
        clean((p as any).potential_theme || (p as any).theme)
          .split(/[|,;/]/)
          .forEach((t) => {
            const tt = clean(t).toLowerCase();
            if (tt) tagVals.add(tt);
          });
        const authorVal = clean((p as any).first_author_last || (p as any).author_summary || (p as any).author).toLowerCase();
        const yearVal = clean((p as any).year);
        const scoreVal = clean((p as any).score_bucket || (p as any).relevance_score).toLowerCase();
        const hay = (clean((p as any).paraphrase) + " " + clean((p as any).direct_quote)).toLowerCase();

        if (filters.rqExclude.has(rqVal) || filters.evidenceExclude.has(evVal) || filters.themeExclude.has(thVal)) {
          return false;
        }
        if (filters.rq.size && !filters.rq.has(rqVal)) return false;
        if (filters.evidence.size && !filters.evidence.has(evVal)) return false;
        if (filters.theme.size && !filters.theme.has(thVal)) return false;
        if (filters.tags.size && ![...filters.tags].some((t) => tagVals.has(t))) return false;
        if (filters.authors.size && !filters.authors.has(authorVal)) return false;
        if (filters.years.size && !filters.years.has(yearVal)) return false;
        if (filters.score.size && !filters.score.has(scoreVal)) return false;
        if (filters.search && !hay.includes(filters.search.toLowerCase())) return false;
        return true;
      });
      if (keepPayloads.length > 0) {
        matches.push({ ...batch, payloads: keepPayloads });
      }
    });
    renderCards(matches);
    status.textContent = `${matches.length} batch(es) · ${matches.reduce((acc, b) => acc + b.payloads.length, 0)} payload(s)`;
  };

  const renderCards = (items: BatchRecord[]) => {
    contentPanel.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No results for current filters.";
      contentPanel.appendChild(empty);
      return;
    }
    items.forEach((batch) => {
      const card = createBatchCard(batch);
      contentPanel.appendChild(card);
    });
  };

  // build filter UI
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.placeholder = "Search paraphrase/quote...";
  searchInput.addEventListener("input", () => {
    filters.search = searchInput.value;
    applyFilters();
  });
  const searchWrap = document.createElement("div");
  searchWrap.className = "panel";
  searchWrap.style.padding = "8px";
  searchWrap.style.border = "1px solid var(--border)";
  searchWrap.style.borderRadius = "10px";
  const searchTitle = document.createElement("h4");
  searchTitle.textContent = "Search";
  searchWrap.appendChild(searchTitle);
  searchWrap.appendChild(searchInput);
  filtersPanel.appendChild(searchWrap);

  renderChecklist("Research questions", facets.rq, filters.rq, filters.rqExclude, applyFilters, filtersPanel, Object.keys(facets.rq).length || 20);
  renderChecklist("Evidence type", facets.evidence, filters.evidence, filters.evidenceExclude, applyFilters, filtersPanel, Object.keys(facets.evidence).length || 12);
  renderChecklist("Overarching theme", facets.theme, filters.theme, filters.themeExclude, applyFilters, filtersPanel, Object.keys(facets.theme).length || 20);
  renderChecklist("Tags", facets.tags, filters.tags, null, applyFilters, filtersPanel, 12);
  renderChecklist("Authors", facets.authors, filters.authors, null, applyFilters, filtersPanel, 10);
  renderChecklist("Year", facets.years, filters.years, null, applyFilters, filtersPanel, 10);
  renderChecklist("Score bucket", facets.score, filters.score, null, applyFilters, filtersPanel, 10);

  applyFilters();
}
