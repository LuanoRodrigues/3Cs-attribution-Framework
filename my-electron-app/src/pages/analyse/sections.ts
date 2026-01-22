import type { AnalysePageContext, AnalyseRoundId, AnalyseState } from "../../analyse/types";
import { loadSections, loadDirectQuoteLookup } from "../../analyse/data";
import type { SectionRecord } from "../../analyse/types";

interface SectionFilters {
  search: string;
  routes: Set<string>;
  rq: Set<string>;
  rqExclude: Set<string>;
  theme: Set<string>;
  themeExclude: Set<string>;
  evidence: Set<string>;
  evidenceExclude: Set<string>;
}

function uniq(values: (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v)));
}

function stripHtml(html: string, limit = 200): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const text = tmp.textContent || tmp.innerText || "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function emitPreview(container: HTMLElement, round: AnalyseRoundId, section: SectionRecord, runId?: string): void {
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

export function renderSectionsPage(
  container: HTMLElement,
  state: AnalyseState,
  round: AnalyseRoundId,
  _ctx?: AnalysePageContext
): void {
  container.innerHTML = "";
  const header = document.createElement("h2");
  header.textContent = `Sections — ${round.toUpperCase()}`;
  container.appendChild(header);

  if (!state.activeRunPath) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Select an active run to view sections.";
    container.appendChild(empty);
    return;
  }

  let sections: SectionRecord[] = [];
  let dqLookup: Record<string, any> = {};
  let dqLookupPath: string | null = null;
  const filters: SectionFilters = {
    search: "",
    routes: new Set<string>(),
    rq: new Set<string>(),
    rqExclude: new Set<string>(),
    theme: new Set<string>(),
    themeExclude: new Set<string>(),
    evidence: new Set<string>(),
    evidenceExclude: new Set<string>(),
  };

  // Panel hosts
  const panel1Host = document.querySelector<HTMLElement>('[data-panel-id="panel1"] .panel-content');
  const panel3Host = document.querySelector<HTMLElement>('[data-panel-id="panel3"] .panel-content');
  let mirrorPanel: HTMLElement | null = null;
  if (state.activeRunPath) {
    const datasets = state.datasets || {};
    console.info("[analyse][round][init]", {
      level: round,
      runPath: state.activeRunPath,
      sectionsPath:
        round === "r1"
          ? datasets.sectionsR1
          : round === "r2"
          ? datasets.sectionsR2
          : datasets.sectionsR3
    });
  }

  const filtersPanel = document.createElement("div");
  filtersPanel.className = "panel";
  filtersPanel.style.padding = "10px";
  filtersPanel.style.border = "1px solid var(--border)";
  filtersPanel.style.borderRadius = "12px";
  filtersPanel.style.overflow = "auto";

  if (panel1Host) {
    panel1Host.innerHTML = "";
    panel1Host.appendChild(filtersPanel);
  } else {
    container.appendChild(filtersPanel);
  }

  const list = document.createElement("div");
  list.style.display = "grid";
  list.style.gridTemplateColumns = "repeat(auto-fit, minmax(320px, 1fr))";
  list.style.gap = "12px";
  container.appendChild(list);

  if (panel3Host && round !== "r1") {
    panel3Host.innerHTML = "";
    mirrorPanel = document.createElement("div");
    mirrorPanel.style.display = "grid";
    mirrorPanel.style.gridTemplateColumns = "repeat(auto-fit, minmax(320px, 1fr))";
    mirrorPanel.style.gap = "12px";
    mirrorPanel.style.padding = "8px";
    mirrorPanel.style.overflow = "auto";
    panel3Host.appendChild(mirrorPanel);
  }

  const previewPanel =
    round === "r2" || round === "r3"
      ? document.createElement("div")
      : null;
  if (previewPanel) {
    previewPanel.style.display = "flex";
    previewPanel.style.flexDirection = "column";
    previewPanel.style.gap = "10px";
    previewPanel.style.padding = "10px";
    previewPanel.className = "panel";
    previewPanel.style.border = "1px solid var(--border)";
    previewPanel.style.borderRadius = "12px";
    if (panel3Host) {
      panel3Host.innerHTML = "";
      panel3Host.appendChild(previewPanel);
    } else {
      container.appendChild(previewPanel);
    }
  }

  const status = document.createElement("div");
  status.className = "status-bar";
  container.appendChild(status);

  const controls = document.createElement("div");
  controls.className = "control-row";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "Search sections";
  search.addEventListener("input", () => {
    filters.search = search.value;
    renderList();
  });
  controls.appendChild(search);
  filtersPanel.appendChild(controls);
  filtersPanel.appendChild(document.createElement("div")).className = "divider";

  const facetsWrap = document.createElement("div");
  facetsWrap.style.display = "flex";
  facetsWrap.style.flexDirection = "column";
  facetsWrap.style.gap = "8px";
  filtersPanel.appendChild(facetsWrap);

  const cleanKey = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const facetCount = (values: (string | undefined)[]) =>
    values.reduce<Record<string, number>>((acc, v) => {
      const k = cleanKey(v);
      if (!k) return acc;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

  const renderChecklist = (
    title: string,
    counts: Record<string, number>,
    includeSet: Set<string>,
    excludeSet: Set<string> | null,
    topN = 10
  ) => {
    const wrapper = document.createElement("div");
    wrapper.className = "premium-card";
    const head = document.createElement("div");
    head.className = "filter-heading";
    const h4 = document.createElement("h4");
    h4.textContent = title;
    head.appendChild(h4);
    const controlsRow = document.createElement("div");
    controlsRow.className = "filter-controls";
    const allBtn = document.createElement("button");
    allBtn.className = "chip";
    allBtn.textContent = "All";
    allBtn.addEventListener("click", () => {
      Object.keys(counts).forEach((k) => includeSet.add(k.toLowerCase()));
      renderList();
      renderListItems();
    });
    const noneBtn = document.createElement("button");
    noneBtn.className = "chip ghost";
    noneBtn.textContent = "None";
    noneBtn.addEventListener("click", () => {
      includeSet.clear();
      if (excludeSet) excludeSet.clear();
      renderList();
      renderListItems();
    });
    const expandBtn = document.createElement("button");
    expandBtn.className = "chip ghost";
    expandBtn.textContent = "Expand…";
    controlsRow.append(allBtn, noneBtn, expandBtn);
    head.appendChild(controlsRow);
    wrapper.appendChild(head);

    const listBox = document.createElement("div");
    listBox.style.display = "flex";
    listBox.style.flexDirection = "column";
    listBox.style.gap = "4px";
    wrapper.appendChild(listBox);
    const sortedEntries = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    const renderListItems = (slice: number | null = topN) => {
      listBox.innerHTML = "";
      const items = slice ? sortedEntries.slice(0, slice) : sortedEntries;
      items.forEach(([key, count]) => {
        const norm = key.toLowerCase();
        const row = document.createElement("label");
        row.className = "filter-row";
        const inc = document.createElement("input");
        inc.type = "checkbox";
        inc.checked = includeSet.has(norm);
        inc.addEventListener("change", () => {
          if (inc.checked) {
            includeSet.add(norm);
            if (excludeSet) excludeSet.delete(norm);
          } else {
            includeSet.delete(norm);
          }
          renderList();
        });
        const txt = document.createElement("span");
        txt.textContent = `${key} (${count})`;
        row.append(inc, txt);
        if (excludeSet) {
          const exc = document.createElement("input");
          exc.type = "checkbox";
          exc.className = "exclude-box";
          exc.checked = excludeSet.has(norm);
          exc.addEventListener("change", () => {
            if (!excludeSet) return;
            if (exc.checked) {
              excludeSet.add(norm);
              includeSet.delete(norm);
              inc.checked = false;
            } else {
              excludeSet.delete(norm);
            }
            renderList();
          });
          row.appendChild(exc);
        }
        listBox.appendChild(row);
      });
    };
    renderListItems();

    const openModal = () => {
      const backdrop = document.createElement("div");
      backdrop.className = "modal-backdrop";
      const dialog = document.createElement("div");
      dialog.className = "modal";
      const titleEl = document.createElement("h3");
      titleEl.textContent = title;
      dialog.appendChild(titleEl);
      const searchBox = document.createElement("input");
      searchBox.type = "search";
      searchBox.placeholder = "Search…";
      searchBox.className = "modal-search";
      dialog.appendChild(searchBox);
      const grid = document.createElement("div");
      grid.className = "modal-grid";
      const incTitle = document.createElement("div");
      incTitle.className = "modal-col-title";
      incTitle.textContent = "Include";
      const excTitle = document.createElement("div");
      excTitle.className = "modal-col-title";
      excTitle.textContent = "Exclude";
      const incWrap = document.createElement("div");
      incWrap.className = "modal-list";
      const excWrap = document.createElement("div");
      excWrap.className = "modal-list";
      grid.append(incTitle, excTitle, incWrap, excWrap);
      dialog.appendChild(grid);
      const actions = document.createElement("div");
      actions.className = "modal-actions";
      const ok = document.createElement("button");
      ok.className = "ribbon-button";
      ok.textContent = "Apply";
      const cancel = document.createElement("button");
      cancel.className = "ribbon-button ghost";
      cancel.textContent = "Cancel";
      actions.append(cancel, ok);
      dialog.appendChild(actions);
      backdrop.appendChild(dialog);
      document.body.appendChild(backdrop);

      const renderModal = () => {
        incWrap.innerHTML = "";
        excWrap.innerHTML = "";
        const needle = searchBox.value.trim().toLowerCase();
        sortedEntries.forEach(([k, c]) => {
          if (needle && !k.toLowerCase().includes(needle)) return;
          const norm = k.toLowerCase();
          const incRow = document.createElement("label");
          incRow.className = "filter-row";
          const inc = document.createElement("input");
          inc.type = "checkbox";
          inc.checked = includeSet.has(norm);
          inc.addEventListener("change", () => {
            if (inc.checked) {
              includeSet.add(norm);
              if (excludeSet) excludeSet.delete(norm);
            } else {
              includeSet.delete(norm);
            }
          });
          const incTxt = document.createElement("span");
          incTxt.textContent = `${k} (${c})`;
          incRow.append(inc, incTxt);
          incWrap.appendChild(incRow);

          if (excludeSet) {
            const excRow = document.createElement("label");
            excRow.className = "filter-row";
            const exc = document.createElement("input");
            exc.type = "checkbox";
            exc.className = "exclude-box";
            exc.checked = excludeSet.has(norm);
            exc.addEventListener("change", () => {
              if (!excludeSet) return;
              if (exc.checked) {
                excludeSet.add(norm);
                includeSet.delete(norm);
              } else {
                excludeSet.delete(norm);
              }
            });
            const excTxt = document.createElement("span");
            excTxt.textContent = `${k} (${c})`;
            excRow.append(exc, excTxt);
            excWrap.appendChild(excRow);
          }
        });
      };

      renderModal();
      searchBox.addEventListener("input", renderModal);
      cancel.addEventListener("click", () => backdrop.remove());
      ok.addEventListener("click", () => {
        backdrop.remove();
        renderList();
        renderListItems();
      });
    };

    expandBtn.addEventListener("click", () => openModal());
    filtersPanel.appendChild(wrapper);
  };

  const filtered = (): SectionRecord[] => {
    const term = filters.search.trim().toLowerCase();
    return sections.filter((section) => {
      const routeVal = section.route?.toLowerCase();
      const rqVal = (section.meta?.rq as string | undefined)?.toLowerCase();
      const themeVal = (section.meta?.gold_theme as string | undefined)?.toLowerCase();
      const evVal = (section.meta?.evidence_type as string | undefined)?.toLowerCase();

      if (filters.routes.size && (!routeVal || !filters.routes.has(routeVal))) return false;
      if (filters.rq.size && (!rqVal || !filters.rq.has(rqVal))) return false;
      if (filters.theme.size && (!themeVal || !filters.theme.has(themeVal))) return false;
      if (filters.evidence.size && (!evVal || !filters.evidence.has(evVal))) return false;

      if (filters.rqExclude.size && rqVal && filters.rqExclude.has(rqVal)) return false;
      if (filters.themeExclude.size && themeVal && filters.themeExclude.has(themeVal)) return false;
      if (filters.evidenceExclude.size && evVal && filters.evidenceExclude.has(evVal)) return false;

      const matchesSearch = !term
        ? true
        : section.title.toLowerCase().includes(term) ||
          routeVal?.includes(term) ||
          rqVal?.includes(term) ||
          themeVal?.includes(term) ||
          stripHtml(section.html, Number.MAX_SAFE_INTEGER).toLowerCase().includes(term);
      return matchesSearch;
    });
  };

  const renderList = () => {
    list.innerHTML = "";
    if (previewPanel) {
      previewPanel.innerHTML = "";
    }
    if (mirrorPanel) {
      mirrorPanel.innerHTML = "";
    }
    const items = filtered();
    status.textContent = `${items.length} sections`;
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No sections matched the current filters.";
      list.appendChild(empty);
      if (previewPanel) {
        const hint = empty.cloneNode(true) as HTMLElement;
        previewPanel.appendChild(hint);
      }
      if (mirrorPanel) {
        const hint2 = empty.cloneNode(true) as HTMLElement;
        mirrorPanel.appendChild(hint2);
      }
      return;
    }

    items.forEach((section) => {
      const card = document.createElement("div");
      card.className = "viz-card";
      card.style.cursor = "pointer";

      const title = document.createElement("h4");
      title.textContent = section.title;
      card.appendChild(title);

      const route = document.createElement("div");
      route.className = "status-bar";
      route.textContent = section.route || "";
      card.appendChild(route);

      const excerpt = document.createElement("p");
      excerpt.textContent = stripHtml(section.html);
      card.appendChild(excerpt);

      card.addEventListener("click", () => {
        emitPreview(container, round, section, state.activeRunId);
        if (previewPanel) {
          renderPreview(previewPanel, section);
        }
        if (mirrorPanel) {
          renderPreview(mirrorPanel, section);
        }
      });
      list.appendChild(card);

      if (mirrorPanel) {
        const clone = card.cloneNode(true) as HTMLElement;
        mirrorPanel.appendChild(clone);
      }
    });
  };

  const renderPreview = (panel: HTMLElement, section: SectionRecord) => {
    panel.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "viz-card";
    const paper = document.createElement("div");
    paper.className = "paper-preview paper";
    const title = document.createElement("h4");
    title.textContent = section.title || section.id;
    paper.appendChild(title);
    const route = document.createElement("div");
    route.className = "status-bar";
    route.textContent = section.route || "";
    paper.appendChild(route);
    const body = document.createElement("div");
    body.className = "preview-content";
    body.innerHTML = section.html || "<p><em>No section HTML.</em></p>";
    body.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target && target.tagName === "A") {
        const href = (target as HTMLAnchorElement).href;
        if (href) {
          ev.preventDefault();
          const dqid = extractDqid(href, target, section);
          const payload = dqid ? dqLookup[dqid] : undefined;
          const detail = {
            href,
            sectionId: section.id,
            route: section.route,
            meta: section.meta,
            title: section.title,
            dqid,
            payload,
            lookupPath: dqLookupPath
          };
          console.info("[analyse][preview][anchor-click]", detail);
          panel.dispatchEvent(new CustomEvent("analyse-open-pdf", { bubbles: true, detail }));
        }
      }
    });
    paper.appendChild(body);
    wrapper.appendChild(paper);
    panel.appendChild(wrapper);
  };

  const extractDqid = (href: string, node: HTMLElement, section: SectionRecord): string | undefined => {
    const pick = (val?: string | null) => {
      const t = (val || "").trim().toLowerCase();
      return t || undefined;
    };

    // 1) Explicit attributes on the anchor
    const attr =
      pick(node.getAttribute("data-dqid")) ||
      pick(node.getAttribute("data-quote_id")) ||
      pick(node.getAttribute("data-quote-id")) ||
      // dataset helpers
      pick((node as HTMLAnchorElement).dataset?.dqid) ||
      pick((node as HTMLAnchorElement).dataset?.quoteId);
    if (attr) return attr;

    const hrefStr = href || "";

    // 2) dq:// scheme or dq:<id>
    if (hrefStr.startsWith("dq://") || hrefStr.startsWith("dq:")) {
      const cleaned = hrefStr.replace(/^dq:\/*/, "");
      return pick(cleaned.split(/[?#]/)[0]);
    }

    // 3) URL params (query + hash)
    try {
      const u = new URL(hrefStr);
      const searchVal =
        pick(u.searchParams.get("dqid")) ||
        pick(u.searchParams.get("quote_id")) ||
        pick(u.searchParams.get("quote-id"));
      if (searchVal) return searchVal;

      const hash = (u.hash || "").replace(/^#/, "");
      if (hash) {
        const hp = new URLSearchParams(hash.replace("?", "&"));
        const hashVal =
          pick(hp.get("dqid")) || pick(hp.get("quote_id")) || pick(hp.get("quote-id"));
        if (hashVal) return hashVal;
      }
    } catch {
      // not a fully qualified URL; fall through
    }

    // 4) Manual regex fallback (handles inline fragments)
    const match = hrefStr.match(/[?#&]dqid=([^&#]+)/i);
    if (match && match[1]) return pick(match[1]);

    // 5) Section metadata fallback (ids only, not full quotes)
    const meta = section.meta || {};
    return pick((meta as any).direct_quote_id || (meta as any).dqid || (meta as any).dq_id || (meta as any).custom_id);
  };

  const loadData = async () => {
    status.textContent = "Loading sections...";
    const runPath = state.activeRunPath;
    if (!runPath) {
      status.textContent = "No active run selected.";
      return;
    }
    try {
      const [secData, dqData] = await Promise.all([loadSections(runPath, round), loadDirectQuoteLookup(runPath)]);
      sections = secData;
      dqLookup = dqData?.data || {};
      dqLookupPath = dqData?.path || null;
      console.info("[analyse][sections][dq-lookup]", { count: Object.keys(dqLookup || {}).length, path: dqLookupPath });
      // build facets and render filters
      facetsWrap.innerHTML = "";
      const routeCounts = facetCount(sections.map((s) => s.route));
      const rqCounts = facetCount(sections.map((s) => (s.meta?.rq as string | undefined)));
      const themeCounts = facetCount(sections.map((s) => (s.meta?.gold_theme as string | undefined)));
      const evCounts = facetCount(sections.map((s) => (s.meta?.evidence_type as string | undefined)));

      renderChecklist("Routes", routeCounts, filters.routes, null, 12);
      renderChecklist("Research questions", rqCounts, filters.rq, filters.rqExclude, 15);
      renderChecklist("Themes", themeCounts, filters.theme, filters.themeExclude, 15);
      renderChecklist("Evidence", evCounts, filters.evidence, filters.evidenceExclude, 10);

      renderList();
      status.textContent = `${sections.length} sections loaded`;
    } catch (error) {
      console.error(error);
      status.textContent = "Failed to load sections.";
    }
  };

  void loadData();
}
