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
  try {
    const batches = (await bridge.loadBatches(runPath)) ?? emptyBatches;
    console.info("[analyse][data][loadBatches]", { runPath, count: batches.length });
    return batches;
  } catch {
    return emptyBatches;
  }
}

export async function loadSections(runPath: string, level: SectionLevel): Promise<SectionRecord[]> {
  const bridge = getBridge();
  if (!bridge || !runPath) {
    return emptySections;
  }
  try {
    const sections = (await bridge.loadSections(runPath, level)) ?? emptySections;
    console.info("[analyse][data][loadSections]", { runPath, level, count: sections.length });
    return sections;
  } catch {
    return emptySections;
  }
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
  try {
    return (await bridge.loadDqLookup(runPath)) ?? { data: {}, path: null };
  } catch {
    return { data: {}, path: null };
  }
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
