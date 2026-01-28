import { getHostContract, type HostContract } from "../host_contract.ts";

export type ReferenceItem = {
  itemKey: string;
  title?: string;
  author?: string;
  year?: string;
  url?: string;
  note?: string;
  dqid?: string;
};

export type ReferencesLibrary = {
  itemsByKey: Record<string, ReferenceItem>;
  itemsByDqid: Record<string, ReferenceItem>;
  updatedAt: string;
};

const LIBRARY_STORAGE_KEY = "leditor.references.library";
const LEGACY_LIBRARY_FILENAME = "references.json";

let cachedLibrary: ReferencesLibrary | null = null;
let loadPromise: Promise<ReferencesLibrary> | null = null;

const buildEmptyLibrary = (): ReferencesLibrary => ({
  itemsByKey: {},
  itemsByDqid: {},
  updatedAt: new Date().toISOString()
});

const normalizeItem = (raw: any): ReferenceItem | null => {
  if (!raw || typeof raw !== "object") return null;
  const itemKey = String(raw.itemKey ?? raw.id ?? raw.item_key ?? "").trim();
  if (!itemKey) return null;
  const dqid = typeof raw.dqid === "string" ? raw.dqid.trim() : undefined;
  const entry: ReferenceItem = { itemKey };
  if (typeof raw.title === "string") entry.title = raw.title;
  if (typeof raw.author === "string") entry.author = raw.author;
  if (typeof raw.year === "string") entry.year = raw.year;
  if (typeof raw.url === "string") entry.url = raw.url;
  if (typeof raw.note === "string") entry.note = raw.note;
  if (dqid) entry.dqid = dqid;
  return entry;
};

const rebuildIndexes = (items: ReferenceItem[]): ReferencesLibrary => {
  const itemsByKey: Record<string, ReferenceItem> = {};
  const itemsByDqid: Record<string, ReferenceItem> = {};
  for (const item of items) {
    itemsByKey[item.itemKey] = item;
    if (item.dqid) {
      itemsByDqid[item.dqid] = item;
    }
  }
  return {
    itemsByKey,
    itemsByDqid,
    updatedAt: new Date().toISOString()
  };
};

const libraryCount = (library: ReferencesLibrary | null | undefined): number => {
  if (!library) return 0;
  return Object.keys(library.itemsByKey || {}).length;
};

const parseLibrary = (raw: any): ReferencesLibrary => {
  if (!raw || typeof raw !== "object") return buildEmptyLibrary();
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem).filter(Boolean) : [];
  if (items.length) {
    return rebuildIndexes(items as ReferenceItem[]);
  }
  const itemsByKeyRaw = raw.itemsByKey && typeof raw.itemsByKey === "object" ? raw.itemsByKey : {};
  const itemsByKey: Record<string, ReferenceItem> = {};
  for (const [key, value] of Object.entries(itemsByKeyRaw)) {
    const normalized = normalizeItem({ itemKey: key, ...(value as object) });
    if (normalized) {
      itemsByKey[normalized.itemKey] = normalized;
    }
  }
  const itemsByDqid: Record<string, ReferenceItem> = {};
  for (const item of Object.values(itemsByKey)) {
    if (item.dqid) {
      itemsByDqid[item.dqid] = item;
    }
  }
  return {
    itemsByKey,
    itemsByDqid,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
  };
};

const getLibraryPath = (host?: HostContract | null): string => {
  const base = host?.paths?.bibliographyDir?.trim() ?? "";
  if (!base) return LEGACY_LIBRARY_FILENAME;
  return `${base.replace(/[\\/]+$/, "")}/${LEGACY_LIBRARY_FILENAME}`;
};

const getLegacyLibraryPath = (host?: HostContract | null): string => {
  const base = host?.paths?.bibliographyDir?.trim() ?? "";
  if (!base) return LEGACY_LIBRARY_FILENAME;
  return `${base.replace(/[\\/]+$/, "")}/${LEGACY_LIBRARY_FILENAME}`;
};

const loadFromStorage = (): ReferencesLibrary | null => {
  try {
    const raw = window.localStorage?.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return null;
    return parseLibrary(JSON.parse(raw));
  } catch {
    return null;
  }
};

const persistLibrary = (library: ReferencesLibrary): void => {
  try {
    window.localStorage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
  } catch {
    // Ignore storage errors.
  }
};

const loadFromBundledPublic = async (): Promise<ReferencesLibrary | null> => {
  try {
    const url = new URL("references.json", window.location.href);
    const res = await fetch(url.href);
    if (!res.ok) return null;
    const parsed = await res.json();
    return parseLibrary(parsed);
  } catch {
    return null;
  }
};

const loadFromHost = async (): Promise<ReferencesLibrary | null> => {
  const host = window.leditorHost;
  if (!host?.readFile) return null;
  const contract = getHostContract();
  const candidates = [getLegacyLibraryPath(contract)];
  for (const path of candidates) {
    const result = await host.readFile({ sourcePath: path });
    if (!result?.success || typeof result.data !== "string") {
      console.info("[References] library read miss", {
        path,
        bibliographyDir: contract.paths?.bibliographyDir,
        error: (result as any)?.error
      });
      continue;
    }
    try {
      const library = parseLibrary(JSON.parse(result.data));
      console.info("[References] library loaded", {
        path,
        count: libraryCount(library),
        updatedAt: library.updatedAt
      });
      return library;
    } catch (error) {
      console.warn("[References] failed to parse library file", error);
      return null;
    }
  }
  return null;
};

export const ensureReferencesLibrary = async (): Promise<ReferencesLibrary> => {
  if (cachedLibrary) return cachedLibrary;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const fromStorage = loadFromStorage();
    const fromHost = await loadFromHost();
    const fromBundled = !fromHost || libraryCount(fromHost) === 0 ? await loadFromBundledPublic() : null;
    cachedLibrary = (fromHost && libraryCount(fromHost) > 0 ? fromHost : null) ?? fromBundled ?? fromStorage ?? buildEmptyLibrary();
    persistLibrary(cachedLibrary);
    return cachedLibrary;
  })();
  return loadPromise;
};

export const refreshReferencesLibrary = async (): Promise<ReferencesLibrary> => {
  const fromHost = await loadFromHost();
  if (fromHost && libraryCount(fromHost) > 0) {
    cachedLibrary = fromHost;
    persistLibrary(cachedLibrary);
    loadPromise = Promise.resolve(cachedLibrary);
    return cachedLibrary;
  }
  const fromBundled = await loadFromBundledPublic();
  if (fromBundled && libraryCount(fromBundled) > 0) {
    cachedLibrary = fromBundled;
    persistLibrary(cachedLibrary);
    loadPromise = Promise.resolve(cachedLibrary);
    return cachedLibrary;
  }
  const fromStorage = loadFromStorage();
  cachedLibrary = fromStorage ?? cachedLibrary ?? buildEmptyLibrary();
  persistLibrary(cachedLibrary);
  loadPromise = Promise.resolve(cachedLibrary);
  return cachedLibrary;
};

export const getReferencesLibrarySync = (): ReferencesLibrary => {
  if (cachedLibrary) return cachedLibrary;
  const fromStorage = loadFromStorage();
  cachedLibrary = fromStorage ?? buildEmptyLibrary();
  return cachedLibrary;
};

export const upsertReferenceItem = (item: ReferenceItem): void => {
  const library = getReferencesLibrarySync();
  library.itemsByKey[item.itemKey] = item;
  if (item.dqid) {
    library.itemsByDqid[item.dqid] = item;
  }
  library.updatedAt = new Date().toISOString();
  cachedLibrary = library;
  persistLibrary(library);
};

export const resolveCitationTitle = (params: {
  dqid?: string | null;
  itemKey?: string | null;
  fallbackText?: string | null;
}): string | null => {
  const library = getReferencesLibrarySync();
  const dqid = typeof params.dqid === "string" ? params.dqid.trim() : "";
  const itemKey = typeof params.itemKey === "string" ? params.itemKey.trim() : "";
  const fromDqid = dqid ? library.itemsByDqid[dqid] : undefined;
  const fromKey = itemKey ? library.itemsByKey[itemKey] : undefined;
  const candidate = fromDqid ?? fromKey;
  if (candidate?.title) return candidate.title;
  if (candidate?.author || candidate?.year) {
    return [candidate.author, candidate.year].filter(Boolean).join(", ");
  }
  const fallback = typeof params.fallbackText === "string" ? params.fallbackText.trim() : "";
  return fallback || null;
};

export const getReferencesLibraryPath = (host?: HostContract | null): string =>
  getLibraryPath(host ?? getHostContract());
