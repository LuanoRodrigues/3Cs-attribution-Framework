import { getHostContract, type HostContract } from "../host_contract.ts";
import { debugInfo, debugWarn } from "../../utils/debug.ts";

export type ReferenceItem = {
  itemKey: string;
  title?: string;
  author?: string;
  year?: string;
  url?: string;
  note?: string;
  source?: string;
  dqid?: string;
  // Optional full CSL-JSON for citeproc. When present, this is used as-is
  // (with id forced to itemKey) to produce rich CSL-compliant rendering.
  csl?: any;
};

export type ReferencesLibrary = {
  itemsByKey: Record<string, ReferenceItem>;
  itemsByDqid: Record<string, ReferenceItem>;
  updatedAt: string;
};

const LIBRARY_STORAGE_KEY = "leditor.references.library";
const LIBRARY_FILENAME = "references_library.json";
const LEGACY_FILENAME = "references.json";
const RECENT_STORAGE_KEY = "leditor.references.recent";
const RECENT_LIMIT = 8;

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
  // Preserve CSL-JSON payloads if they exist in the library file.
  // Common keys: "csl", "cslJson", or a raw CSL-JSON item with a "type".
  const cslCandidate =
    raw.csl && typeof raw.csl === "object"
      ? raw.csl
      : raw.cslJson && typeof raw.cslJson === "object"
        ? raw.cslJson
        : raw.type && typeof raw.type === "string"
          ? raw
          : null;
  if (cslCandidate && typeof cslCandidate === "object") {
    entry.csl = { ...(cslCandidate as any) };
  }
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
  if (!base) return LIBRARY_FILENAME;
  return `${base.replace(/[\\/]+$/, "")}/${LIBRARY_FILENAME}`;
};

const getLegacyPath = (host?: HostContract | null): string => {
  const base = host?.paths?.bibliographyDir?.trim() ?? "";
  if (!base) return LEGACY_FILENAME;
  return `${base.replace(/[\\/]+$/, "")}/${LEGACY_FILENAME}`;
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

export const getRecentReferenceKeys = (): string[] => {
  try {
    const raw = window.localStorage?.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value) => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
};

export const pushRecentReference = (itemKey: string): void => {
  const normalized = itemKey.trim();
  if (!normalized) return;
  const list = getRecentReferenceKeys().filter((key) => key !== normalized);
  list.unshift(normalized);
  const next = list.slice(0, RECENT_LIMIT);
  try {
    window.localStorage?.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
};

export const getRecentReferenceItems = (): ReferenceItem[] => {
  const library = getReferencesLibrarySync();
  const keys = getRecentReferenceKeys();
  return keys.map((key) => library.itemsByKey[key]).filter(Boolean) as ReferenceItem[];
};

const persistLibrary = (library: ReferencesLibrary): void => {
  try {
    window.localStorage?.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(library));
  } catch {
    // Ignore storage errors.
  }
};

const loadFromHost = async (): Promise<ReferencesLibrary | null> => {
  const host = window.leditorHost;
  if (!host?.readFile) return null;
  const contract = getHostContract();
  const candidates = [getLibraryPath(contract), getLegacyPath(contract)];
  for (const path of candidates) {
    const result = await host.readFile({ sourcePath: path });
    if (!result?.success || typeof result.data !== "string") {
      debugInfo("[References] library read miss", {
        path,
        bibliographyDir: contract.paths?.bibliographyDir,
        error: (result as any)?.error
      });
      continue;
    }
    try {
      const library = parseLibrary(JSON.parse(result.data));
      debugInfo("[References] library loaded", {
        path,
        count: libraryCount(library),
        updatedAt: library.updatedAt
      });
      return library;
    } catch (error) {
      debugWarn("[References] failed to parse library file", error);
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
    cachedLibrary = (fromHost && libraryCount(fromHost) > 0 ? fromHost : null) ?? fromStorage ?? buildEmptyLibrary();
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

export const upsertReferenceItems = (items: ReferenceItem[]): void => {
  if (!Array.isArray(items) || items.length === 0) return;
  const library = getReferencesLibrarySync();
  items.forEach((item) => {
    if (!item?.itemKey) return;
    library.itemsByKey[item.itemKey] = item;
    if (item.dqid) {
      library.itemsByDqid[item.dqid] = item;
    }
  });
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
