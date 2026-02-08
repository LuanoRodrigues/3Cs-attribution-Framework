const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { analyzeReport, formatAnalysis } = require("./pagination_debug_analyze.cjs");

const repoRoot = path.resolve(__dirname, "..");
const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");

const ledocArg = process.argv[2];
const outArg = process.argv[3];
const ledocPath = ledocArg ? path.resolve(ledocArg) : path.join(repoRoot, "coder_state.ledoc");
const outputPath = outArg
  ? path.resolve(outArg)
  : path.join(repoRoot, "pagination_debug_watch.json");

const minPageCount = Number.parseInt(process.env.MIN_PAGE_COUNT || "20", 10);
const maxRange = Number.parseInt(process.env.MAX_PAGECOUNT_RANGE || "1", 10);
const maxChanges = Number.parseInt(process.env.MAX_PAGECOUNT_CHANGES || "4", 10);
const maxScrollRatio = Number.parseFloat(process.env.MAX_SCROLL_RATIO || "1.05");
const warmupRatio = Number.parseFloat(process.env.PAGINATION_DEBUG_WARMUP_RATIO || "0.2");

const runDebugWatch = () => {
  if (!fs.existsSync(electronBin)) {
    console.error(`[FAIL] electron binary missing at ${electronBin}`);
    process.exit(1);
  }
  const args = [
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "scripts/pagination_debug_watch.cjs",
    ledocPath,
    outputPath
  ];
  const env = {
    ...process.env,
    ELECTRON_DISABLE_SANDBOX: "1"
  };
  const result = spawnSync(electronBin, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.warn(`[WARN] pagination debug watch exited with status ${result.status}`);
  }
};

const assertStable = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] pagination debug report missing at ${outputPath}`);
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const analysis = analyzeReport(report, {
    warmupRatio,
    minPageCount,
    maxRange,
    maxChanges,
    maxScrollRatio
  });
  console.log(formatAnalysis(analysis));
  if (!analysis.ok) {
    console.error("[FAIL] pagination oscillation detected");
    process.exit(1);
  }
  console.log("[PASS] pagination stable and above minimum page count");
};

runDebugWatch();
assertStable();
