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
  : path.join(repoRoot, "pagination_pagecount_guard.json");

const minPageCount = Number.parseInt(process.env.MIN_PAGE_COUNT || "20", 10);

const runSmoke = () => {
  if (!fs.existsSync(electronBin)) {
    console.error(`[FAIL] electron binary missing at ${electronBin}`);
    process.exit(1);
  }
  const args = ["--disable-setuid-sandbox", "--no-sandbox", "scripts/pagination_smoke.cjs", ledocPath, outputPath];
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

const assertPageCount = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] pagination output missing at ${outputPath}`);
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
    console.error(
      `[FAIL] page count ${pageCount} is not greater than ${minPageCount} (check for horizontal flow/columns)`
    );
    process.exit(1);
  }
  console.log(`[PASS] page count ${pageCount} is greater than ${minPageCount}`);
};

runSmoke();
assertPageCount();
