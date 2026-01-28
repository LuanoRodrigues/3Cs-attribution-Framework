import fs from "fs";
import path from "path";

import type { AudioCacheEntry } from "./types";
import { getAppDataPath } from "../config/settingsFacade";

interface AudioCacheFile {
  entries: Record<string, AudioCacheEntry>;
}

const CACHE_DIR_NAME = "analyse";
const CACHE_FILE_NAME = "audio-cache.json";

const normalizeKey = (value: string): string => value.trim();

const resolveCacheDir = (runId?: string): string => {
  const safeRunId = runId ? runId.replace(/[^a-zA-Z0-9_-]+/g, "_") : "global";
  return path.join(getAppDataPath(), CACHE_DIR_NAME, "audio-cache", safeRunId);
};

const readCacheFile = (filePath: string): AudioCacheFile => {
  if (!fs.existsSync(filePath)) {
    return { entries: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as AudioCacheFile;
    if (parsed && typeof parsed === "object" && parsed.entries) {
      return parsed;
    }
  } catch {
    // ignore parse errors
  }
  return { entries: {} };
};

const writeCacheFile = (filePath: string, cache: AudioCacheFile): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), "utf-8");
};

export const getAudioCacheStatus = async (
  runId: string | undefined,
  keys: string[]
): Promise<{ cachedKeys: string[] }> => {
  if (!Array.isArray(keys) || keys.length === 0) {
    return { cachedKeys: [] };
  }
  const cacheDir = resolveCacheDir(runId);
  const cachePath = path.join(cacheDir, CACHE_FILE_NAME);
  const cache = readCacheFile(cachePath);
  const cachedKeys = keys
    .map((key) => normalizeKey(key))
    .filter((key) => key && cache.entries[key]);
  return { cachedKeys };
};

export const addAudioCacheEntries = async (
  runId: string | undefined,
  entries: AudioCacheEntry[]
): Promise<{ cachedKeys: string[] }> => {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { cachedKeys: [] };
  }
  const cacheDir = resolveCacheDir(runId);
  const cachePath = path.join(cacheDir, CACHE_FILE_NAME);
  const cache = readCacheFile(cachePath);
  const now = new Date().toISOString();
  entries.forEach((entry) => {
    if (!entry || !entry.key) {
      return;
    }
    const key = normalizeKey(entry.key);
    if (!key) {
      return;
    }
    cache.entries[key] = { ...entry, key, updatedAt: entry.updatedAt ?? now };
  });
  writeCacheFile(cachePath, cache);
  return { cachedKeys: Object.keys(cache.entries) };
};
