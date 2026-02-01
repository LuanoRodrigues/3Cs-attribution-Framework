import fs from "fs";
import path from "path";

import type { RetrieveProviderId, RetrieveQuery } from "../../../shared/types/retrieve";
import type { ProviderSearchResult } from "./providers";
import { getAppDataPath } from "../../../config/settingsFacade";

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
  createdAt: number;
}

const cache = new Map<string, CacheEntry>();
let cacheDir: string | null = null;
let cachePath: string | null = null;
let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;

const resolveCachePaths = (): void => {
  if (cacheDir && cachePath) return;
  try {
    cacheDir = path.join(getAppDataPath(), "retrieve");
  } catch {
    cacheDir = path.join(process.cwd(), "retrieve-cache-fallback");
  }
  cachePath = path.join(cacheDir, "request-cache.json");
};

const ensureDir = (): void => {
  resolveCachePaths();
  if (!cacheDir) return;
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch {
    // ignore fs errors; cache will remain in-memory only
  }
};

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

export const buildCacheKey = (providerId: RetrieveProviderId, query: RetrieveQuery, authSig = ""): string => {
  return `${providerId}:${authSig}:${canonicalizeQuery(query)}`;
};

const persist = (): void => {
  if (!dirty) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!dirty) return;
    resolveCachePaths();
    if (!cachePath) return;
    try {
      ensureDir();
      const payload = {
        ttlMs: CACHE_TTL_MS,
        entries: Array.from(cache.entries()).map(([key, entry]) => ({
          key,
          result: entry.result,
          expiresAt: entry.expiresAt,
          createdAt: entry.createdAt
        }))
      };
      fs.writeFileSync(cachePath, JSON.stringify(payload), "utf-8");
      dirty = false;
    } catch {
      // ignore persistence failures
    }
  }, 150);
};

const hydrate = (): void => {
  resolveCachePaths();
  if (!cachePath) return;
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      entries?: Array<{ key: string; result: ProviderSearchResult; expiresAt: number; createdAt?: number }>;
    };
    if (!parsed?.entries) return;
    const now = Date.now();
    parsed.entries.forEach((entry) => {
      if (!entry || typeof entry.key !== "string") return;
      if (!entry.expiresAt || entry.expiresAt <= now) return;
      cache.set(entry.key, {
        result: entry.result,
        expiresAt: entry.expiresAt,
        createdAt: entry.createdAt ?? now
      });
    });
  } catch {
    // ignore hydrate failure
  }
};

hydrate();

const pruneExpired = (): void => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
};

export const getCachedResult = (
  providerId: RetrieveProviderId,
  query: RetrieveQuery,
  authSig = ""
): ProviderSearchResult | undefined => {
  const key = buildCacheKey(providerId, query, authSig);
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
  result: ProviderSearchResult,
  authSig = ""
): void => {
  pruneExpired();
  const key = buildCacheKey(providerId, query, authSig);
  cache.set(key, {
    result,
    createdAt: Date.now(),
    expiresAt: Date.now() + CACHE_TTL_MS
  });
  dirty = true;
  persist();
};
