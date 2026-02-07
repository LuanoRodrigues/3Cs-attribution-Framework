type LlmCacheEntry = {
  key: string;
  fn: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  value: any;
  meta?: { provider?: string; model?: string };
  inputSize?: number;
};

type LlmCachePayload = {
  version: 1;
  entries: LlmCacheEntry[];
};

const CACHE_VERSION = 1;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30 * 6; // 6 months
const CACHE_MAX_ENTRIES = 400;
const LAST_LEDOC_PATH_STORAGE_KEY = "leditor.lastLedocPath";

let cacheEntries = new Map<string, LlmCacheEntry>();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

const safeToString = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    try {
      return Object.prototype.toString.call(value);
    } catch {
      return "[unserializable]";
    }
  }
};

const hashString = (input: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const stableStringify = (value: any): string => {
  if (value == null) return "null";
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  if (!isPlainObject(value)) return JSON.stringify(safeToString(value));
  const keys = Object.keys(value).sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = (value as any)[k];
    if (v === undefined) continue;
    parts.push(`${JSON.stringify(k)}:${stableStringify(v)}`);
  }
  return `{${parts.join(",")}}`;
};

const normalizeForCache = (value: any, depth: number = 0): any => {
  if (depth > 40) return null;
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((v) => normalizeForCache(v, depth + 1));
  }
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === "apiKey" || key === "requestId" || key === "signal" || key === "stream") continue;
    if ((key === "ts" || key === "timestamp") && typeof raw === "number") continue;
    if (key === "history" && Array.isArray(raw)) {
      out[key] = raw
        .map((m: any) => ({
          role: m?.role,
          content: typeof m?.content === "string" ? m.content : safeToString(m?.content ?? "")
        }))
        .filter((m: any) => (m.role === "user" || m.role === "assistant" || m.role === "system") && m.content.trim());
      continue;
    }
    if (key === "messages" && Array.isArray(raw)) {
      out[key] = raw
        .map((m: any) => ({
          role: m?.role,
          content: typeof m?.content === "string" ? m.content : safeToString(m?.content ?? "")
        }))
        .filter((m: any) => (m.role === "user" || m.role === "assistant" || m.role === "system") && m.content.trim());
      continue;
    }
    out[key] = normalizeForCache(raw, depth + 1);
  }
  return out;
};

const pruneExpired = () => {
  const now = Date.now();
  for (const [key, entry] of cacheEntries.entries()) {
    if (!entry || typeof entry.expiresAt !== "number" || entry.expiresAt <= now) {
      cacheEntries.delete(key);
    }
  }
};

const pruneOverflow = () => {
  if (cacheEntries.size <= CACHE_MAX_ENTRIES) return;
  const sorted = [...cacheEntries.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const removeCount = Math.max(0, sorted.length - CACHE_MAX_ENTRIES);
  for (let i = 0; i < removeCount; i += 1) {
    const entry = sorted[i];
    if (entry) cacheEntries.delete(entry.key);
  }
};

let autosaveTimer: number | null = null;
const scheduleCacheAutosave = () => {
  try {
    const allow = (globalThis as typeof globalThis & { __leditorAllowLedocAutosave?: boolean }).__leditorAllowLedocAutosave;
    if (!allow) return;
    if (autosaveTimer !== null) window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      const exporter = (window as typeof window & {
        __leditorAutoExportLEDOC?: (options?: { targetPath?: string; suggestedPath?: string; prompt?: boolean }) => Promise<any>;
      }).__leditorAutoExportLEDOC;
      if (!exporter) return;
      let targetPath = "";
      try {
        targetPath = (window.localStorage.getItem(LAST_LEDOC_PATH_STORAGE_KEY) || "").trim();
      } catch {
        // ignore
      }
      if (!targetPath) return;
      void exporter({ targetPath, suggestedPath: targetPath, prompt: false }).catch(() => {});
    }, 1200);
  } catch {
    // ignore
  }
};

export const buildLlmCacheKey = (args: {
  fn: string;
  provider?: string;
  model?: string;
  payload: any;
  extra?: Record<string, unknown>;
}): string => {
  const normalized = normalizeForCache({ payload: args.payload, extra: args.extra });
  const serialized = stableStringify(normalized);
  const hash = hashString(serialized);
  const provider = typeof args.provider === "string" ? args.provider.trim() : "";
  const model = typeof args.model === "string" ? args.model.trim() : "";
  return `v${CACHE_VERSION}|${args.fn}|${provider}|${model}|${hash}|${serialized.length}`;
};

export const getLlmCacheEntry = (key: string): LlmCacheEntry | null => {
  if (!key) return null;
  pruneExpired();
  const entry = cacheEntries.get(key) ?? null;
  if (!entry) return null;
  const now = Date.now();
  if (entry.expiresAt <= now) {
    cacheEntries.delete(key);
    return null;
  }
  entry.lastUsedAt = now;
  cacheEntries.set(key, entry);
  return entry;
};

export const setLlmCacheEntry = (args: {
  key: string;
  fn: string;
  value: any;
  meta?: { provider?: string; model?: string };
  inputSize?: number;
}) => {
  if (!args.key) return;
  const now = Date.now();
  const entry: LlmCacheEntry = {
    key: args.key,
    fn: args.fn,
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + CACHE_TTL_MS,
    value: args.value,
    meta: args.meta,
    inputSize: typeof args.inputSize === "number" ? args.inputSize : undefined
  };
  cacheEntries.set(args.key, entry);
  pruneExpired();
  pruneOverflow();
  scheduleCacheAutosave();
};

export const clearLlmCache = () => {
  cacheEntries.clear();
};

export const exportLlmCacheForLedoc = (): LlmCachePayload | null => {
  pruneExpired();
  pruneOverflow();
  if (cacheEntries.size === 0) return null;
  return {
    version: CACHE_VERSION as 1,
    entries: [...cacheEntries.values()]
  };
};

export const loadLlmCacheFromLedoc = (container: unknown) => {
  cacheEntries = new Map();
  if (!container || typeof container !== "object") return;
  const raw = container as any;
  const candidate = raw.llmCache ?? raw.llm_cache ?? raw.cache?.llm ?? null;
  if (!candidate || typeof candidate !== "object") return;
  const version = (candidate as any).version;
  if (version !== CACHE_VERSION) return;
  const entries = Array.isArray((candidate as any).entries) ? (candidate as any).entries : [];
  const now = Date.now();
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const key = typeof e.key === "string" ? e.key : "";
    if (!key) continue;
    const expiresAt = Number.isFinite(e.expiresAt) ? Number(e.expiresAt) : now + CACHE_TTL_MS;
    if (expiresAt <= now) continue;
    const entry: LlmCacheEntry = {
      key,
      fn: typeof e.fn === "string" ? e.fn : "unknown",
      createdAt: Number.isFinite(e.createdAt) ? Number(e.createdAt) : now,
      lastUsedAt: Number.isFinite(e.lastUsedAt) ? Number(e.lastUsedAt) : now,
      expiresAt,
      value: (e as any).value,
      meta: isPlainObject(e.meta) ? (e.meta as any) : undefined,
      inputSize: Number.isFinite(e.inputSize) ? Number(e.inputSize) : undefined
    };
    cacheEntries.set(key, entry);
  }
  pruneExpired();
  pruneOverflow();
};
