const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const electronBin = path.join(repoRoot, "node_modules", ".bin", "electron");

const ledocArg = process.argv[2];
const outArg = process.argv[3];
const ledocPath = ledocArg ? path.resolve(ledocArg) : path.join(repoRoot, "coder_state.ledoc");
const outputPath = outArg ? path.resolve(outArg) : path.join(repoRoot, "pagination_audit_linebreak.json");

const shouldSkipAudit = process.argv.includes("--skip-audit");

const runAudit = () => {
  if (shouldSkipAudit) return;
  if (!fs.existsSync(electronBin)) {
    console.error(`[FAIL] electron binary missing at ${electronBin}`);
    process.exit(1);
  }
  const args = [
    "--disable-setuid-sandbox",
    "--no-sandbox",
    "scripts/pagination_audit.cjs",
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
    console.warn(`[WARN] pagination audit exited with status ${result.status}`);
  }
};

const assertNoForcedLineBreaks = () => {
  if (!fs.existsSync(outputPath)) {
    console.error(`[FAIL] audit output missing at ${outputPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(outputPath, "utf8");
  const data = JSON.parse(raw);
  const needle = "Across the literature, a consistent pattern is the absence of clear legal";
  const pages = Array.isArray(data.pages) ? data.pages : [];
  const match = pages.find((page) => typeof page.fullText === "string" && page.fullText.includes(needle));
  if (!match) {
    console.error("[FAIL] did not find target paragraph in audit output");
    process.exit(1);
  }
  const blocks = Array.isArray(match.blocks) ? match.blocks : [];
  const brCountInText = blocks
    .filter((block) => Number(block.brCount || 0) > 0)
    .filter((block) => (block.sample || []).join(" ").trim().length > 0)
    .reduce((sum, block) => sum + Number(block.brCount || 0), 0);
  const lineTextCount = Number(match.lineTextCount || 0);
  const singleWordLineCount = Number(match.singleWordLineCount || 0);
  const singleWordRatio = lineTextCount > 0 ? singleWordLineCount / lineTextCount : 0;

  const forcedBreaksDetected =
    brCountInText > 0 || (singleWordLineCount >= 10 && singleWordRatio > 0.5);

  if (forcedBreaksDetected) {
    console.error(
      `[FAIL] forced line breaks detected on pageIndex ${match.pageIndex} (brCountInText=${brCountInText}, singleWordLines=${singleWordLineCount}, totalLines=${lineTextCount}, ratio=${singleWordRatio.toFixed(
        2
      )})`
    );
    process.exit(1);
  }

  console.log("[PASS] no forced line breaks detected in target paragraph page");
};

runAudit();
assertNoForcedLineBreaks();
