const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");

const ledocArg = process.argv[2];
const outArg = process.argv[3];
const ledocPath = ledocArg ? path.resolve(ledocArg) : path.join(repoRoot, "coder_state.ledoc");
const outputPath = outArg
  ? path.resolve(outArg)
  : path.join(repoRoot, "pagination_horizontal_flow_guard.json");

const minPageCount = Number.parseInt(process.env.MIN_PAGE_COUNT || "1", 10);
const maxScrollRatio = Number.parseFloat(process.env.MAX_SCROLL_RATIO || "1.02");
const maxScrollDelta = Number.parseFloat(process.env.MAX_SCROLL_DELTA || "2");
const maxRightRatio = Number.parseFloat(process.env.MAX_RIGHT_RATIO || "1.1");
const maxRightDelta = Number.parseFloat(process.env.MAX_RIGHT_DELTA || "8");
const maxBlockOffsetRatio = Number.parseFloat(process.env.MAX_BLOCK_OFFSET_RATIO || "0.2");
const historySamples = Number.parseInt(process.env.HISTORY_SAMPLES || "5", 10);
const minTotalLines = Number.parseInt(process.env.MIN_TOTAL_LINES || "4", 10);

const runSmoke = () => {
  if (!fs.existsSync(electronBin)) {
    console.error(`[FAIL] electron binary missing at ${electronBin}`);
    process.exit(1);
  }
  const args = [
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "scripts/pagination_smoke.cjs",
    ledocPath,
    outputPath
  ];
  const env = { ...process.env, ELECTRON_DISABLE_SANDBOX: "1" };
  const result = spawnSync(electronBin, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    console.warn(`[WARN] pagination smoke exited with status ${result.status}`);
  }
};

const assertHorizontalFlow = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] pagination report missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const pageCount = Number.isFinite(data.pageCount)
    ? data.pageCount
    : Array.isArray(data.pages)
      ? data.pages.length
      : 0;
  if (!Number.isFinite(pageCount) || pageCount <= minPageCount) {
    console.error(`[FAIL] page count ${pageCount} is not greater than ${minPageCount}`);
    process.exit(1);
  }
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const maxRatio = pages.reduce((max, page) => {
    const ratio = Number.isFinite(page?.contentScrollRatio) ? page.contentScrollRatio : 0;
    return Math.max(max, ratio);
  }, 0);
  const maxDelta = pages.reduce((max, page) => {
    const delta = Number.isFinite(page?.contentScrollDelta) ? page.contentScrollDelta : 0;
    return Math.max(max, delta);
  }, 0);
  const totalLines = pages.reduce((sum, page) => sum + (Number.isFinite(page?.totalLines) ? page.totalLines : 0), 0);
  const maxRightRatioSeen = pages.reduce((max, page) => {
    const contentRectWidth = Number.isFinite(page?.contentRectWidth) ? page.contentRectWidth : 0;
    const rightDelta = Number.isFinite(page?.maxRightDelta) ? page.maxRightDelta : 0;
    if (contentRectWidth <= 0) return max;
    const ratio = rightDelta / contentRectWidth;
    return Math.max(max, ratio);
  }, 0);
  const maxRightDeltaSeen = pages.reduce((max, page) => {
    const contentRectWidth = Number.isFinite(page?.contentRectWidth) ? page.contentRectWidth : 0;
    const rightDelta = Number.isFinite(page?.maxRightDelta) ? page.maxRightDelta : 0;
    const delta = rightDelta - contentRectWidth;
    return Math.max(max, delta);
  }, 0);
  if (totalLines < minTotalLines) {
    console.error(`[FAIL] total lines ${totalLines} below minimum ${minTotalLines} (text not loaded)`);
    process.exit(1);
  }
  const maxBlockOffsetLeft = pages.reduce((max, page) => {
    const offset = Number.isFinite(page?.maxBlockOffsetLeft) ? page.maxBlockOffsetLeft : 0;
    return Math.max(max, offset);
  }, 0);
  const maxBlockOffsetRatioSeen = pages.reduce((max, page) => {
    const offset = Number.isFinite(page?.maxBlockOffsetLeft) ? page.maxBlockOffsetLeft : 0;
    const width = Number.isFinite(page?.contentWidth) ? page.contentWidth : 0;
    if (width <= 0) return max;
    return Math.max(max, offset / width);
  }, 0);
  const maxScrollLeft = pages.reduce((max, page) => {
    const left = Number.isFinite(page?.contentScrollLeft) ? page.contentScrollLeft : 0;
    return Math.max(max, left);
  }, 0);
  const maxBlockOffsetRatioHistory = Array.isArray(data.maxBlockOffsetRatioHistory)
    ? data.maxBlockOffsetRatioHistory
    : [];
  const maxScrollLeftHistory = Array.isArray(data.maxScrollLeftHistory)
    ? data.maxScrollLeftHistory
    : [];
  const maxScrollRatioHistory = Array.isArray(data.maxScrollRatioHistory)
    ? data.maxScrollRatioHistory
    : [];
  const tailSlice = (arr) =>
    arr.length > historySamples ? arr.slice(arr.length - historySamples) : arr.slice();
  const recentBlockOffsetRatio = tailSlice(maxBlockOffsetRatioHistory).reduce(
    (max, value) => Math.max(max, Number.isFinite(value) ? value : 0),
    0
  );
  const recentScrollLeft = tailSlice(maxScrollLeftHistory).reduce(
    (max, value) => Math.max(max, Number.isFinite(value) ? value : 0),
    0
  );
  const recentScrollRatio = tailSlice(maxScrollRatioHistory).reduce(
    (max, value) => Math.max(max, Number.isFinite(value) ? value : 0),
    0
  );
  const scrollOverflow = maxRatio > maxScrollRatio || maxDelta > maxScrollDelta;
  const shiftOverflow =
    maxBlockOffsetRatioSeen > maxBlockOffsetRatio ||
    maxScrollLeft > 1 ||
    recentBlockOffsetRatio > maxBlockOffsetRatio ||
    recentScrollLeft > 1;
  const rightOverflow =
    maxRightRatioSeen > maxRightRatio && maxRightDeltaSeen > maxRightDelta && shiftOverflow;
  if ((scrollOverflow && shiftOverflow) || rightOverflow) {
    console.error(
      `[FAIL] horizontal flow detected (scroll ratio ${maxRatio}, scroll delta ${maxDelta}, right ratio ${maxRightRatioSeen}, right delta ${maxRightDeltaSeen}, max block offset ${maxBlockOffsetLeft}, recent scroll ratio ${recentScrollRatio})`
    );
    process.exit(1);
  }
  console.log(
    `[PASS] page count ${pageCount} > ${minPageCount}, max scroll ratio ${maxRatio}, max right ratio ${maxRightRatioSeen}, max block offset ${maxBlockOffsetLeft}, recent scroll ratio ${recentScrollRatio}`
  );
};

runSmoke();
assertHorizontalFlow();
