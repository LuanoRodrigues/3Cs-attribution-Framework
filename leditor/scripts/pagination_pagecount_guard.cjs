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
const expectedPageCount = Number.parseInt(process.env.EXPECTED_PAGE_COUNT || "0", 10);

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
  if (Number.isFinite(expectedPageCount) && expectedPageCount > 0 && pageCount !== expectedPageCount) {
    console.error(
      `[FAIL] page count ${pageCount} does not match expected ${expectedPageCount}`
    );
    process.exit(1);
  }
  const history = Array.isArray(data.pageCountHistory) ? data.pageCountHistory : [];
  const detectAbab = (values) => {
    if (values.length < 4) return false;
    for (let i = 0; i + 3 < values.length; i += 1) {
      const a = values[i];
      const b = values[i + 1];
      const c = values[i + 2];
      const d = values[i + 3];
      if (a === c && b === d && a !== b) return true;
    }
    return false;
  };
  if (history.length > 0 && detectAbab(history)) {
    console.error(`[FAIL] page count oscillation detected (ABAB pattern)`);
    process.exit(1);
  }
  if (Array.isArray(data.footnoteEpochHistory)) {
    const epochs = data.footnoteEpochHistory.filter((v) => Number.isFinite(v));
    if (epochs.length > 1) {
      const delta = Math.max(...epochs) - Math.min(...epochs);
      if (delta > 2) {
        console.warn(`[WARN] footnote epochs changed ${delta} times during smoke run`);
      }
    }
  }
  console.log(`[PASS] page count ${pageCount} is greater than ${minPageCount}`);
};

runSmoke();
assertPageCount();
