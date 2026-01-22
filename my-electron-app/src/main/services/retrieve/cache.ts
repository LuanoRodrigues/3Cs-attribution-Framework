import type { RetrieveProviderId, RetrieveQuery } from "../../../shared/types/retrieve";
import type { ProviderSearchResult } from "./providers";

const DEFAULT_TTL_MS = (() => {
  const envValue = Number(process.env.RETRIEVE_CACHE_TTL_MS ?? "");
  if (Number.isFinite(envValue) && envValue > 0) {
    return envValue;
  }
  return 5 * 60 * 1000;
})();

export const CACHE_TTL_MS = Math.max(1000, DEFAULT_TTL_MS);

interface CacheEntry {
  result: ProviderSearchResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

const canonicalizeQuery = (query: RetrieveQuery): string => {
  const snapshot: Record<string, unknown> = {};
  const keys = Object.keys(query) as Array<keyof RetrieveQuery>;
  keys
    .sort()
    .forEach((key) => {
      const value = query[key];
      if (value === undefined || value === null || value === "") {
        return;
      }
      const stringKey = String(key);
      if (typeof value === "string") {
        snapshot[stringKey] = value.trim();
        return;
      }
      snapshot[stringKey] = value;
    });
  return JSON.stringify(snapshot);
};

export const buildCacheKey = (providerId: RetrieveProviderId, query: RetrieveQuery): string => {
  return `${providerId}:${canonicalizeQuery(query)}`;
};

const pruneExpired = (): void => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
};

export const getCachedResult = (providerId: RetrieveProviderId, query: RetrieveQuery): ProviderSearchResult | undefined => {
  const key = buildCacheKey(providerId, query);
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.result;
};

export const setCachedResult = (
  providerId: RetrieveProviderId,
  query: RetrieveQuery,
  result: ProviderSearchResult
): void => {
  pruneExpired();
  const key = buildCacheKey(providerId, query);
  cache.set(key, {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
};
