import type {
  AnalyseDatasets,
  AnalyseRun,
  BatchRecord,
  SectionRecord,
  SectionLevel,
  RunMetrics,
  AudioCacheEntry
} from "./types";

interface DiscoverResult {
  runs: AnalyseRun[];
  sectionsRoot: string | null;
}

function getBridge() {
  return window.analyseBridge?.data;
}

const emptyDiscover: DiscoverResult = { runs: [], sectionsRoot: null };
const emptyRuns: AnalyseRun[] = [];
const emptySections: SectionRecord[] = [];
const emptyBatches: BatchRecord[] = [];
const MAX_DATASET_CACHE = 3;
const batchesCache = new Map<string, BatchRecord[]>();
const batchesInflight = new Map<string, Promise<BatchRecord[]>>();
const sectionsCache = new Map<string, SectionRecord[]>();
const sectionsInflight = new Map<string, Promise<SectionRecord[]>>();
const dqCache = new Map<string, { data: Record<string, unknown>; path: string | null }>();
const dqInflight = new Map<string, Promise<{ data: Record<string, unknown>; path: string | null }>>();

function touchCache<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > MAX_DATASET_CACHE) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
}

async function withCache<T>(
  key: string,
  cache: Map<string, T>,
  inflight: Map<string, Promise<T>>,
  fallback: T,
  loader: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const existing = inflight.get(key);
  if (existing) {
    return existing;
  }
  const promise = loader()
    .then((result) => {
      cache.set(key, result);
      inflight.delete(key);
      return result;
    })
    .catch(() => {
      inflight.delete(key);
      return fallback;
    });
  inflight.set(key, promise);
  return promise;
}

export async function discoverRuns(baseDir?: string): Promise<DiscoverResult> {
  const bridge = getBridge();
  if (!bridge) {
    return emptyDiscover;
  }
  try {
    const result = (await bridge.discoverRuns(baseDir)) ?? emptyDiscover;
    console.info("[analyse][data][discoverRuns]", { baseDir, runs: result.runs.map((r) => ({ id: r.id, path: r.path })), sectionsRoot: result.sectionsRoot });
    return result;
  } catch {
    return emptyDiscover;
  }
}

export async function buildDatasetHandles(runPath: string): Promise<AnalyseDatasets> {
  const bridge = getBridge();
  if (!bridge) {
    return {};
  }
  if (!runPath) {
    return {};
  }
  try {
    return (await bridge.buildDatasetHandles(runPath)) ?? {};
  } catch {
    return {};
  }
}

export async function loadBatches(runPath: string): Promise<BatchRecord[]> {
  const bridge = getBridge();
  if (!bridge || !runPath) {
    return emptyBatches;
  }
  return withCache(runPath, batchesCache, batchesInflight, emptyBatches, async () => {
    const batches = (await bridge.loadBatches(runPath)) ?? emptyBatches;
    touchCache(batchesCache, runPath, batches);
    console.info("[analyse][data][loadBatches]", { runPath, count: batches.length });
    return batches;
  });
}

export async function loadSections(runPath: string, level: SectionLevel): Promise<SectionRecord[]> {
  const bridge = getBridge();
  if (!bridge || !runPath) {
    return emptySections;
  }
  const key = `${runPath}::${level}`;
  return withCache(key, sectionsCache, sectionsInflight, emptySections, async () => {
    const sections = (await bridge.loadSections(runPath, level)) ?? emptySections;
    touchCache(sectionsCache, key, sections);
    console.info("[analyse][data][loadSections]", { runPath, level, count: sections.length });
    return sections;
  });
}

export async function summariseRun(runPath: string): Promise<RunMetrics> {
  const bridge = getBridge();
  if (!bridge || !runPath) {
    return { batches: 0, sectionsR1: 0, sectionsR2: 0, sectionsR3: 0 };
  }
  try {
    return (await bridge.summariseRun(runPath)) ?? { batches: 0, sectionsR1: 0, sectionsR2: 0, sectionsR3: 0 };
  } catch {
    return { batches: 0, sectionsR1: 0, sectionsR2: 0, sectionsR3: 0 };
  }
}

export async function getDefaultBaseDir(): Promise<string> {
  const bridge = getBridge();
  if (!bridge) {
    return "";
  }
  try {
    return (await bridge.getDefaultBaseDir()) ?? "";
  } catch {
    return "";
  }
}

export async function loadDirectQuoteLookup(runPath: string): Promise<{ data: Record<string, unknown>; path: string | null }> {
  const bridge = getBridge();
  if (!bridge || !runPath) {
    return { data: {}, path: null };
  }
  return withCache(runPath, dqCache, dqInflight, { data: {}, path: null }, async () => {
    const result = (await bridge.loadDqLookup(runPath)) ?? { data: {}, path: null };
    touchCache(dqCache, runPath, result);
    return result;
  });
}

export async function getAudioCacheStatus(
  runId: string | undefined,
  keys: string[]
): Promise<{ cachedKeys: string[] }> {
  const bridge = getBridge();
  if (!bridge || !keys.length) {
    return { cachedKeys: [] };
  }
  try {
    return (await bridge.getAudioCacheStatus(runId, keys)) ?? { cachedKeys: [] };
  } catch {
    return { cachedKeys: [] };
  }
}

export async function addAudioCacheEntries(
  runId: string | undefined,
  entries: AudioCacheEntry[]
): Promise<{ cachedKeys: string[] }> {
  const bridge = getBridge();
  if (!bridge || !entries.length) {
    return { cachedKeys: [] };
  }
  try {
    return (await bridge.addAudioCacheEntries(runId, entries)) ?? { cachedKeys: [] };
  } catch {
    return { cachedKeys: [] };
  }
}

export function warmAnalyseRun(runPath: string): void {
  if (!runPath) return;
  // Fire-and-forget warmup to reduce first interaction latency.
  void loadBatches(runPath);
  void loadSections(runPath, "r2");
  void loadSections(runPath, "r3");
  void loadDirectQuoteLookup(runPath);
}
