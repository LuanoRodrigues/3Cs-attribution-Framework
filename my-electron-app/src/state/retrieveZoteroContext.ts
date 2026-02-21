import { commandInternal } from "../ribbon/commandDispatcher";

export type ZoteroProfile = { libraryId?: string; libraryType?: "user" | "group" | string };

export type ZoteroCollection = {
  key: string;
  name: string;
  parentKey?: string | null;
};

export type ZoteroItem = {
  key: string;
  title: string;
  authors?: string;
  date?: string;
  year?: string;
  itemType?: string;
  doi?: string;
  url?: string;
  abstract?: string;
  publicationTitle?: string;
  tags?: string[];
  collections?: string[];
  attachments?: number;
  pdfs?: number;
  hasPdf?: boolean;
  zoteroSelectUrl?: string;
  firstPdfKey?: string;
  firstPdfTitle?: string;
  firstPdfPath?: string;
  notes?: number;
  annotations?: number;
};

export type RetrieveZoteroState = {
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

const normalizeItem = (raw: Record<string, unknown>): ZoteroItem => {
  const normalizeStringArray = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => String(entry || "").trim())
      .filter((entry) => entry.length > 0);
  };
  return {
    key: String(raw.key || ""),
    title: String(raw.title || "Untitled"),
    authors: typeof raw.authors === "string" ? raw.authors : undefined,
    date: typeof raw.date === "string" ? raw.date : undefined,
    year: typeof raw.year === "string" ? raw.year : undefined,
    itemType: typeof raw.itemType === "string" ? raw.itemType : undefined,
    doi: typeof raw.doi === "string" ? raw.doi : undefined,
    url: typeof raw.url === "string" ? raw.url : undefined,
    abstract: typeof raw.abstract === "string" ? raw.abstract : undefined,
    publicationTitle: typeof raw.publicationTitle === "string" ? raw.publicationTitle : undefined,
    tags: normalizeStringArray(raw.tags),
    collections: normalizeStringArray(raw.collections),
    attachments: typeof raw.attachments === "number" ? raw.attachments : undefined,
    pdfs: typeof raw.pdfs === "number" ? raw.pdfs : undefined,
    hasPdf: typeof raw.hasPdf === "boolean" ? raw.hasPdf : undefined,
    zoteroSelectUrl: typeof raw.zoteroSelectUrl === "string" ? raw.zoteroSelectUrl : undefined,
    firstPdfKey: typeof raw.firstPdfKey === "string" ? raw.firstPdfKey : undefined,
    firstPdfTitle: typeof raw.firstPdfTitle === "string" ? raw.firstPdfTitle : undefined,
    firstPdfPath: typeof raw.firstPdfPath === "string" ? raw.firstPdfPath : undefined,
    notes: typeof raw.notes === "number" ? raw.notes : undefined,
    annotations: typeof raw.annotations === "number" ? raw.annotations : undefined
  };
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
    setState({ loadingTree: true, error: undefined, status: "Loading Zotero collections…" });
    const response = (await commandInternal("retrieve", "datahub_zotero_tree")) as any;
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
            .map((raw: Record<string, unknown>) => ({
              key: String(raw.key || ""),
              name: String(raw.name || "Untitled"),
              parentKey: typeof raw.parentKey === "string" ? raw.parentKey : null
            }))
            .filter((c: ZoteroCollection) => c.key)
        )
      : [];

    const nextSelected =
      state.selectedCollectionKey && collections.some((c) => c.key === state.selectedCollectionKey)
        ? state.selectedCollectionKey
        : collections[0]?.key;

    setState({
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
        error: String(response?.message || "Zotero items request failed.")
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
        error: String(response?.message || "Load failed.")
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
  }
};
