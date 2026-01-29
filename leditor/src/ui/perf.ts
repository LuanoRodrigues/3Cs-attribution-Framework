export type PerfEvent = {
  name: string;
  at: number;
  ms?: number;
  data?: Record<string, unknown>;
};

type PerfState = {
  enabled: boolean;
  t0: number;
  events: PerfEvent[];
  marks: Map<string, number>;
};

const getPerfState = (): PerfState => {
  const g = globalThis as typeof globalThis & { __leditorPerfState?: PerfState; __leditorPerf?: boolean };
  if (!g.__leditorPerfState) {
    g.__leditorPerfState = {
      enabled: Boolean(g.__leditorPerf),
      t0: performance.now(),
      events: [],
      marks: new Map()
    };
  } else {
    // Allow enabling perf after load: `window.__leditorPerf = true; location.reload()`
    g.__leditorPerfState.enabled = Boolean(g.__leditorPerf);
  }
  return g.__leditorPerfState;
};

export const perfEnabled = (): boolean => getPerfState().enabled;

export const perfMark = (name: string, data?: Record<string, unknown>): void => {
  const state = getPerfState();
  if (!state.enabled) return;
  const at = performance.now();
  state.marks.set(name, at);
  state.events.push({ name, at, data });
};

export const perfMeasure = (name: string, startMark: string, endMark = startMark + ":end"): void => {
  const state = getPerfState();
  if (!state.enabled) return;
  const start = state.marks.get(startMark);
  const end = state.marks.get(endMark);
  if (typeof start !== "number" || typeof end !== "number") return;
  state.events.push({ name, at: end, ms: Math.max(0, end - start) });
};

export const perfSummaryOnce = (label = "PerfSummary"): void => {
  const g = globalThis as typeof globalThis & { __leditorPerfPrinted?: boolean };
  if (g.__leditorPerfPrinted) return;
  g.__leditorPerfPrinted = true;

  const state = getPerfState();
  if (!state.enabled) return;

  const now = performance.now();
  const sinceStart = now - state.t0;
  const measures = state.events.filter((e) => typeof e.ms === "number");
  const last = state.events.slice(-1)[0];

  console.info(`[LEditor][${label}]`, {
    sinceStartMs: Math.round(sinceStart),
    measures: measures.map((m) => ({ name: m.name, ms: Math.round(m.ms as number) })),
    lastEvent: last ? { name: last.name, atMs: Math.round(last.at - state.t0) } : null
  });
};

