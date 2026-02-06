import { app, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";

import type {
  RetrievePaperSnapshot,
  RetrieveProviderId,
  RetrieveCitationNetwork,
  RetrieveCitationNetworkRequest,
  RetrieveSnowballRequest,
  RetrieveSaveRequest,
  RetrieveQuery,
  RetrieveRecord,
  RetrieveSearchResult
} from "../../shared/types/retrieve";
import type { DataHubTable } from "../../shared/types/dataHub";
import { GENERAL_KEYS, ZOTERO_KEYS } from "../../config/settingsKeys";
import { getAppDataPath, getSetting, setSetting } from "../../config/settingsFacade";
import { getSecretsVault } from "../../config/secretsVaultInstance";
import { getProviderSpec, mergeCosResults, type ProviderSearchResult } from "../services/retrieve/providers";
import { getCachedResult, setCachedResult } from "../services/retrieve/cache";
import { addTagToPaper, listTagsForPaper, removeTagFromPaper } from "../services/retrieve/tags_db";
import { buildCitationNetwork } from "../services/retrieve/citation_network";
import { fetchSemanticSnowball } from "../services/retrieve/snowball";
import { getUnpaywallEmail } from "../services/retrieve/providers";
import AdmZip from "adm-zip";
import { invokeDataHubExportExcel, invokeDataHubListCollections, invokeDataHubLoad } from "../services/dataHubBridge";
import {
  fetchZoteroCollectionItems,
  fetchZoteroCollectionItemsPreview,
  fetchZoteroCollectionCount,
  listZoteroCollections,
  listZoteroCollectionsCached,
  mergeTables,
  resolveZoteroCredentialsTs
} from "../services/retrieve/zotero";

const rateTracker = new Map<RetrieveProviderId, number>();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const throttle = async (providerId: RetrieveProviderId, rateMs?: number): Promise<void> => {
  if (!rateMs || rateMs <= 0) {
    return;
  }
  const last = rateTracker.get(providerId) ?? 0;
  const now = Date.now();
  const elapsed = now - last;
  if (elapsed < rateMs) {
    await sleep(rateMs - elapsed);
  }
  rateTracker.set(providerId, Date.now());
};

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const toStringOrUndefined = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return undefined;
};

const resolveZoteroCredentials = (): { libraryId: string; libraryType: string; apiKey: string } => {
  const libraryId =
    toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.libraryId)) ||
    toStringOrUndefined(process.env.ZOTERO_LIBRARY_ID) ||
    toStringOrUndefined(process.env.LIBRARY_ID);
  const libraryType =
    toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.libraryType)) ||
    toStringOrUndefined(process.env.ZOTERO_LIBRARY_TYPE) ||
    toStringOrUndefined(process.env.LIBRARY_TYPE) ||
    "user";
  if (!libraryId) {
    throw new Error("Zotero library ID is not configured in settings or .env (ZOTERO_LIBRARY_ID / LIBRARY_ID).");
  }
  let apiKey: string | undefined;
  try {
    apiKey = getSecretsVault().getSecret(ZOTERO_KEYS.apiKey);
  } catch {
    // vault might be locked; fall through to env
  }
  apiKey =
    apiKey ||
    toStringOrUndefined(process.env.ZOTERO_API_KEY) ||
    toStringOrUndefined(process.env.API_KEY) ||
    toStringOrUndefined(process.env.ZOTERO_KEY);
  if (!apiKey) {
    throw new Error("Zotero API key is not configured (settings, secrets vault, or .env ZOTERO_API_KEY/API_KEY).");
  }
  return { libraryId, libraryType, apiKey };
};

const resolveZoteroCollection = (payload?: Record<string, unknown>): string | undefined => {
  return (
    toStringOrUndefined(payload?.collectionName) ||
    toStringOrUndefined(getSetting<string>(GENERAL_KEYS.collectionName)) ||
    toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.lastCollection)) ||
    toStringOrUndefined(process.env.ZOTERO_COLLECTION) ||
    toStringOrUndefined(process.env.COLLECTION_NAME)
  );
};

const resolveDataHubCacheDir = (): string => {
  return path.join(app.getPath("userData"), "data-hub-cache");
};

const ensureDataHubLastMarker = (args: {
  source: { type: "file" | "zotero"; path?: string; collectionName?: string };
}): void => {
  const cacheDir = resolveDataHubCacheDir();
  const lastPath = path.join(cacheDir, "last.json");
  if (fs.existsSync(lastPath)) {
    return;
  }
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    // ignore
  }
  const payload = {
    version: 1,
    writtenAt: new Date().toISOString(),
    source: args.source
  };
  try {
    fs.writeFileSync(lastPath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {
    // ignore: marker is best-effort
  }
};

const findMostRecentCachedTable = async (
  cacheDir: string
): Promise<{ table: DataHubTable; cacheFilePath: string } | undefined> => {
  const ignoreNames = new Set([
    "references.json",
    "references_library.json",
    "references.used.json",
    "references_library.used.json",
    "last.json"
  ]);
  let entries: string[] = [];
  try {
    entries = await fs.promises.readdir(cacheDir);
  } catch {
    return undefined;
  }
  const candidates: Array<{ filePath: string; mtimeMs: number }> = [];
  for (const name of entries) {
    const lower = name.toLowerCase();
    if (!lower.endsWith(".json")) continue;
    if (ignoreNames.has(lower)) continue;
    const filePath = path.join(cacheDir, name);
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) continue;
      candidates.push({ filePath, mtimeMs: stat.mtimeMs });
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.filePath.localeCompare(b.filePath));
  for (const candidate of candidates) {
    try {
      const raw = await fs.promises.readFile(candidate.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const table = (parsed as any)?.table as DataHubTable | undefined;
      if (!table || !Array.isArray((table as any).columns) || !Array.isArray((table as any).rows)) continue;
      if ((table as any).columns.length <= 0 || (table as any).rows.length <= 0) continue;
      return { table, cacheFilePath: candidate.filePath };
    } catch {
      // ignore corrupt caches
    }
  }
  return undefined;
};

const ensureTablePayload = (payload?: Record<string, unknown>): DataHubTable => {
  const table = payload?.table as DataHubTable | undefined;
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new Error("Table payload is required.");
  }
  return table;
};

const normalizeCell = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return false;
};

const resolveNaTable = (
  table: DataHubTable,
  columns: string[] | undefined,
  replacement: string
): { table: DataHubTable; replaced: number } => {
  const columnSet = columns && columns.length > 0 ? new Set(columns) : null;
  const nextRows: Array<Array<unknown>> = [];
  let replaced = 0;
  table.rows.forEach((row) => {
    const nextRow = row.slice();
    nextRow.forEach((cell, idx) => {
      const colName = table.columns[idx];
      if (columnSet && !columnSet.has(colName)) {
        return;
      }
      if (normalizeCell(cell)) {
        nextRow[idx] = replacement;
        replaced += 1;
      }
    });
    nextRows.push(nextRow);
  });
  return { table: { columns: table.columns.slice(), rows: nextRows }, replaced };
};

const filterColumns = (table: DataHubTable, columns: string[]): DataHubTable => {
  const wanted = columns.map((name) => table.columns.indexOf(name)).filter((idx) => idx >= 0);
  if (wanted.length === 0) {
    throw new Error("No matching columns were found.");
  }
  const nextColumns = wanted.map((idx) => table.columns[idx]);
  const nextRows = table.rows.map((row) => wanted.map((idx) => row[idx]));
  return { columns: nextColumns, rows: nextRows };
};

const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/\"/g, "\"\"")}"`;
  }
  return text;
};

const stringifyCsv = (table: DataHubTable): string => {
  const lines: string[] = [];
  lines.push(table.columns.map((value) => escapeCsvValue(value)).join(","));
  table.rows.forEach((row) => {
    lines.push(row.map((value) => escapeCsvValue(value)).join(","));
  });
  return `${lines.join("\n")}\n`;
};

const normalizeQuery = (payload?: Record<string, unknown>): RetrieveQuery => {
  const base: RetrieveQuery = {
    query: toStringOrUndefined(payload?.query) ?? "",
    year_from: toNumberOrUndefined(payload?.year_from),
    year_to: toNumberOrUndefined(payload?.year_to),
    sort: typeof payload?.sort === "string" ? (payload.sort as RetrieveQuery["sort"]) : undefined,
    limit: toNumberOrUndefined(payload?.limit),
    cursor: toStringOrUndefined(payload?.cursor),
    offset: toNumberOrUndefined(payload?.offset),
    page: toNumberOrUndefined(payload?.page),
    author_contains: toStringOrUndefined(payload?.author_contains),
    venue_contains: toStringOrUndefined(payload?.venue_contains),
    only_doi: Boolean(payload?.only_doi),
    only_abstract: Boolean(payload?.only_abstract)
  };
  const providerId = typeof payload?.provider === "string" ? (payload.provider as RetrieveProviderId) : undefined;
  if (providerId) {
    base.provider = providerId;
  }
  return base;
};

const headerAuthSignature = (headers?: Record<string, unknown>): string => {
  if (!headers) return "";
  const authKeys = ["x-api-key", "x-els-apikey", "x-apikey", "authorization", "X-ApiKey", "X-ELS-APIKey"];
  const pairs: Array<[string, string]> = [];
  Object.entries(headers).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    const key = String(k).trim();
    if (!authKeys.includes(key) && !authKeys.includes(key.toLowerCase())) return;
    pairs.push([key.toLowerCase(), String(v)]);
  });
  if (!pairs.length) return "";
  return JSON.stringify(pairs.sort((a, b) => a[0].localeCompare(b[0])));
};

const executeProviderSearch = async (
  providerId: RetrieveProviderId,
  query: RetrieveQuery
): Promise<ProviderSearchResult> => {
  const spec = getProviderSpec(providerId);
  if (!spec) {
    return { records: [], total: 0 };
  }

  let authSig = "";
  const cached = getCachedResult(providerId, query);
  if (cached) {
    return cached;
  }

  if (spec.mergeSources?.length) {
    const children: Array<{ providerId: RetrieveProviderId; result: ProviderSearchResult }> = [];
    for (const child of spec.mergeSources) {
      try {
        const result = await executeProviderSearch(child, query);
        children.push({ providerId: child, result });
      } catch (error) {
        console.warn("[retrieve_ipc.ts][executeProviderSearch][debug] merge child failed", {
          providerId,
          child,
          error: error instanceof Error ? error.message : String(error)
        });
        children.push({ providerId: child, result: { records: [], total: 0 } });
      }
    }
    const merged = mergeCosResults(children);
    setCachedResult(providerId, query, merged, authSig);
    return merged;
  }

  if (!spec.buildRequest || !spec.parseResponse) {
    return { records: [], total: 0 };
  }

  const request = spec.buildRequest(query);
  if (!request) {
    return { records: [], total: 0 };
  }

  authSig = headerAuthSignature(request.headers as Record<string, unknown> | undefined);
  const cachedWithAuth = getCachedResult(providerId, query, authSig);
  if (cachedWithAuth) {
    return cachedWithAuth;
  }

  await throttle(providerId, spec.rateMs);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(request.url, {
        headers: request.headers ?? {}
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const snippet = bodyText ? bodyText.slice(0, 600) : "";
        console.error("[retrieve_ipc.ts][executeProviderSearch][debug] provider request failed", {
          providerId,
          attempt,
          status: response.status,
          statusText: response.statusText,
          url: request.url,
          hasApiKey: Boolean(
            (request.headers as Record<string, unknown> | undefined)?.["x-api-key"] ||
              (request.headers as Record<string, unknown> | undefined)?.["X-ApiKey"] ||
              (request.headers as Record<string, unknown> | undefined)?.["X-ELS-APIKey"]
          ),
          body: snippet
        });

        if (response.status === 429 && attempt < 2) {
          const retryHeader = response.headers.get("retry-after");
          const retrySeconds = retryHeader ? Number(retryHeader) : NaN;
          const delayMs = Number.isFinite(retrySeconds) ? Math.max(250, retrySeconds * 1000) : 800 * (attempt + 1);
          console.warn("[retrieve_ipc.ts][executeProviderSearch][debug] rate limited, retrying", {
            providerId,
            attempt,
            delayMs
          });
          await sleep(delayMs);
          continue;
        }

        if (providerId === "semantic_scholar" && response.status === 403) {
          throw new Error(
            "Semantic Scholar request was forbidden (403). Add a Semantic Scholar key in Settings → Academic database keys (or set SEMANTIC_API/SEMANTIC_SCHOLAR_API_KEY)."
          );
        }
        if (providerId === "semantic_scholar" && response.status === 429) {
          throw new Error(
            "Semantic Scholar rate-limited this app (429). Add a Semantic Scholar key in Settings → Academic database keys and retry, or wait and try again."
          );
        }

        throw new Error(`Retrieve provider ${providerId} failed (${response.status} ${response.statusText}).`);
      }
      const payload = await response.json();
      const parsed = spec.parseResponse(payload);
      setCachedResult(providerId, query, parsed, authSig);
      return parsed;
    } catch (error) {
      if (attempt < 2) {
        console.warn("[retrieve_ipc.ts][executeProviderSearch][debug] request attempt failed, retrying", {
          providerId,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await sleep(600 * (attempt + 1));
        continue;
      }
      console.error("Retrieve provider error", providerId, error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  return { records: [], total: 0 };
};

export const executeRetrieveSearch = async (query: RetrieveQuery): Promise<RetrieveSearchResult> => {
  const provider = query.provider ?? "semantic_scholar";
  const normalized: RetrieveQuery = {
    ...query,
    provider
  };
  const spec = getProviderSpec(provider);
  if (!spec) {
    return { provider, items: [], total: 0 };
  }
  const result = await executeProviderSearch(provider, normalized);
  const filtered = applyRecordFilters(result.records, normalized);
  const limited =
    typeof normalized.limit === "number" && normalized.limit > 0
      ? filtered.slice(0, Math.min(normalized.limit, 1000))
      : filtered;
  return {
    provider,
    items: limited,
    total: result.total,
    nextCursor: result.nextCursor
  };
};

const applyRecordFilters = (records: RetrieveRecord[], query: RetrieveQuery): RetrieveRecord[] => {
  let next = records ?? [];
  if (query.only_doi) {
    next = next.filter((r) => !!r.doi);
  }
  if (query.only_abstract) {
    next = next.filter((r) => !!(r.abstract && r.abstract.trim()));
  }
  if (query.author_contains) {
    const needle = query.author_contains.toLowerCase();
    next = next.filter((r) => (r.authors || []).some((a) => a.toLowerCase().includes(needle)));
  }
  if (query.venue_contains) {
    const needle = query.venue_contains.toLowerCase();
    next = next.filter((r) => {
      const venue = (r as any).venue || (r as any).journal;
      return typeof venue === "string" && venue.toLowerCase().includes(needle);
    });
  }
  return next;
};

export const handleRetrieveCommand = async (
  action: string,
  payload?: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  if (action === "fetch_from_source") {
    const query = normalizeQuery(payload);
    if (!query.query) {
      return { status: "error", message: "Query text is required" };
    }
    const search = await executeRetrieveSearch(query);
    return {
      status: "ok",
      provider: search.provider,
      items: search.items,
      total: search.total,
      nextCursor: search.nextCursor
    };
  }
  if (action === "datahub_load_zotero") {
    const collectionName = resolveZoteroCollection(payload);
    const collectionKey = toStringOrUndefined(payload?.collectionKey);
    const cache = payload?.cache !== false;
    let credentials: { libraryId: string; libraryType: "user" | "group"; apiKey: string };
    try {
      credentials = resolveZoteroCredentialsTs();
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "Zotero credentials unavailable." };
    }
    const target = collectionKey || collectionName;
    if (!target) {
      return { status: "error", message: "Collection key or name is required to load Zotero items." };
    }
    // store last collection as NAME for UI, not key
    try {
      const collections = await listZoteroCollectionsCached(credentials as any, resolveDataHubCacheDir());
      const match =
        collections.find((c) => c.key === target) ||
        collections.find((c) => c.name === target) ||
        collections.find(
          (c) => c.name.replace(/\s+/g, "").toLowerCase() === target.replace(/\s+/g, "").toLowerCase()
        );
      if (!match) {
        return { status: "error", message: `Collection '${target}' not found.`, available: collections.slice(0, 10) };
      }
      const cacheDir = resolveDataHubCacheDir();
      const { table, cached } = await fetchZoteroCollectionItems(credentials as any, match.key, undefined, cacheDir, cache);
      setSetting(ZOTERO_KEYS.lastCollection, match.name || match.key);
      ensureDataHubLastMarker({ source: { type: "zotero", collectionName: match.name || match.key } });
      return {
        status: "ok",
        table,
        cached,
        message: cached ? "Loaded from cache." : "Loaded from Zotero.",
        source: { type: "zotero", collectionName: match.name || match.key }
      };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_list_collections") {
    try {
      const creds = resolveZoteroCredentialsTs();
      const collections = await listZoteroCollectionsCached(creds as any, resolveDataHubCacheDir());
      return { status: "ok", collections, profile: { libraryId: creds.libraryId, libraryType: creds.libraryType } };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_zotero_tree") {
    try {
      const creds = resolveZoteroCredentialsTs();
      const cacheDir = resolveDataHubCacheDir();
      const collections = await listZoteroCollectionsCached(creds as any, cacheDir);
      return { status: "ok", collections, profile: { libraryId: creds.libraryId, libraryType: creds.libraryType } };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_zotero_items") {
    const target = toStringOrUndefined(payload?.collectionKey) || toStringOrUndefined(payload?.collectionName);
    if (!target) {
      return { status: "error", message: "collectionKey or collectionName required." };
    }
    try {
      const creds = resolveZoteroCredentialsTs();
      const collections = await listZoteroCollectionsCached(creds as any, resolveDataHubCacheDir());
      const match =
        collections.find((c) => c.key === target) ||
        collections.find((c) => c.name === target) ||
        collections.find((c) => c.name.replace(/\s+/g, "").toLowerCase() === target.replace(/\s+/g, "").toLowerCase());
      if (!match) {
        return { status: "error", message: `Collection '${target}' not found.` };
      }
      const items = await fetchZoteroCollectionItemsPreview(creds as any, match.key);
      return { status: "ok", items, collectionKey: match.key };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_zotero_count") {
    const target = toStringOrUndefined(payload?.collectionKey);
    if (!target) {
      return { status: "error", message: "collectionKey required." };
    }
    try {
      const creds = resolveZoteroCredentialsTs();
      const count = await fetchZoteroCollectionCount(creds as any, target, resolveDataHubCacheDir());
      return { status: "ok", key: target, count };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_load_zotero_multi") {
    const keys = Array.isArray(payload?.collectionKeys) ? (payload?.collectionKeys as string[]) : [];
    if (!keys.length) {
      return { status: "error", message: "collectionKeys required." };
    }
    try {
      const creds = resolveZoteroCredentialsTs();
      const cacheDir = resolveDataHubCacheDir();
      const cache = payload?.cache !== false;
      const tables: DataHubTable[] = [];
      let cachedAny = false;
      for (const key of keys) {
        const { table, cached } = await fetchZoteroCollectionItems(creds as any, key, undefined, cacheDir, cache);
        if (table) tables.push(table);
        if (cached) cachedAny = true;
      }
      const merged = mergeTables(tables);
      return {
        status: "ok",
        table: merged,
        cached: cachedAny,
        message: cachedAny
          ? `Loaded ${tables.length} collections from cache.`
          : `Loaded ${tables.length} collections from Zotero.`,
        source: { type: "zotero", collectionName: keys.join(",") }
      };
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }
  if (action === "datahub_load_file") {
    let filePath = toStringOrUndefined(payload?.filePath);
    if (!filePath) {
      const result = await dialog.showOpenDialog({
        title: "Load data file",
        properties: ["openFile"],
        filters: [
          { name: "Data Files", extensions: ["csv", "tsv", "xls", "xlsx", "xlsm"] },
          { name: "All Files", extensions: ["*"] }
        ]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { status: "canceled", message: "File selection canceled." };
      }
      filePath = result.filePaths[0];
    }
    const result = await invokeDataHubLoad({ sourceType: "file", filePath });
    if ((result as Record<string, unknown>)?.status === "error") {
      return result as Record<string, unknown>;
    }
    ensureDataHubLastMarker({ source: { type: "file", path: filePath } });
    return { status: "ok", ...result };
  }
  if (action === "datahub_load_excel") {
    const result = await dialog.showOpenDialog({
      title: "Load Excel file",
      properties: ["openFile"],
      filters: [{ name: "Excel", extensions: ["xls", "xlsx", "xlsm"] }, { name: "All Files", extensions: ["*"] }]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { status: "canceled", message: "File selection canceled." };
    }
    const filePath = result.filePaths[0];
    const resultLoad = await invokeDataHubLoad({ sourceType: "file", filePath });
    if ((resultLoad as Record<string, unknown>)?.status === "error") {
      return resultLoad as Record<string, unknown>;
    }
    ensureDataHubLastMarker({ source: { type: "file", path: filePath } });
    return { status: "ok", ...resultLoad };
  }
  if (action === "datahub_load_last") {
    const cacheDir = resolveDataHubCacheDir();
    const lastPath = path.join(cacheDir, "last.json");
    if (!fs.existsSync(lastPath)) {
      const fallback = await findMostRecentCachedTable(cacheDir);
      if (fallback) {
        return {
          status: "ok",
          table: fallback.table,
          source: { type: "file", path: fallback.cacheFilePath },
          message: "Loaded last cached table (fallback)."
        };
      }
      return { status: "error", message: "No cached data found.", cacheDir };
    }
    let last: Record<string, unknown> | undefined;
    try {
      last = JSON.parse(fs.readFileSync(lastPath, "utf-8")) as Record<string, unknown>;
    } catch (error) {
      return {
        status: "error",
        message: `Failed to read cache marker: ${error instanceof Error ? error.message : String(error)}`,
        cacheDir
      };
    }
    // Prefer loading the cached table directly when available (fast + does not require original file/network).
    const cachePath = toStringOrUndefined(last?.cachePath);
    if (cachePath && fs.existsSync(cachePath)) {
      try {
        const raw = await fs.promises.readFile(cachePath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const table = (parsed as any)?.table as DataHubTable | undefined;
        if (table && Array.isArray((table as any).columns) && Array.isArray((table as any).rows)) {
          return { status: "ok", table, source: (last?.source as any) ?? undefined, last };
        }
      } catch {
        // fall back to re-loading from source below
      }
    }
    const source = (last?.source ?? {}) as Record<string, unknown>;
    const sourceType = toStringOrUndefined(source.type);
    if (sourceType === "file") {
      const filePath = toStringOrUndefined(source.path);
      if (!filePath) {
        return { status: "error", message: "Cached source is missing file path.", cacheDir, last };
      }
      const result = await invokeDataHubLoad({ sourceType: "file", filePath, cacheDir, cache: true });
      if ((result as Record<string, unknown>)?.status === "error") {
        return result as Record<string, unknown>;
      }
      return { status: "ok", ...result, last };
    }
    if (sourceType === "zotero") {
      const collectionName = toStringOrUndefined(source.collectionName) ?? "";
      let credentials: { libraryId: string; libraryType: string; apiKey: string };
      try {
        credentials = resolveZoteroCredentials();
      } catch (error) {
        return { status: "error", message: error instanceof Error ? error.message : "Zotero credentials unavailable." };
      }
      const result = await invokeDataHubLoad({
        sourceType: "zotero",
        collectionName,
        zotero: credentials,
        cacheDir,
        cache: true
      });
      if ((result as Record<string, unknown>)?.status === "error") {
        return result as Record<string, unknown>;
      }
      return { status: "ok", ...result, last };
    }
    return { status: "error", message: `Unknown cached source type '${sourceType ?? ""}'.`, cacheDir, last };
  }
  if (action === "datahub_export_csv") {
    const table = ensureTablePayload(payload);
    let filePath = toStringOrUndefined(payload?.filePath);
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: "Export CSV",
        defaultPath: path.join(process.cwd(), "data-hub-export.csv"),
        filters: [{ name: "CSV", extensions: ["csv"] }]
      });
      if (result.canceled || !result.filePath) {
        return { status: "canceled", message: "Export canceled." };
      }
      filePath = result.filePath;
    }
    const csv = stringifyCsv(table);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, csv, "utf-8");
    return { status: "ok", message: `Exported ${table.rows.length} rows.`, path: filePath };
  }
  if (action === "datahub_export_excel") {
    const table = ensureTablePayload(payload);
    let filePath = toStringOrUndefined(payload?.filePath);
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: "Export Excel",
        defaultPath: path.join(process.cwd(), "data-hub-export.xlsx"),
        filters: [{ name: "Excel", extensions: ["xlsx"] }]
      });
      if (result.canceled || !result.filePath) {
        return { status: "canceled", message: "Export canceled." };
      }
      filePath = result.filePath;
    }
    const result = await invokeDataHubExportExcel({ filePath, table });
    if ((result as Record<string, unknown>)?.status === "error") {
      return result as Record<string, unknown>;
    }
    return { status: "ok", ...result };
  }
  if (action === "datahub_clear_cache") {
    const collectionName = toStringOrUndefined(payload?.collectionName);
    const cacheRoot = path.join(app.getPath("userData"), "data-hub-cache");
    if (collectionName) {
      const target = path.join(cacheRoot, collectionName);
      if (!fs.existsSync(target)) {
        return { status: "ok", message: "No cache found for the selected collection." };
      }
      fs.rmSync(target, { recursive: true, force: true });
      return { status: "ok", message: `Cleared cache for ${collectionName}.` };
    }
    if (!fs.existsSync(cacheRoot)) {
      return { status: "ok", message: "No cache directory found." };
    }
    fs.rmSync(cacheRoot, { recursive: true, force: true });
    return { status: "ok", message: "Cleared data hub cache." };
  }
  if (action === "datahub_resolve_na") {
    const table = ensureTablePayload(payload);
    const columns = Array.isArray(payload?.columns) ? (payload?.columns as string[]) : undefined;
    const replacement = toStringOrUndefined(payload?.replacement) ?? "Unknown";
    const result = resolveNaTable(table, columns, replacement);
    return {
      status: "ok",
      table: result.table,
      message: `Replaced ${result.replaced} empty values.`
    };
  }
  if (action === "datahub_codebook") {
    const table = ensureTablePayload(payload);
    const columns = payload?.columns as string[] | undefined;
    if (!columns || columns.length === 0) {
      return { status: "error", message: "Provide a list of columns for the codebook." };
    }
    const filtered = filterColumns(table, columns);
    return { status: "ok", table: filtered, message: `Applied codebook (${columns.length} columns).` };
  }
  if (action === "datahub_codes") {
    const table = ensureTablePayload(payload);
    const columns = payload?.columns as string[] | undefined;
    if (!columns || columns.length === 0) {
      return { status: "error", message: "Provide coding columns to display." };
    }
    const filtered = filterColumns(table, columns);
    return { status: "ok", table: filtered, message: `Applied coding columns (${columns.length}).` };
  }
  return { status: "ok" };
};

export const registerRetrieveIpcHandlers = (options: { search?: (query: RetrieveQuery) => Promise<RetrieveSearchResult> } = {}): void => {
  const searchImpl = options.search ?? ((query: RetrieveQuery) => executeRetrieveSearch(query));
  ipcMain.handle("retrieve:search", async (_event, query: RetrieveQuery) => searchImpl(query));
  ipcMain.handle("retrieve:tags:list", (_event, paperId: string) => listTagsForPaper(paperId));
  ipcMain.handle("retrieve:tags:add", (_event, payload: { paper: RetrievePaperSnapshot; tag: string }) =>
    addTagToPaper(payload.paper, payload.tag)
  );
  ipcMain.handle("retrieve:tags:remove", (_event, payload: { paperId: string; tag: string }) =>
    removeTagFromPaper(payload.paperId, payload.tag)
  );
  ipcMain.handle("retrieve:citation-network", (_event, payload: RetrieveCitationNetworkRequest): RetrieveCitationNetwork => {
    if (!payload?.record?.paperId) {
      throw new Error("Citation network request missing record.");
    }
    return buildCitationNetwork(payload.record);
  });
  ipcMain.handle("retrieve:snowball", async (_event, payload: RetrieveSnowballRequest) => {
    if (!payload?.record) {
      throw new Error("Snowball request missing record.");
    }
    return await fetchSemanticSnowball(payload.record, payload.direction);
  });
  ipcMain.handle("retrieve:oa", async (_event, payload: { doi?: string }) => {
    const doi = (payload?.doi || "").trim();
    if (!doi) {
      throw new Error("OA lookup requires a DOI.");
    }
    const email = getUnpaywallEmail();
    if (!email) {
      throw new Error("UNPAYWALL_EMAIL is not configured in .env or settings.");
    }
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`;
    const res = await fetch(`${url}?email=${encodeURIComponent(email)}`);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Unpaywall HTTP ${res.status}: ${txt.slice(0, 120)}`);
    }
    const json = (await res.json()) as any;
    const best = json?.best_oa_location;
    const oaUrl = best?.url_for_pdf || best?.url || json?.oa_locations?.[0]?.url_for_pdf || json?.oa_locations?.[0]?.url;
    const status = json?.is_oa ? "open" : "closed";
    const license = best?.license || json?.license;
    return { status, url: oaUrl, license };
  });
  ipcMain.handle("retrieve:library:save", async (_event, payload: { record: RetrieveRecord }) => {
    if (!payload?.record) {
      throw new Error("Save request missing record.");
    }
    // Reuse tags_db to persist minimal snapshot + tags table; store JSON for now.
    const snapshot: RetrievePaperSnapshot = {
      paperId: payload.record.paperId,
      title: payload.record.title,
      doi: payload.record.doi,
      url: payload.record.url,
      source: payload.record.source,
      year: payload.record.year
    };
    addTagToPaper(snapshot, "__saved__");
    const base = getAppDataPath();
    const outDir = path.join(base, "retrieve", "library");
    fs.mkdirSync(outDir, { recursive: true });
    const fileName = `${snapshot.paperId || snapshot.doi || "record"}.json`.replace(/[\\/:]+/g, "_");
    fs.writeFileSync(path.join(outDir, fileName), JSON.stringify(payload.record, null, 2), "utf-8");
    return { status: "ok", message: "Saved to library cache." };
  });
  ipcMain.handle(
    "retrieve:export",
    async (_event, payload: { rows: RetrieveRecord[]; format: "csv" | "xlsx" | "ris"; targetPath?: string }) => {
      if (!payload?.rows || !Array.isArray(payload.rows) || payload.rows.length === 0) {
        throw new Error("Export request missing rows.");
      }
      const rows = payload.rows;
      const format = payload.format;
      const defaultDir = path.join(getAppDataPath(), "retrieve", "exports");
      fs.mkdirSync(defaultDir, { recursive: true });
      const fallbackName = `export-${Date.now()}.${format === "xlsx" ? "csv" : format}`;
      const target = payload.targetPath && payload.targetPath.trim() ? payload.targetPath : path.join(defaultDir, fallbackName);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (format === "csv") {
        const cols = ["title", "authors", "year", "venue", "doi", "url", "source", "abstract"];
        const escape = (v: unknown) => {
          if (v === null || v === undefined) return "";
          const s = String(Array.isArray(v) ? v.join("; ") : v);
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const lines = [cols.join(",")];
        rows.forEach((r) => lines.push(cols.map((c) => escape((r as any)[c])).join(",")));
        fs.writeFileSync(target, lines.join("\n"), "utf-8");
      } else if (format === "ris") {
        const toRis = (r: RetrieveRecord) => {
          const lines: string[] = ["TY  - JOUR"];
          if (r.title) lines.push(`TI  - ${r.title}`);
          if (r.authors) r.authors.forEach((a) => lines.push(`AU  - ${a}`));
          if (r.year) lines.push(`PY  - ${r.year}`);
          const venue = (r as any).venue ?? (r as any).journal;
          if (venue) lines.push(`JO  - ${venue}`);
          if (r.doi) lines.push(`DO  - ${r.doi}`);
          if (r.url) lines.push(`UR  - ${r.url}`);
          if (r.abstract) lines.push(`AB  - ${r.abstract}`);
          lines.push("ER  - ");
          return lines.join("\n");
        };
        fs.writeFileSync(target, rows.map(toRis).join("\n"), "utf-8");
      } else if (format === "xlsx") {
        const zip = new AdmZip();
        const workbook = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ROWS_PLACEHOLDER
  </sheetData>
</worksheet>`;
        const cols = ["title", "authors", "year", "venue", "doi", "url", "source", "abstract"];
        const esc = (v: unknown) => {
          if (v === null || v === undefined) return "";
          const s = String(Array.isArray(v) ? v.join("; ") : v);
          return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        };
        const rowsXml: string[] = [];
        const row = (idx: number, cells: string[]) =>
          `<row r="${idx}">${cells
            .map(
              (val, i) =>
                `<c r="${String.fromCharCode(65 + i)}${idx}" t="inlineStr"><is><t>${val}</t></is></c>`
            )
            .join("")}</row>`;
        rowsXml.push(row(1, cols.map((c) => esc(c))));
        rows.forEach((r, i) => rowsXml.push(row(i + 2, cols.map((c) => esc((r as any)[c])))));
        const sheetXml = workbook.replace("ROWS_PLACEHOLDER", rowsXml.join(""));
        zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(sheetXml, "utf8"));
        zip.addFile(
          "[Content_Types].xml",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`,
            "utf8"
          )
        );
        zip.addFile(
          "xl/workbook.xml",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets>
    <sheet name="results" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`,
            "utf8"
          )
        );
        zip.addFile(
          "_rels/.rels",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
            "utf8"
          )
        );
        zip.addFile(
          "xl/_rels/workbook.xml.rels",
          Buffer.from(
            `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
            "utf8"
          )
        );
        zip.writeZip(target);
      }
      return { status: "ok", message: `Exported ${rows.length} rows to ${target}` };
    }
  );
};
