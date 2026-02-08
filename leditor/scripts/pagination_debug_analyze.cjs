const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const readReport = (inputPath) => {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`debug report not found: ${inputPath}`);
  }
  const raw = fs.readFileSync(inputPath, "utf8");
  return JSON.parse(raw);
};

const getPageCount = (sample) => {
  const dom = Number.isFinite(sample?.pageCountDom) ? sample.pageCountDom : null;
  const doc = Number.isFinite(sample?.pageCountDoc) ? sample.pageCountDoc : null;
  return dom ?? doc ?? 0;
};

const summarizeTrace = (trace) => {
  const out = { split: 0, join: 0, pullup: 0, merge: 0, total: 0, loops: 0 };
  if (!Array.isArray(trace)) return out;
  const events = trace.filter((entry) => typeof entry?.event === "string");
  out.total = events.length;
  const isSplit = (e) => e.event === "dispatch:split";
  const isJoin = (e) => e.event === "dispatch:join";
  const isPullUp = (e) => e.event === "dispatch:pullup";
  const isMerge = (e) => e.event === "dispatch:mergeContinuation" || e.event === "dispatch:mergeWhitespace";
  for (const entry of events) {
    if (isSplit(entry)) out.split += 1;
    if (isJoin(entry)) out.join += 1;
    if (isPullUp(entry)) out.pullup += 1;
    if (isMerge(entry)) out.merge += 1;
  }
  for (let i = 1; i < events.length; i += 1) {
    const prev = events[i - 1];
    const curr = events[i];
    if (!isSplit(prev) || !isJoin(curr)) continue;
    const prevPos = Number.isFinite(prev.pos) ? prev.pos : null;
    const currPos = Number.isFinite(curr.pos) ? curr.pos : null;
    if (prevPos != null && currPos != null && Math.abs(prevPos - currPos) <= 20) {
      out.loops += 1;
    }
  }
  return out;
};

const analyzeReport = (report, opts = {}) => {
  const samples = Array.isArray(report?.samples) ? report.samples : [];
  const warmupRatio = Number.isFinite(opts.warmupRatio) ? opts.warmupRatio : 0.2;
  const minPageCount = Number.isFinite(opts.minPageCount) ? opts.minPageCount : 20;
  const maxRange = Number.isFinite(opts.maxRange) ? opts.maxRange : 1;
  const maxChanges = Number.isFinite(opts.maxChanges) ? opts.maxChanges : 4;
  const maxScrollRatio = Number.isFinite(opts.maxScrollRatio) ? opts.maxScrollRatio : 1.05;

  const warmup = samples.length > 3 ? Math.max(1, Math.floor(samples.length * warmupRatio)) : 0;
  const stableSamples = samples.slice(warmup);
  const pageCounts = stableSamples.map(getPageCount).filter((count) => Number.isFinite(count) && count > 0);
  const counts = pageCounts.length > 0 ? pageCounts : samples.map(getPageCount).filter((count) => count > 0);
  const minCount = counts.length ? Math.min(...counts) : 0;
  const maxCount = counts.length ? Math.max(...counts) : 0;
  const range = Math.max(0, maxCount - minCount);
  let changes = 0;
  for (let i = 1; i < counts.length; i += 1) {
    if (counts[i] !== counts[i - 1]) changes += 1;
  }
  const ratios = stableSamples
    .map((sample) => (Number.isFinite(sample?.maxScrollRatio) ? sample.maxScrollRatio : null))
    .filter((value) => Number.isFinite(value));
  const peakRatio = ratios.length ? Math.max(...ratios) : 0;
  const overflowActive = stableSamples.some(
    (sample) => sample?.overflowActive === true || (Number.isFinite(sample?.maxScrollRatio) && sample.maxScrollRatio > 1.02)
  );
  const trace = summarizeTrace(report?.trace ?? []);

  const reasons = [];
  if (!samples.length) reasons.push("no samples in debug report");
  if (maxCount <= minPageCount) reasons.push(`page count ${maxCount} is not greater than ${minPageCount}`);
  if (range > maxRange) reasons.push(`page count range ${range} exceeds ${maxRange}`);
  if (changes > maxChanges) reasons.push(`page count changed ${changes} times`);
  if (peakRatio > maxScrollRatio) reasons.push(`max scroll ratio ${peakRatio} exceeds ${maxScrollRatio}`);
  if (overflowActive) reasons.push("horizontal overflow detected (scrollWidth > clientWidth)");
  if (trace.loops > 0) reasons.push(`split/join loop detected (${trace.loops})`);

  const ok = reasons.length === 0;
  return {
    ok,
    warmup,
    samples: samples.length,
    stableSamples: stableSamples.length,
    pageCount: { min: minCount, max: maxCount, range, changes },
    maxScrollRatio: peakRatio,
    overflowActive,
    trace,
    reasons
  };
};

const formatAnalysis = (analysis) => {
  const lines = [];
  lines.push(
    `[ANALYZE] samples=${analysis.samples} warmup=${analysis.warmup} stable=${analysis.stableSamples}`
  );
  lines.push(
    `[ANALYZE] pageCount min=${analysis.pageCount.min} max=${analysis.pageCount.max} range=${analysis.pageCount.range} changes=${analysis.pageCount.changes}`
  );
  lines.push(`[ANALYZE] maxScrollRatio=${analysis.maxScrollRatio} overflowActive=${analysis.overflowActive}`);
  lines.push(
    `[ANALYZE] trace split=${analysis.trace.split} join=${analysis.trace.join} pullup=${analysis.trace.pullup} merge=${analysis.trace.merge} loops=${analysis.trace.loops}`
  );
  if (analysis.reasons.length) {
    lines.push("[ANALYZE] reasons:");
    analysis.reasons.forEach((reason) => lines.push(`- ${reason}`));
  } else {
    lines.push("[ANALYZE] no instability detected");
  }
  return lines.join("\n");
};

if (require.main === module) {
  const inputArg = process.argv[2];
  const inputPath = inputArg ? path.resolve(inputArg) : path.join(repoRoot, "pagination_debug_watch.json");
  const report = readReport(inputPath);
  const analysis = analyzeReport(report, {
    warmupRatio: Number.parseFloat(process.env.PAGINATION_DEBUG_WARMUP_RATIO || "0.2"),
    minPageCount: Number.parseInt(process.env.MIN_PAGE_COUNT || "20", 10),
    maxRange: Number.parseInt(process.env.MAX_PAGECOUNT_RANGE || "1", 10),
    maxChanges: Number.parseInt(process.env.MAX_PAGECOUNT_CHANGES || "4", 10),
    maxScrollRatio: Number.parseFloat(process.env.MAX_SCROLL_RATIO || "1.05")
  });
  if (process.env.PAGINATION_DEBUG_ANALYZE_JSON === "1") {
    console.log(JSON.stringify(analysis, null, 2));
  } else {
    console.log(formatAnalysis(analysis));
  }
  if (process.env.PAGINATION_DEBUG_ANALYZE_STRICT === "1" && !analysis.ok) {
    process.exit(1);
  }
}

module.exports = { analyzeReport, formatAnalysis };
