import { ipcMain } from "electron";

import type {
  RetrievePaperSnapshot,
  RetrieveProviderId,
  RetrieveQuery,
  RetrieveRecord,
  RetrieveSearchResult
} from "../../shared/types/retrieve";
import { getProviderSpec, mergeCosResults, type ProviderSearchResult } from "../services/retrieve/providers";
import { getCachedResult, setCachedResult } from "../services/retrieve/cache";
import { addTagToPaper, listTagsForPaper, removeTagFromPaper } from "../services/retrieve/tags_db";

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

const normalizeQuery = (payload?: Record<string, unknown>): RetrieveQuery => {
  const base: RetrieveQuery = {
    query: toStringOrUndefined(payload?.query) ?? "",
    year_from: toNumberOrUndefined(payload?.year_from),
    year_to: toNumberOrUndefined(payload?.year_to),
    sort: typeof payload?.sort === "string" ? (payload.sort as RetrieveQuery["sort"]) : undefined,
    limit: toNumberOrUndefined(payload?.limit),
    cursor: toStringOrUndefined(payload?.cursor),
    offset: toNumberOrUndefined(payload?.offset),
    page: toNumberOrUndefined(payload?.page)
  };
  const providerId = typeof payload?.provider === "string" ? (payload.provider as RetrieveProviderId) : undefined;
  if (providerId) {
    base.provider = providerId;
  }
  return base;
};

const executeProviderSearch = async (
  providerId: RetrieveProviderId,
  query: RetrieveQuery
): Promise<ProviderSearchResult> => {
  const spec = getProviderSpec(providerId);
  if (!spec) {
    return { records: [], total: 0 };
  }

  const cached = getCachedResult(providerId, query);
  if (cached) {
    return cached;
  }

  if (spec.mergeSources?.length) {
    const children: Array<{ providerId: RetrieveProviderId; result: ProviderSearchResult }> = [];
    for (const child of spec.mergeSources) {
      const result = await executeProviderSearch(child, query);
      children.push({ providerId: child, result });
    }
    const merged = mergeCosResults(children);
    setCachedResult(providerId, query, merged);
    return merged;
  }

  if (!spec.buildRequest || !spec.parseResponse) {
    return { records: [], total: 0 };
  }

  const request = spec.buildRequest(query);
  if (!request) {
    return { records: [], total: 0 };
  }

  await throttle(providerId, spec.rateMs);

  try {
    const response = await fetch(request.url, {
      headers: request.headers ?? {}
    });
    if (!response.ok) {
      return { records: [], total: 0 };
    }
    const payload = await response.json();
    const parsed = spec.parseResponse(payload);
    setCachedResult(providerId, query, parsed);
    return parsed;
  } catch (error) {
    console.error("Retrieve provider error", providerId, error);
    return { records: [], total: 0 };
  }
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
  return {
    provider,
    items: result.records,
    total: result.total,
    nextCursor: result.nextCursor
  };
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
  return { status: "ok" };
};

export const registerRetrieveIpcHandlers = (): void => {
  ipcMain.handle("retrieve:search", async (_event, query: RetrieveQuery) => executeRetrieveSearch(query));
  ipcMain.handle("retrieve:tags:list", (_event, paperId: string) => listTagsForPaper(paperId));
  ipcMain.handle("retrieve:tags:add", (_event, payload: { paper: RetrievePaperSnapshot; tag: string }) =>
    addTagToPaper(payload.paper, payload.tag)
  );
  ipcMain.handle("retrieve:tags:remove", (_event, payload: { paperId: string; tag: string }) =>
    removeTagFromPaper(payload.paperId, payload.tag)
  );
};
