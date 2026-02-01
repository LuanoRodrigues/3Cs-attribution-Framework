import { app, dialog, ipcMain } from "electron";
import fs from "fs";
import path from "path";

import type {
  RetrievePaperSnapshot,
  RetrieveProviderId,
  RetrieveCitationNetwork,
  RetrieveCitationNetworkRequest,
  RetrieveQuery,
  RetrieveRecord,
  RetrieveSearchResult
} from "../../shared/types/retrieve";
import type { DataHubTable } from "../../shared/types/dataHub";
import { GENERAL_KEYS, ZOTERO_KEYS } from "../../config/settingsKeys";
import { getSetting, setSetting } from "../../config/settingsFacade";
import { getSecretsVault } from "../../config/secretsVaultInstance";
import { getProviderSpec, mergeCosResults, type ProviderSearchResult } from "../services/retrieve/providers";
import { getCachedResult, setCachedResult } from "../services/retrieve/cache";
import { addTagToPaper, listTagsForPaper, removeTagFromPaper } from "../services/retrieve/tags_db";
import { buildCitationNetwork } from "../services/retrieve/citation_network";
import { invokeDataHubExportExcel, invokeDataHubListCollections, invokeDataHubLoad } from "../services/dataHubBridge";

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
  const libraryId = toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.libraryId));
  const libraryType = toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.libraryType)) ?? "user";
  if (!libraryId) {
    throw new Error("Zotero library ID is not configured in settings.");
  }
  let apiKey: string | undefined;
  try {
    apiKey = getSecretsVault().getSecret(ZOTERO_KEYS.apiKey);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Secrets vault unavailable.");
  }
  if (!apiKey) {
    throw new Error("Zotero API key is not configured or vault is locked.");
  }
  return { libraryId, libraryType, apiKey };
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
    const collectionName =
      toStringOrUndefined(payload?.collectionName) ??
      toStringOrUndefined(getSetting<string>(GENERAL_KEYS.collectionName)) ??
      toStringOrUndefined(getSetting<string>(ZOTERO_KEYS.lastCollection)) ??
      "";
    let credentials: { libraryId: string; libraryType: string; apiKey: string };
    try {
      credentials = resolveZoteroCredentials();
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "Zotero credentials unavailable." };
    }
    if (collectionName) {
      setSetting(ZOTERO_KEYS.lastCollection, collectionName);
    }
    const result = await invokeDataHubLoad({
      sourceType: "zotero",
      collectionName,
      zotero: credentials
    });
    if ((result as Record<string, unknown>)?.status === "error") {
      return result as Record<string, unknown>;
    }
    return { status: "ok", ...result };
  }
  if (action === "datahub_list_collections") {
    let credentials: { libraryId: string; libraryType: string; apiKey: string };
    try {
      credentials = resolveZoteroCredentials();
    } catch (error) {
      return { status: "error", message: error instanceof Error ? error.message : "Zotero credentials unavailable." };
    }
    const result = await invokeDataHubListCollections({ zotero: credentials });
    return { status: "ok", ...result };
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
    return { status: "ok", ...resultLoad };
  }
  if (action === "datahub_load_last") {
    const cacheDir = path.join(app.getPath("userData"), "data-hub-cache");
    const lastPath = path.join(cacheDir, "last.json");
    if (!fs.existsSync(lastPath)) {
      return { status: "error", message: "No cached data found. Load data in Retrieve first.", cacheDir };
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
};
