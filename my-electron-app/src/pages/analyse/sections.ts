import type { AnalysePageContext, AnalyseRoundId, AnalyseState, BatchPayload, BatchRecord, SectionRecord } from "../../analyse/types";
import { loadBatches, loadSections, loadDirectQuoteLookup } from "../../analyse/data";

interface SectionFilters {
  search: string;
  tagContains: string;
  tags: Set<string>;
  gold: Set<string>;
  rq: Set<string>;
  route: Set<string>;
  evidence: Set<string>;
  potential: Set<string>;
}

interface BatchFilters {
  search: string;
  rq: Set<string>;
  evidence: Set<string>;
  theme: Set<string>;
  tags: Set<string>;
  authors: Set<string>;
  years: Set<string>;
  score: Set<string>;
}

interface SectionView {
  section: SectionRecord;
  title: string;
  rq: string;
  gold: string;
  route: string;
  evidence: string;
  potentialTokens: string[];
  tags: string[];
  text: string;
}

interface BatchPayloadView {
  batch: BatchRecord;
  payload: BatchPayload & Record<string, unknown>;
  rq: string;
  theme: string;
  evidence: string;
  tags: string[];
  author: string;
  year: string;
  score: string;
  text: string;
}

function stripHtml(html: string, limit = 200): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const text = tmp.textContent || tmp.innerText || "";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function extractTagsFromHtml(html: string): string[] {
  if (!html) return [];
  const tags: string[] = [];
  const regex = /data-tags="([^"]*)"/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(html))) {
    const raw = decodeEntities(match[1] || "");
    raw
      .split(/[;|,/]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .forEach((t) => tags.push(t));
  }
  return Array.from(new Set(tags));
}

function tokenizePotentialTheme(value: string): string[] {
  if (!value) return [];
  const cleaned = value.replace(/^mixed:\s*/i, "");
  return Array.from(
    new Set(
      cleaned
        .split(/[|,;/]/)
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );
}

function normalizeTagList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[;|,/]/)
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function countValues(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, v) => {
    if (!v) return acc;
    acc[v] = (acc[v] || 0) + 1;
    return acc;
  }, {});
}

function hashHue(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
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

function emitBatchPayload(container: HTMLElement, payload: Record<string, unknown>, runId?: string): void {
  container.dispatchEvent(
    new CustomEvent("analyse-payload-selected", {
      detail: {
        type: "batch_payload",
        id: String(payload.id ?? ""),
        text: String(payload.text ?? payload.paraphrase ?? payload.direct_quote ?? ""),
        page: payload.page as number | undefined,
        meta: payload,
        runId
      },
      bubbles: true
    })
  );
}

function cleanField(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s) return "";
  const low = s.toLowerCase();
  const bad = new Set(["n/a", "na", "none", "null", "nil", "unspecified", "unknown", "-", "--", "—", "(n/a)", "(na)"]);
  return bad.has(low) ? "" : s;
}

function authorDisplay(payload: Record<string, unknown>): string {
  const first = cleanField(payload.first_author_last);
  if (first) return first;
  const summary = cleanField(payload.author_summary);
  if (summary) {
    const block = summary.split(";")[0] || summary;
    const trimmed = block.split("·")[0].split("(")[0];
    return cleanField(trimmed);
  }
  const author = cleanField(payload.author);
  return author;
}

function pageSegment(payload: Record<string, unknown>): string {
  const keys = ["page", "page_number", "page_num", "pg"] as const;
  for (const key of keys) {
    const raw = cleanField(payload[key]);
    if (!raw) continue;
    if (/^\d+$/.test(raw)) return `p. ${raw}`;
  }
  return "";
}

function buildMetaLine(payload: Record<string, unknown>): string {
  const author = authorDisplay(payload);
  const year = cleanField(payload.year);
  const page = pageSegment(payload);
  const source = cleanField(payload.source);
  const title = cleanField(payload.title);
  const url = cleanField(payload.url);
  const itemKey = cleanField(payload.item_key);

  const parenParts: string[] = [];
  if (year) parenParts.push(year);
  if (page) parenParts.push(page);
  const paren = parenParts.join(", ");

  let authorYear = "";
  if (author && paren) authorYear = `${author} (${paren})`;
  else if (author) authorYear = author;
  else if (paren) authorYear = paren;

  const chunks: string[] = [];
  if (authorYear) chunks.push(escapeHtml(authorYear));
  if (source) chunks.push(`<strong>${escapeHtml(source)}</strong>`);
  if (title) chunks.push(`<em>${escapeHtml(title)}</em>`);

  let line = chunks.join(" · ");
  if (line && url) {
    line += ` · <a href='${escapeHtml(url)}' class='batch-link'>link</a>`;
  }
  if (!line && itemKey) {
    line = `Key: ${escapeHtml(itemKey)}`;
  }
  return line;
}

type ReadStatus = "" | "reading" | "read" | "not_to_read";

function statusCycle(current: ReadStatus): ReadStatus {
  const order: ReadStatus[] = ["", "reading", "read", "not_to_read"];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length] || "";
}

function statusLabel(status: ReadStatus): string {
  switch (status) {
    case "reading":
      return "Reading";
    case "read":
      return "Read";
    case "not_to_read":
      return "Not to read";
    default:
      return "Mark";
  }
}

function readStatusKey(round: AnalyseRoundId, runId?: string): string {
  const safeRun = runId || "default";
  return `analyse.readStatus.${round}.${safeRun}`;
}

function loadReadStatus(round: AnalyseRoundId, runId?: string): Record<string, ReadStatus> {
  const key = readStatusKey(round, runId);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, ReadStatus>;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    return {};
  }
  return {};
}

function saveReadStatus(round: AnalyseRoundId, runId: string | undefined, data: Record<string, ReadStatus>): void {
  const key = readStatusKey(round, runId);
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // ignore storage errors
  }
}

function sectionField(section: SectionRecord, key: string): string {
  const meta = section.meta || {};
  const asAny = section as unknown as Record<string, unknown>;
  const fromMeta = meta[key] ?? (meta as Record<string, unknown>)[key];
  return String(asAny[key] ?? fromMeta ?? "").trim();
}

function sectionTags(section: SectionRecord): string[] {
  if (section.tags && section.tags.length) return section.tags;
  const metaTags = normalizeTagList((section.meta as any)?.tags);
  if (metaTags.length) return metaTags;
  return extractTagsFromHtml(section.html);
}

function sectionPotentialTokens(section: SectionRecord): string[] {
  if (section.potentialTokens && section.potentialTokens.length) return section.potentialTokens;
  const raw = sectionField(section, "potential_theme") || section.potentialTheme || "";
  return tokenizePotentialTheme(raw);
}

function buildSectionViews(sections: SectionRecord[]): SectionView[] {
  return sections.map((section) => {
    const rq = section.rq || sectionField(section, "rq");
    const gold = section.goldTheme || sectionField(section, "gold_theme");
    const route = section.routeValue || section.route || sectionField(section, "route_value") || sectionField(section, "route");
    const evidence = section.evidenceType || sectionField(section, "evidence_type");
    const tags = sectionTags(section);
    const potentialTokens = sectionPotentialTokens(section);
    const title = section.title || sectionField(section, "title") || "Untitled section";
    const text = stripHtml(section.html, Number.MAX_SAFE_INTEGER);
    return { section, title, rq, gold, route, evidence, potentialTokens, tags, text };
  });
}

function buildBatchPayloadViews(batches: BatchRecord[]): BatchPayloadView[] {
  const views: BatchPayloadView[] = [];
  batches.forEach((batch) => {
    batch.payloads.forEach((payload) => {
      const raw = payload as BatchPayload & Record<string, unknown>;
      const meta = (raw.meta as Record<string, unknown>) || {};
      const rq = String(raw.rq_question ?? raw.rq ?? meta.rq ?? batch.rqQuestion ?? "").trim();
      const theme = String(
        raw.payload_theme ??
          raw.theme ??
          raw.potential_theme ??
          raw.overarching_theme ??
          meta.gold_theme ??
          meta.potential_theme ??
          batch.theme ??
          ""
      ).trim();
      const evidence = String(raw.evidence_type ?? raw.evidence_type_norm ?? meta.evidence_type ?? batch.evidenceType ?? "").trim();
      const tags = Array.from(
        new Set([
          ...normalizeTagList(raw.tags ?? raw.tag_cluster ?? raw.section_tags ?? meta.tags ?? meta.tag_cluster ?? meta.section_tags),
          ...extractTagsFromHtml(String(raw.section_html ?? raw.section_text ?? "")),
        ])
      );
      const author = authorDisplay({ ...meta, ...raw });
      const year = cleanField(raw.year ?? meta.year);
      const score = cleanField(raw.relevance_score ?? raw.score ?? raw.rank ?? meta.score);
      const text = String(raw.paraphrase ?? raw.direct_quote ?? raw.section_text ?? raw.text ?? "");
      views.push({ batch, payload: raw, rq, theme, evidence, tags, author, year, score, text });
    });
  });
  return views;
}

function renderChecklist(
  title: string,
  counts: Record<string, number>,
  selected: Set<string>,
  onChange: () => void,
  container: HTMLElement,
  topN = 10
): void {
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
    Object.keys(counts).forEach((k) => selected.add(k));
    onChange();
  });
  const noneBtn = document.createElement("button");
  noneBtn.className = "chip ghost";
  noneBtn.textContent = "None";
  noneBtn.addEventListener("click", () => {
    selected.clear();
    onChange();
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
      const row = document.createElement("label");
      row.className = "filter-row";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(key);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(key);
        else selected.delete(key);
        onChange();
      });
      const txt = document.createElement("span");
      txt.textContent = `${key} (${count})`;
      row.append(cb, txt);
      listBox.appendChild(row);
    });
  };

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
    const list = document.createElement("div");
    list.className = "modal-list";
    dialog.appendChild(list);
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
      list.innerHTML = "";
      const needle = searchBox.value.trim().toLowerCase();
      sortedEntries.forEach(([key, count]) => {
        if (needle && !key.toLowerCase().includes(needle)) return;
        const row = document.createElement("label");
        row.className = "filter-row";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(key);
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(key);
          else selected.delete(key);
        });
        const txt = document.createElement("span");
        txt.textContent = `${key} (${count})`;
        row.append(cb, txt);
        list.appendChild(row);
      });
    };

    renderModal();
    searchBox.addEventListener("input", renderModal);
    cancel.addEventListener("click", () => backdrop.remove());
    ok.addEventListener("click", () => {
      backdrop.remove();
      onChange();
      renderListItems();
    });
  };

  expandBtn.addEventListener("click", openModal);
  renderListItems();
  container.appendChild(wrapper);
}

export function renderSectionsPage(
  container: HTMLElement,
  state: AnalyseState,
  round: AnalyseRoundId,
  _ctx?: AnalysePageContext,
  options?: { source?: "corpus" }
): void {
  container.innerHTML = "";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "12px";
  container.style.height = "100%";
  container.style.minHeight = "0";
  container.style.overflow = "hidden";
  const isCorpus = options?.source === "corpus";
  const isBatchMode = isCorpus || round === "r1";

  const runPath = isCorpus ? state.sectionsRoot || "" : state.activeRunPath || "";
  if (!runPath) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = isCorpus
      ? "Select a base directory to view corpus batches."
      : "Select an active run to view sections.";
    container.appendChild(empty);
    return;
  }

  let sections: SectionRecord[] = [];
  let sectionViews: SectionView[] = [];
  let batches: BatchRecord[] = [];
  let batchViews: BatchPayloadView[] = [];
  let dqLookup: Record<string, any> = {};
  let dqLookupPath: string | null = null;
  const selectedSectionIds = new Set<string>();
  const readStatus = loadReadStatus(round, state.activeRunId);
  let cachedSectionIds = new Set<string>();
  let filteredViews: SectionView[] = [];

  const sectionFilters: SectionFilters = {
    search: "",
    tagContains: "",
    tags: new Set<string>(),
    gold: new Set<string>(),
    rq: new Set<string>(),
    route: new Set<string>(),
    evidence: new Set<string>(),
    potential: new Set<string>(),
  };

  const batchFilters: BatchFilters = {
    search: "",
    rq: new Set<string>(),
    evidence: new Set<string>(),
    theme: new Set<string>(),
    tags: new Set<string>(),
    authors: new Set<string>(),
    years: new Set<string>(),
    score: new Set<string>(),
  };

  const panel1Host = document.querySelector<HTMLElement>('[data-panel-id="panel1"] .panel-content');
  const panel3Host = document.querySelector<HTMLElement>('[data-panel-id="panel3"] .panel-content');
  let previewPanel: HTMLElement | null = null;

  const emitSectionsState = (detail: { all?: SectionRecord[]; filtered?: SectionRecord[]; selectedIds?: string[] }) => {
    container.dispatchEvent(
      new CustomEvent("analyse-sections-state", {
        detail: { round, runId: state.activeRunId, ...detail },
        bubbles: true
      })
    );
  };

  const cacheListenerKey = "__ttsCacheListenerBound";
  const docAny = document as any;
  if (!docAny[cacheListenerKey]) {
    docAny[cacheListenerKey] = true;
    document.addEventListener("analyse-tts-cache-updated", (event) => {
      const detail = (event as CustomEvent<{ cachedIds?: string[]; round?: string; runId?: string }>).detail || {};
      if (detail.round && detail.round !== round) return;
      if (detail.runId && detail.runId !== state.activeRunId) return;
      cachedSectionIds = new Set(detail.cachedIds || []);
      if (filteredViews.length) {
        renderSectionList(filteredViews);
      }
    });
  }

  const filtersPanel = document.createElement("div");
  filtersPanel.className = "panel";
  filtersPanel.style.padding = "10px";
  filtersPanel.style.border = "1px solid var(--border)";
  filtersPanel.style.borderRadius = "12px";
  filtersPanel.style.overflow = "hidden";
  filtersPanel.style.display = "flex";
  filtersPanel.style.flexDirection = "column";
  filtersPanel.style.height = "100%";
  filtersPanel.style.maxHeight = "100%";

  if (panel1Host) {
    panel1Host.innerHTML = "";
    panel1Host.appendChild(filtersPanel);
  } else {
    container.appendChild(filtersPanel);
  }

  const list = document.createElement("div");
  list.style.display = isBatchMode ? "flex" : "grid";
  list.style.flexDirection = isBatchMode ? "column" : "";
  list.style.gridTemplateColumns = isBatchMode ? "" : "repeat(auto-fit, minmax(320px, 1fr))";
  list.style.gap = "12px";
  list.style.flex = "1";
  list.style.minHeight = "0";
  list.style.overflow = "auto";
  container.appendChild(list);

  if (!isBatchMode && panel3Host) {
    panel3Host.innerHTML = "";
    previewPanel = document.createElement("div");
    previewPanel.style.display = "flex";
    previewPanel.style.flexDirection = "column";
    previewPanel.style.gap = "10px";
    previewPanel.style.padding = "10px";
    previewPanel.className = "panel";
    previewPanel.style.border = "1px solid var(--border)";
    previewPanel.style.borderRadius = "12px";
    previewPanel.style.flex = "1";
    previewPanel.style.minHeight = "0";
    previewPanel.style.overflow = "auto";
    panel3Host.appendChild(previewPanel);
  }

  const status = document.createElement("div");
  status.className = "status-bar";
  container.appendChild(status);

  const renderSectionFilters = (facets: Record<string, Record<string, number>>) => {
    filtersPanel.innerHTML = "";

    const controls = document.createElement("div");
    controls.className = "control-row";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search in text, citations & tags…";
    search.value = sectionFilters.search;
    search.addEventListener("input", () => {
      sectionFilters.search = search.value;
    });
    controls.appendChild(search);
    filtersPanel.appendChild(controls);

    const contains = document.createElement("input");
    contains.type = "search";
    contains.placeholder = "Tag contains…";
    contains.value = sectionFilters.tagContains;
    contains.addEventListener("input", () => {
      sectionFilters.tagContains = contains.value;
    });
    filtersPanel.appendChild(contains);

    const actions = document.createElement("div");
    actions.className = "control-row";
    const applyBtn = document.createElement("button");
    applyBtn.className = "ribbon-button";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => applySectionFilters());
    const resetBtn = document.createElement("button");
    resetBtn.className = "ribbon-button ghost";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => {
      sectionFilters.search = "";
      sectionFilters.tagContains = "";
      sectionFilters.tags.clear();
      sectionFilters.gold.clear();
      sectionFilters.rq.clear();
      sectionFilters.route.clear();
      sectionFilters.evidence.clear();
      sectionFilters.potential.clear();
      applySectionFilters();
    });
    actions.append(applyBtn, resetBtn);
    filtersPanel.appendChild(actions);
    filtersPanel.appendChild(document.createElement("div")).className = "divider";

    const scrollArea = document.createElement("div");
    scrollArea.style.flex = "1";
    scrollArea.style.overflow = "auto";
    scrollArea.style.display = "flex";
    scrollArea.style.flexDirection = "column";
    scrollArea.style.gap = "8px";
    filtersPanel.appendChild(scrollArea);

    renderChecklist("Section tags", facets.tags || {}, sectionFilters.tags, applySectionFilters, scrollArea, 10);
    renderChecklist("Gold theme", facets.gold || {}, sectionFilters.gold, applySectionFilters, scrollArea, 10);
    renderChecklist("Research question", facets.rq || {}, sectionFilters.rq, applySectionFilters, scrollArea, 10);
    renderChecklist("Route / timeframe", facets.route || {}, sectionFilters.route, applySectionFilters, scrollArea, 10);
    renderChecklist("Evidence type", facets.evidence || {}, sectionFilters.evidence, applySectionFilters, scrollArea, 10);
    renderChecklist("Potential themes", facets.potential || {}, sectionFilters.potential, applySectionFilters, scrollArea, 10);
  };

  const renderBatchFilters = (facets: Record<string, Record<string, number>>) => {
    filtersPanel.innerHTML = "";

    const controls = document.createElement("div");
    controls.className = "control-row";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search in text, citations & tags…";
    search.value = batchFilters.search;
    search.addEventListener("input", () => {
      batchFilters.search = search.value;
    });
    controls.appendChild(search);
    filtersPanel.appendChild(controls);

    const actions = document.createElement("div");
    actions.className = "control-row";
    const applyBtn = document.createElement("button");
    applyBtn.className = "ribbon-button";
    applyBtn.textContent = "Apply";
    applyBtn.addEventListener("click", () => applyBatchFilters());
    const resetBtn = document.createElement("button");
    resetBtn.className = "ribbon-button ghost";
    resetBtn.textContent = "Reset";
    resetBtn.addEventListener("click", () => {
      batchFilters.search = "";
      batchFilters.rq.clear();
      batchFilters.evidence.clear();
      batchFilters.theme.clear();
      batchFilters.tags.clear();
      batchFilters.authors.clear();
      batchFilters.years.clear();
      batchFilters.score.clear();
      applyBatchFilters();
    });
    actions.append(applyBtn, resetBtn);
    filtersPanel.appendChild(actions);
    filtersPanel.appendChild(document.createElement("div")).className = "divider";

    const scrollArea = document.createElement("div");
    scrollArea.style.flex = "1";
    scrollArea.style.overflow = "auto";
    scrollArea.style.display = "flex";
    scrollArea.style.flexDirection = "column";
    scrollArea.style.gap = "8px";
    filtersPanel.appendChild(scrollArea);

    renderChecklist("Research questions", facets.rq || {}, batchFilters.rq, applyBatchFilters, scrollArea, 10);
    renderChecklist("Evidence type", facets.evidence || {}, batchFilters.evidence, applyBatchFilters, scrollArea, 10);
    renderChecklist("Overarching theme", facets.theme || {}, batchFilters.theme, applyBatchFilters, scrollArea, 10);
    renderChecklist("Tags", facets.tags || {}, batchFilters.tags, applyBatchFilters, scrollArea, 10);
    renderChecklist("Top authors", facets.authors || {}, batchFilters.authors, applyBatchFilters, scrollArea, 10);
    renderChecklist("Year", facets.years || {}, batchFilters.years, applyBatchFilters, scrollArea, 10);
    renderChecklist("Relevance score", facets.score || {}, batchFilters.score, applyBatchFilters, scrollArea, 10);
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

    const attr =
      pick(node.getAttribute("data-dqid")) ||
      pick(node.getAttribute("data-quote_id")) ||
      pick(node.getAttribute("data-quote-id")) ||
      pick((node as HTMLAnchorElement).dataset?.dqid) ||
      pick((node as HTMLAnchorElement).dataset?.quoteId);
    if (attr) return attr;

    const hrefStr = href || "";
    if (hrefStr.startsWith("dq://") || hrefStr.startsWith("dq:")) {
      const cleaned = hrefStr.replace(/^dq:\/*/, "");
      return pick(cleaned.split(/[?#]/)[0]);
    }

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
        const hashVal = pick(hp.get("dqid")) || pick(hp.get("quote_id")) || pick(hp.get("quote-id"));
        if (hashVal) return hashVal;
      }
    } catch {
      // ignore invalid URLs
    }

    const match = hrefStr.match(/[?#&]dqid=([^&#]+)/i);
    if (match && match[1]) return pick(match[1]);

    const meta = section.meta || {};
    return pick((meta as any).direct_quote_id || (meta as any).dqid || (meta as any).dq_id || (meta as any).custom_id);
  };

  const renderSectionList = (views: SectionView[]) => {
    list.innerHTML = "";
    if (previewPanel) previewPanel.innerHTML = "";

    status.textContent = `${views.length} sections`;
    if (views.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No sections matched the current filters.";
      list.appendChild(empty);
      return;
    }

    views.forEach((view) => {
      const card = document.createElement("div");
      card.className = "section-card";
      card.style.cursor = "pointer";
      const sectionId = view.section.id;
      const status = readStatus[sectionId] || "";
      const cached = cachedSectionIds.has(sectionId) || Boolean((view.section.meta as any)?.tts_cached);
      card.dataset.status = status;
      card.dataset.cached = cached ? "true" : "false";

      const header = document.createElement("div");
      header.className = "section-card__head";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "section-card__check";
      checkbox.checked = selectedSectionIds.has(sectionId);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedSectionIds.add(sectionId);
        else selectedSectionIds.delete(sectionId);
        emitSectionsState({ selectedIds: Array.from(selectedSectionIds) });
      });
      header.appendChild(checkbox);

      const textCol = document.createElement("div");
      textCol.className = "section-card__text";
      const title = document.createElement("h4");
      title.textContent = view.title || "Untitled section";
      textCol.appendChild(title);
      if (view.route) {
        const route = document.createElement("div");
        route.className = "status-bar";
        route.textContent = view.route;
        textCol.appendChild(route);
      }
      header.appendChild(textCol);

      const statusCol = document.createElement("div");
      statusCol.className = "section-card__status";
      const statusBtn = document.createElement("button");
      statusBtn.type = "button";
      statusBtn.className = "section-status";
      statusBtn.textContent = statusLabel(status as ReadStatus);
      statusBtn.title = "Toggle reading status";
      const cachedLabel = document.createElement("div");
      cachedLabel.className = "section-cached";
      cachedLabel.textContent = "✓ Cached";
      cachedLabel.style.display = cached ? "block" : "none";
      const info = document.createElement("div");
      info.className = "section-info";
      info.textContent = `${statusLabel(status as ReadStatus)} • ${cached ? "Cached" : "Not cached"}`;
      statusBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const next = statusCycle(card.dataset.status as ReadStatus);
        card.dataset.status = next;
        readStatus[sectionId] = next;
        saveReadStatus(round, state.activeRunId, readStatus);
        statusBtn.textContent = statusLabel(next);
        info.textContent = `${statusLabel(next)} • ${cached ? "Cached" : "Not cached"}`;
      });
      statusCol.append(statusBtn, cachedLabel, info);
      header.appendChild(statusCol);

      card.appendChild(header);

      card.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement | null;
        if (!target) return;
        if (target.tagName === "INPUT" || target.classList.contains("section-status")) return;
        emitPreview(container, round, view.section, state.activeRunId);
        if (previewPanel) {
          renderPreview(previewPanel, view.section);
        }
      });
      list.appendChild(card);
    });
  };

  const renderBatchList = (records: Array<{ batch: BatchRecord; payloads: BatchPayloadView[] }>) => {
    list.innerHTML = "";
    status.textContent = `${records.length} batches`;
    if (records.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No batches matched the current filters.";
      list.appendChild(empty);
      return;
    }

    records.forEach(({ batch, payloads }) => {
      const card = document.createElement("div");
      card.className = "batch-card";

      const heading = document.createElement("div");
      heading.className = "batch-card__head";
      const title = document.createElement("h4");
      title.textContent = batch.theme || batch.id;
      const badge = document.createElement("span");
      badge.className = "status-bar";
      badge.textContent = `${payloads.length} payloads`;
      heading.appendChild(title);
      heading.appendChild(badge);
      card.appendChild(heading);

      const meta = document.createElement("div");
      meta.className = "status-bar";
      meta.textContent = [batch.evidenceType, batch.rqQuestion].filter(Boolean).join(" · ");
      card.appendChild(meta);

      payloads.forEach((view) => {
        const payload = view.payload;
        const block = document.createElement("div");
        block.className = "batch-payload";

        const top = document.createElement("div");
        top.className = "batch-payload__top";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "batch-payload__check";
        top.appendChild(checkbox);

        const pill = document.createElement("span");
        pill.className = "batch-pill";
        const theme = view.theme || "—";
        pill.textContent = theme;
        pill.style.background = `hsla(${hashHue(theme)}, 70%, 50%, 0.18)`;
        pill.style.borderColor = `hsla(${hashHue(theme)}, 70%, 60%, 0.5)`;
        top.appendChild(pill);

        const spacer = document.createElement("div");
        spacer.style.flex = "1";
        top.appendChild(spacer);

        const notes = cleanField(payload.researcher_comment);
        const notesBtn = document.createElement("button");
        notesBtn.type = "button";
        notesBtn.className = "batch-notes";
        notesBtn.textContent = "Notes ▸";
        notesBtn.disabled = !notes;
        top.appendChild(notesBtn);

        block.appendChild(top);

        if (notes) {
          const notesBody = document.createElement("div");
          notesBody.className = "batch-notes__body";
          notesBody.textContent = notes;
          notesBody.style.display = "none";
          notesBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            notesBody.style.display = notesBody.style.display === "none" ? "block" : "none";
          });
          block.appendChild(notesBody);
        }

        const para = cleanField(payload.paraphrase);
        if (para) {
          const paraEl = document.createElement("div");
          paraEl.className = "batch-paraphrase";
          paraEl.textContent = para;
          block.appendChild(paraEl);
        }

        const quote = cleanField(payload.direct_quote);
        if (quote) {
          const quoteEl = document.createElement("div");
          quoteEl.className = "batch-quote";
          quoteEl.textContent = `“${quote}”`;
          block.appendChild(quoteEl);
        }

        const metaLine = buildMetaLine(payload);
        if (metaLine) {
          const metaEl = document.createElement("div");
          metaEl.className = "batch-meta";
          metaEl.innerHTML = metaLine;
          block.appendChild(metaEl);
        }

        block.addEventListener("click", (ev) => {
          const target = ev.target as HTMLElement | null;
          if (!target) return;
          if (target.tagName === "A" || target.tagName === "INPUT" || target.classList.contains("batch-notes")) return;
          emitBatchPayload(container, payload, state.activeRunId);
        });

        card.appendChild(block);
      });

      list.appendChild(card);
    });
  };

  const applySectionFilters = () => {
    const term = sectionFilters.search.trim().toLowerCase();
    const tagTerm = sectionFilters.tagContains.trim().toLowerCase();

    const filtered = sectionViews.filter((view) => {
      if (sectionFilters.tags.size && !view.tags.some((t) => sectionFilters.tags.has(t))) return false;
      if (sectionFilters.gold.size && !sectionFilters.gold.has(view.gold)) return false;
      if (sectionFilters.rq.size && !sectionFilters.rq.has(view.rq)) return false;
      if (sectionFilters.route.size && !sectionFilters.route.has(view.route)) return false;
      if (sectionFilters.evidence.size && !sectionFilters.evidence.has(view.evidence)) return false;
      if (sectionFilters.potential.size && !view.potentialTokens.some((t) => sectionFilters.potential.has(t))) return false;

      if (tagTerm) {
        const hit = view.tags.some((t) => t.toLowerCase().includes(tagTerm));
        if (!hit) return false;
      }

      if (term) {
        const hay = [
          view.title,
          view.route,
          view.rq,
          view.gold,
          view.evidence,
          ...view.potentialTokens,
          ...view.tags,
          view.text,
        ]
          .filter(Boolean)
          .join(" \n ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }

      return true;
    });

    const facets = {
      tags: countValues(filtered.flatMap((v) => v.tags)),
      gold: countValues(filtered.map((v) => v.gold).filter(Boolean)),
      rq: countValues(filtered.map((v) => v.rq).filter(Boolean)),
      route: countValues(filtered.map((v) => v.route).filter(Boolean)),
      evidence: countValues(filtered.map((v) => v.evidence).filter(Boolean)),
      potential: countValues(filtered.flatMap((v) => v.potentialTokens)),
    };

    filteredViews = filtered;
    renderSectionFilters(facets);
    renderSectionList(filtered);
    emitSectionsState({ filtered: filtered.map((v) => v.section) });
  };

  const applyBatchFilters = () => {
    const term = batchFilters.search.trim().toLowerCase();
    const filteredPayloads = batchViews.filter((view) => {
      if (batchFilters.rq.size && !batchFilters.rq.has(view.rq)) return false;
      if (batchFilters.evidence.size && !batchFilters.evidence.has(view.evidence)) return false;
      if (batchFilters.theme.size && !batchFilters.theme.has(view.theme)) return false;
      if (batchFilters.tags.size && !view.tags.some((t) => batchFilters.tags.has(t))) return false;
      if (batchFilters.authors.size && !batchFilters.authors.has(view.author)) return false;
      if (batchFilters.years.size && !batchFilters.years.has(view.year)) return false;
      if (batchFilters.score.size && !batchFilters.score.has(view.score)) return false;

      if (term) {
        const hay = [
          view.rq,
          view.theme,
          view.evidence,
          view.author,
          view.year,
          ...view.tags,
          view.text,
        ]
          .filter(Boolean)
          .join(" \n ")
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });

    const facets = {
      rq: countValues(filteredPayloads.map((v) => v.rq).filter(Boolean)),
      evidence: countValues(filteredPayloads.map((v) => v.evidence).filter(Boolean)),
      theme: countValues(filteredPayloads.map((v) => v.theme).filter(Boolean)),
      tags: countValues(filteredPayloads.flatMap((v) => v.tags)),
      authors: countValues(filteredPayloads.map((v) => v.author).filter(Boolean)),
      years: countValues(filteredPayloads.map((v) => v.year).filter(Boolean)),
      score: countValues(filteredPayloads.map((v) => v.score).filter(Boolean)),
    };

    const byBatch = new Map<string, BatchPayloadView[]>();
    filteredPayloads.forEach((view) => {
      const list = byBatch.get(view.batch.id) || [];
      list.push(view);
      byBatch.set(view.batch.id, list);
    });

    const filteredBatches = batches
      .map((batch) => ({ batch, payloads: byBatch.get(batch.id) || [] }))
      .filter((entry) => entry.payloads.length > 0);

    renderBatchFilters(facets);
    renderBatchList(filteredBatches);
  };

  const loadData = async () => {
    status.textContent = isBatchMode ? "Loading batches..." : "Loading sections...";
    try {
      if (isBatchMode) {
        batches = await loadBatches(runPath);
        batchViews = buildBatchPayloadViews(batches);
        renderBatchFilters({});
        applyBatchFilters();
        status.textContent = `${batches.length} batches loaded`;
      } else {
        const [secData, dqData] = await Promise.all([loadSections(runPath, round), loadDirectQuoteLookup(runPath)]);
        sections = secData;
        sectionViews = buildSectionViews(sections);
        dqLookup = dqData?.data || {};
        dqLookupPath = dqData?.path || null;
        console.info("[analyse][sections][dq-lookup]", { count: Object.keys(dqLookup || {}).length, path: dqLookupPath });
        renderSectionFilters({});
        applySectionFilters();
        emitSectionsState({ all: sections, filtered: filteredViews.map((v) => v.section) });
        status.textContent = `${sections.length} sections loaded`;
      }
    } catch (error) {
      console.error(error);
      status.textContent = "Failed to load data.";
    }
  };

  void loadData();
}
