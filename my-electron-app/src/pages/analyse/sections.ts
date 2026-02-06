import type { AnalysePageContext, AnalyseRoundId, AnalyseState, BatchPayload, BatchRecord, SectionRecord } from "../../analyse/types";
import { loadBatches, loadBatchPayloadsPage, loadSections, loadSectionsPage, querySections, loadDirectQuoteLookup, getDirectQuotes } from "../../analyse/data";

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

function debounce<T extends (...args: any[]) => void>(fn: T, delay = 200): T {
  let handle: number | null = null;
  return ((...args: any[]) => {
    if (handle !== null) window.clearTimeout(handle);
    handle = window.setTimeout(() => fn(...args), delay);
  }) as T;
}

function scheduleIdle(task: () => void, timeout = 120): void {
  const anyWindow = window as any;
  if (typeof anyWindow.requestIdleCallback === "function") {
    anyWindow.requestIdleCallback(task, { timeout });
  } else {
    window.setTimeout(task, 0);
  }
}

function createFilterWorker(): Worker | null {
  try {
    const source = `
      const countValues = (values) => {
        const out = {};
        for (const value of values) {
          if (!value) continue;
          out[value] = (out[value] || 0) + 1;
        }
        return out;
      };
      let sections = [];
      let batches = [];
      const buildSectionCache = (items) => items.map((item) => {
        const searchText = [
          item.title, item.route, item.rq, item.gold, item.evidence,
          ...(item.potentialTokens || []),
          ...(item.tags || []),
          item.text
        ].filter(Boolean).join(" \\n ").toLowerCase();
        const tagsLower = (item.tags || []).map((t) => String(t).toLowerCase());
        return { ...item, searchText, tagsLower };
      });
      const buildBatchCache = (items) => items.map((item) => {
        const searchText = [
          item.rq, item.theme, item.evidence, item.author, item.year,
          ...(item.tags || []),
          item.text
        ].filter(Boolean).join(" \\n ").toLowerCase();
        const tagsLower = (item.tags || []).map((t) => String(t).toLowerCase());
        return { ...item, searchText, tagsLower };
      });
      const filterSections = (filters) => {
        const term = (filters.search || "").trim().toLowerCase();
        const tagTerm = (filters.tagContains || "").trim().toLowerCase();
        const tags = new Set(filters.tags || []);
        const gold = new Set(filters.gold || []);
        const rq = new Set(filters.rq || []);
        const route = new Set(filters.route || []);
        const evidence = new Set(filters.evidence || []);
        const potential = new Set(filters.potential || []);
        const indices = [];
        const facetTags = [];
        const facetGold = [];
        const facetRq = [];
        const facetRoute = [];
        const facetEvidence = [];
        const facetPotential = [];
        for (const item of sections) {
          if (tags.size && !item.tags.some((t) => tags.has(t))) continue;
          if (gold.size && !gold.has(item.gold)) continue;
          if (rq.size && !rq.has(item.rq)) continue;
          if (route.size && !route.has(item.route)) continue;
          if (evidence.size && !evidence.has(item.evidence)) continue;
          if (potential.size && !item.potentialTokens.some((t) => potential.has(t))) continue;
          if (tagTerm && !item.tagsLower.some((t) => t.includes(tagTerm))) continue;
          if (term && !item.searchText.includes(term)) continue;
          indices.push(item.idx);
          facetTags.push(...(item.tags || []));
          if (item.gold) facetGold.push(item.gold);
          if (item.rq) facetRq.push(item.rq);
          if (item.route) facetRoute.push(item.route);
          if (item.evidence) facetEvidence.push(item.evidence);
          facetPotential.push(...(item.potentialTokens || []));
        }
        return {
          indices,
          facets: {
            tags: countValues(facetTags),
            gold: countValues(facetGold),
            rq: countValues(facetRq),
            route: countValues(facetRoute),
            evidence: countValues(facetEvidence),
            potential: countValues(facetPotential)
          }
        };
      };
      const filterBatches = (filters) => {
        const term = (filters.search || "").trim().toLowerCase();
        const rq = new Set(filters.rq || []);
        const evidence = new Set(filters.evidence || []);
        const theme = new Set(filters.theme || []);
        const tags = new Set(filters.tags || []);
        const authors = new Set(filters.authors || []);
        const years = new Set(filters.years || []);
        const score = new Set(filters.score || []);
        const indices = [];
        const facetRq = [];
        const facetEvidence = [];
        const facetTheme = [];
        const facetTags = [];
        const facetAuthors = [];
        const facetYears = [];
        const facetScore = [];
        for (const item of batches) {
          if (rq.size && !rq.has(item.rq)) continue;
          if (evidence.size && !evidence.has(item.evidence)) continue;
          if (theme.size && !theme.has(item.theme)) continue;
          if (tags.size && !item.tags.some((t) => tags.has(t))) continue;
          if (authors.size && !authors.has(item.author)) continue;
          if (years.size && !years.has(item.year)) continue;
          if (score.size && !score.has(item.score)) continue;
          if (term && !item.searchText.includes(term)) continue;
          indices.push(item.idx);
          if (item.rq) facetRq.push(item.rq);
          if (item.evidence) facetEvidence.push(item.evidence);
          if (item.theme) facetTheme.push(item.theme);
          facetTags.push(...(item.tags || []));
          if (item.author) facetAuthors.push(item.author);
          if (item.year) facetYears.push(item.year);
          if (item.score) facetScore.push(item.score);
        }
        return {
          indices,
          facets: {
            rq: countValues(facetRq),
            evidence: countValues(facetEvidence),
            theme: countValues(facetTheme),
            tags: countValues(facetTags),
            authors: countValues(facetAuthors),
            years: countValues(facetYears),
            score: countValues(facetScore)
          }
        };
      };
      self.onmessage = (event) => {
        const msg = event.data || {};
        if (msg.type === "init_sections") {
          sections = buildSectionCache(msg.items || []);
          return;
        }
        if (msg.type === "init_batches") {
          batches = buildBatchCache(msg.items || []);
          return;
        }
        if (msg.type === "filter_sections") {
          const result = filterSections(msg.filters || {});
          self.postMessage({ type: "sections_result", sessionId: msg.sessionId, requestId: msg.requestId, ...result });
          return;
        }
        if (msg.type === "filter_batches") {
          const result = filterBatches(msg.filters || {});
          self.postMessage({ type: "batches_result", sessionId: msg.sessionId, requestId: msg.requestId, ...result });
        }
      };
    `;
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.addEventListener("error", () => URL.revokeObjectURL(url));
    return worker;
  } catch {
    return null;
  }
}

function resolveCorpusRunPath(state: AnalyseState): string {
  const baseDir = (state.baseDir || "").trim();
  if (baseDir) return baseDir;
  const sectionsRoot = (state.sectionsRoot || "").trim();
  if (!sectionsRoot) return "";
  const trimmed = sectionsRoot.replace(/[\\/](sections)[\\/]?$/, "");
  return trimmed || sectionsRoot;
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
  container.removeAttribute("style");
  container.classList.add("analyse-sections-page");
  const isCorpus = options?.source === "corpus";
  const isBatchMode = isCorpus || round === "r1";

  const runPath = isCorpus ? resolveCorpusRunPath(state) : state.activeRunPath || "";
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
  const itemPdfCache = new Map<string, string>();
  let itemPdfCacheBuilt = false;
  const dqEntryCache = new Map<string, unknown>();
  const selectedSectionIds = new Set<string>();
  const readStatus = loadReadStatus(round, state.activeRunId);
  let cachedSectionIds = new Set<string>();
  let filteredViews: SectionView[] = [];

  const workerSessionId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const filterWorker = createFilterWorker();
  let sectionRequestId = 0;
  let batchRequestId = 0;

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
  filtersPanel.className = "panel analyse-panel analyse-filters-panel";

  if (panel1Host) {
    panel1Host.innerHTML = "";
    panel1Host.appendChild(filtersPanel);
  } else {
    container.appendChild(filtersPanel);
  }

  const list = document.createElement("div");
  list.className = isBatchMode
    ? "analyse-sections-list analyse-sections-list--batch"
    : "analyse-sections-list analyse-sections-list--grid";
  container.appendChild(list);

  if (!isBatchMode && panel3Host) {
    panel3Host.innerHTML = "";
    previewPanel = document.createElement("div");
    previewPanel.className = "panel analyse-panel analyse-preview-panel";
    panel3Host.appendChild(previewPanel);
  }

  const status = document.createElement("div");
  status.className = "status-bar";
  container.appendChild(status);

  if (filterWorker) {
    filterWorker.onmessage = (event: MessageEvent) => {
      const msg = event.data as any;
      if (!msg || msg.sessionId !== workerSessionId) return;
      if (msg.type === "sections_result" && msg.requestId === sectionRequestId) {
        const indices = (msg.indices || []) as number[];
        const facets = (msg.facets || {}) as Record<string, Record<string, number>>;
        filteredViews = indices.map((i) => sectionViews[i]).filter(Boolean);
        renderSectionFilters(facets);
        renderSectionList(filteredViews);
        emitSectionsState({ filtered: filteredViews.map((v) => v.section) });
      }
      if (msg.type === "batches_result" && msg.requestId === batchRequestId) {
        const indices = (msg.indices || []) as number[];
        const facets = (msg.facets || {}) as Record<string, Record<string, number>>;
        const filteredPayloads = indices.map((i) => batchViews[i]).filter(Boolean);

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
      }
    };
  }

  const renderSectionFilters = (facets: Record<string, Record<string, number>>) => {
    filtersPanel.innerHTML = "";
    currentPage = 0;

    const controls = document.createElement("div");
    controls.className = "control-row";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search in text, citations & tags…";
    search.value = sectionFilters.search;
    const onSearch = debounce(() => {
      sectionFilters.search = search.value;
      applySectionFilters();
    }, 180);
    search.addEventListener("input", onSearch);
    controls.appendChild(search);
    filtersPanel.appendChild(controls);

    const contains = document.createElement("input");
    contains.type = "search";
    contains.placeholder = "Tag contains…";
    contains.value = sectionFilters.tagContains;
    const onContains = debounce(() => {
      sectionFilters.tagContains = contains.value;
      applySectionFilters();
    }, 180);
    contains.addEventListener("input", onContains);
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
    currentPage = 0;

    const controls = document.createElement("div");
    controls.className = "control-row";
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search in text, citations & tags…";
    search.value = batchFilters.search;
    const onSearch = debounce(() => {
      batchFilters.search = search.value;
      applyBatchFilters();
    }, 180);
    search.addEventListener("input", onSearch);
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
    const baseTitle = section.title || section.id;
    const normalizedHtml = (section.html || "<p><em>No section HTML.</em></p>").replace(/id=["']section-title["']/gi, "");
    const stripLeadingDuplicateHeadings = (html: string, title: string) => {
      const normTitle = (title || "").trim().replace(/\s+/g, " ").toLowerCase();
      if (!normTitle) return html;
      const tmp = document.createElement("div");
      tmp.innerHTML = html;
      while (tmp.firstElementChild) {
        const first = tmp.firstElementChild as HTMLElement;
        if (!/^H[1-4]$/.test(first.tagName)) break;
        const t = (first.textContent || "").trim().replace(/\s+/g, " ").toLowerCase();
        if (t && t === normTitle) {
          first.remove();
          continue;
        }
        break;
      }
      return tmp.innerHTML;
    };
    const cleanedHtml = stripLeadingDuplicateHeadings(normalizedHtml, baseTitle);
    const body = document.createElement("div");
    body.className = "preview-content academic-section__body";
    body.innerHTML = `
      <h4>${baseTitle}</h4>
      ${section.route ? `<p class="academic-section__route">${section.route}</p>` : ""}
      ${cleanedHtml}
    `;
    body.addEventListener("click", (ev) => {
      const target = ev.target as HTMLElement | null;
      if (target && target.tagName === "A") {
        const href = (target as HTMLAnchorElement).href;
        if (href) {
          ev.preventDefault();
          const dqid = extractDqid(href, target, section);
          const open = async () => {
            const key = dqid ? dqid.trim().toLowerCase() : undefined;
            let payload: unknown = key ? (dqEntryCache.get(key) ?? dqLookup[key]) : undefined;
            if (key && payload === undefined) {
              const fetched = await getDirectQuotes(runPath, [key]);
              dqLookupPath = dqLookupPath || fetched.path || null;
              const entry = fetched.entries?.[key];
              if (entry !== undefined) {
                dqEntryCache.set(key, entry);
                payload = entry;
              }
            }
            const normalizedPayload = (() => {
              if (payload === undefined || payload === null) return undefined;
              if (typeof payload === "string") {
                return { direct_quote: payload };
              }
              if (typeof payload === "object" && !Array.isArray(payload)) {
                return payload as Record<string, unknown>;
              }
              return { direct_quote: String(payload) };
            })();
            const itemKey = extractItemKey(href, target);
            if (normalizedPayload) {
              const meta = (section.meta as Record<string, unknown>) || {};
              const pdf = (normalizedPayload as any).pdf_path || (normalizedPayload as any).pdf || meta.pdf_path || meta.pdf;
              if (pdf) {
                (normalizedPayload as any).pdf_path = pdf;
              }
              const page = (normalizedPayload as any).page ?? meta.page;
              if (page !== undefined) {
                (normalizedPayload as any).page = page;
              }
              if (!(normalizedPayload as any).item_key && itemKey) {
                (normalizedPayload as any).item_key = itemKey;
              }
              if (!pdf) {
                const resolved = await getPdfForItemKey(itemKey);
                if (resolved) {
                  (normalizedPayload as any).pdf_path = resolved;
                }
              }
            }
            const detail = {
              href,
              sectionId: section.id,
              route: section.route,
              meta: section.meta,
              title: section.title,
              dqid: key,
              payload: normalizedPayload,
              lookupPath: dqLookupPath
            };
            console.info("[analyse][preview][anchor-click]", detail);
            panel.dispatchEvent(new CustomEvent("analyse-open-pdf", { bubbles: true, detail }));
          };
          void open();
        }
      }
    });
    panel.appendChild(body);
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

  const extractItemKey = (href: string, node: HTMLElement): string | undefined => {
    const pick = (val?: string | null) => {
      const t = (val || "").trim();
      return t || undefined;
    };
    const attr =
      pick(node.getAttribute("data-key")) ||
      pick(node.getAttribute("data-item-key")) ||
      pick((node as HTMLAnchorElement).dataset?.key) ||
      pick((node as HTMLAnchorElement).dataset?.itemKey);
    if (attr) return attr;
    const hrefStr = href || "";
    if (/^[A-Z0-9]{6,12}$/.test(hrefStr)) {
      return hrefStr;
    }
    return undefined;
  };

  const getPdfForItemKey = async (itemKey?: string): Promise<string | undefined> => {
    if (!itemKey) return undefined;
    const direct = itemPdfCache.get(itemKey) || itemPdfCache.get(itemKey.toLowerCase());
    if (direct) return direct;
    if (itemPdfCacheBuilt) return undefined;
    itemPdfCacheBuilt = true;
    try {
      const batchData = await loadBatches(runPath);
      batchData.forEach((batch) => {
        batch.payloads.forEach((payload) => {
          const raw = payload as Record<string, unknown>;
          const key = String(raw.item_key ?? raw.itemKey ?? "").trim();
          if (!key) return;
          const pdf = String(raw.pdf_path ?? raw.pdf ?? "").trim();
          if (!pdf) return;
          itemPdfCache.set(key, pdf);
          itemPdfCache.set(key.toLowerCase(), pdf);
        });
      });
    } catch {
      // ignore lookup failures
    }
    return itemPdfCache.get(itemKey) || itemPdfCache.get(itemKey.toLowerCase());
  };

  let renderToken = 0;
  let pageSize = 10;
  let currentPage = 0;
  let remotePagerMode = false;
  let remotePagerHasMore = false;
  let remotePagerOffset = 0;

  const clampPage = (total: number) => {
    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    if (currentPage > maxPage) currentPage = maxPage;
    if (currentPage < 0) currentPage = 0;
  };

  const buildPager = (total: number, onChange: () => void): HTMLElement => {
    clampPage(total);
    const wrap = document.createElement("div");
    wrap.className = "control-row";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "space-between";
    wrap.style.gap = "10px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.gap = "8px";
    left.style.alignItems = "center";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "ribbon-button ghost";
    prev.textContent = "Prev";
    prev.disabled = currentPage === 0;
    prev.addEventListener("click", () => {
      if (currentPage === 0) return;
      currentPage -= 1;
      onChange();
    });

    const maxPage = Math.max(0, Math.ceil(total / pageSize) - 1);
    const next = document.createElement("button");
    next.type = "button";
    next.className = "ribbon-button ghost";
    next.textContent = "Next";
    next.disabled = currentPage >= maxPage;
    next.addEventListener("click", () => {
      if (currentPage >= maxPage) return;
      currentPage += 1;
      onChange();
    });

    const info = document.createElement("div");
    info.className = "status-bar";
    const from = total === 0 ? 0 : currentPage * pageSize + 1;
    const to = Math.min(total, (currentPage + 1) * pageSize);
    info.textContent = `${from}-${to} of ${total}`;

    left.append(prev, next, info);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    const sizeLabel = document.createElement("span");
    sizeLabel.textContent = "Page size";
    sizeLabel.className = "status-bar";

    const size = document.createElement("select");
    size.className = "audio-select";
    [10, 25, 50, 100].forEach((value) => {
      const opt = document.createElement("option");
      opt.value = String(value);
      opt.textContent = String(value);
      size.appendChild(opt);
    });
    size.value = String(pageSize);
    size.addEventListener("change", () => {
      const parsed = Number(size.value);
      pageSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
      currentPage = 0;
      onChange();
    });

    right.append(sizeLabel, size);
    wrap.append(left, right);
    return wrap;
  };

  const buildRemotePager = (count: number, onChange: () => void): HTMLElement => {
    const wrap = document.createElement("div");
    wrap.className = "control-row";
    wrap.style.alignItems = "center";
    wrap.style.justifyContent = "space-between";
    wrap.style.gap = "10px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.gap = "8px";
    left.style.alignItems = "center";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className = "ribbon-button ghost";
    prev.textContent = "Prev";
    prev.disabled = currentPage === 0;
    prev.addEventListener("click", () => {
      if (currentPage === 0) return;
      currentPage -= 1;
      onChange();
    });

    const next = document.createElement("button");
    next.type = "button";
    next.className = "ribbon-button ghost";
    next.textContent = "Next";
    next.disabled = !remotePagerHasMore;
    next.addEventListener("click", () => {
      if (!remotePagerHasMore) return;
      currentPage += 1;
      onChange();
    });

    const info = document.createElement("div");
    info.className = "status-bar";
    const from = count === 0 ? 0 : remotePagerOffset + 1;
    const to = remotePagerOffset + count;
    info.textContent = `${from}-${to}${remotePagerHasMore ? "+" : ""}`;

    left.append(prev, next, info);

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "8px";
    right.style.alignItems = "center";

    const sizeLabel = document.createElement("span");
    sizeLabel.textContent = "Page size";
    sizeLabel.className = "status-bar";

    const size = document.createElement("select");
    size.className = "audio-select";
    [10, 25, 50, 100].forEach((value) => {
      const opt = document.createElement("option");
      opt.value = String(value);
      opt.textContent = String(value);
      size.appendChild(opt);
    });
    size.value = String(pageSize);
    size.addEventListener("change", () => {
      const parsed = Number(size.value);
      pageSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
      currentPage = 0;
      onChange();
    });

    right.append(sizeLabel, size);
    wrap.append(left, right);
    return wrap;
  };
  const renderSectionList = (views: SectionView[]) => {
    const token = (renderToken += 1);
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

    const renderPage = () => {
      const reload = (renderSectionList as any).__remoteReload as (() => void) | undefined;
      if (remotePagerMode && typeof reload === "function") {
        reload();
        return;
      }
      renderSectionList(views);
    };
    const pageViews = remotePagerMode ? views : (() => {
      list.appendChild(buildPager(views.length, renderPage));
      const startIdx = currentPage * pageSize;
      const endIdx = Math.min(views.length, startIdx + pageSize);
      return views.slice(startIdx, endIdx);
    })();
    if (remotePagerMode) {
      list.appendChild(buildRemotePager(pageViews.length, renderPage));
    }

    const chunkSize = 40;
    let idx = 0;
    const sentinel = document.createElement("div");
    sentinel.style.height = "1px";
    const sentinelObserver = "IntersectionObserver" in window
      ? new IntersectionObserver(
          (entries) => {
            if (token !== renderToken) return;
            if (entries.some((entry) => entry.isIntersecting)) {
              renderChunk();
            }
          },
          { root: list, rootMargin: "600px 0px", threshold: 0.01 }
        )
      : null;

    const buildCard = (view: SectionView) => {
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
      return card;
    };

    const renderChunk = () => {
      if (token !== renderToken) return;
      const frag = document.createDocumentFragment();
      const end = Math.min(idx + chunkSize, pageViews.length);
      for (; idx < end; idx += 1) {
        frag.appendChild(buildCard(pageViews[idx]));
      }
      list.appendChild(frag);
      if (idx < pageViews.length) {
        if (!sentinel.isConnected) list.appendChild(sentinel);
        if (sentinelObserver) sentinelObserver.observe(sentinel);
        else scheduleIdle(renderChunk);
      } else if (sentinel.isConnected) {
        sentinel.remove();
      }
    };

    renderChunk();
  };

  const renderBatchList = (records: Array<{ batch: BatchRecord; payloads: BatchPayloadView[] }>) => {
    const token = (renderToken += 1);
    list.innerHTML = "";
    status.textContent = `${records.length} batches`;
    if (records.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No batches matched the current filters.";
      list.appendChild(empty);
      return;
    }

    const renderPage = () => renderBatchList(records);
    list.appendChild(buildPager(records.length, renderPage));

    const startIdx = currentPage * pageSize;
    const endIdx = Math.min(records.length, startIdx + pageSize);
    const pageRecords = records.slice(startIdx, endIdx);

    let observer: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const target = entry.target as HTMLElement;
            const render = (target as any).__renderPayloads as (() => void) | undefined;
            if (render) {
              render();
              (target as any).__renderPayloads = null;
              observer?.unobserve(target);
            }
          });
        },
        { root: list, rootMargin: "400px 0px", threshold: 0.01 }
      );
    }

    const chunkSize = 10;
    let idx = 0;

    const buildCard = (batch: BatchRecord, payloads: BatchPayloadView[]) => {
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

      const payloadContainer = document.createElement("div");
      card.appendChild(payloadContainer);

      const renderPayloads = () => {
        if (payloadContainer.childElementCount) return;
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

          payloadContainer.appendChild(block);
        });
      };

      (card as any).__renderPayloads = renderPayloads;
      if (observer) {
        observer.observe(card);
      } else {
        renderPayloads();
      }

      return card;
    };

    const renderChunk = () => {
      if (token !== renderToken) return;
      const frag = document.createDocumentFragment();
      const end = Math.min(idx + chunkSize, pageRecords.length);
      for (; idx < end; idx += 1) {
        const record = pageRecords[idx];
        frag.appendChild(buildCard(record.batch, record.payloads));
      }
      list.appendChild(frag);
      if (idx < pageRecords.length) {
        scheduleIdle(renderChunk);
      }
    };

    scheduleIdle(renderChunk);
  };

  const applySectionFilters = () => {
    if (remotePagerMode) {
      const reload = (renderSectionList as any).__remoteReload as (() => void) | undefined;
      if (reload) reload();
      return;
    }
    const term = sectionFilters.search.trim().toLowerCase();
    const tagTerm = sectionFilters.tagContains.trim().toLowerCase();

    if (filterWorker) {
      sectionRequestId += 1;
      filterWorker.postMessage({
        type: "filter_sections",
        sessionId: workerSessionId,
        requestId: sectionRequestId,
        filters: {
          search: term,
          tagContains: tagTerm,
          tags: Array.from(sectionFilters.tags),
          gold: Array.from(sectionFilters.gold),
          rq: Array.from(sectionFilters.rq),
          route: Array.from(sectionFilters.route),
          evidence: Array.from(sectionFilters.evidence),
          potential: Array.from(sectionFilters.potential),
        },
      });
      return;
    }

    scheduleIdle(() => {
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
    });
  };

  const applyBatchFilters = () => {
    const term = batchFilters.search.trim().toLowerCase();
    if (filterWorker) {
      batchRequestId += 1;
      filterWorker.postMessage({
        type: "filter_batches",
        sessionId: workerSessionId,
        requestId: batchRequestId,
        filters: {
          search: term,
          rq: Array.from(batchFilters.rq),
          evidence: Array.from(batchFilters.evidence),
          theme: Array.from(batchFilters.theme),
          tags: Array.from(batchFilters.tags),
          authors: Array.from(batchFilters.authors),
          years: Array.from(batchFilters.years),
          score: Array.from(batchFilters.score),
        },
      });
      return;
    }
    scheduleIdle(() => {
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
    });
  };

  const loadData = async () => {
    status.textContent = isBatchMode ? "Loading batches..." : "Loading sections...";
    try {
      if (isBatchMode) {
        remotePagerMode = false;
        const t0 = performance.now();
        batches = await loadBatches(runPath);
        batchViews = buildBatchPayloadViews(batches);
        if (filterWorker) {
          filterWorker.postMessage({
            type: "init_batches",
            sessionId: workerSessionId,
            items: batchViews.map((view, idx) => ({
              idx,
              batchId: view.batch.id,
              rq: view.rq,
              theme: view.theme,
              evidence: view.evidence,
              tags: view.tags,
              author: view.author,
              year: view.year,
              score: view.score,
              text: view.text,
            })),
          });
        }
        // Render initial facets immediately (so corpus has filters without waiting on the worker).
        const initialFacets = {
          rq: countValues(batchViews.map((v) => v.rq).filter(Boolean)),
          evidence: countValues(batchViews.map((v) => v.evidence).filter(Boolean)),
          theme: countValues(batchViews.map((v) => v.theme).filter(Boolean)),
          tags: countValues(batchViews.flatMap((v) => v.tags)),
          authors: countValues(batchViews.map((v) => v.author).filter(Boolean)),
          years: countValues(batchViews.map((v) => v.year).filter(Boolean)),
          score: countValues(batchViews.map((v) => v.score).filter(Boolean)),
        };
        renderBatchFilters(initialFacets);
        applyBatchFilters();
        status.textContent = `${batches.length} batches loaded`;
        const elapsed = Math.round(performance.now() - t0);
        console.info("[analyse][perf][batches-load]", { ms: elapsed, count: batches.length });
        if (elapsed > 2000) {
          console.warn("[analyse][perf][batches-load][slow]", { ms: elapsed, count: batches.length });
        }
        scheduleIdle(() => {
          void loadSections(runPath, "r2");
          void loadSections(runPath, "r3");
        });
      } else {
        remotePagerMode = true;

        const loadPage = async () => {
          const offset = currentPage * pageSize;
          remotePagerOffset = offset;
          const t0 = performance.now();
          const queryPayload = {
            search: sectionFilters.search,
            tagContains: sectionFilters.tagContains,
            tags: Array.from(sectionFilters.tags),
            gold: Array.from(sectionFilters.gold),
            rq: Array.from(sectionFilters.rq),
            route: Array.from(sectionFilters.route),
            evidence: Array.from(sectionFilters.evidence),
            potential: Array.from(sectionFilters.potential),
          };
          const result = await querySections(runPath, round, queryPayload, offset, pageSize);
          remotePagerHasMore = Boolean(result.hasMore);
          sections = result.sections;
          sectionViews = buildSectionViews(sections);
          filteredViews = sectionViews;
          renderSectionFilters(result.facets || {});
          renderSectionList(filteredViews);
          const elapsed = Math.round(performance.now() - t0);
          console.info("[analyse][perf][sections-query-load]", {
            round,
            ms: elapsed,
            offset,
            count: result.sections.length,
            hasMore: result.hasMore,
            totalMatches: result.totalMatches
          });
          status.textContent = `${result.totalMatches} matches (showing ${result.sections.length}, page ${currentPage + 1}${result.hasMore ? "" : ", last"})`;
          emitSectionsState({ filtered: filteredViews.map((v) => v.section) });
        };

        (renderSectionList as any).__remoteReload = () => void loadPage();
        await loadPage();

        // Avoid loading the full direct_quote_lookup.json into the renderer for very large corpora.
        // We fetch per-id entries over IPC on-demand during anchor clicks.
        dqLookup = {};
        dqLookupPath = null;
      }
    } catch (error) {
      console.error(error);
      status.textContent = "Failed to load data.";
    }
  };

  void loadData();
}
