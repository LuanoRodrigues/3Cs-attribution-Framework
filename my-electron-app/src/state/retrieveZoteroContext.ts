import { commandInternal } from "../ribbon/commandDispatcher";
import type { BatchRecord } from "../analyse/types";

type ZoteroCreator = {
  name: string;
  creatorType?: string;
};

export type ZoteroProfile = { libraryId?: string; libraryType?: "user" | "group" | string };

export type ZoteroCollection = {
  key: string;
  name: string;
  parentKey?: string | null;
  version?: number;
  itemCount?: number;
  /**
   * Optional alias for parity with the legacy Zotero renderer.
   * Kept for display logic that references collection keys by name.
   */
  path?: string;
};

export type ZoteroItem = {
  key: string;
  title: string;
  authors?: string;
  version?: number;
  date?: string;
  year?: string;
  itemType?: string;
  doi?: string;
  url?: string;
  dateModified?: string;
  citationCount?: number;
  abstract?: string;
  publicationTitle?: string;
  containerTitle?: string;
  journalAbbreviation?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
  place?: string;
  rights?: string;
  series?: string;
  seriesTitle?: string;
  seriesNumber?: string;
  section?: string;
  edition?: string;
  numPages?: string;
  isbn?: string;
  issn?: string;
  archive?: string;
  archiveLocation?: string;
  callNumber?: string;
  libraryCatalog?: string;
  extra?: string;
  tags?: string[];
  collections?: string[];
  creators?: ZoteroCreator[];
  attachments?: number;
  pdfs?: number;
  hasPdf?: boolean;
  zoteroSelectUrl?: string;
  zoteroOpenPdfUrl?: string;
  firstPdfKey?: string;
  firstPdfTitle?: string;
  firstPdfPath?: string;
  notes?: number;
  annotations?: number;
};

export type RetrieveZoteroState = {
  workspaceMode: "zotero" | "batches";
  loadingTree: boolean;
  loadingItems: boolean;
  runningLoad: boolean;
  profile?: ZoteroProfile;
  collections: ZoteroCollection[];
  selectedCollectionKey?: string;
  activeTags: string[];
  items: ZoteroItem[];
  selectedItemKey?: string;
  status: string;
  error?: string;
};

const INITIAL_STATE: RetrieveZoteroState = {
  workspaceMode: "zotero",
  loadingTree: false,
  loadingItems: false,
  runningLoad: false,
  profile: undefined,
  collections: [],
  selectedCollectionKey: undefined,
  activeTags: [],
  items: [],
  selectedItemKey: undefined,
  status: "Ready.",
  error: undefined
};

const subscribers = new Set<(state: RetrieveZoteroState) => void>();
let state: RetrieveZoteroState = { ...INITIAL_STATE };
const batchItemsByCollection = new Map<string, ZoteroItem[]>();
let loadRequestToken = 0;

const notify = (): void => {
  subscribers.forEach((fn) => fn(state));
};

const setState = (patch: Partial<RetrieveZoteroState>): void => {
  state = { ...state, ...patch };
  notify();
};

const sortCollections = (collections: ZoteroCollection[]): ZoteroCollection[] => {
  return collections.slice().sort((a, b) => {
    const byName = String(a.name || "").localeCompare(String(b.name || ""));
    if (byName !== 0) return byName;
    return String(a.key || "").localeCompare(String(b.key || ""));
  });
};

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  return "";
};

const toMaybeNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    if (typeof value === "string") {
      return value
        .split(/[;,]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }
    return [];
  }
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object" && "tag" in (entry as { tag?: unknown })) {
        const tag = toStringValue((entry as { tag?: unknown }).tag);
        if (tag) return tag;
      }
      return "";
    })
    .filter((entry) => entry.length > 0);
};

const normalizeCreators = (value: unknown): ZoteroCreator[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const maybe = entry as { name?: unknown; firstName?: unknown; lastName?: unknown; creatorType?: unknown };
      const name = toStringValue(maybe.name) || `${toStringValue(maybe.firstName)} ${toStringValue(maybe.lastName)}`.trim();
      if (!name) return null;
      const creatorType = toStringValue(maybe.creatorType);
      return creatorType ? { name, creatorType } : { name };
    })
    .filter((entry): entry is ZoteroCreator => Boolean(entry && entry.name));
};

const creatorsToString = (value: unknown): string => {
  const creators = normalizeCreators(value);
  if (creators.length > 0) return creators.map((entry) => entry.name).filter(Boolean).join("; ");
  return "";
};

const normalizeItem = (raw: Record<string, unknown>): ZoteroItem => {
  return {
    key: String(raw.key || ""),
    title: toStringValue(raw.title || raw.name || "Untitled"),
    version: toMaybeNumber(raw.version),
    authors: (() => {
      if (typeof raw.authors === "string") return toStringValue(raw.authors);
      return creatorsToString((raw as { creators?: unknown }).creators);
    })(),
    date: toStringValue(raw.date),
    year: toStringValue(raw.year),
    itemType: toStringValue(raw.itemType),
    doi: toStringValue((raw as { doi?: unknown }).doi),
    url: toStringValue(raw.url),
    dateModified: toStringValue((raw as { dateModified?: unknown }).dateModified),
    citationCount: toMaybeNumber((raw as { citationCount?: unknown }).citationCount),
    abstract: toStringValue(raw.abstract),
    publicationTitle: toStringValue(raw.publicationTitle),
    containerTitle: toStringValue((raw as { containerTitle?: unknown }).containerTitle),
    journalAbbreviation: toStringValue((raw as { journalAbbreviation?: unknown }).journalAbbreviation),
    volume: toStringValue((raw as { volume?: unknown }).volume),
    issue: toStringValue((raw as { issue?: unknown }).issue),
    pages: toStringValue((raw as { pages?: unknown }).pages),
    publisher: toStringValue((raw as { publisher?: unknown }).publisher),
    place: toStringValue((raw as { place?: unknown }).place),
    rights: toStringValue((raw as { rights?: unknown }).rights),
    series: toStringValue((raw as { series?: unknown }).series),
    seriesTitle: toStringValue((raw as { seriesTitle?: unknown }).seriesTitle),
    seriesNumber: toStringValue((raw as { seriesNumber?: unknown }).seriesNumber),
    section: toStringValue((raw as { section?: unknown }).section),
    edition: toStringValue((raw as { edition?: unknown }).edition),
    numPages: toStringValue((raw as { numPages?: unknown }).numPages),
    isbn: toStringValue((raw as { isbn?: unknown }).isbn),
    issn: toStringValue((raw as { issn?: unknown }).issn),
    archive: toStringValue((raw as { archive?: unknown }).archive),
    archiveLocation: toStringValue((raw as { archiveLocation?: unknown }).archiveLocation),
    callNumber: toStringValue((raw as { callNumber?: unknown }).callNumber),
    libraryCatalog: toStringValue((raw as { libraryCatalog?: unknown }).libraryCatalog),
    extra: toStringValue((raw as { extra?: unknown }).extra),
    tags: normalizeStringArray((raw as { tags?: unknown }).tags),
    collections: normalizeStringArray((raw as { collections?: unknown }).collections),
    creators: normalizeCreators((raw as { creators?: unknown }).creators),
    attachments: toMaybeNumber((raw as { attachments?: unknown }).attachments),
    pdfs: toMaybeNumber((raw as { pdfs?: unknown }).pdfs),
    hasPdf: typeof (raw as { hasPdf?: unknown }).hasPdf === "boolean" ? Boolean((raw as { hasPdf?: unknown }).hasPdf) : undefined,
    zoteroSelectUrl: toStringValue((raw as { zoteroSelectUrl?: unknown }).zoteroSelectUrl),
    zoteroOpenPdfUrl: toStringValue((raw as { zoteroOpenPdfUrl?: unknown }).zoteroOpenPdfUrl),
    firstPdfKey: toStringValue((raw as { firstPdfKey?: unknown }).firstPdfKey),
    firstPdfTitle: toStringValue((raw as { firstPdfTitle?: unknown }).firstPdfTitle),
    firstPdfPath: toStringValue((raw as { firstPdfPath?: unknown }).firstPdfPath),
    notes: toMaybeNumber((raw as { notes?: unknown }).notes),
    annotations: toMaybeNumber((raw as { annotations?: unknown }).annotations)
  };
};

const toSingleLine = (value: unknown): string => {
  return String(value || "").replace(/\s+/g, " ").trim();
};

const textExcerpt = (value: unknown, max = 160): string => {
  const normalized = toSingleLine(value);
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
};

const normalizeBatchModeData = (
  records: BatchRecord[]
): { collections: ZoteroCollection[]; byCollection: Map<string, ZoteroItem[]> } => {
  const byCollection = new Map<string, ZoteroItem[]>();
  const collections: ZoteroCollection[] = [];
  const seenKeys = new Set<string>();
  records.forEach((record, batchIndex) => {
    const baseKey = String(record.id || `batch-${batchIndex + 1}`).trim() || `batch-${batchIndex + 1}`;
    let key = baseKey;
    let dedupe = 2;
    while (seenKeys.has(key)) {
      key = `${baseKey}-${dedupe++}`;
    }
    seenKeys.add(key);
    const displayName =
      toSingleLine(record.theme) ||
      toSingleLine(record.potentialTheme) ||
      toSingleLine(record.rqQuestion) ||
      `Batch ${batchIndex + 1}`;
    const payloads = Array.isArray(record.payloads) ? record.payloads : [];
    const items = payloads.map((payload, payloadIndex) => {
      const text = toSingleLine(payload?.text);
      const itemKey = toSingleLine(payload?.id) || `${key}::${payloadIndex + 1}`;
      const pageRaw = payload?.page;
      const page = typeof pageRaw === "number" ? pageRaw : Number(String(pageRaw || "").trim());
      const tags = Array.from(
        new Set(
          [toSingleLine(record.theme), toSingleLine(record.potentialTheme), toSingleLine(record.evidenceType)]
            .map((entry) => entry.trim())
            .filter(Boolean)
        )
      );
      return {
        key: itemKey,
        title: textExcerpt(text || payload?.id || "Untitled payload", 180),
        authors: toSingleLine(record.theme) || toSingleLine(record.potentialTheme) || "-",
        year: Number.isFinite(page) && page > 0 ? String(page) : "",
        itemType: toSingleLine(record.evidenceType) || "batch",
        publicationTitle: toSingleLine(record.rqQuestion) || toSingleLine(record.prompt) || "",
        abstract: text,
        tags,
        collections: [key],
        hasPdf: false,
        attachments: 0,
        pdfs: 0
      } as ZoteroItem;
    });
    byCollection.set(key, items);
    collections.push({
      key,
      name: displayName,
      parentKey: null,
      itemCount: items.length,
      path: key
    });
  });
  return { collections, byCollection };
};

const ensureSelectedCollection = (): string | undefined => {
  const current = state.selectedCollectionKey;
  if (current && state.collections.some((c) => c.key === current)) {
    return current;
  }
  return state.collections[0]?.key;
};

const getPrefix = (): string => {
  const libId = String(state.profile?.libraryId || "").trim();
  const libType = String(state.profile?.libraryType || "user").trim().toLowerCase();
  if (libType === "group" && libId) {
    return `groups/${libId}`;
  }
  return "library";
};

export const retrieveZoteroContext = {
  subscribe(fn: (next: RetrieveZoteroState) => void): () => void {
    subscribers.add(fn);
    fn(state);
    return () => subscribers.delete(fn);
  },

  getState(): RetrieveZoteroState {
    return state;
  },

  getSelectedCollection(): ZoteroCollection | undefined {
    return state.collections.find((c) => c.key === state.selectedCollectionKey);
  },

  getSelectedItem(): ZoteroItem | undefined {
    return state.items.find((item) => item.key === state.selectedItemKey);
  },

  selectCollection(collectionKey?: string): void {
    if (!collectionKey || collectionKey === state.selectedCollectionKey) return;
    if (state.workspaceMode === "batches") {
      const items = batchItemsByCollection.get(collectionKey) || [];
      setState({
        selectedCollectionKey: collectionKey,
        selectedItemKey: items[0]?.key,
        activeTags: [],
        items,
        loadingItems: false,
        status: `Loaded ${items.length} payloads from batch ${collectionKey}.`,
        error: undefined
      });
      return;
    }
    setState({ selectedCollectionKey: collectionKey, selectedItemKey: undefined, activeTags: [], items: [] });
    void this.loadItems(collectionKey);
  },

  setActiveTags(tags: string[]): void {
    const normalized = tags
      .map((tag) => String(tag || "").trim())
      .filter((tag) => tag.length > 0);
    setState({ activeTags: normalized });
  },

  selectItem(itemKey?: string): void {
    if (!itemKey) {
      setState({ selectedItemKey: undefined });
      return;
    }
    if (!state.items.some((item) => item.key === itemKey)) return;
    setState({ selectedItemKey: itemKey });
  },

  async loadTree(): Promise<void> {
    const token = ++loadRequestToken;
    batchItemsByCollection.clear();
    setState({ workspaceMode: "zotero", loadingTree: true, error: undefined, status: "Loading Zotero collections…" });
    const response = (await commandInternal("retrieve", "datahub_zotero_tree")) as any;
    if (token !== loadRequestToken) return;
    if (!response || response.status === "error") {
      setState({
        loadingTree: false,
        status: "Failed to load Zotero collections.",
        error: String(response?.message || "Zotero request failed.")
      });
      return;
    }

    const collections = Array.isArray(response.collections)
      ? sortCollections(
          response.collections
            .map((raw: Record<string, unknown>) => {
              const rawParent = String((raw as { parentKey?: unknown; parentCollection?: unknown; parent_collection?: unknown; }).parentKey || "");
              const parentKey = rawParent || String((raw as { parentCollection?: unknown }).parentCollection || "") ||
                (raw as { parent_collection?: unknown }).parent_collection || "";
              const path = toStringValue((raw as { path?: unknown }).path);
              return {
                key: String(raw.key || ""),
                name: String(raw.name || "Untitled"),
                parentKey: parentKey || null,
                version: toMaybeNumber((raw as { version?: unknown }).version),
                itemCount: toMaybeNumber((raw as { itemCount?: unknown }).itemCount),
                path: path || undefined
              } as ZoteroCollection;
            })
            .filter((c: ZoteroCollection) => c.key)
        )
      : [];

    const nextSelected =
      state.selectedCollectionKey && collections.some((c) => c.key === state.selectedCollectionKey)
        ? state.selectedCollectionKey
        : collections[0]?.key;

    setState({
      workspaceMode: "zotero",
      loadingTree: false,
      collections,
      selectedCollectionKey: nextSelected,
      profile: response.profile,
      status: `Loaded ${collections.length} collections.`,
      error: undefined
    });

    if (nextSelected) {
      await this.loadItems(nextSelected);
    }
  },

  async loadItems(collectionKey?: string): Promise<void> {
    if (state.workspaceMode === "batches") {
      const key = collectionKey || ensureSelectedCollection();
      const items = (key && batchItemsByCollection.get(key)) || [];
      setState({
        loadingItems: false,
        selectedCollectionKey: key,
        items,
        selectedItemKey: items[0]?.key,
        status: `Loaded ${items.length} payloads.`,
        error: undefined
      });
      return;
    }
    const key = collectionKey || ensureSelectedCollection();
    if (!key) {
      setState({ items: [], selectedItemKey: undefined, status: "No Zotero collections available." });
      return;
    }

    setState({ loadingItems: true, error: undefined, status: "Loading Zotero items…" });
    const response = (await commandInternal("retrieve", "datahub_zotero_items", { collectionKey: key })) as any;
    if (!response || response.status === "error") {
      setState({
        loadingItems: false,
        items: [],
        selectedItemKey: undefined,
        status: "Failed to load items.",
        error: String(response?.message || response?.error || "Zotero items request failed."),
        loadingTree: state.loadingTree,
      });
      return;
    }

    const items = Array.isArray(response.items)
      ? response.items.map((item: Record<string, unknown>) => normalizeItem(item)).filter((item: ZoteroItem) => item.key)
      : [];
    setState({
      loadingItems: false,
      selectedCollectionKey: key,
      items,
      selectedItemKey: items[0]?.key,
      status: `Loaded ${items.length} items.`,
      error: undefined
    });
  },

  async loadSelectedCollectionToDataHub(): Promise<void> {
    if (state.workspaceMode === "batches") {
      setState({ status: "Batches mode already shows persisted batched data." });
      return;
    }
    const collectionKey = state.selectedCollectionKey;
    if (!collectionKey) {
      setState({ status: "Select a collection first." });
      return;
    }

    setState({ runningLoad: true, status: "Loading selected collection into Data Hub…", error: undefined });
    const response = (await commandInternal("retrieve", "datahub_load_zotero", { collectionKey, cache: true })) as any;
    if (!response || response.status === "error") {
      setState({
        runningLoad: false,
        status: "Failed to load collection into Data Hub.",
        error: String(response?.message || response?.error || "Load failed.")
      });
      return;
    }

    setState({
      runningLoad: false,
      status: String(response.message || "Collection loaded into Data Hub."),
      error: undefined
    });

    document.dispatchEvent(
      new CustomEvent("retrieve:datahub-restore", {
        detail: {
          state: {
            sourceType: "zotero",
            collectionName: collectionKey,
            table: response.table,
            loadedAt: new Date().toISOString()
          }
        }
      })
    );
  },

  selectedCollectionOpenUrl(): string {
    const key = state.selectedCollectionKey;
    if (!key) return "";
    return `zotero://select/${getPrefix()}/collections/${key}`;
  },

  selectedItemOpenUrl(): string {
    const item = this.getSelectedItem();
    if (!item?.key) return "";
    return item.zoteroSelectUrl || `zotero://select/${getPrefix()}/items/${item.key}`;
  },

  async loadBatchesData(options?: { runPath?: string; baseDir?: string }): Promise<void> {
    const token = ++loadRequestToken;
    const bridge = window.analyseBridge?.data;
    if (!bridge) {
      if (token !== loadRequestToken) return;
      setState({
        workspaceMode: "batches",
        loadingTree: false,
        loadingItems: false,
        collections: [],
        items: [],
        selectedCollectionKey: undefined,
        selectedItemKey: undefined,
        status: "Analyse bridge unavailable; unable to load batches.",
        error: "Analyse bridge unavailable."
      });
      return;
    }

    setState({
      workspaceMode: "batches",
      loadingTree: true,
      loadingItems: true,
      status: "Loading persisted batches…",
      error: undefined
    });

    let runPath = toSingleLine(options?.runPath);
    const baseCandidates = [toSingleLine(options?.baseDir)].filter(Boolean);
    try {
      const defaultBaseDir = toSingleLine(await bridge.getDefaultBaseDir());
      if (defaultBaseDir) baseCandidates.push(defaultBaseDir);
    } catch {
      // ignore
    }

    if (!runPath) {
      for (const baseDir of baseCandidates) {
        if (!baseDir) continue;
        try {
          const discovered = await bridge.discoverRuns(baseDir);
          const withBatches = (discovered?.runs || []).filter((run) => run.hasBatches && String(run.path || "").trim());
          if (withBatches.length) {
            runPath = String(withBatches[0].path || "").trim();
            break;
          }
        } catch {
          // ignore and continue fallback chain
        }
      }
    }

    if (!runPath) {
      if (token !== loadRequestToken) return;
      setState({
        loadingTree: false,
        loadingItems: false,
        collections: [],
        items: [],
        selectedCollectionKey: undefined,
        selectedItemKey: undefined,
        status: "No persisted batches were found.",
        error: "No run with batches is available."
      });
      return;
    }

    let batches: BatchRecord[] = [];
    try {
      batches = (await bridge.loadBatches(runPath)) || [];
    } catch {
      batches = [];
    }
    const normalized = normalizeBatchModeData(batches);
    if (token !== loadRequestToken) return;
    batchItemsByCollection.clear();
    normalized.byCollection.forEach((items, key) => batchItemsByCollection.set(key, items));
    const selectedCollectionKey = normalized.collections[0]?.key;
    const items = (selectedCollectionKey && batchItemsByCollection.get(selectedCollectionKey)) || [];
    setState({
      workspaceMode: "batches",
      loadingTree: false,
      loadingItems: false,
      profile: undefined,
      collections: normalized.collections,
      selectedCollectionKey,
      activeTags: [],
      items,
      selectedItemKey: items[0]?.key,
      status: `Loaded ${normalized.collections.length} batches from ${runPath}.`,
      error: normalized.collections.length ? undefined : "No batch records in dataset."
    });
  }
};
